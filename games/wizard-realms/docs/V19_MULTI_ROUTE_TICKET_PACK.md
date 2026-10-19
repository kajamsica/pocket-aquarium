# V19 multi-route discovery pack

## Objective

Make material-driven Greenway construction feel repeatable: a player can discover and build a second non-overlapping bridge or ladder position on the existing south creek and north cliff. The current checked writer, saved `greenwayWorks` arrays, and physical movement solver already support multiple structures. This pack exposes that capacity; it does not add a new obstacle or pretend to offer arbitrary world-wide Fortnite placement.

## Contract

- Suggest a small, deterministic set of seed-resolved, spatially separated valid bridge and ladder positions. Never invent geometry in the view.
- Reveal each suggestion only after its whole footprint is discovered and in the current visual window. Hide completed or physically overlapping suggestions, but do not suppress every same-kind suggestion merely because one was built.
- Works aim, preview, material cost, reach, collision, checked confirmation, save/replay, and keyboard rules remain authoritative and unchanged.
- Keep rendering bounded: reuse the existing map glyphs, scene markers, candidate cache, and built-site display. Do not add per-frame wide scans or a new save field.
- Barefoot/booted gait, dig, and the v18 input scheduler remain untouched.

## Proof

1. For at least two seeds, choose two distinct, non-overlapping valid positions of each kind and show that partial discovery reveals neither position. Full local discovery reveals the appropriate marker.
2. Build two bridges and two ladders sequentially through the checked flow; verify independent log charges, XP, retained IDs, save/reload and replay. An overlapping attempted build is rejected.
3. Cross both bridges and climb both ladders in each direction. Off-support movement stays blocked by water or cliff.
4. After building the first position, a second unbuilt position still shows its discoverable cue. The built position displays ✓ and the unbuilt one ◇ without duplicated scene markers.
5. Run focused tests, TypeScript, full suite, production build, and one hash-bound UI journey before calling the increment done.

## Ownership and sequencing

First finish and observe the frozen v18 fresh-world bridge journey. Then one implementation owner may change the v17 view suggestion selector and its tests only. A separate read-only reviewer checks discovery, overlap, bounding and compatibility. If tests show that a second route requires domain, migration, or save changes, stop this pack and replan rather than broadening it silently. No PR or GitHub action is requested.

## Later terrain expansion

A new creek or cliff at another location is a separate versioned world-geometry milestone. Current water/cliff collision, reticle planes, canonical site IDs, and pinned v17 terrain profile are tied to the existing obstacles. New landforms require paired compatibility proof for old saves and actual world traversal before release.
