# V180 quest experience blueprint

This is a design contract for Wizard Realms, not a claim that these quests or rewards are playable. The current V41 preview has a learnable Arc Bolt, one clockwork ward, health, a telegraphed strike, recovery and saved defeat. It does **not** yet have the Iron Hall quartermaster, Guard Vest, repair, or enemy drop. The V36 opening route has checked rewards, but the complete fresh-player campaign still needs browser proof.

## What should make a quest fun here

Each quest needs a visible problem in the continuous world, a decision the player can explain afterward, and a reward that changes what they can do next. The player should be able to encounter the problem before opening a journal. A turn-in person or landmark should still exist after completion. Avoid generic kill counts, remote menu claims, fake armor with no protection, and random drops required for progress.

The campaign has three useful quest rhythms:

1. **Discovery:** notice an oddity, learn a tool or spell, use it on the world, return with a new route or map lead.
2. **Preparation and choice:** gather or trade for a solution, build or repair it, then traverse it. Preparation should matter without demanding repetitive chores.
3. **Danger and payoff:** read an enemy tell, choose when to guard, move or cast, recover if defeated, then claim guaranteed gear. A rare cosmetic is a bonus, never the reason the contract succeeds.

The quest text should describe the problem, not give away the entire answer. A first-encounter cue can say what is possible. If the player is stuck, a contextual hint can name the needed tool or nearby site. Once the player demonstrates the mechanic, that hint fades while the durable journal and map record remain.

## Candidate quest beats

| Beat | Player moment and choice | Guaranteed claim | Optional outcome and next use |
| --- | --- | --- | --- |
| The Surveyor's First Find (existing V36) | The creek blocks a visible trail. Chop trees, build a marked bridge, cross to the survey post. | Existing basic pick or 35 coins, plus action XP. | The pick makes nearby stone useful. This is an opening lesson, not a grind gate. |
| The Outfitters' Ledger (existing V36) | Build the north ladder and river bridge, find stone and bring a route report back. | Existing 50 coins, Traveler Tunic or 85 coins if owned, and checked Wayfinding/character XP. | The tunic changes appearance but is not armor. The follow-up points toward the Old Marker. |
| Beneath the Old Marker (existing V36) | Use Wayfinder Glow on a suspicious frontier marker, dig up its seal, return to the salvager. | Existing 80 coins, Fen Waders or 230 coins if owned, and checked Spellcraft/character XP. | Waders make the next wet route more convenient. |
| The Ringkeeper's Trail (proposed) | A matching rune is visible on a far Highland stone. Find it on foot, open the link, travel out **and back**, then tell the ringkeeper what connects them. | Proposed 25 coins, 30 Wayfinding XP, 20 Spellcraft XP, 35 character XP and the saved shortcut. | The return journey proves the shortcut is real. The map reveals another reason to revisit the Highland. |
| Windward Waystation (proposed) | A keeper needs a crossing repaired. Spend gathered logs now, or trade local stone for timber and keep the logs for a later build. Both routes require actually crossing the repaired span. | Proposed 45 coins, 45 Wayfinding XP, 45 character XP and a persistent crossing. | The next reachable site should be visible from the repaired route, so the reward feels like access, not only numbers. |
| Iron Hall Watch (V41 combat prototype, claim proposed) | From a safe alcove, learn Arc Bolt and see a ward's windup. Approach, move or guard through its strike, defeat it, then return to a quartermaster. Losing the fight preserves the quest and offers a clear retry. | Proposed 60 coins, 70 Combat XP, 70 character XP and a visibly worn Guard Vest whose mitigation and durability are real. | A once-rolled cosmetic crest may drop from the defeated ward. A next encounter should let the player feel the vest's protection. |
| The Lost Familiar (proposed side story) | Read tracks, choose a quiet shelter or longer safe route, feed and guide a creature home over several visits. This is a relationship, not an instant mount. | Proposed 25 coins, 40 Creature Care XP, 40 character XP and a saved care station. | Its next care need is legible in the world. Sustained care can later qualify for ground-mount training. |
| Iron Hall Depths (proposed later chapter) | The lower hall offers a material-consuming safe repair or a direct guarded stair. Either path leads to a record that must be carried out. | Proposed 70 coins, 80 Combat XP, 30 Excavation XP, 90 character XP and a choice of Stoneguard or Galeweave protection. | The two coats must have different tested strengths, not a hidden best choice. A cosmetic or crafting material may be a saved encounter bonus. |

The existing [V174 quest content plan](V174_QUEST_CONTENT_PLAN.md) has the fuller campaign order, including Highland Signal, The Long Road and Stormline Relay. This page sharpens the play moments; it does not replace that plan or silently promote proposed rewards into shipped features.

## Later side-quest candidates worth prototyping

These are hooks, not shipped rewards or promises of new regions. Prototype each only when its underlying world mechanic is real.

| Hook | Why it is more than an errand | Proposed reward direction |
| --- | --- | --- |
| The Bell Beneath the Creek | A bell rings from the water after a storm. The player can build a dry observation bridge and use a revealing spell, or prepare a boat and investigate from the water. Both approaches reveal the same lost surveyor's cache, but change which route remains useful afterward. | Modest coins and Wayfinding/Spellcraft XP, plus a guaranteed map lead. An optional bell-shaped robe ornament is cosmetic. Requires real boat movement before the water route is offered. |
| The Lantern That Went Walking | A village lantern appears in several places at dusk. Following its light exposes a hidden path, while finding its owner reveals why it moved. The player can return the lantern or help the owner set a permanent beacon. The chosen beacon changes what is visible on later night journeys. | Coins, Spellcraft XP and a persistent beacon or portable light recipe. No mutually exclusive power trap: both endings preserve access to the same future region. Requires a legible day/night world state. |
| Quarry Rescue | A trapped miner is visible across a broken ledge. A short bridge is fast but spends scarce timber; a longer ladder route uses stone from the quarry and is safer. The miner must be escorted back, so the chosen route has to work in both directions. | Coins, Construction/Wayfinding XP and a guaranteed repairable belt or tool. A rare enemy material can be optional if a real guarded route is added. Requires companion traversal before implementation. |

These should not all become separate UI checklists. Each should use a recognizable person, a persistent change in the world and a new reason to revisit an earlier place. The player can carry more than one lead at a time and naturally make progress through ordinary exploration.

## Reward and drop rules

- A story quest pays a known coin, named-skill XP and character-XP amount exactly once. XP from chopping, casting, building or combat actions is separate and shown separately, so the claim is not double-counted.
- Guaranteed gear is the reason a milestone matters. It must be visible on the body, have an actual gameplay effect, and lead to a nearby situation where that effect is useful. The Guard Vest needs a measured damage reduction, wear, repair cost and a readable comparison to ordinary clothing.
- The first Iron Hall crest can use the already proposed 10% rate only after the rate and no-pity rule are disclosed in the game. Its roll belongs to the first authoritative defeated encounter, is saved once even on a miss, and cannot be rerolled by retrying, reloading or migrating a save. It is cosmetic and never gates a quest.
- Quest gear needs one ownership record. A duplicate claim is refused or uses a declared alternative, and a full backpack must leave a guaranteed reward claimable or put it in checked escrow. No silent loss or item duplication.
- Repeatable contracts, if added, should give modest coins and practice XP with clear caps, not another unique armor claim or an endlessly farmable rare-roll reset.
- The early reward economy should leave boots, basic tools and repair affordable while ground mounts remain a substantial later purchase. Test actual player routes before fixing late-game prices.

## Next playable slice

Finish Iron Hall Watch before adding more quest cards. A version-isolated successor to V41 should make the quartermaster physically reachable, check the defeated ward, grant the 60/70/70 reward once, equip and show the Guard Vest, make its protection and durability observable in a subsequent checked encounter, and permit priced repair. Resolve and persist the optional crest result exactly once. Preserve the V41 source save and old decoders. A real browser journey, including crossing, defeat, claim, protection, repair and reload, is the acceptance gate. If any of those is missing, label it a prototype and keep the quest incomplete.
