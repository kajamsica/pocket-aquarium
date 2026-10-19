# V160 Ledger bank UI probe: understanding

The first chapter of the V36 campaign is proven through its claim. The second chapter, Outfitters' Ledger, has a checked route and reward in source, but an organic browser journey has not yet reached the connected-river Ready bank. V157 stopped at the renderer's 870,400 KiB early RAM guard while following the upper shelf. The screen showed eight logs, a saved north ladder, and the Ledger objective. It did not show a Ready bridge site. This is an unproven player journey, not evidence that the route is impossible.

The full-game goal needs quests that cause exploration, give useful coins and XP, and eventually grant meaningful visible gear. The existing Ledger is the nearest real proof of that loop: gather, construct, travel, survey, return, and claim a visible tunic plus coins and XP. Before adding more campaign chapters, test whether a player can follow its current cues to the river bank under the same RAM safety limit.

Important boundaries:

- Preserve the player's authentic barefoot profile at `/private/tmp/v141b-wizard-profile-20261011`. Use only the dedicated DEV boots-equipped test profile at `/private/tmp/v150-wizard-equipped-tester-profile-20261011`.
- Keep the player preview on port 5194 available. Use the existing port 5195 isolated test preview and only one owned game renderer.
- The prior upper-shelf screenshot includes the correct long Ledger instruction, but the persistent short cue only says to find a Ready bank. A route or UI owner is not established until the identical visible journey is tried.
- V159 proved material Node fake-IndexedDB retention and save-path allocation, not a production browser leak. Do not reduce memory caps, suppress saves, or rewrite the renderer from that result.

Decision sought: from the existing boots-equipped checked state, can the visible game map and cues guide the player down the dry west return to a Ready connected-river bridge site, and can the player build and cross before the guard? If not, capture the first exact block and phase-matched JS heap, WebGL resource counts, renderer/GPU RSS, visible cue and route context. A memory guard is a safety stop, not a gameplay failure. A reproducible collision or missing affordance with bounded ownership may justify a separate minimal repair and identical UI retry.
