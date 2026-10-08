# Ticket Pack: Persistent seal-cache excavation

## Outcome and boundary

This is a bounded step toward the full single-player game in [Game Design](GAME_DESIGN.md), not game completion. A player who has discovered the Mireglass seal cache, reached it, equipped the field spade, and earned excavation level 2 can dig it once. In the new world version, that committed action lowers one canonical ground cell. The player, renderer, collision, map, and saved world must agree on the same altered terrain after travel and reload.

The existing `cacheExcavated` fact remains the only mutable dig fact for this site. Rejected and preview actions change no ground, inventory, XP, tick, or save. This pack does not introduce free-form digging, a second cache flag, new map coordinates, or an arbitrary terrain editor.

## Compatibility decision

Existing v7, v8, and v9 saves interpret `cacheExcavated` as a completed reward and decorative pit on seed-only ground. Reinterpreting that bit in place would change collision and invalidate a saved pose. Keep their generation, validation, projection, and storage semantics unchanged.

Add an explicit `?publicWorld=v10` upgrade from a fully validated v9 head. The v10 state adds exactly one fixed marker, `terrainRevision: 'mireglass-cache-pit-v1'`. Its new save schema and atomic store hold the v10 head, prior head, and an immutable receipt of the exact v9 source head and lineage. Migration copies the validated state and adds the marker without writing v7, v8, or v9 bytes. Every v10 resume and commit uses the existing shared Web Lock, compares the source receipt with the current older source, and uses revision compare-and-swap. Changed source, invalid head, or conflicting history blocks rather than auto-selecting a branch. Rescue downloads must carry the source receipt and must not imply automatic import or conflict resolution.

The v10 validator must not pass a lower pit pose through v9's seed-ground check unchanged. It may validate a v9-shaped witness with the player's `y` at base ground, then separately validate the real v10 pose against the effective overlaid ground. The codec serializes the real pose. The validator also checks exact keys, the fixed terrain marker, monotonic `cacheExcavated`, and unchanged prior camp history.

## Frozen terrain rule

The only edited cell is `mireglassAnchors(seed).sealCache.tile.id`. With v10 terrain semantics and `cacheExcavated === true`, its elevation is `0.55` instead of `0.80`, lowering its center from `2.40 m` to `1.65 m`. Its canonical ID and loam terrain type do not change. All other cells retain their existing values. Keep `worldTileAtGrid` and Mireglass content revision unchanged; apply an immutable overlay when active chunks are assembled. An omitted terrain-facts argument preserves seed-only behavior for older worlds.

The action still commits its current single cache event, inventory reward, and XP exactly once. A new immutable state identity invalidates the streamed runtime cache so the lower ground takes effect immediately. The renderer and overview read the same effective tile as movement. The player may descend onto it under existing gravity; leaving the cell currently permits an upward step, which is a known movement limitation, not proof of a general digging system.

## Lane contracts and ownership

| Lane | Exclusive owners | Proof |
| --- | --- | --- |
| Terrain and movement | A small cache-overlay module, `activeWorldTerrain.ts`, `streamedWorld.ts`, and focused tests | Across seeds and chunk reload orders, only the cache cell changes; landing and ground collision use its effective height; omission preserves old output. |
| V10 lineage and validation | New `publicWorldV10State.ts`, snapshot, atomic database, flow, and focused tests; a narrow under-lock inspector export from `publicWorldV9Flow.ts` if needed | Exact shape, actual-pose validation, source receipt, migration without older writes, CAS, stale source rejection, head/previous rescue, and camp-history monotonicity. |
| Public authority | `publicWorldActions.ts`, `publicWorldRuntime.ts`, and focused tests | Rejected digs are atomic; successful dig rebuilds terrain once without duplicate reward; save/reload and region travel preserve the effective ground. |
| Entry and presentation | New `PublicV10Entry.tsx`, `PublicWizardApp.tsx`, `PublicWorldView.ts`, `MireglassPlayableApp.tsx`, `main.tsx`, and focused tests | Explicit upgrade, changed scene and map height, saved-pose resume, blocked-source copy, and unchanged v7/v8/v9 entry routes. |

Freeze the v10 state type, overlay function signature, and source-receipt shape before parallel implementation. The terrain and persistence lanes can then proceed independently. The public-authority lane consumes the terrain interface; entry and presentation follow the authority and flow. No lane starts a WebGL preview, modifies browser storage, commits, pushes, or edits another lane's files. The primary agent owns integration, Bioscopics Git identity, low-RAM validation, and real UI proof.

## Acceptance gate

First close the v9 camp and first-region UI acceptance gate. Then, on an isolated origin, explicitly upgrade a valid v9 save to v10. Dig the seal cache once with the correct tool and skill. Verify the exact tile drops in the scene and map, the player lands on its new ground, neighboring tiles and crossings stay unchanged, and the single reward and XP are not duplicated. Save, reload, cross a chunk seam, leave and return, and verify geometry and pose remain consistent. Test several seeds and both immediate post-dig and post-landing saves. Advance the v9 source in another tab and verify v10 blocks rather than overwrites either history. Reopen older v9 and confirm its seed-only ground has not changed.

Passing this gate does not meet the full-game digging requirement. That still needs terrain-valid, tool- and skill-gated digging at multiple suitable sites, broader construction, world content, mounts, encounters, economy, campaign, and release proof.
