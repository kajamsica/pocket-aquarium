# V34 first-valley affordance and cliff silhouette

## Original Ask

The first valley should feel like a coherent place, not a sequence of invisible stops. Trees supply a meaningful ladder or bridge choice, boots improve travel, the river connects across the world, an equipped spade lets the player pick ground and dig for depth- and location-dependent resources, and a trapped player can return home on a 30-minute cooldown.

## Current Truth

V29 already has a connected cross-world river, a four-log north ladder, an eight-log connected-river bridge, a starting axe, a 25g boots purchase, a spade-controlled dig picker, checked strata and saved divots, soil fill, pit ladders, and checked return-home cooldown. The V33 fresh UI journey proved the ladder-to-streamed-world guidance and one visible west rock return. It did not prove every rim segment or the complete dig feedback loop.

The opening primary objective selects the V29 mining branch before the route branch, so a new player is pushed toward buying a spade and pick before understanding the trees, cliff, river, and route choice. A V33 independent review caught and assigned the false V29 full-pack sale sentence to V33 repair. Successful dig toasts name a column, not the material or new depth. Separately, the view mesh of the still-closed north cliff can crest below the higher walkable shelf at the center of the default world seed; the checked collider and the mesh share the same plan-view segment.

## Desired Player Experience

At spawn, the visible objective should tell the player how to act with the axe and why logs matter. It should expose the ladder and bridge as two different route purchases without forcing one order. Boots and digging should read as useful optional actions, not prerequisites for the route. When the player equips a spade, the ground picker and a saved dig result should immediately communicate what happened. A blocked cliff must have a rock face that is visibly above the traversable high side while its ladder aperture remains open after construction.

## Boundaries

- Do not change world topology, checked movement, dig authority, strata, prices, save schema, migrations, or rescue eligibility in this slice.
- Do not turn return-home into an anytime fast-travel button. Its existing trapped-only condition and cooldown are intentional.
- Preserve the first exposed real preview and use exactly one WebGL renderer for UI acceptance. Close the test browser after evidence; keep the preview server running.
- Preserve the dirty worktree, use no GitHub account or Git mutation without a separate request.

## Acceptance

1. Fresh V29 starts with a short action and choice cue for chopping and route building, not a mining-only command. Saved ladder/bridge state advances the cue, and the prior V33 guide/backpack text remains consistent.
2. V33's V29 full-pack sale correction remains intact. V25-V28 historical claims and actions are unchanged.
3. A closed north rim is visible above both adjacent revealed walkable surfaces at representative default-seed cells, including x=0,z=-6, while a saved ladder aperture has no rock faces.
4. One real UI journey checks the fresh objective, one dig action's observed feedback, and the closed cliff before any broader geometry conclusion. If material/depth feedback needs an additional runtime contract, replan rather than inventing a client-side geology result.

## Open Decision

The existing action reply for V29 deep-dig has an empty event list. Showing the exact yielded material and new depth may require reading the checked before/after snapshot or extending a view-only result. That owner and migration risk should be established by an implementer before changing the toast. Until then, the authoritative terrain bag and depth map remain the truthful source.

## UI Journey Findings

The first fresh V29 run exposed conflicting route copy: the field objective called the far connected-river bridge an immediate alternative to the north ladder. The corrected objective distinguishes the optional nearby South creek bridge from the later connected-river crossing. A blocked north-cliff attempt now visibly meets rock and gives a ladder cue.

The same run exposed a store/pace overlay collision. A store-specific stacking rule made Outfitters Close clickable without disabling Walk/Run. The tester then equipped the field spade, selected outlined dry ground, and successfully dug one column. Soil appeared in the bag, Excavation advanced, and a divot rendered. The expanded map initially counted only legacy Works digs and falsely said zero; V29 now reports visible open excavated columns separately. After reload and Resume, the soil, level, spade, divot, and visible count persisted. The exact material and numeric depth are still not in the immediate success toast, and the tester has not validated deeper pick layers or the trapped-only rescue journey.
