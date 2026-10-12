# V174 quest content plan

Design proposals for one connected Wizard Realms campaign. This document adds no playable quest or reward. Coin, named skill XP, and character XP below are separate, proposed claim grants; existing action XP remains governed by its own checked action. The V36 starter route and its saved rewards are the current foundation, although the full fresh-player campaign and published V36 gate remain open. [Campaign roadmap](QUEST_CAMPAIGN_ROADMAP.md), [reward anchors](V137_QUEST_REWARD_BLUEPRINT.md#current-economy-and-equipment-anchors).

## Rhythm and current route

The opening teaches building a crossing, carrying a useful find home, then using a spell to uncover a cache. Each later beat changes the kind of problem: exploration and a map discovery, a route or trade decision, care for a living companion, a single readable fight, a deeper dungeon choice, then costly ground and aerial travel. A return to a recognizable person or place closes each beat. A quest should present an observable problem, let ordinary world actions solve it, change the player's plan, and leave a saved payoff, rather than add a count-only errand.

The first three chapters are existing V36 content, not new V174 claims:

| Opening chapter | Visible problem, actions, and turn-in | Existing reward and status |
| --- | --- | --- |
| The Surveyor's First Find | The broken creek route leads to a marked Ready bridge and far-bank post. Gather logs, build and cross, then claim at the post. | Basic pick or 35 coins, with existing construction and chopping XP. V171 proved this through normal visible controls on a disposable fresh profile, with a blind-proof caveat. |
| The Outfitters' Ledger | The north ladder and connected-river bridge reveal a survey post and mineable stone; return to Outfitters after excavation. | 50 coins, Traveler Tunic or 85 coins if already owned, and 60 total Wayfinding and character XP across survey and claim. V170 proved the dedicated DEV tester's delivery and reload; this is not full fresh-player proof. The tunic is visible clothing, not protective armor. |
| Beneath the Old Marker | A frontier marker and Wayfinder Glow reveal a cache, then excavation yields a seal for the salvager. | 80 coins and Fen Waders or 230 coins if owned, plus 50 Spellcraft and 50 character XP at claim. V36 checked near-quest fixtures proved reward/save/mobile behavior; an organic fresh-player chapter remains unproven. Waders aid travel but do not mitigate damage. |

## Proposed quests, in campaign order

### The Ringkeeper's Trail: discovery and return

- **Hook and return:** The existing Greenway ring already leads to Mireglass, while a matching symbol on a Highland stone hints at another destination. The Greenway ringkeeper asks what connects them; return there after using a new Highland link in both directions.
- **Actions and twist:** Follow terrain and inscription clues to a new continuous-world Highland ring, discover it on foot, then establish a checked Greenway to Highland link. Travel out and back through that link to prove the return journey; discovering two ring flags alone does not finish the quest.
- **Claim:** Proposed 25 coins, 30 Wayfinding XP, 20 Spellcraft XP, 35 character XP, and a saved two-way Greenway to Highland shortcut. A visible focus can be a later reward only after an accessory slot has a tested purpose. The map shows the new Highland destination and one nearby place worth revisiting.
- **Prerequisites/status:** Checked Greenway to Mireglass ring travel is already shipped in V36, although an organic journey through it remains unproven. The Highland destination, checked new-link and return witnesses, one-time claim and focus effect are planned; the existing link stays intact. No Greenway to Highland shortcut or quest claim is shipped. [V33 checked ring path](../engine/src/domain/publicWorldV33FairyRing.ts#L14-L32), [roadmap](QUEST_CAMPAIGN_ROADMAP.md#L16-L16).

### Highland Signal: optional magic discovery

- **Hook and return:** A dark vane on the dry Quarry Crown trail points to a second vantage. Its wind marks are readable before the player accepts the optional challenge. Return to the Crown marker to record the bearing.
- **Actions and twist:** Study the glyph through normal controls, cast Windward Step on the dry trail, traverse part of that trail under its actual movement effect, and inspect the revealed bearing. A cooldown or step off the dry trail asks for a second attempt without erasing discovery.
- **Claim:** Proposed 30 coins, 35 Spellcraft XP, 35 character XP, and a saved map bearing to a later region. There is no drop. The first map open after claim points to the bearing, and the world landmark remains legible afterward.
- **Prerequisites/status:** V12 contains isolated study/cast/trail rules, but the continuous V36 presentation disables Windward actions. Normal-control study, cast, and movement effect in that continuous world are the prerequisite. The signal then needs a versioned checked vane, cast-effect, vantage and return witness with a one-time claim. None of this quest or its payout is shipped. [V12 rules](../engine/src/domain/publicWorldV12Authority.ts#L164-L209), [continuous disablement](../engine/src/PublicV13WorldView.ts#L97-L100), [V137 brief](V137_QUEST_REWARD_BLUEPRINT.md#1-highland-signal-optional-discovery).

### Windward Waystation: repair or trade

- **Hook and return:** The keeper's washed-out crossing has both a broken brace and a salvager's timber offer in sight. Return to the keeper after crossing the repaired route.
- **Actions and twist:** Spend gathered logs on direct repair, or trade local stone for sound timber and install it. One branch keeps stone; the other saves time gathering logs. Either must make the same saved crossing traversable before claim.
- **Claim:** Proposed 45 coins, 45 Wayfinding XP, 45 character XP, and the usable crossing. The map marks the reopened route and its next reachable site. Construction or trade action XP is separate if those actions award it.
- **Prerequisites/status:** Construction and trade have existing precedents; this site, two checked resource paths, shared completion witness and keeper claim are planned. The crossing is not shipped. [V137 brief](V137_QUEST_REWARD_BLUEPRINT.md#3-windward-waystation-regional-choice).

### The Lost Familiar: care before ownership

- **Hook and return:** Tracks, a disturbed feeding place and a call at dusk lead from the waystation to a sheltered habitat. The stable keeper recognizes the animal when it is safely led home.
- **Actions and twist:** Read tracks, place food and shelter, return for repeated care across actual world time, then guide the animal past a noisy route. A player can spend material on a quiet shelter or take a longer dry path; neither branch grants an instant mount.
- **Claim:** Proposed 25 coins, 40 Creature Care XP, 40 character XP, and a saved companion relationship with a visible care station. The station cue explains the next care action. This relationship may qualify later mount training but is not itself a rideable mount.
- **Prerequisites/status:** Creature simulation, care skill, persistent trust and safe escort are future systems. The quest and every stated grant are planned. [Roadmap](QUEST_CAMPAIGN_ROADMAP.md#L18-L18).

### Iron Hall Watch: the first protective gear

- **Hook and return:** A lit supply door is blocked by one sentry whose windup is visible from a safe alcove. Return to the hall quartermaster with a checked watch token after the encounter.
- **Actions and twist:** Enter on foot, learn the telegraph, avoid or guard a strike, defeat the sentry and recover before leaving. Retreat preserves the contract, and a later attempt has the same guaranteed path to completion.
- **Claim:** Proposed 60 coins, 70 Combat XP, 70 character XP, and a visibly equipped Guard Vest with measured damage mitigation, durability and repair. A cosmetic crest or crafting material from the defeated encounter is an optional bonus only; no random result is needed to turn in the token. The quartermaster points to the next encounter where the vest's protection matters.
- **Prerequisites/status:** Checked player/enemy health, damage, telegraph, recovery, mitigation, durability, repair, Combat skill, unique encounter loot ownership and save/rollback proof are all required. Today's shield slot and Traveler Tunic do not prove armor protection. The quest, vest protection and enemy drop are not shipped. [V137 brief](V137_QUEST_REWARD_BLUEPRINT.md#2-iron-hall-watch-first-combat-contract).

### Iron Hall Depths: later dungeon stakes

- **Hook and return:** A sealed lower door reveals a collapsed safe passage and a guarded direct stair. The same quartermaster receives the recovered hall record after the player exits by a repaired route.
- **Actions and twist:** Choose a material-consuming safe repair or a harder, clearly telegraphed fight, then explore an opened chamber and carry its record out. The record and exit are deterministic; optional encounter loot only changes the bonus.
- **Claim:** Proposed 70 coins, 80 Combat XP, 30 Excavation XP, 90 character XP, and a saved choice of Stoneguard Coat or Galeweave Coat. Both must provide tested protection with distinct physical or magical tradeoffs, durability and repair; neither may be strictly better in every situation. A defeated foe may additionally yield a cosmetic or crafting material under a declared future drop policy. The record opens a map lead toward later travel.
- **Prerequisites/status:** This is a later proposal after Iron Hall Watch, resistance types, gear comparison, checked repair/combat branches, dungeon persistence and unique loot ownership exist. Neither the dungeon nor these items or drops are shipped.

### The Long Road: earn a ground mount

- **Hook and return:** A distant stable has an empty tack rack and a trail with two visible watering points. Return to the stable keeper with a trained animal and a proven route.
- **Actions and twist:** Continue care, learn the ground route, prepare feed and tack, then take a supervised ride. The player chooses a shorter exposed path or a longer sheltered one; keeping the animal well matters more than a single payment.
- **Claim:** Proposed 40 coins, 70 Creature Care XP, 35 Wayfinding XP, 70 character XP, a saved tack recipe and eligibility to purchase and maintain a ground mount. The quest does not give a free mount. The stable displays the future purchase and upkeep cost before commitment.
- **Prerequisites/status:** Mount movement, care, upkeep, tack, safe dismount, route gating and a tested substantial purchase price are required. The mount and quest are planned. Set the mount price after economy playtests so several modest claims cannot erase the cost. [Roadmap](QUEST_CAMPAIGN_ROADMAP.md#L20-L20).

### Stormline Relay: late vertical travel

- **Hook and return:** Broken beacons climb a ridge visible from the ground route. Return to the relay keeper after restoring them and completing an on-foot ascent.
- **Actions and twist:** Repair beacon links, use mastered movement and magic to reach a high station, then choose which branch of the relay network to open first. The player must still discover ground landmarks to use flight meaningfully.
- **Claim:** Proposed 80 coins, 75 Wayfinding XP, 75 Spellcraft XP, 100 character XP, a saved relay route and eligibility for a separately priced flying mount. The relay map points to the first new destination; it does not grant flight instantly.
- **Prerequisites/status:** A high-level connected world, sustained travel economy, vertical routes, flight controls and save/rollback proof are required. This is a late-game proposal only. [Roadmap](QUEST_CAMPAIGN_ROADMAP.md#L21-L21).

## Economy, loot and guidance contract

The early proposed claims are 25 to 60 coins each. A 30-coin discovery can buy 25-coin running boots, while a 45-coin route claim can buy a 40-coin shield or 45-coin wand. One ordinary claim stays below the 150-coin Fen Waders price. The starter Ledger and Old Marker already give larger, checked milestones. Mount purchase and upkeep need their own later balance test, with a substantial cost above early shop gear; no mount price is shipped or fixed here. [Store catalog](../engine/src/domain/generation.ts#L108-L110), [wader price](../engine/src/domain/mireglassExpedition.ts#L24-L29), [V137 anchors](V137_QUEST_REWARD_BLUEPRINT.md#current-economy-and-equipment-anchors).

For each future item claim, the checked writer must detect ownership in inventory, equipped slots and any escrow. A duplicate chooses a declared alternative before the one-time claim saves; it cannot mint a second unique item. V137's extra 150 coins for a duplicate Guard Vest is provisional, not a shipping balance decision until vest shop value and repair cost exist. A full bag must leave the claim available with an explicit free-space prompt, or put the guaranteed item into checked escrow with a visible retrieval point. An optional drop must use one saved roll tied to one authoritative defeated encounter and one ownership record; a retry or reload cannot reroll it. If the bag is full, preserve that result in checked escrow or pending encounter loot. A sold token or material cannot erase a saved completion witness.

The optional crest's illustrative 10% in V137 is a proposal, not a current drop rate or fairness claim. Before a combat release, decide and disclose the encounter's actual probability and pity or no-pity rule, then prove unique ownership, overflow, reload and rollback. Guaranteed armor, record, routes and story access never depend on that roll. Cache finds before checked combat are called finds or materials, not enemy drops. [Roadmap rules](QUEST_CAMPAIGN_ROADMAP.md#rewards-and-drop-rules), [V137 claim gates](V137_QUEST_REWARD_BLUEPRINT.md#claim-and-save-gates-for-implementation).

Each claim should point to its next use in the world and on the map: the Highland bearing to a visible region, the reopened crossing to a reachable site, the care station to a next visit, and the vest to a telegraphed encounter. A short contextual cue appears on first claim and again only when the player approaches the relevant place. After the player opens the bearing, crosses the route, performs care, or equips and survives with the vest, the tutorial cue fades; the durable map/journal record remains. A quest never relies on a menu prompt to replace a missing world landmark.

## Next implementation boundary

Highland Signal is the smallest next quest candidate, but its Windward dependency comes first. Make study, cast and an observable dry-trail movement effect work under normal player controls in the continuous world, with checked authority and persistence across save/reload. Only then add the signal's versioned world witness and one-time 30-coin, 35 Spellcraft-XP, 35 character-XP and map-bearing claim. Acceptance must exercise discovery, study, cast effect, vantage, return, invalid/remote/repeated refusal, migration/reload and the visible reward in the real game. A V12 isolated rule or HUD indicator alone cannot close this gate. [V12 authority](../engine/src/domain/publicWorldV12Authority.ts), [continuous disablement](../engine/src/PublicV13WorldView.ts#L97-L100).
