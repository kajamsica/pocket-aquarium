import type { ReadonlyWorldTile } from './activeWorldTerrain'
import { discoveredTileIdsInActiveWindow } from './publicV13DiscoveryWindow'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import { advancePublicV14BoundaryFrame, publicV14InsideGreenway } from './publicWorldV14Boundary'
import { createPublicV14ContinuousSession } from './publicWorldV14ContinuousSession'
import type { PublicV14ContinuousSession } from './publicWorldV14ContinuousSession'
import type { PublicV14Start } from './publicWorldV14Flow'
import type { PublicV14FrameWitness } from './publicWorldV14Snapshot'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { advancePublicV17GreenwayFrame } from './publicWorldV17GreenwayFrame'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { publicV17StarterAdvanceMove, publicV17StarterPoseValid,
  publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import type { PublicV17GroundStepPolicy } from './publicWorldV17StarterMovement'
import { createFreshPublicV17Lineage, decodePublicV17Head, decodePublicV17Lineage,
  PUBLIC_V17_SCHEMA } from './publicWorldV17Snapshot'
import type { PublicV17Head, PublicV17Lineage } from './publicWorldV17Snapshot'
import { decodePublicV17Progress } from './publicWorldV17Validation'
import type { PublicV17Progress } from './publicWorldV17Validation'
import { starterCliffSupportAt } from './starterCliffMovement'

export type PublicV17SessionStart = Readonly<PublicV17Progress & {
  saveRevision: number
  lineage: PublicV17Lineage
}>
export type PublicV17SaveReadiness =
  | Readonly<{ status: 'ready'; progress: PublicV17Progress }>
  | Readonly<{ status: 'needs-checked-commit'; progress: PublicV17Progress;
    boundaryTransitions: number }>
  | Readonly<{ status: 'deferred-airborne'; pendingBoundary: boolean }>
export type PublicV17SessionFrame = Readonly<{
  events: readonly PublicWorldEvent[]
  rejections: readonly PublicWorldRejection[]
}>
export interface PublicV17ContinuousSession {
  poseSnapshot(): { tick: number; position: { x: number; y: number; z: number }; yaw: number }
  view(): Readonly<{ movementOwner: PublicV17Progress['state']['movementOwner']; tick: number;
    player: PublicV17Progress['state']['player']; activeKnownTileIds: readonly string[];
    activeTiles: readonly ReadonlyWorldTile[]; pendingBoundary: boolean }>
  advanceFrame(intents: readonly PublicWorldIntent[],
    options: { walkRequested: boolean }): PublicV17SessionFrame
  previewSnapshot(): PublicV17Progress
  snapshotForSave(): PublicV17SaveReadiness
}

/** Native v17 Greenway movement; unchanged streamed terrain uses the v14 owner. */
export function createPublicV17ContinuousSession(start: PublicV17SessionStart,
  policy?: PublicV17GroundStepPolicy): PublicV17ContinuousSession {
  const lineage = decodePublicV17Lineage(start?.lineage)
  const head = lineage && decodePublicV17Head({ schemaVersion: PUBLIC_V17_SCHEMA,
    saveRevision: start?.saveRevision, bootstrap: null, state: start?.state,
    greenwayWorks: start?.greenwayWorks }, lineage)
  if (!lineage || !head) {
    throw new RangeError('A validated v17 start is required.')
  }
  return createSession({ state: head.state, greenwayWorks: head.greenwayWorks },
    lineage, start.saveRevision, policy)
}

/** @internal Only V23's first, already-decoded ordinary Greenway frame may use this. */
export function createPublicV17SessionFromDecodedV23(progress: PublicV17Progress,
  expectedSeed: string, saveRevision: number,
  policy?: PublicV17GroundStepPolicy): PublicV17ContinuousSession {
  if (typeof expectedSeed !== 'string' || !expectedSeed || expectedSeed.length > 128
    || saveRevision !== 1 || progress?.state?.seed !== expectedSeed
    || progress.state.movementOwner !== 'greenway') {
    throw new RangeError('A decoded V23 Greenway frame is required.')
  }
  const lineage = createFreshPublicV17Lineage(expectedSeed)
  const owned = structuredClone(progress)
  if (owned.state.seed !== expectedSeed || owned.state.movementOwner !== 'greenway') {
    throw new RangeError('A decoded V23 Greenway frame is required.')
  }
  return createSession(owned, lineage, saveRevision, policy)
}

function createSession(initial: PublicV17Progress, lineage: PublicV17Lineage,
  saveRevision: number, policy?: PublicV17GroundStepPolicy): PublicV17ContinuousSession {
  let progress = initial
  let boundaryTransitions = 0
  const starterTiles = progress.state.greenway.tiles.map((tile) =>
    publicWorldV16TileAtGrid(lineage.seed, tile.center.x / 4, tile.center.z / 4))
  const v14Start = (state: PublicV17Progress['state']): PublicV14Start => ({
    state, saveRevision: Math.max(1, saveRevision), bootstrap: null,
    lineage: { origin: 'fresh' as const, seed: lineage.seed,
      generationProfile: lineage.generationProfile },
  })
  let stream: PublicV14ContinuousSession | null = progress.state.movementOwner === 'streamed'
    ? createPublicV14ContinuousSession(v14Start(progress.state), policy) : null
  const reject = (intents: readonly PublicWorldIntent[], index: number,
    code: PublicWorldRejection['code'], message: string): PublicV17SessionFrame => ({
    events: [], rejections: [{ intentIndex: index,
      intentType: intents?.[index]?.type ?? 'move', code, message }],
  })
  const movementContext = (current: PublicV17Progress) => ({
    seed: current.state.seed, profile: current.state.generationProfile,
    route: current.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: current.state.greenway.builtRouteIds.includes('greenway_ladder'),
    greenwayWorks: current.greenwayWorks,
  })

  return {
    poseSnapshot() {
      const { tick, player } = progress.state
      return { tick, position: { ...player.position }, yaw: player.yaw }
    },
    view() {
      const { state } = progress
      const activeTiles = state.movementOwner === 'greenway'
        ? starterTiles : stream?.view().activeTiles ?? []
      return { movementOwner: state.movementOwner, tick: state.tick,
        player: structuredClone(state.player), activeKnownTileIds:
          discoveredTileIdsInActiveWindow(state.discoveryMask, state.player.position),
        activeTiles: structuredClone(activeTiles), pendingBoundary: boundaryTransitions > 0 }
    },
    advanceFrame(intents, options) {
      if (!Array.isArray(intents) || typeof options?.walkRequested !== 'boolean'
        || intents.length > 2 || intents.length === 2
          && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')) {
        return reject(intents, 0, 'invalid_frame',
          'A frame accepts one action or a look followed by a move.')
      }
      const unsupported = intents.findIndex((intent) => !intent
        || !['look', 'move', 'jump'].includes(intent.type))
      if (unsupported >= 0) return reject(intents, unsupported, 'unavailable_here',
        'This session owns movement only; work requires a checked writer.')
      if (progress.state.movementOwner === 'greenway') {
        const last = intents[intents.length - 1]
        if (last?.type === 'move') {
          const x = progress.state.player.position.x + last.delta?.x
          const z = progress.state.player.position.z + last.delta?.z
          if (Number.isFinite(x) && Number.isFinite(z) && !publicV14InsideGreenway({ x, z })) {
            const context = movementContext(progress)
            const from = progress.state.player.position
            if (!publicV17StarterPoseValid(context, from, progress.state.player.verticalVelocity)) {
              return reject(intents, intents.length - 1, 'airborne',
                'Land on actual v17 support before changing regions.')
            }
            const oldFloor = starterCliffSupportAt(context, from)?.floorY
            if (oldFloor === undefined) return reject(intents, intents.length - 1,
              'terrain_missing', 'The old boundary support is missing.')
            const projected = { ...progress.state, player: { ...progress.state.player,
              position: { ...from, y: oldFloor } } }
            const crossing = advancePublicV14BoundaryFrame(projected, intents, options, policy)
            if (!crossing.candidate) return { events: [], rejections: crossing.rejections }
            const actual = publicV17StarterAdvanceMove(context, from,
              crossing.candidate.player.position, 0, policy)
            if (!actual.accepted || Math.abs(actual.position.y
              - crossing.candidate.player.position.y) > 1e-6) {
              return reject(intents, intents.length - 1, 'terrain_missing',
                'The actual v17 crossing has no receiving support.')
            }
            const next = decodePublicV17Progress({ state: crossing.candidate,
              greenwayWorks: progress.greenwayWorks }, lineage.seed)
            if (!next) return reject(intents, intents.length - 1, 'terrain_missing',
              'The v17 receiving owner rejected this crossing.')
            try {
              const receiving = createPublicV14ContinuousSession(v14Start(next.state), policy)
              progress = next
              stream = receiving
              boundaryTransitions++
              return { events: crossing.events, rejections: [] }
            } catch { return reject(intents, intents.length - 1, 'terrain_missing',
              'The receiving owner could not activate its bounded terrain.') }
          }
        }
        const frame = advancePublicV17GreenwayFrame(progress, intents, options, policy)
        if (!frame.rejections.length) progress = frame.progress
        return { events: frame.events, rejections: frame.rejections }
      }
      if (!stream) throw new RangeError('The streamed owner is not active.')
      const old = progress
      const frame = stream.advanceFrame(intents, options)
      if (frame.rejections.length) return frame
      const state = stream.previewSnapshot()
      if (state.movementOwner === 'greenway') {
        const actual = publicV17StarterAdvanceMove(movementContext(old),
          old.state.player.position, state.player.position, 0, policy)
        const receiving = actual.accepted ? { ...state, player: { ...state.player,
          position: actual.position } } : null
        const next = receiving && decodePublicV17Progress({ state: receiving,
          greenwayWorks: old.greenwayWorks }, lineage.seed)
        if (!next) {
          stream = createPublicV14ContinuousSession(v14Start(old.state), policy)
          return reject(intents, intents.length - 1, 'terrain_missing',
            'The v17 Greenway rejected this return.')
        }
        progress = next
        stream = null
        boundaryTransitions++
        return { events: frame.events.map((event) => event.type === 'player_moved'
          ? { ...event, position: { ...next.state.player.position } } : event), rejections: [] }
      } else progress = { state, greenwayWorks: old.greenwayWorks }
      return frame
    },
    previewSnapshot: () => structuredClone(progress),
    snapshotForSave() {
      const { state, greenwayWorks } = progress
      const position = state.player.position
      const floor = state.movementOwner === 'greenway'
        ? publicV17StarterSupportAt({ seed: state.seed, profile: state.generationProfile,
          route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
          built: state.greenway.builtRouteIds.includes('greenway_ladder'),
          greenwayWorks }, position)?.floorY
        : resolvePublicV14Surface(state, position)?.floorY
      if (floor === undefined || position.y < floor - 1e-6) {
        throw new RangeError('The v17 player has no valid support.')
      }
      if (state.player.verticalVelocity !== 0 || position.y > floor + 1e-6) {
        return { status: 'deferred-airborne', pendingBoundary: boundaryTransitions > 0 }
      }
      const checked = decodePublicV17Progress(progress, lineage.seed)
      if (!checked) throw new RangeError('The v17 grounded state failed proof.')
      return boundaryTransitions > 0
        ? { status: 'needs-checked-commit', progress: checked, boundaryTransitions }
        : { status: 'ready', progress: checked }
    },
  }
}

/** Replay a bounded witness through the same session used for local movement. */
export function replayPublicV17Frames(before: PublicV17Head, lineage: PublicV17Lineage,
  witness: PublicV14FrameWitness): { next: PublicV17Progress; events: PublicWorldEvent[] } | null {
  try {
    const session = createPublicV17ContinuousSession({ state: before.state,
      greenwayWorks: before.greenwayWorks, saveRevision: before.saveRevision, lineage })
    const events: PublicWorldEvent[] = []
    for (const frame of witness.frames) {
      const result = session.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
      if (result.rejections.length) return null
      events.push(...result.events)
    }
    const saved = session.snapshotForSave()
    return saved.status === 'deferred-airborne' ? null
      : { next: saved.progress, events }
  } catch { return null }
}
