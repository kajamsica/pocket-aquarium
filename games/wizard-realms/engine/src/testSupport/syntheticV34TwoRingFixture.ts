import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from '../domain/discoveryMask'
import { MIREGLASS_RING_ID, mireglassFairyRing } from '../domain/mireglassContent'
import { createFreshPublicV17Head } from '../domain/publicWorldV17Snapshot'
import { decodePublicV17Progress } from '../domain/publicWorldV17Validation'
import { publicV17StarterSupportAt } from '../domain/publicWorldV17StarterMovement'
import { createPublicV23Root } from '../domain/publicWorldV23Snapshot'
import { createPublicV24Root } from '../domain/publicWorldV24Snapshot'
import { createPublicV25Root } from '../domain/publicWorldV25Snapshot'
import { createPublicV26Root } from '../domain/publicWorldV26Snapshot'
import { createPublicV27Root } from '../domain/publicWorldV27Snapshot'
import { createPublicV28Root } from '../domain/publicWorldV28Snapshot'
import { createPublicV29Root } from '../domain/publicWorldV29Snapshot'
import { createPublicV30Root } from '../domain/publicWorldV30Snapshot'
import { createPublicV31Root } from '../domain/publicWorldV31Snapshot'
import { createPublicV32Root } from '../domain/publicWorldV32Snapshot'
import { createPublicV33Root, decodePublicV33CheckedSuccessor,
  decodePublicV33Root, replayPublicV33Witness } from '../domain/publicWorldV33Snapshot'
import { createPublicV34Root, decodePublicV34Root } from '../domain/publicWorldV34Snapshot'
import type { PublicV34Root } from '../domain/publicWorldV34Snapshot'
import { WORLD_CELL_METERS, worldTileAtGrid } from '../domain/worldChunks'

/** Test-only shortcut: Mireglass discovery and its tile are seeded in synthetic V17 history.
 * This does not prove the player explored the 400 m route. Greenway discovery and all later
 * V34 travel still use checked witnesses. Never write this fixture to a player profile. */
export function createSyntheticV34TwoRingFixture(): PublicV34Root {
  const seed = 'wizard-realms'
  const v17 = createFreshPublicV17Head(seed)
  const ring = v17.head.state.greenway.fairyRings.find(({ id }) => id === 'ring-greenway')
  if (!ring) throw Error('Missing Greenway ring')
  const greenwayTile = worldTileAtGrid(seed,
    Math.ceil(ring.position.x / WORLD_CELL_METERS - 0.5),
    Math.ceil(ring.position.z / WORLD_CELL_METERS - 0.5))
  const mireglassTile = mireglassFairyRing(seed).tile
  const floor = publicV17StarterSupportAt({ seed, profile: v17.head.state.generationProfile,
    route: v17.head.state.greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: v17.head.greenwayWorks }, ring.position)
  if (!floor) throw Error('Missing Greenway ring support')
  const state = { ...v17.head.state,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(v17.head.state.discoveryMask), greenwayTile.id,
      mireglassTile.id])].sort()),
    player: { ...v17.head.state.player, position: { ...ring.position, y: floor.floorY },
      discoveredRingIds: [...v17.head.state.player.discoveredRingIds, MIREGLASS_RING_ID] } }
  if (!decodePublicV17Progress({ state, greenwayWorks: v17.head.greenwayWorks }, seed))
    throw Error('Invalid synthetic V17 source')
  const v23 = createPublicV23Root(seed, { state, greenwayWorks: v17.head.greenwayWorks,
    saveRevision: 1, lineage: v17.lineage })
  const v24 = createPublicV24Root(v23)
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  const v31 = createPublicV31Root(v30)
  const v32 = createPublicV32Root(v31)
  const v33 = createPublicV33Root(v32)
  const witness = { kind: 'fairy-ring-discover/v1' as const, ringId: 'ring-greenway' as const }
  const discovered = replayPublicV33Witness(v33.head, witness)
  if (!discovered) throw Error('Greenway discovery rejected')
  const candidate = { lineage: v33.lineage, previous: v33.head,
    head: { ...v33.head, ...discovered, saveRevision: 1, witness } }
  const checked = decodePublicV33CheckedSuccessor(v33, candidate)
  if (!checked || !decodePublicV33Root(checked)) throw Error('Invalid V33 discovery successor')
  const compact = createPublicV34Root(checked.head)
  if (!decodePublicV34Root(compact)) throw Error('Invalid compact V34 fixture')
  return compact
}
