export type AquariumNamespace = 'marine_reef' | 'freshwater'

export type LifecyclePhase =
  | 'commissioning'
  | 'cycling'
  | 'ugly_phase'
  | 'stabilizing'
  | 'young_reef'

export const ACTIVE_AQUARIUM_NAMESPACE = 'marine_reef' as const satisfies AquariumNamespace

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
    readonly saltMassKilograms: number
    readonly salinityPpt: number
    readonly specificGravity: number
    readonly temperatureCelsius: number
    readonly ph: number
    readonly alkalinityDkh: number
    readonly ammoniaPpm: number
    readonly nitritePpm: number
    readonly nitratePpm: number
    readonly phosphatePpm: number
  }
  readonly equipment: {
    readonly atoEnabled: boolean
    readonly atoReservoirLiters: number
    readonly atoSetpointLiters: number
    readonly atoPumpLitersPerHour: number
    readonly lightPower: number
    readonly flowPower: number
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
}

export interface ReefHudProps {
  readonly snapshot: ReefSnapshot
  readonly dispatch: (action: ReefAction) => void
}

