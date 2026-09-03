import ocellarisLod1Url from '../../assets/specimens/ocellaris/v1/lod1.glb?url'

// Runtime asset registry. Only user-accepted packages are bundled and listed here; visual-catalog
// candidates (art/specimens/*/candidates/*) are inspected through the workbench dev service and never
// resolve through specimenAssetFor. The types are open so more accepted species can be added without
// touching consumers, but the table itself is the acceptance gate.
export interface SpecimenAsset {
  readonly speciesId: string
  readonly url: string
  readonly assetVersion: string
  readonly referenceAdultLengthMeters: number
  readonly clips: readonly string[]
}

export const ACCEPTED_SPECIES_IDS = ['ocellaris'] as const
export type AcceptedSpeciesId = (typeof ACCEPTED_SPECIES_IDS)[number]

const SPECIMEN_ASSETS: Readonly<Record<AcceptedSpeciesId, SpecimenAsset>> = {
  ocellaris: {
    speciesId: 'ocellaris',
    url: ocellarisLod1Url,
    assetVersion: '1.1.0',
    referenceAdultLengthMeters: 0.08,
    clips: ['idle', 'swim', 'burst'],
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
