# V181 Lost Familiar implementation pack

## Player outcome

The player finds a living creature by following world-visible tracks from Windward Waystation, earns its trust through useful care, guides it across a dangerous route, and returns it to a keeper. The creature, its needs, position, trust, route choice, and relationship survive save and reload. The reward is a meaningful next path and the proposed 25 coins, 40 Creature Care XP, and 40 character XP. It is a companion, not a free or rideable mount. This is one chapter in the full Wizard Realms campaign, not the goal's endpoint.

The quest needs an observable problem, a normal-control solution, a complication during escort, and a saved payoff. A journal-only flag or an animal that teleports between quest stages does not meet the outcome. The care station must mark a useful safe path immediately after the claim, and later care can deepen trust without real-time waiting.

## Current evidence and safety boundaries

- V42 has no creature entity or Creature Care skill. `domain/types.ts` has five fixed player skill keys, and legacy roots decode them strictly. Do not add a key to old `PlayerState.skillXp`, mutate V42 records, or reinterpret old witnesses.
- V42 frame replay, checked actions, CAS/lock flow, and explicit V41-to-V42 migration are the patterns for a distinct V43 lineage. Read a checked V42 source and copy it to a new version-owned record. A failed or stale migration leaves the source untouched.
- The Waystation-to-Iron-Hall V42 browser acceptance is still open. V43 may be built on a separate local branch or isolated worktree but must not replace the V42 DEV entry or claim a player-ready journey before the exact V42 retry and V43 normal-control proof pass.
- RAM guard: one renderer at a time, one-worker focused tests, no duplicate previews. Preserve existing saves and untracked test checkpoints. Git author and committer must be Bioscopics; branch prefix `ben/`.

## Contract before implementation

The new overlay owns exactly one deterministic familiar identified from the supported world seed. It records a bounded identity, canonical position, movement or escort mode, needs, trust, one-time care outcomes, route choice, care-station state, claim state, and Creature Care XP. The site solver anchors habitat, tracks, keeper, shelter, and crossing to validated dry or supported terrain. Discovery gates projection and interaction; unseen habitat is not leaked through map or scene.

Client witnesses request an action, never a position, trust amount, item quantity, reward, or movement result. The authority derives the target from the checked world and validates reveal, grounded player pose, reach, current stage, inventory/capacity, and route support. Distinct one-time care includes an offered gathered herb and either a material-consuming quiet shelter or a longer dry approach. Repeated care cannot mint XP or skip a stage. Escort advances the animal during fixed-step replay over traversable terrain, follows or pauses based on player distance and crossing safety, and has a recovery path if separated. No witness grants riding or a mount.

The keeper claim requires a safely returned familiar and pays once. Character XP and Creature Care XP are separate. The companion relationship and care-station map path remain after reload, and a duplicate claim, malformed witness, forged trust, or stale revision changes nothing.

## Proposed dependent merge units

1. **V43 authority and save.** New familiar site/content, state decoder, action and frame replay, V43 snapshot, distinct atomic store and locked flow. Add V42-to-V43 checked migration and focused tests. Preserve inherited V42 behavior and its lineage exactly. This unit is not a playable quest alone.
2. **V43 player surface.** Route opt-in, controller runtime and intent routing, projected tracks/animal/keeper/care station, HUD/map/journal cues, and a bounded character-quality creature asset with idle, walk, follow, and startled states in an isolated workbench before promotion. Validate desktop and narrow UI. This depends on unit 1 and does not open the production default route by itself.

Owners should stay disjoint by file until integration. `PublicV23Controller.tsx` and inherited save replay are exclusive integration points; do not let parallel workers edit either simultaneously. Reassess PR boundaries after validation rather than splitting one unreviewable vertical behavior into artificial branches.

## Acceptance evidence

- Domain tests: both care choices, exact resource debit, anti-farming, escort following/pausing/recovery, supported crossing, no mount, one-time rewards, full-bag behavior, malformed/tampered state refusal, stale CAS, strict replay, old V42 source preservation, and save/resume at each stage.
- Projection and scene tests: unrevealed clues/animal hidden, revealed habitat and route legible, equipment/skill text truthful, no direct client minting or teleporting.
- Real UI: from a copied checked V42 save, use ordinary controls to find tracks, care, escort, return, claim, revisit the station, and reload. Separately exercise both route choices. Record screenshots, console/network errors, renderer memory, and any dead end. A constructed fixture proves only its segment, not a fresh-player campaign.
- Performance: bounded active creature count and update cost; no unbounded per-frame object or geometry creation. Keep the one-renderer guard and close the preview after the journey.

The complete game still requires boats, a sustained economy, ground-mount raising and purchase, late flight, broader magic, dungeon/endgame content, and independent campaign, accessibility, recovery, and performance proof.
