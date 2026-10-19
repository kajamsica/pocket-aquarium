import { enumerateTerrainWorkSites } from './terrainWorks'
import type { TerrainWorkSite } from './terrainWorks'
import { confirmTerrainWorkTrial, createTerrainWorkTrialState,
  previewTerrainWorkTrial, resolveBuiltTerrainWorkTrialSites } from './terrainWorkTrial'
import type { BuiltTerrainWorkTrialSite, TerrainWorkTrialPreview,
  TerrainWorkTrialResult, TerrainWorkTrialState } from './terrainWorkTrial'
import { createTerrainWorkRuntimeHooks } from './terrainWorkRuntimeHooks'
import { publicV11Gait } from './publicWorldGait'
import { createStreamedWorld } from './streamedWorld'
import type { StreamedWorldRuntime } from './streamedWorld'
import { WORLD_CELL_METERS } from './worldChunks'

export interface StreamedTerrainWorkTrialRuntime extends StreamedWorldRuntime {
  readonly trialState: TerrainWorkTrialState
  readonly bootsEquipped: boolean
  readonly gait: ReturnType<typeof publicV11Gait>
  toggleFootwear(): void
  toggleWalk(): void
  preview(id: string): TerrainWorkTrialPreview
  confirm(id: string): TerrainWorkTrialResult
  nearbyCandidates(): readonly TerrainWorkSite[]
  builtSites(): readonly BuiltTerrainWorkTrialSite[]
}

type GroundPoint = { x: number; z: number }
const CANDIDATE_RADIUS = 16
const gridAtWorld = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)

export function terrainWorkTrialRequested(search: string, development: boolean): boolean {
  const query = new URLSearchParams(search)
  return development && query.get('devRegion') === 'streamed' && query.get('trial') === 'works'
}

/** Trial-only streamed runtime. No public profile or durable snapshot includes its ledger. */
export function createStreamedTerrainWorkTrial(seed: string,
  start: GroundPoint = { x: -288, z: 288 }): StreamedTerrainWorkTrialRuntime {
  let trialState = createTerrainWorkTrialState()
  let built: readonly BuiltTerrainWorkTrialSite[] = []
  let dug = new Set<string>()
  let bootsEquipped = false
  let walkRequested = false
  const gait = () => publicV11Gait(bootsEquipped ? 'leather_boots' : null, walkRequested)
  const workHooks = createTerrainWorkRuntimeHooks(() => built, () => dug)
  const { hooks } = workHooks
  const world = createStreamedWorld(seed, start, undefined, hooks, true)
  const authority = () => ({ seed: world.state.seed, position: world.state.player.position,
    discoveredTileIds: world.state.discoveredTileIds, fieldCampTileIds: [], authoredBuiltRouteIds: [] })
  let windowKey = ''
  let enumerated: readonly TerrainWorkSite[] = []
  let summaryDiscovery: readonly string[] | null = null
  let summaryLedger: TerrainWorkTrialState | null = null
  let summaryWindow = ''
  let discoveredSites: readonly TerrainWorkSite[] = []

  return {
    get state() { return world.state },
    get trialState() { return trialState },
    get bootsEquipped() { return bootsEquipped },
    get gait() { return gait() },
    toggleFootwear() { bootsEquipped = !bootsEquipped; walkRequested = false },
    toggleWalk() { if (bootsEquipped) walkRequested = !walkRequested },
    advance(intents, options) {
      let moved = false
      for (let index = 0; index < intents.length; index++) {
        const intent = intents[index]
        if (intent.type !== 'move') continue
        if (moved || Math.hypot(intent.delta.x, intent.delta.z) > gait().metersPerStep + 1e-9) {
          return { state: world.state, events: [], rejections: [
            { intentIndex: index, intentType: 'move', code: 'invalid_value' },
          ] }
        }
        moved = true
      }
      return world.advance(intents, options)
    },
    tileAtWorld: (x, z) => world.tileAtWorld(x, z),
    activeTiles: () => world.activeTiles(),
    activeChunkCoordinates: () => world.activeChunkCoordinates(),
    activeChunkCount: () => world.activeChunkCount(),
    preview: (id) => previewTerrainWorkTrial(trialState, authority(), id),
    confirm(id) {
      const result = confirmTerrainWorkTrial(trialState, authority(), id)
      if (!result.event) return result
      trialState = result.state
      built = resolveBuiltTerrainWorkTrialSites(trialState, world.state.seed) ?? []
      if (result.event.type === 'terrain_work_dug') {
        dug = new Set(trialState.dugTileIds)
        workHooks.invalidateTiles()
      }
      return result
    },
    nearbyCandidates() {
      const { x, z } = world.state.player.position
      const gx = gridAtWorld(x), gz = gridAtWorld(z)
      const nextWindow = `${gx}:${gz}`
      if (nextWindow !== windowKey) {
        windowKey = nextWindow
        enumerated = enumerateTerrainWorkSites(world.state.seed,
          { minGX: gx - 7, maxGX: gx + 8, minGZ: gz - 7, maxGZ: gz + 8 })
      }
      if (summaryWindow !== windowKey || summaryDiscovery !== world.state.discoveredTileIds
        || summaryLedger !== trialState) {
        const discovered = new Set(world.state.discoveredTileIds)
        const done = new Set([...trialState.builtWorkIds, ...trialState.dugTileIds])
        discoveredSites = enumerated.filter((site) => !done.has(site.id)
          && discovered.has(site.kind === 'dig' ? site.footprintTileIds[0] : site.footprintTileIds[1]))
        summaryWindow = windowKey
        summaryDiscovery = world.state.discoveredTileIds
        summaryLedger = trialState
      }
      return discoveredSites.filter((site) => {
        const target = site.kind === 'dig' ? site.center : site.from
        return Math.hypot(target.x - x, target.z - z) <= CANDIDATE_RADIUS
      })
    },
    builtSites: () => built,
  }
}
