# HF-07 Revision-Bound Browser Acceptance

- Verdict: PASS
- Revision before and after capture: `a208ee6848e49a69db955d5a69d76b946d4c8e11`
- Isolated surface: `http://127.0.0.1:4178/`
- Preserved surface: `http://127.0.0.1:4177/`
- Browser method: Chrome browser control with semantic locators, responsive viewport control, visible screenshots, DOM health checks, console inspection, and observed page-asset inventory.
- Normal desktop viewport: 1184 by 916.

## Journey and exact observations

1. Reset, pause, and balanced beauty baseline
   - One WebGL canvas rendered at 1776 by 1374 device pixels in an 1184 by 916 visible region.
   - Namespace was `marine_reef`; phase was Cycling; fish count was 0; coral health and polyp extension were 0%; feed was disabled as `Fishless phase`.
   - Water was 245.9 L, S_eq was 35.01 g/kg, ATO reservoir was 20.0 L, and local PPFD was 210.
   - Balanced telemetry reported 6 bands, 0.65x render scale, 24 by 12 flow grid, 77.8% mean visible transmission, and 5.38 px chromatic spread.

2. Cinematic and diagnostics
   - Cinematic changed telemetry to 1.30x render scale, 32 by 16 flow grid, and 10.75 px chromatic spread.
   - The complete displayed water and chemistry text was exactly unchanged while paused.
   - Spectral and flow buttons each became the pressed diagnostic, each visibly changed the rendered canvas, and the flow view displayed projected streamlines.
   - The truth disclosure stated one-bounce real-time spectral approximation, sampled PPFD, and reduced-order 2D incompressible flow, with explicit full path-tracing and full 3D CFD exclusions.

3. Lifecycle, flow, and feed
   - Cycling showed 0 clownfish, 0 reef fish, 0% coral health, 0% polyp extension, and disabled feeding.
   - Young reef showed 2 clownfish, 3 reef fish, 90% coral health, 86% polyp extension, and enabled feeding.
   - At 8% local circulation, settled flow telemetry was 0.027 / 0.055 m/s mean / peak speed, 0.137 s^-1 mean shear, and 52.3% low-flow area.
   - At 55%, telemetry was 0.057 / 0.117 m/s, 0.340 s^-1, and 13.5% low-flow area.
   - At 95%, telemetry was 0.125 / 0.243 m/s, 0.624 s^-1, and 2.0% low-flow area. Particles, coral, and flow streamlines remained visible.
   - Feeding 0.40 g produced `7.2 mg N and 1.4 mg P entered the extensive ledgers`; TAN rose from 0.005 to 0.034 mg N/L and PO4-P rose from 0.025 to 0.031 mg P/L.

4. Evaporation and finite ATO
   - ATO was disabled through the visible control, speed was set to 48x, and the simulation was resumed.
   - Water fell from 245.9 L to 178.4 L while S_eq rose from 35.00 to 47.63 g/kg. The state remained finite and all livestock remained below the visible water surface.
   - Enabling the 20.0 L finite RO/DI reservoir produced `ATO added 20.00 L`.
   - The next bounded state was 193.9 L, S_eq 43.99 g/kg, and 0.0 L reservoir. Recovery reduced concentration without reaching or overshooting the 246.0 L target.

5. Responsive access
   - At 390 by 844, the clock, Day 205 at 00:32, Stabilizing lifecycle, `marine_reef` namespace, render controls, and aquarium controls remained available. The HUD exposed 195 px of internal scroll, and the full control deck, phase selector, and Reset were brought into view.
   - At 1280 by 500, the document exposed 100 px of vertical scroll. After scrolling 100 px, the control deck occupied y=415 to 485, the phase selector occupied y=443.75 to 469, and Reset occupied y=431 to 469.

## Browser and request health

- Canvas: exactly 1, visibly rendered in every checked state.
- WebGL fallback: present only as a zero-area Canvas fallback node, not visible.
- Alerts: no visible alert. The sole alert-role node was the same zero-area fallback.
- Fatal overlays: 0.
- JavaScript dialogs: 0.
- NaN text: absent.
- Context-loss text or event signal: absent.
- Console errors: 0.
- Console warnings: 1 known upstream warning, `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`
- Observed page assets: 26 total, comprising 25 scripts and 1 stylesheet.
- Required request failures: 0 observed. Root, Vite client, main, App, styles, ReefScene, and reefSimulation requests all returned HTTP 200.
- HTTP after capture: 4178 returned 200; preserved 4177 returned 200.

## Evidence hashes

| Artifact | SHA-256 |
| --- | --- |
| `hf07-balanced-beauty-desktop-a208ee6.jpg` | `7ff5e98d4c5980971b4e8ade10b80c1438994f2ed735766ec306bc58ab57515c` |
| `hf07-spectral-cinematic-desktop-a208ee6.jpg` | `8113ea3551e6c8a108e8b04cb15c900b20ef0f74c9973d3f03e28f059d7b22ab` |
| `hf07-flow-high-stocked-desktop-a208ee6.jpg` | `bad3332d09a595e1a897c28e2ae691a4db9ce012253a458e81658d11ebf144a3` |
| `hf07-low-water-desktop-a208ee6.jpg` | `0964826636398a285179765ef072ce58151c75a1a5d927d0be1953958fe24143` |
| `hf07-ato-finite-recovery-desktop-a208ee6.jpg` | `1e6465dedc825e4afae345220cb5fbf82e61769a5a2afcb22a83f96c153cd2d6` |
| `hf07-mobile-top-390x844-a208ee6.jpg` | `1496a921ccd426466bb09eb2330f3fe51f6f3b5c6d12bb2fa74c65dcb2765eac` |
| `hf07-mobile-controls-390x844-a208ee6.jpg` | `02fd7db47861e24ce7cadb44426192033f90e91ce2de93680accf5627818e880` |
| `hf07-short-wide-controls-1280x500-a208ee6.jpg` | `c21aabde35fc4b58405744f87509057166fff8ebf0f590f369d1187a9e85c607` |

## Scope receipt

Only this report and the eight revision-bound screenshots were added. No production, test, dependency, configuration, prior evidence, or stable-surface file was modified.
