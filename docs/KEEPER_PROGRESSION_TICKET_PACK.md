# Keeper progression ticket pack

## Outcome

Make Keeper XP a legible, consequential progression system instead of an unexplained number. Players should immediately understand that XP records husbandry experience, Tank credits buy things, and keeper ranks turn sustained care into credit rewards.

## Rules

- Keeper XP is cumulative and is never spent.
- Existing real husbandry awards remain the only XP sources: commissioning, water testing, cycling, stable-care days, animal maturity, coral growth, breeding, and responsible cleanup.
- Rank thresholds are shared domain data, not UI-only fiction.
- Crossing a new rank awards Tank credits once and records a milestone in the authoritative log.
- Existing saves receive any earned-but-unclaimed rank reward on the next XP award.
- Progress appears in its own movable/resizable desktop window and bounded mobile sheet; the aquarium remains the world behind it.
- The Water panel stops presenting XP as an unexplained metric.

## Smallest viable implementation

1. Add a compact ordered keeper-rank catalog to the existing domain data.
2. Award each rank's credits exactly once through the existing milestone ledger.
3. Project current rank, next threshold, progress, reward, real XP sources, and recent XP milestones.
4. Add a Rank entry to the HUD workspace and an explanatory progress surface.
5. Verify the live first-rank transition and responsive window geometry; do not add a broad test suite.

## Acceptance

- At 0 XP the player sees New Keeper and the exact XP needed for Cycle Technician.
- The panel says XP is not spendable and Tank credits are.
- Crossing 40 XP awards 25 Tank credits once and records the rank milestone.
- Reloading or earning more XP cannot pay the same rank twice.
- Desktop progress is an independent window; phone progress is a visible, scrollable sheet with no horizontal overflow.
