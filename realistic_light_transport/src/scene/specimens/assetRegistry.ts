import runtimeAcceptance from '../../assets/specimens/runtime-acceptance.v1.json'

// Runtime asset registry. Only user-accepted packages are discoverable here. The eager glob
// imports URL strings, so GLB payloads remain network-loaded only when a renderer requests one.
export type SemanticAnimationRole = 'idle' | 'locomotion' | 'response'

export interface SpecimenClipRoles {
  readonly idle: string
  readonly locomotion: string
  readonly response: string
}

export interface SpecimenAsset {
  readonly key: string
  readonly speciesId: string
  readonly variantId?: string
  readonly displayName: string
  readonly url: string
  readonly assetVersion: string
  readonly referenceAdultLengthMeters: number
  readonly clips: readonly string[]
  readonly clipRoles: SpecimenClipRoles
  readonly clipLoops: Readonly<Record<string, boolean>>
}

interface RuntimeAcceptanceEntry {
  readonly key: string
  readonly speciesId: string
  readonly variantId?: string
  readonly bundledGlbPath: string
  readonly version: string
  readonly referenceSize: {
    readonly meters: number
    readonly kind: string
  }
  readonly displayName: string
  readonly clips: readonly string[]
  readonly clipRoles: SpecimenClipRoles
  readonly clipLoops: Readonly<Record<string, boolean>>
  readonly defaultForSpecies: boolean
}

const runtimeEntries = runtimeAcceptance.assets as unknown as readonly RuntimeAcceptanceEntry[]
const acceptedAssetUrls = import.meta.glob('../../assets/specimens/**/lod1.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Readonly<Record<string, string>>

function acceptedUrl(entry: RuntimeAcceptanceEntry): string {
  const globKey = entry.bundledGlbPath.replace(/^src\/assets\/specimens\//, '../../assets/specimens/')
  const url = acceptedAssetUrls[globKey]
  if (!url) throw new Error(`Accepted specimen asset is missing from the bundle: ${entry.bundledGlbPath}`)
  return url
}

const SPECIMEN_ASSET_LIST: readonly SpecimenAsset[] = Object.freeze(runtimeEntries.map((entry) => ({
  key: entry.key,
  speciesId: entry.speciesId,
  ...(entry.variantId ? { variantId: entry.variantId } : {}),
  displayName: entry.displayName,
  url: acceptedUrl(entry),
  assetVersion: entry.version,
  referenceAdultLengthMeters: entry.referenceSize.meters,
  clips: entry.clips,
  clipRoles: entry.clipRoles,
  clipLoops: entry.clipLoops,
})))

const SPECIMEN_ASSETS_BY_KEY = new Map(SPECIMEN_ASSET_LIST.map((asset) => [asset.key, asset]))
const DEFAULT_SPECIMEN_ASSETS = new Map(
  runtimeEntries.flatMap((entry, index) => entry.defaultForSpecies
    ? [[entry.speciesId, SPECIMEN_ASSET_LIST[index]] as const]
    : []),
)

export const ACCEPTED_SPECIES_IDS = Object.freeze([...DEFAULT_SPECIMEN_ASSETS.keys()])
export type AcceptedSpeciesId = (typeof ACCEPTED_SPECIES_IDS)[number]

export function isAcceptedSpeciesId(speciesId: string): speciesId is AcceptedSpeciesId {
  return DEFAULT_SPECIMEN_ASSETS.has(speciesId)
}

export function specimenAssetFor(speciesId: string, variantId?: string): SpecimenAsset | undefined {
  return variantId === undefined
    ? DEFAULT_SPECIMEN_ASSETS.get(speciesId)
    : SPECIMEN_ASSETS_BY_KEY.get(`${speciesId}@${variantId}`)
}

export function acceptedSpecimenAssetList(): readonly SpecimenAsset[] {
  return SPECIMEN_ASSET_LIST
}

export const listSpecimenAssets = acceptedSpecimenAssetList
