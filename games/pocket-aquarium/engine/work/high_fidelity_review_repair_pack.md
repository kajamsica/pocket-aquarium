# Reef Room High-Fidelity Review Repair Pack

## State

- Pack: `REEF-HF-R1`
- Product reviewed: `a208ee6848e49a69db955d5a69d76b946d4c8e11`
- Evidence base: `19640ba9f765c9a40e38aa72f20566279e782dd4`
- Trigger: HF-08 NO-GO.
- Stable surfaces to preserve: 4177 and 4178.
- Repair surface: a new isolated worktree and port 4179.
- No dependency, research, chemistry-ledger, species, lifecycle, or truth-boundary expansion is authorized.

## Findings to Close

1. `HF-R2`: biological flow scalars came from a fresh 0.5-second field while render telemetry came from a settled persistent field. Both consumers must use one canonical, quality-independent, solver-derived regime for mean speed, peak speed, mean shear, and low-flow fraction. Render-grid divergence and pressure residual may remain instantaneous diagnostics.
2. `HF-R1`: spectral mode must present six visibly distinct wavelength attenuation bands across the water volume, not only a subtle change on the horizontal surface.
3. Shrink defect: remove `OpticalRenderSettings` and use the locked `ReefRenderSettings` contract directly.

## Lane Graph

```text
HR-01 optics and type shrink --+
                               +--> HR-03 isolated integration --> HR-04 browser proof --> HR-05 review --> HR-06 promotion
HR-02 canonical flow regime ---+
```

## Shared Runtime Contract

All lanes continue the same qualified native children used in the original pack, with inherited model, local runtime, no Cursor, no durable task, no interruption, and no fallback. HR-01 and HR-02 use separate temporary worktrees from `19640ba`. HR-03 creates a third isolated worktree, applies accepted repairs, and is the only lane that edits `ReefScene.tsx`. Main receives planning documentation only and no production change through HR-05. HR-06 may apply reviewed repair commits to main only after reviewer GO.

All implementers must read the auto-planner and smallest-viable-diff skills, this pack, the original milestone contract, and project AGENTS instructions. Generated prose must not use em dashes.

## Tickets

### HR-01: Volume-Legible Spectral Diagnostic and Type Shrink

- Agent: `/root/reef_optics`, implementer only.
- Owned files: `src/scene/OpticalTank.tsx`, `src/scene/materials/opticalShaders.ts`, and existing spectral transport tests only when needed.
- Base: `19640ba9f765c9a40e38aa72f20566279e782dd4` in a unique temporary worktree.
- Behavior:
  - Import and use `ReefRenderSettings`; delete `OpticalRenderSettings` and any duplicate default type surface.
  - Pass spectral diagnostic state into the water-volume shader.
  - In spectral mode, render six distinct, ordered, labeled-by-HUD wavelength color bands across the visible water volume using the existing band coefficients and depth-dependent Beer-Lambert loss.
  - Keep beauty mode, offscreen capture, recursion guard, acrylic, Fresnel, target disposal, caustics, and fallback unchanged.
  - Avoid a full-screen opaque overlay. Fish, rock, water level, and tank boundaries must remain legible.
- Acceptance: targeted spectral tests, full tests, build, and no duplicate `OpticalRenderSettings` declaration.
- Visual proof: deferred to HR-03 and HR-04.

### HR-02: Canonical Solver-Derived Flow Regime

- Agent: `/root/reef_simulation`, implementer only.
- Owned files: `src/sim/flowField.ts`, `src/sim/flowField.test.ts`, `src/sim/reefSimulation.ts`, `src/sim/reefSimulation.test.ts`.
- Base: `19640ba9f765c9a40e38aa72f20566279e782dd4` in a unique temporary worktree.
- Behavior:
  - Add one deterministic, canonical, balanced-grid regime estimator keyed only by physical flow power, not render quality.
  - The estimator must be solver-derived, advance a fixed regime to a documented convergence horizon or criterion, and return mean speed, peak speed, mean shear, and low-flow fraction.
  - Biology must use that estimator exactly once per public simulation advance.
  - Export it for renderer telemetry. Do not store a field or render settings in `ReefSnapshot`.
  - Add parity tests proving biology-facing and renderer-facing scalar consumers receive identical values at low, moderate, and high power.
  - Preserve the moderate-flow polyp optimum, low-flow cyano contribution, all mass ledgers, lifecycle gates, feeding, ATO, and phase previews.
  - Bound cost with memoization or a similarly transparent pure cache that cannot change numerical results.
- Acceptance: targeted flow tests, full tests, build, parity trace, and long-run finite trace.

### HR-03: Isolated Repair Integration

- Agent: `/root/reef_integration`, implementer only.
- Dependencies: accepted HR-01 and HR-02.
- Workspace: a new isolated worktree and branch from `19640ba`, not main.
- Owned files: `src/scene/ReefScene.tsx`, exact cherry-pick conflict regions, and no other production file.
- Behavior:
  - Apply accepted HR-01 and HR-02 commits with authorship preserved.
  - Replace renderer scalar telemetry with the exact canonical regime estimator used by biology.
  - Continue reporting actual active-grid columns, rows, maximum divergence, and pressure residual.
  - Render quality must not change canonical biological scalar telemetry at fixed flow power.
  - Preserve local field sampling for motion and preserve 4177/4178.
  - Serve port 4179 and prove beauty, spectral, and flow views plus zero console errors.
- Acceptance: full tests, build, HTTP 4179, one canvas, no fallback or overlay, zero console errors, and parity values recorded.

### HR-04: Focused Browser Repair Proof

- Agent: `/root/reef_hardening`, browser acceptance only.
- Dependency: HR-03.
- Owned files: new evidence under `work/ui-evidence/` in the HR-03 worktree only.
- Behavior:
  - At one fixed paused young-reef state and flow power, capture balanced and cinematic telemetry. Mean/peak speed, shear, and low-flow fraction must match; only grid size, render scale, divergence, and residual may differ.
  - Capture beauty and spectral views. Spectral must show six visibly distinct ordered bands across the water volume while habitat remains visible.
  - Capture flow view and confirm vectors, finite values, one canvas, no context loss, no console error, and no required request failure.
  - Recheck feeding, ATO, fishless stocking, mobile, and short-wide essentials without repeating long evaporation unless a regression appears.
  - Record screenshot hashes and exact served revision.
- Acceptance: PASS receipt and evidence-only commit.

### HR-05: Independent Repair Review

- Agent: `/root/reef_review`, reviewer only, no edits.
- Dependency: HR-04.
- Behavior:
  - Verify all three findings are closed with file and line evidence.
  - Verify canonical flow scalars are identical across biology and render telemetry and independent of visual quality.
  - Verify volume-legible six-band mode uses the shared spectral coefficients.
  - Verify the duplicate type is gone and no new abstraction replaced it.
  - Recheck performance cost, cache determinism, resource disposal, truth labels, tests, and evidence revision.
- Acceptance: GO with no blocking or high-severity finding.

### HR-06: Reviewed Repair Promotion

- Agent: `/root/reef_integration`, same continued session.
- Dependency: HR-05 GO.
- Scope: git integration only, no code edits.
- Behavior:
  - Confirm main is clean, contains product/evidence base `19640ba`, and has no production change after that base.
  - Apply the exact reviewed HR-01, HR-02, HR-03, and HR-04 evidence commits to main in dependency order, preserving the planner-document commits already on main.
  - Recheck tests, build, 4179 HTTP 200, and main cleanliness.
- Acceptance: final main revision, exact commit chain, tests, build, live URL, and clean status.

## Closure

No finisher or PR lane is required. After HR-06, the top-level planner repeats Phase 4 reconciliation against the original user request, the high-fidelity milestone contract, both ticket packs, the HF-08 findings, and the accepted HR-05 review. Any new high-severity finding returns to planner mode.
