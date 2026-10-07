# RAQ-A0 Consolidated Positions

Evidence revision: `reef-packet-v1-2026-09-02`

Surface state: `before_surface_ready`

## Revision Log

| Date | Tickets | A0 changes |
|---|---|---|
| 2026-09-02 | RAQ-C1, RAQ-C2 | Registered NOAA Ocean Service as `SRC-090` for the `23 to 29 deg C` natural reef-building coral context; removed unsupported commercial numeric coral-class PAR bands and their incorrect proposition mappings; renamed the artificial-mix conservative salt ledger to `S_eq` and reserved `S_A` for compliant TEOS-10 profiles. |

This is the selected-position control artifact for downstream drafting. It is not final audience prose and it is not a real-world husbandry prescription. Every material rule below maps to an exact claim identifier in the [source matrix](/Volumes/git/games/reef/source_matrix.md). The future audience artifacts are:

- [reef_aquarium_research_packet.md](/Volumes/git/games/reef/reef_aquarium_research_packet.md), RAQ-D1 and the real audience entrypoint
- [simulation_parameter_model.md](/Volumes/git/games/reef/simulation_parameter_model.md), RAQ-D2
- [gameplay_systems_spec.md](/Volumes/git/games/reef/gameplay_systems_spec.md), RAQ-D3

## Upstream Input Integrity

| Accepted lane | Upstream artifact | Receipt-bound SHA-256 |
|---|---|---|
| RAQ-R1 | `/Volumes/git/games/reef/work/marine_ecology_packet.md` | `01a00c830afcc61cee2710e18db7104cb7baa78406c918bb6d226c3191aae554` |
| RAQ-R2 | `/Volumes/git/games/reef/work/freshwater_ecology_packet.md` | `a26cea9d629701168301c2a74e0ec9cad025f536c200f4ca6baa682dc307033a` |
| RAQ-R3 | `/Volumes/git/games/reef/work/engineering_ato_par_packet.md` | `f35e59ea0a6f67f05c83b5f5e30de3534687ce0ee818addd3973b57843b5d530` |
| RAQ-R4 | `/Volumes/git/games/reef/work/livestock_coral_microfauna_packet.md` | `00301f8414e19cd0f913f15a301605bf0450b294641fa283e8fae46b8eb66c6e` |
| RAQ-R5 | `/Volumes/git/games/reef/work/gameplay_equipment_packet.md` | `6c1f91e75e22030db4ac6bee6eadd1eaa8480a72551eed72533db5020ff6a91d` |

These hashes are rechecked at RAQ-A0 closeout. Any mismatch invalidates this aggregation receipt.

## Scope Locks

- In scope: evidence normalization, selected and declined positions, equations, units, namespaces, welfare gates, source traceability, and exact drafting instructions for D1, D2, and D3.
- Out of scope: simulator code, 3D assets, engine selection, product pricing, a complete species database, veterinary treatment protocols, current legal-commerce rules, electrical or structural engineering approval, and claims that game outcomes predict real animal outcomes.
- The accepted upstream packets are the only research inputs for RAQ-A0. No new broad source search is authorized or used.

## Consolidated Position

The future simulation should be a mass-conserving, spatially resolved aquarium system with three explicit rule domains: shared physical principles, marine reef, and freshwater. Marine and freshwater species, chemistry targets, source-water treatment, biological seed material, lighting biology, equipment compatibility, and consumables remain separate. Only genuinely shared physics and abstract process families may be reused.

Progression must follow demonstrated system state rather than a calendar. The player plans around adult inhabitants, commissions safe hardware, prepares mode-correct water, establishes a fishless biofilter, proves processing capacity, manages a contingent maturation period, quarantines and introduces eligible livestock, feeds and maintains the system, responds to growth and breeding, upgrades measured bottlenecks, and diagnoses incidents from visible cues plus measurements. Welfare-critical incompatibilities are hard gates. Equipment can improve capacity, control, observability, labor, efficiency, and redundancy, but cannot override animal requirements or conservation laws.

## Evidence and Classification Contract

Downstream artifacts must preserve these six classes without promotion:

| Code | Required label | Meaning |
|---|---|---|
| `EBF` | Evidence-backed fact or range | A mechanism, observation, or scoped range supported by accepted evidence. Scope and provenance remain visible. |
| `HC` | Husbandry convention | A professional or common practice that is useful as guidance but is not a universal biological law. |
| `DE` | Derived equation | A transparent calculation from stated assumptions. Inputs, units, and limitations remain visible. |
| `DI` | Design inference | A simulation architecture or rule derived from accepted evidence but not itself validated as an animal-outcome standard. |
| `TBV` | Tunable balance value | A value chosen for pacing, difficulty, economy, numerical stability, or interface assistance. It is not husbandry evidence. |
| `EWC` | Ethical or welfare constraint | A hard restriction required to avoid normalizing predictable harm or unsupported real-world claims. |

Facility profiles, named product behavior, and species-group care envelopes are `EBF` only for what the source reports. Their use as a default, hint, or catalog seed is respectively `HC`, `DI`, or `TBV`. They never become universal safe limits.

## Namespace Contract

### `shared_physics`

Allowed shared modules are geometry and displacement, water and solute mass ledgers, heat transfer, gas exchange, evaporation, plumbing and pump hydraulics, overflow and drain-down, local flow representation, particle transport, sensor observation and failure, and abstract nitrogen transformation capacity. Shared code does not imply shared parameter values. Claims: `SP-001`, `SP-002`, `SP-003`, `SP-004`, `SP-005`, `SP-006`, `SP-007`, `SP-008`, `SP-009`.

### `marine_reef`

Marine-only state includes artificial seawater composition, the conservative reference-composition salt-equivalent mass `m_salt_eq`, its derived `S_eq` state, separately declared salinity forms and instrument conventions, saltwater water changes, reef RO/DI ATO, marine foam fractionation, marine live rock and sand provenance, coral and marine livestock catalogs, coral PPFD and spectral response, coral polyps, reef calcification chemistry, and marine compatibility. Claims: `MR-001`, `MR-002`, `MR-003`, `MR-004`, `MR-005`, `MR-006`, `MR-007`, `MR-008`, `MR-009`, `MR-010`, `MR-011`, `MR-012`, `ORG-001`, `ORG-002`, `ORG-003`.

### `freshwater`

Freshwater-only state includes source-water disinfectant, dechlorination, GH, KH or alkalinity, conductivity or TDS, mineralization, plants, freshwater substrates and hardscape chemistry, freshwater organism and microfauna catalogs, freshwater flow and lighting profiles, and freshwater top-off composition. Claims: `FW-001`, `FW-002`, `FW-003`, `FW-004`, `FW-005`, `FW-006`, `FW-007`, `FW-008`, `FW-009`, `FW-010`.

### Hard no-leak boundaries

1. A `water_namespace` mismatch blocks purchase, transfer, placement, and shared-water connection. Brackish or migratory life stages require a separately declared profile. `ORG-007`, `FW-009`.
2. Marine salinity, SG, reef alkalinity, reef calcium or magnesium dosing, salt mix, coral PAR bands, coral polyps, marine live rock, marine live sand, reef-safe labels, and marine biofilter seed do not exist in strict freshwater mode. `FW-009`.
3. Freshwater chlorine or chloramine treatment, GH and KH targets, freshwater plant controls, and freshwater species envelopes do not substitute for marine water preparation or reef chemistry. `FW-001`, `FW-002`, `MR-002`.
4. Shared equipment class names do not share media, setpoints, sensing principles, biological effects, or compatibility. A conductivity-dependent marine ATO sensor is blocked in freshwater. Marine protein-skimmer benefit is disabled by default in freshwater. `SP-008`, `GP-004`.
5. Marine and freshwater microbial communities and inocula are not interchangeable. `MR-004`, `FW-003`, `FW-009`.

## Chosen Positions

### Shared physical and process positions

| Claim | Class | Selected position | Downstream owner |
|---|---|---|---|
| `SP-001` | `EBF`, `DE` | Use actual operating water volume after headspace, rock, substrate, equipment, sump, and plumbing displacement. UI gallons are derived from an SI internal state. | D1, D2 |
| `SP-002` | `EBF`, `DE`, `DI` | Store actual pump duty-point flow. Keep filtration-loop turnover, nominal display circulation, local velocity or shear, and true water replacement as four distinct quantities. | D1, D2 |
| `SP-003` | `DE`, `DI` | Couple temperature to heater, pumps, light, room exchange, chiller, and evaporative heat loss. Couple oxygen and carbon dioxide to gas transfer, photosynthesis, respiration, nitrification, and decomposition. | D2 |
| `SP-004` | `EBF`, `DE` | Evaporation removes H2O. It does not remove ordinary dissolved salt or conservative solute. Concentration rises as water mass falls. Splash, skimming, leaks, sampling, and water removal are separate fluxes. | D1, D2 |
| `SP-005` | `DE`, `EWC` | Top-off restores evaporated water. A water change removes and replaces water plus carried material. Dosing adds named solutes. These are separate verbs and ledger operations. | D1, D2, D3 |
| `SP-006` | `EBF`, `DI`, `EWC` | Replace a binary `cycled` flag with ammonia-oxidation and nitrite-oxidation capacity under oxygen, alkalinity, temperature, pH, flow, surface, and load constraints. Use an animal-free defined challenge as readiness evidence. | D1, D2, D3 |
| `SP-007` | `DI` | Store true state separately from sensor readings, calibration, resolution, bias, noise, fouling, response lag, and detection limit. One precise reading is not perfect knowledge. | D2, D3 |
| `SP-008` | `EBF`, `DI` | Equipment has a mechanism, actual-condition capacity, maintenance state, observable outputs, compatible namespace, and explicit failure modes. Nameplate maxima and price do not determine delivered performance. | D2, D3 |
| `SP-009` | `DE`, `TBV` | Use bounded mass and energy integration with event handling for thresholds, pump dry states, siphons, blockage, and overflow. Numerical step sizes and tolerances are tunable, but unexplained mass drift is not. | D2 |

### Marine reef positions

| Claim | Class | Selected position | Downstream owner |
|---|---|---|---|
| `MR-001` | `EBF`, `DI`, `EWC` | Size marine systems from intended habitat and adult organisms. Volume buffers change, while footprint, depth, unobstructed route, territory, substrate, and aquascape geometry remain independent constraints. | D1, D2 |
| `MR-002` | `EBF`, `HC`, `EWC` | Prepare artificial seawater from suitable purified freshwater and a formulated marine salt mix, with measured mixing and equilibration. Normal reef ATO uses unsalted purified freshwater, normally RO/DI, only to replace evaporated H2O. | D1, D2, D3 |
| `MR-003` | `EBF`, `DI`, `EWC` | Cycle without animals, prove nitrogen-processing capacity, stock gradually, and treat elapsed weeks only as context. | D1, D2, D3 |
| `MR-004` | `EBF`, `DI` | Live rock can add biofilms and hitchhikers, shipped rock can add die-off, and dry or manufactured rock begins mainly as structure and future surface. No rock-mass-per-gallon rule is selected. | D1, D2 |
| `MR-005` | `EBF`, `DI` | Sand and bare bottom are habitat and maintenance choices. Track grain, depth, detritus, oxygen gradient, bioturbation, animal need, and local flow. No universal sand depth is selected. | D1, D2 |
| `MR-006` | `EBF`, `DI` | Model the ugly phase as contingent competition among bacterial films, diatoms, green algae, cyanobacteria, dinoflagellate-like taxa, and calcifying crusts. Do not force a fixed sequence or a mature-on-day-X state. | D1, D2, D3 |
| `MR-007` | `EBF`, `DI` | Cyanobacterial mat risk is multicausal. Organic loading, phosphorus and iron availability, light, temperature, local deposition, and low-oxygen sediment interfaces can interact. Low local flow is an indirect modifier, not a sole cause. | D1, D2, D3 |
| `MR-008` | `EBF`, `DI` | Low measured nitrate or phosphate can coexist with rapid biological uptake. Both excess and extreme nutrient limitation can be harmful. Use nonlinear, provenance-specific response profiles, not a universal zero target. | D1, D2 |
| `MR-009` | `EBF`, `DI` | Store local PPFD over 400 to 700 nm, spectral bands, photoperiod, DLI, orientation, shading, turbidity, and acclimation history. Coral response is species, provenance, symbiont, morphology, and endpoint specific. No numeric soft, LPS, or SPS band is selected. | D1, D2 |
| `MR-010` | `EBF`, `DI` | Use local flow and turbulence or shear at each organism and substrate cell. Return turnover and nominal circulation do not determine coral exposure. | D1, D2 |
| `MR-011` | `EBF`, `DI` | Use named NOAA experimental, Steinhart exhibit, and NOAA Ocean Service natural-context profiles as separate references with provenance. Do not merge them into a universal reef range. The base artificial-mix salt ledger is `S_eq`, not `S_A`, `S_P`, or `SG`. | D1, D2 |
| `MR-012` | `DI`, `EWC` | Diagnose before high-impact intervention. Verify measurements and identity, protect organisms, remove proximate load, restore failed processes, correct gradually, and confirm recovery by trend and function. | D1, D3 |

### Freshwater positions

| Claim | Class | Selected position | Downstream owner |
|---|---|---|---|
| `FW-001` | `EBF`, `EWC` | Characterize source water and neutralize the disinfectant actually present. Standing water is not a chloramine treatment. Validate total chlorine at 0 mg/L before exposure. | D1, D2, D3 |
| `FW-002` | `EBF`, `DI` | Use a biotope or species profile for temperature, pH, GH, KH or alkalinity, TAN and calculated NH3, nitrite, nitrate, DO, conductivity or TDS, light, flow, and source-water composition. No universal freshwater target exists. | D1, D2 |
| `FW-003` | `EBF`, `DI`, `EWC` | Use fishless, state-based commissioning. Freshwater and marine biofilter communities and seed media remain separate. | D1, D2, D3 |
| `FW-004` | `EBF`, `DE`, `DI` | Freshwater evaporation concentrates conservative solutes. Freshwater ATO adds freshwater without marine salt, with reservoir composition matched to the mineral plan. Top-off does not export nitrate, organics, hardness, or conductivity. | D1, D2, D3 |
| `FW-005` | `EBF`, `DI` | Substrate, plants, wood, and rock affect animal behavior, rooting, detritus, habitat, light, chemistry, and stability. Calcareous material is a characterized hardwater-biotope option, not a freshwater default. | D1, D2 |
| `FW-006` | `EBF`, `DI` | Treat freshwater biofilm, algae, diatoms, and cyanobacteria as contingent populations. Cyanobacterial appearance cannot establish toxicity, and sudden biomass death can worsen oxygen loss. | D1, D2, D3 |
| `FW-007` | `EBF`, `DI`, `EWC` | Freshwater compatibility requires chemistry overlap plus adult geometry, current, social structure, territory, substrate, feeding, plant or invertebrate safety, and directional predation checks. | D1, D2, D3 |
| `FW-008` | `EBF`, `DI` | Model plants as nutrient uptake and biomass storage. Export occurs when biomass is removed. Plants do not automatically replace filtration or water changes. | D1, D2, D3 |
| `FW-009` | `EWC` | Enforce the hard no-leak contract. Brackish common-name traps are excluded or placed in an explicit third namespace. | D1, D2, D3 |
| `FW-010` | `EBF`, `DI` | Diagnose common failures through coupled state: new-tank ammonia or nitrite, old-tank alkalinity and pH decline, hypoxia, disinfectant exposure, temperature or filter failure, ATO drift, organic overload, cyanobacteria, CO2 overdose, copper, aggression, and predation. | D1, D3 |

### Organisms, polyps, microfauna, and welfare positions

| Claim | Class | Selected position | Downstream owner |
|---|---|---|---|
| `ORG-001` | `EBF`, `DI` | A coral polyp is a living local unit connected within a colony. Use concurrent structural, extension, feeding, symbiosis, energy, calcification, stress, competition, reproduction, and disease-observation layers. | D1, D2 |
| `ORG-002` | `EBF`, `DI` | Polyp behavior and outcome respond to local light and history, spectrum, flow, food encounter, oxygen, temperature, salinity, carbonate chemistry, sediment, neighbors, injury, and disease risk. No single extension or color state is a health score. | D1, D2, D3 |
| `ORG-003` | `EBF`, `DI` | Keep budding, fragmentation, brooding, and broadcast spawning distinct. Sexual reproduction requires species-specific maturity, cues, compatible reproductive type, fertilization, settlement, and juvenile capacity. | D1, D2, D3 |
| `ORG-004` | `EBF`, `DI` | Represent copepods, amphipods, isopods, worms, gastropods, small crustaceans, plankton, and larvae as marine or freshwater species or guild records with grazing, scavenging, deposit, filter, predator, parasite, prey, and habitat-engineering roles. | D1, D2 |
| `ORG-005` | `EBF`, `DI` | Microfauna populations grow or crash through reproduction, immigration, food, refuge, density, predation, chemistry, treatments, filtration export, siphoning, harvesting, and life-stage transitions. Cleanup converts matter; it does not delete it. | D1, D2, D3 |
| `ORG-006` | `DI`, `EWC` | Carrying capacity is the first limiting metabolic, spatial, social, trophic, sessile-space, or reproductive capacity. Filter upgrades cannot waive a different limiting dimension. | D1, D2, D3 |
| `ORG-007` | `EBF`, `EWC` | Hard eligibility gates precede soft scoring: water namespace and life stage, temperature, adult geometry and growth, normal movement, required social structure, required substrate or habitat, adequate life support, and a defensible absence of unavoidable predation or severe harm. | D1, D2, D3 |
| `ORG-008` | `EBF`, `DI` | After hard gates pass, directional soft modifiers may represent territorial pressure, feeding competition, coral nipping, invertebrate predation risk, breeding aggression, neighbor reach, refuge, and observed individual behavior. Unknown evidence remains unknown, not compatible. | D1, D2, D3 |
| `ORG-009` | `EBF`, `EWC` | A shark entry requires curated adult size, enclosure geometry, unobstructed run or benthic use, swimming and ventilation mode, substrate, diet, prey profile, life-support load, and handling risk. Gallons, juvenile size, player level, or filtration cannot authorize it alone. A shark and clownfish pair is hard incompatible only when the shark's curated prey profile makes that fish a defensible prey match; otherwise it is conditional or unknown, never automatically safe. | D1, D2, D3 |
| `ORG-010` | `EBF`, `DI` | Feeding is individual, species-specific intake plus uneaten material, metabolism, oxygen demand, and nutrient load. Cleanup animals need their own food budget. | D1, D2, D3 |
| `ORG-011` | `EBF`, `EWC` | Observable signs generate a syndrome description and differential causes, not a visual-only pathogen diagnosis. Medication requires a curated diagnosis, organism tolerance, and treatment context. | D1, D3 |
| `ORG-012` | `HC`, `DI`, `EWC` | Quarantine is a separate epidemiological system with appropriate water, mature filtration, shelter, light or flow, tools, feeding, monitoring, and cohort separation. Named 30-day practices remain context-specific and do not guarantee pathogen exclusion. | D1, D2, D3 |
| `ORG-013` | `EBF`, `DI`, `EWC` | Breeding requires maturity, condition, reproductive compatibility, cues, nest or spawning habitat, gamete or egg survival, first food, larval environment, and humane grow-out capacity. It is not a random reward roll. | D1, D2, D3 |
| `ORG-014` | `EWC` | Do not reward animal-in cycling, routine predator-prey feeding, starvation cleanup, illegal or unverifiable stock, environmental release, blind medication, or offspring without capacity. Do not claim that simulated success validates real-world care. | D1, D3 |

### Gameplay and equipment positions

| Claim | Class | Selected position | Downstream owner |
|---|---|---|---|
| `GP-001` | `DI`, `EWC` | Use the 14-stage lifecycle: mode and plan, site and leak test, prepare water and habitat, fishless cycle, contingent maturation, stability proof, quarantine, gradual introduction, feeding, maintenance, growth review, breeding, evidence-led upgrade, and incident recovery. | D3, summarized in D1 |
| `GP-002` | `DI` | Every mechanic exposes action, immediate physical state, delayed biological state, glance cue, instrument cue, confirmatory action, bounded correction, and recovery evidence. | D3 |
| `GP-003` | `EBF`, `DI` | Compare equipment by actual-condition capacity, spatial coverage, control, observability, maintenance, safety, energy, heat, water use, noise, footprint, compatibility, and failure modes. | D2, D3 |
| `GP-004` | `EBF`, `DI`, `EWC` | Equipment, stores, tests, media, consumables, and fluid actions are namespace-aware. Shared hardware may have different sensing or biological behavior by mode. | D2, D3 |
| `GP-005` | `DI`, `TBV`, `EWC` | Upgrades relieve a measured bottleneck or improve control, labor, observability, efficiency, serviceability, or redundancy. Essential humane life support is available from the start. Prestige and brand-only bonuses are dropped. | D3 |
| `GP-006` | `EBF`, `DI` | Incidents arise from explicit causal chains and include fair warnings, discriminating checks, bounded recovery, and verification. Include ATO, heater, pump, drain, outage, skimmer, light, RO/DI, dosing, probe, biofilter, overfeeding, and pathogen events. | D2, D3 |
| `GP-007` | `TBV`, `EWC` | Difficulty may change information, uncertainty, time pressure, wear, fault frequency, economy, and procedural detail. It never disables adult-space, cross-salinity, cycling, or unavoidable predation gates. | D3 |
| `GP-008` | `TBV`, `EWC` | Prices, rewards, resale, failure probabilities, task timers, and operating-cost multipliers remain tunable. No price or brand ranking is evidence-backed in the accepted packet. | D3 |
| `GP-009` | `EWC` | The package and game must state that simulation outcomes do not replace real husbandry, veterinary diagnosis, structural review, electrical safety, or current legal controls. | D1, D3 |

## Selected and Declined Numeric Positions

The table below is the complete baseline disposition for values that downstream authors are most likely to misuse. Every number maps to the source matrix. A `selected profile` is selectable only at its stated provenance, not a universal safe band.

| Parameter | Classification | Disposition | Exact downstream rule | Claim and source mapping |
|---|---|---|---|---|
| `1 US gal = 3.785411784 L` | `EBF` | Selected conversion | Store SI internally and convert exactly at the UI boundary. | `SP-001`, `SRC-001` |
| Rectangular volume and displacement | `DE` | Selected equation | Use internal dimensions and actual water height, then subtract displacement and add circulating sump or plumbing volume. | `SP-001`, `SRC-001` |
| Marine salinity | `EBF` scoped profiles, `DE` base ledger | No universal selection | Preserve Steinhart `33 to 36 ppt` and NOAA experimental `35` as named source-reported profiles. The base conservative state is `S_eq`, the reference-composition salt-equivalent mass fraction in `g kg^-1`. Do not identify any profile value or `S_eq` with `S_A`, `S_P`, or `SG`. | `SP-004`, `MR-011`, `SRC-003`, `SRC-019`, `SRC-002` |
| Marine temperature | `EBF` scoped profiles | No universal selection | Preserve Steinhart `24 to 26 C`, NOAA experimental `24.5 to 28 C`, and the NOAA Ocean Service broad natural reef-building coral context of roughly `23 to 29 deg C` only at their source scopes. The last range is not an aquarium setpoint or every-coral tolerance. Species and provenance select the operating curve. | `MR-011`, `MR-009`, `SRC-003`, `SRC-019`, `SRC-090` |
| Marine pH | `EBF` scoped profiles | No universal selection | Preserve Steinhart `8.0 to 8.4` and NOAA experimental `8.1 to 8.3` as separate profiles. | `MR-011`, `SRC-003`, `SRC-019` |
| Marine alkalinity | `EBF` scoped profiles | No universal selection | Preserve Steinhart `3.0 to 3.5 mEq/L` and NOAA `8 to 10 dKH`; show `1 mEq/L = 2.8 dKH = 50 mg/L as CaCO3` only with the NOAA mapping. | `MR-011`, `SRC-003`, `SRC-019` |
| Marine calcium | `EBF` scoped profiles | No universal selection | Preserve Steinhart `400 to 460 mg/L` and NOAA `380 to 450 mg/L`. | `MR-011`, `SRC-003`, `SRC-019` |
| Marine magnesium | `EBF` scoped profiles | No universal selection | Preserve Steinhart `1300 to 1400 mg/L` and NOAA `1250 to 1350 mg/L`. | `MR-011`, `SRC-003`, `SRC-019` |
| Marine nitrate and phosphate | `EBF` scoped profiles | Conflict retained | NOAA experimental nitrate below `0.2 ppm` and phosphate below `0.03 ppm` conflict in scope with Steinhart nitrate below `10 mg/L as NO3-` and phosphate below `0.15 mg/L as PO4`. Do not average or call either universally safe. | `MR-008`, `MR-011`, `SRC-003`, `SRC-019`, `SRC-030`, `SRC-031` |
| Marine flow | `HC` | Universal target declined | NOAA's `10 tank volumes/h` remains a rule of thumb. Species, geometry, delivered flow, and local velocity decide placement. | `MR-010`, `SRC-003`, `SRC-007` |
| Coral PPFD and photoperiod | `EBF` scoped profile, `HC` nonnumeric hints | Universal target declined | NOAA `100 to 200 umol photons m^-2 s^-1` for `10 to 12 h` and about `50` for new-coral quarantine remain one institutional example. No numeric soft, LPS, or SPS band is selected. Generic coral-class labels may appear only as low-authority nonnumeric placement hints and never as realistic-mode biology. | `MR-009`, `SRC-003` |
| Coral acclimation time | `EBF` experimental anchors | Universal ramp declined | The observed `3 to 5 days` for *Pachyseris speciosa* and slower than `20 days` for *Acropora millepora* remain named experimental anchors, not generic ramps. | `MR-009`, `SRC-013` |
| Reef ATO safeguards | `EBF` product-specific | Universal thresholds declined | TUNZE `10 minute` cutoff and Red Sea `3 mm` control band with backup probes about `2.5 cm` above cutoff remain product examples. Safety architecture is selected, numbers come from equipment profiles. | `SP-008`, `GP-006`, `SRC-017`, `SRC-018` |
| Freshwater cycle time | `EBF` observed envelope | Calendar unlock declined | Keep roughly `3 to 8 weeks` as observed or extension context, plus institutional examples around 30 days and up to 8 weeks. Commissioning requires a functional challenge. | `FW-003`, `SP-006`, `SRC-032`, `SRC-033`, `SRC-021`, `SRC-022` |
| Freshwater cycling input | `HC` scoped method | Universal dose declined | UF/IFAS `2 to 3 mg/L TAN` remains one recirculating-system method, not a universal home protocol. | `FW-003`, `SRC-034` |
| Freshwater temperature, pH, GH, KH | `EBF` group examples | Universal range declined | Store catalog examples separately: goldfish `4 to 25 C`; livebearers `20 to 28 C`, pH `7.0 to 8.0`, GH `8 to 18 dGH`, KH `5 to 15 dKH`; discus `26 to 30 C`, pH `6.0 to 7.5`, GH `4 to 12 dGH`; Malawi cichlids `23 to 27 C`, pH `8.0 to 8.6`, GH `12 to 18 dGH`, KH `10 to 15 dKH`. | `FW-002`, `SRC-041`, `SRC-042`, `SRC-043`, `SRC-044` |
| Freshwater example tank sizes | `HC` species-group envelopes | Universal formula declined | Keep examples as provenance-tagged catalog seeds: small guppy group `45 L`, sailfin mollies `80 L`, six adult discus about `300 L` and `50 L/adult` planning guide, Malawi community `200 L`, many tankbusters over `500 L`, small shrimp or snail groups `10 L`, larger groups about `20 L`. Adult geometry and behavior remain hard gates. | `MR-001`, `FW-007`, `ORG-007`, `SRC-041`, `SRC-043`, `SRC-044`, `SRC-045`, `SRC-083` |
| Freshwater disinfectant | `EBF`, `EWC` | Selected screening value | Free and total chlorine must be `0 mg/L` before exposure. | `FW-001`, `SRC-036`, `SRC-037` |
| Freshwater dissolved oxygen | `EBF` broad screening | No universal species limit | More than `5 mg/L` is a broad Merck reference and less than `5 mg/L` a danger flag. Species, temperature, saturation, and exposure set welfare response. | `FW-002`, `FW-010`, `SRC-035` |
| Freshwater ammonia | `EBF` broad screening | Selected zero target, qualified toxicity | Healthy-system TAN or ammonia target is `0 mg/L`; about `0.05 mg/L` un-ionized ammonia is a broad tissue-damage concern with species and context dependence. Always calculate NH3 from TAN, pH, and temperature with explicit units. | `FW-002`, `SRC-034` |
| Freshwater nitrite and nitrate | `EBF` broad screening | Selected zero nitrite target, nitrate profile required | Nitrite target is `0 mg/L`; about `0.10 mg/L` is a concern for some fish. Merck nitrate below `20 mg/L` remains a broad reference, not a biotope target. | `FW-002`, `SRC-035` |
| Freshwater alkalinity | `EBF` engineering envelope | Universal target declined | UF/IFAS below `20 mg/L as CaCO3` concern and `100 to 180 mg/L` robust recirculating-biofilter guidance remain engineering anchors that may conflict with low-alkalinity species profiles. | `FW-002`, `SRC-033`, `SRC-034` |
| Freshwater planted photoperiod | `HC` | Default hint only | OATA `6 to 8 h` start and up to `10 to 12 h` in some ramped systems remain planted-mode guidance, not coral or universal plant biology. | `FW-002`, `FW-008`, `SRC-046` |
| Freshwater water changes | `HC` | Universal schedule declined | OATA up to `25%` weekly and discus `50%` weekly remain context-specific conventions. Calculate need from load, chemistry, and species. | `FW-004`, `SRC-043`, `SRC-085` |
| Fish quarantine | `HC`, `EWC` | Isolation selected, universal duration declined | Merck minimum `30 days` remains veterinary guidance, not proof that every pathogen is excluded. Coral nursery `30 days` remains a restoration protocol. | `ORG-012`, `SRC-021`, `SRC-067` |
| Numerical substep | `TBV` | Tunable baseline | `1 to 60 s` may be used only with flux bounds and exact event splitting. It is an engineering starting range, not biological evidence. | `SP-009` |

## Derived Equation Set

These equations are selected for D2. They are idealized and must carry their assumptions.

| Equation ID | Class | Selected equation or invariant | Claim mapping |
|---|---|---|---|
| `EQ-VOLUME` | `DE` | `V_net = L_internal * W_internal * h_water - V_displacement`; `V_sys = V_display_net + sum(V_sump_operating) + V_plumbing + V_reactors` | `SP-001` |
| `EQ-FLOW` | `DE` | `N_filter = Q_return_actual / V_sys`; `N_circ = sum(Q_powerhead_actual) / V_display_net`; neither yields `u(x,t)` | `SP-002` |
| `EQ-HEAT` | `DE` | `C_sys*dT/dt = P_heater*eta + P_pumps + P_light - UA*(T-T_air) - dot_m_e*L_v - Q_chiller` | `SP-003` |
| `EQ-GAS` | `DE` | `dC_O2/dt = k_La*(C_star(T,S,p)-C_O2) + photosynthesis - respiration - oxidation_demand` | `SP-003` |
| `EQ-EVAP` | `DE` | `dot_m_e = k_e*A_effective*(p_sat(T_water)-RH*p_sat(T_air))`; calibrate `k_e` by installation | `SP-004` |
| `EQ-SALT` | `DE` | Base artificial-mix ledger: `S_eq = 1000 * m_salt_eq / m_solution`, where `S_eq` is the reference-composition salt-equivalent mass fraction in `g kg^-1` under the declared idealized reference-composition assumption. Pure evaporation changes water mass but not `m_salt_eq`; exact purified-freshwater ATO restores water mass. The base ledger does not derive `S_A`. | `SP-004`, `MR-002`, `MR-011` |
| `EQ-WC` | `DE` | `m_s,new = (1-f)*m_s,old + (S_rep/1000)*m_rep`; equal-mass simplification `S_new = (1-f)*S_old + f*S_rep` | `SP-005` |
| `EQ-DLI` | `DE` | `DLI(x) = 10^-6 * integral(E_PAR(x,t) dt)` | `MR-009` |
| `EQ-DRAIN` | `DE` | `V_drainback = A_display*Delta_h + V_return_plumbing + V_device`; require sump freeboard at least drainback plus explicit uncertainty margin | `SP-008`, `GP-006` |
| `EQ-MICRO` | `DI` | Next abundance equals survivors plus reproduction and immigration, minus predation, starvation, density stress, environmental or treatment mortality, filtration or siphon export, and harvest | `ORG-005` |

## Welfare and Compatibility Decision Order

### Hard gates

Apply in this order. Any failure returns `hard_incompatible` or `unavailable` before soft scoring.

1. Declared water namespace and any explicit life-stage salinity transition.
2. Temperature and core chemistry overlap for the applicable life stage.
3. Expected adult size, body shape, growth trajectory, turn radius, usable footprint, depth, and unobstructed route.
4. Normal swimming, resting, burrowing, clinging, schooling, diel, and escape behavior.
5. Required social group, pair, harem, sex ratio, hierarchy, and conspecific constraints.
6. Required substrate, cover, cave, host, plant, attachment, nesting, or spawning habitat.
7. Directional predation, severe aggression, venom, stinging, toxin, unavoidable feeding exclusion, and coral or invertebrate predation.
8. Oxygen, waste, feed, biological filtration, temperature-control, and redundancy capacity at the expected load.
9. Quarantine or source protocol, treatment compatibility, and biosecurity separation.
10. Legal, collection, trade, provenance, invasive-species, and release restrictions when current control sources are available.

Claims: `ORG-006`, `ORG-007`, `ORG-009`, `ORG-012`, `ORG-014`.

### Directional soft modifiers

Only after hard gates pass, score monitored and changeable risks: territory overlap, visual barriers, refuge, current preference, feeding zone and time, resource competition, fin nipping, coral nipping, bulldozing, aggression reach, breeding state, hunger, individual history, juvenile risk, microfauna predation, and future growth. Compatibility is directional and time-dependent. `compatible_at_declared_scope` is not a permanent guarantee. Claim: `ORG-008`.

### Shark and predator-prey rule

No generic shark record exists. An unavailable shark cannot be purchased until adult geometry, swimming or resting mode, ventilation, prey profile, diet, substrate, handling, and life-support load are curated. Tank volume is contextual evidence only. Clownfish compatibility is evaluated against the selected shark record. Chemistry overlap never authorizes the pair. A documented prey match is a hard block. An undocumented or avoidable risk remains conditional or unknown, not guaranteed safe and not a claim that every shark kills every clownfish. Claim: `ORG-009`.

## Coral Polyp and Colony Contract

D2 must model a colony as connected local modules. A polyp may be extended, feeding, energy-limited, calcifying, injured, and competing at the same time. The required layers are:

1. structural tissue and skeleton state;
2. extension and retraction state;
3. prey encounter, capture, handling, digestion, rejection, and satiation;
4. symbiont type, density, pigment, performance, and translocation;
5. photosynthetic, heterotrophic, respiratory, mucus, repair, and reserve energy flows;
6. calcification, maintenance, and dissolution risk;
7. acclimation, chronic stress, and acute distress;
8. directional competition by contact, overgrowth, shading, chemical exposure, filaments, or sweepers;
9. reproductive maturity, gametogenesis, brooding or broadcasting, budding, fragmentation, and post-event cost;
10. gross disease observation without automatic etiologic diagnosis.

Every layer consumes local light, spectrum, DLI, flow, food, oxygen, temperature, salinity, carbonate chemistry, sediment, neighbor, injury, and history. Colony-level resource sharing may buffer a local module but must not erase local damage. Claims: `ORG-001`, `ORG-002`, `ORG-003`, `MR-009`, `MR-010`.

## Microfauna Contract

Marine and freshwater guilds use separate catalogs. Each taxon or functional record identifies feeding mode, resource, refuge, substrate, salinity or hardness, temperature, life stage, reproduction, predation, parasitism, filtration susceptibility, and export pathways. Required families include copepods, amphipods and isopods, worms, snails and other gastropods, small crustaceans, plankton, protozoa or rotifers where appropriate, eggs, and larvae.

No `cleanup_power` deletes matter. Grazing, scavenging, filtering, or deposit feeding moves material into respiration, excretion, growth, reproduction, detritus, or predation. Only an explicit export removes mass. Unknown hitchhikers progress through `unknown_taxon`, `known_low_risk`, `conditional_nuisance`, `documented_predator_or_parasite`, or `biosecurity_restricted`. Claims: `ORG-004`, `ORG-005`.

## Issue and Conflict Disposition Log

| ID | Conflict or issue | Disposition | Status |
|---|---|---|---|
| `C-001` | NOAA experimental and Steinhart exhibit reef nutrient profiles differ greatly. | Retain as separate provenance-tagged profiles. No averaging and no universal reef range. | Closed by scoped selection |
| `C-002` | NOAA institutional, commercial coral-class, and species experiments give different light guidance. | Use species and provenance profiles in realistic mode. NOAA remains an institutional profile. The commercial numeric class bands fail the corroboration floor and are removed. Generic class grouping may be retained only as a low-authority nonnumeric hint. | Closed by hierarchy and scope |
| `C-003` | Salt-equivalent state, Absolute Salinity, Practical Salinity, and SG are commonly treated as interchangeable. | Use `S_eq` for the idealized artificial-mix conservative ledger. Reserve `S_A` for a TEOS-10 profile satisfying its declared composition and thermodynamic convention. Keep `S_P` and temperature/reference-specific `SG` as separate observations. | Closed |
| `C-004` | Marine and freshwater cycle timing sources report about 3 weeks to 8 weeks, with around 30 days also common. | Use a functional challenge gate. Times are context envelopes, never countdown unlocks. | Closed |
| `C-005` | RSPCA standing-water advice for chlorine conflicts with EPA chloramine chemistry. | EPA controls for chloramine. Require disinfectant-specific treatment and total chlorine at 0 mg/L. | Closed by authority and applicability |
| `C-006` | Shared physics could invite shared chemistry, microbes, organisms, or settings. | Reuse only declared shared modules. Enforce namespace and equipment-compatibility gates. | Closed |
| `C-007` | Larger volume is sometimes treated as a universal stocking pass. | Volume buffers change but never waives adult geometry, social, habitat, or predation gates. | Closed |
| `C-008` | The user example implies every shark will kill every clownfish. | Preserve the concern without overclaiming. Curated predator-prey evidence decides hard incompatibility; otherwise result is conditional or unknown. | Closed with precise wording |
| `C-009` | Ugly phases are often presented in a fixed diatom, cyanobacteria, dinoflagellate, green algae order. | Use contingent guild competition and inoculation history. No mandatory order. | Closed |
| `C-010` | Cyanobacteria is often reduced to low flow or one nutrient. | Model interacting light, nutrients, organics, temperature, stability, deposition, and low-oxygen microzones. Flow is an indirect modifier. | Closed |
| `C-011` | Equipment documentation supplies precise ATO bands and timeouts. | Preserve them only as product profiles. Select the safeguard architecture, not universal product numbers. | Closed |
| `C-012` | ATO reservoirs are sometimes used for supplements. | Baseline reef ATO is pure RO/DI. Any additive creates an explicit coupled dosing subsystem. | Closed |
| `C-013` | Cleanup crews are commonly treated as nutrient deletion. | Model consumption and recycling. Require food and explicit export. | Closed |
| `C-014` | Visual fish or coral signs are commonly treated as diagnoses. | Signs produce observations and differential hypotheses. Stronger diagnoses require corresponding evidence. | Closed |
| `C-015` | Water-change percentages vary by species and system. | No universal schedule. Preserve named conventions and calculate need from trends and profile. | Closed |
| `C-016` | Coral and fish quarantine sources both mention 30 days. | Select isolation principles, not a universal shared duration. Keep organism and protocol context separate. | Closed |

## Dropped Positions

- Universal gallons-per-fish, gallons-per-coral, fish-inches-per-volume, rock-mass-per-gallon, sand-depth, flow-turnover, coral PAR, pH, salinity, nutrient, or water-change rules are dropped because accepted evidence is species, habitat, facility, or system specific.
- A binary `cycled` or `mature` flag is dropped because processing capacity and community maturation are continuous and disturbance-sensitive.
- A forced ugly-phase sequence is dropped because succession evidence supports contingency and multiple stable states.
- A universal `reef_safe` or symmetric compatibility boolean is dropped because interactions are directional and life-stage dependent.
- A generic shark template and juvenile-upgrade loophole are dropped on welfare grounds.
- A single coral health bar, polyp-extension score, or bleaching-equals-death rule is dropped.
- Magic cleanup, instant biofilter media, broad cure buttons, and visual-only diagnosis are dropped.
- Equipment rarity, brand prestige, vague professional labels, and unsupported reliability bonuses are dropped.
- Essential life support locked behind progression is dropped.
- A claim that simulation success validates real husbandry is prohibited.

## Known Unknowns and Required Overrides

1. Species-level adult geometry, social, diet, prey, reproductive, and welfare thresholds remain incomplete. Unknown records default to unavailable or conservative review.
2. No universal coral PAR, spectrum, DLI, flow, neighbor spacing, temperature, or chemistry curve is established. Species, provenance, symbiont, face orientation, history, and endpoint overrides are required.
3. Household evaporation coefficient, gas-transfer coefficient, pump curve, filter capacity, fouling, sensor reliability, and anti-siphon reliability require equipment and installation profiles.
4. Aquarium-specific nuisance dinoflagellate triggers and treatment efficacy remain weak and taxon-specific. Toxin safety needs separate review.
5. Freshwater spans extreme biotopes. Species and source-population profiles are required for chemistry, temperature, current, substrate, plants, and breeding.
6. Brackish and saline-lake systems are outside the two locked namespaces unless added as an explicit third mode.
7. Detailed medication, euthanasia, zoonotic, electrical, structural, building-load, flood, and jurisdictional trade controls require separate current control sources.
8. Microfauna rates, coral growth grammars, wound healing, larval survival, and breeding probabilities require calibration against declared taxa and conditions.
9. Prices, rewards, service times, fault rates, failure distributions, and economy multipliers remain tunable.
10. Artificial salt mixes are not identical to TEOS-10 reference seawater. The base model exposes `S_eq` only under its idealized reference-composition assumption and does not derive `S_A`. Density and `SG` need a declared reference-composition approximation or mix-specific data. A true `S_A` output requires a separately validated TEOS-10 profile.

## Cross-Artifact Terminology and Unit Rules

1. Use `marine reef`, `freshwater`, and, only if explicitly added, `brackish`. Do not use `saltwater` as a species-compatibility shortcut.
2. Use `actual operating water volume`, not marketed tank size, for calculations. Store `m^3`, `L`, `kg`, `s`, `W`, `J`, `deg C`, and named chemical mass units internally. Display US gallons as a conversion.
3. Use salinity terms only with their basis. `S_eq` is the reference-composition salt-equivalent mass fraction in `g kg^-1`, defined as `S_eq = 1000 * m_salt_eq / m_solution` under the declared idealized reference-composition assumption. Reserve `S_A`, Absolute Salinity, for a TEOS-10 profile satisfying its declared composition and thermodynamic convention; the base simulation does not derive `S_A` from the salt-equivalent ledger. `S_P` is dimensionless. `SG` is dimensionless with sample and reference temperature or instrument convention. Do not state an identity among them.
4. Nitrogen variables include basis in the identifier and label: examples are `TAN_mg_N_L`, `NH3_mg_N_L`, `NO2_mg_N_L`, `NO2_mg_L`, `NO3_mg_N_L`, and `NO3_mg_L`. State `as N`, `as ion`, or other basis.
5. Phosphate and alkalinity also require basis, such as `mg/L as PO4`, `mg/L as P`, `mEq/L`, `dKH`, or `mg/L as CaCO3`.
6. Use `PPFD` for the local photon-flux quantity commonly called aquarium PAR, in `umol photons m^-2 s^-1` over 400 to 700 nm. Use `DLI` in `mol photons m^-2 day^-1`. Store spectrum and photoperiod separately.
7. Use `filtration-loop turnover`, `nominal display circulation`, `local velocity or shear`, and `water replacement` as four distinct terms.
8. Use `top-off`, `water change`, `salt correction`, and `dosing` as separate actions.
9. Use `commissioned` for a passed functional cycle challenge. Use `maturing` for continuing ecological development. Do not use age alone as readiness.
10. Use `gross sign`, `syndrome`, `differential`, `morphologic diagnosis`, and `etiologic diagnosis` at the evidence level actually obtained.
11. Use `hard_incompatible`, `conditionally_compatible`, `curated_exception`, `unknown`, and `compatible_at_declared_scope` for compatibility results.
12. Use normal Markdown URLs or exact source-matrix claim IDs for every material factual or numeric statement.

## Exact Downstream Artifact Outlines

### RAQ-D1: `reef_aquarium_research_packet.md`

1. Scope, audience, evidence classes, and simulation-not-husbandry disclaimer: `GP-009`, `ORG-014`.
2. System architecture and namespace separation: `SP-001`, `SP-002`, `SP-003`, `SP-004`, `SP-005`, `SP-006`, `SP-007`, `SP-008`, `SP-009`, `MR-001`, `FW-009`.
3. Reef setup sequence and purpose-driven tank sizing: `MR-001`, `MR-002`, `MR-003`, `MR-004`, `MR-005`, `ORG-007`.
4. Freshwater setup sequence, source water, and biotope sizing: `FW-001`, `FW-002`, `FW-003`, `FW-004`, `FW-005`, `FW-007`.
5. Filtration, flow, oxygen, temperature, and system capacity: `SP-002`, `SP-003`, `SP-006`, `MR-010`, `FW-002`.
6. Fishless cycling, commissioning, maturation, and ugly phases: `SP-006`, `MR-003`, `MR-006`, `MR-007`, `FW-003`, `FW-006`.
7. Marine chemistry, salinity, nutrient balance, PAR, and profile provenance: `MR-002`, `MR-008`, `MR-009`, `MR-011`.
8. Freshwater chemistry, source treatment, plants, evaporation, and maintenance: `FW-001`, `FW-002`, `FW-004`, `FW-008`.
9. Evaporation and ATO explainer, with water-change and dosing separation: `SP-004`, `SP-005`, `MR-002`, `FW-004`.
10. Coral polyps, colony function, growth, and reproduction: `ORG-001`, `ORG-002`, `ORG-003`.
11. Microfauna and micro-invertebrate guilds and population logic: `ORG-004`, `ORG-005`.
12. Livestock compatibility, sharks, feeding, health, breeding, and carrying capacity: `ORG-006`, `ORG-007`, `ORG-008`, `ORG-009`, `ORG-010`, `ORG-011`, `ORG-012`, `ORG-013`, `ORG-014`.
13. Equipment and upgrade principles: `SP-008`, `GP-003`, `GP-004`, `GP-005`, `GP-006`.
14. Common incidents, diagnosis, and recovery: `MR-012`, `FW-010`, `GP-002`, `GP-006`.
15. Limitations, known unknowns, and current-control-source needs.

### RAQ-D2: `simulation_parameter_model.md`

1. Data-model conventions, namespaces, evidence classes, units, and provenance fields.
2. Compartment geometry, displacement, water, solute, salt, and energy ledgers: `SP-001`, `SP-003`, `SP-004`, `SP-005`.
3. Pump, plumbing, turnover, local flow, mixing, filtration, gas, heat, overflow, and drain events: `SP-002`, `SP-003`, `SP-008`, `SP-009`.
4. Nitrogen, organics, oxygen, alkalinity, nutrient, detritus, and microbial capacity states: `SP-006`, `MR-008`, `FW-002`, `FW-003`.
5. Marine salinity, ATO state machine, saltwater change, correction, and dosing: `MR-002`, `MR-011`, `GP-006`.
6. Freshwater source water, GH, KH, disinfectant, plants, top-off, and water change: `FW-001`, `FW-002`, `FW-004`, `FW-008`.
7. Spatial PPFD, spectrum, DLI, shading, local flow, sediment, and organism exposure: `MR-009`, `MR-010`, `ORG-002`.
8. Coral polyp, colony, growth-form, injury, competition, symbiosis, energy, calcification, and reproduction state: `ORG-001`, `ORG-002`, `ORG-003`.
9. Species record, hard-gate order, directional interactions, sharks, carrying capacities, feeding, health, quarantine, and breeding: `ORG-006`, `ORG-007`, `ORG-008`, `ORG-009`, `ORG-010`, `ORG-011`, `ORG-012`, `ORG-013`.
10. Microfauna guild, life-stage, population, refuge, predation, filtration, harvest, and export state: `ORG-004`, `ORG-005`.
11. Equipment profile, sensor profile, maintenance, consumables, compatibility, controller, and incident event schemas: `SP-007`, `SP-008`, `GP-003`, `GP-004`, `GP-006`.
12. Derived equation library, deterministic invariants, example calculations, numerical stability, and calibration requirements.
13. Scoped numeric profile registry with selected, declined, and product-specific values from this artifact.

### RAQ-D3: `gameplay_systems_spec.md`

1. Design goals, ethical floors, and non-goals: `ORG-014`, `GP-005`, `GP-007`, `GP-008`, `GP-009`.
2. The shortest complete 14-stage lifecycle: `GP-001`.
3. Player action to physical state to biological state to feedback grammar: `GP-002`.
4. Mode selection, planning, adult preview, store and transfer gates: `FW-009`, `ORG-007`, `ORG-008`, `ORG-009`, `GP-004`.
5. Setup, wet test, water preparation, cycle challenge, maturation, and stability proof: `SP-006`, `MR-002`, `MR-003`, `MR-006`, `FW-001`, `FW-003`, `FW-006`.
6. Feeding, leftovers, cleanup, microfauna, growth, and carrying capacity: `ORG-004`, `ORG-005`, `ORG-006`, `ORG-010`.
7. Quarantine, health observation, diagnostic uncertainty, and treatment gating: `ORG-011`, `ORG-012`.
8. Breeding, larval systems, coral reproduction, and grow-out capacity: `ORG-003`, `ORG-013`.
9. Equipment comparison, capability-led progression, maintenance, consumables, and economy: `GP-003`, `GP-004`, `GP-005`, `GP-008`.
10. Incident library for ATO, heat, flow, drain, outage, source water, dosing, sensors, biofilter, organic load, cyanobacteria, aggression, and biosecurity: `FW-010`, `GP-006`.
11. Difficulty presets, toggles, pause and time compression, fair-warning contract, and recovery verification: `GP-002`, `GP-007`.
12. Tutorial and UI language that preserves units, uncertainty, source profiles, and simulation limitations.

## Activated Downstream Correction Instructions

### RAQ-C1: source repair

- D1 must describe the NOAA Ocean Service `23 to 29 deg C` range only as broad natural reef-building coral growth context, cite `SRC-090`, and state that it is neither an aquarium setpoint nor a tolerance for every coral. D1 must not publish numeric soft, LPS, or SPS PPFD bands.
- D2 must retain the Steinhart `24 to 26 C`, NOAA experimental `24.5 to 28 C`, and NOAA Ocean Service `23 to 29 deg C` rows as three separate provenance-scoped profiles mapped to `SRC-019`, `SRC-003`, and `SRC-090`. It must delete the commercial numeric soft, LPS, and SPS PPFD profile. A generic class field may exist only as a low-authority nonnumeric placement hint, never as realistic-mode biology.
- D3 must remove any numeric coral-class light hints from defaults, tutorials, placement validation, upgrades, and difficulty modes. It may show source-scoped institutional or species-profile values only with provenance and may use nonnumeric class hints only when labeled low authority.

### RAQ-C2: salinity state semantics

- D1 must call the base artificial-mix conservative state `S_eq`, the reference-composition salt-equivalent mass fraction in `g kg^-1`, and show `S_eq = 1000 * m_salt_eq / m_solution` under the declared idealized reference-composition assumption. It must reserve `S_A`, Absolute Salinity, for a compliant TEOS-10 profile and state that the base model does not derive `S_A`.
- D2 must use `m_salt_eq`, `m_solution`, and `S_eq` in canonical state, equations, invariants, worked evaporation examples, ATO logic, water-change logic, and field names. It must preserve `S_P` and `SG` as separate observation or instrument values. Only a separately validated TEOS-10 profile may expose `S_A`.
- D3 must label the base computed salinity display `S_eq` or a plain-language salt-equivalent value with its basis. `S_P` and `SG` readings remain instrument-specific displays. `S_A` may appear only when a compliant TEOS-10 profile is active. ATO remains unsalted purified freshwater replacement of evaporated H2O and is not dosing.

## User Topic Coverage Matrix

| User-required topic | Primary artifact owner | Exact consolidated claims | Required source-matrix coverage |
|---|---|---|---|
| Reef and freshwater separation | D1, D2, D3 | `FW-009`, `GP-004`, namespace contract | `SRC-036`, `SRC-059`, `SRC-084`, `SRC-089` |
| Tank size and gallons | D1, D2 | `SP-001`, `MR-001`, `FW-007`, `ORG-007` | `SRC-001`, `SRC-003`, `SRC-037`, `SRC-059`, `SRC-060`, `SRC-083` |
| Inhabitants and compatibility | D1, D2, D3 | `ORG-006`, `ORG-007`, `ORG-008`, `ORG-009` | `SRC-059`, `SRC-060`, `SRC-061`, `SRC-062`, `SRC-071` |
| Sharks and clownfish | D1, D2, D3 | `ORG-009` | `SRC-060`, `SRC-061`, `SRC-062` |
| Substrates and rockwork | D1, D2 | `MR-004`, `MR-005`, `FW-005`, `ORG-007` | `SRC-020`, `SRC-041`, `SRC-042`, `SRC-043`, `SRC-044`, `SRC-048` |
| Filtration and flow | D1, D2, D3 | `SP-002`, `SP-006`, `SP-008`, `MR-010` | `SRC-003`, `SRC-004`, `SRC-005`, `SRC-006`, `SRC-007`, `SRC-008`, `SRC-009`, `SRC-023`, `SRC-048` |
| Cycling and setup phases | D1, D2, D3 | `SP-006`, `MR-003`, `FW-003`, `GP-001` | `SRC-021`, `SRC-022`, `SRC-023`, `SRC-024`, `SRC-032`, `SRC-033`, `SRC-034`, `SRC-037` |
| Ugly phase | D1, D2, D3 | `MR-006`, `FW-006` | `SRC-020`, `SRC-025`, `SRC-026`, `SRC-027`, `SRC-028`, `SRC-029`, `SRC-038` |
| Cyanobacteria | D1, D2, D3 | `MR-007`, `FW-006`, `FW-010` | `SRC-025`, `SRC-026`, `SRC-038` |
| Salinity and chemistry | D1, D2 | `SP-004`, `MR-002`, `MR-008`, `MR-011`, `FW-002` | `SRC-002`, `SRC-003`, `SRC-019`, `SRC-033`, `SRC-034`, `SRC-035` |
| Marine temperature profiles | D1, D2 | `MR-009`, `MR-011` | `SRC-003`, `SRC-019`, `SRC-090` |
| Evaporation mechanics | D1, D2, D3 | `SP-004`, `FW-004` | `SRC-006`, `SRC-016`, `SRC-039` |
| Reef ATO using freshwater | D1, D2, D3 | `SP-005`, `MR-002`, `GP-006` | `SRC-003`, `SRC-016`, `SRC-017`, `SRC-018` |
| PAR and coral lighting | D1, D2 | `MR-009`, `ORG-002` | `SRC-010`, `SRC-011`, `SRC-012`, `SRC-013`, `SRC-014`, `SRC-015`, `SRC-052`, `SRC-053` |
| Coral polyps | D1, D2, D3 | `ORG-001`, `ORG-002`, `ORG-003` | `SRC-051`, `SRC-052`, `SRC-053`, `SRC-054`, `SRC-055`, `SRC-056`, `SRC-057`, `SRC-058`, `SRC-086`, `SRC-087` |
| Micro-invertebrates | D1, D2, D3 | `ORG-004`, `ORG-005` | `SRC-063`, `SRC-064`, `SRC-065`, `SRC-066`, `SRC-067` |
| Feeding | D1, D2, D3 | `ORG-010`, `GP-002` | `SRC-052`, `SRC-059`, `SRC-063`, `SRC-072` |
| Breeding | D1, D2, D3 | `ORG-003`, `ORG-013` | `SRC-058`, `SRC-062`, `SRC-070`, `SRC-072`, `SRC-086`, `SRC-088` |
| Health, disease, and quarantine | D1, D2, D3 | `ORG-011`, `ORG-012`, `FW-010` | `SRC-021`, `SRC-067`, `SRC-068`, `SRC-069`, `SRC-073` |
| Equipment and upgrades | D1, D2, D3 | `SP-008`, `GP-003`, `GP-004`, `GP-005` | `SRC-004`, `SRC-005`, `SRC-017`, `SRC-018`, `SRC-074`, `SRC-075`, `SRC-076`, `SRC-077`, `SRC-078`, `SRC-079`, `SRC-080`, `SRC-081` |
| Incidents and recovery | D1, D2, D3 | `MR-012`, `FW-010`, `GP-006` | Claim-specific source set in the source matrix |
| Interactive progression and causal gameplay | D3 | `GP-001`, `GP-002`, `GP-005`, `GP-007`, `GP-008` | `SRC-003`, `SRC-017`, `SRC-037`, `SRC-059`, `SRC-076` |

## Downstream Instructions

1. D1, D2, and D3 consume this artifact and the source matrix, not raw disagreements in the five research packets.
2. A drafting lane may add no new numeric recommendation or factual mechanism without either an existing claim mapping or an explicit return to the Aggregator or research owner.
3. Every profile table must carry provenance, evidence class, unit basis, scope, and whether the value is selected, contextual, declined as universal, or tunable.
4. D2 owns equations and implementable schemas. D3 owns interaction, feedback, progression, economy, and incident play. D1 explains the evidence and requirements without duplicating the full parameter schema or gameplay specification.
5. Maintain the marine and freshwater namespaces in headings, examples, data identifiers, stores, and fluid actions.
6. Welfare hard gates override economy, ownership, player level, rarity, later-upgrade plans, and equipment capacity.
7. Optional audience feedback does not gate D1-D3 drafting, V1 review, activated corrections, or F1 packaging.

## Limitations

This synthesis normalizes accepted upstream evidence. It does not add new research, validate current legal restrictions, define every species record, or prove biological accuracy of future simulation coefficients. It selects mechanisms, evidence labels, equations, safe boundaries, and explicit non-selections so downstream authors can remain consistent and traceable.
