# V59 V31 first-region journey understanding

## Original Ask

Build Wizard Realms into a complete third-person single-player wizard RPG across a connected roughly 2 km world. The first proof gate is one distinctive region reached from the starter valley and returned from with magic, visible gear, routes, digging, gathering, trade, and save/resume. A working local preview is not the terminal condition.

## Input PRD / Spec

`GAME_DESIGN.md`, `FIRST_EXPANDED_REGION_CONTENT.md`, `STARTER_VALLEY_WORLD_LOOP_UNDERSTANDING.md`, and `V30_FIRST_REGION_JOURNEY_UNDERSTANDING.md`. The older Mireglass V7 UI receipt proves an earlier public profile, not the current V31 source-pinned chain.

## Aligned Problem Statement

V31 now has a checked, walkable one-layer soil lift, a connected river, route works, spade digging, deeper resources, gear, and saved migration. Its local soil UI journey, focused tests, and build passed. The complete fresh Greenway-to-Mireglass-to-return loop has not been observed on V31. A novice-facing route may still have an unclear or inaccessible connector despite local mechanics passing. Before inventing another feature or claiming the first-region gate, identify the first actual obstacle in that real UI journey and compare it with current source authority.

## Goals

- From a fresh isolated V31 save, follow only visible instructions through gathering, a north route or river crossing, and the first distinctive Mireglass marker or interaction.
- Identify the first decision-bearing blocker or show a real milestone, including exact action sequence, visible cue, screenshot, console health, and reload result where safe.
- Independently trace the current V31-inherited path to Mireglass and back, including resource, spell, trade, and save requirements, so a UI finding can be classified accurately without steering the novice tester.
- Keep the live V31 preview available, the dirty shared worktree intact, and only one automated WebGL renderer open.

## Non-Goals

- This evidence pack does not alter code, saves, movement, terrain, routes, or presentation.
- A single reached marker is not proof of the whole first region, much less the full campaign or endgame.
- No PR, commit, push, or GitHub action is authorized by this continuation.

## Constraints and success criteria

- Worktree: `/private/tmp/pa-wizard-playable-v2`, branch `ben/wizard-playable-v2`, with pre-existing extensive user/goal changes. Preserve all files.
- Real entrypoint: `http://127.0.0.1:5193/?publicWorld=v31`, currently HTTP 200. Use fresh isolated browser storage for UI evidence, never reuse or reset the user's save.
- The UI lane must not use source-derived coordinates, dev teleports, synthetic state, direct domain calls, or another browser renderer. It stops at the first decision-bearing failure.
- A valid evidence receipt records exact visible inputs and progression, screenshots, browser errors, whether a save reopened, and the first blocker or first Mireglass milestone. The source lane returns exact file/line support and distinguishes intended gates from mismatches.
- After the two receipts, repair only an identified small product owner. If no blocker appears, schedule the longer outward-and-return final proof. Continue the full-game goal either way.

## Open questions and risks

- Does the currently visible route guide enable a fresh V31 player to carry enough timber for the north ladder and connected-river bridge without a dead-end backtrack?
- Does the V31 movement and source-pinned save path still expose and preserve the Mireglass marker, spell, salvage, trade, and return route?
- A first load may take 20 to 30 seconds while checked ancestry is validated. A long wait is a known performance issue, not permission to skip source checking or claim an environment outage.
- The prior V31 local test did not validate the entire first region. Keep the result scopes separate.

## Routing

- Goal status: aligned with the durable full-game objective in this thread.
- System translation: `not_qualified`, this is current-game user-flow evidence, not a whole-system migration. Receipt: `not_applicable`.
- Product agent runtime: `not_required`, the shipped game does not execute an agent for this journey. Ordinary game UI/source review is sufficient.
- Existing-task coordination: no qualifying current child was found; current ephemeral children are completed under other role locks. Fresh ephemeral evidence workers are safer than interrupting or repurposing them.
