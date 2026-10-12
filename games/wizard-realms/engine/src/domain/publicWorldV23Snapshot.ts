import { createFreshPublicV17Head, decodePublicV17Head, decodePublicV17Lineage,
  PUBLIC_V17_SCHEMA } from './publicWorldV17Snapshot'
import type { PublicV17Lineage } from './publicWorldV17Snapshot'
import { decodePublicV17Progress } from './publicWorldV17Validation'
import type { PublicV17Progress } from './publicWorldV17Validation'
import { samePublicV14Value, requiredPublicV14EarnedXpMinima } from './publicWorldV14Validation'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { discoveryMaskHasTileId } from './discoveryMask'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { publicV23CampOverlaps, publicV23CorridorsOverlap, publicV23WorkCorridor, resolvePublicV23Site } from './publicWorldV23Sites'
import type { PublicV23ResolvedSite } from './publicWorldV23Sites'
import type { PublicV14FrameWitness } from './publicWorldV14Snapshot'
import type { PublicWorldIntent } from './publicWorldRuntime'
import { decodePublicV23Witness, replayPublicV23Witness } from './publicWorldV23Transitions'

export const PUBLIC_V23_SCHEMA = 'wizard-world/v23' as const
export const PUBLIC_V23_DATABASE_NAME = 'wizard-realms:world:v23'
export type PublicV23SourceReceipt = Readonly<PublicV17Progress & {
  saveRevision: number; lineage: PublicV17Lineage }>
export type PublicV23Lineage = Readonly<{ origin: 'fresh' | 'v17-migration'; seed: string;
  rulesProfile: 'regional-ladder/v1'; sourceReceipt: PublicV23SourceReceipt | null }>
export type PublicV23Progress = PublicV17Progress & Readonly<{ regionalWorks: { builtLadderIds: readonly string[] } }>
export type PublicV23Witness = Readonly<{ kind: 'checkpoint' }>
  | Readonly<{ kind: 'regional-work'; id: string }> | Readonly<{ kind: 'legacy-work'; id: string }>
  | Readonly<{ kind: 'legacy-action'; intent: PublicWorldIntent }> | PublicV14FrameWitness
export type PublicV23Head = PublicV23Progress & Readonly<{ schemaVersion: typeof PUBLIC_V23_SCHEMA;
  saveRevision: number; witness: PublicV23Witness | null }>

export function exactPublicV23(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  try { return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length
    && keys.every((key) => { const field = Object.getOwnPropertyDescriptor(value, key)
      return !!field?.enumerable && Object.hasOwn(field, 'value') }) } catch { return false }
}
export function decodePublicV23Source(value: unknown): PublicV23SourceReceipt | null {
  if (!exactPublicV23(value, ['state', 'greenwayWorks', 'saveRevision', 'lineage'])) return null
  const lineage = decodePublicV17Lineage(value.lineage)
  const head = lineage && decodePublicV17Head({ schemaVersion: PUBLIC_V17_SCHEMA,
    saveRevision: value.saveRevision, bootstrap: null, state: value.state, greenwayWorks: value.greenwayWorks }, lineage)
  return head && lineage ? { state: head.state, greenwayWorks: head.greenwayWorks,
    saveRevision: head.saveRevision, lineage } : null
}
export function decodePublicV23Lineage(value: unknown): PublicV23Lineage | null {
  if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
    || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128
    || value.rulesProfile !== 'regional-ladder/v1') return null
  if (value.origin === 'fresh' && value.sourceReceipt === null) return structuredClone(value) as PublicV23Lineage
  const receipt = decodePublicV23Source(value.sourceReceipt)
  return value.origin === 'v17-migration' && receipt?.state.seed === value.seed
    ? { origin: value.origin, seed: value.seed, rulesProfile: value.rulesProfile, sourceReceipt: receipt } : null
}

export function decodePublicV23Progress(value: unknown, seed: string): PublicV23Progress | null {
  try {
    if (!exactPublicV23(value, ['state', 'greenwayWorks', 'regionalWorks'])
      || !exactPublicV23(value.regionalWorks, ['builtLadderIds'])) return null
    const ids = value.regionalWorks.builtLadderIds
    if (!Array.isArray(ids) || Object.getPrototypeOf(ids) !== Array.prototype || ids.length > 32
      || Reflect.ownKeys(ids).length !== ids.length + 1) return null
    for (let i = 0; i < ids.length; i++) {
      const field = Object.getOwnPropertyDescriptor(ids, String(i))
      if (!field?.enumerable || !Object.hasOwn(field, 'value') || typeof field.value !== 'string'
        || i > 0 && ids[i - 1] >= field.value || !resolvePublicV23Site(seed, field.value)) return null
    }
    const owned = structuredClone(value) as PublicV23Progress
    // Validate a regional grounded pose on its canonical support, then project only
    // its Y onto the old floor for the unchanged V17 core proof.
    let core = owned.state
    if (core.movementOwner === 'streamed') {
      const regional = ids.map((id) => resolvePublicV23Site(seed, id)!).map((site) =>
        terrainWorkSupportAt({ ...site, obstacle: 'slate_cliff' }, core.player.position))
        .find((support) => support.floorY !== null)
      if (regional) {
        if (core.player.verticalVelocity !== 0 || Math.abs(core.player.position.y - regional.floorY!) > 1e-6) return null
        const old = resolvePublicV14Surface(core, core.player.position)
        if (!old) return null
        core = { ...core, player: { ...core.player, position: { ...core.player.position, y: old.floorY } } }
      }
    }
    const legacy = decodePublicV17Progress({ state: core, greenwayWorks: owned.greenwayWorks }, seed)
    if (!legacy) return null
    const all = [...owned.state.terrainWorks.builtWorkIds, ...owned.state.terrainWorks.dugTileIds,
      ...owned.greenwayWorks.builtBridgeIds, ...owned.greenwayWorks.builtLadderIds, ...owned.greenwayWorks.dugTileIds]
    for (let i = 0; i < ids.length; i++) {
      const site = resolvePublicV23Site(seed, ids[i])!
      if (site.footprintTileIds.some((id) => !discoveryMaskHasTileId(owned.state.discoveryMask, id))) return null
      if (owned.state.fieldCampTileIds.some((id) => publicV23CampOverlaps(seed, site.corridor, id))) return null
      if ([...all, ...ids.slice(0, i)].some((id) => {
        const corridor = publicV23WorkCorridor(seed, id)
        return !corridor || publicV23CorridorsOverlap(site.corridor, corridor)
      })) return null
    }
    const minima = requiredPublicV14EarnedXpMinima(owned.state)
    const construction = owned.greenwayWorks.builtBridgeIds.length * 80
      + owned.greenwayWorks.builtLadderIds.length * 60 + ids.length * 60
    if (owned.state.player.skillXp.construction < minima.construction + construction
      || owned.state.player.xp < minima.total + construction + owned.greenwayWorks.dugTileIds.length * 30) return null
    return owned
  } catch { return null }
}

export function createPublicV23Root(seed: string, sourceReceipt: PublicV23SourceReceipt | null = null) {
  const lineage = decodePublicV23Lineage({ origin: sourceReceipt ? 'v17-migration' : 'fresh',
    seed, rulesProfile: 'regional-ladder/v1', sourceReceipt })
  if (!lineage) throw new RangeError('Invalid V23 source')
  const base = lineage.sourceReceipt ?? createFreshPublicV17Head(seed).head
  const head: PublicV23Head = { schemaVersion: PUBLIC_V23_SCHEMA, saveRevision: 0,
    state: structuredClone(base.state), greenwayWorks: structuredClone(base.greenwayWorks),
    regionalWorks: { builtLadderIds: [] }, witness: null }
  return { lineage, head }
}

export function decodePublicV23Head(value: unknown, lineage: PublicV23Lineage): PublicV23Head | null {
  if (!exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state', 'greenwayWorks', 'regionalWorks', 'witness'])
    || value.schemaVersion !== PUBLIC_V23_SCHEMA || !Number.isSafeInteger(value.saveRevision)
    || (value.saveRevision as number) < 0) return null
  const progress = decodePublicV23Progress({ state: value.state, greenwayWorks: value.greenwayWorks,
    regionalWorks: value.regionalWorks }, lineage.seed)
  if (!progress) return null
  if (value.saveRevision === 0) return samePublicV14Value(value, createPublicV23Root(lineage.seed,
    lineage.sourceReceipt).head) ? structuredClone(value) as PublicV23Head : null
  const witness = decodePublicV23Witness(value.witness)
  if (!witness || witness.kind === 'regional-work' && !resolvePublicV23Site(lineage.seed, witness.id)) return null
  return { ...progress, schemaVersion: PUBLIC_V23_SCHEMA, saveRevision: value.saveRevision as number,
    witness: structuredClone(witness) as PublicV23Witness }
}

export function confirmPublicV23Work(raw: PublicV23Progress, id: unknown):
  { progress: PublicV23Progress; event: { id: string; logsSpent: 4; xp: 60 } } | { rejection: string } {
  const progress = decodePublicV23Progress(raw, raw?.state?.seed)
  if (!progress) return { rejection: 'invalid_progress' }
  const site = resolvePublicV23Site(progress.state.seed, id)
  if (!site) return { rejection: 'invalid_site' }
  const { state, regionalWorks } = progress, player = state.player
  if (state.movementOwner !== 'streamed') return { rejection: 'unavailable_here' }
  if (site.footprintTileIds.some((tile) => !discoveryMaskHasTileId(state.discoveryMask, tile))) return { rejection: 'undiscovered' }
  if (regionalWorks.builtLadderIds.includes(site.id)) return { rejection: 'already_done' }
  if (regionalWorks.builtLadderIds.length >= 32) return { rejection: 'limit_reached' }
  const floor = resolvePublicV14Surface(state, player.position)
  if (!floor || player.verticalVelocity !== 0 || Math.abs(player.position.y - floor.floorY) > 1e-6
    || Math.abs(player.position.y - site.from.y) > 0.1
    || Math.hypot(player.position.x - site.from.x, player.position.z - site.from.z) > 3
    || player.position.x < site.from.x) return { rejection: 'too_far' }
  if (state.fieldCampTileIds.some((tile) => publicV23CampOverlaps(state.seed, site.corridor, tile))) return { rejection: 'occupied' }
  if (![state.eventSequence + 1, player.xp + site.xpReward,
    player.skillXp.construction + site.xpReward].every(Number.isSafeInteger)) return { rejection: 'invalid_value' }
  let remaining = site.logCost as number
  if (player.inventory.filter((s) => s.itemId === 'logs').reduce((sum, s) => sum + s.quantity, 0) < remaining) return { rejection: 'not_owned' }
  for (const stack of player.inventory) if (stack.itemId === 'logs') {
    const spent = Math.min(stack.quantity, remaining); stack.quantity -= spent; remaining -= spent
  }
  player.inventory = player.inventory.filter((s) => s.quantity > 0)
  player.xp += site.xpReward; player.skillXp.construction += site.xpReward
  player.level = 1 + Math.floor(player.xp / 100)
  const next = decodePublicV23Progress({ ...progress, state: { ...state, eventSequence: state.eventSequence + 1 },
    regionalWorks: { builtLadderIds: [...regionalWorks.builtLadderIds, site.id].sort() } }, state.seed)
  return next ? { progress: next, event: { id: site.id, logsSpent: 4, xp: 60 } } : { rejection: 'occupied' }
}

/** Advisory preview never exposes a site whose complete footprint is still hidden. */
export function previewPublicV23Work(raw: PublicV23Progress, id: unknown): {
  site: PublicV23ResolvedSite | null; rejection: string | null
} {
  const checked = decodePublicV23Progress(raw, raw?.state?.seed)
  if (!checked) return { site: null, rejection: 'invalid_progress' }
  const site = resolvePublicV23Site(checked.state.seed, id)
  if (!site) return { site: null, rejection: 'invalid_site' }
  if (site.footprintTileIds.some((tile) => !discoveryMaskHasTileId(checked.state.discoveryMask, tile))) {
    return { site: null, rejection: 'undiscovered' }
  }
  const result = confirmPublicV23Work(checked, id)
  return { site, rejection: 'rejection' in result ? result.rejection : null }
}

export function replayPublicV23Transition(before: PublicV23Head, after: PublicV23Head): boolean {
  const progress = ({ state, greenwayWorks, regionalWorks }: PublicV23Progress): PublicV23Progress => ({ state, greenwayWorks, regionalWorks })
  if (after.saveRevision !== before.saveRevision + 1 || !after.witness) return false
  return samePublicV14Value(replayPublicV23Witness(progress(before), after.witness), progress(after))
}
