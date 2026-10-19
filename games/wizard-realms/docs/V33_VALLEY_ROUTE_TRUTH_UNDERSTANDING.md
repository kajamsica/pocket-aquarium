# V33 starter-valley route truth

## Original Ask

The first valley should be explorable without invisible stops. The cliff and continuous river should be legible obstacles that teach chopping trees, acquiring boots, constructing a ladder or bridge, and eventually crossing into the next area. Equipping a spade should make nearby diggable ground evident and permit click-to-dig with location- and depth-dependent materials, persistent divots, filling, and a 30-minute trapped-player return-home.

## Aligned Problem Statement

The V29 simulation already owns most of these rules, but the visible journey does not reliably communicate them. A fresh browser player built the four-log north ladder and crossed into the streamed world, then arrived at a marked connected-river bridge with no logs. The panel and backpack still told them to build or climb the ladder, despite the saved ladder being behind them. That is an observed user-flow defect. The reported apparently walkable boundary needs a separate visual/collision probe before any terrain-authority change.

## Goals

- Keep the world continuous across the Greenway handoff and make stage-specific directions match saved route state and location.
- Tell the player before and after the north ladder that a connected-river bridge needs eight additional logs, and point them toward accessible oaks when short.
- Replace stale backpack help with river-stage help in the streamed world.
- Probe the first visually plausible blocked cliff/side route in the real V29 UI, with one renderer, before changing geometry or collision.
- Preserve the existing checked spade click-to-dig, strata, fill, pit ladder, and trapped-only 30-minute return-home behavior.

## Intended First-Valley Loop

The first valley is a small, readable playground, not a fenced tutorial room. The player can see trees, the Outfitters store, the high cliff, and the river. Chopping provides logs that can be sold or invested in routes. Boots unlock running. A four-log ladder opens the north shelf; an eight-log bridge opens the far river bank. The player may choose either order if resources and a marked, physically supported placement allow it. Each built route remains part of the same continuous world and save.

Where a path is blocked, its appearance and response must agree: a cliff face calls for a ladder, the river for a bridge or eventual boat, and a genuinely sheer rock return must look like rock rather than open ground. Discovered ground on the visible, apparently traversable side of a region boundary should never teleport, vanish, or become a hidden wall. This is a quality contract for subsequent geometry work, not a license for V33's copy lanes to change terrain authority.

The spade is an equipped interaction mode. A nearby revealed dry cell should show whether Dig can be attempted; clicking it sends only the cell location to checked geology. Soil, stone, iron, gold, and diamond depend on location and depth, with tool and skill gates. Each successful action lowers the saved column and adds material to the terrain bag. Fill places carried soil back into a saved pit. A pit ladder is the ordinary recovery route; return-home is a cooldown-limited last resort only when the simulation can prove the player is completely trapped.

The connected river runs across the current world and exits its edges. Future lakes, tributaries, and boats can enrich it, but the first-valley proof is a geographically continuous river with explicit supported crossings, not isolated water patches or invisible collision strips.

## Non-Goals

- No new mineral, river, boat, free-build, or hearthstone authority in this slice.
- No save schema, movement, terrain height, collision, or world-generation mutation based solely on this report.
- No PR or GitHub action without a separate request; no work-associated Git identity.

## Constraints

- Existing dirty worktree is user-owned. Preserve all unrelated files and do not reset.
- One WebGL renderer at a time; close the test browser after the receipt and keep the Vite preview live.
- No existing-save position/terrain change without explicit migration design and proof.
- Use `ben/` branch naming and Bioscopics identity if Git operations later become necessary.

## Success Criteria

1. A fresh player sees 4-log ladder and 8-log connected-river costs before spending the first four logs.
2. Beyond Greenway, neither guide nor backpack says to climb a ladder the player already climbed; with fewer than eight logs, both tell the player the river resource gate and a workable next action.
3. Existing lower-cliff and starter creek guidance remains correct.
4. One real UI probe captures the first visible blocked boundary with screenshot, rejection message, and whether the mesh visibly matches the stop. The result determines a later physical/presentation pack; it is not falsely claimed solved by copy.
5. Existing V29 dig and return-home contracts remain unchanged in this slice.

## Open Questions

- Is the user's apparently open boundary the valley rock return, a nonbuildable cliff face, or a streamed-world terrain/support edge? The UI probe discriminates these cases.
- Should the eventual return-home affordance be available outside provable traps? Current contract deliberately permits only genuinely trapped states; changing that is a separate design decision.

## Implementation Risks

- Treating world Z as proof of being on the original upper shelf is wrong after handoff to the streamed owner.
- Two help surfaces can contradict each other unless both are tested on the same saved-stage projection.
- Broad terrain edits would violate saved-world authority and mask the observed guidance bug.

## Follow-on Evidence, Not V33 Scope

- The V25 river is a connected wet-cell path across every world X column. Visible water is restricted to discovered cells, so a fog edge is not a river endpoint.
- V29 already couples an equipped spade to click-to-dig, checked strata, persistent 0.4 m divots, soil fill, and a trapped-only return-home with a 30-minute cooldown. The remaining questions are discoverability and first-person feedback, not whether the rules exist.
- The V29 primary objective currently favors mining over the tree-to-route journey. The full-pack guide also says terrain materials cannot be sold, although V29 permits sales. A dig success toast names a cell but not its yield or depth. These are candidates for a later onboarding/feedback pack.
- The V26 rim collider and mesh share the same segment endpoints, but rock facets depend on revealed terrain. A source-level calculation for the default seed found the closed north cliff crest at x=0, z=-6 about 0.031 m below the upper walkable ground. That is a concrete visual-height defect before the center ladder opens an aperture, but it does not identify the player's reported blocked edge. A view-only fix should await the real pose and screenshot.

## System Translation Routing

`not_qualified`: this is a local game-flow correction, not a system migration.

## System Translation Receipt

`not_applicable`

## Product Agent Runtime Routing

`not_required`: the delivered game simulation is deterministic; build-time agent delegation is not a shipped agent runtime.
