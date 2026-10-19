# V177 Ringkeeper understanding

## Original Ask

Build a complete third-person Wizard Realms RPG, with connected exploration, useful magic, skills, equipment, construction, shops, travel, quests, and endgame. The recent player request asks for quests that award coin, XP, and eventually meaningful armor and drops, not a sequence of empty counters.

## Input Spec and Current Reality

The [quest content plan](V174_QUEST_CONTENT_PLAN.md) defines The Ringkeeper's Trail as a discovery, return, and lasting shortcut. V38 now provides a checked Highland Signal quest and a separate DEV save, but it has no Highland fairy-ring link. V33 authorizes only Greenway to Mireglass travel. The classic generated world contains an unrelated small-map `ring-highland`; that legacy location must not be mistaken for the streamed Highland Quarry ring. There is no player health, combat, mitigation, durability, or enemy loot, so describing current clothing as armor or generating drops would be false.

## Aligned Problem Statement

Add a physically discoverable Highland Quarry ring to the same continuous world and make its two-way connection a checked, persistent player ability. The player walks to the ring on dry ground, returns to Greenway, establishes the link, takes an actual outbound and return journey, then claims a one-time coin and XP reward. Do this in a distinct V39 DEV save without changing V38 or older writers. The journey should be visible and usable from normal controls, with honest save and UI proof limits.

## Goal and Evidence

The full goal remains the complete single-player campaign and endgame, not V39 alone. This pack's success requires a reachable new ring, genuine checked two-way relocation, durable return witness, one-time claim, visible journal and map affordance, migration/reload proof, and an honest UI attempt or explicit environment-blocked record. Unit and SSR tests do not prove the full player journey.

## Constraints and Non-Goals

- Use `ring-highland-quarry` as a V39-only identifier. Do not put it in the old player's `discoveredRingIds` or reinterpret the classic small-map `ring-highland`.
- New schema `wizard-world/v39`, database `wizard-realms:world:v39`; explicit checked V38 copy or fresh start. Older databases are read-only.
- Reuse V38 movement, physical pose, discovery mask, V33 Greenway ring and travel safety checks, the shared scene ring visual, and checked writer/CAS conventions.
- No instant teleport to an undiscovered target, no client coordinates or payouts, no hidden terrain reveal, no armor or combat in this pack, no production default route, dependency, PR, push, or GitHub action.
- Keep at most one browser renderer. Prior isolated browser attempts exceeded the 1 GiB guard twice; do not launch a third without a separately authorized bounded environment.

## Design Decisions

- Canonical streamed ring tile is `(520,-488)`, 8 m from the authored trail end. Read-only terrain probe on seed `wizard-realms` found rocky dry highland, elevation `2.047217043465349`, and `publicV26TerrainCellIsWet=false`. The action lane must still prove effective support and approach reachability.
- Five monotonic V39-only booleans record `quarryRingDiscovered`, `ringLinkEstablished`, `ringOutboundCompleted`, `ringReturnCompleted`, and `ringkeeperClaimed`. A claim implies returned, returned implies outbound and link, link implies discovery. Do not duplicate the legacy ring ID list.
- Exact witnesses have server-owned positions and amounts: `ringkeeper-discover/v1`, `ringkeeper-link/v1`, `ringkeeper-travel/v1` with a two-value direction, and `ringkeeper-claim/v1`. Discovery requires presence at the Highland ring, linking and claim require presence at Greenway ring, and travel requires presence at its stated source. All require grounded effective support, revealed relevant sites, and safe arrivals.
- After linking, Greenway to Highland sets outbound. Highland to Greenway after outbound sets return. Both directions remain usable afterward. Claim awards exactly 25 coins, 30 Wayfinding XP, 20 Spellcraft XP, and 35 character XP once. It does not mint an item.

## Routing

System translation: `not_qualified`, an additive game feature with no paired whole-system port. System translation receipt: `not_applicable`. Product agent runtime: `not_required`, the shipped game does not execute an AI agent. The existing aligned durable goal supplies terminal condition and scope locks. Planner handoff: coding `auto-planner-ticket-pack`, with smallest viable diff and a DEV-only implementation pack.

## Risks and Open Questions

The primary data-loss risk is replaying V38 progress and movement while adding V39-only flags. The main journey risk is a ring that renders on a dry tile but has no safe arrival or reachable approach. The existing classic `ring-highland` name collision is handled by a distinct ID and V39-only ledger. Browser visual acceptance is unresolved under the RAM guard, but this does not block deterministic save, action, and controller work. No outcome-determinative question remains for this pack.
