# V134: Fresh start into the current campaign

## Original ask and current goal

Wizard Realms must become a complete single-player wizard RPG, not a succession of short preview islands. The user wants to start at the beginning and understand the game through normal controls, without incorrect dead ends. The preceding V36 chapter has a checked reward path, but its full new-player quest journey is not proven.

## Aligned problem statement

First determine, from a truly empty browser profile and the visible current-game entrypoint, whether a player can begin the latest campaign without technical version-hopping. If the journey fails, record the exact earliest product blocker and its owning seam. Repair and full organic quest validation follow from that evidence. Do not count a synthetic near-quest save as a fresh-player proof.

## Repository truth and constraints

- At the first probe, `PublicV36Entry.tsx` offered only resume or explicit copy of a checked V35 root. Without V35 it rendered `source-missing` and a V35 link.
- V35 similarly links to V34 when its source is missing. V34 asks for V33, while V33 has a visible `Start new adventure` choice.
- V36/V35/V34 use separate checked roots and storage. Existing saves are user data, so no clearing or silent migration in the user-facing 5194 browser.
- An isolated 5195 server is currently reachable. Use one disposable browser profile and one renderer, with the established early RSS stop at 870400 KiB and hard stop below 1024000 KiB. Close it afterward.
- The current checkout is heavily dirty. No GitHub action or commit is requested. The 5194 V36 preview stays available.

## Goals, non-goals and success criteria

This probe's goal is to identify the first actual new-player blocker, with visible UI, console and network evidence, and no source edits. A player-facing final flow should eventually have one clear New Game action on the current game entrypoint, preserve checked older saves, and lead into an organic Old Marker journey. Designing or coding that flow before seeing the first UI result is out of scope for the probe.

Success: an empty isolated profile visits `http://127.0.0.1:5195/?publicWorld=v36`, records the visible choice/error, follows only obvious in-product links as far as needed to identify the shortest start path, and returns an exact blocker or an unexpectedly working path. Evidence includes screenshots and browser health. No synthetic save or direct storage mutation.

## Open questions and risks

The source predicts a V36 `source-missing` state, but the browser may expose additional constraints or a more direct route. The next implementation pack depends on whether the missing current-version New Game action is the first blocker. A future repair must honor checked migration and avoid conflating old branches.

System translation routing: `not_qualified`, because this is a feature and journey repair within the existing engine, not a whole-system port. System translation receipt: `not_applicable`. Product agent runtime: `not_required`; the game does not ship agent execution for this path. Current goal contract is aligned and remains active.

## Probe and integrated-review update

The empty-profile browser confirmed the predicted V36 to V35 to V34 to V33 link chain, with New Game first offered at V33. V134-A/B then added a checked fresh-origin V36 path. A one-renderer 390 by 844 UI smoke clicked New Game, saw a visible preparing state, created a valid V36 fresh root without a V35 root, discovered Greenway Ring, reloaded and resumed with the action saved. That is an early surface milestone, not the full quest journey.

The independent integrated review found two bounded issues: fresh-root decoding reconstructs the entire V23 through V35 constructor chain on every cold module load, stalling entry about 12 seconds; and the V35 copy flow can read a newer source revision after the entry precheck. A corrected fast canonical initializer and an under-lock expected-revision check are required before V134 final acceptance. The UI tester's continuous RSS guard script did not sample correctly, so only one direct 580864 KiB page-renderer observation is valid; a later browser retry must verify its guard before rendering.

## Repair and guarded UI result

R1 replaced the cold constructor chain with a 145,190-byte fixed-seed genesis fixture. A parity test still composes the pure V23 to V35 constructors and checks the fixture exactly, while production rejects any other fresh seed and compares checked fresh roots to it. Focused snapshot tests passed 7/7, TypeScript and production build passed; domain measurements were under 1 ms to create, 5 ms to import cold, and 36 ms to decode a checked root. R2 made the displayed V35 source revision mandatory in the copy flow, checking it under the shared exclusive lock before target write. Its focused flow/entry and controller-consumer tests passed 13/13. Independent review found no remaining save-safety issue in these repairs.

R3 repeated the fresh 390 by 844 UI journey with a sampler self-test and continuous 50 ms renderer-RSS guard. New Game command wall time was 1.30 seconds instead of the prior 10.68, with a visible preparing frame and a playable scene by the third video second. It created a checked fresh V36 root without V35, saved Greenway Ring discovery as revision 1, reloaded and continued with that witness intact. Reload to entry took 0.78 seconds and Continue 1.18 seconds. Across 853 guard samples the peak renderer was 410,192 KiB, below the 870,400 KiB early-stop threshold. The isolated browser and guard were closed; 5194 and its saves were untouched. This is a short fresh-start proof, not the full organic Old Marker quest or long-session memory proof. R3 also observed a missing space in resume copy and a narrow-screen movement strip overflow, which are bounded UI polish before closure.

R5 corrected those exact two UI defects with a four-net-line markup/style patch and one focused text assertion; 4/4 entry tests and TypeScript passed. The identical guarded 390 by 844 browser retry showed `Validated V36 save #1 is ready`, a gait strip entirely inside the viewport (x 16 to 374), no horizontal document overflow, and the saved ring action still present after Continue. Its renderer peak was 408,384 KiB over 407 guard samples; the browser was closed. The 5194 user preview still returns HTTP 200. V134 fresh-start acceptance is therefore met, while the organic full-chapter and long-session gates remain open.
