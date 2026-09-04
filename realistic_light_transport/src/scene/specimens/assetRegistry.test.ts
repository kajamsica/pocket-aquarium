// @ts-expect-error Vitest runs this suite in Node, while production TypeScript excludes Node types.
import { createHash } from 'node:crypto'
// @ts-expect-error Vitest runs this suite in Node, while production TypeScript excludes Node types.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import runtimeAcceptance from '../../assets/specimens/runtime-acceptance.v1.json'
import {
  ACCEPTED_SPECIES_IDS,
  acceptedSpecimenAssetList,
  listSpecimenAssets,
  specimenAssetFor,
} from './assetRegistry'

const ACCEPTED_OCELLARIS_SHA = 'ed4d447b2c7d88e91f45699a76b2ff3768144b57e6acb4199000567bafe37ac0'

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(new URL(`../../../${path}`, import.meta.url))).digest('hex')
}

describe('accepted specimen asset registry', () => {
  it('enumerates 46 unique accepted assets across 33 species', () => {
    const assets = acceptedSpecimenAssetList()

    expect(assets).toHaveLength(46)
    expect(listSpecimenAssets()).toBe(assets)
    expect(new Set(assets.map((asset) => asset.key))).toHaveProperty('size', 46)
    expect(ACCEPTED_SPECIES_IDS).toHaveLength(33)
    expect(new Set(ACCEPTED_SPECIES_IDS)).toHaveProperty('size', 33)
  })

  it('records exactly one default and resolves explicit variants', () => {
    for (const speciesId of ACCEPTED_SPECIES_IDS) {
      const entries = runtimeAcceptance.assets.filter((entry) => entry.speciesId === speciesId)
      const defaults = entries.filter((entry) => entry.defaultForSpecies)

      expect(defaults, speciesId).toHaveLength(1)
      expect(specimenAssetFor(speciesId)?.key, speciesId).toBe(defaults[0].key)
      for (const entry of entries) {
        if (entry.variantId) expect(specimenAssetFor(speciesId, entry.variantId)?.key).toBe(entry.key)
      }
    }
  })

  it('keeps the fixed final non-variant candidate choices', () => {
    const bySpecies = new Map(runtimeAcceptance.assets.map((entry) => [entry.speciesId, entry]))

    expect(bySpecies.get('blue_hippo_tang')?.sourceCandidate).toBe('approved-v2')
    expect(bySpecies.get('gem_tang')?.sourceCandidate).toBe('fable-v2')
    expect(bySpecies.get('purple_tang')?.sourceCandidate).toBe('fable-v2')
    expect(bySpecies.get('yellow_tang')?.sourceCandidate).toBe('fable-v2')
    expect(bySpecies.get('six_line_wrasse')?.sourceCandidate).toBe('fable-v2')
  })

  it('preserves the accepted Ocellaris binary and semantic clips', () => {
    const ocellaris = runtimeAcceptance.assets.find((entry) => entry.key === 'ocellaris')

    expect(ocellaris).toMatchObject({
      sourceCandidate: 'existing-accepted-v1.1.0',
      bundledGlbPath: 'src/assets/specimens/ocellaris/v1/lod1.glb',
      version: '1.1.0',
      sha256: ACCEPTED_OCELLARIS_SHA,
      clips: ['idle', 'swim', 'burst'],
      clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
      clipLoops: { idle: true, swim: true, burst: false },
    })
    expect(sha256(ocellaris!.bundledGlbPath)).toBe(ACCEPTED_OCELLARIS_SHA)
  })

  it('matches every accepted source and bundled GLB to its exact receipt hash', () => {
    expect(runtimeAcceptance.assets).toHaveLength(46)
    for (const entry of runtimeAcceptance.assets) {
      expect(sha256(entry.sourceCandidateGlbPath), `${entry.key} source`).toBe(entry.sha256)
      expect(sha256(entry.bundledGlbPath), `${entry.key} bundle`).toBe(entry.sha256)
      expect(specimenAssetFor(entry.speciesId, entry.variantId)?.url, entry.key)
        .toContain(`/${entry.bundledGlbPath}`)
    }
  })

  it('does not resolve excluded or superseded candidates', () => {
    expect(specimenAssetFor('ocellaris', 'fable-baseline')).toBeUndefined()
    expect(specimenAssetFor('ocellaris', 'fable-v2')).toBeUndefined()
    expect(specimenAssetFor('blue_hippo_tang', 'alt-v2')).toBeUndefined()
    expect(specimenAssetFor('six_line_wrasse', 'fable-v1')).toBeUndefined()
    expect(runtimeAcceptance.assets).not.toContainEqual(expect.objectContaining({ sourceCandidate: 'alt-v2' }))
    expect(runtimeAcceptance.assets).not.toContainEqual(expect.objectContaining({ sourceCandidate: 'fable-baseline' }))
  })

  it('discovers accepted URL strings without runtime payload preloads', () => {
    const source = readFileSync(new URL('./assetRegistry.ts', import.meta.url), 'utf8')

    expect(source).toContain("import.meta.glob('../../assets/specimens/**/lod1.glb'")
    expect(source).toContain("query: '?url'")
    expect(source).toContain("import: 'default'")
    expect(source).not.toMatch(/^import .*\.glb\?url/m)
    expect(source).not.toMatch(/\bfetch\s*\(/)
    for (const asset of acceptedSpecimenAssetList()) {
      expect(asset.url).not.toContain('/art/specimens/')
      expect(asset.url).not.toContain('/candidates/')
    }
  })
})
