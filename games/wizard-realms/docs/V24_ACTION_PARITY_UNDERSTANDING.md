# V24 action parity: aligned understanding

## Original Ask

Finish Wizard Realms as an intuitive, smooth, connected single-player RPG. A new player should be able to deduce useful actions without misleading dead ends. The full-game goal remains active; this is one bounded step toward the first expanded-region proof.

## Input PRD / Spec

`GAME_DESIGN.md` requires visible equipment, persistent exploration and trade, a completed Greenway to Mireglass return journey, and independent real-UI proof. `V24_MIREGLASS_INTEGRATION_PACK.md` keeps V24 browser acceptance open and records slow projection/saves and a later browser crash. Existing V23 and V24 saves must remain valid.

## Aligned Problem Statement

The V24 Mireglass view lists owned leather boots as an equipment choice, but marks it unavailable because its local rule call disables the existing leather-boots branch. The checked V24 action decoder also rejects that item. A player who brings boots from Greenway can become unable to switch back to them after equipping fen waders. Make this one existing gear choice honestly usable through the checked action and replay path, then independently audit the other V24 view choices for similar view/authority disagreement.

## Goals

- Equipping owned leather boots in Mireglass works through the same explicit checked action as axe, spade, and waders. It never uses the generic E key.
- The view only calls it actionable when the checked action can succeed, including pose and current gear checks.
- Old V24 roots and V23 sources remain readable with no migration, record, or schema change. No existing witness result changes.
- Produce a decision-bearing matrix for all other displayed V24 choices against the checked decoder and authority guard, without claiming browser proof from source tests.

## Non-Goals

Fairy-ring teleportation, unequip, player trade listings, herb sale policy, new asset work, frame-performance optimization, PR creation, and full-game completion are separate work.

## Constraints

Use the current dirty `ben/wizard-playable-v2` checkout and preserve all user work. No GitHub action. Use only one renderer total; do not open a replacement browser surface for the crashed tab. No save reset, cadence change, or new dependency. Use `ben/` and Bioscopics only if later GitHub work is explicitly requested. Generated prose uses no em dashes.

## Success Criteria

1. A V24 action test proves exact boot request decode, checked equip success, idempotent rejection, and witness replay without changing tick/RNG.
2. A view test proves owned unequipped boots are actionable and map to the same explicit choice; unowned or already equipped boots remain unavailable.
3. Existing V24 root/lineage and V23 source compatibility tests pass, plus TypeScript and production build.
4. The separate source audit lists any remaining false-actionable or false-disabled V24 choices with file/line evidence and a precise next owner.
5. Real UI acceptance stays open until a permitted one-renderer retry exercises the action and current start-to-return journey. HTTP 200 and unit tests do not close it.

## Open Questions

The cause of the prior browser crash and the browser-only projection gap remain unresolved. They do not change the bounded gear contract. If the action audit finds another save- or gameplay-blocking mismatch, plan a separate narrow repair before claiming regional acceptance.

## Implementation Risks

The V24 witness is replayed under checked persistence. Adding an allowed request must not silently accept forged fields, alter legacy action outcomes, or weaken source-drift/CAS validation. View-only success is insufficient. Source tests cannot establish current browser smoothness or crash recovery.

## System Translation Routing

`not_qualified`: this is an additive local game action, not a whole-system translation. System Translation Receipt: `not_applicable`.

## Product Agent Runtime Routing

`not_required`: no model or agent executes in the shipped game runtime. Ordinary game action and view code is sufficient.
