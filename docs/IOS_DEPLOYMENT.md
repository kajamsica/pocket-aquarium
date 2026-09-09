# iPhone Deployment: Pocket Aquarium

This document describes the current mobile distribution paths:

1. **Live today: the installable iPhone PWA** (verified, no paid plan, no signing).
2. **Live today: the Android debug app** from the native mobile workflow.
3. **Next gate: a signed iPhone beta through TestFlight.** The reproducible Capacitor iOS host
   exists under [`native/`](../native/), but Apple signing and App Store Connect inputs are not
   provisioned yet.

> **Status: `PWA_AND_ANDROID_AVAILABLE_IOS_TESTFLIGHT_INPUTS_REQUIRED`.**
> The Progressive Web App is deployed and installable on iPhone right now. The native Capacitor 8
> iOS project has been **generated and committed** (`native/ios/`, Swift Package Manager, no
> CocoaPods) and can be re-staged and re-synced deterministically. The merged **Validate native
> mobile hosts** workflow in `.github/workflows/ios.yml` validates both the unsigned iOS Simulator
> app and installable Android debug APK. **No signed
> IPA or TestFlight build exists yet** because the protected Apple inputs and App Store Connect
> app record are absent. Local Xcode and signing state are also absent on this machine; see
> [Local toolchain evidence](#local-toolchain-evidence-recorded-2026-09-02).

---

## 1. Install the live PWA on iPhone (works today)

The game is a Vite-built React/Three.js Progressive Web App served over HTTPS by GitHub Pages.
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
- The workflow builds `realistic_light_transport/` and publishes its compiled **`dist/`
  artifact only**. Source, docs, tests, labs, and checkpoints are never published.

Primary sources: GitHub — *Using custom workflows with GitHub Pages*
(<https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>)
and *Changing the visibility of your GitHub Pages site*
(<https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site>).

### Verify the live deployment

```sh
# Runtime assets must return HTTPS 200:
base="https://kajamsica.github.io/pocket-aquarium"
for p in / /manifest.webmanifest /sw.js /asset-manifest.json /assets/icons/icon-192.png /assets/icons/apple-touch-icon.png; do
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
gh workflow run "Deploy Pocket Aquarium 3D app to GitHub Pages" --repo kajamsica/pocket-aquarium --ref main

# Watch the run and confirm success:
gh run list --repo kajamsica/pocket-aquarium \
  --workflow "Deploy Pocket Aquarium 3D app to GitHub Pages" -L 3
```

Never place a Personal Access Token or `GH_TOKEN` in the repository, the workflow, logs, or the
app bundle. The workflow itself uses the built-in `GITHUB_TOKEN` with least-privilege
`pages: write` / `id-token: write` permissions — no secret is stored.

---

## 3. Native mobile hosts (Capacitor 8), checked in under `native/`

Native iOS and Android apps wrap the same compiled web app with **Capacitor 8**. The hosts are a
**checked-in, isolated** package at [`native/`](../native/): pinned Capacitor 8.5.1 dependencies,
a deterministic staging boundary, an Xcode project using Swift Package Manager, and an Android
Gradle project. This changes nothing about the web runtime or Pages deployment. All hosts consume
`realistic_light_transport/dist`.

### What is committed vs. regenerated

Committed (the reproducible source of truth):

- `native/package.json` + `native/package-lock.json` — exact-pinned `@capacitor/core`,
  `@capacitor/ios`, `@capacitor/android`, and `@capacitor/cli` at `8.5.1`.
- `native/capacitor.config.json` — app identity (`Pocket Aquarium`,
  `com.kajamsica.pocketaquarium`) and the `webDir: "www"` boundary. **No remote server URL** —
  the app loads its bundled assets offline.
- `native/scripts/stage-web.mjs` — the one staging boundary (see below).
- `native/ios/**` — the generated Xcode/SPM project sources needed to open the app, including a
  `native/ios/App/CapApp-SPM/Package.swift` that pins `capacitor-swift-pm` to `exact: "8.5.1"`.
  The app icon is a `sips`-resized 1024×1024 derivative of the preserved RGB master
  `assets/icons/app-icon-master-v1.png` (the master itself is never modified).
- `native/android/**`: the generated Android Gradle project and launcher icons.

Regenerated locally and git-ignored (never committed, so there are no duplicated runtime bytes or secrets):
`native/node_modules/`, the staged `native/www/`, the copied `native/ios/App/App/public/`,
the generated `capacitor.config.json`/`config.xml` inside `ios/`, `native/ios/capacitor-cordova-ios-plugins/`,
Android build output, `DerivedData/`, `xcuserdata/`, and any signing material.

### The staging boundary

`native/scripts/stage-web.mjs` rebuilds `native/www` from the complete compiled Vite artifact.
It requires `index.html` plus hashed JavaScript and CSS entrypoints, recursively includes runtime
assets such as GLB models, rejects symlinks and unsafe paths, removes stale destination bytes
safely, and prints a deterministic per-file checksum receipt. `tests/native.test.js` proves the
staged tree is byte-identical to `realistic_light_transport/dist` and contains nothing extra.

### Reproduce the host from a clean checkout

> The **first three** commands **were executed in this environment** to generate the committed
> host (Node v24.2.0). They require only Node + the standalone Command Line Tools — **not** full
> Xcode. `npx cap open ios` was **not** executed here: opening the project (and any subsequent
> build/sign) requires full Xcode 26+.

```sh
cd native
npm ci                     # install the pinned Capacitor 8.5.1 toolchain (reproducible)
npm run sync:fresh         # build the 3D app, stage exact bytes, and sync native/SPM wiring
npx cap open ios           # open native/ios/App/App.xcodeproj in Xcode (needs full Xcode 26+)
# Or sync/open Android with npm run sync:fresh:android and npm run open:android.
```

Package **resolution and build** happen in Xcode / `xcodebuild` (from the `Package.swift` wiring),
not during `cap sync`.

### Prerequisites (all required before a local native build)

- **macOS** on Apple hardware. Xcode 26.0–26.3 requires macOS Sequoia 15.6 or later;
  Apple's current Xcode 26.6 requires macOS Tahoe 26.2 or later. *This host is on Sonoma
  14.8.8 and must be upgraded before any Xcode 26 release can be installed.*
- **Node.js 22 or higher** (used for the Vite build and Capacitor CLI). *Present here:
  Node v24.2.0.*
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
and *TestFlight* (<https://developer.apple.com/testflight/>), plus *Xcode SDK and system
requirements* (<https://developer.apple.com/xcode/system-requirements/>).

### Configure secure TestFlight distribution

The signed workflow must use the protected GitHub environment **`apple-testflight`**. Store all
seven values as environment secrets with these exact names:

- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_P8_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_APP_STORE_PROVISIONING_PROFILE_BASE64`

Account-holder setup:

1. In Apple Developer Certificates, Identifiers & Profiles, register the explicit App ID
   **`com.kajamsica.pocketaquarium`**. In App Store Connect, create the Pocket Aquarium app record
   using that bundle ID.
2. Create an **Apple Distribution** certificate. Install its private key, export the certificate
   and private key together from Keychain Access as a password-protected PKCS#12 (`.p12`), and
   retain that password for `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`.
3. Create an **App Store** provisioning profile for the same App ID and distribution certificate,
   then download the `.mobileprovision` file.
4. In App Store Connect, create an API key with access sufficient to upload this app. Download its
   `.p8` file once, then record its key ID and issuer ID.
5. Encode each file locally without printing it into terminal output. On macOS, copy each encoded
   value directly to the clipboard, for example `base64 -i Certificate.p12 | pbcopy`, then repeat
   for the provisioning profile and `.p8` key. Add the values through the GitHub environment UI.
   Do not paste credentials into issues, pull requests, chat, command arguments, or shell history.
6. Protect `apple-testflight` with required reviewers and restrict deployment branches to `main`.
   Keep account-holder approval as the release gate.

The workflow must be merged before use because a manually dispatched GitHub workflow is registered
from the default branch. After merge, open **Actions**, choose the signed TestFlight workflow,
select **Run workflow**, confirm `main`, and approve the `apple-testflight` environment deployment.
Each upload needs a unique, increasing iOS build number.

The distribution run builds and stages the accepted web runtime, syncs Capacitor, imports the
temporary certificate and provisioning profile, archives the App Store build, exports the signed
IPA, validates it, and uploads it to App Store Connect. Temporary signing files and keychains must
be deleted even when a step fails. GitHub cannot bypass Apple signing or provisioning.

After Apple finishes processing the upload, assign the build to an internal TestFlight group and
invite the tester's Apple Account email. On the iPhone, install Apple's **TestFlight** app, accept
the invitation, and install Pocket Aquarium from TestFlight. A TestFlight beta build is available
for **90 days** from upload; upload a newer unique build before it expires.

Rotate the API key, certificate, profile, or PKCS#12 password when exposed, when staff access
changes, and before expiry. Revoke compromised credentials in Apple Developer or App Store
Connect first, then replace the corresponding GitHub environment secrets. Never commit signing
files. The native ignore rules exclude `.mobileprovision`, `.p12`, `.cer`, and related material.

Troubleshooting categories:

- **Workflow is missing:** confirm the signed workflow was merged to `main` and includes manual dispatch.
- **Certificate import or signing fails:** confirm the `.p12` contains the private key, its password
  matches, the certificate is valid, and `APPLE_TEAM_ID` names its team.
- **Provisioning fails:** confirm the App Store profile is current and matches the explicit bundle ID,
  team, distribution certificate, and enabled capabilities.
- **Upload is rejected:** use a new build number and confirm the App Store Connect app record, API
  key access, bundle ID, version metadata, archive export, and validation results.
- **Build is absent in TestFlight:** wait for Apple processing, then inspect App Store Connect for
  compliance questions or processing errors before inviting internal testers.

---

## 4. Local toolchain evidence (recorded 2026-09-02)

Captured on this machine during this deployment step:

| Check | Command | Result |
|---|---|---|
| Host OS | `sw_vers` | macOS Sonoma `14.8.8` — below Xcode 26's minimum host OS, macOS Sequoia `15.6` |
| Xcode | `xcodebuild -version` | **Fails** — "tool 'xcodebuild' requires Xcode, but active developer directory `/Library/Developer/CommandLineTools` is a command line tools instance" |
| Active developer dir | `xcode-select -p` | `/Library/Developer/CommandLineTools` (Command Line Tools only — no full Xcode) |
| Signing identities | `security find-identity -v -p codesigning` | **0 valid identities found** |
| Provisioning profiles | `ls ~/Library/MobileDevice/Provisioning\ Profiles/` and the Xcode 16+ path | Both directories absent |
| Device tooling | `xcrun xctrace list devices` / `xcrun devicectl list devices` | Utilities not present (full Xcode absent) → cannot enumerate connected iOS devices |
| Node | `node --version` | `v24.2.0` (meets Capacitor's Node 22+) |

**Conclusion:** the checked-in iOS host compiles on GitHub's macOS 26 / Xcode 26 runner, and the
merged native workflow also produces the Android debug APK. This
local Mac needs a macOS upgrade before Xcode 26 can be installed. Full Xcode, a code-signing
identity, and a provisioning profile are absent, so no local iPhone build or signing is possible.

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
  Command Line Tools only, `npm ci` and `npm run sync:fresh` ran successfully
  and are reproducible; the SPM project (`native/ios/App/CapApp-SPM/Package.swift`) pins
  `capacitor-swift-pm` to `8.5.1`, and the app icon is a derivative of the preserved master.
- GitHub Actions has compiled the staged host as an **unsigned iOS Simulator app** on a macOS 26 /
  Xcode 26 runner, proving the checked-in Xcode/SPM project resolves and builds without signing.
- The same merged native workflow builds an installable Android debug APK from the same staged
  runtime. This does not provide or imply an Apple-signed build.

**Blocked (signed iPhone binary), and why no fake artifact is produced:**

- Opening the project and launching it in a local **Simulator** are blocked on a macOS upgrade and
  **full Xcode 26+**; Simulator use does not require Apple signing. `xcodebuild` currently fails
  locally because only the Command Line Tools are installed. The hosted unsigned Simulator compile
  is proven, but an interactive local Simulator launch is not yet claimed.
- A **physical-device** install or **TestFlight** upload additionally requires an Apple signing
  state (identity, App ID, provisioning profile). This machine has none:
  `security find-identity -v -p codesigning` reports **0 valid identities**.
- **No signed IPA or TestFlight build exists yet.** The protected `apple-testflight` inputs and
  App Store Connect app record are absent. An unsigned or ad-hoc-without-profile IPA cannot
  install on an iPhone, cannot go to TestFlight or the App Store, and would be a misleading
  artifact. The honest state is **`PWA_AND_ANDROID_AVAILABLE_IOS_TESTFLIGHT_INPUTS_REQUIRED`**: the
  host exists, is reproducible, and compiles today; the *signed build* becomes runnable once the
  prerequisites in [§3](#3-native-mobile-hosts-capacitor-8-checked-in-under-native) exist.

---

## Primary sources

- Apple — Turn a website into an app in Safari on iPhone: <https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios>
- Apple — Distributing your app to registered devices: <https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices>
- Apple — TestFlight: <https://developer.apple.com/testflight/>
- Apple, Add a new app: <https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/>
- Apple, Create API keys: <https://developer.apple.com/help/app-store-connect/manage-keys/create-api-keys/>
- Apple, Create an App Store provisioning profile: <https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/>
- Apple, Upload builds: <https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/>
- Apple, TestFlight overview: <https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/>
- Apple — Xcode SDK and system requirements: <https://developer.apple.com/xcode/system-requirements/>
- Capacitor — Environment Setup: <https://capacitorjs.com/docs/getting-started/environment-setup>
- Capacitor — Installing Capacitor (Getting Started): <https://capacitorjs.com/docs/getting-started>
- Capacitor — iOS Documentation: <https://capacitorjs.com/docs/ios>
- GitHub — Using custom workflows with GitHub Pages: <https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>
- GitHub — Changing the visibility of your GitHub Pages site: <https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site>
