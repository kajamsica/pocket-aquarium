import ocellarisLod1Url from '../../assets/specimens/ocellaris/v1/lod1.glb?url'
import epauletteSharkLod1Url from '../../assets/specimens/epaulette_shark/v1/lod1.glb?url'
import pistolShrimpLod1Url from '../../assets/specimens/pistol_shrimp/v1/lod1.glb?url'
import watchmanGobyLod1Url from '../../assets/specimens/watchman_goby/v1/lod1.glb?url'

// Runtime asset registry. Only user-accepted packages are bundled and listed here; visual-catalog
// candidates (art/specimens/*/candidates/*) are inspected through the workbench dev service and
// never resolve through specimenAssetFor.
export type SemanticAnimationRole = 'idle' | 'locomotion' | 'response'

export interface SpecimenClipRoles {
  readonly idle: string
  readonly locomotion: string
  readonly response: string
}

export interface SpecimenAsset {
  readonly speciesId: string
  readonly displayName: string
  readonly url: string
  readonly assetVersion: string
  readonly referenceAdultLengthMeters: number
  readonly clips: readonly string[]
  readonly clipRoles: SpecimenClipRoles
  readonly clipLoops: Readonly<Record<string, boolean>>
}

export const ACCEPTED_SPECIES_IDS = [
  'ocellaris',
  'watchman_goby',
  'pistol_shrimp',
  'epaulette_shark',
] as const
export type AcceptedSpeciesId = (typeof ACCEPTED_SPECIES_IDS)[number]

const SPECIMEN_ASSETS: Readonly<Record<AcceptedSpeciesId, SpecimenAsset>> = {
  ocellaris: {
    speciesId: 'ocellaris',
    displayName: 'Ocellaris Clownfish',
    url: ocellarisLod1Url,
    assetVersion: '1.1.0',
    referenceAdultLengthMeters: 0.08,
    clips: ['idle', 'swim', 'burst'],
    clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
    clipLoops: { idle: true, swim: true, burst: false },
  },
  watchman_goby: {
    speciesId: 'watchman_goby',
    displayName: 'Yellow Watchman Goby',
    url: watchmanGobyLod1Url,
    assetVersion: '0.1.0',
    referenceAdultLengthMeters: 0.08,
    clips: ['burst', 'idle', 'swim'],
    clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
    clipLoops: { idle: true, swim: true, burst: false },
  },
  pistol_shrimp: {
    speciesId: 'pistol_shrimp',
    displayName: 'Tiger Pistol Shrimp',
    url: pistolShrimpLod1Url,
    assetVersion: '0.1.0',
    referenceAdultLengthMeters: 0.05,
    clips: ['rest', 'snap', 'walk'],
    clipRoles: { idle: 'rest', locomotion: 'walk', response: 'snap' },
    clipLoops: { rest: true, walk: true, snap: false },
  },
  epaulette_shark: {
    speciesId: 'epaulette_shark',
    displayName: 'Epaulette Shark',
    url: epauletteSharkLod1Url,
    assetVersion: '0.1.0',
    referenceAdultLengthMeters: 0.9,
    clips: ['burst', 'idle', 'swim'],
    clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
    clipLoops: { idle: true, swim: true, burst: false },
  },
}

export function isAcceptedSpeciesId(speciesId: string): speciesId is AcceptedSpeciesId {
  return Object.prototype.hasOwnProperty.call(SPECIMEN_ASSETS, speciesId)
}

export function specimenAssetFor(speciesId: string): SpecimenAsset | undefined {
  return isAcceptedSpeciesId(speciesId) ? SPECIMEN_ASSETS[speciesId] : undefined
}

export function acceptedSpecimenAssetList(): readonly SpecimenAsset[] {
  return ACCEPTED_SPECIES_IDS.map((speciesId) => SPECIMEN_ASSETS[speciesId])
}

export const listSpecimenAssets = acceptedSpecimenAssetList
