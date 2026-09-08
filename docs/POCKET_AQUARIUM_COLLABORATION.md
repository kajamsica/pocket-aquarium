# Pocket Aquarium Collaboration Ledger

This draft document and its GitHub pull request are the cross-computer coordination surface for James's and Ben's Codex agents. It carries goals, ownership, ticket-pack links, decisions, handoffs, and collision warnings. It does not carry implementation code.

## North-star goal

Build a believable reef-keeping game where the aquarium is always the primary world, inhabitants visibly behave according to their biology, husbandry choices change the ecosystem, and progression unlocks meaningful livestock, equipment, habitats, and automation.

## Current baseline

- `main` includes PRs #18 through #22.
- PR #21 owns the authoritative 3D roster, species behavior, surface locomotion, feeding pursuit, coral placement, and compatibility purchase flow.
- PR #22 owns durable multi-view renaming, the editable resident title, selected/hover fish identity, and coral health inspection.
- New implementation branches must start from current `main` unless the ledger explicitly records a dependency stack.

## Communication protocol

Use comments on the draft coordination PR with one of these prefixes:

- `[CLAIM]` — branch, exact files/systems, objective, and release condition.
- `[TICKET PACK]` — link to a committed ticket pack or implementation PR and name its dependencies.
- `[UPDATE]` — meaningful scope, contract, or baseline change only.
- `[CONFLICT]` — overlapping files or incompatible assumptions; both lanes pause the overlap until ownership is resolved.
- `[HANDOFF]` — artifact/commit/PR, validation evidence, remaining risks, and released surfaces.
- `[DECISION NEEDED]` — one concrete choice reserved for James or Ben.

Agents should not post routine progress. Implementation stays on separate branches. The coordination branch is updated only to reflect accepted roadmap or ownership changes.

## Ownership rules

1. Claim before changing shared simulation, renderer, catalog, or persistence contracts.
2. One implementation owner per overlapping file set.
3. A different task/agent should perform final review when behavior risk warrants it.
4. No agent merges a PR without explicit user permission.
5. A lane releases ownership when its PR merges or its `[HANDOFF]` explicitly relinquishes the surface.

## Roadmap

| Order | Milestone | Outcome | Likely surfaces | Status / owner |
|---|---|---|---|---|
| 1 | Accepted asset promotion | Regal angelfish is playable; Montipora candidates receive an explicit acceptance decision and selected variants become playable | specimen assets, acceptance catalog, species data, store, behavior policy | Unclaimed; Montipora selection requires James/Ben decision |
| 2 | Visible coral lifecycle | Colony scale, tissue/color, bleaching, and polyp extension visibly follow live health, growth, tissue, and extension | bridge coral view, `CoralPlacement`, rigged specimen/material controls | Unclaimed |
| 3 | Functional cleanup crew | Cleanup roles materially reduce the correct algae, detritus, leftover food, pests, or fish stress with capacity limits | root data/simulation, guide, resident/store explanations | Unclaimed |
| 4 | Compatibility consequences | Accepted-risk stocking produces observable chasing, stress, injury, and predation instead of warnings only | root simulation, behavior policy, movement targets, event/UI feedback | Unclaimed |
| 5 | Outbreaks and treatment | Introduction vectors create pests/disease; quarantine, equipment, livestock, and treatments create tradeoffs | state schema, simulation, store/care guidance, rendering | Unclaimed |
| 6 | Mobile payload | Faster first launch through compression, LOD/streaming, and selective offline packs | asset pipeline, runtime registry, service worker, iOS packaging | Unclaimed; may run parallel after asset contracts stabilize |
| 7 | Husbandry depth | Species-specific tolerance and condition profiles extend beyond Ocellaris | species data and welfare simulation | Unclaimed; should accompany milestones 1, 3, and 4 |
| 8 | Freshwater 3D | Dedicated freshwater assets, plants, habitat, placement, chemistry, and progression | separate product milestone | Deferred |

## Recommended next slice

### Visible coral lifecycle

Acceptance target: without opening a panel, a player can distinguish a thriving, retracted, bleached, declining, and growing colony from the aquarium view, and those appearances are driven by authoritative simulated fields rather than a second visual-only clock.

Scope locks:

- Reuse existing `health`, `tissue`, `extension`, `growth`, and `polyps` values.
- Preserve coral placement, relocation, locking, and asset normalization.
- Start with reversible material/rig/scale controls; do not generate replacement coral assets in this slice.
- Growth must not move the colony through glass, waterline, rock, or neighboring coral.
- The inspector and 3D appearance must report the same authoritative state.

Dependencies:

- Montipora promotion is not required for the first lifecycle slice.
- Asset promotion and lifecycle work must coordinate any shared asset-registry or rig-control changes.

## Open decisions

1. Which Montipora candidate(s)—capricornis, digitata, encrusting—should be accepted into gameplay?
2. Should the regal angelfish promotion be a small independent PR or ship with its species-specific husbandry profile?
3. Which cleanup interaction should prove the ecology loop first: trochus film algae, goby sand turnover, or cleaner-shrimp stress reduction?
