# Pocket Aquarium native mobile hosts (Capacitor 8)

An **isolated** Capacitor 8.5.1 shell that packages the accepted React/Three.js Pocket
Aquarium build as native iOS and Android apps. GitHub Pages and both native hosts consume the same
`realistic_light_transport/dist` artifact, so the browser and native hosts cannot drift.

The merged native workflow compiles an unsigned iOS Simulator app and an installable Android
debug APK. Signed iPhone distribution is the next environment-gated step.

- **App name:** Pocket Aquarium
- **App id:** `com.kajamsica.pocketaquarium`
- **Web dir:** `www` (staged, git-ignored — never edited by hand)
- **iOS dependency manager:** Swift Package Manager (Capacitor 8 default; no CocoaPods)
- **Android build system:** Gradle

## What is checked in vs. generated

Committed (reproducible source of truth):

- `package.json` / `package-lock.json` — pinned Capacitor 8.5.1 toolchain
- `capacitor.config.json` — app identity and the `www` boundary
- `scripts/stage-web.mjs` — the one deterministic staging boundary
- `ios/` — the generated Xcode/SPM project sources needed to open the app
- `android/`: the generated Android Gradle project and launcher resources

Regenerated locally (git-ignored — see `.gitignore` and `ios/.gitignore`):

- `node_modules/` (`npm ci`), `www/` (staging), copied platform web assets, generated Capacitor
  configuration, Android build output, `DerivedData/`, `xcuserdata/`, and any signing material.

## Reproduce from a clean checkout

```sh
cd native
npm ci                     # install the pinned Capacitor toolchain
npm run sync:fresh         # install/build the 3D app, stage it, and sync the iOS host
npm run open               # open App.xcodeproj in Xcode (requires full Xcode 26+)
npm run sync:fresh:android # rebuild, stage, and sync the Android host
npm run open:android       # open the Android project in Android Studio
```

`npm run stage` is intentionally build-free: it copies every file in an existing
`realistic_light_transport/dist` tree into `www` and prints a checksum receipt. It
requires Vite's hashed JavaScript and CSS entries, rejects symlinks and unsafe paths,
and never copies source, docs, tests, or repository metadata. Use `sync:fresh` from a
clean checkout; use `stage` only when the 3D build already exists.

## Platform gates

The checked-in host compiles as an unsigned iOS Simulator app in GitHub Actions on macOS 26 /
Xcode 26. Local opening and an interactive Simulator launch require a macOS upgrade plus **full
Xcode 26+**, but not Apple signing. Physical-device installation and TestFlight additionally
require an **Apple signing identity, App Store profile, App Store Connect app record, API key, and
protected `apple-testflight` environment approval**. No signed IPA or TestFlight build exists yet.
This Mac is on macOS Sonoma 14.8.8, below Xcode 26's minimum macOS Sequoia 15.6, and has no signing
state. See [`../docs/IOS_DEPLOYMENT.md`](../docs/IOS_DEPLOYMENT.md) for secure operator setup.

Android debug APK installation does not use the Apple gate. See
[`../docs/ANDROID_DEPLOYMENT.md`](../docs/ANDROID_DEPLOYMENT.md) for the current artifact and device
installation path. Production Google Play distribution remains a separate signing gate.

The installable PWA remains the working iPhone distribution today.
