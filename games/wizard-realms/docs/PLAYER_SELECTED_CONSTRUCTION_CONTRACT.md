# Player-selected construction contract

This is the next Greenway milestone after the v4 magic and excavation expedition. It is not the full-game construction system or the full-game completion gate in [Game Design](GAME_DESIGN.md).

## Authority and placement

- A player chooses a specific eligible site for the Greenway ladder or Highland bridge. A route name alone is not a site choice. Each site has a stable ID and canonical endpoints derived from the seed, profile, terrain, and area seam. Client intents submit `{ routeId, siteId }`, never arbitrary coordinates.
- Ladder candidates cross the Greenway north seam into the Northern Ridge. Bridge candidates cross the Ridge east seam into Eastern Highland. The original fixed anchors remain valid candidate IDs for v1-v4 migration. Other candidates are derived at regular terrain-grid intervals along the seam and filtered by actual footprint and terrain suitability, not hand-picked visual markers.
- One pure site resolver supplies the simulation, projection, and save validator. It determines world-ground endpoint heights, route and area identity, range from the source endpoint, store and landmark clearance, active resource obstruction, and progression/material status. At least two usable placements per route and profile must be established across a seed corpus. A depleted resource can make its former site usable.
- The authoritative build step validates the site again, spends the listed logs once, grants construction XP once, commits the chosen endpoints to the route, and emits an event identifying the site. Failed, spoofed, obstructed, distant, or duplicate builds change no resources, XP, route, or discovery.
- Built traversal uses the player's current area and the corresponding endpoint, not whichever endpoint is nearest in three dimensions. It works in both directions and remains blocked at other area boundaries.

## Save compatibility

- A new versioned save key and content revision preserve v4 bytes. Completed v1-v4 fixed routes migrate to their matching canonical legacy-anchor sites; unbuilt routes remain unplaced. The player's prior magic, excavations, trade, map, inventory, coins, and route progress survive.
- The chosen route endpoints are authoritative only when they match a canonical site for that route and profile. New-save validation rejects missing, duplicate, out-of-bounds, nonfinite, wrong-area, mismatched-built-status, or forged placements before restore or autosave. Never clamp or regenerate a malformed selected placement silently.
- Classic and expanded saves stay isolated. An incompatible newest key blocks fallback and writes until explicit reset.

## Player surface

- The north-up atlas lists discovered candidates grouped by route, with cost and a clear reason when a candidate cannot be built. Each row is at least 44 px tall on touch screens. Fogged sites are neither described nor selectable.
- Selecting one candidate closes the atlas and previews that placement in the world. The selected-site card has Build and Cancel controls and does not depend on the nearest-object prompt or an open backpack. Only the selected candidate gets a strong scaffold preview; completed routes remain visible.
- A successful build changes the atlas marker from candidate to completed at the chosen site. Other candidates for that route are no longer offered. Reload retains the same scaffold, marker, traversal endpoints, and materials spent.

## Acceptance proof

On classic and expanded profiles, choose and build a non-default valid ladder site, cross north and back, save/reload, and verify the chosen placement remains. Repeat for the bridge after the ladder prerequisite. Verify rejected spoofed sites and malformed saves leave prior bytes and gameplay progress untouched. In the real compact-landscape and phone UI, select a discovered site while a tree or fairy ring is closer, then use the selected Build control. This proves actual player-selected placement within the first region. Free placement of camps, boats, roads, and structures throughout the later streamed world remains a separate full-game milestone.
