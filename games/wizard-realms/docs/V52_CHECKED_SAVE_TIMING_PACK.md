# V52 checked-save timing and causal repair

## Observed failure

In the opt-in V30 UI, a five-second ordinary dry-ground W run triggered an autosave after 64 pending frames. `controller.save.start` to saved result took 4,943.3 ms. The trace also showed two multi-second render gaps, although W had already been released when the write began. No movement rejection or non-static network request occurred. This is a measured responsiveness fault, not evidence of a terrain collision.

## Outcome and locks

Identify the actual expensive checked-write phase, then repair that owner without weakening replay, source ancestry, compare-and-swap, strict cache admission, or save/resume compatibility. Keep V29 untouched and V30 opt-in. Preserve the ordered-input rule. Do not raise queue or cache limits blindly, advance authority during a write, or create another renderer while one is active.

## Unit A: numeric-only diagnostic

Add an optional callback to V30 commit that reports finite nonnegative durations for exclusive-lock wait, V30 checked read, V29 live-source inspection, lineage and witness replay, and V30 commit. Catch exceptions from the callback. Wire it only into the existing localhost `inputTrace=1` recorder in `PublicV23Controller.tsx`. No save data, schema, authority, or default UI behavior changes.

Add tests showing valid commit, stale CAS, invalid witness, changed source, and source bytes behave identically with no callback and with a throwing callback. Check bounded phase labels and finite timings without brittle duration thresholds. Change only the necessary V30 flow, controller, and focused tests.

## Unit B: same-entrypoint measurement and repair

In one isolated browser renderer, repeat `?publicWorld=v30&inputTrace=1` on ordinary dry ground through one autosave. Record phase durations, total save span, render/frame gaps, console and network state, and browser closure. Only then choose the smallest owner to optimize. If V30 checked read dominates, measure strict-cache hits and decode; if commit dominates, separate preflight, IDB open, CAS, and transaction completion. Preserve forged-root and corrupted-source rejection and exactly-once reward behavior.

The repeat measured 5,579.3 ms total: 82.1 lock wait, 41.4 V30 read, 210.0 V29 ancestry, 887.5 writer replay, and 939.2 commit. About 3,397 ms occurred before lock acquisition. Source inspection shows the inherited V28 flush replays the same 64-frame witness twice before the V29 and V30 wrappers each replay it again. The next bounded repair is one replay elimination in V28 flush, not removing the wrappers or changing checked storage.

## Unit C: remove one redundant V28 flush replay

For a decoded frame-batch witness, use `replayPublicV28FramesWithEvents` once to obtain both expected progress and events. Preserve `publicV28BridgeSitesValid` checks before and after that replay, compare expected progress to the in-memory preview exactly, and pass the same expected progress/events to the checked writer. Preserve non-frame witness behavior, rejection semantics where feasible, and the checked reply. Tests must cover successful 64-frame save, mismatch/failure, bridge-site invalidity, stale CAS, and reload equality through inherited V29/V30 as applicable. Then repeat the identical V30 UI autosave trace and report whether it advanced, stayed the same, or regressed. Do not claim this single removal resolves the whole 5.58 seconds before measurement.

The live retry was 4,215.5 ms, an improvement of 1,363.8 ms but still a visible hitch. Pre-writer time fell to about 2,288.7 ms. The V29 and V30 in-memory adapters each replay the already checked V28 frame batch before the locked V30 writer replays it again.

## Unit D: frame-only detached expected-progress handoff

The V28 flush may pass a detached clone of its checked frame-batch expected progress as an optional private writer callback argument. Keep V28's own expected reference private for post-write checked-reply comparison. V29 may accept this proof only for a frame-batch witness at the matching revision; derive the V29 sidecar using the exact existing active-pick rule, then retain its checked-reply comparison. For actions, return-home, missing proof, and novel V29 witnesses, retain full replay. V29 may forward a detached expected V29 progress to V30 on that frame-only path. V30 must enforce the existing canonical claimed-bridgehead guard, carry its claim ID unchanged, and retain its checked-reply comparison. The locked V30 writer, independent replay, atomic checked-successor validation, CAS, and exact source checks remain unchanged.

Tests must compare each fast-path result with normal `replayPublicV29Witness` and `replayPublicV30Witness` for a 64-frame batch, equipped and unequipped mining pick, claimed and unclaimed canonical bridgehead, missing/invalid proof fallback, callback mutation attempt, action/return-home non-use, writer mismatch, and stale revision. No public app contract or save format changes. If these contracts cannot be proven narrowly, stop. Then repeat the same one-renderer V30 UI autosave to measure latency; the 4,215.5 ms baseline is not a passing feel target.

Unit D code, tests, TypeScript, build, and independent authority review passed. The identical one-renderer fresh ladder, dry upper-shelf W-five-second UI retry measured 2,706.3 ms from save start to saved result, down 1,509.2 ms (about 36%) from Unit C. Pre-writer time fell from 2,288.7 to 763.7 ms. The remaining phases were lock wait 72.3 ms, V30 checked read 52.7 ms, V29 ancestry 189.4 ms, writer witness replay 771.0 ms, and V30 commit 836.2 ms. Render gaps during save were 885.0 and 1,909.2 ms; the bounded input queue still reached 16 and dropped 37 timed samples. No movement rejection occurred; key release preceded save start. The sole browser was closed after exporting [the trace](/var/folders/p2/6p9p9mhx1hv3s88f1rs0w9c40000gp/T/wizard-v52d.cORN94Muqw/.playwright-cli/wizard-v30-input-trace.json). This is an improvement, not a responsiveness pass. Next owner is remaining locked replay/commit CPU time and controller input continuity, not a larger queue or weaker validation.

## Delivery gate

Focused V30 flow/runtime regressions, TypeScript, production build, scoped diff check, independent review, and a same-entrypoint UI retry. Report `observed error | change | restart | retry result | next action`. A fast unit test is not a substitute for the live autosave latency observation.
