# V55/V56 measured movement and save CPU owners

## Observed failure

The identical V30 fresh-ladder, dry upper-shelf five-second W journey now saves in 2,706.3 ms after V52-D, but still has an approximately 1,909 ms render gap. A more immediate movement defect is 64 accepted `controller.frame` calls at p50 72.5 ms and p95 74.4 ms before rendering, against a 50 ms step. The open-phase input queue reached 16 and dropped 37 sampled steps before save began. These are two distinct defects. [Trace](/var/folders/p2/6p9p9mhx1hv3s88f1rs0w9c40000gp/T/wizard-v52d.cORN94Muqw/.playwright-cli/wizard-v30-input-trace.json).

## Contract

Identify actual hot functions before another replay or writer change. Use one isolated real V30 browser and a compact Chromium CDP `Profiler` summary for movement and save. Never run a second renderer, raw heap snapshot, video, or other CPU-heavy test concurrently. Repeat the same ordinary UI start, axe/two Chops/four logs, built north ladder, climb to dry upper shelf, five-second W hold, save. Capture top self-time function, URL/line, sample count, controller trace spans, input queue/drop timing, browser closure, and profiler limitations. The profile may perturb absolute timings, so use prior unprofiled trace for latency comparison. No source or save mutation in this measurement unit.

## Conditional repair path

The successful movement call graph is V30 → V29 → V28 `advanceFrame`. With an empty V28 river-bridge ledger, V28 uses V27 replay, which decodes starting V23 progress before a V23 visitor decodes it again; V28 also projects the final pose for grounded status. These duplications are source-proven, but their portion of 72 ms is not measured. If the CPU profile confirms one dominates, write a separate smallest-diff unit to reuse the visitor's checked initial progress and preserve the pre-frame pose gate, or safely avoid redundant final projection. Compare exact progress, events, rejection/null parity for 64 frames, malformed starts/witnesses, cliff/river collision, airborne state, and V28→V30 save/reload. Then repeat the same unprofiled UI trace to measure p50/p95 and dropped input. Do not simply enlarge the queue, skip validation, or claim an improvement from unit tests.

The 771 ms V30 writer replay is synchronous; the 836 ms commit phase contains another independent successor replay, cache preparation, and IndexedDB CAS. If CDP cannot distinguish these, add opt-in catch-safe subphase timing to only the V30 flow and atomic store, retaining replay, strict source checks, cache admission, CAS, and transaction durability. Any worker or speculative movement during save is a separate architecture decision, not this first repair.

## V55 profile result and next repair unit

The sole isolated browser completed the fresh axe, two Chops, north Works ladder build, dry upper-shelf walk, and save, then closed. The movement profile contained 3,462 samples over 5.29 seconds. The largest self-time was procedural generation (`generation.ts`, anonymous resource placement, 2,173.8 ms; `terrainHeightAt`, 465.7 ms); `createGeneratedWorld` appeared separately at 189.2 ms. The later 8.37-second profile included input-queue drain and idle time, so it is not a pure save profile. No raw CDP profile was retained, so a precise parent-child call chain is not proven. Trace: `/var/folders/p2/6p9p9mhx1hv3s88f1rs0w9c40000gp/T/wizard-v55q.61yjKCI3Xw/.playwright-cli/wizard-v30-input-trace.json`.

The fresh journey built only one `works4` north ladder and no river bridge. Source inspection shows `resolvePublicV17GreenwaySite` calls `blockers`, which reconstructs `createStarterCliffGreenwayFacts(seed)` for every deterministic `works4` resolution. V17 progress validation and starter movement resolve built sites on movement frames. The first measured-owner repair is a bounded private cache of deterministic resolved `works4` sites, keyed by normalized seed and canonical ID. Retain all parse, seed, and geometry checks on cold resolution; cache success or null only after valid parse; return detached copies so callers cannot mutate cached canonical geometry. Do not cache mutable player state, skip independent validation, or alter `works3` legacy routing in this unit. A second source-replay duplicate optimization waits for a post-cache timing trace.

Proof must cover same-id resolution parity, invalid IDs, distinct seeds, mutation isolation, replay/collision/save tests, TypeScript, build, an independent read-only review, and the identical unprofiled five-second W journey with p50/p95 frame duration and dropped input count. If the same stutter remains after two grounded repairs, replan based on the new trace. Keep one browser renderer only.

## Delivery gate

One compact profile receipt and browser closed; then measured-owner patch, focused tests, TypeScript, build, independent review, identical unprofiled live retry, and observed-error report. The existing local Vite preview stays available for user access throughout.

## V55 repair receipt

Observed error | change | restart | retry result | next action: 64 accepted V30 movement frames at 72.5 ms median and 74.4 ms p95 against a 50 ms step, 37 dropped movement samples, plus a 2,706.3 ms autosave | add a bounded 64-entry private cache for canonical `works4` Greenway bridge/ladder site resolution, with detached returns and no change to `works3`, movement authority, replay or save checks | Vite hot-reloaded only the affected game module; sole browser was closed and reopened in an isolated fresh V30 context | advanced: exact axe/two Chops/four logs/north Works ladder/upper-shelf W5s route passed; 91 W5s frames had advance median 10.7 ms, p95 11.7 ms, zero movement input drops, max queue 11, and zero movement rejections; autosave observed during W5s took 490.7 ms, largest render gap 446.4 ms | continue remaining starter-world polish and separately validate above-grade ground placement, world-edge readability, and later routes.

The unprofiled retry trace was downloaded through the UI to `/Volumes/git/weave-agents/.playwright-cli/wizard-v30-input-trace.json`. Its 1,200-record ring dropped 49 old *diagnostic records*, not movement inputs; the timed W5s section and save remain intact. Autosave timing differs from the prior run, so its latency is supportive evidence, not an exact matched benchmark. The sole browser was closed after export. Focused tests passed (at least 45 across resolver, movement, flow, and river suites), TypeScript and production build passed, and independent read-only review returned GO. No PR or GitHub write was performed.
