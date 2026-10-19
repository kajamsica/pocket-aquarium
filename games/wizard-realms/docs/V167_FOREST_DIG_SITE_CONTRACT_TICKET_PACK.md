# Ticket Pack: V167 forest dig-site contract discriminator

## Observed failure and decision question

V166 visible UI resumed an equipped-spade Ledger save at two map-marked `temperate_forest` dig-site poses. Bare-looking green ground taps produced checked `Choose dry ground outside the river and wetland` refusals, without an observed hover outline. The two exact-player map positions were x -1.0,z 15.8 m, tile 3,7 and x -6.4,z 14.8 m, tile 1,7. These are player positions, not tapped world-cell coordinates. The screenshots and action log are in `/private/tmp/v166-dig-target-dC46e6/V166_A_RECEIPT.md`. No stone was recovered. Determine whether the marked dig-site neighborhood actually contains any revealed, dry, unoccupied, stable, in-reach cell that the player could target; then decide whether the owner is map clue, visual material, picker/raycast, or checked terrain rules. Do not infer a tapped world cell from a screen pixel without a recorded camera transform.

One source-only diagnostic lane is the smallest safe next action. Do not reopen a browser until it identifies a falsifiable visible retry. The renderer is closed and 5194/5195 must remain available. No source, save, test or GitHub edits, no direct profile access, no production deployment, no authoring a fixture to make the quest pass.

## V167-A: read-only neighborhood audit

Role `reviewer` ONLY, native reused source-audit child, inherited model. Read V166 receipt and current V36 map/terrain/biome, dig target, ground-surface and generated dig-site code. Using the two UI-visible player positions, inspect or run bounded pure read-only terrain classification for the cell at each player pose and the smallest neighboring cell set plausibly within 5 m. Report for each cell: visible map label, dry/wet/depth status, source biome/stream classification, occupancy/protection gate if known, and whether a terrain target should exist on a clear surface. Do not inspect or mutate IndexedDB/profile state. The report must distinguish exact checked domain eligibility from map labels and rendering appearance. If pure generation needs a seed not known from visible UI, state that limit and provide source-logic conditional findings rather than inventing one.

Inspect whether the `V26TerrainPicker` source mismatch from V166-B can explain a missing outline on otherwise eligible terrain, and whether the checked wetland refusal implies the tap hit a different cell. State the smallest independently reproducible owner and a visual retry that would falsify it. No browser, no source/test/docs edits, no hidden source coordinates sent to the browser worker. Return a concise file-and-line zero-diff receipt.

## Primary decision

If the generated marked dig-site neighborhood has no legal ground, authorize a smallest-owner map/terrain affordance repair and identical-entrypoint UI retry. If legal ground exists but its rays can be intercepted by decorative scenery, authorize a narrow picker/layer repair with a regression test and identical-entrypoint UI retry. If neither is established, issue one more focused visible targeting probe, not a broad quest rerun. Retain the release-mode and RAM safety boundary. Full-game goal remains active.

## V167-A source receipt and decision

**Confirmed seed-independent contract mismatch.** At the two UI-visible poses, every canonical cell center within 5 m is raw `marsh/wetland` for every seed. The authored [V16 Greenway tile](/private/tmp/pa-wizard-playable-v2/games/wizard-realms/engine/src/domain/publicWorldV16GreenwaySites.ts) presents rows 3 and 4 as `temperate_forest/loam`; the V17 map marks dig sites there. Yet [V26 checked Dig](/private/tmp/pa-wizard-playable-v2/games/wizard-realms/engine/src/domain/publicWorldV26TerrainAction.ts) and the hover hint read raw `worldTileAtGrid`, so both wet refusal and missing outline are expected. A checked wet refusal proves that tap reached a terrain cell, not merely a decorative mesh. The tapped cell's exact world coordinate cannot be inferred from the screen pixel, but the entire in-reach neighborhood has the same raw wet classification. Source and bounded arithmetic only; no browser, profile, file or GitHub action by A.

**Decision:** GO for a narrow Greenway terrain-authority alignment across terrain tools and hover, with V25 river precedence, streamed-region behavior and save replay preserved. V168 carries the implementation and identical-entrypoint UI retry. The decorative picker hypothesis remains separate.
