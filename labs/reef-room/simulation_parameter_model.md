# Aquarium Simulation Parameter Model

Evidence revision: `reef-packet-v1-2026-09-02`

Ticket: `RAQ-D2`

Surface state: `final_complete`

Audience: simulation engineers defining a future interactive 3D aquarium environment. This document specifies state, parameters, causal order, equations, safeguards, and acceptance scenarios. It does not implement a simulator and is not a real-world husbandry prescription.

## Revision log

| Date | Ticket | D2 change |
|---|---|---|
| 2026-09-02 | `RAQ-C1` | Mapped the NOAA Ocean Service broad natural reef-building coral temperature context to `SRC-090`, removed unsupported numeric coral-class PPFD bands, and retained only the nonnumeric low-authority class-hint boundary. |
| 2026-09-02 | `RAQ-C2` | Renamed the base artificial-mix conservative ledger to `S_eq`, the reference-composition salt-equivalent mass fraction, and reserved `S_A`, Absolute Salinity, for a separately validated TEOS-10 profile. |
| 2026-09-02 | `RAQ-P1` | Reconciled delivery metadata after completed RAQ-V1 validation and RAQ-F1 packaging; no substantive simulation content changed. |

Companion artifacts:

- [Main research packet](/Volumes/git/games/reef/reef_aquarium_research_packet.md)
- [Gameplay systems specification](/Volumes/git/games/reef/gameplay_systems_spec.md)
- [Source matrix](/Volumes/git/games/reef/source_matrix.md)
- [Final package status](/Volumes/git/games/reef/final_package_status.md)
- [Accepted consolidated positions](/Volumes/git/games/reef/work/consolidated_positions.md)

## 1. Governing contract

### 1.1 Evidence classes

These labels are mandatory and must not be promoted or collapsed.

| Code | Required label | Meaning |
|---|---|---|
| `EBF` | Evidence-backed fact or range | A mechanism, observation, or scoped range supported by accepted evidence. Scope and provenance remain visible. |
| `HC` | Husbandry convention | A professional or common practice that is useful as guidance but is not a universal biological law. |
| `DE` | Derived equation | A transparent calculation from stated assumptions. Inputs, units, and limitations remain visible. |
| `DI` | Design inference | A simulation architecture or rule derived from accepted evidence but not itself validated as an animal-outcome standard. |
| `TBV` | Tunable balance value | A value chosen for pacing, difficulty, economy, numerical stability, or interface assistance. It is not husbandry evidence. |
| `EWC` | Ethical or welfare constraint | A hard restriction required to avoid normalizing predictable harm or unsupported real-world claims. |

Every stored profile value carries `evidence_class[]`, `claim_ids[]`, `source_ids[]`, `provenance`, `scope`, `disposition`, `uncertainty`, `override_scope`, and `revision`. Allowed dispositions are `selected_conversion`, `selected_equation`, `selected_scoped_profile`, `contextual_example`, `declined_as_universal`, `product_specific`, `tunable`, and `unset_required`. An `unset_required` field is an explicit unresolved input, not permission to invent a value. Claims: `SP-009`, `MR-011`, `FW-002`, `ORG-007`.

### 1.2 Namespace boundary

The root `water_namespace` is exactly one of:

- `shared_physics`: geometry, displacement, water and solute ledgers, heat, gas exchange, evaporation, hydraulics, overflow, particle transport, local flow representation, sensing, failures, and abstract nitrogen transformation capacity.
- `marine_reef`: artificial seawater, reference-composition salt-equivalent mass `m_salt_eq`, its derived `S_eq` state, reef chemistry, marine RO/DI ATO, marine foam fractionation, marine rock and sand provenance, corals, coral PPFD and spectrum response, marine organisms, and marine microbial seed.
- `freshwater`: disinfectant treatment, GH, KH or alkalinity, conductivity or TDS, mineralization, plants, freshwater hardscape, freshwater organisms, freshwater microfauna, and freshwater source and top-off water.

`shared_physics` supplies process shapes, not shared values. Namespace mismatch blocks purchase, transfer, placement, connection, media use, inoculation, and dosing. Brackish or migratory life stages require a separately declared future profile and are unavailable in this two-mode model. Claims: `FW-009`, `GP-004`, `ORG-007`.

Strict freshwater has no marine livestock, coral, coral polyps, reef salinity target, Practical Salinity display, SG-based reef control, marine salt mix, reef calcium or magnesium dosing, marine live rock, marine live sand, marine seed, coral PPFD band, or default protein-skimmer benefit. Freshwater source-water disinfectant logic, GH, KH, plants, and freshwater seed do not substitute for marine water preparation or reef chemistry. Claims: `MR-002`, `FW-001`, `FW-002`, `FW-003`, `FW-009`, `GP-004`.

### 1.3 Parameter record schema

| Field | Type | Constraint |
|---|---|---|
| `parameter_id` | stable string | Unique within evidence revision. |
| `namespace` | enum | `shared_physics`, `marine_reef`, or `freshwater`; cross-namespace reference requires an allowed interface. |
| `value` | scalar, vector, curve, distribution, or `unset_required` | Never silently default an unresolved biological or equipment value. |
| `canonical_unit` | unit string | SI or the explicit chemical basis in Section 3. |
| `evidence_class` | set of class codes | One or more of the six exact codes above. |
| `claim_ids` | list | Exact A0 claim identifiers. |
| `source_ids` | list | Exact source-matrix identifiers inherited through the claims. |
| `provenance` | structured text | Species, source population, facility, experiment, product, installation, or design owner. |
| `scope` | structured text | Life stage, endpoint, environment, method, and exclusions. |
| `disposition` | enum | One of the allowed dispositions in Section 1.1. |
| `override_scope` | enum or record | Global conversion, scenario, installation, equipment, species, provenance, life stage, colony, individual, or local cell. |
| `uncertainty` | record | Known range, confidence class, conflicting profiles, or `unknown`. |
| `update_scale` | enum | Static, event, controller tick, physics substep, chemistry substep, biology substep, diel accumulator, or observation sample. |
| `revision` | string | `reef-packet-v1-2026-09-02` for this package. |

## 2. Entity and spatial model

### 2.1 Entity graph

| Entity | Required state and relationships | Namespace rule | Claims |
|---|---|---|---|
| `Scenario` | Clock, stochastic seed, difficulty tunables, evidence revision, selected water namespace | One biological namespace per hydraulically connected system | `SP-009`, `FW-009`, `GP-007` |
| `AquariumSystem` | Geometry, actual operating water, compartments, hydraulic graph, equipment, selected habitat and source-water profiles | `marine_reef` or `freshwater` | `SP-001`, `MR-001`, `FW-002` |
| `FluidCompartment` | Water and component masses, energy, capacity geometry, water level, mixing representation | Shared shape, namespace-specific composition | `SP-001`, `SP-003`, `SP-004` |
| `HydraulicEdge` | Source, sink, actual-condition flow, direction, valve and siphon state, carried fluid packet | Connected endpoints must be compatible | `SP-002`, `SP-008`, `GP-006` |
| `SurfaceCell` | Position, normal, area, material, biofilm, deposited particles, local light and flow exposure | Material and biota remain namespace-aware | `MR-004`, `MR-005`, `FW-005` |
| `SubstrateCell` | Grain profile, depth, void fraction, detritus, oxygen gradient state, bioturbation, refuge | Profile-specific, no universal depth | `MR-005`, `FW-005`, `ORG-004` |
| `EquipmentInstance` | Product or generic profile, installed geometry, mechanism, capacity curve, maintenance, consumables, power, observations, failures | Compatibility gate before connection | `SP-008`, `GP-003`, `GP-004` |
| `SensorInstance` | True-state mapping, calibration, gain, bias, drift, noise, lag, resolution, fouling, detection limit, fault state | Sensing principle and corrections are profile-specific | `SP-007`, `GP-004` |
| `SpeciesProfile` | Adult geometry, life stage, chemistry, habitat, social, diet, prey, reproduction, welfare, provenance | Catalogs are separate; unresolved required fields block eligibility | `ORG-006`, `ORG-007`, `ORG-009`, `ORG-013` |
| `OrganismIndividual` | Identity, life stage, body and reserve state, intake, stress exposures, behavior, gross observations, reproductive state | Must reference a compatible species profile | `ORG-007`, `ORG-010`, `ORG-011`, `ORG-013` |
| `CoralColony` | Connected polyp-module graph, growth form, shared resources, local injury and competition | `marine_reef` only | `ORG-001`, `ORG-002`, `ORG-003` |
| `PolypModule` | Layered local states from Section 11 | `marine_reef` only | `ORG-001`, `ORG-002` |
| `MicrofaunaPopulation` | Taxon or guild, life stages, abundance or biomass, resources, refuge, trophic edges, export susceptibility | Separate marine and freshwater records | `ORG-004`, `ORG-005` |
| `ParticlePool` | Material class, size class, dry or wet mass basis, composition, position, suspension and deposition state | Composition profile remains explicit | `ORG-005`, `ORG-010` |
| `FluidOperation` | Typed packet transfer with source, sink, time, component vector, reason, and receipt | Operation type cannot be relabeled after posting | `SP-004`, `SP-005` |
| `Observation` | Sensor, timestamp, reading, unit, basis, quality flag, calibration revision | Never overwrites true state | `SP-007` |

### 2.2 Compartments and space

The hydraulic graph may contain a display, sump sections, overflow box, plumbing segments, reactors, quarantine system, and top-off or replacement reservoirs. Quarantine is a separate epidemiological `AquariumSystem`, not a hidden flag on the display. Reservoirs have explicit composition and are not assumed to share display chemistry. Claims: `SP-001`, `SP-008`, `ORG-012`.

Each fluid compartment selects one representation:

1. `well_mixed`: one extensive ledger and one derived concentration per component.
2. `zoned`: several connected well-mixed cells with explicit exchange packets.
3. `spatial_field`: a mesh or voxel field for velocity, temperature, dissolved state, particles, and light where required by fidelity.

The representation may differ by process, but every local field integrates back to the parent compartment's extensive ledger. Refinement cannot create or destroy water, salt, conservative solute, particles, energy, or organism biomass. Local organism exposure samples the field at body, colony-face, polyp, or substrate-cell coordinates. Claims: `SP-001`, `SP-002`, `SP-009`, `MR-009`, `MR-010`, `ORG-002`.

Actual operating water volume is derived from internal wetted geometry and water height, minus rock, substrate, equipment, organism, and trapped-gas displacement, plus circulating sump, plumbing, and reactor water. Marketed tank volume is metadata only.

`V_display_net = L_internal W_internal h_water - V_displacement`

`V_sys = V_display_net + sum(V_sump_operating) + V_plumbing + V_reactors`

Both equations are `DE` under `SP-001`. Nonrectangular compartments use their declared geometry integral instead of the rectangular product.

## 3. Units and basis discipline

### 3.1 Canonical units

| Quantity | Canonical storage | Display forms and rules |
|---|---|---|
| Length, area, volume | `m`, `m^2`, `m^3` | `L` is allowed as `1 L = 10^-3 m^3`. US gallons are display only. |
| Mass, time | `kg`, `s` | Chemical displays may use `g`, `mg`, or `ug` with basis. |
| Flow | `m^3 s^-1` or `kg s^-1` | `L h^-1` and US gallons per hour are display conversions. |
| Temperature | `deg C` state plus Kelvin where an equation requires absolute temperature | Profile scope remains attached. |
| Power, energy, heat capacity | `W`, `J`, `J K^-1` | No equipment wattage is assumed to equal delivered heat unless its profile says so. |
| Dissolved component | extensive `kg` per compartment | Derived concentration must name mass and basis, for example `mg N L^-1` or `mg NO3 L^-1`. |
| Alkalinity | extensive equivalents plus declared solution mass or volume | Display as `mEq L^-1`, `dKH`, or `mg L^-1 as CaCO3` with conversion provenance. |
| Base artificial-mix salt-equivalent state | `S_eq` in `g kg^-1` from `m_salt_eq` and `m_solution` | `S_A`, `S_P`, and `SG` are distinct quantities. The base model exposes only `S_eq`. |
| Local light | `umol photons m^-2 s^-1` over 400 to 700 nm | Label this quantity `PPFD`; spectrum is stored separately. |
| Daily light integral | `mol photons m^-2 day^-1` | Computed per local surface orientation. |
| Velocity and shear | `m s^-1` and a declared shear or turbulence metric with its unit | Do not infer either from turnover alone. |
| Population | integer abundance or `kg` biomass with life-stage basis | Conversion between abundance and biomass requires a taxon and stage profile. |

The exact selected UI conversion is `1 US gal = 3.785411784 L` (`EBF`, `SP-001`, `SRC-001`).

Nitrogen identifiers and labels always retain basis, including `TAN_mg_N_L`, `NH3_mg_N_L`, `NO2_mg_N_L`, `NO2_mg_L`, `NO3_mg_N_L`, and `NO3_mg_L`. Accepted display conversions are `NO2-N * 3.3 = NO2` and `NO3-N * 4.4 = NO3`, with rounding provenance (`EBF`, `FW-002`, `SRC-082`). Phosphate likewise names `as P` or `as PO4`. Claims: `FW-002`, `MR-008`.

### 3.2 Salt-equivalent and salinity observations

For the idealized artificial-mix bulk ledger, the authoritative conservative state is:

`S_eq = 1000 * m_salt_eq / m_solution`

`S_eq` is the reference-composition salt-equivalent mass fraction in grams per kilogram under the declared idealized reference-composition assumption. `m_salt_eq` is the reference-composition salt-equivalent mass in kilograms and `m_solution` is solution mass in kilograms. For the base idealized bulk ledger, `m_solution = m_w + m_salt_eq`. Analytical tracers that are already represented within the reference composition must not be added a second time to `m_solution`. This is `DE` under `SP-004`, `MR-002`, and `MR-011`.

`S_eq` is not Absolute Salinity. `S_A`, Absolute Salinity, is reserved for a separately validated TEOS-10 profile that satisfies its declared composition and thermodynamic convention. The base model does not derive `S_A` from `S_eq`. `S_P` is a dimensionless observation produced by a declared measurement and conversion profile. `SG` is a dimensionless density ratio with sample temperature, reference temperature, and instrument convention attached. No identity or universal conversion is selected among `S_eq`, `S_A`, `S_P`, and `SG`. Mix-specific density data or a declared approximation is required. Claims: `MR-011`, conflict `C-003`.

## 4. True state, observations, and initialization

### 4.1 State separation

The authoritative state vector `x_true(t)` contains extensive masses, energy, geometry, equipment state, biological populations, and local fields. A sensor reads through a profile-specific observation function:

`dz/dt = (g(x_true) - z) / tau_response`

`reading(t) = quantize(gain(fouling,t) z(t) + bias(t) + noise(t), resolution)`

Detection limits, missing values, calibration dates, drift, lag, fouling, saturation, and fault codes remain in the observation record. All sensor coefficients are equipment or installation overrides and default to `unset_required`, not zero. This observation abstraction is `DI` under `SP-007`; manufacturer-specific behavior remains `EBF` only for the named product under `SP-008`.

Controllers consume timestamped observations and quality flags. They never read future true state. A precise display does not imply accurate or current knowledge. Diagnosis uses trends and discriminating checks, not one reading or one visible sign. Claims: `SP-007`, `MR-012`, `ORG-011`.

### 4.2 Initialization sequence

1. Lock evidence revision, water namespace, scenario seed, and explicit tunables.
2. Load internal geometry, displacement geometry, maximum safe levels, drain paths, and compartment capacities.
3. Build the hydraulic graph and validate pump, valve, siphon, overflow, and freeboard profiles without animals.
4. Select a namespace-correct source-water, replacement-water, habitat, substrate, microbial-seed, and chemistry profile. Missing required overrides remain `unset_required` and block the dependent action.
5. Initialize each compartment from extensive water, component, particle, and energy inventories. Derive concentrations only after the inventories pass conservation and capacity checks.
6. Install equipment and sensors with actual-condition curves, maintenance state, calibration, compatible media, consumables, and explicit failures.
7. Initialize surface, substrate, light, flow, and deposition fields from geometry and installed devices.
8. Establish a namespace-correct biofilter without animals. Commission only after a defined, animal-free nitrogen-processing challenge passes the selected profile. Elapsed time alone never sets `commissioned`.
9. Initialize contingent biofilm and nuisance guilds from declared inoculation history. Do not force an ugly-phase sequence.
10. Validate every organism through the hard gates in Section 13 before transfer. Quarantine remains a separate system.
11. Run the zero-time invariant suite before advancing the clock.

Claims: `SP-006`, `MR-003`, `MR-004`, `MR-006`, `FW-001`, `FW-003`, `FW-006`, `ORG-007`, `ORG-012`.

## 5. Explicit update order

The integrator uses a candidate physics substep from the `1 to 60 s` `TBV` range only when flux bounds and exact event splitting permit it. Biological response intervals may be longer, but their source terms are integrated over the same conserved clock. No biological or controller event may be skipped by time acceleration. Claim: `SP-009`.

For each accepted step from `t` to `t + dt`:

1. Find the earliest scheduled action, controller sample, threshold crossing, pump-dry point, siphon transition, overflow, depletion, reproduction event, or failure within the candidate interval. Split `dt` exactly at that event.
2. Validate due player and scenario commands against namespace, provenance, equipment, and welfare gates. Rejected commands do not mutate state.
3. Sample sensors due at `t`, then evaluate controllers from the latest timestamped observations and fault flags. Controllers schedule actuator commands rather than directly setting chemistry.
4. Resolve equipment mode, actual-condition capacity, fouling, consumables, power, heat, valve state, pump curve, and failure state.
5. Resolve hydraulic flows, compartment exchange, local velocity or shear fields, and packet paths. Filtration-loop turnover and nominal display circulation remain diagnostic ratios, not local-flow substitutes.
6. Assemble all fluid packets and boundary fluxes from the same pre-step snapshot: internal transfers, evaporation, top-off, splash, leak, skimming, sampling, water change, dosing, drainback, and overflow. Sum source terms before applying them so equivalent independent actions are order-independent where possible.
7. Apply extensive water, dissolved-component, `m_salt_eq`, particle, and energy ledgers simultaneously. Internal packets subtract and add the same component vector.
8. Update temperature, gas transfer, oxygen demand, nitrogen transformations, alkalinity bookkeeping, namespace chemistry, and derived pH. Stiff or threshold-sensitive reactions request adaptive subdivision.
9. Update PPFD, spectrum, DLI accumulators, shading, turbidity, deposition, resuspension, substrate gradients, detritus, and contingent microbial or ugly-phase guilds.
10. Update feeding encounters, organism energy and mass budgets, local stress exposure, coral polyp layers, colony sharing, plant storage, microfauna stages, trophic transfers, growth, and repair from one consistent pre-biology snapshot.
11. Evaluate directional interaction, predation, mortality, reproduction, settlement, and export events. Prerequisites and capacity gates run before stochastic draws.
12. Generate new observations and gross signs from the updated true state. Update logs, alarms, uncertainty, and UI-derived quantities without rewriting true state.
13. Assert conservation, nonnegativity, compartment capacity, namespace, event, and welfare invariants. On failure, reject the step, record the defect, subdivide or require a corrected profile. Never silently clip.

Photosynthesis, respiration, nitrification, decomposition, and gas transfer are coupled. Within one accepted substep, their requested transfers are collected, bounded by available inventories, and applied simultaneously. A solver may iterate them, but the committed result must satisfy the same ledger and cannot depend on arbitrary module call order. Claims: `SP-003`, `SP-009`.

## 6. Extensive water, solute, and energy ledgers

### 6.1 Fluid packets

For compartment `c`, store a component vector:

`M_c = {m_w, m_salt_eq if marine, m_j for each named dissolved component, m_p for each particle class}`

A transfer creates a packet `P` from the source compartment's pre-transfer composition. For an ordinary well-mixed withdrawal of total packet mass `Delta M`, each represented component transfers as `Delta m_k = x_k Delta M`, where `x_k` is its declared mass fraction. A volume-based withdrawal uses `Delta m_k = C_k Delta V` with density and basis declared. Internal transfer posts the same packet as a source debit and destination credit. A special operation may alter packet composition only when its mechanism and export vector are explicit.

General component ledger:

`m_k,c^(n+1) = m_k,c^n + sum(P_k,in) - sum(P_k,out) + dt R_k,c`

For a conservative component, `R_k,c = 0`. For reactions, component source terms must map reactants, products, gas exchange, organism storage, particles, and explicit export. Internal transfers cancel at whole-system scope. This is `DE` and `DI` under `SP-004`, `SP-005`, and `SP-009`.

### 6.2 Operation semantics

| Operation | Water effect | Dissolved salt or conservative-solute effect | Required rule | Claims |
|---|---|---|---|---|
| `evaporation` | Removes H2O mass to atmosphere | Removes zero ordinary dissolved salt and zero conservative solute | Use the evaporation flux and latent heat term | `SP-003`, `SP-004` |
| `top_off` | Adds the reservoir packet | Adds exactly the reservoir's declared solute vector | Marine baseline reservoir is unsalted purified freshwater, normally RO/DI | `SP-005`, `MR-002`, `FW-004` |
| `splash` | Removes a source-composition packet | Removes carried dissolved and particulate material | Never post as evaporation | `SP-004` |
| `leak` | Removes a source-composition packet from its actual location | Removes carried components | Can trigger low-level, pump-dry, or flood events | `SP-004`, `GP-006` |
| `sampling` | Removes a measured source-composition packet | Removes carried components | Sample discard is an explicit export | `SP-004` |
| `skimming` | Removes aqueous carrier plus a profile-specific selective export vector | Removes only carried or selectively captured material | Marine mechanism and capacity profile required; freshwater benefit disabled by default | `SP-004`, `SP-008`, `GP-004` |
| `water_change_remove` | Removes a well-mixed or location-specific packet | Removes carried components | Paired operationally, but ledgered separately from replacement | `SP-005` |
| `water_change_add` | Adds a replacement-water packet | Adds its declared component vector | Namespace and source-water treatment must pass | `SP-005`, `MR-002`, `FW-001` |
| `dose` | Adds carrier water only if present | Adds the named mass vector | Never set a concentration directly | `SP-005` |
| `salt_correction` | Adds or removes an explicit carrier if used | Adds or removes a declared marine salt vector | Separate from ATO and water change | `SP-005`, `MR-002` |
| `overflow` | Removes a source-composition packet after capacity crossing | Removes carried components | Split the event at exact capacity | `SP-008`, `SP-009`, `GP-006` |

Baseline reef ATO never carries supplements. If an advanced system couples additives to top-off, it creates both a `top_off` receipt and a separate `dose` receipt with its own safeguards. Claim: `MR-002`, conflict `C-012`.

### 6.3 Evaporation

The selected installation-calibrated driver is:

`dot_m_e = k_e A_effective [p_sat(T_water) - RH p_sat(T_air)]`

With vapor pressure in pascals and area in square meters, `k_e` must have units `kg s^-1 m^-2 Pa^-1` so `dot_m_e` is `kg s^-1`. The bracketed driver cannot produce a negative evaporation withdrawal; condensation, if supported later, must be a separate explicit boundary flux. `k_e` is installation-specific and `unset_required` until calibrated. This equation is `DE` under `SP-004`; coefficient selection is not a biological target.

### 6.4 Water change

For an ideal, well-mixed marine system with old reference-composition salt-equivalent mass `m_salt_eq,old`, removed solution-mass fraction `f`, replacement solution mass `m_solution,rep`, and replacement salt-equivalent state `S_eq,rep` in `g kg^-1`:

`m_salt_eq,new = (1 - f) m_salt_eq,old + (S_eq,rep / 1000) m_solution,rep`

If removed and replacement solution masses are equal, the reference-composition salt-equivalent mass fraction simplifies to:

`S_eq,new = (1 - f) S_eq,old + f S_eq,rep`

Every conservative solute uses the same packet logic with its own replacement concentration. Reactions, selective export, incomplete mixing, and displacement during the operation invalidate the simplified concentration equation and require the full packet ledger. This is `DE` under `SP-005`.

### 6.5 Energy and gas

The extensive energy ledger is:

`dU_c/dt = sum(dot_m h)_in - sum(dot_m h)_out + P_heater eta + P_pumps + P_light - UA(T - T_air) - dot_m_e L_v - Q_chiller`

All right-hand terms are watts, equivalent to joules per second. For a lumped system without material advection, `dU/dt = C_sys dT/dt`, yielding the selected reduced equation:

`C_sys dT/dt = P_heater eta + P_pumps + P_light - UA(T - T_air) - dot_m_e L_v - Q_chiller`

`C_sys`, `UA`, delivered power fractions, and `L_v` are installation or fluid-profile inputs. No numeric baseline is selected. Claim: `SP-003`.

For oxygen inventory in a compartment of volume `V`:

`dm_O2/dt = k_La V [C_star(T,composition_profile,p) - C_O2] + J_photosynthesis - J_respiration - J_nitrification - J_decomposition`

All `J` terms use oxygen mass per second. `k_La` is in `s^-1`, concentrations use one declared mass per volume basis, and `C_star` uses the selected namespace fluid profile. Carbon dioxide follows an analogous declared gas-transfer and source-term ledger. Coefficients and biological demand curves are profile overrides. Claim: `SP-003`.

## 7. Worked ledger examples

Every number in this section is either an accepted conversion or a hypothetical `DE` or `TBV` input for checking arithmetic. None is a universal husbandry target.

### 7.1 Marine evaporation and exact ATO restoration

Start with `m_solution = 100 kg` of idealized reference-composition solution at `S_eq = 35 g kg^-1`. The reference-composition salt-equivalent inventory `m_salt_eq` is `3.5 kg`, and H2O inventory is `96.5 kg`.

Evaporate `2 kg` of H2O:

- `m_salt_eq = 3.5 kg`, unchanged.
- `m_w = 94.5 kg`.
- `m_solution = 98 kg`.
- `S_eq = 1000 * 3.5 / 98 = 35.714 g kg^-1`, rounded to three decimals.

Add exactly `2 kg` of unsalted purified freshwater:

- `m_salt_eq = 3.5 kg`.
- `m_w = 96.5 kg`.
- `m_solution` returns to `100 kg`.
- `S_eq = 35.000 g kg^-1`.

The restoration is exact only because the loss was pure H2O and the top-off carried zero salt. Splash, leak, sampling, skimming, an incorrect reservoir, or dosing requires its own ledger and breaks this shortcut. This accepted hypothetical example is `DE` under `SP-004` and `MR-002`.

### 7.2 Freshwater conservative-solute concentration

An idealized freshwater compartment falls from `100 L` to `95 L` by pure evaporation while conservative-solute mass remains fixed. The concentration ratio is `100 / 95 = 1.05263`, an increase of about `5.26%`. Adding `5 L` of solute-free water restores the prior volume and concentration. A mineralized freshwater top-off adds its declared mineral mass and therefore does not produce the same exact result. This accepted hypothetical example is `DE` under `SP-004` and `FW-004`.

### 7.3 Water change with different replacement `S_eq`

Use a hypothetical `m_solution,old = 100 kg` well-mixed reference-composition marine solution at `S_eq,old = 35 g kg^-1`, so `m_salt_eq,old = 3.5 kg`. Remove `10 kg`, which is `f = 0.10`; `3.15 kg` reference-composition salt-equivalent mass remains. Add `m_solution,rep = 10 kg` replacement at `S_eq,rep = 33 g kg^-1`, contributing `0.33 kg` reference-composition salt-equivalent mass.

`m_salt_eq,new = 3.15 + 0.33 = 3.48 kg`

`S_eq,new = 1000 * 3.48 / 100 = 34.8 g kg^-1`

Replacement at the same `35 g kg^-1` would restore `35 g kg^-1` under these ideal assumptions. This is a `DE` arithmetic test, not a selected water-change percentage or salinity recommendation. Claim: `SP-005`.

### 7.4 Pump-off drainback and freeboard

The selected equation is:

`V_drainback = A_display Delta_h + V_return_plumbing + V_device`

Hypothetical `DE` inputs are `A_display = 0.60 m^2`, `Delta_h = 0.020 m`, `V_return_plumbing = 0.006 m^3`, and `V_device = 0.002 m^3`. Therefore:

`V_drainback = 0.60 * 0.020 + 0.006 + 0.002 = 0.020 m^3 = 20 L`

If the scenario assigns a hypothetical `TBV` uncertainty margin of `0.005 m^3`, required sump freeboard is at least `0.025 m^3`, or `25 L`. A measured `23 L` freeboard fails the commissioning test by `2 L`; the model predicts up to `2 L` overflow if the full drainback arrives and no other path intervenes. The margin is a scenario input, not a universal safety number. Claims: `SP-008`, `GP-006`.

### 7.5 Low-water pump risk

For a constant-area pump chamber:

`V_above_min = A_chamber (h_current - h_min)`

`t_to_min = V_above_min / max(0, Q_out - Q_in)`

Hypothetical `DE` inputs are `A_chamber = 0.15 m^2`, `h_current = 0.20 m`, equipment-specific `h_min = 0.14 m`, and net drawdown `Q_out - Q_in = 0.00005 m^3 s^-1`. Then `V_above_min = 0.009 m^3 = 9 L` and `t_to_min = 180 s`. The integrator splits exactly at or before `180 s`, transitions the pump according to its dry-state profile, and records any controller action. It may not integrate past the threshold and later clip the level. Claim: `SP-009`.

## 8. Hydraulics, overflow, and ATO control

### 8.1 Flow quantities

`N_filter = Q_return_actual / V_sys`

`N_circ = sum(Q_powerhead_actual) / V_display_net`

These `DE` ratios have units `s^-1` and may be displayed per hour. They are distinct from true water replacement and from the local velocity, turbulence, or shear field `u(x,t)`. `Q_actual` comes from pump and system curves at the current duty point, valve state, head, fouling, and obstruction. No universal turnover target is selected. Claims: `SP-002`, `MR-010`.

At a maximum-level crossing, an overflow packet removes the source compartment composition. At pump shutdown, siphon, return-plumbing, and device drainback are resolved as events. Required freeboard is `V_drainback` plus an explicit uncertainty margin. Anti-siphon and check-valve reliability are equipment and installation overrides, not assumed guarantees. Claims: `SP-008`, `GP-006`.

### 8.2 Product-independent ATO state machine

Allowed states are `disarmed`, `armed_observing`, `fill_requested`, `filling`, `satisfied_lockout`, and `fault_lockout`. State names are `DI`; timing and thresholds are equipment profiles.

Required guards before entering `filling`:

1. Correct water namespace and reservoir connection.
2. Reservoir composition passes its declared top-off profile.
3. Primary level observation is valid and below its product-specific request threshold.
4. Independent high-level, leak, reservoir-low, pump-current, and timeout safeguards are not in fault.
5. The target compartment has freeboard and a valid flow path.
6. Any configured fill budget is an explicit `TBV`, not an inferred safety law.

During `filling`, the actuator adds reservoir fluid packets at actual pump capacity. A satisfied primary level enters lockout or observation according to the equipment profile. High level, timeout, implausible level trend, leak, empty reservoir, pump fault, or inconsistency in `S_eq` or a declared salinity observation can enter `fault_lockout`; the exact enabled checks come from the installed profile. Reset never repairs the underlying true state.

For `marine_reef`, the baseline reservoir has `m_salt_eq = 0` and contains suitable purified freshwater, normally RO/DI. For `freshwater`, reservoir water is freshwater with an explicit mineral plan. Neither top-off exports nitrate, organics, hardness, salt, or conductivity. Claims: `MR-002`, `FW-004`, `SP-008`, `GP-006`.

Named examples remain product-specific `EBF`: a TUNZE `10 minute` cutoff; a Red Sea `3 mm` control band and backup probes about `2.5 cm` above cutoff. They are not generic ATO defaults. Claims: `SP-008`, sources `SRC-017`, `SRC-018`.

## 9. Chemistry, cycling, gas, and nutrient abstractions

### 9.1 Nitrogen capacity

Store extensive inventories for TAN as N, un-ionized NH3 as N, nitrite as N, nitrate as N, organic nitrogen pools, and organism or plant biomass nitrogen when the selected model tracks them. Display conversions never replace the canonical basis.

Store separate potential capacities for ammonia oxidation and nitrite oxidation. A generic bounded rate is:

`r_AO = min(L_TAN / dt, K_AO phi_T phi_pH phi_O2 phi_alk phi_flow phi_surface phi_inhibition)`

`r_NO = min(L_NO2 / dt, K_NO phi_T phi_pH phi_O2 phi_alk phi_flow phi_surface phi_inhibition)`

`L_TAN` and `L_NO2` are available substrate inventories in kilograms N, `dt` is seconds, each `phi` is a dimensionless profile response bounded to `[0,1]`, and `K_AO` and `K_NO` are namespace, biofilter, community, temperature-history, and installation capacities in kilograms N per second. Therefore both rates are kilograms N per second. The notation is `DI`, not a universal kinetic law. Stoichiometric oxygen, alkalinity, and product coefficients remain `unset_required` until an accepted model profile supplies them. The ledger refuses coefficients that fail element or basis checks.

Capacity grows or declines through a declared profile influenced by oxygen, alkalinity, temperature, pH, flow, active surface, inoculum, load, and disturbances. Freshwater and marine capacities and seed communities cannot transfer across namespaces. Commissioning requires an animal-free challenge with a declared input and passing transformation criteria. Observed weeks are context only. Claims: `SP-006`, `MR-003`, `FW-003`.

### 9.2 pH and alkalinity boundary

Alkalinity is stored as an extensive equivalent inventory with its basis and volume. pH is a derived chemistry result, not an extensive conserved mass and not a quantity that a dose can directly set. The namespace chemistry profile consumes current temperature, gas state, alkalinity, declared acid-base component inventories, and marine or freshwater composition, then produces `pH_true` plus solver status and uncertainty. Reef carbonate chemistry and freshwater GH or KH remain separate profiles.

A dose posts named material and carrier masses first. Gas transfer, biological processes, mineral interactions, and water changes post their own transfers. The chemistry solver then recomputes pH. Missing composition or a failed charge or mass closure produces `chemistry_unresolved`, not a fabricated pH. Claims: `SP-003`, `MR-002`, `FW-002`, `FW-010`, `ORG-002`.

Accepted display mapping for scoped profile comparison is `1 mEq L^-1 = 2.8 dKH = 50 mg L^-1 as CaCO3` (`EBF`, `MR-011`, `SRC-019`). No universal marine or freshwater alkalinity target follows from the conversion.

### 9.3 Nutrients, organics, and plants

Named dissolved and particulate pools track input, uptake, transformation, storage, resuspension, removal, and export. A low measured nitrate or phosphate observation may coexist with rapid uptake, so observation alone does not imply low biological flux. Both excess and extreme limitation use nonlinear, provenance-specific response curves; no universal zero nutrient target is selected. Claim: `MR-008`.

Freshwater plants transfer nutrients into biomass and release respiratory, growth, and senescence source terms according to selected plant profiles. Nutrient export occurs only when plant biomass leaves the system. Plants do not silently replace filtration or water changes. Claim: `FW-008`.

## 10. Light, flow, substrate, and maturation fields

### 10.1 Light and spectrum

For every photosensitive surface or organism point, store:

- local `PPFD(x,t)` over 400 to 700 nm in `umol photons m^-2 s^-1`;
- spectral-bin photon flux with configurable bin boundaries;
- surface orientation and self-shadow state;
- geometry, neighbor, water, particle, and biofilm shading factors;
- turbidity or attenuation state tied to particles and water profile;
- photoperiod schedule, dark interval, and acclimation history;
- local DLI accumulator.

`DLI(x) = 10^-6 integral PPFD(x,t) dt`

With `PPFD = 200 umol photons m^-2 s^-1` for `10 h`, the accepted hypothetical result is `7.2 mol photons m^-2 day^-1`. Equal DLI produced by a different peak, spectrum, or photoperiod is not presumed biologically equivalent. All response curves require species, provenance, symbiont, morphology, orientation, history, and endpoint scope. Claims: `MR-009`, `ORG-002`.

A generic coral-class label may exist only as a low-authority nonnumeric placement hint. It cannot supply a realistic-mode PPFD band, response curve, or universal biology. Claim: `MR-009`, conflict `C-002`.

### 10.2 Flow and deposition

Store local velocity, a declared turbulence or shear measure, direction variability, particle encounter, and boundary-layer proxy at organism and substrate cells. Pumps contribute through installed geometry and actual duty point. Rockwork, organism growth, blockage, and equipment movement can change the field. Turnover ratios never substitute for local exposure. Claims: `SP-002`, `MR-010`, `ORG-002`.

Substrate cells store grain profile, depth, void fraction, detritus, oxygen-gradient state, local deposition, resuspension, bioturbation, animal-use flags, and siphon export. Bare bottom is an explicit surface profile, not a zero-state error. Marine sand depth and grain values are `unset_required` unless a habitat or installation profile supplies them. Claims: `MR-005`, `FW-005`.

### 10.3 Ugly-phase and cyanobacterial guilds

`marine_reef` guild records include bacterial films, diatoms, green algae, cyanobacteria, dinoflagellate-like taxa, and calcifying crusts. `freshwater` records include freshwater biofilm, algae, diatoms, and cyanobacteria. Each record may store biomass, surface cover, thickness, local resource uptake, light exposure, deposition, oxygen effect, detachment, grazing, mortality, and export, but every numeric rate is `unset_required` or a declared `TBV` until a scoped taxon or calibration profile exists.

Guild change follows current resources, inoculation history, surface, light, temperature, local deposition, oxygen microstate, competition, grazing, and disturbance. There is no fixed diatom-to-cyanobacteria-to-algae schedule and no mature-on-day-X transition. Marine cyanobacterial mat risk may combine organic loading, phosphorus and iron availability, light, temperature, deposition, and low-oxygen sediment interfaces. Low local flow is an indirect modifier, not a sole cause. Freshwater appearance does not establish toxicity; sudden biomass loss can add oxygen demand through the existing decomposition ledger. Claims: `MR-006`, `MR-007`, `FW-006`.

## 11. Coral polyp and colony model

This entire section exists only in `marine_reef`. A colony is a graph of local polyp modules connected by tissue and optional profile-defined resource-sharing edges. Sharing may buffer a local module, but it cannot erase local tissue loss, sediment exposure, neighbor contact, or injury. Claims: `ORG-001`, `ORG-002`.

Each polyp module carries concurrent layers. These are not mutually exclusive animation states and do not collapse to one health value.

| Layer | Local state | Inputs | Outputs or transitions | Override scope |
|---|---|---|---|---|
| Structure | Tissue mass, skeletal mass or geometry, attachment, lesion map | Growth, damage, repair, dissolution profile | Geometry, displacement, exposed skeleton, repair demand | Species, colony, module |
| Extension | Extension fraction, retraction drive, diel history | Light history, flow, food, sediment, neighbors, disturbance | Local capture area and visible gross sign | Species, provenance, module |
| Feeding | Encounter, capture, handling, digestion, rejection, satiation | Prey field, particle size, flow, polyp geometry | Ingested mass, leftovers, metabolic demand | Species, life stage, module |
| Symbiosis | Symbiont type, density, pigment, performance, translocation state | Spectrum, PPFD, DLI, temperature, nutrients, stress history | Photosynthetic energy transfer, respiratory demand, visible color observation | Provenance, symbiont, module |
| Energy | Photosynthetic and heterotrophic inputs, respiration, mucus, repair, reserve | Feeding, symbiosis, oxygen, temperature, stress | Maintenance, growth, calcification, reproduction budget | Species, colony, module |
| Calcification | Active rate request, maintenance, dissolution risk | Energy, temperature, salinity, carbonate chemistry, local flow | Skeletal mass and geometry request | Species, provenance, module |
| Stress | Acclimation memory, chronic stress load, acute distress events | Light change, temperature, salinity, chemistry, oxygen, sediment, injury | Response modifiers and gross signs | Species, provenance, individual history |
| Competition | Directional contact, overgrowth, shading, chemical exposure, filament or sweeper reach | Neighbor geometry, current, distance, species profile | Local injury, energy cost, shading, retreat or growth effect | Ordered colony pair and local faces |
| Reproduction | Maturity, gametogenesis, brooding or broadcasting, budding, fragmentation, post-event cost | Species cues, energy, compatibility, season profile, capacity | Bud, fragment, gamete, embryo, larva, or settlement event | Species, colony, reproductive type |
| Disease observation | Gross lesion or tissue sign, progression map, observation confidence | True local damage and observation conditions | Syndrome and differential evidence only | Module and observer |

A generic local reserve ledger is:

`dE_reserve/dt = J_photo + J_assimilated_food + J_shared_in - J_respiration - J_mucus - J_repair - J_growth - J_calcification - J_reproduction - J_shared_out`

All terms use energy per second and are profile-specific `DI` transfer channels. Requested outflow is bounded by available reserve and current intake. A shortfall records which function was unmet; it does not convert directly to a universal mortality probability. Claims: `ORG-001`, `ORG-002`.

Budding, fragmentation, brooding, and broadcast spawning remain separate paths. Sexual reproduction requires profile-defined maturity, cues, compatible reproductive type, fertilization, settlement, and juvenile capacity. Timing, larval survival, growth grammar, wound healing, and probabilities remain unresolved taxon overrides. Claim: `ORG-003`.

Extension, color, calcification, feeding, stress, and disease observations may disagree. None alone is a health score or etiologic diagnosis. Claims: `ORG-002`, `ORG-011`.

## 12. Microfauna, feeding, and organism bioenergetics

### 12.1 Microfauna populations and trophic transfer

Marine and freshwater catalogs are separate. Required record families include copepods, amphipods, isopods, worms, gastropods, small crustaceans, plankton, protozoa or rotifers where appropriate, eggs, and larvae. A taxon or guild record declares feeding mode, resource, refuge, substrate, salinity or hardness, temperature, life stage, reproduction, predation, parasitism, habitat engineering, filtration susceptibility, siphon susceptibility, harvest, and export paths. Claims: `ORG-004`, `ORG-005`.

For taxon or guild `g` and life stage `l`:

`N_g,l^(n+1) = N_g,l^n - D_g,l + B_g,l + I_g,l + T_in,g,l - P_g,l - S_g,l - M_env,g,l - M_treat,g,l - X_filter,g,l - X_siphon,g,l - X_harvest,g,l - T_out,g,l`

The terms are deaths among starting individuals, births, immigration, stage transitions, predation, starvation, density stress, environmental or treatment mortality, and explicit exports. An abundance model also carries a biomass or per-individual mass profile when matter transfer is needed. Rates require taxon and condition calibration. This is the selected `DI` abstraction under `ORG-005`.

Every feeding or cleanup event debits a resource pool and credits respiration, excretion, consumer growth, reproduction, detritus, or predator intake. Only filtration, siphoning, harvesting, water removal, or another explicit boundary export removes matter. There is no `cleanup_power` sink. Cleanup organisms have their own food and oxygen budgets. Claims: `ORG-005`, `ORG-010`.

Unknown hitchhikers use exactly one current classification: `unknown_taxon`, `known_low_risk`, `conditional_nuisance`, `documented_predator_or_parasite`, or `biosecurity_restricted`. `unknown_taxon` cannot be promoted to harmless by elapsed time. Claim: `ORG-004`.

### 12.2 Feeding and individual energy

A feeding event creates a food batch with namespace, material and nutrient basis, particle or prey class, location, time, and mass. Individual intake proceeds through encounter, capture, ingestion, rejection, and assimilation requests under a species and life-stage profile. Uneaten food remains a particle or live-prey population and enters predation, decomposition, filtration, or export paths.

Generic individual reserve ledger:

`dE_reserve/dt = J_assimilated + J_photo_if_applicable - J_maintenance - J_activity - J_growth - J_repair - J_reproduction`

Generic body-mass bookkeeping:

`dm_body/dt = dot_m_assimilated_to_growth - dot_m_respired_equivalent - dot_m_excreted - dot_m_gametes - dot_m_lost`

The exact partition, oxygen demand, nutrient waste, stress response, and growth curve are species, provenance, life-stage, temperature, and condition overrides. Missing curves remain `unset_required`. Claims: `ORG-010`, `ORG-013`.

Health observations generate gross signs, syndromes, and differential causes. Morphologic or etiologic diagnosis requires corresponding evidence. Visual state alone never selects a pathogen or medication. Treatment tolerance and context are outside this parameter baseline unless a curated future profile supplies them. Claim: `ORG-011`.

### 12.3 Growth, reproduction, mortality, and carrying capacity

Growth requests consume assimilated matter, energy, oxygen, habitat, and local space. The committed growth is bounded by the first limiting declared capacity. Carrying capacity is a vector, not one biomass number:

`K = {metabolic, spatial, social, trophic, sessile_space, reproductive}`

The operative capacity is the first failing dimension for the proposed state transition. A filter upgrade may increase metabolic processing but cannot increase adult turn radius, territory, group structure, refuge, prey safety, coral face space, or humane grow-out capacity unless it physically changes that dimension. Claim: `ORG-006`.

Reproduction requires maturity, condition, reproductive compatibility, cues, nest or spawning habitat, egg or gamete survival, first food, larval environment, and grow-out capacity. The prerequisite chain runs before any profile-defined stochastic success draw. Offspring without capacity are blocked rather than spawned into predictable harm. Claims: `ORG-003`, `ORG-013`, `ORG-014`.

Mortality can follow a curated deterministic threshold, accumulated exposure model, predation event, or stochastic hazard profile only when its scope and evidence class are declared. Missing species-response evidence does not authorize a generic probability. Gross signs may precede mortality but never establish cause by themselves. Claims: `ORG-011`, known unknowns 1 and 8.

## 13. Habitat eligibility and directional compatibility

Hard gates run in this exact order before any soft modifier. Any failed hard gate returns `hard_incompatible` or `unavailable` and stops evaluation.

1. Declared water namespace and explicit life-stage salinity transition.
2. Temperature and core chemistry overlap for the applicable life stage.
3. Expected adult size, body shape, growth trajectory, turn radius, usable footprint, depth, and unobstructed route.
4. Normal swimming, resting, burrowing, clinging, schooling, diel, and escape behavior.
5. Required social group, pair, harem, sex ratio, hierarchy, and conspecific constraints.
6. Required substrate, cover, cave, host, plant, attachment, nesting, or spawning habitat.
7. Directional predation, severe aggression, venom, stinging, toxin, unavoidable feeding exclusion, and coral or invertebrate predation.
8. Oxygen, waste, feed, biological filtration, temperature-control, and redundancy capacity at expected load.
9. Quarantine or source protocol, treatment compatibility, and biosecurity separation.
10. Legal, collection, trade, provenance, invasive-species, and release restrictions when current control sources are available.

Claims: `ORG-006`, `ORG-007`, `ORG-009`, `ORG-012`, `ORG-014`.

Only after all hard gates pass may the model evaluate ordered interaction edge `A -> B`. Soft modifiers include territory overlap, barriers, refuge, current preference, feeding zone and time, resource competition, fin or coral nipping, bulldozing, aggression reach, breeding state, hunger, individual history, juvenile risk, microfauna predation, neighbor reach, and future growth. Allowed outputs are `conditionally_compatible`, `curated_exception`, `unknown`, and `compatible_at_declared_scope`. `unknown` never converts to compatible. Compatibility is directional, time-dependent, and scoped. Claim: `ORG-008`.

No generic shark profile exists. A shark record remains unavailable until it has curated adult size, enclosure geometry, unobstructed run or benthic use, swimming and ventilation mode, substrate, diet, prey profile, life-support load, and handling risk. Gallons, juvenile size, player level, or filtration cannot pass it. A shark-to-clownfish edge is `hard_incompatible` only when the selected shark's curated prey profile makes that fish a defensible prey match. Otherwise it is conditional or unknown, never automatically safe. Claim: `ORG-009`.

## 14. Equipment, sensors, controllers, and incidents

An equipment profile contains mechanism, compatible namespace, installation requirements, capacity surface over actual conditions, spatial coverage, control mode, observables, maintenance and fouling state, consumables, electrical input, delivered heat, water use, noise metadata, failure modes, alarms, and safe fallback state. Nameplate maximum, purchase price, rarity, and brand are not delivered performance. Claims: `SP-008`, `GP-003`.

Shared equipment class names do not imply shared media, settings, biological effects, or sensing principles. A marine-conductivity-dependent ATO sensor is blocked in freshwater. Marine foam fractionation is disabled by default in freshwater. RO units post treated water and reject-water ledgers when that system boundary is modeled. Claims: `GP-004`, `GP-006`.

Each incident record has:

1. initiating event or latent failure;
2. affected true-state flux or capacity;
3. delayed physical and biological consequences;
4. visible and instrument observations with uncertainty;
5. discriminating checks;
6. bounded correction actions;
7. recovery invariants and trend evidence.

Supported incident families are ATO, heater, pump, drain, outage, skimmer, light, RO/DI, dosing, probe, biofilter, overfeeding, organic load, source-water disinfectant, cyanobacteria, aggression, predation, quarantine, and pathogen-observation events. Exact failure rates and repair times are `TBV` unless a scoped equipment profile supplies them. Claims: `FW-010`, `GP-006`.

## 15. Parameter-family registry

The tables below specify units, evidence, update scale, constraints, and overrides. A row can define a state family without supplying a numeric value.

### 15.1 Physics and chemistry

| Parameter family | Canonical unit | Namespace | Evidence class | Claim IDs | Update scale | Constraints | Override scope |
|---|---|---|---|---|---|---|---|
| Internal geometry and water height | `m`, `m^2`, `m^3` | `shared_physics` | `EBF`, `DE` | `SP-001` | Event or physics substep | Actual wetted geometry; displacement explicit | Installation and compartment |
| H2O mass | `kg` | `shared_physics` | `DE` | `SP-004`, `SP-005` | Physics substep | Nonnegative; every boundary flux typed | Compartment |
| Conservative component mass | `kg` plus named basis | `shared_physics` | `DE` | `SP-004`, `SP-005` | Physics or chemistry substep | No reaction source; explicit export only | Component and compartment |
| Reference-composition salt-equivalent mass `m_salt_eq` and `S_eq` | `kg`, `g kg^-1` | `marine_reef` | `EBF`, `DE` | `SP-004`, `MR-002`, `MR-011` | Physics substep | `S_eq = 1000 * m_salt_eq / m_solution`; evaporation salt-equivalent flux is zero; no identity with `S_A`, `S_P`, or `SG` | Salt mix and system |
| Freshwater mineral components | `kg`, named concentration basis | `freshwater` | `EBF`, `DI` | `FW-002`, `FW-004` | Physics or chemistry substep | No marine salt-mix field | Source, biotope, component |
| Evaporation coefficient | `kg s^-1 m^-2 Pa^-1` | `shared_physics` | `DE`, `DI` | `SP-004` | Installation load, then physics substep | `unset_required` until calibrated; bounded flux | Installation |
| Heat capacity and heat-transfer terms | `J K^-1`, `W K^-1`, `W` | `shared_physics` | `DE`, `DI` | `SP-003` | Physics substep | Energy closure required | Fluid, equipment, installation |
| Gas-transfer coefficient and saturation function | `s^-1`, named concentration | `shared_physics` | `DE`, `DI` | `SP-003` | Physics or chemistry substep | Temperature, namespace fluid, pressure scope | Installation and fluid profile |
| Nitrogen inventories and capacities | `kg N`, `kg N s^-1` | Shared shape, separate biological profiles | `EBF`, `DI`, `EWC` | `SP-006`, `MR-003`, `FW-003` | Chemistry or biology substep | Fishless challenge; no cross-namespace seed | Biofilter, community, namespace |
| Alkalinity inventory and pH result | equivalents, named concentration, dimensionless pH | Separate marine and freshwater profiles | `EBF`, `DI` | `MR-011`, `FW-002` | Chemistry substep | Dose material first; pH derived; solver closure | System, source, biotope |
| Nutrient and organic pools | `kg` with named basis | Separate marine and freshwater profiles | `EBF`, `DI` | `MR-008`, `FW-008` | Chemistry or biology substep | No analytical-zero optimum; export explicit | Component, species, provenance |

### 15.2 Fields, biology, and welfare

| Parameter family | Canonical unit | Namespace | Evidence class | Claim IDs | Update scale | Constraints | Override scope |
|---|---|---|---|---|---|---|---|
| Actual return and circulation flow | `m^3 s^-1` | `shared_physics` | `EBF`, `DE`, `DI` | `SP-002` | Physics substep | Duty point, not nameplate | Equipment and installation |
| Local velocity or shear field | `m s^-1`, declared shear unit | `shared_physics` | `EBF`, `DI` | `SP-002`, `MR-010` | Physics substep or geometry event | Not derived from turnover alone | Cell, equipment layout |
| Local PPFD and spectrum | `umol photons m^-2 s^-1` plus spectral bins | `marine_reef`; separate plant-light profile in `freshwater` | `EBF`, `DI` | `MR-009`, `FW-002` | Light event and biology sample | Coral response never leaks to freshwater | Cell, surface, species, provenance |
| DLI | `mol photons m^-2 day^-1` | Namespace-specific biology | `DE` | `MR-009` | Diel accumulator | Local orientation; spectrum remains separate | Surface and organism |
| Substrate and detritus | `m`, `m^3`, `kg` | Separate habitat profiles | `EBF`, `DI` | `MR-005`, `FW-005` | Particle or biology substep | No universal depth; bare bottom valid | Cell, habitat, species |
| Ugly-phase guild state | `kg`, coverage fraction, declared rate | Separate marine and freshwater catalogs | `EBF`, `DI` | `MR-006`, `MR-007`, `FW-006` | Biology substep | No fixed succession; taxon rates unresolved | Guild, cell, inoculation history |
| Coral polyp layers | Layer-specific mass, energy, geometry, or bounded index | `marine_reef` | `EBF`, `DI` | `ORG-001`, `ORG-002`, `ORG-003` | Biology substep or event | Concurrent layers; no single health score | Species, provenance, colony, module |
| Microfauna stages | count or `kg` biomass | Separate marine and freshwater catalogs | `EBF`, `DI` | `ORG-004`, `ORG-005` | Biology substep or event | Matter transfer explicit; no cleanup sink | Taxon, stage, refuge, system |
| Feeding and reserve energy | `kg`, `J`, `W` | Species namespace | `EBF`, `DI` | `ORG-010` | Feeding event and biology substep | Leftovers persist; cleanup animals fed | Species, life stage, individual |
| Reproduction prerequisites and rates | booleans, state indices, declared event rate | Species namespace | `EBF`, `DI`, `EWC` | `ORG-003`, `ORG-013` | Biology event | Capacity before stochastic draw; no random reward roll | Species, reproductive type, individual |
| Carrying-capacity vector | Dimension-specific units | Species namespace | `DI`, `EWC` | `ORG-006` | Placement, growth, or breeding event | First failing dimension blocks | System, habitat, species |
| Hard habitat gates | ordered result | Species namespace | `EBF`, `EWC` | `ORG-007`, `ORG-009` | Purchase, transfer, growth review | Run before soft modifiers | Species, life stage, system |
| Directional compatibility | ordered edge and scoped status | Species namespace | `EBF`, `DI` | `ORG-008` | Interaction event or state change | Unknown is not compatible | Ordered individual or species pair |

### 15.3 Equipment and observation

| Parameter family | Canonical unit | Namespace | Evidence class | Claim IDs | Update scale | Constraints | Override scope |
|---|---|---|---|---|---|---|---|
| Equipment capacity surface | Mechanism-specific SI units | Shared shape, namespace-specific behavior | `EBF`, `DI` | `SP-008`, `GP-003` | Controller or physics substep | Actual condition and maintenance state | Product and installation |
| Maintenance and consumables | Bounded state plus explicit mass or time basis | Equipment namespace | `EBF`, `DI`, or `TBV` | `SP-008`, `GP-003`, `GP-006` | Event | Product evidence or marked tuning only | Product or scenario |
| Failure mode and hazard rate | State plus `s^-1` when probabilistic | Equipment namespace | `EBF` scoped behavior or `TBV` rate | `SP-008`, `GP-006` | Event | Product behavior does not imply universal rate | Product, installation, difficulty |
| Sensor gain, bias, drift, noise, lag | Sensor-specific units | Equipment namespace | `DI`; `EBF` only for named profiles | `SP-007`, `SP-008` | Observation sample | True state immutable; missing coefficients explicit | Sensor and installation |
| ATO thresholds and timeout | `m`, `s`, or device state | Namespace-aware equipment | `EBF` product-specific or `TBV` | `SP-008`, `MR-002`, `GP-006` | Controller tick or event | Unsalted reef reservoir; independent safeguards | Product and installation |
| Numerical substep and tolerances | `s`, dimension-specific tolerance | `shared_physics` | `TBV` | `SP-009` | Integrator | Event splitting and conservation required | Solver and scenario |
| Stochastic seed and stream IDs | integer identifiers | `shared_physics` | `DI` | `SP-009` | Scenario initialization | Reproducible and subsystem-stable | Scenario |

## 16. Scoped numeric profile registry

No row below becomes a universal biological target unless its disposition explicitly says so.

| Parameter or value | Class | Disposition and scope | Model rule | Claim and source mapping |
|---|---|---|---|---|
| `1 US gal = 3.785411784 L` | `EBF` | Selected conversion | Exact UI-boundary conversion | `SP-001`, `SRC-001` |
| Rectangular volume and displacement | `DE` | Selected equation | Internal dimensions and actual water height, less displacement, plus circulating system water | `SP-001`, `SRC-001` |
| Marine source-reported profiles: Steinhart `33 to 36 ppt`; NOAA experimental `35` | `EBF` scoped profiles, `DE` base ledger | No universal selection | Store as separate named source profiles; the base computed state is `S_eq`; do not identify a source value with `S_eq`, `S_A`, `S_P`, or `SG` | `SP-004`, `MR-011`, `SRC-003`, `SRC-019`, `SRC-002` |
| Marine temperature: Steinhart `24 to 26 deg C`; NOAA experimental `24.5 to 28 deg C`; NOAA Ocean Service broad natural reef-building coral context about `23 to 29 deg C` | `EBF` scoped profiles | No universal selection | Keep all three provenance scopes separate. The NOAA Ocean Service context is not an aquarium setpoint or every-coral tolerance. Species and provenance select the response curve. | `MR-011`, `MR-009`, `SRC-003`, `SRC-019`, `SRC-090` |
| Marine pH: Steinhart `8.0 to 8.4`; NOAA `8.1 to 8.3` | `EBF` scoped profiles | No universal selection | Keep profiles separate | `MR-011`, `SRC-003`, `SRC-019` |
| Marine alkalinity: Steinhart `3.0 to 3.5 mEq L^-1`; NOAA `8 to 10 dKH` | `EBF` scoped profiles | No universal selection | Keep profiles separate; show basis | `MR-011`, `SRC-003`, `SRC-019` |
| `1 mEq L^-1 = 2.8 dKH = 50 mg L^-1 as CaCO3` | `EBF` | Scoped conversion mapping | Conversion only, not a target | `MR-011`, `SRC-019` |
| Marine calcium: Steinhart `400 to 460 mg L^-1`; NOAA `380 to 450 mg L^-1` | `EBF` scoped profiles | No universal selection | Keep profiles separate | `MR-011`, `SRC-003`, `SRC-019` |
| Marine magnesium: Steinhart `1300 to 1400 mg L^-1`; NOAA `1250 to 1350 mg L^-1` | `EBF` scoped profiles | No universal selection | Keep profiles separate | `MR-011`, `SRC-003`, `SRC-019` |
| Marine nitrate and phosphate: NOAA nitrate below `0.2 ppm`, phosphate below `0.03 ppm`; Steinhart nitrate below `10 mg L^-1 as NO3`, phosphate below `0.15 mg L^-1 as PO4` | `EBF` scoped profiles | Conflict retained | Do not average or call universally safe | `MR-008`, `MR-011`, `SRC-003`, `SRC-019`, `SRC-030`, `SRC-031` |
| Marine flow `10 tank volumes h^-1` | `HC` | NOAA rule of thumb; universal target declined | Local flow and geometry still decide exposure | `MR-010`, `SRC-003`, `SRC-007` |
| NOAA coral `100 to 200 umol photons m^-2 s^-1` for `10 to 12 h`; about `50` in new-coral quarantine | `EBF` scoped profile | Institutional examples only | Species and provenance response required | `MR-009`, `SRC-003` |
| Coral acclimation `3 to 5 days` for *Pachyseris speciosa*; slower than `20 days` for *Acropora millepora* | `EBF` experimental anchors | Named species only; universal ramp declined | Preserve species and experiment provenance | `MR-009`, `SRC-013` |
| TUNZE `10 minute` cutoff; Red Sea `3 mm` control and backup about `2.5 cm` higher | `EBF` product-specific | Named products only | Safety architecture selected; thresholds remain product profiles | `SP-008`, `GP-006`, `SRC-017`, `SRC-018` |
| Freshwater cycle about `3 to 8 weeks`, examples around `30 days` and up to `8 weeks` | `EBF` observed context | Calendar unlock declined | Commission only by functional challenge | `FW-003`, `SP-006`, `SRC-032`, `SRC-033`, `SRC-021`, `SRC-022` |
| Freshwater cycling input `2 to 3 mg L^-1 TAN` | `HC` scoped method | UF/IFAS recirculating-system example; universal dose declined | Optional named method only | `FW-003`, `SRC-034` |
| Goldfish `4 to 25 deg C` | `EBF` group example | Catalog seed only | Species and provenance profile required | `FW-002`, `SRC-042` |
| Livebearers `20 to 28 deg C`, pH `7.0 to 8.0`, GH `8 to 18 dGH`, KH `5 to 15 dKH` | `EBF` group example | Catalog seed only | Not a universal freshwater range | `FW-002`, `SRC-041` |
| Discus `26 to 30 deg C`, pH `6.0 to 7.5`, GH `4 to 12 dGH` | `EBF` group example | Catalog seed only | Not a universal freshwater range | `FW-002`, `SRC-043` |
| Malawi cichlids `23 to 27 deg C`, pH `8.0 to 8.6`, GH `12 to 18 dGH`, KH `10 to 15 dKH` | `EBF` group example | Catalog seed only | Not a universal freshwater range | `FW-002`, `SRC-044` |
| Freshwater size examples: guppy group `45 L`, sailfin mollies `80 L`, six adult discus about `300 L` and `50 L` per adult guide, Malawi community `200 L`, many tankbusters over `500 L`, small shrimp or snail groups `10 L`, larger groups about `20 L` | `HC` species-group envelopes | Catalog seeds; universal formula declined | Adult geometry and behavior gates still apply | `MR-001`, `FW-007`, `ORG-007`, `SRC-041`, `SRC-043`, `SRC-044`, `SRC-045`, `SRC-083` |
| Free and total chlorine `0 mg L^-1` before freshwater exposure | `EBF`, `EWC` | Selected screening value | Exposure blocked until validated | `FW-001`, `SRC-036`, `SRC-037` |
| Freshwater DO above `5 mg L^-1` broad reference; below `5 mg L^-1` danger flag | `EBF` broad screening | No universal species limit | Species, temperature, saturation, and exposure response required | `FW-002`, `FW-010`, `SRC-035` |
| Freshwater TAN or ammonia target `0 mg L^-1`; about `0.05 mg L^-1` un-ionized ammonia broad concern | `EBF` broad screening | Zero target with qualified toxicity | Calculate NH3 from TAN, pH, and temperature with basis | `FW-002`, `SRC-034` |
| Freshwater nitrite target `0 mg L^-1`; about `0.10 mg L^-1` concern for some fish; nitrate below `20 mg L^-1` broad reference | `EBF` broad screening | Zero nitrite target; nitrate profile required | Not a universal biotope range | `FW-002`, `SRC-035` |
| Freshwater alkalinity below `20 mg L^-1 as CaCO3` concern; `100 to 180 mg L^-1` recirculating-biofilter guidance | `EBF` engineering envelope | Universal target declined | May conflict with low-alkalinity biotopes | `FW-002`, `SRC-033`, `SRC-034` |
| Freshwater planted `6 to 8 h` start; up to `10 to 12 h` in some ramped systems | `HC` | Default hint only | Not coral biology or universal plant biology | `FW-002`, `FW-008`, `SRC-046` |
| Freshwater water change up to `25%` weekly; discus `50%` weekly | `HC` | Context-specific conventions; universal schedule declined | Need derived from load, chemistry, and species | `FW-004`, `SRC-043`, `SRC-085` |
| Fish quarantine minimum `30 days`; coral nursery `30 days` | `HC`, `EWC` | Context-specific isolation examples; universal duration declined | No pathogen-exclusion guarantee | `ORG-012`, `SRC-021`, `SRC-067` |
| Numerical substep `1 to 60 s` | `TBV` | Tunable candidate range | Valid only with flux bounds and exact event splitting | `SP-009` |

## 17. Numerical safeguards and time acceleration

1. Integrate extensive masses, energy, populations, and particle inventories. Derive concentrations and ratios after commit.
2. Enforce nonnegative inventories by bounding every requested outflow to available stock over the accepted `dt`. A bound hit emits a depletion event and can change downstream behavior.
3. Do not silently clip negative mass, impossible water level, over-capacity volume, invalid pH solve, or population underflow. Reject, subdivide, or surface a profile defect.
4. Split steps at pump-dry, overflow, siphon, controller, depletion, dosing, feeding, reproduction, mortality, and failure events. Use adaptive steps for stiff chemistry, gas, or biological coupling.
5. Build source-term requests from one pre-step snapshot and apply their accepted transfers simultaneously where possible. Internal transfer packets must be bitwise or tolerance-accounting complements.
6. Assert water, `m_salt_eq`, each conservative solute, energy, particles, and tracked biomass at compartment and whole-system boundaries. Tolerances are explicit `TBV` solver parameters with units and scale; they do not excuse unexplained drift.
7. Store residuals by component and operation. A residual beyond tolerance blocks commit and records the smallest implicated ledger.
8. Use reproducible scenario seeds and stable named random streams for failures, encounters, reproduction, and demographic events. Adding an unrelated subsystem must not reseed existing streams.
9. Run prerequisites and welfare gates before random draws. Randomness cannot bypass eligibility, capacity, namespace, or unavoidable predation constraints.
10. Time acceleration is limited by the earliest unresolved event, controller sampling need, observation aliasing limit, profile-defined response time, or welfare-critical transition. The engine must slow, pause, or analytically integrate a validated process rather than skip it.
11. Any analytical fast-forward operator must conserve the same ledgers, return all threshold events in order, preserve the stochastic stream contract, and be validated against substepped execution for its declared scope.
12. Difficulty may change information, uncertainty presentation, time pressure, wear, failure frequency, economy, and procedural detail, but never conservation, namespace, adult-space, cycling, or unavoidable-predation gates.

Claims: `SP-009`, `GP-007`, `ORG-007`.

## 18. Validation invariants

| Invariant ID | Assertion | Evidence mapping |
|---|---|---|
| `INV-MASS-01` | Whole-system change for H2O, `m_salt_eq`, and each conservative component equals explicit boundary packets within declared tolerance. | `SP-004`, `SP-005`, `SP-009` |
| `INV-EVAP-01` | An evaporation packet contains H2O and energy only; ordinary dissolved salt and conservative-solute export is zero. | `SP-004` |
| `INV-ATO-01` | Baseline marine ATO reservoir has `m_salt_eq = 0` and posts unsalted purified freshwater only. | `MR-002` |
| `INV-WC-01` | Water-change removal and addition remain separate receipts; component arithmetic matches packet composition. | `SP-005` |
| `INV-SAL-01` | `S_eq`, `S_A`, `S_P`, and `SG` use distinct fields, basis, and provenance. The base model does not derive or expose `S_A`; only a separately validated TEOS-10 profile may do so. | `MR-011` |
| `INV-VOL-01` | All load and concentration calculations use actual operating water volume, not marketed volume. | `SP-001` |
| `INV-FLOW-01` | Filtration turnover, nominal circulation, local velocity or shear, and replacement remain distinct. | `SP-002`, `MR-010` |
| `INV-EVENT-01` | A step never crosses pump-dry, overflow, siphon, depletion, or controller thresholds without splitting or a validated exact event operator. | `SP-009` |
| `INV-OBS-01` | Sensor reading mutation cannot modify true state; calibration, drift, noise, lag, and fault remain observable metadata. | `SP-007` |
| `INV-CYCLE-01` | `commissioned` can be set only by a passed animal-free functional challenge, never elapsed time. | `SP-006`, `MR-003`, `FW-003` |
| `INV-NS-01` | No organism, microbial seed, consumable, setting, or operation crosses marine and freshwater namespaces. | `FW-009`, `GP-004` |
| `INV-FW-01` | Freshwater schema contains no coral, marine salinity, marine salt mix, reef chemistry, or marine seed assumption. | `FW-009` |
| `INV-POLYP-01` | A polyp can concurrently be extended, feeding, energy-limited, calcifying, injured, competing, and reproductive; one layer cannot overwrite another. | `ORG-001`, `ORG-002` |
| `INV-MICRO-01` | Microfauna feeding transfers matter among explicit pools; no cleanup action deletes mass. | `ORG-004`, `ORG-005` |
| `INV-WELFARE-01` | All hard gates run before soft compatibility; any failure blocks transfer regardless of economy or equipment. | `ORG-006`, `ORG-007` |
| `INV-PRED-01` | Compatibility is directional; unknown is not compatible; shark-clownfish hard block requires a curated prey match. | `ORG-008`, `ORG-009` |
| `INV-REPRO-01` | Reproduction requires the full profile-defined prerequisite and grow-out capacity chain before stochastic success. | `ORG-003`, `ORG-013`, `ORG-014` |
| `INV-SOURCE-01` | Every numeric profile retains unit basis, evidence class, claim, source, provenance, disposition, and override scope. | A0 evidence contract |

## 19. Acceptance scenarios

| Scenario | Setup and action | Expected acceptance result |
|---|---|---|
| `ACC-01 Marine evaporation` | Use Section 7.1's `m_solution = 100 kg`, `S_eq = 35 g kg^-1`, and `2 kg` H2O loss. | `m_salt_eq` stays `3.5 kg`; `S_eq` becomes `35.714 g kg^-1`; mass residual is zero. |
| `ACC-02 Exact reef ATO` | Add `2 kg` unsalted purified freshwater after `ACC-01`. | `m_solution` returns to `100 kg` and `S_eq` to `35.000 g kg^-1`; one top-off receipt, no dose or water-change receipt. |
| `ACC-03 Wrong reef reservoir` | Connect a reservoir with nonzero `m_salt_eq` or an undeclared additive to baseline reef ATO. | Filling is blocked or the additive is routed through a separately authorized dosing subsystem; no silent baseline ATO use. |
| `ACC-04 Freshwater evaporation` | Reduce `100 L` to `95 L` with conservative-solute mass fixed, then add `5 L` solute-free water. | Concentration first rises about `5.26%`, then returns to start; no marine salinity field exists. |
| `ACC-05 Water change` | Execute Section 7.3's removal and replacement. | New `m_salt_eq` is `3.48 kg`, new `S_eq` is `34.8 g kg^-1`, and removal and addition have separate receipts. |
| `ACC-06 Drainback freeboard` | Use Section 7.4's geometry, volumes, and `23 L` measured freeboard. | Commissioning fails the hypothetical `25 L` requirement; expected overflow risk is `2 L` under stated assumptions. |
| `ACC-07 Low-water event` | Use Section 7.5's chamber and net drawdown. | Solver reaches the equipment threshold no later than `180 s`, splits exactly, and applies the pump dry-state profile without negative volume. |
| `ACC-08 Sensor drift` | Hold true state constant while applying a nonzero declared sensor drift. | Reading changes, true state does not, controller sees quality and calibration metadata, and the ledger remains unchanged. |
| `ACC-09 Fishless commissioning` | Advance calendar time without a challenge, then perform a declared animal-free challenge. | Calendar alone does not commission; only the passing state-based result can commission. |
| `ACC-10 Contingent ugly phase` | Initialize two systems with different inoculation and resource profiles. | Guild trajectories may differ; no fixed sequence or mature-day flag is imposed. |
| `ACC-11 Cyanobacteria cause check` | Change local flow alone without changing other risk factors. | Flow modifies deposition or local exposure only through declared links; it is never recorded as the sole universal cause. |
| `ACC-12 Local coral injury` | Injure one module while colony sharing remains active. | Local injury persists, other layers continue concurrently, and sharing cannot erase the lesion. |
| `ACC-13 Microfauna grazing` | A grazer consumes a detrital or algal mass packet. | Resource is debited and consumer, waste, respiration, reproduction, detritus, or export pools are credited; total tracked matter closes. |
| `ACC-14 Namespace leak` | Attempt to add marine seed, coral, salt mix, or reef salinity control to freshwater. | Schema or action validation rejects it before mutation. |
| `ACC-15 Hard gate before soft score` | Provide excellent filtration but insufficient adult geometry or an unavoidable curated prey match. | Result is `hard_incompatible`; filtration and soft modifiers cannot override it. |
| `ACC-16 Shark and clownfish` | Test one shark with curated matching prey profile, then a shark with unresolved prey profile. | First is `hard_incompatible`; second is `unknown` or conditional, never automatically safe. |
| `ACC-17 Breeding capacity` | Meet maturity and cues but omit first food or grow-out capacity. | No offspring event is committed; missing prerequisite is reported. |
| `ACC-18 Product profile isolation` | Load named ATO thresholds, then swap to an unprofiled device. | Named values do not carry over; new fields become `unset_required` or explicit `TBV`. |
| `ACC-19 Time acceleration` | Fast-forward across a scheduled pump failure and oxygen-risk transition. | Engine stops or returns ordered events and conserved state; it cannot skip the incident. |

## 20. Calibration, unresolved overrides, and exclusions

The following remain explicit override work, not inferred defaults:

1. Species-level adult geometry, social, diet, prey, reproductive, stress, growth, mortality, and welfare thresholds.
2. Coral PPFD, spectrum, DLI, flow, neighbor distance, temperature, chemistry, symbiont, growth, healing, and larval curves by species and provenance.
3. Installation evaporation, gas transfer, pump and system curves, filter capacity, fouling, sensor reliability, and anti-siphon behavior.
4. Microfauna demographic and trophic rates, filtration susceptibility, life-stage transitions, and carrying capacities.
5. Freshwater biotope, source-population, source-water, mineral, plant, substrate, and breeding profiles.
6. Artificial salt-mix density and `SG` observation mappings. A requested `S_A` output requires a separately validated TEOS-10 profile and is not derived from `S_eq`.
7. Failure distributions, service times, information delay, economy, and pacing values, all labeled `TBV` when used.
8. Aquarium-specific nuisance dinoflagellate triggers, toxin status, and treatment efficacy.
9. Detailed medication, euthanasia, zoonotic, electrical, structural, flood, legal-commerce, and release controls.

Unknown required species, biotope, provenance, equipment, or installation fields resolve to `unavailable`, `unknown`, or `unset_required` at their declared boundary. They do not inherit a generic safe value.

Out of scope are simulator code, 3D asset design, engine selection, a complete species database, product pricing, veterinary treatment protocols, legal advice, structural or electrical approval, and any claim that simulated success validates real aquarium care. Claims: `GP-009`, `ORG-014`.

## 21. Final closeout status

This artifact is `final_complete` for evidence revision `reef-packet-v1-2026-09-02`. Its previously declared `SURFACE_READY` handoff gate passed after all of the following were confirmed for the validated artifact revision:

1. Marine evaporation and unsalted-freshwater ATO examples close exactly.
2. Water-change, overflow, freeboard, and low-water examples pass unit and arithmetic checks.
3. Marine and freshwater schema and terminology scans show no namespace leakage.
4. `S_eq`, `S_A`, `S_P`, and `SG` remain distinct; the base model does not derive `S_A`.
5. Hard welfare gates, directional compatibility, shark handling, layered polyps, and mass-conserving microfauna are visible and internally consistent.
6. Every numeric entry retains its evidence class, scope, provenance, and claim mapping; every tuning value is marked `TBV`.
7. All companion links resolve to completed package artifacts.

RAQ-V1 equation, unit, namespace, welfare, numeric-source, and cross-artifact review completed. RAQ-F1 packaging also completed. No validation remains pending for this evidence revision. Any future substantive change creates a new artifact hash and requires scoped revalidation.
