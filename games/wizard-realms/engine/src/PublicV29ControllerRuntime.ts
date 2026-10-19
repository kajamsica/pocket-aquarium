import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import type { PublicV28Start } from './domain/publicWorldV28Flow'
import type { PublicV28Progress } from './domain/publicWorldV28Migration'
import type { PublicV28Witness } from './domain/publicWorldV28Snapshot'
import { applyPublicV26PitLadderAction } from './domain/publicWorldV26PitLadder'
import { applyPublicV26TerrainAction } from './domain/publicWorldV26TerrainAction'
import { applyPublicV29DeepDig } from './domain/publicWorldV29DeepDigAction'
import { applyPublicV29MineralSale } from './domain/publicWorldV29MineralSale'
import type { PublicV29Mineral } from './domain/publicWorldV29MineralSale'
import { applyPublicV29MiningToolAction } from './domain/publicWorldV29MiningTools'
import type { PublicV29Operation, PublicV29Start } from './domain/publicWorldV29Flow'
import type { PublicV29Progress } from './domain/publicWorldV29Migration'
import { replayPublicV28Witness } from './domain/publicWorldV28Snapshot'
import { decodePublicV29Witness, replayPublicV29Witness } from './domain/publicWorldV29Snapshot'
import type { PublicV29Witness } from './domain/publicWorldV29Snapshot'
import { WORLD_CELL_METERS } from './domain/worldChunks'
import { createPublicV28ControllerRuntime } from './PublicV28ControllerRuntime'

type Writer = (revision: number, lineage: PublicV29Start['lineage'], witness: PublicV29Witness,
  frameExpected?: PublicV29Progress) =>
  Promise<PublicV29Operation<PublicV29Start>>
type ReturnHomeWriter = (revision: number, lineage: PublicV29Start['lineage']) =>
  Promise<PublicV29Operation<PublicV29Start>>
type V28Action = Parameters<ReturnType<typeof createPublicV28ControllerRuntime>['action']>[0]
type NovelAction = Extract<PublicV29Witness, { kind: 'mining-tool/v1' | 'deep-dig' | 'sell-mineral/v1' }>
type V29CheckedAction = NovelAction | Extract<PublicV29Witness,
  { kind: 'terrain-action/v1' | 'pit-ladder/v1' }>
type Action = V28Action | NovelAction
export type PublicV29DigOutcome = Readonly<{ material: PublicV29Mineral | null;
  depthLayers: number }>
const materials: readonly PublicV29Mineral[] = ['soil', 'stone', 'iron_ore', 'gold_ore', 'diamond']
const digOutcome = (before: PublicV29Progress, after: PublicV29Progress,
  gx: number, gz: number): PublicV29DigOutcome | undefined => {
  const prior = before.terrain.columns.find((column) => column.gx === gx && column.gz === gz)
  const next = after.terrain.columns.find((column) => column.gx === gx && column.gz === gz)
  if (!next || next.openDepth !== (prior?.openDepth ?? 0) + 1) return undefined
  const gained = materials.filter((material) =>
    after.terrain.bag[material] === before.terrain.bag[material] + 1)
  const unchanged = materials.every((material) =>
    after.terrain.bag[material] === before.terrain.bag[material])
  if (next.rewardDepth === (prior?.rewardDepth ?? 0) + 1 && gained.length === 1
    && materials.every((material) => material === gained[0]
      || after.terrain.bag[material] === before.terrain.bag[material]))
    return { material: gained[0], depthLayers: next.openDepth }
  return next.rewardDepth === prior?.rewardDepth && unchanged
    ? { material: null, depthLayers: next.openDepth } : undefined
}
const progress = ({ head }: PublicV29Start): PublicV29Progress => ({
  state: head.state, greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
  terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs,
  riverBridgeIds: [...head.riverBridgeIds], miningTools: head.miningTools })
const v28Start = (start: PublicV29Start, witness: PublicV28Witness | null = null): PublicV28Start => ({
  lineage: structuredClone(start.lineage.sourceReceipt.lineage),
  head: { state: structuredClone(start.head.state),
    greenwayWorks: structuredClone(start.head.greenwayWorks),
    regionalWorks: structuredClone(start.head.regionalWorks),
    terrain: structuredClone(start.head.terrain), nextHomeAtMs: start.head.nextHomeAtMs,
    riverBridgeIds: [...start.head.riverBridgeIds], schemaVersion: 'wizard-world/v28',
    saveRevision: start.head.saveRevision, witness } })
const novel = (witness: PublicV29Witness): witness is NovelAction => witness.kind === 'deep-dig'
  || witness.kind === 'mining-tool/v1' || witness.kind === 'sell-mineral/v1'
const v29Checked = (witness: PublicV29Witness): witness is V29CheckedAction => novel(witness)
  || witness.kind === 'terrain-action/v1' || witness.kind === 'pit-ladder/v1'
const v26Progress = ({ state, greenwayWorks, regionalWorks, terrain,
  nextHomeAtMs }: PublicV29Progress) => ({ state, greenwayWorks, regionalWorks, terrain,
    nextHomeAtMs })
const localRejection = (before: PublicV29Progress, action: V29CheckedAction): string | null => {
  const checked = action.kind === 'terrain-action/v1'
    ? applyPublicV26TerrainAction(v26Progress(before), action.action)
    : action.kind === 'pit-ladder/v1'
      ? applyPublicV26PitLadderAction(v26Progress(before), action.action)
      : action.kind === 'deep-dig' ? applyPublicV29DeepDig(before, action)
    : action.kind === 'mining-tool/v1' ? applyPublicV29MiningToolAction(before, action.action)
      : applyPublicV29MineralSale(before, action)
  return checked.rejection ?? null
}
const cellAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const deepPitCue = (before: PublicV28Progress,
  move: Extract<PublicWorldIntent, { type: 'move' }>, walkRequested: boolean): string | null => {
  if (before.state.player.verticalVelocity !== 0
    || before.state.movementOwner === 'greenway' && before.greenwayWorks.builtLadderIds.length > 0
      && move.delta.z < 0) return null // V28 may guide north-ladder input before replay.
  const from = before.state.player.position
  const to = { x: from.x + move.delta.x, z: from.z + move.delta.z }
  const gx = cellAt(to.x), gz = cellAt(to.z)
  if (gx === cellAt(from.x) && gz === cellAt(from.z)) return null
  const column = before.terrain.columns.find((entry) => entry.gx === gx && entry.gz === gz)
  if (!column || column.openDepth < 2 || column.pitLadder
    || before.terrain.columns.some((entry) => entry.pitLadder
      && entry.gx === cellAt(from.x) && entry.gz === cellAt(from.z))) return null
  const shallow = { ...before, terrain: { ...before.terrain,
    columns: before.terrain.columns.map((entry) => entry === column
      ? { ...entry, openDepth: 1 } : entry) } }
  const accepted = replayPublicV28Witness(shallow, { kind: 'frame-batch/v1',
    frames: [{ intents: [move], walkRequested }] })
  if (!accepted || Math.hypot(accepted.state.player.position.x - to.x,
    accepted.state.player.position.z - to.z) > 1e-6) return null
  const needed = column.openDepth - 1, missing = Math.max(0, needed - before.terrain.bag.soil)
  const lead = `This saved pit is ${column.openDepth} layers deep; this step cannot enter it.`
  const ownsSpade = before.state.player.inventory.some((stack) => stack.itemId === 'field_spade'
    && stack.quantity > 0)
  if (missing) return `${lead} Gather ${missing} more soil elsewhere, then check your spade and reach before trying Fill.`
  const fill = applyPublicV26TerrainAction({ state: before.state,
    greenwayWorks: before.greenwayWorks, regionalWorks: before.regionalWorks,
    terrain: before.terrain, nextHomeAtMs: before.nextHomeAtMs },
  { kind: 'fill', gx, gz })
  if (fill.rejection === 'requires_tool')
    return `${lead} You have enough soil. ${ownsSpade ? 'Equip your spade' : 'Buy and equip a spade at Outfitters'}, then use Fill ${needed} ${needed === 1 ? 'time' : 'times'} from within reach.`
  if (fill.rejection) return `${lead} You have enough soil, but Fill is not ready from this position. Check your footing and reach, or take another route.`
  return `${lead} Use Fill ${needed} ${needed === 1 ? 'time' : 'times'} to leave one layer, step in, then deepen it from inside.`
}

/** V28 travel is adapted in memory, but every persisted write is a checked V29 witness. */
export function createPublicV29ControllerRuntime(initial: PublicV29Start, write: Writer,
  returnHomeWrite?: ReturnHomeWriter) {
  let committed = structuredClone(initial)
  let blockedReason: string | null = null
  let novelBusy = false
  const freeze = (reason: string) => {
    blockedReason = reason
    return { status: 'blocked' as const, reason }
  }
  const checkedReply = (reply: PublicV29Operation<PublicV29Start>, revision: number,
    witness: PublicV29Witness, expected: PublicV29Progress) => {
    if (!reply.ok) return { ok: false as const, reason: reply.reason }
    try {
      if (reply.value.head.schemaVersion !== 'wizard-world/v29'
        || reply.value.head.saveRevision !== revision + 1
        || !samePublicV14Value(reply.value.lineage, committed.lineage)
        || !samePublicV14Value(reply.value.head.witness, witness)
        || !samePublicV14Value(progress(reply.value), expected))
        return { ok: false as const, reason: 'writer-mismatch' }
      committed = structuredClone(reply.value)
      return { ok: true as const, value: v28Start(committed,
        novel(witness) ? null : witness) }
    } catch { return { ok: false as const, reason: 'writer-mismatch' } }
  }
  const makeCore = () => createPublicV28ControllerRuntime(v28Start(committed),
    async (revision, _lineage, witness, frameExpected) => {
      const before = progress(committed)
      let checkedFrame: PublicV29Progress | null = null
      if (witness.kind === 'frame-batch/v1' && revision === committed.head.saveRevision
        && frameExpected) {
        try {
          if (samePublicV14Value(frameExpected, core.preview())) {
            const activePick = frameExpected.state.player.equipment.mainHand === null
              ? before.miningTools.activePick : null
            checkedFrame = { ...frameExpected,
              miningTools: { ...before.miningTools, activePick } }
          }
        } catch { /* A malformed private proof takes the ordinary replay path. */ }
      }
      const expected = checkedFrame ?? replayPublicV29Witness(before, witness)
      if (!expected || revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'local-replay' }
      try {
        const lineage = structuredClone(committed.lineage), savedWitness = structuredClone(witness)
        const reply = checkedFrame ? await write(revision, lineage, savedWitness,
          structuredClone(checkedFrame)) : await write(revision, lineage, savedWitness)
        return checkedReply(reply, revision, witness, expected)
      }
      catch { return { ok: false as const, reason: 'storage-error' } }
    }, returnHomeWrite ? async (revision) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      try {
        const reply = await returnHomeWrite(revision, structuredClone(committed.lineage))
        if (!reply.ok) return reply
        const witness = decodePublicV29Witness(reply.value.head.witness)
        const expected = witness?.kind === 'return-home/v1'
          ? replayPublicV29Witness(progress(committed), witness) : null
        return witness && expected ? checkedReply(reply, revision, witness, expected)
          : { ok: false as const, reason: 'writer-mismatch' }
      } catch { return { ok: false as const, reason: 'storage-error' } }
    } : undefined)
  let core = makeCore()
  let pitCueCache: { key: string; rejection: string; message: string | null } | null = null
  return {
    committed: () => structuredClone(committed),
    preview: (): PublicV29Progress => ({ ...core.preview(),
      miningTools: structuredClone(committed.head.miningTools) }),
    view: () => core.view(),
    status: () => blockedReason ? { ...core.status(), gate: 'blocked' as const, blockedReason }
      : novelBusy ? { ...core.status(), gate: 'barrier' as const } : core.status(),
    idleFrameNeeded: () => blockedReason !== null || novelBusy || core.idleFrameNeeded(),
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean) {
      if (blockedReason || novelBusy) { pitCueCache = null
        return { events: [], rejections: [{ intentIndex: 0,
          intentType: intents[0]?.type ?? 'move' as const, code: 'unavailable_here' as const,
          message: 'Movement is paused for a checked write.' }] } }
      const result = core.advanceFrame(intents, walkRequested)
      const move = intents[0]
      if (intents.length !== 1 || move?.type !== 'move'
        || result.rejections.length !== 1 || result.rejections[0].code !== 'terrain_missing') {
        pitCueCache = null; return result
      }
      const before = core.preview(), pose = before.state.player
      const key = `${pose.position.x}:${pose.position.y}:${pose.position.z}:` +
        `${pose.verticalVelocity}:${move.delta.x}:${move.delta.z}:${walkRequested}`
      const rejection = result.rejections[0].message
      const message = pitCueCache?.key === key && pitCueCache.rejection === rejection
        ? pitCueCache.message : deepPitCue(before, move, walkRequested)
      pitCueCache = { key, rejection, message }
      return message ? { ...result,
        rejections: [{ ...result.rejections[0], message }] } : result
    },
    save: () => { pitCueCache = null; return blockedReason ? Promise.resolve(freeze(blockedReason))
      : novelBusy ? Promise.resolve({ status: 'busy' as const }) : core.save() },
    returnHome: () => { pitCueCache = null
      return blockedReason ? Promise.resolve(freeze(blockedReason))
        : novelBusy ? Promise.resolve({ status: 'busy' as const }) : core.returnHome() },
    async action(raw: Action) {
      pitCueCache = null
      if (blockedReason) return freeze(blockedReason)
      if (novelBusy) return { status: 'busy' as const }
      const witness = decodePublicV29Witness(raw)
      if (!witness || witness.kind === 'checkpoint' || witness.kind === 'frame-batch/v1'
        || witness.kind === 'return-home/v1') return { status: 'rejected' as const,
          reason: 'invalid-action' }
      if (!v29Checked(witness)) return core.action(witness as V28Action)
      novelBusy = true
      try {
        const saved = await core.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const before = progress(committed)
        const rejection = localRejection(before, witness)
        if (rejection) return { status: 'rejected' as const, reason: rejection }
        const expected = replayPublicV29Witness(before, witness)
        if (!expected) return freeze('local-replay')
        const revision = committed.head.saveRevision
        const reply = await write(revision, structuredClone(committed.lineage),
          structuredClone(witness))
        const checked = checkedReply(reply, revision, witness, expected)
        if (!checked.ok) return freeze(checked.reason)
        const outcome = witness.kind === 'deep-dig' ? digOutcome(before, progress(committed),
          witness.gx, witness.gz)
          : witness.kind === 'terrain-action/v1' && witness.action.kind === 'dig'
            ? digOutcome(before, progress(committed), witness.action.gx, witness.action.gz)
            : undefined
        core = makeCore()
        return { status: 'saved' as const, events: [], resetWalkRequested: false,
          ...(outcome ? { digOutcome: outcome } : {}) }
      } catch { return freeze('storage-error') }
      finally { novelBusy = false }
    },
  }
}
