# Ticket pack: V28 connected-river bridges

## Why this is the next gate

V25-V27 correctly draw and block one canonical river across the 2.048 km world, but bridge construction still resolves the old fixed starter creek or Mireglass fen. A player who follows the river beyond those authored sites can see water that demands a bridge without any legal place to build one. This undermines the promised material-driven route building and makes the river an arbitrary wall.

This pack adds version-isolated bridge placement on suitable streamed dry-overlay river reaches. It keeps the existing Greenway works4 bridge and all V25-V27 saves/replay unchanged. It does not add boats, fluid simulation, or unrestricted voxel construction. The separate V27 travel-truth pack must be accepted before this pack changes the preview URL.

## Concrete user journey

Default seed `greenway-alpha`: the off-starter crossing at grid x=-14 (world x=-56 m) has V25 wet row z=12 m above old dry loam, with dry north/south approaches at z=8 and z=16 m. The player discovers both banks, gathers eight logs, previews a buildable bridge at that visible bank, commits it through the checked writer, walks across and back on the deck, saves on the far bank, reloads at the same support, and cannot step sideways into uncovered water. The original x≈0,z=8 crossing still works. A fresh player must not be told to build on a reach that the resolver rejects.

## Fixed interfaces and invariants

- Canonical ID `works6:river-bridge:<gx>`, strict canonical in-range integer text. `resolvePublicV28RiverBridge(seed,id)` derives all coordinates, contiguous wet rows, dry approach/from/to/exit, support path, width, footprint, cost (8 logs), and reward (80 Construction XP) from the seed and canonical V25 river. No client endpoint is trusted.
- Eligible sites are outside a buffer around the Greenway owner rectangle, outside authored fen/cliff and protected footprints, with walkable dry banks and bounded grade. Enumeration is limited to the local visible window. Invalid seams, diagonal corner contact, and overlap fail closed.
- V28 progress adds a sorted, unique, capped `riverBridgeIds` ledger. A new `{kind:'river-bridge/v1',id}` witness re-resolves the site, validates discovery of its full footprint, grounded bank reach, materials, ownership and overlap, consumes logs, and records the ID. No V27 root or witness shape is changed.
- `publicV28RiverPassage` retains the V25 supercover and step cap, accepts an old supported crossing or saved V28 deck that covers every wet sample, and rejects uncovered, off-rail, malformed, or out-of-world segments. V28 replay uses the existing V27 0.8 m ordinary-ground policy with its own visit gate, while preserving V26 rim, pit, and world-edge rules.
- Carrier position remains source-valid. `projectPublicV28Pose` raises only the effective presentation/support Y over a saved bridge. View and collision use the same site geometry; deck appearance is reused from generic terrain-work structures. A build cannot create a different-looking crossing from the one the authority traverses.
- New `wizard-world/v28` DB/schema and lineage pin the exact V27 source receipt. Migration copies checked V27 progress and starts an empty bridge ledger. Genesis and three-slot previous/head replay, CAS, shared lock, live V27 ancestry, and source-changed rejection are mandatory.

## Lane graph

`RIVER-A` pure resolver/geometry and `RIVER-B` V28 migration/genesis/atomic store run independently after these interfaces are fixed. `RIVER-C` passage/pose follows A; `RIVER-D` checked action/witness/flow follows A+B+C; `RIVER-E` view/controller/UI entry follows D. `RIVER-Q` independent source and one-renderer UI proof follows E. No lane edits another lane's files without explicit main replan. Main owns integration and preview availability.

### RIVER-A: canonical site resolver

New V28-only site module and focused tests. Prove the default off-starter fixture, strict ID parse, dry banks, grade, protected exclusions, footprint identity, and bounded local enumeration. No old resolver edit, browser, or GitHub action.

### RIVER-B: pinned lineage and store skeleton

New V28 migration, snapshot genesis, atomic DB modules and tests. Source receipt must be a validated V27 head+lineage and flow must verify the live ancestry under one lock. A schema skeleton may compile before witness integration but cannot be exposed as a playable URL until D. No browser or GitHub action.

### RIVER-C: support and passage

New V28 passage/pose modules and focused tests. Reuse canonical sites from A; verify every wet sample is deck-covered, vertical position matches deck, old supported crossings still pass, and sideways/diagonal bypasses fail. Keep V27 replay byte-compatible. No UI or store edit.

### RIVER-D: checked build and replay

New V28 action/witness/flow integration. Full discoverability, grounded approach, exact eight-log charge, overlap and capacity checks, saved ID, reward once, replay and CAS. Test forged IDs, source changes, stale revision, reload, and old-root isolation. This is the only lane allowed to connect A/B/C contracts.

### RIVER-E: player surface

Add V28 opt-in entry and attach built/suggested/preview bridge sites to the existing Works projection. Reuse the generic bridge mesh and reticle where legal. Make map/HUD language site-specific, support both touch and keyboard confirmation, and show why a reached bank is not eligible. Keep V27 URL unchanged. This lane has the first honest live surface once D passes the minimum safety gate.

### RIVER-Q: independent acceptance

Review root/migration/replay and run a fresh UI journey on one isolated renderer at `?publicWorld=v28`: chop, reach x=-56, discover banks, build, cross, save, reload, return, probe lateral water and old Greenway bridge. Inspect console/network and screenshots. Close test browser; keep dev preview available. Report exact failures for a short causal retry.

## Size and stop rules

This is a versioned subsystem exception to the usual small-diff budget and will exceed five files/300 lines. Each lane must still minimize its own boundary and add no dependency or broad refactor. If an old carrier cannot validate a saved pose above the new deck, or a V27 accepted witness changes, stop and replan rather than weakening replay or migrating in place. No commit, PR, push, or GitHub account action is authorized by this pack. The full RPG goal remains active after this milestone.
