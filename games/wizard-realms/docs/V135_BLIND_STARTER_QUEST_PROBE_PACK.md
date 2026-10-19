# V135 blind starter-quest probe

## Goal and evidence boundary

The full Wizard Realms goal includes a coherent, fun quest campaign with coin, XP, useful visible gear, and eventually combat armor and drops. V134 proved only New Game, one ring discovery, reload and Continue. V133's Old Marker reward test began from a checked synthetic near-quest history. Neither proves that a new player can infer the first chapter, follow the world, finish it, and understand the payoff.

This ticket is an early evidence probe, not a new quest implementation. Start from an empty profile at the latest V36 UI, play through normal visible controls without direct state setup, and find the first actual confusing dead end or bug. The player should see what to do with chopped logs, how to find/build the first route, and why returning to a character or post matters. A quest must offer a world-visible problem, clue, meaningful action, and saved payoff. The [quest campaign roadmap](QUEST_CAMPAIGN_ROADMAP.md) records the later armor/drop design; no combat loot is claimed present.

## Contract and guardrails

- Single disposable browser at `http://127.0.0.1:5195/?publicWorld=v36`, one renderer, desktop 1280 by 720. Leave the user-facing 5194 preview and all its saves untouched.
- Before rendering, self-test an RSS sampler on a known PID and arm a continuous page-renderer guard. Early stop at 870400 KiB; hard stop below 1024000 KiB. Close browser and guard on completion, blocker or stop.
- Begin with no Wizard IndexedDB/local storage. Click New Game. Use only on-screen cues, mouse, keyboard, map and journal that a normal player could use. No source-derived waypoints, direct API/storage mutation, synthetic fixtures, god-mode controls, console commands, or multiple browser tabs.
- Seek the first complete named quest turn-in if it is naturally possible within 15 minutes of active interaction. Record each clue/action, confusion, dead end, reward and persistence after reload. Do not brute-force against unclear guidance. If the first repeatable product blocker appears, stop there and capture exact visible error plus console/network/trace evidence.
- An early source or unit-test pass cannot substitute for the UI. A completed reward from an injected save cannot substitute for a fresh-player journey. The probe says what is passed and what remains unproven.

## Lane P1: one browser reviewer

Role `reviewer` only. Read `test-from-ui`, its generic UI reference and `playwright` completely. Use the fixed contract above. Capture screenshots of New Game, opening objective, relevant route/journal cues, first blocker or turn-in, and checked save after reload if a turn-in succeeds. Include exact action trace, console and network health, renderer guard peak, and whether the first quest was fun/legible as a player rather than only mechanically possible. Return `pass`, `product_blocker`, or `environment_blocked` with first owner hypothesis. No code/docs edits, Git or GitHub action.

## Next decision

If P1 finds a bounded product defect, follow the observed-failure loop: evidence, smallest owner, HMR/restart only affected component, identical UI retry. If the first quest completes, schedule the same blind journey through the next chapter and inspect reward cadence before implementing new content. Preserve V134 acceptance and the 5194 preview. This ticket does not close the full-game, long-session, combat, mounts, or market gates.

## P1 result and bounded journal repair

P1 naturally equipped the axe, chopped eight logs, found and built a Ready creek bridge, then reached its deck. The isolated browser was stopped by the functioning RSS guard at 878672 KiB before reaching the surveyor's post. The reward and persistence are unproven; V136 investigates the memory phase before another long playtest.

The same first-glance UI showed a separate, concrete guidance defect: an incomplete `The Surveyor's First Find` was buried in `Rewards and earlier quest` while the primary card displayed locked `Outfitters' Ledger`. The journal should prioritize the earliest incomplete named chapter. A bounded `WizardHud.tsx` and focused HUD-test repair should make Surveyor primary until claimed, then Ledger, then Old Marker, without changing quest authority or reward state. Use the existing V34/V35/V36 projected facts, not a new UI progress flag. A later one-browser retry can verify the visible order while collecting the memory discriminator, without opening an extra renderer.

The bounded HUD repair and its one focused ordering test passed; TypeScript passed. The full older HUD test file still has 13 pre-existing `Invalid hook call` failures because those tests invoke a hook-using component as a plain function. That test-harness debt was not expanded into this quest ticket. V136's later guarded browser run confirmed Surveyor is the primary fresh-start chapter and, after its checked claim and reload, Ledger becomes primary.

That same normal-UI run completed the first quest: axe equipped, eight logs chopped, Ready creek bridge built, far-bank River Works post reached, basic pick claimed, and V36 save #18 reloaded with the pick and Ledger objective preserved. Renderer peak was 727120 KiB under the 870400 KiB early stop, with natural idle recovery; browser and guard closed. This passes one paced fresh-player starter chapter, not an unpaced long session or the Old Marker chapter. The initial unpaced V135 guard crossing remains a real user-experience/performance concern.
