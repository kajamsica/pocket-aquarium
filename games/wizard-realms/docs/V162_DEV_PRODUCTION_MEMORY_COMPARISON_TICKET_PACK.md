# Ticket Pack: V162 development versus production memory comparison

## Understanding and scope

V160's Vite development browser hit the RAM guard while exploring Ledger. V161's browser allocation sample shows a large React development prop-diff path plus real V36 replay, view and terrain allocations. The causal question is whether a production bundle supports materially longer ordinary play under the same memory stop. A build comparison is warranted before changing save or scene internals. This pack is diagnostic, not a production deployment or a quest claim.

No game source, save schema, dependency, permanent server, tester profile, player preview or GitHub change. Preserve the authentic barefoot profile and existing DEV boots-equipped profile. Use new disposable fresh-start browser profiles. Keep ports 5194 and 5195 available, and close the temporary 5196 preview after proof. Only one game renderer at a time.

## Topology and diff

One productive lane is safe: the isolated production build must finish before sequential dev and production browser arms, and both arms use the one-renderer budget. A separate preparer or generic reviewer would not shorten the critical path. Primary owner integrates. Dispatch verdict: **PASS at width one**.

Expected repo diff: zero. External artifacts: one `mktemp -d` build output, two disposable browser profiles, screenshots and a compact metrics trace under `/private/tmp/v162-*`. No `dist` overwrite. Vite build directly into the temporary directory with `npx vite build --outDir <temp>/dist --emptyOutDir`; run `npx vite preview --outDir <temp>/dist --host 127.0.0.1 --port 5196 --strictPort`. Build under self-tested exact-worker-PID 1536 MiB guard. If build needs no TypeScript step, state that it proves bundling, not typecheck; prior guarded TypeScript remains the separate proof. Do not use `npm run build`, which would write default dist.

## V162-A: build and two-arm guarded UI comparison

Role `reviewer` ONLY. Transport `native_spawned_subagent`, inherited model, no Cursor, durable task, nested agent, or fallback. Required skills: read `test-from-ui`, its generic reference, and `playwright` fully before acting. Use `early_smoke` mode. No source edits or direct game state/action calls.

1. Confirm both existing ports HTTP 200, memory headroom, and no owned game renderer. Build the current engine with direct Vite into a new validated temporary directory under the 1536 MiB exact-PID guard. Record build exit, artifact hashes/size and any errors. Start only the temporary production preview on 5196, verify it serves V36. A build or server setup failure is an environment blocker with at most one documented retry; no broad repair.
2. Run the development arm first on 5195 with a fresh disposable profile and one 1280×720 browser. Self-test and arm the exact Chrome renderer PID nominal 50 ms guard before navigation, early 870400 KiB, hard 1024000 KiB. Through visible UI choose New Game and confirm barefoot starting character, initial quest, starting save/currency. Capture loaded baseline RSS, GPU RSS, JS heap, screenshot. Execute up to four identical short held-key movement steps of 500 to 700 ms each, separated by visible save settlement. Record accepted movement/tile, save transitions, per-step settled and peak memory, console/network, and any guard. Stop at first product blocker or guard. Close this browser and guard before opening the other arm.
3. Run the production arm on 5196 with a different fresh disposable profile and the same viewport, UI start and exact input sequence, under a newly self-tested exact-PID guard with the same thresholds. Stop after the same number of steps completed by the dev arm, or sooner on guard/blocker. Compare baseline-to-step RSS and JS heap at equivalent journey/checkpoint phases. If both arms reach four steps safely, call that a bounded comparison, not sustained-play proof. Do not open the dedicated Ledger tester profile in this pack.
4. Close only owned browsers, guards and 5196 preview server. Verify their exact PIDs absent, 5194/5195 HTTP 200, and no repository source/diff change. Keep external evidence directory recoverable and do not delete profiles by broad glob.

Return table with build and browser revision evidence, identical input sequence, visible quest/save states, phase-matched renderer/GPU/JS metrics, sampled peaks, screenshots, console/network and cleanup. Verdict should say whether production is materially lower, comparable, or unresolved. Do not infer a product memory leak from a dev-only path, nor call the full game validated from four steps.

## Primary decision

If production is materially lower and stable under this bounded test, move later Ledger UI proof to a production-bundle test surface without disturbing the player preview, and separately decide whether dev diagnostics need tuning. If production also approaches the guard, prioritize a product allocation owner from V161's source-to-stack map and write a minimal repair pack with identical UI retry. If build/test setup fails, keep V36 preview available and report the evidence gap. Full-game goal stays active.

## Receipt and classification

The external Vite bundle built in 317 ms from 333 modules under the guarded build process, with a 355,008 KiB peak. The dev arm completed four visible fresh-game W holds and checked-save settlements from barefoot level 1; its renderer peaked at 503,792 KiB and the fourth step showed the expected cliff-ladder cue. The production arm could not begin New Game. It visibly rendered `Experimental V36 is not ready. Your V35 save remains available. Open V35`. Source inspection confirmed `src/main.tsx` deliberately requires `import.meta.env.DEV && PUBLIC_V36_ENTRY_READY` for V36, so a production build intentionally shows the fallback. The reviewer stopped there, closed only owned browsers, guards and 5196 preview, and left 5194/5195 HTTP 200. Full receipt: `/private/tmp/v162-devprod-yfksd4/comparison-receipt.md`.

Classification: **expected product release gate**, not a production build failure and not a dev-versus-production memory result. Do not remove or globally override this gate. A separate isolated test-only transform may enable V36 in a local release-mode bundle for diagnostic comparison, with no source edit, no published artifact and a disposable profile.
