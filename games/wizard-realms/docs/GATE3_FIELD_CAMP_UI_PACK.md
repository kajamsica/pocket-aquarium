# Ticket Pack: V9 field camp interaction

## Delivery boundary

This is the playable UI gate for the first player-chosen camp in Mireglass, not full-game completion. The authoritative placement rule and v9 save lineage remain in `GATE3_FIELD_CAMP_FOUNDATION_PACK.md`. Expose only an explicit experimental `?publicWorld=v9` route. Keep default, v7, and v8 behavior unchanged. The existing preview stays available while this work is built and tested in one isolated browser origin.

## Frozen additive view contract

```ts
interface WizardFieldCamp { tileId: string; position: Vec3 }
interface WizardFieldCampPreview {
  tileId: string
  position: Vec3 | null
  rejection: NonNullable<FieldCampActionResult['rejection']> | null
}
interface WizardFieldCampView {
  camps: readonly WizardFieldCamp[]
  preview: WizardFieldCampPreview | null
  selectionEnabled: boolean
}
// WizardViewProjection gains fieldCamp?: WizardFieldCampView.
// WizardViewIntent gains:
// {type:'field-camp.select'; tileId:string|null}
// {type:'field-camp.confirm'; tileId:string}
publicWorldViewProjection(state, messages, selectedSiteId, openStoreId?, fieldCamp?)
publicWorldOverview(state, camps?)
```

The application builds the read model from `resolveFieldCampSite` and the current authoritative state. Preview calls `applyFieldCampAction` with the session's actual bootstrap and discards its returned state/event. Confirm rechecks the selected tile against the current state, adopts only a successful result, and persists through the v9 session. Cancel changes UI selection only. A selected camp and selected route are mutually exclusive. No placement may be inferred from drawing or map state. Build requires four logs and one stone, awards 30 XP once, and allows one camp in this revision.

Use a receipt-bearing v9 rescue bundle with the actual source bootstrap for every v9 unsaved/blocked download. A state-only v9 JSON file cannot prove the v8 branch from which the camp descended. The rescue parser validates the snapshot and full source receipt but does not authorize an overwrite. The preview must say it cannot import the file yet and must tell the player to keep site data. Never encode camp state as v7 or v8. Existing v7/v8 sessions omit the optional field and retain their original view.

## Safe parallel lanes

The primary agent owns integration, Bioscopics commits, low-RAM validation, actual browser acceptance, and independent tester coordination. Worker lanes may not commit, push, start servers, open WebGL tabs, or alter browser storage. Each worker owns only its listed files. Frozen interfaces allow C2, C3, and C4 to run concurrently with the v9 migration flow. C1 starts after the flow exports and signatures are stable; flow tests may still run concurrently.

### C2: Projection adapter

Own only `engine/src/view/contracts.ts`, `engine/src/PublicWorldView.ts`, and `engine/src/PublicWorldView.test.ts`. Add the optional contract above. Pass it through the projection, mark canonical camp tiles on the local map, and add a `Field camp` marker in the lazy world overview. Preserve discovery fog and prior projection behavior. Avoid a per-tick full-world scan beyond existing visible map generation. Tests cover canonical tile mapping, overview consistency, and old callers without a camp field.

### C3: Map, HUD, and accessible dialog

Own only `engine/src/view/WizardMap.tsx`, `WizardHud.tsx`, `WizardSurface.tsx`, and their tests. In v9 selection mode, discovered expanded-map cells are selectable buttons; undiscovered cells do not become selectable. Arrow keys move a roving cell focus, Enter/Space select a candidate, and Escape closes the map and restores Map-button focus. Tab and Shift+Tab stay within the map dialog instead of jumping to Close on every press. Compact map remains read-only. HUD shows the camp recipe, candidate status/rejection, Build when ready, and Cancel. Existing route preview, focus, mouse, touch, and v7/v8 map behavior must pass unchanged.

### C4: Scene feedback

Own only `engine/src/view/WizardScene.tsx` and its tests. Show one grounded, bounded camp shape for the committed site and at most one distinct placement preview for a non-null resolved position. Use canonical resolver coordinates from the projection, clip to the existing visible terrain window, and allocate no unbounded per-frame geometry. Optional `fieldCamp` absent means no change to older scenes.

### C1: Session and entry integration

Starts when the v9 flow exports and signatures are stable. Own only `engine/src/PublicV9Entry.tsx`, `main.tsx`, `PublicWizardApp.tsx`, and their tests. Use actual flow signatures, rather than guessing. The new route must perform explicit v8 to v9 migration, resume a valid v9 save, block corrupt or divergent source with honest recovery/export, and never silently reset. `PublicWizardApp` accepts mutually exclusive v8/v9 sessions. Feed the C2 projection from authoritative state. Selected map cell is UI state; confirmation revalidates before a v9 CAS save. Preserve all action transitions and committed `fieldCampTileIds`. Fix the observed clipped Next objective banner within these same files while retaining mobile controls and desktop save access.

### B2: Receipt-bearing rescue artifact

Own only `engine/src/domain/publicWorldV9Snapshot.ts` and its tests, after the persistence safety review. Add separate `serializePublicV9Rescue(state, bootstrap, saveRevision, sourceReceipt)` and `parsePublicV9Rescue(bytes)` APIs without changing v7/v8 or the existing state-only codec. Envelope schema is `wizard-world/v9-rescue`. It contains the existing validated portable v9 snapshot, exact `sourceV7Bytes`, and a portable v8 source head whose state uses canonical `discoveredTileIds` JSON instead of a raw typed mask. Reconstruct and validate the complete typed v8 head on parse, then validate receipt coherence and snapshot origin. Parsing is read-only and never grants overwrite authority. Test imported bootstrap, full mask round-trip, altered v7 text, changed v8 source, extra keys, and malformed payloads. C1 switches its v9 download to this API after B2 passes.

## Proof gates

Run focused tests after each lane and the whole suite with at most two workers after integration, plus TypeScript, production build, diff check, and source audit. Browser acceptance uses a fresh isolated origin: explicitly upgrade a valid v8 save, inspect two eligible candidate cells, cancel without changing state, place one with exact spend/XP, save/reload, leave/return, and see both local and overview markers. Advance the old source and verify v9 blocks rather than overwrites. Validate keyboard focus and a narrow touch viewport. Keep the user-facing preview available, and do not claim full-game completion from this gate.

## Smallest viable diff

Each lane changes only its assigned files and reuses the existing projection, atlas, build-preview card, focus handlers, scene primitives, and versioned entry patterns. No new dependency, general-purpose UI framework, or redesign of the older save routes is justified for this gate. The new v9 entry file is the only expected new UI module. Tests should focus on the added camp and focus behavior while retaining the existing behavior checks. The primary agent reviews the combined diff for unused code, overlapping UI, unnecessary route changes, and a coherent single merge unit before any commit.
