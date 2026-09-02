import { describe, expect, it } from 'vitest'

import { ACTIVE_AQUARIUM_NAMESPACE, type LifecyclePhase, type ReefAction, type ReefSnapshot } from '../contracts'
import {
  advanceReefState,
  applyReefAction,
  createInitialReefState,
  sampleParAtDepth,
} from './reefSimulation'

const nitrogenMass = (state: ReefSnapshot) =>
  state.chemistry.totalAmmoniaNitrogenMassMilligrams +
  state.chemistry.nitriteNitrogenMassMilligrams +
  state.chemistry.nitrateNitrogenMassMilligrams

const extensiveMasses = (state: ReefSnapshot) => ({
  salt: state.chemistry.saltEquivalentMassKilograms,
  tan: state.chemistry.totalAmmoniaNitrogenMassMilligrams,
  nitrite: state.chemistry.nitriteNitrogenMassMilligrams,
  nitrate: state.chemistry.nitrateNitrogenMassMilligrams,
  phosphate: state.chemistry.phosphatePhosphorusMassMilligrams,
})

const retainedSoluteState = (): ReefSnapshot => {
  const initial = createInitialReefState()
  return {
    ...initial,
    chemistry: {
      ...initial.chemistry,
      totalAmmoniaNitrogenMassMilligrams: 0,
      nitriteNitrogenMassMilligrams: 0,
      totalAmmoniaNitrogenMgPerLiter: 0,
      nitriteNitrogenMgPerLiter: 0,
    },
  }
}

describe('repaired reef simulation', () => {
  it('starts as a finite fishless marine commissioning system with S_eq in g/kg', () => {
    const initial = createInitialReefState()

    expect({
      namespace: initial.namespace,
      elapsedHours: initial.clock.elapsedHours,
      day: initial.clock.day,
      speed: initial.clock.speed,
      paused: initial.clock.paused,
      nominalVolumeLiters: initial.tank.nominalVolumeLiters,
      targetWaterVolumeLiters: initial.tank.targetWaterVolumeLiters,
      waterVolumeLiters: initial.tank.waterVolumeLiters,
      phase: initial.ecology.phase,
      clownfish: initial.livestock.clownfishCount,
      reefFish: initial.livestock.smallReefFishCount,
      coralHealth: initial.livestock.coralHealth,
      polypExtension: initial.ecology.polypExtension,
    }).toEqual({
      namespace: 'marine_reef',
      elapsedHours: 0,
      day: 1,
      speed: 1,
      paused: false,
      nominalVolumeLiters: 284,
      targetWaterVolumeLiters: 246,
      waterVolumeLiters: 246,
      phase: 'commissioning',
      clownfish: 0,
      reefFish: 0,
      coralHealth: 0,
      polypExtension: 0,
    })
    expect(initial.chemistry.saltEquivalentGPerKg).toBeCloseTo(35, 12)
    expect(initial.chemistry).not.toHaveProperty(['specific', 'Gravity'].join(''))
    expect(initial.chemistry).not.toHaveProperty(['salinity', 'Ppt'].join(''))
    expect(Object.values(initial.chemistry).every(Number.isFinite)).toBe(true)

    const actions: ReefAction[] = [
      { type: 'set_speed', speed: 48 },
      { type: 'toggle_pause' },
      { type: 'feed', amountGrams: 0.4 },
      { type: 'set_light', power: 0.25 },
      { type: 'set_flow', power: 0.9 },
      { type: 'toggle_ato' },
      { type: 'refill_ato' },
      { type: 'set_phase_preview', phase: 'young_reef' },
      { type: 'reset' },
    ]
    for (const action of actions) {
      expect(applyReefAction(initial, action).namespace).toBe(ACTIVE_AQUARIUM_NAMESPACE)
    }
    const invalidInput = { ...initial, namespace: 'freshwater' } as unknown as ReefSnapshot
    expect(advanceReefState(invalidInput, 1).namespace).toBe(ACTIVE_AQUARIUM_NAMESPACE)
    expect(initial.events.sequence).toBe(0)
    expect(initial.namespace).toBe('marine_reef')
  })

  it('evaporates water while preserving retained extensive masses and raising concentrations', () => {
    const initial = retainedSoluteState()
    const atoOff = applyReefAction(initial, { type: 'toggle_ato' })
    const afterOneDay = advanceReefState(atoOff, 24)

    expect(afterOneDay.tank.waterVolumeLiters).toBeCloseTo(243, 8)
    expect(extensiveMasses(afterOneDay)).toEqual(extensiveMasses(initial))
    expect(afterOneDay.chemistry.saltEquivalentGPerKg).toBeGreaterThan(
      initial.chemistry.saltEquivalentGPerKg,
    )
    expect(afterOneDay.chemistry.nitrateNitrogenMgPerLiter).toBeGreaterThan(
      initial.chemistry.nitrateNitrogenMgPerLiter,
    )
    expect(afterOneDay.chemistry.phosphatePhosphorusMgPerLiter).toBeGreaterThan(
      initial.chemistry.phosphatePhosphorusMgPerLiter,
    )
  })

  it('uses a finite freshwater ATO without changing solute masses or overshooting target', () => {
    const initial = retainedSoluteState()
    const dry = advanceReefState(applyReefAction(initial, { type: 'toggle_ato' }), 48)
    const finiteReservoir: ReefSnapshot = {
      ...dry,
      equipment: { ...dry.equipment, atoEnabled: true, atoReservoirLiters: 0.5 },
    }
    const recovered = advanceReefState(finiteReservoir, 1)

    expect(recovered.tank.waterVolumeLiters).toBeCloseTo(
      dry.tank.waterVolumeLiters + 0.5 - dry.tank.evaporationLitersPerDay / 24,
      8,
    )
    expect(recovered.tank.waterVolumeLiters).toBeGreaterThan(dry.tank.waterVolumeLiters)
    expect(recovered.tank.waterVolumeLiters).toBeLessThanOrEqual(
      recovered.tank.targetWaterVolumeLiters,
    )
    expect(recovered.equipment.atoReservoirLiters).toBe(0)
    expect(extensiveMasses(recovered)).toEqual(extensiveMasses(dry))
    expect(recovered.chemistry.saltEquivalentGPerKg).toBeLessThan(
      dry.chemistry.saltEquivalentGPerKg,
    )
    expect(recovered.chemistry.nitrateNitrogenMgPerLiter).toBeLessThan(
      dry.chemistry.nitrateNitrogenMgPerLiter,
    )
    expect(recovered.chemistry.phosphatePhosphorusMgPerLiter).toBeLessThan(
      dry.chemistry.phosphatePhosphorusMgPerLiter,
    )
    expect(recovered.chemistry.saltEquivalentGPerKg).toBeGreaterThan(
      initial.chemistry.saltEquivalentGPerKg,
    )
  })

  it('transfers TAN through nitrite to nitrate on an extensive mg N ledger', () => {
    const initial = createInitialReefState()
    const afterOneHour = advanceReefState(initial, 1)
    const afterTwoDays = advanceReefState(initial, 48)

    expect(afterOneHour.chemistry.totalAmmoniaNitrogenMassMilligrams).toBeLessThan(
      initial.chemistry.totalAmmoniaNitrogenMassMilligrams,
    )
    expect(afterOneHour.chemistry.nitriteNitrogenMassMilligrams).toBeGreaterThan(
      initial.chemistry.nitriteNitrogenMassMilligrams,
    )
    expect(afterTwoDays.chemistry.nitrateNitrogenMassMilligrams).toBeGreaterThan(
      initial.chemistry.nitrateNitrogenMassMilligrams,
    )
    expect(nitrogenMass(afterOneHour)).toBeCloseTo(nitrogenMass(initial), 10)
    expect(nitrogenMass(afterTwoDays)).toBeCloseTo(nitrogenMass(initial), 10)
    expect(afterTwoDays.chemistry.phosphatePhosphorusMassMilligrams).toBeCloseTo(
      initial.chemistry.phosphatePhosphorusMassMilligrams,
      10,
    )
  })

  it('skips fishless feed and adds declared mg N and mg P only to stocked reefs', () => {
    const initial = createInitialReefState()
    const skipped = applyReefAction(initial, { type: 'feed', amountGrams: 0.4 })
    const young = applyReefAction(initial, { type: 'set_phase_preview', phase: 'young_reef' })
    const fed = applyReefAction(young, { type: 'feed', amountGrams: 0.4 })
    const processed = advanceReefState(fed, 6)

    expect(extensiveMasses(skipped)).toEqual(extensiveMasses(initial))
    expect(skipped.events.lastEvent).toBe('Feeding skipped')
    expect(skipped.events.causalNote).toContain('no feed or nutrient mass')
    expect(fed.chemistry.totalAmmoniaNitrogenMassMilligrams).toBeCloseTo(
      young.chemistry.totalAmmoniaNitrogenMassMilligrams + 7.2,
      10,
    )
    expect(fed.chemistry.phosphatePhosphorusMassMilligrams).toBeCloseTo(
      young.chemistry.phosphatePhosphorusMassMilligrams + 1.4,
      10,
    )
    expect(fed.events.lastEvent).toBe('Fed 0.40 g')
    expect(fed.events.causalNote).toBe(
      '7.2 mg N and 1.4 mg P entered the extensive ledgers.',
    )
    expect(nitrogenMass(processed)).toBeLessThanOrEqual(nitrogenMass(fed))
    expect(processed.chemistry.phosphatePhosphorusMassMilligrams).toBeLessThanOrEqual(
      fed.chemistry.phosphatePhosphorusMassMilligrams,
    )
  })

  it('keeps every representative phase preview stable across normal running ticks', () => {
    const pausedInitial = applyReefAction(createInitialReefState(), { type: 'toggle_pause' })
    const fishlessPhases: LifecyclePhase[] = ['commissioning', 'cycling', 'ugly_phase']
    const stockedPhases: LifecyclePhase[] = ['stabilizing', 'young_reef']

    for (const phase of [...fishlessPhases, ...stockedPhases]) {
      const preview = applyReefAction(pausedInitial, { type: 'set_phase_preview', phase })
      expect(preview.clock.elapsedHours).toBeGreaterThan(0)
      expect(preview.events.lastEvent).toContain('representative')
      expect(preview.events.causalNote).toContain('not a physical water operation')

      let running = preview.clock.paused
        ? applyReefAction(preview, { type: 'toggle_pause' })
        : preview
      for (let tick = 0; tick < 12; tick += 1) {
        running = advanceReefState(running, 0.25)
        expect(running.ecology.phase).toBe(phase)
      }

      if (fishlessPhases.includes(phase)) {
        expect(running.livestock.clownfishCount).toBe(0)
        expect(running.livestock.smallReefFishCount).toBe(0)
        expect(running.livestock.coralHealth).toBe(0)
        expect(running.ecology.polypExtension).toBe(0)
      } else {
        expect(running.livestock.clownfishCount).toBe(2)
        expect(running.livestock.smallReefFishCount).toBe(3)
        expect(running.livestock.coralHealth).toBeGreaterThan(0)
        expect(running.livestock.coralHealth).toBeLessThanOrEqual(1)
        expect(running.ecology.polypExtension).toBeGreaterThan(0)
        expect(running.ecology.polypExtension).toBeLessThanOrEqual(1)
      }
    }
  })

  it('strips livestock from an inconsistent stocked cycling snapshot on advance', () => {
    const cycling = applyReefAction(createInitialReefState(), {
      type: 'set_phase_preview',
      phase: 'cycling',
    })
    const inconsistent: ReefSnapshot = {
      ...cycling,
      ecology: { ...cycling.ecology, polypExtension: 0.7 },
      livestock: {
        clownfishCount: 2,
        smallReefFishCount: 3,
        fishSatiation: 0.8,
        fishStress: 0.1,
        coralHealth: 0.8,
      },
    }
    const repaired = advanceReefState(inconsistent, 0.25)

    expect(repaired.ecology.phase).toBe('cycling')
    expect(repaired.ecology.polypExtension).toBe(0)
    expect(repaired.livestock).toEqual({
      clownfishCount: 0,
      smallReefFishCount: 0,
      fishSatiation: 0,
      fishStress: 0,
      coralHealth: 0,
    })
  })

  it('makes local PPFD finite and responsive to depth, shading, power, and transmission', () => {
    const initial = createInitialReefState()
    const dim = applyReefAction(initial, { type: 'set_light', power: 0.2 })
    const bright = applyReefAction(initial, { type: 'set_light', power: 0.9 })
    const lowTransmission: ReefSnapshot = {
      ...initial,
      lightField: { ...initial.lightField, interfaceTransmission: 0.6 },
    }
    const samples = [
      sampleParAtDepth(initial, 0.05, 0.15),
      sampleParAtDepth(initial, 0.45, 0.15),
      sampleParAtDepth(initial, 0.05, 0.7),
      sampleParAtDepth(dim, 0.2, 0.15),
      sampleParAtDepth(bright, 0.2, 0.15),
      sampleParAtDepth(lowTransmission, 0.2, 0.15),
    ]

    expect(samples.every(Number.isFinite)).toBe(true)
    expect(samples[1]).toBeLessThan(samples[0])
    expect(samples[2]).toBeLessThan(samples[0])
    expect(samples[3]).toBeLessThan(samples[4])
    expect(samples[5]).toBeLessThan(sampleParAtDepth(initial, 0.2, 0.15))
  })

  it('uses aggregate flow estimates for a moderate polyp optimum and low-flow cyano pressure', () => {
    const young = applyReefAction(createInitialReefState(), {
      type: 'set_phase_preview',
      phase: 'young_reef',
    })
    const advanceAtFlow = (power: number) =>
      advanceReefState(applyReefAction(young, { type: 'set_flow', power }), 24)
    const low = advanceAtFlow(0)
    const moderate = advanceAtFlow(0.62)
    const high = advanceAtFlow(1)

    expect(moderate.ecology.polypExtension).toBeGreaterThan(low.ecology.polypExtension)
    expect(moderate.ecology.polypExtension).toBeGreaterThan(high.ecology.polypExtension)
    expect(low.ecology.cyanobacteriaCoverage).toBeGreaterThan(
      moderate.ecology.cyanobacteriaCoverage,
    )
    expect(moderate.ecology.cyanobacteriaCoverage).toBeGreaterThan(
      high.ecology.cyanobacteriaCoverage,
    )
  })

  it('keeps volume, mass ledgers, concentrations, fractions, and PPFD bounded for a year', () => {
    let state = applyReefAction(createInitialReefState(), {
      type: 'set_phase_preview',
      phase: 'young_reef',
    })
    state = applyReefAction(state, { type: 'set_speed', speed: 48 })
    state = applyReefAction(state, { type: 'feed', amountGrams: 5 })
    state = applyReefAction(state, { type: 'set_light', power: 1 })
    state = applyReefAction(state, { type: 'set_flow', power: 0 })
    const afterOneYear = advanceReefState(state, (365 * 24) / 48)
    const fractions = [
      afterOneYear.equipment.lightPower,
      afterOneYear.equipment.flowPower,
      afterOneYear.ecology.maturity,
      afterOneYear.ecology.diatomCoverage,
      afterOneYear.ecology.greenAlgaeCoverage,
      afterOneYear.ecology.cyanobacteriaCoverage,
      afterOneYear.ecology.microfaunaActivity,
      afterOneYear.ecology.polypExtension,
      afterOneYear.livestock.fishSatiation,
      afterOneYear.livestock.fishStress,
      afterOneYear.livestock.coralHealth,
      afterOneYear.lightField.interfaceTransmission,
      afterOneYear.lightField.shading,
    ]
    const numericValues = [
      ...Object.values(afterOneYear.clock).filter((value): value is number => typeof value === 'number'),
      ...Object.values(afterOneYear.tank),
      ...Object.values(afterOneYear.chemistry),
      ...Object.values(afterOneYear.equipment).filter(
        (value): value is number => typeof value === 'number',
      ),
      ...Object.values(afterOneYear.ecology).filter(
        (value): value is number => typeof value === 'number',
      ),
      ...Object.values(afterOneYear.livestock),
      ...Object.values(afterOneYear.lightField),
      afterOneYear.events.sequence,
      afterOneYear.events.feedPulse,
    ]

    expect(afterOneYear.namespace).toBe('marine_reef')
    expect(numericValues.every(Number.isFinite)).toBe(true)
    expect(Object.values(extensiveMasses(afterOneYear)).every((value) => value >= 0)).toBe(true)
    expect(fractions.every((value) => value >= 0 && value <= 1)).toBe(true)
    expect(afterOneYear.events.feedPulse).toBeGreaterThanOrEqual(0)
    expect(afterOneYear.events.feedPulse).toBeLessThanOrEqual(1.5)
    expect(afterOneYear.tank.waterVolumeLiters).toBeGreaterThanOrEqual(100)
    expect(afterOneYear.tank.waterVolumeLiters).toBeLessThanOrEqual(
      afterOneYear.tank.targetWaterVolumeLiters,
    )
    expect(afterOneYear.lightField.localPpfd).toBeGreaterThanOrEqual(0)
    expect(afterOneYear.lightField.localPpfd).toBeLessThanOrEqual(
      afterOneYear.lightField.surfacePpfd,
    )
  })
})
