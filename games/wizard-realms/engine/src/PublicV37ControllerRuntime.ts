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
import type { PublicV36MarkerProgress } from './domain/publicWorldV36MarkerAction'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import { decodePublicV36Witness, PUBLIC_V36_SCHEMA } from './domain/publicWorldV36Snapshot'
import type { PublicV37Operation, PublicV37Start } from './domain/publicWorldV37Flow'
import { decodePublicV37Head, decodePublicV37Lineage, replayPublicV37Witness } from './domain/publicWorldV37Snapshot'
import type { PublicV37Witness } from './domain/publicWorldV37Snapshot'
import { previewPublicV37FrameBatch } from './domain/publicWorldV37Movement'
import { confirmPublicV37WindwardAction, decodePublicV37WindwardWitness } from './domain/publicWorldV37WindwardAction'

type Writer = (revision: number, lineage: PublicV37Start['lineage'], witness: PublicV37Witness) =>
  Promise<PublicV37Operation<PublicV37Start>>
type HomeWriter = (revision: number, lineage: PublicV37Start['lineage']) =>
  Promise<PublicV37Operation<PublicV37Start>>
type InheritedAction = Parameters<ReturnType<typeof createPublicV36ControllerRuntime>['action']>[0]
const progress = ({ head }: PublicV37Start): PublicV36MarkerProgress => {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness, ...value } = head
  return value
}

/** Inherited controls use a disposable V36 shell. Its lineage never reaches storage. */
function asV36(start: PublicV37Start): PublicV36Start {
  const { markerClaimReward: _marker, ...genesis } = start.lineage.genesis
  return { lineage: { origin: 'v35-migration', rulesProfile: 'old-marker/v1',
    seed: start.lineage.seed, sourceRevision: 0, genesis: structuredClone(genesis) },
  head: { ...structuredClone(start.head), schemaVersion: PUBLIC_V36_SCHEMA,
    saveRevision: start.head.saveRevision + 1,
    witness: decodePublicV36Witness(start.head.witness) ?? { kind: 'checkpoint' } } }
}

/** Preview and writer verify the same ordinary witnesses with V37's private movement policy. */
export function createPublicV37ControllerRuntime(initial: PublicV37Start,
  write: Writer, homeWrite?: HomeWriter) {
  let committed = structuredClone(initial), preview = progress(committed)
  let pending: PublicV14Frame[] = [], busy = false, blockedReason: string | null = null
  const grounded = (value: PublicV36MarkerProgress) => {
    const pose = projectPublicV31Pose(value)
    return value.state.player.verticalVelocity === 0 && !!pose
      && Math.abs(pose.effective.position.y - pose.effective.floorY) <= 1e-6
  }
  const freeze = (reason: string) => {
    blockedReason = reason
    return { status: 'blocked' as const, reason }
  }
  const checked = (reply: PublicV37Operation<PublicV37Start>, revision: number,
    witness: PublicV37Witness, expected: PublicV36MarkerProgress) => {
    if (!reply.ok) return reply
    try {
      const { head, lineage } = reply.value
      if (!exactPublicV23(reply.value, ['head', 'lineage'])
        || !decodePublicV37Lineage(lineage) || !decodePublicV37Head(head, lineage)
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
    const expected = witness && replayPublicV37Witness(progress(committed), witness)
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
      const expected = replayPublicV37Witness(progress(committed), witness)
      if (!expected) return { ok: false, reason: 'local-replay' }
      return checked(await write(revision, structuredClone(committed.lineage), witness), revision, witness, expected)
    }, homeWrite ? async (shellRevision) => {
      const revision = committed.head.saveRevision
      if (shellRevision !== revision + 1) return { ok: false, reason: 'revision-changed' }
      const reply = await homeWrite(revision, structuredClone(committed.lineage))
      if (!reply.ok) return reply
      const witness = decodePublicV36Witness(reply.value.head.witness)
      const expected = witness?.kind === 'return-home/v1'
        ? replayPublicV37Witness(progress(committed), witness) : null
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
    },
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean) {
      if (busy || blockedReason || pending.length >= PUBLIC_V14_MAX_FRAME_BATCH)
        return reject(intents, 'unavailable_here', 'Movement is paused for a checked write.')
      const frame = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: [{ intents, walkRequested }] })
      if (!frame) return reject(intents, 'invalid_frame', 'Invalid replayable frame.')
      const candidate = [...pending, frame.frames[0]]
      const next = previewPublicV37FrameBatch(progress(committed),
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
    async action(raw: InheritedAction | import('./domain/publicWorldV37WindwardAction').PublicV37WindwardWitness) {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      busy = true
      try {
        const saved = await flush()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
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
          revision, windward, action.progress)
        return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
      } catch { return freeze('storage-error') } finally { busy = false }
    },
  }
}
