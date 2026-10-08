# First expanded region content pack: Mireglass Reach

## Status and boundary

This is the content contract for the first playable streamed region southwest of Greenway. Its deterministic landmark anchors, versioned fen and berm ground forms, reserved timber nodes, and bounded per-chunk content query are implemented and tested. The live streamed surface is still an unsaved traversal preview; the authored journey, routes, shop, and save integration are not yet playable. The current `wizard-world/v5` Greenway has a 7 by 7 default and a roughly 64 m, 16 by 16 development preview, Wayfinder Glow, selected sites for two profiled routes, a practice dig, visible starter equipment, and local shop sales. Preserve those saves, IDs, and positions. The [streamed-world foundation](STREAMED_WORLD_FOUNDATION_CONTRACT.md) supplies chunk and save rules; [Game Design](GAME_DESIGN.md) keeps the separate full-game target of a roughly 2 km world with more regions, mounts, boats, and endgame.

Mireglass Reach has a 192 m east-west by 256 m north-south core, using 12 streamed 64 m chunks at world `X [-448, -256)` and `Z [256, 512)`. A marked dry fringe trail leads southwest from Greenway to its southeast edge across streamed transition terrain. New authored anchors begin outside the preserved v5 footprint; no v5 cell, landmark, resource, or route is rewritten. The core and its approach make one first-region journey, not a claim of full-game completion.

## Region identity and spatial plan

The southwest outer climate supplies the wetland field; the northeast highland field is outside this pack. In the first streamed content revision, author a shallow fen channel, dry outpost pad, and raised slate berm only in the new southwest cells, with deterministic seam blending. Bent alder and tall reeds define the wetland silhouette; dark peat, pale water, and green slate define its materials and palette. Reed wind, shallow water, and distant stone chimes distinguish its ambient sound. Logs, marsh herbs, and exposed stone support gathering, construction, and excavation. No combat, mount, boat, hostile weather, or survival meter is required to finish the first journey.

Coordinates below are placement envelopes in world meters, not hardcoded spawn points. The generator chooses one eligible cell in each envelope and pins the result to the content revision.

| Place and envelope (`X`, `Z`) | Stable content ID | Player function |
|---|---|---|
| Existing Greenway start and waystone, near `(0, 0)` | Existing v5 IDs | Safe launch, learn `wayfinder_glow`, buy or equip the axe and field spade, complete the existing practice dig. |
| Dry southwest trail marker, `X -112..-80`, `Z 80..112` | `mireglass_reach/landmark/fringe_marker` | Foot route across transition terrain, local discovery, and a clear return bearing. |
| Raised outpost, `X -304..-272`, `Z 272..304` | `mireglass_reach/vendor/salvager` | Recognizable return destination, visible price for the expedition find, spade fallback, and post-sale equipment purchase. |
| Bell alder and timber pockets, `X -400..-336`, `Z 320..352` | `mireglass_reach/landmark/bell_alder` | Distinct wetland silhouette, local map discovery, useful logs, and nearby fog for an 8 m Wayfinder Glow reveal. |
| Authored fen channel, `X -392..-320`, `Z 352..376` | `mireglass_reach/route/fen_bridge/*` | Water barrier with at least two discovered, dry-supported, player-selectable bridge sites. |
| Authored slate berm, `X -432..-368`, `Z 416..448` | `mireglass_reach/route/slate_ladder/*` | Height barrier with at least two player-selectable ladder sites and a long view back toward the outpost. |
| Buried seal cache, `X -432..-400`, `Z 464..496` | `mireglass_reach/dig/seal_cache` | Hidden until a nearby spell cast, dry standable excavation ground, one persistent find, and the far turn of the return journey. |

All critical locations are connected by the marked dry fringe, readable hummocks, or the two new built crossings. The bridge spans water; the ladder climbs the authored berm. The far cache is revealed locally, not by seeing it from the start. The return uses the player's built crossings in reverse and ends at the outpost vendor. The old northbound Greenway ladder is optional legacy content, not an entry gate or detour.

## Outward and return journey

Target a 30 to 45 minute first-time journey without wait timers. An experienced replay may be faster.

| Target elapsed time | Player action and observable result |
|---|---|
| 0 to 8 minutes | Study the existing Greenway waystone, buy and equip a field spade, excavate the practice mound to reach excavation level 2, and set out on the marked southwest foot trail. The character visibly changes main-hand gear when switching axe and spade. |
| 8 to 16 minutes | Follow the dry Greenway fringe into Mireglass Reach, discover the raised outpost and bell alder, read the vendor's return price, cast Wayfinder Glow near fog to reveal terrain, and gather timber before the channel. |
| 16 to 27 minutes | Inspect multiple bridge and slate-ladder sites, compare material costs, gather any shortfall, commit one site for each, and cross. The unchosen sites remain unbuilt; map markers and world structures match the chosen sites. |
| 27 to 35 minutes | Cast Wayfinder Glow near the cache to reveal it, equip the spade, excavate once, collect one `mireglass_reach/item/seal`, and see the ground change to a dug state. |
| 35 to 45 minutes | Return on foot across the same crossings, sell the seal at the outpost, buy and equip `mireglass_reach/item/waders`, then save and reload. Coins, inventory, skill XP, discoveries, chosen sites, dug ground, and the avatar's visible boots agree after reload. |

## Deterministic content and eligibility

- Pin this pack as `mireglass-reach-v3` within the first streamed content revision. V3 closes the side and back detours around the fen and the side detours around the elevated cache, before any streamed save or public profile existed; no v1 or v2 save migration is implied. Stable IDs above identify authored facts. Generated resource IDs use `mireglass_reach/resource/<globalCellX>/<globalCellZ>/<slot>`; route candidate IDs replace `*` with their global seam-cell coordinates. IDs never depend on chunk activation, render order, or search completion order. Changing geometry or rewards after promotion requires a new content revision and migration decision.
- For each authored envelope, enumerate 4 m cells in a stable seeded order, then choose the first that passes the southwest wetland or authored dry-pad eligibility, region, collision, landmark clearance, and walkable-approach checks. Pin the stitched shallow fen meander, deep side and back channel, and three-sided slate rise to `mireglass-reach-v3`; they cannot alter v5 cells or appear in a different climate field without a new revision. The current 100-seed corpus proves a closed visible fen ring, a raised cache plateau, at least 18 locally eligible fen bank spans, and 16 slate rises per seed. Global route reachability and authoritative obstruction are still unproven. If a required anchor or two route candidates cannot be placed, reject that seed for this profile. Never silently move a landmark outside its envelope or fall back to Greenway ownership.
- Existing `wayfinder_glow` remains the practical exploration spell. It reveals undiscovered nearby terrain and the cache only within its 8 m range; XP is earned only for new reveals. The seal cache requires an owned, equipped `field_spade`, excavation level 2, a standable point within 3 m, free pack capacity, and a prior reveal. It grants one seal and one XP award, then remains visibly dug after unload and reload.
- New site costs depend on canonical geometry and are shown before commit: a supported ladder costs 4 logs for a rise up to 2 m or 6 for a rise above 2 m and up to 3 m; a bridge costs 6 logs for a span up to 6 m or 8 for a span above 6 m and up to 10 m. Other geometry is ineligible. The existing v5 Greenway recipes retain their 4 and 6 log costs but are not required here. Both new builds revalidate support and ownership, spend materials once, persist the selected site ID and endpoints, and allow two-way traversal.
- The outpost salvager buys one seal for 80 coins, versus 30 at Greenway, and buys logs for 2 coins each as an early trade outlet. It sells a field spade for 18 coins plus visible `mireglass_reach/item/waders` for 150. Waders occupy the feet slot and improve traction on wet ground for later expeditions; they are a reward, not a gate. A fresh player with 120 coins can buy a spade, sell the seal, and afford the waders. Shop prices, stock, sale, coin delta, and equipped appearance are authoritative.

## Safety and resource floor

- Keep the existing Greenway start, waystone, first shop, and practice mound safe and reachable on foot. A lost or delayed spade can be bought at either the Greenway shop or the outpost. No required tool, spell, material, or skill is located only beyond the obstacle it unlocks.
- Reserve at least five reachable harvestable trees worth 20 logs across the southwest approach pockets. The current content generator pins six candidate trees worth 24 logs, three before the fen bridge and three between the bridge and slate ladder. The maximum required route spend is 14 logs for an 8-log bridge and a 6-log slate ladder. Reachability and resource interaction still require gameplay validation; do not count blocked, submerged, or depleted nodes toward the acceptance floor. Stage the trees so the 20-item backpack need not hold all logs at once.
- Across accepted seeds, provide at least two usable sites for each new crossing. Each site has dry support, safe endpoints, a clear preview footprint, and a standable build approach. A failed or cancelled build spends nothing. A completed crossing cannot become a one-way drop or remove the only return path. The cache and vendor remain reachable after any legal site choice.
- Keep the route free of mandatory combat, boats, mounts, flight, and irreversible hazards. Crossing an unloaded or unvalidated chunk pauses movement safely. Critical interactions remain reachable in third person and with touch controls.

## Completion proof and observables

This pack is ready for player exposure only when the streamed foundation and its compatible save migration pass, then the following region checks pass:

1. Across a predeclared corpus of at least 100 seeds and shuffled chunk activation orders, legacy Greenway cells remain exact, every stable ID and authored terrain overlay regenerates identically, the dry southwest connector and 12-chunk wetland core have no abrupt seam, every critical landmark is reachable, and both crossings retain at least two eligible sites. All corpus seeds must pass; invalid seeds outside the corpus never enter the playable profile. Activation stays within a 3 by 3 chunk window and terrain presentation within a 17 by 17 cell window.
2. A fresh-save real UI journey records the 30 to 45 minute path above. The map shows local discovery, the spell reveals rather than prediscovers the cache, gear changes on the avatar, site previews show their costs, built routes match chosen sites, the dug cache changes appearance, and the vendor shows the regional price and coin change.
3. Close and reload at the outpost and after crossing a chunk boundary. Persist the spell, skills, chosen route IDs and endpoints, resource depletion, excavation, item ownership, sale, coins, and visible equipment through sparse deltas. Revisit after chunk eviction without a duplicate reward, lost crossing, terrain pop, or rewritten legacy save.

Passing this first-region pack proves an expedition in one distinctive area. The connected roughly 2 km world, additional regions, fuller economy, camps, boats, ground mounts, rare flying mounts, campaign, and endgame remain the separate full-game gate.
