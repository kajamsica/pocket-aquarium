import { specimenAssetFor } from '../scene/specimens/assetRegistry'

// The workbench may inspect two kinds of assets: accepted runtime assets (resolved through the
// untouched asset registry) and awaiting_user_acceptance candidates served by the dev-only
// candidate catalog service. Normal aquarium runtime resolution never sees candidates.
export type WorkbenchAssetState = 'accepted' | 'candidate'

export interface WorkbenchAsset {
  readonly key: string
  readonly state: WorkbenchAssetState
  readonly speciesId: string
  readonly candidate?: string
  readonly displayName: string
  readonly scientificName?: string
  readonly url: string
  readonly assetVersion: string
  readonly referenceSizeMeters: number
  readonly referenceSizeKind: string
  readonly clips: readonly string[]
  readonly clipRoles?: Readonly<Record<'idle' | 'locomotion' | 'response', string>>
  readonly clipLoops?: Readonly<Record<string, boolean>>
  readonly referenceGrade?: string
  readonly bodyPlan?: string
  readonly candidateState?: string
  readonly validatorStatus?: string
  readonly buildStatus?: string
  readonly buildFailedStage?: string
  readonly glbBytes?: number
  readonly glbSha256?: string
  readonly candidateHash?: string
  readonly authorPreviewUrl?: string
  readonly threeViewUrl?: string
}

interface CandidateIndexEntry {
  readonly speciesId: string
  readonly candidate: string
  readonly loadable: boolean
  readonly displayName: string
  readonly scientificName: string | null
  readonly assetVersion: string | null
  readonly bodyPlan: string | null
  readonly referenceGrade: string | null
  readonly referenceSizeMeters: number | null
  readonly referenceSizeKind: string | null
  readonly clipRoles: WorkbenchAsset['clipRoles'] | null
  readonly clipLoops: Record<string, boolean> | null
  readonly clips: readonly string[]
  readonly candidateState: string
  readonly candidateHash: string | null
  readonly validatorStatus: string
  readonly buildStatus: string
  readonly buildFailedStage: string | null
  readonly glbBytes: number
  readonly glbSha256: string | null
  readonly files: { readonly glb: string | null; readonly authorPreview: string | null; readonly threeView: string | null }
}

export const CANDIDATE_INDEX_URL = '/__catalog/v1/candidates.json'
export const DEFAULT_WORKBENCH_SPECIES = 'ocellaris'

export function acceptedWorkbenchAssets(): WorkbenchAsset[] {
  const ocellaris = specimenAssetFor('ocellaris')
  if (!ocellaris) return []
  return [{
    key: ocellaris.speciesId,
    state: 'accepted',
    speciesId: ocellaris.speciesId,
    displayName: 'Ocellaris clownfish',
    scientificName: 'Amphiprion ocellaris',
    url: ocellaris.url,
    assetVersion: ocellaris.assetVersion,
    referenceSizeMeters: ocellaris.referenceAdultLengthMeters,
    referenceSizeKind: 'adult_total_length',
    clips: ocellaris.clips,
    clipRoles: { idle: 'idle', locomotion: 'swim', response: 'burst' },
    clipLoops: { idle: true, swim: true, burst: false },
  }]
}

export function candidateKey(speciesId: string, candidate: string) {
  return `${speciesId}@${candidate}`
}

function toWorkbenchAsset(entry: CandidateIndexEntry): WorkbenchAsset | undefined {
  if (!entry.loadable || !entry.files.glb || !entry.referenceSizeMeters) return undefined
  return {
    key: candidateKey(entry.speciesId, entry.candidate),
    state: 'candidate',
    speciesId: entry.speciesId,
    candidate: entry.candidate,
    displayName: entry.displayName,
    scientificName: entry.scientificName ?? undefined,
    url: entry.files.glb,
    assetVersion: entry.assetVersion ?? 'candidate',
    referenceSizeMeters: entry.referenceSizeMeters,
    referenceSizeKind: entry.referenceSizeKind ?? 'adult_total_length',
    clips: entry.clips,
    clipRoles: entry.clipRoles ?? undefined,
    clipLoops: entry.clipLoops ?? undefined,
    referenceGrade: entry.referenceGrade ?? undefined,
    bodyPlan: entry.bodyPlan ?? undefined,
    candidateState: entry.candidateState,
    validatorStatus: entry.validatorStatus,
    buildStatus: entry.buildStatus,
    buildFailedStage: entry.buildFailedStage ?? undefined,
    glbBytes: entry.glbBytes,
    glbSha256: entry.glbSha256 ?? undefined,
    candidateHash: entry.candidateHash ?? undefined,
    authorPreviewUrl: entry.files.authorPreview ?? undefined,
    threeViewUrl: entry.files.threeView ?? undefined,
  }
}

export interface WorkbenchCatalog {
  readonly assets: readonly WorkbenchAsset[]
  readonly candidateSource: 'dev-service' | 'unavailable'
  readonly skipped: readonly { readonly speciesId: string; readonly candidate: string; readonly reason: string }[]
}

export async function loadWorkbenchCatalog(fetchImpl: typeof fetch = fetch): Promise<WorkbenchCatalog> {
  const accepted = acceptedWorkbenchAssets()
  try {
    const response = await fetchImpl(CANDIDATE_INDEX_URL, { cache: 'no-store' })
    if (!response.ok) return { assets: accepted, candidateSource: 'unavailable', skipped: [] }
    const payload = (await response.json()) as { readonly candidates?: readonly CandidateIndexEntry[] }
    const candidates: WorkbenchAsset[] = []
    const skipped: { speciesId: string; candidate: string; reason: string }[] = []
    for (const entry of payload.candidates ?? []) {
      const asset = toWorkbenchAsset(entry)
      if (asset) candidates.push(asset)
      else skipped.push({ speciesId: entry.speciesId, candidate: entry.candidate, reason: entry.buildFailedStage ? `build failed at ${entry.buildFailedStage}` : 'no runtime GLB or manifest yet' })
    }
    return { assets: [...accepted, ...candidates], candidateSource: 'dev-service', skipped }
  } catch {
    return { assets: accepted, candidateSource: 'unavailable', skipped: [] }
  }
}

export function selectWorkbenchAsset(catalog: readonly WorkbenchAsset[], speciesId: string | null, candidate: string | null) {
  const fallback = catalog.find((asset) => asset.key === DEFAULT_WORKBENCH_SPECIES)
  if (!speciesId) return { asset: fallback, invalid: undefined }
  const key = candidate ? candidateKey(speciesId, candidate) : speciesId
  const exact = catalog.find((asset) => asset.key === key)
  if (exact) return { asset: exact, invalid: undefined }
  // A species without an accepted asset: fall through to its newest loadable candidate.
  const newest = candidate ? undefined : [...catalog].reverse().find((asset) => asset.speciesId === speciesId && asset.state === 'candidate')
  if (newest) return { asset: newest, invalid: undefined }
  return { asset: fallback, invalid: candidate ? `${speciesId} / ${candidate}` : speciesId }
}

export function workbenchSearch(asset: WorkbenchAsset) {
  const params = new URLSearchParams(window.location.search)
  params.set('workbench', asset.speciesId)
  if (asset.candidate) params.set('candidate', asset.candidate)
  else params.delete('candidate')
  return `?${params.toString()}`
}

export function clipLoops(asset: WorkbenchAsset, clip: string) {
  if (asset.clipLoops && clip in asset.clipLoops) return asset.clipLoops[clip]
  return asset.clipRoles?.response !== clip
}
