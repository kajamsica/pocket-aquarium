# V142 bridge-crossing memory understanding

## Original Ask

The active full-game goal requires a sustained, playable Wizard Realms campaign. The user warned about RAM, asked us to use one renderer, and wants genuine quests. The first quest currently stops in a guarded fresh-player run before its claim.

## Input PRD / Spec

V141 reached a built creek bridge through normal UI, then the owned renderer hit the 870400 KiB early RSS guard during crossing after about 329.6 seconds. V140 lowered no-Canvas movement allocation by about 30%, but a longer UI run still reached high RSS. V136 source review found bounded scene windows and no proven retained leak, with discovery-driven instanced scenery as a transient candidate. V138 found large transient simulation validation/copy allocation and post-GC heap recovery. No unique browser byte owner is proven.

## Aligned Problem Statement

Discriminate whether the long-route RSS rise is primarily repeated V36 simulation/save work, scene and discovery churn, V8 committed pages, or mixed. Use paired bounded no-Canvas and scene-source evidence, then one guarded browser GC/phase diagnostic if needed. Select only a measured small repair and repeat the identical organic player journey afterward.

## Goals

- Quantify memory across 192 deterministic accepted no-Canvas V36 frames, views and checked saves under a strict Node cap, including post-GC settled values.
- Identify crossing/discovery-specific scene creation and disposal behavior from source, beyond the earlier general scene audit.
- Compare browser renderer RSS, JS heap and GPU before and after one diagnostic forced GC near the high-RSS bridge phase, without weakening the guard or claiming this is normal gameplay.

## Non-Goals

No production repair, visual downgrade, threshold increase, new quest, PR, GitHub action, or claim of long-session safety in this evidence pack. The generic post-bridge river-block message is a separate lower-priority UX defect.

## Constraints

One disposable 5195 renderer only; preserve 5194. Browser and Node profiling never overlap. Pre-render self-tested 50 ms exact-PID guard with early 870400 KiB stop, hard below 1024000 KiB. The Node profile uses one worker, 512 MiB max old space, and stops its own process near 450 MiB RSS. Existing dirty work is user-owned. No source-derived navigation in the UI lane.

## Success Criteria

The no-Canvas run reports accepted frames, save status, first and last block RSS/heap/external/array-buffer peak and post-GC settled values, and process cleanup. The scene audit reports exact crossing/discovery lifetime paths, disposal evidence and a falsifiable hypothesis. The browser receipt reports action phase, before/after forced-GC JS heap, renderer RSS and GPU, subsequent crossing or guard, screenshots, console/network and cleanup. Fan-in classifies the measured owner or states the next smallest discriminator.

## Open Questions

Do repeated checked saves cause settled no-Canvas RSS growth without scene rendering? Does browser RSS materially fall after V8 GC at high-RSS bridge phase? Are scene instance counts or recreation tied to discovery-window changes during crossing?

## Implementation Risks

GC instrumentation changes timing and cannot serve as organic quest proof. Node RSS and Chrome RSS are not directly comparable. An unchanged RSS after GC cannot by itself prove a WebGL leak, since allocators may retain freed pages. Stop at the guard even if it truncates the trace.

## System Translation Routing

`not_qualified`; this is a bounded diagnostic inside an existing game. System Translation Receipt: `not_applicable`.
