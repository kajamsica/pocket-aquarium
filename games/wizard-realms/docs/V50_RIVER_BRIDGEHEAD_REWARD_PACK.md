# V50 River Works bridgehead reward, V30 successor

## Outcome and scope

The connected river already crosses the world and has checked, saved bridge columns, but its first far exit currently opens generic terrain without an immediate authored payoff. Make crossing feel purposeful: at the dry far exit of any saved V17 Greenway creek bridge or V28 connected-river bridge, a discovery-gated River Works survey post offers one checked, one-time claim. If the player has no basic pick, the reward is that existing tool, without auto-equip; otherwise it is 35 in-game coins. The post then points toward optional prospecting and the return to Greenway Outfitters to sell recovered material. This is an additive first-crossing reward, not a gate on travel, digging, Mireglass, or trade. It does not turn the river into an arbitrary fixed-column crossing or promise ore at every location.

Use a separate opt-in V30 save surface, preserving V29 bytes. Progress adds `claimedBridgeheadId: string | null`, a canonical built V17 or V28 bridge ID, initially null on V29 migration. A successful claim stores that ID exactly once across both families. Witness `bridgehead-claim/v1` carries only `bridgeId`; writer derives reward from checked state. No reuse of `fringeMarkerStudied`, discovery mask, or geology as a hidden flag. Do not alter V29 strata or old save semantics. The active preview remains `http://127.0.0.1:5193/?publicWorld=v29` until the V30 safety/honesty gate; expose `?publicWorld=v30` as soon as validated migration, checked claim, persisted reload, and truthful UI are ready.

Worktree `/private/tmp/pa-wizard-playable-v2`, branch `ben/wizard-playable-v2`, broad dirty state preserved. No commit, push, PR, account action, or destructive reset. One WebGL renderer maximum, and no V50 scene edit until V49 scene ownership has cleared. Runtime uses the authoritative game-specific engine and saved lineage, not a view-local prize flag. The user can keep playing V29 while V30 is built.

## Evidence and decisions

- The V25 river is the same continuous waterway through the Greenway starter creek. V25 passage accepts saved V17 Works3/Works4 Greenway bridges there. Works6/V28 sites exclude Greenway and V28 view leaves the Greenway owner unchanged, so a Works6-only reward would miss the ordinary first crossing.
- `publicWorldV17GreenwaySites.ts` and `publicWorldV28RiverBridgeSites.ts` provide canonical built bridge IDs and dry exits. First saved crossing need not be at a fixed x-column; sorted arrays are not claim chronology.
- Existing V17 and V28 views already bound nearby bridge sites and discovery; the post can be derived from a local saved bridge, without a full-river scan or early discovery leak.
- `publicWorldV29MiningTools.ts` already owns basic-pick possession and price behavior; use that state for reward branch. `publicWorldV29MineralSale.ts` owns return-sale behavior.
- `publicWorldV29Flow.ts` has a private under-lock ancestry inspection. V30 needs a narrow export or shared pure helper called under the same exclusive lock. Calling a public V29 inspector while holding V30's lock risks nested-lock deadlock.
- A no-migration trail sign would be save-safe but insufficient for the user's requested tangible reason to cross. A proper V30 migration is required for an exactly once reward.

## Interface contract

`PublicV30Progress` is the exactly validated V29 progress plus `claimedBridgeheadId: string | null`. A non-null value must decode as a canonical saved V17 Works3/Works4 Greenway bridge ID in `greenwayWorks.builtBridgeIds` or a V28 Works6 bridge ID in `riverBridgeIds`, and must be reachable through witness replay from a valid V30 genesis or prior state. Claim intent submits canonical `bridgeId` only. Authority resolves it for the active seed through the matching resolver, requires actual built membership, an unclaimed flag, matching Greenway or streamed movement owner, a grounded player within checked reach of the bridge's dry far exit, and safe tool/coin capacity. It derives either one owned basic pick or 35 coins, advances event sequence once, and persists one witness. Failed, forged, near-bank, not-yet-built, duplicate, overflow, or incompatible-save claims make no state/write/event change. Source V29 remains unmodified. Map/scene post is shown only when its saved bridge far exit is locally streamed and discovered, and the first-claim prompt is displayed only when the checked action can run; after claim it may show informational return guidance. The Greenway copy must not imply that a pick replaces the spade needed for nearby soil digging.

## Topology audit and lanes

Parallelism is safe only after the above state/action/projection contract is fixed. V50-A owns domain authority and migration files; V50-B owns the new world-view overlay and bounded HUD/map/scene projection files once V49-D clears; V50-C owns entry/controller integration after A and B. Hardening lanes start once the earliest honest real V30 surface passes its migration/claim/reload gate. Reviewer owns no edits. Main owns interfaces, integration, resource budget, user-facing preview, and final proof. Do not launch a second browser while V49-D is live. No routine interruption of other work.

### V50-A, authoritative successor and storage

Own new `domain/publicWorldV30Migration.ts`, `publicWorldV30Snapshot.ts`, `publicWorldV30Flow.ts`, `atomicV30Database.ts`, `publicWorldV30BridgeheadAction.ts`, and only a narrow under-lock export in `publicWorldV29Flow.ts` if necessary. Implement exact V29 receipt pinning, separate genesis/schema/key, deterministic claim witness replay, CAS, source-preserving migration, and checked one-time reward. Keep the old database and V29 semantics untouched. Stop if a shared-lock proof requires a broader redesign. Do not touch view, entry, or controller files. Before integration, expose a pure checked action and typed progress/witness surface to B/C, and report exact interface.

### V50-B, bridgehead presentation

Own new `PublicV30WorldView.ts` and bounded `view/contracts.ts`, `WizardHud.tsx`, `WizardMap.tsx`, `WizardScene.tsx` after V49-D closes. Derive posts only from saved V17 or V28 bridges with active, discovered far exits. Post identifies River Works and the first-claim/return-to-Outfitters path. It never exposes hidden geometry, promises guaranteed ore, auto-claims, or implies that a bridge can be placed anywhere. Keep the post lightweight and locally streamed. Do not edit domain authority, entry, or controller files. Tests belong to later hardening unless a tiny focused test is necessary to prove no discovery leak before first surface.

### V50-C, controller and entry

Own new `PublicV30ControllerRuntime.ts`, `PublicV30Entry.tsx`, and bounded `PublicV23Controller.tsx`, `main.tsx` integration. Add an opt-in `?publicWorld=v30` path with explicit copy/migration consent, checked claim queue, state projection, persistent reload and Resume. V29 URL remains intact. The post's action must go through the checked writer, never optimistic local reward mutation. No source display before a real safe claim/reload path exists.

### V50-HA/HB and V50-H, hardening and review

HA owns only new V30 domain/entry tests: valid V29 copy with unchanged source bytes, malformed or changed ancestor rejection, CAS conflict, witness decoding and replay, claim before bridge/wrong bank/forged ID/duplicate rejection for Works3, Works4, and Works6, pick and 35g branches, no auto-equip, overflow, and one claim across multiple bridge families/reloads. HB owns only V30 runtime/view tests and bounded existing controller/HUD/map tests: local discovery gate, interactive post, appropriate prompts, predecessor regressions, and sale return. V50-H is independent read-only integrated review of migration integrity, authority, performance, accessibility, scope, focused tests, TypeScript, build, and no work-account Git writes. Final UI proof uses one isolated browser: build a checked bridge or use a legitimate UI save, cross to far exit, claim, dig/mine optional material, return and sell, reload; do not inject state or mutate saves through devtools.

## Earliest honest surface and stop conditions

The `?publicWorld=v30` preview can be shown once the V29 source is copied without mutation, V30 ancestry and replay validate, a first claim is checked/persisted, UI text is truthful, and a same-tab reload retains reward. Do not hold user access for optional broad tests, but keep V29 accessible and continue hardening concurrently in an isolated environment. Stop/replan if lineage, lock, save preservation, or reward conservation is not provable, if a shared owner is already active, or if the V30 change grows into unrelated world-generation or economic rebalance. Completion of V50 is not completion of the full Wizard Realms goal.

## Routing and local-save integrity note

The role-locked domain, presentation, entry, domain-test, and presentation-test lanes used native ephemeral subagents with inherited model routing. The lane contracts required TypeScript/game-engine implementation and test capability, but no provider-specific feature. Each dispatch returned a live native child receipt; no durable task, Cursor run, or GitHub action was created. The main agent retains integration and browser acceptance.

The existing V29 and V30 local IndexedDB format validates the current transition, a three-slot root, and pinned live ancestry under an exclusive lock. It does not cryptographically attest the full lifetime history against a person manually rewriting both stored heads after several revisions. V30's one-time reward is authoritative for normal checked game actions and reload, not an anti-cheat claim for a future online economy. Multiplayer trading would need server-held authority and a separate trust model. Do not describe the local save as tamper-proof.
