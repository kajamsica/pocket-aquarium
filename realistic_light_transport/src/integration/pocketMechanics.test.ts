import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  advancePocketState,
  createPocketReefShowcase,
  dispatchPocketAction,
  pocketActions,
  pocketSaveKey,
  pocketShowcasePopulationAuthority,
  projectPocketState,
  restorePocketGame,
  savedRecordSupersedes,
  serializePocketGame,
  type PocketState,
} from './pocketAquariumBridge'
import { ACCEPTED_SPECIES_IDS, specimenAssetFor } from '../scene/specimens/assetRegistry'
// The other local aquarium route. It shares `pocketSaveKey`, and under a headless load it skips
// bootstrap and publishes only its shared action surface, so these drive its real save path.
import '../../../js/app.js'

const rootRoute = (globalThis as unknown as {
  PA: { _app: { setState(state: PocketState): void; getState(): PocketState; save(): void; feed(): void } }
}).PA._app

// The 3D view. Its module scope reads `location`, so stand it up on a plain non-loopback origin:
// dev-safe stays off and it shares `pocketSaveKey` with the root route, exactly as in production.
Object.assign(globalThis, {
  location: { href: 'https://example.com/', hostname: 'example.com', protocol: 'https:', search: '' },
})
;(globalThis as { window?: unknown }).window = globalThis
// Its commit path, imported after `location` exists. `rebaseOnStoredSave` then `persistPocketState`
// is verbatim what its `dispatch` runs; the component around them needs a DOM this env has not got.
const { persistPocketState, rebaseOnStoredSave } = await import('../App')

/** Minimal `Storage` stand-in: the routes only ever get/set/remove this one key. */
function installStorage() {
  const cells = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => cells.has(key) ? cells.get(key)! : null,
      setItem: (key: string, value: string) => { cells.set(key, value) },
      removeItem: (key: string) => { cells.delete(key) },
    },
  })
  return {
    /** What a reload would restore, read straight from the bytes on disk. */
    reload: () => restorePocketGame(JSON.parse(cells.get(pocketSaveKey)!)),
    seq: () => JSON.parse(cells.get(pocketSaveKey)!).saveSeq as number | undefined,
    write: (payload: string) => { cells.set(pocketSaveKey, payload) },
  }
}

const nameOf = (state: PocketState, id: number) =>
  projectPocketState(state).residents.find((resident) => resident.id === id)?.name

describe('integrated reef showcase mechanics', () => {
  it('fills the upgraded tank with reef-strength saltwater before livestock', () => {
    const state = createPocketReefShowcase()

    expect(state.tier).toBe('xl757')
    expect(state.water.levelL).toBeCloseTo(757, 6)
    expect(state.water.salinity).toBeCloseTo(35, 1)
    expect(projectPocketState(state).residents.length).toBeGreaterThan(0)
  })

  it('keeps showcase residents alive and salinity stable over two game days', () => {
    const initial = createPocketReefShowcase()
    const advanced = advancePocketState(initial, 192)

    expect(advanced.time.days - initial.time.days).toBeCloseTo(2, 6)
    expect(advanced.livestock.every((resident) => resident.alive !== false)).toBe(true)
    expect(advanced.water.levelL).toBeCloseTo(757, 6)
    expect(advanced.water.salinity).toBeCloseTo(35, 1)
  })

  it('projects accepted showcase defaults from root state with ordinary interactions available', () => {
    const state = createPocketReefShowcase()
    const view = projectPocketState(state)
    const animalOffers = view.storeOffers.filter((offer) => offer.kind === 'livestock')
    const coralOffers = view.storeOffers.filter((offer) => offer.kind === 'coral')

    expect(pocketShowcasePopulationAuthority).toBe('root_pa')
    expect(view.authority).toBe(pocketShowcasePopulationAuthority)
    const acceptedAnimals = ACCEPTED_SPECIES_IDS.filter((speciesId) => specimenAssetFor(speciesId)?.category !== 'coral')
    expect(acceptedAnimals).toHaveLength(25)
    expect(acceptedAnimals).toContain('epaulette_shark')
    expect(state.livestock).toHaveLength(24)
    expect(view.specimens).toHaveLength(24)
    expect(view.specimens.map((animal) => animal.id)).toEqual(state.livestock.map((animal) => animal.id))
    expect(new Set(view.specimens.map((animal) => animal.speciesId))).toHaveProperty('size', 24)
    expect(view.specimens.some((animal) => animal.speciesId === 'epaulette_shark')).toBe(false)
    expect(view.specimens.every((animal) => animal.stage === 'adult' && animal.health === 1
      && animal.condition === 1 && animal.hunger <= .15 && animal.runtimeProfile.id === animal.speciesId)).toBe(true)
    expect(view.specimens.every((animal) => animal.x >= 0 && animal.x <= 1 && animal.y >= 0 && animal.y <= 1)).toBe(true)
    expect(createPocketReefShowcase().livestock.map((animal) => animal.id)).toEqual(state.livestock.map((animal) => animal.id))
    expect(animalOffers).toHaveLength(25)
    expect(coralOffers).toHaveLength(22)
    expect(new Set(coralOffers.map((offer) => offer.id)).size).toBe(22)
    const sharkOffer = animalOffers.find((offer) => offer.id === 'epaulette_shark')
    expect(sharkOffer).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('at least 1363 L of water (this tank holds 757 L)'),
        expect.stringContaining('at least 32000 cm²'),
      ]),
    })
    const sharkAttempt = dispatchPocketAction(state, {
      ...sharkOffer!.action,
      acceptRisk: true,
    })
    expect(sharkAttempt.livestock).toHaveLength(24)
    expect(sharkAttempt.livestock.some((animal) => animal.species === 'epaulette_shark')).toBe(false)
    expect(coralOffers.every((offer) => typeof offer.action.variantId === 'string')).toBe(true)
    expect(view.coralInventory).toHaveLength(8)
    expect(view.coralInventory.every((coral) => specimenAssetFor(coral.speciesId)?.variantId === coral.variantId)).toBe(true)
    expect(view.placedCorals).toHaveLength(0)

    const selected = dispatchPocketAction(state, { type: pocketActions.SELECT_ENTITY,
      entityType: 'livestock', id: view.specimens[0].id })
    expect(projectPocketState(selected).selection).toMatchObject({ entityType: 'livestock', id: view.specimens[0].id })
    expect(projectPocketState(selected).selectedSpecimen?.id).toBe(view.specimens[0].id)
    const fed = dispatchPocketAction(selected, { type: pocketActions.FEED, x: .5, y: .2 })
    expect(projectPocketState(fed).food).toHaveLength(1)
    const storeUpgrade = view.storeOffers.find((offer) => offer.id === 'circulation:gyre')
    expect(storeUpgrade).toMatchObject({ allowed: true, action: { type: pocketActions.PURCHASE_EQUIPMENT } })
    expect(dispatchPocketAction(state, storeUpgrade!.action).equipment.circulation).toBe('gyre')
    const purchasableCoral = coralOffers.find((offer) => offer.allowed)
    expect(purchasableCoral).toBeDefined()
    expect(projectPocketState(dispatchPocketAction(state, purchasableCoral!.action)).coralInventory).toHaveLength(9)

    const coral = view.coralInventory[0]
    const next = dispatchPocketAction(state, { type: pocketActions.LOCK_CORAL_PLACEMENT,
      coralId: coral.id, placement: { version: 1, surface: 'sand', surfaceId: 'sand:base',
        position: [0, 0, 0], normal: [0, 1, 0], yaw: 0 } })
    const projected = projectPocketState(next)
    expect(projected.coralInventory).toHaveLength(7)
    expect(projected.placedCorals).toMatchObject([{ id: coral.id, speciesId: coral.speciesId,
      variantId: coral.variantId, speciesName: coral.speciesName,
      variantDisplayName: coral.variantDisplayName, health: expect.any(Number) }])
  })
})

describe('resident rename durability', () => {
  it('keeps a custom name through simulation ticks, serialization, and reload', () => {
    const state = createPocketReefShowcase()
    const id = state.livestock[0].id
    let renamed = dispatchPocketAction(state, { type: pocketActions.RENAME_LIVESTOCK, id, name: 'Nemo' })

    for (let tick = 0; tick < 240; tick++) renamed = advancePocketState(renamed, .25) // 60s at 250ms
    expect(nameOf(renamed, id)).toBe('Nemo')

    const reloaded = restorePocketGame(JSON.parse(serializePocketGame(renamed)))
    expect(reloaded.livestock.find((animal) => animal.id === id)?.customName).toBe('Nemo')

    // An emptied name is how a rename resets a resident to its species name.
    const cleared = dispatchPocketAction(reloaded, { type: pocketActions.RENAME_LIVESTOCK, id, name: '   ' })
    expect(cleared.livestock.find((animal) => animal.id === id)?.customName).toBeUndefined()
    expect(nameOf(cleared, id))
      .toBe(projectPocketState(cleared).residents.find((resident) => resident.id === id)?.speciesName)
  })

  /* The two local aquarium views share one save key, so the ordering below is the whole contract:
   * sequence wins, and an unsequenced record is adoptable only before a view has sequenced one of
   * its own. Both views are driven through their own writers, and every assertion reads the stored
   * bytes, because a reload is what the player actually gets. One store is installed for the whole
   * block and never reset: sequences climb across scenarios exactly as they do across a session. */
  describe('across the two views that share the save key', () => {
    let store: ReturnType<typeof installStorage>
    let opened: PocketState
    let id: number

    beforeAll(() => { store = installStorage() })
    afterAll(() => { Reflect.deleteProperty(globalThis, 'localStorage') })

    // Two tabs open on the same fresh reef, both in sync with disk: the moment before one acts.
    // The first save settles the root route against whatever the previous scenario left stored.
    beforeEach(() => {
      rootRoute.save()
      opened = createPocketReefShowcase()
      id = opened.livestock[0].id
      rootRoute.setState(opened)
      rootRoute.save()
      rebaseOnStoredSave(opened) // the 3D view reads the same save
    })

    /** The 3D view renames a resident and commits, through its own commit path. */
    const renameIn3DView = () =>
      persistPocketState(dispatchPocketAction(rebaseOnStoredSave(opened),
        { type: pocketActions.RENAME_LIVESTOCK, id, name: 'Nemo' }))

    /** The root route renames a resident and commits, through its own writer. */
    const renameInRootRoute = () => {
      rootRoute.setState(dispatchPocketAction(rootRoute.getState(),
        { type: pocketActions.RENAME_LIVESTOCK, id, name: 'Nemo' }))
      rootRoute.save()
    }

    it('rebases a root-route action onto a 3D-view rename it has not swept yet', () => {
      renameIn3DView()

      // No adoption sweep runs in the root route first: the player just feeds, on the roster that
      // route is still showing. The action has to land on the renamed aquarium, not over it.
      rootRoute.feed()

      const stored = store.reload()
      expect(nameOf(stored, id)).toBe('Nemo')       // the peer's rename survived the action
      expect(stored.food.length).toBeGreaterThan(0) // and the action itself still landed
      expect(nameOf(rootRoute.getState(), id)).toBe('Nemo')
    })

    it('rebases a 3D-view action onto a root-route rename it has not swept yet', () => {
      renameInRootRoute()

      // The mirror image: no sweep in the 3D view, which still holds the roster it opened with,
      // and the player feeds there.
      persistPocketState(dispatchPocketAction(rebaseOnStoredSave(opened), { type: 'FEED', x: 0.5 }))

      const stored = store.reload()
      expect(nameOf(stored, id)).toBe('Nemo')
      expect(stored.food.length).toBeGreaterThan(0)
      // The root route's next sweep takes that commit rather than putting its own roster back.
      rootRoute.save()
      expect(nameOf(rootRoute.getState(), id)).toBe('Nemo')
      expect(rootRoute.getState().food.length).toBeGreaterThan(0)
    })

    it('leaves the rename on disk when the root route autosaves its older roster', () => {
      const renamedSeq = store.seq()! + 1
      renameIn3DView()
      // No 3D sweep runs after this: the assertion is what a reload one millisecond later restores.
      rootRoute.save()

      expect(nameOf(store.reload(), id)).toBe('Nemo')
      expect(store.seq()).toBe(renamedSeq)
      // Yielding is not enough — the route must take the aquarium it yielded to, or its next
      // write would put the older roster straight back.
      expect(nameOf(rootRoute.getState(), id)).toBe('Nemo')
    })

    it('keeps the rename once the 3D view exits and only the root route is still saving', () => {
      renameIn3DView()
      const renamedSeq = store.seq()!
      rootRoute.save() // the adoption above, then the 3D view closes its tab

      for (let sweep = 0; sweep < 8; sweep++) {
        rootRoute.setState(advancePocketState(rootRoute.getState(), 2))
        rootRoute.save()
        expect(nameOf(store.reload(), id)).toBe('Nemo')
      }
      expect(store.seq()).toBeGreaterThan(renamedSeq) // it is writing again, not frozen out
    })

    it('migrates an initially unsequenced save exactly once, then stops adopting it', () => {
      renameIn3DView()
      const legacy = JSON.stringify(store.reload()) // a save written before saveSeq existed
      store.write(legacy)
      rootRoute.setState(store.reload())
      rootRoute.save() // the first write after reading it stamps a sequence

      const migrated = store.seq()
      expect(migrated).toEqual(expect.any(Number))
      expect(nameOf(store.reload(), id)).toBe('Nemo')

      // An older build now writes that same unsequenced save back over the sequenced one.
      store.write(legacy)
      rootRoute.save()

      expect(store.seq()).toBe(migrated! + 1) // re-asserted rather than rolled back
      expect(nameOf(store.reload(), id)).toBe('Nemo')
    })
  })

  it('orders stored saves by sequence, adopting an unsequenced record only before its first write', () => {
    const unsequenced = { seq: null, raw: 'peer' }
    expect(savedRecordSupersedes(unsequenced, { seq: 0, raw: null })).toBe(true)      // legacy migration
    expect(savedRecordSupersedes(unsequenced, { seq: 0, raw: 'peer' })).toBe(false)   // already this view's bytes
    expect(savedRecordSupersedes(unsequenced, { seq: 4, raw: 'mine' })).toBe(false)   // this view has sequenced
    expect(savedRecordSupersedes({ seq: 5, raw: 'peer' }, { seq: 4, raw: 'mine' })).toBe(true)
    expect(savedRecordSupersedes({ seq: 4, raw: 'peer' }, { seq: 4, raw: 'mine' })).toBe(false)
  })
})
