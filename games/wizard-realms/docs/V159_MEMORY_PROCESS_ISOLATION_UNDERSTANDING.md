# V159 memory process-isolation understanding

## Original Ask

The active goal is a complete, playable Wizard Realms RPG. The user has specifically warned about RAM, requested one renderer rather than stopping parallel build and test work, and expects an intuitive first-region journey. V157's guarded browser journey stopped before the connected-river site.

## Input PRD / Spec

[V158 bounded memory attribution](V158_MEMORY_DISCRIMINATOR_TICKET_PACK.md) is the current diagnostic evidence and next-probe constraint, not a replacement for the full-game goal.

## Aligned Problem Statement

V158 observed large checked-save allocations and a first-arm Node RSS rise, but four test arms shared one process. A short browser out-and-back showed flat WebGL resource counts, not a proven scene leak. Run matched no-Canvas arms in separate capped processes and a separate fake-IndexedDB overwrite control to decide whether the residual memory trajectory is game save/replay work, test-backend retention, or still unresolved. Do not edit production behavior based on these measurements alone.

## Goals

- Measure the existing four V158 arms one per fresh Node worker process, retaining identical frame count and input sequence.
- Independently measure whether fake IndexedDB alone retains successive 1.2 MB same-key overwrites after GC.
- Preserve the player preview and browser-free diagnostic environment, then choose the next production owner only from evidence.

## Non-Goals

- No game-source, gameplay, migration, renderer, schema, dependency, PR or GitHub action.
- No increase to the established 450 MiB Node guard or 870400 KiB browser guard.
- No claim that Node fake-IDB results alone prove browser IndexedDB or organic renderer behavior.

## Constraints

- Only one heavy Node worker at a time, no browser renderer during diagnostics. Keep 5194 HTTP-reachable.
- Four V36 arms must use the same 96 legal movement frames; save arms checkpoint every 16, no-save arms stay below the 128 pending-frame cap.
- Exact-worker-PID independent 450 MiB RSS stop, old-space 512 MiB, GC exposed, no unbounded retries.
- All existing dirty files and the authentic barefoot profile are user-owned and must be preserved.

## Success Criteria

- Per-arm fresh-process peak and GC-settled RSS/heap, allocation sample, checked revision, root size and cleanup receipt, including actual arm order.
- Fake-IDB write versus no-write control reports six post-GC measurements with the same initial payload and number of blocks, or an honest NO-GO if it cannot safely run.
- A decision distinguishes supported and unsupported interpretations, with no speculative production edit.

## Open Questions

- Does save+view materially exceed no-save+view when each starts from a fresh process?
- Does fake IndexedDB alone show a monotonic settled-memory slope on same-key overwrites?
- If both are true, how much can be attributed to the test backend versus repeated V36 replay/copy work?

## Implementation Risks

Different Node processes can have startup variance, so compare slopes and allocation stacks, not one RSS value. A synthetic fake-IDB payload may not reproduce the shape of the checked V36 root. Store-only control must not share a heavy process with V36 profiling. A guard stop is partial evidence, not a reason to raise the cap.

## System Translation Routing

`not_qualified`: this is a bounded diagnostic of an existing game, not a whole-system port. System Translation Receipt: `not_applicable`.

## Product Agent Runtime

`not_required`: Wizard Realms does not ship an agent/model runtime in this diagnostic. No agent-runtime architecture obligation is changed.
