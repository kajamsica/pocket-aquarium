# Reef Room High-Fidelity Ticket Pack

## Pack State

- Pack: `REEF-HF-01`
- Base revision: `f723c55e6f7f7d6d16044ed63e2c373775ed8052`
- Goal source: `work/high_fidelity_implementation_problem.md`
- Existing-task routing: authorized only for the seven recent, completed reef specialist children in this task tree.
- Durable task creation: not authorized and not needed.
- Final fallback transport: none.
- Current user surface: `http://127.0.0.1:4177/`, preserve during worker and browser validation.
- Proposed merge unit: one cohesive high-fidelity milestone on `main`. PR packaging is not requested.

## Lane Graph

```text
HF-01 spectral optics ---------+
HF-02 flow solver -------------+--> HF-05 integration --> HF-07 browser proof --> HF-08 review
HF-03 procedural materials ----+          ^                       |                 |
HF-04 diagnostics HUD ---------+          +-- HF-06 bio coupling -+                 |
                                                                                     +--> conditional repairs
```

Parallel wave 1 is HF-01 through HF-04. HF-06 begins when HF-02 is accepted and works in the same flow specialist session. HF-05 begins when HF-01 through HF-04 are accepted, then incorporates HF-06 before its final receipt. HF-07 and HF-08 operate from the same integrated revision, with HF-07 using an isolated port and HF-08 performing independent read-only review.

`SURFACE_READY` occurs when HF-05 serves the integrated revision on a new local port and passes the minimal desktop smoke gate. Existing port 4177 remains the stable surface.

## Initialization Contract

All lanes use `native_spawned_subagent` by continuing a qualified, completed native child from this task tree. Model is `inherited`, runtime is local, Cursor runtime is `not_applicable`, task/thread receipt is `not_applicable`, fallback is `none`, and session policy is `initialize_once_then_continue`.

Qualification evidence:

- `/root/reef_optics`: recent optical shader and physical-material implementation, completed, no current ownership.
- `/root/reef_simulation`: recent deterministic simulation and regression implementation, completed, no current ownership.
- `/root/reef_habitat`: recent bounded habitat rendering implementation, completed, no current ownership.
- `/root/reef_hud`: recent accessible responsive HUD implementation, completed, no current ownership.
- `/root/reef_integration`: recent cross-lane App integration, completed, no current ownership.
- `/root/reef_hardening`: recent isolated server, browser, and deterministic acceptance work, completed, no current ownership.
- `/root/reef_review`: recent independent findings-first review, completed, no current ownership.

No child may edit the main checkout during parallel work. Each implementer must create a unique temporary git worktree and branch from the exact base revision. Integration is the only lane permitted to apply accepted commits to main. No active or irrelevant task is contacted or interrupted.

## Shared Coding Contract

- Read `/Volumes/git/weave-agents/AGENTS.md`, `work/high_fidelity_implementation_problem.md`, and this ticket before editing.
- Follow the smallest-viable-diff contract. Reuse existing dependencies and surfaces. Remove superseded paths when safe.
- Generated prose must not use em dashes.
- Do not add dependencies, fetch assets, change research sources, or broaden species/lifecycle scope.
- Preserve existing mass ledgers and current surface availability.
- Commit the lane result and return the complete receipt required by the auto-planner skill.

## Tickets

### HF-01: Scene-Sampled Six-Band Optics

- Role: implementer, optical transport specialist.
- Agent: `/root/reef_optics`.
- Dispatch transport: `native_spawned_subagent` continuation.
- Model: inherited.
- Runtime rationale: the prior child authored the existing shader system and can extend it with the least interface risk.
- Worktree: unique temporary worktree from `f723c55e6f7f7d6d16044ed63e2c373775ed8052`.
- Owned files: `src/scene/OpticalTank.tsx`, `src/scene/materials/opticalShaders.ts`, new `src/scene/materials/spectralTransport.ts`, new `src/scene/materials/spectralTransport.test.ts`.
- Exact behavior:
  - Define six fixed bands spanning violet, blue, cyan, green, amber, and red.
  - Apply independent absorption and recombine in display RGB.
  - Render a habitat-only scene target before the main pass, hide the optical group during capture, then sample that texture in the water-surface shader with band-specific refraction offsets.
  - Retain Schlick Fresnel, acrylic transmission, bounded target resolution, disposal, and a procedural fallback if the render target is not ready.
  - Accept optional render settings and telemetry callback without requiring App integration.
  - Spectral diagnostic must visually isolate attenuation bands without changing aquarium state.
- Acceptance: `npm test -- --run src/scene/materials/spectralTransport.test.ts`; `npm run build`.
- Visual proof: deferred to HF-05 and HF-07 because isolated ownership cannot mount controls.
- Surprise triggers: recursive render, black target, WebGL target leak, interface break, or material transparency ordering regression. Stop and report rather than changing scene/habitat/HUD files.

### HF-02: Reduced-Order Incompressible Flow Solver

- Role: implementer, numerical simulation specialist.
- Agent: `/root/reef_simulation`.
- Dispatch transport: `native_spawned_subagent` continuation.
- Model: inherited.
- Runtime rationale: the prior child owns deterministic simulation reasoning and regression safety.
- Worktree: unique temporary worktree from the base revision.
- Owned files: new `src/sim/flowField.ts`, new `src/sim/flowField.test.ts`.
- Exact behavior:
  - Implement a deterministic rectangular two-dimensional velocity and pressure field.
  - Use semi-Lagrangian velocity advection, bounded pump forcing, wall boundary enforcement, divergence calculation, Jacobi pressure solve, and projection.
  - Expose create, step, sample, diagnose, and scalar estimate functions.
  - Use meters and seconds at the public boundary. Document grid coordinates and truth limits.
  - Balanced default is at least 24 by 12 with at least 10 pressure iterations. Cinematic supports at least 32 by 16 with at least 18 iterations.
  - Long-run values must remain finite and bounded. Projection must materially reduce divergence in a discriminating fixture.
- Acceptance: `npm test -- --run src/sim/flowField.test.ts`; `npm run build`.
- Visual proof: not applicable to the standalone numerical module.
- Surprise triggers: unstable advection, projection increases divergence, nondeterminism, typed-array aliasing across state creation, or need for a dependency.

### HF-03: Deterministic Procedural PBR Materials

- Role: implementer, habitat material specialist.
- Agent: `/root/reef_habitat`.
- Dispatch transport: `native_spawned_subagent` continuation.
- Model: inherited.
- Runtime rationale: the prior child authored the current rock, sand, coral, and particle habitat and has recent Three.js material context.
- Worktree: unique temporary worktree from the base revision.
- Owned files: new `src/scene/materials/proceduralMaterials.ts`, new `src/scene/materials/proceduralMaterials.test.ts`.
- Exact behavior:
  - Synthesize seeded scalar fields and reusable Three.js textures for porous reef rock, aragonite sand, and coral tissue.
  - Provide albedo, normal, roughness, and fluorescence or emissive maps where biologically plausible.
  - Use repeat wrapping, correct color-space assignment, bounded texture size, explicit disposal, and no network or filesystem asset dependency.
  - Keep pure field generation testable outside WebGL and deterministic for the same seed.
  - Maps must contain measurable spatial variance and remain within valid channel ranges.
- Acceptance: `npm test -- --run src/scene/materials/proceduralMaterials.test.ts`; `npm run build`.
- Visual proof: deferred to HF-05 and HF-07 because this lane does not mount the maps.
- Surprise triggers: DOM-only import breaks Vitest, texture generation blocks startup, maps are visually periodic at normal camera distance, or added dependency is needed.

### HF-04: Render Controls and Truthful Diagnostics HUD

- Role: implementer, accessible UI specialist.
- Agent: `/root/reef_hud`.
- Dispatch transport: `native_spawned_subagent` continuation.
- Model: inherited.
- Runtime rationale: the prior child implemented the responsive accessible HUD and can preserve its interaction model.
- Worktree: unique temporary worktree from the base revision.
- Owned files: `src/contracts.ts`, `src/ui/ReefHUD.tsx`, `src/styles.css`.
- Exact behavior:
  - Add the locked `ReefRenderSettings` and `ReefRenderTelemetry` types.
  - Extend scene and HUD props with optional settings, telemetry, and callbacks so the standalone lane still builds.
  - Add keyboard-accessible quality and diagnostic controls with balanced, cinematic, beauty, spectral, and flow labels.
  - Display six-band, render-scale, chromatic-spread, grid, speed, shear, low-flow, divergence, and pressure-residual telemetry in a compact disclosure or diagnostic panel.
  - Replace the old local-circulation-proxy wording with the exact reduced-order solver truth boundary, while retaining the path-tracing disclaimer.
  - Preserve mobile and short-wide internal scrolling and existing control access.
- Acceptance: `npm run build`; existing `npm test -- --run`.
- Visual proof: deferred to HF-07 after App wiring.
- Surprise triggers: props become required before integration, any existing control becomes unreachable, namespace truth text is weakened, or styles require a new UI dependency.

### HF-06: Biological Flow Coupling

- Role: implementer, numerical simulation specialist.
- Agent: continue `/root/reef_simulation` after accepted HF-02 receipt.
- Dispatch transport: same `native_spawned_subagent` continuation.
- Model: inherited.
- Dependency: HF-02 accepted.
- Worktree: continue the HF-02 worktree and branch.
- Owned files: `src/sim/reefSimulation.ts`, `src/sim/reefSimulation.test.ts`, plus its already-owned HF-02 files.
- Exact behavior:
  - Reuse the scalar estimate from the flow module for aggregate low-flow fraction, mean speed, and shear.
  - Make polyp extension favor a bounded moderate-flow window and decrease under near-stagnant or extreme shear conditions.
  - Make cyanobacteria pressure increase with low-flow fraction while preserving nutrient, maturity, and phase causality.
  - Preserve all mass-ledger equations, lifecycle stocking gates, feeding behavior, ATO, and existing phase previews.
  - Add discriminating tests that compare low, moderate, and high flow without relying on fragile exact snapshots.
- Acceptance: `npm test -- --run`; `npm run build`.
- Visual proof: deferred to HF-07.
- Surprise triggers: any chemistry mass balance changes, lifecycle regression, the moderate-flow optimum cannot be observed, or test runtime materially increases.

### HF-05: Integrated High-Fidelity Playable Surface

- Role: implementer, integration specialist.
- Agent: `/root/reef_integration`.
- Dispatch transport: `native_spawned_subagent` continuation.
- Model: inherited.
- Runtime rationale: the prior child integrated the existing product and has the narrowest recent cross-surface context.
- Dependencies: accepted HF-01 through HF-04 commits, then accepted HF-06 commit before final receipt.
- Workspace: main checkout `/Volumes/git/games/reef`, only after parallel implementers have committed and exited their edits.
- Owned files: `src/App.tsx`, `src/scene/ReefScene.tsx`, `src/scene/ReefHabitat.tsx`, and integration-only conflict resolution in files already changed by accepted commits.
- Exact behavior:
  - Apply accepted commits in dependency-safe order without flattening authorship.
  - Store render settings and throttled telemetry in App, pass settings through scene, and pass telemetry to HUD.
  - Instantiate one flow field per quality profile, step it using bounded real-time delta and equipment flow power, and reuse its local samples for suspended particles, detritus cues, coral branches, and polyp motion.
  - Mount procedural rock, sand, and coral maps with explicit disposal and no remount leak when only diagnostic view changes.
  - Mount scene-sampled optics and flow-vector diagnostics. Beauty remains the default.
  - Preserve camera parallax, low-water actor bounds, lifecycle visuals, loading fallback, and all existing interactions.
  - Serve on a new isolated port and prove one canvas, visible habitat, visible HUD, working pause and diagnostic controls, no blocking overlay, and zero console errors.
- Acceptance: `npm test -- --run`; `npm run build`; isolated Vite server HTTP 200; minimal browser smoke.
- Required milestone receipt: `SURFACE_READY` with revision and isolated URL, followed by `final_complete` only after HF-06 is incorporated and all acceptance commands pass.
- Surprise triggers: accepted commit conflict changes behavior, render target becomes black, frame loop stalls, telemetry causes render churn, context loss, or 4177 becomes unavailable.

### HF-07: Revision-Bound Browser Acceptance

- Role: hardening and UI acceptance specialist.
- Agent: `/root/reef_hardening`.
- Dispatch transport: `native_spawned_subagent` continuation.
- Model: inherited.
- Dependency: HF-05 final integrated revision.
- Owned files: new evidence only under `work/ui-evidence/` and optional new browser-proof markdown there. No production code edits.
- Exact journey:
  - Baseline desktop beauty in balanced mode.
  - Switch to cinematic and confirm telemetry changes without chemistry changes.
  - Switch to spectral and flow views and confirm each canvas changes visibly with truthful labels.
  - Change flow low, moderate, and high, observe telemetry and coral or particles responding.
  - Feed stocked fish, disable ATO under accelerated time, observe evaporation and salinity rise, re-enable or refill ATO, and confirm recovery remains finite.
  - Preview fishless and stocked lifecycle states.
  - Repeat essential control access at 390 by 844 and 1280 by 500.
  - Record one canvas, overlays, alerts, console errors, warnings, required request failures, server HTTP, current revision, screenshots, and hashes.
- Acceptance: no console error, no required request failure, no blocking overlay, all essential controls accessible, stable surface remains HTTP 200.
- Surprise triggers: any crash, black tank, numerical NaN, diagnostic control mismatch, chemistry state mutates from render settings, or evidence revision differs from served revision.

### HF-08: Independent Findings-First Review

- Role: reviewer only.
- Agent: `/root/reef_review`.
- Dispatch transport: `native_spawned_subagent` continuation.
- Model: inherited.
- Dependency: HF-05 revision and HF-07 receipt.
- Scope: read-only review of integrated diff, tests, evidence, and live isolated surface.
- Required findings:
  - Correctness and honesty of scene sampling, spectral band recombination, solver projection, boundary behavior, biological coupling, material lifecycle, and HUD labels.
  - Regression protection for evaporation, ATO, S_eq, nutrient ledgers, lifecycle, feeding, low-water rendering, and namespace separation.
  - Smallest viable diff, dependency, resource disposal, performance, accessibility, and responsive risks.
- Acceptance: GO only with no blocker or high-severity finding. Return file and line references, required-behavior pass/fail, SVD pass/fail, residual risks, testing gaps, and reviewed revision.
- Production edits: forbidden.

## Conditional Repair Tickets

### HF-R1: Optics Repair

Activate only when HF-05, HF-07, or HF-08 records a blocking black target, recursive render, band transport mismatch, framebuffer leak, or optical truth-label defect. Owner is `/root/reef_optics`; scope is HF-01 owned files only. Acceptance repeats HF-01 tests, full tests, build, and the failing browser journey.

### HF-R2: Flow or Biology Repair

Activate only when a receipt records numerical instability, insufficient projection, boundary violation, NaN, telemetry mismatch, or incorrect polyp/cyanobacteria flow response. Owner is `/root/reef_simulation`; scope is HF-02 and HF-06 owned files only. Acceptance repeats all simulation tests, build, and the failing flow journey.

### HF-R3: Habitat Material or Coupling Repair

Activate only when a receipt records missing maps, texture leak, visible material failure, actor boundary regression, or local flow motion mismatch. Owner is `/root/reef_habitat`; scope is procedural-material files and `src/scene/ReefHabitat.tsx`. Acceptance repeats material tests, full tests, build, and the failing viewport.

### HF-R4: HUD or Integration Repair

Activate only when a receipt records inaccessible render controls, responsive overflow, render-setting chemistry mutation, telemetry render churn, App wiring defect, or accepted-commit integration regression. Owner is `/root/reef_integration`, with `/root/reef_hud` used only for HUD-owned files. Scope is `src/App.tsx`, `src/scene/ReefScene.tsx`, HUD-owned files, and exact conflict regions. Acceptance repeats full tests, build, desktop, mobile, and short-wide smoke.

No conditional repair may change research packets, add dependencies, broaden species scope, or alter the truth boundary. Any finding outside these predicates returns the pack to planner mode.

## Receipt and Closure Contract

Each implementer receipt must include commit, branch/worktree, exact changed files, added/deleted lines, reuse scan, alternative analysis, deletion pass, tripwires, key diff excerpt, command outputs, visual applicability, out-of-scope disposition, native child ID, inherited model, local runtime, continued session, no fallback, and candidate merge unit.

HF-07 must return revision-bound screenshot artifacts, hashes, exact journey, input values, console and request status. HF-08 must return a findings-first GO or NO-GO receipt.

No finisher lane is included because the user did not request a PR or release package. After HF-08, the top-level planner performs Phase 4 coverage reconciliation against the original request, the goal contract, accepted lane receipts, and current revision. If any required observation is stale or absent, it activates the exact repair ticket or returns to planner mode.
