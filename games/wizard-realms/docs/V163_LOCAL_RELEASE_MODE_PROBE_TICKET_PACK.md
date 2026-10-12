# Ticket Pack: V163 isolated release-mode V36 memory probe

## Contract

V162 found that a standard production bundle intentionally hides V36 behind `import.meta.env.DEV` in `src/main.tsx`. V161 found significant React development-diagnostic allocation. We need a release-mode memory comparison, but the V36 exposure gate must remain intact in source and published output. Build one strictly local, temporary diagnostic bundle with an exact one-token V36-only transform, then replay V162's four fresh-start W holds. This is a test artifact, not an authorization to release V36.

The full-game goal remains active. The player preview on 5194, dev test preview on 5195, all authentic and boots tester profiles, and release gate source are untouched. No GitHub, deployment, PR, dependency or save migration change.

## Topology and smallest diff

One productive lane: the transform and build are serial prerequisites for one guarded browser. A second renderer violates the user's one-renderer constraint. The primary planner reviews the receipt. Dispatch verdict: **PASS at width one**.

Repository diff budget: zero files. External artifacts: a fresh validated `/private/tmp/v163-*` directory containing a small Vite config overlay, build output, one disposable profile and proof. Use `apply_patch` to write the external config, not shell write tricks. The overlay imports the existing Vite config and prepends an `enforce:'pre'` transform that matches only the exact `import.meta.env.DEV && PUBLIC_V36_ENTRY_READY` expression in `src/main.tsx`, once, replacing it with `PUBLIC_V36_ENTRY_READY`. Fail the build if the exact source match count is not one or if any other module is transformed. Retain `base: './'` and normal production React transform. Do not change V35/V34 gates or define `import.meta.env.DEV` globally. Never copy the test bundle into repo `dist` or publish it.

## V163-A: isolated build and one guarded UI arm

Role `reviewer` ONLY. Transport `native_spawned_subagent`, inherited model, no Cursor, durable task, nested agent or fallback. Required skills: read `test-from-ui`, generic UI reference, `playwright`, and `smallest-viable-diff` fully before task actions. `early_smoke` validation. No source edits, direct game action calls or IndexedDB writes.

1. Confirm 5194/5195 HTTP 200, memory headroom, no owned game renderer, source token count exactly one, and V162 dev baseline source revision unchanged. Prepare an external Vite config overlay in a fresh `mktemp -d` directory, importing the engine's existing config with anchored paths. The only transform is the exact V36 release-gate token, guarded by count and module ID. Syntax/check the config before build. Record overlay hash and build command.
2. Build with `NODE_ENV=production` and `npx vite build --config <external-config> --outDir <temp>/dist --emptyOutDir` under a self-tested exact-worker-PID 1536 MiB guard. Verify the build output stays outside the repo, V35/V34 source gates remain unchanged, and no repo diff appears. Start a temporary preview on 5196, local host only. If config/toolchain cannot be made to work after one bounded check, stop as environment blocked; do not edit game source or widen the transform.
3. With a new disposable profile and one 1280×720 browser, self-test/arm the exact-PID nominal 50 ms renderer guard at 870400 KiB early, 1024000 KiB hard before navigation. Open `http://127.0.0.1:5196/?publicWorld=v36`. Confirm visible New Game. Use it to start barefoot level 1 with 120 coins and Surveyor's First Find, matching V162 dev. Replay exactly four nominal W600 holds, each followed by a visible checked-save settlement, stopping sooner for a product blocker or guard. Capture baseline and each step: tile/quest/cue, JS heap, settled renderer/GPU RSS, sampled guard peaks, screenshot, console/network. No boots/equipment or map change.
4. Compare equivalent phase deltas with `/private/tmp/v162-devprod-yfksd4/comparison-receipt.md`, noting that V162's development arm had actual holds 645/637/635/635 ms and peak renderer 503792 KiB. The comparison is bounded and observational, not proof that production V36 is launch-ready or sustained-play safe.
5. Close owned browser, guard and 5196 preview; verify their exact PIDs gone and 5194/5195 HTTP 200. Preserve external evidence. Verify no source, repo dist or GitHub change. Never touch unrelated Chrome processes or user tabs.

Return findings-first result with source/overlay/build hashes, strict transform proof, artifacts, phase table, guard/cleanup, and inference limits. If the local diagnostic build makes V36 visible but its UI fails, report that exact product error and stop. If it remains hidden, report the gate still blocked; do not keep trying new ways to expose it in this lane.

## Primary decision

If the isolated release-mode journey shows materially lower memory at equivalent steps, use a similarly isolated bundle on the same test origin for later Ledger validation without weakening the published gate. If comparable or worse, prioritize a minimal current-product allocation repair using V161's browser stacks. A local override is diagnostic evidence only; V36 stays unreleased until its real source, save, memory and UI gates pass.

## Receipt and decision

The strict external overlay transformed the single V36 gate token once and left `src/main.tsx`, `vite.config.ts`, V35/V34 gates and repo `dist` unchanged. A local production-mode bundle on 5196 visibly started the same barefoot level-1 Surveyor game and completed four W600 holds with checked saves and the same fourth-step cliff cue as V162 dev. Release-mode renderer peak was 386,992 KiB versus 503,792 KiB in dev, about 23% lower. GPU peaks were comparable. Both were under the same early/hard guard. The browser, guard and 5196 preview closed; 5194/5195 remained HTTP 200. Full evidence: `/private/tmp/v163-release-probe-nJZ31D/release-mode-receipt.md`.

Decision: **GO** on materially lower bounded local release-mode footprint; **NO-GO** on sustained-play safety or releasing V36. Next, serve this same external bundle through a browser-local same-origin route only to the dedicated 5195 tester profile, then continue the real Ledger journey under the guard. Do not change 5195's server or published gate to do so.
