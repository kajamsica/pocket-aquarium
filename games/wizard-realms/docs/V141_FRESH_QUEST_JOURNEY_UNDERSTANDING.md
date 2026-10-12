# V141 fresh quest journey understanding

## Original Ask

The active goal is a complete connected wizard RPG, and the user recently asked for fun quests with useful coin, XP, armor and drops. Before adding more chapters, the current first three chapters need a real first-time-player journey. The user also asked for careful RAM use, one game renderer at a time, and a usable preview.

## Input PRD / Spec

`QUEST_CAMPAIGN_ROADMAP.md` explicitly calls for a genuinely fresh playtest of Surveyor, Ledger and Old Marker before new quests. V136 proved the first claim and save/reload from one fresh run; V137's attempt to reach Ledger stopped at a renderer RSS guard. V140 reduced no-Canvas movement allocation by about 30% and proved only a short route to an oak. Ledger and Old Marker remain unproven from fresh play.

## Aligned Problem Statement

Attempt the shortest normal-control fresh V36 journey that finishes Surveyor and enters Ledger, stopping at the first reproducible gameplay blocker, RAM guard or Ledger claim. Use the actual UI and visible cues, not a constructed save, hidden coordinates or developer grants. The result selects the next smallest implementation or performance repair.

## Goals

- Establish whether a new player can equip the axe, gather eight logs, build the supported creek bridge, reach the far-bank post, claim Surveyor, understand the Ledger objective and make progress using visible UI.
- Record the first exact player-facing confusion or failure, or a successful Ledger claim and checked reload if reached.
- Preserve 5194 preview, one owned disposable 5195 renderer and the RAM guard.

## Non-Goals

No new quest, game edit, save fixture, hidden navigation, debug boots, PR, GitHub action or long-session safety claim. An incomplete chapter is a valid probe result, not an acceptance pass.

## Constraints

Pre-render self-tested 50 ms exact-PID RSS sampler, 870400 KiB early stop, hard below 1024000 KiB. User-owned dirty work stays untouched. No parallel browser renderer or memory-heavy Node profile. The 5194 preview is never used for destructive test play.

## Success Criteria

A revision-bound normal-UI action trace gives stage reached, screenshots, visible objective/cues, coin/inventory/XP and save status, console/network, phase-local renderer/GPU/JS heap and idle recovery, exact first blocker or Ledger claim/reload, and browser/guard cleanup. If the guard fires, record phase and stop safely. The full-game goal remains active regardless of this short probe.

## Open Questions

Does the optimized V27 route keep RAM below the guard through gathering and construction? Are the bridge site, post, Ledger path and return trade legible without code knowledge? Is any first actual blocker product-owned or environment-owned?

## Implementation Risks

The first quest path may take longer than a short smoke run. Browser or RAM instrumentation perturbs memory, so its samples do not prove a leak. A code-informed tester may unconsciously use hidden route knowledge; every move must be grounded in visible UI.

## System Translation Routing

`not_qualified`; this is a UI evidence probe of an existing game. System Translation Receipt: `not_applicable`.
