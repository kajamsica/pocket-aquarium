# Hyperrealistic Aquarium Simulation Research Packet

**Evidence revision:** reef-packet-v1-2026-09-02  
**Audience:** simulation, systems, gameplay, UX, art, and engineering teams  
**Surface state:** final_complete, with the five-file research and design package validated and ready for human review

## Revision log

| Date | Ticket | Change |
|---|---|---|
| 2026-09-02 | RAQ-C2 | Corrected the base artificial-mix salinity terminology to S_eq, reserved S_A and Absolute Salinity for explicitly compliant TEOS-10 profiles, and retained evidence revision reef-packet-v1-2026-09-02. |
| 2026-09-02 | RAQ-P1 | Reconciled delivery metadata after accepted V1 review, correction closure, and F1 packaging. No scientific, quantitative, gameplay, source, citation, or welfare content changed. |

This report is the scientific and husbandry foundation for an interactive 3D aquarium game. It explains the causal system and the boundaries that must survive implementation. Detailed variables, equations, and schemas belong in the [simulation parameter model](/Volumes/git/games/reef/simulation_parameter_model.md). Player loops, feedback, economy, progression, and incident design belong in the [gameplay systems specification](/Volumes/git/games/reef/gameplay_systems_spec.md). Every claim and source profile is controlled by the [source matrix](/Volumes/git/games/reef/source_matrix.md). Completed validation, correction, and package-closeout receipts are recorded in [final package status](/Volumes/git/games/reef/final_package_status.md).

## Executive summary

The simulation should be built as three visibly separate rule domains: shared physics, marine reef, and freshwater. Geometry, water mass, heat transfer, gas exchange, evaporation, plumbing, particle transport, and sensor behavior can share abstractions. Species, chemistry targets, water preparation, microbial inocula, light biology, consumables, and equipment effects cannot cross between marine reef and freshwater without an explicitly modeled third profile such as brackish water. **DI, EWC.** [FW-009, GP-004: SRC-017, SRC-018, SRC-036, SRC-040, SRC-048, SRC-059, SRC-074, SRC-084, SRC-089](/Volumes/git/games/reef/source_matrix.md)

Aquarium size is not one gallon number. The model must distinguish marketed capacity from actual operating water volume, then test adult body geometry, unobstructed movement, depth, territory, social structure, substrate, refuge, life-support capacity, and directional predation. Larger volume adds chemical and thermal buffering, but it never waives a failed habitat or welfare gate. **EBF, DE, DI, EWC.** [SP-001, MR-001, ORG-006, ORG-007: SRC-001, SRC-003, SRC-037, SRC-059, SRC-060, SRC-061, SRC-071](/Volumes/git/games/reef/source_matrix.md)

Commissioning is state-based, not calendar-based. Both modes require animal-free biofilter establishment and a defined ammonia-processing challenge before stocking. A commissioned aquarium is still maturing. Its early films, diatoms, algae, cyanobacteria, and other nuisance or beneficial communities emerge from inoculation history, resources, light, flow, chemistry, disturbance, and competition, not from a fixed scripted sequence. **EBF, DI, EWC.** [SP-006, MR-003, MR-006, MR-007, FW-003, FW-006: SRC-020, SRC-021, SRC-022, SRC-023, SRC-024, SRC-025, SRC-026, SRC-027, SRC-028, SRC-029, SRC-032, SRC-033, SRC-034, SRC-037, SRC-038](/Volumes/git/games/reef/source_matrix.md)

Evaporation removes H2O while ordinary dissolved salts and other conservative solutes remain. Marine salinity therefore rises as water mass falls. Normal reef auto-top-off must add **unsalted purified freshwater, normally RO/DI, only to replace evaporated H2O**, thereby restoring water mass while preserving salt mass. Freshwater top-off also adds freshwater, with reservoir composition governed by the tank's mineral plan. Neither form of top-off exports nitrate, organics, hardness, salt, or other accumulated material. Water change, salt correction, and dosing are separate operations. **EBF, DE, EWC.** [SP-004, SP-005, MR-002, FW-004: SRC-003, SRC-006, SRC-016, SRC-018, SRC-021, SRC-033, SRC-039](/Volumes/git/games/reef/source_matrix.md)

Corals are colonies of living local modules, not decorative meshes with one health bar. Polyps can be extended, feeding, energy-limited, calcifying, injured, competing, and reproductively active at the same time. Light, spectrum, photoperiod, local flow, food, oxygen, temperature, salinity, carbonate chemistry, sediment, neighbors, injury, and acclimation history affect those processes locally. **EBF, DI.** [ORG-001, ORG-002, ORG-003, MR-009, MR-010: SRC-010, SRC-011, SRC-012, SRC-013, SRC-014, SRC-051, SRC-052, SRC-053, SRC-054, SRC-055, SRC-056, SRC-057, SRC-058, SRC-086, SRC-087](/Volumes/git/games/reef/source_matrix.md)

Micro-invertebrates and microbes form functional food-web, decomposition, biofiltration, grazing, scavenging, parasite, prey, and habitat-engineering systems. Cleanup organisms move matter into respiration, waste, growth, reproduction, detritus, and predation. They do not delete nutrients and must be fed when the tank does not supply enough appropriate food. **EBF, DI.** [ORG-004, ORG-005, ORG-010: SRC-063, SRC-064, SRC-065, SRC-066, SRC-067, SRC-072](/Volumes/git/games/reef/source_matrix.md)

The game should reward evidence-led care, not shortcuts. Essential humane life support is available at the start. Upgrades improve actual-condition capacity, control, observability, labor, efficiency, serviceability, or redundancy. They cannot legalize a cross-water transfer, fit an adult shark into inadequate geometry, make prey safe, replace a cycle challenge, or prove real-world care. **DI, TBV, EWC.** [GP-003, GP-004, GP-005, GP-007, GP-008, GP-009, ORG-014: SRC-003, SRC-017, SRC-018, SRC-037, SRC-048, SRC-059, SRC-074, SRC-075, SRC-076, SRC-077, SRC-078, SRC-079, SRC-080, SRC-081](/Volumes/git/games/reef/source_matrix.md)

## Scope, evidence taxonomy, and realism principles

This packet is a simulation-design foundation, not a universal husbandry recipe. It does not replace species-specific care, veterinary diagnosis, current legal controls, electrical or structural review, or local expert judgment. A successful run in the game must never be presented as proof that the same outcome will occur in a real aquarium. **EWC.** [GP-009, ORG-014: SRC-059, SRC-064, SRC-067, SRC-068, SRC-069, SRC-081](/Volumes/git/games/reef/source_matrix.md)

### Evidence classes

| Label | Meaning in this packet | Design use |
|---|---|---|
| **EBF** | Evidence-backed fact or scoped range | Preserve the source, scope, organism or facility, units, and limitations. |
| **HC** | Husbandry convention | Present as a practice or contextual hint, not a biological law. |
| **DE** | Derived equation | Show assumptions, units, inputs, and what the calculation omits. |
| **DI** | Design inference | An implementation choice based on accepted evidence, not a validated animal-outcome standard. |
| **TBV** | Tunable balance value | A pacing, economy, UI, difficulty, or numerical choice that must not masquerade as husbandry evidence. |
| **EWC** | Ethical or welfare constraint | A hard boundary that prevents predictable harm or an unsupported real-world claim. |

These labels are not quality rankings. A manufacturer value can be strong evidence for that product's documented behavior while remaining invalid as a universal device-class threshold. A public-aquarium profile can be accurate for that facility and still be unsuitable as a default for every reef. Source profiles and husbandry ranges are not universal targets. [Source authority classes and use rules](/Volumes/git/games/reef/source_matrix.md)

### Realism principles

1. **Conserve matter and energy.** Water, dissolved salt, named solutes, particulates, biomass, gases, and heat move through explicit fluxes. A cleanup animal, filter, or controller cannot make mass disappear. **DE, DI.** [SP-003, SP-004, SP-005, SP-009, ORG-005: SRC-001, SRC-002, SRC-003, SRC-004, SRC-006, SRC-016, SRC-018, SRC-063, SRC-064, SRC-066](/Volumes/git/games/reef/source_matrix.md)
2. **Resolve space.** A tank-wide average cannot substitute for local light, current, sediment deposition, oxygen exchange, territory, refuge, shading, or coral-neighbor contact. The 3D environment should expose these fields at organisms and surfaces. **EBF, DI.** [MR-009, MR-010, ORG-002, ORG-007, ORG-008: SRC-003, SRC-007, SRC-010, SRC-011, SRC-012, SRC-052, SRC-053, SRC-055, SRC-056, SRC-057, SRC-059, SRC-060, SRC-061, SRC-071, SRC-087](/Volumes/git/games/reef/source_matrix.md)
3. **Separate true state from observed state.** Sensors have calibration, resolution, bias, noise, fouling, lag, and detection limits. A precise-looking number is not perfect knowledge. **DI.** [SP-007: SRC-003, SRC-015, SRC-079](/Volumes/git/games/reef/source_matrix.md)
4. **Gate by welfare before scoring convenience.** Namespace, adult habitat, movement, social structure, substrate, predation, life support, and biosecurity pass before a soft compatibility score exists. **EBF, EWC.** [ORG-006, ORG-007, ORG-009, ORG-012, ORG-014: SRC-021, SRC-037, SRC-059, SRC-060, SRC-061, SRC-067, SRC-071, SRC-073, SRC-081](/Volumes/git/games/reef/source_matrix.md)
5. **Let time expose processes, not unlock them.** Cycling, maturation, acclimation, healing, breeding, fouling, wear, and population change depend on state and history. Elapsed time is context, not proof. **EBF, DI.** [SP-006, MR-003, MR-006, MR-009, FW-003, ORG-003, ORG-005, ORG-013: SRC-013, SRC-020, SRC-021, SRC-022, SRC-023, SRC-024, SRC-032, SRC-033, SRC-034, SRC-058, SRC-063, SRC-066, SRC-070, SRC-072, SRC-086, SRC-088](/Volumes/git/games/reef/source_matrix.md)
6. **Preserve uncertainty.** Unknown identity, undocumented predation, incomplete species data, and ambiguous signs stay unknown or conditional. The system must not silently convert missing evidence into compatibility, diagnosis, or safety. **DI, EWC.** [ORG-008, ORG-009, ORG-011: SRC-056, SRC-057, SRC-059, SRC-060, SRC-061, SRC-062, SRC-068, SRC-069, SRC-087, SRC-088](/Volumes/git/games/reef/source_matrix.md)

## System architecture and shared physical rules

### Actual volume and geometry

Use internal wetted dimensions and actual water height, subtract rock, substrate, equipment, and other displacement, then add the operating water held in sumps, plumbing, and reactors. Store SI units internally. Convert to US gallons only at the interface, using the exact relationship 1 US gal = 3.785411784 L. **EBF, DE.** [SP-001, SRC-001, SRC-003](/Volumes/git/games/reef/source_matrix.md)

The actual operating volume governs dilution, heat capacity, solute concentration, and system-level ratios. It does not describe usable footprint, depth, open swimming route, turn radius, territory, cave access, or the location of hazards. Those geometry checks remain independent. **EBF, DI, EWC.** [MR-001, ORG-006, ORG-007, ORG-009: SRC-003, SRC-037, SRC-059, SRC-060, SRC-061, SRC-071](/Volumes/git/games/reef/source_matrix.md)

### Flow, heat, gases, and particles

The model must keep four concepts separate: filtration-loop turnover, nominal display circulation, local velocity or shear, and true water replacement. Pump output is the actual duty-point flow after head, friction, fittings, fouling, and operating state, not the box maximum. Coral exposure and detritus deposition depend on local hydrodynamics, not only a tank-wide turnover ratio. **EBF, DE, DI.** [SP-002, MR-010: SRC-003, SRC-004, SRC-005, SRC-007, SRC-056](/Volumes/git/games/reef/source_matrix.md)

Temperature couples heater input, pump and light heat, room exchange, chilling, and evaporative heat loss. Oxygen and carbon dioxide couple gas transfer, photosynthesis, organism respiration, nitrification, and decomposition. Flow, temperature, oxygen, and organic load therefore interact during outages, pump failures, blooms, and heavy feeding. **DE, DI.** [SP-003, GP-006: SRC-002, SRC-003, SRC-006, SRC-008, SRC-020, SRC-074, SRC-075, SRC-076](/Volumes/git/games/reef/source_matrix.md)

Suspended food, waste, sediment, bubbles, larvae, and treatment compounds need spatial transport and explicit capture or export. A filter only acts on water and particles that reach it, with efficiency determined by its mechanism and current maintenance state. **EBF, DI.** [SP-008, ORG-005, GP-003: SRC-004, SRC-005, SRC-074, SRC-075, SRC-077](/Volumes/git/games/reef/source_matrix.md)

### Hard no-leak table

| Surface | Marine reef rule | Freshwater rule | Hard enforcement |
|---|---|---|---|
| Water and livestock | Marine organisms use marine profiles and life-stage salinity rules. | Freshwater organisms use freshwater profiles. A common name does not override salinity needs. | A water-namespace mismatch blocks purchase, transfer, placement, and shared-water connection. Brackish or migratory cases require a separate declared profile. |
| Chemistry controls | Artificial seawater composition, salinity basis, reef alkalinity, calcium, magnesium, and marine nutrient profiles. | Source disinfectant, GH, KH or alkalinity, conductivity or TDS, and biotope mineral plan. | Marine controls do not appear in strict freshwater mode. Freshwater targets do not prepare marine water. |
| Lighting biology | Coral-local PPFD, spectrum, DLI, orientation, shading, and coral acclimation. | Freshwater plant and animal light profiles. | Coral PAR bands and coral polyps never populate a freshwater catalog. Freshwater plant rules never stand in for coral biology. |
| Microbial seed and habitat | Marine rock, sand, and biofilter communities retain marine provenance. | Freshwater media and communities retain freshwater provenance. | Seed media and microbial communities are not interchangeable. |
| Equipment and consumables | Marine salt, reef dosing, marine skimming, and marine-compatible sensing can exist. | Dechlorination, freshwater mineralization, and freshwater-compatible sensing can exist. | A shared class name does not imply shared media, setpoints, sensor principle, or effect. Conductivity-dependent marine ATO sensing is blocked in freshwater. Default marine skimmer benefit is disabled in freshwater. |
| Stores and progression | Marine livestock, foods, tests, treatments, media, and water actions come from the marine namespace. | Freshwater equivalents come from the freshwater namespace. | Difficulty, price, ownership, or player level can never bypass namespace gates. |

**EWC, with EBF and DI support.** [FW-001, FW-002, FW-003, FW-009, MR-002, MR-004, MR-009, SP-008, GP-004, ORG-007: SRC-017, SRC-018, SRC-032, SRC-033, SRC-036, SRC-040, SRC-048, SRC-059, SRC-074, SRC-084, SRC-089](/Volumes/git/games/reef/source_matrix.md)

## State-based aquarium lifecycle

The complete player journey has 14 stages: select mode and plan the adult community; choose a site and leak-test; prepare mode-correct water and habitat; establish a fishless biofilter; pass through contingent maturation; prove stability; quarantine; introduce eligible livestock gradually; feed; maintain; review growth and carrying capacity; support breeding only when capacity exists; upgrade measured bottlenecks; and recover from incidents. The order expresses causal dependencies, but duration is state-dependent. **DI, EWC.** [GP-001, SP-006, ORG-007, ORG-012, ORG-013: SRC-003, SRC-016, SRC-021, SRC-033, SRC-037, SRC-059, SRC-067, SRC-070, SRC-072, SRC-073](/Volumes/git/games/reef/source_matrix.md)

Commissioned means that a defined animal-free challenge demonstrated adequate ammonia- and nitrite-processing capacity under the current oxygen, alkalinity, temperature, pH, flow, surface, and load conditions. Maturing means that broader microbial, algal, and microfaunal communities are still developing. The game should show both states at once rather than offer a single cycled or mature switch. **EBF, DI, EWC.** [SP-006, MR-003, FW-003: SRC-020, SRC-021, SRC-022, SRC-023, SRC-024, SRC-032, SRC-033, SRC-034, SRC-037](/Volumes/git/games/reef/source_matrix.md)

## Marine reef foundation

### Purpose, size, and starting plan

Start with the intended adult organisms and habitat rather than a tank marketed by gallons. The design must consider actual operating water volume, footprint, depth, rockwork displacement, unobstructed movement, territory, refuge, substrate needs, expected waste and oxygen load, and life-support delivery. A larger volume can slow concentration and temperature change, but cannot correct a body-shape, turn-radius, territory, substrate, social, or predation failure. **EBF, DI, EWC.** [MR-001, SP-001, ORG-006, ORG-007, ORG-009: SRC-001, SRC-003, SRC-059, SRC-060, SRC-061, SRC-071](/Volumes/git/games/reef/source_matrix.md)

No universal gallons-per-fish, gallons-per-coral, rock-mass-per-gallon, sand-depth, or turnover rule is selected. Marine stock records need adult geometry, behavior, habitat, social, prey, load, and life-stage information. Missing critical information defaults to unavailable or expert review, not a permissive estimate. **DI, EWC.** [MR-001, MR-004, MR-005, ORG-007, ORG-008, ORG-009: SRC-003, SRC-020, SRC-024, SRC-049, SRC-055, SRC-059, SRC-060, SRC-061](/Volumes/git/games/reef/source_matrix.md)

### Marine setup and commissioning sequence

1. Lock the marine reef namespace and preview the adult community, coral placement needs, feeding load, refuge, and future growth.
2. Verify the site and perform a leak, overflow, drain-down, and pump-off freeboard test before animals are at risk.
3. Prepare artificial seawater from suitable purified freshwater and a formulated marine salt mix, then mix, equilibrate, and measure it under a declared salinity convention.
4. Build stable rockwork and select sand or bare bottom from habitat and maintenance needs.
5. Install heating, circulation, gas exchange, mechanical and biological filtration, and any marine-specific equipment with real operating capacities and failure states.
6. Establish the biofilter without animals and prove processing capacity with a defined challenge.
7. Continue through ecological maturation and its contingent ugly phase while monitoring real state and sensor uncertainty.
8. Demonstrate stability, quarantine mode-appropriate livestock, then stock gradually within hard welfare gates.

**EBF, HC, DI, EWC.** [MR-001, MR-002, MR-003, MR-004, MR-005, SP-006, SP-008, ORG-007, ORG-012, GP-001, GP-006: SRC-003, SRC-009, SRC-016, SRC-017, SRC-018, SRC-020, SRC-021, SRC-022, SRC-023, SRC-024, SRC-049, SRC-059, SRC-067, SRC-073, SRC-074](/Volumes/git/games/reef/source_matrix.md)

### Marine rockwork, substrate, filtration, and flow

Live rock can add established biofilms and hitchhikers, while transported rock can also add die-off. Dry or manufactured rock begins primarily as structure and future colonization surface. The game should track provenance, viable biomass, die-off load, attached unknowns, porosity, placement, and water access rather than award generic live-rock points. **EBF, DI.** [MR-004: SRC-020, SRC-024, SRC-049](/Volumes/git/games/reef/source_matrix.md)

Sand and bare bottom are different habitat and maintenance choices. Relevant state includes grain, depth, trapped detritus, oxygen gradient, animal burrowing or resting need, bioturbation, cleanability, and local flow. No universal sand depth is selected. Stable rockwork cannot rely on loose geometry that ignores later digging, growth, maintenance access, or current. **EBF, DI, EWC.** [MR-005, ORG-007: SRC-003, SRC-055, SRC-059](/Volumes/git/games/reef/source_matrix.md)

Filtration is a set of mechanisms, not one score. Biological processing depends on active surface, oxygen, alkalinity, temperature, pH, flow, and load. Mechanical capture changes where particles accumulate but requires removal or cleaning to become export. Marine foam fractionation is marine-specific. Delivered return flow and display circulation must be distinguished from the local velocity and shear experienced by corals and benthic surfaces. **EBF, DI.** [SP-002, SP-006, SP-008, MR-010, GP-004: SRC-003, SRC-004, SRC-005, SRC-007, SRC-023, SRC-048, SRC-074, SRC-077](/Volumes/git/games/reef/source_matrix.md)

### Marine cycling, maturation, ugly phase, and cyanobacteria

Marine commissioning is fishless and challenge-validated. About-30-day and up-to-eight-week references remain contextual observations or practices, not countdown unlocks. A disturbance, loss of oxygen, alkalinity, surface, or flow, or a sharp load increase can make yesterday's capacity inadequate. **EBF, DI, EWC.** [SP-006, MR-003: SRC-003, SRC-021, SRC-022, SRC-023, SRC-024](/Volumes/git/games/reef/source_matrix.md)

The marine ugly phase is contingent competition among bacterial films, diatoms, green algae, cyanobacteria, dinoflagellate-like taxa, calcifying crusts, and other colonists. Inoculation history, available resources, light, temperature, grazing, disturbance, and local habitat can change which community appears and when. The game must not force a universal diatom-to-cyanobacteria-to-algae sequence or grant maturity on a particular day. **EBF, DI.** [MR-006: SRC-020, SRC-025, SRC-027, SRC-028, SRC-029](/Volumes/git/games/reef/source_matrix.md)

Cyanobacterial mat risk is multicausal. Organic loading, phosphorus and iron availability, light, temperature, deposition, and low-oxygen sediment interfaces can interact. Low local flow can alter deposition and exchange, but it is not a sole cause. A visible mat should therefore trigger a diagnostic workflow rather than a one-click low-flow cure. **EBF, DI.** [MR-007: SRC-025, SRC-026](/Volumes/git/games/reef/source_matrix.md)

### Marine chemistry

For the base artificial-mix ledger, S_eq is the **reference-composition salt-equivalent mass fraction**, in g kg^-1, defined as S_eq = 1000 * m_salt_eq / m_solution under the declared idealized reference-composition assumption. Practical Salinity S_P is a separate dimensionless observation. Specific gravity, SG, is dimensionless but depends on sample temperature, reference temperature, or instrument convention. S_A and the full term Absolute Salinity are reserved only for an explicitly compliant TEOS-10 profile. The base simulation does not derive S_A from S_eq. These quantities are not interchangeable identities. **EBF, DE.** [MR-002, MR-011, SP-004: SRC-002, SRC-003, SRC-016, SRC-019](/Volumes/git/games/reef/source_matrix.md)

Track temperature, pH, salinity basis, alkalinity with unit basis, calcium, magnesium, dissolved oxygen, nitrogen compounds with as-N or as-ion basis, phosphate with as-P or as-PO4 basis, and nutrient and organic load trends. Low measured nitrate or phosphate can coexist with rapid biological uptake. Both excess supply and extreme nutrient limitation can create problems, so analytical zero is not a universal reef target. **EBF, DI.** [MR-008, MR-011: SRC-003, SRC-019, SRC-030, SRC-031](/Volumes/git/games/reef/source_matrix.md)

The following values are evidence-backed facility profiles, not universal targets:

| Profile | Temperature | pH | Salinity | Alkalinity | Calcium | Magnesium | Nutrient note |
|---|---:|---:|---:|---:|---:|---:|---|
| NOAA experimental coral systems | 24.5 to 28 C | 8.1 to 8.3 | 35 under its stated convention | 8 to 10 dKH | 380 to 450 mg/L | 1250 to 1350 mg/L | Nitrate below 0.2 ppm and phosphate below 0.03 ppm in that experimental profile |
| Steinhart large mixed-reef exhibit | 24 to 26 C | 8.0 to 8.4 | 33 to 36 ppt as reported | 3.0 to 3.5 mEq/L | 400 to 460 mg/L | 1300 to 1400 mg/L | Nitrate below 10 mg/L as NO3 and phosphate below 0.15 mg/L as PO4 in that exhibit profile |

**EBF, scoped profiles.** Do not average these rows, translate them into an unstated SG target, or infer that either row is safe for every species. [MR-008, MR-011, SRC-002, SRC-003, SRC-019, SRC-030, SRC-031](/Volumes/git/games/reef/source_matrix.md)

NOAA Ocean Service separately reports a broad natural reef-building coral growth context of roughly 23 to 29 deg C. This is environmental context only, not an aquarium setpoint and not a tolerance range for every coral species or provenance. **EBF, broad natural context.** [MR-009, MR-011, SRC-090](/Volumes/git/games/reef/source_matrix.md)

### PAR, spectrum, photoperiod, spatial distribution, and acclimation

Aquarium PAR should be represented as local photosynthetic photon flux density, or PPFD, over 400 to 700 nm, in umol photons m^-2 s^-1. Store spectral bands, photoperiod, and daily light integral separately. A single fixture percentage or surface reading cannot describe the exposure of a shaded, tilted, deep, turbid, or self-shading coral surface. **EBF, DI.** [MR-009, SRC-010, SRC-011, SRC-012, SRC-015](/Volumes/git/games/reef/source_matrix.md)

Daily light integral integrates local PPFD over time. A constant 200 umol photons m^-2 s^-1 for 10 hours gives 7.2 mol photons m^-2 day^-1, but equal DLI created by a higher peak is not assumed biologically equivalent. Continuous light can also differ from a normal light-dark schedule. **DE, EBF, DI.** [MR-009, EQ-DLI, SRC-014](/Volumes/git/games/reef/source_matrix.md)

NOAA's 100 to 200 umol photons m^-2 s^-1 for 10 to 12 hours, and about 50 for new-coral quarantine, are institutional examples only. Species, provenance, symbiont, morphology, orientation, history, and response endpoint select the applicable exposure curve. Named experiments found roughly 3 to 5 days of adjustment in Pachyseris speciosa and slower than 20 days in Acropora millepora after a DLI change, demonstrating why no universal acclimation ramp is selected. **EBF, scoped profiles.** [MR-009, SRC-003, SRC-013, SRC-014](/Volumes/git/games/reef/source_matrix.md)

For the 3D environment, place light sensors and coral faces within the same spatial field. Rockwork, colony growth, water clarity, surface motion, sediment, and neighboring organisms should change local exposure. Acclimation history must persist, so moving a coral or changing the schedule can produce delayed stress even when the final average appears plausible. **DI.** [MR-009, ORG-002: SRC-010, SRC-011, SRC-012, SRC-013, SRC-014, SRC-015, SRC-052, SRC-053, SRC-055](/Volumes/git/games/reef/source_matrix.md)

## Freshwater foundation

### Purpose, size, and starting plan

Freshwater is a family of biotopes, not one chemistry preset. Plan from the intended adult species or population, source water, temperature, pH, GH, KH or alkalinity, current, social group, territory, substrate, plants, feeding, refuge, and invertebrate or prey interactions. Actual operating water volume matters, but it cannot replace adult geometry or behavior checks. **EBF, DI, EWC.** [FW-002, FW-005, FW-007, SP-001, ORG-007: SRC-001, SRC-033, SRC-034, SRC-035, SRC-037, SRC-040, SRC-041, SRC-042, SRC-043, SRC-044, SRC-045, SRC-046, SRC-050, SRC-071, SRC-082, SRC-083](/Volumes/git/games/reef/source_matrix.md)

Contextual husbandry examples show why a universal formula fails:

| Freshwater profile example | Scoped chemistry or temperature example | Contextual volume example | Evidence use |
|---|---|---:|---|
| Small guppy group | 20 to 28 C, pH 7.0 to 8.0, GH 8 to 18 dGH, KH 5 to 15 dKH | 45 L | Trade care-sheet catalog seed, not a universal minimum |
| Sailfin mollies | Same livebearer group envelope in the accepted source | 80 L | Trade care-sheet catalog seed |
| Six adult discus | 26 to 30 C, pH 6.0 to 7.5, GH 4 to 12 dGH | About 300 L, with 50 L per adult as a planning guide | Trade care-sheet group example |
| Malawi cichlid community | 23 to 27 C, pH 8.0 to 8.6, GH 12 to 18 dGH, KH 10 to 15 dKH | 200 L | Trade care-sheet biotope example |
| Small shrimp or snail group | Species-specific mineral, copper, and predation constraints | 10 L, with about 20 L for larger groups | Trade care-sheet invertebrate example |
| Many very large tankbusters | Adult geometry and prey-size cautions dominate | Often over 500 L | Trade care-sheet warning, not a pass for every listed fish |

**HC, scoped species-group envelopes.** Adult body shape, movement, social structure, filtration, habitat, and predation still decide eligibility. [FW-002, FW-007, ORG-007, SRC-041, SRC-043, SRC-044, SRC-045, SRC-083](/Volumes/git/games/reef/source_matrix.md)

### Freshwater setup and commissioning sequence

1. Lock the freshwater namespace and select a biotope or species profile.
2. Characterize source water, including whether chlorine or chloramine is present, and choose the matching treatment.
3. Verify the site and leak-test the assembled system.
4. Select substrate, wood, rock, plants, shelters, and current from animal and plant needs, while accounting for chemistry effects.
5. Install appropriate heating or cooling, circulation, oxygenation, and filtration with actual-condition capacity.
6. Add treated, profile-appropriate freshwater. Do not add marine salt, marine live rock, marine seed, coral controls, or reef dosing.
7. Establish a freshwater biofilter without fish and prove processing capacity with a defined challenge.
8. Continue through contingent films, algae, diatoms, cyanobacteria, and plant establishment.
9. Demonstrate stability, quarantine, and introduce only freshwater-compatible organisms gradually.

**EBF, DI, EWC.** [FW-001, FW-002, FW-003, FW-005, FW-006, FW-007, FW-009, SP-006, SP-008, ORG-012: SRC-021, SRC-032, SRC-033, SRC-034, SRC-036, SRC-037, SRC-038, SRC-040, SRC-041, SRC-042, SRC-043, SRC-044, SRC-045, SRC-046, SRC-048, SRC-050, SRC-067, SRC-073, SRC-084, SRC-089](/Volumes/git/games/reef/source_matrix.md)

### Source water, substrate, hardscape, plants, filtration, and flow

The disinfectant actually present must be neutralized. Standing water is not a chloramine treatment. Free and total chlorine must read 0 mg/L before exposure in the accepted screening rule. This is a water-safety gate, not a claim that every other source-water hazard has been removed. **EBF, EWC.** [FW-001, SRC-033, SRC-036, SRC-037](/Volumes/git/games/reef/source_matrix.md)

Substrate, wood, rock, and plants change habitat, rooting, refuge, light, detritus retention, nutrient storage, and sometimes chemistry. Calcareous material is a characterized hardwater-biotope option, not a generic freshwater upgrade. Plant nutrient uptake stores matter in biomass; export occurs when biomass is removed. Plants do not automatically replace filtration or water changes. **EBF, DI.** [FW-005, FW-008: SRC-044, SRC-046, SRC-047, SRC-048, SRC-050](/Volumes/git/games/reef/source_matrix.md)

Freshwater biological filtration remains capacity-based and mode-specific. Local current must fit the animals, plants, substrate, and oxygen needs. The same pump or filter shell can have different media, setpoints, delivered flow, biological effects, and risks in different freshwater profiles. **EBF, DI, EWC.** [FW-002, FW-003, FW-007, SP-002, SP-006, SP-008, GP-004: SRC-004, SRC-005, SRC-032, SRC-033, SRC-034, SRC-037, SRC-040, SRC-046, SRC-048, SRC-071, SRC-074, SRC-089](/Volumes/git/games/reef/source_matrix.md)

### Freshwater cycling, maturation, ugly phase, and cyanobacteria

Freshwater commissioning is fishless and challenge-based. Research and institutional guidance contain observations from roughly three to eight weeks and practices around 30 days, but these are context envelopes. A functional challenge under the tank's current conditions controls readiness. Freshwater and marine biofilter communities remain separate. **EBF, DI, EWC.** [SP-006, FW-003, SRC-021, SRC-032, SRC-033, SRC-034, SRC-037, SRC-089](/Volumes/git/games/reef/source_matrix.md)

Freshwater biofilms, algae, diatoms, and cyanobacteria are contingent populations, not mandatory levels in a fixed tutorial. Appearance alone cannot establish that a cyanobacterial population is toxic. A sudden biomass death can increase decomposition demand and worsen oxygen loss, so diagnosis and controlled recovery are safer than magical eradication. **EBF, DI.** [FW-006, FW-010, SRC-038, SRC-045, SRC-046](/Volumes/git/games/reef/source_matrix.md)

### Freshwater chemistry and lighting

Each freshwater profile should specify temperature, pH, GH, KH or alkalinity, total ammonia nitrogen and calculated un-ionized NH3, nitrite, nitrate, dissolved oxygen, conductivity or TDS, source-water composition, flow, and light. Nitrogen values must show whether they are expressed as nitrogen or as the ion. No universal freshwater target exists across goldfish, livebearers, discus, Malawi cichlids, blackwater species, plants, shrimp, snails, and large fish. **EBF, DI.** [FW-002, SRC-033, SRC-034, SRC-035, SRC-036, SRC-037, SRC-038, SRC-039, SRC-040, SRC-041, SRC-042, SRC-043, SRC-044, SRC-045, SRC-046, SRC-050, SRC-082, SRC-085](/Volumes/git/games/reef/source_matrix.md)

Selected broad screening values remain qualified. The accepted sources use a healthy-system ammonia or TAN target of 0 mg/L, a nitrite target of 0 mg/L, and free and total chlorine of 0 mg/L. About 0.05 mg/L un-ionized ammonia is a broad tissue-damage concern, about 0.10 mg/L nitrite concerns some fish, dissolved oxygen below 5 mg/L is a danger flag, and nitrate below 20 mg/L is a broad reference. Species, temperature, exposure, pH, and unit basis still control interpretation. **EBF, broad screening, not species optima.** [FW-001, FW-002, FW-010, SRC-034, SRC-035, SRC-036, SRC-037](/Volumes/git/games/reef/source_matrix.md)

Plant lighting is not coral lighting. An accepted trade guide offers a 6 to 8 hour starting photoperiod and up to 10 to 12 hours in some ramped planted systems, but these are husbandry hints, not universal plant biology and never coral PAR targets. The model should retain plant species, depth, shading, nutrient supply, CO2 context, algae competition, and maintenance history. **HC, DI.** [FW-002, FW-008, SRC-046, SRC-047](/Volumes/git/games/reef/source_matrix.md)

## Evaporation, salinity, top-off, water changes, and dosing

### Shared mass logic

Pure evaporation reduces water mass while preserving the mass of ordinary dissolved salt or other conservative solute. For the base artificial-mix ledger, m_salt_eq is the reference-composition salt-equivalent mass and m_solution is total solution mass. Under the declared idealized reference-composition assumption, the state is:

S_eq = 1000 * m_salt_eq / m_solution, in g kg^-1

Evaporation decreases water mass and leaves m_salt_eq unchanged, so S_eq rises. A top-off that replaces only the lost water restores solution mass and the prior S_eq without changing m_salt_eq. This reference-composition salt-equivalent mass fraction is not S_A, S_P, or SG. S_A is available only through an explicitly compliant TEOS-10 profile, and the base simulation does not derive S_A from S_eq. Splash, skimming, leaks, sampling, drain events, and water changes are not evaporation because they can remove water plus dissolved or particulate material. **DE, EBF.** [SP-004, MR-002, MR-011, EQ-SALT: SRC-002, SRC-003, SRC-006, SRC-016, SRC-039](/Volumes/git/games/reef/source_matrix.md)

A deterministic example from the accepted control set starts with 100 kg of solution at S_eq = 35 g kg^-1. It contains 3.5 kg of reference-composition salt-equivalent material. Evaporating 2 kg of water leaves m_salt_eq unchanged and raises S_eq to about 35.714 g kg^-1. Replacing the lost 2 kg with solute-free water restores S_eq = 35.000 g kg^-1. **DE, hypothetical example, not a target.** [SP-004, EQ-SALT](/Volumes/git/games/reef/source_matrix.md)

### Marine reef ATO

Normal reef ATO adds **unsalted purified freshwater, normally RO/DI, only to replace evaporated H2O**. Salt does not evaporate. Adding premixed seawater for normal evaporation would add new salt mass and drive salinity upward. The ATO reservoir is not a water-change reservoir, and baseline ATO water contains no automatic alkalinity, calcium, magnesium, nutrient, or medication dose. **EBF, HC, DE, EWC.** [SP-004, SP-005, MR-002: SRC-003, SRC-016, SRC-017, SRC-018](/Volumes/git/games/reef/source_matrix.md)

An ATO system needs independent safeguards in its equipment profile: primary level observation, bounded delivery, high-level backup, low-reservoir and dry-run handling, timeout, leak and siphon handling, alarm or fallback behavior, and mode-compatible sensing. Product examples such as a TUNZE 10-minute cutoff or a Red Sea 3 mm control band and backup probes about 2.5 cm higher remain manufacturer-specific. Their architecture is informative; their numbers are not universal thresholds. **EBF, product-specific, DI.** [SP-008, GP-006, SRC-017, SRC-018](/Volumes/git/games/reef/source_matrix.md)

ATO failure must have causal direction. Underfill allows water mass to fall and salinity to rise. Stuck-on overfill adds freshwater, lowers salinity, raises system level, and can overflow or dilute chemistry. A siphon can continue after a pump stops. A conductivity-dependent marine sensor belongs only in a compatible marine profile. **EBF, DE, DI.** [SP-004, MR-002, SP-008, GP-004, GP-006: SRC-003, SRC-017, SRC-018, SRC-074](/Volumes/git/games/reef/source_matrix.md)

### Freshwater top-off

Freshwater evaporation also concentrates conservative solutes. Reducing 100 L to 95 L with fixed solute mass raises concentration by about 5.26 percent. Refilling with solute-free water restores the prior concentration, while mineralized refill water adds new solute mass. The reservoir composition must therefore follow the tank's source-water and mineral plan. **EBF, DE, DI.** [FW-004, SP-004, SRC-033, SRC-039](/Volumes/git/games/reef/source_matrix.md)

Freshwater top-off adds freshwater without marine salt. It does not remove nitrate, organics, hardness, conductivity, or other accumulated material. In a hard-water, blackwater, planted, shrimp, or other specialized system, the refill composition is an explicit profile choice, not an automatic assumption that one form of purified water suits every tank. **EBF, DI.** [FW-002, FW-004, FW-005: SRC-021, SRC-033, SRC-039, SRC-041, SRC-043, SRC-044, SRC-045, SRC-046, SRC-050](/Volumes/git/games/reef/source_matrix.md)

### Four distinct fluid actions

| Action | Water mass | Solute or salt mass | Correct use |
|---|---|---|---|
| Top-off | Adds water equal to evaporation loss | Baseline reef ATO adds no salt; freshwater reservoir adds only its declared composition | Restore evaporated H2O |
| Water change | Removes aquarium water and its carried material, then adds prepared replacement water | Changes solute and salt mass according to removed and replacement water | Export and replace under a profile-driven maintenance plan |
| Salt correction | Adds or removes a declared salt-bearing fluid or salt input | Intentionally changes marine salt mass | Correct a verified salinity error gradually under a separate operation |
| Dosing | Adds a named chemical or biological input | Intentionally changes the named state | Address a measured need with explicit units, capacity, limits, and failure behavior |

**DE, EWC.** [SP-005, MR-002, FW-004: SRC-003, SRC-016, SRC-018, SRC-021, SRC-033](/Volumes/git/games/reef/source_matrix.md)

No universal water-change percentage or schedule is selected. Examples such as up to 25 percent weekly in a general freshwater guide or 50 percent weekly in a discus care sheet remain context-specific conventions. Need should follow species profile, actual load, chemistry and trend, export pathways, and source-water constraints. **HC, DI.** [FW-004, SRC-043, SRC-085](/Volumes/git/games/reef/source_matrix.md)

## Coral polyps and colony function

A coral polyp is a living local unit connected to a larger colony. The 3D representation should not treat a colony as one interchangeable surface. Each polyp or local module can carry simultaneous structural, behavioral, energetic, symbiotic, calcification, stress, competition, reproductive, and observation states. Colony-level sharing can buffer a module but must not erase local shading, sediment damage, injury, or neighbor contact. **EBF, DI.** [ORG-001, ORG-002: SRC-051, SRC-052, SRC-053, SRC-054, SRC-055, SRC-056, SRC-057, SRC-068, SRC-087](/Volumes/git/games/reef/source_matrix.md)

### Required concurrent layers

| Layer | What the simulation should represent | Main local drivers |
|---|---|---|
| Structure | Tissue continuity, skeletal or attachment state, surface orientation, wound and loss | Injury, sediment, chemistry, neighbor contact |
| Extension | Extension and retraction as behavior, not a universal health score | Flow, food, light history, disturbance, time, stress |
| Feeding | Prey encounter, capture, handling, digestion, rejection, satiation | Local particles, prey size, current, polyp state |
| Symbiosis | Symbiont type, density, pigment, performance, and translocation | Spectrum, PPFD, DLI, temperature, nutrients, acclimation |
| Energy | Photosynthetic and heterotrophic input, respiration, mucus, repair, and reserve | Light, food, oxygen, temperature, stress |
| Calcification | Growth, maintenance, and dissolution risk | Energy, carbonate chemistry, temperature, flow |
| Stress | Acclimation, chronic load, acute distress, injury, and recovery | Rate and magnitude of environmental change plus history |
| Competition | Contact, overgrowth, shading, chemical exposure, filaments, and sweepers | Neighbor identity, direction, distance, reach, flow |
| Reproduction | Budding, fragmentation, gametogenesis, brooding, broadcasting, settlement | Maturity, species cues, compatible reproductive type, habitat, capacity |
| Health observation | Gross signs and local change without automatic cause assignment | Multi-factor syndrome evidence and diagnostic follow-up |

**EBF, DI.** [ORG-001, ORG-002, ORG-003, MR-009, MR-010: SRC-051, SRC-052, SRC-053, SRC-054, SRC-055, SRC-056, SRC-057, SRC-058, SRC-068, SRC-086, SRC-087](/Volumes/git/games/reef/source_matrix.md)

Polyp extension, retraction, color, or bleaching cannot serve as a single health score. Similar visible states can have multiple causes, and a coral can be extended while energy-limited or retracted while otherwise viable. The player should combine local visual change, environmental trend, measurements, feeding response, tissue integrity, and recovery evidence before acting. **EBF, DI, EWC.** [ORG-002, ORG-011: SRC-052, SRC-053, SRC-054, SRC-055, SRC-056, SRC-068, SRC-069](/Volumes/git/games/reef/source_matrix.md)

Growth and reproduction must remain distinct. Budding expands a colony through local asexual growth. Fragmentation produces a separate piece only if attachment, wound repair, and continued viability succeed. Brooding and broadcast spawning require species-specific maturity, cues, reproductive compatibility, fertilization, settlement, and juvenile support. These are prerequisite chains, not random cosmetic rewards. **EBF, DI.** [ORG-003, ORG-013: SRC-058, SRC-067, SRC-070, SRC-072, SRC-080, SRC-086](/Volumes/git/games/reef/source_matrix.md)

## Microbial ecology and micro-invertebrates

The aquarium should expose microbes through their functions and observable consequences rather than pretend every taxon is known. Biofilter capacity, decomposition, films, nitrification, oxygen demand, nutrient uptake, mat formation, and disturbance response emerge from communities whose composition differs between marine and freshwater systems. Seed provenance, available surface, oxygen, alkalinity, flow, temperature, pH, load, treatments, and time shape those functions. **EBF, DI.** [SP-006, MR-004, MR-006, FW-003, FW-006, FW-009: SRC-020, SRC-023, SRC-024, SRC-025, SRC-032, SRC-033, SRC-034, SRC-038, SRC-089](/Volumes/git/games/reef/source_matrix.md)

Micro-invertebrate and microfauna catalogs remain namespace-specific. They should include copepods, amphipods and isopods, worms, snails and other gastropods, small crustaceans, plankton, protozoa or rotifers where appropriate, eggs, and larvae. Each taxon or functional guild needs feeding mode, resource, refuge, substrate, salinity or hardness, temperature, life stage, reproduction, predation, parasitism, filtration susceptibility, and export routes. **EBF, DI.** [ORG-004, ORG-005: SRC-063, SRC-064, SRC-065, SRC-066, SRC-067](/Volumes/git/games/reef/source_matrix.md)

Population change follows survivors plus reproduction and immigration, minus predation, starvation, density stress, environmental or treatment mortality, filtration or siphon export, and harvest. Refuge geometry and life-stage transitions matter, so adults visible in rockwork do not prove larvae survive pumps, filtration, or predators. **DI, grounded in EBF.** [ORG-005, EQ-MICRO: SRC-063, SRC-064, SRC-066](/Volumes/git/games/reef/source_matrix.md)

Unknown hitchhikers should progress through evidence states such as unknown taxon, known low risk, conditional nuisance, documented predator or parasite, and biosecurity restricted. Copepods, worms, or snails must not be assigned one universal good or bad label because their feeding roles and risks differ. **EBF, DI.** [ORG-004, ORG-005: SRC-063, SRC-064, SRC-065, SRC-067](/Volumes/git/games/reef/source_matrix.md)

## Livestock compatibility, habitat, and carrying capacity

Carrying capacity is the first limiting dimension among metabolic processing, oxygen and heat control, usable space, normal movement, social organization, food, refuge, sessile attachment and neighbor space, biosecurity, and reproductive or grow-out capacity. A larger filter only relieves the dimensions it actually affects. **DI, EWC.** [ORG-006, ORG-007: SRC-037, SRC-059, SRC-060, SRC-071](/Volumes/git/games/reef/source_matrix.md)

### Hard eligibility gates

Apply these gates in order before soft compatibility scoring:

1. Declared water namespace and any explicit life-stage salinity transition.
2. Temperature and core chemistry overlap for the applicable life stage.
3. Adult size, body shape, growth trajectory, turn radius, usable footprint, depth, and unobstructed route.
4. Normal swimming, resting, burrowing, clinging, schooling, diel, and escape behavior.
5. Required group, pair, harem, sex ratio, hierarchy, and conspecific conditions.
6. Required substrate, cover, cave, host, plant, attachment, nesting, or spawning habitat.
7. Directional predation, severe aggression, venom, stinging, toxin, unavoidable feeding exclusion, and coral or invertebrate predation.
8. Oxygen, waste, feed, biological filtration, temperature control, and redundancy at expected load.
9. Quarantine, source protocol, treatment compatibility, and biosecurity separation.
10. Current legal, collection, trade, provenance, invasive-species, and release controls when authoritative current sources are available.

Any failure returns hard_incompatible or unavailable. Price, rarity, current juvenile size, player level, future upgrades, or a high compatibility score cannot override it. **EBF, DI, EWC.** [ORG-006, ORG-007, ORG-009, ORG-012, ORG-014: SRC-021, SRC-037, SRC-059, SRC-060, SRC-061, SRC-067, SRC-071, SRC-073, SRC-081](/Volumes/git/games/reef/source_matrix.md)

### Directional soft compatibility

Only after hard gates pass may the game evaluate monitored and changeable interactions such as territory overlap, visual barriers, refuge, current preference, feeding zone and time, competition, fin or coral nipping, bulldozing, aggression reach, breeding state, hunger, individual history, juvenile risk, and future growth. Compatibility is directional and time-dependent. Unknown evidence remains unknown, not compatible. **EBF, DI.** [ORG-008: SRC-056, SRC-057, SRC-059, SRC-087](/Volumes/git/games/reef/source_matrix.md)

### Sharks, clownfish, and predation

There is no generic shark record and no universal shark gallon threshold. A shark remains unavailable until curated data define adult size, body geometry, unobstructed route or benthic use, swimming and ventilation mode, substrate, diet, prey profile, life-support load, and handling risk. A juvenile that fits temporarily does not pass the adult gate, and filtration cannot compensate for inadequate movement geometry. **EBF, EWC.** [MR-001, ORG-007, ORG-009: SRC-059, SRC-060, SRC-061](/Volumes/git/games/reef/source_matrix.md)

Shark and clownfish compatibility is evaluated directionally against the selected shark's curated prey profile. Shared marine chemistry does not authorize the pair. When the clownfish is a defensible prey match, the pairing is a hard incompatibility. When evidence is incomplete, the result remains conditional or unknown, never automatically safe. The simulation must not claim that every shark always kills every clownfish, but it also must not soften a documented predator-prey match into a score the player can out-upgrade. **EBF, EWC.** [ORG-009, SRC-060, SRC-061, SRC-062, SRC-088](/Volumes/git/games/reef/source_matrix.md)

## Feeding, health, quarantine, and breeding

### Feeding and waste

Feeding is an individual and species-specific intake process. Food enters local water, can be encountered, captured, rejected, eaten, left over, filtered, decomposed, or consumed by other organisms. Ingested food becomes metabolism, respiration, growth, reproduction, excretion, and waste. Uneaten food increases particle, organic, microbial, oxygen, and nutrient loads. **EBF, DI.** [ORG-010, GP-002: SRC-003, SRC-052, SRC-059, SRC-063, SRC-072](/Volumes/git/games/reef/source_matrix.md)

Cleanup animals and live-feed populations have their own nutrition and carrying capacity. A cleanup crew cannot be stocked as starvation equipment, and routine predator-prey feeding must not be rewarded as spectacle. Food type, size, delivery zone, timing, competition, leftovers, and body condition should all be visible or measurable. **EBF, DI, EWC.** [ORG-005, ORG-010, ORG-014: SRC-059, SRC-063, SRC-064, SRC-072](/Volumes/git/games/reef/source_matrix.md)

### Health and diagnosis

Visible signs generate a syndrome description and differential causes, not an automatic pathogen identity. Rapid breathing, color change, retraction, lesions, abnormal position, appetite loss, or tissue change can share environmental, nutritional, interaction, toxic, infectious, or equipment causes. Stronger diagnoses require corresponding examination or evidence. Blind medication is a prohibited shortcut because organism tolerance and treatment context differ. **EBF, EWC.** [ORG-011, MR-012, FW-010: SRC-021, SRC-033, SRC-034, SRC-035, SRC-036, SRC-038, SRC-046, SRC-048, SRC-059, SRC-068, SRC-069](/Volumes/git/games/reef/source_matrix.md)

### Quarantine and biosecurity

Quarantine is a separate epidemiological system with mode-correct water, mature filtration, suitable shelter, appropriate light or flow, dedicated tools, feeding, observation, and cohort separation. A shared net, water path, media transfer, or unverified treatment can defeat separation. Named 30-day fish and coral practices have different scopes and do not prove all pathogens or pests are excluded. **HC, DI, EWC.** [ORG-012, SRC-021, SRC-067, SRC-073](/Volumes/git/games/reef/source_matrix.md)

### Breeding

Breeding requires maturity, body condition, reproductive compatibility, cues, nest or spawning habitat, gamete or egg survival, first food, larval environment, and humane grow-out capacity. Clownfish hierarchy and nesting, coral brooding or broadcast spawning, and other fish larviculture therefore need different profiles. Offspring cannot be a random bonus when the player lacks space, food, filtration, or a responsible destination. **EBF, DI, EWC.** [ORG-003, ORG-013, ORG-014: SRC-058, SRC-059, SRC-062, SRC-067, SRC-070, SRC-072, SRC-080, SRC-081, SRC-086, SRC-088](/Volumes/git/games/reef/source_matrix.md)

## Equipment, maintenance, upgrades, and progression

Every equipment record should expose mechanism, actual-condition capacity, spatial coverage, control range, observability, maintenance state, consumables, energy, heat, water use, noise, footprint, namespace compatibility, and failure modes. Nameplate maximum, price, rarity, and brand prestige are not delivered performance. **EBF, DI.** [SP-008, GP-003: SRC-004, SRC-005, SRC-017, SRC-018, SRC-074, SRC-075, SRC-076, SRC-077, SRC-078, SRC-079, SRC-080, SRC-081](/Volumes/git/games/reef/source_matrix.md)

Essential humane life support must be available from the start. Progression should unlock improved control, instrumentation, coverage, labor reduction, efficiency, serviceability, redundancy, or capacity for a measured bottleneck. An upgrade never waives adult-space, cross-water, fishless-cycle, unavoidable-predation, or biosecurity gates. **DI, TBV, EWC.** [GP-004, GP-005, GP-007: SRC-003, SRC-017, SRC-018, SRC-037, SRC-048, SRC-059, SRC-074, SRC-076](/Volumes/git/games/reef/source_matrix.md)

Maintenance should be causal. Mechanical media accumulates captured material, pumps lose delivered flow through fouling or obstruction, probes drift or foul, heaters and lights age or fail, RO systems produce treated and reject streams, reservoirs empty, and plumbing can siphon, block, leak, or drain back. Inspection, cleaning, calibration, replacement, and testing restore only the affected capability. **EBF, DI.** [SP-007, SP-008, GP-006: SRC-004, SRC-005, SRC-009, SRC-015, SRC-017, SRC-018, SRC-074, SRC-075, SRC-077, SRC-078, SRC-079](/Volumes/git/games/reef/source_matrix.md)

## Common faults, diagnosis, and recovery

The general recovery order is: verify the observation and identity; protect organisms from the immediate hazard; remove or isolate the proximate load; restore failed oxygen, heat, flow, filtration, water-preparation, or containment processes; correct chemistry gradually; and confirm recovery through trends and restored function. High-impact treatment comes after discriminating checks, not before them. **DI, EWC.** [MR-012, ORG-011, GP-002, GP-006: SRC-003, SRC-017, SRC-018, SRC-021, SRC-037, SRC-059, SRC-068, SRC-069, SRC-076, SRC-079](/Volumes/git/games/reef/source_matrix.md)

| Incident | Glance cue and measured evidence | Causal diagnosis | Bounded recovery principle |
|---|---|---|---|
| New-tank ammonia or nitrite | Animal stress if present, test trend, recent load, cycle history | Processing load exceeds current ammonia- or nitrite-oxidation capacity | Protect animals, reduce load, restore oxygen, flow, alkalinity, temperature, and filtration conditions, then re-prove capacity |
| Old-tank alkalinity or pH decline | Trend rather than one reading, maintenance and load history | Accumulated acids and depleted buffering can impair biology | Verify units and instrument, correct gradually under the mode profile, restore maintenance and export |
| Hypoxia or outage | Gasping or abnormal behavior, falling DO, stopped flow or aeration, rising temperature risk | Gas transfer falls while respiration and decomposition continue | Prioritize oxygen and temperature, reduce feeding load, restore safe circulation and monitor recovery |
| Heater, chiller, or pump failure | Temperature or flow trend, equipment state, local dead zones | Lost control or delivery changes heat, oxygen, waste transport, and habitat | Stabilize rate of change, restore or replace the failed function, confirm actual delivered conditions |
| Marine ATO underfill | Falling level and rising salinity with unchanged salt ledger | Evaporation is not being replaced | Repair sensing or delivery, restore evaporated water with unsalted purified freshwater gradually, verify salinity basis |
| Marine ATO overfill or siphon | Rising level, falling salinity, reservoir depletion, leak or overflow alarm | Excess freshwater entered, sometimes after pump stop | Stop inflow, contain overflow, verify salt and water ledgers, correct separately and gradually |
| Freshwater top-off drift | Conductivity, hardness, or concentration trend conflicts with water loss and refill history | Reservoir mineral composition or delivery is inconsistent with the plan | Stop automatic input, verify source and measurements, correct through explicit top-off or water-change actions |
| Overfeeding or organic overload | Uneaten food, turbidity, detritus, oxygen decline, nutrient trend | Food input and decomposition exceed consumption and export | Stop excess input, remove recoverable load, restore gas exchange and filtration, then reassess feed delivery |
| Cyanobacterial mat | Surface mat plus local deposition, light, nutrient, organic, temperature, and oxygen evidence | Interacting habitat and resource conditions, not one universal cause | Verify identity limits, protect organisms, remove proximate biomass carefully, address demonstrated drivers, monitor oxygen and recurrence |
| Source-water disinfectant exposure | Total chlorine evidence, recent water addition, acute fish or invertebrate signs | Treatment did not neutralize the actual disinfectant | Stop source input, protect animals, apply mode-appropriate verified treatment, confirm 0 mg/L free and total chlorine before reuse |
| CO2 overdose or chemical dose error | Dose log, controller state, pH or gas trend, organism response | Coupled dosing or controller failure changed chemistry faster than the system could buffer | Stop dosing, verify instruments and substance, restore gas exchange or safe chemistry gradually |
| Aggression or predation | Directional wounds, pursuit, disappearance, territory and feeding history | A hard gate was missed or a conditional interaction changed | Separate immediately when harm is unavoidable, then correct the habitat or stocking decision rather than buffing a score |
| Coral stress or disease-like change | Retraction, discoloration, tissue loss, sediment, neighbor contact, light and flow history | Environmental, competitive, injury, or disease causes remain differential | Stabilize local conditions, separate contact hazards, collect stronger evidence, and avoid visual-only treatment |
| Biosecurity breach | Shared tools, water, media, pests, disease signs, cohort history | A transfer path bypassed isolation | Stop transfers, re-establish separation, inspect affected cohorts, disinfect within organism and system constraints |

**EBF, DI, EWC.** [FW-010, MR-012, ORG-011, ORG-012, GP-006: SRC-003, SRC-017, SRC-018, SRC-021, SRC-033, SRC-034, SRC-035, SRC-036, SRC-037, SRC-038, SRC-046, SRC-048, SRC-059, SRC-067, SRC-068, SRC-069, SRC-073, SRC-074, SRC-075, SRC-076, SRC-079](/Volumes/git/games/reef/source_matrix.md)

## Implementation choices and evidence limits

The following are selected design inferences, not claims that a particular discretization or UI has been biologically validated:

- Use a compartment and surface-cell model that exposes actual water volume, local light, local flow, sediment, refuge, territory, neighbor reach, and equipment intake or return coverage. **DI.** [SP-001, SP-002, MR-009, MR-010, ORG-002, ORG-007](/Volumes/git/games/reef/source_matrix.md)
- Maintain a hidden true state and a separate observation layer for tests, probes, visual cues, calibration, bias, noise, fouling, lag, and detection limits. **DI.** [SP-007](/Volumes/git/games/reef/source_matrix.md)
- Represent commissioning as measured ammonia-oxidation and nitrite-oxidation capacity under current conditions, plus an explicit challenge result. **DI, EWC.** [SP-006, MR-003, FW-003](/Volumes/git/games/reef/source_matrix.md)
- Represent ugly phases as competing guild populations with inoculation, resource, light, flow, temperature, oxygen, grazing, treatment, and disturbance inputs. Do not hard-code a single succession order. **DI.** [MR-006, MR-007, FW-006](/Volumes/git/games/reef/source_matrix.md)
- Evaluate compatibility as ordered hard gates followed by directional, time-dependent soft modifiers. **DI, EWC.** [ORG-006, ORG-007, ORG-008, ORG-009](/Volumes/git/games/reef/source_matrix.md)
- Give every player action an immediate physical effect, a potentially delayed biological effect, a glance cue, an instrument cue, a confirmatory action, a bounded correction, and recovery evidence. **DI.** [GP-002](/Volumes/git/games/reef/source_matrix.md)
- Keep prices, rewards, resale, task time, fault frequency, failure distributions, and economy multipliers as TBV values. Do not cite them as biological evidence. **TBV, EWC.** [GP-008](/Volumes/git/games/reef/source_matrix.md)

The detailed state variables, equations, units, events, and parameter profiles are intentionally delegated to the [simulation parameter model](/Volumes/git/games/reef/simulation_parameter_model.md). The full interactive loops, tutorials, progression, economy, failure telegraphing, and difficulty controls are intentionally delegated to the [gameplay systems specification](/Volumes/git/games/reef/gameplay_systems_spec.md). This separation prevents the research report from becoming a duplicate implementation schema.

## Limitations and known unknowns

1. Species-level adult geometry, social structure, diet, prey, reproduction, and welfare thresholds are incomplete. Unknown records should remain unavailable or require conservative review.
2. No universal coral PPFD, spectrum, DLI, flow, neighbor spacing, temperature, or chemistry curve has been established. Species, provenance, symbiont, orientation, history, and endpoint overrides are required.
3. Household evaporation and gas-transfer coefficients, pump curves, filter capacities, fouling, sensor reliability, and anti-siphon reliability require equipment and installation profiles.
4. Aquarium-specific nuisance dinoflagellate triggers and treatment efficacy remain taxon-specific and weakly transferable. Toxin safety requires separate review.
5. Freshwater includes extreme biotopes. Chemistry, temperature, current, substrate, plants, and breeding need species and source-population profiles.
6. Brackish and saline-lake systems are outside the two locked namespaces unless added as an explicit third mode.
7. Detailed medication, euthanasia, zoonotic, electrical, structural, building-load, flood, and jurisdictional trade controls require separate current authoritative sources.
8. Microfauna rates, coral growth forms, wound healing, larval survival, and breeding probabilities require declared taxon calibration.
9. Prices, rewards, service times, failure rates, and economy multipliers remain tunable gameplay values.
10. Artificial salt mixes are not identical to reference seawater. Density and specific-gravity observations require a declared composition approximation or mix-specific data.

These are implementation and evidence gaps, not permission to invent universal targets. Source profiles and husbandry ranges remain scoped examples. Future evidence must enter through a revised [source matrix](/Volumes/git/games/reef/source_matrix.md), with classification, scope, units, conflicts, and downstream claim mapping.

## Product and engineering handoff

Product should use this packet to protect the game's causal and welfare promises: visibly separate marine reef and freshwater, make setup and maturation state-driven, treat the ugly phase as ecological competition, reward diagnosis and maintenance, expose the consequences of feeding and breeding, and never monetize bypasses around welfare gates.

Engineering should implement the selected mechanisms and invariants through the [simulation parameter model](/Volumes/git/games/reef/simulation_parameter_model.md), while gameplay and UX should turn them into interactive loops through the [gameplay systems specification](/Volumes/git/games/reef/gameplay_systems_spec.md). The completed V1 review sampled claims and numbers against the current [source matrix](/Volumes/git/games/reef/source_matrix.md), audited namespace separation and welfare gates, verified ATO mass logic, and closed the activated corrections. [Final package status](/Volumes/git/games/reef/final_package_status.md) records the F1 closeout and final_complete state. No further research-package validation is pending; implementation testing remains outside scope until a simulator exists.

The core handoff rule is simple: preserve conservation, locality, provenance, uncertainty, and welfare. Do not use simulation success as evidence that a real animal or aquarium will be safe.
