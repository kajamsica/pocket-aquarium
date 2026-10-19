# V174 ticket pack: quest content and Windward prerequisite

## Outcome and boundaries

Make the next Wizard Realms quest slate concrete, enjoyable and balanceable while the game remains a single connected ecosystem. Correct the false V137 implication that Windward Step already works in the continuous V36 game. Determine the smallest honest spell-integration milestone before Highland Signal can be implemented. This pack writes design documents, not a playable quest, and does not change the V36 release gate.

No GitHub write, preview restart, renderer, save/profile mutation, or production claim. The local branch is `ben/wizard-campaign-checkpoint-v36` at checkpoint `9ea7efe`. All work remains in `games/wizard-realms/docs/` except read-only source inspection. Use the Bioscopics author and committer identity for any local commit. Do not use the work account.

The product contract is the active full-game goal, `QUEST_CAMPAIGN_ROADMAP.md`, `V137_QUEST_REWARD_BLUEPRINT.md`, and the V173 quest-seam finding. A quest must create a visible problem, let the player apply ordinary world actions, introduce a complication or choice, and give a saved, useful payoff. The experience must not be a list of fetch counters. Coin and character/skill XP are distinct. Armor is not protective until checked combat, health, mitigation, durability and repair exist. Enemy drops are not claimed until a checked encounter and unique loot ownership exist.

## Parallel lanes and handoff

- A, implementer, owns the content plan document and the narrow correction to V137. This is documentation-only. A does not edit runtime source.
- B, reviewer, independently audits the minimum V37/V38 spell-authority path. B reads source and returns a findings-first interface receipt, and does not edit files.
- C, reviewer, runs after A and checks that the content plan is playable, internally balanced and honest about shipped versus planned mechanics. C does not edit files.
- D, primary, fans in A/B/C, checks the actual diff, commits the documentation locally with Bioscopics identity if sound, and sets the next implementation boundary. A and B are independent: A writes creative content against frozen product constraints; B inspects runtime ownership. C depends on A's document.

This two-lane wave is useful parallelism: quest design and the engine seam are different uncertainties. No source implementation is dispatched until B fixes the data/action/movement/save interface contract. The earliest real player surface remains the existing local V36 diagnostic preview; this pack cannot make a quest playable by documentation alone.

## Ticket A: content plan

Role `implementer` only. Read `auto-planner-ticket-pack` and `smallest-viable-diff` fully. Work only in `/private/tmp/pa-wizard-campaign-checkpoint-v36/games/wizard-realms/docs/`. Do not spawn workers. Add `V174_QUEST_CONTENT_PLAN.md` and correct only the sentences in `V137_QUEST_REWARD_BLUEPRINT.md` that incorrectly describe Windward Step as working or shipped in continuous V36. Preserve the existing economy anchors and three quest briefs unless source evidence contradicts a claim. Do not create a fake milestone.

The new plan should define a short campaign rhythm from present starter route through exploration/magic, repair/trade choice, companion care, first combat and later dungeon/mount stakes. For each proposed quest, give: world-visible hook, location/return, normal player actions, a meaningful twist or choice, explicit reward (coin, named skill XP, character XP, practical item/route/map consequence), prerequisites and current implementation status. Give at least three different reward shapes: discovery/map payoff, route/gear payoff, and protective combat gear plus an optional cosmetic/material drop. Calibrate coin against current store prices without trivializing the 150-coin waders or future expensive mounts. Guaranteed critical progression cannot depend on a random drop. Define duplicate-item and full-inventory behavior, how the player learns the next use for a reward, and when guidance fades. Quest variants may be high-level where their systems do not exist.

No copied names, plots, exact loot tables or art from another game. Do not assert a 10% drop as shipped or fair without a declared future policy; probability is a proposal. Keep the next deliverable scoped: Highland Signal cannot ship until normal-control Windward study, cast and effect work in the continuous world, plus a versioned quest witness. Return changed file list, smallest-diff reasoning, any factual uncertainty, and no-code/no-GitHub confirmation. Do not commit.

## Ticket B: spell interface audit

Role `reviewer` only. Read `auto-planner-ticket-pack` and `smallest-viable-diff` fully. Read-only. No renderer, no edits, no branch/commit. Inspect the V12 Windward authority, V13 forced disablement, V23/V36 controller movement/action path, V36 root/flow/runtime, active HUD intents and the V36 entry gate. Return a decision-complete minimal path for a working Windward study, cast and actual movement effect in the continuous world. State whether it requires a separate versioned V37 root before Highland Signal V38, or whether one version can safely contain both. List exact exported data/action/view interfaces, migration source and rollback rules, old-version compatibility, and acceptance tests (fresh, V36 copy, forged/repeated/remote input, cooldown, dry-trail speed effect, save/reload, browser). Do not implement.

Do not rename a UI-only indicator as a spell effect. Do not silently route Windward actions through the Mireglass-only Wayfinder Glow choice. If the narrow approach is unsafe, say NO-GO and state the blocking technical reason with file/line evidence.

## Ticket C: content review

Role `reviewer` only. Read the two skills fully. Start after A. Check A's actual changed docs against this pack and source price anchors. Findings first, with severity. Test for dull repeated fetch loops, no world-visible cue, reward/item without a supported mechanic, accidental random completion gate, economic inflation, missing duplicate/full-bag behavior, and incorrect shipped-status claims. Verify only docs changed. Return GO/NO-GO and exact required revisions, no edits.

## Fan-in proof

The primary agent verifies A/C doc scope and B's interface verdict. If GO, run `git diff --check` and make a local documentation commit with `Ben Fowlersmith <79104665+Bioscopics@users.noreply.github.com>` as author and committer. No push or PR. The next pack implements the smallest real Windward prerequisite or revises the quest contract from explicit evidence, then builds Highland Signal with an authoritative one-time claim. The full-game goal remains open.
