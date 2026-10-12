# V24 Mireglass integration pack

## Outcome and evidence

The public `?publicWorld=v23` route streams the walkable west world and persists
travel, but its checked actions and UI remain Greenway-only. The authored
Mireglass marker, resources, outpost, herbs, seal, and ring already exist in
older game-specific systems. Players must be able to walk continuously from
Greenway into Mireglass, interact with those sites through checked actions,
save, reload, and return without losing their earlier V23 work. This is the
next complete-game milestone, not the complete-game terminal condition.

Source facts: `PublicV23WorldView` projects streamed movement through
`publicWorldV14ViewProjection`, which offers no Mireglass interactions;
`PublicV23Controller` maps actions through `publicV17ActionForView`;
`publicWorldV23Transitions` delegates legacy actions to Greenway. The V23
state already carries `state.mireglass` and the discovery mask, so do not
introduce a duplicate region ledger. The prior Greenway public UI journey
saved and reopened bridges, a ladder, excavation, coins, and bought boots.
Mireglass public UI acceptance remains unproved.

## Contract and safety locks

- Classifications: existing-game feature integration, not a whole-system
  translation; no shipped model-agent runtime change.
- Preserve V23 and all ancestor schemas, roots, and save files unchanged.
  Use a V24 successor with a validated pinned V23 source receipt, its own
  atomic root, one shared world lock, CAS commits, deterministic witness replay,
  and fail-closed detection of partial or changed source state.
- `PublicV24Progress` initially has exactly V23's validated progress fields:
  `state`, `greenwayWorks`, `regionalWorks`. Mireglass lives only in
  `state.mireglass`. Witnesses add bounded typed Mireglass actions and herb
  forage to inherited V23 frame/work/action/checkpoint witnesses.
- No player-supplied pose, XP, inventory, coins, tile mask, or region result.
  Decode action inputs exactly, derive results from existing Mireglass reducers,
  validate the resulting V23-compatible progress, and replay against the
  committed previous head. Do not accept old `traverse_route` teleport as a
  public movement witness; walking and existing Works provide traversal.
- Keep the currently running port 5193 available. Use one game renderer/tab
  total, not one per worker. Source and Vitest work can run concurrently.
  Do not touch unrelated user browsers or apps.
- No GitHub writes in this pack. If later requested, use `gh-bioscopics`, the
  Bioscopics noreply identity, and `ben/` branches only.

## Ownership and sequence

After this contract is fixed, dispatch three independent first-wave lanes:

1. **Persistence and replay lane:** Own new `publicWorldV24Snapshot*`,
   `publicWorldV24Flow*`, and `atomicV24Database*` files only, plus a narrowly
   exported under-lock V23 inspector if necessary. Implement V23 receipt
   pinning, fresh/migration/resume/commit, exact shape validation, previous-head
   replay, source-drift detection, crash-safe atomic storage, and tests. Its
   action hook may import the second lane's exported pure adapter after both
   land. Do not edit V23 validator or old roots.
2. **Checked Mireglass action lane:** Own only new
   `publicWorldV24MireglassAction*` files. Export a pure typed function taking
   validated `PublicV23Progress` and one bounded Mireglass action or herb
   forage intent, returning validated progress/events or rejection. Reuse
   `applyMireglassExpeditionAction`, `applyMireglassHerbForage`, mask helpers,
   and existing terrain validation. Prove marker, timber, herb, Glow/reveal,
   outpost trade, seal, ring, invalid inputs, distance, inventory, and replay
   determinism. Exclude `traverse_route` teleport.
3. **Public projection lane:** Own only new
   `PublicV24MireglassView*` files. Project nearby, discovered Mireglass
   affordances into `WizardViewProjection` from V23's active tiles, player,
   and saved region facts. Expose stable typed action IDs for a later
   controller handoff. No purchase/sale/equip through generic E. Do not alter
   current V23 view or renderer.

The dependent integration lane begins after the three receipts: own a thin
V24 entry/controller binding and query routing, preserving the V23 controller's
movement scheduler, save guard, and Works. Avoid copying its 400-plus lines.
Add a small adapter or injected checked-action/view seam with explicit V23
regression tests. If sharing that seam is not bounded, stop and replan rather
than duplicating the controller or changing V23 save semantics.

The read-only controller seam audit identified a bounded path: make the V23
runtime closure generic over its checked start, writer, and optional extra
action reducer, while leaving `createPublicV23ControllerRuntime` as the
unchanged V23 wrapper. A discriminated V24 adapter on the single controller
supplies that runtime, a view overlay, a streamed action mapper, and save
label. Keep its frame scheduler, pending-action barrier, exit guard, Works,
and `WizardSurface` shared. The V24 view must remove streamed `starterCliff`
and `unavailableActions` gates so Mireglass prompts can appear, without
changing those gates for plain V23. Implement and regress the runtime seam
before the controller/entry route handoff.

## Acceptance and smallest viable diff

First-wave proof: focused reducer, snapshot, migration, tamper, replay, and
projection tests plus TypeScript build. A worker should target 1 to 3 owned
files and a focused test. If an individual change exceeds 5 files or 300 net
lines, report the boundary and propose a smaller unit before expanding it.
No unrelated art, terrain, campaign, or economy refactor.

Once integrated, expose the V24 route at the earliest honest safety gate.
Then use one browser renderer for the same player journey: resume V23 save,
walk west to the marker, study it, harvest or trade, save/reopen with the same
region state and prior Greenway Works, and return east without teleporting.
Capture UI, console/network, and source-root evidence. Run broader automated
validation after that first accessible surface without blocking access.
Measure V24 saved bytes and commit/validation latency on the actual build,
since lineage size and memory are explicit product constraints.

## First live UI result and performance follow-up

The single in-app browser smoke on the V24 route displayed explicit V23
migration, copied the saved Greenway Works and 78 coins with leather boots,
and showed a V24 checkpoint confirmation. No Mireglass action was reached.
During idle/map use, V24 repeatedly entered checked saving and accumulated
queued input. One UI click returned a browser-control dispatch timeout, then
the page visibly confirmed that the save had completed. Available system
memory fell from about 48% to 38% while this sole game tab was open and
rebounded to about 47% when it closed. No other browser was opened or closed.

Before the longer westward journey, diagnose the exact idle-frame checkpoint
cadence and representative V23/V24 root bytes plus commit/resume latency.
Do not infer a RAM leak from one sample or treat the browser-control timeout
as a proven game failure. Fix the smallest observed game owner only if the
measurement identifies a bounded cause, then reopen one tab and repeat the
same migrate/save/idle/movement journey. Keep simulation ticks, trade timing,
save safety, and V23 compatibility explicit in any timing change.

The opt-in `inputTrace=1` run on a single hidden V24 tab measured 115 idle
`controller.frame` samples at 57.3 ms median (59.7 ms p95) and 122
`controller.render` projection samples at 43.9 ms median (46.2 ms p95).
One `controller.save.start` to `controller.save.result` span was 2,959 ms;
the result was `saved`, and the tab logged no console errors. The 50 ms
controller interval is therefore oversubscribed in this browser run even
before three-dimensional paint. This is stronger evidence of main-thread
pressure than the earlier isolated browser-control timeout. The tab was
closed after the trace. A separate Node/fake-IndexedDB probe found portable
JSON root bytes of 792,392 V23 versus 1,188,656 V24 for a fresh V23 source
(1.50x), and 1,188,591 versus 1,584,855 for a V17-migrated source (1.33x).
Its V24 commit medians were 123 and 225 ms respectively, not browser timings.
Next repair must target the measured frame/projection owner, then repeat the
same one-tab trace and movement actions without weakening checked writes.

## Bounded repair and identical-entrypoint retry

Observed error: the hidden V24 browser tab exceeded its 50 ms simulation
interval (57.3 ms median frame, 43.9 ms median projection, one 2,959 ms
checked save). Changes: add an 18-entry immutable base-terrain chunk cache,
a four-seed canonical bridge-site cache, and truthful checked-action gating
for shared Mireglass controls. Restart: Vite hot reload applied the source
changes; no additional renderer remained open. Retry: the same saved V24
world at the same `?publicWorld=v24&inputTrace=1` entrypoint produced 128
frame samples at 62.5 ms median (69.7 ms p95), 138 projection samples at
50.8 ms median (54.9 ms p95), and one successful 3,471 ms checked save,
with no console errors. Result: same performance error, not a browser win.

To separate development-mode overhead, the dev server was temporarily
stopped and the already-built production bundle served on the same origin.
The same saved-world entrypoint produced 93 frame samples at 58.5 ms median
(61.8 ms p95), 51 projection samples at 46.0 ms median (49.6 ms p95), and
one successful 3,194 ms save, with no console errors. Result: production is
slightly faster, but still oversubscribed. Both browser tabs and the temporary
production server were closed; the original dev server was restored on the
same port and returned HTTP 200. The source-level caches remain useful and
bounded, but browser acceptance for movement and save responsiveness is still
open. After two grounded repairs did not clear the error, broaden diagnosis
to checked-write validation and browser-specific main-thread costs before
changing tick cadence or save guarantees.

A third short one-tab retry used the same V24 save through the visible Save
button. Its trace showed a successful 18-pending-frame save in 2,058 ms;
the subsequent automatic 64-frame saves took 2,565 and 2,830 ms. The
browser-control click itself timed out once, but the UI and trace showed the
automatic saves succeeded, so no extra click was assumed or repeated. No
console errors were present and the tab was closed. This supports a
substantial fixed checked-write cost with an additional frame-count cost,
but it does not yet separate local replay, chained source validation, and
IndexedDB transaction completion. The next diagnostic is opt-in numeric
save-phase timing with no state or witness payload in the trace.

That opt-in runtime trace measured a successful 18-frame save at about
2,073 ms total: 0.1 ms witness decode, 210.2 ms local frame replay,
1,860.2 ms awaited checked writer, and 1.8 ms reply comparison/clone.
There were no console errors and the sole hidden tab was closed. This
identifies the writer path as the largest measured save stage, not the
local frame replay. The next bounded probe will split that writer across
lock wait, V24 read, V23/V17 source inspection, witness application,
candidate preflight, and IndexedDB transaction completion, recording
numeric durations only when `inputTrace=1` is enabled.

The writer probe then completed another 18-frame UI save with no console
errors. Runtime phases were 202.1 ms local replay and 1,825.9 ms writer
await. Within the writer: lock wait 112.8 ms, V24 checked read 611.8 ms,
live V23/V17 source inspection 550.7 ms, witness application 200.9 ms,
atomic candidate preflight 312.0 ms, IndexedDB open 2.2 ms, CAS read/put
3.2 ms, and transaction completion 6.4 ms. These are one-run browser
samples, not a stable benchmark. They show repeated validation and replay
dominate this save, not IndexedDB durability. The tab was closed and the
diagnostic code passed independent review. Any next optimization must keep
the live source-drift check, existing semantic root CAS, full replay proof, and
strict transaction semantics, with a bounded memory cost.

## V24 validated-root read-cache pilot

After independent persistence review, one V24-only cache pilot is allowed.
Every checked read must still fetch the live IndexedDB root and exact key
set. Reuse a private previously validated root only after a fail-closed,
type-whitelisted comparison of that raw record against a detached private
snapshot, including own keys, descriptors, prototypes, and typed-array
bytes. Unsupported shapes, cycles, or a raw payload estimate above 1 MiB
take the existing full-decoder path. Keep only one V24 cache entry per JS
realm, keyed by exact IndexedDB factory and database name, and return
fresh detached roots and proof snapshots. A fully validated cold read may
seed the entry after its read transaction completes. A successful strict
write may seed it from the already validated candidate, never after an
aborted or conflicted write. For a root whose raw estimate is at most 1 MiB,
the two private copies have a nominal steady-state payload around 2 MiB,
plus JavaScript object overhead. This is not a hard heap ceiling: the
decoded copy is not independently sized, and old/new entries may coexist
briefly during replacement. Keep live V23/V17 source inspection,
source-receipt comparison, incoming witness replay, candidate preflight,
and in-transaction CAS unchanged. The existing CAS is semantic rather than
descriptor-exact; do not claim this pilot strengthens that separate rule.

Prove hot-hit mutation isolation, same-revision raw corruption, extra-key
rejection, typed-array corruption, stale cross-instance CAS, warm-cache V17
source drift, failed-write non-seeding, over-limit bypass, and cold-versus-
cached replay parity. Accept the pilot only after the same one-tab browser
trace shows a real V24 checked-read hit and lower duration without a memory
spike or loss of save correctness. Do not add a V23 cache until the V23 and
V17 source costs are separately measured.

Independent review found that equal visible bytes in a `Uint8Array` view
with nonzero offset or oversized backing could incorrectly hit the first
cache version even though the cold decoder rejects that mask. The pilot
was held at NO-GO and repaired to check view offset, backing size and
kind, and resizability, with warm-cache direct-IndexedDB overwrite tests.
A 512 KiB gate was tested but prevented hits on valid checkpoint and
V17-migrated roots (734,282 and 734,328 estimated bytes), so the fixed
1 MiB per-root gate remains.

The one-tab browser acceptance passed for the pilot. On the same V24
Greenway save/resume journey, the trace recorded `v24-validated-cache-hit`
and a 15.6 ms checked V24 read for a 17-frame save, compared with 611.8 ms
before the pilot on an 18-frame save. The save completed with `saved` status
and no browser console errors. The writer still took 1190.1 ms because
V23/V17 source inspection (534.5 ms), witness application (186.2 ms), and
candidate preflight (308.4 ms) remain expensive. This is an accepted
incremental read optimization, not a claim that browser save or frame
performance is solved. The one hidden renderer tab was closed after the
test; system-wide free memory was 52% immediately before and after.
