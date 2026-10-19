# V119 fresh-entry and breadth understanding

## Original Ask

The active user goal is a complete third-person single-player Wizard Realms RPG, not a vertical slice. The most recent explicit feedback approves the current hair direction as good enough. The next work must retain that decision while advancing a sustained campaign, connected roughly 2 km world, progression and endgame.

## Input PRD / Spec

`GAME_DESIGN.md` defines four delivery gates. `V115_FIRST_REGION_JOURNEY_RECEIPT.md` and `V118_HIGHLAND_SOURCE_TO_BUYER_PROOF_PACK.md` prove two substantial save-continuation journeys, but explicitly do not prove a fresh current-build novice run or full-world breadth. The active goal contract is the terminal condition.

## Aligned Problem Statement

Before adding another region or travel tier, distinguish two live uncertainties: whether a fresh player can actually begin and understand the current game through visible UI, and which connected-world/gameplay systems exist now versus only in design. Use those independent results to select the next bounded product change without mistaking the proven Highland loop for full-game completion.

## Goals

- Attempt a genuine fresh V32 player journey, starting with no imported or edited save, and capture the first usable action or first product blocker.
- Map the current connected world and travel/progression owners against the full-game gate 2 contract using current source, not stale design prose.
- Keep the accepted hair direction and the already validated V31/V32 save lineage unchanged.

## Non-Goals

- No new feature, PR, GitHub mutation, production deployment, or full-game-complete claim in this evidence pack.
- No resetting a user's or tester's existing saved adventure.
- No image generation or further hair iteration.

## Constraints

- The working tree is heavily dirty. Preserve all existing changes and all private browser checkpoints.
- Keep the user preview on port 5193 available. Use a separate isolated preview and one browser renderer for automated UI work, closing or unloading WebGL before memory approaches 1.2 GB.
- Browser validation uses visible controls. Source inspection may inform the next design decision, but must not become a hidden-state shortcut in the novice test.
- Any future GitHub work uses `gh-bioscopics`, the Bioscopics noreply identity, and `ben/` branches. This pack authorizes none.

## Success Criteria

- A real fresh-origin browser shows V32 entry, allows `Start new adventure`, and reaches an observable first player action or a precise, captured blocker with console/network evidence.
- A read-only source inventory identifies the current authored region extent, existing travel systems, and at least the highest-priority missing gate-2 seam with exact files/tests. It distinguishes implemented, design-only, and unverified behavior.
- Fan-in chooses a bounded next implementation or a causal repair; it does not infer broad completion from narrow evidence.

## Open Questions

- Can a novice identify and perform a first useful action without relying on prior knowledge of controls or a restored save? This requires a fresh UI probe.
- Is the next highest-leverage product change first-session guidance or a new region/travel tier? The UI and source receipts determine this.

## Implementation Risks

- A fresh V32 start builds a checked predecessor lineage and may be slower than a simple page load.
- Large IndexedDB exports can spike RAM if WebGL remains loaded. Prefer an isolated, fresh browser and unload WebGL before any necessary export.
- Existing design status prose is known stale relative to V32. Current code and live UI are authority.

## System Translation Routing

`not_qualified`: the task concerns the existing game and browser journey, not reimplementation across runtime/framework/host boundaries.

## System Translation Receipt

`not_applicable`.

## Product Agent Runtime

`not_required`: the delivered game does not execute an agent/model. Build-time Codex coordination is outside the shipped runtime.

## Goal Status

`aligned`: the active durable goal explicitly states the full-game terminal condition. This evidence pack closes only a next-step decision.
