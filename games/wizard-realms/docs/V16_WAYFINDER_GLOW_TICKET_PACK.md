# V16 Wayfinder Glow ticket pack

## Goal and current evidence

Complete the first Greenway region's learn-and-cast magic loop on the currently playable v16 root. Source inspection shows that v16 already carries canonical `greenway_waystone`, `studiedInscriptionIds`, `learnedSpellIds`, spellcraft/wayfinding XP, and a discovery mask, but its action allowlist rejects study/cast and its projection/HUD hides inscriptions and the Cast control. The old v5 spell is not an authority for v16. This pack keeps v16's existing save shape and checked write history, and makes the spell reveal canonical nearby terrain farther than walking reveals. It does not claim the rest of the full RPG is complete.

## Interface and authority contract

- The only new v16 Greenway actions are `study_inscription` for the canonical `greenway_waystone` within 3 m, and `cast_spell` for learned `wayfinder_glow`. The checked writer replays the same pure candidate as the local controller. No frame or streamed-world spell action is added.
- Cast uses the existing 24 m public spell discovery circle, adds only previously unknown canonical tile IDs to the mask, emits `spell_cast` and one `tile_discovered` per new tile, and awards spellcraft/wayfinding XP only when there is a new reveal. A repeated cast may produce its cast event but must not farm XP. Preserve event sequence, tick, market step, and validation invariants.
- No new save fields, root version, changed source save, or migration is authorized. If v16 validation cannot safely admit the candidate, stop and report the schema obstacle before changing persisted shape.
- Projection may show only the already-discovered waystone, using canonical position and studied state. The HUD exposes Study and Cast only on the v16 Greenway where actions are enabled. The v14/v15 starter-cliff and streamed UIs retain their existing behavior. Controller maps only those live projected v16 actions to checked intents.
- Do not reveal undiscovered map details through the waystone, projection, or guidance. Existing walking discovery, route works, bare feet/boots gait, collision, and store economics remain unchanged.

## Parallel tickets and ownership

1. **Authority and replay.** Own `domain/publicWorldV14Actions.ts`, `domain/publicWorldV16Flow.ts`, the one-line v16-only opt-in seam in `domain/publicWorldV16GreenwayFrame.ts`, and focused tests for the new actions. Keep the shared v14/v15 action default rejecting study/cast. Reuse the v16 action wrapper; do not delegate to the mutable v5 world. Prove study range, already-studied rejection, unlearned rejection, initial cast reveal, no-farm repeated cast, checked commit/resume, and tampered-history rejection. Implement only if current v14/v16 validators admit these states without schema revision.
2. **Projection and HUD.** Own `PublicV16WorldView.ts`, `view/WizardHud.tsx`, and focused tests. Add the waystone to v16 Greenway visual/projection contracts and a clear Study/Cast affordance, including touch, with availability driven by current checked projection. Do not expose it on v14/v15 or streamed surfaces. Keep route guidance intact.
3. **Controller mapping.** Own `PublicV16Controller.tsx` and its focused test. Translate visible, actionable v16 Study and Cast intents to checked writer actions. Keep `publicV14ActionForView` unchanged for legacy routes. No new renderer, tab, or save root.

The three tickets have disjoint production file ownership. Agent edits share the checkout, so each worker must inspect adjacent changes before finishing. The primary integrates and validates. If a contract clash arises, pause that ticket and report it.

## Acceptance, exposure, and scope guard

- Focused authority, projection, HUD, controller, route, and save-history tests, then production build and diff check. Compare persisted behavior after a checked reload. No fabricated save writes.
- The existing single local preview is the user surface once the smallest safety gate passes. Browser UI automation was blocked by a URL policy in the prior turn. Do not route around that policy; report UI proof as pending unless an allowed surface becomes available. The separate Grok Bot run on an earlier frozen v16 artifact is not validation of this change.
- Smallest viable diff target: one cohesive magic slice, expected one to three production files per ticket, no new save version and no unrelated art/route rewrite. Tripwire: more than five production files or 300 changed lines in a ticket requires re-scope before coding further.
