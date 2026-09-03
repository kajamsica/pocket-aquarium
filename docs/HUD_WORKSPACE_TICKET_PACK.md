# HUD workspace ticket pack

## Goal

Make the aquarium—not a menu—the permanent play surface. On laptop/desktop, every secondary concern is an independent instrument window the player can arrange around the tank. On phones, the same information remains touch-friendly in one bounded sheet at a time.

Done when the running build lets a player keep multiple useful windows open, move and resize them, minimize or close them, pin selected water readings, recover a bad layout, and return later without changing or corrupting aquarium progress.

## First-principles interaction model

- The tank is the world and never navigates away.
- Water is observation: chemistry, level, nitrogen-cycle evidence, and pinnable readings.
- Care is intervention: diagnosis, water test, immediate actions, automation, dead-resident removal, and breeding status.
- Store is acquisition only: livestock, corals, equipment, tanks, ownership state, price, and purchase rationale.
- View is presentation only: brightness, render quality, diagnostics, and render telemetry.
- Guide is progression: the next lesson and next action, independent of every other window.
- Fish selection is inspection: a compact specimen card opened from the animal itself.

## Pack HUD-01 — Window foundation

Owned files: `realistic_light_transport/src/ui/HudWorkspace.tsx`, `PocketGameHUD.tsx`, and scoped workspace CSS.

- Desktop windows open independently rather than replacing one another.
- Title bars drag with mouse or pointer.
- Windows resize from the native lower-right handle, minimize, close, and return from the dock.
- Position, size, open state, minimized state, and stacking order persist in a UI-only local-storage record.
- Viewport changes clamp windows back into reach.
- View includes a reset-layout escape hatch.
- Mobile keeps a single bottom sheet with large touch targets and no tiny resize affordance.

## Pack HUD-02 — Semantic separation

Owned file: `realistic_light_transport/src/ui/PocketGameHUD.tsx`.

- Move clutches and fry from Store to Care.
- Move optics and flow from Store to View.
- Move guided next step out of Water into Guide.
- Keep Store limited to purchasable catalog offers.
- Keep resident inspection on the fish-selection card.

## Pack HUD-03 — Personal instrumentation

Owned files: workspace controller, Water markup, and scoped CSS.

- Every tested water parameter exposes a Pin control.
- A pinned reading becomes an independent compact desktop window.
- Closing the readout unpins it; pin preferences persist separately from the aquarium.
- The readout carries test freshness so a precise-looking stale number never masquerades as live truth.

## Pack HUD-04 — Store comprehension and ownership

Owned files: store projection/validator, Store markup, and visual catalog assets.

- Filters cover recommended items, equipment, livestock, coral, and tanks.
- Each offer explains price, problem solved, durable effect, and upkeep.
- Installed equipment is disabled and visibly owned.
- Lower tiers cannot replace higher tiers; the authoritative purchase validator rejects the downgrade.
- Next visual pass adds recognizable thumbnails without changing store rules.

## Acceptance surface

Primary proof is the running build in `responsive.html`, not a growing automated-test suite. Exercise laptop and iPhone presets, open several desktop windows at once, drag/resize/minimize/close, pin a reading, reload, reset the layout, and confirm the aquarium save remains intact. Keep only narrow deterministic safeguards for state corruption and chemistry conservation.
