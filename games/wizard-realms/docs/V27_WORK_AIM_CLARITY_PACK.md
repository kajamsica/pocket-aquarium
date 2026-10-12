# V27 Works aim clarity ticket pack

## Observed failure

In a real fresh V27 UI journey, the tester chose a Ready north-cliff ladder at x 1.1. Tapping `Aim at my lane` moved the slider to the avatar's x 0 but removed the selected Ready candidate. The user had to choose Ladder again. The x 0 lane overlaps the separate authored center route, so this is an interface dead end, not a writer failure.

## Outcome and ownership

The convenience button should lead to a discovered candidate instead of silently clearing selection. Keep the exact slider and avatar-facing option for deliberate manual aim. Prefer reusing the projected `savedTerrainWorks.suggestedSites` contract and existing checked preview, not adding an unauthorized build path.

- Owner: `engine/src/view/WizardHud.tsx` and focused `WizardHud.test.ts` only. No domain, controller, save, scene, or entry changes.
- Rename the convenience action to describe its actual behavior, such as `Nearest build site`. Choose the nearest discovered suggested site of the selected kind to the avatar's x. If there is no candidate, disable the button with explicit help instead of dispatching a misleading aim.
- Continue dispatching the existing `saved-work.aim` intent. The writer and preview still decide readiness, clearance, resources, and whether F/Confirm is permitted.
- Preserve historical modes that do not render this control and preserve manual slider/reticle behavior.

## Proof and tripwires

Add a focused test using a V27-like Works projection where avatar x 0 and a Ready ladder site x 1.1: convenience click must aim x 1.1, keep the candidate selected, and never imply it places the authored x 0 route. Cover no suggested site, other work kind, and manual aim controls. Run focused WizardHud tests and TypeScript, then hand off exact diff/test receipt. No browser or GitHub from this lane.

Stop if `suggestedSites` does not distinguish discovered candidate kind or the fix requires changing domain preview semantics. Report rather than widen.
