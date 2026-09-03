import { describe, expect, it } from 'vitest'

import { specimenAssetFor } from '../scene/specimens/assetRegistry'
import {
  ASSET_STATUSES,
  KNOWN_CATEGORIES,
  SHARED_SCALE_CLAMP_METERS,
  VISUAL_CATALOG_SCHEMA,
  acceptedSpecimenAssets,
  categoryLabel,
  categoryOrder,
  rowsByCategory,
  sharedScaleSpan,
  visualCatalog,
  type CatalogRow,
} from './visualCatalog'

function sizeRow(id: string, meters: number | null, extra: Partial<CatalogRow> = {}): CatalogRow {
  return {
    id,
    displayName: id,
    scientificLabel: null,
    taxonomyConfidence: null,
    category: 'fish',
    waterType: 'saltwater',
    bodyPlan: null,
    referenceSize: { meters, kind: 'adult_total_length' },
    referenceGrade: null,
    assetStatus: 'candidate',
    assetVersion: null,
    provisional: false,
    accepted: { glb: null, sha256: null, clips: [], statistics: null },
    candidates: [],
    variants: [],
    clipRoles: null,
    provenance: { source: `art/specimens/${id}/asset.source.json`, sourceReferences: null, referenceGrade: null },
    visualDebt: [],
    ...extra,
  }
}

describe('committed visual catalog', () => {
  it('has the v1 schema, the accepted Ocellaris row and sorted rows', () => {
    expect(visualCatalog.schemaVersion).toBe(VISUAL_CATALOG_SCHEMA)
    expect(visualCatalog.assetStatuses).toEqual([...ASSET_STATUSES])
    expect(visualCatalog.categories.slice(0, KNOWN_CATEGORIES.length)).toEqual([...KNOWN_CATEGORIES])
    const ocellaris = visualCatalog.rows.find((row) => row.id === 'ocellaris')
    expect(ocellaris?.assetStatus).toBe('accepted')
    expect(ocellaris?.assetVersion).toBe('1.1.0')
    expect(ocellaris?.accepted).toMatchObject({
      glb: 'src/assets/specimens/ocellaris/v1/lod1.glb',
      sha256: 'ed4d447b2c7d88e91f45699a76b2ff3768144b57e6acb4199000567bafe37ac0',
    })
    const order = categoryOrder(visualCatalog)
    const ranks = visualCatalog.rows.map((row) => order.indexOf(row.category))
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    expect(visualCatalog.summary.rows).toBe(visualCatalog.rows.length)
  })

  it('never lets a candidate resolve through the runtime registry', () => {
    const accepted = acceptedSpecimenAssets()
    expect(accepted.map(({ row }) => row.id)).toEqual(['ocellaris'])
    for (const row of visualCatalog.rows) {
      if (row.assetStatus === 'accepted') continue
      expect(specimenAssetFor(row.id), row.id).toBeUndefined()
      for (const candidate of row.candidates) expect(specimenAssetFor(`${row.id}@${candidate.name}`)).toBeUndefined()
    }
    // A row claiming acceptance is not enough: the registry table is the gate.
    const impostor = sizeRow('blue_hippo_tang', 0.25, { assetStatus: 'accepted', accepted: { glb: 'x', sha256: 'y', clips: [], statistics: null } })
    expect(acceptedSpecimenAssets([impostor])).toEqual([])
  })
})

describe('category grouping', () => {
  it('orders known categories first, unknown ones after, and hoists accepted rows within a group', () => {
    const rows = [
      sizeRow('kelp', 0.3, { category: 'plant', waterType: 'freshwater' }),
      sizeRow('b_fish', 0.1),
      sizeRow('a_fish', 0.1, { assetStatus: 'accepted' }),
      sizeRow('snail', 0.03, { category: 'cleanup_crew' }),
    ]
    const groups = rowsByCategory(rows, categoryOrder({ categories: [...KNOWN_CATEGORIES], rows }))
    expect(groups.map((group) => group.category)).toEqual(['fish', 'cleanup_crew', 'plant'])
    expect(groups[0].rows.map((row) => row.id)).toEqual(['a_fish', 'b_fish'])
    expect(groups[2].label).toBe('Plant')
    expect(categoryLabel('cleanup_crew')).toBe('Cleanup crew')
  })
})

describe('shared-scale span', () => {
  it('uses the largest reference size, clamped with a note when it exceeds the frame budget', () => {
    const span = sharedScaleSpan([sizeRow('ocellaris', 0.08), sizeRow('trochus_snail', 0.03), sizeRow('epaulette_shark', 0.9)])
    expect(span).toEqual({ spanMeters: SHARED_SCALE_CLAMP_METERS, largestMeters: 0.9, largestId: 'epaulette_shark', largestDisplayName: 'epaulette_shark', clamped: true })
    const small = sharedScaleSpan([sizeRow('ocellaris', 0.08), sizeRow('blue_hippo_tang', 0.25), sizeRow('unknown', null)])
    expect(small).toMatchObject({ spanMeters: 0.25, largestId: 'blue_hippo_tang', clamped: false })
    expect(sharedScaleSpan([]).spanMeters).toBe(0.1)
    expect(sharedScaleSpan().largestId).toBe('epaulette_shark')
  })
})
