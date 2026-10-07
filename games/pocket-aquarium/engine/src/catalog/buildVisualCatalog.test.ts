// @ts-nocheck -- this project intentionally has no @types/node dependency.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/specimens/build_visual_catalog.mjs')

function write(file: string, contents: string | Buffer) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents)
}

function json(file: string, value: unknown) {
  write(file, `${JSON.stringify(value, null, 2)}\n`)
}

function source(id: string, extra: Record<string, unknown>) {
  return {
    schemaVersion: 'pocket-aquarium.asset-source/v1',
    id,
    displayName: id,
    scientificLabel: `${id} sp.`,
    taxonomyConfidence: 'species',
    category: 'fish',
    waterType: 'saltwater',
    bodyPlan: 'fish',
    assetVersion: '0.1.0',
    referenceGrade: 'B',
    referenceSize: { meters: 0.1, kind: 'adult_total_length', note: 'fixture' },
    origin: 'anatomical_midbody',
    clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
    visualDebt: ['fixture debt'],
    ...extra,
  }
}

function manifest(speciesId: string, extra: Record<string, unknown>) {
  return {
    schemaVersion: 2,
    speciesId,
    variantId: null,
    displayName: speciesId,
    assetVersion: '0.1.0',
    referenceSizeMeters: 0.1,
    referenceSizeKind: 'adult_total_length',
    candidate: { state: 'awaiting_user_acceptance', candidateHash: 'hash' },
    validator: { status: 'passed' },
    runtimeGlbSha256: { lod1: 'unverified' },
    statistics: { triangles: 1234, materials: 3, bones: 7, clips: ['swim', 'burst', 'idle'] },
    clipRoles: { response: 'burst', locomotion: 'swim', idle: 'idle' },
    clipLoops: { swim: true, burst: false, idle: true },
    ...extra,
  }
}

function makeFixture(root: string) {
  const specimens = join(root, 'art', 'specimens')
  const glb = Buffer.from('glTF fixture bytes')
  const glbSha = createHash('sha256').update(glb).digest('hex')

  // Accepted Ocellaris: promotion accepted and the bundled GLB hash matches the manifest.
  json(join(specimens, 'ocellaris', 'asset.source.json'), source('ocellaris', { displayName: 'Ocellaris Clownfish', scientificLabel: 'Amphiprion ocellaris', assetVersion: '2.0.0-candidate', referenceSize: { meters: 0.08, kind: 'adult_total_length' } }))
  json(join(specimens, 'ocellaris', 'ocellaris.asset.json'), {
    schemaVersion: 2, speciesId: 'ocellaris', assetVersion: '1.1.0', runtimeGlbSha256: { lod1: glbSha },
    statistics: { triangles: 9052, materials: 6, bones: 14, clips: ['burst', 'idle', 'swim'] }, promotion: { status: 'accepted' },
  })
  write(join(root, 'src', 'assets', 'specimens', 'ocellaris', 'v1', 'lod1.glb'), glb)
  json(join(specimens, 'ocellaris', 'candidates', 'fable-v2', 'candidate.manifest.json'), manifest('ocellaris', { assetVersion: '2.0.0-candidate' }))
  write(join(specimens, 'ocellaris', 'candidates', 'fable-v2', 'lod1.glb'), glb)

  // Complete candidate package with renders and a verified GLB hash.
  json(join(specimens, 'epaulette_shark', 'asset.source.json'), source('epaulette_shark', { displayName: 'Epaulette Shark', referenceSize: { meters: 0.9, kind: 'adult_total_length' } }))
  json(join(specimens, 'epaulette_shark', 'source-references.json'), { schemaVersion: 'pocket-aquarium.source-references/v1', sources: [] })
  const shark = join(specimens, 'epaulette_shark', 'candidates', 'fable-v1')
  json(join(shark, 'candidate.manifest.json'), manifest('epaulette_shark', { displayName: 'Epaulette Shark', referenceSizeMeters: 0.9, runtimeGlbSha256: { lod1: glbSha } }))
  json(join(shark, 'build-receipt.json'), { status: 'passed', failure: null, finishedAt: '2026-09-03T00:00:00.000Z' })
  json(join(shark, 'geometry-digest.json'), { geometryDigest: 'shark-digest' })
  write(join(shark, 'lod1.glb'), glb)
  write(join(shark, 'renders', 'three-view.png'), Buffer.alloc(4, 1))

  // Candidate directory that a lane is still writing: no manifest yet.
  json(join(specimens, 'trochus_snail', 'asset.source.json'), source('trochus_snail', { displayName: 'Trochus Snail', category: 'cleanup_crew', bodyPlan: 'gastropod', referenceSize: { meters: 0.03, kind: 'adult_shell_diameter' } }))
  write(join(specimens, 'trochus_snail', 'candidates', 'fable-v1', 'build.log'), '# building\n')

  // Failed build: receipt present, no manifest, no GLB.
  json(join(specimens, 'six_line_wrasse', 'asset.source.json'), source('six_line_wrasse', { displayName: 'Six-line Wrasse' }))
  json(join(specimens, 'six_line_wrasse', 'candidates', 'fable-v1', 'build-receipt.json'), { status: 'failed', failure: { stage: 'source' } })

  // Variants: one candidate without variantId in its manifest, one with an unparsable manifest.
  json(join(specimens, 'acropora_branching', 'asset.source.json'), source('acropora_branching', {
    displayName: 'Acropora (branching SPS)', category: 'coral', bodyPlan: 'branching_sps_coral', taxonomyConfidence: 'genus',
    referenceSize: { meters: 0.15, kind: 'colony_width' }, clipRoles: { idle: 'sway', locomotion: 'flow', response: 'retract' },
    variants: { table_blue: { displayName: 'Acropora table, blue', overrides: {} }, bushy_pink: { displayName: 'Acropora digitate, pink', overrides: {} } },
  }))
  const tableBlue = join(specimens, 'acropora_branching', 'candidates', 'fable-v1-table_blue')
  const tableManifest = manifest('acropora_branching', { displayName: 'Acropora table, blue', referenceSizeMeters: 0.15, referenceSizeKind: 'colony_width' })
  delete tableManifest.variantId
  json(join(tableBlue, 'candidate.manifest.json'), tableManifest)
  write(join(tableBlue, 'lod1.glb'), glb)
  write(join(specimens, 'acropora_branching', 'candidates', 'fable-v1-bushy_pink', 'candidate.manifest.json'), '{ "truncated": ')

  // User-approved candidate resolved from the lane registry.
  json(join(specimens, 'blue_hippo_tang', 'asset.source.json'), source('blue_hippo_tang', { displayName: 'Blue Hippo Tang', referenceSize: { meters: 0.25, kind: 'adult_total_length' } }))
  const approved = join(specimens, 'blue_hippo_tang', 'candidates', 'approved-v2')
  json(join(approved, 'candidate.manifest.json'), manifest('blue_hippo_tang', { displayName: 'Blue Hippo Tang', referenceSizeMeters: 0.25 }))
  json(join(approved, 'build-receipt.json'), { status: 'passed', failure: null })
  write(join(approved, 'lod1.glb'), glb)

  // Provisional species and a future category / water type.
  json(join(specimens, 'goniopora', 'asset.source.json'), source('goniopora', { displayName: 'Goniopora', category: 'coral', provisional: true }))
  json(join(specimens, 'kelp', 'asset.source.json'), source('kelp', { displayName: 'Kelp', category: 'plant', waterType: 'freshwater', bodyPlan: 'macroalgae', referenceSize: { meters: 0.3, kind: 'frond_height' } }))

  // Ignored: review scratch dir, unparsable source, directory without a source yet.
  write(join(specimens, '_review', 'note.txt'), 'ignored')
  write(join(specimens, 'broken', 'asset.source.json'), 'not json')
  mkdirSync(join(specimens, 'incoming'), { recursive: true })

  json(join(root, 'registry.json'), {
    approvedByUser: {
      blue_hippo_tang: 'candidates/approved-v2',
      gem_tang: 'round-v2 (lane fable-v2, branch lane/gem_tang-fable-v2 e49b44f, digest 88bfbd8f...), user 17:20',
      'Bad Species': 'nope',
    },
  })
  json(join(specimens, 'user-acceptance.v1.json'), {
    schemaVersion: 'pocket-aquarium.user-acceptance/v1',
    excluded: ['gem_tang/fable-v2 (superseded by round-v2)'],
    entries: [
      { speciesId: 'blue_hippo_tang', candidate: 'approved-v2', status: 'user_accepted', userApprovedLook: true },
      { speciesId: 'gem_tang', candidate: 'round-v2', status: 'user_accepted', userApprovedLook: true },
      { speciesId: 'gem_tang', candidate: 'fable-v2', status: 'user_accepted', userApprovedLook: true },
    ],
  })
  return { glbSha }
}

function run(root: string, args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

function readCatalog(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function withoutTimestamp(text: string) {
  return text.replace(/^\s*"generatedAt": ".*",\n/m, '')
}

describe('build_visual_catalog.mjs', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function fixtureRoot() {
    const root = mkdtempSync(join(tmpdir(), 'pa-visual-catalog-'))
    roots.push(root)
    return root
  }

  it('writes a versioned, sorted catalog and tolerates partially written candidate directories', () => {
    const root = fixtureRoot()
    const { glbSha } = makeFixture(root)
    const out = join(root, 'out', 'visual-catalog.v1.json')
    const result = run(root, ['--out', out, '--registry', join(root, 'registry.json')])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).toContain('broken: asset.source.json is unparsable; row skipped')
    expect(result.stdout).toContain('wrote out/visual-catalog.v1.json')

    const catalog = readCatalog(out)
    expect(catalog.schemaVersion).toBe('pocket-aquarium.visual-catalog/v1')
    expect(typeof catalog.generatedAt).toBe('string')
    expect(catalog.categories).toEqual(['fish', 'coral', 'invertebrate', 'cleanup_crew', 'plant'])
    expect(catalog.userApprovals).toEqual({ blue_hippo_tang: 'approved-v2', gem_tang: 'round-v2' })
    expect(catalog.rows.map((row) => row.id)).toEqual([
      'blue_hippo_tang', 'epaulette_shark', 'ocellaris', 'six_line_wrasse',
      'acropora_branching', 'goniopora',
      'trochus_snail',
      'kelp',
    ])
    expect(Object.keys(catalog.rows[0])).toEqual([
      'id', 'displayName', 'scientificLabel', 'taxonomyConfidence', 'category', 'waterType', 'bodyPlan', 'referenceSize',
      'referenceGrade', 'assetStatus', 'assetVersion', 'provisional', 'accepted', 'candidates', 'variants', 'clipRoles', 'provenance', 'visualDebt',
    ])
    expect(catalog.summary).toEqual({
      rows: 8,
      byCategory: { fish: 4, coral: 2, invertebrate: 0, cleanup_crew: 1, plant: 1 },
      byStatus: { accepted: 1, candidate: 3, provisional: 1, failed: 1, missing: 2 },
      candidates: { total: 7, loadable: 4, missing: 3, userApproved: 1 },
    })

    const byId = new Map(catalog.rows.map((row) => [row.id, row]))
    const ocellaris = byId.get('ocellaris')
    expect(ocellaris.assetStatus).toBe('accepted')
    expect(ocellaris.assetVersion).toBe('1.1.0')
    expect(ocellaris.accepted).toEqual({
      glb: 'src/assets/specimens/ocellaris/v1/lod1.glb', sha256: glbSha, clips: ['burst', 'idle', 'swim'],
      statistics: { triangles: 9052, materials: 6, bones: 14, clips: ['burst', 'idle', 'swim'] },
    })
    expect(ocellaris.candidates.map((candidate) => [candidate.name, candidate.buildStatus])).toEqual([['fable-v2', 'missing']])

    const shark = byId.get('epaulette_shark')
    expect(shark.assetStatus).toBe('candidate')
    expect(shark.referenceSize).toEqual({ meters: 0.9, kind: 'adult_total_length' })
    expect(shark.provenance).toEqual({ source: 'art/specimens/epaulette_shark/asset.source.json', sourceReferences: 'art/specimens/epaulette_shark/source-references.json', referenceGrade: 'B' })
    expect(shark.visualDebt).toEqual(['fixture debt'])
    expect(shark.candidates[0]).toMatchObject({
      name: 'fable-v1', variantId: null, displayName: 'Epaulette Shark', state: 'awaiting_user_acceptance', manifest: 'present',
      validatorStatus: 'passed', buildStatus: 'passed', buildFailedStage: null, loadable: true,
      glb: 'art/specimens/epaulette_shark/candidates/fable-v1/lod1.glb', glbSha256: glbSha, glbSha256Verified: true,
      geometryDigest: 'shark-digest', statistics: { triangles: 1234, materials: 3, bones: 7, clips: ['burst', 'idle', 'swim'] },
      clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' }, clipLoops: { burst: false, idle: true, swim: true },
      referenceSizeMeters: 0.9, userApproved: false,
      renders: { authorPreview: null, threeView: 'art/specimens/epaulette_shark/candidates/fable-v1/renders/three-view.png' },
    })
    expect(Object.keys(shark.candidates[0].clipRoles)).toEqual(['idle', 'locomotion', 'response'])

    const snail = byId.get('trochus_snail')
    expect(snail.assetStatus).toBe('missing')
    expect(snail.candidates[0]).toMatchObject({ name: 'fable-v1', state: 'missing', manifest: 'missing', validatorStatus: null, buildStatus: 'missing', loadable: false, glb: null, statistics: null, referenceSizeMeters: null })

    const wrasse = byId.get('six_line_wrasse')
    expect(wrasse.assetStatus).toBe('failed')
    expect(wrasse.candidates[0]).toMatchObject({ state: 'missing', buildStatus: 'failed', buildFailedStage: 'source' })

    const acropora = byId.get('acropora_branching')
    expect(acropora.assetStatus).toBe('candidate')
    expect(acropora.variants).toEqual([{ id: 'bushy_pink', displayName: 'Acropora digitate, pink' }, { id: 'table_blue', displayName: 'Acropora table, blue' }])
    expect(acropora.candidates.map((candidate) => [candidate.name, candidate.variantId, candidate.displayName, candidate.manifest])).toEqual([
      ['fable-v1-bushy_pink', 'bushy_pink', 'Acropora digitate, pink', 'unparsable'],
      ['fable-v1-table_blue', 'table_blue', 'Acropora table, blue', 'present'],
    ])

    expect(byId.get('goniopora').assetStatus).toBe('provisional')
    expect(byId.get('blue_hippo_tang').candidates[0].userApproved).toBe(true)
    expect(byId.get('kelp')).toMatchObject({ category: 'plant', waterType: 'freshwater', assetStatus: 'missing', candidates: [] })
  })

  it('uses formal acceptance by default and excludes superseded approvals', () => {
    const root = fixtureRoot()
    makeFixture(root)
    const out = join(root, 'out', 'visual-catalog.v1.json')
    const result = run(root, ['--out', out])
    expect(result.code, result.stderr).toBe(0)

    const catalog = readCatalog(out)
    expect(catalog.userApprovals).toEqual({ blue_hippo_tang: 'approved-v2', gem_tang: 'round-v2' })
    expect(catalog.rows.find((row) => row.id === 'blue_hippo_tang').candidates[0].userApproved).toBe(true)
  })

  it('is deterministic apart from generatedAt and reports staleness through --check', () => {
    const root = fixtureRoot()
    makeFixture(root)
    const registry = join(root, 'registry.json')
    const first = join(root, 'out', 'first.json')
    const second = join(root, 'out', 'second.json')
    expect(run(root, ['--out', first, '--registry', registry, '--quiet']).code).toBe(0)
    expect(run(root, ['--out', second, '--registry', registry, '--quiet']).code).toBe(0)
    expect(withoutTimestamp(readFileSync(first, 'utf8'))).toBe(withoutTimestamp(readFileSync(second, 'utf8')))
    expect(readFileSync(first, 'utf8')).toMatch(/^\{\n {2}"schemaVersion": "pocket-aquarium\.visual-catalog\/v1",\n {2}"generatedAt": "/)

    // Fresh: --check passes and a plain rerun leaves the file untouched (no timestamp churn).
    expect(run(root, ['--out', first, '--registry', registry, '--check']).code).toBe(0)
    const before = readFileSync(first, 'utf8')
    const rerun = run(root, ['--out', first, '--registry', registry])
    expect(rerun.code).toBe(0)
    expect(rerun.stdout).toContain('unchanged:')
    expect(readFileSync(first, 'utf8')).toBe(before)

    // Without an approval source, stale approvals are not recycled from generated output.
    const noRegistry = run(root, ['--out', first, '--registry', join(root, 'missing-registry.json'), '--check'])
    expect(noRegistry.code).toBe(1)
    expect(noRegistry.stdout).toContain('no user approvals recorded')
    expect(noRegistry.stderr).toContain('~ userApprovals')

    // A lane finishes a candidate: the committed catalog is now stale.
    json(join(root, 'art', 'specimens', 'trochus_snail', 'candidates', 'fable-v1', 'candidate.manifest.json'), manifest('trochus_snail', { referenceSizeMeters: 0.03 }))
    write(join(root, 'art', 'specimens', 'trochus_snail', 'candidates', 'fable-v1', 'lod1.glb'), Buffer.from('snail'))
    const stale = run(root, ['--out', first, '--registry', registry, '--check'])
    expect(stale.code).toBe(1)
    expect(stale.stderr).toContain('is stale')
    expect(stale.stderr).toContain('~ row trochus_snail')
    expect(run(root, ['--out', join(root, 'nowhere.json'), '--registry', registry, '--check']).code).toBe(1)
    expect(run(root, ['--bogus']).code).toBe(2)
  })
})
