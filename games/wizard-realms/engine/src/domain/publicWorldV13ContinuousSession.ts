import { MIREGLASS_RING_ID } from './mireglassContent'
import { legacyMovementEnvelope } from './publicWorldV6'
import { advancePublicV13OutboundBoundary, advancePublicV13ReturnBoundary } from './publicWorldV13Boundary'
import type { PublicV13Start } from './publicWorldV13Flow'
import { createPublicV13GreenwaySession } from './publicWorldV13GreenwayFrame'
import type { PublicV13GreenwaySession } from './publicWorldV13GreenwayFrame'
import { decodePublicV13Head, decodePublicV13SourceLineage, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import { createPublicV13StreamSession } from './publicWorldV13Stream'
import type { PublicV13StreamEvent, PublicV13StreamIntent, PublicV13StreamSession } from './publicWorldV13Stream'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'

type State = PublicV13Head['state']
type Active = { owner: 'greenway'; session: PublicV13GreenwaySession }
  | { owner: 'streamed'; session: PublicV13StreamSession }
type Event = PublicWorldEvent | PublicV13StreamEvent
type Result = Readonly<{ events: readonly Event[]; rejections: readonly PublicWorldRejection[] }>
type View = Readonly<{ movementOwner: 'greenway' } & ReturnType<PublicV13GreenwaySession['view']>>
  | Readonly<{ movementOwner: 'streamed' } & ReturnType<PublicV13StreamSession['view']>>

export interface PublicV13ContinuousSession {
  view(): View
  advanceFrame(intents: readonly PublicWorldIntent[], options: { walkRequested: boolean }): Result
  snapshotForSave(): State
  previewSnapshot(): State
}

/** One unmounted owner. A successful commit requires construction from the returned saved start. */
export function createPublicV13ContinuousSession(start: PublicV13Start): PublicV13ContinuousSession {
  const lineage = decodePublicV13SourceLineage(start?.sourceLineage)
  const head = lineage && decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: start.saveRevision, bootstrap: start.bootstrap, state: start.state }, lineage)
  if (!head) throw new RangeError('Invalid continuous v13 start.')
  const base: PublicV13Start = { state: head.state, bootstrap: head.bootstrap,
    saveRevision: head.saveRevision, sourceLineage: lineage }
  const envelope = legacyMovementEnvelope({ generationProfile: head.state.generationProfile,
    tiles: head.state.greenway.tiles })
  const inside = (x: number, z: number) => x >= envelope.minX && x <= envelope.maxX
    && z >= envelope.minZ && z <= envelope.maxZ
  let active: Active = head.state.movementOwner === 'greenway'
    ? { owner: 'greenway', session: createPublicV13GreenwaySession(base) }
    : { owner: 'streamed', session: createPublicV13StreamSession(base) }
  const reject = (index: number, intent: PublicWorldIntent | undefined,
    code: PublicWorldRejection['code'], message: string): Result => ({ events: [],
      rejections: [{ intentIndex: index, intentType: intent?.type ?? 'move', code, message }] })

  return {
    view() {
      return active.owner === 'greenway'
        ? { movementOwner: 'greenway', ...active.session.view() }
        : { movementOwner: 'streamed', ...active.session.view() }
    },
    advanceFrame(intents, options) {
      if (!Array.isArray(intents) || typeof options?.walkRequested !== 'boolean') {
        throw new RangeError('Invalid continuous v13 frame.')
      }
      const malformed = intents.findIndex((intent) => !intent || typeof intent !== 'object'
        || typeof intent.type !== 'string')
      if (malformed >= 0) return reject(malformed, intents[malformed], 'invalid_frame',
        'A fixed frame requires a valid intent.')
      if (intents.length > 2 || intents.length === 2
        && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')) {
        const index = Math.min(1, intents.length - 1)
        return reject(index, intents[index], 'invalid_frame',
          'A fixed frame accepts at most one look followed by one move.')
      }
      const sole = intents.length === 1 ? intents[0] : null
      if (sole?.type === 'teleport_fairy_ring'
        && (active.owner === 'streamed' || sole.sourceRingId === MIREGLASS_RING_ID
          || sole.targetRingId === MIREGLASS_RING_ID)) {
        return reject(0, sole, 'unavailable_here', 'Cross-region fairy travel is not yet available.')
      }
      const moveIndex = intents.length - 1
      const move = intents[moveIndex]
      if (move?.type === 'move') {
        const { x, z, y = 0 } = move.delta ?? {}
        if (![x, z, y].every(Number.isFinite) || y !== 0) {
          return reject(moveIndex, move, 'invalid_value', 'Movement must be finite and horizontal.')
        }
        const position = active.session.view().player.position
        const target = { x: position.x + x, z: position.z + z }
        const crossing = active.owner === 'greenway'
          ? !inside(target.x, target.z) : inside(target.x, target.z)
        if (crossing) {
          const before = active.session.snapshotForSave()
          const result = active.owner === 'greenway'
            ? advancePublicV13OutboundBoundary(base, before, intents, options)
            : advancePublicV13ReturnBoundary(base, before, intents, options)
          if (result.candidate === null) return { events: [], rejections: result.rejections }
          try {
            const receiving: Active = active.owner === 'greenway'
              ? { owner: 'streamed', session: createPublicV13StreamSession(base, result.candidate) }
              : { owner: 'greenway', session: createPublicV13GreenwaySession(base, result.candidate) }
            active = receiving
          } catch (error) {
            if (!(error instanceof RangeError)) throw error
            return reject(moveIndex, move, 'terrain_missing', 'The receiving region rejected this crossing.')
          }
          return { events: structuredClone(result.events), rejections: [] }
        }
      }
      if (active.owner === 'greenway') return active.session.advance(intents, options)
      const unavailableIndex = intents.findIndex((intent) => intent.type !== 'move'
        && intent.type !== 'look' && intent.type !== 'jump' && intent.type !== 'cast_spell')
      if (unavailableIndex >= 0) return reject(unavailableIndex, intents[unavailableIndex],
        'unavailable_here', 'This action is not available on streamed terrain.')
      const streamed: PublicV13StreamIntent[] = intents.map((intent) => intent.type === 'move'
        ? { type: 'move', delta: { x: intent.delta.x, z: intent.delta.z } }
        : intent.type === 'look'
          ? { type: 'look', yawDelta: intent.yawDelta, pitchDelta: intent.pitchDelta }
          : intent.type === 'cast_spell' ? { type: 'cast_spell', spellId: intent.spellId }
            : { type: 'jump' })
      const result = active.session.advance(streamed, options)
      return { events: result.events, rejections: result.rejections.map((entry) => ({ ...entry,
        message: `Streamed frame rejected: ${entry.code}.` })) }
    },
    snapshotForSave() { return active.session.snapshotForSave() },
    previewSnapshot() { return active.session.previewSnapshot() },
  }
}
