# Wizard Realms Game Design

## Status and intent

Wizard Realms is a working title and a design target. This document defines what the team intends to build. It does not describe a finished game.

The first product is a full third-person, single-player wizard RPG, not a 15-minute vertical slice. Completion means a sustained adventure across distinct regions, with discovery, practical magic, visible equipment, meaningful progression, expeditions, return and trade, and an endgame worth pursuing. The simulation and content boundaries may leave a credible path to cooperative play and persistent realms, but multiplayer and MMO delivery are not part of the current product goal.

### Full-game completion contract

The first expanded Mireglass journey is a playable milestone, not the finish condition. Call the single-player game complete only when a new player can progress through a sustained campaign and an endgame pursuit on a connected world of roughly 2 km scale, with all of the following proven in the shipped build:

- Distinct, navigable regions with discovery, readable maps, regional resources, settlements, and reasons to revisit them. Walking, built routes, fairy rings, boats, raised or captured ground mounts, and late-game flying mounts must each have a useful role and a tested progression path.
- Several learnable and practiced spells with uses in travel, exploration, making, and encounters. Skills must advance from committed actions and unlock meaningful options. Clothing, armor, tools, and magical equipment must visibly change the character.
- Material-driven placement of ladders, bridges, camps, and boats with preview, terrain validation, authoritative commit, and persistence. Digging must require an appropriate tool and skill, alter suitable terrain, and survive save and reload.
- Regional shops, inventory and equipment decisions, useful trade listings, and a bounded single-player market with prices that make gathering, making, return trips, and upgrades worthwhile.
- Original creatures, encounters, quests or mysteries, and a deliberate late-game challenge or stewardship goal that give the player more than a checklist of mechanics.
- A complete first-session tutorial by play, accessible controls and feedback, reliable recovery, acceptable performance on target hardware, and independent end-to-end proof of progression, travel, economy, save and resume, and endgame completion.

Online trade, shared persistence, PvP, and MMO scale are separate later releases. Passing the first 15-minute loop, or publishing a technical preview, does not satisfy this contract.

### Delivery gates toward the full game

These are proof gates, not substitutes for the full-game completion contract. Each gate must be playable in the same authoritative public world and must preserve earlier saves or provide an explicit, tested migration.

1. **Expanded-region proof:** A fresh player completes Greenway and the distinctive Mireglass expedition in the real UI, learning a spell, visibly changing gear, choosing and building both crossings, digging the seal cache, gathering a renewable herb, returning to trade, and resuming the same world after reload. Deterministic reachability and source-safe save recovery pass alongside the playthrough.
2. **Connected-world breadth:** Extend the traversable world toward the roughly 2 km target with multiple visually and mechanically distinct regions, legible exploration and map discovery, regional resources and settlements, several practiced spells and skill paths, equipment choices, camps, boats, and terrain-valid construction and digging. Revisit and return journeys must be useful, not just possible.
3. **Living progression:** Add original creatures, encounters, quests or mysteries, tool and armor progression, regional commerce and bounded trade listings, captured or raised ground mounts, and late flying mounts. Travel tiers must each retain a purpose. Long-session saves, migrations, and performance must hold across the connected world.
4. **Campaign and release proof:** A new player can reach and complete a deliberate endgame pursuit without developer intervention. Independent playtests verify first-session learning, sustained midgame decisions, endgame payoff, accessible controls, visual readability, save/recovery, and target-hardware performance. Only then is the single-player game complete; online systems are a separate product decision.

### Current implementation status

The public game currently proves a Greenway first-session path and a connected Mireglass expedition, with authored travel, gathering, route choices, a spell, equipment, and local trade. A separate experimental v9 entry adds one player-chosen Mireglass field camp without rewriting older saves. Independent playtesting has completed the Greenway relic sale, both fairy-ring discoveries, travel in both directions, save and reload, and the explicit v7 to v8 to v9 upgrade. A fully unassisted v9 UI run reached suitable camp ground before the fen bridge, chose a tile, spent exactly 4 logs and 1 stone, gained 30 construction XP, and resumed the same tent and map marker after save and reload. The latest guidance also explains the camp and bridge material budget in the real HUD and map. The earlier cross-cliff ring shortcut is blocked in both Greenway and connected-world authority with regression tests. An independent UI retest also found no cliff-top ring action and confirmed the reachable Greenway-side ring action. Leave-and-return camp persistence, the complete Mireglass-to-trade journey, and long-session stability remain open. This is progress within gate 1, not a full-game release.

The roughly 2 km world, multiple practiced spell paths, terrain-wide construction and digging, boats, creatures and quests, mounts, late flight, a sustained economy, endgame, and release proof remain open work. Each completed slice must leave the older save lineage intact or provide an explicit, tested migration.

The design inherits the authority, behavior, asset, tooling, and validation methods in the [Simulation-Rich Game Development Playbook](../../../docs/game-development/README.md). In particular:

- [Foundation and Architecture](../../../docs/game-development/FOUNDATION_AND_ARCHITECTURE.md) defines one authority, fixed causal time, typed intents and events, projections, content profiles, and explicit promotion.
- [Realism, Behavior, and Physics](../../../docs/game-development/REALISM_BEHAVIOR_AND_PHYSICS.md) defines navigation, locomotion, interaction state machines, realized-motion animation, and deterministic scenarios.
- [Asset and Animation Pipeline](../../../docs/game-development/ASSET_AND_ANIMATION_PIPELINE.md) defines evidence, morphology, rigs, semantic clips, workbench review, promotion, and rollback.
- [Product Tooling and Validation](../../../docs/game-development/PRODUCT_TOOLING_AND_VALIDATION.md) defines player surfaces, creator surfaces, input grammar, diagnostics, validation, and release evidence.
- [Reusable Specification Templates](../../../docs/game-development/REUSABLE_SPEC_TEMPLATES.md) supplies the records used for biomes, entities, interactions, assets, simulations, tests, and promotion.

## Player fantasy

The player is a young wizard dropped into an unfamiliar world with simple clothing, a worn backpack, a basic tool, and a small amount of coin. Knowledge is earned through travel and practice. A distant tree line may conceal rare timber, a wet valley may support different herbs than a dry plateau, and a strange mushroom ring may become a permanent route home only after the player reaches and studies both ends.

Magic is part of the world, not a menu pasted over it. The player learns by observing, collecting, crafting, trading, and eventually solving dangerous problems. The tone should reward curiosity and preparation more than rushing toward a single prescribed quest.

## Product pillars

1. **A world worth reading:** Climate, terrain, vegetation, creatures, materials, settlements, and weather should make each region legible before the map label does.
2. **Actions leave useful consequences:** Gathering changes inventory and local availability. Tools wear and improve. Discovery opens routes. Trade changes purchasing power.
3. **Progress comes from practiced life:** Exploration, woodcutting, gathering, crafting, tool use, commerce, and magic each produce relevant skill growth.
4. **Readable fantasy:** Silhouettes, colors, effects, landmarks, and interaction affordances remain clear from an over-the-shoulder camera and at modest hardware budgets.
5. **One game at every scale:** Single-player rules must not be throwaway rules. Later servers may own them, but must not redefine them.

## Visual direction

The visual target sits between the immediate readability of classic RuneScape and the color richness and welcoming fantasy mood associated with World of Warcraft. This is a directional comparison only.

The game must not copy either game's assets, user interface, lore, characters, names, maps, architecture, creatures, quests, iconography, or world design. Original forms and a distinct visual language are required.

Practical art principles:

- Use strong silhouettes and restrained geometry before surface noise.
- Give each biome a controlled palette, atmospheric profile, landmark grammar, and material family.
- Keep interactable resources recognizable without making every object glow.
- Use saturated accents against calmer terrain and architecture.
- Prefer authored modular kits over undirected procedural visual clutter.
- Drive animation from realized motion and interaction state.
- Validate assets in a runtime-equivalent workbench and then in the actual world.

## World structure

### Procedural world contract

Each new world is derived from an immutable world seed plus pinned generator and content versions. Procedural generation produces geography and opportunities, while authored rules preserve quality and playability.

A generated region must declare:

- climate band and seasonal tendency;
- terrain forms, elevation range, soil, water, and traversal constraints;
- resource families and regeneration rules;
- plant, creature, settlement, shop, and encounter eligibility;
- landmark density and at least one navigation identity;
- weather probabilities and visibility effects;
- links or boundaries to neighboring regions;
- validation results for reachability, resource sufficiency, and safe starting conditions.

Generation may select, combine, and place authored content. It must not invent unsupported rules at runtime.

### Initial biome set

The vertical slice needs one temperate woodland and a neighboring meadow or river edge. The full single-player game can expand through:

- temperate woodland with common timber, mushrooms, herbs, and small settlements;
- wetland with reeds, medicinal plants, bog resources, mist, and difficult ground;
- highland with stone, ore, wind, sparse trees, and long sightlines;
- dry scrubland with heat pressure, hard timber, mineral outcrops, and scarce water;
- cold forest or alpine region with snow, conifers, ice, and specialized equipment needs;
- magically altered region with unusual ecology and late-game resources.

Every biome needs authored identity tests. A palette swap is not a new biome.

### Region identity

A region should be recognizable through at least four channels: silhouette, material and color, ambient audio, and resource or activity mix. Weather and inhabitants reinforce the identity but should not be its only signal.

## Core interactions

### Explore and discover

The player travels in third person, reads terrain, marks or names useful locations, discovers settlements and fairy rings, and gradually replaces uncertainty with a reliable personal map.

Discovery is authoritative state. A location is discovered only after the player crosses its validation volume or completes its discovery interaction. Seeing a distant landmark is not sufficient unless a content profile explicitly permits sight discovery.

### Gather and chop

Resources expose typed interactions such as inspect, gather, chop, mine, harvest, or collect. Each interaction checks tool, skill, capacity, range, state, and cooldown before committing a result.

Tree chopping is the representative vertical-slice interaction:

1. The player identifies a harvestable tree.
2. The world validates the equipped axe, reach, tree state, and action cadence.
3. Realized strikes advance deterministic harvest progress.
4. The committed result produces logs, tool wear, woodcutting XP, and a changed tree state.
5. Regrowth or replacement follows the biome's resource profile.

The renderer may show anticipatory movement and impact effects, but it never grants logs or XP.

### Tools and making

Players can buy, find, maintain, improve, and eventually craft tools. A tool profile defines legal actions, efficiency, durability, handling, quality, repair rules, and presentation assets.

The first tool set should stay small: axe, pick, gathering knife, and simple magical focus. General building systems are later than basic tool production. The current slice proves two bounded route recipes. The first expanded region must let players choose valid ladder and bridge placements based on terrain and carried materials; fixed project endpoints are only a foundation milestone.

### Building and placement

Later single-player milestones add bounded camps and regional projects after the world has transactional editing. Placement must follow `begin -> preview -> validate -> freeze -> commit or cancel`. Preview geometry cannot consume materials, alter terrain, or create collision until commit.

Construction checks land permissions, support, overlap, resource ownership, biome restrictions, and a safe rollback path. Free-form building, shared claims, and large settlements remain outside MVP.

The current vertical slice proves two profiled regional projects with selectable, validated sites. The Greenway ladder costs 4 logs and grants 60 XP. It opens the northern ridge. At level 2, completing that ladder unlocks the Highland bridge, which costs 6 logs, grants 80 XP, and opens the eastern highland and Highland Arcanum. Chosen endpoints persist and traverse authoritatively in both directions. This is not yet terrain-wide free placement, camps, boats, or a general building system.

### Shops

Settlements provide stores with themed inventories, buy and sell rules, opening conditions, stock refresh rules, and local price modifiers. The world authority validates every purchase or sale. The store UI is a projection of authoritative stock, player inventory, and coin balance.

Vendors should support regional identity. A highland smith and a woodland provisioner should not carry the same stock with different labels.

## Player systems

### Backpack and capacity

Inventory uses stable item identities and stack rules. Capacity has two dimensions:

- slots limit the number of distinct carried stacks or objects;
- encumbrance limits total carried mass or bulk.

A soft encumbrance band may reduce sprint duration or stamina recovery. A hard capacity limit rejects new pickups with a clear reason. Quest-bound or safety-critical items need an explicit recovery policy rather than hidden exemptions.

Backpack upgrades can add capacity, organization, or specialized storage. They must not bypass authoritative item ownership.

### Money

Coins are authoritative ledger value, not a UI counter. Purchases, sales, fees, rewards, and recoveries emit exactly-once economy events. The initial game may use one currency. Additional currencies require a separate design decision.

### Trade listings

Each player begins with exactly four trade-listing slots. A listing escrows owned items until sale, cancellation, or expiration. In single player, listings can interact with a bounded simulated market. In later online realms, the economy service becomes the listing authority without changing the player's listing workflow.

Increasing listing capacity is progression, not a client preference. No UI may create a fifth active listing unless authoritative progression allows it.

### Experience and skills

Skills increase through relevant committed actions. Initial skill families:

- exploration;
- woodcutting;
- gathering;
- mining;
- crafting and repair;
- commerce;
- practical magic.

XP is granted by committed domain events and should reward meaningful completion, not input spam. Levels unlock recipes, efficiency, safer access, equipment eligibility, or new interaction options. Numeric power growth should not erase biome preparation or player judgment.

### Equipment and armor

Equipment has explicit slots such as head, torso, hands, legs, feet, main hand, off hand, focus, and accessory. Content profiles define fit, protection, warmth, utility, magical properties, durability, and appearance.

Armor must trade protection against weight, cost, noise, heat, or magical handling. Cosmetic presentation is projected from equipped authoritative items.

## Fairy rings

Fairy rings are mushroom portals and a discovery reward. They are not unrestricted fast-travel points.

Rules:

1. The player must physically discover a ring before it can be used.
2. A destination must also be previously discovered by that player.
3. The player initiates travel while inside the ring's interaction boundary.
4. The authority validates player state, destination availability, cooldown, and any progression requirement.
5. Travel commits as one transaction. The player never exists authoritatively at both ends.
6. Failed travel leaves the player at the origin with no consumed cost.
7. The destination receives a readable arrival effect and a safe placement check.

Early play can introduce a dormant ring before activation, making the system a remembered mystery rather than an immediate convenience.

## Time, weather, and survival pressure

The world advances on a fixed simulation clock. Day and weather influence visibility, temperature pressure, resource availability, creature schedules, shops, and atmosphere according to content profiles.

The initial game should use mild preparation pressure, not a punishing survival meter stack. Weather asks the player to choose clothing, shelter, route, or timing. It should not routinely trap a new player in an unrecoverable state.

Offline time, pause, and resume need explicit policies. Presentation time may continue for menus or effects only when gameplay time is paused.

## Death and recovery

Death should interrupt progress without deleting the player's identity or learned skills.

Initial policy:

- return the player to the last safe anchor or settlement;
- preserve skills, discovered locations, bound equipment, and progression;
- place a recoverable field pack containing eligible carried items near the death location;
- protect the pack from unsafe placement and provide a fallback reclaim path after a timeout;
- apply explicit item durability loss or coin cost only if balance testing supports it;
- never let a reconnect or crash duplicate the player, pack, items, or coins.

The exact penalties are calibration, not foundation law.

## First-session loop

The first 30 to 45 minutes should prove the game's identity:

1. Wake at a safe woodland edge and learn third-person movement, pivot, jump, camera orbit, and interaction.
2. Inspect the backpack, starter coins, worn axe, clothing, and empty equipment slots.
3. Follow environmental cues to a settlement while collecting one herb and one fallen branch.
4. Meet a provisioner or craftsperson and learn the store transaction.
5. Chop one marked tree, receive logs and woodcutting XP, and see the tree's changed state.
6. Use a workbench to repair or improve the starter tool.
7. Sell surplus material or post one of four trade listings.
8. Discover a dormant fairy ring and a distant destination clue.
9. Open the north-up map, gather 10 logs, build the ladder and bridge route, and see fog clear only after authoritative traversal.
10. Save, reload, and resume with the same inventory, world state, discoveries, routes, and time contract.

This loop is the first vertical-slice acceptance journey.

## Midgame loop

Midgame alternates preparation, expedition, return, and investment:

1. Choose a region or resource goal.
2. Select tools, armor, supplies, and available carrying capacity.
3. Travel through known routes or a discovered fairy-ring link.
4. Explore, gather, face environmental or creature pressure, and discover content.
5. Return to sell, list, craft, repair, equip, and improve skills.
6. Spend progression on access, recipes, capacity, travel, and magical options.
7. Revisit changed regions and build a personal network of useful places.

## Endgame direction

Single-player endgame should emphasize mastery and world stewardship rather than one final stat ceiling. Potential directions include rare regional projects, advanced magical research, dangerous expeditions, settlement investment, high-tier crafting, collection goals, and restoration or transformation of altered regions.

The later MMO direction may add shared economies, social groups, contested or cooperative events, instanced challenges, and persistent regional projects. None of those systems belongs in the MVP by implication.

## Input and accessibility intentions

The first implementation should be keyboard and mouse first, with semantic actions that can later map to controller, touch, and assistive input without changing world intents.

Intended support:

- remappable keyboard and mouse actions;
- separate sensitivity, field of view, camera motion, and hold or toggle settings;
- readable interaction focus and non-color-only state cues;
- scalable text and HUD density;
- subtitles and directional audio captions where applicable;
- reduced camera bob, shake, flashes, and particle density;
- controller navigation and aim as a later validated input grammar;
- touch controls as a later compact interaction grammar, not a shrunken desktop HUD.

Controller and touch support are intentions only until real-device journeys pass.

## Scope boundaries

### MVP vertical slice

This is an early systems milestone, not the full-game completion condition. The current v5 Greenway build lets the player study a waystone to learn Wayfinder Glow, reveal nearby terrain and a hidden cache, gain woodcutting, construction, wayfinding, spellcraft, and excavation XP, excavate spade- and skill-gated sites, choose a valid ladder or bridge placement, and return to sell a relic at a shop. The expedition and nondefault site-selection flows have passed live UI journeys. The 16 by 16 profile is still only a roughly 64 m preview. The planned milestone also includes:

- one deterministic seed and one validated woodland region with a neighboring subregion;
- third-person movement, pivot, jump, camera orbit, collision, interaction focus, and pause;
- basic gathering and representative tree chopping;
- small backpack, capacity, coins, one store, and four trade-listing slots;
- a minimal XP and skill loop;
- starter tools, equipment, and armor data;
- day and one weather transition;
- one dormant or two linked fairy rings with discovery-gated travel;
- a compact and expanded fog-of-discovery map, plus player-selected sites for the Greenway ladder and Highland bridge projects;
- death and recovery;
- save, migration seed, replay, diagnostics, and one real player surface.

MVP excludes multiplayer, persistent remote realms, player combat, deep questing, free-form building, mounts, guilds, global chat, raids, controller completion, and touch completion.

### First expanded-region milestone

The next playable milestone must extend this foundation into one distinctive region large enough for an expedition beyond the current route demonstration. A player can discover and map its locations, use an exploration spell to reveal or interact with something in the world, see equipped gear change the character, gather materials and build a ladder or bridge at a valid player-selected site, and excavate a dig site only with the required tool and skill. The excavation and constructed route persist across save and reload. The player can return to a settlement and sell or list the expedition's finds. This complete outward-and-return journey is the milestone's acceptance proof, not the full-game finish.

[Mireglass Reach](FIRST_EXPANDED_REGION_CONTENT.md) is the first authored content pack for that milestone. Its southwest wetland systems are partly implemented in the local public world, but the complete fresh-player outward-and-return UI proof is still pending.

### Full single-player game

After the expanded region, completion requires:

- several validated, mechanically distinct regions and settlements, with authored quests, characters, creatures, magic, and regional goals;
- broader resources, tools, recipes, visible equipment, skill growth, regional shops, and single-player trade that deepen the economy before any online market;
- travel progression from walking and built routes through discovered fairy rings and boats to hard-earned ground mounts captured or raised by the player; rare, expensive top-tier flying mounts open vertical and distant routes without trivializing ground travel, while camps support longer expeditions;
- defensive magic and combat after separate interaction contracts pass, plus richer weather, day schedules, death recovery, and endgame projects;
- workbench, creator, accessibility, desktop, controller, and touch journeys as individually proven capabilities.

Full-game acceptance requires a connected, streamed world roughly 2 km across with at least three mechanically distinct regions. A fresh character must be able to finish an authored campaign and a repeatable endgame project; recorded journeys must exercise each travel tier, regional shops and single-player trade, and save/reload persistence for discoveries, equipment, built routes, excavations, and economy state.

The full single-player game does not require networked multiplayer or an online economy.

### Later multiplayer and MMO direction

Later milestones may add cooperative sessions, authoritative regional servers, persistent realms, social systems, player-to-player trade, shared events, sharding, and high population operation.

No MMO feature enters production until the measurable gates in [Scaling Architecture](SCALING_ARCHITECTURE.md) pass. Multiplayer scale must replace authority hosts, not fork game rules or trust the client.

## Design acceptance

The design remains aligned only if:

- third-person exploration and practical wizard progression remain the core fantasy;
- regions are mechanically and visually distinct;
- world changes follow typed, deterministic authority;
- backpack, coins, XP, equipment, shops, and trade listings survive save and replay;
- fairy rings connect only previously discovered locations;
- procedural generation is versioned and validated;
- the expanded region proves an expedition, persistent player-shaped access, a gated dig site, and return to trade;
- the product finish is a full single-player RPG across distinct regions, not the MVP slice or its two profiled construction routes;
- later network scale does not require replacing client presentation or redefining world rules.
