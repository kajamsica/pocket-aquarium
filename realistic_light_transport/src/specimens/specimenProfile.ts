export type SpecimenId = 'ocellaris'
export type EvidenceClass =
  | 'primary_experiment'
  | 'primary_observation'
  | 'authoritative_reference'
  | 'seller_claim'
  | 'expert_consensus'
  | 'game_calibration'
  | 'unknown'

export interface EvidenceValue<T> {
  readonly value: T | null
  readonly unit?: string
  readonly status: 'supported' | 'unset_required'
  readonly evidenceClass: EvidenceClass
  readonly sourceRefs: readonly string[]
  readonly provenance: 'reported' | 'derived' | 'calibrated' | 'unknown'
  readonly scope?: Readonly<{
    lifeStage?: string
    population?: string
    endpoint?: string
    environment?: string
    exposure?: string
    acclimation?: string
    exclusions?: readonly string[]
  }>
  readonly disposition: 'runtime' | 'display_only' | 'research_only' | 'excluded'
  readonly confidence: 'high' | 'medium' | 'low' | 'unknown'
  readonly note?: string
  readonly revision: number
}

export interface SourceReference {
  readonly id: string
  readonly title: string
  readonly publisher: string
  readonly url?: string
  readonly citation?: string
  readonly accessedAt?: string
  readonly evidenceClass: Exclude<EvidenceClass, 'game_calibration' | 'unknown'>
  readonly allowedUse: 'facts_and_citation' | 'permission_required_for_asset_use'
  readonly notes?: string
}

export interface CompatibilityEdge {
  readonly subjectSpeciesId: SpecimenId
  readonly objectType: 'species' | 'taxon' | 'trait' | 'coral_group' | 'environment'
  readonly objectId: string
  readonly outcome: 'compatible' | 'conditional' | 'incompatible' | 'unknown'
  readonly conditions: readonly string[]
  readonly riskTags: readonly string[]
  readonly evidence: EvidenceValue<string>
}

export interface MorphologyProfileV1 {
  readonly schemaVersion: 'pocket-aquarium.morphology/v1'
  readonly speciesId: SpecimenId
  readonly revision: number
  readonly units: 'meters'
  readonly adultLengthMeters: number
  readonly referenceGrade: 'A' | 'B' | 'C' | 'D'
  readonly controlStations: readonly Readonly<{ id: string; x: number; dorsalHeight: number; ventralDepth: number; halfWidth: number; centerY: number; centerZ: number }>[]
  readonly sampling: Readonly<{ ringPositions: readonly number[]; ringSampleCount: 48; crossSectionExponent: 1.72; capMode: 'center_fan' }>
  readonly landmarks: Readonly<Record<string, readonly [number, number, number]>>
  readonly finAnchors: Readonly<Record<string, readonly (readonly [number, number, number])[]>>
  readonly constraints: Readonly<{ stationOrder: true; minimumClearance: number; preserveRingCount: true; preserveRingSamples: true }>
  readonly referenceViews: readonly Readonly<{ view: 'side' | 'top' | 'front'; sourceRef: string; usage: 'measurement_only' | 'display_with_permission' }>[]
}

export interface SpecimenPackageV1 {
  readonly schemaVersion: 'pocket-aquarium.specimen-package/v1'
  readonly speciesId: SpecimenId
  readonly scientificName: string
  readonly commonName: string
  readonly waterType: 'marine' | 'freshwater'
  readonly revisions: Readonly<{ package: number; biology: number; calibration: number; morphology: number; asset: string }>
  readonly files: Readonly<{ biology: string; calibration: string; morphology: string; sources: string; acceptedAsset: string; acceptance: string }>
  readonly promotion: Readonly<{ state: 'accepted'; acceptedHash: string; baseAcceptedHash: string | null; candidateHash: string | null; validationReceipt: string | null; acceptanceReceipt: string }>
}

export interface RuntimeSpecimenProfileV1 {
  readonly schemaVersion: 'pocket-aquarium.runtime-specimen/v1'
  readonly speciesId: SpecimenId
  readonly profileRevision: Readonly<{ package: number; biology: number; calibration: number; morphology: number; asset: string }>
  readonly acceptedAssetHash: string
  readonly sourceRefs: readonly string[]
  readonly compatibilityEdges: readonly CompatibilityEdge[]
  readonly responseAxes: Readonly<Record<string, readonly unknown[]>>
  readonly [key: string]: unknown
}
