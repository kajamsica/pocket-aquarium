# Android installation and distribution

Pocket Aquarium's Android workflow produces an installable debug APK for direct testing on an
Android phone. It is not a Google Play release build.

## Install the latest PR build on an Android phone

1. Open the Pocket Aquarium pull request on GitHub while signed in.
2. Open **Checks**, then select **Build installable Android debug APK**.
3. Open the completed workflow run and find its **Artifacts** section.
4. Download **PocketAquarium-Android-Debug** to the phone. GitHub downloads a ZIP archive.
5. Open the ZIP in the phone's Files app and extract `app-debug.apk`.
6. Tap `app-debug.apk`.
7. If Android blocks the install, open the offered settings screen and enable **Allow from this
   source** for the app that opened the APK, usually the browser or Files app. Return to the APK
   and tap **Install**. This permission is needed only for installs from that source and can be
   disabled again afterward.
8. Tap **Open**, or launch **Pocket Aquarium** later from its app icon.

Only install APKs downloaded from a trusted Pocket Aquarium workflow run. Managed devices may
prevent direct APK installation through an administrator policy.

## What the artifact contains

The workflow builds `realistic_light_transport`, stages its compiled output into the native
Capacitor host, and syncs those local web bytes into Android before Gradle runs. The installed
app opens the packaged game. It does not load the live GitHub Pages site as its application
runtime.

The uploaded artifact contract is fixed:

- GitHub artifact: `PocketAquarium-Android-Debug`
- Downloaded archive: `PocketAquarium-Android-Debug.zip`
- Installable file after extraction: `app-debug.apk`
- Build output: `native/android/app/build/outputs/apk/debug/app-debug.apk`
- Retention: 14 days

The APK is signed automatically with a development debug certificate. That makes it installable
for testing, but debug certificates are not suitable for app-store publishing.

## Debug APK versus Google Play

| Output | Purpose | Signing | Distribution |
|---|---|---|---|
| Debug APK | Direct testing on an Android device | Android development debug certificate | Download the workflow artifact and install it manually |
| Release AAB | Google Play submission | Private upload key, followed by Play App Signing | Upload through Google Play Console |

The current workflow intentionally creates no keystore, uses no repository secrets, publishes
no release, and uploads nothing to Google Play. A future Play Store release needs a separately
approved signing and publishing workflow that protects the upload key and builds a release AAB.

## Local Android development requirements

Capacitor 8 currently requires:

- Node.js 22 or newer. CI uses Node.js 24.
- Android Studio 2025.2.1 or newer for local Android development.
- An Android SDK installation.
- Android 7 or newer, API 24+, on the device or emulator.

After the native Android host is generated and its dependencies are installed, the local sync
and build contract is:

```sh
cd realistic_light_transport
npm ci
npm run build
cd ../native
npm ci
npm run sync:android
cd android
./gradlew :app:assembleDebug
```

This repository does not yet claim physical-device validation. The first authoritative APK
build is the integrated GitHub Actions run, followed by installation and launch on an Android
device.

## References

- [Capacitor 8 support policy and requirements](https://capacitorjs.com/docs/main/reference/support-policy)
- [Capacitor 8 Android support](https://capacitorjs.com/docs/android)
- [Android app signing](https://developer.android.com/studio/publish/app-signing)
