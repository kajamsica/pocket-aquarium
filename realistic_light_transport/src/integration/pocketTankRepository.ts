import { restorePocketGame, savedRecordSupersedes, serializePocketGame,
  type PocketState } from './pocketAquariumBridge'

const INDEX_SCHEMA = 'pocket-aquarium.tank-index/v1' as const
const LEGACY_TANK_ID = 'legacy'
const TANK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_NAME_LENGTH = 24

type TankHabitat = 'reef' | 'amazon' | null
type TankStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface PocketTankIndexEntry { readonly id: string; readonly name: string; readonly habitat: TankHabitat }

export interface PocketTankIndex {
  readonly schemaVersion: typeof INDEX_SCHEMA
  readonly revision: number
  readonly activeTankId: string | null
  readonly tanks: readonly PocketTankIndexEntry[]
}

export interface PocketActiveTank {
  readonly id: string
  readonly name: string
  readonly state: PocketState
  readonly saveSeq: number | null
  readonly storageKey: string
}

export interface PocketTankRepositorySnapshot { readonly index: PocketTankIndex; readonly active: PocketActiveTank | null }

type SaveResult = Readonly<{ status: 'saved' | 'adopted' | 'active_changed'; snapshot: PocketTankRepositorySnapshot }>
type CommitResult = Readonly<{ status: 'committed' | 'adopted' | 'active_changed'; snapshot: PocketTankRepositorySnapshot }>
interface StoredTank { readonly raw: string; readonly state: PocketState; readonly seq: number | null }
interface SeenTank { readonly raw: string | null; readonly seq: number }

const emptyIndex = (): PocketTankIndex => ({ schemaVersion: INDEX_SCHEMA, revision: 0,
  activeTankId: null, tanks: [] })

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTankId(value: unknown): value is string {
  return typeof value === 'string' && TANK_ID.test(value)
}

function isHabitat(value: unknown): value is TankHabitat {
  return value === 'reef' || value === 'amazon' || value === null
}

function looksLikePocketState(value: Record<string, unknown>) {
  return isHabitat(value.habitat) && isObject(value.time) && isObject(value.water)
    && isObject(value.cycle) && Array.isArray(value.livestock)
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Tank name must be text')
  const name = value.trim()
  if (!name || name.length > MAX_NAME_LENGTH || /[\r\n]/.test(name)) {
    throw new Error(`Tank name must be one line and ${MAX_NAME_LENGTH} characters or fewer`)
  }
  return name
}

function parseIndex(raw: string): PocketTankIndex {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('Pocket tank index is malformed') }
  if (!isObject(parsed) || parsed.schemaVersion !== INDEX_SCHEMA) {
    throw new Error('Unsupported or malformed pocket tank index')
  }
  if (!Number.isInteger(parsed.revision) || (parsed.revision as number) < 0
    || !Array.isArray(parsed.tanks)
    || !(parsed.activeTankId === null || isTankId(parsed.activeTankId))) {
    throw new Error('Pocket tank index is malformed')
  }

  const ids = new Set<string>()
  const tanks = parsed.tanks.map((candidate): PocketTankIndexEntry => {
    if (!isObject(candidate) || !isTankId(candidate.id) || !isHabitat(candidate.habitat)) {
      throw new Error('Pocket tank index contains an invalid tank')
    }
    const name = normalizeName(candidate.name)
    if (name !== candidate.name || ids.has(candidate.id)) {
      throw new Error('Pocket tank index contains an invalid tank')
    }
    ids.add(candidate.id)
    return { id: candidate.id, name, habitat: candidate.habitat }
  })
  if (parsed.activeTankId !== null && !ids.has(parsed.activeTankId)) {
    throw new Error('Pocket tank index points to an unknown active tank')
  }
  return {
    schemaVersion: INDEX_SCHEMA,
    revision: parsed.revision as number,
    activeTankId: parsed.activeTankId as string | null,
    tanks,
  }
}

function readSaveSequence(parsed: unknown): number | null {
  if (!isObject(parsed)) return null
  const sequence = parsed.saveSeq
  return typeof sequence === 'number' && Number.isFinite(sequence) ? sequence : null
}

export function createPocketTankRepository({
  storage,
  baseKey,
  now = Date.now,
  makeId,
}: {
  storage: TankStorage
  baseKey: string
  now?: () => number
  makeId?: () => string
}) {
  const indexKey = `${baseKey}:tank-index-v1`
  const seen = new Map<string, SeenTank>()
  let generatedId = 0

  const storageKeyFor = (id: string) => id === LEGACY_TANK_ID
    ? baseKey : `${baseKey}:tank-v1:${id}`

  const readStoredTank = (id: string): StoredTank | null => {
    const raw = storage.getItem(storageKeyFor(id))
    if (raw === null) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isObject(parsed) || !looksLikePocketState(parsed)) return null
      return { raw, state: restorePocketGame(parsed, now()), seq: readSaveSequence(parsed) }
    } catch { return null }
  }

  const remember = (id: string, stored: StoredTank) => {
    const previous = seen.get(id)
    seen.set(id, { raw: stored.raw, seq: stored.seq ?? previous?.seq ?? 0 })
  }

  const writeIndex = (index: PocketTankIndex) => {
    storage.setItem(indexKey, JSON.stringify(index))
  }

  const readIndex = (): PocketTankIndex => {
    const raw = storage.getItem(indexKey)
    if (raw !== null) return parseIndex(raw)

    const legacy = readStoredTank(LEGACY_TANK_ID)
    if (!legacy) return emptyIndex()
    const migrated: PocketTankIndex = {
      schemaVersion: INDEX_SCHEMA,
      revision: 1,
      activeTankId: LEGACY_TANK_ID,
      tanks: [{ id: LEGACY_TANK_ID, name: 'Original tank', habitat: legacy.state.habitat }],
    }
    writeIndex(migrated)
    remember(LEGACY_TANK_ID, legacy)
    return migrated
  }

  const snapshotFor = (index: PocketTankIndex): PocketTankRepositorySnapshot => {
    let active: PocketActiveTank | null = null
    const tanks = index.tanks.map((tank) => {
      const stored = readStoredTank(tank.id)
      if (!stored) return tank
      remember(tank.id, stored)
      if (tank.id === index.activeTankId) {
        active = {
          id: tank.id,
          name: tank.name,
          state: stored.state,
          saveSeq: stored.seq,
          storageKey: storageKeyFor(tank.id),
        }
      }
      return stored.state.habitat === tank.habitat
        ? tank : { ...tank, habitat: stored.state.habitat }
    })
    return { index: { ...index, tanks }, active }
  }

  const writeState = (id: string, state: PocketState, current: StoredTank | null) => {
    const prior = seen.get(id)
    const saveSeq = Math.max(current?.seq ?? 0, prior?.seq ?? 0) + 1
    const stamped: PocketState & { saveSeq: number } = { ...state, saveSeq }
    const raw = serializePocketGame(stamped, now())
    storage.setItem(storageKeyFor(id), raw)
    const stored = { raw, state, seq: saveSeq }
    remember(id, stored)
    return stored
  }

  const nextId = (reservedId?: string) => {
    const candidate = reservedId ?? makeId?.()
      ?? `tank-${Math.floor(now()).toString(36)}-${(++generatedId).toString(36)}`
    if (!isTankId(candidate) || candidate === LEGACY_TANK_ID) {
      throw new Error('Tank ID must be lowercase letters, numbers, and hyphens')
    }
    return candidate
  }

  const getSnapshot = () => snapshotFor(readIndex())

  const createTank = ({ name: rawName, state, reservedId }: {
    name: string
    state: PocketState
    reservedId?: string
  }) => {
    const index = readIndex()
    const name = normalizeName(rawName)
    if (reservedId !== undefined && (!isTankId(reservedId) || reservedId === LEGACY_TANK_ID)) {
      throw new Error('Reserved tank ID must be lowercase letters, numbers, and hyphens')
    }
    const id = index.tanks.length === 0 ? LEGACY_TANK_ID : nextId(reservedId)
    if (index.tanks.some((tank) => tank.id === id)) throw new Error(`Tank ${id} already exists`)
    writeState(id, state, readStoredTank(id))
    const next: PocketTankIndex = {
      ...index,
      revision: index.revision + 1,
      activeTankId: id,
      tanks: [...index.tanks, { id, name, habitat: state.habitat }],
    }
    writeIndex(next)
    return snapshotFor(next)
  }

  const renameTank = (id: string, rawName: string) => {
    const index = readIndex()
    const name = normalizeName(rawName)
    if (!index.tanks.some((tank) => tank.id === id)) throw new Error(`Unknown tank ${id}`)
    const changed = index.tanks.some((tank) => tank.id === id && tank.name !== name)
    if (!changed) return snapshotFor(index)
    const next = { ...index, revision: index.revision + 1,
      tanks: index.tanks.map((tank) => tank.id === id ? { ...tank, name } : tank) }
    writeIndex(next)
    return snapshotFor(next)
  }

  const activateTank = (id: string) => {
    const index = readIndex()
    if (!index.tanks.some((tank) => tank.id === id)) throw new Error(`Unknown tank ${id}`)
    if (!readStoredTank(id)) throw new Error(`Tank ${id} has no valid saved state`)
    if (index.activeTankId === id) return snapshotFor(index)
    const next = { ...index, revision: index.revision + 1, activeTankId: id }
    writeIndex(next)
    return snapshotFor(next)
  }

  const resetTank = (id: string, state: PocketState) => {
    const index = readIndex()
    if (!index.tanks.some((tank) => tank.id === id)) throw new Error(`Unknown tank ${id}`)
    writeState(id, state, readStoredTank(id))
    const next = { ...index, revision: index.revision + 1,
      tanks: index.tanks.map((tank) => tank.id === id ? { ...tank, habitat: state.habitat } : tank) }
    writeIndex(next)
    return snapshotFor(next)
  }

  const saveActive = (expectedTankId: string, state: PocketState): SaveResult => {
    const index = readIndex()
    if (index.activeTankId !== expectedTankId) {
      return { status: 'active_changed', snapshot: snapshotFor(index) }
    }
    const current = readStoredTank(expectedTankId)
    const prior = seen.get(expectedTankId) ?? { seq: 0, raw: null }
    if (current && savedRecordSupersedes(current, prior)) {
      remember(expectedTankId, current)
      return { status: 'adopted', snapshot: snapshotFor(index) }
    }
    try { writeState(expectedTankId, state, current) } catch (error) {
      if (!current) throw error
      remember(expectedTankId, current)
      return { status: 'adopted', snapshot: snapshotFor(index) }
    }
    return { status: 'saved', snapshot: snapshotFor(index) }
  }

  const commitActiveAction = (
    expectedTankId: string,
    state: PocketState,
    reduce: (state: PocketState) => PocketState,
  ): CommitResult => {
    const index = readIndex()
    if (index.activeTankId !== expectedTankId) {
      return { status: 'active_changed', snapshot: snapshotFor(index) }
    }
    const current = readStoredTank(expectedTankId)
    const prior = seen.get(expectedTankId) ?? { seq: 0, raw: null }
    const base = current && savedRecordSupersedes(current, prior) ? current.state : state
    if (current && base === current.state) remember(expectedTankId, current)
    const nextState = reduce(base)
    try { writeState(expectedTankId, nextState, current) } catch (error) {
      if (!current) throw error
      remember(expectedTankId, current)
      return { status: 'adopted', snapshot: snapshotFor(index) }
    }
    return { status: 'committed', snapshot: snapshotFor(index) }
  }

  return { getSnapshot, createTank, renameTank, activateTank, resetTank, saveActive, commitActiveAction }
}
