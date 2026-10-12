# V49 discovery-clipped Works survey affordance

## Mission and fixed interface

The opening valley currently makes buildable routes look like isolated hidden hotspots. The checked Greenway Works site resolver supports many 0.1 m-snapped ladder positions along the north cliff and bridge positions along the starter creek, but the scene advertises only two small example stakes of each kind. A player should see the surveyed obstacle section while aiming, tap a visible non-stake position, then see the existing ghost and its checked Ready or blocked verdict. This is a presentation repair, not free construction authority.

Worktree `/private/tmp/pa-wizard-playable-v2`, branch `ben/wizard-playable-v2`; preserve all existing dirty and untracked work. Preview `http://127.0.0.1:5193/?publicWorld=v29`. V48-A owns the sole live browser/WebGL renderer. No production edits, hot reload, or additional renderer until V48-A closes its browser and gives a receipt. No Git commit, push, or PR in this pack.

## Evidence and safety gates

- V46-A demonstrated an actual blocked step at a visibly raised cliff. V47-D proved the ladder event text is legible after a narrow CSS repair. Neither proves placement is self-evident.
- `publicWorldV17GreenwaySites.ts` accepts 0.1 m-snapped placement IDs across x ±29.4 m for ladders outside the protected center, and x ±9.1 m for starter creek bridges, subject to actual checked terrain, occupancy, cost, stance, and discovery.
- `PublicV17WorldView.ts` offers only two separated example candidates per kind. `WizardScene.tsx` renders these as small stakes. The existing obstacle picker and aim slider can select non-stake positions, and the aimed ghost already displays checked Ready versus blocked state.
- V28 connected-river bridge columns are discrete supported sites. Retain their discrete markers; do not paint a continuous Ready strip for them. Some V29 views switch between legacy starter works and V28 river context, so the presentation must follow the current checked context.
- The terrain picker and work picker traverse visible `THREE.Mesh` objects. Any survey line must not intercept picking. It must never expose undiscovered terrain or be mistaken for a Ready verdict.

## Topology audit: PASS, conditional dispatch

V49-A is the scene presentation implementer. V49-B is a disjoint focused scene-test owner after A fixes its helper interface. V49-C is a read-only integration reviewer after A and B. V49-D is a sole-renderer final UI checker after V48-A has closed. Source changes wait until V48-A closes because Vite hot reload could invalidate its live journey. No artificial parallelism, source ownership overlap, or second renderer. Primary owns integration, user updates, and stop/replan decisions. If A identifies a required authority, save, or migration change, stop and replan instead of broadening this pack.

## Smallest Viable Diff

Expected behavior delta: one neutral survey affordance over already revealed relevant cliff or creek sections only while matching Greenway Works mode is active. The existing aimed ghost and checked preview remain the only build verdict. Expected files: `games/wizard-realms/engine/src/view/WizardScene.tsx` and one focused scene test, optionally one short explanatory line in `WizardHud.tsx` if the visual needs a text key. Target: roughly 70–120 production/test lines, no new package, asset, save field, controller intent, or domain rule. Reuse `revealedTerrain`, `savedTerrainWorks.modeActive`, `.selectedKind`, `.context`, existing obstacle geometry, and existing checked preview. No scene-wide raycasting expansion or broad HUD redesign.

Forbidden: altering route eligibility, moving water/cliff geometry, granting a build from survey-only state, revealing hidden sections, intercepting obstacle picking, showing a Greenway continuous strip for V28 discrete river context, modifying older route modes, or adding more than one renderer. Rollback: remove the presentation component and test, leaving all stored state unchanged.

## V49-A scene implementer ticket

Role lock: implementer, scene presentation only. Dispatch transport: native continued subagent, inherited model. Read this pack and current source before editing. Add a lightweight neutral line or segment strip clipped to revealed sections of the selected north cliff or starter creek while matching Greenway Works mode is active. Use a non-mesh visual or prove it is excluded from the work picker. It must be visually subordinate to the aimed ghost, not gold/Ready colored. Hide when mode closes or when the view is using V28 connected-river context. Preserve existing candidate stakes, built structures, and ghost. Keep the helper local and pure if possible. Report exact changed files/lines, clearance/discovery logic, pickability, focused validation, and no Git writes.

## V49-B test owner ticket

Role lock: focused test implementer. Own only the applicable scene test, not production source. Write targeted tests for: Works off has no survey; ladder mode shows only revealed north-cliff segments; bridge mode shows only revealed starter-creek segments when Greenway context applies; V28 context shows no continuous strip; the survey is not a Mesh picked by the obstacle picker; blocked aimed ghost is still distinct. If the scene component cannot be statically rendered, use a pure geometry helper and test it with synthetic revealed tiles. Do not test a guessed build verdict or duplicate authority. Report focused test result and exact diff.

## V49-C integration review and V49-D real UI proof

V49-C: read-only reviewer, inspect A/B diff for discovery leakage, visual semantics, picker interception, ownership/scope, and V28 context. Run focused tests, TypeScript, build, and `git diff --check`; distinguish existing baseline failures. GO only if checked construction and save behavior are unchanged.

V49-D: after all other browser sessions close, one isolated fresh V29 browser. Reveal a cliff/creek section, open matching Works mode, and capture the neutral survey with a non-stake aimed ghost and its checked reason. Close Works and verify the survey disappears. Capture screenshot, visible messages, console/network, and close browser. Do not claim click-to-build at any point unless the existing checked preview says Ready. Stop at first decision-bearing blocker and use the observed failure loop if a bounded repair is authorized.

## Completion evidence

Minimum V49 completion is targeted tests, TypeScript/build, read-only review, and a real UI screenshot proving the strip only while matching Works is active, plus a non-stake aim checked by the existing preview. This does not complete the larger request for meaningful far-bank content, above-grade soil placement, camps, boats, mounts, or full-game exploration.

## First observed failure and bounded repair, V49-R1

Observed error: fresh V29 W 1800 ms to the north cliff, Works On > Ladder showed the aimed ghost and checked `Gather 4 logs` but no discernible neutral survey strip on the exposed wall. A non-stake wall tap at viewport `(870,375)` left aim x 1.1 unchanged. [Works On screenshot](/private/tmp/wizard-v49d.VcEFtI/.playwright-cli/page-2026-10-10T08-08-52-582Z.png), [Works Off screenshot](/private/tmp/wizard-v49d.VcEFtI/.playwright-cli/page-2026-10-10T08-11-51-778Z.png). Browser closed; console had only favicon 404 and THREE.Clock warning; no nonstatic network failures. Current V49 is NO-GO for user-visible affordance. Source tests and build passing did not prove it was perceivable.

Repair owner: `WizardScene.tsx` V49 survey geometry/material only. First causal hypothesis is that a 1px gray line at `surface.position[1]+0.16` is buried at the cliff foot or too low-contrast. Raise the cliff survey band onto the visible wall face and make it clearly contrasting but still non-gold/non-Ready, with no Mesh and no picker change. Preserve discovery clipping, V28 exclusion, and existing checked ghost. Test owner updates only exact visual geometry/material assertions if necessary. Vite HMR/one browser refresh is the affected-component restart. Retry the **identical** fresh Start, W 1800ms, Works On > Ladder entrypoint, then compare Works Off; capture screenshot and non-stake tap result. If the same visibility failure survives this grounded repair, broaden source evidence before another change. The separate non-stake tap could have missed the specific pickable fascia; do not alter picker until a visible precise tap establishes that failure.

## Source-confirmed picker mismatch, V49-R2

The non-stake tap also exposed a separate mismatch, now source-confirmed: `TerrainSurfaceLayer` omits its normal fascia where the V26 physical rim is rendered, but `pickVisibleWorkAimX` accepts only the omitted `Terrain perimeter and cliff fascia` mesh for ladder aim. The visible `V26 starter valley rock rim` is the frontmost Mesh and is rejected. Its shoulder extends 0.5 m to either side of z=-6, beyond the old ±0.2 fascia tolerance. This is presentation picking only; checked build authority is unaffected.

After R1's browser closes, repair the one picker owner in `WizardScene.tsx` and add a regression in `WizardScene.test.ts`. Preserve the existing fascia branch and frontmost-hit behavior. Accept the exact V26 rim mesh only for south-facing camera rays on its revealed north-wall face with `|x| <= 29.4` and `|z+6| <= 0.55`, and only when the adjacent lower/upper canonical north-wall cells are both revealed. The side returns, backface, hidden half, and unrelated foreground meshes must not aim. Pass currently revealed terrain to the picker without a second discovery source. A valid rim tap changes transient aim only; checked preview remains sole build verdict. Use generated rim geometry in focused tests where practical. No save, domain, witness, or material-cost change. Retry the same visible non-stake wall tap from the south after Vite HMR; report whether aim changes and the checked reason. If it still fails after one grounded picker repair, inspect exact ray hit before broadening.

## R2 result and observed HUD guidance loss, V49-R3

R2 real-browser retry advanced: the same fresh W 1800 ms north-cliff route, Works Ladder, and non-stake tap at `(870,375)` changed aim from x 1.1 m to x 2.9 m. The latter position was unsuitable, so ghost/Confirm disappeared. The visible HUD incorrectly said only `Choose Bridge or Ladder in Works, or close Works for spade Dig/Fill.` [Before tap](/private/tmp/wizard-v49r2.jvGfz6/.playwright-cli/page-2026-10-10T08-25-32-745Z.png), [after tap](/private/tmp/wizard-v49r2.jvGfz6/.playwright-cli/page-2026-10-10T08-27-46-748Z.png). Browser closed; console favicon 404 and THREE.Clock warning only; no nonstatic network failures. The picker bug is passed, but the affordance is not complete until the player sees why this aimed point cannot build.

The view already computes `No supported ladder position at x 2.9. Shift the aim along the obstacle.` as `workPreview.guidance` when the resolver has no site. `WizardHud.tsx` has a V26 Terrain Works-on, no-starter-site branch that returns a generic instruction before reading that guidance. R3 owner changes only that branch to prioritize the projected exact guidance, with the existing generic instruction as fallback; test owner adds a focused HUD regression using an active Greenway ladder aim with `selected=null` and `guidance` set. Do not change the resolver, checked build authority, or pointer logic. Retry the identical unsupported non-stake tap after Vite HMR; acceptance is visible precise aim reason, ghost absent, and no false Ready state. If precise guidance is still missing, inspect the projected value in this exact view before another edit.

## V49 observed retry receipts

R1: no discernible cliff survey | raised the ladder line onto the visible mid-face, increased neutral contrast, doubled its stroke | fresh isolated browser after Vite HMR | passed visibility: [Works On](/private/tmp/wizard-v49r1.MLP0gV/.playwright-cli/page-2026-10-10T08-17-22-251Z.png) shows pale line separate from ghost, [Works Off](/private/tmp/wizard-v49r1.MLP0gV/.playwright-cli/page-2026-10-10T08-19-06-670Z.png) removes both | next: non-stake aim.

R2: non-stake tap did not aim | picker now accepts the revealed player-facing V26 north rim with strict side/return/foreground guards | fresh isolated browser | advanced: identical `(870,375)` tap changed aim x 1.1 to x 2.9, but unsupported point had no visible reason; [before](/private/tmp/wizard-v49r2.jvGfz6/.playwright-cli/page-2026-10-10T08-25-32-745Z.png), [after](/private/tmp/wizard-v49r2.jvGfz6/.playwright-cli/page-2026-10-10T08-27-46-748Z.png) | next: HUD guidance.

R3: unsupported aim hid the view's precise guidance | one-line HUD branch now prefers `workPreview.guidance` and retains generic fallback | fresh isolated browser | passed: identical `(870,375)` tap changes aim x 1.1 to x 2.9 and displays `No supported ladder position at x 2.9. Shift the aim along the obstacle.` with no ghost or Confirm; [after](/private/tmp/wizard-v49r3.Tpcg60/.playwright-cli/page-2026-10-10T08-36-32-769Z.png) | next: integrated review and bridgehead content. All browser sessions were closed; Vite remained HTTP 200. Console evidence on each retry showed only favicon 404 and THREE.Clock deprecation, no nonstatic request failures. The valid non-stake Ready case and actual construction are separately proven by earlier saved-route journeys, not this unsupported tap.
