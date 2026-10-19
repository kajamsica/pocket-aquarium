# V24 first-start understanding

## Original Ask

Build a complete, intuitive Wizard Realms game. A fresh player should be able to start at the beginning and reach the first expanded Mireglass region without a misleading dead end or developer-only migration choreography.

## Input Spec

`GAME_DESIGN.md` gate 1 requires a fresh player to complete Greenway and Mireglass in the same authoritative public world, with save/resume and older-save preservation. Existing V24 source-pinning and explicit migration are safety contracts, not disposable implementation details.

## Aligned Problem Statement

On a blank origin, `?publicWorld=v24` reports `source-v23-missing` and offers only reload. The player cannot start a new V24-capable world from that entry. Add an explicit fresh-world choice that creates the required V23 source and promotes that exact source to V24 through existing checked flows. Existing V17-only, V23, and V24 saves must retain their current paths and never be overwritten.

## Goals

- A blank origin presents one clear Start new world choice and enters a validated V24 session.
- The new V23 foundation is source-pinned by V24 and remains independently readable.
- A stale choice, another tab creating V23 or V17, a partial target, a failed promotion, and source drift fail closed or remain recoverable without clearing data.
- Existing V23-to-V24 migration and V24 resume continue to work unchanged.

## Non-Goals

Default-route switch, silent upgrade of existing saves, save-schema change, direct V17-to-V24 promotion, new world content, browser crash repair, or a claim that the full first-region UI journey passed.

## Constraints

One game renderer total. The prior crashed tab's browser-control protocol forbids alternate browser workarounds. Keep port 5193 available. Work in the dirty `ben/wizard-playable-v2` checkout and preserve all other files and existing data. No commit, PR, push, GitHub action, dependency, or shared process change.

## Success Criteria

Focused fake-IndexedDB tests prove blank-origin create, source pinning, resume, stale-choice rejection, V17-only exclusion, existing V23 migration, and failed-promotion recoverability. TypeScript and build pass. A permitted later one-renderer browser journey must confirm the rendered first-start flow, inputs, console/network, and saved reload; source tests are not UI proof.

## Open Questions

None for the source behavior. Browser responsiveness and crash cause remain separately unresolved.

## Implementation Risks

`startPublicV23` is idempotent for a matching existing source. A stale fresh-start choice must not silently promote another tab's V23 progress. Use an explicit fresh-only option rechecked under its world lock. The two checked commits cannot form one cross-database transaction; if V24 promotion fails after a new V23 source commits, retain that source and offer the existing explicit V23 migration on retry. Never roll it back.

## System Translation Routing

`not_qualified`: this composes existing game flows and does not port an independently authoritative system. System Translation Receipt: `not_applicable`.

Product agent runtime: `not_required`; the delivered game does not run model-agent work.
