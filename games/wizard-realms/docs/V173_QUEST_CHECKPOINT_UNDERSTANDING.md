# V173 understanding: preserve the playable game before extending quests

## Original Ask

Build Wizard Realms into a complete third-person single-player RPG, with a connected roughly 2 km world, an extended campaign, practical magic, skills, visible gear, persistent construction and digging, regional economy, travel progression and endgame. The latest addition asks for fun quests with coin, XP, useful armor and drops in the spirit of reward-rich RPGs. It does not ask to copy another game's characters, writing or exact reward tables.

## Input Spec

The active full-game goal and `QUEST_CAMPAIGN_ROADMAP.md` are the current product contract. `V137_QUEST_REWARD_BLUEPRINT.md` proposes the optional Highland Signal, first-combat Iron Hall Watch and Windward Waystation; those are not shipped.

## Aligned Problem Statement

Before creating V37 quest state, preserve the recently playable V36 source in a complete local Git checkout. The current V36 working snapshot has no `.git` link and omits 2,125 tracked repository files outside its intentionally partial tree. It must not be treated as a complete checkout or staged wholesale. Import only the game-owned source, authored art and documentation into a new branch based on the existing `ben/wizard-playable-v2` local tip, retaining branch-only game files. In parallel, pin the next quest's genuine gameplay and checked-authority contract against V36 so implementation does not become another fetch errand or an unsaved UI-only reward.

## Goals

- Produce a recoverable, reviewable local V36 checkpoint with no deletions or changes outside `games/wizard-realms/`.
- Preserve current 5194/5195 preview and browser profiles; no second renderer.
- Define the next optional quest's visible hook, normal-world actions, reward, checked witness, persistence/migration boundary and E2E proof before coding it.

## Non-Goals

- No GitHub push, PR, merge, production V36 gate change or account switch in this pack.
- No combat, damage, protective armor, random enemy drops, mounts or MMO in the next optional quest.
- No blanket copy of root `assets/`, `docs/`, other games, `node_modules`, `dist`, `output`, `.playwright-cli` or generated build files from the partial snapshot.

## Constraints and Repo Truth

- Real repository: `/Volumes/git/games/pocket-aquarium`, clean local `main`, currently behind its `origin/main`; local `ben/wizard-playable-v2` tip `6bb8d39` is 142 commits ahead of the locally known `origin/main`.
- Current playable snapshot: `/private/tmp/pa-wizard-playable-v2`, no `.git` file. The Git worktree metadata still points there, but restoring that link makes 2,125 unrelated tracked files appear deleted. Do not do so.
- The old branch tracks 164 engine source files and 18 game docs; the snapshot has 571 source files, 239 game docs and 73 authored-art files. Only five branch-tracked game docs are absent from the snapshot, so importing without delete preserves them. About 68 existing game files differ.
- Last V172 guarded UI proof passed for map and Works on a local-only diagnostic build. The standard V36 release entry remains closed. Broader HUD tests have a known direct-hook test failure and are not a passing suite claim.
- GitHub game work must use Bioscopics identity and `ben/` branches. This pack performs no remote write.

## Success Criteria

The new local branch contains the complete prior tracked tree plus the snapshot's game-owned source/docs/art only, with no tracked deletion or out-of-scope modification. Source file hashes match the snapshot for imported families; package/lockfiles are unchanged; TypeScript and a diagnostic build pass or report an exact environment-only blocker. A V37 quest implementation contract identifies one fresh experience and its reward/persistence/E2E gates without claiming it is implemented.

## Open Questions

- Whether the 800-plus game files should eventually be split into multiple PRs is a separate packaging decision. This pack creates a local checkpoint, not a PR topology.
- A truly blind external onboarding playtest and full published-V36 RAM gate remain open before production release.

## Implementation Risks

The partial snapshot can accidentally delete thousands of files if used as a Git checkout or copied with deletion. The V36 save format uses versioned checked roots; an unplanned quest field could break migration/replay. The asset/art family includes authored Blender and preview files, not just runtime GLBs; its import must be explicitly scoped and audited. A source-copy build can pass while UI/save behavior remains unproven, so V37 will require its own browser and migration proof.

## System Translation Routing

`not_qualified`: this is checkpoint recovery and a new game feature, not a whole-system port or migration from an independently authoritative implementation. System Translation Receipt: `not_applicable`.

## Product Agent Runtime Routing

`not_required`: Wizard Realms does not ship a model-driven multi-step agent runtime for this quest. Ordinary checked game simulation is sufficient.
