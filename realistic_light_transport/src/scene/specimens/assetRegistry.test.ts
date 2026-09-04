// @ts-expect-error Vitest runs this suite in Node, while production TypeScript excludes Node types.
import { createHash } from 'node:crypto'
// @ts-expect-error Vitest runs this suite in Node, while production TypeScript excludes Node types.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import userAcceptance from '../../../art/specimens/user-acceptance.v1.json'
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
    expect(bySpecies.get('gem_tang')?.sourceCandidate).toBe('round-v2')
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
      const asset = specimenAssetFor(entry.speciesId, entry.variantId)
      expect(asset?.url, entry.key).toContain(`/${entry.bundledGlbPath}`)
      expect(asset, entry.key).toMatchObject({
        sourceCandidate: entry.sourceCandidate,
        defaultForSpecies: entry.defaultForSpecies,
        category: entry.category,
        bodyPlan: entry.bodyPlan,
        referenceSizeKind: entry.referenceSize.kind,
        sha256: entry.sha256,
      })
    }
  })

  it('binds every runtime promotion to an exact formal acceptance entry', () => {
    const formallyAccepted = new Map(userAcceptance.entries
      .filter((entry) => entry.status === 'user_accepted')
      .map((entry) => [`${entry.speciesId}/${entry.candidate}`, entry]))
    const promotions = runtimeAcceptance.assets.filter((entry) => entry.speciesId !== 'ocellaris')

    expect(promotions).toHaveLength(45)
    for (const promotion of promotions) {
      const key = `${promotion.speciesId}/${promotion.sourceCandidate}`
      const formal = formallyAccepted.get(key)

      expect(formal, key).toMatchObject({
        speciesId: promotion.speciesId,
        candidate: promotion.sourceCandidate,
        glbSha256: promotion.sha256,
        status: 'user_accepted',
      })
      if (key === 'gem_tang/round-v2') {
        expect(formal).toMatchObject({
          candidateHash: 'b2e85afcf696ef10062ae40c14c69d4e082acbcf14cc1a0bae7e90f8b7330c4d',
          geometryDigest: '88bfbd8f51c84e523f69f7062c4fb9207473499788def105c54855b39771a824',
        })
        continue
      }

      const candidateRoot = `../../../art/specimens/${promotion.speciesId}/candidates/${promotion.sourceCandidate}/`
      const manifest = JSON.parse(readFileSync(new URL(`${candidateRoot}candidate.manifest.json`, import.meta.url), 'utf8'))
      const validation = JSON.parse(readFileSync(new URL(`${candidateRoot}validation-receipt.json`, import.meta.url), 'utf8'))
      const geometry = JSON.parse(readFileSync(new URL(`${candidateRoot}geometry-digest.json`, import.meta.url), 'utf8'))
      expect(validation.status, `${key} validation`).toBe('passed')
      expect(formal, key).toMatchObject({
        candidateHash: manifest.candidate.candidateHash,
        glbSha256: manifest.runtimeGlbSha256.lod1,
        geometryDigest: geometry.geometryDigest,
      })
    }
  })

  it('records the seven newly formalized variant approvals with exact hashes', () => {
    const expected = [
      ['acropora_branching', 'fable-v1-staghorn_blue', '49c9507cf0ee263c112a72c73bf48a094567081dcfd5cecb9262094840a956ee'],
      ['acropora_branching', 'fable-v1-table_green', 'a9ed92fae67049d58cd75f9cb68e3f4ee42717de054fc4e09b54ed6c59ea52bc'],
      ['anacropora', 'fable-v1-green', 'd2240c0653653ca8a9a07d31215d6523bce1f414146689f7ec06ad4259b34b2a'],
      ['millepora', 'fable-v1-blade', '77a364947b53005404132045394bd2b969001c449cffd7fd1325a6cbce7b6780'],
      ['millepora', 'fable-v1-branching', '9dfc47f3ac2b4df6d3035ede7133d8bbee175ee58a347c7eaa0f2d8e1fc5c634'],
      ['stylophora', 'fable-v1-blueberry', 'd61420f0a95f375723687b4ab747e8b1a1f637ac227719aa7bbc89606689a6e1'],
      ['stylophora', 'fable-v1-pink', 'bd7b9588ea9f8728577f3c965bfc74f1250fc6035d11cd6911418ed35bdfe79d'],
    ] as const

    for (const [speciesId, candidate, glbSha256] of expected) {
      expect(userAcceptance.entries).toContainEqual(expect.objectContaining({
        speciesId,
        candidate,
        glbSha256,
        status: 'user_accepted',
      }))
    }
  })

  it('does not resolve excluded or superseded candidates', () => {
    expect(specimenAssetFor('ocellaris', 'fable-baseline')).toBeUndefined()
    expect(specimenAssetFor('ocellaris', 'fable-v2')).toBeUndefined()
    expect(specimenAssetFor('blue_hippo_tang', 'alt-v2')).toBeUndefined()
    expect(specimenAssetFor('six_line_wrasse', 'fable-v1')).toBeUndefined()
    expect(runtimeAcceptance.assets).not.toContainEqual(expect.objectContaining({ sourceCandidate: 'alt-v2' }))
    expect(runtimeAcceptance.assets).not.toContainEqual(expect.objectContaining({ sourceCandidate: 'fable-baseline' }))
    for (const [speciesId, sourceCandidate] of [
      ['ocellaris', 'fable-v2'],
      ['blue_hippo_tang', 'alt-v2'],
      ['gem_tang', 'fable-v1'],
      ['gem_tang', 'fable-v2'],
      ['purple_tang', 'fable-v1'],
      ['six_line_wrasse', 'fable-v1'],
      ['yellow_tang', 'fable-v1'],
    ]) {
      expect(runtimeAcceptance.assets.some((entry) =>
        entry.speciesId === speciesId && entry.sourceCandidate === sourceCandidate),
      `${speciesId}/${sourceCandidate}`).toBe(false)
    }
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
