import { useMemo, useState } from 'react'

import type { CompatibilityEdge, EvidenceValue, SourceReference, SpecimenId } from '../specimens/specimenProfile'
import { SpecimenResponsePreview, type ResponseBandName } from './SpecimenResponsePreview'
import './specimenStudio.css'

type CalibrationField =
  | 'legacyRuntime.feedIntervalDays'
  | 'criticalHazardAfterHours'
  | 'recoveryPerDay'
  | `stressAccrualPerDayByBand.${ResponseBandName}`

export interface CalibrationDraftPatch {
  readonly schemaVersion: 'pocket-aquarium.calibration-patch/v1'
  readonly speciesId: SpecimenId
  readonly baseRevision: number
  readonly values: Readonly<Partial<Record<CalibrationField, number>>>
}

export interface CalibrationValidationIssue { readonly field: CalibrationField; readonly message: string }

export type BiologyProfile = {
  readonly speciesId: SpecimenId
  readonly housing: { readonly enforcedMinimumDisplayVolumeL: EvidenceValue<number> }
  readonly acuteExperimentalLimits: readonly EvidenceValue<unknown>[]
  readonly unsupportedRates: Readonly<Record<string, EvidenceValue<unknown>>>
  readonly compatibilityEdges: readonly CompatibilityEdge[]
  readonly reproduction: {
    readonly displaySpawning: EvidenceValue<boolean>
    readonly larvalRecruitment: EvidenceValue<{ readonly availableInOrdinaryDisplay: boolean; readonly requires: readonly string[]; readonly ordinaryPodsSufficient: boolean }>
  }
}

export type CalibrationProfile = {
  readonly revision: number
  readonly legacyRuntime: EvidenceValue<{ readonly feedIntervalDays: number }>
  readonly conditionMultiplierByBand: EvidenceValue<Record<ResponseBandName, number>>
  readonly stressAccrualPerDayByBand: EvidenceValue<Record<ResponseBandName, number>>
  readonly criticalHazardAfterHours: EvidenceValue<number>
  readonly recoveryPerDay: EvidenceValue<number>
}

const BANDS: readonly ResponseBandName[] = ['ideal', 'neutral', 'poor', 'critical']
const FIELD_LIMITS: Readonly<Record<CalibrationField, readonly [number, number]>> = {
  'legacyRuntime.feedIntervalDays': [0.25, 14], criticalHazardAfterHours: [1, 336], recoveryPerDay: [0, 1],
  'stressAccrualPerDayByBand.ideal': [0, 1], 'stressAccrualPerDayByBand.neutral': [0, 1], 'stressAccrualPerDayByBand.poor': [0, 1], 'stressAccrualPerDayByBand.critical': [0, 1],
}

function EvidenceCard({ label, evidence, sources }: { readonly label: string; readonly evidence: EvidenceValue<unknown>; readonly sources: ReadonlyMap<string, SourceReference> }) {
  const scope = evidence.scope && Object.entries(evidence.scope).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' | ')
  return <article className={`evidence-card${evidence.status === 'unset_required' ? ' evidence-card--unset' : ''}`}>
    <h3>{label}</h3>
    <strong>{evidence.status === 'unset_required' ? 'Unset, evidence required' : `${typeof evidence.value === 'object' ? JSON.stringify(evidence.value) : evidence.value} ${evidence.unit ?? ''}`}</strong>
    <div className="evidence-tags"><span>{evidence.evidenceClass.replaceAll('_', ' ')}</span><span>{evidence.provenance}</span><span>{evidence.confidence} confidence</span><span>{evidence.disposition.replaceAll('_', ' ')}</span></div>
    {evidence.evidenceClass === 'seller_claim' && <p className="seller-warning">Seller claim, non-canonical guidance</p>}
    {scope && <p>{scope}</p>}{evidence.note && <p>{evidence.note}</p>}
    <nav aria-label={`${label} sources`}>{evidence.sourceRefs.map((id) => { const source = sources.get(id); return source?.url ? <a href={source.url} target="_blank" rel="noreferrer" key={id}>{id}</a> : <span key={id}>{id}</span> })}</nav>
  </article>
}

export function SpecimenProfilePanel({ biology, calibration, sources, onDraftChange }: {
  readonly biology: BiologyProfile
  readonly calibration: CalibrationProfile
  readonly sources: readonly SourceReference[]
  readonly onDraftChange?: (patch: CalibrationDraftPatch, issues: readonly CalibrationValidationIssue[]) => void
}) {
  const [draft, setDraft] = useState<Partial<Record<CalibrationField, number>>>({})
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])
  const original = (field: CalibrationField) => {
    if (field === 'legacyRuntime.feedIntervalDays') return calibration.legacyRuntime.value?.feedIntervalDays ?? 0
    if (field === 'criticalHazardAfterHours') return calibration.criticalHazardAfterHours.value ?? 0
    if (field === 'recoveryPerDay') return calibration.recoveryPerDay.value ?? 0
    const band = field.split('.')[1] as ResponseBandName
    return calibration.stressAccrualPerDayByBand.value?.[band] ?? 0
  }
  const valueOf = (field: CalibrationField) => draft[field] ?? original(field)
  const update = (field: CalibrationField, value: number) => {
    const next = { ...draft, ...(Number.isFinite(value) ? { [field]: value } : {}) }
    const issues = Object.entries(next).flatMap(([path, candidate]) => {
      const [minimum, maximum] = FIELD_LIMITS[path as CalibrationField]
      return candidate! < minimum || candidate! > maximum ? [{ field: path as CalibrationField, message: `Must be between ${minimum} and ${maximum}.` }] : []
    })
    setDraft(next)
    onDraftChange?.({ schemaVersion: 'pocket-aquarium.calibration-patch/v1', speciesId: biology.speciesId, baseRevision: calibration.revision, values: next }, issues)
  }
  const bands = BANDS.map((band) => ({ band, conditionMultiplier: calibration.conditionMultiplierByBand.value?.[band] ?? 0, stressPerDay: valueOf(`stressAccrualPerDayByBand.${band}`) }))

  return <div className="specimen-profile-panel">
    <section className="profile-section"><header><p>Read-only biology</p><h2>Evidence-backed profile</h2></header>
      <div className="evidence-grid"><EvidenceCard label="Minimum display volume" evidence={biology.housing.enforcedMinimumDisplayVolumeL} sources={sourceMap} />
        {Object.entries(biology.unsupportedRates).slice(0, 4).map(([key, evidence]) => <EvidenceCard key={key} label={key.replaceAll(/([A-Z])/g, ' $1')} evidence={evidence} sources={sourceMap} />)}
      </div>
      <details><summary>Research-only acute endpoints</summary><p>Acute endpoints retain their exposure and acclimation context. They cannot become editable routine husbandry bands.</p>{biology.acuteExperimentalLimits.map((evidence, index) => <EvidenceCard key={index} label={`Acute observation ${index + 1}`} evidence={evidence} sources={sourceMap} />)}</details>
    </section>

    <section className="profile-section"><header><p>Tunable game values</p><h2>Calibration draft</h2></header><p className="calibration-warning">These controls are game design, not measured biology.</p>
      <div className="calibration-grid">
        <label>Hunger cadence <small>game days between feeds</small><input type="number" min="0.25" max="14" step="0.25" value={valueOf('legacyRuntime.feedIntervalDays')} onChange={(event) => update('legacyRuntime.feedIntervalDays', event.currentTarget.valueAsNumber)} /></label>
        <label>Critical hazard delay <small>hours</small><input type="number" min="1" max="336" step="1" value={valueOf('criticalHazardAfterHours')} onChange={(event) => update('criticalHazardAfterHours', event.currentTarget.valueAsNumber)} /></label>
        <label>Recovery <small>fraction/day</small><input type="number" min="0" max="1" step="0.01" value={valueOf('recoveryPerDay')} onChange={(event) => update('recoveryPerDay', event.currentTarget.valueAsNumber)} /></label>
        {BANDS.map((band) => <label key={band}>{band} stress <small>fraction/day</small><input type="number" min="0" max="1" step="0.01" value={valueOf(`stressAccrualPerDayByBand.${band}`)} onChange={(event) => update(`stressAccrualPerDayByBand.${band}`, event.currentTarget.valueAsNumber)} /></label>)}
      </div>
    </section>

    <SpecimenResponsePreview bands={bands} criticalHazardAfterHours={valueOf('criticalHazardAfterHours')} />
    <section className="profile-section"><header><p>Subject to object only</p><h2>Directional compatibility</h2></header><ul className="compatibility-list">{biology.compatibilityEdges.map((edge) => <li key={`${edge.objectType}:${edge.objectId}`}><strong>ocellaris → {edge.objectId.replaceAll('_', ' ')}</strong><span data-outcome={edge.outcome}>{edge.outcome === 'unknown' ? 'unknown, not compatible' : edge.outcome}</span><small>{edge.conditions.join(' | ') || 'No added conditions'}</small><small>{edge.evidence.evidenceClass.replaceAll('_', ' ')} | {edge.evidence.sourceRefs.join(', ') || 'no source IDs'}{edge.evidence.evidenceClass === 'seller_claim' ? ' | non-canonical seller guidance' : ''}</small></li>)}</ul></section>
    <section className="profile-section"><header><p>Separate lifecycle gates</p><h2>Spawning and recruitment</h2></header><div className="evidence-grid"><EvidenceCard label="Display spawning" evidence={biology.reproduction.displaySpawning} sources={sourceMap} /><EvidenceCard label="Larval recruitment" evidence={biology.reproduction.larvalRecruitment} sources={sourceMap} /></div></section>
  </div>
}
