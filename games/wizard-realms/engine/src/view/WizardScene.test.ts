import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { WizardViewProjection } from './contracts'
import { avatarGearFor, cameraFramingFor, storeSafeCameraPosition } from './WizardScene'

const stack = (itemId: string) => ({ id: `inventory-${itemId}`, itemId, name: itemId, quantity: 1 })
const equipment = (overrides: Partial<WizardViewProjection['equipment']> = {}): WizardViewProjection['equipment'] =>
  ({ head: null, chest: null, legs: null, feet: null, mainHand: null, offHand: null, ...overrides })

describe('avatar gear projection', () => {
  it('shows no hat, staff, axe, or shield on the bare starting wizard', () => {
    expect(avatarGearFor(equipment())).toEqual({
      hat: false, tunic: false, leggings: false, boots: false, mainHand: null, offHand: null, offHandLight: false,
    })
  })

  it('maps each equipped slot to its visible gear', () => {
    expect(avatarGearFor(equipment({ mainHand: stack('woodcutters_axe'), offHand: stack('wooden_shield'), head: stack('apprentice_hat') })))
      .toMatchObject({ hat: true, mainHand: 'axe', offHand: 'shield', offHandLight: false })
    expect(avatarGearFor(equipment({ chest: stack('traveler_tunic'), legs: stack('trail_leggings'), feet: stack('leather_boots') })))
      .toMatchObject({ tunic: true, leggings: true, boots: true })
  })

  it('lights an off-hand wand only when the main hand does not already carry one', () => {
    expect(avatarGearFor(equipment({ offHand: stack('oak_wand') }))).toMatchObject({ mainHand: null, offHand: 'wand', offHandLight: true })
    expect(avatarGearFor(equipment({ mainHand: stack('oak_wand'), offHand: stack('oak_wand') }))).toMatchObject({ mainHand: 'wand', offHand: 'wand', offHandLight: false })
  })
})

describe('shop-aware follow camera', () => {
  const target = new THREE.Vector3(0, 1.35, 0)
  const desired = new THREE.Vector3(0, 4.32, 6.14)
  const storeAt = (x: number) => ({ id: `store-${x}`, name: 'Outfitters', position: [x, 0, 2] as const, listings: [], sellOffers: [] })

  it('orbits away from the shop roof behind the fresh spawn without crowding the wizard', () => {
    const stores = [storeAt(-2)]
    const camera = storeSafeCameraPosition(target, desired, stores, null, 0.016)
    expect(camera.x).toBeGreaterThan(0)
    expect(camera.distanceTo(target)).toBeGreaterThan(5)
    expect(storeSafeCameraPosition(target, camera, stores, null, 0.016).distanceTo(camera)).toBeLessThan(1e-6)
  })

  it('chooses the opposite side for a mirrored shop and leaves a clear orbit unchanged', () => {
    expect(storeSafeCameraPosition(target, desired, [storeAt(2)], null, 0.016).x).toBeLessThan(0)
    expect(storeSafeCameraPosition(target, desired, [storeAt(-12)], null, 0.016).toArray()).toEqual(desired.toArray())
  })

  it('keeps a usable camera inside a legacy shop save until the player walks out', () => {
    const stores = [storeAt(-2)]
    const inside = new THREE.Vector3(-2, 1.35, 2)
    const desiredBehind = inside.clone().add(new THREE.Vector3(0, 2.97, 6.14))
    const camera = storeSafeCameraPosition(inside, desiredBehind, stores, null, 0.016)
    expect(camera.toArray().every(Number.isFinite)).toBe(true)
    expect(camera.distanceTo(inside)).toBeGreaterThan(0.5)
    expect(camera.distanceTo(inside)).toBeLessThan(3)
    expect(storeSafeCameraPosition(inside, camera, stores, null, 0.016).distanceTo(camera)).toBeLessThan(1e-6)

    const nearWall = new THREE.Vector3(-0.4, 1.35, 2)
    const outward = nearWall.clone().add(new THREE.Vector3(6, 2.97, 0))
    expect(storeSafeCameraPosition(nearWall, outward, stores, null, 0.016).distanceTo(nearWall)).toBeGreaterThan(0.5)
  })

  it('eases through nearby poses with finite coordinates and clear sightlines', () => {
    const stores = [storeAt(-2)]
    let camera = storeSafeCameraPosition(target, desired, stores, null, 0.016)
    for (let frame = 1; frame <= 30; frame += 1) {
      const nextTarget = target.clone().add(new THREE.Vector3(frame * 0.02, 0, 0))
      const nextDesired = desired.clone().add(new THREE.Vector3(frame * 0.02, 0, 0))
      const next = storeSafeCameraPosition(nextTarget, nextDesired, stores, camera, 0.016)
      expect(next.toArray().every(Number.isFinite)).toBe(true)
      expect(next.distanceTo(camera)).toBeLessThan(0.3)
      expect(storeSafeCameraPosition(nextTarget, next, stores, null, 0.016).distanceTo(next)).toBeLessThan(1e-6)
      camera = next
    }
  })

  it('frames the 853 by 480 spawn below the roof and above the compact objective bar', () => {
    const compact = cameraFramingFor(853, 480)
    const desktop = cameraFramingFor(1280, 800)
    expect(compact.focusHeight).toBeLessThan(desktop.focusHeight)
    expect(compact.pitchScale).toBeLessThan(desktop.pitchScale)
    const compactTarget = new THREE.Vector3(0, compact.focusHeight, 0)
    const pitch = 0.28 * compact.pitchScale
    const compactDesired = compactTarget.clone().add(new THREE.Vector3(0, compact.eyeRise + Math.sin(pitch) * compact.distance, Math.cos(pitch) * compact.distance))
    expect(storeSafeCameraPosition(compactTarget, compactDesired, [storeAt(-2)], null, 0.016).toArray()).toEqual(compactDesired.toArray())
  })
})
