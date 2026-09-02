# REEF-06 Final UI Proof

Verdict: `PASS` for integrated product revision `33ef28ccd4ee30fa5083edab790256c16254cb4f` at `http://127.0.0.1:4174/`.

## Scenarios

Scenario 1, evaporation and finite ATO:

1. Opened the URL, confirmed `Reef Room`, `marine_reef`, and one WebGL canvas, then selected Reset and Pause.
2. Paused baseline: Day 1 at 00:30, 245.9 L, 35.01 ppt salt-equivalent concentration, and 20.0 L RO/DI.
3. Selected ATO off, 48x speed, and Resume. The next paused observation was Day 12 at 12:28, 211.4 L, 40.72 ppt, and the unchanged 20.0 L reservoir.
4. Selected ATO on and Resume, then paused at Reservoir empty. The UI showed Day 14 at 00:25, 228.4 L, 37.69 ppt, and 0.0 L RO/DI.

Scenario 2, feed and a fresh ecological control state:

1. Selected Feed 0.4 g. Event 18 reported `Fed 0.40 g` and linked satiation to residual nutrient processing.
2. Selected Ugly phase. Visible signals were Microfauna 38%, Diatom film 48%, Green algae 31%, Cyanobacteria 20%, and Polyp extension 47%.
3. Set Reef light to 23% and Return flow to 91%. The UI showed local PPFD 63 and the flow causal event.
4. The final screenshot visibly showed the lower-light scene, local PPFD 63, 23% light, and 91% flow.

## Browser health

- Title: `Reef Room`; canvas: 1; visible namespace: `marine_reef`.
- Fatal role alerts: 0; Vite overlays: 0; console errors: 0.
- Required request failures: 0 observed. The browser inventoried 23 rendered assets, including every app module, stylesheet, React, React Three Fiber, and Three.js.
- Raw response statuses were not exposed by this browser surface. No missing-resource error appeared and the full UI rendered.
- One non-blocking console warning was present: `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`

## Screenshot evidence

| Artifact | SHA-256 |
|---|---|
| `initial-33ef28c.jpg` | `d41332195691f3efaeb70d9d71c2a757ea20f5b388d044a71eef71021289010b` |
| `final-33ef28c.jpg` | `2e236e9a795f9f0ee38fa12204872104d37fcdf70d8c187d74542128564eb8d4` |

All images are 1280 by 720 JPEG files containing only the local reef game.

## Validation

- `npm ci`: 73 packages installed, 74 audited, 0 vulnerabilities.
- `npm test -- --run`: 1 test file passed, 7 tests passed, duration 232 ms.
- `npm run build`: 36 modules transformed and the Vite build completed in 1.91 s.
- Build advisory: the 1,120.90 kB JavaScript chunk exceeds Vite's 500 kB advisory threshold. No dependency or production-code repair was authorized in this lane.

## Requirement matrix

| Requirement | Result |
|---|---|
| Exact marine baseline and locked namespace | PASS |
| Evaporation conserves salt and raises concentration | PASS |
| Finite ATO consumes RO/DI and recovers without overshoot | PASS |
| PPFD responds to depth, shading, light, and transmission | PASS |
| Feed action creates subsequent processing effects | PASS |
| Diatom, green algae, cyano, microfauna, and polyp signals stay separate and bounded | PASS |
| Long accelerated state remains finite and bounded | PASS |
| Default and fresh visible journeys plus browser health | PASS |
