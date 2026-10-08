# Ticket Pack: A Connected Highland Quarry

## Purpose

This is the smallest distinct second-region milestone toward the full single-player game in [Game Design](GAME_DESIGN.md). The world grid already spans 2,048 m per side in 64 m streamed chunks. Expanding its numeric bounds is not the work. The present public game treats nearly every streamed position as Mireglass, so the work is a connected, recognizable destination with different activity, reliable navigation, and a reason to return.

The player crosses from Greenway into a rocky highland pocket, discovers its landmark and quarry, extracts stone with the proper tool and skill, then returns to sell or use it. The stone source is renewable or has a bounded recovery cadence so the route remains useful. The rest of the grid may remain traversable generated ground without pretending to be fully authored regions.

## Sequencing and compatibility

Finish the v9 Mireglass out-and-back playtest and the explicit v10 persistent cache-pit upgrade first. Highland state then belongs to an explicit **v11** successor, never a new field in exact-key v9 or v10 saves. The v11 migration must take a validated v10 head, preserve its immutable source lineage, and write no older bytes. Resume and commit use the same shared Web Lock, revision compare-and-swap, prior head, rescue export, and source-drift blocking pattern. A player on v7 through v10 keeps that version's original world and terrain semantics until an explicit upgrade.

The v11 frame entry keeps its own small bootstrap-proof and frozen-state trust chain. This deliberately duplicates the v10 boundary instead of widening a helper that protects already-shipped exact-key saves; a shared helper is appropriate only after a separate cross-version equivalence proof. The duplication is a compatibility cost, not an additional source of game authority.

Keep `movementOwner` as the physics owner (`greenway` or `streamed`), not a biome label. Derive a separate region identity from the authoritative position and pinned content envelopes. One player, one tick, one inventory, and one event sequence cross all regional seams.

## First contracts to freeze

1. Survey a fixed seed corpus to choose a compact rocky quarry envelope in the existing northeast highland climate. Pin its content revision, landmark, valid stone nodes, and a reversible dry walking corridor. Canonical IDs derive from seed, revision, and tile coordinates, not chunk load order.
2. Connect Greenway's eastern Highland route to that corridor through an explicit, tested outbound and inbound transition. The current public transition permits only the westward Mireglass connector; merely placing content northeast would strand or hide it. Preserve the older westward transition exactly.
3. Define `highland` as a gameplay region only within the authored envelope and corridor. Outside authored envelopes, project honest generic streamed terrain rather than titling every distant tile “Mireglass Reach” or inventing interactions.
4. Freeze the v11 delta as a small quarry progress ledger: discovered landmark and canonical depleted or regenerating node state. Reuse the existing `stone` item, field spade, excavation XP, capacity checks, and Greenway stone buyer. Avoid a new item, skill, ferry, ring, mount, or global building schema in this milestone.
5. Render the quarry with a rocky silhouette and material family, wind ambience, a readable landmark, and visible harvest state. These cues must be distinguishable from Mireglass in ordinary third-person play, not only a map title.

## Pinned v11 content and interface contract

Use content revision `highland-quarry-v1`. The dry, cardinal walking corridor follows `(12,0) → (96,0) → (192,-96) → (320,-224) → (448,-384) → (464,-432) → (520,-480)`, advancing one 4 m cell toward the larger remaining coordinate gap and preferring x on ties. Classic Greenway exits east across the `12 → 16` seam at z=0; the expanded profile exits across `34 → 36` from its center at x=32. Both directions use the same route. Keep the existing western Mireglass connector byte-for-byte compatible.

The landmark is `(464,-432)`. The four stone nodes lie in `500 ≤ x < 540` and `-500 ≤ z < -460`. Rank rocky cells by `hashSeed(seed + ':highland-quarry-v1:stone:' + tile.id)`, break ties by grid z then x, and select four nodes at least 20 m apart. Derive canonical node IDs from normalized seed hash, content revision, and world-coordinate grid indices (`worldX / 4`, `worldZ / 4`); do not mistake the existing tile grid fields, which have a `+3` offset, for those indices. Recompute the catalog when validating an action or a save. For `greenway-alpha`, the selected centers should be `(528,-488)`, `(528,-468)`, `(508,-484)`, and `(508,-464)`.

Keep movement ownership as `greenway | streamed`. Classify Highland presentation only inside `448 ≤ x ≤ 544`, `-512 ≤ z ≤ -424`, or within 8 m of the corridor from `(384,-320)` to that core. The earlier eastern track remains generic streamed wilderness. Keep Mireglass inside its existing authored envelope and approach; call the remaining generated ground generic wilderness. Regional identity never substitutes for physics ownership.

The versioned v11 delta is one landmark-discovered flag and four canonical, sorted node `readyAtTick` values, initially zero. Discover the landmark by approaching on foot. A stone extraction requires that discovery, the node tile's discovery, distance at most 3 m, an owned and equipped field spade, excavation level 2, and room for two stone. One accepted extraction awards two stone and 20 excavation XP and sets that node's `readyAtTick` to `currentTick + 3000` (150 simulated seconds), with overflow rejected. Rejected attempts mutate nothing. Greenway Outfitters already buys stone for one coin each; Highland Arcanum's existing three-coin buy price can reward the longer route when accessible.

The corridor survey covered `greenway-alpha`, `wizard-realms`, and 100 fixed corpus seeds. All 102 had 100 rocky quarry cells and four separated nodes. The 248-cell, 988 m route had no wetland or Mireglass barrier in either direction, with maximum adjacent ground-height change of 0.681 m. Three active-terrain out-and-back probes crossed 16 chunk seams while keeping at most nine chunks active. These facts pin the initial authored route, but the real UI still needs an independent travel and return proof. A visual quarry wall must agree with collision; it cannot trap a player on a route that the authority considers open.

## Authority and interaction

Actions are typed intents handled by a pure highland reducer. Validate region, range, canonical site, discovery, tool and skill, capacity, and recovery cadence before mutating. Accepted extraction adds stone and excavation XP once, changes the node, and emits one event. Rejected attempts change no player state, regional state, tick, or save. Presentation reads committed projections only.

The route is discovered by walking, not awarded from a distant view. Directions and map cues must work from both sides of the Greenway and Highland transition, including after a reload. A return journey must offer a concrete trade decision, not merely a path back.

## Lanes and ownership

| Lane | Exclusive ownership | Proof |
| --- | --- | --- |
| Seeded content and corridor | New highland catalog, bounded path, region classifier, focused tests | Fixed-seed and varied-seed stability, canonical rocky sites, bidirectional reachability, no chunk-order dependence. Do not alter existing `worldChunks.ts` or Mireglass terrain. |
| Public transition and authority | Public movement transition, new highland action reducer, focused tests | Eastward exit and return, no westward regression, one player and event sequence, atomic rejection/commit. |
| V11 state and storage | New exact v11 state, snapshot, atomic store, lineage flow, tests | Explicit v10 upgrade, unchanged older bytes, CAS, source drift, prior-head rescue, valid cross-region pose. |
| Presentation and UI | Region-aware projection/title, quarry scene and map cues, focused tests | Distinct identity and discoverability, visible harvested state, no Mireglass anchors or objective projected in highland. |
| Integration and playtest | Primary agent | One low-RAM preview, full suite/build, independent UI journey, save/reload, chunk leave/return, and Bioscopics-only publication. |

The region classifier, v11 state shape, and transition coordinates must be frozen before independent implementation lanes begin. Newer content cannot silently revise v10 seed terrain or a saved pose.

## Acceptance journey

A fresh upgraded player reaches the Highland bridge, travels east into streamed highland terrain, follows readable cues to the quarry, discovers its landmark, extracts stone, saves, reloads, crosses a chunk seam, leaves and returns, then sells stone in Greenway. The player can repeat the loop after its stated recovery cadence. Test too-far, wrong-tool, low-skill, capacity, depleted, and duplicate attempts as non-mutating rejections. Check several seeds, both corridor directions, active-window eviction/reconstruction, and unchanged v9/v10 source bytes.

Bound active chunks to nine, active tiles to 2,304, visible terrain to 289, and the discovery mask to its fixed size. Measure the documented p95 tick target on named hardware separately. An independent tester must finish the journey through the UI without source-code hints. Passing this milestone does not finish gate 2 or the full game: multiple spell paths, broader regional commerce, boats, creatures, mounts, endgame, and release proof still remain.
