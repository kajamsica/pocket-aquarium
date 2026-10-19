# Wizard Realms quest campaign: aligned understanding

## Outcome and scope

The north star remains a full third-person wizard RPG, not a checklist demo. Quests should turn exploration, skills, magic, construction, excavation, trade, and later companions into connected reasons to travel. A quest is successful only when a player can understand the problem in the world, act through normal game controls, receive a fair reward, see that reward persist after reload, and have a new reason to continue. This is an addition to the existing full-game goal, not a new mode or a fixed quest-only tank-like preset.

The user's new request is to start shaping fun quests that grant coins, skill and character XP, visible armor, and worthwhile drops. WoW is inspiration for reward cadence, but Wizard Realms should keep its own geography and skills. Quest-critical tools must be guaranteed through a quest or affordable shop stock. Random loot must never gate the only route out of a region.

## Existing implementation truth

- The opt-in V34 game is at `?publicWorld=v34` and has a strict, separate checked save. Its witness decoder and replay reject extra or altered head fields. Changing V34 payout rules in place would invalidate existing saved histories.
- The valley already supports chopping for logs, Woodcutting XP, building ladders and bridges for Construction XP, reaching a bridge's far bank, and claiming a one-time River Works find. The checked claim accepts both an early Greenway creek bridge and the later connected-river bridge. It grants a basic pick if the player lacks one, otherwise 35 coins. It does not grant armor or quest XP. The claimed bridge ID persists, but the exact past reward branch does not.
- `WizardHud` has a field objective and a claim button, but no journal, named quest, campaign state, or explicit completion and reward recap. `WizardScene` already renders equipped traveler tunic, apprentice hat, and boots distinctly, so these are viable future visible rewards.
- Excavation, Highland and Mireglass, and fairy rings exist in later checked versions. There is no current enemy/combat drop system. Calling a coin or tool claim a combat drop would misrepresent the game.

## Campaign spine

| Arc | World problem and player choice | Primary actions | Deterministic completion reward | Unlock and return hook |
|---|---|---|---|---|
| 1. The Surveyor's First Find | A surveyor's field post is stranded across a local water crossing. The player finds a supported site and builds any valid first bridge. | Chop, equip, construct, traverse a saved bridge, inspect its far-bank post. | Existing one-time basic pick or 35 coins. Woodcutting and Construction XP come from the actual actions, not an invented quest payout. | The saved claim ends this quest; the broader frontier remains open. |
| 2. The Outfitters' Ledger | A trader needs a safe connected-river supply route beyond the north cliff, but only materials delivered from that side count. | Build the north ladder, cross the connected river, deliver a regional material, choose boots or a visibly worn tunic when an equivalent is already owned. | Coins, Trade XP, one guaranteed practical equipment choice. | Better stock and a reason to bring material back. Requires new checked quest authority. |
| 3. Beneath the Old Marker | A clue points to a buried resource; shallow loam and hard strata need different tools. | Read clue, equip spade, click valid ground, use pick for deeper rock, manage pit and return-home safety. | Excavation XP, materials determined by the actual site, and a tool or recipe. | New excavation site and demand at a shop. Requires checked site flags. |
| 4. The Ringkeeper's Trail | Fragments at two landmarks describe an old route. | Discover landmarks, practice a useful spell, visit both fairy rings and safely travel. | Spellcraft/Wayfinding XP, modest coins, a visible accessory or spell focus. | Repeatable shortcut, not a teleport to an undiscovered place. |
| 5. The Windward Contract | Highland resources are valuable but moving them safely is the challenge. | Build a ridge approach, gather regional stone, trade it, and revisit the route. | Regional gear and money sufficient to make a later mount goal legible, not free top-tier travel. | Opens crafting and future companion/ground-mount arcs. |

Later predator, dungeon, and creature quests should introduce enemy drops only after a checked combat and loot-owner system exists. Rare drops can be exciting, but every main-story completion gets a guaranteed reward. Ground mounts should be earned through capture/raising plus a substantial gold investment; flight belongs to a later high-level arc.

## Quest design invariants

1. Every stage points to a visible place, object, character, or map clue. Guidance says why a route is blocked and which concrete tool or material solves it; it never sends players to invisible coordinates.
2. Progress derives from authoritative world state, not a parallel UI checkbox. Reward claims are checked against location, prerequisites, inventory capacity, and prior claim, then written atomically. Reload cannot duplicate a reward.
3. Multiple quests may overlap, but the starter arc highlights one next action. A small, collapsible journal must not occlude Works, the map, or the avatar, including narrow screens.
4. XP rewards map to actual skills used; coins and gear respect shop prices and pack capacity. Existing ownership has a documented alternate reward. Visible equipment must appear on the character after equip and after reload.
5. The present V34 rules remain frozen. A quest that pays new coins, XP, or equipment needs a new versioned checked witness, explicit V34-to-successor migration, strict replay, and fresh-save and migrated-save proof.

## First milestone and terminal evidence

First expose the existing Surveyor's First Find as an honest named, staged quest in V34 without changing authority or falsely promising armor. It should accept either checked bridge family, show a concise objective, distinguish earned action XP from the final pick-or-coin claim, and retain completed state from any canonical `claimedBridgeheadId` after reload. Historical completion cannot say which reward branch was granted. This is a useful playable quest presentation, not the full campaign. Then implement Arc 2 in a new checked save version with a genuinely new armor/coin/XP reward, following the versioning rule above.

Proof for Arc 1: start from a real V34 save, read the quest prompt, make progress with normal controls, build and cross, claim once, reload, and see a completed journal and the persisted reward. Prove that an early, remote, or repeated claim fails without reward. Proof for Arc 2 additionally requires exact migration and save-replay tests, alternate-reward tests, gear rendering, narrow-screen UI, and a real browser journey. User access to the V34 route remains available while these are built; UI testing should use one renderer within the agreed memory ceiling.

## Non-goals for this pass

No combat loot, dungeon, NPC dialogue tree, repeatable task farming, multiplayer market, currency purchase, or silent V34 schema change. No GitHub push or PR is implied by this request. The design does not claim those features already exist.
