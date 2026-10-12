# V149 Ledger return and save seam understanding

## Original Ask

Build the complete Wizard Realms RPG and make quests meaningful with coins, XP and useful gear. The current first-region proof needs the real Outfitters' Ledger stone-delivery claim and save/resume, while the user requires one renderer and a strict RAM watch.

## Input PRD / Spec

Active full-game goal, `QUEST_CAMPAIGN_ROADMAP.md`, V147 genuine saved journey and V148 memory attribution receipt.

## Aligned Problem Statement

The saved player claimed the far-bank survey but has not returned to Outfitters, acquired a spade, mined a stone or claimed Ledger. V147's long reverse movement hit the renderer early RAM guard. V148's S250 ms movement showed a transient 451,520 to 620,480 KiB RSS rise with natural recovery, not an established scene leak. Continue organic UI play safely enough to expose the next gameplay blocker or claim, and independently determine whether one current checked-save copy can be removed without weakening independent writer replay, CAS, hostile-input rejection or save migration.

## Goals

- Advance the genuine saved UI journey via ordinary controls, recording exact progress and stopping at the first gameplay blocker or RAM guard.
- Identify one safe, single-owner allocation seam in V36/V35 save wrappers, or return NO-GO with a precise reason.

## Non-Goals

No debug grant, fixture, teleport, profile modification, guard increase, graphics reduction, new quest implementation or GitHub action. A successful staggered return does not prove sustained-input RAM performance.

## Constraints

Only one game browser. Self-tested exact-PID 50 ms 870400 KiB early guard, hard below 1024000 KiB; close owned browser. The source lane runs no browser, Node profiler or edits. Preserve all dirty/untracked repository files and 5194 preview. If the original profile is used, normal game saves are allowed; no direct storage edits.

## Success Criteria

The browser lane either reaches the shop/spade/dig/stone/claim/reload via visible controls or returns a precise first blocker with screenshot, console/network and memory trace. The source lane returns a line-level one-owner GO/NO-GO and adversarial proof obligations. The planner then decides whether a bounded repair pack is justified.

## Open Questions

Can ordinary short gameplay inputs avoid an early stop long enough to complete the quest? Is the V36/V35 shell copy necessary for integrity at every checked save, or is one already-owned, already-validated value defensively copied again?

## Implementation Risks

Short pulses and idle recovery may mask a poor sustained-travel experience, so no performance acceptance claim follows from them. A source-level `@internal` label is not a runtime trust barrier. Removing a clone without alias proof could let a hostile caller change checked progress.

## System Translation Routing

`not_qualified`: local game diagnosis, not a port. Receipt `not_applicable`.

## Product Agent Runtime

`not_required`: no shipped agent runtime obligation. Goal status aligned; planner handoff coding auto-planner, diagnostic pack before any implementation.
