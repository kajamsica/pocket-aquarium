# Reef Game Vertical Slice: Aligned Implementation Problem

## Original Ask

Create an iterative game workspace in `/Volumes/git/games/reef` for a realistic, screen-based 3D reef aquarium simulation. The aquarium should look, feel, and act like a real reef tank, including physically grounded light transport, refraction through glass or acrylic and water, evaporation, freshwater automatic top off, salinity, PAR, tank maturation, compatible life, polyps, and micro-invertebrates.

## Input Spec

The accepted research packet, simulation parameter model, gameplay systems specification, source matrix, and final package status already in `/Volumes/git/games/reef` are the scientific and product-design inputs. They remain unchanged and are not reinterpreted as universal husbandry prescriptions.

## Aligned Problem Statement

Build the first executable marine reef vertical slice as a standalone React and Three.js browser game in a nested Git repository at `/Volumes/git/games/reef`. It must expose a coherent tank scene and a causal simulation loop. Real-time rendering must use documented physically based approximations for interface Fresnel response, refraction, Beer-Lambert attenuation, chromatic absorption, water-surface distortion, caustic cues, and depth-dependent PAR. The simulation must conserve salt during evaporation, add only fresh RO/DI water during ATO, and make visible tank-state consequences respond to player controls.

## Goals

- Provide a polished full-screen aquarium that is immediately runnable in a browser.
- Render a glass or acrylic vessel, water volume and surface, sand, rockwork, corals, fish, ugly-phase growth, microfauna, and suspended material.
- Make time, light, flow, feeding, evaporation, salinity, ATO, PAR, maturation, cyano, and polyp extension interactive and causally linked.
- Keep `marine_reef` and `freshwater` as explicit, non-interchangeable namespaces. The playable slice is marine only; freshwater remains an architectural boundary, not a partially implemented mode.
- Preserve all existing research artifacts and connect the implementation README to them.
- Prove the visible user journey through a real browser and retain screenshots plus console and network health evidence.

## Non-Goals

- Offline spectral path tracing, CFD, finite-element optics, or photorealistic ray-traced production assets.
- A complete species, equipment, chemistry, breeding, disease, or freshwater catalog.
- Claims that the game is a husbandry prescription, structural review, electrical review, or veterinary tool.
- Production deployment, accounts, persistence, multiplayer, commerce, or a pull request.

## Constraints

- Preserve the accepted research packet and all files under `work/`.
- Isolate the target with a nested Git repository because the parent `/Volumes/git` repository is uncommitted and spans unrelated projects.
- Use React, TypeScript, Vite, Three.js, and React Three Fiber. Do not use Next.js.
- Favor procedural geometry and shaders so the workspace has no external art-license dependency.
- Label real-time optics as approximations. Do not claim full physically exact light transport.
- Use fixed contracts in `src/contracts.ts` so rendering, simulation, ecology, and UI lanes can work without overlapping ownership.
- Generated prose must not use em dashes.

## Success Criteria

1. `npm install`, `npm run build`, and `npm test -- --run` succeed from `/Volumes/git/games/reef`.
2. A real browser can open the development URL without a fatal overlay, page error, failed required request, or journey-blocking console error.
3. The visible tank includes transmissive walls, a moving water surface, depth color shift, caustic or light-shaft cues, rock, substrate, corals, fish, microfauna, and ugly-phase organisms.
4. Advancing time causes evaporation to reduce water volume while salt mass remains conserved and `S_eq` rises.
5. With ATO enabled and reservoir water available, RO/DI top off restores water toward the setpoint and lowers `S_eq` toward its prior value without removing salt.
6. PAR varies with depth, light intensity, interface transmission, attenuation, and shading; the UI identifies it as local PPFD, not a universal coral target.
7. Feeding creates a visible pulse and state consequences. Lifecycle and polyp-extension cues respond to maturity, light, flow, and water quality.
8. Namespace types include `marine_reef` and `freshwater`, but the running project is immutably `marine_reef` and no freshwater organism or consumable is exposed.
9. Final proof includes a screenshot of the integrated tank, the exact tested UI journey, and console and network health notes.

## Open Questions

None are outcome-determinative for this milestone. Exact balance values, art direction refinements, and additional species are execution-local and remain tunable.

## Implementation Risks

- WebGL transmission effects vary by browser and GPU, so the readiness gate requires a legible fallback appearance and browser proof on the available local runtime.
- Transparent-material sorting can make water, glass, fish, and particles visually unstable. Layering, render order, and conservative opacity are required.
- A visual-only demo could drift from the accepted mass-balance model. Pure simulation functions and invariant tests are required during hardening.
- Large procedural scenes can reduce frame rate. Geometry counts and device pixel ratio must remain bounded.

## System Translation Routing

`not_qualified`. This is a greenfield implementation grounded by a research and design packet, not a port or behaviorally authoritative reimplementation of an existing source system.

## System Translation Receipt

`not_applicable`

## Planner Handoff

One coding ticket pack, direct orchestrator mode, with a linear user-flow probe followed by parallel narrow implementation lanes and integrated hardening.

## Goal Status

`aligned`
