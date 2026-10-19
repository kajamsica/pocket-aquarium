import type { ReadonlyWorldTile } from './activeWorldTerrain'
import { discoveredTileIdsInActiveWindow } from './publicV13DiscoveryWindow'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import { advancePublicV14BoundaryFrame, publicV14InsideGreenway } from './publicWorldV14Boundary'
import { createPublicV14ContinuousSession } from './publicWorldV14ContinuousSession'
import type { PublicV14ContinuousSession } from './publicWorldV14ContinuousSession'
import { advancePublicV15GreenwayFrame } from './publicWorldV15GreenwayFrame'
import { publicV15StarterSupportAt } from './publicWorldV15StarterMovement'
import { publicWorldV15StarterTileAtGrid } from './publicWorldV15StarterSites'
import { createFreshPublicV15Head, decodePublicV15Lineage,
  publicV15ToV14Lineage } from './publicWorldV15Snapshot'
import type { PublicV15Lineage } from './publicWorldV15Snapshot'
import { validatePublicV15Progress } from './publicWorldV15Validation'
import type { PublicV15Progress } from './publicWorldV15Validation'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { samePublicV14Value } from './publicWorldV14Validation'

export type PublicV15SessionStart = Readonly<PublicV15Progress & {
  saveRevision: number
  lineage: PublicV15Lineage
}>
export type PublicV15SaveReadiness =
  | Readonly<{ status: 'ready'; progress: PublicV15Progress }>
  | Readonly<{ status: 'needs-checked-commit'; progress: PublicV15Progress;
    boundaryTransitions: number }>
  | Readonly<{ status: 'deferred-airborne'; pendingBoundary: boolean }>
export type PublicV15SessionFrame = Readonly<{
  events: readonly PublicWorldEvent[]
  rejections: readonly PublicWorldRejection[]
}>
export interface PublicV15ContinuousSession {
  view(): Readonly<{ movementOwner: PublicV15Progress['state']['movementOwner']; tick: number;
    player: PublicV15Progress['state']['player']; activeKnownTileIds: readonly string[];
    activeTiles: readonly ReadonlyWorldTile[]; pendingBoundary: boolean }>
  advanceFrame(intents: readonly PublicWorldIntent[],
    options: { walkRequested: boolean }): PublicV15SessionFrame
  /** A detached preview may be airborne; it cannot authorize persistence. */
  previewSnapshot(): PublicV15Progress
  snapshotForSave(): PublicV15SaveReadiness
}

/** A v15-native local session. The unchanged outer stream owns only v14-valid terrain. */
export function createPublicV15ContinuousSession(start: PublicV15SessionStart): PublicV15ContinuousSession {
  const lineage = decodePublicV15Lineage(start?.lineage)
  if (!lineage || !Number.isSafeInteger(start.saveRevision) || start.saveRevision < 0
    || !validatePublicV15Progress({ state: start.state,
      starterWorks: start.starterWorks }, lineage.seed)
    || start.saveRevision === 0 && !samePublicV14Value(
      { state: start.state, starterWorks: start.starterWorks },
      { state: createFreshPublicV15Head(lineage.seed).head.state,
        starterWorks: { bridgeBuilt: false, bankCacheDug: false } })) {
    throw new RangeError('A validated v15 start is required.')
  }
  let progress: PublicV15Progress = structuredClone({ state: start.state,
    starterWorks: start.starterWorks })
  let boundaryTransitions = 0
  const starterTiles = progress.state.greenway.tiles.map((tile) =>
    publicWorldV15StarterTileAtGrid(lineage.seed, tile.center.x / 4, tile.center.z / 4))
  const v14Start = (state: PublicV15Progress['state']) => ({
    // This is an in-memory v14 terrain adapter, never a v15 persisted revision.
    // V14 revision zero means exact v14 genesis, not an advanced v15 frame.
    state, saveRevision: Math.max(1, start.saveRevision), bootstrap: null,
    lineage: publicV15ToV14Lineage(lineage),
  })
  let stream: PublicV14ContinuousSession | null = progress.state.movementOwner === 'streamed'
    ? createPublicV14ContinuousSession(v14Start(progress.state)) : null
  const reject = (intents: readonly PublicWorldIntent[], index: number,
    code: PublicWorldRejection['code'], message: string): PublicV15SessionFrame => ({
    events: [], rejections: [{ intentIndex: index,
      intentType: intents?.[index]?.type ?? 'move', code, message }],
  })

  return {
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
        'This session owns movement only; work actions require a checked writer.')
      if (progress.state.movementOwner === 'greenway') {
        const last = intents[intents.length - 1]
        if (last?.type === 'move') {
          const x = progress.state.player.position.x + last.delta?.x
          const z = progress.state.player.position.z + last.delta?.z
          if (Number.isFinite(x) && Number.isFinite(z) && !publicV14InsideGreenway({ x, z })) {
            const crossing = advancePublicV14BoundaryFrame(progress.state, intents, options)
            if (!crossing.candidate) return { events: [], rejections: crossing.rejections }
            if (!validatePublicV15Progress({ state: crossing.candidate,
              starterWorks: progress.starterWorks }, lineage.seed)) return reject(intents,
              intents.length - 1, 'terrain_missing', 'The v15 receiving owner rejected this crossing.')
            try {
              const receiving = createPublicV14ContinuousSession(v14Start(crossing.candidate))
              progress = { state: crossing.candidate, starterWorks: progress.starterWorks }
              stream = receiving
              boundaryTransitions++
              return { events: crossing.events, rejections: [] }
            } catch { return reject(intents, intents.length - 1, 'terrain_missing',
              'The receiving owner could not activate its bounded terrain.') }
          }
        }
        const frame = advancePublicV15GreenwayFrame(progress, intents, options)
        if (!frame.rejections.length) progress = frame.progress
        return { events: frame.events, rejections: frame.rejections }
      }
      if (!stream) throw new RangeError('The streamed owner is not active.')
      const frame = stream.advanceFrame(intents, options)
      if (frame.rejections.length) return frame
      const next = stream.previewSnapshot()
      const returned = next.movementOwner === 'greenway'
      progress = { state: next, starterWorks: progress.starterWorks }
      if (returned) {
        stream = null
        boundaryTransitions++
      }
      return frame
    },
    previewSnapshot: () => structuredClone(progress),
    snapshotForSave() {
      const { state, starterWorks } = progress
      const position = state.player.position
      const floor = state.movementOwner === 'greenway'
        ? publicV15StarterSupportAt({ seed: state.seed, profile: state.generationProfile,
          route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
          built: state.greenway.builtRouteIds.includes('greenway_ladder'), starterWorks }, position)?.floorY
        : resolvePublicV14Surface(state, position)?.floorY
      if (floor === undefined || position.y < floor - 1e-6) {
        throw new RangeError('The v15 player has no valid support.')
      }
      if (state.player.verticalVelocity !== 0 || position.y > floor + 1e-6) {
        return { status: 'deferred-airborne', pendingBoundary: boundaryTransitions > 0 }
      }
      if (!validatePublicV15Progress(progress, lineage.seed)) {
        throw new RangeError('The v15 grounded state failed proof.')
      }
      const checked = structuredClone(progress)
      return boundaryTransitions > 0
        ? { status: 'needs-checked-commit', progress: checked, boundaryTransitions }
        : { status: 'ready', progress: checked }
    },
  }
}
