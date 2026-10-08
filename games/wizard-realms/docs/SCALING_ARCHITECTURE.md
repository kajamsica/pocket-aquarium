# Wizard Realms Scaling Architecture

## Purpose

Wizard Realms starts as an authoritative local single-player simulation. It may later evolve through co-op and persistent realms toward MMORPG scale without discarding its game rules. This is an architecture contract, not a claim that networking or MMO infrastructure exists.

The controlling source is [Foundation and Architecture](../../../docs/game-development/FOUNDATION_AND_ARCHITECTURE.md). Implementation must also apply the deterministic interaction contracts in [Realism, Behavior, and Physics](../../../docs/game-development/REALISM_BEHAVIOR_AND_PHYSICS.md), immutable content method in [Asset and Animation Pipeline](../../../docs/game-development/ASSET_AND_ANIMATION_PIPELINE.md), operational gates in [Product Tooling and Validation](../../../docs/game-development/PRODUCT_TOOLING_AND_VALIDATION.md), and records in [Reusable Specification Templates](../../../docs/game-development/REUSABLE_SPEC_TEMPLATES.md).

## Foundation laws

Wizard Realms inherits six laws:

1. One gameplay fact has one authority.
2. One cause advances on one fixed causal clock.
3. Surfaces send typed intents and receive committed events.
4. Clients render read-only projections instead of duplicate mechanics.
5. Immutable content profiles remain separate from mutable state.
6. Candidate, approval, promotion, and release remain explicit states.

The first authority runs locally. Later authorities may run on servers. The boundary stays the same.

## One world authority

### Local authority today

The current v4 local foundation owns its 50 ms clock, tick ordering, seeded randomness, player movement and jump state, resource nodes, two shops with direct sales, interactions, inventory, coins, five skill XP tracks, equipment, waystone study, Wayfinder Glow discovery, gated dig sites, fairy-ring travel, four trade slots, saves, events, and projections. The browser defaults to the original seven-by-seven terrain; domain generation also supports an opt-in 16 by 16 profile that preserves the original core. Neither profile is a finished region or game. Flexible player-selected construction, weather, creatures, regional chunks, remote services, request IDs, authority epochs, state digests, and a durable event log are not yet implemented.

Weather, creatures, chunk streaming, and every networked authority named later in this document are future milestones. Their descriptions are requirements for those milestones, not claims about the current package.

Renderer, UI, audio, and input submit intents and interpolate projections. They never award resources, move items, grant XP, change coins, discover locations, or finalize travel.

### Server authority later

When networking begins, the same interface is hosted by authoritative servers. A player or entity has exactly one current simulation authority. Regional transfers are explicit transactions.

The client may predict reversible locomotion. It never commits economy, inventory, progression, death, discovery, portal, combat, or trade outcomes.

## Fixed tick and future transition order

The vertical slice advances one deterministic local step every 50 ms, including idle and rejected-intent steps. That is a 20-tick-per-second implementation target, not a measured capacity claim.

The current step orders and validates intents, advances player terrain and jump physics, advances the simulation RNG, commits accepted state, emits events or typed rejections, and produces a projection. Later simulation profiles must add the following ordered phases:

1. orders and validates intents;
2. advances time, weather, shops, and regional fields;
3. advances resources, regrowth, creature needs, and player conditions;
4. selects goals and desired motion;
5. resolves terrain, structures, agents, and safe movement;
6. resolves interaction contact and transaction consequences;
7. updates inventory, economy, skills, equipment, discovery, and travel;
8. emits events and immutable projections;
9. appends durable events and snapshots under the persistence policy.

Render cadence never changes causal steps.

## Intents, events, and projections

Representative intents include move, gather, build or traverse a fixed route, buy, sell, create or cancel a listing, equip, study the waystone, cast Wayfinder Glow, excavate a dig site, and select a discovered fairy-ring destination. Field-pack recovery is a future intent.

Current committed events include movement, resource harvest, fixed-route construction and traversal, tile and fairy-ring discovery, waystone study, spell casting, excavation, skill XP, equipment changes, store purchases and sales, trade-listing creation and cancellation, and fairy-ring travel. Tool durability, listing settlement, death, and recovery packs remain future events.

Today, every rejection has a typed reason and every projection carries the local tick. Projection objects are detached from authoritative state. World revision, content revision, generator version, authority epoch, and digest fields are future protocol requirements.

## Deterministic world today and future chunk contract

### Coordinates

The local world uses right-handed meters. `X` increases east, `Y` increases upward, and `-Z` points north. Yaw zero faces north, so forward movement reduces Z and the north-up map orders lower Z rows first. The default profile has seven by seven 4 m tiles; the opt-in 16 by 16 profile is a roughly 64 m preview around the preserved core, without streaming. The full single-player game targets a connected, streamed world roughly 2 km across. A later chunked world must use 64 by 64 meter outdoor chunks and the following coordinate rules:

```text
chunkX = floor(worldX / 64)
chunkZ = floor(worldZ / 64)
localX = worldX - chunkX * 64
localZ = worldZ - chunkZ * 64
```

Floor division keeps local coordinates in `[0, 64)` for negative positions. Elevation stays as absolute world `Y`. Isolated interiors use an instance identity and the same meter convention.

Canonical chunk key:

```text
worldId / generatorVersion / chunkX / chunkZ
```

Entity and landmark IDs must not depend on render or generation completion order.

### Future seed versions and chunk lifecycle

Today, base generation depends on the world seed and deterministic named inputs in the generator. Generator version, content revision, biome and landmark revisions, named substream records, and persisted chunk deltas are future requirements. When added, equal pinned inputs must reproduce terrain, eligibility, resource anchors, landmarks, and connectivity.

Generator upgrades never silently rewrite a save. A migration keeps the old generator, transforms stored deltas through a named migration, or creates a new world.

Chunk states are:

```text
unrequested -> generating -> validated -> active -> cooling -> unloaded
```

Only validated chunks become authoritative. Activation must not depend on completion order. Unloading persists required deltas or proves deterministic reconstruction. Interest includes movement horizon, visible or audible neighbors, active interactions, and pinned obligations.

## Content profiles versus state

Profiles define what a tree, tool, item, creature, vendor, biome, weather pattern, fairy ring, or equipment piece can be. They are immutable and revisioned.

State records what an instance is doing now, such as tree progress, vendor stock, durability, XP, equipment, discoveries, and active listings. Saves reference stable profile IDs and pinned content revisions. They do not serialize meshes or UI labels as gameplay truth.

## Current save and future migration schema

The current `wizard-world/v4` save pins `greenway-region-v2` content and contains the local world state, seed, generation profile, tick, simulation RNG, event sequence, built routes, discovered tiles, learned spells, skill XP, waystone study, and dig-site reveal and excavation state. Valid v1/v2/v3 saves restore into v4 state and are written to a new v4 storage key on save while source bytes remain untouched; profile-less v1/v2 saves restore as the original seven-by-seven world. Unknown schemas, profiles, and content revisions fail closed before autosave. Structural validation precedes restore, but nested values are still sanitized, not fully audited. The local save does not contain the complete distributed-system metadata below. A future persistent or networked schema must add and validate these values:

```text
schemaVersion, saveSequence, worldId, worldSeed
generatorVersion, contentRevision, simulationProfileVersion
authorityEpoch, committedTick, lastEventId, stateDigest
worldState, playerState, chunkDeltas
```

Migration rules:

1. Migrations are ordered, versioned, deterministic functions.
2. Unknown newer schemas fail closed and preserve original bytes.
3. A source backup remains until the migrated save loads and validates.
4. Sanitization reports repaired, defaulted, quarantined, and rejected fields.
5. Save, close, reopen, and replay must reach the expected next digest.
6. Multi-device writes require monotonic sequence or compare-and-swap, not timestamps alone.

## Future identity, ownership, and event IDs

The vertical slice has one local owner and a monotonic local event sequence. The following ownership split and identifiers are future network protocol requirements:

| Fact | Current owner | Later owner |
|---|---|---|
| Identity and entitlement | Local profile authority | Account and character service |
| Live pose and interactions | Local world authority | Current regional authority |
| Inventory and equipment | Local world authority | Character or inventory authority |
| Coins, escrow, listings | Local economy authority | Economy service |
| Resources and creatures | Local world authority | Regional authority |
| Discoveries and ring access | Local world authority | Character authority with regional validation |
| Chat, groups, social graph | Not in MVP | Social and chat services |

No durable fact has simultaneous writers.

Future consequential commands must carry a client request ID. Their committed event identity will be:

```text
worldId / authorityEpoch / tick / authoritySequence
```

A future authority must retain processed IDs for a bounded period and return the original result for an exact retry. Reusing an ID with a different payload must be rejected. Sequence must be monotonic within an epoch. Restore, leader replacement, or handoff must change the persisted epoch. None of those request-ID or epoch behaviors exists in the local vertical slice.

## Future networked fairy-ring travel transaction

The current local domain validates range and discovery, then commits one in-memory teleport event. Cross-authority preparation, request-ID recovery, revisions, and distributed exactly-once delivery are not implemented. A networked milestone must use this transaction:

1. Receive request ID, player, origin, destination, and expected player revision.
2. Validate proximity, discovery of both rings, destination, cooldown, state, and cost.
3. Reserve the player against conflicting movement, death, inventory, or travel commits.
4. validate and activate a safe destination placement.
5. Prepare the destination authority if crossing a region boundary.
6. Commit origin, destination, cost, tick, versions, and ownership transfer once.
7. Update authority and pose, emit one event, and release the reservation.

Preparation failure leaves the player and cost at the origin. Lost acknowledgement is recovered by request ID. The player never exists authoritatively at both endpoints.

## Future persistent trade-listing transaction

The current player has four local listing slots. Listing and cancellation move owned inventory into and out of local escrow atomically for one step. Settlement, expiry, fees, request IDs, revisions, and crash recovery are future work. A persistent economy milestone must use this transaction:

1. Receive request ID, expected inventory revision, stack IDs, quantity, price, and duration.
2. Validate listing capacity, ownership, quantity, tradability, price bounds, and fee.
3. Move items into authoritative escrow.
4. Create an immutable listing and expiry.
5. Commit escrow and listing atomically, then emit the result.

Settlement atomically transfers items and coins. Cancellation or expiry returns escrow exactly once. A crash produces either old state or full committed state, never duplication or a listing without escrow. The single-player simulated market calls this same boundary.

## Future rollback, replay, and reconciliation

The current package supports deterministic generation, serialized restore, and next-step equivalence tests. It does not yet ship snapshots plus replay, state digests, administrative epochs, compensation ledgers, or network prediction reconciliation. Those milestones require:

- Periodic snapshots record last included event ID and state digest.
- Restore loads a valid snapshot and replays later events.
- Golden replay proves checkpoint events and state digests.
- Chunk order and render frames cannot change committed outcomes.
- Administrative rollback opens a new authority epoch and corrective stream instead of rewriting history.
- Economy corrections use compensating ledger events.

For networked movement, authoritative correction rewinds prediction, reapplies unacknowledged movement inputs, and blends presentation. Inventory, coins, XP, listing, portal, death, and discovery are never client-committed.

## What stays and what moves

Client code that can stay:

- input and semantic intent construction;
- camera and presentation settings;
- world, HUD, inventory, store, equipment, skills, map, and trade projections;
- animation, materials, particles, audio, interpolation, LOD, and occlusion;
- candidate workbench views;
- bounded movement prediction and reconciliation presentation;
- accessibility and keyboard, controller, or touch grammar over shared intents.

Authority that moves server-side:

- simulation ticks, RNG, validation, and rate limits;
- generation approval, chunks, resources, creatures, weather, shops, and interactions;
- pose authority, health, death, recovery, combat, and discovery;
- inventory, equipment, coins, XP, skills, travel, and trade;
- event log, snapshots, migrations, moderation, and audits.

Shared deterministic libraries may run on both sides for prediction, but only the named authority commits.

## Future services for persistent scale

No service in this section exists in the vertical slice. They are possible later ownership boundaries after co-op measurement proves they are needed.

- **Regional authorities:** Own groups of chunks and transfer players through prepared handoff.
- **Interest management:** Sends only relevant, permitted projections based on distance, visibility, audio, interaction, group, and UI subscription.
- **Sharding and instancing:** Partition population without duplicating global identity, ownership, or scarce economy items.
- **Persistence:** Stores snapshots, events, migrations, revision pins, backups, and replay evidence.
- **Economy:** Owns coins, escrow, listings, settlement, fees, idempotency, and audit.
- **Chat and social:** Owns presence, friends, groups, guilds, and chat outside the simulation tick.
- **Moderation:** Provides reports, blocks, mutes, sanctions, naming policy, appeals, audit retention, and staff permissions.
- **Anti-cheat:** Validates movement, cadence, reach, ownership, progression, prices, and revisions while treating latency and accessibility tools fairly.
- **Reconciliation:** Uses ticked snapshots for motion and explicit pending or committed UI for high-impact transactions.
- **Observability and live ops:** Tracks ticks, chunks, handoffs, latency, corrections, economy invariants, transactions, saves, migrations, moderation, versions, and rollback.

Live configuration is versioned, access controlled, staged, and reversible. Operators use audited domain commands, not renderer or database edits.

## Capacity milestones and exit gates

Targets are provisional until measured on named hardware and deployment profiles.

| Milestone | Capacity target | Measurable exit gates |
|---|---|---|
| Local systems foundation | 1 player, 7 by 7 default or opt-in 16 by 16 tile profile, 20 ticks per second | 30-minute journey, p95 tick under 35 ms, save and replay digest pass, no client grants |
| Full single-player RPG | Connected streamed world roughly 2 km across, at least 3 distinct regions, exploration, traversal, economy, and endgame | Complete fresh-save campaign and repeatable endgame journeys, exercise each travel tier and regional trade, preserve world changes across reload, p95 tick under 35 ms on named target hardware |
| Co-op authority proof | 2 to 8 players, 64 active chunks, region handoff | 2-hour soak, p95 tick under 40 ms and p99 under 50 ms, reconnect idempotency, transaction disconnect tests, hostile-client bounds |
| Small persistent realm | 100 concurrent players, multiple authorities and durable services | 24-hour soak at 150 players, no sustained tick debt, zero loss of acknowledged economy events, authority recovery, transfer, privacy, moderation, backup and rollback drills |
| MMORPG launch candidate | At least 1,000 concurrent players across a realm group, horizontal regions, shards, and instances | 24-hour soak at 1.5 times launch target, hotspot degradation without corruption, security and privacy review, disaster and abuse drills, state-safe rollback, alarms tied to practiced actions |

Sequence:

```text
local foundation -> expanded-region proof -> full single-player RPG
-> optional co-op proof -> persistent realm
-> measured regional and service scaling -> MMORPG launch candidate
```

Each transition consumes replay, transaction, failure, security, and capacity evidence. Failure keeps the project at the earlier honest capability level. MMORPG promotion is also a product, safety, support, and operations decision.

## Future architecture acceptance

Implementation planning may begin only when:

- every gameplay fact and transaction has one authority;
- world seed, generator, content, simulation, schema, and authority versions are pinned;
- chunk coordinates and IDs are stable across generation order;
- local play uses the intent and event boundary intended for servers;
- save and replay preserve causal continuation;
- networked fairy-ring and listing transactions prove retry-safe, exactly-once outcomes;
- retained client and future server responsibilities are explicit;
- each capacity milestone has a measurable exit gate;
- the product claim remains single player until later gates pass.
