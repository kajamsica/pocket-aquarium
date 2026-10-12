# Ticket Pack: Pause truly inert public-world idle frames

## Outcome

An untouched fresh V23 start currently records one empty authoritative frame
every 50 ms. It repeatedly shows unsaved-progress copy, requests a leave-page
warning, and writes a checked save every 64 idle frames. This makes the
opening feel choppy before the player acts. Repair that behavior without
pausing physics, trade, cooldowns, herb regrowth, or migrated state timers.
This is a first-session and performance repair toward the full Wizard Realms
game, not game completion or a save-format migration.

## Evidence and contract

- Reviewer BRP-02 traced the empty-frame path from
  `PublicV23Controller.tsx`'s 50 ms interval through
  `PublicV23ControllerRuntime.advanceFrame` to the pending-frame status.
- Empty frames are not globally disposable. They advance tick/RNG, resolve
  support and airborne motion, settle trade listings, unlock Mireglass herb
  cycles, and may advance inherited Highland stone and Windward Step timers.
- A grounded, input-free frame may be omitted only when the currently
  validated preview has no active time-dependent obligation. If the proof is
  uncertain, advance the frame. Do not change the authoritative transition,
  witness format, replay, save lock, CAS, or migration semantics.
- Explicitly guard queued/held input, airborne or not provably grounded pose,
  active trade listings, same-cycle harvested Mireglass herbs, future quarry
  `readyAtTick`, and future Windward Step `nextCastTick` or
  `activeUntilTick`. Future time-dependent systems must extend this predicate.
- Preserve all movement, jump, Works, action, market-sale, herb, and cooldown
  outcomes. Existing V23/V24 saves remain valid. The live player tab on port
  5193 stays available; do not edit its watched source or open another
  renderer during the isolated prototype.
- No GitHub action. If later requested, use gh-bioscopics, Bioscopics
  noreply, and `ben/` branches.

## Lane and integration

One bounded implementer lane, IC-01, in an isolated copy at
`/private/tmp/wizard-idle-STpxH2/games/wizard-realms/engine`. The copy was
made from the current dirty live engine before this ticket, with its
`node_modules` symlinked to the live install. It is not a branch or PR.
No browser or server in the copy. The primary agent owns review, independent
tests, and later controlled integration into the live source after the user
testing window. A parallel renderer lane is forbidden by the one-renderer
constraint. A separate reviewer may inspect the final isolated diff if it
changes frame semantics beyond the contract.

### IC-01 implementer instructions

Role: implementer only under `auto-planner-ticket-pack` and
`smallest-viable-diff`. Change only the isolated copy of
`src/PublicV23Controller.tsx`, `src/PublicV23ControllerRuntime.ts`, and their
focused existing tests. Add a narrow, fail-open `idleFrameNeeded` query on
the runtime or an equivalent small seam. The interval must avoid generating
an empty frame when no active input exists and the query proves the world is
inert. It must still run an empty frame for active timed state or unsupported
pose. Avoid expensive full `preview()`/`view()` clones in the idle predicate.

Tests must reproduce fresh untouched tick with no pending frame, checked
save plus another idle interval with no false newer-progress warning, and no
beforeunload request for the untouched opening. Prove that real movement,
airborne landing, active trade listing, Mireglass herb cycle, and inherited
Highland quarry/Windward timers continue to record frames and preserve the
normal unload/save guard. Use a real runtime test for timer classification,
not only a controller mock whose `advanceFrame` does not change pending.
Run focused Vitest and TypeScript in the isolated copy. Return the exact
diff, file/line test evidence, limitations, and a code patch or changed-file
receipt for root to apply later. Do not edit the live checkout, launch a
browser, stage, commit, or push. Stop if the repair requires a schema change,
more than five files, or more than 300 net lines.

## Acceptance

The isolated test result is only a prototype. Root must inspect the diff,
confirm no old-save drift, apply the minimal accepted change to live source,
run focused suites and production build, then use the sole browser tab for an
identical fresh-start and leave/reopen journey when the player is done with
it. No claim of smoothness until the browser frame/save trace improves.
