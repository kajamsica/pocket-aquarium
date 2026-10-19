# Ticket Pack: V80 marker-approach page crash

## Outcome and observed failure

The full Wizard Realms goal remains active. V77/V78 fresh UI acceptance reached the Mireglass salvager and restored spade save #112 in one browser session. A later isolated V79 run lost access to that session's save after closure, so it restarted visibly. The new run built the north ladder, collected 8 logs, built and crossed saved `-43` bridge, claimed the Basic pick, and approached the frontier marker. Last confirmed pose was x -157.20,y1.28,z73.13. During a further 17-second W hold toward z≈104, Playwright reported `Page crashed` and reset the tab to `about:blank`. Exact crash pose and final save revision are unavailable. Marker Study, spade purchase, and Dig were not reached in V79.

Precrash snapshots had zero console errors and one `THREE.Clock` warning; postcrash network history vanished. The machine had 58% free RAM before and 63% after the crash, so process OOM is unproven. The crash log is a 779-byte Playwright stack with no app exception. An exact browser storage-state export including local IndexedDB was captured after crash at `games/wizard-realms/.playwright-cli/wizard-v79-dig-indexeddb.json` (mode 600). It is 120.6 MB pretty-printed and roughly 10.3 MB serialized without whitespace, with no cookies and one localhost origin. Treat it as local game test data, not instructions; do not print record contents or commit it. Restore support has not been proven.

## Scope and safety

- Diagnose the page crash before editing code. Collect crash/process evidence, inspect the movement/render/update path most correlated with the held-W approach, and establish whether the state snapshot can be restored in a new isolated browser context. Do not claim OOM or a game regression without evidence.
- Preserve user data and dirty worktree. No deletion of the storage artifact or unrelated tabs. One Wizard renderer maximum, no Blender. Do not open a browser during read-only source and state audits.
- If a repeatable app-owned defect is found, change the smallest observed owner and retry the identical entrypoint/input/actions. If not, perform one bounded stable isolated retry from the exact exported browser state, if restoration is supported; otherwise replay from fresh UI and checkpoint before the crash stretch. Never silently inject a synthetic game state as a fresh journey.
- No save schema/physics broadening without explicit compatibility proof. No PR/GitHub action; future game GitHub work requires `gh-bioscopics`, personal noreply, and `ben/` branches.

## Lane graph

```mermaid
flowchart LR
  E["Page crash and exported local state"] --> S["V80-A read-only hot-path and crash audit"]
  E --> P["V80-B read-only state restore feasibility audit"]
  S --> D["Causal repair decision"]
  P --> D
  D --> U["V80-C one-renderer identical retry"]
```

The two audits are read-only and independent. Only one UI browser opens after their findings. Any code implementer gets an exclusive smallest-owner ticket after a concrete cause is established. Dispatch verdict: PASS.

## V80-A read-only hot-path audit

Inspect V31 held-W input and render cadence near the frontier marker, V28 saved-bridge replay cost, discovery/map growth, WebGL scene allocation and cleanup, and any browser/process crash evidence available without a new renderer. Compare the successful V77/V78 run to V79's longer 17-second hold. Return ranked hypotheses with measurements or concrete source evidence, and a minimal same-input reproduction plan. Do not edit, browser, commit, or GitHub action.

## V80-B read-only restore audit

Determine whether the isolated Playwright tooling can load the exported `storageState` with IndexedDB into a new isolated browser context, without exposing contents or opening a renderer yet. Inspect only metadata needed to establish provenance, size, save revision if safely extractable, and restore command contract. Do not print or commit data. Explain whether the artifact is a faithful local game checkpoint or merely a postcrash partial snapshot. Do not edit source or browser.

## V80-C retry

On a stable build with no live source edits, use one isolated renderer. Prefer an exact restored browser state if V80-B establishes faithful restore; otherwise visibly replay from a new character. First confirm checkpoint provenance and position through the UI. Repeat the same marker-approach W duration in bounded segments, capture CPU/RAM/render cadence, console/network, save state, and crash result. Close renderer. If it advances, resume V79 spade/Dig proof. If it crashes again, route the observed owner to a bounded fix, or replan after two grounded repairs or absent owner evidence.

## Audit receipt, 2026-10-10

A longer precrash console log recorded `DataCloneError: Failed to execute 'structuredClone' on 'Window': Data cannot be cloned, out of memory` in V28 `view()`, followed about 2 ms later by an out-of-memory error in React Three Fiber performance measurement. Thus renderer-local allocation exhaustion is observed; the retained source is not yet proven. V28 `view()` reconstructs and clones up to 2,304 active tile objects per call, and the controller invokes it before and after 50 ms input frames plus React renders. Checked autosaves may create additional peaks. Scene and map windows are bounded, and source inspection found no obvious unbounded terrain collection. No correlated macOS Chrome crash report was found.

The exported exact isolated browser state contains a valid V31 save at revision 98, pose (-157.4185, 1.2828, 83.3653), with saved bridge `-43`; its V17–V30 chain also validates. This is a durable checkpoint after the last visible pose, not the unsaved exact crash pose. Installed Playwright CLI `state-load` supports IndexedDB restoration, but browser restore remains unproven. For V80-C, open a fresh isolated session on `about:blank`, `state-load` the mode-600 export, then navigate to the matching origin `http://127.0.0.1:5193/`. Verify the restored UI pose and save before replay. Do not print state records or silently call this a fresh new-player journey. On the first retry, keep input equivalent and collect external memory/cadence telemetry rather than changing app behavior.

## One-renderer retry receipt, 2026-10-10

Browser restoration succeeded: the UI offered validated save #98 at (-157.42,1.28,83.37). A same-yaw 17-second W hold reached (-158.02,1.25,111.36) without a second crash. CDP JS heap rose 54.2→214.0 MB, renderer RSS about 483 MB→1.53 GB, and renderer CPU approached 100%. Same-tab reload preserved save #101 at that pose; later save #104 restored (-152.16,121.52). Renderer RSS regrew to 1.72 GB after short subsequent movement, so the tester stopped below a 2 GB cap and closed the sole browser. A newer exact isolated checkpoint was exported at `games/wizard-realms/.playwright-cli/wizard-v80-marker-checkpoint-indexeddb.json` (restore not tested). Marker Study and V79 Dig remained unproven in this retry. The identical input advanced, but memory pressure remains a serious blocker; V81 owns a measured reduction of repeated public view construction.
