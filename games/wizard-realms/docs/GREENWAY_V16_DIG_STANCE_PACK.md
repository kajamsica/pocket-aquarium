# Greenway v16 dig stance usability pack

## Outcome and observed failure

The v16 Greenway route loop must let a player cross a saved bridge, equip a spade on stable far-bank ground, dig a discovered loam patch from a clearly usable adjacent stance, and sell the resulting stone at Outfitters. In the isolated browser journey, the bridge saved and awarded 80 Construction XP. The spade equipped after stepping fully off its deck. Digging then oscillated between `occupied` while standing within the 4 m cell and `too_far` immediately outside the current 3 m reach. The HUD rounds the displayed distance, making the legal 1 m band hard to find. Several nearby highlighted patches also overlap the built bridge's footprint and are legitimately unavailable.

## Scope and fixed contracts

- Change only v16 Greenway dig reach from 3 m to 4 m. Bridge and ladder reach remain 3 m. This widens the legal adjacent stance without letting the player dig the ground directly under their feet.
- Preserve authoritative current-position validation on confirmation, owned equipped spade, backpack-capacity check, discovery, occupancy/overlap rules, terrain support, save history, and earned rewards.
- The preview, map, and HUD must tell the same truth. Dig-only `too_far` copy should say 4 m; bridge and ladder copy should still say 3 m. Explain that the player must stand beside, not on, the marked ground.
- No changes to save schema, generation, bridge/ladder geometry, store prices, or another game's files. No PR, push, branch, or account action in this pack.

## Proposed merge unit and lanes

One cohesive local fix, no PR yet. Domain lane owns `publicWorldV16GreenwayWork.ts` and its focused test. HUD/map copy lane owns `PublicV16WorldView.ts`, `WizardHud.tsx`, `WizardMap.tsx`, and focused view tests only if required. The two lanes must not edit the same file. Main agent integrates, runs typecheck and targeted tests, and repeats the isolated UI dig entrypoint before accepting the pack. The existing dirty worktree must be preserved.

## Acceptance evidence

1. Pure tests prove a far-bank dig from 3 to 4 m away can confirm only when outside its footprint, while a bridge or ladder at the same distance remains `too_far`.
2. The map/HUD wording shows the correct per-kind reach and explains why an occupied patch cannot be dug.
3. The saved bridge remains crossable, and the same UI run can equip a spade, dig an eligible patch, receive one stone and 30 Excavation XP, return to Outfitters, sell the stone, and reload with the route and dig saved.
4. At most one browser renderer remains open during validation. The primary preview stays available at port 5193; testing uses the isolated 5194 origin.

## Replan gate

If a 4 m dig range still leaves no UI-usable far-bank patch, do not broaden silently. Inspect the exact preview rejection and site overlap cause, then create a separate bounded repair unit for site generation or selection. Do not weaken authoritative occupied checks merely to satisfy the test.
