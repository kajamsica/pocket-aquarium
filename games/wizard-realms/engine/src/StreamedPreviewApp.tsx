import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createStreamedWorld,
  MIREGLASS_CORE,
  mireglassRouteSites,
  type ReadonlyWorldTile,
  type StreamedWorldIntent,
  type StreamedWorldRejection,
  type StreamedWorldRuntime,
  type StreamedWorldState,
} from './domain'
import { highlandRidgeCellAt } from './domain/highlandRidge'
import { WizardSurface, type WizardViewIntent, type WizardViewProjection } from './view'
import type { WizardTerrainCell } from './view/contracts'
import { visibleMapTiles } from './view/visibleMap'

const WORLD_SEED = 'greenway-alpha'
const FIXED_STEP_MS = 50
const MAX_CATCH_UP_STEPS = 12
// Same per-step feel as the v5 Greenway loop: 0.16 m per 50 ms step and a roughly 149 deg/s pivot.
const MOVE_METERS_PER_TICK = 0.16
const PIVOT_RADIANS_PER_TICK = 0.13
const TILE_METERS = 4
/** 17 by 17 cells stays legible in the dialog; the authority's own window is wider. */
const PREVIEW_MAP_RADIUS_CELLS = 8
/** Only glyphs this preview can actually show; the Greenway legend is the component fallback. */
export const PREVIEW_MAP_LEGEND = '▲ you · ? unexplored'
const TERRAIN_COLORS = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' } as const
const MIREGLASS_COLORS = { loam: '#6c7651', wetland: '#385b57', rocky: '#777d78', snow: '#d4e3df' } as const
/** Development-only direct spawn inside the Mireglass core, near the pinned outpost pad. */
export const MIREGLASS_DEV_SPAWN = { x: -288, z: 288 } as const
/** Development-only west gallery mouth, outside the ridge rock. */
export const HIGHLAND_RIDGE_DEV_SPAWN = { x: 552, z: -466 } as const
/** Development-only old-save visual simulation, inside newly raised ridge rock. */
export const HIGHLAND_RIDGE_RECOVERY_DEV_SPAWN = { x: 580, z: -500 } as const
const EMPTY_SKILLS = { woodcutting: 0, construction: 0, wayfinding: 0, spellcraft: 0, excavation: 0 } as const
const EMPTY_EQUIPMENT = { head: null, chest: null, legs: null, feet: null, mainHand: null, offHand: null } as const
const REJECTION_TEXT: Readonly<Record<StreamedWorldRejection['code'], string>> = {
  out_of_bounds: 'The streamed world ends here.',
  terrain_missing: 'No active terrain there yet.',
  airborne: 'You are already in the air.',
  invalid_value: 'That movement was rejected.',
  fen_channel: 'The fen channel needs a built bridge.',
  slate_cliff: 'The slate rise needs a built ladder.',
  ridge_rock: 'The ridge rock blocks this way.',
}

const PREVIEW_STYLES = `
.wr-streamed-banner{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:4;display:grid;gap:3px;box-sizing:border-box;max-width:calc(100vw - 24px);margin:0;padding:8px 14px;border:1px solid #e3a277;border-radius:12px;background:#4b2824f2;color:#fff2db;font:500 12px/1.3 system-ui;text-align:center;pointer-events:none}
.wr-streamed-banner p{display:grid;gap:3px;margin:0}
.wr-streamed-banner b{color:#ffd9a8;letter-spacing:.08em;text-transform:uppercase}
.wr-streamed-telemetry{color:#f5d889;font:11px monospace}
@media(max-width:719px){.wr-streamed-banner{left:10px;right:10px;bottom:calc(142px + env(safe-area-inset-bottom,0px));transform:none;max-width:none}}
@media(max-width:719px) and (max-height:400px){.wr-streamed-banner{top:6px;bottom:auto;left:50%;right:auto;transform:translateX(-50%);width:min(430px,calc(100vw - 130px));padding:5px 10px;gap:1px;font-size:11px}.wr-streamed-banner p{gap:1px}.wr-streamed-keys{display:none}}
.wr-streamed-preview .wr-surface{min-height:0}
.wr-streamed-preview .wr-topbar,.wr-streamed-preview .wr-backpack,.wr-streamed-preview .wr-backpack-toggle,.wr-streamed-preview .wr-gear,.wr-streamed-preview .wr-trade,.wr-streamed-preview .wr-focus-note,.wr-streamed-preview .wr-touch-actions button:nth-child(n+2){display:none}
.wr-streamed-preview .wr-diagnostics{top:16px}
`

export function streamedMapTitle(position: { x: number; z: number }): string {
  const inMireglass = position.x >= MIREGLASS_CORE.minX && position.x < MIREGLASS_CORE.maxX
    && position.z >= MIREGLASS_CORE.minZ && position.z < MIREGLASS_CORE.maxZ
  return `${inMireglass ? 'Mireglass Reach' : 'Streamed terrain'} local atlas (unsaved preview)`
}

export function streamedStartForSearch(search: string, development = import.meta.env.DEV): { x: number; z: number } | undefined {
  if (!development) return undefined
  const parameters = new URLSearchParams(search)
  const spawn = parameters.get('spawn')
  if (spawn === 'mireglass') return MIREGLASS_DEV_SPAWN
  if (parameters.get('devRegion') === 'streamed') {
    if (spawn === 'ridge') return HIGHLAND_RIDGE_DEV_SPAWN
    if (spawn === 'ridge-recovery') return HIGHLAND_RIDGE_RECOVERY_DEV_SPAWN
  }
  if (spawn !== 'fen' && spawn !== 'berm') return undefined
  const kind = spawn === 'fen' ? 'bridge' : 'ladder'
  const site = mireglassRouteSites(WORLD_SEED).find((candidate) => candidate.kind === kind)
  if (!site) throw new Error(`Missing canonical ${kind} site for preview spawn.`)
  // The canonical route validation checks this dry approach one cell before the crossing.
  return { x: site.from.x, z: site.from.z - TILE_METERS }
}

/** Keep the ridge movement fact and scenery flag bound to the same development query. */
export function streamedPreviewRuntimeForSearch(search: string, development = import.meta.env.DEV) {
  const parameters = new URLSearchParams(search)
  const spawn = parameters.get('spawn')
  const ridgeActive = development && parameters.get('devRegion') === 'streamed'
    && (spawn === 'ridge' || spawn === 'ridge-recovery')
  const ridgeRecovery = ridgeActive && spawn === 'ridge-recovery'
  return { runtime: createStreamedWorld(WORLD_SEED, streamedStartForSearch(search, development),
    ridgeActive ? { highlandRidge: true, cachePitDug: false } : undefined), ridgeActive, ridgeRecovery }
}

export function streamedControlIntents(yaw: number, vector: readonly [number, number]): StreamedWorldIntent[] {
  const intents: StreamedWorldIntent[] = []
  const yawDelta = -vector[0] * PIVOT_RADIANS_PER_TICK
  if (yawDelta !== 0) intents.push({ type: 'look', yawDelta, pitchDelta: 0 })
  if (vector[1] !== 0) {
    const facing = yaw + yawDelta
    intents.push({ type: 'move', delta: { x: -vector[1] * Math.sin(facing) * MOVE_METERS_PER_TICK, z: -vector[1] * Math.cos(facing) * MOVE_METERS_PER_TICK } })
  }
  return intents
}

/** Mark the authored core plus one adjacent wetland cell at its edge. */
export function mireglassVisualTerrainAt(position: { x: number; z: number }, terrain: ReadonlyWorldTile['terrain']) {
  const { x, z } = position
  const inCore = x >= MIREGLASS_CORE.minX && x < MIREGLASS_CORE.maxX
    && z >= MIREGLASS_CORE.minZ && z < MIREGLASS_CORE.maxZ
  const onWetlandRim = terrain === 'wetland'
    && x >= MIREGLASS_CORE.minX - TILE_METERS && x <= MIREGLASS_CORE.maxX
    && z >= MIREGLASS_CORE.minZ - TILE_METERS && z <= MIREGLASS_CORE.maxZ
  return inCore || onWetlandRim ? terrain : undefined
}

// The active window is a frozen array that only changes on chunk crossing, so its cells are mapped once per window.
const terrainCellCache = new WeakMap<readonly ReadonlyWorldTile[], { ridgeActive: boolean; cells: WizardTerrainCell[] }>()
function terrainCellsFor(tiles: readonly ReadonlyWorldTile[], ridgeActive: boolean): WizardTerrainCell[] {
  const cached = terrainCellCache.get(tiles)
  if (cached?.ridgeActive === ridgeActive) return cached.cells
  const cells: WizardTerrainCell[] = tiles.map((tile) => {
    const { x, z } = tile.center
    const mireglassTerrain = mireglassVisualTerrainAt(tile.center, tile.terrain)
    const highlandRidgeCell = ridgeActive ? highlandRidgeCellAt(x, z) : null
    return {
      id: tile.id, position: [x, tile.center.y, z], size: [TILE_METERS, TILE_METERS],
      height: 0.7 + tile.elevation * 3, climate: tile.biome,
      color: mireglassTerrain ? MIREGLASS_COLORS[mireglassTerrain] : TERRAIN_COLORS[tile.terrain],
      ...(mireglassTerrain ? { mireglassTerrain } : {}),
      ...(highlandRidgeCell ? { highlandRidgeCell } : {}),
    }
  })
  terrainCellCache.set(tiles, { ridgeActive, cells })
  return cells
}

/** Read-only projection of the streamed authority. Only the bounded active window is projected; nothing is fabricated. */
export function streamedProjection(runtime: StreamedWorldRuntime, state: StreamedWorldState,
  messages: readonly string[], ridgeActive = false): WizardViewProjection {
  const { position, yaw, pitch } = state.player
  const tiles = runtime.activeTiles()
  const current = runtime.tileAtWorld(position.x, position.z)
  if (!current) throw new Error('Active terrain missing under player.')
  const discovered = new Set(state.discoveredTileIds)
  return {
    seed: state.seed,
    tick: state.tick,
    player: { position: [position.x, position.y, position.z], yaw, pitch },
    terrain: terrainCellsFor(tiles, ridgeActive),
    ...(ridgeActive ? { highlandRidgeActive: true as const } : {}),
    resources: [], fairyRings: [], inscriptions: [], digSites: [],
    skillXp: EMPTY_SKILLS, learnedSpellIds: [],
    routes: [], buildSites: [], selectedBuildSiteId: null,
    map: {
      tiles: visibleMapTiles(tiles, current.gridX, current.gridZ, PREVIEW_MAP_RADIUS_CELLS).map((tile) => {
        const seen = discovered.has(tile.id)
        return {
          id: tile.id, gridX: tile.gridX, gridZ: tile.gridZ,
          terrain: seen ? tile.terrain : null, biome: seen ? tile.biome : null, discovered: seen,
          hasResource: false, hasStore: false, hasRing: false, hasRouteSite: false, hasBuiltRoute: false,
        }
      }),
      player: { gridX: current.gridX, gridZ: current.gridZ, yaw },
      title: streamedMapTitle(position),
      legend: PREVIEW_MAP_LEGEND,
    },
    stores: [], openStoreId: null, nearbyStoreId: null,
    backpack: { capacity: 0, stacks: [] },
    coins: 0,
    experience: { xp: 0, nextLevelXp: 0, level: 0 },
    equipment: EMPTY_EQUIPMENT,
    tradeListings: [null, null, null, null],
    nearbyInteraction: null,
    recentEvents: messages,
  }
}

/** Unsaved developer traversal preview over the streamed authority. It never touches v5 state or storage. */
export function StreamedPreviewApp() {
  const [{ runtime, ridgeActive, ridgeRecovery }] = useState(() =>
    streamedPreviewRuntimeForSearch(window.location.search))
  const [state, setState] = useState(runtime.state)
  const [messages, setMessages] = useState<string[]>([])
  const movementRef = useRef<readonly [number, number]>([0, 0])
  const queuedRef = useRef<StreamedWorldIntent[]>([])
  const rejectionClearTick = useRef<number | null>(null)
  const clockRef = useRef<{ lastMs: number | null; accumulatedMs: number }>({ lastMs: null, accumulatedMs: 0 })

  useEffect(() => {
    const resetClock = () => {
      movementRef.current = [0, 0]
      clockRef.current = { lastMs: null, accumulatedMs: 0 }
    }
    const timer = window.setInterval(() => {
      if (document.hidden) return
      const nowMs = performance.now()
      const clock = clockRef.current
      clock.accumulatedMs += clock.lastMs === null ? 0 : Math.max(0, nowMs - clock.lastMs)
      clock.lastMs = nowMs
      let steps = Math.floor(clock.accumulatedMs / FIXED_STEP_MS)
      if (steps > MAX_CATCH_UP_STEPS) { steps = MAX_CATCH_UP_STEPS; clock.accumulatedMs = 0 } else clock.accumulatedMs -= steps * FIXED_STEP_MS
      if (steps === 0) return
      const texts: string[] = []
      for (let index = 0; index < steps; index += 1) {
        const intents = [...(index === 0 ? queuedRef.current : []), ...streamedControlIntents(runtime.state.player.yaw, movementRef.current)]
        for (const rejection of runtime.advance(intents).rejections) texts.push(REJECTION_TEXT[rejection.code])
      }
      queuedRef.current = []
      setState(runtime.state)
      if (texts.length) {
        rejectionClearTick.current = runtime.state.tick + 60
        setMessages((current) => {
          const next = [...current]
          for (const text of texts) if (next.at(-1) !== text) next.push(text)
          return next.slice(-3)
        })
      } else if (rejectionClearTick.current !== null && runtime.state.tick >= rejectionClearTick.current) {
        rejectionClearTick.current = null
        setMessages([])
      }
    }, FIXED_STEP_MS)
    document.addEventListener('visibilitychange', resetClock)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', resetClock)
    }
  }, [runtime])

  const onIntent = useCallback((intent: WizardViewIntent) => {
    if (intent.type === 'movement') movementRef.current = intent.vector
    else if (intent.type === 'movement.tap') queuedRef.current.push(...streamedControlIntents(runtime.state.player.yaw, intent.vector))
    else if (intent.type === 'jump') queuedRef.current.push({ type: 'jump' })
    // Every other view intent belongs to gameplay systems that this preview does not implement.
  }, [runtime])

  const projection = useMemo(() => streamedProjection(runtime, state, messages, ridgeActive),
    [runtime, state, messages, ridgeActive])

  return <main className="wr-streamed-preview" style={{ position: 'fixed', inset: 0, background: '#14221f' }}>
    <WizardSurface projection={projection} onIntent={onIntent} diagnostics />
    <style>{PREVIEW_STYLES}</style>
    <div className="wr-streamed-banner">
      <p role="status">
        <b>Unsaved streamed terrain preview</b>
        <span>Movement runs on the streamed terrain authority. Gathering, shops, routes, rewards, and saving are not in this preview; reloading starts over.</span>
        {ridgeRecovery && <span>Old-save visual simulation: this unsaved preview starts inside new ridge rock. It is not a saved v11 resume.</span>}
      </p>
      <span className="wr-streamed-keys">W/S move · A/D pivot · Space jump · hold and drag to orbit · M map</span>
      {/* Telemetry changes 20 times a second, so it stays outside any live region. */}
      <span className="wr-streamed-telemetry">position x {state.player.position.x.toFixed(1)}, y {state.player.position.y.toFixed(1)}, z {state.player.position.z.toFixed(1)} · active chunks {runtime.activeChunkCount()} · discovered tiles {state.discoveredTileIds.length}</span>
    </div>
  </main>
}
