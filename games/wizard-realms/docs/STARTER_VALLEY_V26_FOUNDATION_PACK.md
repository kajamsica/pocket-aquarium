# Ticket Pack: V26 physical starter valley foundation

## Why a new version

The V25 river slice is replay-safe and visible, but the original cliff tapers
near x=28 m, allowing a no-ladder walk into its upper side. V25 also has an
exact excavation schema whose saved columns contain only rewarded depth;
filling without duplicate rewards needs both open depth and earned high-water
depth. Changing V25 frame replay or its exact saved shape in place would
reinterpret already-written V25 roots. V26 therefore takes a checked,
source-pinned copy and opts into physical starter-valley rules. V17/V23/V24/V25
roots remain readable without reinterpretation.

This pack records the original foundation contract and its implementation history.
The current opt-in V26 route is exposed locally. The full user-facing first-hour
loop remains the terminal condition in `STARTER_VALLEY_WORLD_LOOP_UNDERSTANDING.md`.

## Fixed V26 contracts

- Schema and profile: `wizard-world/v26`, `physical-starter-valley/v1`, a new
  IndexedDB root, and a V25 source receipt checked live under the existing
  exclusive lock. No mutation of old roots, no destructive reset.
- Four-meter canonical column key `(gx,gz)`. The V26 terrain ledger has sorted
  unique columns of `{gx,gz,openDepth,rewardDepth,pitLadder}`. `0 <= openDepth
  <= rewardDepth <= 12`. A fully filled column remains in the ledger while
  `rewardDepth > 0`, so old rewards cannot be reissued. The bag has exact
  nonnegative counts for soil, stone, iron ore, gold ore, diamond, with a
  bounded total of 256. `nextHomeAtMs` is a separate nonnegative safe integer
  in the V26 head, initialized to zero.
- Migration of a V25 column of depth D sets `openDepth=D` and
  `rewardDepth=D`, with `pitLadder=false`, and copies bag counts. This is a
  checked copy, not an in-place upgrade. Existing V25 roots currently have
  no accepted dig witness, but the migration should not assume that all
  future V25 ledgers remain empty.
- The physical V26 floor at a column is its old supported floor minus
  `openDepth * 0.4 m`, except protected bridge and ladder decks stay at their
  validated support height. The old V23/V24 player Y remains a carrier for
  source replay; V26's effective Y is deterministically derived from the
  ledger. Every accepted V26 frame must check its effective step/fall, river,
  cliff, and edge using the same floor as the mesh and projected avatar.
- A checked dig witness supplies only `{gx,gz}`. The writer derives every
  gate from the saved head and seeded world. Redigging a filled layer lowers
  `openDepth` but grants no material until a new `rewardDepth` is reached.
  Fill consumes one soil unit and reduces `openDepth`, while preserving
  `rewardDepth`. Pit ladder consumes logs and permits exit from a deep pit.
  Rescue is only for a genuinely trapped player, records the writer's accepted
  wall time and `nextHomeAtMs=atMs+1_800_000`, and returns to a validated home
  pose. These actions will be separate later tickets after pure foundations.
- The starter pocket is bounded by the connected V25 river, a north cliff
  seam at z=-6 m from x=-30 to x=30 m, and visible rock returns at x=-30 and
  x=30 m joining the cliff's ends to
  wet river cells. Ordinary visible dry ground within the pocket remains
  walkable. Collision and rock-wall meshes must use the same canonical
  segments. The existing built ladder is the north seam aperture. A built
  bridge is the river aperture. The finite 2 km world edge remains honest.

## Lane graph and topology audit

Wave 1: F1 V26 terrain-ledger pure types/validation || F2 V26 starter rim pure
geometry/passage || F3 read-only source-pinning migration audit.

Wave 2: after F1, F2, and F3, one authority lane adds V26 migration, root,
writer, and replay, while a separate view lane adds matching bounded rim/pit
visuals. A runtime/controller lane follows the authority interface.

Wave 3: independent reviewer, focused replay and corruption tests, TypeScript,
build, and UI journey through the one existing renderer when browser auth is
available. No browser renderer is requested during foundation work.

F1 and F2 own disjoint new files. F3 is an independent read-only audit.
There is no duplicate implementation ownership. This is the maximum useful
parallel width before the exact migration/replay contract is ready. Dispatch
verdict: PASS.

## Tickets

### F1: pure V26 terrain ledger

Implementer only. Own new `engine/src/domain/publicWorldV26TerrainLedger.ts`
and its test. Export `PublicV26TerrainLedger`, a strict decoder, empty
constructor, migration from decoded V25 excavation ledger, a column lookup,
and pure `dig`/`fill` transformations that preserve reward high-water marks.
Pure transformations accept already-derived trusted gates as arguments, but
return an explicit rejection and never infer player authority from client
input. No public writer yet. Preserve provenance of V25 bag and no-double-
reward after fill/re-dig. Cap rows at 256 and depth at 12. No edits to V25
files. Budget <=280 net lines. Focused tests, TypeScript, whitespace. No
browser, server, commit, PR, push, or GitHub action.

### F2: pure V26 valley rim

Implementer only. Own new `engine/src/domain/publicWorldV26ValleyRim.ts`
and its test. Export a canonical seed-aware north seam and east/west return
segments, with the side returns ending in actual wet V25 river cells; a
continuous swept-segment crossing check; and read-only segment data suitable
for later mesh projection. No regular movement authority or view edits yet.
The gate may receive a validated `ladderBuilt` fact, but must not accept
untrusted client claims in the eventual writer. Test the known x=28, z=-6
bypass, around-the-end paths, ordinary interior dry movement, ladder aperture,
and seeded river connection. Budget <=260 net lines. Focused tests,
TypeScript, whitespace. No browser, server, commit, PR, push, or GitHub.

### F3: source-pinning and pose audit

Read-only. Identify exact files and adapter tests for V25-to-V26 migration,
live source proof, old-floor carrier versus effective V26 floor, and accepted
home-return pose. Flag schema or economics contradictions before wave 2.
Do not edit, browse, render, restart, commit, or use GitHub.

## Stop conditions and validation

Do not connect the new rim to an already-saved V25 replay path. Do not render
a pit without physical support rules. Do not treat a pure ledger test as an
authorized checked dig. If migration of existing nonempty V25 columns cannot
be proved, block V26 start for that source rather than discard them. A
focused root/writer flow and effective-movement proof is required before
exposing `?publicWorld=v26`. Current V25 remains the playable preview in the
meantime. Browser control is currently environment-blocked by
`unsupported Codex auth method: apikey`; HTTP/build/tests are not UI proof.

## F1/F2/F3 receipts and wave-2 contract

F1 added a strict, pure V26 ledger and tests. F2 added the seed-aware rim
segments and swept gate. Independent review: GO, 11/11 focused tests, clean
TypeScript after a concurrent unrelated HUD test fixture repair. F3 found
that live V25 roots cannot currently carry nonempty excavation because V25
replay requires ledger equality. The pure V26 migration still copies a
nonempty decoded V25 ledger, but the integrated source fixture should use a
genuine accepted V25 root. These foundations do not make V26 playable.

For wave 2, fix the interfaces before dispatch:

- `publicWorldV26Migration.ts` owns `PUBLIC_V26_SCHEMA`, the exact V25 source
  receipt, V26 lineage, and a pure genesis copy using F1's migration. Receipt
  decoding is shape proof only, not live source authority.
- `publicWorldV26Pose.ts` owns one deterministic support/effective-floor
  projection. The inherited player Y remains on the old surface as a carrier
  for V23/V24 proof. For ordinary ground, subtract `0.4 * openDepth` at the
  current 4 m cell. A validated bridge/ladder deck keeps its old floor. The
  home cell at `(gx,gz)=(0,0)` is protected from V26 excavation. A player
  effective pose must not be passed directly into the old decoder.
- `inspectPublicV25UnderLock` is a narrow read-only export in V25 flow that
  returns the already-validated live target and source chain without acquiring
  a second lock. V26 start/resume/commit will compare a source receipt under
  the one existing `PUBLIC_V7_LOCK_NAME`. A later V25 write blocks V26 as
  `source-changed` rather than silently merging.
- `nextHomeAtMs` is a head field, initialized to zero and checked as a
  nonnegative safe integer. Rescue's `atMs` is stamped by the checked writer
  while holding the lock, and replay uses that recorded value. Define the
  genuinely-trapped predicate before dispatching rescue actions. Ticks cannot
  serve as the 30-minute clock because grounded idle frames are suppressed.

Wave 2a has three disjoint lanes: M1 pure migration module/tests, P1 pure
pose module/tests, and I1 the narrow V25 under-lock inspector/test. M1 and
P1 consume the approved F1/F2 interfaces without editing their files. I1
touches only V25 flow and its test. Wave 2b snapshot and atomic store depends
on M1/P1/I1; wave 2c checked writer and movement/view integration depends
on the snapshot. A reviewer follows each authority boundary. This split
avoids an all-in-one source-pin/movement edit and keeps V25 behavior stable.

M1 budget <=220 net lines, P1 <=200, I1 <=45. Each lane runs focused tests,
TypeScript, whitespace; no browser, server, commit, PR, push, or GitHub
action. A V26 route stays unexposed until checked root, writer, local
movement, mesh, and save/reload agree.

## Wave 2b authority contract

The root is a new exact three-slot record `{lineage,head,previous}`. The head
copies V25's `state`, `greenwayWorks`, and `regionalWorks` unchanged at genesis;
adds `schemaVersion`, `saveRevision`, `terrain`, `nextHomeAtMs`, and `witness`;
and pins V25's full `{head,lineage}` receipt in the V26 lineage. Revision zero
must equal the deterministic genesis byte for byte. Every later head must
replay its preceding head's witness, preserve inherited monotonic history,
and keep the V25 source fixed. A shape-valid receipt does not prove the live
source: the flow re-reads V25 and its full source chain under the one world
lock before start, resume, or commit.

The first snapshot implementation may accept inherited V24 witnesses only.
For a frame batch it must check each transition against both the existing
river passage and V26 valley rim, using the saved ladder state, plus effective
terrain support. A ground step whose effective floor changes more than
0.55 m in either direction is rejected until an explicit fall or pit-ladder
transition can show and save it; digging underfoot is a separate action.
Non-frame inherited actions may change route ownership or
build a bridge/ladder, but may not mutate terrain or cooldown. Subsequent
checked excavation witnesses are a deliberate additive union with their own
replay, not an unvalidated object field. The atomic store uses a separate V26
database, exact root key, transactional CAS, and a consumed proof token, as
in V25. It must never reset or write V25 storage.

We will not expose V26 merely because a genesis copy decodes. The minimum
playable gate is: current view, all accepted movement, dig/fill/pit-ladder,
rescue, and reload project the same effective floor; the physical rim mesh
matches the swept gate; and one UI journey can gather, build, cross, dig, and
recover without a silent boundary. If browser control remains unavailable,
report HTTP/build and model tests honestly, then leave V25 as the preview.

## Wave 2c terrain-action contract

The first new actions are `dig` and `fill`, each naming only a canonical
column `(gx,gz)`. The checked transition, never the click payload, derives
the current saved pose, owned/equipped tool, reach to the column center,
discovery, dry ground and structural clearance, stratum and skill gate,
inventory plus escrow plus terrain-bag capacity, and source seed. The home
column cannot be excavated. Every result is a deterministic new progress
value or an explicit rejection reason. A spade opens soil only; stone and
rarer layers require a separately implemented matching tool. A filled layer
reopened later yields no new material. Filling uses one earned soil and does
not erase the reward high-water mark. This pure action is not authority by
itself: the V26 writer must decode, replay, and CAS it under the world lock.

The escape pair follows after the dig/fill witness is proved. A pit ladder
must spend saved logs and persist in the column. Return-home must check the
saved trapped pose and safe home, apply writer-stamped wall time, persist a
30-minute cooldown, and replay the recorded time. We will not offer a
general-purpose teleport from an ordinary blocked wall.

## Current receipts and exposure gate

V26 now has a separate checked store and source-pinned migration, exact
terrain and pit-ladder witnesses, writer-timed trapped-only return home,
effective-floor replay, the matching river and rock-rim geometry, click
targeting, and an opt-in `?publicWorld=v26` route. A blank browser can create
a checked V25 foundation and copy it to V26; existing V25 saves are not
overwritten. Independent review found no blocking authority issue. The
integrated focused run passed 251/251 tests across 14 files, TypeScript and
production build passed, and route tests passed 10/10 across three files.

Browser early smoke used one isolated renderer. Fresh V26 entry, axe equip,
tree chop, inventory update to four logs, and the updated bridge objective
worked through visible controls. The first browser screenshot revealed a
rescue overlay covering equipment; a small contextual Safety menu and a
full-viewport V26 surface corrected that visible defect on retry. A later
fresh-browser pass confirmed that Works presents Bridge and Ladder, while
its Dig/Fill guidance directs players to equip a spade and click ground.
The final focused integration run passed 262/262 tests across 11 files,
TypeScript, production build, and whitespace checks. The only browser
console error in the fresh pass was a missing favicon, not a game failure. This is
not a full playthrough or a claim that bridge crossing, freeform dig/fill,
pit-ladder exit, and 30-minute return-home are visually accepted yet.

Known limits: the field spade currently opens soil only. Stone, iron, gold,
and diamond strata are deterministic but require future owned pick tiers,
store offerings, and visible equipment. The ground highlight is an aim cue;
the checked writer can still reject occupied, wet, distant, or tool-locked
columns. The save root protects normal local corruption and replay mistakes,
not a deliberately forged complete older three-slot history. Keep
`?publicWorld=v25` available while V26 receives further UI and playtesting.
