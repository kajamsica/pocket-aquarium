# V140 V27 replay allocation understanding

## Original Ask

The active full-game goal needs long, smooth Wizard Realms exploration while the user asks us to watch RAM, use only one renderer, and keep the player preview accessible.

## Input PRD / Spec

V138 measured about 330 MiB cumulative no-Canvas allocation per 16 movement frames with substantial V14 validation, V13 bounded copy and V17/V23/V28 replay stacks. V139 source review found V27 outer decoding immediately duplicated by the V23 visitor. V139's organic first-oak route peaked at 646064 KiB and settled after idle, below the guard. The V137 872640 KiB guard event remains unreproduced and its unique source is unknown.

## Aligned Problem Statement

Remove only redundant V27 pre-visitor decoding while preserving fail-closed input, segment, terrain, cooldown, save and migration checks. Measure allocation and test rejection parity, then retry the same short organic UI route under the same RAM guard. Do not claim this repairs the prior browser spike without evidence.

## Goals

- A smallest one-production-file change with focused adversarial tests and no new abstraction.
- Same-command capped V138 no-Canvas before/after comparison, aiming for at least 10% lower cumulative allocation per 16 movement frames.
- Independent source review and guarded real UI to first accessible oak, with 5194 kept available.

## Non-Goals

No content, visual fidelity, save schema, world generation, UI, quest, PR, GitHub action or deployment change. No claim of long-session safety from a short route.

## Constraints

Existing dirty files belong to the user. The V138 diagnostic file is untracked and may be run but not broadened. Keep one disposable 5195 renderer, self-tested 50 ms RSS guard, 870400 KiB early stop, hard below 1024000 KiB. Run Node allocation profile before UI browser opens, not concurrently. Avoid work account GitHub identity entirely by doing no GitHub action.

## Success Criteria

Tests prove malformed/proxy/empty frame rejection and accepted movement/event parity; TypeScript and focused tests pass; V138 sample shows an honest change or explicitly fails the 10% target; reviewer finds no validation bypass; real UI reaches oak or reports exact blocker under guard with phase memory and cleanup. If any check fails, revert only the new repair via `apply_patch` or leave it unaccepted with a clear next action, preserving all unrelated changes.

## System Translation Routing

`not_qualified`; this is a bounded optimization inside an existing game engine. System Translation Receipt: `not_applicable`.
