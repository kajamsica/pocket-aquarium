# V54 unbuilt route previews must not look walkable

## Observed mismatch

V30's unbuilt Works bridge and ladder previews are rendered with a complete, opaque deck or rungs in `WizardScene.tsx`, while checked movement accepts only saved built support IDs. The player can reasonably try to cross a preview and encounter a blocker. The existing HUD mentions preview and Confirm, but the spatial object still looks built. This is a presentation mismatch, not permission to change collision or construction authority.

## Contract

Keep built bridge planks and ladder rungs exactly as they are. For every unbuilt selected Works bridge/ladder, render a clearly non-physical placement guide: thin translucent or wireframe rails/outline, no opaque full deck and no complete solid rung set. Blocked previews remain visibly distinct. Starter cliff and saved/connected-river Works previews should use the same ghost language. Preserve discovery clipping, placement geometry, Ready/blocked verdict, scene picking, built support, and save behavior. Add a short selected-preview caption such as “Placement preview only. Confirm to build before crossing or climbing.” Do not show it for a built structure or when Works is closed.

## Units and ownership

- A, scene presentation: `view/WizardScene.tsx` only. Reuse existing geometry and constants; at most two preview-only materials or a local helper. Do not edit domain, movement, persistence, store, or unrelated route graphics. Keep built meshes unchanged.
- B, focused tests: `view/WizardScene.test.ts`, `view/WizardSceneV23.test.ts`, and if needed `view/WizardHud.test.ts` only. Prove selected preview lacks a walkable-looking full deck/complete opaque rung set, blocked guide differs, built geometry remains intact, discovery still gates preview, and HUD caption is conditional. Do not edit production.
- C, coordinator: run focused tests, TypeScript, production build, independent view review, then one isolated UI comparison on fresh V30. Select a ready ladder/bridge without confirming and inspect the ghost, then confirm and inspect the physical built structure. Close the browser. No second renderer. If a visual failure is observed, use one small causal repair and repeat the identical entrypoint.

## Guardrails

No new save version, witness, dependencies, or asset pipeline. Keep V29/V30 behavior and every built geometry unchanged. The ghost is not a promise of traversability. Avoid broad HUD redesign. The current V52 performance trace is complete and its browser is closed, so source edits may begin. This pack does not claim the perceptual UI proof has passed.

## Result

The V30 fresh north-cliff journey passed in one isolated browser: two oak Chops gave four logs, Works Ladder aimed at x 1.1 m, z -4 m, and the Ready unbuilt guide appeared as thin translucent wireframe rails with no opaque rungs. The conditional caption was visible. [Unbuilt screenshot](/var/folders/p2/6p9p9mhx1hv3s88f1rs0w9c40000gp/T/wizard-v54q.kErT1n3qpL/.playwright-cli/page-2026-10-10T10-47-25-139Z.png). Confirm spent four logs and replaced the guide with physical brown rails and rungs; W 500 ms plus W 1,200 ms climbed to the upper shelf and updated the objective. [Built screenshot](/var/folders/p2/6p9p9mhx1hv3s88f1rs0w9c40000gp/T/wizard-v54q.kErT1n3qpL/.playwright-cli/page-2026-10-10T10-48-30-761Z.png). The sole browser was closed. Scene 76/76 and HUD 31/31 focused tests, TypeScript, and production build passed. Bridge and older Mireglass ghost appearance have source/test checks but were not visually inspected in this UI run.
