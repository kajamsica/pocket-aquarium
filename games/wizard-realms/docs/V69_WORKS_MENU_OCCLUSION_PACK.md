# V69: Works menu occlusion

## Observed failure

The user's narrow portrait screenshot shows the Greenway field objective layered over the expanded Works panel, while the save toast covers the objective. The expanded Works controls remain partly visible, but the text and panel header are occluded. Source review also found that a pending-save button can extend into the Works top edge, and the collapsed route guide can cover its footer at phone width. This is a UI layout failure at the same entrypoint, not a gameplay or save failure.

The first 390×800 browser retry exposed a second, distinct blocker after closing Works: the objective rect was x62..382, y156..303 while the collapsed Works entry rect was x265..382, y250..306. The objective visually covered nearly all of the reopening control. The expanded menu and both save-toast states otherwise passed. The next retry must begin at the same viewport and verify the entry remains visibly discoverable after close, not merely pointer-clickable through the objective.

## Contract

- Keep the expanded Works panel readable and operable in narrow portrait view.
- Keep the field objective available outside Works mode. When Works is expanded, its own instructions can replace the objective rather than stacking the two overlays.
- The collapsed Works entry remains visible and touch-discoverable below or away from the field objective after closing the menu.
- Keep save feedback visible without covering an active menu. Keep the route guide available after Works closes, but do not let it cover Works controls while expanded.
- Preserve desktop and short-landscape behavior, keyboard shortcuts, and the current game/save state.
- Do not change simulation, route geometry, or persistent state.

## Ownership and proof

One implementation lane owns the smallest UI styling change across `engine/src/view/WizardHud.tsx`, `engine/src/PublicV23Controller.tsx` if needed, and the necessary focused test. Independent source review checks selector specificity and responsive behavior. One final real browser journey at the user's narrow portrait width opens Works, checks the toast, guide, and panel, then closes Works to verify the objective and guide return. Reuse a single renderer and close it after proof because of the reported RAM pressure. No GitHub action is authorized.

## Validation receipt

The first browser retry found the collapsed Works entry covered by the restored objective at 390×800. A second source change stacked them in natural flow. The same-path UI retry passed with an exact 8px gap. Subsequent 320×568, 768×1024, and 844×390 checks each exposed a breakpoint-specific overlap and were repaired and retried at the identical saved state. Final visible journeys passed at all four viewports: Works Off visible and hit-testable, Works On readable and closable, objective returning on close. Both pending and saved-only notices were checked at 390×800. The short-landscape objective is touch/wheel scrollable; keyboard scrolling was not proven. Focused WizardHud/WizardSurface tests passed 110/110, TypeScript passed, and whitespace checks passed. The single isolated renderer was closed after proof. Console reported only a favicon 404 and an existing Three.js deprecation warning. No GitHub action was taken.
