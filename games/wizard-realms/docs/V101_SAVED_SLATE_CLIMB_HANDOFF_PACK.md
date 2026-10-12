# Ticket Pack: V101 saved Slate ladder climb handoff

## Observed result and causal diagnosis

The full Wizard Realms goal remains active. V99-C built checked Works5 Slate ladder `works5:ladder:mireglass-slate:W:-103:4311` in the real production UI, spent four logs, gained 60 Construction XP and level 5, and saved/reloaded #308 at (-413.04, 0.84, 431.64). The private mode-600 same-origin IndexedDB-inclusive checkpoint is `.playwright-cli/wizard-v99c-slate-ladder-built-rev308-indexeddb.json`; do not print, edit, or commit it. Two nearby movement attempts received `This step has no supported route`, but independent source audits found both were outside the ladder's 1.05 m lane by 1.5 cm and 8.5 cm. An exact valid V31 authority replay crossed the saved q4311 centerline and reached upper floor y2.40; it did not use the private checkpoint. Thus ladder physics is not shown broken.

The concrete UI defect is post-build guidance. The prebuild Slate guide turns off on a saved regional ladder, while the near-West note still says to gather four logs and build. The broader guide is hidden near the cliff. A player sees rungs and completed map marks but is not taught to approach their narrow supported east-side entry, center on the mark, then climb west.

## Frozen repair contract

- Add a narrow saved-Works5 Slate climb stage in `PublicV23Controller.tsx` with focused tests. Resolve a validated saved, fully discovered regional ladder site from projected built sites rather than a Boolean or hidden source coordinate. Select the nearest local usable built site if multiple. Preserve earlier starter, salvager, Dig, timber, Fen build and Fen deck priorities, and stop this special cue only after authoritative upper-side footing or cache revelation. A built ladder alone does not prove a climb.
- From a distant lower-side pose, route only through `knownDryWaypoint` over saved revealed connected dry ground to a lower east approach; no known route means no bearing. From an off-lane lower pose like #308, tell the player to retreat EAST on dry lower ground before any lateral alignment, then line up with the rendered center mark and move WEST straight along rungs. Do not suggest a sideways entry from the unsupported cliff face. On the supported lane, tell the player to continue west to the upper floor. Do not widen physics, reveal hidden cells, or promise a safe step that the checked barrier rejects.
- Replace the stale near-West four-log/build note after a saved ladder and make the new guide visible even at the West face. Do not show a new ladder-build request after the ladder is already saved. Keep existing Works preview, cost, save schema, and movement authority unchanged.
- Red tests first reproduce stale #308-like objective and both off-lane refusals; green tests cover both exact published poses, source-side centerline and upper-floor handoff, cache-revealed shutoff, pits/wet/grade/barrier/fog/disconnected no-route, multiple saved IDs, near-West render visibility, and no fabricated Works5 for unsupported `wizard-realms` seed. Run focused tests, TypeScript, whitespace, independent review. Only the controller and focused tests are in scope unless a grounded proof shows otherwise.

## Lanes and gates

1. V101-A implementation owner follows the observed-failure loop. No browser, private checkpoint contents, Git, commits, GitHub, or broad refactor.
2. V101-B independent read-only reviewer checks lane geometry, stage priority, no hidden leak, safe approach, render handoff, test quality, and smallest diff. GO required for browser.
3. V101-C sole production browser restores authentic #308 on temporary same-origin 5194 and follows only visible guidance to a centerline climb, saves/reloads/exports a genuine private mode-600 checkpoint, closes browser/5194 by ~1.2 GB RSS, leaves dev 5193. Stop at first new concrete blocker or safe smaller milestone.

## Stop rule

If an aligned centerline step is refused in the live UI, capture exact position, saved ladder, guide, movement refusal, and scene before changing authority. If only the guide fails twice, replan scene/map alignment affordance instead of repeating copy edits.

## V101-A/B source receipt and browser GO

Red tests reproduced the saved q4311 ladder's stale generic/build instruction and both published off-lane refusals. The controller-only repair resolves validated, fully discovered saved regional ladder geometry, ranks the nearest local site, routes distant lower-side players via known dry connected cells, tells off-lane players to retreat east before aligning at the dry lower entry, and then cues a straight west climb on supported rungs. It hides the stale four-log/build note after construction and stops the climb cue on grounded upper rim or cache revelation. Independent review initially found two handoff defects: an upper-rim pose still received a lower-route cue, and a player already in the dry approach tile could be told there was no route. Both were reproduced and corrected in the same two files. Final controller suite passed 79/79, V23 movement 9/9, TypeScript and whitespace checks passed. Independent re-review returned GO after 88/88 tests, TypeScript, and whitespace, with no blocking finding. This is source-level evidence only; authentic #308 centerline climb remains V101-C.

## V101-C production UI receipt

The sole production browser restored authentic #308 at (-413.04, 0.84, 431.64), level 5, zero logs, and saved q4311 rungs. The visible objective progressed from `Slate ladder: retreat east to align` to dry east approach alignment and then `climb west on saved rungs`; the stale four-log build note was absent. Following only those cues reached the actual Slate upper floor at (-416.66, 2.40, 431.55) with no supported-route refusal on the aligned climb. The special cue then ended. Same-tab reload validated save #333 at the exact upper-floor pose. The genuine mode-600 IndexedDB-inclusive checkpoint `.playwright-cli/wizard-v101c-slate-upper-rev333-indexeddb.json` must not be printed or committed. App requests returned 200; there was no gameplay console error. Renderer RSS peaked at 1,046,240 KiB after export, then the isolated browser and temporary preview 5194 closed; dev 5193 remains live. Saved Slate passage is proven, but cache revelation, excavation, return trade, and independent novice first-region acceptance remain open.
