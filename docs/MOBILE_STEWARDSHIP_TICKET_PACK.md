# Pocket Aquarium: Mobile Stewardship Ticket Pack

Status: aligned and ready for implementation  
Target: `codex/player-fixes-integration` / PR #5  
Base revision: `1bae6dc06c3320652ea52d75a4fa5b95c59b221b`

## Goal contract

Pocket Aquarium should play as an aquarium-first stewardship game on an iPhone in portrait or landscape. The living tank is the persistent world. Compact, hideable glass controls help the player observe it, understand a condition, make one intervention, and watch the ecosystem respond.

The next playable vertical loop is:

`observe -> diagnose -> intervene -> watch response -> unlock/build -> personalize`

The first chapter teaches a fishless cycle as a causal process, not a timer or button checklist. The player adds a defined ammonia challenge, observes ammonia oxidation, observes nitrite oxidation and nitrate accumulation, and unlocks stocking only after the tank demonstrates safe processing capacity.

## Why this work exists

Phone testing exposed structural failures rather than isolated styling defects:

- the header, command card, time controls, and dock consume or overflow the phone viewport;
- the aquarium becomes a narrow background strip, especially in landscape;
- setup can be completed by repeatedly pressing the recommendation button without understanding nitrification;
- Water, Livestock, Store, and Journal feel like generic web panels rather than parts of the aquarium;
- equipment purchases change coefficients but do not visibly communicate installation or delivered effect;
- feeding is mechanically sound only after the recent fix, but the entry point and bottom contact surface do not match the rendered scene;
- the existing Guide duplicates the recommendation surface and loses relevance on mobile.

## Locked product decisions

1. The aquarium fills the available viewport and remains mounted behind every tool in portrait and landscape.
2. All secondary interfaces are closable translucent overlays. No full-page route replaces the tank.
3. The default HUD shows only the next meaningful condition/action, a compact welfare signal, and access to tools. Credits, score, day, habitat, and simulation speed move into expandable surfaces.
4. The recommendation surface explains `what changed`, `why it matters`, and `what to observe next`. It does not permit unexplained CTA spam.
5. Readiness is state-based. Calendar age and time compression cannot substitute for a successful fishless processing challenge.
6. Water care leads with a plain-language verdict and one recommended action, then reveals trends and advanced readings progressively.
7. Store cards show an image or recognizable silhouette, the problem the item solves, its delivered effect, whether it is installed, and all hard lock reasons before price.
8. A purchased representative equipment upgrade must appear in the aquarium and visibly alter an appropriate cue such as surface agitation, flow particles, water clarity, or lighting.
9. Livestock cards lead with the resident image, behavior, feeding state, welfare, growth stage, and compatibility needs. Raw bars are secondary.
10. Journal becomes a causal timeline: action, delayed response, milestone, and incident/recovery evidence. Start Over moves to settings.
11. A feeding tap selects horizontal entry. Food appears at the actual water surface, falls through the water, is eaten only on contact, or settles on the visibly rendered substrate and decomposes.
12. The rendered substrate owns the contact boundary. A single generic normalized bottom constant may not expose an invisible floor.
13. The dependency-free PWA, deterministic ecology model, save compatibility, water namespaces, welfare gates, and current PR remain intact.
14. Ben's `labs/reef-room` and any incoming Three.js work are reference material only. This slice does not migrate the main game to React or Three.js.

Interpretation: the request for an “opaque background where the tank is still visible” means translucent glass with enough contrast to remain readable.

## Non-goals for these packs

- full freeform aquascape placement;
- full 3D migration or integration of unpublished Ben work;
- a complete equipment degradation and incident library;
- every species, coral, breeding path, or cleanup organism;
- App Store signing or TestFlight distribution;
- a second PR for feeding or mobile work.

## Pack graph

```text
PA-201 Mobile Aquarium World ---------+
                                       +--> PA-203 Integrated phone proof
PA-202 Feeding Surface + Substrate ----+

PA-203 --> PA-204 Stewardship Chapter --> PA-205 Independent review + finish
```

PA-201 and PA-202 may run in parallel because their production file ownership is disjoint. PA-204 is serialized after the new shell because it reuses the same application and style surfaces. Optional user feedback on PA-203 never blocks PA-204.

## Hard viewport gates

At each viewport below, the document and fixed chrome must not overflow horizontally, controls must remain reachable, and the aquarium must remain the primary visible surface:

- 320 x 568 portrait;
- 375 x 667 portrait;
- 390 x 844 portrait;
- 844 x 390 landscape.

At 844 x 390, persistent overlays may not consume more than 96 CSS pixels of vertical tank space in their collapsed state. At portrait sizes, no persistent top bar may clip Welfare, Keeper Score, or credits because those values are not all rendered persistently.

## Ticket PA-201: Mobile Aquarium World

Lane: implementer  
Runtime: Claude CLI, Opus  
Branch: `codex/mobile-aquarium-world`  
Base: the accepted base revision above  
Owns: `index.html`, `styles.css`, the shell/navigation portions of `js/app.js`, and mobile-shell tests only

Implement a full-viewport tank composition inspired by the layout principle in Ben's reference: uninterrupted aquarium, floating translucent instrumentation, compact edge controls, and closable bottom/side sheets.

Required behavior:

- remove the desktop-style persistent brand/status/wallet grid from the mobile visual hierarchy;
- replace the large command card with a compact expandable “Now” chip/card;
- reduce time controls to one compact button that reveals pause and 1x/4x/8x choices;
- make the tool dock a translucent, closable overlay with a reliable height and internal scroll;
- keep only Care, Residents, Store, and Log as primary tools; fold Guide orientation into the Now/cycle surface;
- use safe-area insets and dynamic viewport units for installed iPhone PWA behavior;
- preserve keyboard, focus, screen-reader, and desktop behavior;
- preserve all current actions and simulation state.

Acceptance:

- no horizontal overflow at all hard viewport gates;
- landscape screenshot shows at least 70 percent of viewport height as unobstructed aquarium when tools are closed;
- portrait screenshot shows a visually dominant aquarium with collapsed controls;
- opening and closing every tool never unmounts or resizes the tank scene unexpectedly;
- the full existing automated suite remains green.

Smallest viable diff: reuse the current DOM, glass tokens, dock, render functions, and event delegation. Do not add a framework, dependency, router, or second UI system.

## Ticket PA-202: Feeding Surface and Substrate

Lane: implementer  
Runtime: Claude CLI, Opus  
Branch: `codex/feeding-surface-alignment`  
Base: the accepted base revision above  
Owns: `js/render.js`, feeding-coordinate portions of `js/sim.js`, and focused render/simulation tests

Make a feed interaction spatially honest without pretending food appears in mid-water:

- tapped x selects the surface entry location;
- an immediate ripple/splash confirms the selected entry point;
- food begins at the rendered waterline, falls with drag, and remains visible throughout descent;
- fish pursue, contact, and visibly bite the same particle before nutrition changes;
- uneaten food settles against a renderer-owned substrate profile that matches the visible reef or freshwater plate;
- the simulation and renderer share the same substrate/contact query rather than unrelated constants;
- settled food remains visible and later decomposes through the existing chemistry path;
- reduced-motion behavior keeps the causal order while shortening animation.

Acceptance:

- taps at left, center, and right produce entry at the corresponding horizontal location;
- tapping low in the water does not create food below the surface;
- a fish cannot gain satiation before contact;
- bottom-feeding and food decay tests still pass at 1x, 4x, and 8x;
- screenshots at reef and freshwater states show no pellet resting on an invisible floor;
- the full existing automated suite remains green.

Smallest viable diff: extend the existing food state and renderer path. Do not add a physics engine, canvas library, new assets, or alternate feeding subsystem.

## Ticket PA-203: Integrated phone proof

Lane: integrator and browser verifier  
Runtime: Codex CLI reviewer/finisher  
Depends on: PA-201 and PA-202  
Target: `codex/player-fixes-integration`

Integrate only accepted commits, resolve ownership conflicts narrowly, bump the service-worker cache once, and expose a cache-clean local URL. Run automated tests, then perform real browser journeys at every hard viewport gate.

The first feedback surface must let the user:

1. open the app on a phone-sized viewport;
2. hide all UI and watch the tank;
3. open Care without losing the tank;
4. reveal and use time controls;
5. tap three horizontal feed positions and observe surface entry, descent, pursuit, and consumption/settling.

Return the test URL immediately after this gate while PA-204 continues. Do not wait for optional feedback.

## Ticket PA-204: Stewardship Chapter

Lane: implementer  
Runtime: Claude CLI, Opus  
Branch: created from accepted PA-203 integration  
Owns: progression/cycle, care, store, livestock, journal presentation in `js/app.js`, `index.html`, `styles.css`, plus relevant tests; simulation edits only when a missing state transition is proven

Build one complete chapter from a new habitat through the first responsibly stocked and fed resident.

### Chapter beats

1. Prepare: choose water namespace, fill the tank, and commission life support.
2. Challenge: add a defined animal-free ammonia source.
3. Observe ammonia oxidation: show falling ammonia, rising nitrite, the active bacterial guild, and the condition that supports it.
4. Observe nitrite oxidation: show falling nitrite, rising nitrate, the second guild, and the supporting condition.
5. Prove capacity: require a safe validation window or repeat challenge result; do not unlock from age alone.
6. Stock gradually: open the Store directly to compatible starter inhabitants with adult-fit and social-group explanations.
7. Feed physically: guide one surface-entry feed and wait for actual consumption.
8. Upgrade a bottleneck: present a recommended filter or circulation upgrade, preview its exact effect, install it visibly, and show a before/after delivered metric or glance cue.

### Panel outcomes

- Care: a compact system verdict, causal trends, last test age, one recommended intervention, and expandable chemistry.
- Residents: large visual identity, observed behavior, appetite, life stage/growth, welfare drivers, habitat/social needs, and inspection.
- Store: category filter; visual item cards; “solves”, “changes”, and “requires” copy; visible installed state; full compatibility and capacity reasons; price last.
- Log: causal pairs and milestones, with filters for care, biology, additions, and incidents. Settings owns Start Over.
- Now: one current learning or care objective. It can point to a tool but does not instantly execute every setup step.

Acceptance:

- a first-time player can explain, from visible UI evidence, that ammonia becomes nitrite and nitrite becomes nitrate;
- repeated Now-button presses alone cannot complete the cycle chapter;
- time compression advances the same model but never claims readiness without a safe processing result;
- buying the representative equipment visibly installs it and changes a named delivered effect;
- Store lock reasons appear before affordability and cannot be bypassed;
- the aquarium stays mounted and visible through the entire chapter;
- existing save files load safely and all automated tests remain green.

Smallest viable diff: present state and mechanisms already modeled in `js/sim.js` and `js/data.js`. Add simulation state only when no existing field can support a required observation or gate.

## Ticket PA-205: Independent review and finish

Lane: independent reviewer followed by finisher  
Runtime: Codex CLI  
Depends on: PA-204

Review against the user's phone feedback, the ecology model, and this pack. Block on:

- clipped or off-screen HUD content;
- the aquarium ceasing to be the primary world;
- a cycle that can be completed as unexplained CTA spam;
- nutrition before fish/food contact;
- an invisible or mismatched substrate floor;
- an equipment purchase with no visible and measurable effect;
- loss of scroll, focus, safe-area, save, chemistry, compatibility, or welfare behavior;
- cross-namespace leakage;
- a new framework, dependency, or parallel UI architecture.

The finisher runs the full deterministic, renderer, PWA, and native-host suites; captures portrait and landscape acceptance evidence; updates PR #5; and leaves a cache-clean phone URL.

## Evidence and feedback policy

Surface PA-203 as soon as it passes its narrow gate. Continue PA-204 while the user tests it. Treat phone feedback as product evidence, not as authorization to merge PR #5. Merge remains a separate explicit decision.

