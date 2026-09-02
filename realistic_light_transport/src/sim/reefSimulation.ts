import {
  ACTIVE_AQUARIUM_NAMESPACE,
  type LifecyclePhase,
  type ReefAction,
  type ReefSnapshot,
} from '../contracts'
import {
  estimateCanonicalFlowRegime,
  type FlowScalarEstimate,
} from './flowField'

const HOURS_PER_DAY = 24
const NOMINAL_VOLUME_LITERS = 284
const TARGET_WATER_VOLUME_LITERS = 246
const MIN_MODELED_WATER_VOLUME_LITERS = 100
const TANK_WIDTH_METERS = 1.2
const TANK_HEIGHT_METERS = 0.52
const TANK_DEPTH_METERS = 0.5
const EVAPORATION_LITERS_PER_DAY = 3
const ATO_RESERVOIR_CAPACITY_LITERS = 20
const ATO_SETPOINT_LITERS = 245.5
const ATO_PUMP_LITERS_PER_HOUR = 5
const INITIAL_SALT_EQUIVALENT_G_PER_KG = 35
const INITIAL_SALT_MASS_FRACTION = INITIAL_SALT_EQUIVALENT_G_PER_KG / 1000

// Display volume is converted to water mass with a fixed 25 C density proxy.
// S_eq remains a mass fraction, not salinity or a specific-gravity conversion.
const WATER_DENSITY_KG_PER_LITER = 0.997

const FULL_POWER_SURFACE_PPFD = 520
const AIR_WATER_INTERFACE_TRANSMISSION = 0.96
const BASE_ATTENUATION_PER_METER = 0.78
const DEFAULT_PAR_SAMPLE_DEPTH_METERS = 0.28
const BASE_REEF_SHADING = 0.18

const MAX_SIMULATION_STEP_HOURS = 0.25
const MAX_INTEGRATION_STEPS = 2048
const TARGET_TEMPERATURE_CELSIUS = 25.5
const TARGET_PH = 8.12
const TARGET_ALKALINITY_DKH = 8.2
const MAX_SPEED = 48
const MIN_SPEED = 0.25
const POLYP_OPTIMAL_FLOW_METERS_PER_SECOND = 0.11
const POLYP_FLOW_HALF_WIDTH_METERS_PER_SECOND = 0.11
const EXCESSIVE_SHEAR_START_PER_SECOND = 0.62
const EXCESSIVE_SHEAR_RANGE_PER_SECOND = 0.18
const MINIMUM_CYANO_FLOW_PRESSURE = 0.08

const FEED_PULSE_HALF_LIFE_HOURS = 6
const FEED_WATER_COLUMN_NITROGEN_MG_PER_GRAM = 18
const FEED_WATER_COLUMN_PHOSPHORUS_MG_PER_GRAM = 3.5
const AMMONIA_PROCESSING_PER_HOUR = 0.09
const NITRITE_PROCESSING_PER_HOUR = 0.065
const NITRATE_EXPORT_PER_HOUR = 0.0018
const PHOSPHATE_EXPORT_PER_HOUR = 0.0012
const MATURITY_DAYS = 180
const FISHLESS_LIVESTOCK: ReefSnapshot['livestock'] = {
  clownfishCount: 0,
  smallReefFishCount: 0,
  fishSatiation: 0,
  fishStress: 0,
  coralHealth: 0,
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback

const relax = (current: number, target: number, ratePerHour: number, hours: number): number =>
  target + (current - target) * Math.exp(-Math.max(0, ratePerHour) * hours)

const processedAmount = (available: number, ratePerHour: number, hours: number): number =>
  Math.max(0, available) * (1 - Math.exp(-Math.max(0, ratePerHour) * hours))

const withDerivedConcentrations = (
  waterVolumeLiters: number,
  chemistry: ReefSnapshot['chemistry'],
): ReefSnapshot['chemistry'] => {
  const liters = Math.max(MIN_MODELED_WATER_VOLUME_LITERS, waterVolumeLiters)
  const waterMassKilograms = liters * WATER_DENSITY_KG_PER_LITER
  return {
    ...chemistry,
    saltEquivalentGPerKg:
      (1000 * chemistry.saltEquivalentMassKilograms) /
      (waterMassKilograms + chemistry.saltEquivalentMassKilograms),
    totalAmmoniaNitrogenMgPerLiter:
      chemistry.totalAmmoniaNitrogenMassMilligrams / liters,
    nitriteNitrogenMgPerLiter: chemistry.nitriteNitrogenMassMilligrams / liters,
    nitrateNitrogenMgPerLiter: chemistry.nitrateNitrogenMassMilligrams / liters,
    phosphatePhosphorusMgPerLiter:
      chemistry.phosphatePhosphorusMassMilligrams / liters,
  }
}

const waterLevelFor = (waterVolumeLiters: number): number =>
  clamp(
    waterVolumeLiters / 1000 / (TANK_WIDTH_METERS * TANK_DEPTH_METERS),
    0,
    TANK_HEIGHT_METERS,
  )

const clockFor = (
  elapsedHours: number,
  speed: number,
  paused: boolean,
): ReefSnapshot['clock'] => ({
  elapsedHours,
  day: Math.floor(elapsedHours / HOURS_PER_DAY) + 1,
  timeOfDayHours: ((elapsedHours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY,
  speed,
  paused,
})

const lifecyclePhaseFor = (
  maturity: number,
  totalAmmoniaNitrogenMgPerLiter: number,
  nitriteNitrogenMgPerLiter: number,
  nuisanceCoverage: number,
  waterQuality: number,
): LifecyclePhase => {
  if (
    maturity < 0.035 &&
    totalAmmoniaNitrogenMgPerLiter < 0.12 &&
    nitriteNitrogenMgPerLiter < 0.06
  ) {
    return 'commissioning'
  }

  if (
    maturity < 0.12 ||
    totalAmmoniaNitrogenMgPerLiter > 0.12 ||
    nitriteNitrogenMgPerLiter > 0.08
  ) {
    return 'cycling'
  }

  // The ugly phase is condition-driven. A maturing tank can skip this label if
  // nutrients, flow, light, and grazing keep nuisance coverage low.
  if (nuisanceCoverage > 0.18) {
    return 'ugly_phase'
  }

  if (maturity > 0.72 && waterQuality > 0.72 && nuisanceCoverage < 0.16) {
    return 'young_reef'
  }

  return 'stabilizing'
}

const appendEvent = (
  state: ReefSnapshot,
  lastEvent: string,
  causalNote: string,
): ReefSnapshot => ({
  ...state,
  namespace: ACTIVE_AQUARIUM_NAMESPACE,
  events: {
    ...state.events,
    sequence: state.events.sequence + 1,
    lastEvent,
    causalNote,
  },
})

/**
 * Samples local photosynthetic photon flux density at a water depth.
 * surfacePpfd is the fixture's full-power water-surface reference. The current
 * power fraction, interface transmission, Beer-Lambert attenuation, and local
 * shading are applied independently so every causal input remains tunable.
 */
export function sampleParAtDepth(
  state: ReefSnapshot,
  depthMeters: number,
  shading = state.lightField.shading,
): number {
  const boundedDepth = clamp(finiteOr(depthMeters, 0), 0, state.tank.heightMeters)
  const boundedShading = clamp(finiteOr(shading, state.lightField.shading), 0, 1)
  const power = clamp(finiteOr(state.equipment.lightPower, 0), 0, 1)
  const surfacePpfd = Math.max(0, finiteOr(state.lightField.surfacePpfd, 0))
  const transmission = clamp(finiteOr(state.lightField.interfaceTransmission, 0), 0, 1)
  const attenuation = Math.max(0, finiteOr(state.lightField.attenuationPerMeter, 0))

  return (
    surfacePpfd *
    power *
    transmission *
    Math.exp(-attenuation * boundedDepth) *
    (1 - boundedShading)
  )
}

const synchronizeLightField = (state: ReefSnapshot): ReefSnapshot => {
  const nuisanceShading =
    state.ecology.diatomCoverage * 0.09 +
    state.ecology.greenAlgaeCoverage * 0.16 +
    state.ecology.cyanobacteriaCoverage * 0.13
  const shading = clamp(BASE_REEF_SHADING + nuisanceShading, 0, 0.86)
  const attenuationPerMeter = clamp(
    BASE_ATTENUATION_PER_METER +
      state.events.feedPulse * 0.08 +
      state.ecology.greenAlgaeCoverage * 0.22,
    0.2,
    2.4,
  )
  const lightField = {
    ...state.lightField,
    attenuationPerMeter,
    shading,
  }
  const withOptics = { ...state, lightField }

  return {
    ...withOptics,
    lightField: {
      ...lightField,
      localPpfd: sampleParAtDepth(withOptics, lightField.sampleDepthMeters, shading),
    },
  }
}

export function createInitialReefState(): ReefSnapshot {
  const initialWaterMassKilograms =
    TARGET_WATER_VOLUME_LITERS * WATER_DENSITY_KG_PER_LITER
  const saltEquivalentMassKilograms =
    (INITIAL_SALT_MASS_FRACTION * initialWaterMassKilograms) /
    (1 - INITIAL_SALT_MASS_FRACTION)
  const chemistry = withDerivedConcentrations(TARGET_WATER_VOLUME_LITERS, {
    saltEquivalentMassKilograms,
    saltEquivalentGPerKg: 0,
    totalAmmoniaNitrogenMassMilligrams: 0.18 * TARGET_WATER_VOLUME_LITERS,
    nitriteNitrogenMassMilligrams: 0.035 * TARGET_WATER_VOLUME_LITERS,
    nitrateNitrogenMassMilligrams: 1.5 * TARGET_WATER_VOLUME_LITERS,
    phosphatePhosphorusMassMilligrams: 0.035 * TARGET_WATER_VOLUME_LITERS,
    totalAmmoniaNitrogenMgPerLiter: 0,
    nitriteNitrogenMgPerLiter: 0,
    nitrateNitrogenMgPerLiter: 0,
    phosphatePhosphorusMgPerLiter: 0,
    temperatureCelsius: 25.4,
    ph: 8.08,
    alkalinityDkh: 8.1,
  })
  const initial: ReefSnapshot = {
    namespace: ACTIVE_AQUARIUM_NAMESPACE,
    clock: clockFor(0, 1, false),
    tank: {
      nominalVolumeLiters: NOMINAL_VOLUME_LITERS,
      targetWaterVolumeLiters: TARGET_WATER_VOLUME_LITERS,
      waterVolumeLiters: TARGET_WATER_VOLUME_LITERS,
      waterLevelMeters: waterLevelFor(TARGET_WATER_VOLUME_LITERS),
      widthMeters: TANK_WIDTH_METERS,
      heightMeters: TANK_HEIGHT_METERS,
      depthMeters: TANK_DEPTH_METERS,
      evaporationLitersPerDay: EVAPORATION_LITERS_PER_DAY,
    },
    chemistry,
    equipment: {
      atoEnabled: true,
      atoReservoirLiters: ATO_RESERVOIR_CAPACITY_LITERS,
      atoSetpointLiters: ATO_SETPOINT_LITERS,
      atoPumpLitersPerHour: ATO_PUMP_LITERS_PER_HOUR,
      lightPower: 0.64,
      flowPower: 0.62,
    },
    ecology: {
      phase: 'commissioning',
      maturity: 0.015,
      diatomCoverage: 0.01,
      greenAlgaeCoverage: 0.004,
      cyanobacteriaCoverage: 0.002,
      microfaunaActivity: 0.025,
      polypExtension: 0,
    },
    livestock: FISHLESS_LIVESTOCK,
    lightField: {
      surfacePpfd: FULL_POWER_SURFACE_PPFD,
      localPpfd: 0,
      sampleDepthMeters: DEFAULT_PAR_SAMPLE_DEPTH_METERS,
      interfaceTransmission: AIR_WATER_INTERFACE_TRANSMISSION,
      attenuationPerMeter: BASE_ATTENUATION_PER_METER,
      shading: BASE_REEF_SHADING,
    },
    events: {
      sequence: 0,
      lastEvent: 'Fishless commissioning challenge added',
      causalNote: 'The initial TAN inventory is a declared fishless nitrogen challenge.',
      feedPulse: 0,
    },
  }

  return synchronizeLightField(initial)
}

const advanceOneStep = (
  state: ReefSnapshot,
  simulatedHours: number,
  flowEstimate: FlowScalarEstimate,
): ReefSnapshot => {
  const evaporationLiters = Math.min(
    state.tank.evaporationLitersPerDay * (simulatedHours / HOURS_PER_DAY),
    Math.max(0, state.tank.waterVolumeLiters - MIN_MODELED_WATER_VOLUME_LITERS),
  )
  let waterVolumeLiters = state.tank.waterVolumeLiters - evaporationLiters
  let atoReservoirLiters = state.equipment.atoReservoirLiters

  if (state.equipment.atoEnabled && waterVolumeLiters < state.equipment.atoSetpointLiters) {
    const atoAdditionLiters = Math.min(
      state.tank.targetWaterVolumeLiters - waterVolumeLiters,
      state.equipment.atoPumpLitersPerHour * simulatedHours,
      atoReservoirLiters,
    )
    waterVolumeLiters += Math.max(0, atoAdditionLiters)
    atoReservoirLiters -= Math.max(0, atoAdditionLiters)
  }

  waterVolumeLiters = clamp(
    waterVolumeLiters,
    MIN_MODELED_WATER_VOLUME_LITERS,
    state.tank.targetWaterVolumeLiters,
  )
  atoReservoirLiters = clamp(atoReservoirLiters, 0, ATO_RESERVOIR_CAPACITY_LITERS)

  // Evaporation and ATO alter water only. All solute changes below operate on
  // extensive masses before concentrations are derived from the new volume.
  const saltEquivalentMassKilograms = state.chemistry.saltEquivalentMassKilograms
  const feedPulseStart = state.events.feedPulse
  const feedPulseEnd = feedPulseStart * Math.pow(0.5, simulatedHours / FEED_PULSE_HALF_LIFE_HOURS)
  const meanFeedPulse = (feedPulseStart + feedPulseEnd) / 2

  const maturityBefore = state.ecology.maturity
  const nitrifierCapacity = clamp(0.12 + maturityBefore * 0.88, 0.12, 1)
  const temperatureFactor = clamp(1 - Math.abs(state.chemistry.temperatureCelsius - 25.5) / 12, 0.35, 1)
  const totalAmmoniaNitrogenProcessedMilligrams = processedAmount(
    state.chemistry.totalAmmoniaNitrogenMassMilligrams,
    AMMONIA_PROCESSING_PER_HOUR * nitrifierCapacity * temperatureFactor,
    simulatedHours,
  )
  const totalAmmoniaNitrogenMassMilligrams = Math.max(
    0,
    state.chemistry.totalAmmoniaNitrogenMassMilligrams -
      totalAmmoniaNitrogenProcessedMilligrams,
  )
  const nitriteBeforeProcessingMilligrams =
    state.chemistry.nitriteNitrogenMassMilligrams +
    totalAmmoniaNitrogenProcessedMilligrams
  const nitriteNitrogenProcessedMilligrams = processedAmount(
    nitriteBeforeProcessingMilligrams,
    NITRITE_PROCESSING_PER_HOUR * nitrifierCapacity * temperatureFactor,
    simulatedHours,
  )
  const nitriteNitrogenMassMilligrams = Math.max(
    0,
    nitriteBeforeProcessingMilligrams - nitriteNitrogenProcessedMilligrams,
  )

  const algaeUptakeFactor =
    state.ecology.diatomCoverage * 0.15 +
    state.ecology.greenAlgaeCoverage * 0.55 +
    state.ecology.cyanobacteriaCoverage * 0.2
  const exportCapacity =
    clamp((maturityBefore - 0.12) / 0.55, 0, 1) *
    (0.35 + algaeUptakeFactor)
  const nitrateBeforeExportMilligrams =
    state.chemistry.nitrateNitrogenMassMilligrams +
    nitriteNitrogenProcessedMilligrams
  const nitrateExportedMilligrams = processedAmount(
    nitrateBeforeExportMilligrams,
    NITRATE_EXPORT_PER_HOUR * exportCapacity,
    simulatedHours,
  )
  const nitrateNitrogenMassMilligrams = Math.max(
    0,
    nitrateBeforeExportMilligrams - nitrateExportedMilligrams,
  )
  const phosphateExportedMilligrams = processedAmount(
    state.chemistry.phosphatePhosphorusMassMilligrams,
    PHOSPHATE_EXPORT_PER_HOUR * exportCapacity,
    simulatedHours,
  )
  const phosphatePhosphorusMassMilligrams = Math.max(
    0,
    state.chemistry.phosphatePhosphorusMassMilligrams - phosphateExportedMilligrams,
  )
  const ledgerChemistry = withDerivedConcentrations(waterVolumeLiters, {
    ...state.chemistry,
    saltEquivalentMassKilograms,
    totalAmmoniaNitrogenMassMilligrams,
    nitriteNitrogenMassMilligrams,
    nitrateNitrogenMassMilligrams,
    phosphatePhosphorusMassMilligrams,
  })
  const totalAmmoniaNitrogenMgPerLiter =
    ledgerChemistry.totalAmmoniaNitrogenMgPerLiter
  const nitriteNitrogenMgPerLiter = ledgerChemistry.nitriteNitrogenMgPerLiter
  const nitrateNitrogenMgPerLiter = ledgerChemistry.nitrateNitrogenMgPerLiter
  const phosphatePhosphorusMgPerLiter =
    ledgerChemistry.phosphatePhosphorusMgPerLiter

  const toxicLoad = clamp(
    totalAmmoniaNitrogenMgPerLiter / 0.8 + nitriteNitrogenMgPerLiter / 0.5,
    0,
    1,
  )
  const nutrientLoad = clamp(
    nitrateNitrogenMgPerLiter / 30 + phosphatePhosphorusMgPerLiter / 0.3,
    0,
    1,
  )
  const saltEquivalentStress = clamp(
    Math.abs(ledgerChemistry.saltEquivalentGPerKg - INITIAL_SALT_EQUIVALENT_G_PER_KG) / 8,
    0,
    1,
  )
  const waterQuality = clamp(
    1 - toxicLoad * 0.6 - nutrientLoad * 0.2 - saltEquivalentStress * 0.35,
    0,
    1,
  )
  const maturity = clamp(
    maturityBefore +
      (simulatedHours / (HOURS_PER_DAY * MATURITY_DAYS)) * (0.25 + waterQuality * 0.75),
    0,
    1,
  )

  const timeAfterStep = state.clock.elapsedHours + simulatedHours
  const timeOfDayHours = timeAfterStep % HOURS_PER_DAY
  const lightIsOn = timeOfDayHours >= 8 && timeOfDayHours <= 20
  const effectiveLight = state.equipment.lightPower * (lightIsOn ? 1 : 0.08)
  const flowPower = clamp(state.equipment.flowPower, 0, 1)
  const earlyMaturityWindow = clamp(1 - Math.abs(maturity - 0.2) / 0.28, 0, 1)
  const diatomTarget = clamp(
    earlyMaturityWindow * (0.28 + nutrientLoad * 0.38) * (0.35 + effectiveLight * 0.65) -
      state.ecology.microfaunaActivity * 0.14,
    0,
    0.88,
  )
  const greenAlgaeTarget = clamp(
    clamp(
      (nitrateNitrogenMgPerLiter - 1) / 18 +
        phosphatePhosphorusMgPerLiter / 0.22,
      0,
      1,
    ) *
      (0.2 + effectiveLight * 0.8) *
      (0.35 + maturity * 0.65) -
      state.ecology.microfaunaActivity * 0.22,
    0,
    0.9,
  )
  const cyanobacteriaTarget = clamp(
    (phosphatePhosphorusMgPerLiter / 0.16 + meanFeedPulse * 0.28) *
      (0.25 + effectiveLight * 0.75) *
      (MINIMUM_CYANO_FLOW_PRESSURE + flowEstimate.lowFlowFraction) *
      (0.45 + nutrientLoad * 0.55),
    0,
    0.86,
  )
  const diatomCoverage = clamp(
    relax(state.ecology.diatomCoverage, diatomTarget, 0.016, simulatedHours),
    0,
    1,
  )
  const greenAlgaeCoverage = clamp(
    relax(state.ecology.greenAlgaeCoverage, greenAlgaeTarget, 0.012, simulatedHours),
    0,
    1,
  )
  const cyanobacteriaCoverage = clamp(
    relax(state.ecology.cyanobacteriaCoverage, cyanobacteriaTarget, 0.014, simulatedHours),
    0,
    1,
  )

  const microfaunaTarget = clamp(
    maturity *
      (0.42 + meanFeedPulse * 0.32 + diatomCoverage * 0.18) *
      (1 - toxicLoad * 0.82) *
      (0.55 + flowPower * 0.45),
    0,
    1,
  )
  const microfaunaActivity = clamp(
    relax(state.ecology.microfaunaActivity, microfaunaTarget, 0.025, simulatedHours),
    0,
    1,
  )
  const hasFish = state.livestock.clownfishCount + state.livestock.smallReefFishCount > 0
  const hasCoral = state.livestock.coralHealth > 0
  const fishSatiation = hasFish
    ? clamp(state.livestock.fishSatiation * Math.pow(0.5, simulatedHours / 18), 0, 1)
    : 0
  const temperatureTarget =
    TARGET_TEMPERATURE_CELSIUS + state.equipment.lightPower * 0.2 - (1 - flowPower) * 0.12
  const temperatureCelsius = clamp(
    relax(state.chemistry.temperatureCelsius, temperatureTarget, 0.14, simulatedHours),
    20,
    32,
  )
  const fishStressTarget = clamp(
    toxicLoad * 0.58 +
      saltEquivalentStress * 0.46 +
      Math.abs(temperatureCelsius - TARGET_TEMPERATURE_CELSIUS) / 7 +
      cyanobacteriaCoverage * 0.16 +
      Math.max(0, 0.2 - fishSatiation) * 0.55,
    0,
    1,
  )
  const fishStress = hasFish
    ? clamp(relax(state.livestock.fishStress, fishStressTarget, 0.09, simulatedHours), 0, 1)
    : 0

  const alkalinityTarget = clamp(
    TARGET_ALKALINITY_DKH - toxicLoad * 0.45 - meanFeedPulse * 0.1,
    5.5,
    11,
  )
  const alkalinityDkh = clamp(
    relax(state.chemistry.alkalinityDkh, alkalinityTarget, 0.004, simulatedHours),
    5,
    14,
  )
  const diurnalPhOffset = Math.sin(((timeOfDayHours - 11) / HOURS_PER_DAY) * Math.PI * 2) *
    0.07 *
    state.equipment.lightPower
  const phTarget = clamp(
    TARGET_PH +
      diurnalPhOffset +
      (alkalinityDkh - TARGET_ALKALINITY_DKH) * 0.035 -
      toxicLoad * 0.18 -
      meanFeedPulse * 0.035,
    7.65,
    8.45,
  )
  const ph = clamp(relax(state.chemistry.ph, phTarget, 0.075, simulatedHours), 7.5, 8.55)

  const provisional: ReefSnapshot = {
    ...state,
    namespace: ACTIVE_AQUARIUM_NAMESPACE,
    clock: clockFor(timeAfterStep, state.clock.speed, state.clock.paused),
    tank: {
      ...state.tank,
      waterVolumeLiters,
      waterLevelMeters: waterLevelFor(waterVolumeLiters),
    },
    chemistry: withDerivedConcentrations(waterVolumeLiters, {
      ...ledgerChemistry,
      temperatureCelsius,
      ph,
      alkalinityDkh,
    }),
    equipment: {
      ...state.equipment,
      atoReservoirLiters,
    },
    ecology: {
      ...state.ecology,
      maturity,
      diatomCoverage,
      greenAlgaeCoverage,
      cyanobacteriaCoverage,
      microfaunaActivity,
    },
    livestock: {
      ...state.livestock,
      fishSatiation,
      fishStress,
    },
    events: {
      ...state.events,
      feedPulse: clamp(feedPulseEnd, 0, 1.5),
    },
  }
  const withLight = synchronizeLightField(provisional)
  const localPpfd = withLight.lightField.localPpfd
  const usefulLight = clamp(localPpfd / 150, 0, 1) * clamp((620 - localPpfd) / 220, 0, 1)
  const coralQuality = clamp(
    waterQuality * 0.55 + usefulLight * 0.25 + (1 - fishStress) * 0.2,
    0,
    1,
  )
  const coralHealthTarget = clamp(
    0.12 +
      coralQuality * 0.86 -
      cyanobacteriaCoverage * 0.28 -
      saltEquivalentStress * 0.34,
    0,
    1,
  )
  const coralHealth = hasCoral
    ? clamp(
        relax(state.livestock.coralHealth, coralHealthTarget, 0.018, simulatedHours),
        0,
        1,
      )
    : 0
  const nightExtension = lightIsOn ? 0 : 0.12
  const moderateFlowSuitability = clamp(
    1 -
      Math.abs(
        flowEstimate.meanSpeedMetersPerSecond - POLYP_OPTIMAL_FLOW_METERS_PER_SECOND,
      ) /
        POLYP_FLOW_HALF_WIDTH_METERS_PER_SECOND,
    0,
    1,
  )
  const excessiveShearPenalty = clamp(
    (flowEstimate.meanShearPerSecond - EXCESSIVE_SHEAR_START_PER_SECOND) /
      EXCESSIVE_SHEAR_RANGE_PER_SECOND,
    0,
    1,
  )
  const flowSuitability = moderateFlowSuitability * (1 - excessiveShearPenalty * 0.8)
  const polypTarget = clamp(
    coralHealth *
      (0.25 + usefulLight * 0.38 + flowSuitability * 0.25 + nightExtension) *
      (1 - fishStress * 0.45) *
      (1 - cyanobacteriaCoverage * 0.55),
    0,
    1,
  )
  const polypExtension = hasCoral
    ? clamp(relax(state.ecology.polypExtension, polypTarget, 0.13, simulatedHours), 0, 1)
    : 0
  const nuisanceCoverage = Math.max(
    diatomCoverage,
    greenAlgaeCoverage,
    cyanobacteriaCoverage,
  )
  const phase = lifecyclePhaseFor(
    maturity,
    totalAmmoniaNitrogenMgPerLiter,
    nitriteNitrogenMgPerLiter,
    nuisanceCoverage,
    waterQuality,
  )
  const fishlessPhase =
    phase === 'commissioning' || phase === 'cycling' || phase === 'ugly_phase'

  return {
    ...withLight,
    namespace: ACTIVE_AQUARIUM_NAMESPACE,
    ecology: {
      ...withLight.ecology,
      phase,
      polypExtension: fishlessPhase ? 0 : polypExtension,
    },
    livestock: fishlessPhase
      ? FISHLESS_LIVESTOCK
      : { ...withLight.livestock, coralHealth },
  }
}

export function advanceReefState(
  state: ReefSnapshot,
  elapsedRealSeconds: number,
): ReefSnapshot {
  if (state.clock.paused) {
    return state
  }

  const realSeconds = Math.max(0, finiteOr(elapsedRealSeconds, 0))
  const simulatedHours = realSeconds * clamp(state.clock.speed, MIN_SPEED, MAX_SPEED)
  if (simulatedHours === 0) {
    return state
  }

  const stepCount = clamp(
    Math.ceil(simulatedHours / MAX_SIMULATION_STEP_HOURS),
    1,
    MAX_INTEGRATION_STEPS,
  )
  const stepHours = simulatedHours / stepCount
  const flowEstimate = estimateCanonicalFlowRegime(state.equipment.flowPower)
  let next = state
  for (let index = 0; index < stepCount; index += 1) {
    next = advanceOneStep(next, stepHours, flowEstimate)
  }

  const atoAddedLiters = Math.max(
    0,
    state.equipment.atoReservoirLiters - next.equipment.atoReservoirLiters,
  )
  const phaseChanged = next.ecology.phase !== state.ecology.phase
  if (atoAddedLiters >= 0.01) {
    return appendEvent(
      next,
      `ATO added ${atoAddedLiters.toFixed(2)} L`,
      'Fresh RO/DI water restored volume without changing salt-equivalent mass.',
    )
  }
  if (phaseChanged) {
    return appendEvent(
      next,
      `Lifecycle shifted to ${next.ecology.phase.replace('_', ' ')}`,
      'Observed chemistry, maturity, and nuisance coverage changed the lifecycle label.',
    )
  }

  return next
}

const ecologyPreview = (
  phase: LifecyclePhase,
  current: ReefSnapshot['ecology'],
): ReefSnapshot['ecology'] => {
  const values =
    phase === 'commissioning'
      ? [0.015, 0.01, 0.004, 0.002, 0.025, 0]
      : phase === 'cycling'
        ? [0.1, 0.08, 0.02, 0.01, 0.14, 0]
        : phase === 'ugly_phase'
          ? [0.28, 0.48, 0.31, 0.2, 0.38, 0]
          : phase === 'stabilizing'
            ? [0.55, 0.14, 0.11, 0.055, 0.66, 0.7]
            : [0.82, 0.045, 0.07, 0.02, 0.84, 0.86]

  return {
    ...current,
    phase,
    maturity: values[0],
    diatomCoverage: values[1],
    greenAlgaeCoverage: values[2],
    cyanobacteriaCoverage: values[3],
    microfaunaActivity: values[4],
    polypExtension: values[5],
  }
}

export function applyReefAction(state: ReefSnapshot, action: ReefAction): ReefSnapshot {
  switch (action.type) {
    case 'set_speed': {
      const speed = clamp(finiteOr(action.speed, state.clock.speed), MIN_SPEED, MAX_SPEED)
      return appendEvent(
        {
          ...state,
          namespace: ACTIVE_AQUARIUM_NAMESPACE,
          clock: { ...state.clock, speed },
        },
        `Simulation speed set to ${speed.toFixed(2)} h/s`,
        'Real elapsed seconds now advance the reef clock at the selected rate.',
      )
    }
    case 'toggle_pause': {
      const paused = !state.clock.paused
      return appendEvent(
        {
          ...state,
          namespace: ACTIVE_AQUARIUM_NAMESPACE,
          clock: { ...state.clock, paused },
        },
        paused ? 'Simulation paused' : 'Simulation resumed',
        paused ? 'Biological and physical updates are halted.' : 'Causal updates are active again.',
      )
    }
    case 'feed': {
      const amountGrams = clamp(finiteOr(action.amountGrams, 0), 0, 5)
      const hasFish = state.livestock.clownfishCount + state.livestock.smallReefFishCount > 0
      if (!hasFish || amountGrams === 0) {
        return appendEvent(
          state,
          'Feeding skipped',
          hasFish
            ? 'No feed entered the modeled water column.'
            : 'No fish are present, so no feed or nutrient mass entered the system.',
        )
      }

      const nitrogenAddedMilligrams =
        amountGrams * FEED_WATER_COLUMN_NITROGEN_MG_PER_GRAM
      const phosphorusAddedMilligrams =
        amountGrams * FEED_WATER_COLUMN_PHOSPHORUS_MG_PER_GRAM
      const fed = {
        ...state,
        namespace: ACTIVE_AQUARIUM_NAMESPACE,
        chemistry: withDerivedConcentrations(state.tank.waterVolumeLiters, {
          ...state.chemistry,
          totalAmmoniaNitrogenMassMilligrams:
            state.chemistry.totalAmmoniaNitrogenMassMilligrams +
            nitrogenAddedMilligrams,
          phosphatePhosphorusMassMilligrams:
            state.chemistry.phosphatePhosphorusMassMilligrams +
            phosphorusAddedMilligrams,
        }),
        livestock: {
          ...state.livestock,
          fishSatiation: clamp(state.livestock.fishSatiation + amountGrams * 0.22, 0, 1),
        },
        events: {
          ...state.events,
          feedPulse: clamp(state.events.feedPulse + amountGrams * 0.65, 0, 1.5),
        },
      }
      return appendEvent(
        fed,
        `Fed ${amountGrams.toFixed(2)} g`,
        `${nitrogenAddedMilligrams.toFixed(1)} mg N and ${phosphorusAddedMilligrams.toFixed(1)} mg P entered the extensive ledgers.`,
      )
    }
    case 'set_light': {
      const lightPower = clamp(finiteOr(action.power, state.equipment.lightPower), 0, 1)
      const relit = synchronizeLightField({
        ...state,
        namespace: ACTIVE_AQUARIUM_NAMESPACE,
        equipment: { ...state.equipment, lightPower },
      })
      return appendEvent(
        relit,
        `Light power set to ${Math.round(lightPower * 100)}%`,
        'Local PPFD changed through fixture power and the existing optical field.',
      )
    }
    case 'set_flow': {
      const flowPower = clamp(finiteOr(action.power, state.equipment.flowPower), 0, 1)
      return appendEvent(
        {
          ...state,
          namespace: ACTIVE_AQUARIUM_NAMESPACE,
          equipment: { ...state.equipment, flowPower },
        },
        `Flow power set to ${Math.round(flowPower * 100)}%`,
        'Flow now alters cyano pressure, mixing, microfauna activity, and polyp response.',
      )
    }
    case 'toggle_ato': {
      const atoEnabled = !state.equipment.atoEnabled
      return appendEvent(
        {
          ...state,
          namespace: ACTIVE_AQUARIUM_NAMESPACE,
          equipment: { ...state.equipment, atoEnabled },
        },
        atoEnabled ? 'ATO enabled' : 'ATO disabled',
        atoEnabled
          ? 'The finite reservoir can add only fresh water below the setpoint.'
          : 'Evaporation can now lower volume and concentrate conserved salt-equivalent mass.',
      )
    }
    case 'refill_ato':
      return appendEvent(
        {
          ...state,
          namespace: ACTIVE_AQUARIUM_NAMESPACE,
          equipment: {
            ...state.equipment,
            atoReservoirLiters: ATO_RESERVOIR_CAPACITY_LITERS,
          },
        },
        'ATO reservoir refilled',
        'Fresh RO/DI reserve was restored without entering the display tank yet.',
      )
    case 'reset': {
      const reset = createInitialReefState()
      return {
        ...reset,
        namespace: ACTIVE_AQUARIUM_NAMESPACE,
        events: {
          ...reset.events,
          sequence: state.events.sequence + 1,
          lastEvent: 'Reef simulation reset',
          causalNote: 'All tunable demo state returned to the marine reef baseline.',
        },
      }
    }
    case 'set_phase_preview': {
      const stocked = action.phase === 'stabilizing' || action.phase === 'young_reef'
      const [elapsedHours, tanMgPerLiter, nitriteMgPerLiter, nitrateMgPerLiter, phosphateMgPerLiter] =
        action.phase === 'commissioning'
          ? [24, 0.04, 0.02, 0.25, 0.012]
          : action.phase === 'cycling'
            ? [240, 0.18, 0.12, 3, 0.035]
            : action.phase === 'ugly_phase'
              ? [960, 0.02, 0.015, 8, 0.09]
              : action.phase === 'stabilizing'
                ? [2160, 0.01, 0.01, 5, 0.04]
                : [4320, 0.005, 0.005, 2.5, 0.025]
      const waterVolumeLiters = state.tank.waterVolumeLiters
      const waterMassKilograms = waterVolumeLiters * WATER_DENSITY_KG_PER_LITER
      const saltEquivalentMassKilograms =
        (INITIAL_SALT_MASS_FRACTION * waterMassKilograms) /
        (1 - INITIAL_SALT_MASS_FRACTION)
      const preview = synchronizeLightField({
        ...state,
        namespace: ACTIVE_AQUARIUM_NAMESPACE,
        clock: clockFor(elapsedHours, state.clock.speed, state.clock.paused),
        chemistry: withDerivedConcentrations(waterVolumeLiters, {
          ...state.chemistry,
          saltEquivalentMassKilograms,
          totalAmmoniaNitrogenMassMilligrams: tanMgPerLiter * waterVolumeLiters,
          nitriteNitrogenMassMilligrams: nitriteMgPerLiter * waterVolumeLiters,
          nitrateNitrogenMassMilligrams: nitrateMgPerLiter * waterVolumeLiters,
          phosphatePhosphorusMassMilligrams: phosphateMgPerLiter * waterVolumeLiters,
        }),
        ecology: ecologyPreview(action.phase, state.ecology),
        livestock: stocked
          ? {
              clownfishCount: 2,
              smallReefFishCount: 3,
              fishSatiation: 0.68,
              fishStress: 0.12,
              coralHealth: action.phase === 'young_reef' ? 0.9 : 0.78,
            }
          : FISHLESS_LIVESTOCK,
        events: { ...state.events, feedPulse: 0 },
      })
      return appendEvent(
        preview,
        `Loaded representative ${action.phase.replace('_', ' ')} preview`,
        'This explicit demo-state replacement loaded a representative clock, chemistry, ecology, and stock profile. It was not a physical water operation.',
      )
    }
  }
}
