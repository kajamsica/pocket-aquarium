# V139 memory repair understanding

## Original Ask

The active full-game goal requires long, playable exploration and a quest campaign. The user specifically asked that game development watch RAM, use only one renderer, and keep the preview available.

## Input PRD / Spec

V137's organic first-chapter route stopped at 872640 KiB renderer RSS before collecting a log. V138's shorter guarded route peaked at 485872 KiB and recovered during idle. V138's no-Canvas allocation sample identified repeated V14 validation, V13 bounded copying, and V17/V23/V28 replay as large transient allocation paths, with post-GC heap recovery. The browser spike's source remains unproven.

## Aligned Problem Statement

Establish whether a longer, phase-labeled normal-player route reproduces the renderer spike, and prove a safe contract for reducing redundant local movement allocations without weakening fail-closed save, witness, migration, or public entrypoint validation. Use that paired evidence to scope the smallest production repair and identical UI retry.

## Goals

- Repeat organic New Game movement toward the first log under the exact RAM guard, distinguishing movement, save, discovery and idle phases.
- Propose one concrete allocation reduction with explicit trust boundary, invariant and rejection tests, measured baseline and target.
- Preserve one renderer, the 5194 player preview, visual fidelity and checked state.

## Non-Goals

No product code edit, graphical downgrading, new quest, schema change, PR, merge, or deployment in this evidence pack. It does not prove long-session safety.

## Constraints

Use one disposable 5195 browser and pre-render self-tested 50 ms RSS sampler. Early stop at 870400 KiB, hard below 1024000 KiB. Avoid parallel memory-heavy Node probes. Existing worktree changes are user-owned. Do not infer a leak from cumulative allocations or RSS alone.

## Success Criteria

A real UI trace names the exact phase and current/peak/settled renderer, GPU and JS heap, plus screenshots and console/network. A source review names one bounded safe optimization, preserves every external validation boundary, and specifies tests and performance acceptance. The fan-in chooses a repair or next discriminator and states uncertainty honestly.

## Open Questions

Does the V137 spike depend on the extra traversal length, camera/scene exposure, save cadence, or profiling overhead? Can a trusted in-memory preview avoid repeat full-state decoding without accepting untrusted data or changing saved output?

## System Translation Routing

`not_qualified`; this is a performance investigation within one game engine. System Translation Receipt: `not_applicable`.
