# Pocket Aquarium — native iOS host (Capacitor 8)

An **isolated** Capacitor 8.5.1 shell that packages the accepted root Pocket Aquarium
PWA as a native iOS app. Nothing here changes the web runtime or the GitHub Pages
deployment — the game's source of truth remains the repository root.

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
npm run stage              # rebuild ./www from the root runtime allowlist
npx cap sync ios           # copy ./www into the iOS host + update the SPM manifest/wiring
npx cap open ios           # open App.xcodeproj in Xcode (requires full Xcode 26+; not run here)
```

`npm run stage` runs `scripts/stage-web.mjs`, which copies exactly the 16-file root
runtime allowlist (root shell + `js/` + validated `assets/`) into `www` and prints a
checksum receipt to stdout. It fails loudly if any allowlisted file is missing and
never copies the app-icon master, the invalid sprite, docs, tests, labs, or reef files.

## Signing, device, and TestFlight — environment-gated

Opening, signing, building to a simulator/device, and TestFlight all require **full
Xcode 26+** and an **Apple signing identity / provisioning profile**. Those are not
present in the environment where this host was generated, so no `xcodebuild`, simulator,
device install, or TestFlight result is claimed here. See `../docs/IOS_DEPLOYMENT.md`.

The installable PWA remains the working iPhone distribution today.
