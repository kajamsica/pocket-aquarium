# Pocket Aquarium iOS Splash Provenance

The iOS launch artwork is a direct WebGL render of the Pocket Aquarium game at repository commit `bc972ea`. It contains only app-owned game content rendered by the existing Pocket Aquarium scene. No photograph, stock asset, external image, model output, or other third-party visual input was added to the capture.

- Source route: `http://127.0.0.1:4221/?dev=1`
- Source mode: saltwater God Mode tank created through the normal game UI
- Render settings: cinematic quality, 2732 x 2732 browser viewport
- Capture method: one Playwright browser page, with the HUD, coral tray, rockscape control, and camera hint hidden by capture-only CSS
- Output catalog: `native/ios/App/App/Assets.xcassets/Splash.imageset/`
- Output format: 2732 x 2732, 8-bit RGB PNG without alpha
- Expected SHA-256 for each committed release PNG: `250ed7c22db15f1105b578edcd9ee39ff92259f2e1b643bb9e7bed8c1d0d0592`

All three scale slots use identical committed release bytes. WebGL output can vary with the browser, GPU, and driver, so this record does not claim byte-reproducible recapture. The exact reviewed release bytes are pinned by SHA-256 instead.

Remaining human gate: before commercial distribution, the Account Holder must review the app-owned source assets and this capture receipt, then make the final ownership and commercial-rights attestation. This repository evidence removes external visual-input uncertainty but does not make that legal attestation on the Account Holder's behalf.
