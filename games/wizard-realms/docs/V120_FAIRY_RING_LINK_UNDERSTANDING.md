# V120 checked two-ring travel understanding

## Original Ask

The active goal is a complete connected, approximately 2 km third-person wizard RPG. The latest user response accepts the current hairstyle as good enough. V119 selected usable fairy-ring travel as the next bounded world-progress step, not as full-game completion.

## Input PRD / Spec

`GAME_DESIGN.md` requires discovery-led travel and durable saves. V119's fresh-player probe passed only entry, axe equip, first oak chop, and reload. V119's source audit found that V32's Greenway projection omits its ring, Mireglass's ring has no destination, and the current continuous session rejects cross-region teleport.

## Aligned Problem Statement

Make the existing Greenway and Mireglass fairy rings a discoverable, bidirectional shortcut only after the player has physically discovered both. Implement it in an opt-in V33 successor with checked action replay and complete V32 ancestry, expose it through the existing HUD panel, and prove a saved UI trip without changing V32 or pretending the broader world is finished.

## Goals

- Preserve the V32 root, its complete V31 ancestry, and every currently valid V32 action and save.
- Discover the Greenway ring by standing beside it and interacting. Retain the existing checked Mireglass discovery action.
- From either discovered ring, travel to the other only if both are discovered, source pose is grounded and within 3 m, source and destination tiles were actually revealed, and the arrival support is dry and valid.
- Save the new owner and arrival pose atomically, replay the exact witness, resume from the same position, and retain the existing HUD travel affordance.
- Keep the current V32 preview available and run any automated WebGL validation in one isolated renderer below 1.2 GB RSS.

## Non-Goals

No Highland ring, ferry rings, boat, mount, new region, new art, combat, online authority, anti-cheat claim, default-route switch, GitHub action, or PR in this pack. The first-region novice journey and full campaign remain open.

## Constraints

- The working tree has extensive pre-existing edits. Preserve every unrelated file, private checkpoint, and user browser save.
- The human requires `ben/` branches and Bioscopics Git identity for later GitHub work. None is authorized here.
- A V33 root must pin a complete checked V32 source receipt, use its own database, and reject stale/malformed ancestry and forged ring witnesses.
- V32's old cross-region rejection stays unchanged. V33 dispatches a checked action, not the old `teleport_fairy_ring` frame.
- The existing HUD panel is reused. Ring visibility must follow actual discovery and active visual tiles; no map leak.

## Success Criteria

1. V32 save migrates into V33 without mutating V32; fresh V33 entry also creates the full checked predecessor chain.
2. A ring cannot be discovered or used remotely, airborne, unrevealed, with an undiscovered destination, or with unsafe arrival support. A rejected action changes no saved state.
3. A legitimate two-ring V33 UI journey travels both directions, then reloads at the saved arrival. Existing movement, Highland extraction, digging, works, sale, and return-home actions remain available.
4. Focused tests prove strict root and successor replay, source mismatch/stale CAS, both travel directions and rejections, projection secrecy, and controller UI action routing. A real browser trip gives screenshot plus console/network evidence.

## Open Questions

No outcome-determinative product question remains. A test fixture for the final two-discovered-ring browser journey must come from a genuine prior UI save or visible play, not an edited IndexedDB root. If no suitable saved state exists, the tester must play the route or report final UI proof unproven.

## Implementation Risks

- Each save generation has strict replay and source pinning; writing into V32 would invalidate prior meanings. V33 must be additive.
- The V31/V32 controller adapters project newer progress through older runtime layers. A V33 ring action must flush pending movement, verify its writer reply, rebuild that adapter, and prove a subsequent movement/reload.
- `WizardHud` currently hides the ring panel while `starterCliff` is present; V33 requires an explicit opt-in view flag, not a global removal of that safeguard.
- Arrival must use effective V31 floor, not merely the raw ring object's Y coordinate. A pit, raised soil, or unsupported tile must reject before save.

## System Translation Routing

`not_qualified`. This is an additive feature within the same game engine and browser runtime, not a source-to-target platform migration. Receipt: `not_applicable`.

## Product Agent Runtime

`not_required`. Shipped Wizard Realms does not execute an agent/model; Codex workers are build-time coordination only.

## Goal Status

`aligned`: the current active goal states the full-game terminal condition. V120 is a bounded travel milestone.
