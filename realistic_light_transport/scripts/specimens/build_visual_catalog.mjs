#!/usr/bin/env node
// Build the versioned visual catalog manifest that drives the specimen workbench.
//
//   node scripts/specimens/build_visual_catalog.mjs            write src/catalog/visual-catalog.v1.json
//   node scripts/specimens/build_visual_catalog.mjs --check    exit 1 when the committed JSON is stale
//
// Options: --root <rlt root> --out <json path> --registry </tmp/pa-lanes/registry.json> --force --quiet
//
// The builder scans art/specimens/*/asset.source.json, every candidates/*/candidate.manifest.json and
// the accepted packages (<id>.asset.json whose promotion is accepted and whose runtime GLB is bundled
// under src/assets/specimens). Species lanes write candidate directories concurrently, so a candidate
// whose manifest is missing or unparsable is kept as a row entry marked `missing` instead of aborting
// the build. Output is deterministic: explicit key order, codepoint sorting, and the only timestamp is
// generatedAt (ignored by --check and by the unchanged-output short circuit). No dependencies.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SCHEMA_VERSION = 'pocket-aquarium.visual-catalog/v1'
export const DEFAULT_OUTPUT = 'src/catalog/visual-catalog.v1.json'
export const DEFAULT_REGISTRY = '/tmp/pa-lanes/registry.json'
// Known categories keep this display order; unknown categories (a future `plant`) sort after them
// alphabetically so the schema does not need to change when they arrive.
export const CATEGORY_ORDER = ['fish', 'coral', 'invertebrate', 'cleanup_crew']
export const ASSET_STATUSES = ['accepted', 'candidate', 'provisional', 'failed', 'missing']

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function readJson(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return { ok: false, reason: 'missing' }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'unparsable' }
  }
}

function fileSize(file) {
  try {
    const stat = fs.statSync(file)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

function sha256File(file) {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return null
  }
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SAFE_SEGMENT.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareStrings)
  } catch {
    return []
  }
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/')
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').sort(compareStrings) : []
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out = {}
  for (const key of Object.keys(value).sort(compareStrings)) out[key] = value[key]
  return out
}

// registry.json approvedByUser values are prose such as "candidates/fable-v1 (digest ...)" or
// "round-v2 (lane fable-v2, ...)"; the candidate directory name is the first token.
export function parseApprovals(registry) {
  const approvals = {}
  const source = registry && typeof registry === 'object' ? registry.approvedByUser : undefined
  if (!source || typeof source !== 'object') return approvals
  for (const speciesId of Object.keys(source).sort(compareStrings)) {
    const raw = String(source[speciesId] ?? '').trim().replace(/^candidates\//, '')
    const candidate = raw.split(/[\s(,;]/)[0]
    if (SAFE_SEGMENT.test(speciesId) && SAFE_SEGMENT.test(candidate)) approvals[speciesId] = candidate
  }
  return approvals
}

function inferVariantId(candidateName, source) {
  const variants = source.variants && typeof source.variants === 'object' ? Object.keys(source.variants) : []
  const match = variants
    .filter((variantId) => candidateName.endsWith(`-${variantId}`))
    .sort((a, b) => b.length - a.length)[0]
  return match ?? null
}

function findAccepted(root, speciesId) {
  const manifest = readJson(path.join(root, 'art', 'specimens', speciesId, `${speciesId}.asset.json`))
  if (!manifest.ok) return null
  const accepted = manifest.value
  if (accepted?.promotion?.status !== 'accepted') return null
  const sha256 = stringOrNull(accepted.runtimeGlbSha256?.lod1)
  if (!sha256) return null
  const bundleRoot = path.join(root, 'src', 'assets', 'specimens', speciesId)
  for (const version of listDirs(bundleRoot)) {
    const glb = path.join(bundleRoot, version, 'lod1.glb')
    if (fileSize(glb) > 0 && sha256File(glb) === sha256) {
      return {
        glb: relative(root, glb),
        sha256,
        assetVersion: stringOrNull(accepted.assetVersion),
        clips: stringList(accepted.statistics?.clips),
        statistics: {
          triangles: numberOrNull(accepted.statistics?.triangles),
          materials: numberOrNull(accepted.statistics?.materials),
          bones: numberOrNull(accepted.statistics?.bones),
          clips: stringList(accepted.statistics?.clips),
        },
      }
    }
  }
  return { glb: null, sha256, assetVersion: stringOrNull(accepted.assetVersion), clips: [], statistics: null, bundleMissing: true }
}

function scanCandidate(root, speciesId, source, candidateName, approvals) {
  const dir = path.join(root, 'art', 'specimens', speciesId, 'candidates', candidateName)
  const manifest = readJson(path.join(dir, 'candidate.manifest.json'))
  const build = readJson(path.join(dir, 'build-receipt.json'))
  const digest = readJson(path.join(dir, 'geometry-digest.json'))
  const glbFile = path.join(dir, 'lod1.glb')
  const hasGlb = fileSize(glbFile) > 0
  const renderFile = (name) => {
    const file = path.join(dir, 'renders', name)
    return fileSize(file) > 0 ? relative(root, file) : null
  }
  const inferredVariant = inferVariantId(candidateName, source)
  const buildStatus = build.ok ? stringOrNull(build.value.status) ?? 'unknown' : build.reason
  const buildFailedStage = build.ok ? stringOrNull(build.value.failure?.stage) : null
  const userApproved = approvals[speciesId] === candidateName
  const renders = { authorPreview: renderFile('author-preview.png'), threeView: renderFile('three-view.png') }

  if (!manifest.ok) {
    const variantDisplay = inferredVariant ? stringOrNull(source.variants?.[inferredVariant]?.displayName) : null
    return {
      name: candidateName,
      variantId: inferredVariant,
      displayName: variantDisplay ?? stringOrNull(source.displayName) ?? speciesId,
      state: 'missing',
      manifest: manifest.reason,
      validatorStatus: null,
      buildStatus,
      buildFailedStage,
      assetVersion: null,
      loadable: false,
      glb: hasGlb ? relative(root, glbFile) : null,
      glbSha256: null,
      glbSha256Verified: false,
      geometryDigest: digest.ok ? stringOrNull(digest.value.geometryDigest) : null,
      statistics: null,
      clipRoles: null,
      clipLoops: null,
      referenceSizeMeters: null,
      userApproved,
      renders,
    }
  }

  const data = manifest.value
  const variantId = stringOrNull(data.variantId) ?? inferredVariant
  const glbSha256 = stringOrNull(data.runtimeGlbSha256?.lod1)
  const statistics = data.statistics && typeof data.statistics === 'object'
    ? {
      triangles: numberOrNull(data.statistics.triangles),
      materials: numberOrNull(data.statistics.materials),
      bones: numberOrNull(data.statistics.bones),
      clips: stringList(data.statistics.clips),
    }
    : null
  return {
    name: candidateName,
    variantId,
    displayName: stringOrNull(data.displayName)
      ?? (variantId ? stringOrNull(source.variants?.[variantId]?.displayName) : null)
      ?? stringOrNull(source.displayName)
      ?? speciesId,
    state: stringOrNull(data.candidate?.state) ?? 'unknown',
    manifest: 'present',
    validatorStatus: stringOrNull(data.validator?.status) ?? 'pending',
    buildStatus,
    buildFailedStage,
    assetVersion: stringOrNull(data.assetVersion),
    loadable: hasGlb,
    glb: hasGlb ? relative(root, glbFile) : null,
    glbSha256,
    glbSha256Verified: Boolean(hasGlb && glbSha256 && sha256File(glbFile) === glbSha256),
    geometryDigest: digest.ok ? stringOrNull(digest.value.geometryDigest) : null,
    statistics,
    clipRoles: plainRecord(data.clipRoles),
    clipLoops: plainRecord(data.clipLoops),
    referenceSizeMeters: numberOrNull(data.referenceSizeMeters) ?? numberOrNull(source.referenceSize?.meters),
    userApproved,
    renders,
  }
}

function candidateFailed(candidate) {
  return candidate.buildStatus === 'failed' || candidate.validatorStatus === 'failed'
}

export function deriveAssetStatus({ accepted, provisional, candidates }) {
  if (accepted && accepted.glb) return 'accepted'
  if (provisional) return 'provisional'
  if (candidates.some((candidate) => candidate.loadable && candidate.validatorStatus === 'passed')) return 'candidate'
  if (candidates.length > 0 && candidates.every(candidateFailed)) return 'failed'
  return 'missing'
}

function categoryRank(category, categories) {
  const index = categories.indexOf(category)
  return index === -1 ? categories.length : index
}

export function compareRows(a, b, categories = CATEGORY_ORDER) {
  const rank = categoryRank(a.category, categories) - categoryRank(b.category, categories)
  if (rank !== 0) return rank
  return compareStrings(a.category, b.category)
    || compareStrings(a.displayName, b.displayName)
    || compareStrings(a.id, b.id)
}

function buildRow(root, speciesId, source, approvals, warnings) {
  const accepted = findAccepted(root, speciesId)
  if (accepted?.bundleMissing) {
    warnings.push(`${speciesId}: accepted manifest found but no bundled GLB matches ${accepted.sha256}; treating as not accepted`)
  }
  const candidateNames = listDirs(path.join(root, 'art', 'specimens', speciesId, 'candidates'))
  const candidates = candidateNames.map((name) => scanCandidate(root, speciesId, source, name, approvals))
  const provisional = source.provisional ?? false
  const referenceSize = source.referenceSize && typeof source.referenceSize === 'object' ? source.referenceSize : {}
  const sourceReferences = path.join(root, 'art', 'specimens', speciesId, 'source-references.json')
  const variants = source.variants && typeof source.variants === 'object'
    ? Object.keys(source.variants).sort(compareStrings).map((id) => ({
      id,
      displayName: stringOrNull(source.variants[id]?.displayName) ?? id,
    }))
    : []
  const assetStatus = deriveAssetStatus({ accepted, provisional, candidates })
  return {
    id: speciesId,
    displayName: stringOrNull(source.displayName) ?? speciesId,
    scientificLabel: stringOrNull(source.scientificLabel),
    taxonomyConfidence: stringOrNull(source.taxonomyConfidence),
    category: stringOrNull(source.category) ?? 'unknown',
    waterType: stringOrNull(source.waterType),
    bodyPlan: stringOrNull(source.bodyPlan),
    referenceSize: { meters: numberOrNull(referenceSize.meters), kind: stringOrNull(referenceSize.kind) },
    referenceGrade: stringOrNull(source.referenceGrade),
    assetStatus,
    assetVersion: (assetStatus === 'accepted' ? accepted.assetVersion : null) ?? stringOrNull(source.assetVersion),
    provisional,
    accepted: {
      glb: assetStatus === 'accepted' ? accepted.glb : null,
      sha256: assetStatus === 'accepted' ? accepted.sha256 : null,
      clips: assetStatus === 'accepted' ? accepted.clips : [],
      statistics: assetStatus === 'accepted' ? accepted.statistics : null,
    },
    candidates,
    variants,
    clipRoles: plainRecord(source.clipRoles),
    provenance: {
      source: `art/specimens/${speciesId}/asset.source.json`,
      sourceReferences: fileSize(sourceReferences) > 0 ? relative(root, sourceReferences) : null,
      referenceGrade: stringOrNull(source.referenceGrade),
    },
    visualDebt: Array.isArray(source.visualDebt) ? source.visualDebt.filter((item) => typeof item === 'string') : [],
  }
}

function summarize(rows, categories) {
  const byCategory = {}
  for (const category of categories) byCategory[category] = 0
  const byStatus = {}
  for (const status of ASSET_STATUSES) byStatus[status] = 0
  let total = 0
  let loadable = 0
  let missing = 0
  let userApproved = 0
  for (const row of rows) {
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1
    byStatus[row.assetStatus] = (byStatus[row.assetStatus] ?? 0) + 1
    for (const candidate of row.candidates) {
      total += 1
      if (candidate.loadable) loadable += 1
      if (candidate.state === 'missing') missing += 1
      if (candidate.userApproved) userApproved += 1
    }
  }
  return { rows: rows.length, byCategory, byStatus, candidates: { total, loadable, missing, userApproved } }
}

export function buildVisualCatalog({ root = SCRIPT_ROOT, approvals = {}, generatedAt = new Date().toISOString() } = {}) {
  const warnings = []
  const specimens = path.join(root, 'art', 'specimens')
  const rows = []
  for (const speciesId of listDirs(specimens)) {
    const source = readJson(path.join(specimens, speciesId, 'asset.source.json'))
    if (!source.ok) {
      if (source.reason === 'unparsable') warnings.push(`${speciesId}: asset.source.json is unparsable; row skipped`)
      continue
    }
    if (source.value?.schemaVersion !== 'pocket-aquarium.asset-source/v1') {
      warnings.push(`${speciesId}: unexpected asset.source.json schemaVersion ${JSON.stringify(source.value?.schemaVersion)}`)
    }
    rows.push(buildRow(root, speciesId, source.value, approvals, warnings))
  }
  const extraCategories = [...new Set(rows.map((row) => row.category))]
    .filter((category) => !CATEGORY_ORDER.includes(category))
    .sort(compareStrings)
  const categories = [...CATEGORY_ORDER, ...extraCategories]
  rows.sort((a, b) => compareRows(a, b, categories))
  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    categories,
    assetStatuses: ASSET_STATUSES,
    userApprovals: Object.fromEntries(Object.keys(approvals).sort(compareStrings).map((id) => [id, approvals[id]])),
    summary: summarize(rows, categories),
    rows,
  }
  return { catalog, warnings }
}

export function serializeCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`
}

export function stripGeneratedAt(catalog) {
  if (!catalog || typeof catalog !== 'object') return catalog
  const { generatedAt: _ignored, ...rest } = catalog
  return rest
}

export function catalogsMatch(a, b) {
  return JSON.stringify(stripGeneratedAt(a)) === JSON.stringify(stripGeneratedAt(b))
}

function describeDifferences(previous, next) {
  const lines = []
  if (!previous || typeof previous !== 'object') return ['no committed catalog to compare against']
  const before = new Map((previous.rows ?? []).map((row) => [row.id, row]))
  const after = new Map((next.rows ?? []).map((row) => [row.id, row]))
  for (const id of after.keys()) {
    if (!before.has(id)) lines.push(`+ row ${id}`)
    else if (JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))) lines.push(`~ row ${id}`)
  }
  for (const id of before.keys()) if (!after.has(id)) lines.push(`- row ${id}`)
  for (const key of ['schemaVersion', 'categories', 'assetStatuses', 'userApprovals', 'summary']) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) lines.push(`~ ${key}`)
  }
  return lines.length ? lines : ['content differs']
}

function parseArgs(argv) {
  const options = { check: false, force: false, quiet: false, root: SCRIPT_ROOT, out: null, registry: DEFAULT_REGISTRY }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') options.check = true
    else if (arg === '--force') options.force = true
    else if (arg === '--quiet') options.quiet = true
    else if (arg === '--root') options.root = path.resolve(argv[++index] ?? '')
    else if (arg === '--out') options.out = argv[++index] ?? null
    else if (arg === '--registry') options.registry = argv[++index] ?? DEFAULT_REGISTRY
    else throw new Error(`Unknown argument ${arg}`)
  }
  options.out = path.resolve(options.root, options.out ?? DEFAULT_OUTPUT)
  return options
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const log = options.quiet ? () => {} : (message) => console.log(message)
  const existing = readJson(options.out)
  const registry = readJson(options.registry)
  let approvals
  if (registry.ok) {
    approvals = parseApprovals(registry.value)
  } else {
    // Without the lane registry (CI, another machine) keep the approvals already recorded in the
    // committed catalog so --check stays meaningful.
    approvals = existing.ok && existing.value.userApprovals ? existing.value.userApprovals : {}
    log(`note: registry ${options.registry} ${registry.reason}; reusing ${Object.keys(approvals).length} recorded approval(s)`)
  }
  const { catalog, warnings } = buildVisualCatalog({ root: options.root, approvals })
  for (const warning of warnings) console.error(`warning: ${warning}`)
  const summary = catalog.summary
  const counts = Object.entries(summary.byCategory).map(([category, count]) => `${category}=${count}`).join(' ')
  const statuses = Object.entries(summary.byStatus).map(([status, count]) => `${status}=${count}`).join(' ')
  log(`visual catalog: ${summary.rows} rows (${counts}); status ${statuses}; candidates ${summary.candidates.total} (${summary.candidates.loadable} loadable, ${summary.candidates.missing} missing, ${summary.candidates.userApproved} user approved)`)

  const fresh = existing.ok && catalogsMatch(existing.value, catalog)
  if (options.check) {
    if (fresh) {
      log(`check: ${relative(options.root, options.out)} is up to date`)
      return 0
    }
    console.error(`check: ${relative(options.root, options.out)} is stale; rerun node scripts/specimens/build_visual_catalog.mjs`)
    for (const line of describeDifferences(existing.ok ? existing.value : null, catalog)) console.error(`  ${line}`)
    return 1
  }
  if (fresh && !options.force) {
    log(`unchanged: ${relative(options.root, options.out)}`)
    return 0
  }
  fs.mkdirSync(path.dirname(options.out), { recursive: true })
  fs.writeFileSync(options.out, serializeCatalog(catalog))
  log(`wrote ${relative(options.root, options.out)}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}
