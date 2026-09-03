export type AquariumNamespace = 'marine_reef' | 'freshwater'

export type LifecyclePhase =
  | 'commissioning'
  | 'cycling'
  | 'ugly_phase'
  | 'stabilizing'
  | 'young_reef'

export const ACTIVE_AQUARIUM_NAMESPACE = 'marine_reef' as const satisfies AquariumNamespace

export type RenderQuality = 'balanced' | 'cinematic'

export type DiagnosticView = 'beauty' | 'spectral' | 'flow'

export interface ReefRenderSettings {
  readonly quality: RenderQuality
  readonly diagnosticView: DiagnosticView
  /** Display exposure only. Biological PAR remains authoritative simulation state. */
  readonly brightness: number
}

export interface ReefRenderTelemetry {
  readonly optics: {
    readonly spectralBands: 6
    readonly renderScale: number
    readonly meanVisibleTransmittance: number
    readonly chromaticSpreadPixels: number
  }
  readonly flow: {
    readonly columns: number
    readonly rows: number
    readonly meanSpeedMetersPerSecond: number
    readonly peakSpeedMetersPerSecond: number
    readonly meanShearPerSecond: number
    readonly lowFlowFraction: number
    readonly maximumDivergence: number
    readonly pressureResidual: number
  }
}

export interface ReefSnapshot {
  readonly namespace: typeof ACTIVE_AQUARIUM_NAMESPACE
  readonly clock: {
    readonly elapsedHours: number
    readonly day: number
    readonly timeOfDayHours: number
    readonly speed: number
    readonly paused: boolean
  }
  readonly tank: {
    readonly nominalVolumeLiters: number
    readonly targetWaterVolumeLiters: number
    readonly waterVolumeLiters: number
    readonly waterLevelMeters: number
    readonly widthMeters: number
    readonly heightMeters: number
    readonly depthMeters: number
    readonly evaporationLitersPerDay: number
  }
  readonly chemistry: {
    readonly saltEquivalentMassKilograms: number
    readonly saltEquivalentGPerKg: number
    readonly totalAmmoniaNitrogenMassMilligrams: number
    readonly nitriteNitrogenMassMilligrams: number
    readonly nitrateNitrogenMassMilligrams: number
    readonly phosphatePhosphorusMassMilligrams: number
    readonly totalAmmoniaNitrogenMgPerLiter: number
    readonly nitriteNitrogenMgPerLiter: number
    readonly nitrateNitrogenMgPerLiter: number
    readonly phosphatePhosphorusMgPerLiter: number
    readonly temperatureCelsius: number
    readonly ph: number
    readonly alkalinityDkh: number
  }
  readonly equipment: {
    readonly atoEnabled: boolean
    readonly atoReservoirLiters: number
    readonly atoSetpointLiters: number
    readonly atoPumpLitersPerHour: number
    readonly lightPower: number
    readonly flowPower: number
    /** Finite ATO reservoir capacity and empty cue (optional: only the pocket bridge fills these). */
    readonly atoReservoirCapacityLiters?: number
    readonly atoEmpty?: boolean
    /** Physical auto-feeder projection for the reef hardware and HUD cues. */
    readonly feederInstalled?: boolean
    readonly feederEnabled?: boolean
    readonly feederDispensing?: boolean
    readonly feederEmpty?: boolean
    /** Installed equipment level ids, projected so the reef can render owned hardware. */
    readonly filterLevel?: string
    readonly circulationLevel?: string
    readonly lightLevel?: string
    readonly skimmerLevel?: string
    readonly refugiumLevel?: string
  }
  readonly ecology: {
    readonly phase: LifecyclePhase
    readonly maturity: number
    readonly diatomCoverage: number
    readonly greenAlgaeCoverage: number
    readonly cyanobacteriaCoverage: number
    readonly microfaunaActivity: number
    readonly polypExtension: number
  }
  readonly livestock: {
    readonly clownfishCount: number
    readonly smallReefFishCount: number
    readonly fishSatiation: number
    readonly fishStress: number
    readonly coralHealth: number
  }
  readonly lightField: {
    readonly surfacePpfd: number
    readonly localPpfd: number
    readonly sampleDepthMeters: number
    readonly interfaceTransmission: number
    readonly attenuationPerMeter: number
    readonly shading: number
  }
  readonly events: {
    readonly sequence: number
    readonly lastEvent: string
    readonly causalNote: string
    readonly feedPulse: number
  }
}

export type ReefAction =
  | { readonly type: 'set_speed'; readonly speed: number }
  | { readonly type: 'toggle_pause' }
  | { readonly type: 'feed'; readonly amountGrams: number }
  | { readonly type: 'set_light'; readonly power: number }
  | { readonly type: 'set_flow'; readonly power: number }
  | { readonly type: 'toggle_ato' }
  | { readonly type: 'refill_ato' }
  | { readonly type: 'reset' }
  | { readonly type: 'set_phase_preview'; readonly phase: LifecyclePhase }

export interface ReefSceneProps {
  readonly snapshot: ReefSnapshot
  readonly renderSettings?: ReefRenderSettings
  readonly onRenderTelemetry?: (telemetry: ReefRenderTelemetry) => void
}

export interface ReefHudProps {
  readonly snapshot: ReefSnapshot
  readonly dispatch: (action: ReefAction) => void
  readonly renderSettings?: ReefRenderSettings
  readonly renderTelemetry?: ReefRenderTelemetry
  readonly onRenderSettingsChange?: (settings: ReefRenderSettings) => void
}
