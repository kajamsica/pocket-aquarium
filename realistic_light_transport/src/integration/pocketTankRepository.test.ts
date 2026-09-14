import { describe, expect, it } from 'vitest'

import {
  createPocketFreshwaterDevTank,
  createPocketReefShowcase,
  DEV_FRESHWATER_50_TANK_ID,
  dispatchPocketAction,
  loadSavedPocketState,
  pocketActions,
  pocketSaveKey,
  serializePocketGame,
  type PocketState,
} from './pocketAquariumBridge'
import { createPocketTankRepository } from './pocketTankRepository'

const NOW = 1_700_000_000_000
const BASE = pocketSaveKey
const INDEX = `${BASE}:tank-index-v1`
const tankKey = (id: string) => `${BASE}:tank-v1:${id}`

class MemoryStorage implements Storage {
  readonly writes: Array<readonly [string, string]> = []
  private readonly cells = new Map<string, string>()
  private afterRead: { key: string; run: () => void } | null = null

  constructor(entries: Iterable<readonly [string, string]> = []) {
    for (const [key, value] of entries) this.cells.set(key, value)
  }

  get length() { return this.cells.size }
  clear() { this.cells.clear() }
  key(index: number) { return [...this.cells.keys()][index] ?? null }
  removeItem(key: string) { this.cells.delete(key) }
  setItem(key: string, value: string) {
    const stored = String(value)
    this.cells.set(key, stored)
    this.writes.push([key, stored])
  }
  getItem(key: string) {
    const value = this.cells.get(key) ?? null
    if (this.afterRead?.key === key) {
      const { run } = this.afterRead
      this.afterRead = null
      run()
    }
    return value
  }
  afterNextReadOf(key: string, run: () => void) { this.afterRead = { key, run } }
  entries() { return [...this.cells.entries()].sort(([a], [b]) => a.localeCompare(b)) }
}

const reef = (credits = 100) => Object.assign(createPocketReefShowcase(), { credits })
const freshwater = (credits = 200) => Object.assign(createPocketFreshwaterDevTank(NOW), { credits })
const repository = (storage: MemoryStorage, makeId?: () => string) =>
  createPocketTankRepository({ storage, baseKey: BASE, now: () => NOW, makeId })

describe('pocket tank repository storage contract', () => {
  it('keeps empty storage unpersisted until the first ordinary tank is created', () => {
    const storage = new MemoryStorage()
    const repo = repository(storage)

    expect(repo.getSnapshot()).toEqual({
      index: { schemaVersion: 'pocket-aquarium.tank-index/v1', revision: 0,
        activeTankId: null, tanks: [] },
      active: null,
    })
    expect(storage.entries()).toEqual([])

    const created = repo.createTank({ name: 'Home reef', state: reef(11) })
    expect(created.active).toMatchObject({ id: 'legacy', name: 'Home reef', saveSeq: 1, storageKey: BASE })
    expect(storage.entries().map(([key]) => key)).toEqual([BASE, INDEX].sort())
    expect(JSON.parse(storage.getItem(BASE)!).saveSeq).toBe(1)
  })

  it('imports valid singleton bytes by writing only the index', () => {
    const legacyRaw = serializePocketGame(reef(31), NOW)
    const storage = new MemoryStorage([[BASE, legacyRaw]])

    const snapshot = repository(storage).getSnapshot()

    expect(storage.getItem(BASE)).toBe(legacyRaw)
    expect(storage.writes.map(([key]) => key)).toEqual([INDEX])
    expect(JSON.parse(storage.getItem(INDEX)!)).toEqual({
      schemaVersion: 'pocket-aquarium.tank-index/v1', revision: 1,
      activeTankId: 'legacy', tanks: [{ id: 'legacy', name: 'Original tank', habitat: 'reef' }],
    })
    expect(snapshot.active).toMatchObject({ id: 'legacy', saveSeq: null, storageKey: BASE })
  })

  it.each([
    ['malformed index', [[BASE, serializePocketGame(reef(), NOW)], [INDEX, '{bad']] as const],
    ['foreign legacy singleton', [[BASE, '{"owner":"another-app"}']] as const],
    ['malformed legacy singleton', [[BASE, '{bad']] as const],
  ])('preserves bytes and throws for a %s', (_case, entries) => {
    const storage = new MemoryStorage(entries)
    const before = storage.entries()

    expect(() => repository(storage).getSnapshot()).toThrow()
    expect(storage.entries()).toEqual(before)
    expect(storage.writes).toEqual([])
  })

  it('puts an explicitly reserved dev tank in its scoped slot and never writes the base slot', () => {
    const storage = new MemoryStorage()
    const snapshot = repository(storage).createTank({
      name: 'Freshwater 50', state: freshwater(), reservedId: DEV_FRESHWATER_50_TANK_ID,
    })

    expect(storage.getItem(BASE)).toBeNull()
    expect(storage.entries().map(([key]) => key)).toEqual([INDEX, tankKey(DEV_FRESHWATER_50_TANK_ID)])
    expect(snapshot.active).toMatchObject({
      id: DEV_FRESHWATER_50_TANK_ID,
      storageKey: tankKey(DEV_FRESHWATER_50_TANK_ID),
      saveSeq: 1,
    })
  })

  it('never overwrites occupied orphan scoped bytes', () => {
    const orphanKey = tankKey('orphan')
    const storage = new MemoryStorage([[orphanKey, 'foreign bytes']])
    const before = storage.entries()

    expect(() => repository(storage).createTank({
      name: 'Claim orphan', state: reef(), reservedId: 'orphan',
    })).toThrow(/already occupied/)
    expect(storage.entries()).toEqual(before)
    expect(storage.writes).toEqual([])
  })

  it('keeps two tanks, sequences, metadata, and reset state independent', () => {
    const storage = new MemoryStorage()
    const repo = repository(storage, () => 'second-tank')
    repo.createTank({ name: 'First reef', state: reef(10) })
    repo.createTank({ name: 'Second fresh', state: freshwater(20) })

    expect(storage.entries().map(([key]) => key)).toEqual([BASE, INDEX, tankKey('second-tank')].sort())
    expect(JSON.parse(storage.getItem(BASE)!).saveSeq).toBe(1)
    expect(JSON.parse(storage.getItem(tankKey('second-tank'))!).saveSeq).toBe(1)

    repo.activateTank('legacy')
    expect(repo.saveActive('legacy', reef(11)).status).toBe('saved')
    repo.activateTank('second-tank')
    expect(repo.saveActive('second-tank', freshwater(21)).status).toBe('saved')
    expect(JSON.parse(storage.getItem(BASE)!).saveSeq).toBe(2)
    expect(JSON.parse(storage.getItem(tankKey('second-tank'))!).saveSeq).toBe(2)

    const peerRaw = storage.getItem(tankKey('second-tank'))
    const peerRow = repo.getSnapshot().index.tanks.find(({ id }) => id === 'second-tank')
    repo.renameTank('legacy', 'Renamed reef')
    repo.activateTank('legacy')
    const reset = repo.resetTank('legacy', freshwater(12))

    expect(storage.getItem(tankKey('second-tank'))).toBe(peerRaw)
    expect(reset.index.tanks.find(({ id }) => id === 'second-tank')).toEqual(peerRow)
    expect(reset.index.tanks.find(({ id }) => id === 'legacy')).toMatchObject({
      name: 'Renamed reef', habitat: 'amazon',
    })
    expect(reset.active).toMatchObject({ id: 'legacy', saveSeq: 3 })
  })
})

describe('pocket tank repository view coordination', () => {
  it('returns active_changed for stale saves and actions without reducing or writing them', () => {
    const storage = new MemoryStorage()
    const setup = repository(storage)
    setup.createTank({ name: 'A', state: reef(1), reservedId: 'tank-a' })
    setup.createTank({ name: 'B', state: freshwater(2), reservedId: 'tank-b' })
    const stale = repository(storage).getSnapshot().active!
    const peer = repository(storage)
    peer.activateTank('tank-a')
    const before = storage.entries()
    let reduced = false

    expect(repository(storage).saveActive('tank-b', stale.state).status).toBe('active_changed')
    const action = repository(storage).commitActiveAction('tank-b', stale.state, (state) => {
      reduced = true
      return state
    })
    expect(action.status).toBe('active_changed')
    expect(action.snapshot.active?.id).toBe('tank-a')
    expect(reduced).toBe(false)
    expect(storage.entries()).toEqual(before)
  })

  it('adopts a newer same-tank save and rebases a later action over another newer save', () => {
    const storage = new MemoryStorage()
    repository(storage).createTank({ name: 'Shared', state: reef(1), reservedId: 'shared' })
    const first = repository(storage)
    const second = repository(storage)
    const firstState = first.getSnapshot().active!.state
    const staleState = second.getSnapshot().active!.state

    expect(first.saveActive('shared', { ...firstState, credits: 10 }).status).toBe('saved')
    const newerRaw = storage.getItem(tankKey('shared'))
    const adopted = second.saveActive('shared', { ...staleState, credits: 20 })
    expect(adopted.status).toBe('adopted')
    expect(adopted.snapshot.active).toMatchObject({ saveSeq: 2, state: { credits: 10 } })
    expect(storage.getItem(tankKey('shared'))).toBe(newerRaw)

    const actionBase = adopted.snapshot.active!.state
    expect(first.saveActive('shared', { ...first.getSnapshot().active!.state, credits: 30 }).status).toBe('saved')
    const rebased = second.commitActiveAction('shared', actionBase, (state: PocketState) =>
      dispatchPocketAction(state, { type: pocketActions.SET_SPEED, speed: 4 }))

    expect(rebased.status).toBe('committed')
    expect(rebased.snapshot.active).toMatchObject({ saveSeq: 4, state: { credits: 30, speed: 4 } })
  })

  it('retries deterministic index interleavings without losing peer create, rename, or activation', () => {
    const storage = new MemoryStorage()
    const actor = repository(storage)
    const peer = repository(storage)
    actor.createTank({ name: 'Actor', state: reef(), reservedId: 'actor' })

    storage.afterNextReadOf(INDEX, () => {
      peer.createTank({ name: 'Peer', state: freshwater(), reservedId: 'peer' })
    })
    actor.renameTank('actor', 'Actor renamed')

    storage.afterNextReadOf(INDEX, () => { peer.renameTank('peer', 'Peer renamed') })
    actor.activateTank('actor')

    storage.afterNextReadOf(INDEX, () => { peer.activateTank('peer') })
    const final = actor.renameTank('actor', 'Actor final')

    expect(final.index).toEqual({
      schemaVersion: 'pocket-aquarium.tank-index/v1', revision: 7, activeTankId: 'peer',
      tanks: [
        { id: 'actor', name: 'Actor final', habitat: 'reef' },
        { id: 'peer', name: 'Peer renamed', habitat: 'amazon' },
      ],
    })
    expect(final.active).toMatchObject({ id: 'peer', state: { habitat: 'amazon' } })
  })

  it('leaves an old client on the legacy base state while the active scoped tank advances', () => {
    const storage = new MemoryStorage()
    const repo = repository(storage, () => 'new-tank')
    repo.createTank({ name: 'Legacy', state: reef(7) })
    const legacyRaw = storage.getItem(BASE)
    repo.createTank({ name: 'New', state: freshwater(8) })
    expect(repo.saveActive('new-tank', freshwater(9)).status).toBe('saved')

    expect(repo.getSnapshot().active).toMatchObject({ id: 'new-tank', state: { credits: 9 } })
    expect(storage.getItem(BASE)).toBe(legacyRaw)
    expect(loadSavedPocketState(NOW, storage)).toMatchObject({ habitat: 'reef', credits: 7 })
  })
})
