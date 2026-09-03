# James PR #7 convergence ledger

This ledger records a behavior-level reconciliation. It is not a merge receipt.

- UG-06 base: `3e377ada1ffd9f790468d8e9988cf3a14189884a`
- PR ref: `refs/pull/7/head`
- Immutable PR head: `143461e2a29e353d9adaa5804b64e3e36d87c6af`
- PR parent: `8d2b859267b630093cb24c9d2e57f34f262191ab`
- PR merge base with `origin/main`: `1dc9c8cba23c23bd1117419f3c544dfd71bae458`
- Reconciliation rule: preserve the newer UG-06 specimen studio, root mechanics authority, one contact driver, and Fable-owned asset paths.

## Required behavior parity

| PR #7 behavior | Classification | Integrated result |
|---|---|---|
| Fish clear the rendered live-rock volumes | integrated equivalent in 3D | `reefLayout.ts` is now shared by `ReefHabitat.tsx` and `SpecimenFish.tsx`; four collision passes enforce padded ellipsoid clearance without replacing the accepted fish renderer. |
| Brighter balanced aquarium exposure | integrated exact | PR #7 exposure, hemisphere, directional fill, and point-fill values are applied in `ReefScene.tsx`. |
| Irregular tumbling food flakes | integrated equivalent in 3D | Existing root food IDs and one contact driver are preserved; each root portion renders as a deterministic three-flake tumbling cluster and settles when root state says it is sunk. |
| Hunger-aware fair portion assignment | integrated equivalent in 3D | Each live compatible fish receives one assigned portion before repeats, ordered by hunger and then distance and ID. Both pursuit and contact use the same assignment. |
| HUD count of fish still needing food | integrated exact | The authoritative resident projection drives a visible `Still need food` count using PR #7's hunger threshold. |
| Dry first run and real nitrogen-cycle tutorial | integrated equivalent in 3D | UG-06 already creates an unfilled root reef and restores existing saves. The HUD now projects root ammonia, nitrite, nitrate, colony strength, guide actions, and a confirmed dry-reef reset. No separate tutorial state was added. |

## Changed-file parity

| File changed by PR #7 | Classification | Disposition |
|---|---|---|
| `.github/workflows/pages.yml` | intentionally superseded with reason | Deployment topology is outside this mechanics lane. The current PR will be validated before release workflow policy changes. |
| `docs/THREE_D_MAIN_GAME_TICKET_PACK.md` | intentionally superseded with reason | The active auto-planner ticket pack is the revision-bound planning authority. PR planning history is not product behavior. |
| `js/data.js` | integrated equivalent in 3D | UG-06 already contains `CONSUME_FOOD`, stable food IDs, and the stronger `DATA.resolveSpecies` contract. |
| `js/sim.js` | integrated equivalent in 3D | UG-06 already owns falling food, decay, save sanitation, compatible contact consumption, dry setup, and real nitrification. The stronger profile-aware lookup remains. |
| `realistic_light_transport/src/App.tsx` | integrated equivalent in 3D | UG-06 already defaults to new or restored root state, gates showcase by query, saves, advances, and passes one dispatcher into scene and HUD. |
| `realistic_light_transport/src/integration/pocketAquariumBridge.ts` | integrated equivalent in 3D | Existing typed guide, tested-water, selection, clutch, runtime-profile, food, and save projections remain. PR #7 cycle fields were added without reverting these newer contracts. |
| `realistic_light_transport/src/integration/pocketFeeding.test.ts` | intentionally superseded with reason | Test additions are prohibited until UG-07 and UG-08 hardening. Existing tests were run unchanged in this lane. |
| `realistic_light_transport/src/integration/pocketGameController.ts` | intentionally superseded with reason | UG-06 `App.tsx` already provides the same single root-state owner and save loop without adding a parallel controller abstraction. |
| `realistic_light_transport/src/scene/ReefHabitat.tsx` | integrated exact | The local rock generator was replaced by the shared PR #7 layout, preserving every rendered transform. |
| `realistic_light_transport/src/scene/ReefScene.tsx` | integrated exact | PR #7 balanced exposure and fill-light values are applied. |
| `realistic_light_transport/src/scene/SpecimenFish.tsx` | integrated equivalent in 3D | Fair targeting, flake visuals, and hardscape clearance were adapted around the newer accepted Ocellaris, morphology overlay, and exactly-once `foodContact.ts` driver. |
| `realistic_light_transport/src/scene/feeding.ts` | historical deletion rejected | Adding this provider would create a second food contact and scene mapping authority. The newer `foodContact.ts` path remains the only driver. |
| `realistic_light_transport/src/scene/reefLayout.ts` | integrated exact | Shared deterministic rock transforms were added at the renderer and collision seam. |
| `realistic_light_transport/src/scene/specimens/RiggedSpecimen.tsx` | intentionally superseded with reason | The accepted asset animation contract remains unchanged. Per-fish travel already follows assigned food; changing rig props would collide with asset work without being required for feeding correctness. |
| `realistic_light_transport/src/styles.css` | integrated equivalent in 3D | Existing mechanics HUD styles remain; only the compact nitrogen-cycle visualization was added. |
| `realistic_light_transport/src/ui/PocketGameHUD.tsx` | integrated equivalent in 3D | New cycle teaching, meal-demand count, and dry reset were added to the newer tested-water, store, inspector, breeding, ATO, and optics HUD. |
| `realistic_light_transport/vite.config.ts` | intentionally superseded with reason | Relative GitHub Pages base and workflow release changes are coupled deployment policy, not a mechanics requirement. The specimen studio service remains registered. |
| `tests/sim.test.js` | intentionally superseded with reason | This lane cannot add or rewrite tests. Root hardening owns conversion of the stale pre-contact feeding assertion. |

## Historical deletions rejected

The PR branch predates the accepted specimen-profile compiler, editor, workbench geometry tools, Ocellaris profile package, and shared session guide. The reconciliation never applied its tree-level deletions. These newer paths remain byte-for-byte outside this lane's declared behavior owners.

## Validation notes

- `npm run build`: passed.
- `npm test -- --run`: 4 files and 25 tests passed.
- Root dry-cycle probe: a fresh reef started with `levelL = 0` and `filled = false`; its authoritative guide advanced through `fill_tank`, `start_life_support`, `start_fishless_cycle`, `inoculate_filter`, and `test_cycle`; ammonia, nitrite, and nitrate each rose in sequence before root state reached `Cycled`.
- `node tests/sim.test.js`: 212 passed and one known stale pre-contact assertion failed. UG-07 owns that assertion update; production contact behavior is unchanged.
- Ports: 4184 serves this worktree and 4183 remained HTTP 200.
- Visible browser smoke could not run after two browser-connection failures, so no visual acceptance is claimed in this lane.
