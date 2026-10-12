# Ticket Pack: Playable V25 Connected River

## Summary and gate

The V25 river, passage rule, snapshot, atomic store, and source-pinned writer have passed independent domain review. This pack makes that approved rule playable in a separate `?publicWorld=v25` route. It does not claim click-to-dig, fill, hearth return, or complete first-hour polish. Existing V24 stays available at its current route and never writes V25 data.

The minimum honest surface gate is: a new or migrated V25 save can enter the world; visible V25 water comes from the same canonical cells as passage authority; local movement refuses river contact before recording unsavable frames; the saved central bridge still works; and save/reload does not strand the player. Expose the route after that gate, before optional UI hardening. Keep only one WebGL renderer; do not open another preview tab. The existing browser-control bridge previously returned `unsupported Codex auth method: apikey`, so a failing bridge must be reported as an environment limit, not counted as UI acceptance.

Goal aligned. System translation: not_qualified. Product agent runtime: not_required. No GitHub action, commit, PR, push, or production deployment. Read relevant skills completely before lane action. `test-from-ui` is required before any browser journey.

## Fixed interfaces and behavior

- Runtime export: `createPublicV25ControllerRuntime(initial: PublicV25Start, write: V25Writer, onSavePhase?)` in `PublicV23ControllerRuntime.ts`. Reuse `createControllerRuntime` and V24 Mireglass action adapter. Add an optional V25 passage hook to `advanceFrame` after replay and before changing `pending` or `preview`. Use the prior preview pose and candidate next pose. A failed river gate returns the existing typed movement-rejection code with an explicit `River crossing blocked. Build a bridge to cross.` message, and does not append a frame. The checked writer remains final authority. V23/V24 paths do not receive this hook and must remain unchanged.
- Visual contract: optional `v25RiverActive?: boolean` on `WizardViewProjection`, supplied only by V25 controller. `WizardScene` draws a V25 water layer over bounded, already-revealed 4 m cells selected by `publicV25RiverCellAtGrid(seed,gx,gz)`. The layer must not create a second scene, geometry across the whole 2 km world, or a river in V24. Prefer the existing `GreenwayCreekWaterLayer` geometry/appearance pattern. The central saved bridge must remain visible above the water. All water-cell selection logic must be pure and tested.
- Entry export: `PublicV25EntryApp`, `inspectPublicV25Entry`, and `choosePublicV25Entry` in new `PublicV25Entry.tsx`. Bind V25, V24, V23, V17 stores and the shared lock once. Existing V25: resume. Valid V24 source and missing V25: migrate with clear copy/no-reset wording. Truly fresh browser: create V24 through its existing checked fresh path, then migrate to V25 with source recheck. Partial older worlds: guide to V23/V24 instead of resetting. Explicit blocked storage and retry states. No automatic destructive migration.
- Final route `?publicWorld=v25` in `main.tsx` renders the entry, then the shared controller with a V25 variant. V25 uses the existing V24 Mireglass projections/actions plus `v25RiverActive`; V23 and V24 remain unchanged. Saved V25 writes call `commitPublicV25`. Save labels report V25. The controller cannot use a V24 runtime or V24 writer for V25.

## Lane graph and topology audit

```
Wave 1: A local replay gate || B bounded visual river || C V25 entry
Wave 2: D controller and route integration, consuming A/B/C
Wave 3: R read-only code and runtime review
```

A, B, and C edit disjoint files under the interfaces above and require no serial dependency. D integrates them, R reviews the integrated result. This is real parallel ownership, not a worker per trivial edit. Maximum productive width is three. No UI browser worker is spawned because the user requested one renderer and the existing browser bridge is unavailable; the main agent will try the existing surface only after the minimum gate and will report honest evidence. Dispatch verdict: PASS.

## Smallest viable diff

Expected files: `PublicV23ControllerRuntime.ts` and `.test.ts`; `view/contracts.ts`, `view/MireglassWaterLayer.tsx`, its test, and `view/WizardScene.tsx`; new `PublicV25Entry.tsx` and `.test.ts`; `PublicV23Controller.tsx`, `main.tsx`, and relevant route/controller tests. No legacy authority or snapshot edits, package changes, duplicate scene component, new renderer, or dependency. Reuse V24 entry flow, V23/V24 controller, existing water geometry, canonical V25 river, and checked V25 flow. Overall budget <=850 net lines; a lower count is preferred. Unexpected source/authority edit or V24 behavior drift triggers replan.

## Tickets

### A: local movement parity

Implementer only. Own `PublicV23ControllerRuntime.ts` and its runtime test files. Add the declared V25 runtime and optional passage hook. Verify dry accepted frame, wet rejected frame, two-frame bypass impossible, and saved bridge accepted. Verify unchanged V23/V24 frame results and no pending-frame mutation on rejection. Budget <=140 net lines. Focused Vitest and TypeScript. No nested agents, browser, server, or GitHub action.

### B: visual river

Implementer only. Own `view/contracts.ts`, `view/MireglassWaterLayer.tsx`, its tests, and `view/WizardScene.tsx`. Add pure bounded visible-cell selection and a V25-only layer using canonical wet cells. Preserve existing V24 water and old scene behavior. Test central five cells, a bent downstream segment, discovered/bounded filtering, and no V24 activation. Budget <=150 net lines. Focused Vitest and TypeScript. No nested agents, browser, server, or GitHub action.

### C: entry

Implementer only. Own new `PublicV25Entry.tsx` and `.test.ts`. Use checked flow, V24 fresh genesis, and no reset. Test valid migrate/resume, true fresh genesis, older-world guidance, failure/retry, and no source mutation. Budget <=270 net lines. Focused Vitest and TypeScript. No nested agents, browser, server, or GitHub action.

### D: controller and route

Implementer only after A/B/C. Own `PublicV23Controller.tsx`, `main.tsx`, and relevant controller/route tests only. Hook V25 bindings/runtime/writer, V24 projection, V25 visual flag, and version-specific save label. Add `?publicWorld=v25` route. Test the selected writer/runtime variant and separate V24 route. Budget <=290 net lines. Focused Vitest, TypeScript, and production build. No nested agents, browser, server, or GitHub action.

### R: integrated reviewer

Reviewer only, read-only. Findings first. Recheck V25 local/server movement parity, visible/collision water cell source, bridge passage, migration/resume, V24 route/save parity, exact file scope, topology, reuse/deletion/tripwires. Run focused tests, TypeScript, and build. Report GO/NO-GO and residual issues. Browser proof is separate and may be blocked by the existing bridge.

## Delivery

After D satisfies the minimum gate, expose the real local URL to the user immediately, keep it available, and continue R and any safe automated validation. User access is a milestone, not completion. Do not call this a finished starter valley. Next packs connect click-to-dig/deformation and the rescue/route loop. If the new route appears to permit a river crossing that the writer rejects, treat the exact user path as the primary failure loop and do not expose it until repaired.

## Review finding and bounded repair

R found one stale V24 test expectation, not a V25 product regression. `PublicV24ControllerChoice.test.tsx:132` expects owned Leather boots disabled, while the checked V24 projection/action intentionally offers and equips them. The existing action test proves that path succeeds. The full focused run is 94 passed and 1 failed; V25-targeted tests, TypeScript, and production build pass. Do not disable boots to satisfy a stale assertion.

Repair lane E, implementer only: update only the stale expectation in `PublicV24ControllerChoice.test.tsx` to assert that owned boots are actionable, preserving its other disabled/unsupported assertions. No production change. Budget <=8 net lines. Repeat the identical ten-file focused run from R, TypeScript, and build. This is a dependent bounded repair after R, not a parallel lane, and does not alter the A/B/C/D topology. R2, reviewer only, verifies the corrected expectation reflects the real checked action and reports final GO/NO-GO. Extra production edits or a second failure require replan. No browser renderer, server restart, commit, PR, push, or GitHub action.
