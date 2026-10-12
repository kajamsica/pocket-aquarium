# V30 first-region journey understanding

## Original Ask

Build Wizard Realms into a complete third-person single-player wizard RPG across a connected roughly 2 km world. The first proof gate is an outward-and-return Greenway and Mireglass journey with learned magic, visible gear, building, digging, gathering, trade, and save/resume. A short technical preview is not completion.

## Input PRD / Spec

`GAME_DESIGN.md`, `FIRST_EXPANDED_REGION_CONTENT.md`, and the current V24 through V29 public-world packs. The older Mireglass content document reports a completed V7-era fresh journey; the V24 public integration pack and newer game-design status do not establish the same journey on the current V29 authority and UI.

## Aligned Problem Statement

The current V29 browser journey proves the local Greenway dig, pick, sale, and reload loop. It does not prove that a new player can discover the connected Mireglass expedition and complete its return trade on the current public world. Before adding another mechanic or declaring gate 1 ready, run a fresh, isolated, UI-only early smoke to find the first player-visible blocker in that outward-and-return route.

The first V29 route probe stopped at the upper starter cliff lip because its cue incorrectly demanded another ladder. V31 corrected that message and the starter guide. A fresh UI retry climbed the saved ladder, backed away from the lip, traveled west to x about -26.8, z -11.8, and reloaded without losing progress. V32 separately proved the starter river bridge crossing from a fresh save. Neither result reaches Mireglass, so the next evidence step is a same-entry continuation beyond the repaired lip, not another Greenway implementation guess.

## Goals

- Observe the current V29 first-session route without source-coordinate coaching.
- Determine how far a fresh player can progress from Greenway toward Mireglass using visible controls and cues.
- Capture the first decision-bearing blocker, or a clear marker/expedition/return milestone if no blocker appears.
- Preserve the live preview and all user saves while testing in one isolated browser profile.

## Non-Goals

- This probe does not implement a fix, revise save schemas, publish a PR, or claim the full game complete.
- It does not use dev teleportation, direct domain calls, or source-derived map coordinates as substitute player actions.
- It does not open multiple WebGL renderers.

## Constraints

- Use `http://127.0.0.1:5193/?publicWorld=v29` and the current `/private/tmp/pa-wizard-playable-v2` checkout. Confirm reachability before the browser run.
- Keep the existing preview server running and close the isolated test renderer at the end.
- Preserve V24 through V29 source bytes and the dirty worktree. No GitHub action is authorized.
- User-facing prose uses no em dashes; any later GitHub action requires gh-bioscopics, Bioscopics identity, and `ben/` branches.

## Success Criteria

An early-smoke receipt names the exact visible steps, first blocker or milestone, screenshot, browser console/network health, and whether the world reopens unchanged. The receipt must distinguish failure of player guidance from failure of movement, authority, or save, rather than inferring cause from appearance alone.

## Open Questions

- Does a fresh V29 character discover and reach the Mireglass connector without source hints?
- Are Greenway route materials, ladder and bridge placement, and the waystone legible enough to get there?
- If the marker is reached, which Mireglass interaction first fails or becomes unclear?

## Implementation Risks

- Prior V7 proof may not transfer to V29 due to newer movement, river, store, and save gates.
- A long browser run can consume RAM. One renderer and a first-blocker stop rule bound this probe.
- A timed-out browser control is not by itself evidence of a product failure; inspect the visible state before retrying.

## Routing

- Goal status: aligned with the active full-game contract.
- System Translation Routing: `not_qualified`. This is a current-game UI evidence probe, not a whole-system migration.
- System Translation Receipt: `not_applicable`.
- Product agent runtime: `not_required`. The shipped game does not run an agent or model for this journey.
- Ordinary integration: sufficient, no new architecture contract is needed for an evidence-only run.
