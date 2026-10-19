import { createPublicV36ControllerRuntime } from './PublicV36ControllerRuntime'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { HERB_CYCLE_TICKS } from './domain/mireglassHerbForaging'
import { createPublicV23StreamTerrain } from './domain/publicWorldV14Terrain'
import { decodePublicV14FrameWitness, PUBLIC_V14_MAX_FRAME_BATCH } from './domain/publicWorldV14Snapshot'
import type { PublicV14Frame } from './domain/publicWorldV14Snapshot'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { publicWorldV16TileAtGrid } from './domain/publicWorldV16GreenwaySites'
import { exactPublicV23 } from './domain/publicWorldV23Snapshot'
import type { PublicWorldIntent, PublicWorldRejection } from './domain/publicWorldRuntime'
import type { PublicV23ControllerOutcome } from './PublicV23ControllerRuntime'
import type { PublicV36Start } from './domain/publicWorldV36Flow'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import { decodePublicV36Witness, PUBLIC_V36_SCHEMA } from './domain/publicWorldV36Snapshot'
import type { PublicV41Operation, PublicV41Start } from './domain/publicWorldV41Flow'
import { decodePublicV41Head, decodePublicV41Lineage, replayPublicV41Witness } from './domain/publicWorldV41Snapshot'
import type { PublicV41Witness } from './domain/publicWorldV41Snapshot'
import { confirmPublicV37WindwardAction, decodePublicV37WindwardWitness } from './domain/publicWorldV37WindwardAction'
import { confirmPublicV38SignalAction, decodePublicV38SignalWitness } from './domain/publicWorldV38SignalAction'
import { confirmPublicV39RingAction, decodePublicV39RingWitness } from './domain/publicWorldV39RingAction'
import type { PublicV39RingProgress } from './domain/publicWorldV39RingAction'
import { confirmPublicV40WaystationAction, decodePublicV40WaystationWitness } from './domain/publicWorldV40WaystationAction'
import type { PublicV40WaystationProgress } from './domain/publicWorldV40WaystationAction'
import { confirmPublicV41CombatAction, decodePublicV41CombatWitness } from './domain/publicWorldV41CombatAction'
import type { PublicV41CombatProgress } from './domain/publicWorldV41CombatAction'

type Writer = (revision: number, lineage: PublicV41Start['lineage'], witness: PublicV41Witness) =>
  Promise<PublicV41Operation<PublicV41Start>>
type HomeWriter = (revision: number, lineage: PublicV41Start['lineage']) =>
  Promise<PublicV41Operation<PublicV41Start>>
type InheritedAction = Parameters<ReturnType<typeof createPublicV36ControllerRuntime>['action']>[0]
const progress = ({ head }: PublicV41Start): PublicV41CombatProgress => {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness, ...value } = head
  return value
}
const ringFlags = ({ quarryRingDiscovered, ringLinkEstablished, ringOutboundCompleted,
  ringReturnCompleted, ringkeeperClaimed }: PublicV39RingProgress) => ({
  quarryRingDiscovered, ringLinkEstablished, ringOutboundCompleted,
  ringReturnCompleted, ringkeeperClaimed })
const waystationFlags = ({ timberBartered, southbankReached,
  waystationClaimed }: PublicV40WaystationProgress) => ({ timberBartered, southbankReached,
  waystationClaimed })
const combatState = ({ ironHall }: PublicV41CombatProgress) => ({ ironHall })

/** Inherited controls use a disposable V36 shell. Its lineage never reaches storage. */
function asV36(start: PublicV41Start): PublicV36Start {
  const { markerClaimReward: _marker, signalVantageInspected: _inspected,
    signalClaimed: _claimed, quarryRingDiscovered: _discovered,
    ringLinkEstablished: _linked, ringOutboundCompleted: _outbound,
    ringReturnCompleted: _returned, ringkeeperClaimed: _ringClaimed,
    timberBartered: _bartered, southbankReached: _southbank,
    waystationClaimed: _waystationClaimed, ironHall: _combat, ...genesis } = start.lineage.genesis
  const { signalVantageInspected: _headInspected, signalClaimed: _headClaimed,
    quarryRingDiscovered: _headDiscovered, ringLinkEstablished: _headLinked,
    ringOutboundCompleted: _headOutbound, ringReturnCompleted: _headReturned,
    ringkeeperClaimed: _headRingClaimed, timberBartered: _headBartered,
    southbankReached: _headSouthbank, waystationClaimed: _headWaystationClaimed,
    ironHall: _headCombat, ...head } = start.head
  return { lineage: { origin: 'v35-migration', rulesProfile: 'old-marker/v1',
    seed: start.lineage.seed, sourceRevision: 0, genesis: structuredClone(genesis) },
  head: { ...structuredClone(head), schemaVersion: PUBLIC_V36_SCHEMA,
    saveRevision: start.head.saveRevision + 1,
    witness: decodePublicV36Witness(start.head.witness) ?? { kind: 'checkpoint' } } }
}

/** Preview and writer verify the same ordinary witnesses with V37's private movement policy. */
export function createPublicV41ControllerRuntime(initial: PublicV41Start,
  write: Writer, homeWrite?: HomeWriter) {
  let committed = structuredClone(initial), preview = progress(committed)
  let pending: PublicV14Frame[] = [], busy = false, blockedReason: string | null = null
  const grounded = (value: PublicV41CombatProgress) => {
    const pose = projectPublicV31Pose(value)
    return value.state.player.verticalVelocity === 0 && !!pose
      && Math.abs(pose.effective.position.y - pose.effective.floorY) <= 1e-6
  }
  const freeze = (reason: string) => {
    blockedReason = reason
    return { status: 'blocked' as const, reason }
  }
  const checked = (reply: PublicV41Operation<PublicV41Start>, revision: number,
    witness: PublicV41Witness, expected: PublicV41CombatProgress) => {
    if (!reply.ok) return reply
    try {
      const { head, lineage } = reply.value
      if (!exactPublicV23(reply.value, ['head', 'lineage'])
        || !decodePublicV41Lineage(lineage) || !decodePublicV41Head(head, lineage)
        || !samePublicV14Value(lineage, committed.lineage)
        || head.saveRevision !== revision + 1 || !samePublicV14Value(head.witness, witness)
        || !samePublicV14Value(progress(reply.value), expected))
        return { ok: false as const, reason: 'writer-mismatch' }
      committed = structuredClone(reply.value); preview = progress(committed); pending = []
      return { ok: true as const, value: asV36(committed) }
    } catch { return { ok: false as const, reason: 'writer-mismatch' } }
  }
  const flush = async (): Promise<PublicV23ControllerOutcome> => {
    if (!pending.length) return { status: 'unchanged' }
    if (!grounded(preview)) return { status: 'deferred-airborne' }
    const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: pending })
    const expected = witness && replayPublicV41Witness(progress(committed), witness)
    if (!witness || !expected || !samePublicV14Value(expected, preview)) return freeze('local-replay')
    try {
      const revision = committed.head.saveRevision
      const result = checked(await write(revision, structuredClone(committed.lineage), witness),
        revision, witness, expected)
      return result.ok ? { status: 'saved', events: [], resetWalkRequested: false } : freeze(result.reason)
    } catch { return freeze('storage-error') }
  }
  const inherited = () => createPublicV36ControllerRuntime(asV36(committed),
    async (shellRevision, _lineage, witness) => {
      const revision = committed.head.saveRevision
      if (shellRevision !== revision + 1) return { ok: false, reason: 'revision-changed' }
      const expected = replayPublicV41Witness(progress(committed), witness)
      if (!expected) return { ok: false, reason: 'local-replay' }
      return checked(await write(revision, structuredClone(committed.lineage), witness), revision, witness, expected)
    }, homeWrite ? async (shellRevision) => {
      const revision = committed.head.saveRevision
      if (shellRevision !== revision + 1) return { ok: false, reason: 'revision-changed' }
      const reply = await homeWrite(revision, structuredClone(committed.lineage))
      if (!reply.ok) return reply
      const witness = decodePublicV36Witness(reply.value.head.witness)
      const expected = witness?.kind === 'return-home/v1'
        ? replayPublicV41Witness(progress(committed), witness) : null
      return witness && expected ? checked(reply, revision, witness, expected)
        : { ok: false, reason: 'writer-mismatch' }
    } : undefined)
  const reject = (intents: readonly PublicWorldIntent[], code: PublicWorldRejection['code'], message: string) =>
    ({ events: [], rejections: [{ intentIndex: 0, intentType: intents[0]?.type ?? 'move', code, message }] })
  return {
    committed: () => structuredClone(committed),
    preview: () => structuredClone(preview),
    view() {
      const { state } = preview
      const activeTiles = state.movementOwner === 'greenway' ? state.greenway.tiles.map((tile) =>
        publicWorldV16TileAtGrid(state.seed, tile.center.x / 4, tile.center.z / 4))
        : createPublicV23StreamTerrain(state, preview.regionalWorks.builtLadderIds).activeTiles()
      return { movementOwner: state.movementOwner, tick: state.tick,
        player: structuredClone(state.player), activeTiles: structuredClone(activeTiles),
        activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask, state.player.position),
        pendingBoundary: false }
    },
    status: () => ({ gate: blockedReason ? 'blocked' as const : busy ? 'barrier' as const
      : pending.length >= PUBLIC_V14_MAX_FRAME_BATCH ? 'cap-paused' as const : 'open' as const,
    blockedReason, saveRevision: committed.head.saveRevision, pendingFrames: pending.length,
    checkpointRecommended: pending.length >= 64, checkpointRequired: pending.length >= PUBLIC_V14_MAX_FRAME_BATCH }),
    // Match inherited clock obligations, with V31's effective support for settling.
    idleFrameNeeded: () => {
      const { state } = preview, { tick, player } = state
      return busy || blockedReason !== null || !grounded(preview)
        || !Number.isSafeInteger(tick + 1)
        || !player.tradeSlots.every((slot) => slot.itemId === null && slot.quantity === 0 && slot.unitPrice === 0)
        || !state.mireglass.herbHarvestCycles.every((entry) => entry.cycle < Math.floor(tick / HERB_CYCLE_TICKS))
        || !state.highland.stoneNodes.every((node) => node.readyAtTick <= tick)
        || state.windstep.activeUntilTick > tick || state.windstep.nextCastTick > tick
        || preview.ironHall.engaged && (preview.ironHall.phase === 'windup'
          || preview.ironHall.phase === 'recovery')
    },
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean) {
      if (busy || blockedReason || pending.length >= PUBLIC_V14_MAX_FRAME_BATCH)
        return reject(intents, 'unavailable_here', 'Movement is paused for a checked write.')
      const frame = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: [{ intents, walkRequested }] })
      if (!frame) return reject(intents, 'invalid_frame', 'Invalid replayable frame.')
      const candidate = [...pending, frame.frames[0]]
      const next = replayPublicV41Witness(progress(committed),
        { kind: 'frame-batch/v1', frames: candidate })
      if (!next) return reject(intents, 'terrain_missing', 'This move cannot be replayed safely.')
      pending = candidate; preview = next
      return { events: [], rejections: [] }
    },
    async save() {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      busy = true
      try { return await flush() } finally { busy = false }
    },
    async returnHome() {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      busy = true
      try {
        const saved = await flush()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const result = await inherited().returnHome()
        if (result.status === 'blocked') return freeze(result.reason)
        return result
      } catch { return freeze('storage-error') } finally { busy = false }
    },
    async action(raw: InheritedAction | import('./domain/publicWorldV37WindwardAction').PublicV37WindwardWitness
      | import('./domain/publicWorldV38SignalAction').PublicV38SignalWitness
      | import('./domain/publicWorldV39RingAction').PublicV39RingWitness
      | import('./domain/publicWorldV40WaystationAction').PublicV40WaystationWitness
      | import('./domain/publicWorldV41CombatAction').PublicV41CombatWitness) {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      busy = true
      try {
        const saved = await flush()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const combat = decodePublicV41CombatWitness(raw)
        if (combat) {
          const action = confirmPublicV41CombatAction(preview, combat)
          if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
          const revision = committed.head.saveRevision
          const result = checked(await write(revision, structuredClone(committed.lineage), combat),
            revision, combat, action.progress)
          return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
        }
        const waystation = decodePublicV40WaystationWitness(raw)
        if (waystation) {
          const action = confirmPublicV40WaystationAction(preview, waystation)
          if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
          const revision = committed.head.saveRevision
          const result = checked(await write(revision, structuredClone(committed.lineage), waystation),
            revision, waystation, { ...action.progress, ...combatState(preview) })
          return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
        }
        const ring = decodePublicV39RingWitness(raw)
        if (ring) {
          const action = confirmPublicV39RingAction(preview, ring)
          if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
          const revision = committed.head.saveRevision
          const result = checked(await write(revision, structuredClone(committed.lineage), ring),
            revision, ring, { ...action.progress, ...waystationFlags(preview),
              ...combatState(preview) })
          return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
        }
        const signal = decodePublicV38SignalWitness(raw)
        if (signal) {
          const action = confirmPublicV38SignalAction(preview, signal)
          if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
          const revision = committed.head.saveRevision
          const result = checked(await write(revision, structuredClone(committed.lineage), signal),
            revision, signal, { ...action.progress, ...ringFlags(preview),
              ...waystationFlags(preview), ...combatState(preview) })
          return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
        }
        const windward = decodePublicV37WindwardWitness(raw)
        if (!windward) {
          const result = await inherited().action(raw as InheritedAction)
          if (result.status === 'blocked') return freeze(result.reason)
          return result
        }
        const action = confirmPublicV37WindwardAction(preview, windward)
        if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
        const revision = committed.head.saveRevision
        const result = checked(await write(revision, structuredClone(committed.lineage), windward),
          revision, windward, { ...action.progress,
            signalVantageInspected: preview.signalVantageInspected,
            signalClaimed: preview.signalClaimed, ...ringFlags(preview),
            ...waystationFlags(preview), ...combatState(preview) })
        return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
      } catch { return freeze('storage-error') } finally { busy = false }
    },
  }
}
