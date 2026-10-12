# V18 input scheduler replan

## Why this pack exists

The frozen v18 Greenway playtest (T149) kept showing checkpoint and input backpressure. A 128-entry deferred queue filled while the player tried to aim and build a creek bridge. Two bounded controller fixes passed their focused tests but failed independent review: an early click could prevent pending frames reaching the pause threshold, and a later pause/resume could move an old click behind a newly sampled movement frame. No revised build has passed real-browser traversal. The route key, objective, and barefoot pacing text were visible; crossing, climbing, digging, and booted running remain unproved.

## Terminal condition

On one fresh v17 Greenway world, the player can gather logs, enter Works, aim a valid bridge lane, confirm, cross, place and climb a separate rung ladder, then use a spade to dig and trade stone without the controller refusing ordinary inputs or replaying time spent in a checked save. Save/reload preserves structures and progress. This pack fixes input ordering and bounded backpressure, not the whole game or general-world construction.

## Ownership and non-goals

- One implementation owner may edit `engine/src/PublicV17Controller.tsx`, its focused test, and one new controller-local pure scheduler module with its focused test. No domain, checked writer, IDB, save format, migration, frame witness, v16 controller, or renderer changes in this pack.
- Prerequisite discovered by the red airborne test: a separate domain/view owner must make live v17 airborne preview projection valid without relaxing grounded durable-save validation. `decodePublicV17Progress` currently requires a grounded pose and `publicWorldV17ViewProjection` calls it every render, so a valid jump throws before scheduler behavior can be tested. This prerequisite is a distinct unit and must be reviewed before the scheduler lane resumes.
- Prerequisite result: the view-only decoder now accepts bounded support-backed airborne poses while the durable decoder still rejects them. A real-session jump test was red then green; focused 7/7 and independent review GO. Scheduler work may resume against this validated prerequisite.
- A separate read-only reviewer inspects the implementation and its red-to-green tests. The coordinator owns the integration build, one-renderer Grok retry, and final validation. If the observed failure requires changing the checked writer or persistence architecture, stop and replan at that boundary.
- Preserve all accepted input ordering and authoritative 50 ms steps. Do not silently discard accepted movement, clicks, jumps, gait toggles, or build confirmations. A refused input must be explicit and correctly classified.

## Fixed-step scheduler contract

1. Assign each accepted fixed simulation step a monotonic logical `stepId`. Attach every accepted discrete intent or pulse to a specific boundary plus its arrival order. Define and test the tie rule. Existing queued tokens retain these identities across any save pause. Never reconstruct their relative order from wall-clock timestamps or insert a new sampled frame ahead of an older token.
2. Separate capacity for simulation steps and discrete commands. One or many queued clicks cannot consume the reserved boundary step. Coalesce only genuinely superseding aim updates; do not coalesce distinct actions, toggles, jumps, or confirmations. At quota, refuse the new input visibly without altering previously accepted tokens.
3. A checked write may let already accepted airborne neutral landing frames finish within the existing 128-frame authority cap. A new checked equip, build, store, or similar action requested while airborne is explicitly rejected with `Land before interacting` before scheduler acceptance, not queued for a silently changed boundary. UI-only aim and kind controls must not block landing. At the grounded reserve, or a saturated command queue, freeze logical world time. During pause, retain latest held direction for the eventual next step but do not create a frame for each elapsed 50 ms. Rebase the wall clock after the verified write. An elapsed 15-second save must not create 300 catch-up steps.
4. Drain old accepted tokens strictly in logical order before admitting newly sampled post-resume steps. Checked actions and owner-boundary transitions remain barriers. A blocked writer stops play with recoverable state intact; deferred-airborne handling does not masquerade as a successful save.
5. Report checkpoint waiting, refused clicks, and genuinely truncated movement history as distinct facts. Clear transient warnings on recovery; do not claim clicks were refused merely because an idle frame could not be sampled.
6. Admission and pause policy must distinguish a ready step from an unfilled virtual boundary. Drain the runnable FIFO prefix first. While airborne below the 128-frame cap, a due step may fill the oldest virtual boundary; from pending 96 onward it must be neutral and any displaced pulse explicitly reported. UI-only tokens then run in order. A grounded player at pending 96 waits for the checked save. At a blocked gate no token executes. Do not advance the wall-clock cursor or consume timed movement before admission succeeds. If airborne reaches frame 128 without landing, surface an explicit invariant failure rather than spin indefinitely.

## Required red-to-green cases

- A click at pending frame 65 while W is held, then a 15-second held writer, does not fill the queue or replay elapsed wall time.
- `frame@100 → click@100 → frame@150` keeps that exact order after pause. A gait toggle affects only steps after its own boundary.
- A click-heavy queue at pending 65 cannot block the required boundary frame; a later over-cap click is explicitly refused, and no catch-up avalanche occurs after writer release.
- An airborne checked click is visibly rejected before acceptance, causes no write, and does not let a non-neutral movement frame leapfrog landing; the player still lands. UI-only controls do not block those neutral frames.
- A valid v17 jump can be projected every frame; malformed unsupported airborne poses are still rejected, and an airborne state is never accepted as a durable save checkpoint.
- A pulse/jump, a boundary crossing, and a checked build action remain ordered against frames, including after save and reload.
- During a held checkpoint, `jump → queued Works mode → later Works kind` cannot let the later UI-only click overtake the older one; UI-only head intents run in order without a checked writer and do not block neutral landing. A checked action that reaches the head airborne is visibly rejected and removed before landing frames continue.
- A pulse accepted before a preceding jump executes cannot turn a required neutral landing frame into a non-neutral move or jump that stalls the airborne reserve.
- At pending 94 during a held checkpoint, execute a jump to pending 95 and then accept a UI-only Works choice. Its virtual boundary must not trigger a grounded-style pause before a safe neutral landing frame can drain. Check the same behavior at 64, 95, 96, and the 128-frame cap, with and without queued UI-only tokens.
- Save failure blocks without consuming accepted tokens or claiming a successful action. Deferred-airborne returns to a safe runnable state.
- Refused-click and movement-history-loss notices can coexist and clear appropriately after recovery.
- A slow write release drains the bounded backlog promptly, without changing the save schema or prior save validation.
- Exercise the pure pause/admission policy as a finite matrix over gate (open, checkpointing, barrier, blocked, cap-paused), pose (grounded/airborne), pending frames (64, 94, 95, 96, 128), queue head (none, ready step, virtual step, UI-only, checked action), and arrival (none, UI click, pulse). Prune impossible combinations explicitly. Assert FIFO IDs, no unchecked action while airborne, no frame above 128, no clock consumption on refusal, and no accepted token loss. Add bounded liveness traces for every valid airborne checkpoint state.

## Dispatch and proof

Implementer: existing native `/root/v18_backpressure_repair`, recent exact controller context, planner-selected current model retained. Required capabilities: local repository edits, deterministic React/controller tests, TypeScript, safe save-contract reasoning. Reviewer: existing native `/root/v18_integrated_review`, read-only and independent; recent proof found both NO-GO cases. No model substitution or new provider is needed. Both lanes must return actual dispatch and result receipts. The implementation lane must show a failing pre-fix test, then focused pass, TypeScript and diff check. The reviewer must return GO/NO-GO with line evidence. Only after GO: production build, full suite with at most two test workers, frozen bundle hash, and same-entrypoint Grok test on its own one-renderer machine. A UI failure is logged as `observed error | change | restart | retry result` and routed to the smallest observed owner.

## Remaining independent feature work

The v18 HUD now has a direct `Aim at my lane` button and truthful `Use avatar facing` reset. The existing Greenway ladder is adjustable along the north cliff, not arbitrary placement at every obstacle. A later bounded region extension may reuse the existing Works ledger; do not combine that scope with this scheduler repair.
