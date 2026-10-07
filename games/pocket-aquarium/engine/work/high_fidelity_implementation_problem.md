# Reef Room High-Fidelity Milestone Contract

## Goal

Advance the existing marine reef vertical slice into an honest high-fidelity browser release whose optics, circulation, and materials visibly and causally improve while preserving the validated aquarium mass ledgers, lifecycle rules, species namespace, accessibility, and playable controls.

Completion means a user can open the game, select balanced or cinematic rendering, inspect beauty, spectral, and flow views, see scene-sampled refractive water with six-band visible-light attenuation, observe a stable reduced-order incompressible flow field driving suspended matter and coral motion, and read hydrodynamic and optical telemetry that is consistent with the rendered state.

## Truth Boundary

- The renderer is a real-time, one-bounce, scene-sampled spectral approximation. It must not be described as offline or full spectral path tracing.
- The flow solver is a deterministic, reduced-order two-dimensional incompressible projection model. It must not be described as full three-dimensional CFD or a pump-certification model.
- Material textures are deterministic, original procedural PBR maps generated in the application. They are not scans and must not imply measured reflectance.
- The product remains a marine reef game and educational simulation, not husbandry advice.

## Observable Outcomes

1. Water and acrylic preserve the air, acrylic, and seawater interface model, while the water surface samples actual scene color instead of only a procedural horizon.
2. Six visible-light bands from violet through red are attenuated independently and recombined into display RGB. A spectral diagnostic view makes the wavelength-dependent loss legible.
3. A pressure-projected flow grid remains numerically bounded, exposes divergence and residual diagnostics, and produces local velocity samples.
4. Suspended particles, detritus cues, coral sway, polyp response, and cyanobacteria pressure use local or aggregate flow outputs rather than only decorative animation.
5. Rock, sand, and coral use reusable albedo, normal, roughness, and fluorescence maps generated from seeded fields.
6. Balanced and cinematic quality profiles are keyboard-accessible and do not change simulation truth.
7. Beauty, spectral, and flow diagnostics remain usable at desktop, mobile, and short-wide viewports.
8. Existing evaporation, finite freshwater ATO, salt-equivalent conservation, nutrient mass ledgers, lifecycle stocking rules, feeding, and marine-only namespace remain valid.

## Locked Interfaces

### Render Settings

```ts
export type RenderQuality = 'balanced' | 'cinematic'
export type DiagnosticView = 'beauty' | 'spectral' | 'flow'

export interface ReefRenderSettings {
  readonly quality: RenderQuality
  readonly diagnosticView: DiagnosticView
}
```

Balanced uses a reduced offscreen target and fewer pressure iterations. Cinematic uses device-pixel scene sampling up to a bounded cap and the full solver budget.

### Telemetry

```ts
export interface ReefRenderTelemetry {
  readonly optics: {
    readonly spectralBands: 6
    readonly renderScale: number
    readonly meanVisibleTransmittance: number
    readonly chromaticSpreadPixels: number
  }
  readonly flow: {
    readonly columns: number
    readonly rows: number
    readonly meanSpeedMetersPerSecond: number
    readonly peakSpeedMetersPerSecond: number
    readonly meanShearPerSecond: number
    readonly lowFlowFraction: number
    readonly maximumDivergence: number
    readonly pressureResidual: number
  }
}
```

Telemetry is render-system state. It does not become part of the aquarium chemistry snapshot.

### Flow Solver

The solver module owns a stable, deterministic grid API with create, step, sample, diagnose, and estimate operations. It uses semi-Lagrangian advection, bounded circulation forcing, no-through wall conditions, Jacobi pressure iteration, and velocity projection. Local samples use normalized aquarium coordinates.

### Spectral Transport

The optical module owns six fixed visible bands and their seawater absorption weights. It exposes a CPU telemetry helper using the same band model as the shader. The water surface samples an offscreen scene render at chromatically displaced coordinates and applies Fresnel plus Beer-Lambert transport.

## Scope Locks

- Preserve the existing `ReefSnapshot` chemistry, equipment, ecology, livestock, and light-field meanings.
- No freshwater gameplay is added in this milestone.
- No new runtime dependency is permitted unless a worker proves the behavior cannot be implemented with React, React Three Fiber, Three.js, TypeScript, and Vitest already present.
- No network-fetched or third-party texture is permitted.
- No shark, large-animal, store economy, breeding, or save-system expansion is included.
- The current main surface on port 4177 must remain available while isolated validation runs on a different port.

## Acceptance Evidence

- Deterministic unit tests for solver projection, boundary safety, bounded long-run behavior, sampling, and spectral transport.
- Existing simulation regression suite remains green, with new assertions for aggregate flow effects on polyps and cyanobacteria.
- Production build succeeds without new runtime dependencies.
- Browser proof covers balanced and cinematic beauty views, spectral diagnostic, flow diagnostic, lifecycle interaction, feeding, ATO, desktop, mobile, and short-wide layouts.
- Browser proof records console errors and required request failures.
- Independent findings-first review confirms the truth boundary and smallest viable diff.

## Terminal Condition

The milestone is complete only when the integrated revision passes tests and build, an isolated playable surface is available, browser acceptance has revision-bound evidence, independent review has no blocking finding, and top-level reconciliation confirms every observable outcome above or explicitly reports a blocker requiring the user.
