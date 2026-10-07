import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, open, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const RLT_ROOT = await realpath(resolve(process.env.SPECIMEN_STUDIO_RLT_ROOT || SCRIPT_ROOT))
const DOCUMENTS = ['specimen.package.json', 'biology.profile.json', 'simulation.calibration.json', 'morphology.profile.json', 'source-references.json']
const SPECIES = new Map([['ocellaris', 'ocellaris']])
const HASH = /^[a-f0-9]{64}$/
const fail = (message) => { throw new Error(message) }
const digest = (value) => createHash('sha256').update(value).digest('hex')
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const writeJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
const fileHash = async (path) => digest(await readFile(path))
const within = (root, path) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep)) }
const safeFile = async (root, path) => { const actual = await realpath(path); if (!within(root, actual)) fail('symlink_path_escape'); return actual }

async function safeRoots(speciesId, createCandidates = false) {
  const folder = SPECIES.get(speciesId)
  if (!folder) fail('unsupported_species')
  const specimenRoot = await realpath(resolve(RLT_ROOT, 'art/specimens'))
  const packageRoot = await realpath(resolve(specimenRoot, folder))
  if (!within(specimenRoot, packageRoot)) fail('specimen_path_escape')
  const candidatesRoot = resolve(packageRoot, 'candidates')
  if (createCandidates) {
    await mkdir(candidatesRoot, { recursive: true })
    if (!within(packageRoot, await realpath(candidatesRoot))) fail('candidate_path_escape')
  } else if (!within(packageRoot, candidatesRoot)) fail('candidate_path_escape')
  return { packageRoot, candidatesRoot }
}

async function acceptedState(packageRoot) {
  const manifest = await readJson(resolve(packageRoot, 'specimen.package.json'))
  const acceptedAsset = await realpath(resolve(packageRoot, manifest.files.acceptedAsset))
  const expectedAsset = await realpath(resolve(RLT_ROOT, 'src/assets/specimens/ocellaris/v1/lod1.glb'))
  if (acceptedAsset !== expectedAsset) fail('accepted_asset_path_mismatch')
  const acceptedHash = await fileHash(acceptedAsset)
  if (manifest.promotion.acceptedHash !== acceptedHash) fail('accepted_hash_mismatch')
  return { manifest, acceptedAsset, acceptedHash }
}

async function requestBody() {
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > 1024 * 1024) fail('payload_too_large')
    chunks.push(chunk)
  }
  try { return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {} }
  catch { fail('invalid_json') }
}

function validateSource(source, speciesId) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('source_required')
  const keys = Object.keys(source).sort()
  if (keys.join('|') !== [...DOCUMENTS].sort().join('|')) fail('source_document_set_mismatch')
  for (const name of DOCUMENTS) if (!source[name] || typeof source[name] !== 'object' || Array.isArray(source[name]) || source[name].speciesId !== speciesId && name !== 'source-references.json') fail(`invalid_${name}`)
  const manifest = source['specimen.package.json']
  if (manifest.schemaVersion !== 'pocket-aquarium.specimen-package/v1') fail('invalid_package_schema')
  const expectedFiles = { biology: 'biology.profile.json', calibration: 'simulation.calibration.json', morphology: 'morphology.profile.json', sources: 'source-references.json', acceptedAsset: '../../../src/assets/specimens/ocellaris/v1/lod1.glb', acceptance: 'ocellaris.asset.json' }
  if (JSON.stringify(stable(manifest.files)) !== JSON.stringify(stable(expectedFiles))) fail('unsafe_package_files')
}

async function status(speciesId) {
  const { packageRoot, candidatesRoot } = await safeRoots(speciesId)
  const { manifest, acceptedHash } = await acceptedState(packageRoot)
  return { speciesId, state: manifest.promotion.state, acceptedHash, revisions: manifest.revisions, candidateRoot: relative(RLT_ROOT, candidatesRoot) }
}

async function validate(speciesId, payload) {
  const { packageRoot, candidatesRoot } = await safeRoots(speciesId, true)
  const before = await acceptedState(packageRoot)
  if (!HASH.test(payload.baseAcceptedHash || '') || payload.baseAcceptedHash !== before.acceptedHash) fail('stale_accepted_hash')
  validateSource(payload.source, speciesId)
  const work = await mkdtemp(resolve(candidatesRoot, '.build-'))
  try {
    const sourceDir = resolve(work, 'source')
    await mkdir(sourceDir)
    await Promise.all(DOCUMENTS.map((name) => writeJson(resolve(sourceDir, name), payload.source[name])))
    const builder = await realpath(resolve(RLT_ROOT, 'scripts/specimens/build_ocellaris.sh'))
    if (!within(await realpath(resolve(RLT_ROOT, 'scripts/specimens')), builder)) fail('builder_path_escape')
    await run(builder, ['--package-dir', sourceDir, '--candidate-dir', work], { cwd: RLT_ROOT, env: process.env, shell: false, maxBuffer: 1024 * 1024 })
    const receipt = await readJson(await safeFile(work, resolve(work, 'validation-receipt.json')))
    await verifyReceipt(work, receipt, before.acceptedHash)
    const finalDir = resolve(candidatesRoot, receipt.candidateHash)
    if (!within(candidatesRoot, finalDir)) fail('candidate_path_escape')
    try {
      const existing = await realpath(finalDir)
      if (!within(candidatesRoot, existing) || JSON.stringify(await readJson(resolve(existing, 'validation-receipt.json'))) !== JSON.stringify(receipt)) fail('candidate_hash_collision')
      await rm(work, { recursive: true })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await rename(work, finalDir)
    }
    if ((await acceptedState(packageRoot)).acceptedHash !== before.acceptedHash) fail('validation_mutated_accepted_asset')
    return receipt
  } catch (error) {
    await rm(work, { recursive: true, force: true })
    throw error
  }
}

async function verifyReceipt(candidateRoot, receipt, expectedBase) {
  if (receipt.schemaVersion !== 'pocket-aquarium.specimen-validation/v1' || receipt.speciesId !== 'ocellaris' || receipt.status !== 'passed' || receipt.state !== 'awaiting_user_acceptance' || receipt.acceptance?.performed !== false || receipt.baseAcceptedHash !== expectedBase) fail('validation_receipt_incomplete')
  if (receipt.blenderVersion !== '5.2.1 LTS') fail('unapproved_blender_version')
  const sourceDir = await realpath(resolve(candidateRoot, 'source'))
  if (!within(candidateRoot, sourceDir)) fail('source_path_escape')
  const names = { package: DOCUMENTS[0], biology: DOCUMENTS[1], calibration: DOCUMENTS[2], morphology: DOCUMENTS[3], sources: DOCUMENTS[4] }
  const sourceHashes = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) => [key, await fileHash(await safeFile(sourceDir, resolve(sourceDir, name)))])))
  if (JSON.stringify(sourceHashes) !== JSON.stringify(receipt.sourceJsonFiles) || digest(JSON.stringify(stable(sourceHashes))) !== receipt.sourceJsonHash) fail('source_receipt_stale')
  const glb = await safeFile(candidateRoot, resolve(candidateRoot, 'lod1.glb'))
  if (await fileHash(glb) !== receipt.candidateGlbHash) fail('candidate_receipt_stale')
  const geometry = await readJson(await safeFile(candidateRoot, resolve(candidateRoot, 'geometry-digest.json')))
  if (geometry.geometryDigest !== receipt.geometryDigest || geometry.morphologySha256 !== receipt.morphologySha256) fail('geometry_receipt_stale')
  for (const stage of ['source', 'runtime']) {
    const name = `validation-${stage}.json`
    const reportPath = await safeFile(candidateRoot, resolve(candidateRoot, name))
    const report = await readJson(reportPath)
    if (report.status !== 'passed' || report.binary !== receipt.blenderVersion || receipt.stages?.[stage]?.status !== 'passed' || receipt.stages[stage].report !== name || await fileHash(reportPath) !== receipt.stages[stage].sha256) fail('validation_stage_stale')
  }
  const builder = { entrypoint: await fileHash(resolve(RLT_ROOT, 'scripts/specimens/author_specimen.py')), speciesBackend: await fileHash(resolve(RLT_ROOT, 'scripts/specimens/author_ocellaris.py')) }
  if (JSON.stringify(builder) !== JSON.stringify(receipt.builderVersion)) fail('builder_receipt_stale')
  const identity = { sourceJsonHash: receipt.sourceJsonHash, candidateGlbHash: receipt.candidateGlbHash, geometryDigest: receipt.geometryDigest, builderVersion: receipt.builderVersion, blenderVersion: receipt.blenderVersion, baseAcceptedHash: receipt.baseAcceptedHash }
  if (digest(JSON.stringify(stable(identity))) !== receipt.candidateHash) fail('candidate_identity_stale')
  return { sourceDir, glb }
}

async function accept(speciesId, payload) {
  if (!HASH.test(payload.candidateHash || '') || !HASH.test(payload.expectedAcceptedHash || '')) fail('invalid_hash')
  if (payload.confirmation !== `ACCEPT ${speciesId} ${payload.candidateHash}`) fail('explicit_confirmation_required')
  const { packageRoot, candidatesRoot } = await safeRoots(speciesId)
  const lockPath = resolve(packageRoot, '.promotion.lock')
  let lock
  try { lock = await open(lockPath, 'wx') } catch { fail('promotion_in_progress') }
  try {
    const candidateRoot = await realpath(resolve(candidatesRoot, payload.candidateHash))
    if (!within(candidatesRoot, candidateRoot)) fail('candidate_path_escape')
    const receipt = await readJson(await safeFile(candidateRoot, resolve(candidateRoot, 'validation-receipt.json')))
    const current = await acceptedState(packageRoot)
    if (payload.expectedAcceptedHash !== current.acceptedHash) fail('stale_accepted_hash')
    const { sourceDir, glb } = await verifyReceipt(candidateRoot, receipt, current.acceptedHash)
    const source = Object.fromEntries(await Promise.all(DOCUMENTS.map(async (name) => [name, await readJson(resolve(sourceDir, name))])))
    const rollbackRoot = resolve(packageRoot, 'accepted/rollback', current.acceptedHash)
    await mkdir(rollbackRoot, { recursive: true })
    await cp(current.acceptedAsset, resolve(rollbackRoot, 'lod1.glb'))
    await Promise.all([...DOCUMENTS, 'ocellaris.asset.json'].map((name) => cp(resolve(packageRoot, name), resolve(rollbackRoot, name))))
    const nextManifest = source['specimen.package.json']
    nextManifest.promotion = { state: 'accepted', acceptedHash: receipt.candidateGlbHash, baseAcceptedHash: current.acceptedHash, candidateHash: null, validationReceipt: `candidates/${payload.candidateHash}/validation-receipt.json`, acceptanceReceipt: `candidates/${payload.candidateHash}/acceptance-receipt.json` }
    const assetManifest = await readJson(resolve(packageRoot, 'ocellaris.asset.json'))
    assetManifest.assetVersion = nextManifest.revisions.asset
    assetManifest.runtimeGlbSha256.lod1 = receipt.candidateGlbHash
    assetManifest.promotion = { status: 'accepted', acceptedBy: 'explicit_local_user', acceptedOn: new Date().toISOString(), promotedAssetVersion: nextManifest.revisions.asset, rollback: { assetVersion: current.manifest.revisions.asset, runtimeGlbSha256: current.acceptedHash } }
    const acceptance = { schemaVersion: 'pocket-aquarium.acceptance-receipt/v1', speciesId, candidateHash: payload.candidateHash, acceptedHash: receipt.candidateGlbHash, previousAcceptedHash: current.acceptedHash, validationReceiptHash: await fileHash(resolve(candidateRoot, 'validation-receipt.json')), rollback: relative(RLT_ROOT, rollbackRoot) }
    try {
      await cp(glb, current.acceptedAsset)
      await Promise.all(DOCUMENTS.map((name) => writeJson(resolve(packageRoot, name), name === 'specimen.package.json' ? nextManifest : source[name])))
      await writeJson(resolve(packageRoot, 'ocellaris.asset.json'), assetManifest)
      await run(process.execPath, [resolve(RLT_ROOT, 'scripts/specimens/compile_profiles.mjs')], { cwd: RLT_ROOT, shell: false })
      await writeJson(resolve(candidateRoot, 'acceptance-receipt.json'), acceptance)
    } catch (error) {
      await cp(resolve(rollbackRoot, 'lod1.glb'), current.acceptedAsset)
      await Promise.all([...DOCUMENTS, 'ocellaris.asset.json'].map((name) => cp(resolve(rollbackRoot, name), resolve(packageRoot, name))))
      await rm(resolve(candidateRoot, 'acceptance-receipt.json'), { force: true })
      await run(process.execPath, [resolve(RLT_ROOT, 'scripts/specimens/compile_profiles.mjs')], { cwd: RLT_ROOT, shell: false }).catch(() => {})
      throw error
    }
    return acceptance
  } finally {
    await lock.close()
    await unlink(lockPath).catch(() => {})
  }
}

try {
  const [operation, flag, speciesId] = process.argv.slice(2)
  if (flag !== '--species' || !SPECIES.has(speciesId)) fail('unsupported_species')
  const payload = await requestBody()
  const result = operation === 'status' ? await status(speciesId) : operation === 'validate' ? await validate(speciesId, payload) : operation === 'accept' ? await accept(speciesId, payload) : fail('unsupported_operation')
  process.stdout.write(JSON.stringify(result))
} catch (error) {
  process.stderr.write(error.message || 'lifecycle_failed')
  process.exitCode = 1
}
