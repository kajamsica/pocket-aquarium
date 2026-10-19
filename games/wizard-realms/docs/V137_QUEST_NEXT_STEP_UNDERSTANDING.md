# V137 quest next-step understanding

## Original Ask

The player wants fun, World of Warcraft-like quests that pay coin and XP and eventually award good armor and drops. This is part of the active full-game Wizard Realms goal, not a request to declare the existing starter quests complete.

## Input PRD / Spec

`QUEST_CAMPAIGN_ROADMAP.md` supplies the current quest rhythm, guaranteed reward rule, proposed chapters, and the distinction between travel clothing and protective armor. V135 and V136 record one normal-UI completion of the first quest, plus a still-open unpaced memory concern.

## Aligned Problem Statement

Before adding another reward button or combat loot table, verify that the current second-chapter handoff is legible through real play and specify a varied next quest/reward arc against actual shop prices, equipment capabilities, and save authority. The design must distinguish already playable rewards from future armor, combat, and drops.

## Goals

- Find the first actual player-facing blocker, if any, between the first quest claim and the Outfitters' Ledger delivery, without bypassing normal controls.
- Define three distinct next quest concepts, including optional discovery and a first-combat contract, with coin, named XP, guaranteed useful gear, and optional drops calibrated to current item prices.
- Preserve the active full-game goal and the existing checked V36 save, route, and quest rules.

## Non-Goals

- No combat, loot, armor-stat, mount, or V37 runtime implementation in this evidence/design pack.
- No GitHub action, commit, PR, save reset on the user preview, second renderer, or lowering of the V36 memory guard.

## Constraints

- Worktree `/private/tmp/pa-wizard-playable-v2` is dirty, with user-owned changes. Use `ben/` for any future new branch and only `gh-bioscopics` with a non-work identity for future game GitHub actions. Neither is needed in this pack.
- Keep the 5194 user preview live. Any browser evidence uses one disposable 5195 renderer, a self-tested 50 ms RSS guard, early stop at 870400 KiB, hard stop below 1024000 KiB, and closes the browser afterward.
- A checked fixture is not an organic journey. Do not claim a Ledger or Old Marker fresh-player completion from a synthetic starting state.

## Success Criteria

- A phase-labeled real-UI trace reports exactly how far a new player gets in Ledger, the first confusing step or complete delivery, reward and reload if reached, screenshot, console/network, and renderer memory peak.
- A concise design artifact names world-visible problem, clue, meaningful action, complication, return/turn-in, guaranteed coin and XP, useful gear, optional drop, source price calibration, authoritative ownership, and implementation prerequisites for each proposed chapter.
- The two results reconcile into a next implementation choice without representing unbuilt combat or armor as shipped.

## Open Questions

- Can a normal player find and complete the full Ledger path without source-derived waypoints or oversized journal instructions? The UI lane resolves this.
- What actual prices and current gear effects make a future quest reward meaningful? The reward-design lane resolves this from the current catalog.
- Will unpaced traversal repeat the V135 memory guard? The UI lane records a guarded observation but this pack does not claim full long-session clearance.

## Implementation Risks

Unpaced memory pressure may stop the browser before Ledger completion; that is an honest product result. UI guidance may hide a real route or return target. A design that promises protective armor or enemy drops before combat authority would be misleading. Multiple uncoordinated browser renderers would violate the RAM constraint.

## System Translation Routing

`not_qualified`: this is an evidence and game-design step within Wizard Realms, not a cross-system reimplementation. System Translation Receipt: `not_applicable`.
