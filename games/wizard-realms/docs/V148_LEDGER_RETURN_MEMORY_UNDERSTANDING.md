# V148 Ledger return memory understanding

## Original Ask

Finish Wizard Realms as a connected, persistent wizard RPG. The immediate accepted journey is the genuine saved Outfitters' Ledger return, stone excavation and claim. The user has also asked for a sustained quest campaign with meaningful coin, XP, gear and eventual drops, while keeping only one renderer open and watching RAM.

## Input PRD / Spec

The active full-game goal, `QUEST_CAMPAIGN_ROADMAP.md`, `V147_LEDGER_STONE_DELIVERY_TICKET_PACK.md`, and the existing V127, V138 through V143 memory receipts. No separate PRD changes the scope.

## Aligned Problem Statement

V147-A resumed the authentic saved V36 quest and moved backward across the saved connected-river bridge. The renderer then reached the exact-PID 870,400 KiB early stop during the next ordinary movement segment, before the player could return to Outfitters. The reported renderer peak was 891,936 KiB, below the 1,024,000 KiB hard ceiling. Browser and guard were closed; 5194 and 5195 remain HTTP 200 and the authentic test profile remains. Determine whether this V36 rise is tied to held frames, key-release checked save, Three.js resource churn, or a different process/phase before editing production code.

## Goals

- Obtain one synchronized, safety-bounded V36 phase trace and two independent current-source ownership maps.
- Identify the smallest measured owner and a discriminating same-entrypoint repair check, or state the exact residual unknown.
- Keep the authentic save, player preview, fidelity and integrity checks intact.

## Non-Goals

No production edit, new quest, lowered graphics, changed guard, save migration, new browser topology, PR or GitHub action in this diagnostic pack. A fresh fixture cannot substitute for the authentic quest journey.

## Constraints

One owned browser renderer at a time. A self-tested exact-PID guard must start before V36 navigation, poll nominally every 50 ms, stop at 870,400 KiB, and keep the process below 1,024,000 KiB. Close owned tabs and guard. Do not touch unrelated Chrome, modify private IndexedDB data, use debug grants or claim UI success from source tests. Source lanes do not run browsers or heavy tests.

## Success Criteria

- Browser lane reports same-PID baseline and phase RSS, JS used/total heap, GPU RSS, and visible save/action timestamp where obtainable, including honest missing metrics at a guard stop.
- Source lanes name current line-level owners and at least one falsifiable explanation each, without attributing magnitude from code alone.
- Fan-in chooses one measured repair owner or the smallest safe follow-up probe, not a speculative edit.

## Open Questions

- Does the large RSS rise start while W/S is held, only on release/checkpoint, or during nearby scene streaming?
- Is the rise mainly used JS heap, transient heap capacity/native IndexedDB, native renderer graphics, or mixed?

## Implementation Risks

One long input can exhaust the early guard before post-step CDP sampling. A copied browser profile must retain the same 127.0.0.1 origin and must not be mistaken for a fresh-player acceptance run. `vmmap` may be incomplete for Chrome PartitionAlloc. Avoid correlated source guesses masquerading as measured cause.

## System Translation Routing

`not_qualified`: this is diagnostic work on an existing game runtime, not a whole-system port. System Translation Receipt: `not_applicable`.

## Product Agent Runtime

`not_required`: Wizard Realms does not run a durable shipped model agent in this flow. The tester is build-time validation.

Goal status: aligned. Planner handoff: coding auto-planner, read-only diagnostic pack now, possible bounded repair pack after decision-grade evidence.
