# Ticket pack: V29 deep excavation and usable tools

## Player promise

A new wizard can buy a basic pick at Greenway Outfitters, equip it visibly, and dig a specific nearby dry ground cell by clicking or tapping it. The checked geology determines whether that layer yields soil, stone, iron ore, gold ore, or a rare diamond. Excavation leaves a persistent 0.4 m layer divot. A higher-tier enchanted pick and skill levels unlock the rarest material. A spade still works for soil and for refilling an open pit with carried soil. Bedrock and unsafe ground remain blocked with exact reasons. An unreachable hole offers a saved pit ladder or the existing trapped-only, 30-minute return-home rescue.

This is versioned V29 work. V25 through V28 roots, witnesses, store listings, and replay stay unchanged. It is not unrestricted voxel terrain or a promise that every coordinate contains a valuable ore.

## Existing facts

`publicWorldV25Strata` already seeds soil, stone, iron, gold, diamond, tool tiers, level thresholds 1/2/5/12/25, and bedrock at layer 12. The V26 terrain ledger already bounds 256 columns, tracks open and reward depth, contains a mineral bag, prevents repeat farming after fill, and projects 0.4 m layer changes. The current V26 action accepts only an owned equipped spade and rejects all other tool tiers. The old ItemId, store, and save validators are closed, so adding a pick to old inventory would change historical semantics.

## Fixed V29 interface and proof

- Migrate only from a checked, live V28 source receipt under the same lock. Copy its world and terrain exactly; initialize a small V29-only mining-tools sidecar. No old source mutation or implicit save reset.
- V29 virtual Greenway offers sell one basic pick and, later, one enchanted pick. Their stock, prices, ownership, coin charge, and selection are canonical V29 rules, not client-supplied store state. The enchanted offer needs an explicit progression gate and must not make diamonds an early shortcut.
- The sidecar is exactly `{ basicPickOwned: boolean, enchantedPickOwned: boolean, activePick: null | 'basic' | 'enchanted' }`, initialized with two false values and null. The two unique virtual offers are 35 coins for a basic pick and 240 coins for an enchanted pick. The latter requires Excavation level 25 at purchase. A checked purchase charges coins once and turns on ownership; a checked equip selects an owned tier and clears the legacy main hand. Any legacy main-hand equip action clears `activePick`. The UI reflects the actual equipped tool, not two simultaneous tools. The sidecar does not add pick IDs to historical inventory or store listings.
- A V29-only checked mineral cash-out action at canonical Greenway Outfitters sells a bounded quantity from the terrain bag, not from historical inventory. Fixed bids are soil 1, stone 3, iron ore 8, gold ore 15, diamond 60 coins each. It checks reach, ownership of the mined quantity, safe integer arithmetic, and applies bag and coin changes atomically. This frees capacity so level 25 and the 240-coin enchanted pick are reachable through play rather than only synthetic test fixtures. No old store listings or V26 terrain bag interpretation change.
- A V29 dig witness names only a grid cell. The authority rechecks seed geology, full discovery, dry and unoccupied surface, saved bridge/pit clearances, grounded reach, current tier, excavation level, bedrock, backpack capacity, and reward conservation. It updates the existing terrain ledger with the same anti-farm rule. The spade and fill continue using their existing checked action.
- V29 head, bounded replay slots, lineage, atomic store, and flow preserve the V28 to V25 live source ancestry, one-shot proof, CAS, and full-decoder fallback. Routine checked saves should remain below the 800 ms input-queue window on the `greenway-alpha` fixture.
- Hover or reticle text must distinguish a geometric target from a checked diggable target. Each rejection names the missing tool, skill, reach, capacity, occupied work, bedrock, or unsafe water. The starter guide says where to buy the spade and basic pick, and does not promise gold or diamond immediately.

## Lane graph

`MINE-A` designs the V29 sidecar, canonical virtual offers, exact purchase/equip witnesses, and focused tests. `MINE-B` adds source-pinned V29 migration, snapshot, atomic store, and flow independently using the fixed sidecar contract. `MINE-C` adds V29 checked deeper-dig action on the existing terrain ledger after A, with exact geometry and anti-farm tests. `MINE-F` adds V29 mineral cash-out at Outfitters independently of C. `MINE-D` joins witnesses, replay, and flow after A through C and F. `MINE-E` connects V29 entry, inventory/gear UI, terrain picker, reticle and honest first-session guidance. `MINE-Q` independently reviews the trust boundary and proves the new-player UI path in one isolated renderer, with console/network and save/reload. Preserve the V28 playable route while this work proceeds.

## Acceptance sequence

1. Fresh start, buy and equip spade, click dry soil, see a persistent divot and soil; fill it, then re-dig without a second reward.
2. Buy/equip the basic pick, reach skill level 2 through genuine digging, click a stone layer, and receive only the deterministic material at that cell and depth.
3. Prove iron/gold/diamond gates with deterministic seeded fixtures, including the enchanted tier, levels 5/12/25, and bedrock rejection. Do not grant rare materials in the starter tutorial.
4. Save/reload on changed terrain, verify old V28 save still opens unchanged, reject forged witness/source changes/stale CAS, and measure routine save latency.
5. Check pit ladder and trapped-only return-home, including the 30-minute cooldown and no free escape when a known exit exists.

No GitHub action, commit, PR, or push is authorized by this pack. The full Wizard Realms game goal remains active beyond this milestone.

## Local validation receipt

The fresh V29 browser journey passed the core loop on `greenway-alpha`: buy and equip a spade and basic pick, dig column `(0,1)` twice for two soil, mine its third layer for stone, sell one stone at Greenway Outfitters for 3 coins, and reload. Validated save #13 retained the deeper pit, two soil, the equipped pick, and 70 coins. The V29-only pit picker accepts the exposed wall from adjacent ground while older Dig behavior stays unchanged. Focused UI tests and TypeScript passed, and `npm run build` passed.

The first pit is hard to retarget while the avatar stands inside it. A V29-only hint now advises stepping onto neighboring ground or orbiting until the floor or inner wall outlines. The out-of-reach Mine preflight has a deterministic regression test, but its exact distant-click cue was not independently proved in the browser because intervening trees and water blocked the test view. This receipt proves the excavation and trade loop, not the full game or complete pit usability.
