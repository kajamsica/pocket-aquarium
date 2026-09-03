# PWA install-surface ticket pack

## Goal

Make the deployed React/Three.js aquarium honestly installable on an iPhone from Safari and usable after the first successful online load. GitHub Pages and the Capacitor host must continue consuming the same complete Vite `dist` artifact.

Done when the production Pages subpath serves a valid manifest, iPhone icon, and service worker; the application registers that worker only in production over HTTP(S); the worker scopes all URLs to the Pages project path; the built artifact stages unchanged into Capacitor; and a real production browser confirms standalone metadata plus service-worker control.

## PWA-01 — Build artifact

- Add the manifest, service worker, and existing validated RGB icons through Vite's `public/` boundary.
- Use only relative URLs so `/pocket-aquarium/`, localhost preview, and native staging cannot diverge.
- Support portrait and landscape rather than forcing one orientation.
- Keep the app identity `Pocket Aquarium` and bundle-independent web id `./`.

## PWA-02 — Registration and offline shell

- Register only in a production build on `http:` or `https:`; never register in the active Vite dev server or Capacitor's custom scheme.
- Precache the document, manifest, and icons.
- Cache successful same-origin runtime assets as they are used, including hashed JavaScript/CSS, GLB models, and specimen textures.
- Use network-first navigation with the cached app shell as the offline fallback.
- Delete older Pocket Aquarium 3D caches on activation.

## PWA-03 — iPhone metadata

- Add `viewport-fit=cover`, manifest, Apple web-app capability/status-bar metadata, touch icon, favicon, theme color, and an accurate product title to the built HTML.
- Reuse the existing validated 180/192/512 RGB icon assets.

## PWA-04 — Production proof

- Build the real Vite artifact and inspect its file manifest.
- Stage that artifact through the existing Capacitor boundary.
- Merge through a focused PR so GitHub Pages deploys from `main`.
- Verify HTTPS 200 for the manifest, service worker, and icons.
- Open the production URL in a real browser viewport, verify manifest linkage, service-worker registration/control, no horizontal overflow, and core aquarium rendering.

## Non-goals

- Do not claim a signed native `.ipa`, TestFlight release, or physical-device native install without Apple signing evidence.
- Do not add a PWA framework or broaden the automated test suite during active gameplay development.
