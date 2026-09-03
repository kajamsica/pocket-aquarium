import ocellarisLod1Url from '../../assets/specimens/ocellaris/v1/lod1.glb?url'

export interface SpecimenAsset {
  readonly speciesId: 'ocellaris'
  readonly url: string
  readonly assetVersion: '1.0.0'
  readonly referenceAdultLengthMeters: 0.08
  readonly clips: readonly ['idle', 'swim', 'burst']
}

const SPECIMEN_ASSETS: Readonly<Record<SpecimenAsset['speciesId'], SpecimenAsset>> = {
  ocellaris: {
    speciesId: 'ocellaris',
    url: ocellarisLod1Url,
    assetVersion: '1.0.0',
    referenceAdultLengthMeters: 0.08,
    clips: ['idle', 'swim', 'burst'],
  },
}

export function specimenAssetFor(speciesId: string): SpecimenAsset | undefined {
  return SPECIMEN_ASSETS[speciesId as SpecimenAsset['speciesId']]
}
