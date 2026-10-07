# Wizard Realms

> **Working title:** Wizard Realms is a project name, not a final product or trademark decision.

Wizard Realms is a third-person fantasy RPG about arriving alone in a vast, seeded world and gradually learning how to live within it. The player explores distinct climates, gathers local resources, fells trees, makes and improves tools, trades in regional stores, equips practical and magical gear, and discovers mushroom fairy rings that reconnect places they have already reached. The immediate goal is a rich single-player adventure with readable, colorful stylized art. Its simulation contracts are designed so a later multiplayer realm can replace local authority without replacing the game.

## Project boundary

- Wizard Realms engine: `games/wizard-realms/engine`
- Game package: `games/wizard-realms`
- Pocket Aquarium sibling game: `games/pocket-aquarium`
- Pocket Aquarium engine: `games/pocket-aquarium/engine`
- Reusable development playbook: [Simulation-Rich Game Development Playbook](../../docs/game-development/README.md)

Each game owns its engine. The games share architecture laws and production methods, not a runtime package. Extracting shared runtime code is deferred until both engines independently prove the same reusable implementation and compatibility contract. Wizard-specific world rules, content, progression, UI vocabulary, and assets belong in this package.

## Quick start

```sh
cd games/wizard-realms/engine
npm ci
npm run dev
```

Open the local URL printed by Vite. The current vertical slice uses the deterministic seed
`greenway-alpha`, saves committed state in local browser storage, and includes third-person movement,
pivot, jump, drag-orbit camera control, harvesting, stores, equipment, four trade-listing slots, and
fairy-ring travel. A north-up map tracks authoritative discovery. The current progression route spends
4 logs on the Greenway ladder, then unlocks a 6-log Highland bridge at level 2. These two profiled
projects are the only construction in the slice.

Run deterministic tests and make a production build with:

```sh
npm test -- --run
npm run build
```

This is an honest systems vertical slice. Combat, spells, quests, NPC AI, free-form building, and
multiplayer are deliberately outside this build.

## Design documents

- [Game Design](docs/GAME_DESIGN.md): player fantasy, world, loops, progression, economy, accessibility, and release boundaries.
- [Scaling Architecture](docs/SCALING_ARCHITECTURE.md): authority, deterministic world generation, persistence, transactions, networking evolution, and measurable capacity gates.

## Inherited methods

Wizard Realms adopts the repository's existing game-development contracts rather than inventing a second production method:

- [Foundation and Architecture](../../docs/game-development/FOUNDATION_AND_ARCHITECTURE.md)
- [Realism, Behavior, and Physics](../../docs/game-development/REALISM_BEHAVIOR_AND_PHYSICS.md)
- [Asset and Animation Pipeline](../../docs/game-development/ASSET_AND_ANIMATION_PIPELINE.md)
- [Product Tooling, Validation, and Release Operations](../../docs/game-development/PRODUCT_TOOLING_AND_VALIDATION.md)
- [Reusable Specification Templates](../../docs/game-development/REUSABLE_SPEC_TEMPLATES.md)

These documents are design contracts. They do not claim that networking, combat, questing, free-form building, controller completion, or touch completion already exists.
