# Greenway free placement, first authoritative slice

## Outcome

Let the player aim a bridge across the discovered Greenway creek or a real rung ladder against the discovered north cliff. A placement ghost follows a 0.1 m horizontal snap at eligible positions. Confirm rechecks the canonical position, discovery, reach, overlap, props, costs, and pose under the checked writer. Built crossings are physical, saved, replayed, and usable after reload. Keep `works3` and the v16 root frozen so existing progress is recoverable.

This is an incremental Greenway feature, not a claim of world-wide free building or of a completed game. The authored center ladder remains its own route. Barefoot walking, boot-enabled default running, and R/Walk pacing remain unchanged.

## Interface contract

- New IDs: `works4:bridge:greenway-creek:<q>` and `works4:ladder:greenway-north-cliff:<q>`, where canonical integer `q` is world X in decimetres. Snap with `Math.floor(x * 10 + 0.5)`. Reject noncanonical `-0`, leading zero, malformed, unsafe, or out-of-range values.
- Creek q range `[-91, 91]`. North-cliff q range `[-294, 294]`, with `|q| <= 10` excluded so the existing center route cannot be shadowed. Seed-derived terrain and obstacle checks further prune these ranges.
- A pure resolver derives full site geometry and all affected tiles from seed and ID. It delegates `works3` IDs exactly to the existing v16 resolver. It receives no client endpoints, heights, or footprints. Lookup is one snapped aim or the bounded saved ID set, never a per-frame scan over all q.
- V17 owns a separate save root and checked v16 migration. Read and validate the source under the existing exclusive lock. Preserve v16 data, source revision, built works, XP, inventory, pose, and frame history. New v17 validation accepts both frozen `works3` and new `works4` IDs. V17 movement and replay use the same combined resolver.
- A ghost is transient view state. The checked confirm action submits only the canonical ID and recomputes all eligibility against the current saved state. A preview never spends materials or alters a save.

## Ticket A: pure site resolver

Owner files: new `engine/src/domain/publicWorldV17GreenwaySites.ts` and `.test.ts` only. Export `placementId(kind, aimX): string | null` and `resolvePublicV17GreenwaySite(seed, id): PublicV16GreenwaySite | null`. Use existing v16 tile and seed facts, support dimensions, and creek bounds, but do not call the v16 automatic X chooser for works4. Include all intersected columns in the footprint. Require dry banks/approach, wet creek gap, acceptable steps/rise and lateral continuity. Reject static hard props, stores, landmarks, and return sorted intersecting tree blocker IDs. Preserve works3 results exactly.

Tests: canonical grammar/bounds and tie handling; geometry at distinct snaps; cross-cell footprint; terrain/prop rejection for multiple seeds; deterministic tree blockers; no mutation; exact works3 delegation. No v16 file edits.

## Ticket B: versioned authority and movement

Depends on A. New v17 save schema, database, checked source inspector/migration, frame and action replay, canonical work confirmation, and movement support. Existing v16 root remains byte-for-byte untouched. Confirm uses current discovery, 3 m reach, hard/static and saved-work overlap, resource depletion, log/spade/capacity rules, one-time XP/cost, and post-build pose validation. Source revision race and forged IDs fail closed.

Split after A's interface lands: B1 owns only a new `publicWorldV17StarterMovement.ts` and focused tests, reusing the v16 works ledger shape while resolving both works3 and works4. B2 owns the new v17 schema, database, migration, validation, flow, and focused tests; it consumes B1's movement proof. A narrow `inspectPublicV16UnderLock` export in v16 flow is permitted solely to authenticate the source under the shared lock, mirroring v15. Do not loosen the v16 decoder, writer, schema, or saved root.

Proof: v16 built structures survive v17 migration and reload; new bridge and ladder can be physically crossed both ways after reload; blocked confirm leaves bytes/revision unchanged; malformed/tampered saves reject; replay reproduces checked actions and frames.

## Ticket C: aim, ghost, and teaching UI

Depends on A's exported contract and B's checked action API. New v17 entry/controller/projection route, not replacement of v16. Reticle/pointer chooses a world X on the known obstacle; Works 1/2 displays the snapped ghost, ready/blocked reason, log cost and what the route reaches. F/Confirm acts on only the selected eligible ID. Works 3 retains dig guidance: spade plus free bag slot yields one stone and 30 Excavation XP, then sell the stone at Greenway Outfitters. Provide visible creek/cliff directions on the map. Touch and keyboard both work. A ladder must read as narrow upright rails and rungs, not a deck.

Split C1 projection/view files (`PublicV17WorldView`, shared view contracts/HUD/map/scene/surface, focused tests) from C2 entry/controller/app routing files. C1 exports a v16-parallel `publicWorldV17ViewProjection` with a transient v17 work-preview input. C2 consumes that projection and B2's v16-parallel flow/runtime API. Coordinate their interfaces before wiring the route. Keep v16 behavior unchanged.

Resolved C1/C2 interface: `PublicV17WorkPreviewInput` carries kind, body yaw, transient `aimX: number | null`, mode, and action gate. C2 derives default aim from the player-facing ray intersecting creek Z 8 or north cliff Z -5.5; a `saved-work.aim` intent may override world X for accessible keyboard/touch fine positioning, and the override clears on mode/kind changes. C1 snaps and resolves only the chosen ID, then presents checked ready or blocked status. The route owner is `engine/src/main.tsx`; App need not change.

Proof: focused UI tests plus independent real-browser journey on an isolated v17 origin: gather, choose bridge, move ghost to two different eligible positions, build/cross, choose ladder, climb/descend, dig, trade, save, reload. Capture before/after confirmation screenshots and timing. Keep one local renderer; browser access policy remains binding.

## Integration gates

Run focused tests per ticket, then adjacent migration/movement/UI tests, full suite, TypeScript, production build, and diff check. Expose the v17 route only after checked migration/confirmation and a safe UI entry pass; user access is a milestone, not completion. Keep the frozen T146 v16 Grok playtest running independently and use its observations before claiming the existing flow is repaired.

### Review repair gate

The independent B2 review found that `works4` bridge q0 followed by ladder q11 can be rejected as `occupied` even though the structure spans are disjoint. The two sites share a discovery footprint approach tile at gz0. A red sequential build test and a physical-geometry occupancy check are required before the integrated suite; the complete discovery footprint remains required for visibility and eligibility.
