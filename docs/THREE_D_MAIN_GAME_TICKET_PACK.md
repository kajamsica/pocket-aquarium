# Pocket Aquarium — 3D Main Game Adoption

## North star

`realistic_light_transport` is the Pocket Aquarium product surface. The aquarium is a persistent, full-viewport 3D world on phone and desktop. The existing deterministic Pocket Aquarium simulation remains the single source of truth for saved state, chemistry, ecology, livestock, progression, economy, and validation until it is extracted behind the same contract. React Three Fiber renders that truth and sends player actions back through one bidirectional adapter.

The player loop is:

> Observe → diagnose → intervene → watch the physical response → unlock/build → personalize.

## Non-negotiable contracts

- There is one aquarium state, one clock, one wallet, and one action dispatcher. No showcase state or second React-owned game.
- The 3D aquarium is the default runnable/deployable app, not a lab linked beside the root canvas app.
- On mobile, the aquarium remains visible behind compact, dismissible overlays. No full-height fixed panels or clipped stores.
- Player actions have visible physical causes and effects. Feeding is complete only after a fish contacts a pellet.
- Purchases use the authoritative catalog and validation rules and visibly change the 3D habitat when installed or stocked.
- First-run progression begins with an empty habitat and teaches cycling through water chemistry, not button-spam shortcuts.
- Existing deterministic simulation tests remain green. New bridge and scene interaction tests cover every cross-boundary action.

## Pack 3D-01 — Make the 3D app authoritative-facing

### Outcome

Opening Pocket Aquarium launches the Three.js aquarium with the player's real saved tank. The pre-stocked `createPocketReefShowcase` path is workbench/demo-only.

### Work

1. Introduce a `PocketGameController` contract with `getState`, `dispatch`, `subscribe`, `advance`, `load`, and `save` boundaries.
2. Move root persistence semantics behind the controller. Do not duplicate reducer, economy, or validation logic in React.
3. Project the authoritative state into scene and HUD view models.
4. Make the React/Three app the root build and Pages artifact while preserving the asset workbench behind an explicit query/route.
5. Add a migration/fallback for existing root saves and a fresh-start empty reef.

### Acceptance

- Reloading restores the same tank, animals, chemistry, credits, and progression.
- Root and 3D surfaces cannot diverge because only the controller owns mutable state.
- Production build contains the 3D app and required root simulation/assets.

## Pack 3D-02 — Physical feeding vertical slice

### Outcome

Tap the visible water to place food at that horizontal point. A pellet enters at the rendered waterline, sinks under water physics, is pursued by a hungry compatible fish, and nourishes that exact fish only on contact. Uneaten food settles on the visible substrate and decays into nutrients.

### Work

1. Convert pointer coordinates into tank/world coordinates using the active camera and rendered water surface.
2. Dispatch `FEED` with normalized surface coordinates and render pellets from authoritative food entities.
3. Give fish bounded steering: arrival, separation, obstacle/tank avoidance, depth preference, and hunger-weighted food targeting.
4. Detect mouth/pellet contact in the scene and dispatch `CONSUME_FOOD` once with fish and pellet identity.
5. Remove event-log/time heuristics such as `feedPulse`; scene feedback must be driven by food and consumption events.
6. Render surface entry, sinking, substrate settlement, bite, crumbs, and leftover decay without teleporting nutrition.

### Acceptance

- Each valid tank tap creates one visible pellet at the tapped horizontal position.
- Hunger and `lastFedDay` do not improve before contact.
- One contact consumes one pellet once; another fish cannot consume it again.
- An untouched pellet reaches the rendered substrate and eventually increases waste nutrients.
- Tests exercise feed dispatch, projection, contact consumption, and duplicate-contact rejection.

## Pack 3D-03 — Tank-dominant mobile HUD

### Outcome

The phone screen feels like looking into an aquarium. A compact status rail explains the most urgent next action. Care, livestock, store, and journal open as translucent, closeable sheets that never replace the world.

### Work

1. Replace desktop side panels with a responsive HUD shell and bottom tool dock.
2. Keep only the current objective, risk state, credits, and day in the resting HUD; explain score/XP only where it affects an unlock.
3. Use one-sheet-at-a-time overlays with real scrolling, safe areas, drag/close behavior, and landscape constraints.
4. Turn water metrics into grouped status cards: nitrogen cycle, stability, salinity/temperature, light/flow.
5. Make store entries visual and explain both eligibility and the exact physical/simulation effect of a purchase.

### Acceptance

- No horizontal overflow at 320×568, 375×667, 390×844, or 844×390.
- At least 60% of the viewport remains aquarium while a normal sheet is open; sheets can expand deliberately for detail.
- Every overlay scrolls independently without moving or snapping the aquarium.
- Controls meet touch-target and safe-area requirements.

## Pack 3D-04 — Cycling and first progression chapter

### Outcome

A new player commissions an empty reef, watches ammonia become nitrite and nitrate, survives the ugly phase, proves biofilter readiness, and earns the right to add the first compatible animal.

### Work

1. Present one contextual objective at a time in the 3D HUD.
2. Visualize ammonia source, bacterial colonization, haze, diatoms, green film, cyanobacteria, and recovery in the tank.
3. Unlock livestock only after a simulated processing challenge confirms zero ammonia/nitrite within the defined window.
4. Explain why water testing, top-off, and water changes differ and show the causal response after each intervention.
5. Award credits/keeper progression for stable husbandry milestones, not repetitive clicks.

### Acceptance

- The first animal cannot be purchased by merely fast-forwarding or spamming setup actions.
- The player can state what ammonia, nitrite, and nitrate are doing from the HUD and tank response.
- Completion produces a visible, persisted unlock and a clear next choice.

## Pack 3D-05 — Physical habitat growth

### Outcome

Tank upgrades, equipment, livestock growth, coral colonies, and cleanup crews visibly inhabit the same scene and affect the same simulation.

### Work

- Scene registry for tanks, filters, heaters, circulation pumps, lights, ATO, rocks, substrate, livestock, corals, and micro-invertebrates.
- Equipment placement and effects: flow field, PAR distribution, heat, water level, sound/particles, and maintenance state.
- Life-stage geometry/scale/material changes, compatibility behavior, mortality, breeding conditions, offspring, coral polyp extension and colony growth.
- Habitat-specific catalogs and hard salinity/volume/predation gates.

### Acceptance

- Buying or upgrading an item changes both the authoritative model and a visible scene object/effect.
- Growth and lifecycle changes are gradual, persisted, and inspectable.
- Incompatible or undersized stocking is blocked with a concrete ecological reason.

## Execution order and ownership

3D-01 and the minimum of 3D-03 needed for a usable shell come first. 3D-02 is the first complete gameplay proof and the first user-facing preview. 3D-04 follows on the same controller/HUD contract. 3D-05 expands content only after those seams are tested.

Implementation occurs on `codex/3d-main-game`, based on the locally verified combination of PR #5 mechanics and PR #6 renderer. Ben's branch is not modified. The combined proof commit is not merged directly; this branch must earn its own tests, browser evidence, and review.

## First preview gate

The first URL can be surfaced when all of the following are true:

- it opens directly into the Three.js aquarium;
- the aquarium owns the phone viewport;
- tapping water reliably creates a pellet at the correct surface position;
- a rendered fish visibly reaches and consumes that pellet;
- the authoritative fish hunger changes only after that contact;
- reload preserves the result;
- the console is clean and the production build passes.
