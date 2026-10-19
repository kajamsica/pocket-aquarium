# V26 Ladder Entry: Aligned Understanding

## Original Ask

The early Wizard Realms valley should feel explorable and legible. A visible cliff should be climbed with a built ladder, not an unexplained invisible stop. Building a route should make it easy to use. The river and cliff gate the starter valley until players gather materials and construct the right route.

## Input PRD / Spec

The active full-game goal and `STARTER_VALLEY_WORLD_LOOP_UNDERSTANDING.md` are the source of product intent. The first-time V26 UI probe is recorded in `STARTER_VALLEY_V26_EXIT_JOURNEY_PROBE_PACK.md`.

## Aligned Problem Statement

The checked north-cliff ladder is physically present and its aperture is valid, but a first-time player approaching from a nearby lane can collide with the wall before aligning with its 1.05 m climb surface. The UI still presents the initial chop-logs hint after a ladder is built. Repair the ladder entry and progress cue without rewriting old movement/replay rules or implying unrestricted access through cliffs.

## Goals

- A normal forward approach from the starter valley near a built north Works ladder gently joins the lower foot, then climbs under the existing checked V26 movement rules.
- A player already close to the cliff can recover toward the ladder without another build or a hidden teleport.
- The starter hint advances after ladder construction and does not claim first steps are still pending.
- Preserve the exact recorded movement frames and replay behavior of existing saves, and keep unbuilt or distant cliffs solid.

## Non-Goals

- General pathfinding, auto-climb from anywhere, V17 movement changes, a new save schema, freer cliff traversal, deep mining, or the entire RPG north star in this slice.
- A new bridge route or new world geography.

## Constraints

- Work in the current dirty `ben/wizard-playable-v2` checkout; do not clean, reset, commit, or push unrelated changes.
- Only V26 live input adaptation may change the movement entered into a new checked frame. Stored frames, authoritative replay, gait caps, V17 helper behavior, and validated saved Works sites stay unchanged.
- The shown guidance must match what actually works. Browser validation uses one renderer, with the existing preview server retained.
- Any GitHub operation would require `gh-bioscopics`, a personal/Bioscopics commit identity, and a `ben/` branch. This slice does not require a GitHub operation.

## Success Criteria

1. On a fresh V26 start, equip axe, chop enough logs, build a Works north ladder, hold forward from a nearby lane, reach and traverse the rungs, checkpoint, and reload on the upper side.
2. No saved ladder means no assistance or cliff passage; far-away ladders cannot attract input.
3. Guided steps remain within the requested stride and must pass the unchanged V26 checked preview/writer.
4. Progress hint no longer says to start chopping for logs once the ladder has been built.
5. A rendered browser receipt includes route inputs, a screenshot of the upper-side state, and console/network status. Failure is reported honestly with the first exact blocker.

## Open Questions

- Whether the old V17 support slope accepts every in-lane foot entry from the sampled approach. The worker must measure this in focused tests and the browser. If not, stop and return a concrete failure for replanning instead of weakening replay rules.

## Implementation Risks

- Silent sideways steering may feel artificial. Keep the capture radius small and use a visible, accurate cue.
- A direct lateral step close to the rim can join the sloped ladder at excessive elevation. The approach must first return to the lower foot on ground before moving sideways, then move north through the support.
- Input adaptation after witness decoding would break replay parity. Adapt before decoding, and record the adapted move as the witness.

## System Translation Routing

`not_qualified`: this is a bounded input and UI change within the existing game engine, not a whole-system translation.

## System Translation Receipt

`not_applicable`.
