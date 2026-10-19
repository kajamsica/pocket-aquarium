# V122: bounded checked-frame proof and memory architecture

## Outcome and non-negotiable boundaries

Reduce the transient renderer memory cost of repeated V28-to-V33 movement-save validation enough that an authentic migrated V33 character can discover the Mireglass ring, save, close, reopen, and continue under a 1,000 MiB exact-renderer RSS watchdog. V33 remains guarded opt-in until that real UI journey and two-way ring travel pass. Keep V32 user preview on 5193 and V33 development preview on 5194 live. Use one automated browser renderer at a time. Preserve all V17-to-V33 save contents, checked replay, live ancestor pinning, mutation isolation, revision/CAS checks, and old-version gameplay. No GitHub action, branch, commit, deployment, or production rollout is authorized.

## Evidence that forces a replan

V121's no-Canvas checked save reproduced a large transient RSS rise with real native IndexedDB and no scene, ruling out the renderer scene as the sole cause. A pass-through clone-site trace found 2,359 clone calls before the first V33 read on a twelve-frame save, including 195 matched V23 and V17 full-progress validations. Outer V28-to-V33 wrapper clone sites were only 17 calls and 16.7 ms, so deleting their isolation copies blindly is not justified. V31's empty-soil path repeated V28 frame replay for events and through V30 for state. A bounded V30 frame-with-events proof removed this one duplication, passed focused tests and a real isolated save, and cut the matched V23/V17 calls to 141 each. But baseline-adjusted peak renderer RSS improved only 6.6%, from 371,664 to 347,296 KiB in instrumented probes. That is not a material RAM repair. The native IDB get/put phases are short; checked replay and clone work spans the pre-read, read/decode, and candidate phases. RSS sampling and GC prevent exact byte attribution to a single call.

## Architecture decision before implementation

Design a private per-save frame proof that can travel across the V29-to-V33 adapter chain without repeating each version's expensive canonical frame replay. The proof must be minted only after a checked replay from the relevant committed state, tied to the exact revision and witness, immutable or privately owned, and consumed only inside the same synchronous save handoff. A public caller-supplied object, object-identity cache, or bare hash is not trusted. Each version's unique invariants still need explicit proof, including V29 mining-tool normalization, V30 bridgehead claim, V31 soil/effective pose, V32 highland state, and V33 fairy-ring state. The authoritative V33 flow/store must independently check the witness, full lineage and live V32-to-V17 ancestry, and perform CAS. No security check may be removed merely for speed.

Before coding, compare that design with a direct V33 frame runtime that keeps V28 as the movement simulator and performs one checked V33 replay, while preserving old V32 entry and standalone runtime behavior. Select the smaller contract with explicit correctness evidence. If either requires a storage schema change, stop for a migration plan rather than altering persisted data in place. Reject a broad clone removal or cache that cannot prove caller isolation and forged-writer rejection.

## Planning-first lanes

### A: call graph and proof contract

Read-only. List each V29-to-V33 runtime save gate and unique invariant, all replay/clone calls on a twelve-frame W save, and where a private proof can be minted and consumed. Define a TypeScript interface or private closure capability, validity lifetime, mutation boundaries, and a fallback to ordinary replay for standalone and action/return-home paths. Give a precise changed-file budget and identify any >300-net-line architecture tripwire.

### B: independent security and compatibility review

Read-only and independent of A. Attack the candidate proof interface with stale revision, forged witness, caller mutation, aliased source slots, replay mismatch, time-of-check/time-of-use, wrong environment, failed writer, and V31 airborne/nonempty-soil cases. Specify red-to-green tests and whether old V32 remains behaviorally identical. No source edits.

### C: one selected implementation unit

Only after A/B agree on a safe interface. Implement one bounded runtime proof path and focused tests. Keep public APIs and old standalone runtime behavior intact unless a documented compatibility shim is proven. Do not modify the store, migrations, or scene. Require TypeScript, production build, whitespace checks, focused V29-to-V33 tests, forged reply/mutation/revision tests, multi-frame jump/landing, and batch-cap event parity. If the unit exceeds 300 net lines or touches more than four production files, stop and split an architecture stack before coding further.

### D: exact guarded replay and UI journey

Repeat the unchanged U5 no-Canvas twelve-W checked save under one exact-PID 1,024,000 KiB watchdog. Record clone counts, JS heap, baseline-adjusted and absolute peak RSS, and save/ancestor/CAS result against V121 B7/C1. A material RAM improvement means at least a 25% reduction in baseline-adjusted peak **and** no increase in idle RSS, with no validation loss. Then, in a separate sole renderer and authentic private V33 profile, move in bounded steps to Mireglass ring discovery, save, close and reopen, checking persisted location/discovery under the same guard. Two-way ring travel and post-arrival movement are separate required V33 acceptance gates. Close every owned renderer after each probe; keep preview ports live.

### R: independent source and UI go/no-go

Findings first. No user-facing V33 rollout from source tests or no-Canvas evidence alone. A GO requires save/reload, ring discovery, two-way travel, post-arrival play, V32 compatibility, and sustained memory headroom. Otherwise report guarded opt-in only and the next bounded action.

## Stop rules

If the same near-cap UI spike survives one measured proof-path repair, or if a safe private proof cannot fit the bounded interface, stop local clone tuning and explicitly partition legacy adapter and authoritative save architecture. Do not relax the watchdog, downgrade graphics, weaken validation, print private checkpoint contents, or run multiple browser renderers. Preserve all existing dirty worktree state.

## A/B design decision, 2026-10-11

The read-only call-graph and independent security lanes agree on a conditional four-runtime-file private frame-proof experiment. V28 mints a checked grounded batch after witness decode, V28 replay, bridge checks and equality to its live preview. V29 checks that private result against its preview and applies mining-tool normalization. V30 checks revision, preview and canonical bridgehead claim; it currently drops the private proof before its writer callback. V31, V32 and V33 each then repeat canonical frame replay. Carry a closure-backed, one-use capability only through private V30-to-V33 nested callbacks. Bind it to exact committed revision and decoded witness, consume synchronously before any `await`, and return only owned/cloned progress. Each wrapper checks its own live preview and sidecar rules before reminting. V31 may use it only for empty raised soil and grounded movement; nonempty soil, airborne preview, actions, Return Home, stale/invalid proof, and standalone V32 use existing replay. V32 must preserve Highland state and V33 fairy-ring state. All schema, lineage, writer-reply and authoritative V33 flow/store checks remain unchanged; the proof must never cross into persistence.

The production budget is four runtime files (V30, V31, V32, V33), at most 300 net lines. If a fifth production helper is essential, stop and amend the pack before writing it. Red-to-green tests must cover stale revision and altered/extra-key witness, proof and writer mutation, forged/failing async writer, empty/nonempty soil, deferred airborne, multi-frame landing, 128-frame cap/event parity, actions/Return Home fallback, and standalone V32 parity. The independent reviewer gives conditional GO for this design only, not for implementation or memory outcome. The unchanged V33 flow/store must still re-read and replay full ancestry and CAS. The 25% baseline-adjusted RSS improvement is an empirical acceptance gate, not a prediction.

## C source review and narrow repair gate

The four-runtime proof path is drafted; targeted proof, fallback, landing, cap, and forged-reply tests, TypeScript and build passed. The combined V29-to-V33 suite was stopped after about 180 seconds without output and is not passing evidence. Independent source review is **NO-GO pending a V31 parity repair**: the private proof branch checked empty soil and pose but omitted `decodePublicV31ActionProgress(before)`, which the ordinary V31-to-V33 replay requires. A forged committed mining-tool state with `activePick: 'basic'` and `basicPickOwned: false` could therefore pass the client proof path with a matching fake writer. V33 authoritative flow/store would still reject it, but runtime parity is mandatory. The implementer is running a red-to-green malformed-initial test and adding the full V31 decoder gate before proof consumption. Do not run the memory probe until this narrow repair and independent re-review pass. The callback's witness binding is canonical decoded value equality, not a claim of raw descriptor equality.

The V31 gap was reproduced red with a forged mining-tool state, then fixed by requiring the full `decodePublicV31ActionProgress(before)` and internal-state equality before proof use. The forged case now rejects with `local-replay` and no writer call; a legitimate 128-frame cap/event-parity case still passes. TypeScript/build and independent source re-review pass. The no-Canvas probe was then released.

## D result and forced architecture partition

The identical guarded no-Canvas U5 checked-save probe passed correctness: twelve W frames, zero rejections, twelve ancestor reads, one V33 commit, no Canvas, valid save. Pre-first-read clone calls fell from C1's 2,017 to 964 (52.2%); V23/V17 validations fell from 141 to 55 each (61.0%). Yet renderer RSS baseline 289,360 KiB rose to a 641,600 KiB peak, a 352,240 KiB adjusted rise, slightly **worse** than C1's 347,296 KiB and above the 260,472 KiB material-improvement ceiling. Post-GC idle passed at 312,928 KiB. The sole guarded renderer closed, the checkpoint remained unchanged, and both previews stayed HTTP 200. Source-only GO and clone-count reduction do not establish a RAM fix. Per this pack's stop rule, do not run a real UI traversal or add another local adapter clone patch. Partition the save architecture with explicit data-shape, migration, and compatibility proof. V33 remains guarded opt-in; ring discovery/travel is unproven.
