# Pocket Aquarium iOS Splash Provenance

The iOS launch artwork is original procedural work generated entirely by this repository. It uses geometric primitives, a custom bitmap wordmark, and a programmatic aquarium palette. No photograph, stock asset, external image, model output, or other third-party visual input is used.

- Source generator: `assets/icons/generate-ios-splash.mjs`
- Generation command: `node assets/icons/generate-ios-splash.mjs`
- Output catalog: `native/ios/App/App/Assets.xcassets/Splash.imageset/`
- Output format: 2732 x 2732, 8-bit RGB PNG without alpha
- Expected SHA-256 for each committed release PNG: `fcbf9303701e70e9f0f3186e41f3e2325e063759d74e31f088e9e83f5c6b5600`
- Expected SHA-256 for each decoded PNG scanline stream: `0334c26be2d919784f3a35032ccf8d9468b2d70616eb6c01f6946aa4916f8cca`

The generator is dependency-free apart from Node.js built-ins. All three scale slots use identical committed release bytes. Node.js distributions can bundle different zlib encoders, so reproduction is defined by the decoded scanline hash above while the exact committed release-file hash remains pinned separately.

Remaining human gate: before commercial distribution, the Account Holder must review this record and make the final ownership and commercial-rights attestation. This repository evidence removes third-party visual-input uncertainty but does not make that legal attestation on the Account Holder's behalf.
