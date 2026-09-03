# Pocket Aquarium — 3D Reef Keeper

A tank-first aquarium game built with React Three Fiber and the deterministic Pocket Aquarium
simulation. Establish and cycle a reef, manage real chemistry and equipment, stock compatible
animals, and feed fish through physical food/contact rather than a feed-button shortcut.

- **Canonical source folder:** `/Users/jamessicard/Documents/RESEARCH/Games/PocketAquarium`
- **Ecology model & research anchors:** [`docs/ECOLOGY_MODEL.md`](docs/ECOLOGY_MODEL.md)
- **Player source:** [`realistic_light_transport/`](realistic_light_transport/)
- **Deterministic tests:** root simulation/PWA/native contracts plus the 3D app's Vitest suite
- **Installable:** iPhone-ready Progressive Web App with an offline shell — see [Install on iPhone](#install-on-iphone-and-other-devices)

---

## Run it

The accepted player is a Vite-built React/Three.js app. The compiled `dist/` artifact is the
single input to both GitHub Pages and the Capacitor iOS host.

### From a local server (recommended)

```sh
cd realistic_light_transport
npm ci
npm run dev
```

### Tests

```sh
cd /Users/jamessicard/Documents/RESEARCH/Games/PocketAquarium
node tests/sim.test.js
node tests/pwa.test.js
node tests/native.test.js
cd realistic_light_transport && npm test && npm run build
```

The root Node harnesses preserve the deterministic model, PWA, and native packaging contracts.
The Vitest suite exercises the live 3D integration, physical feeding, controller, and scene math.

---

## Install on iPhone (and other devices)

The game is also an installable Progressive Web App with an offline shell, so it can live on
the iPhone Home Screen and open full-screen with no browser chrome.

1. Open the deployed HTTPS URL — the GitHub Pages build lives under
   `https://kajamsica.github.io/pocket-aquarium/` — in **Safari** on iOS.
2. Tap **Share → Add to Home Screen → Add**.
3. Launch it from the Home Screen icon. It opens standalone, respects the safe areas
   (notch / Dynamic Island / home indicator), keeps 44 px touch targets, and — after the
   first load — runs offline.

The install surface is emitted with the compiled 3D artifact and is safe under the
`/pocket-aquarium/` subpath:

- `realistic_light_transport/public/manifest.webmanifest` — `display: standalone`, flexible
  portrait/landscape orientation, theme/background colours, and relative 192/512 icon URLs.
- `realistic_light_transport/public/assets/icons/` — `icon-192.png`, `icon-512.png`, and
  `apple-touch-icon.png` (180 px) copied from derivatives of the preserved validated RGB
  master `app-icon-master-v1.png`.
- `realistic_light_transport/public/sw.js` plus Vite's `asset-manifest.json` — a versioned
  service worker that precaches the complete hashed JavaScript/CSS, GLB, specimen texture,
  shell, and icons; prunes older caches; and falls back to cached `index.html` offline.
  `src/main.tsx` registers it only for production HTTP(S), never the Vite dev server or
  Capacitor custom scheme, and the worker never handles cross-origin requests.

The installable PWA remains today's working iPhone distribution. A **native Capacitor 8 iOS
shell** is checked in under [`native/`](native/) and is reproducible from a clean checkout
(`npm ci` → `npm run sync:fresh` → `npx cap open ios`) — it wraps the exact same compiled
Three.js artifact used by Pages. GitHub Actions
proves the host compiles as an unsigned iOS Simulator app. Opening or running it in a local
Simulator requires full Xcode 26+ but not signing; physical-device and TestFlight distribution
additionally require an Apple signing identity and provisioning. This local Mac must move from
Sonoma 14.8.8 to at least Sequoia 15.6 before Xcode 26 can be installed. For the full deploy /
verify / redeploy path and native host details, see [`docs/IOS_DEPLOYMENT.md`](docs/IOS_DEPLOYMENT.md).

---

## Repository, visibility & the experimental reef lab

This game lives in its own standalone repository, **`kajamsica/pocket-aquarium`**, which is
**public**: GitHub Pages publishes from a *private* repository only on a paid plan, so the
free-plan Pages deployment requires a public source. A **write-access invitation** is pending
for collaborator **Ben Fowlersmith** (`Bioscopics`).
GitHub Pages (`.github/workflows/pages.yml`) builds and publishes
`realistic_light_transport/dist` only. Ben's Three.js renderer is no longer an experimental
side lab: it is the product surface where the Pocket Aquarium simulation and gameplay live.

---

## Preserved arcade checkpoint

The previous **arcade** build is preserved untouched under `checkpoints/arcade-v3` and owns
the browser save key **`pocket-aquarium-v1`**. This v4 ecosystem never reads, writes, or
deletes that key — it uses its own key (see [Save keys](#save-keys)), so installing or playing
v4 leaves any existing arcade progress intact.

---

## Feedback-mirror workflow

The accepted build is mirrored to the output feedback folder:

```
/Users/jamessicard/Documents/Codex/2026-09-02/can/outputs/fish-tank-game
```

Per the integration pack, the canonical source folder above is the source of truth; the
accepted build is copied into that output mirror after fan-in and after every accepted repair.
Review and browser-proof journeys are run against a fixed source snapshot, and the mirror is
refreshed only from accepted builds — never edited in place.

---

## Controls

**First run.** A habitat decision dialog opens — choose an **Amazonian freshwater** tank or an
**Indo-Pacific reef**. Nothing is pre-stocked; you cycle the tank before adding livestock.

**Top chrome.** Habitat, game day/time, welfare state, credits, and XP, plus the time
transport:

| Control | Action |
|---|---|
| **Pause** | Freeze simulation time (toggles back to your last speed) |
| **1× / 4× / 8×** | Simulation speed (see [Time & offline rules](#time-speed-and-offline-rules)) |

**Command surface.** Directly under the tank, an always-visible bar states the habitat as
**STABLE**, **WATCH**, or **CRITICAL**, gives a plain-language reason and how fresh your test
data is, and offers the single most useful next action with a one-line note on why it helps.
It is derived from the current state and mirrors the Guide's *Next best action*.

**Right dock (tabs).** Roving keyboard focus — **←/→ or ↑/↓** move between tabs, **Home/End**
jump to first/last:

- **Guide** — the current cycle phase and the single next move: a `Next best action` card
  (with a one-tap command button) and the cycle-phase timeline.
- **Water** — Test / 25% water change / Freshwater top-off, each teaching when it applies (a
  water change dilutes toxic waste and nitrate; a top-off only restores evaporated volume and
  never removes nitrate), then readings grouped by role — **toxic waste** (ammonia, nitrite),
  **environment** (temperature, pH, salinity, level) and **accumulation** (nitrate + advanced
  chemistry). Untested readings say so and prompt a test to reveal them (reef also shows ATO).
- **Livestock** — animal, coral, egg/fry, breeding-status, and microfauna cards.
- **Store** — livestock, corals, cultures, equipment, and tank-tier offers, each showing every
  lock reason when a purchase isn't yet legal.
- **Journal** — causal event log, plus the accessible **Start over…** control (clears
  ecosystem progress only; the arcade save is never touched).

**Tank surface.**

- **Click / tap the water** to drop food (feed action). Feeding into dangerous
  ammonia/nitrite warns you, because extra food worsens the water.
- **Click / tap an animal or coral** to open its inspector.
- With the canvas focused, **Enter** or **Space** feeds at the centre.
- **Escape** closes the inspector or an open modal.

**Accessibility.** All controls are keyboard-operable, the canvas has a live text summary,
panels use bounded internal scrolling (population growth never hides the store), and focus is
preserved across the ~6 Hz re-render.

---

## Save keys

| Key | Belongs to | Written by v4? |
|---|---|---|
| `pocket-aquarium-ecosystem-v1` | This v4 ecosystem (state version `1`) | Yes — autosaved |
| `pocket-aquarium-v1` | Preserved arcade checkpoint | **Never** |

The ecosystem save persists habitat, game time/day, speed, credits/XP, tank tier / water /
equipment / cycle & succession, livestock / corals / microfauna, tasks / milestones / log, and
the last real timestamp. Autosave is throttled to at most one write every two seconds, with an
immediate flush when the page is hidden or unloaded. Loaded saves are fully sanitized: every
numeric range is clamped and every id/enum validated, and invalid entries are quarantined to
the journal rather than crashing the renderer.

---

## Time, speed, and offline rules

- **1 game-day = 96 real seconds at 1×** (`DATA.secondsPerGameDay1x = 96`). At 4× and 8× a
  game-day passes in ~24 s and ~12 s respectively; **Pause** (speed `0`) stops time.
- The simulation advances in **fixed deterministic sub-steps** (`TICK_DAYS = 0.05` game-day,
  20 ticks/day) independent of the render frame rate, so the same elapsed game-time always
  produces the same result for a given seed.
- **Offline catch-up is capped at two game-days** (`DATA.offlineCapDays = 2`). On return the
  game applies the (capped) elapsed time and shows a return report. Because welfare loss is
  gradual, a catch-up jump can stress livestock but **cannot instantly kill a healthy animal**
  without a visible causal entry in the journal.
- The game also pauses when the tab is hidden and resumes your prior speed when you come back.

---

## Realism disclaimer

**"Hyper-realistic" means biologically coherent and recognizable — not a professional
life-support calculator, and not a claim of veterinary accuracy.** Real husbandry timescales
(new biofilters take weeks; corals grow over months) are **accelerated into readable game
time, not deleted**. Fish do not die from a single missed feeding: starvation, toxic water,
temperature/salinity shock, chronic crowding, and predation cause **staged** stress and
eventual death, and deaths and uneaten food feed back into the nitrogen cycle. The stocking
gate never silently places livestock into measurable ammonia or nitrite. See
[`docs/ECOLOGY_MODEL.md`](docs/ECOLOGY_MODEL.md) for every deliberate abstraction and its
research anchor.

---

## Architecture

All code is browser-native ES5-compatible JavaScript with **zero runtime dependencies, zero
network requests, and no assets**. Scripts load in a fixed order and each extends the single
`window.PA` namespace, which is what keeps `file://` usage working:

```
index.html
  ├─ styles.css
  ├─ manifest.webmanifest + sw.js   →  installable PWA shell (see “Install on iPhone”)
  ├─ js/data.js    →  PA.DATA, PA.ACTIONS, PA.validatePurchase
  │                   Immutable domain catalog: habitats, tiers, species, corals, equipment,
  │                   parameter bands, bundles, and pure purchase/compatibility validators.
  ├─ js/sim.js     →  PA.createState, PA.step, PA.stepDays, PA.dispatch,
  │                   PA.sanitizeState, PA.snapshotSummary, PA.offlineCatchUp
  │                   Deterministic fixed-step model: chemistry & cycling, succession, water
  │                   volume/evaporation/top-off/ATO, feeding, welfare/death/waste, corals &
  │                   polyps, microfauna, breeding, milestones/XP, persistence & sanitization.
  ├─ js/render.js  →  PA.createRenderer(canvas, getState, dispatch) → {resize, draw, destroy}
  │                   High-DPI procedural Canvas renderer + pointer hit map. Reads state and
  │                   only dispatches explicit pointer feed/select actions.
  └─ js/app.js     →  bootstrap only (DOM binding)
                      Binds the shell to PA: first-run habitat flow, guide/care actions, water
                      controls, store purchases, inspector, tank feeding, time controls, journal,
                      autosave/reload, offline report, and accessible status updates.
```

Load order matters: `data.js` must define `PA.DATA`/`PA.ACTIONS` before `sim.js`, which must
define the state/step API before `render.js` and `app.js`. `app.js` renders the DOM on a
state/action cadence (~6 Hz), not once per Canvas frame; the renderer animates on its own
loop; and it feeds the renderer a small **derived, read-only** view for a couple of fields
(water-level fraction, egg/fry counts, biodiversity score) without ever mutating authoritative
state.

`tests/sim.test.js` is a dependency-free Node harness that loads `data.js` + `sim.js` and
asserts the deterministic contract (both habitats, the cycle gate, top-off salinity, upgrade
coefficients, starvation progression, death/ammonia, group/tank/habitat/predator locks,
polyps/PAR, microfauna, clownfish and tetra breeding, corrupt saves, and the offline cap).

### File contract

| File | Responsibility |
|---|---|
| `index.html` | Shell: IDs/roles, PWA metadata, first-run dialog, time controls, dock tabs/panels, canvas + command surface |
| `styles.css` | Physical-console visual language (warm cream, dark outlines/offset shadows); command surface, safe-area/iPhone layout |
| `js/data.js` | Domain catalog + validators (`PA.DATA`, `PA.ACTIONS`, `PA.validatePurchase`) |
| `js/sim.js` | Deterministic simulation, actions, persistence helpers |
| `js/render.js` | Canvas habitat/animal/coral/microfauna renderer and input hit map |
| `js/app.js` | DOM binding, command surface + guide/water/store/journal, game clock, save/load, service-worker registration |
| `manifest.webmanifest` | Installable-PWA metadata (standalone, theme/background, relative 192/512 icon URLs) |
| `sw.js` | Versioned offline-shell service worker (same-origin cache-first, navigation fallback, no `file://` registration) |
| `assets/icons/` | RGB app-icon master + 192/512/180 (`apple-touch-icon`) derivatives |
| `tests/sim.test.js` | Deterministic Node contract tests (`node tests/sim.test.js`) |
| `tests/pwa.test.js` | Dependency-free static PWA/manifest/icon/service-worker contract tests (`node tests/pwa.test.js`) |
| `docs/ECOLOGY_MODEL.md` | Model rationale, deliberate abstractions, and research anchors |
