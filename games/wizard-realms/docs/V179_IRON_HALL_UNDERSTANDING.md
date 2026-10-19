# V179 Iron Hall understanding

## Original ask and north star

The player wants fun quests that pay meaningful coins and XP, with good armor and enemy drops in the spirit of an RPG campaign. This is part of the active full-game goal: a connected roughly 2 km wizard world with persistent discovery, magic, skills, routes, trade, visible gear, mounts and an endgame. This milestone is not the full game.

## Input specs and current reality

- `QUEST_CAMPAIGN_ROADMAP.md`, `V174_QUEST_CONTENT_PLAN.md` and `V137_QUEST_REWARD_BLUEPRINT.md` define Iron Hall Watch as the first dangerous contract: readable windup, avoidance or guard, recovery, a saved return, 60 coins, 70 Combat XP, 70 character XP, a protective Guard Vest, and an optional cosmetic drop. Those documents are proposals, not shipped features.
- V40 already offers a two-path repaired river crossing and a separate checked save. The canonical crossing reaches dry terrain at `(80, 24)`. Read-only probes for both `wizard-realms` and `greenway-alpha` show loam, terrain-supported cells at `(80, 28)`, `(84, 32)` and `(84, 36)`; the V25 river predicate is false there. This branch of the connected world is a plausible hall approach, pending full movement and visual proof.
- Existing equipment includes a visual Traveler Tunic and a wooden shield, but `PlayerState` has no player health, Combat skill, incoming damage, armor mitigation, durability or encounter loot. The old exact save schemas cannot silently accept those fields. The avatar is currently procedural; the approved character workbench is a separate asset-development precedent.
- A fresh V40 browser smoke on one temporary tab passed New Game, axe equip, normal oak interaction, eight logs, skill XP and Works discovery with zero console errors. It did not reach the Waystation crossing or prove Iron Hall. That tab was closed to respect the one-renderer RAM constraint.

## Aligned problem statement

Build the first honest combat chapter on a reachable branch beyond the Waystation. The player sees an Iron Hall ward's attack tell, learns a basic wizard strike from a world clue, avoids or guards a blow through normal controls, defeats the ward, recovers if hurt, and returns to a recognizable quartermaster. The checked claim grants separate coin, character XP and Combat XP plus a visibly equipped Guard Vest that measurably reduces future damage and can be repaired. An optional cosmetic crest is determined once from the defeated encounter, never gates the quest and cannot be rerolled by reload. The complete path must survive save/resume without corrupting V40.

## Goals and success criteria

- A single continuous-world hall site and quest cues are reachable after the saved Waystation bridge, not a teleporting square or separate combat menu.
- An authoritative, deterministic combat model owns health, telegraph timing, damage, dodge/guard, recovery, a learned wizard strike, defeat, and once-only loot ownership. Invalid or remote actions cannot mint combat outcomes.
- A versioned V41 save copies V40 only by an explicit checked choice, leaves V40 read-only, replays movement and inherited actions, and retains combat/reward state through reload, rollback and competing writes.
- The Guard Vest is one unique piece of quest equipment. It visibly replaces the effective chest presentation while worn, mitigates a measured hit, loses durability and has a priced repair. No old V40 writer or general item decoder is broadened to accept it.
- The guaranteed claim gives 60 coins, 70 character XP and 70 Combat XP exactly once. A cosmetic crest uses a disclosed, deterministic 10% first-defeat roll, saved whether it hits or misses. It has no power or quest gate.
- A real UI journey, including crossing, combat, claim, vest mitigation and reload, is the eventual acceptance proof. Source tests, HTTP 200 and build alone do not prove it. One renderer maximum; close the test tab afterward.

## Scope locks and non-goals

- Keep V40 and older saves usable. No implicit upgrade, overwrite or old-writer edits. Use a new `wizard-world/v41` lineage and separate local database.
- The first enemy is a clockwork ward at the Hall, not a general spawning or PvP system. Repeat practice may train Combat but cannot reroll loot or repeat the quest claim.
- The vest is a new V41 quest-gear ledger with one effective chest presentation, not an old-version `ItemId` union expansion. A future general gear migration may unify catalogs, but this milestone must not lie about V40 compatibility.
- No online economy, MMO, dungeon instance, random quest gate, new dependency or additional browser renderer. No GitHub push or PR is authorized by this continuation.
- Use the correct Bioscopics local commit identity and `ben/` branch convention for any local commit. Keep pre-existing `output/` untouched.

## Open questions and implementation risks

- The supported hall cells still need a full movement/obstacle probe and one-tab browser traversal. If not reachable, choose another dry site through a documented planner decision, not a client coordinate fallback.
- Frame-batch movement and combat timing must replay identically. An isolated simulation must not disagree with V40's movement or save a different strike outcome.
- The prototype ward and vest must use the existing avatar/scene materials and the character workbench method. Visual fidelity is not proven until inspected in the running game.
- The first claim needs a real follow-up use for the vest. A repeatable ward drill can provide that without duplicating a story reward; it must be priced and XP-capped by a checked rule.
- Safe recovery is mandatory. Defeat cannot strand the player behind a locked route or consume the once-per-30-minute home rescue.

## Routing

System translation: `not_qualified`, this is a new feature and versioned save extension, not a whole-system port. System translation receipt: `not_applicable`.

Product agent runtime: `not_required`; the shipped game does not run a model agent. Planner handoff: `auto-planner-ticket-pack`, goal status `aligned`. The next pack may stage a combat-substrate slice before the full claim only if it carries the whole Iron Hall terminal condition forward and exposes a real playable checkpoint rather than declaring a toy encounter complete.
