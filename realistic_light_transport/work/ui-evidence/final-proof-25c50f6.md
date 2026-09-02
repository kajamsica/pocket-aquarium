# RRF-06 Repaired Final Proof

Verdict: `PASS` for repaired product revision `25c50f65275db793e02a0e930a9cfb698dc1012b` at `http://127.0.0.1:4175/`.

## Scenario A: Fishless commissioning

- Reset exposed the commissioning baseline. The simulation was paused and Commissioning was selected to retain a stable evidence frame.
- The UI showed `marine_reef`, Day 1 at 00:14, 246.0 L, 35.00 g/kg S_eq, TAN 0.179 mg N/L, NO2-N 0.035 mg N/L, NO3-N 1.50 mg N/L, and PO4-P 0.035 mg P/L.
- Operating target was 246.0 L and the distinct ATO trigger was 245.5 L.
- Fish counts, coral health, and polyp extension were zero. No fish or coral rendered in the tank.
- Fishless phase feed was disabled. The visible speed maximum was 48x, with no 120x control.
- The expanded disclosure stated that local circulation is a gameplay proxy, not pump turnover or measured local velocity or shear.

## Scenario B: Stocked low water and finite recovery

- Young reef restored 2 clownfish, 3 reef fish, 90% coral health, and 86% polyp extension. Feed became enabled.
- Feeding 0.4 g reported `7.2 mg N and 1.4 mg P entered the extensive ledgers.`
- Reef light was changed to 36% and Local circulation proxy to 88%, each with a causal event.
- With ATO off at 48x, volume fell to 189.8 L, water level to 0.316 m, and S_eq rose to 44.89 g/kg.
- Visual inspection at the extreme water state showed fish and visible particles below the rendered surface.
- Finite ATO recovery raised volume to 206.7 L, reduced S_eq to 41.38 g/kg, and consumed the reservoir to 0.0 L without exceeding the 246.0 L target.

## Scenario C: Responsive state

- At 390 by 844, the clock, Day 20 at 18:14, Young reef lifecycle, `marine_reef`, and controls remained present.
- The mobile HUD had client height 844 and scroll height 942. A real 98 px internal scroll brought Reset from top 893.86 to 805.86, fully inside the viewport.
- At 1280 by 500, the document height was 600. A 100 px page scroll moved Reset from top 531 to 431, proving short-wide controls are reachable.

## Browser health

- WebGL canvas: 1; fatal role alerts: 0; Vite overlays: 0; console errors: 0.
- Required request failures: 0 observed. The browser inventoried 24 rendered assets, including all app modules and the stylesheet.
- Raw response statuses were not exposed by the browser surface. The full app rendered and no missing-resource error appeared.
- One non-blocking upstream warning remained: `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`
- Both the preserved 4174 surface and repaired 4175 surface returned HTTP 200.

## Evidence

| Artifact | Size | SHA-256 |
|---|---:|---|
| `empty-desktop-25c50f6.jpg` | 1184x916 | `25a2a9301493b96cda4ddf366b7cc177eb013b1b9120b05d54c03facf204df77` |
| `stocked-low-water-25c50f6.jpg` | 1184x916 | `e396d52dade04939fb243999c6fda8271b09fa306e4f955084a06e3a41c95e53` |
| `mobile-responsive-25c50f6.jpg` | 390x844 | `4728d4b896101c86d76a18e3bf4811cc330e6e6d26aa396bc6f679277fc4db28` |

## Validation

- `npm ci`: 73 packages installed, 74 audited, 0 vulnerabilities.
- `npm test -- --run`: 1 file passed, 8 tests passed, duration 211 ms.
- `npm run build`: 36 modules transformed and built in 259 ms. The existing non-fatal chunk-size advisory remained.
- Product scan: no `specificGravity`, `SPECIFIC_GRAVITY`, `salinityPpt`, `120x`, or `Return flow` match remained in `src/`.

## Requirement matrix

| Requirement | Result |
|---|---|
| Fishless immutable marine commissioning baseline and S_eq semantics | PASS |
| Water-only evaporation and finite ATO mass conservation | PASS |
| Explicit nitrogen and phosphorus mass-ledger behavior | PASS |
| Honest fishless and stocked feeding | PASS |
| Fishless early phases and bounded later demo stock | PASS |
| Finite responsive PPFD | PASS |
| Long-step finite and bounded state | PASS |
| Low-water rendering bounds | PASS |
| Mobile and short-wide access | PASS |
| Console, overlay, and required asset health | PASS |
