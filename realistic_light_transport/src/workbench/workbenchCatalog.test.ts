import { describe, expect, it } from 'vitest'

import type { CatalogCandidate, CatalogRow, VisualCatalog } from '../catalog/visualCatalog'
import { specimenAssetFor } from '../scene/specimens/assetRegistry'
import {
  BADGE_LABELS,
  acceptedWorkbenchAssets,
  assetBadge,
  candidateKey,
  clipLoops,
  loadWorkbenchCatalog,
  parseScaleMode,
  preferredCandidate,
  selectWorkbenchAsset,
  workbenchOptionGroups,
  workbenchSearch,
  type WorkbenchAsset,
} from './workbenchCatalog'

function candidate(overrides: Partial<CatalogCandidate> & Pick<CatalogCandidate, 'name'>): CatalogCandidate {
  return {
    variantId: null,
    displayName: 'Candidate',
    state: 'awaiting_user_acceptance',
    manifest: 'present',
    validatorStatus: 'passed',
    buildStatus: 'passed',
    buildFailedStage: null,
    assetVersion: '0.1.0',
    loadable: true,
    glb: `art/specimens/x/candidates/${overrides.name}/lod1.glb`,
    glbSha256: 'abc',
    glbSha256Verified: true,
    geometryDigest: 'digest',
    statistics: { triangles: 100, materials: 2, bones: 3, clips: ['burst', 'idle', 'swim'] },
    clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
    clipLoops: { idle: true, swim: true, burst: false },
    referenceSizeMeters: 0.1,
    userApproved: false,
    renders: { authorPreview: null, threeView: null },
    ...overrides,
  }
}

function row(overrides: Partial<CatalogRow> & Pick<CatalogRow, 'id' | 'displayName' | 'category'>): CatalogRow {
  return {
    scientificLabel: null,
    taxonomyConfidence: 'species',
    waterType: 'saltwater',
    bodyPlan: 'fish',
    referenceSize: { meters: 0.1, kind: 'adult_total_length' },
    referenceGrade: 'B',
    assetStatus: 'candidate',
    assetVersion: '0.1.0',
    provisional: false,
    accepted: { glb: null, sha256: null, clips: [], statistics: null },
    candidates: [],
    variants: [],
    clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
    provenance: { source: `art/specimens/${overrides.id}/asset.source.json`, sourceReferences: null, referenceGrade: 'B' },
    visualDebt: [],
    ...overrides,
  }
}

// Mirrors the builder's order: category, then displayName (accepted rows are hoisted by the picker, not the builder).
const ROWS: readonly CatalogRow[] = [
  row({
    id: 'blue_hippo_tang', displayName: 'Blue Hippo Tang', category: 'fish', referenceSize: { meters: 0.25, kind: 'adult_total_length' },
    candidates: [candidate({ name: 'fable-v1' }), candidate({ name: 'fable-v2', userApproved: true })],
  }),
  row({ id: 'epaulette_shark', displayName: 'Epaulette Shark', category: 'fish', referenceSize: { meters: 0.9, kind: 'adult_total_length' }, assetStatus: 'missing' }),
  row({
    id: 'ocellaris', displayName: 'Ocellaris Clownfish', category: 'fish', scientificLabel: 'Amphiprion ocellaris',
    referenceSize: { meters: 0.08, kind: 'adult_total_length' }, assetStatus: 'accepted', assetVersion: '1.1.0',
    accepted: { glb: 'src/assets/specimens/ocellaris/v1/lod1.glb', sha256: 'ed4d', clips: ['burst', 'idle', 'swim'], statistics: null },
  }),
  row({
    id: 'six_line_wrasse', displayName: 'Six-line Wrasse', category: 'fish', assetStatus: 'failed',
    candidates: [candidate({ name: 'fable-v1', state: 'missing', manifest: 'missing', validatorStatus: null, buildStatus: 'failed', buildFailedStage: 'source', loadable: false, glb: null, glbSha256: null, glbSha256Verified: false, statistics: null, referenceSizeMeters: null })],
  }),
  row({
    id: 'acropora_branching', displayName: 'Acropora (branching SPS)', category: 'coral', bodyPlan: 'branching_sps_coral',
    referenceSize: { meters: 0.15, kind: 'colony_width' },
    candidates: [candidate({ name: 'fable-v1-table_blue', variantId: 'table_blue', displayName: 'Acropora table, blue' })],
  }),
  row({ id: 'goniopora', displayName: 'Goniopora', category: 'coral', assetStatus: 'provisional', provisional: true, candidates: [candidate({ name: 'fable-v1' })] }),
  row({ id: 'trochus_snail', displayName: 'Trochus Snail', category: 'cleanup_crew', referenceSize: { meters: 0.03, kind: 'adult_shell_diameter' }, candidates: [candidate({ name: 'fable-v1', referenceSizeMeters: 0.03 })] }),
]

const CATALOG: Pick<VisualCatalog, 'rows' | 'userApprovals' | 'generatedAt'> = {
  rows: ROWS,
  userApprovals: { blue_hippo_tang: 'fable-v2' },
  generatedAt: '2026-09-03T00:00:00.000Z',
}

function indexEntry(speciesId: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    speciesId,
    candidate: name,
    loadable: true,
    displayName: speciesId,
    scientificName: null,
    assetVersion: '0.1.0',
    bodyPlan: 'fish',
    referenceGrade: 'B',
    referenceSizeMeters: 0.2,
    referenceSizeKind: 'adult_total_length',
    clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
    clipLoops: { idle: true, swim: true, burst: false },
    clips: ['burst', 'idle', 'swim'],
    candidateState: 'awaiting_user_acceptance',
    candidateHash: 'abc',
    validatorStatus: 'passed',
    buildStatus: 'passed',
    buildFailedStage: null,
    glbBytes: 1024,
    glbSha256: 'def',
    files: { glb: `/__catalog/v1/candidates/${speciesId}/${name}/lod1.glb`, authorPreview: null, threeView: null },
    ...overrides,
  }
}

const CANDIDATE_INDEX = {
  candidates: [
    indexEntry('blue_hippo_tang', 'fable-v1', { displayName: 'Blue Hippo Tang', scientificName: 'Paracanthurus hepatus', referenceSizeMeters: 0.25 }),
    indexEntry('blue_hippo_tang', 'fable-v2', { displayName: 'Blue Hippo Tang', referenceSizeMeters: 0.25 }),
    indexEntry('six_line_wrasse', 'fable-v1', {
      loadable: false, displayName: 'Six-line Wrasse', assetVersion: null, referenceGrade: null, referenceSizeMeters: null, referenceSizeKind: null,
      clipRoles: null, clipLoops: null, clips: [], candidateState: 'unknown', candidateHash: null, validatorStatus: 'pending', buildStatus: 'failed',
      buildFailedStage: 'source', glbBytes: 0, glbSha256: null, files: { glb: null, authorPreview: null, threeView: null },
    }),
    indexEntry('acropora_branching', 'fable-v1-table_blue', { displayName: 'Acropora table, blue', variantId: 'table_blue', bodyPlan: 'branching_sps_coral', referenceSizeMeters: 0.15, referenceSizeKind: 'colony_width' }),
    indexEntry('goniopora', 'fable-v1', { displayName: 'Goniopora', referenceSizeMeters: 0.1 }),
    indexEntry('trochus_snail', 'fable-v1', { displayName: 'Trochus Snail', referenceSizeMeters: 0.03, referenceSizeKind: 'adult_shell_diameter' }),
    indexEntry('trochus_snail', 'fable-v2', { displayName: 'Trochus Snail', referenceSizeMeters: 0.03, referenceSizeKind: 'adult_shell_diameter' }),
    indexEntry('zoanthid', 'fable-v1-blue_green', { displayName: 'Zoanthid', referenceSizeMeters: 0.08 }),
  ],
}

function fakeFetch(payload: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => payload })) as unknown as typeof fetch
}

describe('runtime asset registry stays accepted-only', () => {
  it('resolves the accepted Ocellaris and nothing else', () => {
    expect(specimenAssetFor('ocellaris')?.assetVersion).toBe('1.1.0')
    for (const candidateOnly of ['blue_hippo_tang', 'yellow_tang', 'purple_tang', 'gem_tang', 'black_storm_ocellaris', 'constructor', '__proto__']) {
      expect(specimenAssetFor(candidateOnly)).toBeUndefined()
    }
  })

  it('exposes only accepted assets when the candidate service is unavailable', async () => {
    const catalog = await loadWorkbenchCatalog(fakeFetch({}, false), { catalog: CATALOG })
    expect(catalog.candidateSource).toBe('unavailable')
    expect(catalog.assets.map((asset) => asset.key)).toEqual(['ocellaris'])
    expect(acceptedWorkbenchAssets(ROWS).every((asset) => asset.state === 'accepted')).toBe(true)
    expect(catalog.rows).toHaveLength(ROWS.length)
  })

  it('keeps Ocellaris inspectable from the registry even when the catalog has no accepted row', () => {
    const [ocellaris] = acceptedWorkbenchAssets([])
    expect(ocellaris.key).toBe('ocellaris')
    expect(ocellaris.referenceSizeMeters).toBe(0.08)
    expect(ocellaris.clipLoops).toEqual({ idle: true, swim: true, burst: false })
  })
})

describe('workbench candidate catalog', () => {
  it('loads validated candidates for explicit review, enriches them from the catalog row and reports unloadable ones', async () => {
    const catalog = await loadWorkbenchCatalog(fakeFetch(CANDIDATE_INDEX), { catalog: CATALOG })
    expect(catalog.candidateSource).toBe('dev-service')
    const keys = catalog.assets.map((asset) => asset.key)
    expect(keys[0]).toBe('ocellaris')
    expect(keys).toContain(candidateKey('blue_hippo_tang', 'fable-v2'))
    const tang = catalog.assets.find((asset) => asset.key === 'blue_hippo_tang@fable-v2')!
    expect(tang.state).toBe('candidate')
    expect(tang.candidateState).toBe('awaiting_user_acceptance')
    expect(tang.referenceSizeMeters).toBe(0.25)
    expect(tang.userApproved).toBe(true)
    expect(tang.category).toBe('fish')
    expect(catalog.assets.find((asset) => asset.key === 'blue_hippo_tang@fable-v1')?.userApproved).toBe(false)
    expect(catalog.skipped).toEqual([{ speciesId: 'six_line_wrasse', candidate: 'fable-v1', reason: 'build failed at source' }])
    expect(catalog.span.spanMeters).toBe(0.5)
  })

  it('selects by species and candidate, falling back visibly to the accepted Ocellaris', async () => {
    const { assets, rows } = await loadWorkbenchCatalog(fakeFetch(CANDIDATE_INDEX), { catalog: CATALOG })
    expect(selectWorkbenchAsset(assets, null, null).asset?.key).toBe('ocellaris')
    expect(selectWorkbenchAsset(assets, 'blue_hippo_tang', 'fable-v1').asset?.key).toBe('blue_hippo_tang@fable-v1')
    // No candidate named: the user-approved look wins over other validated builds.
    expect(selectWorkbenchAsset(assets, 'blue_hippo_tang', null).asset?.key).toBe('blue_hippo_tang@fable-v2')
    expect(preferredCandidate(assets, 'trochus_snail')?.key).toBe('trochus_snail@fable-v2')

    const unknown = selectWorkbenchAsset(assets, 'zzz', null, rows)
    expect(unknown.asset?.key).toBe('ocellaris')
    expect(unknown.invalid).toBe('zzz')
    expect(unknown.unavailable).toBeUndefined()

    const missingCandidate = selectWorkbenchAsset(assets, 'blue_hippo_tang', 'fable-v9', rows)
    expect(missingCandidate.asset?.key).toBe('ocellaris')
    expect(missingCandidate.invalid).toBe('blue_hippo_tang / fable-v9')

    // Known catalog rows without a loadable asset fall back with a reason instead of an unknown-id notice.
    const shark = selectWorkbenchAsset(assets, 'epaulette_shark', null, rows)
    expect(shark.asset?.key).toBe('ocellaris')
    expect(shark.invalid).toBeUndefined()
    expect(shark.unavailable?.row.id).toBe('epaulette_shark')
    expect(shark.unavailable?.reason).toBe('no candidate yet')
    const wrasse = selectWorkbenchAsset(assets, 'six_line_wrasse', 'fable-v1', rows)
    expect(wrasse.unavailable?.reason).toBe('build failed at source')

    // Without rows the legacy behaviour is unchanged.
    expect(selectWorkbenchAsset(assets, 'epaulette_shark', null).invalid).toBe('epaulette_shark')
  })

  it('derives clip looping from the manifest, defaulting the response clip to one-shot', () => {
    const asset: WorkbenchAsset = {
      key: 'x', state: 'candidate', speciesId: 'x', displayName: 'x', url: '/x.glb', assetVersion: '0.1.0',
      referenceSizeMeters: 0.1, referenceSizeKind: 'adult_total_length', clips: ['idle', 'swim', 'burst'],
      clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
    }
    expect(clipLoops(asset, 'swim')).toBe(true)
    expect(clipLoops(asset, 'burst')).toBe(false)
    expect(clipLoops({ ...asset, clipLoops: { burst: true } }, 'burst')).toBe(true)
    expect(clipLoops({ clipRoles: { idle: 'rest', locomotion: 'crawl', response: 'retract' } }, 'retract')).toBe(false)
    expect(clipLoops({ clipRoles: { idle: 'rest', locomotion: 'crawl', response: 'retract' } }, 'crawl')).toBe(true)
  })

  it('assigns the five-word badge vocabulary', () => {
    const base = { state: 'candidate' as const }
    expect(assetBadge({ state: 'accepted' })).toBe('accepted')
    expect(assetBadge({ ...base })).toBe('candidate')
    expect(assetBadge({ ...base, userApproved: true })).toBe('approved')
    expect(assetBadge({ ...base, assetStatus: 'provisional', userApproved: true })).toBe('provisional')
    expect(assetBadge({ ...base, validatorStatus: 'failed', userApproved: true })).toBe('failed')
    expect(assetBadge({ ...base, buildStatus: 'failed' })).toBe('failed')
    expect(Object.values(BADGE_LABELS)).toEqual(['Accepted (runtime)', 'Candidate', 'Candidate (user approved look)', 'Provisional', 'Failed'])
  })

  it('builds the categorized picker with accepted rows first and unloadable rows disabled', async () => {
    const catalog = await loadWorkbenchCatalog(fakeFetch(CANDIDATE_INDEX), { catalog: CATALOG })
    const groups = workbenchOptionGroups(catalog)
    expect(groups.map((group) => group.category)).toEqual(['fish', 'coral', 'cleanup_crew', 'uncatalogued'])
    const fish = groups[0].options
    expect(fish[0]).toMatchObject({ key: 'ocellaris', disabled: false, badge: 'accepted', label: 'Ocellaris Clownfish (accepted v1.1.0)' })
    expect(fish.map((option) => option.key)).toEqual([
      'ocellaris',
      'blue_hippo_tang@fable-v1',
      'blue_hippo_tang@fable-v2',
      'row:epaulette_shark',
      'row:six_line_wrasse@fable-v1',
    ])
    expect(fish.find((option) => option.key === 'blue_hippo_tang@fable-v2')).toMatchObject({ badge: 'approved', label: 'Blue Hippo Tang (fable-v2, user approved)' })
    expect(fish.find((option) => option.key === 'row:epaulette_shark')).toMatchObject({ disabled: true, status: 'no candidate yet' })
    expect(fish.find((option) => option.key === 'row:six_line_wrasse@fable-v1')).toMatchObject({ disabled: true, status: 'build failed at source' })

    const coral = groups[1].options
    expect(coral.find((option) => option.key === 'acropora_branching@fable-v1-table_blue')?.label).toBe('Acropora (branching SPS) / Acropora table, blue (fable-v1-table_blue, validated)')
    expect(coral.find((option) => option.key === 'goniopora@fable-v1')?.badge).toBe('provisional')

    // A loadable candidate the committed catalog has not been rebuilt for is still offered.
    const cleanup = groups[2].options
    expect(cleanup.map((option) => option.key)).toEqual(['trochus_snail@fable-v1', 'trochus_snail@fable-v2'])
    expect(cleanup[1].label).toContain('not in catalog yet')
    expect(groups[3].options.map((option) => option.key)).toEqual(['zoanthid@fable-v1-blue_green'])
  })

  it('marks candidates as dev-server-only when the candidate service is unavailable', async () => {
    const catalog = await loadWorkbenchCatalog(fakeFetch({}, false), { catalog: CATALOG })
    const groups = workbenchOptionGroups(catalog)
    const tang = groups[0].options.find((option) => option.key === 'row:blue_hippo_tang@fable-v2')
    expect(tang).toMatchObject({ disabled: true, status: 'dev server only' })
    const selection = selectWorkbenchAsset(catalog.assets, 'blue_hippo_tang', null, catalog.rows, catalog.candidateSource)
    expect(selection.asset?.key).toBe('ocellaris')
    expect(selection.unavailable?.reason).toBe('candidate GLBs load through the dev server only')
    expect(selectWorkbenchAsset(catalog.assets, 'blue_hippo_tang', 'fable-v2', catalog.rows, catalog.candidateSource).unavailable?.reason).toBe('dev server only')
    expect(groups.every((group) => group.options.filter((option) => !option.disabled).every((option) => option.key === 'ocellaris'))).toBe(true)
  })

  it('persists species, candidate and scale mode in the URL without reloading', () => {
    expect(parseScaleMode(null)).toBe('shared')
    expect(parseScaleMode('fit')).toBe('fit')
    expect(parseScaleMode('bogus')).toBe('shared')
    expect(workbenchSearch({ speciesId: 'epaulette_shark' }, 'shared', '?workbench=zzz&candidate=old')).toBe('?workbench=epaulette_shark&scale=shared')
    expect(workbenchSearch({ speciesId: 'gem_tang', candidate: 'round-v2' }, 'fit', '?showcase=1')).toBe('?showcase=1&workbench=gem_tang&candidate=round-v2&scale=fit')
  })
})
