# Ticket Pack: V25 Checked Valley Save Path

## Summary

The reviewed V25 river and root rules are pure functions. They cannot yet protect a live game because there is no V25 atomic store or locked source-pinned writer. This pack creates that save path without changing V17, V23, or V24 worlds. It is the next safety gate before exposing a playable V25 route. The aligned user problem and completion criteria are in `STARTER_VALLEY_WORLD_LOOP_UNDERSTANDING.md`.

Locked behavior: a V25 world is a copy of one fully checked live V24 head. Its own IndexedDB record is separate. Each move is replayed through the V25 per-frame river gate before a compare-and-swap write. A stale revision, changed V24/V23/V17 source, invalid root, or failed lock blocks rather than silently resetting a save. No V25 excavation UI or invented digging witness in this pack.

Goal aligned. System translation: not_qualified. Agent runtime: not_required. No GitHub action, commit, PR, push, browser renderer, or server restart is authorized.

## Interface and sequence

1. Export `inspectPublicV24UnderLock(store, sourceStore, ancestorStore)` from the V24 flow, returning the same `PublicV24Inspection` shape as `inspectPublicV24`, but never acquiring a second lock. It must perform the same complete V24, V23, and V17 source checks. Existing V24 APIs and results remain unchanged.
2. Add `createAtomicV25Store(factory, name?)`, `AtomicV25Read`, and separate V25 database name from the existing V25 migration module. Mirror the V24 one-record proof-token CAS semantics, strict bounded raw comparison, exact root decode, validated cache, and transaction completion behavior. Never touch the V24 database. A candidate after an existing root must match the previous V25 head and lineage exactly.
3. Add `inspectPublicV25`, `startPublicV25`, `resumePublicV25`, and `commitPublicV25` in `publicWorldV25Flow.ts`. All public operations take the existing world lock once. Every operation inspects the complete live V24 source under that lock, comparing its head and lineage with `lineage.sourceReceipt`. Start only from a supplied, freshly checked V24 receipt and a missing V25 target. Commit accepts only inherited V24 witnesses for now. For frame batches use one observed `visitPublicV23Frames` pass and the canonical `publicV25RiverPassage` callback; for other witnesses reuse V24 replay/action behavior. Apply the decoded witness once, form the next V25 head with unchanged excavation, then commit through the atomic V25 proof. Expose a useful `river-needs-bridge` rejection before CAS rather than freezing on an opaque invalid-root result. Do not trust a client-supplied pose, resource, clock, or work list.

## Lane graph and topology audit

```
Wave 1: A V24 under-lock inspection export || B V25 atomic store
Wave 2: C V25 flow, consuming A and B
Wave 3: R read-only integrated review
```

A and B are independent, disjoint file owners. C depends on their fixed APIs. R depends on all three. Maximum productive parallel width is two. There is no artificial worker and no UI worker in this pack. The next UI pack depends on R's GO and uses a separate route, not a V24 save rewrite. Dispatch verdict: PASS.

## Smallest viable diff

Expected files: `engine/src/domain/publicWorldV24Flow.ts`, `publicWorldV24Flow.test.ts`, new `atomicV25Database.ts`, new `atomicV25Database.test.ts`, new `publicWorldV25Flow.ts`, new `publicWorldV25Flow.test.ts`. Do not edit V17/V23/V24 snapshot or atomic stores, V25 river/passage/snapshot, UI, package files, or art. Reuse V24 flow, V24 atomic store design, V25 root decoder, `visitPublicV23Frames`, and `publicV25RiverPassage`; do not create a generic database framework. Budget: <=650 net lines total. A smaller coherent implementation is preferred. Extra files, dependencies, old-save behavior changes, or a second movement implementation trigger replan. Existing dirty files belong to their current owners.

## Tickets

### A: V24 complete source inspection

Role implementer only. Read this pack and the `auto-planner-ticket-pack` and `smallest-viable-diff` skills completely. Own only `publicWorldV24Flow.ts` and `.test.ts`. Add exactly the under-lock export above with a no-nested-lock test, full-root/source drift checks, and old public result parity. The exported helper should not leak a CAS proof or imply a second source read. Budget <=65 net lines. Run focused V24 flow tests and TypeScript. Return changed-file/net-line and full validation receipt. No browser/server/GitHub action, commit, or nested agent.

### B: V25 atomic store

Role implementer only, same skills and pack. Own only `atomicV25Database.ts` and `.test.ts`. Implement the stated proof-token, strict one-root CAS store and isolated database. Test missing, genesis, valid revision, stale proof, malformed or extra keys, reader after a fresh store instance, and no V24 database mutation. Budget <=230 net lines. Run focused tests and TypeScript. No browser/server/GitHub action, commit, or nested agent.

### C: V25 locked flow

Role implementer only, same skills and pack. Own only `publicWorldV25Flow.ts` and `.test.ts`. Depends on A and B. Build the declared inspect, start, resume, commit APIs. Test a complete V17 to V23 to V24 to V25 migration under one lock, V24 source immutability and drift, stale CAS/revision, dry movement acceptance, wet bypass rejection including a two-frame return, and a saved bridge acceptance. Preserve existing V24 action semantics; excavation remains unchanged. Budget <=355 net lines. Run focused V25 plus V24 flow/root tests and TypeScript. No browser/server/GitHub action, commit, or nested agent.

### R: integrated reviewer

Role reviewer only, read-only. Inspect exact source-pinned chain, one-lock semantics, CAS proof consumption, canonical river rejection, and old-profile parity. Run focused flow/store/root suites and TypeScript. Findings first, GO/NO-GO, topology/scope/reuse/deletion/tripwire verdict, residual risks. No browser/server/GitHub action.

## Delivery and assumptions

Delivery milestone: pre_surface. The existing V24 preview stays available. V25 becomes user-visible only after this pack passes and a later route/controller pack meets the minimum honest safety gate. A local storage test is not UI proof. The V25 root's three-slot latest-transition contract remains; this writer uses the same checked CAS lineage discipline as V24. The new river path is authoritative only for V25.
