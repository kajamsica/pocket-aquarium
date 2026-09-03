import { describe, expect, it } from 'vitest'

import { listSpecimenAssets, specimenAssetFor } from './assetRegistry'

describe('accepted specimen asset registry', () => {
  it('enumerates only the accepted runtime specimens', () => {
    expect(listSpecimenAssets().map((asset) => asset.speciesId)).toEqual([
      'ocellaris',
      'watchman_goby',
      'pistol_shrimp',
      'epaulette_shark',
    ])
    expect(specimenAssetFor('candidate-only-species')).toBeUndefined()
  })

  it.each([
    {
      speciesId: 'ocellaris',
      displayName: 'Ocellaris Clownfish',
      version: '1.1.0',
      length: 0.08,
      clips: ['idle', 'swim', 'burst'],
      roles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
      loops: { idle: true, swim: true, burst: false },
    },
    {
      speciesId: 'watchman_goby',
      displayName: 'Yellow Watchman Goby',
      version: '0.1.0',
      length: 0.08,
      clips: ['burst', 'idle', 'swim'],
      roles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
      loops: { idle: true, swim: true, burst: false },
    },
    {
      speciesId: 'pistol_shrimp',
      displayName: 'Tiger Pistol Shrimp',
      version: '0.1.0',
      length: 0.05,
      clips: ['rest', 'snap', 'walk'],
      roles: { idle: 'rest', locomotion: 'walk', response: 'snap' },
      loops: { rest: true, walk: true, snap: false },
    },
    {
      speciesId: 'epaulette_shark',
      displayName: 'Epaulette Shark',
      version: '0.1.0',
      length: 0.9,
      clips: ['burst', 'idle', 'swim'],
      roles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
      loops: { idle: true, swim: true, burst: false },
    },
  ])('resolves $speciesId with its manifest metadata', ({
    speciesId,
    displayName,
    version,
    length,
    clips,
    roles,
    loops,
  }) => {
    const asset = specimenAssetFor(speciesId)

    expect(asset).toMatchObject({
      speciesId,
      displayName,
      assetVersion: version,
      referenceAdultLengthMeters: length,
      clips,
      clipRoles: roles,
      clipLoops: loops,
    })
    expect(asset?.url).toContain(`/src/assets/specimens/${speciesId}/v1/lod1.glb`)
  })

  it('never exposes candidate-art paths through runtime registry entries', () => {
    for (const asset of listSpecimenAssets()) {
      expect(asset.url).not.toContain('/art/specimens/')
      expect(asset.url).not.toContain('/candidates/')
    }
  })
})
