# V128: phase-separate checked-save allocation

## Ask and implementation understanding

The durable ask is a complete, playable Wizard Realms RPG. V127 observed that a guarded V34 W500 checked save increased exact renderer RSS from 451,120 to at least 706,320 KiB and naturally returned near baseline, while GPU process RSS changed by only 4,960 KiB. The specific allocation owner is not proven. This pack isolates the phase and makes only a bounded, independently safe allocation cut after measurement.

**Goal:** identify the top renderer-JS allocation call sites during held movement and keyup save, remove one redundant V34 `readChecked()` full-root clone if its isolation contract is proven, and retest the same entrypoint without claiming a whole-route performance win from unmatched browser baselines. **Non-goals:** graphics reduction, safety-cap increase, store authority reduction, save-format change, production activation, PR, full 400 m playthrough. **Authority:** local game code and disposable development profiles only. User Chrome, the authentic U5/ring profiles, other agents' browsers, and GitHub remain out of scope.

Constraints: one owned renderer at a time; exact-PID early stop at 870,400 KiB, absolute stop below 1,024,000 KiB; close the browser and watchdog after each bounded run. Do not export private state. Keep original 5194 preview available. Branch stays `ben/wizard-playable-v2`; no work-associated Git identity.

## Ticket pack

**Design lock:** `readChecked()` returns a detached checked root plus opaque one-use proof. The proof's private baseline must remain unaliased from caller mutations. `commit()` independently decodes/replays the successor, detaches its candidate before async work, and semantically compares the exact raw native record in one IndexedDB readwrite transaction. V34 saves remain strictly validated.

**Public interfaces:** none. No schema, route, external prop, browser option, or persistent record change.

**Topology:** serial A→B→C. A must profile the unmodified code before B can change hot-reload source, otherwise the allocation baseline is contaminated. B's small source+test change is independent of the profiler's suspected dominant owner and may proceed only if A safely closes its browser. C integrates/reviews/tests the change and repeats a matched guarded W500 save. If A finds that this cut is irrelevant to the dominant spike, C reports it as allocation hygiene and a separate measured next owner; it does not mislabel the cut a fix for the entire spike.

### V128-A, UI allocation profiler, reviewer only

Read `auto-planner-ticket-pack`, `test-from-ui` and its required generic UI reference, this pack and V127. Reuse the completed V127 UI agent if safe. No code, test, doc or Git edits; no nested workers. With one fresh disposable U5-derived profile at `127.0.0.1:5194`, arm the exact owned Chrome renderer watchdog before state load and visibly enter V34. Use CDP `HeapProfiler.startSampling`/`stopSampling` or an equivalent allocation stack profiler with a bounded sampling interval. Segment held W500 movement from keyup/checked-save, so the returned call trees can identify top source locations and approximate sampled bytes separately. Record renderer/GPU RSS and CDP heap at each phase. Stop after the first visible checked save, or when guard approaches. Do not force GC until the unperturbed comparison is complete. Source-map stack traces when available; distinguish allocation samples from retained heap or process RSS. Close owned browser/watchdog and leave previews live. Return visible result, top functions/files/bytes for each phase, sampler overhead, exact peak/baseline, console/network, and evidence path. No A500/W900.

### V128-B, private clone cut, implementer only

After A closes the browser, change only `engine/src/domain/atomicV34Database.ts` and its focused existing test file. In `readChecked`, retain the decoded private root directly in the WeakMap proof instead of cloning it a second time; continue returning a detached `structuredClone(root)` to the caller. Do not remove `Prior.raw`, proof deletion, independent successor decode/replay, candidate detach, semantic CAS, or transaction ordering. Add a focused test: mutate the returned root after read and verify the same proof's private checked baseline remains independent, then test valid unchanged successor and mutated/forged successor rejection. Keep existing stale interleaving, proof reuse and corrupt-root tests. Run focused tests and TypeScript. No browser, profile, broad refactor, commit, PR, or GitHub action. If the decoder shares nested references with `value.result` such that direct retention could mutate the native raw comparison or caller alias, stop and report instead of editing.

### V128-C, integration and final proof

Main planner checks A and B receipts. Independent review verifies the exact one-clone cut does not weaken the store proof or native CAS. Run focused tests, TypeScript and build, then one identical guarded W500 visible save in a fresh isolated browser profile. Compare within-run baseline/delta and allocation sites, not raw peaks across unequal starting baselines. If the transient spike remains, derive a new bounded owner from A's allocation profile. Keep the user-accessible development preview live. No PR until explicitly asked.

## Smallest viable diff and tripwires

Expected source delta: one redundant clone removed from `atomicV34Database.ts` plus a focused isolation test, no new production files or dependencies. The V128 document is the only planning artifact. Any need to change V28/V14 validation, WebGL settings, IndexedDB schema, save cadence, or guard thresholds triggers a separate pack and review. A source-only hypothesis is not a measured performance conclusion.

## Completion evidence

V128 is complete when the profiler receipt segments movement/save allocations, B's private-baseline contract is test-proven, the independent review/automated suite passes, and one guarded visible save completes with the owned browser closed. This is a performance-hardening milestone, not the full-game terminal condition.

## V128-A measured receipt

The unmodified source was profiled in one guarded disposable V34 browser. Exact page renderer PID 10875 settled to 382,752 KiB before W500, reached about 579,952 KiB during input/save, and returned to roughly 394,688 KiB at idle. The separate GPU process changed only about 704 KiB. Session-wide renderer peak 615,728 KiB occurred earlier during Copy startup; the guard did not trip. CDP JS heap used/total was 51.68/59.42 MB before movement, 62.45/157.20 MB after the held phase, 53.55/128.89 MB at the visible save, and 57.39/65.98 MB after idle. The UI displayed `V34 progress saved on this device.` 508 ms after keyup.

The 575 ms held profile sampled 6.66 MB, led by V28 `view` (1.61 MB), scene JSX (1.13 MB), V28 `preview` (0.39 MB) and V14 view projection (0.39 MB). The keyup/save profile sampled 5.16 MB, led by scene JSX (1.47 MB), V28 `view` (0.79 MB), V28 `preview` (0.26 MB), V34 `checked` (0.26 MB), and V32/V33 checked replies (about 0.20/0.16 MB). The profiler omitted collected objects, so these are survivor-biased samples, not total transient allocation or RSS attribution. They do not rule out V34's extra private clone. The browser/watchdog closed; original U5 remained unchanged. Evidence: `/private/tmp/wizard-v128-a-evidence.LARllu/saved.png` and adjacent console log. The disposable profile remained mode 700 because safe deletion was denied; it contains no authentic source mutation.

## V128-B/C integrated receipt and decision

V128-B changed only `engine/src/domain/atomicV34Database.ts` and `engine/src/domain/publicWorldV34Snapshot.test.ts`. The proof now retains the validated decoder-created private root directly, while `readChecked()` still returns a `structuredClone(root)` to callers. A pre-change probe found no shared object or ArrayBuffer references between raw and decoded roots for genesis and two successor shapes. The new caller-mutation test protects the proof baseline; focused Vitest passed 7/7, TypeScript passed, and independent read-only source review returned GO. `Prior.raw`, one-use proof consumption, independent successor replay, detached candidate, semantic native CAS and transaction ordering remain unchanged. Production build passed.

V128-C repeated a fresh U5→V34 visible W500 save under the same safety guard. The UI showed `V34 progress saved on this device.` 516 ms after keyup. Exact page renderer PID 16275 settled at about 275,312 KiB before W, sampled at about 525,168 KiB during input/save, and the session-wide 624,368 KiB peak occurred earlier during Copy startup. GPU process RSS did not grow correspondingly. The browser/watchdog closed, authentic U5 stayed unchanged, and both preview ports returned HTTP 200. Evidence: `/private/tmp/wizard-v128-c-evidence.IkQPKw/saved.png` and adjacent console log.

This time CDP sampling included objects collected by major and minor GC. Held W sampled 411.7 MB; keyup/save sampled 493.5 MB. The save phase's largest mapped repo sites were V14 `validatePublicV14State` at 114.4 MB (23.2%) and V13 `copy` at 42.6 MB (8.6%), followed by V17 and V23 decoders. That identifies repeated validation/copy as a substantially larger transient JS allocation path than the one-clone store hygiene cut. The V128-A and V128-C profiler modes and renderer baselines differ, so their raw RSS peaks cannot establish a causal improvement from V128-B. The one-line cut is accepted for isolation-safe allocation hygiene, not claimed as the full 1 GB renderer fix.

**Next bounded owner:** trace exactly why V14 validation and V13 copying run repeatedly during V28 held frames and V34 checked saves, then introduce a proof-preserving internal reuse/fast path only where the same checked value can be demonstrated. Do not skip independent stored-root replay, successor validation or transactional CAS. A code change to those lower layers requires a separate pack and tests before another guarded UI run. V34 remains dev-only, and the durable full-game goal remains active.
