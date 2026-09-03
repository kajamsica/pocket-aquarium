# Store merchandising ticket pack

## Outcome

Turn the aquarium Store from a raw catalog dump into a decision surface: the player can recognize what is being sold, understand why it matters, see what is already installed, and buy only the next meaningful equipment or tank upgrade.

## Product rules

- The aquarium remains visible behind the movable Store window.
- Equipment is presented as an upgrade path, not separate cards for installed, obsolete, and future levels.
- Each equipment category shows the current installation and the next available upgrade. A maxed category shows its installed system as complete.
- Tank upgrades follow the same rule: show the next larger aquarium, not every future size at once.
- A purchase card must expose price, problem solved, durable simulation effect, upkeep, and lock reason before the action.
- Recognizable technical line art distinguishes filters, heaters, circulation, lighting, skimmers, refugia, ATOs, feeders, livestock, coral, and aquariums without introducing a second asset pipeline.
- Store filters use player-facing labels and show offer counts.
- Purchase validation remains authoritative in the existing root simulation. This slice changes merchandising and projection only.

## Smallest viable implementation

1. Enrich equipment offers with stable category/level metadata and the currently installed name.
2. Derive one visible equipment offer per category and one next tank offer in the HUD.
3. Replace generic initials with reusable technical SVG artwork.
4. Recompose cards around installed state, outcome, price, and explicit action status.
5. Verify in the running desktop and phone-sized builds; do not add a broad automated test suite.

## Acceptance

- Buying Preset heater changes the Heater card to “Installed: Preset heater” and offers Controller + heater next; “No heater” never returns as a purchasable-looking product.
- Installed/maxed equipment is visibly complete and cannot be purchased again.
- A player can identify the type, price, reason, effect, and upkeep of an offer without opening another panel.
- Locked offers explain the blocker; insufficient funds state the shortfall.
- Store filtering remains usable at phone width and in a resized desktop window.
