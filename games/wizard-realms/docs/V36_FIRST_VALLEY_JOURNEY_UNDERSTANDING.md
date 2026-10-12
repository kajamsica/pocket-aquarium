# V36 first-valley journey understanding

## Original Ask

The standing Wizard Realms goal is a complete third-person single-player wizard RPG, not a short slice. The user specifically wants a starting valley in which visible terrain remains traversable except for meaningful obstacles. Trees should yield materials and obvious next uses, boots unlock faster travel, a ladder opens the cliff, and a bridge opens a continuous river. Digging should be location- and depth-sensitive, persistent, and recoverable if a pit truly traps the player. The overall feel should approach a polished exploration RPG rather than a clunky grid demo.

## Aligned Problem Statement

The current V29 preview has checked pieces of that loop, but the shortest novice journey through gathering and route building has not been proven from the real UI. V35 proved the first spade dig and checked one-layer pit traversal in simulation; it did not prove intuitive pit navigation or rescue from the UI. The next decision is which *first visible player-flow blocker* most limits the opening valley, and whether any failure is in UI affordance, route authority, or a transient isolated-browser save profile.

The user's intended opening geography is a small, legible valley with trees, a store, a cliff, and a river. The valley is not a permanent pen: logs become a cliff ladder or river bridge, while boots make movement more rewarding. If distant terrain is rendered as reachable, walking toward it must either work or explain the physical obstacle and the next tool. A river should be a continuous watercourse, connecting through the world or into another water body, not a short artificial barrier. The player should learn this by play, not by consulting coordinates in a large map help panel.

Digging is a spatial action: equipping the spade should expose diggable ground, and clicking a nearby ground location should check that exact column. Depth and location determine soil, stone, and rarer materials; neither ore nor a specific reward is guaranteed. Excavation visibly changes and saves the terrain. Later actions can refill terrain and place a route out of a pit. A trapped player needs a safe Return Home action with a 30-minute cooldown. These are acceptance targets for the continuing game, not claims that the current UI already delivers them.

## Goals

- Observe a fresh player, using only visible instructions and controls, equip the axe, chop nearby oaks, understand the log choices, build the north ladder or South creek bridge, and attempt to traverse the chosen route.
- Record the first decision-bearing failure with exact visible cue, map/position, screenshot, console/network, and source revision. If the route succeeds, continue only far enough to establish one real saved route and a same-tab reload/resume.
- Independently trace route guidance, checked route construction, movement edge, and persistence owner so the first failure can be mapped to a bounded repair rather than a speculative terrain rewrite.

## Non-Goals

- This evidence pack does not modify production code, snapshots, migrations, world size, camera controls, assets, or economy.
- It does not claim the full ~2 km campaign, endgame, mounts, boats, market, or escape journey is complete.
- No GitHub write, PR, commit, or push is authorized by this continuation.

## Constraints

- Reuse `/private/tmp/pa-wizard-playable-v2`, branch `ben/wizard-playable-v2`, preserving the broad dirty and untracked worktree.
- Keep `http://127.0.0.1:5193/?publicWorld=v29` available to the user. Use at most one isolated WebGL renderer and close it after the UI probe. Do not create a second preview server.
- The novice UI lane must not read source-derived coordinates or inject browser storage, teleport, seed state, or skip gameplay; source lanes do not control its route before the first observation.
- If browser closing clears the isolated profile, do not classify that alone as a game save failure. Same-tab reload while the browser remains open is the product boundary to test.

## Success Criteria

- One real, bounded UI receipt reaches a saved ladder/bridge traversal or stops at the first reproducible player-facing blocker.
- Source receipts name the exact owner and distinguish product behavior from test environment behavior.
- The synthesis chooses a small in-scope repair or records a specific missing proof; it does not falsely upgrade simulation tests to UI acceptance.

## Open Questions

- Can a novice find and chop a tree, then see a coherent next use for four or eight logs without source hints?
- Can the built route be selected and crossed through ordinary controls without a misleading edge or vanishing terrain?
- Does same-tab reload restore the route and player state in the current browser, regardless of isolated-profile teardown?

## Implementation Risks

- Route and movement authority are versioned and saved. A causal repair may need more than copy changes and could cross a migration/compatibility boundary.
- A small map glyph, camera angle, or input cadence may be mistaken for a collision bug. Exact visible actions and checked response are required.
- One WebGL renderer can consume substantial RAM; no parallel browser sessions.

## Routing

- Goal status: aligned to the active full-game goal. This evidence pass is a milestone, not a redefinition of completion.
- System translation: not_qualified. This is native game evolution, not a whole-system port.
- System translation receipt: not_applicable.
- Product agent runtime: not_required. The game does not ship an agent/model runtime for this path.
