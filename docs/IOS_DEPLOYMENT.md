# iPhone Deployment — Pocket Aquarium

This document describes the two ways Pocket Aquarium can reach an iPhone:

1. **Live today — the installable PWA** (verified, no paid plan, no signing).
2. **Follow-on — a native app via Capacitor** — the iOS host is now **checked in and
   reproducible** under [`native/`](../native/). What is still gated is *signing and shipping*
   to a device/TestFlight, which needs full Xcode 26+ and an Apple signing identity that this
   machine does not have.

> **Status: `PWA_DEPLOYED_NATIVE_HOST_CHECKED_IN_SIGNING_BLOCKED`.**
> The Progressive Web App is deployed and installable on iPhone right now. The native Capacitor 8
> iOS project has been **generated and committed** (`native/ios/`, Swift Package Manager, no
> CocoaPods) and can be re-staged and re-synced deterministically. A signed native **binary** is
> still **not** produced: the required Apple toolchain (full Xcode 26+) and signing state
> (identity, App ID, provisioning profile) are absent on this machine — see
> [Local toolchain evidence](#local-toolchain-evidence-recorded-2026-09-02).

---

## 1. Install the live PWA on iPhone (works today)

The game is a static, dependency-free Progressive Web App served over HTTPS by GitHub Pages.
iOS Safari can install it to the Home Screen and run it full-screen ("Open as Web App").

**This is a web app, not a signed native binary.** It installs through Safari's Home Screen
mechanism — it does **not** go through Xcode, code signing, the App Store, or TestFlight, and
it does not require an Apple Developer Program membership. It runs in Apple's WebKit web-app
container, keeps its own icon, opens standalone (no browser chrome), and works offline after
the first load via the service worker.

### Steps (on the iPhone)

1. Open **Safari** and go to **`https://kajamsica.github.io/pocket-aquarium/`**.
2. Tap the **Share** button.
3. Scroll down and tap **Add to Home Screen**, then tap **Add**.
   - Optionally choose **Open as Web App** so it launches like an app.
4. Launch it from the new Home Screen icon. It opens standalone, respects the safe areas
   (notch / Dynamic Island / home indicator), and runs offline after the first load.

Primary source: Apple — *Turn a website into an app in Safari on iPhone*
(<https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios>).

### What "installed PWA" gives you vs. a native binary

| Capability | Installed PWA (live now) | Signed native app (follow-on) |
|---|---|---|
| Distribution | Safari → Add to Home Screen | App Store / TestFlight / registered device |
| Apple Developer Program | Not required | Required |
| Code signing / provisioning | Not required | Required |
| Full Xcode on macOS | Not required | Required (Xcode 26+) |
| Offline / standalone / icon | Yes | Yes |
| Native APIs beyond WebKit | No | Yes (via Capacitor plugins) |

---

## 2. GitHub Pages deployment (already live — no paid plan)

The deployment is already live on the **public** repository `kajamsica/pocket-aquarium` and
needs **no paid plan**. GitHub Pages is free for public repositories; publishing Pages from a
*private* repository requires a paid plan (and private Pages *access control* requires GitHub
Enterprise Cloud). That is why this repository is public rather than private.

- Live site: `https://kajamsica.github.io/pocket-aquarium/`
- Build type: **GitHub Actions custom workflow** — `.github/workflows/pages.yml`
- The workflow stages and publishes the **runtime app only** (`index.html`, `styles.css`,
  `js/`, `assets/`, `manifest.webmanifest`, `sw.js`). `labs/`, `docs/`, `tests/`, and
  `checkpoints/` are never published.

Primary sources: GitHub — *Using custom workflows with GitHub Pages*
(<https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>)
and *Changing the visibility of your GitHub Pages site*
(<https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site>).

### Verify the live deployment

```sh
# Runtime assets must return HTTPS 200:
base="https://kajamsica.github.io/pocket-aquarium"
for p in / /manifest.webmanifest /sw.js /js/app.js /assets/icons/icon-192.png; do
  printf '%s  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$base$p")" "$base$p"
done
# Source-only paths must return 404 (never published):
for p in /tests/sim.test.js /docs/ECOLOGY_MODEL.md /README.md; do
  printf '%s  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$base$p")" "$base$p"
done
```

### Redeploy (existing workflow)

Deployment happens automatically on every push to `main`, and can also be triggered manually
because the workflow declares `workflow_dispatch`:

```sh
# Authenticate as the repository owner first (interactive; never commit a token):
#   gh auth login            # or: gh auth switch --user kajamsica

# Manually trigger a redeploy of the existing workflow:
gh workflow run "Deploy Pocket Aquarium PWA to GitHub Pages" --repo kajamsica/pocket-aquarium --ref main

# Watch the run and confirm success:
gh run list --repo kajamsica/pocket-aquarium \
  --workflow "Deploy Pocket Aquarium PWA to GitHub Pages" -L 3
```

Never place a Personal Access Token or `GH_TOKEN` in the repository, the workflow, logs, or the
app bundle. The workflow itself uses the built-in `GITHUB_TOKEN` with least-privilege
`pages: write` / `id-token: write` permissions — no secret is stored.

---

## 3. Native app host (Capacitor 8) — checked in under `native/`

A native iOS app wraps this same static web app with **Capacitor 8**. The host is a **checked-in,
isolated** package at [`native/`](../native/): pinned Capacitor 8.5.1 toolchain, a deterministic
staging boundary, and the generated **Swift Package Manager** Xcode project. It changes nothing
about the web runtime or the Pages deployment — the game's source of truth stays at the repo root.

### What is committed vs. regenerated

Committed (the reproducible source of truth):

- `native/package.json` + `native/package-lock.json` — exact-pinned `@capacitor/core`,
  `@capacitor/ios`, and `@capacitor/cli` at `8.5.1`.
- `native/capacitor.config.json` — app identity (`Pocket Aquarium`,
  `com.kajamsica.pocketaquarium`) and the `webDir: "www"` boundary. **No remote server URL** —
  the app loads its bundled assets offline.
- `native/scripts/stage-web.mjs` — the one staging boundary (see below).
- `native/ios/**` — the generated Xcode/SPM project sources needed to open the app, including a
  `native/ios/App/CapApp-SPM/Package.swift` that pins `capacitor-swift-pm` to `exact: "8.5.1"`.
  The app icon is a `sips`-resized 1024×1024 derivative of the preserved RGB master
  `assets/icons/app-icon-master-v1.png` (the master itself is never modified).

Regenerated locally and git-ignored (never committed — no duplicated runtime bytes, no secrets):
`native/node_modules/`, the staged `native/www/`, the copied `native/ios/App/App/public/`,
the generated `capacitor.config.json`/`config.xml` inside `ios/`, `native/ios/capacitor-cordova-ios-plugins/`,
`DerivedData/`, `xcuserdata/`, and any Apple signing material.

### The staging boundary

`native/scripts/stage-web.mjs` rebuilds `native/www` from an **explicit 16-file allowlist** that
matches the GitHub Pages runtime artifact exactly (root shell + `js/` + validated `assets/`):
`index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`; `js/{data,sim,render,app}.js`;
the two habitat plates; the three validated species sprites (clownfish **v2**, not the invalid
v1); and the three runtime icons (**not** the app-icon master). It fails loudly if any
allowlisted file is missing, removes stale destination bytes safely (never touching anything
outside `native/www`), and prints a deterministic checksum receipt. `tests/native.test.js`
locks all of this behavior.

### Reproduce the host from a clean checkout

> The **first three** commands **were executed in this environment** to generate the committed
> host (Node v24.2.0). They require only Node + the standalone Command Line Tools — **not** full
> Xcode. `npx cap open ios` was **not** executed here: opening the project (and any subsequent
> build/sign) requires full Xcode 26+.

```sh
cd native
npm ci                     # install the pinned Capacitor 8.5.1 toolchain (reproducible)
npm run stage              # rebuild ./www from the root runtime allowlist (deterministic)
npx cap sync ios           # copy ./www into ios/App/App/public and update the SPM manifest/wiring
npx cap open ios           # open native/ios/App/App.xcodeproj in Xcode (needs full Xcode 26+)
```

Package **resolution and build** happen in Xcode / `xcodebuild` (from the `Package.swift` wiring),
not during `cap sync`.

### Prerequisites (all required before any native build)

- **macOS** on Apple hardware (iOS builds cannot be produced off macOS).
- **Node.js 22 or higher** (this repo needs no build step of its own; Node is for the
  Capacitor CLI). *Present here: Node v24.2.0.*
- **Xcode 26.0 or higher** — Capacitor 8 requires a minimum of Xcode 26.0. *Absent here.*
- **Xcode Command Line Tools** — `xcode-select --install`. *Only the standalone Command Line
  Tools are present here; full Xcode is not.*
- **Dependency manager:** Capacitor 8 defaults to **Swift Package Manager (SPM)**;
  **CocoaPods** remains supported as the alternative (install via Homebrew if used).
- **Apple Developer Program membership** and, in Xcode, a signing **Team**.
- **Signing identity** (Apple Development / Apple Distribution certificate). *0 valid identities
  here.*
- **App ID / bundle identifier** registered for the app.
- **Provisioning profile** (development, ad-hoc for registered devices, or App Store). *None
  present here.*
- A **registered test device** (for direct install / ad-hoc) **or** **App Store Connect +
  TestFlight** for beta distribution.

Primary sources: Capacitor — *Environment Setup*
(<https://capacitorjs.com/docs/getting-started/environment-setup>), *Installing Capacitor*
(<https://capacitorjs.com/docs/getting-started>), *iOS Documentation*
(<https://capacitorjs.com/docs/ios>); Apple — *Distributing your app to registered devices*
(<https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices>)
and *TestFlight* (<https://developer.apple.com/testflight/>).

### Sign and distribute (gated — needs full Xcode 26+ and an Apple signing state)

The host is already generated (see §3), so a future operator does **not** re-scaffold it. They
re-stage, re-sync, open the committed project, set a signing Team, and distribute. The commands
below **were NOT executed here** because they require full Xcode 26+ and an Apple signing
identity — both absent on this machine (see [§4](#4-local-toolchain-evidence-recorded-2026-09-02)).

```sh
# From native/: refresh the bundle and open the committed project.
cd native
npm ci && npm run stage && npx cap sync ios
npx cap open ios
# In Xcode: select the App target → Signing & Capabilities → choose your Team,
# confirm the bundle identifier (com.kajamsica.pocketaquarium), and let Xcode manage
# the provisioning profile.

# Confirm the native toolchain is actually present (these currently FAIL here):
xcodebuild -version
security find-identity -v -p codesigning

# Distribute (choose one), all requiring the signing state above:
# a) Direct install to a registered device: Xcode → Product → Run (device selected).
# b) Ad-hoc build for registered devices: Xcode → Product → Archive → Distribute App.
# c) TestFlight/App Store: Archive → Distribute App → upload to App Store Connect,
#    then manage the beta in TestFlight.
```

Never embed Apple credentials, App Store Connect API keys, or signing secrets in the repository
or in any command output. The `native/.gitignore` excludes `*.mobileprovision`, `*.p12`, `*.cer`,
and other signing material so they can never be committed.

---

## 4. Local toolchain evidence (recorded 2026-09-02)

Captured on this machine during this deployment step:

| Check | Command | Result |
|---|---|---|
| Xcode | `xcodebuild -version` | **Fails** — "tool 'xcodebuild' requires Xcode, but active developer directory `/Library/Developer/CommandLineTools` is a command line tools instance" |
| Active developer dir | `xcode-select -p` | `/Library/Developer/CommandLineTools` (Command Line Tools only — no full Xcode) |
| Signing identities | `security find-identity -v -p codesigning` | **0 valid identities found** |
| Provisioning profiles | `ls ~/Library/MobileDevice/Provisioning\ Profiles/` and the Xcode 16+ path | Both directories absent |
| Device tooling | `xcrun xctrace list devices` / `xcrun devicectl list devices` | Utilities not present (full Xcode absent) → cannot enumerate connected iOS devices |
| Node | `node --version` | `v24.2.0` (meets Capacitor's Node 22+) |

**Conclusion:** Node is sufficient, but full Xcode, a code-signing identity, and a provisioning
profile are all absent, so no native iOS build or signing is possible here.

---

## 5. What is done vs. blocked

**Done (verified):**

- Installable HTTPS PWA is **live** at `https://kajamsica.github.io/pocket-aquarium/` and
  installs on iPhone via Safari → Add to Home Screen → Open as Web App.
- GitHub Pages deploys the runtime-only app from the **public** repository through the existing
  Actions workflow; the latest run completed successfully; runtime assets return HTTPS 200 and
  source-only paths return 404.
- Deterministic tests pass (`node tests/sim.test.js`, `node tests/pwa.test.js`,
  `node tests/native.test.js`).
- The **native Capacitor 8 iOS host is generated and committed** under `native/`. With Node +
  Command Line Tools only, `npm ci`, `npm run stage`, and `npx cap sync ios` all ran successfully
  and are reproducible; the SPM project (`native/ios/App/CapApp-SPM/Package.swift`) pins
  `capacitor-swift-pm` to `8.5.1`, and the app icon is a derivative of the preserved master.

**Blocked (native binary), and why no fake artifact is produced:**

- Opening the project, code-signing, building to a **simulator or device**, and **TestFlight**
  are blocked on **full Xcode 26+** and an **Apple signing state** (identity, App ID, provisioning
  profile) that this machine does not have. `xcodebuild` fails here (Command Line Tools only), and
  `security find-identity -v -p codesigning` reports **0 valid identities** — so no `xcodebuild`,
  simulator, device-install, or TestFlight result is claimed.
- **No unsigned or fake `.ipa` is created.** An unsigned or ad-hoc-without-profile IPA cannot
  install on an iPhone, cannot go to TestFlight or the App Store, and would be a misleading
  artifact. The honest state is **`PWA_DEPLOYED_NATIVE_HOST_CHECKED_IN_SIGNING_BLOCKED`**: the
  host exists and is reproducible today; the *signed build* becomes runnable once the
  prerequisites in [§3](#3-native-app-host-capacitor-8--checked-in-under-native) exist.

---

## Primary sources

- Apple — Turn a website into an app in Safari on iPhone: <https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios>
- Apple — Distributing your app to registered devices: <https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices>
- Apple — TestFlight: <https://developer.apple.com/testflight/>
- Capacitor — Environment Setup: <https://capacitorjs.com/docs/getting-started/environment-setup>
- Capacitor — Installing Capacitor (Getting Started): <https://capacitorjs.com/docs/getting-started>
- Capacitor — iOS Documentation: <https://capacitorjs.com/docs/ios>
- GitHub — Using custom workflows with GitHub Pages: <https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>
- GitHub — Changing the visibility of your GitHub Pages site: <https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site>
