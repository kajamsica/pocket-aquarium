# Pocket Aquarium — PR #8 Post-Merge Validation

## Understanding

- Ask: treat Ben's merged 3D/specimen foundation as the main app and continue gameplay work without losing the accepted feeding, mobile, care, camera, save, and native behavior.
- Exact baseline: `origin/main` at `c81a172ffcfa7e9006d70a67ae745533cc11ae4d`.
- Current evidence: simulation 231/231, native 61/61, R3F 41/41, and production build pass. PWA is 130/138 because eight source-structure assertions still require care logic inside `js/app.js`; PR #8 intentionally moved that authority to `js/sessionGuide.js`.
- Goal: make the PWA acceptance suite validate the new shared guide authority behaviorally, then run full browser acceptance against the exact merged revision.
- Non-goal: no gameplay, guide, UI, camera, feeding, specimen, save, native, or deployment behavior change in this repair.
- Risk: merely weakening string assertions could hide a real toxic/elevated priority regression. The replacement must execute the shipped shared guide at boundary values and retain ordering/environment-before-stocking proof.

## Ticket PV-01 — Retarget stale care tests to the shared guide

Behavior delta:

- None in production. Update only the PWA test harness so it follows the merged single source of truth in `js/sessionGuide.js`.

Expected diff budget:

- Files: 1 test file, plus this planning artifact.
- Net lines: within ±120.
- New files/dependencies/runtime changes: zero, excluding this plan.

Expected changed file:

- `tests/pwa.test.js` — replace legacy `careAdvice`, `waterToxic`, and `waterElevated` source-location assertions with executable shared-guide contract tests.

Forbidden surfaces:

- Every production file, dependency, lockfile, generated asset, native file, and deployment workflow.

Reuse scan:

- Reuse the existing Node VM/browser-global harness patterns in `tests/pwa.test.js`, `js/sessionGuide.js`, `js/data.js`, `js/sim.js`, and the current boundary fixture values.

Prompt/config/contract alternative:

- Production config/code is already correct; only the test contract points at the removed implementation location.

Deletion/simplification target:

- Delete obsolete assertions that demand duplicated care helpers in `js/app.js`; do not keep compatibility-only production functions for tests.

Validation:

- `node tests/pwa.test.js`, then `node tests/sim.test.js`, `node tests/native.test.js`, R3F Vitest, and production build.

Tripwire policy:

- Stop if any production file is required or if the test no longer executes toxic/elevated threshold cases and environment-before-ready ordering.

## Ticket PV-02 — Exact-revision browser proof

- Serve the built merged app on a new non-blocking port; preserve 4187 as a pre-PR8 comparison.
- Verify phone portrait and landscape with no overflow/console errors.
- Verify contact feeding, pinch-without-feed, fish inspection, water-care scrolling, normal save reload, and the ocellaris workbench evidence/editor surface.
- Record exact revision and surface URL. Any player-facing regression becomes a separate bounded repair before god/watch mode.

## Dispatch

- PV-01: Claude CLI Opus implementer, test-only.
- PV-02: top-level browser acceptance after automated suites are green.
- Independent read-only review follows exact-revision evidence; no PR/merge is required unless a real code repair is discovered.
