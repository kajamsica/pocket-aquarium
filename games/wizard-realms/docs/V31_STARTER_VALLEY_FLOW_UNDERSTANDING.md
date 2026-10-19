# V31 starter valley flow: aligned understanding

## Original Ask

The opening still feels clunky. If land looks reachable, walking should reach it; a real cliff or river should visibly explain the obstruction and suggest a ladder, bridge, or later boat. The player starts in a small valley with trees and a store, uses gathered logs and boots to make progress, equips a spade to reveal and click diggable ground, obtains materials according to location and depth, changes the ground persistently, places fill or a pit ladder to escape, and has a trapped-only Return Home action with a 30-minute cooldown. The river must be continuous and lead into another waterbody or span the world, not end arbitrarily.

## Input spec and existing evidence

- `GAME_DESIGN.md` and `STARTER_VALLEY_WORLD_LOOP_UNDERSTANDING.md` define the full-game contract and the earlier versioned valley implementation.
- V29 already has a connected west-to-east river, 4-log cliff ladder, 8-log river bridge, boots-gated running, spade auto-Dig mode with a hovered cell outline, checked location/depth strata, saved pits and fill, pit ladders, and a trapped-only home return with a saved 1,800,000 ms deadline.
- A fresh V29 UI probe built and climbed the starter ladder, then reached x about -24.9, z about -6.0 on the upper route. A 4.2-second forward hold did not move. The world showed apparently reachable green land while the cue said to build a cliff ladder, although the map showed the ladder already built. Save/reload retained the pose and ladder. Mireglass was not reached. See `V30_FIRST_REGION_JOURNEY_PROBE_PACK.md` and its M30-Q receipt.
- The single-renderer follow-up repeated the climb and then backed away from the lip, pivoted west, and walked from x about 1.8, z -6.1 to x about -29, z -12 on the upper shelf. This is not a global movement softlock. The cliff lip and the instructions fail to communicate the passable detour. The tester closed its renderer; the preview remains live.

## Aligned problem statement

The main gap is not a missing collection of isolated mechanics. The opening geography, movement, route previews, and context cues must tell one consistent story. The first concrete defect is a visible upper-valley route that stops and gives the wrong ladder instruction. Fix that observed failure first. Then verify that the already-built chopping, equipment, crossing, digging, and rescue systems form an intuitive first-session loop in the real UI. Do not reimplement existing mechanics just because their current presentation hides them.

## Goals

- Ordinary visible dry land is traversable. Where travel is prohibited, the world shows a physical cliff, water, or finite edge at the actual checked boundary.
- Contact with a cliff or river states one concise cause and the next useful action, without sending a player back to a route they have already built unless they actually need to use it.
- The starter valley offers enough accessible timber to choose both the first ladder and bridge, with the store, boots, spade, and dig affordance readable through play.
- Spade Dig/Fill, location- and depth-specific rewards, persistent holes, pit ladders, and home rescue are validated through an exact new-player UI journey, not only unit tests.
- The continuous river and each buildable crossing use the same canonical geography for rendering and collision.

## Constraints and non-goals

- The active goal is a full single-player RPG. This is an opening-region milestone, not completion.
- Keep existing V24 through V29 saved roots and replay semantics intact. If the movement authority must change, use a new versioned root and explicit migration or a replay-safe V29 input adapter whose persisted witnesses remain valid.
- Use one browser renderer, close it after tests, and leave the current preview available. Preserve the dirty worktree and user saves.
- No unrestricted voxel simulation, arbitrary water crossing, routine home teleport, MMO, GitHub action, or PR is authorized by this task.

## Success criteria

The exact M30-Q route no longer strands the player or misstates the remedy. A fresh player can recognize and pursue the ladder and bridge routes, dig a visibly targeted dry cell after equipping the spade, see the correct material and divot, recover from a true pit trap without bypassing the cooldown, and resume the same world with those changes. A topological river check and renderer/collision boundary agreement accompany the UI proof.

## Open questions and risks

- The upper shelf is traversable if the player stays north of the lip. The first bounded repair can correct the obstacle and starter guidance without changing movement authority.
- Can the present cliff mesh and movement boundary be made visually congruent without changing authority, or is a new versioned movement profile required?
- Bridge and ladder placement are still constrained to marked valid sites. The UI must reveal those sites naturally; this milestone does not silently promise arbitrary spans or cliff faces.
- A local wall clock cannot be anti-cheat proof for Return Home. The saved deadline is sufficient for the current single-player contract.

## Routing

- Goal status: aligned with the active full-game contract.
- System translation: `not_qualified`, ordinary game implementation inside the established engine. Receipt: `not_applicable`.
- Product agent runtime: `not_required`, the shipped game adds no agent or model runtime.
