import { describe, expect, it } from 'vitest'
import { createPublicV13ControllerRuntime, publicV13WalkRequestedAfterFrame } from './PublicV13Controller'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { withFreshPublicV7Herbs } from './domain/publicWorldV7'
import { withFreshPublicV9Camps } from './domain/publicWorldV9State'
import { withPublicV10TerrainRevision } from './domain/publicWorldV10State'
import { encodePublicV11Head, PUBLIC_V11_SCHEMA } from './domain/publicWorldV11Snapshot'
import { withPublicV11Highland } from './domain/publicWorldV11State'
import type { PublicV13Start } from './domain/publicWorldV13Flow'
import { createPublicV13MigrationHead, decodePublicV13Head, PUBLIC_V13_SCHEMA } from './domain/publicWorldV13Snapshot'
import { parsePublicV13Rescue } from './domain/publicWorldV13Rescue'
import { publicV11Gait } from './domain/publicWorldGait'
import { publicWorldV13ViewProjection } from './PublicV13WorldView'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { terrainHeightAt } from './domain/generation'
import { worldTileAtGrid } from './domain/worldChunks'
import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WizardHud } from './view/WizardHud'
import { WizardMap } from './view/WizardMap'
import type { WizardViewProjection } from './view/contracts'

const seed = 'greenway-alpha'
const move = { type: 'move' as const, delta: { x: .16, z: 0 } }
function start(): PublicV13Start {
  const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
  const v11 = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
    withFreshPublicV7Herbs(fresh))))
  const sourceLineage = { sourceSchemaVersion: PUBLIC_V11_SCHEMA,
    sourceHead: encodePublicV11Head(v11, null, 0) } as const
  const zero = createPublicV13MigrationHead(sourceLineage)!
  return { state: zero.state, bootstrap: zero.bootstrap,
    saveRevision: zero.saveRevision, sourceLineage }
}
function next(saved: PublicV13Start, state: PublicV13Start['state']): PublicV13Start {
  const head = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: saved.saveRevision + 1, bootstrap: saved.bootstrap, state }, saved.sourceLineage)!
  if (!head) throw Error('Invalid test commit')
  return { ...saved, state: head.state, saveRevision: head.saveRevision }
}

describe('unmounted public v13 controller barrier', () => {
  it('does not advertise store, equipment, spell, or dig actions during a v13 save barrier', async () => {
    const base = start()
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const runtime = createPublicV13ControllerRuntime(base, {
      save: async () => { await pending; return { ok: false, reason: 'revision-changed' } },
      boots: async () => ({ ok: false, reason: 'unused' }),
      work: async () => ({ ok: false, reason: 'unused' }),
    })
    const render = (storeOpen: boolean) => {
      const view = publicWorldV13ViewProjection(runtime.snapshotForView(), runtime.view(), [], null)
      const spade = { id: 'spade', itemId: 'field_spade', name: 'Field spade', quantity: 1 }
      const projection = { ...view,
        controllerActionsEnabled: runtime.status().gate === 'open',
        learnedSpellIds: ['wayfinder_glow'] as const,
        backpack: { capacity: 20, stacks: [{ id: 'axe', itemId: 'woodcutters_axe',
          name: 'Woodcutter axe', quantity: 1, equippableSlots: ['mainHand'] as const }] },
        equipment: { ...view.equipment, mainHand: spade },
        digSites: [{ id: 'practice_mound' as const, name: 'Practice mound',
          position: view.player.position, revealed: true, excavated: false,
          minimumExcavationLevel: 1 }],
        stores: [{ id: 'store-greenway', name: 'Greenway Outfitters', position: view.player.position,
          listings: [{ id: 'spade', name: 'Field spade', price: 18 }],
          sellOffers: [{ itemId: 'logs', name: 'Logs', quantity: 1, unitPrice: 2 }] }],
        nearbyStoreId: 'store-greenway', openStoreId: storeOpen ? 'store-greenway' : null,
      } satisfies WizardViewProjection
      return renderToStaticMarkup(createElement(WizardHud, { projection, onIntent: () => {} }))
    }
    const button = (html: string, label: string) =>
      html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0]
    const check = (disabled: boolean) => {
      const closed = render(false), opened = render(true)
      for (const [html, label] of [
        [closed, 'Open Greenway Outfitters'], [opened, 'Sell 1 Logs'],
        [closed, 'Equip Woodcutter axe'], [closed, 'Excavate Practice mound'],
        [closed, 'Cast Wayfinder Glow'],
      ]) expect(button(html, label)?.includes('disabled=""')).toBe(disabled)
      expect(opened).toContain('Greenway Outfitters')
      expect(opened).toContain('Field spade')
      if (disabled) for (const html of [closed, opened]) {
        for (const control of html.match(/<button\b[^>]*>/g) ?? [])
          expect(control).toMatch(/disabled=""|aria-disabled="true"/)
        expect(html).toContain('Excavation Lv1')
      }
    }
    check(false)
    runtime.advanceFrame([{ type: 'look', yawDelta: .1, pitchDelta: 0 }], false)
    const saving = runtime.save()
    expect(runtime.status().gate).toBe('barrier')
    check(true)
    release()
    expect(await saving).toBe('blocked')
    check(true)
  })

  it('shows Greenway route and Walk controls as ready only while the save gate is open', async () => {
    const base = start()
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const runtime = createPublicV13ControllerRuntime(base, {
      save: async () => { await pending; return { ok: false, reason: 'revision-changed' } },
      boots: async () => ({ ok: false, reason: 'unused' }),
      work: async () => ({ ok: false, reason: 'unused' }),
    })
    const site = { id: 'greenway-test-site', routeId: 'greenway_ladder',
      label: 'Greenway ladder test approach', from: [0, 0, 0] as const,
      to: [0, 4, -4] as const, logCost: 4, status: 'ready' as const,
      reason: 'Ready to build', discovered: true }
    const render = (geographicallyUnavailable = false) => {
      const projection = { ...publicWorldV13ViewProjection(runtime.snapshotForView(), runtime.view(), [], site.id),
        buildSites: [site], selectedBuildSiteId: site.id,
        ...(geographicallyUnavailable ? { unavailableActions: true as const } : {}),
        controllerActionsEnabled: runtime.status().gate === 'open',
        gait: publicV11Gait('leather_boots', false) }
      return {
        map: renderToStaticMarkup(createElement(WizardMap, { projection, open: true,
          onToggle: () => {}, onIntent: () => {}, buttonRef: createRef<HTMLButtonElement>(),
          closeRef: createRef<HTMLButtonElement>() })),
        hud: renderToStaticMarkup(createElement(WizardHud, { projection, onIntent: () => {} })),
      }
    }
    const open = render()
    expect(open.map).toMatch(/<button[^>]*aria-label="Preview Greenway low steps test approach"[^>]*>/)
    expect(open.map.match(/<button[^>]*aria-label="Preview Greenway low steps test approach"[^>]*>/)?.[0])
      .not.toContain('disabled=""')
    expect(open.hud.match(/<button[^>]*aria-label="Walk"[^>]*>/)?.[0]).not.toContain('disabled=""')
    expect(open.hud).toContain('Ready to build')
    const geographic = render(true)
    expect(geographic.map.match(/<button[^>]*aria-label="Preview Greenway low steps test approach"[^>]*>/)?.[0])
      .toContain('disabled=""')
    expect(geographic.map).toContain('Route actions unavailable here')
    expect(geographic.map).not.toContain('Route actions paused for save')
    expect(geographic.hud.match(/<button[^>]*aria-label="Walk"[^>]*>/)?.[0]).not.toContain('disabled=""')

    runtime.advanceFrame([{ type: 'look', yawDelta: .1, pitchDelta: 0 }], false)
    const saving = runtime.save()
    expect(runtime.status().gate).toBe('barrier')
    const paused = render()
    expect(paused.map.match(/<button[^>]*aria-label="Preview Greenway low steps test approach"[^>]*>/)?.[0])
      .toContain('disabled=""')
    expect(paused.map).toContain('Route actions paused for save')
    expect(paused.hud.match(/<button[^>]*aria-label="Walk"[^>]*>/)?.[0]).toContain('disabled=""')
    expect(paused.hud).toContain('Pace changes paused while the save is not ready.')
    expect(paused.hud).not.toContain('Ready to build')
    expect(paused.hud).toMatch(/<button type="button" disabled="">Build<\/button>/)
    expect(paused.hud).toMatch(/<button type="button" disabled="">Cancel<\/button>/)
    expect(paused.map).toContain('Greenway low steps')

    release()
    expect(await saving).toBe('blocked')
    const blocked = render()
    expect(blocked.map.match(/<button[^>]*aria-label="Preview Greenway low steps test approach"[^>]*>/)?.[0])
      .toContain('disabled=""')
    expect(blocked.hud.match(/<button[^>]*aria-label="Walk"[^>]*>/)?.[0]).toContain('disabled=""')
    expect(blocked.map).toContain('Route actions paused for save')
  })

  it('casts learned streamed glow, checkpoints discovery, and blocks casts during save and recovery', async () => {
    const zero = start()
    const mask = new Uint8Array(zero.state.discoveryMask)
    const edgeBit = encodeDiscoveredTileIds([worldTileAtGrid(seed, -3, 0).id])
    for (let index = 0; index < mask.length; index++) mask[index] |= edgeBit[index]
    let saved = next(zero, { ...zero.state, discoveryMask: mask,
      player: { ...zero.state.player, learnedSpellIds: ['wayfinder_glow'],
        position: { x: -12, y: terrainHeightAt(zero.state.greenway.tiles, -12, 0), z: 0 } } })
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    let stale = false
    const runtime = createPublicV13ControllerRuntime(saved, {
      save: async (state) => {
        await pending
        if (stale) return { ok: false, reason: 'source-changed' }
        saved = next(saved, state)
        return { ok: true, value: saved }
      },
      boots: async () => ({ ok: false, reason: 'unused' }),
      work: async () => ({ ok: false, reason: 'unused' }),
    })
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: -.16, z: 0 } }], false).rejections).toEqual([])
    expect(runtime.view().movementOwner).toBe('streamed')
    const cast = [{ type: 'cast_spell' as const, spellId: 'wayfinder_glow' as const }]
    const result = runtime.advanceFrame(cast, false)
    expect(result.rejections).toEqual([])
    expect(result.events[0]).toMatchObject({ type: 'spell_cast' })
    expect(runtime.status().dirtyGeneration).toBe(2)
    const candidate = runtime.snapshotForView()
    const saving = runtime.save()
    expect(runtime.advanceFrame(cast, false).rejections).toMatchObject([{ code: 'unavailable_here' }])
    expect(runtime.snapshotForView()).toEqual(candidate)
    release()
    expect(await saving).toBe('saved')
    expect(saved.state.discoveryMask).toEqual(candidate.discoveryMask)
    expect(runtime.advanceFrame(cast, false).events[0]).toMatchObject({ type: 'spell_cast', revealedTileIds: [] })
    stale = true
    expect(await runtime.save()).toBe('blocked')
    expect(runtime.advanceFrame(cast, false).rejections).toMatchObject([{ code: 'unavailable_here' }])
    expect(parsePublicV13Rescue(runtime.status().rescueBytes!)?.unsavedCandidate).not.toBeNull()
  })

  it.each([
    [true, true, false], [true, false, true], [false, true, true], [true, undefined, true],
  ] as const)('gates both streamed Cast buttons for learned=%s capability=%s', (learned, capability, disabled) => {
    const base = start()
    const runtime = createPublicV13ControllerRuntime(base, {
      save: async () => ({ ok: false, reason: 'unused' }),
      boots: async () => ({ ok: false, reason: 'unused' }),
      work: async () => ({ ok: false, reason: 'unused' }),
    })
    const projection = { ...publicWorldV13ViewProjection(base.state, runtime.view(), [], null),
      learnedSpellIds: learned ? ['wayfinder_glow' as const] : [],
      unavailableActions: true as const, streamedSpellAvailable: capability }
    const html = renderToStaticMarkup(createElement(WizardHud, { projection, onIntent: () => {} }))
    const casts = html.match(/<button[^>]*aria-label="Cast Wayfinder Glow"[^>]*>/g)!
    expect(casts).toHaveLength(2)
    for (const button of casts) expect(button.includes('disabled=""')).toBe(disabled)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Interact<\/button>/)
  })

  it('drains an older delayed save before accepting newer frames or a work writer', async () => {
    const base = start()
    let release!: (result: ReturnType<typeof next>) => void
    const pending = new Promise<PublicV13Start>((resolve) => { release = resolve })
    const calls: string[] = []
    let saved = base
    let saves = 0
    const runtime = createPublicV13ControllerRuntime(base, {
      save: async (state, revision) => {
        calls.push(`save:${revision}:${state.tick}`)
        if (++saves === 1) { saved = await pending; return { ok: true, value: saved } }
        saved = next(saved, state)
        return { ok: true, value: saved }
      },
      boots: async () => ({ ok: false, reason: 'Not enough coins for leather boots.' }),
      work: async (_id, revision) => {
        calls.push(`work:${revision}`)
        return { ok: false, reason: 'too_far' }
      },
    })
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: .1, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    const firstCandidate = runtime.snapshotForView()
    const saving = runtime.save()
    expect(runtime.status().gate).toBe('barrier')
    expect(runtime.advanceFrame([move], false).rejections)
      .toMatchObject([{ code: 'unavailable_here' }])
    expect(runtime.status().dirtyGeneration).toBe(1)
    expect(await runtime.buildWork('works1:bridge:1:1:x')).toBe('busy')
    release(next(base, firstCandidate))
    expect(await saving).toBe('saved')
    expect(runtime.status()).toMatchObject({ gate: 'open', saveRevision: 1, dirtyGeneration: 0 })
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: .1, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.buildWork('works1:bridge:1:1:x')).toBe('rejected')
    expect(calls).toEqual([`save:0:${firstCandidate.tick}`,
      `save:1:${firstCandidate.tick + 1}`, 'work:2'])
    expect(runtime.status()).toMatchObject({ gate: 'open', saveRevision: 2, dirtyGeneration: 0 })
  })

  it('freezes a stale write with a validated detached rescue and never retries', async () => {
    const base = start()
    let writes = 0
    const runtime = createPublicV13ControllerRuntime(base, {
      save: async () => { writes++; return { ok: false, reason: 'revision-changed' } },
      boots: async () => { throw Error('must not run') },
      work: async () => { throw Error('must not run') },
    })
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: .1, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    const candidate = runtime.snapshotForView()
    expect(await runtime.save()).toBe('blocked')
    const status = runtime.status()
    expect(status).toMatchObject({ gate: 'blocked', blockedReason: 'revision-changed' })
    const rescue = parsePublicV13Rescue(status.rescueBytes!)
    expect(rescue?.savedBase.saveRevision).toBe(0)
    expect(rescue?.unsavedCandidate?.state).toEqual(candidate)
    expect(runtime.advanceFrame([move], false).rejections)
      .toMatchObject([{ code: 'unavailable_here' }])
    expect(await runtime.buyBoots('store-greenway')).toBe('blocked')
    expect(writes).toBe(1)
    expect(runtime.snapshotForView()).toEqual(candidate)
  })

  it('checkpoints before the canonical boots writer, then allows equipped run and walk toggle', async () => {
    const base = start()
    let saved = base
    const seen: string[] = []
    const runtime = createPublicV13ControllerRuntime(base, {
      save: async (state, revision) => {
        seen.push(`save:${revision}`)
        saved = next(saved, state)
        return { ok: true, value: saved }
      },
      boots: async (id, revision) => {
        seen.push(`boots:${id}:${revision}`)
        saved = next(saved, { ...saved.state, player: { ...saved.state.player,
          inventory: [...saved.state.player.inventory, { itemId: 'leather_boots', quantity: 1 }] } })
        return { ok: true, value: { start: saved, event: { type: 'store_item_bought' } } }
      },
      work: async () => ({ ok: false, reason: 'too_far' }),
    })
    expect(publicV11Gait(runtime.snapshotForView().player.equipment.feet, false).canRun).toBe(false)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: .1, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.buyBoots('store-greenway')).toBe('saved')
    expect(seen).toEqual(['save:0', 'boots:store-greenway:1'])
    expect(runtime.advanceFrame([{ type: 'equip_item', itemId: 'leather_boots', slot: 'feet' }], false)
      .rejections).toEqual([])
    const feet = runtime.snapshotForView().player.equipment.feet
    expect(publicV11Gait(feet, false).pace).toBe('run')
    expect(publicV11Gait(feet, true).pace).toBe('walk')

    const known = new Uint8Array(saved.state.discoveryMask)
    const edgeBit = encodeDiscoveredTileIds([worldTileAtGrid(seed, -3, 0).id])
    for (let index = 0; index < known.length; index++) known[index] |= edgeBit[index]
    const edge = next(saved, { ...saved.state, discoveryMask: known,
      player: { ...saved.state.player,
        position: { x: -12, y: terrainHeightAt(saved.state.greenway.tiles, -12, 0), z: 0 },
        equipment: { ...saved.state.player.equipment, feet: 'leather_boots' } } })
    const outer = createPublicV13ControllerRuntime(edge, {
      save: async () => ({ ok: false, reason: 'unused' }),
      boots: async () => ({ ok: false, reason: 'unused' }),
      work: async () => ({ ok: false, reason: 'unused' }),
    })
    expect(outer.advanceFrame([{ type: 'move', delta: { x: -.16, z: 0 } }], false)
      .rejections).toEqual([])
    expect(outer.view().movementOwner).toBe('streamed')
    const streamedFeet = outer.snapshotForView().player.equipment.feet
    expect(publicV11Gait(streamedFeet, false).pace).toBe('run')
    expect(publicV11Gait(streamedFeet, true).pace).toBe('walk')
  })

  it('returns to booted default run after Walk, unequip, and re-equip without resetting on other frames', async () => {
    const base = start()
    let saved = base
    const runtime = createPublicV13ControllerRuntime(base, {
      save: async (state) => {
        saved = next(saved, state)
        return { ok: true, value: saved }
      },
      boots: async () => {
        saved = next(saved, { ...saved.state, player: { ...saved.state.player,
          inventory: [...saved.state.player.inventory, { itemId: 'leather_boots', quantity: 1 }] } })
        return { ok: true, value: { start: saved, event: { type: 'store_item_bought' } } }
      },
      work: async () => ({ ok: false, reason: 'unused' }),
    })
    let walkRequested = false
    const frame = (intents: Parameters<typeof runtime.advanceFrame>[0]) => {
      const result = runtime.advanceFrame(intents, walkRequested)
      expect(result.rejections).toEqual([])
      walkRequested = publicV13WalkRequestedAfterFrame(walkRequested, result.events)
      return result
    }
    expect(publicV11Gait(runtime.snapshotForView().player.equipment.feet, walkRequested))
      .toMatchObject({ pace: 'walk', canRun: false })
    expect(await runtime.buyBoots('store-greenway')).toBe('saved')
    expect(frame([{ type: 'equip_item', itemId: 'leather_boots', slot: 'feet' }]).events)
      .toMatchObject([{ type: 'item_equipped', slot: 'feet' }])
    expect(publicV11Gait(runtime.snapshotForView().player.equipment.feet, walkRequested).pace).toBe('run')
    walkRequested = true
    frame([{ type: 'look', yawDelta: .1, pitchDelta: 0 }])
    expect(walkRequested).toBe(true)
    expect(publicV13WalkRequestedAfterFrame(walkRequested,
      [{ type: 'item_equipped', slot: 'mainHand' }])).toBe(true)
    expect(publicV11Gait(runtime.snapshotForView().player.equipment.feet, walkRequested).pace).toBe('walk')
    expect(frame([{ type: 'unequip_item', slot: 'feet' }]).events)
      .toMatchObject([{ type: 'item_unequipped', slot: 'feet' }])
    expect(walkRequested).toBe(false)
    expect(publicV11Gait(runtime.snapshotForView().player.equipment.feet, walkRequested))
      .toMatchObject({ pace: 'walk', canRun: false })
    frame([{ type: 'equip_item', itemId: 'leather_boots', slot: 'feet' }])
    expect(publicV11Gait(runtime.snapshotForView().player.equipment.feet, walkRequested))
      .toMatchObject({ pace: 'run', canRun: true })
  })

  it('keeps 128 bounded preview frames within the responsive frame budget', () => {
    const runtime = createPublicV13ControllerRuntime(start(), {
      save: async () => ({ ok: false, reason: 'unused' }),
      boots: async () => ({ ok: false, reason: 'unused' }),
      work: async () => ({ ok: false, reason: 'unused' }),
    })
    const samples: number[] = []
    const stepSamples: number[] = [], snapshotSamples: number[] = [], projectionSamples: number[] = []
    const node = globalThis as typeof globalThis & {
      process?: { memoryUsage(): { heapUsed: number } }
    }
    const heapBefore = node.process?.memoryUsage().heapUsed ?? 0
    for (let index = 0; index < 144; index++) {
      const before = performance.now()
      runtime.advanceFrame([], false)
      const afterStep = performance.now()
      const state = runtime.snapshotForView()
      const afterSnapshot = performance.now()
      publicWorldV13ViewProjection(state, runtime.view(), [], null)
      const afterProjection = performance.now()
      if (index >= 16) {
        samples.push(afterProjection - before)
        stepSamples.push(afterStep - before)
        snapshotSamples.push(afterSnapshot - afterStep)
        projectionSamples.push(afterProjection - afterSnapshot)
      }
    }
    samples.sort((a, b) => a - b)
    stepSamples.sort((a, b) => a - b)
    snapshotSamples.sort((a, b) => a - b)
    projectionSamples.sort((a, b) => a - b)
    const p95 = samples[Math.floor(samples.length * .95)]
    const heapAfter = node.process?.memoryUsage().heapUsed ?? 0
    console.log(`P22C 128-frame p95 ${p95.toFixed(3)} ms, step ${stepSamples[121].toFixed(3)}, snapshot ${snapshotSamples[121].toFixed(3)}, projection ${projectionSamples[121].toFixed(3)}, net heap ${(heapAfter - heapBefore) / 1024 / 1024} MiB`)
    expect(p95).toBeLessThan(20)
  })
})
