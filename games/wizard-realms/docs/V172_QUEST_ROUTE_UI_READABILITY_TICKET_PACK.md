# Ticket Pack: V172 route and Works readability

## Goal and evidence

The V171 fresh-profile test reached the River Works claim without a gameplay dead end, but at 1280 × 720 the map route key began below the fold and the Works Ready explanation was clipped. The first quest should reveal its next route and action without a hidden scroll step. This is a focused UI repair, not a new quest or a production release.

## Contract and scope

- Preserve the existing V36 gameplay, quest, map, input, save and reward authority. Do not change route costs, positions, visibility or progression.
- Make the Greenway route key and map grid usable together at 1280 × 720, including the South creek bridge and North cliff ladder guidance. Keep mobile map behavior functional and avoid truncating interactive controls.
- Make the Works panel's selected Ready status, material cost and confirmation visible or plainly scrollable at 1280 × 720, without hiding the game canvas permanently. Prefer a compact panel or bounded internal scroll to moving major HUD architecture.
- Repair only the observed owner, add focused regression tests, then repeat the same visible route/map journey through one guarded renderer. Preserve both existing profile saves. Do not modify the standard production V36 entry gate, publish, commit, push or create a PR.

## Work lanes

1. UI implementer: inspect `WizardMap.tsx`, `WizardSurface.tsx` and `PublicV23Controller.tsx`, make the smallest change, and run relevant Vitest, typecheck and diagnostic external build. Return exact files, tests and limits. No browser renderer.
2. UI reviewer/tester, after build: use one 1280 × 720 guarded browser and new disposable profile or approved existing dedicated tester profile to inspect map and Works. Capture screenshots and accessibility/scroll state, validate no occlusion of essential action, and close owned browser/temporary preview. Early 870400 KiB, hard 1024000 KiB exact renderer guard. Keep 5194/5195 available.

## Acceptance

At 1280 × 720, the map shows a legible grid and actionable route guidance without needing to hunt below a hidden fold; the selected Works route can be read and confirmed or scrolled obviously. Tests pass, the UI journey advances, one renderer only, existing game state unchanged. Later quests still require separate checked-authority and gameplay work. No full-game completion claim.

## Result

**Passed locally, not published.** The implementation changed only `WizardMap.tsx`, `WizardHud.tsx` and their focused tests. The Greenway route key sits beside the grid on desktop, and Works shows a concise selected-site, cost and Ready/rejection status above the aim controls. Map tests passed 21/21, an isolated Works-status test passed, TypeScript and a diagnostic build passed. A broader pre-existing HUD/Surface test path still fails on direct `WizardHud(...)` calls with a null React `useState` dispatcher; that failure was not repaired or counted as a pass here.

The first diagnostic production-mode bundle visibly showed the closed V36 entry gate. An external local-only build transform, already used for V168, changed that diagnostic artifact only; the app source and published gate stayed unchanged. The same guarded UI entrypoint then passed: at 1280 × 720 the map grid, route key and legend were visible together; Works showed the Ready Creek bridge, 8-log cost, 80 Construction XP and Confirm. The tester built the bridge using ordinary UI, spending eight logs and receiving the XP. At 390 × 844 the map and Works remained scrollable and closeable. Console errors and network failures were zero; renderer peak was 498080 KiB under the early guard. Owned browser, guard and temporary preview closed, 5194/5195 remained HTTP 200. Only a disposable test profile changed.

[Desktop map screenshot](/Volumes/git/weave-agents/.playwright-cli/page-2026-10-12T05-19-33-693Z.png) · [Works Ready screenshot](/Volumes/git/weave-agents/.playwright-cli/page-2026-10-12T05-21-56-452Z.png) · [Mobile map screenshot](/Volumes/git/weave-agents/.playwright-cli/page-2026-10-12T05-22-33-026Z.png)
