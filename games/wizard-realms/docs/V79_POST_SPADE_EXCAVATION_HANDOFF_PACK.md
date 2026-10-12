# Ticket Pack: V79 post-spade Excavation handoff

## Outcome and evidence

The full Wizard Realms goal remains active. A fresh V31 `greenway-alpha` UI run reached the Mireglass salvager by visible trail bearings and dots, bought and equipped the field spade, and restored validated save #112 with exact position, inventory, equipment, and 102 coins. That proves the route and purchase, not the next decision.

Read-only source audit identifies the next supported first-region milestone as one checked Dig for +30 Excavation XP and Level 2. The public guide currently loses its salvager-specific stage as soon as the spade is owned and falls back to generic “Explore the fen and slate shelf” text. The guide also describes the spade as opening soil only, although E interactions with chopped stumps and revealed cache exist. Before implementation, repeat the handoff in the real UI from the saved state and capture the actual visible affordances and first failure.

## Scope and invariants

- Do not invent a new mechanic or route. A V31 Dig requires equipped spade, revealed dry unoccupied loam, grounded pose, target within 5 m, and pack capacity. Chopped-stump E is a separate valid +30 XP alternative; do not imply that arbitrary ground yields rare materials.
- Guidance must be coordinate-free, specific, and visible enough for a novice without requiring them to already know the hidden interaction. The first-line objective must remain useful when its disclosure is collapsed. It may mention closing trade/map/Works before clicking a revealed dry patch.
- Preserve V74 marker, V78 trail, existing saved bridge/Works ledgers, cache secrecy, action gates, and all save schemas. Never copy standalone Mireglass quest stages into public V31 because their Works ledgers differ.
- Prefer `PublicV23Controller.tsx` and its focused test for guidance. Change another owner only after UI evidence shows it is required. No new dependency or asset work. One browser renderer, no Blender during UI proof. No PR/GitHub action; future game GitHub work requires `gh-bioscopics`, personal noreply, and `ben/` branches.

## Lane graph

```mermaid
flowchart LR
  A["Save #112 and source audit"] --> U["V79-A read-only UI handoff probe"]
  U --> I["V79-B bounded guidance repair if failure observed"]
  I --> R["V79-C independent code review"]
  R --> E["V79-D checked UI Dig and save/reload"]
```

The probe and any implementation cannot overlap in one live renderer. After code review GO, the UI acceptance tester uses a stable build with no HMR edits. Dispatch verdict: PASS.

V83, V85, and V86 each reduced measured renderer churn without changing this journey. An exact isolated IndexedDB-inclusive V31 save #104 was exported after the V80 marker approach at `games/wizard-realms/.playwright-cli/wizard-v80-marker-checkpoint-indexeddb.json` (mode 600, not yet restore-tested). V79-A may restore this **real UI checkpoint** at its matching `http://127.0.0.1:5193/` origin to avoid replaying already proven movement, but must verify the revision, position, and route state before using it. This is a resumed journey, not a new-player intuition proof. Stop if the restore fails; do not inject a synthetic state. Keep one renderer below 2 GB RSS and close it afterward.

The V79-A retry restored that named checkpoint as validated save #105 at (-143.47, 1.25, 121.52), claimed River Works, level 3, 120 coins, axe equipped, no spade. After short map-guided movement to (-147.92, 1.28, 110.04), renderer RSS rose from about 339 MB to 1.67 GB. The tester stopped under the 2 GB cap and closed the renderer. No product error or OOM appeared, but marker Study, salvager purchase, and Dig remain unproven. V87 owns the memory diagnosis before another extended UI attempt.

V89's staged production UI journey has now supplied the missing observed result. Genuine save #60 followed only visible trail/rejoin cues to the salvager, bought the field spade for 18 coins (120→102), and equipped it. The collapsed post-purchase objective was only `Mireglass Reach`; expanded guidance fell back to `Explore the fen and slate shelf. Use Works for crossings and cast Wayfinder Glow.` A visible dry-grass tap with Dig auto-selected succeeded: `Dig saved at column -70, 72. Found soil. Depth 0.4 m.` Excavation reached Lv2 (30 XP). Same-tab reload validated save #110 with spade, soil, XP, coins, pose and open column retained. The authentic same-origin 5194 checkpoint is `.playwright-cli/wizard-v89-stage4-spade-dig-rev110-indexeddb.json` (mode 600). V79-B therefore owns a **guidance-only** repair, not a Dig mechanic change. Source may now be edited because the tester closed the sole browser and preview.

## V79-A UI probe

Role lock: read-only UI tester. Resume the existing validated V31 save #112 if the isolated browser profile can access it; if not, report that limitation, do not silently substitute a synthetic state. Observe the collapsed and expanded objective, equipped tool affordance, terrain cursor/preview, and first attempted Dig on a clearly revealed dry nearby loam patch. Capture exact toast/blocked state, console/network, save status, memory, and screenshot; close sole renderer. Stop at first actionable failure or one successful +30 XP Dig. Do not edit files, Git, or user saves outside the game’s own tested save interaction.

The first V79-A probe found that the prior isolated browser profile did not retain save #112 after closure: it showed only `Create V30 foundation and V31 copy`. This is a test-profile continuity limitation, not evidence that the game's in-session save/reload failed. Retry V79-A by visibly creating and playing a fresh V31 character through the already proven ladder/bridge/marker/trail/spade journey, keeping one isolated renderer open until the Dig probe finishes. No synthetic checkpoint or direct state injection. Retain screenshots/save numbers along the way and close the renderer at the end.

## V79-B bounded implementer, conditional

Role lock: implementer. Only after V79-A evidence, make the smallest correction in the observed owner. If guidance is the failure, give owned-spade/pre-Lv2 V31 a specific immediate Dig objective visible in the collapsed summary, and make detailed copy accurate about soil and chopped-stump E. Add focused tests for both seeds, capacity/pose fallback, stage precedence, and no cache disclosure. Do not alter physics or save format for a copy failure. Run focused tests and TypeScript.

## V79-C review and V79-D UI acceptance

Reviewer checks stage predicates, visible novice copy, action safety, cache secrecy, and smallest diff. UI tester then repeats the exact probe input on stable build, proves a checked +30 Excavation XP/Level 2 action and validated save/reload, and reports the first next blocker. Do not claim the full first region until fen bridge, slate ladder, Glow/cache, gathering, return trade, and persistence are separately proven.

## Stop rule

If the real UI action fails for a movement/terrain/store reason rather than guidance, route that exact failure to its source owner. Do not patch copy to disguise an inoperable action.

## V79-B/C source receipt, 2026-10-10

The authentic V89 production journey proved that Dig itself succeeds, but post-purchase guidance fell back to a generic regional objective. V79-B changed only the public controller copy and its focused test: an owned-spade V31 player who has studied the marker, claimed the bridgehead, and has less than 30 Excavation XP now sees the immediate Dig objective even while the guide is collapsed. The expanded action names an unoccupied, revealed dry grassy (loam) patch within 5 m, the equipped spade, the UI panels to close, and the 30 XP outcome. Spade footer variants also specify dry grassy loam. This is guidance only; authority, terrain, saves, and higher-priority salvager stages are unchanged. Focused controller tests passed 36/36 and TypeScript passed.

Independent review initially found that “dry patch” was too broad: a spade rejects rocky or snowy dry ground because the top layer is stone. The implementer narrowed all new target wording to grassy loam and added assertions against the generic phrase. Independent rereview returned GO for action accuracy, stage precedence, cache secrecy, and smallest viable diff. V79-D must still repeat the pre-Dig handoff in the real UI on a stable build; source-level success is not browser acceptance. The V89 post-Dig Stage 5 may run concurrently using the unchanged production build, but it exclusively owns the sole renderer until closure.

## V79-D production UI receipt, 2026-10-10

After V89 Stage 5 closed its renderer, the tester built the reviewed source once and served a stable production preview on the same origin 5194. It restored the authentic pre-spade V31 save #60, followed the visible dry trail to the salvager, bought and equipped the field spade for 18 coins, and observed the corrected collapsed and expanded objective. Both named revealed, unoccupied dry grassy (loam) ground. A click on visible grass saved Dig at column (-69, 73), yielded one soil and 30 Excavation XP, and reached Lv2. Same-tab reload validated save #107 with spade, soil, XP, 102 coins, and pose (-275.80, 1.07, 291.49) retained. The private mode-600 same-origin checkpoint is `.playwright-cli/wizard-v79d-spade-dig-rev107-indexeddb.json`. Peak renderer RSS was about 847 MB, below the 1.2 GB cap; no dynamic request failed. Browser and temporary preview were closed; dev 5193 remained available.

Observed error: generic post-spade guidance | change: loam-specific immediate Dig copy | restart: one stable production build and preview | identical handoff retry: passed | next action: resolve the separate post-Dig Fen route guidance blocker recorded by V89 Stage 5.
