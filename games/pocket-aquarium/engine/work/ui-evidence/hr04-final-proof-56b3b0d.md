# HR-04 Focused Browser Repair Proof

- Verdict: PASS
- Product revision before and after capture: `56b3b0d3b546646dd164e907daf353c6ed2ee17d`
- Branch: `fix/hr03-canonical-telemetry`
- Surface: `http://127.0.0.1:4179/`
- Browser method: Chrome browser control with semantic locators, responsive viewport control, visible screenshots, DOM health checks, console inspection, and observed page-asset inventory.
- Fixed comparison state: simulation paused, Day 181 at 00:00, Young reef, local circulation 62%, reef light 64%, water 245.9 L, S_eq 35.00 g/kg.

## Canonical flow parity

| Displayed value | Balanced | Cinematic | Result |
| --- | --- | --- | --- |
| Mean / peak speed | `0.111 / 0.220 m/s` | `0.111 / 0.220 m/s` | exact match |
| Mean shear | `0.546 s^-1` | `0.546 s^-1` | exact match |
| Low-flow area | `1.4%` | `1.4%` | exact match |
| Render scale | `0.65x` | `1.30x` | intentionally different |
| Flow grid | `24 x 12` | `32 x 16` | intentionally different |
| Maximum divergence | `3.78e-5` | `8.53e-4` | finite active-grid diagnostic |
| Pressure residual | `5.99e-3` | `4.40e-2` | finite active-grid diagnostic |

The entire water and chemistry panel text remained exactly unchanged across the quality switch.

## Visual diagnostics

- Balanced beauty retained readable water, acrylic boundaries, sand, rock, fish, coral, particles, and telemetry.
- Cinematic spectral selected the `spectral` diagnostic and reported `6 bands`. Six ordered violet, blue, cyan, green, amber, and red columns were visibly distinguishable across the water volume. Habitat, livestock, waterline, and tank boundaries remained readable through the transparent diagnostic.
- Cinematic flow selected the `flow` diagnostic and showed projected vectors across the water volume. Telemetry remained `0.111 / 0.220 m/s`, `0.546 s^-1`, and `1.4%`, with finite divergence `4.26e-5` and residual `7.74e-3` at capture.

## Focused regression journey

- Feeding: Young reef exposed 2 clownfish and 3 reef fish. Clicking `Feed 0.4 g` produced `7.2 mg N and 1.4 mg P entered the extensive ledgers`; TAN changed from 0.005 to 0.034 mg N/L and PO4-P changed from 0.025 to 0.031 mg P/L.
- ATO: toggling off produced Manual with 20.0 L remaining and the evaporation concentration warning. Toggling on restored Armed with 20.0 L remaining and the finite fresh-water-only note.
- Fishless gate: Cycling showed 0 clownfish, 0 reef fish, 0% coral health, 0% polyp extension, and disabled feeding. Young reef restored 2 clownfish, 3 reef fish, 90% coral health, 86% polyp extension, and enabled feeding.
- Mobile 390 by 844: the HUD exposed 221 px of internal scroll. The control deck moved to y=431.36 through 608.50, phase selector to y=695.11 through 720.36, and Reset to y=682.36 through 720.36, all within the viewport after scrolling.
- Short-wide 1280 by 500: the document exposed exactly 100 px of vertical scroll. The complete control deck moved to y=415 through 485, phase selector to y=443.75 through 469, and Reset to y=431 through 469.

## Browser and request health

- Canvas: exactly 1 and visibly rendered in every checked state.
- WebGL fallback and alert: one zero-area fallback node existed but was not visible.
- Fatal overlays: 0.
- JavaScript dialogs: 0.
- NaN text: absent.
- Context-loss text or event signal: absent.
- Console errors: 0.
- Console warnings: 1 known upstream warning, `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`
- Observed assets: 26 total, comprising 25 scripts and 1 stylesheet.
- Required request failures: 0 observed. Root, Vite client, main, App, styles, ReefScene, and reefSimulation requests returned HTTP 200.
- HTTP after capture: repair 4179 returned 200; preserved 4178 and 4177 each returned 200.

## Evidence hashes

| Artifact | SHA-256 |
| --- | --- |
| `hr04-balanced-beauty-56b3b0d.jpg` | `22642d99e713fb4891878b8f20c08b3208cc5f938313797f6ce2e88c3f32b5ca` |
| `hr04-spectral-volume-56b3b0d.jpg` | `bd3d885ebd7df88eedd70e89d3306473baecb9bf4f055d702db0961de3332f0d` |
| `hr04-flow-diagnostic-56b3b0d.jpg` | `c970928b8d1f9a4a06c599693a1259cbddffde533de257d3e87993a40f9f397d` |
| `hr04-mobile-controls-390x844-56b3b0d.jpg` | `89aa3fe83252cf1254889da61252bab0800db1151a514a0c6552fbf9231949bc` |

## Scope receipt

Only this report and four current revision screenshots were added. Existing controls, telemetry, and the already-running repair surface were reused. No product, test, dependency, configuration, prior evidence, main, or stable-surface file was modified. No deletion, new abstraction, fallback, or broad refactor was introduced. No smallest-diff tripwire was hit.
