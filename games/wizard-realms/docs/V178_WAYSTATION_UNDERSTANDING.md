# V178 Waystation understanding

## Original Ask

Complete Wizard Realms as a connected third-person wizard RPG with a sustained campaign, meaningful skills, equipment, construction, trade, travel and eventual combat, mounts and endgame. The latest quest direction asks for fun world-based chapters that pay coin and XP, then useful armor and optional drops when the corresponding mechanics exist.

## Input PRD / Spec

[Quest campaign roadmap](QUEST_CAMPAIGN_ROADMAP.md) and [V174 quest content plan](V174_QUEST_CONTENT_PLAN.md) describe a Waystation repair-or-trade choice before creature care and first combat. Those are proposals, not shipped behavior. V39 now provides a checked Highland Quarry ring and durable return quest, but no Waystation choice. The full-game goal remains active.

## Aligned Problem Statement

Add one playable, persistent campaign beat in the same continuous world: an east-road river crossing near the existing highland approach is visibly broken. The player can gather eight logs or barter two quarried stones for eight timbers, build the existing connected-river bridge through normal Works, walk to the far bank, then return to Greenway Outfitters for a one-time claim. The repaired route remains usable. Use a distinct V40 DEV save and keep V39 and older saves intact.

## Goals

- Make two ordinary world/resource paths converge on one genuinely built crossing, not a menu-only choice or an arbitrary fetch counter.
- Make the chosen crossing discoverable from the eastbound trail, show the broken brace/stockpile and clear next-action cues, then show its saved bridge after construction.
- Make barter, far-bank witness and claim checked against authoritative terrain, inventory, discovery and save state. Reward exactly 45 coins, 45 Wayfinding XP and 45 character XP once.
- Preserve all V39 quests, ring travel, movement, trade, digging, construction and older save writers.

## Non-Goals

- No combat, protective armor, enemy drops, new item IDs, new store economy or full Waystation settlement in this pack. The later Iron Hall milestone must introduce real health, mitigation, durability, repair and unique loot before awarding armor or drops.
- No production default route, PR, push, GitHub action, new browser renderer, or modification of user-owned saves.

## Constraints and Repo Truth

- The existing V25 river is continuous and V28 already authorizes and renders a bridge at a seed-derived site. `works6:river-bridge:20` resolves to a dry, supported site for canonical `wizard-realms` and `greenway-alpha`; canonical north approach is `(80, 1.1915, 8)` and far exit is `(80, 1.1934, 24)`. The eastbound Highland corridor passes near `(80, 0)`. A deterministic nearest-column fallback can accommodate other valid migrated seeds without changing V28.
- The quarry currently yields two stone per checked extraction; the V39 ring makes a return trip practical. The existing bridge costs eight logs and gives its own 80 Construction XP. V40 claim XP is separate.
- Existing V39 strict replay, CAS, migration and versioned database are the storage pattern. V39 is read-only as a source for an explicit V40 copy. Normal Works remains the only way to build the bridge.
- Browser rendering previously approached the user's 1 GiB guard. Keep one existing preview available and do not launch a new isolated renderer without an authorized safe path. HTTP/build or SSR is not visual journey proof.

## Success Criteria

An ordinary player can find the broken crossing, choose either material route, build through Works, physically reach the south bank and return to Outfitters to claim once. The bridge persists and is traversable after reload. A full bag, no stone, invalid/remote/airborne witness, unbuilt bridge, premature claim, duplicate claim, stale save and malformed migration cannot mint materials or rewards. V39 source remains byte-for-byte unchanged. Focused tests and build pass; real browser acceptance must be reported separately and honestly.

## Open Questions and Risks

No outcome-determinative design question remains for V40. The site selector must prove a reachable dry V28 bridge for the canonical seed and reject migration safely for any seed with no valid bounded candidate. The major risks are accidental old-writer mutation, material duplication through barter/replay, false far-bank completion without a built bridge, and a marker or journal that hides the route. Browser proof is environment-constrained and cannot be replaced by deterministic tests.

## Routing

System translation: `not_qualified`, additive quest in one existing game, no source-to-target system port. System translation receipt: `not_applicable`. Product agent runtime: `not_required`, the shipped game does not run agents. Planner handoff: `auto-planner-ticket-pack`. Goal status: aligned, with the larger full-game objective still active.
