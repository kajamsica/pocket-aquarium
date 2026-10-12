# Wizard Realms V133: Beneath the Old Marker

## Outcome

Advance the full-game campaign with a third quest that feels different from the two bridge-and-trade quests. The player follows the dry trail into Mireglass, studies the frontier marker, uses Wayfinder Glow to reveal a sealed cache, gains the Excavation skill needed to open it, and returns to the Mireglass salvager for a one-time reward. The reward is coins, character and Spellcraft XP, and an optional visible regional item. This is a playable chapter, not completion of the full RPG.

The user's request is for fun quests with coin, XP, worthwhile equipment, and eventually armor and drops. The current game has no damage, defense, enemies, or combat loot. Fen waders are visible travel clothing, not protective armor. The cache's seal is an existing guaranteed exploration find, not a random enemy drop. A later checked combat/equipment milestone must give armor and enemy drops real mechanical meaning rather than relabeling clothes or selling random chance as quest completion.

## Existing facts and constraints

- V35 is an opt-in checked save copied explicitly from V34. It already has the completed Outfitters' Ledger flag and a collapsible journal. Do not change V35 replay or silently migrate its save.
- Mireglass has a studied frontier marker, learned Wayfinder Glow, a spell-revealed seal cache, and `cacheExcavated` in authoritative saved state. The cache requires a field spade and Excavation level 2. Chopping then digging a stump is an existing way to earn the required Excavation XP. The seal is independently saleable, so completion must rely on saved excavation evidence, not continued possession of the item.
- The salvager is a canonical streamed-world outpost. Fen waders already have inventory, feet-equipment and 3D rendering support; they cost 150 coins in the shop. They force walking, so a reward must **not** automatically replace the player's running boots. No invented wader movement perk is claimed.
- Existing world and versioned replay checks are strict. New quest payout and claim history belong to a separate V36 checked schema and storage root, with explicit V35-to-V36 copy, atomic compare-and-swap, strict witness replay, and historical V35 preservation. The latest parent source already has hundreds of unrelated modifications; preserve them.
- Keep the user preview at `http://127.0.0.1:5194/?publicWorld=v35`. Use an isolated test origin and only one owned renderer for visual proof. Watch RSS. No GitHub action is requested.

## Quest experience and reward contract

1. The journal opens with a short clue to the dry Mireglass trail and frontier marker, but nearby map and world landmarks remain the primary guidance. This chapter is highlighted only after the V35 Ledger reward is claimed. Previously discovered or completed Mireglass actions count immediately; no forced replays.
2. Study the frontier marker to learn Wayfinder Glow if not already learned. Cast close enough to reveal the actual cache. If Excavation is below level 2, the journal points to the real chop-and-stump-dig route and its spade requirement. Excavate the cache with the existing action. The ordinary actions award their existing XP and the seal as before.
3. Approach the salvager on grounded terrain and claim the quest. The locked writer independently verifies the previous Ledger claim, marker studied, cache revealed and excavated, canonical outpost proximity, and prior non-claim. The cache seal may have been sold. No client-selected reward branch.
4. If no fen waders are owned or escrowed, the claim grants 80 coins, one pair of fen waders in inventory, 50 Spellcraft XP and 50 character XP. The waders remain unequipped so boots and run speed are preserved. If already owned or escrowed, it grants 230 coins and the same XP. The equivalent 150-coin difference matches the current wader shop price. A full pack blocks only the item branch with a clear free-space instruction; the alternate coin branch adds no carried item. All arithmetic uses safe integers.
5. Claim is a single checked `marker-claim/v1` witness in V36. Saved `markerClaimReward` is `'fen_waders' | 'coins' | null`. A repeat, remote, airborne, incomplete, forged, or competing claim leaves revision, coins, XP and inventory unchanged. Reload shows the precise reward branch and normal inherited movement/actions still work.

## Why this is a better quest

The task asks the player to read a place, learn and use a spell, deliberately train a skill, uncover a hidden site, then decide whether to keep or sell a unique find before returning. It combines existing verbs in a new order. The guaranteed reward is transparent; the seal remains a separate collectible sale choice. The player is never blocked because a one-off seal was sold. The regional item is visibly equippable but does not unexpectedly slow them at claim.

## Campaign reward grammar after this chapter

- Every main quest has a guaranteed coin/XP payout and either a useful unlock or a clearly identified visual item. It never relies on a random drop for mandatory progression.
- Skill XP is earned chiefly from performing the relevant action. Completion bonuses are modest and named precisely. Character XP may accompany it. The journal distinguishes action rewards from the final claim.
- Optional discoveries can pay rare cosmetic or crafting finds once a checked drop/loot owner exists. True armor should have a defense model, visible equipped mesh, level or skill requirements, repair/economy consequences, and tests against damage. Combat drops require authoritative encounter ownership, probability disclosure where appropriate, duplicate/rollback safety, and an inventory-capacity policy.
- Future varied quest archetypes: route rescue, spell puzzle, regional trade contract, creature-care trial, and a later dungeon boss. Avoid several consecutive “carry one item back” missions. The next main chapter after this should be Ringkeeper's Trail, which must use two discovered rings for a real shortcut rather than a free teleport.

## Proof and limits

Pure tests: fresh and migrated V36 root, V35 source unchanged, strict malformed witness rejection, cache/marker/ledger/pose/pack gates, duplicate payout, both reward branches, sale of seal before claim, inherited action after claim, reload. UI proof: a real V35-to-V36 copy or a checked near-quest fixture, visible clue/marker/cast/dig/claim/reload, exact rewards and non-occluding mobile journal. Start with early honest access to a working V36 surface; continue focused tests and one-renderer E2E. Do not claim the entire journey or long-session under-1-GiB memory is proven if only a fixture segment was exercised.

No enemy, combat, defense stat, loot table, new spell, random payout, offscreen auto-quest completion, multiplayer, or production deployment in this chapter.
