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

The local world process owns clock, tick ordering, seeded randomness, terrain, chunks, player movement, resources, weather, shops, creatures, interactions, inventory, coins, XP, equipment, discoveries, fairy-ring travel, trade listings, saves, events, and projections.

Renderer, UI, audio, and input submit intents and interpolate projections. They never award resources, move items, grant XP, change coins, discover locations, or finalize travel.

### Server authority later

When networking begins, the same interface is hosted by authoritative servers. A player or entity has exactly one current simulation authority. Regional transfers are explicit transactions.

The client may predict reversible locomotion. It never commits economy, inventory, progression, death, discovery, portal, combat, or trade outcomes.

## Fixed tick and transition order

The initial target is 20 fixed ticks per second, subject to measurement before promotion and pinned in a simulation profile.

Each tick:

1. orders and validates intents;
2. advances time, weather, shops, and regional fields;
3. advances resources, regrowth, creature needs, and player conditions;
4. selects goals and desired motion;
5. resolves terrain, structures, agents, and safe movement;
6. resolves interaction contact and exactly-once consequences;
7. updates inventory, economy, skills, equipment, discovery, and travel;
8. emits events and immutable projections;
9. appends durable events and snapshots under the persistence policy.

Render cadence never changes causal steps.

## Intents, events, and projections

Representative intents include move, interact, gather, use tool, buy, sell, create or cancel listing, equip, select fairy-ring destination, and recover field pack.

Representative committed events include player moved, resource harvested, tool durability changed, item transferred, coins changed, XP granted, listing created or settled, location discovered, fairy-ring travel committed, player died, and recovery pack created.

Every rejection has a typed reason. Every projection carries world revision, content revision, generator version, authority epoch, and tick. Projected data is immutable to the client.

## Deterministic world and chunk contract

### Coordinates

The world uses right-handed meters. `X` increases east, `Y` increases upward, and `Z` increases north. Outdoor chunks are 64 by 64 meters.

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

### Seed, versions, and lifecycle

Base generation depends only on world seed, generator version, content revision, biome and landmark rule revisions, coordinates, and named deterministic random substreams. Equal pinned inputs reproduce terrain, eligibility, resource anchors, landmarks, and connectivity. Runtime changes are deltas over that base.

Generator upgrades never silently rewrite a save. A migration keeps the old generator, transforms stored deltas through a named migration, or creates a new world.

Chunk states are:

```text
unrequested -> generating -> validated -> active -> cooling -> unloaded
```

Only validated chunks become authoritative. Activation must not depend on completion order. Unloading persists required deltas or proves deterministic reconstruction. Interest includes movement horizon, visible or audible neighbors, active interactions, and pinned obligations.

## Content profiles versus state

Profiles define what a tree, tool, item, creature, vendor, biome, weather pattern, fairy ring, or equipment piece can be. They are immutable and revisioned.

State records what an instance is doing now, such as tree progress, vendor stock, durability, XP, equipment, discoveries, and active listings. Saves reference stable profile IDs and pinned content revisions. They do not serialize meshes or UI labels as gameplay truth.

## Save schema and migrations

Every save represents these version pins and values, even if its serialized shape groups them differently:

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

## Identity, ownership, and event IDs

Single player keeps these logical boundaries even when one process hosts them:

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

Each consequential command carries a client request ID. Committed event identity is:

```text
worldId / authorityEpoch / tick / authoritySequence
```

The authority retains processed IDs for a bounded period and returns the original result for an exact retry. Reusing an ID with a different payload is rejected. Sequence is monotonic within an epoch. Restore, leader replacement, or handoff changes the persisted epoch.

## Fairy-ring travel transaction

1. Receive request ID, player, origin, destination, and expected player revision.
2. Validate proximity, discovery of both rings, destination, cooldown, state, and cost.
3. Reserve the player against conflicting movement, death, inventory, or travel commits.
4. validate and activate a safe destination placement.
5. Prepare the destination authority if crossing a region boundary.
6. Commit origin, destination, cost, tick, versions, and ownership transfer once.
7. Update authority and pose, emit one event, and release the reservation.

Preparation failure leaves the player and cost at the origin. Lost acknowledgement is recovered by request ID. The player never exists authoritatively at both endpoints.

## Trade-listing transaction

The player starts with four listing slots.

1. Receive request ID, expected inventory revision, stack IDs, quantity, price, and duration.
2. Validate listing capacity, ownership, quantity, tradability, price bounds, and fee.
3. Move items into authoritative escrow.
4. Create an immutable listing and expiry.
5. Commit escrow and listing atomically, then emit the result.

Settlement atomically transfers items and coins. Cancellation or expiry returns escrow exactly once. A crash produces either old state or full committed state, never duplication or a listing without escrow. The single-player simulated market calls this same boundary.

## Rollback, replay, and reconciliation

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

## Services for persistent scale

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
| Single-player vertical slice | 1 player, 9 active chunks, 20 ticks per second | 30-minute journey, p95 tick under 35 ms, save and replay digest pass, frame-chunk determinism, no client grants |
| Co-op authority proof | 2 to 8 players, 64 active chunks, region handoff | 2-hour soak, p95 tick under 40 ms and p99 under 50 ms, reconnect idempotency, transaction disconnect tests, hostile-client bounds |
| Small persistent realm | 100 concurrent players, multiple authorities and durable services | 24-hour soak at 150 players, no sustained tick debt, zero loss of acknowledged economy events, authority recovery, transfer, privacy, moderation, backup and rollback drills |
| MMORPG launch candidate | At least 1,000 concurrent players across a realm group, horizontal regions, shards, and instances | 24-hour soak at 1.5 times launch target, hotspot degradation without corruption, security and privacy review, disaster and abuse drills, state-safe rollback, alarms tied to practiced actions |

Sequence:

```text
vertical slice -> co-op proof -> persistent realm
-> measured regional and service scaling -> MMORPG launch candidate
```

Each transition consumes replay, transaction, failure, security, and capacity evidence. Failure keeps the project at the earlier honest capability level. MMORPG promotion is also a product, safety, support, and operations decision.

## Architecture acceptance

Implementation planning may begin only when:

- every gameplay fact and transaction has one authority;
- world seed, generator, content, simulation, schema, and authority versions are pinned;
- chunk coordinates and IDs are stable across generation order;
- local play uses the intent and event boundary intended for servers;
- save and replay preserve causal continuation;
- fairy-ring and listing transactions are exactly once;
- retained client and future server responsibilities are explicit;
- each capacity milestone has a measurable exit gate;
- the product claim remains single player until later gates pass.
