import {
  categoryLabel,
  rowsByCategory,
  sharedScaleSpan,
  visualCatalog,
  type AssetStatus,
  type CatalogCandidate,
  type CatalogRow,
  type SharedScaleSpan,
  type VisualCatalog,
} from '../catalog/visualCatalog'
import { acceptedSpecimenAssetList, type SpecimenAsset } from '../scene/specimens/assetRegistry'

// The workbench may inspect two kinds of assets: accepted runtime assets (resolved through the
// untouched asset registry) and awaiting_user_acceptance candidates served by the dev-only
// candidate catalog service. Normal aquarium runtime resolution never sees candidates. The visual
// catalog (src/catalog/visual-catalog.v1.json) supplies every row shown in the picker, including
// species that have no loadable asset yet.
export type WorkbenchAssetState = 'accepted' | 'candidate'

export interface WorkbenchAsset {
  readonly key: string
  readonly state: WorkbenchAssetState
  readonly speciesId: string
  readonly candidate?: string
  readonly sourceCandidate?: string
  readonly variantId?: string
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
  readonly category?: string
  readonly waterType?: string
  readonly taxonomyConfidence?: string
  readonly assetStatus?: AssetStatus
  readonly userApproved?: boolean
  readonly candidateState?: string
  readonly validatorStatus?: string
  readonly buildStatus?: string
  readonly buildFailedStage?: string
  readonly glbBytes?: number
  readonly glbSha256?: string
  readonly candidateHash?: string
  readonly authorPreviewUrl?: string
  readonly threeViewUrl?: string
  readonly visualDebt?: readonly string[]
}

interface CandidateIndexEntry {
  readonly speciesId: string
  readonly candidate: string
  readonly loadable: boolean
  readonly displayName: string
  readonly scientificName: string | null
  readonly variantId?: string | null
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
export const CANDIDATE_FILES_URL = '/__catalog/v1/candidates'
export const DEFAULT_WORKBENCH_SPECIES = 'ocellaris'

export type ScaleMode = 'shared' | 'fit'
export const DEFAULT_SCALE_MODE: ScaleMode = 'shared'

export function parseScaleMode(value: string | null | undefined): ScaleMode {
  return value === 'fit' ? 'fit' : 'shared'
}

export type WorkbenchBadge = 'accepted' | 'candidate' | 'approved' | 'provisional' | 'failed'

export const BADGE_LABELS: Readonly<Record<WorkbenchBadge, string>> = {
  accepted: 'Accepted (runtime)',
  candidate: 'Candidate',
  approved: 'Candidate (user approved look)',
  provisional: 'Provisional',
  failed: 'Failed',
}

export function assetBadge(asset: Pick<WorkbenchAsset, 'state' | 'buildStatus' | 'validatorStatus' | 'assetStatus' | 'userApproved'>): WorkbenchBadge {
  if (asset.state === 'accepted') return 'accepted'
  if (asset.buildStatus === 'failed' || asset.validatorStatus === 'failed') return 'failed'
  if (asset.assetStatus === 'provisional') return 'provisional'
  if (asset.userApproved) return 'approved'
  return 'candidate'
}

export function rowStatusText(row: Pick<CatalogRow, 'assetStatus' | 'candidates'>) {
  switch (row.assetStatus) {
    case 'accepted': return 'accepted runtime asset'
    case 'candidate': return 'candidate awaiting acceptance'
    case 'provisional': return 'provisional reference'
    case 'failed': return 'build failed'
    default: return row.candidates.length ? 'candidate still building' : 'no candidate yet'
  }
}

function acceptedFromRow(row: CatalogRow | undefined, asset: SpecimenAsset): WorkbenchAsset {
  const registryAsset = asset as SpecimenAsset & Partial<{
    key: string; variantId: string; category: string; bodyPlan: string; referenceSizeKind: string
    sourceCandidate: string; sha256: string; defaultForSpecies: boolean
  }>
  const key = registryAsset.key ?? asset.speciesId
  const isDefault = registryAsset.defaultForSpecies ?? key === asset.speciesId
  return {
    key,
    state: 'accepted',
    speciesId: asset.speciesId,
    candidate: isDefault ? undefined : registryAsset.sourceCandidate,
    sourceCandidate: registryAsset.sourceCandidate,
    variantId: registryAsset.variantId,
    displayName: asset.displayName,
    scientificName: row?.scientificLabel ?? undefined,
    url: asset.url,
    assetVersion: asset.assetVersion,
    referenceSizeMeters: row?.referenceSize.meters ?? asset.referenceAdultLengthMeters,
    referenceSizeKind: registryAsset.referenceSizeKind ?? row?.referenceSize.kind ?? 'adult_total_length',
    clips: asset.clips,
    clipRoles: asset.clipRoles,
    clipLoops: asset.clipLoops,
    referenceGrade: row?.referenceGrade ?? undefined,
    bodyPlan: registryAsset.bodyPlan ?? row?.bodyPlan ?? undefined,
    category: registryAsset.category ?? row?.category,
    waterType: row?.waterType ?? undefined,
    taxonomyConfidence: row?.taxonomyConfidence ?? undefined,
    assetStatus: 'accepted',
    glbSha256: registryAsset.sha256 ?? row?.accepted.sha256 ?? undefined,
    visualDebt: row?.visualDebt,
  }
}

export function acceptedWorkbenchAssets(rows: readonly CatalogRow[] = visualCatalog.rows, assets: readonly SpecimenAsset[] = acceptedSpecimenAssetList()): WorkbenchAsset[] {
  return assets.map((asset) =>
    acceptedFromRow(rows.find((row) => row.id === asset.speciesId), asset))
}

export function candidateKey(speciesId: string, candidate: string) {
  return `${speciesId}@${candidate}`
}

function toWorkbenchAsset(entry: CandidateIndexEntry, row: CatalogRow | undefined, approvals: Readonly<Record<string, string>>): WorkbenchAsset | undefined {
  if (!entry.loadable || !entry.files.glb) return undefined
  const catalogCandidate = row?.candidates.find((candidate) => candidate.name === entry.candidate)
  const referenceSizeMeters = entry.referenceSizeMeters ?? catalogCandidate?.referenceSizeMeters ?? row?.referenceSize.meters ?? null
  if (!referenceSizeMeters) return undefined
  return {
    key: candidateKey(entry.speciesId, entry.candidate),
    state: 'candidate',
    speciesId: entry.speciesId,
    candidate: entry.candidate,
    sourceCandidate: entry.candidate,
    variantId: entry.variantId ?? catalogCandidate?.variantId ?? undefined,
    displayName: entry.displayName || row?.displayName || entry.speciesId,
    scientificName: entry.scientificName ?? row?.scientificLabel ?? undefined,
    url: entry.files.glb,
    assetVersion: entry.assetVersion ?? catalogCandidate?.assetVersion ?? 'candidate',
    referenceSizeMeters,
    referenceSizeKind: entry.referenceSizeKind ?? row?.referenceSize.kind ?? 'adult_total_length',
    clips: entry.clips,
    clipRoles: entry.clipRoles ?? undefined,
    clipLoops: entry.clipLoops ?? undefined,
    referenceGrade: entry.referenceGrade ?? row?.referenceGrade ?? undefined,
    bodyPlan: entry.bodyPlan ?? row?.bodyPlan ?? undefined,
    category: row?.category,
    waterType: row?.waterType ?? undefined,
    taxonomyConfidence: row?.taxonomyConfidence ?? undefined,
    assetStatus: row?.assetStatus,
    userApproved: catalogCandidate?.userApproved ?? approvals[entry.speciesId] === entry.candidate,
    candidateState: entry.candidateState,
    validatorStatus: entry.validatorStatus,
    buildStatus: entry.buildStatus,
    buildFailedStage: entry.buildFailedStage ?? undefined,
    glbBytes: entry.glbBytes,
    glbSha256: entry.glbSha256 ?? undefined,
    candidateHash: entry.candidateHash ?? undefined,
    authorPreviewUrl: entry.files.authorPreview ?? undefined,
    threeViewUrl: entry.files.threeView ?? undefined,
    visualDebt: row?.visualDebt,
  }
}

export interface WorkbenchCatalog {
  readonly assets: readonly WorkbenchAsset[]
  readonly candidateSource: 'dev-service' | 'unavailable'
  readonly skipped: readonly { readonly speciesId: string; readonly candidate: string; readonly reason: string }[]
  readonly rows: readonly CatalogRow[]
  readonly generatedAt: string
  readonly span: SharedScaleSpan
}

export interface LoadWorkbenchCatalogOptions {
  /** Override the bundled visual catalog (tests). */
  readonly catalog?: Pick<VisualCatalog, 'rows' | 'userApprovals' | 'generatedAt'>
  readonly acceptedAssets?: readonly SpecimenAsset[]
}

export async function loadWorkbenchCatalog(fetchImpl: typeof fetch = fetch, options: LoadWorkbenchCatalogOptions = {}): Promise<WorkbenchCatalog> {
  const source = options.catalog ?? visualCatalog
  const rows = source.rows
  const accepted = acceptedWorkbenchAssets(rows, options.acceptedAssets)
  const acceptedKeys = new Set(accepted.flatMap((asset) => [asset.key, ...(asset.sourceCandidate ? [candidateKey(asset.speciesId, asset.sourceCandidate)] : [])]))
  const base = { rows, generatedAt: source.generatedAt, span: sharedScaleSpan(rows) }
  try {
    const response = await fetchImpl(CANDIDATE_INDEX_URL, { cache: 'no-store' })
    if (!response.ok) return { ...base, assets: accepted, candidateSource: 'unavailable', skipped: [] }
    const payload = (await response.json()) as { readonly candidates?: readonly CandidateIndexEntry[] }
    const candidates: WorkbenchAsset[] = []
    const skipped: { speciesId: string; candidate: string; reason: string }[] = []
    for (const entry of payload.candidates ?? []) {
      if (acceptedKeys.has(candidateKey(entry.speciesId, entry.candidate))) continue
      const row = rows.find((candidate) => candidate.id === entry.speciesId)
      const asset = toWorkbenchAsset(entry, row, source.userApprovals)
      if (asset) candidates.push(asset)
      else skipped.push({ speciesId: entry.speciesId, candidate: entry.candidate, reason: entry.buildFailedStage ? `build failed at ${entry.buildFailedStage}` : 'no runtime GLB or manifest yet' })
    }
    return { ...base, assets: [...accepted, ...candidates], candidateSource: 'dev-service', skipped }
  } catch {
    return { ...base, assets: accepted, candidateSource: 'unavailable', skipped: [] }
  }
}

/** Among a species' loadable candidates prefer the user-approved look, then validated builds, then the newest. */
export function preferredCandidate(catalog: readonly WorkbenchAsset[], speciesId: string) {
  const candidates = catalog.filter((asset) => asset.speciesId === speciesId && asset.state === 'candidate')
  return candidates.find((asset) => asset.userApproved)
    ?? [...candidates].reverse().find((asset) => asset.validatorStatus === 'passed')
    ?? candidates[candidates.length - 1]
}

export interface WorkbenchSelection {
  readonly asset: WorkbenchAsset | undefined
  /** Set when the request named something the catalog does not know at all. */
  readonly invalid: string | undefined
  /** Set when the request named a catalog row (or its candidate) that has no loadable asset right now. */
  readonly unavailable: { readonly row: CatalogRow; readonly candidate?: string; readonly reason: string } | undefined
}

export function selectWorkbenchAsset(
  catalog: readonly WorkbenchAsset[],
  speciesId: string | null,
  candidate: string | null,
  rows: readonly CatalogRow[] = [],
  candidateSource: WorkbenchCatalog['candidateSource'] = 'dev-service',
): WorkbenchSelection {
  const fallback = catalog.find((asset) => asset.key === DEFAULT_WORKBENCH_SPECIES)
  if (!speciesId) return { asset: fallback, invalid: undefined, unavailable: undefined }
  const key = candidate ? candidateKey(speciesId, candidate) : speciesId
  const exact = catalog.find((asset) => asset.key === key)
  if (exact) return { asset: exact, invalid: undefined, unavailable: undefined }
  // A species without an accepted asset: fall through to its best loadable candidate.
  const preferred = candidate ? undefined : preferredCandidate(catalog, speciesId)
  if (preferred) return { asset: preferred, invalid: undefined, unavailable: undefined }
  const row = rows.find((entry) => entry.id === speciesId)
  if (row) {
    const catalogCandidate = candidate ? row.candidates.find((entry) => entry.name === candidate) : undefined
    if (!candidate || catalogCandidate) {
      const reason = catalogCandidate
        ? candidateStatusText(catalogCandidate, candidateSource)
        : candidateSource === 'unavailable' && row.candidates.length
          ? 'candidate GLBs load through the dev server only'
          : rowStatusText(row)
      return { asset: fallback, invalid: undefined, unavailable: { row, candidate: candidate ?? undefined, reason } }
    }
  }
  return { asset: fallback, invalid: candidate ? `${speciesId} / ${candidate}` : speciesId, unavailable: undefined }
}

export function workbenchSearch(asset: Pick<WorkbenchAsset, 'speciesId' | 'candidate'>, scaleMode: ScaleMode = DEFAULT_SCALE_MODE, search = window.location.search) {
  const params = new URLSearchParams(search)
  params.set('workbench', asset.speciesId)
  if (asset.candidate) params.set('candidate', asset.candidate)
  else params.delete('candidate')
  params.set('scale', scaleMode)
  return `?${params.toString()}`
}

export function clipLoops(asset: Pick<WorkbenchAsset, 'clipLoops' | 'clipRoles'>, clip: string) {
  if (asset.clipLoops && clip in asset.clipLoops) return asset.clipLoops[clip]
  return asset.clipRoles?.response !== clip
}

// Picker model: one option per accepted asset and per catalog candidate, grouped by category with
// accepted rows first. Rows without a loadable asset stay visible as disabled options that explain why.
export interface WorkbenchOption {
  readonly key: string
  readonly speciesId: string
  readonly candidate?: string
  readonly label: string
  readonly disabled: boolean
  readonly status: string
  readonly badge?: WorkbenchBadge
}

export interface WorkbenchOptionGroup {
  readonly category: string
  readonly label: string
  readonly options: readonly WorkbenchOption[]
}

export function candidateStatusText(candidate: CatalogCandidate, candidateSource: WorkbenchCatalog['candidateSource']) {
  if (candidate.buildStatus === 'failed') return candidate.buildFailedStage ? `build failed at ${candidate.buildFailedStage}` : 'build failed'
  if (candidate.state === 'missing') return candidate.manifest === 'unparsable' ? 'manifest unparsable' : 'building, manifest missing'
  if (!candidate.glb) return 'no runtime GLB yet'
  if (candidate.validatorStatus === 'failed') return 'validator failed'
  if (candidateSource === 'unavailable') return 'dev server only'
  return 'not served yet, restart the dev server'
}

function candidateSuffix(candidate: Pick<CatalogCandidate, 'userApproved' | 'validatorStatus' | 'buildStatus'>) {
  if (candidate.buildStatus === 'failed' || candidate.validatorStatus === 'failed') return 'failed'
  if (candidate.userApproved) return 'user approved'
  return candidate.validatorStatus === 'passed' ? 'validated' : candidate.validatorStatus ?? 'unvalidated'
}

export function workbenchOptionGroups(catalog: Pick<WorkbenchCatalog, 'assets' | 'rows' | 'candidateSource'>): WorkbenchOptionGroup[] {
  const byKey = new Map<string, WorkbenchAsset>()
  for (const asset of catalog.assets) {
    if (!byKey.has(asset.key) || asset.state === 'accepted') byKey.set(asset.key, asset)
  }
  const acceptedBySourceKey = new Map(catalog.assets
    .filter((asset) => asset.state === 'accepted' && asset.sourceCandidate)
    .map((asset) => [candidateKey(asset.speciesId, asset.sourceCandidate!), asset]))
  const seenKeys = new Set<string>()
  const groups: WorkbenchOptionGroup[] = []

  for (const group of rowsByCategory(catalog.rows)) {
    const options: WorkbenchOption[] = []
    for (const row of group.rows) {
      const rowLabel = row.displayName
      const accepted = byKey.get(row.id)
      if (accepted?.state === 'accepted') {
        seenKeys.add(row.id)
        options.push({ key: accepted.key, speciesId: row.id, label: `${rowLabel} (accepted v${accepted.assetVersion})`, disabled: false, status: BADGE_LABELS.accepted, badge: 'accepted' })
      } else if (row.assetStatus === 'accepted') {
        seenKeys.add(row.id)
        options.push({ key: `row:${row.id}`, speciesId: row.id, label: `${rowLabel} (accepted, not in registry)`, disabled: true, status: 'accepted package missing from the runtime registry' })
      }
      for (const candidate of row.candidates) {
        const key = candidateKey(row.id, candidate.name)
        seenKeys.add(key)
        const promotedDefault = acceptedBySourceKey.get(key)
        if (promotedDefault && promotedDefault.key !== key) continue
        const asset = byKey.get(key)
        const variant = candidate.variantId ? ` / ${candidate.displayName}` : ''
        if (asset?.state === 'accepted') {
          options.push({ key, speciesId: row.id, candidate: asset.candidate, label: `${rowLabel}${variant} (${candidate.name}, accepted v${asset.assetVersion})`, disabled: false, status: BADGE_LABELS.accepted, badge: 'accepted' })
        } else if (asset) {
          const badge = assetBadge(asset)
          options.push({ key, speciesId: row.id, candidate: candidate.name, label: `${rowLabel}${variant} (${candidate.name}, ${candidateSuffix({ ...candidate, userApproved: asset.userApproved ?? candidate.userApproved })})`, disabled: false, status: BADGE_LABELS[badge], badge })
        } else {
          const status = candidateStatusText(candidate, catalog.candidateSource)
          options.push({ key: `row:${key}`, speciesId: row.id, candidate: candidate.name, label: `${rowLabel}${variant} (${candidate.name}, ${status})`, disabled: true, status })
        }
      }
      // Loadable candidates the committed catalog has not been rebuilt for yet.
      for (const asset of catalog.assets) {
        if (asset.speciesId !== row.id || seenKeys.has(asset.key)) continue
        seenKeys.add(asset.key)
        const badge = assetBadge(asset)
        const suffix = asset.state === 'accepted' ? `accepted v${asset.assetVersion}` : 'not in catalog yet'
        options.push({ key: asset.key, speciesId: row.id, candidate: asset.candidate, label: `${rowLabel} (${asset.candidate ?? asset.key}, ${suffix})`, disabled: false, status: BADGE_LABELS[badge], badge })
      }
      if (row.assetStatus !== 'accepted' && row.candidates.length === 0 && !options.some((option) => option.speciesId === row.id)) {
        options.push({ key: `row:${row.id}`, speciesId: row.id, label: `${rowLabel} (${rowStatusText(row)})`, disabled: true, status: rowStatusText(row) })
      }
    }
    if (options.length) groups.push({ category: group.category, label: group.label, options })
  }

  const orphans = catalog.assets.filter((asset) => !seenKeys.has(asset.key))
  if (orphans.length) {
    groups.push({
      category: 'uncatalogued',
      label: 'Not in catalog yet',
      options: orphans.map((asset) => {
        const badge = assetBadge(asset)
        return { key: asset.key, speciesId: asset.speciesId, candidate: asset.candidate, label: `${asset.displayName}${asset.candidate ? ` (${asset.candidate})` : ''}`, disabled: false, status: BADGE_LABELS[badge], badge }
      }),
    })
  }
  return groups
}

export { categoryLabel }
