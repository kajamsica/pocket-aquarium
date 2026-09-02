# Reef Room

Reef Room is an iterative browser game workspace for a physically grounded marine reef aquarium simulation. This first executable slice establishes the real WebGL surface, immutable marine namespace, shared simulation contracts, and one visible lighting interaction.

The renderer is a real-time approximation. It uses physically based material parameters and separate air, glass, and seawater interfaces, but it is not an offline path tracer, CFD model, structural calculator, or husbandry prescription.

## Run locally

```bash
npm install
npm run dev
```

Create an optimized build with `npm run build`.

## Current interaction

Open the local Vite URL and use **Engage actinic**. The spectrum, tank lighting, water color, coral response, background, and moving caustic cue change immediately. Use **Restore daylight** to return to the balanced preview.

## Scientific and gameplay basis

The implementation is grounded by the research and design artifacts stored beside this README:

- `reef_aquarium_research_packet.md`
- `simulation_parameter_model.md`
- `gameplay_systems_spec.md`
- `source_matrix.md`
- `final_package_status.md`

The playable workspace is marine only. `freshwater` remains a separate type-level namespace for future work and must not share livestock, chemistry, or consumables with the running `marine_reef` project.

## Near-term slices

The shared contracts support the next independent slices: conservation-law simulation, finite RO/DI automatic top off, local PPFD, physically grounded optical materials, procedural habitat and life, and a causal game HUD.
