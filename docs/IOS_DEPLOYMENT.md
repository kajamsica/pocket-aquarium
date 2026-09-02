# iPhone Deployment — Pocket Aquarium

This document describes the two ways Pocket Aquarium can reach an iPhone:

1. **Live today — the installable PWA** (verified, no paid plan, no signing).
2. **Follow-on — a native app via Capacitor** (a documented checklist, **not built here**
   because this Mac has no full Xcode and no code-signing identity).

> **Status: `PWA_DEPLOYED_NATIVE_BLOCKED_ON_XCODE_SIGNING`.**
> The Progressive Web App is deployed and installable on iPhone right now. A signed native
> binary is **not** produced: the required Apple toolchain (full Xcode) and signing state
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

## 3. Native app follow-on (Capacitor 8) — checklist, NOT built here

A native iOS app can wrap this same static web app with **Capacitor 8**. The steps below are a
**forward checklist for a future operator on a properly provisioned Mac**. They are
**deliberately NOT executed in this environment**, and no Capacitor packages, `package.json`,
native `ios/` project, or dependencies are added to this repository while Xcode and signing are
absent (see [§5](#5-what-is-done-vs-blocked)).

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

### Exact commands for a future operator

> **NOT EXECUTED in this environment.** Running these here would fail at the Xcode/signing
> steps and would add unbuildable native dependencies to a repository that is intentionally
> dependency-free. Run them only on a Mac with full Xcode 26+ and an Apple signing state.

```sh
# --- Stage a dedicated runtime web directory (run from the repo root) ---
# NOT EXECUTED HERE. Capacitor 8 REJECTS webDir values of "", ".", "..", "./", "../"
# (see cli/src/common.ts checkWebDir), so `--web-dir .` cannot be used. Instead copy
# ONLY the runtime app into a clean ./www — never the repo root, labs/, docs/, tests/,
# checkpoints/, .git, or the generated ios/ tree. This mirrors the Pages staging step.
rm -rf www
mkdir -p www
cp index.html styles.css manifest.webmanifest sw.js www/
cp -R js www/js
cp -R assets www/assets
rm -f www/assets/icons/app-icon-master-v1.png       # source master, not a runtime asset
rm -f www/assets/animals/ocellaris-clownfish-v1.png # invalid sprite, never shipped

# --- One-time native scaffold (run from the repo root) ---
# NOT EXECUTED HERE — adds package.json + Capacitor deps + an ios/ project.
npm init -y
npm i @capacitor/core
npm i -D @capacitor/cli
npx cap init "Pocket Aquarium" com.kajamsica.pocketaquarium --web-dir www
npm i @capacitor/ios
npx cap add ios

# --- Re-stage ./www and sync the static web app into the native shell after any change ---
# Re-run the staging block above (rm -rf www … cp …) so ./www reflects the latest runtime,
# then sync it into the native project:
npx cap sync ios

# --- Open the generated project in Xcode to set the signing Team ---
npx cap open ios
# In Xcode: select the target → Signing & Capabilities → choose your Team,
# confirm the bundle identifier, and let Xcode manage the provisioning profile.

# --- Verify the native toolchain is actually present (these currently fail here) ---
xcodebuild -version
security find-identity -v -p codesigning

# --- Distribute (choose one) ---
# a) Direct install to a registered device: Xcode → Product → Run (device selected).
# b) Ad-hoc build for registered devices: Xcode → Product → Archive → Distribute App.
# c) TestFlight/App Store: Archive → Distribute App → upload to App Store Connect,
#    then manage the beta in TestFlight.
```

Never embed Apple credentials, App Store Connect API keys, or signing secrets in the repository
or in any command output.

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
- Deterministic tests pass (`node tests/sim.test.js`, `node tests/pwa.test.js`).

**Blocked (native), and why no fake artifact is produced:**

- Native iOS packaging is blocked on **full Xcode 26+** and an **Apple signing state**
  (identity, App ID, provisioning profile) that this machine does not have.
- **No unsigned or fake `.ipa` is created.** An unsigned or ad-hoc-without-profile IPA cannot
  install on an iPhone, cannot go to TestFlight or the App Store, and would be a misleading
  artifact. Producing one would also mean adding unbuildable Capacitor/native dependencies to a
  repository that is intentionally dependency-free. The honest state is
  **`PWA_DEPLOYED_NATIVE_BLOCKED_ON_XCODE_SIGNING`**: the native path becomes runnable once the
  prerequisites in [§3](#3-native-app-follow-on-capacitor-8--checklist-not-built-here) exist.

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
