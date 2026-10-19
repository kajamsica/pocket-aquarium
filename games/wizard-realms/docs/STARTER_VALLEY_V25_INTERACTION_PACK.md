# Ticket Pack: V25 starter-valley interaction

## Goal and honest scope

The player should understand why a real obstacle stopped them, turn trees into
an obvious bridge or ladder route, and eventually dig a clicked column with an
equipped spade. This pack first closes the V25 river UI review, repairs the
smallest observed onboarding gap, and fixes a save-safe excavation contract
before an implementation lane touches authority. The full-game goal remains
active. A visible divot, fill, pit ladder, and 30-minute home rescue are not
complete merely because the pure V25 excavation ledger exists.

The current V25 preview is the one local renderer at
`http://127.0.0.1:5193/?publicWorld=v25`. No second renderer, production
deployment, GitHub action, commit, or branch change is authorized.

## Fixed interface and safety constraints

- V25 is separate from V24 and source-pinned. Never mutate V17/V23/V24
  witnesses or terrain to accommodate new V25 behavior.
- `PublicV25Head.excavation` is an exact saved ledger. The existing V25 root
  rejects any excavation change without a checked V25 action witness. A click
  may submit only a canonical 4 m grid coordinate; reach, reveal, tool,
  capacity, support, occupancy, stratum, and reward must be derived again in
  the checked writer under its lock.
- The V23/V24 player state is inherited by V25, so its Y pose is validated
  against the old surface. A lowered V25 surface cannot be added as visual
  dressing alone. The implementation contract must specify how V25 movement,
  replay, and the displayed pose use one deterministic ground-height rule.
- Filling must not let a player extract rewards twice from the same depth.
  A 30-minute cooldown must be recorded in a checked save, not inferred from
  suppressed idle ticks or a React timer. Old database copies and manipulated
  local clocks are outside offline anti-cheat guarantees.
- Dry, ordinary visible terrain must remain traversable. Only a true river,
  cliff, world limit, or grounded collision may block; the message must name
  the observed reason. Do not relabel an owner-crossing failure as a cliff.

## Lane graph and audit

Wave 0: R2 independent review of the existing V25 river slice.

Wave 1: A read-only excavation architecture audit || B V25-only obstacle and
route guidance repair || C read-only starter-economy and route audit.

Wave 2: after A/C, root fixes the checked excavation and escape interface and
dispatches disjoint domain, runtime, view, and route implementation lanes.

Wave 3: independent code review, targeted tests, TypeScript/build, existing
server check, and the one existing browser journey when its auth bridge works.

A and C answer different causal questions. B edits only the controller and
its tests while A/C inspect source read-only. No concurrent editor owns the
same files. R2 is read-only and may run concurrently with B, but its GO
applies to the pre-guidance river slice. This is real, bounded parallelism.

## Tickets

### A: authoritative dig and recovery interface audit

Read-only. Trace `publicWorldV25Snapshot`, `publicWorldV25Flow`,
`PublicV23ControllerRuntime`, V23 frame replay, V25 excavation ledger,
`WizardScene` terrain mesh, and surface picker. Return the smallest credible
additive V25 design for clicked digging and true depth-aware movement without
changing older save semantics. Name exact witness, replay, height, occupancy,
visual picker, bag, fill/no-farm, and escape/cooldown boundaries; list file
ownership for disjoint implementer lanes and tests. Identify any blocking
invariant rather than suggesting a cosmetic-only divot. No edits, browser,
server restart, commit, or GitHub action.

### B: V25-only route guidance

Implementer. Own `PublicV23Controller.tsx` and
`PublicV23ControllerInput.test.tsx` only. The V25 river rejection currently
says to build a bridge but omits the first actionable control/resource loop.
For that exact message, give a short Works/Bridge hint with the established
8-log cost. Keep existing V24 creek/cliff copy, deduplication, timeout, and
unknown rejection behavior unchanged. Add a V25-specific initial guide that
explains: chop trees for logs, 8 logs for a river bridge, 4 for a cliff
ladder, equip boots to run, then follow visible routes. The guide must be
collapsible/dismissible, avoid blocking the game on phone, and not claim that
arbitrary click-to-dig or rescue is already available. Prefer reusing the
current `.v23-guide` region and do not add an overlay obscuring movement.
Focused tests, TypeScript, build, diff check. Budget <=130 net lines. No
browser, server restart, commit, or GitHub action.

### C: starter-valley economy and route proof

Read-only. For the exact fresh V25 genesis, calculate whether at least 12
accessible logs are available on the starting side before river/cliff gates,
where the supported bridge and cliff ladder can be built, whether the store
and boots/spade are reachable, and whether a new user can learn those actions
from the current UI. Use deterministic source/test evidence, not screenshots
or another renderer. Return observed gaps and a minimum production owner for
each. No edits, browser, server restart, commit, or GitHub action.

### R2: existing river integrated review

Read-only. Verify the one-line V24 boots assertion repair matches checked
behavior, repeat the same ten-file integrated test, TypeScript, and build.
Its verdict certifies only the existing V25 connected-river slice.

## Validation and stop conditions

The existing V25 route was exposed at its minimum code gate, with HTTP 200.
The browser-control bridge reports `unsupported Codex auth method: apikey`;
do not treat HTTP/tests as rendered UI proof or start another WebGL process.
After a concrete failure, follow the exact observed error, smallest owner,
restart only if needed, identical retry loop. If A finds that a V25-only
movement extension cannot preserve inherited source proof, move digging to a
new explicitly migrated version instead of weakening V25/V24 validation.

The next implementation pass must prove save/reload of a selected column,
render and collision agreement, rejected remote/wet/undiscovered clicks,
backpack pressure, fill/no double reward, and home-return cooldown before
calling the full valley milestone done.

## Source-audit finding and bounded B2 follow-up

C proved the fresh economy: three reachable trees yield 12 logs, enough for
the 8-log bridge and 4-log ladder, and Outfitters sells boots and a spade.
However, after the bridge the primary HUD and map guidance prioritize the
old far-bank dig work before the already-buildable north ladder. B2 is a
V25-only guidance repair, not a new world action. It must use saved built-site
facts and the actual current log count, and must not hide the existing dig
option or rewrite V23/V24 guidance.

B2 implementer owns `PublicV23Controller.tsx`, `view/WizardHud.tsx`, and
focused tests for those surfaces only, after B releases the controller.
When V25 Greenway has a built bridge but no built north ladder, the primary
field objective and map guidance should show the ladder route and 4-log
price, with a remaining-log count only if it comes from the actual backpack.
The old far-bank dig action remains available in Works and may be described
as an optional side activity. Other versions and later objectives stay the
same. Budget <=90 net lines. Focused tests, TypeScript, build, no browser,
server, commit, PR, push, or GitHub action. A read-only reviewer follows.
