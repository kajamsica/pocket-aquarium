# Reef Room

Reef Room is an iterative browser game workspace for a physically grounded marine reef aquarium simulation. This vertical slice combines a causal aquarium model, procedural reef life, real-time optical materials, and a full game HUD in one interactive tank.

The playable milestone is locked to `marine_reef`. The shared contracts reserve `freshwater` as a separate namespace, but freshwater chemistry, species, food, and gameplay are not exposed in this build.

## Install and run

```bash
npm install
npm run dev
```

Vite prints the local browser URL. The default development address is `http://localhost:5173/`.

## Build and test

```bash
npm run build
npm test -- --run
```

The test command is the project hardening gate. Tests may be added in the dedicated hardening milestone.

## Controls

- Pause or resume the simulation and select a time speed.
- Feed 0.4 g to create a visible food pulse and fish response.
- Tune reef light power to change local PPFD and the rendered light field.
- Tune return flow to change water motion and ecology responses.
- Disable ATO to let evaporation lower volume and concentrate the conserved salt inventory.
- Enable or refill ATO to add finite RO/DI freshwater toward the operating setpoint.
- Preview lifecycle conditions, including separate diatom, green algae, and cyanobacteria signals.
- Reset to return the tunable demo state to its marine reef baseline.
- Move the pointer across the aquarium for a bounded camera parallax view.

## Physics and optics boundary

The simulation conserves modeled salt mass during evaporation and freshwater top off. Local PPFD combines fixture power, interface transmission, depth attenuation, and shading. Ecology, fish feeding, polyps, nuisance organisms, and microfauna respond to the shared state.

Rendering uses real-time physically based approximations for air, acrylic, and seawater interfaces, Fresnel response, refraction, wavelength-biased Beer-Lambert attenuation, surface-normal distortion, light shafts, and caustic cues. It is not offline spectral path tracing, CFD, a laboratory seawater equation of state, structural analysis, or husbandry advice.

## Research and design basis

The implementation is grounded by the accepted local artifacts stored beside this README:

- [Reef aquarium research packet](./reef_aquarium_research_packet.md)
- [Simulation parameter model](./simulation_parameter_model.md)
- [Gameplay systems specification](./gameplay_systems_spec.md)
- [Source matrix](./source_matrix.md)
- [Final package status](./final_package_status.md)

These sources guide the simulation boundary and do not constitute universal livestock or husbandry prescriptions.
