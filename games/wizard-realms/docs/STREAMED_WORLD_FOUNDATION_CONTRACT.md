# Streamed world foundation contract

This is the bounded terrain foundation after player-selected construction. Deterministic cells and chunks, a nine-chunk active cache, a 17 by 17 scene terrain cap, a 33 by 33 local atlas cap, and a separate streamed movement authority now exist. Mireglass Reach also has version-pinned ground forms, anchors, and timber candidates. They are prerequisites for the larger, distinctive first region and the roughly 2 km full game, not a claim that either is playable yet. The north star and completion gate remain in [Game Design](GAME_DESIGN.md).

## Coordinates and content identity

- The eventual connected world covers 2,048 m by 2,048 m at the existing 4 m terrain-cell scale: 512 by 512 cells, divided into 32 by 32 chunks of 16 by 16 cells. Global cell coordinates run from `-256` through `255` on each axis. Negative-coordinate chunk indexing uses mathematical floor, not truncation.
- A pure deterministic cell function accepts `(seed, globalGridX, globalGridZ)` and returns a stable tile ID, center, height, terrain, biome, and climate values. A chunk generator calls that cell function in row-major order. Generating chunks in any order, or regenerating after eviction, must produce bit-identical cells.
- Global cell `(0, 0)` remains centered at world `(0, 0)`. In the legacy Greenway footprint, map global coordinates to the existing local grid with `local = global + 3`. The classic seven-by-seven and expanded sixteen-by-sixteen cells, including tile IDs and all physical and climate fields, must remain exactly unchanged. New outer terrain must meet that boundary without an abrupt height seam.
- A stable coarse region field distinguishes at least woodland, wetland, and highland climatic areas without making every cell of a region identical. Region design does not authorize new creatures, shops, quests, or save data in this increment.

## Bounded activation and presentation

- Request chunks by coordinate and keep no more than the current chunk plus its eight neighbors active for the first playable integration. The terrain cache now returns `null` for missing cells and rejects out-of-world activation without changing its window. Future movement authority must pause at a not-yet-validated chunk rather than treating a missing tile as empty ground. Content activation order cannot change terrain or resource identity.
- The 3D view must not create one mesh per cell for all 262,144 world cells. Its first culling gate renders at most a 17 by 17 terrain window around the player; resources and landmarks follow their own visibility ranges. The view adapter now caps the local atlas to 33 by 33 cells while preserving the complete classic and expanded Greenway maps. A larger-world atlas overview and player-relative map controls are still pending.
- Chunk generation and view filtering are pure functions with bounded memory. No render loop, fixed-step simulation tick, or local save performs whole-world generation or serialization.

## Integration order

1. Prove the pure cell, chunk, active-window, and visible-terrain functions without changing the playable profile or v5 save. Retain exact Greenway generation through the same tile function used by existing profiles. This foundation is implemented, with pre-refactor Greenway tile-array hashes pinned in tests.
2. Give a distinct streamed authority state coordinate-indexed terrain lookup through the active window. This internal module now handles fixed-step movement, look, jump, discovery, and fail-closed chunk crossing without exposing a public profile or save. Keep v5 `terrainHeightAt` and its deep-clone semantics untouched: v5 saves permit moved tile centers, and previous and next v5 states are independently mutable. `advanceWizardWorld` currently clones the whole v5 state on every tick, and the app saves full JSON every tick; neither path can be run against a generated 512 by 512 tile array.
3. Move resource and landmark activation to deterministic per-chunk content profiles, then store only changed resources and placed objects as sparse deltas. Mireglass now pins anchors and six timber candidates across a 100-seed corpus, but they are not yet authority-owned interactions. Validate cross-chunk collisions and reachability before the player can enter a chunk.
4. Extend the bounded local map with an aggregated atlas. Discovery uses stable global IDs. The player can cross chunk boundaries without a terrain pop, a false empty-ground step, or loss of discovery. Replace `areaAt`'s out-of-bounds Greenway fallback with explicit region ownership. The scene's current 320 m ground plane and origin-centered shadow coverage also need a player-relative or chunk-local presentation policy before travel reaches distant coordinates.
5. Introduce the versioned v6 save and migration with complete legacy-state round trips. Only then expose a larger development profile with an authored outward-and-return regional journey. Expand further after that journey passes from the real UI.

This sequence keeps the simulation authoritative. A rendering-only extension, a static 2 km tile array, or a new profile without sparse saves does not satisfy the world-scale gate.

## Authority and compatibility boundary

- The currently playable `wizard-world/v5` Greenway profiles and their saves are untouched by this foundation increment. Do not add a selectable 2 km profile until movement, resource activation, sparse deltas, discovery, area crossings, map presentation, and save migration have a single validated contract.
- A later v6 save must persist seed/content revision, player state, discovered global IDs, and sparse per-chunk deltas while regenerating immutable cells. It must preserve and migrate v1-v5 bytes, route placements, equipment, magic, excavations, coins, and regional progress. Unknown or incompatible chunks fail closed; no reset or silent truncation.
- Classic and expanded Greenway saves can coexist with different progress. A new streamed profile must ask which source, if any, to import. Cancel leaves both original saves untouched. An invalid active v6 root must block writes rather than silently falling back to a prior key.
- V6 is a separate persistence DTO. It saves full player and progression facts, clock and RNG, per-chunk discovery masks, selected route site IDs, and only changed resource, store, ring, and placed-object facts. It does not serialize generated tiles or the active chunk cache. Its root is published after staged chunk records and keeps a recoverable prior root. Content revision can be reused only when regenerated Greenway content is identity and geometry equivalent to v5.
- Coordinate validation must be profile-aware: v5's bounds stay unchanged, while v6 accepts the full 2,048 m world edge. Chunk IDs, ownership, referenced records, progression, equipment, capacity, and chosen-site geometry are validated before restore or autosave.
- The first user-facing integration must be one expanded, distinctive region with a complete outward-and-return journey, not a vast empty map. It should be exposed as a separate honest development surface before the rest of the 2 km world is complete.

## Proof for this increment

Across a seed corpus, prove legacy-cell exactness, negative and edge coordinates, chunk-order independence, deterministic regeneration, cross-chunk height continuity, region diversity, 3 by 3 active-window bounds, and a 17 by 17 presentation cap. The integrated suite now passes 247 tests and the production build passes. The terrain foundation is not the full game, not a new save format, and not a new public preview.
