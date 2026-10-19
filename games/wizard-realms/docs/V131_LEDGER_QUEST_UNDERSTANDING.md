# Wizard Realms V131: Outfitters' Ledger quest understanding

## Original Ask

The durable goal is a complete third-person, single-player wizard RPG across a connected roughly 2 km world. The latest addition asks for fun quests with meaningful coins, XP, visible gear, and eventually good armor and drops, in the spirit of a sustained RPG campaign. V130 delivered the first honest, checked bridgehead quest presentation. Continue the campaign, without treating that first quest or this second quest as completion of the game.

## Input PRD / Spec

`V130_QUEST_CAMPAIGN_UNDERSTANDING.md` is the current campaign spine. Its second arc, Outfitters' Ledger, calls for a connected-river route, a return to trade, and a worthwhile gear reward. Repo truth refines the reward: there is no Trading skill, no combat or armor stat, and the existing Traveler Tunic is a visible garment, not defensive armor. The implementation must say Wayfinding XP and visibly worn travel gear, not invent a Trading skill or combat drop.

## Aligned Problem Statement

Make the second quest a real, saved journey through construction, exploration, excavation, and return trade. The player should complete the existing first find, build or use a connected-river bridge, survey its dry far-bank exit, obtain one excavated stone in the terrain bag, then return to Greenway Outfitters to hand in the sample. The checked survey grants 20 Wayfinding and character XP. A checked one-time delivery then grants 40 more Wayfinding and character XP, 50 coins and an auto-equipped Traveler Tunic; if the tunic is already owned, it grants 85 coins instead. The game must show the exact saved reward after reload, prevent duplicate claims, and preserve all V34 saves through an explicit opt-in copy to a separate V35 save.

This is a narrative and gameplay loop, not a new disconnected world. The survey mark at the connected river is a checked quest action, not a free-form UI checkbox. The sample is one unit of actual `terrain.bag.stone`, produced by normal digging, not an invented item or a claim of precise geological provenance. The player can dig it at any valid site after completing the survey. The quest should guide the player if the pack is full, the pick is missing or unequipped, the route is not built, or they are at the wrong location.

## Goals

- Give V34 players an explicit, safe V35 copy or resume choice. V34 remains intact and independently playable.
- Save `ledgerSurveyBridgeId` and `ledgerClaimReward` in a strict V35 lineage, with pure checked witnesses `ledger-survey/v1` and `ledger-deliver/v1` and replay/CAS verification.
- Verify a canonical built V28 connected-river bridge, revealed dry far-bank exit, grounded player within 3 m, and prior first-find claim before survey. Verify a saved survey, one terrain-bag stone, Greenway Outfitters reach, grounded player, and no prior ledger claim before delivery.
- Consume exactly one bag stone at delivery; award the specified deterministic stage XP, coins, and owned/equipped garment or alternate coins atomically. Never let the client choose the reward branch.
- Show one compact, non-occluding journal and actionable Survey/Deliver controls through the real V35 UI. The first quest remains understandable, and other versions behave as before.
- Prove new-copy, resume, old V34 preservation, bad/wrong/repeat action rejection, rewarded equipment display, and save/reload from the UI.

## Non-Goals

No combat, damage mitigation, random drops, new Trading skill, new garment mesh, multiplayer market, V34 historical rewrite, implicit migration, or production release. True armor stats and enemy loot remain later campaign milestones. No GitHub push or PR is authorized by this goal continuation.

## Constraints

- Current branch/worktree: `ben/wizard-playable-v2` in `/private/tmp/pa-wizard-playable-v2`, ahead of origin with many user-owned changes. Preserve all unrelated state.
- The V34 root has exact keys and replays inherited V33 witnesses. New rewards cannot be inserted into V34 replay without invalidating old saves. V35 needs a new database and explicit copy under the same lock, then self-contained checked progression.
- Existing `traveler_tunic` is in `ItemId` and `WizardScene` visibly renders it when `equipment.chest` is set. Persisted equipment must also be owned in inventory. Its reward is a travel garment, not protective armor.
- V30's one-time claim can be at an early creek bridge. V131 requires any saved first-find claim but independently validates a V28 connected-river survey; it does not reuse the old claim as proof of crossing.
- V26 terrain bag carries excavated stone and is included in pack capacity. Delivery consumes stone before granting a tunic, so the carried-unit count does not increase for that branch. Reward arithmetic and level derivation must be safe integers.
- Preserve the playable V34 preview on port 5194. Use one game renderer for UI proof and close test tabs; avoid unnecessary HMR while a live checked test save is being driven.

## Success Criteria

1. A valid V34 save can be explicitly copied once into a separate V35 root; V34 head and revision remain byte-for-byte unchanged. Bad or conflicting source/target roots fail closed without clearing data.
2. Survey rejects creek IDs, unbuilt or unrevealed connected-river sites, airborne/remote/wrong-side poses, missing first claim, and repeats. Rejections leave revision, coins, XP, bag, and flags unchanged.
3. Delivery rejects absence of survey, no stone, remote/wrong-region/airborne store pose, and repeats. Success uses exactly one stone, exact currency/XP/equipment branch, safe level, and one new checked revision. A second delivery never pays.
4. Reload of the real game retains survey, precise reward history, visibly equipped tunic when awarded, and correct next objective. Movement, return-home, fairy-ring travel, and existing V34 actions still work from the rewarded V35 state.
5. One real UI journey passes through copy, survey, dig, return, deliver and reload. If the journey cannot be reached within bounded proof time, report exactly which gates are still unproven, not a fabricated pass.

## Open Questions

No outcome-determinative user choice remains for this pack. We choose a deterministic Traveler Tunic reward and 50 coins, with 85 coins for a prior tunic owner. The exact visual quality and future armor rating of later gear remain open for a separate combat and equipment milestone.

## Implementation Risks

- Version-wrapper state after the new claim may be rejected by an inherited V34/V33 decoder if its player equipment and inventory are inconsistent. A post-claim inherited movement and reload probe is mandatory.
- V28 far-bank pose and post projection have strict geometry; UI controls are advisory and the writer must independently revalidate. A prior V30 creek claim must not create a false V28 survey.
- The V35 entry and controller touch several versioned seams. Split by ownership and replan if any lane exceeds five files or 300 net lines, or if historical rules need modification.
- A new HUD card can obscure Works or the Survey/Deliver prompt on phones. Use the existing compact objective region, and hit-test at narrow widths before claiming UI success.

## System Translation Routing

`not_qualified`. This is a new, versioned gameplay feature in the existing TypeScript game, not a whole-system port or platform migration. System translation receipt: `not_applicable`. Product agent runtime: `not_required`; shipped quest authority is deterministic and does not run a model agent.
