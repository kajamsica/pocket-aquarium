# V137 quest reward blueprint

Design proposals only. The V35 Ledger and V36 Old Marker claims are the current checked quest precedent; their second and third chapters remain unproven from an organic fresh-player journey because V137-A stopped at the RAM guard before Ledger. No quest or payout below is shipped. The campaign calls for visible problems, distinct actions, deterministic main-story rewards, and return trips to recognizable places. [Roadmap](QUEST_CAMPAIGN_ROADMAP.md#L3-L9), [V35 claim](../engine/src/domain/publicWorldV35LedgerAction.ts#L153-L175), [V36 claim](../engine/src/domain/publicWorldV36MarkerAction.ts#L102-L116).

## Current economy and equipment anchors

| Shipped anchor | Source | Design implication |
| --- | --- | --- |
| Greenway hat 20, axe 35, spade 18 coins; Highland shield 40, wand 45 coins | [store catalog](../engine/src/domain/generation.ts#L108-L110) | A 30 to 60 coin claim buys one practical item or contributes to a larger purchase. The shield has an equipment slot, not proven protection. |
| Leather boots cost 25 coins through a virtual Greenway offer and enable running; Fen Waders cost 150 coins and permit walking only | [generated store catalog, without boots](../engine/src/domain/generation.ts#L108-L110), [virtual boot price](../engine/src/domain/publicWorldGait.ts#L4-L5), [boot purchase](../engine/src/domain/publicBootPurchase.ts#L11-L36), [gait](../engine/src/domain/publicWorldGait.ts#L7-L16), [outpost catalog](../engine/src/domain/mireglassExpedition.ts#L24-L29) | Footwear has a real travel tradeoff. Waders are not armor. |
| Ledger pays 50 coins plus visible Traveler Tunic, or 85 coins if owned, with 60 Wayfinding and character XP across survey and claim | [V35 action](../engine/src/domain/publicWorldV35LedgerAction.ts#L131-L175), [avatar gear](../engine/src/view/WizardScene.tsx#L595-L607) | Tunic is a visual clothing precedent, not a damage-mitigation precedent. |
| Old Marker pays 80 coins plus Fen Waders, or 230 coins if owned, and 50 Spellcraft and character XP at claim; the seal sells for 80 | [V36 action](../engine/src/domain/publicWorldV36MarkerAction.ts#L78-L116), [seal bid](../engine/src/domain/mireglassExpedition.ts#L24-L29) | New ordinary claims should stay below the wader duplicate payout and should not rely on selling a find. |

All amounts in the next table are **proposed**, additive claim rewards. Existing spell, travel, repair, or combat action XP, where supported, is separate. Character XP and named skill XP are stated independently.

| Proposed quest | Guaranteed claim | Useful payoff | Optional find or drop | Price calibration |
| --- | --- | --- | --- | --- |
| Highland Signal, optional discovery | 30 coins; 35 Spellcraft XP; 35 character XP | Saved highland signal clue on the map, proposed persistent discovery | None | 30 covers 25 coin running boots or an 18 coin spade, but not a 40 coin shield. |
| Iron Hall Watch, first combat contract | 60 coins; 70 Combat XP; 70 character XP | One visibly equipped, mechanically protective Guard Vest, proposed new armor | Proposed 10% cosmetic crest from the defeated foe, never needed for completion | 60 covers a 45 coin wand or 40 coin shield, but is well below 150 coin waders. Vest value cannot be priced until protection and repair costs exist. |
| Windward Waystation, regional choice | 45 coins; 45 Wayfinding XP; 45 character XP | Saved repaired waystation crossing, a durable route consequence | None | 45 matches a wand, exceeds a shield by 5, and does not replace the 150 coin wader milestone. |

## Three quest briefs

### 1. Highland Signal, optional discovery

- **Problem and clue:** A dark signal vane stands on the dry Quarry Crown trail. Its etched wind marks point toward a second vantage point, inviting exploration beyond the main route. The existing Crown glyph teaches Windward Step, and the spell works on the authored dry Highland trail. [Windward rules](../engine/src/domain/publicWorldV12Authority.ts#L164-L209).
- **Action, complication, return:** Learn Windward Step through the normal glyph interaction, follow the trail to the vane, cast within its legal window, and inspect the revealed bearing. A cooldown or leaving the trail delays the signal without losing progress. Return to the Crown marker to record it.
- **Proposed reward:** The table's 30 coins and two 35 XP grants, plus a saved map bearing that points to a later region. No random drop. The bearing is the practical payoff; it must become visible soon after claim.
- **Future prerequisite:** Add a world-visible vane, checked discovery and return witness, persistent map clue, and one-time claim. Reuse the shipped Windward Step learning and cast rules; the signal quest and its payout do not exist yet. [Roadmap optional-signal direction](QUEST_CAMPAIGN_ROADMAP.md#L23-L28).

### 2. Iron Hall Watch, first combat contract

- **Problem and clue:** A single hall sentry blocks a lit supply door. Its stance and windup clearly announce one attack, while a nearby safe alcove teaches recovery before the player commits.
- **Action, complication, return:** Enter on foot, read and avoid the telegraphed strike, defeat this one foe, recover, then return its stamped watch token to the hall quartermaster. A retreat preserves the contract; no random drop is required to turn in.
- **Proposed reward:** The table's 60 coins, 70 Combat skill XP, 70 character XP, and first genuinely protective Guard Vest. Combat skill and vest are future additions. The proposed 10% cosmetic crest is a bonus owned by that defeated encounter; its chance must be shown or documented before launch.
- **Future prerequisite:** Checked player and enemy health, damage and resistance, readable telegraph and recovery, armor mitigation and durability/repair, visible vest equipment, Combat skill, encounter defeat and unique loot ownership, save/reload, and rollback proof. Current item slots do not define protection, and the roadmap marks the Iron Hall as requiring these systems. [Item and skill types](../engine/src/domain/types.ts#L6-L12), [armor and drop rules](QUEST_CAMPAIGN_ROADMAP.md#L31-L34).

### 3. Windward Waystation, regional choice

- **Problem and clue:** A washed-out waystation crossing leaves two visible solutions: a broken brace beside the path and a salvager offering sound timber for local stone. The player can repair the brace directly or trade for the timber, then install it.
- **Action, complication, return:** Either path requires reaching the same crossing and checking that it holds. The trade path costs stone but avoids gathering logs; the repair path spends logs but keeps stone. Return to the waystation keeper, who acknowledges the chosen work.
- **Proposed reward:** The table's 45 coins and two 45 XP grants, plus a saved usable crossing. No drop. The route, rather than an unimplemented item, is the guaranteed practical benefit. Ordinary construction or trade action XP remains separately governed by its action.
- **Future prerequisite:** Add the visible site, two authoritative resource-consuming paths to one completion fact, traversable saved route, keeper turn-in, and one-time claim. Existing route construction and trade are precedents, but this crossing and choice quest are not shipped. [Roadmap Windward and rhythm](QUEST_CAMPAIGN_ROADMAP.md#L7-L19), [existing trade and capacity checks](../engine/src/domain/world.ts#L360-L390).

## Claim and save gates for implementation

Each proposed claim needs a versioned, checked world witness and authoritative one-time progress flag. The UI may preview a reward, but the checked writer derives coins, XP, item or route, and any duplicate alternative from its current saved head. A failed, remote, forged, or repeated claim changes nothing. V35 and V36 already model one-time reward selection; V36 also rejects full capacity before granting waders. [V35 claim checks](../engine/src/domain/publicWorldV35LedgerAction.ts#L117-L139), [V36 capacity and claim](../engine/src/domain/publicWorldV36MarkerAction.ts#L78-L90), [roadmap authority](QUEST_CAMPAIGN_ROADMAP.md#L29-L35).

For the proposed vest, ownership in inventory, equipment, or trade escrow must select a fair, **proposed** 150 extra coins in addition to the base 60. That provisional duplicate premium matches the V36 wader premium and 150 coin shop price; balance it against the vest's eventual shop and repair value before shipping. Full inventory must block the item claim with a clear free-space action or use checked escrow, never consume completion and lose the vest. Persist the chosen branch, encounter or route fact, and optional drop roll before displaying success; reload must reproduce the same result and a retry must not reroll. A sold quest token or material cannot erase a saved achievement. These are future gates, not current V36 behavior. [V36 duplicate premium](../engine/src/domain/publicWorldV36MarkerAction.ts#L78-L89), [roadmap reward and overflow rules](QUEST_CAMPAIGN_ROADMAP.md#L29-L35).
