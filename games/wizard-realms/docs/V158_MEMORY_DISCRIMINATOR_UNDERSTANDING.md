# V158 memory discriminator understanding

## Original Ask

The active goal is a complete playable Wizard Realms RPG. The user has repeatedly asked us to watch RAM, keep one renderer, and not stop useful parallel work. The latest quest-design request adds engaging rewards but does not authorize weakening the memory safety gate.

## Aligned Problem Statement

The guarded V157 browser journey stopped at 870,784 KiB renderer RSS before the connected-river bridge. The production owner of that rise is unknown. Distinguish repeated checked-save allocation from view/reveal work and WebGL resource retention without changing gameplay, save authority, or the player preview.

## Goals

- Measure matched save/no-save and view/no-view V36 no-Canvas journeys under a per-worker RSS stop.
- Measure resident WebGL resource counts at a few safe browser phase boundaries, without changing game source or opening more than one game renderer.
- Choose a production repair only if the measurements identify a falsifiable owner; otherwise preserve the uncertainty and select a smaller next probe.

## Non-Goals

- No renderer memory cap increase, visual downgrade, save-schema rewrite, speculative clone removal, or gameplay change.
- No PR, push, merge, or GitHub operation.
- No claim that a debug-instrumented browser pass is an organic long-session acceptance pass.

## Constraints

- Preserve all dirty work in `/private/tmp/pa-wizard-playable-v2` and the original barefoot profile. Use only a disposable browser/profile for the isolated diagnostic.
- Keep the player preview on port 5194 available. The isolated test port is 5195.
- Run at most one game renderer. No simultaneous heavy Node worker and game renderer. Use the established 870,400 KiB early renderer stop and 1,024,000 KiB hard ceiling.
- One Node Vitest worker, old-space 512 MiB, exact-PID independent 450 MiB RSS stop. Do not raise any cap.

## Success Criteria

- Both measurements have revision, inputs, process/PID, peak/settled metrics, limitations, and cleanup receipts.
- No-save arms remain under 128 pending frame witnesses; save arms checkpoint every 16 accepted frames.
- WebGL counts are read at explicit phase boundaries only, not traversed every frame.
- The decision names a supported owner or says unresolved with the next discriminating metric.

## Open Questions

- Does `fake-indexeddb` account for the rising settled Node heap after checked saves?
- Do renderer geometry/texture counts rise across return to a matching visible terrain window?
- Does stationary checked save raise browser RSS when resident scene counts remain flat?

## Implementation Risks

The diagnostic backend is fake IndexedDB, not Chrome IndexedDB. WebGL object counts are not memory bytes. Diagnostic interception can perturb timing and memory. Browser source HMR and an uncontrolled second renderer would invalidate evidence. The V157 final unsaved step is not progress.

## System Translation Routing

`not_qualified`: this is a diagnostic of an existing game, not a whole-system port. System Translation Receipt: `not_applicable`.
