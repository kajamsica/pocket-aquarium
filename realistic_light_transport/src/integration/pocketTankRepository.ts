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
type TankSlot = Readonly<{ kind: 'missing' } | { kind: 'invalid'; raw: string } | { kind: 'valid'; stored: StoredTank }>
interface IndexRecord { readonly raw: string | null; readonly index: PocketTankIndex }
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

  const readTankSlot = (id: string): TankSlot => {
    const raw = storage.getItem(storageKeyFor(id))
    if (raw === null) return { kind: 'missing' }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isObject(parsed) || !looksLikePocketState(parsed)) return { kind: 'invalid', raw }
      return { kind: 'valid', stored: { raw, state: restorePocketGame(parsed, now()),
        seq: readSaveSequence(parsed) } }
    } catch { return { kind: 'invalid', raw } }
  }

  const readStoredTank = (id: string) => {
    const slot = readTankSlot(id)
    return slot.kind === 'valid' ? slot.stored : null
  }

  const remember = (id: string, stored: StoredTank) => {
    const previous = seen.get(id)
    seen.set(id, { raw: stored.raw, seq: stored.seq ?? previous?.seq ?? 0 })
  }

  const readIndexRecord = (): IndexRecord => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = storage.getItem(indexKey)
      if (raw !== null) return { raw, index: parseIndex(raw) }
      const legacySlot = readTankSlot(LEGACY_TANK_ID)
      if (legacySlot.kind === 'invalid') {
        throw new Error('Legacy tank storage is occupied by invalid or foreign data')
      }
      if (legacySlot.kind === 'missing') return { raw: null, index: emptyIndex() }
      const legacy = legacySlot.stored
      const migrated: PocketTankIndex = {
        schemaVersion: INDEX_SCHEMA,
        revision: 1,
        activeTankId: LEGACY_TANK_ID,
        tanks: [{ id: LEGACY_TANK_ID, name: 'Original tank', habitat: legacy.state.habitat }],
      }
      const guardedRaw = storage.getItem(indexKey)
      if (guardedRaw !== null) continue
      const migratedRaw = JSON.stringify(migrated)
      storage.setItem(indexKey, migratedRaw)
      const verifiedRaw = storage.getItem(indexKey)
      if (verifiedRaw === migratedRaw) {
        remember(LEGACY_TANK_ID, legacy)
        return { raw: migratedRaw, index: migrated }
      }
      if (verifiedRaw !== null) return { raw: verifiedRaw, index: parseIndex(verifiedRaw) }
    }
    throw new Error('Pocket tank index changed too often during migration')
  }

  const readIndex = () => readIndexRecord().index
  const mutateIndex = (
    apply: (latest: PocketTankIndex) => PocketTankIndex | null,
    postcondition: (latest: PocketTankIndex) => boolean,
  ): PocketTankIndex => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = readIndexRecord()
      const applied = apply(current.index)
      if (applied === null) return current.index
      const next = { ...applied, revision: current.index.revision + 1 }
      if (storage.getItem(indexKey) !== current.raw) continue
      const nextRaw = JSON.stringify(next)
      storage.setItem(indexKey, nextRaw)
      const verifiedRaw = storage.getItem(indexKey)
      if (verifiedRaw === null) continue
      const verified = parseIndex(verifiedRaw)
      if (postcondition(verified)) return verified
    }
    throw new Error('Pocket tank index changed too often to save safely')
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

  const writeState = (id: string, state: PocketState, current: StoredTank | null, requireEmpty = false) => {
    const prior = seen.get(id)
    const saveSeq = Math.max(current?.seq ?? 0, prior?.seq ?? 0) + 1
    const stamped: PocketState & { saveSeq: number } = { ...state, saveSeq }
    const raw = serializePocketGame(stamped, now())
    if (requireEmpty && storage.getItem(storageKeyFor(id)) !== null) {
      throw new Error(`Tank storage ${storageKeyFor(id)} became occupied`)
    }
    storage.setItem(storageKeyFor(id), raw)
    const stored = { raw, state, seq: saveSeq }
    remember(id, stored)
    return stored
  }

  const nextId = () => {
    const candidate = makeId?.() ?? `tank-${Math.floor(now()).toString(36)}-${(++generatedId).toString(36)}`
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
    const id = reservedId ?? (index.tanks.length === 0 ? LEGACY_TANK_ID : nextId())
    if (index.tanks.some((tank) => tank.id === id)) throw new Error(`Tank ${id} already exists`)
    const target = readTankSlot(id)
    if (target.kind !== 'missing') throw new Error(`Tank storage ${storageKeyFor(id)} is already occupied`)
    const written = writeState(id, state, null, true)
    const next = mutateIndex((latest) => {
      const existing = latest.tanks.find((tank) => tank.id === id)
      if (existing) {
        const slot = readTankSlot(id)
        const ownLegacyMigration = id === LEGACY_TANK_ID && latest.tanks.length === 1
          && slot.kind === 'valid' && slot.stored.raw === written.raw
        if (!ownLegacyMigration) throw new Error(`Tank ${id} already exists`)
        return { ...latest, activeTankId: id, tanks: [{ id, name, habitat: state.habitat }] }
      }
      return { ...latest, activeTankId: id,
        tanks: [...latest.tanks, { id, name, habitat: state.habitat }] }
    }, (latest) => latest.activeTankId === id
      && latest.tanks.some((tank) => tank.id === id && tank.name === name
        && tank.habitat === state.habitat))
    return snapshotFor(next)
  }

  const renameTank = (id: string, rawName: string) => {
    const name = normalizeName(rawName)
    const next = mutateIndex((latest) => {
      const tank = latest.tanks.find((candidate) => candidate.id === id)
      if (!tank) throw new Error(`Unknown tank ${id}`)
      return tank.name === name ? null : { ...latest,
        tanks: latest.tanks.map((candidate) => candidate.id === id ? { ...candidate, name } : candidate) }
    }, (latest) => latest.tanks.some((tank) => tank.id === id && tank.name === name))
    return snapshotFor(next)
  }

  const activateTank = (id: string) => {
    if (!readStoredTank(id)) throw new Error(`Tank ${id} has no valid saved state`)
    const next = mutateIndex((latest) => {
      if (!latest.tanks.some((tank) => tank.id === id)) throw new Error(`Unknown tank ${id}`)
      return latest.activeTankId === id ? null : { ...latest, activeTankId: id }
    }, (latest) => latest.activeTankId === id)
    return snapshotFor(next)
  }

  const resetTank = (id: string, state: PocketState) => {
    const index = readIndex()
    if (!index.tanks.some((tank) => tank.id === id)) throw new Error(`Unknown tank ${id}`)
    writeState(id, state, readStoredTank(id))
    const next = mutateIndex((latest) => {
      if (!latest.tanks.some((tank) => tank.id === id)) throw new Error(`Unknown tank ${id}`)
      return { ...latest, tanks: latest.tanks.map((tank) => tank.id === id
        ? { ...tank, habitat: state.habitat } : tank) }
    }, (latest) => latest.tanks.some((tank) => tank.id === id && tank.habitat === state.habitat))
    return snapshotFor(next)
  }

  const saveActive = (expectedTankId: string, state: PocketState): SaveResult => {
    const opening = readIndexRecord()
    if (opening.index.activeTankId !== expectedTankId) {
      return { status: 'active_changed', snapshot: snapshotFor(opening.index) }
    }
    const slot = readTankSlot(expectedTankId)
    if (slot.kind === 'invalid') throw new Error(`Tank ${expectedTankId} contains invalid or foreign data`)
    const current = slot.kind === 'valid' ? slot.stored : null
    const latest = readIndexRecord()
    if (latest.index.activeTankId !== expectedTankId) {
      return { status: 'active_changed', snapshot: snapshotFor(latest.index) }
    }
    const prior = seen.get(expectedTankId) ?? { seq: 0, raw: null }
    if (current && savedRecordSupersedes(current, prior)) {
      remember(expectedTankId, current)
      return { status: 'adopted', snapshot: snapshotFor(latest.index) }
    }
    try { writeState(expectedTankId, state, current) } catch (error) {
      if (!current) throw error
      remember(expectedTankId, current)
      return { status: 'adopted', snapshot: snapshotFor(latest.index) }
    }
    return { status: 'saved', snapshot: snapshotFor(latest.index) }
  }

  const commitActiveAction = (
    expectedTankId: string,
    state: PocketState,
    reduce: (state: PocketState) => PocketState,
  ): CommitResult => {
    const opening = readIndexRecord()
    if (opening.index.activeTankId !== expectedTankId) {
      return { status: 'active_changed', snapshot: snapshotFor(opening.index) }
    }
    const slot = readTankSlot(expectedTankId)
    if (slot.kind === 'invalid') throw new Error(`Tank ${expectedTankId} contains invalid or foreign data`)
    const current = slot.kind === 'valid' ? slot.stored : null
    const latest = readIndexRecord()
    if (latest.index.activeTankId !== expectedTankId) {
      return { status: 'active_changed', snapshot: snapshotFor(latest.index) }
    }
    const prior = seen.get(expectedTankId) ?? { seq: 0, raw: null }
    const base = current && savedRecordSupersedes(current, prior) ? current.state : state
    if (current && base === current.state) remember(expectedTankId, current)
    const nextState = reduce(base)
    try { writeState(expectedTankId, nextState, current) } catch (error) {
      if (!current) throw error
      remember(expectedTankId, current)
      return { status: 'adopted', snapshot: snapshotFor(latest.index) }
    }
    return { status: 'committed', snapshot: snapshotFor(latest.index) }
  }

  return { getSnapshot, createTank, renameTank, activateTank, resetTank, saveActive, commitActiveAction }
}
