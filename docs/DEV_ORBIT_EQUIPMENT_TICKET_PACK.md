# Pocket Aquarium — Live Dev, Orbit, and Reef Equipment Pack

## Understanding artifact

### Original ask

Turn the merged 3D aquarium into a materially richer game now: keep a live aquarium visible while development continues; add a developer god mode so unattended fish do not die; support full 360-degree tank viewing and zoom; add auto feeder, ATO, a separately defined future auto-refill concept, specialized reef equipment, a cleaner store, and clearer Care guidance.

### Aligned problem statement

The aquarium is now a unified 3D product, but the player cannot freely inspect it, development sessions can destroy the tank while nobody is watching, and equipment is mostly catalog text instead of visible, causal automation. The next slice must create observable interaction and progression, not another parallel prototype.

### Goals

1. A dev-only safe/watch mode with a visible on/off control, separate save, and honest would-have-died diagnostics.
2. One-finger/mouse 360-degree orbit and pinch/wheel zoom that coexist with tap-to-feed and tap-to-inspect.
3. Auto feeder and ATO as visible installed devices with understandable schedules/reservoir state, causal simulation effects, and failure/maintenance states.
4. Store and Care surfaces organized around player problems and the equipment that solves them.
5. Keep an exact-revision live dev URL running throughout accepted changes.

### Non-goals

- Do not implement every reef device in one pass. Dosing, skimmer, wavemakers, refugium, reactors, RO/DI, and automatic water changes become later equipment tickets after the feeder/ATO pattern is proven.
- Do not define "auto refilling" as ATO. It remains a separate open product concept.
- Do not fake player-authored aquascaping with a decorative store item. Rock placement, collision-safe editing, pricing, and habitat consequences are a later gameplay system.
- Do not disable chemistry, hunger, stress, aging, ecology, food decay, or diagnostics in dev-safe mode.
- Do not change normal-player mortality or saves.
- Do not replace the authoritative root simulation/controller or add a second aquarium state.

### Constraints

- Exact base is merged `main` at `c81a172ffcfa7e9006d70a67ae745533cc11ae4d`, plus the test-only PWA contract correction on this branch.
- Dev-safe mode defaults off and activates only in a local development build through an explicit query/control.
- Dev mode uses a distinct local-storage key and is always visibly labeled while the dev shell is active.
- Camera gestures must never create food unless the completed gesture qualifies as a tap on water.
- Equipment purchases and automation use the existing catalog, validation, dispatcher, save, and deterministic clock.
- Installed equipment must change both simulation behavior and visible tank hardware/state.
- The running responsive build is the primary acceptance surface. Keep only the narrow automated checks needed to protect save compatibility and authoritative chemistry; do not expand broad UI test scaffolding during active iteration.

### Success criteria

- 4188 hot reload shows each accepted feature without restarting or replacing the stable pre-PR8 4187 comparison.
- In dev mode, an animal that would die stays alive, chemistry/hunger/condition continue changing, and the UI records when/why death was prevented.
- Reloading dev mode never loads or overwrites the normal save; toggling protection does not reset or replace the current tank.
- Drag/orbit supports at least a full horizontal revolution and bounded vertical inspection; pinch/wheel zoom remains bounded; taps still feed/select exactly once.
- Auto feeder follows the game clock, dispenses physical portions through the normal food system, can run empty or overfeed, and exposes schedule/hopper state. A later jam mechanic must be deterministic and inspectable.
- ATO consumes a finite freshwater reservoir to replace evaporation, visibly changes water-level/salinity behavior, and stops when empty.
- Store entries state the problem solved, operating requirement, ongoing resource, and visible/simulation effect.
- Care recommends feeder or ATO only when their actual problem is present and never treats ATO as nitrate removal.

### Open question

- "Auto refilling" needs a separate behavior definition: whether it means refilling the ATO reservoir, producing RO/DI water, or automating water changes. This pack reserves no implementation for it.

### Risks

- A dev flag can leak into production or corrupt the normal save.
- Orbit gestures can break feeding/selection or cause motion sickness on phones.
- Automated feeding can bypass physical contact and recreate the old fake-feeding bug.
- Infinite ATO water erases the salinity/evaporation game; the reservoir must be finite.
- A store redesign can obscure locked reasons or make equipment look cosmetic.

## Order

```text
DEV-01 safe/watch mode
  -> DEV-02 responsive preview harness
    -> VIEW-01 orbit + gesture arbitration
    -> EQ-01 auto feeder + finite ATO vertical slice
      -> UX-01 Store/Care equipment clarity
        -> browser acceptance -> independent review -> PR
```

These tickets are serial because they overlap the app shell, HUD, scene interaction, authoritative bridge, and equipment view model. One implementation owner handles them in order; review is independent.

## DEV-01 — Developer safe/watch mode

### Behavior

- Activate only when `import.meta.env.DEV`, localhost/loopback, and `?dev=1` are all true.
- Use `${pocketSaveKey}:dev-safe-v1`; never read/write the normal key while active.
- Show a compact, repository-native `DEV SAFE ON/OFF` switch in the existing HUD rail with a prevented-death count. It must not permanently overlay the aquarium, brand, objective, or status.
- Toggling protection changes only future death prevention. It does not reset, reload, or replace the current dev tank, and the dev save remains isolated in both states.
- Advance the real simulation normally. If a living animal crosses into death during a tick, capture animal ID/species/cause/day and restore only `alive` plus the smallest nonzero health necessary to continue. Do not rewind water, hunger, condition, age, food, credits, ecology, or time.
- Keep bounded diagnostics and expose repeat prevention honestly as "would have died", not healthy.

### Smallest Viable Diff

- Expected: 3 to 5 production files, 1 to 2 test files, under 260 net lines, zero dependencies/new framework.
- Reuse: `PocketGameController`, `advancePocketState`, current save effect, HUD badge/sheet primitives, and existing deterministic new-game seed.
- Expected files: `App.tsx`, narrow bridge/controller helper, `PocketGameHUD.tsx`, `styles.css`, focused tests.
- Forbidden: root sim mortality rules, root save key, production activation, specimen Studio, native staging.
- Simplify: one mode descriptor and one dev-safe advance path; no general feature-flag framework.
- Validation: focused mode/save/death/toggle-without-reset tests plus all current suites and mobile visual proof that the control does not cover the tank.
- Tripwire: any root simulation edit or normal-save schema change requires replan.

## VIEW-01 — Full tank orbit and gesture arbitration

### Behavior

- Drag horizontally to orbit around the tank through 360 degrees; drag vertically within a safe pitch range.
- Preserve aspect-aware starting framing, bounded pinch/wheel zoom, gentle damping, and a reset-view action.
- A pointer sequence is exactly one of: orbit, pinch/zoom, fish selection, or water tap/feed. Crossing a movement threshold cancels tap/feed.
- On phone, no care/store/water sheet is open by default. The visible aquarium must own the hit surface immediately after launch; opening a sheet is an explicit player action.
- Keep the aquarium and hardware visually coherent from rear/side views; no camera penetration through acrylic or hardscape.

### Smallest Viable Diff

- Expected: 2 to 4 production files, 1 to 2 test files, under 240 net lines, zero dependencies.
- Reuse: existing camera rig in `ReefScene.tsx`, `tankGestures.ts`, R3F pointer events, current pinch latch and feed-on-pointer-up.
- Expected files: `ReefScene.tsx`, `tankGestures.ts`, narrow HUD reset control if needed, focused gesture/camera tests.
- Forbidden: `OrbitControls` in the production tank if it duplicates gesture ownership; feeding controller replacement; scene/layout rewrite.
- Simplify: replace current pointer-look offset with one yaw/pitch camera state rather than layering a second camera controller.
- Validation: full revolution/pitch/zoom math; at 390×844 the initial aquarium point resolves to the canvas; drag adds zero food, tap adds one, pinch adds zero, selection remains reachable.
- Tripwire: shared feeding or authoritative state changes require replan.

## DEV-02 — Live responsive preview harness

### Behavior

- Provide a dedicated dev URL that runs the live aquarium inside a resizable device frame.
- Presets: iPhone portrait, iPhone landscape, tablet, and laptop; custom numeric width/height; rotate; fit-to-window.
- Resizing the frame must not reload or reset the aquarium iframe.
- Display the exact current CSS pixel dimensions and keep the preview controls outside the game viewport.
- Default target is the isolated `/?dev=1` aquarium on the same dev origin.

### Smallest Viable Diff

- Expected: one standalone dev HTML file, under 260 lines, zero dependencies/config/build changes.
- Reuse: current Vite dev server, same-origin iframe, and the existing dark/cyan visual vocabulary; keep styles local to the harness.
- Expected file: `realistic_light_transport/responsive.html` only.
- Forbidden: app/HUD code, production build entry, Vite config, save state, dependency/lockfile changes.
- Validation: open the visible harness; cycle every preset, custom size, rotate, and fit; verify iframe URL and that state survives resizing.
- Tripwire: any production-bundle or app-runtime change requires replan.

## EQ-01 — Auto feeder and finite ATO equipment vertical slice

### Behavior

- Add an auto-feeder equipment category/level through the existing catalog and purchase validation.
- Player configures a simple deterministic cadence and portion count. At scheduled game times it dispatches through the same authoritative food-creation path used by manual feeding, creating visible physical food that must be contacted to nourish fish.
- Track a finite food hopper. It can become empty; a later jam state may be deterministic and inspectable, but no opaque random punishment.
- Make the existing ATO consume a finite freshwater reservoir. Evaporation triggers top-off only while water remains; salinity and water level respond through the existing mass-conserving chemistry.
- Render the installed feeder above the water and the ATO sensor/reservoir/line near the tank. Show dispensing/top-off/empty states.

### Smallest Viable Diff

- Expected: 5 to 8 production files, 2 to 4 test files, under 520 net lines, zero dependencies.
- Reuse: existing equipment catalog, purchase validation, deterministic clock, FEED action/food entities, ATO dilution path, `ReefHabitat`, bridge projection, and HUD controls.
- Expected files: `js/data.js`, `js/sim.js`, bridge/view types, `ReefHabitat.tsx`, `PocketGameHUD.tsx`, styles, focused root/R3F tests.
- Forbidden: direct hunger mutation, infinite reservoir, second food entity, random non-seeded failure, auto-refill/RODI/AWC behavior.
- Simplify: one automation state object in authoritative state; no generic equipment scheduler framework until a second cadence-driven device proves the abstraction.
- Validation: exact schedule/portion/hopper depletion; contact-only nourishment; uneaten decay; finite ATO mass balance and empty stop; save/sanitize/offline determinism; visible device projection.
- Tripwire: new dependency, more than one new scheduler abstraction, or changed manual feeding semantics requires replan.

## UX-01 — Problem-led Store and Care

### Behavior

- Group equipment by the problem it solves: feeding consistency, evaporation/salinity, filtration, temperature, flow, lighting.
- Each card shows device image/icon, installed/locked/recommended state, price, requirement, operating resource, immediate effect, and durable benefit.
- Care links a current problem to an immediate manual action first and an equipment recommendation second. ATO never claims to export nitrate; feeder never claims to fix starvation when its hopper is empty.
- Keep tank visible behind the mobile sheet and keep independent scrolling.

### Smallest Viable Diff

- Expected: 2 to 4 production files, 1 to 2 test files, under 340 net lines, zero dependencies.
- Reuse: current store offers, care recommendations, sheet/dock components, catalog descriptions, recommendation highlighting.
- Expected files: bridge projection, `PocketGameHUD.tsx`, styles, care/store tests.
- Forbidden: new commerce/economy system, full-screen route, duplicate recommendation engine.
- Simplify: enrich existing offer view model and card; no new Store component tree unless current component cannot remain readable.
- Validation: recommendation truth table, locked reasons, installed states, mobile scroll/tank visibility.

## Acceptance and delivery

- Running build first: exercise the real game through the responsive preview at phone, landscape, tablet, and laptop sizes while changes continue hot-reloading.
- Browser capability proof: zero overflow/console errors; dev/prod save isolation; prevented-death event; orbit full turn; responsive pinch and drag; manual and auto food visibly fall, are pursued, and are consumed on mouth contact; hopper empty; ATO reservoir empty; Store/Care clarity.
- Narrow safeguards only: type/build plus save-schema and chemistry invariants where a live visual check cannot expose silent corruption. Avoid broad UI-test expansion while interaction design is changing rapidly.
- Reviewer: Codex CLI read-only, findings-first, verifies exact evidence revision and smallest viable diff.
- Finisher: Claude CLI Opus handles accepted findings, commits, pushes, opens a review-ready PR, and keeps 4188 on the exact head.
