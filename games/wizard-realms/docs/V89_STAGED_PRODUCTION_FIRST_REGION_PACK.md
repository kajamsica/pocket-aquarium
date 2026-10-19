# Ticket Pack: V89 staged production first-region journey

## Outcome and evidence

The full Wizard Realms goal remains active. The authentic V31 saved checkpoint near the frontier marker could not reach Study/spade/Dig in development because renderer RSS rose to 1.67 GB. A fresh production build is about 25% lighter in directional short-input profiling but still allocation-heavy. We will prove the real player path in short, bounded production sessions, using only in-game saves and IndexedDB-inclusive browser-state exports between stages. This is not a synthetic or direct state injection.

## Scope and invariants

- Use the current successful production build and a temporary `vite preview` on the same unused port, 5194. Do not stop or modify the dev server on 5193. Only one isolated browser renderer at a time. Leave the renderer closed between stages and stop by 1.2 GB RSS, earlier if rising fast.
- Start a fresh ordinary V31 character in the production UI, without a game-state fixture. Stage 1 proves the visible first objective: equip axe, chop trees, build a real north ladder and connected-river bridge if reachable, with UI screenshot, exact event/save/reload, and first blocker. The tester may pause at a smaller safe milestone rather than force both structures in one renderer session.
- At each successful in-game save, export the entire same-origin 5194 isolated browser state with IndexedDB to a mode-600 file under `.playwright-cli/`, using a descriptive V89 name. The next stage may `state-load` that *authentic UI checkpoint* at matching origin and verify revision/pose before continuing. No origin rewriting, manual record edits, synthetic state, or dev-mode cheat. Do not print or commit export contents.
- Later stages: cross saved bridge, follow fog-safe marker/trail, Study, buy and equip spade, perform checked Dig for +30 Excavation XP, save/reload; then Fen/Slate routes, Glow/cache, return trade. Each stage stops at first actionable blocker, memory cap, or verified milestone, with a causal receipt and next scoped ticket.
- Production play does not replace dev-mode performance hardening or novice UX proof. Record any unclear affordance, dead end, block cue, and input friction. Only implement a UI copy/mechanic repair after a real observed failure. No source edits during a tester stage; no PR/GitHub action. Future game GitHub work requires `gh-bioscopics`, personal noreply, and `ben/` branches.

## Lane graph

```mermaid
flowchart LR
  S["Fresh production V31 start"] --> G["Stage 1 gather and build"]
  G --> C["Verified in-game save and same-origin checkpoint"]
  C --> M["Stage 2 marker, trail, spade"]
  M --> D["Stage 3 checked Dig and save"]
  D --> R["Stage 4 region routes, Glow/cache, return trade"]
```

Dispatch verdict: PASS. Stages are sequential because one browser renderer owns the genuine game state. Source microbenchmarks and read-only review may run in parallel without a renderer.

## Stop rule

If the production renderer approaches 1.2 GB or a repeated in-game failure blocks progress, save/export only if the ordinary UI can do so safely, close the renderer, and report exact evidence. Do not turn off checks, inject materials, teleport, or call the journey complete from source-level tests.

## Stage 1 receipt, 2026-10-10

A fresh production V31 UI character equipped the axe, chopped four logs, built the marked north ladder for four logs and 60 XP, then gathered eight more logs and climbed to the upper shelf. Visible final pose was x 1.1, z -8.8, elevation 2.9, level 2, 120 coins, axe equipped, eight logs carried. In-game save and same-tab reload validated revisions #5 and #14, retaining ladder, position, equipment, and inventory. The exact same-origin 5194 IndexedDB-inclusive checkpoint is `games/wizard-realms/.playwright-cli/wizard-v89-stage1-upper-shelf-rev14-indexeddb.json` (mode 600). The renderer reached 1.138 GB RSS near the 1.2 GB stage cap and was closed before the westward bridge. Production preview 5194 was stopped; dev 5193 remained available. Stage 2 must restore and verify this genuine checkpoint before moving west.

## Stage 2 receipt, 2026-10-10

The current production build restored genuine save #14 with ladder, axe, eight logs, and upper-shelf pose. The tester followed the HUD westward across continuous terrain to the marked source bank at x -172, z 4. Works became Ready, and the UI built `works6:river-bridge:-43` for eight logs and 80 Construction XP, reaching level 3. Same-tab reload validated save #40 at (-171.98, 1.28, 3.60), with bridge, axe, and zero logs retained. The map displayed a far-bank post at (-170.60, 16.00). The exact same-origin checkpoint is `games/wizard-realms/.playwright-cli/wizard-v89-stage2-connected-bridge-rev40-indexeddb.json` (mode 600). Renderer RSS stayed about 500–749 MB; browser and temporary preview 5194 were closed. Stage 3 must restore and verify this export, then cross the saved deck and claim the far-bank post. The site approach used prior route familiarity, so Stage 2 is not independent novice site-discovery proof.

## Stage 3 receipt, 2026-10-10

The production UI restored save #40, crossed the saved -43 bridge, and claimed the far-bank River Works post for a basic pick. The visible frontier marker cue decreased from about 111 m to 45 m and 21 m while following revealed dry ground. At (-108.46, 1.27, 103.97), the visible Study action learned Wayfinder Glow. Cast correctly reported no new terrain or cache in reach there. Same-tab reload validated save #60 with the learned spell and exact pose retained. The next authentic same-origin 5194 checkpoint is `games/wizard-realms/.playwright-cli/wizard-v89-stage3-marker-studied-rev60-indexeddb.json` (mode 600). Peak renderer RSS was about 832 MiB. Browser and temporary preview closed. Stage 4 owns trail-to-salvager, field spade purchase/equip, and the first actual post-spade guidance/Dig observation.

## Stage 4 receipt, 2026-10-10

The authentic production save #60 followed visible marked dry-trail and off-trail recovery cues to the Mireglass salvager. The UI bought a field spade for 18 coins and equipped it; Dig auto-selected. A screenshot-derived dry-grass tap saved one soil column at grid (-70, 72), depth 0.4 m, and awarded 30 Excavation XP, reaching Lv2. Same-tab reload validated save #110 at (-276.70, 1.47, 290.66) with spade, soil, 102 coins, XP, and open column retained. The exact same-origin checkpoint is `games/wizard-realms/.playwright-cli/wizard-v89-stage4-spade-dig-rev110-indexeddb.json` (mode 600). Peak renderer RSS was about 852 MiB; browser and preview closed. Observed UX gap: post-purchase collapsed objective says only `Mireglass Reach`, and expanded objective falls back to generic exploration despite the imminent Dig milestone. V79-B now owns a guidance-only repair. Stage 5 can later restore #110 for Fen/Slate routes, Glow/cache, and return trade.

## Stage 5 receipt, 2026-10-10

The production UI restored authentic save #110 with the spade, soil, 102 coins, learned Glow, and Excavation Lv2. Post-Dig, the collapsed objective was only `Mireglass Reach`; the expanded objective said `Explore the fen and slate shelf. Use Works for crossings and cast Wayfinder Glow.` The map had fog but no discovered Fen/Slate marker; Works showed zero nearby. One safe southward walk from the salvager to (-279.37, 1.45, 299.89) did not change the cue or reveal a route. This is a next-decision wayfinding blocker, not a collision failure. Same-tab reload validated save #111 with state retained. The exact private same-origin checkpoint is `.playwright-cli/wizard-v89-stage5-fen-wayfinding-rev111-indexeddb.json` (mode 600). Peak renderer RSS was about 638 MiB. The browser and temporary preview were closed; dev 5193 remained HTTP 200. V91 owns a bounded visible post-Dig Fen cue and the identical #111 retry. Fen/Slate construction, cache, and return trade remain unproven in this V31 journey.

## Stage 6 contract after V91 wayfinding, 2026-10-10

V91's production retry advanced from authentic save #111 to a fully revealed Fen bridge footprint and validated save #123 at (-342.26, 1.20, 357.07). Works showed an eight-log shallow-channel bridge and correctly disabled confirmation while more than 3 m away. The next bounded UI stage restores the exact same-origin `.playwright-cli/wizard-v91d-fen-footprint-rev123-indexeddb.json` checkpoint, verifies state, gathers eight logs from visible reachable trees with the owned axe, uses the checked Works preview at a discovered Fen site, builds only when Ready, crosses the saved deck if reachable, and validates save/reload. It must stop at the first concrete material, navigation, preview, movement, or memory blocker rather than using source coordinates or synthetic inventory. Use one renderer and the 1.2 GB RSS cap. The browser/preview are closed and dev 5193 is available between stages. Slate, cache, and return trade remain later bounded stages.

## Stage 6 receipt, 2026-10-10

The authentic #123 save restored correctly with the fully revealed Fen site, axe and spade owned, soil, 102 coins, and zero logs. The tester equipped the axe. The nearest map resource dot proved to be a marsh herb; conspicuous tall trees west of the bank stood in teal wetland, so the tester did not enter water. A bounded dry-ground search of about 51 m back toward the interior found no Chop prompt or log-source guidance. The objective reverted to a Fen waypoint without explaining where to gather its eight logs. Inventory stayed at zero logs. Same-tab reload validated save #134 at (-307.94, 1.32, 318.58), retaining equipment, soil, and pose. The private mode-600 same-origin checkpoint is `.playwright-cli/wizard-v89-stage6-log-search-rev134-indexeddb.json`. Renderer RSS reached 1,235,488 KB after export, triggering immediate browser closure at the cap; temporary preview stopped and dev 5193 remained live. No dynamic request failed.

V92-A read-only source audit found two dry, reachable, unchopped four-log trees in the local pre-Fen pocket for this seed. They were still undiscovered, and the local `•` marked an herb; decorative wetland trees can have no Chop action. V92 owns a bounded novice timber cue, then an identical #123 retry. This is a log-source discoverability gap, not a construction or resource-exhaustion failure.
