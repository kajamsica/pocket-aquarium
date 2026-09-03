# Pocket Aquarium — native iOS host (Capacitor 8)

An **isolated** Capacitor 8.5.1 shell that packages the accepted React/Three.js Pocket
Aquarium build as a native iOS app. GitHub Pages and Capacitor both consume the same
`realistic_light_transport/dist` artifact, so the browser and native hosts cannot drift.

- **App name:** Pocket Aquarium
- **App id:** `com.kajamsica.pocketaquarium`
- **Web dir:** `www` (staged, git-ignored — never edited by hand)
- **iOS dependency manager:** Swift Package Manager (Capacitor 8 default; no CocoaPods)

## What is checked in vs. generated

Committed (reproducible source of truth):

- `package.json` / `package-lock.json` — pinned Capacitor 8.5.1 toolchain
- `capacitor.config.json` — app identity and the `www` boundary
- `scripts/stage-web.mjs` — the one deterministic staging boundary
- `ios/` — the generated Xcode/SPM project sources needed to open the app

Regenerated locally (git-ignored — see `.gitignore` and `ios/.gitignore`):

- `node_modules/` (`npm ci`), `www/` (staging), `ios/App/App/public/` (copied web
  assets), `ios/App/App/capacitor.config.json` + `config.xml`, `ios/capacitor-cordova-ios-plugins/`,
  `DerivedData/`, `xcuserdata/`, and any signing material.

## Reproduce from a clean checkout

```sh
cd native
npm ci                     # install the pinned Capacitor toolchain
npm run sync:fresh         # install/build the 3D app, stage it, and sync the iOS host
npx cap open ios           # open App.xcodeproj in Xcode (requires full Xcode 26+; not run here)
```

`npm run stage` is intentionally build-free: it copies every file in an existing
`realistic_light_transport/dist` tree into `www` and prints a checksum receipt. It
requires Vite's hashed JavaScript and CSS entries, rejects symlinks and unsafe paths,
and never copies source, docs, tests, or repository metadata. Use `sync:fresh` from a
clean checkout; use `stage` only when the 3D build already exists.

## Signing, device, and TestFlight — environment-gated

The checked-in host compiles as an unsigned iOS Simulator app in GitHub Actions on macOS 26 /
Xcode 26. Local opening and an interactive Simulator launch require a macOS upgrade plus **full
Xcode 26+**, but not Apple signing. Physical-device installation and TestFlight additionally
require an **Apple signing identity / provisioning profile**. This Mac is on macOS Sonoma
14.8.8—below Xcode 26's minimum macOS Sequoia 15.6—and has no signing state. See
`../docs/IOS_DEPLOYMENT.md`.

The installable PWA remains the working iPhone distribution today.
