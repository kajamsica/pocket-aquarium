# Games

This repository contains independent game packages that share production methods, not runtime code.

- [Pocket Aquarium](pocket-aquarium/README.md), the shipping aquarium product. Its engine remains the default Pages and native build.
- [Wizard Realms](wizard-realms/README.md), a third-person fantasy RPG systems vertical slice with a deterministic seeded world.

Each game owns its engine under `games/<game>/engine`. A shared engine package is intentionally deferred until two games prove the same reusable implementation contract.
