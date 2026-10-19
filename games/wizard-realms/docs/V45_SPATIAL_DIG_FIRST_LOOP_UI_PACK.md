# Ticket Pack: V45 spade, spatial digging, and Fill first-loop UI proof

## Summary

The player expects equipping a spade to reveal where digging is possible, clicking ground to yield the material of that exact location/depth, a persistent visible divot, deeper digging when equipment permits, and Fill to restore the ground. V39 source audit confirmed checked spatial/geology/save paths and one earlier real first Dig reported soil at 0.4 m, but repeat Dig and Fill have not been run as a continuous novice UI journey. This pack probes that path after V44's cue repair stabilizes. It does not claim Minecraft-like freeform above-grade earth placement exists.

## Fixed interface and acceptance

Use `http://127.0.0.1:5193/?publicWorld=v29` in one fresh isolated browser profile. Ordinary visible UI only, no source coordinates, state injection, direct action calls, or second renderer. Start new, reach Outfitters by its visible sign/guide, obtain/equip spade, observe whether Dig becomes selected, hover a revealed dry cell in reach, tap it, record checked material/depth and visible pit. If the first site is invalid, record the exact message and use one other visible nearby dry cell. If a saved pit exists, try one additional layer by clicking its visible floor, then Fill the same column with earned soil using ordinary terrain controls. Stop at first decision-bearing blockage or after Fill. Do not grind for picks or rare ores in this probe. Same-tab reload is optional only if flow remains short; V40 already proved route/save persistence generally.

The output must separate “the click selected a geometric cell” from “the checked action accepted it.” A neutral ground outline may appear while no terrain mode is selected; V39 source review identified this as a possible misleading affordance. Capture whether it actually causes a dead click. The current geology table is seed/cell/depth-based, with soil, stone, iron, gold, diamond, and bedrock tiers, but this first UI run is not expected to prove the rare materials.

## Lane graph, certainty, and safety

One read-only UI reviewer lane V45-A runs after V44 code/test/build review. Primary synthesis follows. No source-review lane is necessary because V39 already traced the checked path. The browser is the sole renderer. A real failed click with exact rejection can trigger a bounded repair; a source-only possible hover mismatch alone cannot. Stop at first decision-bearing issue, not repeated blind clicking. Preserve the dirty worktree, no code/test edits, Git writes, or browser storage manipulation. Vite preview stays live for user access.

## Smallest viable diff

Zero production/test changes in this evidence pack. If a click affordance gap is confirmed, reuse `WizardSurface` terrain mode and `WizardScene` hover gate; do not change checked geology or save schema. A UI change should tell the truth about a *candidate*, not promise Ready from geometric hover alone. Validation for any later repair needs a focused component regression and an identical UI retry. Tripwires: terrain authority rewrite, freeform fill assumption, second renderer, hidden source coaching.

## V45-A reviewer ticket

Read auto-planner-ticket-pack, smallest-viable-diff, test-from-ui and Playwright skills completely, then this pack and V39 evidence. Role lock: read-only UI reviewer. Worktree `/private/tmp/pa-wizard-playable-v2`, branch `ben/wizard-playable-v2`. One isolated browser; follow fixed interface, stop at first blocker or one saved dig/Fill loop. Capture spade equip/mode, hover, click and rejection or material/depth toast, visible pit and Fill state, screenshot paths, exact inputs, console/network, browser-closed receipt. Transport native continued `/root/v26_first_loop_probe`, inherited model, no durable task/Cursor/nested worker. No edits/commit/push. Do not start until primary confirms V44 integration stable and no other renderer active.

## Status

V44 integration passed and V45-A ran one fresh, sole-renderer UI journey. The player walked to visible Greenway Outfitters, bought a Field spade for 18g (120 to 102), equipped it, and saw Dig auto-select and become enabled. Screenshot: `/private/tmp/wizard-v45a.NfOo0A/.playwright-cli/page-2026-10-10T07-11-47-934Z.png`. The first geometrically outlined dry cell was checked and rejected as protected home/route/structure ground. A second visibly outlined cell succeeded: `Dig saved at column -1, 1. Found soil. Depth 0.4 m.` Soil ×1 appeared in the backpack, Excavation advanced from Lv1 to Lv2, and a visible dark divot appeared left of the avatar. Screenshot: `/private/tmp/wizard-v45a.NfOo0A/.playwright-cli/page-2026-10-10T07-19-42-418Z.png`. The reviewer stopped after the second result at the primary's instruction, so deeper same-column digging and Fill remain untested, not failed. Console showed only favicon 404 and Three.js Clock deprecation; no non-static requests. Browser closed, Vite live, no code/Git/storage edits.

Observed error | change | restart | retry result: first outlined ground target rejected because it intersects protected home/route/structure | none in evidence pack | none | second visible dry target succeeded and saved a 0.4 m soil pit | next action: test repeat Dig and Fill; separately improve candidate validity communication without duplicating checked authority.

`activated_repairs`: none immediately; the first invalid click returned a truthful cause and the second succeeded, but pre-click candidate distinction remains a UX gap against the user's “see where you can dig” target. `not_required_repairs`: spade purchase/equip, auto-Dig selection, clicked-cell witness persistence, first soil material and visible pit rendering. `finding_to_ticket_mapping`: invalid geometric outline to a future read-only preview/validity affordance design that must reuse checked rules or remain explicitly provisional; deeper Dig/Fill to a follow-on UI acceptance. `unmapped_findings`: rescue from a genuinely trapped pit and 30-minute timer remain untested.
