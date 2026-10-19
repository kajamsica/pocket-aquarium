# V20 direct obstacle aiming pack

## Objective

Make Greenway construction feel like pointing at a place in the world. While Works Bridge or Ladder is active, a short click or tap on the visible creek or north cliff aims the existing ghost at that X position. It does not build. The checked F or Confirm action remains the only way to spend logs and persist a structure.

## Scope and interface

- Reuse `saved-work.aim`, 0.1 m site snapping, the existing checked resolver, material costs, discovery, range, collision, and saved Works state.
- Raycast from the live scene camera through the canvas bounds against only the visible creek water for Bridge or the visible north-cliff fascia for Ladder. Never aim at concealed terrain or by guessing screen coordinates.
- Accept a primary click or touch tap only when pointer displacement is below the orbit threshold. A drag keeps orbit behavior. Ignore secondary buttons, pointer cancellation, lost capture, zero-sized canvas, no hit, map open, Works off or Dig selected, and blocked save state.
- Keep the X slider, Aim at my lane, B/1/2/F, and touch controls as alternatives. Do not auto-confirm, snap the player, or modify a save/schema/domain rule.
- This is only for the current creek and cliff. Arbitrary world-wide obstacle building requires versioned terrain and movement support and is not claimed here.

## Lane and proof

One implementation owner changes `WizardSurface.tsx`, `WizardScene.tsx`, and their focused tests. A separate read-only reviewer checks focus/orbit/camera-picking, discovery, and no material spend. Run focused tests, TypeScript, full suite and build after integration, then one hash-bound single-renderer UI journey alongside the bridge-end retest. Do not create a PR without a new user request.

The implementation may start after the V18 bridge-end repair owner is fixed. Domain movement and controller status have separate owners. If scene picking requires new authoritative geometry or a change beyond these four files, stop and replan.
