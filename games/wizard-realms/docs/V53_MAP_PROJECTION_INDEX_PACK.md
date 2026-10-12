# V53 map projection indexing

## Evidence and outcome

The current V30 input trace shows warm `controller.render` projection p50 about 25.1 ms and p95 about 29.3 ms. Its base projection is p50 about 16.1 ms and p95 about 19.8 ms. Source inspection finds `PublicV17WorldView` repeatedly searching active tiles and discovered sites for each map tile. Reduce that repeated per-render work without changing any map marker, discovery gate, order, authority, save, or UI contract.

## Bounded change

Build per-projection indexes for active tiles and discovered sites by their marker tile ID before `base.map.tiles.map`. Preserve the existing `visibleSites` ordering and all `hasResource`, `hasWaystone`, `hasRouteSite`, `hasBuiltRoute`, `hasDigSite`, terrain, biome, and elevation results. Avoid persistent caches or sharing mutable projected objects. Do not remove the cached dig-site `structuredClone`, whose mutation-isolation test is intentional. Touch only the V17 view and focused tests.

## Proof

Compare complete fresh, partially discovered, built-bridge, and dug-site view projections before and after indexing, including undiscovered cells and marker flags. Run focused single-worker tests, TypeScript and production build. After the separate V52 writer repair completes, repeat the same V30 dry-ground input-trace run for warm projection p50/p95 and render gaps. Do not attribute the unmeasured overlay remainder or cold startup outlier to this change.
