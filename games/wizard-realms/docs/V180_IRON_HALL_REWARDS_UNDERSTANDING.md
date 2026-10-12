# V180 Iron Hall rewards understanding

## Original ask and goal

The player wants quests that are enjoyable to play and pay coins, skill and character XP, useful armor, and occasional enemy drops. This remains one milestone inside the active full Wizard Realms goal, not completion of the roughly 2 km campaign. [Quest experience blueprint](V180_QUEST_EXPERIENCE_BLUEPRINT.md) makes the proposed quest order and play moments explicit.

## Current evidence

- V41 has a real but small Iron Hall combat prototype. The player can learn Arc Bolt, engage a ward, see a 20-tick windup, dodge or guard, lose health, recover, defeat the ward and save that defeat. It has no quartermaster, claim, armor, repair, or drop.
- V41 preserves a separate `wizard-world/v41` lineage and checked, explicit V40 copy. Older `ItemId` and `SkillId` decoders are exact. Traveler Tunic is cosmetic; the wooden shield does not provide combat mitigation.
- A V41 review found a balance issue: the alcove is in seven-meter bolt range but outside the 2.7-meter slam. The first fight can be won without a hit. Do not present this as final combat balance. The follow-on armor proof must be an encounter that can actually hit the player, not a number shown only in tests.
- Prior UI proof is partial: one temporary browser tab loaded V41, copied V40, equipped an axe and moved without console errors. It did not traverse the crossing or fight. The full Iron Hall browser journey is still required. One renderer at a time remains the user's RAM preference.

## Aligned problem

Complete the first quest payoff without corrupting an existing game or pretending cosmetics are armor. The player returns to a reachable quartermaster after the saved ward defeat, claims known coin and XP amounts once, wears a visibly distinct Guard Vest, tests its mitigation against a repeatable telegraphed spar, and can pay to repair it. A cosmetic crest outcome belongs to the one defeated ward, is saved even on a miss, and is never needed for the quest. The quest then points to a later Iron Hall challenge.

## Success and scope locks

- Create a version-isolated V42 save and database. Copy only a checked V41 root by explicit player choice, keep V41 read-only and unmodified, and allow a V42 fresh start. Inherited world actions and movement still work.
- The quartermaster is a physically reachable, revealed, dry hall site derived from the seed, never a client-supplied coordinate. Claim requires a saved ward defeat and proximity, grants 60 coins, 70 character XP and 70 Combat XP exactly once, then saves a unique Guard Vest.
- The vest is a V42 quest-gear overlay with one effective chest appearance over any already-owned clothing. It is not smuggled into the legacy item decoder. It has 12 durability, saves equip state, reduces a normal four-point spar hit to two, wears by one on a landed hit, and is repaired to full for 18 coins by the quartermaster. The UI must make the overlay and comparison understandable.
- The optional crest is a cosmetic, disclosed 10% no-pity outcome of the first authoritative ward defeat. A V41 copy that already defeated the ward resolves the same deterministic seed-and-encounter roll in the immutable V42 genesis. V42 defeat resolves it once at the transition. A miss is saved. No repeat spar, reload or migration can roll again.
- The spar uses a readable 20-tick windup at the hall ward site, checks the actual replayed player position at the strike, can be dodged and cannot award another quest payout or loot roll. It is available after claim and is an honest way to experience vest protection. Its reward is practice, not a repeatable farm.
- Full bag does not discard the vest because the quartermaster places this quest-specific armor directly in the scoped worn-gear ledger; the legacy inventory remains untouched. If a future common item catalog absorbs it, that needs an explicit migration. The optional crest is a saved cosmetic entitlement, not a hidden inventory stack.
- No old save writer, common `ItemId`, `SkillId`, global agent runtime, dependency, PR or GitHub push is in scope. Local commits use Bioscopics identity and `ben/` branch convention; preserve pre-existing `output/`.

## Open proof gates

- Probe the proposed quartermaster cell and full walking route for supported seeds before using it. If unsupported, choose a new seed-derived dry location through planner review.
- Check that V42's one-frame replay yields the same movement as V41 and resolves one spar strike exactly once. Guard stacking may be a future balance feature; the initial spar only tests movement and armor.
- Prove claim, equip, landed and dodged spar hits, wear, repair, duplicate and remote refusal, optional-roll persistence, save/rollback and V41 source immutability in focused tests.
- Provide an early build-ready preview, then a one-tab normal-control browser journey through crossing, combat, turn-in, spar, repair and reload. If browser proof is blocked, describe V42 as a prototype rather than quest completion.

## Routing

This is a versioned feature extension, not a whole-system translation. The product does not gain a runtime AI agent. Use `auto-planner-ticket-pack` with a domain-authority lane, isolated save lane, visible UI lane, integration lane and post-surface adversarial validation. Keep the entire full-game goal active after this milestone.
