# Starter valley affordance pack

## Summary

The user's opening valley should teach actions through legible geography rather
than hard stops. This pack delivers one narrow, immediately testable UI repair
and two independent source audits that fix the contracts for a subsequent
versioned river and excavation milestone. The larger milestone remains open.

## Proposed flow

1. A fresh V24 player walks on dry land. Ordinary visible, supported land is
   traversable. A river or cliff visibly interrupts travel.
2. Attempting to cross a blocked creek or cliff shows a concise, prominent
   local cue with the exact next tool and resource loop. Repeated held input
   does not spam the cue or recent-event history.
3. The player gathers logs, buys/equips boots and a spade as appropriate,
   selects Works, and builds a bridge or ladder. The prior obstacle becomes a
   supported route. This pack does not alter that authority.
4. A future V25 world will extend the river to a connected endpoint and add
   clicked-ground excavation, strata rewards, saved divots, fill/support, and
   30-minute home rescue. The audits here produce the implementation contract;
   they do not mutate legacy roots.

## Public interfaces and scope locks

- Existing current preview: `http://127.0.0.1:5193/?publicWorld=v24`. Keep its
  one renderer and current save available; no second renderer.
- `PublicV23Controller` consumes authoritative `advanceFrame().rejections`.
  It must not invent collision reasons. Only recognized creek, cliff,
  off-bridge, off-ladder, and true outer-edge messages get a contextual cue.
  Unknown or owner-crossing failures retain their exact rejection text.
- No change to `PublicWorldV17/V23/V24` terrain, state, writer, replay, migration,
  actions, or save schema in the feedback slice.
- Historical save roots are immutable. A new authoritative river or excavation
  grammar requires a V25 root and an explicit checked V24-to-V25 migration.
- No GitHub writes, PR, commit, branch creation, or account switch are in scope.

## Lane graph

| Lane | Role and custody | Deliverable | Depends on |
| --- | --- | --- | --- |
| SV-01A | Implementer, `PublicV23Controller.tsx` and `PublicV23ControllerInput.test.tsx` only | Prominent exact-rejection cue with deduplicated held-input feedback; focused tests | This pack |
| SV-01B | Read-only source auditor, river/terrain/rendering and save version files | Exact V25 connected-river topology and migration risk note, including present geometry and canonical cell ownership | This pack |
| SV-01C | Read-only source auditor, Work/pointer/save/clock files | Exact V25 dig, strata, fill, rescue interface options and replay/cooldown hazards | This pack |
| SV-01D | Implementer, V23 transition/runtime and corresponding tests only | Retain authoritative local movement rejection without altering accepted replay | SV-01B discovery |
| SV-01R | Read-only reviewer | Independent scope and regression check of SV-01A and SV-01D after receipts | SV-01A/D |
| Root | Planner, integrator and validator | Tests, typecheck, existing preview HTTP check, UI proof or honest blocker, next pack decision | SV-01A/B/C/D/R |

Topology audit: A, B, and C are incomparable, productive lanes. B and C have
distinct evidence questions and no file edits. D is a causally discovered
repair with disjoint file custody from A. R is an independent QA lane,
not an artificial implementation split. No concurrent editor owns the same
file. Reviews and validation do not create another browser renderer.

## Tickets

### SV-01A: immediate collision explanation

Input: `PublicV23Controller` currently calls `tell` on every frame rejection,
and HUD events are low salience. V23/V24 currently collapse local failed moves
to a generic message even though V17 has exact reasons. Do not infer a
geography-specific cause before SV-01D supplies one.

Implement a single prominent, transient, accessible status cue in the
controller for a rejected movement. Show the authoritative message plus, only
when that message itself explicitly says creek or cliff, the control hint
(`B` Works, Bridge needs 8 logs; Ladder needs 4 logs). A repeated same rejection during a held input
must not append duplicate recent events or continually reset cue expiry. A
changed reason may replace the cue. Clear on successful movement or after a
short timeout, using a monotonic time source without adding long-lived timers.
Do not show a cue for idle frames or unrelated checked-action rejections.
The cue must avoid the touch movement controls and map overlay, and not trap
pointer input. Do not hide unknown boundary errors or convert them to a
misleading cliff/river hint.

Tests: extend the existing controller input mock to inject rejections and
verify initial cue, same-reason deduplication, changed reason, clear on
successful move, no idle cue, and V23/V24 behavior. Preserve existing tests.
Run focused Vitest, TypeScript, and `git diff --check`. Report exact files,
result, and any UI proof limitation. Do not commit.

### SV-01D: retain authoritative movement rejections

`advancePublicV23Frames` and its private `framesResult` currently return
`null` for both invalid replay and source movement rejection. The controller
runtime therefore reports one generic message for any failed local move.

Within `domain/publicWorldV23Transitions.ts`, `PublicV23ControllerRuntime.ts`,
and their focused test files only, expose a read-only local frame result or
rejection diagnostic from the *same* V17/streamed transition path. Preserve
`advancePublicV23Frames` and `applyPublicV23Witness` success/null behavior,
witness format, checked writer, pending-frame order, and V24 compatibility.
On a failed one-frame preview, the runtime should return the actual source
`PublicWorldRejection` when available. If failure is decode, internal proof,
or full pending replay inconsistency without a specific source rejection,
retain the generic message. Do not infer from position, visual art, or an
independent approximation. Test creek, cliff, owner handoff or streamed
rejection, plus invalid witness paths. Run focused Vitest, TypeScript, and
diff check. Do not commit or open a browser.

### SV-01B: connected river and save topology audit

Read-only. Trace the current five wet cells (x -10..10 m, z 6..10 m), bridge
canonical footprint, water mesh, collision, outer world bounds, and world
owner crossing. Recommend one finite, continuous river graph with visible
map-edge continuation or lake terminus, which is traversable only by a saved
bridge/boat route. Name source owners, interface changes, V25 migration
choices, compatibility witnesses, and high-value tests. Flag any current
non-river obstruction that can make visible dry terrain feel blocked. Do not
edit, render, or run a browser.

### SV-01C: excavation and rescue contract audit

Read-only. Trace equipped spade checks, pointer raycasts, canonical work sites,
terrain overlay, inventory/reward, checked action, replay proof, and save clock.
Recommend a smallest viable 4 m addressed-column dig action, deterministic
biome/depth material table with common dirt/stone and rare mineral gates,
bounded depth/bedrock, persistent divot and fill/support, and a saved 30-minute
rescue cooldown. Specify how wall-clock time is attested on checked actions
without relying on suppressed idle ticks or allowing reload/clock rollback to
reset the cooldown. Distinguish starter milestone from later mining depth.
Do not edit, render, or run a browser.

### SV-01R: feedback code review

Read-only. Verify deduplication does not swallow changed errors; only movement
rejections are cued; no false geography assertion; map/touch constraints and
legacy authority untouched; tests prove behavior. Report findings first.

## Validation and stop conditions

- Automated: focused controller input tests, TypeScript, relevant existing
  movement tests, and diff check.
- Runtime: existing server health only. UI acceptance remains required, but
  computer-control bridge currently returns `unsupported Codex auth method:
  apikey`; do not bypass with a second browser renderer. State UI proof as
  blocked until the bridge recovers or the user verifies the same journey.
- Do not call V25, mining, hydrology, or rescue complete from SV-01A/D. The
  source audits feed a second implementation pack with schema decisions.
- Stop and replan if the same visible stop survives two grounded repairs or
  if a fix would mutate legacy replay semantics.

## Assumptions and smallest viable diff

The exact user-observed stop position is unknown. The confirmed creek/cliff
rejection path suffices for a bounded feedback repair; owner-crossing and dry
terrain stops must be investigated separately, not guessed. SV-01A reuses the
existing authoritative rejection and controller status UI. No new dependency,
schema, input action, or terrain profile is justified in that lane. The
versioned V25 milestone is intentionally separate because changing V17 terrain
in place could invalidate saved poses and witness replay.

## Execution receipt

- SV-01A and SV-01D landed in the local working tree. A shows a prominent,
  transient movement cue, dedupes a continuous hold, and re-arms after a fresh
  attempt. Exact creek/cliff rejections add touch and keyboard Works hints.
  D preserves V17/streamed source rejections in the live V23/V24 preview while
  leaving checked witness replay behavior unchanged.
- SV-01B and SV-01C completed read-only audits. Their V25 topology, excavation,
  and rescue contracts are captured in
  `STARTER_VALLEY_WORLD_LOOP_UNDERSTANDING.md`.
- Independent SV-01R review: GO after retry, touch-copy, and safe-area repairs.
- Root validation: 91 focused tests across four suites passed; TypeScript and
  production build passed. The existing V24 preview returned HTTP 200.
- Visual UI proof remains unavailable: the browser-control bridge reports
  `unsupported Codex auth method: apikey`. HTTP/build/test results are not a
  substitute for a rendered user journey.
- No commit, PR, push, deployment, new browser renderer, or legacy save-schema
  edit was made in this pack. V25 river, free excavation, fill, and rescue are
  not implemented yet.
