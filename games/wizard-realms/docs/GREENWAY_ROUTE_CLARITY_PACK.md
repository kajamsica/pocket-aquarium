# Greenway route clarity and first-tool loop

## Outcome

The first region should teach three distinct physical actions through play: build a real deck over the south creek, climb a visibly runged ladder at the north cliff, and lower dry ground with a spade to earn stone and Excavation XP. Barefoot movement is walking only. Equipping boots enables running by default, with a persistent-in-session Walk/Run toggle. The saved world and player progression remain authoritative.

## Evidence and problem

Player feedback is that the ladder reads like a bridge, bridge locations are hard to find, and digging's location, controls, and reward are not apparent. Source inspection confirms bridge and ladder sites already exist in v16, a near-spawn center bridge spans the south creek, a center authored cliff ladder and off-center ladder works span the north rise, and dug ground yields one stone plus 30 Excavation XP. The code also enforces barefoot walking and booted default running. The issue is legibility and discoverability, not absence of those systems. Live browser inspection was blocked by the browser's URL policy, so completion cannot claim a fresh UI run until an allowed surface becomes available.

## Scope and interfaces

- Preserve v16 save format, site IDs, authority validation, resource costs, collision/support, route permanence, discovery fog, and store economics. No free placement that could invalidate existing saves. No route teleport.
- Visual lane owns only ladder presentation and scene-level visual tests. The rendered ladder should visibly be two rails and separated rungs climbing the cliff face, not a solid plank deck; the bridge stays a deck. The mesh must line up with the existing authoritative climbable support.
- Guidance lane owns v16 objective, HUD, and map copy plus its focused tests. Show where south creek bridges and north cliff ladders are found without revealing unreached tiles. Explain B/Works, 1 Bridge, 2 Ladder, 3 Dig, F confirmation, required materials/tools, and why digging matters. Clearly state that bridge/ladder building is at discovered obstacle sites and that arbitrary Fortnite-like placement is a future system, not a present capability. Make the gait control describe its current and next pace: barefoot cannot run; boots default to Run; Walk is a toggle.
- First-region navigation should remain usable when the map is closed. Prioritize a concise contextual next step over duplicating the whole manual across panels.
- Main agent owns pack integration, targeted tests, build, and an allowed UI journey if available. Grok Bot's frozen artifact may continue independently; do not mistake its result for a new build.

## Tickets and acceptance

1. **Route silhouette**: Adjust only scene rendering for ladder so it reads as a steep runged climb at playable camera distance, including the authored center ladder and saved off-center ladders if both need the same treatment. Keep mesh count bounded and align with support. Add geometry/markup assertions for ladder-versus-bridge identity.
2. **Teach and find**: State bridge location as south of spawn by the creek and ladder location at the north cliff. Give a direct short action sequence in Works/map, including eight logs for a bridge, four for a ladder, equipped field spade and one bag slot for digging, a beside-the-patch stance within 4 m, stone and XP reward, and stone sale at Outfitters. State boots behavior precisely and expose Walk/Run toggle state. Add focused projection/HUD/map assertions.
3. **Integration**: Run typecheck and focused tests for both lanes. Verify no save contract or authority paths changed. If browser policy permits, run one fresh first-region UI journey in an isolated origin while leaving the user's preview available; otherwise report the exact UI validation limit.
4. **Observed legacy compatibility failure**: Integration found one separate v9 wilderness assertion failure. The rendered overlay says `Next: Next: Frontier marker...`, while the older test expects no pinned wilderness objective. Inspect the current objective contract, remove duplicate `Next:` presentation without hiding a legitimately available frontier objective, and update only the now-stale assertion if the frontier objective is intentional. Own only `PublicWizardApp.tsx` and its focused test. This is a distinct compatibility repair from the v16 route change, with its own identical-test retry.

## Replan gate

If geometry changes need a different movement support or persisted site coordinates, stop the visual lane and create a versioned authority/migration ticket instead of silently changing a saved world. If guidance still cannot make bridge and dig findable in a UI run, inspect the actual projection and rendered affordances before broadening to markers or waypoint design.

## Local validation receipt

- Route silhouette and first-region guidance landed without changing authority, generation, save schema, or store prices.
- Focused integrated test command across the v16 projection, HUD, map surface, scene, movement, work authority, controller, and legacy public app: 221/221 passed across eight files.
- TypeScript and production Vite build passed; `git diff --check` passed. The build retains an existing large-chunk warning.
- The observed legacy test failure was `Next: Next: Frontier marker...`. The frontier objective is intentional; overlay and panel now strip the duplicate prefix. The identical legacy test rerun passed 68/68.
- UI validation of this new build was unavailable because browser automation blocked the localhost tab. A separate Grok Bot run is testing a hash-verified earlier v16 artifact, so its outcome cannot validate this visual and copy revision. The local preview remains served on port 5193; no second local preview renderer was opened for this pack.
