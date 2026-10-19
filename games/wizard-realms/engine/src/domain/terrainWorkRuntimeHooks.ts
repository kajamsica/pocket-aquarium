import type { ReadonlyWorldTile } from './activeWorldTerrain'
import type { TerrainFacts } from './mireglassCachePitOverlay'
import { isValidTerrainWorkLedger } from './terrainWorkLedger'
import type { TerrainWorkLedger, TerrainWorkLedgerContext } from './terrainWorkLedger'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { resolveTerrainWorkSite } from './terrainWorks'
import type { TerrainWorkSite } from './terrainWorks'
import { createStreamedWorldFromState } from './streamedWorld'
import type { StreamedWorldRuntime, StreamedWorldState, StreamedWorldTrialHooks } from './streamedWorld'

type BuiltSite = Exclude<TerrainWorkSite, { kind: 'dig' }>
const STEP_LIMIT = 0.24

/** Shared geometry for the unsaved trial and validated persisted work ledger. */
export function createTerrainWorkRuntimeHooks(built: () => readonly BuiltSite[],
  dug: () => ReadonlySet<string>): { hooks: StreamedWorldTrialHooks; invalidateTiles(): void } {
  let effectiveTileCache = new WeakMap<ReadonlyWorldTile, ReadonlyWorldTile>()
  let activeBase: readonly ReadonlyWorldTile[] | null = null
  let activeEffective: readonly ReadonlyWorldTile[] | null = null
  const hooks: StreamedWorldTrialHooks = {
    barrier(from, to, authored) {
      if (Math.hypot(to.x - from.x, to.z - from.z) > STEP_LIMIT + 1e-9) return authored ?? 'fen_channel'
      for (const site of built()) {
        const start = terrainWorkSupportAt(site, from), end = terrainWorkSupportAt(site, to)
        if ((start.floorY === null) === (end.floorY === null)) continue
        const inside = start.floorY === null ? end : start
        if (inside.axis <= 0.05 || inside.axis >= 0.95) continue
        const outside = start.floorY === null ? start : end
        const throughEnd = (outside.axis < 0 || outside.axis > 1)
          && outside.lateralMeters <= site.widthMeters / 2 + 1e-9
        if (!throughEnd) return site.obstacle
      }
      if (authored && built().some((site) => site.obstacle === authored
        && terrainWorkSupportAt(site, from).floorY !== null
        && terrainWorkSupportAt(site, to).floorY !== null)) return null
      return authored
    },
    tile(base) {
      if (!dug().has(base.id)) return base
      let effective = effectiveTileCache.get(base)
      if (!effective) {
        effective = Object.freeze({ ...base,
          center: Object.freeze({ ...base.center, y: base.center.y - 0.24 }) })
        effectiveTileCache.set(base, effective)
      }
      return effective
    },
    activeTiles(base) {
      if (base !== activeBase || !activeEffective) {
        activeBase = base
        activeEffective = Object.freeze(base.map((tile) => hooks.tile(tile)))
      }
      return activeEffective
    },
    groundY(position, tile) {
      for (const site of built()) {
        const support = terrainWorkSupportAt(site, position)
        if (support.floorY !== null) return support.floorY
      }
      return tile.center.y
    },
    supportsStep(from, to) {
      return built().some((site) => terrainWorkSupportAt(site, from).floorY !== null
        && terrainWorkSupportAt(site, to).floorY !== null)
    },
  }
  return { hooks, invalidateTiles() {
    effectiveTileCache = new WeakMap()
    activeBase = null
    activeEffective = null
  } }
}

/** Unmounted v13-only rehydration. The caller must derive context from its validated state. */
export function createStreamedWorldV13FromState(snapshot: StreamedWorldState,
  ledger: TerrainWorkLedger, context: TerrainWorkLedgerContext,
  facts?: TerrainFacts): StreamedWorldRuntime {
  try {
    if (context.seed !== snapshot.seed || !isValidTerrainWorkLedger(ledger, context)) {
      throw new RangeError('Invalid terrain-work ledger.')
    }
    const ownedLedger = structuredClone(ledger) as TerrainWorkLedger
    const ownedContext = structuredClone(context) as TerrainWorkLedgerContext
    if (ownedContext.seed !== snapshot.seed || !isValidTerrainWorkLedger(ownedLedger, ownedContext)) {
      throw new RangeError('Invalid terrain-work ledger.')
    }
    const built = ownedLedger.builtWorkIds.map((id) => resolveTerrainWorkSite(snapshot.seed, id))
    if (built.some((site) => !site || site.kind === 'dig')) throw new RangeError('Invalid built work.')
    const sites = built as BuiltSite[]
    const dug = new Set(ownedLedger.dugTileIds)
    const { hooks } = createTerrainWorkRuntimeHooks(() => sites, () => dug)
    const world = createStreamedWorldFromState(snapshot, facts, hooks)
    return {
      get state() { return world.state },
      advance(intents, options) {
        let moved = false
        for (let index = 0; index < intents.length; index++) {
          if (intents[index].type !== 'move') continue
          if (moved) return { state: world.state, events: [], rejections: [
            { intentIndex: index, intentType: 'move', code: 'invalid_value' },
          ] }
          moved = true
        }
        return world.advance(intents, options)
      },
      tileAtWorld: (x, z) => world.tileAtWorld(x, z),
      activeTiles: () => world.activeTiles(),
      activeChunkCoordinates: () => world.activeChunkCoordinates(),
      activeChunkCount: () => world.activeChunkCount(),
    }
  } catch (error) {
    if (error instanceof RangeError) throw error
    throw new RangeError('Invalid terrain-work rehydration input.')
  }
}
