# Simulation-Rich Game Development Playbook

This playbook explains how to build a detailed, broad, believable game without letting simulation, rendering, content, tools, and release work collapse into one fragile system. It is for product owners, game designers, simulation engineers, technical artists, gameplay engineers, UI engineers, test engineers, and agents working together on the same product.

The method is universal first. Pocket Aquarium appears as a labeled case study because it produced concrete lessons about ecosystem simulation, animal behavior, 3D assets, creator tools, mobile interaction, persistence, and native packaging. Freshwater aquariums and an open-world wizard game appear only as transfer examples. They are not separate specifications.

## How to read claims in this suite

Every project claim uses one of these labels:

- **Observed in Pocket Aquarium:** Directly supported by repository code, tests, history, or a revision-bound receipt.
- **Observed failure:** A concrete failure supported by the same evidence.
- **Observed recovery:** A concrete repair and its surviving contract.
- **Recommended reusable method:** The target practice selected from those lessons. It may be stronger than the current implementation.

Do not turn a recommendation into a claim about current code. Do not treat an observed implementation as ideal merely because it exists.

Normative words are deliberate:

- **MUST** means the condition is required for architectural integrity, reproducibility, or an honest promotion claim.
- **SHOULD** means the condition is the default and needs a recorded reason to waive.
- **MAY** means the choice is optional within the surrounding contracts.

## The suite

| Document | Use it to answer |
|---|---|
| [Foundation and Architecture](FOUNDATION_AND_ARCHITECTURE.md) | What owns truth? How do data, simulation, spatial services, presentation, tools, persistence, and release fit together? |
| [Realism, Behavior, and Physics](REALISM_BEHAVIOR_AND_PHYSICS.md) | How do fixed time, physics, locomotion, typical behavior, contact, interaction state machines, and animation signals work? |
| [Asset and Animation Pipeline](ASSET_AND_ANIMATION_PIPELINE.md) | How do evidence, Blender, body plans, rigs, candidates, the workbench, human approval, promotion, and rollback work? |
| [Product Tooling, Validation, and Release Operations](PRODUCT_TOOLING_AND_VALIDATION.md) | How do player, showcase, developer, mobile, editor, web, and native surfaces share mechanics and earn release confidence? |
| [Reusable Specification Templates](REUSABLE_SPEC_TEMPLATES.md) | What schemas, receipts, worksheets, gates, and repeatable checklists should a team copy into a new project? |

## Use the playbook in this order

1. Read [Foundation and Architecture](FOUNDATION_AND_ARCHITECTURE.md) and name the one authoritative world model.
2. Write the player fantasy, canonical player journey, typicality targets, evidence policy, target devices, and non-goals.
3. Define stable content, state, command, event, persistence, asset, and release identities before scaling production.
4. Build a headless deterministic world skeleton with one meaningful lifecycle loop.
5. Expose the smallest honest playable surface and keep it available while validation continues separately.
6. Add deterministic spatial services and behavior families through [Realism, Behavior, and Physics](REALISM_BEHAVIOR_AND_PHYSICS.md).
7. Produce one gold-standard body plan or archetype through the complete method in [Asset and Animation Pipeline](ASSET_AND_ANIMATION_PIPELINE.md).
8. Generalize the creator pipeline only after the representative asset works in the real player surface.
9. Expand behaviors and content behind frozen contracts, with exclusive ownership for each candidate tree.
10. Complete player journeys, persistence, mobile controls, observability, packaging, and platform gates through [Product Tooling, Validation, and Release Operations](PRODUCT_TOOLING_AND_VALIDATION.md).
11. Use [Reusable Specification Templates](REUSABLE_SPEC_TEMPLATES.md) at every promotion and release boundary.

## Ground-up execution sequence

| Stage | Build | Exit evidence |
|---|---|---|
| 0. Product truth | Fantasy, canonical journey, typicality, evidence policy, target device, non-goals | Written goal and authority contract |
| 1. World skeleton | Serializable state, fixed clock, seeded randomness, typed intents and events, save schema | Golden replay and save/restore pass |
| 2. Vertical slice | One environment, one entity, one action, one lifecycle consequence, one player surface | A player can complete the smallest meaningful loop |
| 3. Spatial backbone | Collision world, support graph, neighbor index, reduced-order fields, interpolation | Deterministic spatial scenarios and device budget pass |
| 4. Gold asset | Evidence packet, source, rig, clips, workbench, validation, approval, promotion | One archetype passes every asset gate in world |
| 5. Creator platform | Semantic editing, candidate service, generic promotion, rollback, diagnostics | A second distinct item succeeds without a special path |
| 6. Behavior breadth | Behavior families, special interactions, lifecycle visuals, compatibility consequences | Typicality scenarios and player journeys pass |
| 7. Content expansion | Parallel evidence and candidate production | Per-item automated and human receipts, within device budgets |
| 8. Product completeness | Onboarding, HUD, economy, accessibility, orientation, persistence, mode parity | Canonical desktop and touch journeys pass |
| 9. Platform release | One immutable build through web, native, internal device, and store gates | Signed device and store receipts for the same digest |
| 10. Live evolution | Telemetry, migrations, balance, incidents, rollback | Revisioned post-release acceptance |

Do not expand content while the canonical journey is broken. Do not parallelize shared authorities merely to increase worker count. Do not call a build published until the corresponding distribution gate has passed.

## Minimum project-start contract

Before implementation begins, the team MUST be able to answer:

- What exact player experience is the product trying to produce?
- Which facts can change a later outcome, and which one system owns them?
- What is the fixed causal clock?
- Which parts are evidence, which parts are game calibration, and which parts are display only?
- What does accurate or typical portrayal mean for each important entity or archetype?
- What is the smallest complete player journey?
- What data must survive save, reload, another open view, and a content revision?
- Which artifact digest is being reviewed, promoted, packaged, and released?
- Which automated gate and which human gate apply?
- Who owns each shared interface and exclusive-write surface?

If any answer is missing, the team SHOULD resolve it before broad asset or feature fan-out.

## Working rules

- One fact MUST have one authority.
- Gameplay consequences MUST advance on deterministic simulation ticks, not render frames.
- Scenes and HUDs MUST consume read-only projections and issue typed intents.
- Evidence and game calibration MUST remain separate, versioned records.
- Behavior MUST use named families plus entity profiles, with unknown classifications failing closed.
- Physics MUST resolve intended motion before animation reports realized motion.
- Creator edits MUST be drafts until explicit validation and commit.
- Generated content MUST remain a candidate until automated checks and human review approve the same digest.
- Player, showcase, developer, workbench, compact, wide, web, and native surfaces MUST share core mechanics.
- Every accepted repair MUST leave a durable test, threshold, digest, or human acceptance record.

## Pocket Aquarium evidence boundary

**Observed in Pocket Aquarium:** At evidence revision `a2f65b788faa89dce59fb0bf826547f96648da83`, [`js/sim.js`](../../js/sim.js) owns deterministic ecosystem state, [`realistic_light_transport/src/App.tsx`](../../realistic_light_transport/src/App.tsx) owns production scheduling and persistence, and [`pocketAquariumBridge.ts`](../../realistic_light_transport/src/integration/pocketAquariumBridge.ts) projects that state into the React and Three.js player surface.

**Observed gap:** Consequential spatial causes such as locomotion and several contacts still cross a frame-driven renderer boundary. The active workbench proves inspection, not catalog-wide semantic editing or generic atomic promotion. The Android evidence at revision `dd987d3169e0f0b33012c74f12858f86c3a3736b` proves a debug APK path, not a signed Play Store release.

**Recommended reusable method:** Preserve the mature deterministic domain model, extend its authority to spatial continuation and contact, keep presentation local to assets and adapters, promote immutable candidates, and move one compiled product digest through explicit platform gates.

## Transfer test

A reusable contract should survive a theme change:

| Contract | Freshwater example | Wizard open-world example |
|---|---|---|
| World model | Chemistry, planting, filtration, inhabitants | Time, resources, factions, quests, mana ecology |
| Environment envelope | Hardness, temperature, current, vegetation, substrate | Biome, weather, terrain, elevation, magic field |
| Behavior family | Schooling, bottom dwelling, grazing, plant growth | Humanoid navigation, patrol, mount, vendor, combatant |
| Interaction state machine | Spawning site, grazing, shelter use | Dialogue, spell preparation, combat, crafting |
| Workbench | Fish, plant, and hardscape laboratory | Character, creature, spell, prop, and biome laboratory |
| Draft editor | Planting and hardscape layout | Terrain, building, loadout, and spell configuration |

The content changes. Authority, time, projection, candidate, approval, persistence, and release contracts remain.
