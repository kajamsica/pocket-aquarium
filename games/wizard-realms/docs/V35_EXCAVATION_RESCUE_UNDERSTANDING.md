# V35 excavation outcome and trapped-player rescue

## User Intent

Equipping a spade should turn nearby ground into an understandable digging target. The tapped location and depth determine whether it yields soil, stone, iron, gold, or diamond; the ground should visibly lower, support fill or a pit ladder, and persist. If the player truly cannot escape a pit, a return-home action should work no more than once every 30 minutes. These actions should feel like world interactions, not hidden menu facts.

## Current Evidence

V34's real UI run proved the first soil dig: the spade selected Dig, one outlined dry cell accepted a tap, Soil ×1 and Excavation Lv2 appeared, a divot rendered, and reload restored them. The first success toast only named the column, not its material or numeric depth. Source shows V29 deep digging uses checked seeded strata up to a bedrock layer, tool/skill gates, and a saved terrain ledger. Source also shows return-home checks four cardinal 4 m exits, requires all checked exits blocked with no unknown, rejects if a pit ladder exists, and stores a 30-minute cooldown. None of the second-layer pit, pit ladder, or return-home paths have been proven in the current real UI.

## Decision Needed Before Code

Identify the smallest checked, version-safe way for a successful V29 dig to report the actual yielded material (including a no-yield deeper layer) and resulting depth. Do not guess from coordinates on the client or invent material from appearance. Separately determine through a single real browser journey whether a player can intentionally dig a 0.8 m pit, become trapped, see the safety options, use return-home, and see a cooldown rejection or display. If the UI cannot reach this state, capture the first concrete blocker.

## Bounds

- No new mineral distribution, bedrock rule, tool price, save schema, migration, or broad terrain rewrite in the evidence phase.
- At most one WebGL renderer; close it after the probe and keep the local preview live.
- No direct seeding, teleport, localStorage manipulation, or bypass of visible controls for the UI lane.
- The dirty user-owned checkout remains untouched by read-only evidence lanes. Later repairs require a separate bounded contract.
