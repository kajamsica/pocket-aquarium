# Ticket Pack: V168 align marked Greenway dry ground with excavation authority

## Observed error and locked repair boundary

The V166 tester stood at two map-marked Greenway forest dig sites with an equipped field spade. Ordinary Dig taps on visibly green ground repeatedly produced the checked refusal `Choose dry ground outside the river and wetland`, and hover showed no target outline. V167 established a seed-independent owner: V16 explicitly renders grid rows 3 and 4 in the starter bank as `temperate_forest/loam`, but V26 Dig, V29 Mine and the hover hint consult the older raw `worldTileAtGrid` classification, which is marsh/wetland for every cell center within 5 m of those saved player poses. The refusal is real and replayable; the tap reached checked authority. The decorative-pick concern is separate and unproved for these taps.

Fix only this classification disagreement. The authored V16 dry-bank tile must be the canonical terrain surface for terrain tools in Greenway, while the V25 river remains blocked and streamed-region terrain keeps its existing authority. Preserve support, occupancy, discovery, distance, tool, skill, capacity, checked witness, save/replay and historical version gates. Do not mint stone, teleport, edit saves, auto-complete Ledger or alter quest rewards. No GitHub/PR action.

The working preview checkout at `/private/tmp/pa-wizard-playable-v2` currently lacks a `.git` pointer and contains substantial pre-existing user work, including untracked game files. It is not a safe commit unit. Preserve all files and do not run cleanup/reset or create a commit from this incomplete checkout. Limit source edits to the explicit owner files and focused tests. The primary will later integrate through an intact game-repo checkout, after the visible retry proves the repair. The 5194/5195 player previews must remain available; no game renderer during implementation.

## Interface and smallest diff

Add one pure, deterministic domain helper that answers the checked wet/dry surface classification for a canonical `(seed, gx, gz, movementOwner)` cell using `publicWorldV16TileAtGrid` for Greenway and the existing `worldTileAtGrid` for streamed terrain. Keep explicit `publicV25RiverCellAtGrid` rejection at every caller. Do not change V16 tile generation or the raw world tile catalog. Put the helper in a small new domain module only if sharing it actually reduces duplication and preserves dependency direction.

Apply the same helper to the terrain-tool wet checks in `publicWorldV26TerrainAction.ts`, `publicWorldV29DeepDigAction.ts`, `publicWorldV26PitLadder.ts`, and `publicWorldV31Soil.ts`. In `WizardScene.tsx`, make `v26TargetedTerrainCell` use the displayed revealed terrain cell or a reliable Greenway/streamed owner signal so its neutral hover hint agrees with the checked action. Do not derive permission from client visuals: the checked domain helper remains the authority. Do not change the raycaster in this pack; a separate controlled case is needed for decorative interception.

Regression proof must include: the exact V167 marked-bank classification under Greenway, same coordinates still wet for a streamed owner if raw terrain says wet, genuine V25 river cells still wet, remote/unrevealed/occupied cells still reject without mutation, normal dry Greenway/streamed samples keep prior behavior, and focused Mine/Fill/Place Soil/pit-ladder surface gates if affected. Existing checked saves must decode/replay; no schema or migration change. Capture pre-edit file hashes and changed-file/line accounting because Git metadata is absent in this scratch checkout.

## V168-A: implementation and focused tests

Role `implementer` ONLY; native spawned subagent, inherited model, no Cursor, durable task or nested workers. Required `auto-planner-ticket-pack` collaboration contract is fixed by this pack; use `smallest-viable-diff` fully. Own only the named domain/view files, one optional helper, and their directly relevant focused tests. Use `apply_patch` for edits. No broad formatting, package changes, generated asset or quest rewrite.

1. Capture source-file hashes and line counts. Implement the shared checked classification and replace only stale wet checks. Confirm V16 overlay is applied only for Greenway, not streamed terrain. Keep river predicate first and all other checks in original order.
2. Add focused deterministic tests for the marked-bank mismatch and preservation gates above, reusing existing test scaffolding. Run one bounded Vitest worker for affected tests, TypeScript and build as permitted by RAM headroom. Do not open a browser. If test implementation requires broad fixtures, stop and report rather than fabricate passing evidence.
3. Return exact files, added/deleted lines, behavior before/after, focused test and build receipts, memory/process cleanup, limitations, and any replay compatibility concern. No commit or GitHub action.

## V168-R: independent read-only review after A

After A finishes, a separate reviewer checks the actual diff, test coverage, Greenway/streamed boundary, V25 river precedence, historical save replay and risk of widening dry terrain. The reviewer runs no browser and changes no files. Findings-first GO/NO-GO with line references. This lane is sequential, not artificial parallelism.

## V168-U: identical-entrypoint UI retry after GO

After A tests and R review, build a new external local-only release-mode V36 diagnostic bundle with the same V163 gate substitution, without changing the repo V36 production gate or repo `dist`. Use one guarded browser, the same dedicated tester profile and 5195 origin proxy, starting from the saved V166 forest pose with field spade and pick. Repeat the same normal-camera, Dig-selected, visible-ground hover/tap journey. The proof target is one outlined dry cell, a checked Dig, second Dig if soil depth requires, equipped-pick Mine, one terrain-bag stone and checked save/reload. Stop at first new error or RAM guard. No automatic Ledger claim in this retry. Close owned renderer/preview and preserve 5194/5195. Report the observed loop as `observed error | change | restart | retry result | next action`.

## Primary decision

Do not claim repair from unit tests alone. If identical UI retry passes, advance to a separate guarded Ledger return/claim/reload. If the same wet refusal survives on a verified marked bank, broaden to projection/owner mismatch rather than layering another speculative patch. If click becomes no-target, isolate the decorative picker as a separate owner. The full-game goal remains active.

## V168-A and V168-R receipts

V168-A patched only the five named existing production callers, one nine-line shared domain helper, and five focused existing test files. The helper selects the V16 authored tile for a Greenway owner and raw world tile for streamed ownership. Each terrain action keeps V25 river rejection first; downstream occupancy, reach, tool, skill, capacity and witness checks remain. Focused one-worker Vitest groups passed 97 tests total, TypeScript noEmit passed, and an external Vite build passed at `/private/tmp/v168-a-build-OccV3p/dist` (334 modules, 314 ms). No browser, profile, repo `dist`, GitHub or server change. Both 5194 and 5195 stayed HTTP 200. Scoped patch accounting: 11 files, +116/-11 lines. Pre-edit hashes were captured except for the V31 snapshot test; its 27 added lines were accounted for.

Independent V168-R source review returned **GO**. It checked the owner-specific helper and explicit river precedence in V26 Dig, V29 Mine, pit ladder, V31 soil and hover. An initial concern about cross-owner raised-soil replay was withdrawn after verifying V31's existing protected-corridor gate, which prevents soil placement on the newly dry bank. The source reviewer saw no schema or migration edit or unrelated file owner. The bank Mine test does not itself prove stone; V168-U remains the user-visible gate. The scratch checkout's absent Git metadata limits independent historical diff certification, so no commit or PR is attempted from it.

## V168-U identical UI retry and decision

**PASS for the scoped stone sample and reload.** A fresh isolated local V36 release-mode bundle built from the patched source with the exact one-token diagnostic gate transform (334 modules). The same dedicated tester save resumed at the exact V166 forest pose. Normal hover at the previously non-outlining point now outlined a cell; checked Dig at the same column twice produced soil at depths 0.4 m and 0.8 m. The owned basic pick was equipped, and checked Mine yielded Stone ×1 at 1.2 m. Ledger advanced to carry the stone to Outfitters. Same-tab reload and Continue validated V36 save #330 and retained Stone ×1, Soil ×2, active pick and the quest objective. [Full UI receipt and screenshots](/private/tmp/v168-ui-retry-mVJSPT/V168_U_RECEIPT.md).

The build worker peak was 435,184 KiB; the exact-PID renderer peak was 402,624 KiB and GPU peak 168,048 KiB, with no guard event. Browser, guard and temporary 5196 preview closed; 5194/5195 stayed HTTP 200. This validates the observed error loop for the marked Greenway site, not sustained-play memory or the Ledger hand-in. **Decision:** GO to one guarded normal-control Outfitters delivery/reload segment on the saved stone-bearing tester. Keep the production V36 gate closed and preserve the authentic barefoot profile.
