# V176 Highland Signal understanding

## Original Ask

Continue building the complete Wizard Realms campaign. The latest player request asks for fun quests with coin, XP, and useful equipment or drops, in the spirit of a sustained RPG rather than a count-only errand. The standing goal requires real UI, checked simulation, persistent saves, and eventual full-game proof.

## Input PRD / Spec

[V174 quest content plan](V174_QUEST_CONTENT_PLAN.md) proposes Highland Signal as the first new optional quest after Windward Step. It proposes 30 coins, 35 Spellcraft XP, 35 character XP, and a saved bearing. The other proposed equipment and drops still require combat, armor, unique-loot, and overflow systems.

## Aligned Problem Statement

V37 makes Windward Step playable in a separate development save, but no continuous-world quest observes that spell use, asks the player to visit a second landmark, returns them to the Crown, or grants a checked one-time reward. Add that complete optional journey in a new V38 development save, while retaining V37's physical movement rules and explicit migration boundary.

## Goals and Success Criteria

- A visible signal vane on the authored Highland dry route gives a discoverable objective, with no teleport or replacement landscape.
- The checked writer observes a legitimate studied spell, active cast, and realized assisted route crossing before accepting vane inspection. Proximity or a client-supplied completion flag alone cannot satisfy it.
- The player returns to Quarry Crown to claim exactly once. Checked save/reload retains 30 coins, 35 Spellcraft XP, 35 character XP, and a map bearing toward another reachable part of Highland.
- A fresh V38 save or explicit checked V37 copy opens in DEV, and malformed V38 data never overwrites an older branch. V37 remains usable for rollback.
- The journal, landmark, map bearing, and rejection copy accurately reflect checked state in desktop and phone-sized views.

## Constraints and Non-Goals

- The full-game goal remains active. V38 is a campaign increment, not a release or completion claim.
- No combat, armor, random drop, new mount, new region, new dependency, old-version writer change, production route, PR, or GitHub operation in this pack.
- Do not widen movement tolerances or mint progress from a renderer-only state. Existing V37 frame replay remains authoritative.
- Keep the local preview and older saves intact. Use one renderer at most for UI validation; the previous isolated browser hit the 1 GiB guard twice, so a further browser attempt requires an authorized different environment.

## Open Questions and Risk

- The proposed vane coordinate `(512,-472)` must be proved dry, walkable, and reachable from the checked V37 Windward trail for the canonical seed. If not, choose another *existing* revealed dry trail cell in route indices 236 through 244 and update the fixed content contract before integration. Do not add a hidden route or waive physical gates.
- A map bearing is a clue, not unlocked content. It must not present a new inaccessible area as already playable.
- The V38 migration and witness replay are the data-loss boundary. Validate copied V37 roots, malformed V38 blocks, one-time rewards, rollback, and stale revisions before claiming V38 safe.

## Routing

- System Translation: `not_qualified`. This is an additive game-version feature, not a whole-system rewrite.
- System Translation Receipt: `not_applicable`.
- Product agent runtime: `not_required`. Build-time workers do not run in the shipped game.
- Goal status: `aligned` to the active full-game objective. No new durable goal is created.
