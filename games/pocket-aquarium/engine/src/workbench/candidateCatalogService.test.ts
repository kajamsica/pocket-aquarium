// @ts-nocheck -- this project intentionally has no @types/node dependency.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { indexCandidates } from './candidateCatalogService'

describe('candidate index service', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('indexes candidate packages from art/specimens and marks incomplete ones unloadable', () => {
    root = mkdtempSync(join(tmpdir(), 'pa-catalog-'))
    const good = join(root, 'art', 'specimens', 'yellow_tang', 'candidates', 'fable-v2')
    const failed = join(root, 'art', 'specimens', 'six_line_wrasse', 'candidates', 'fable-v1')
    mkdirSync(join(good, 'renders'), { recursive: true })
    mkdirSync(failed, { recursive: true })
    writeFileSync(join(good, 'lod1.glb'), Buffer.alloc(16, 1))
    writeFileSync(join(good, 'renders', 'three-view.png'), Buffer.alloc(8, 1))
    writeFileSync(join(good, 'candidate.manifest.json'), JSON.stringify({
      displayName: 'Yellow Tang', scientificName: 'Zebrasoma flavescens', assetVersion: '0.2.0', bodyPlan: 'fish',
      referenceGrade: 'B', referenceSizeMeters: 0.2, referenceSizeKind: 'adult_total_length',
      clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' }, clipLoops: { idle: true, swim: true, burst: false },
      statistics: { clips: ['burst', 'idle', 'swim'] }, candidate: { state: 'awaiting_user_acceptance', candidateHash: 'h' },
      validator: { status: 'passed' }, runtimeGlbSha256: { lod1: 'g' },
    }))
    writeFileSync(join(good, 'build-receipt.json'), JSON.stringify({ status: 'passed' }))
    writeFileSync(join(failed, 'build-receipt.json'), JSON.stringify({ status: 'failed', failure: { stage: 'source' } }))
    // ignored: transient or unsafe names never become catalog entries
    mkdirSync(join(root, 'art', 'specimens', 'yellow_tang', 'candidates', 'Bad Name'), { recursive: true })

    const entries = indexCandidates(root)
    expect(entries.map((entry) => [entry.speciesId, entry.candidate, entry.loadable])).toEqual([
      ['six_line_wrasse', 'fable-v1', false],
      ['yellow_tang', 'fable-v2', true],
    ])
    const tang = entries[1]
    expect(tang.candidateState).toBe('awaiting_user_acceptance')
    expect(tang.files.glb).toBe('/__catalog/v1/candidates/yellow_tang/fable-v2/lod1.glb')
    expect(tang.files.threeView).toBe('/__catalog/v1/candidates/yellow_tang/fable-v2/renders/three-view.png')
    expect(tang.files.authorPreview).toBeNull()
    expect(entries[0].buildFailedStage).toBe('source')
    expect(entries[0].buildStatus).toBe('failed')
  })
})
