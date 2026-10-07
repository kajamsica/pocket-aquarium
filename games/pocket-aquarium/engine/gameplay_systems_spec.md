# Aquarium Simulation Gameplay Systems Specification

Evidence revision: `reef-packet-v1-2026-09-02`

Surface state: `final_complete`

## Revision Log

| Date | Correction | D3 change |
|---|---|---|
| 2026-09-02 | RAQ-C2 | Defined the base artificial-mix display as `S_eq`, the reference-composition salt-equivalent mass fraction in `g kg^-1`; reserved `S_A`, Absolute Salinity, for an explicitly compliant TEOS-10 profile; preserved `S_P`, `SG`, salt-mass, and reef ATO behavior. |
| 2026-09-02 | RAQ-C3 | Advanced this gameplay specification to `SURFACE_READY` while retaining evidence revision `reef-packet-v1-2026-09-02`. |
| 2026-09-02 | RAQ-P1 | Reconciled package metadata after completed integrated review, activated corrections, and final packaging; marked this specification `final_complete` without changing substantive content. |

## Purpose and companion artifacts

This specification defines the interactive gameplay, progression, feedback, welfare, and recovery systems for a hyperrealistic 3D aquarium simulation. It covers two strictly separated project modes, `marine_reef` and `freshwater`. It does not define the simulator equations, implement the game, or prescribe real-world animal care.

Use this specification with the following package artifacts:

- [Main research packet](/Volumes/git/games/reef/reef_aquarium_research_packet.md), the real audience entrypoint and scientific explanation.
- [Simulation parameter model](/Volumes/git/games/reef/simulation_parameter_model.md), the state, equation, event, and schema contract.
- [Source matrix](/Volumes/git/games/reef/source_matrix.md), the authoritative claim-to-source mapping.
- [Consolidated positions](/Volumes/git/games/reef/work/consolidated_positions.md), the selected-position control artifact.
- [Final package status](/Volumes/git/games/reef/final_package_status.md), the package review and delivery disposition.

Simulation outcomes do not replace real husbandry, veterinary diagnosis, structural review, electrical safety, or current legal controls. Success in the game does not validate a real aquarium plan. Claims: `GP-009`, `ORG-014`.

## Evidence and product-decision notation

| Label | Meaning in this specification |
|---|---|
| `EBF` | Evidence-backed mechanism or scoped observation accepted by A0. |
| `HC` | Husbandry convention retained only at its stated scope. |
| `DE` | Derived relationship whose equations belong in the parameter model. |
| `DI` | Gameplay or simulation design inference grounded in accepted claims. |
| `TBV` | Tunable balance value or product choice. It is not biology. |
| `EWC` | Ethical or welfare constraint that gameplay cannot waive. |

Every mechanic table or its adjacent section identifies governing A0 claim IDs. Timing, prices, rewards, resale, failure probabilities, convenience, UI assistance, and economy multipliers are `TBV` unless a row says otherwise. No `TBV` may override an `EWC` gate.

## Design goals, ethical floors, and non-goals

### Design goals

1. Make the aquarium legible as a coupled living system rather than a decoration meter. Player actions change water, equipment, habitats, organisms, and future options through explicit causal chains. `DI`, claims: `GP-001`, `GP-002`.
2. Reward observation, measurement, diagnosis, restraint, maintenance, and verified recovery. More expensive hardware can improve capability or convenience, but cannot purchase immunity from biology or physics. `DI`, claims: `GP-003`, `GP-005`, `GP-006`.
3. Let new tanks mature through contingent ecology. Diatoms, bacterial films, green algae, cyanobacteria, and other guilds can appear, coexist, or never dominate according to state and history. `EBF`, `DI`, claims: `MR-006`, `MR-007`, `FW-006`.
4. Make fish, corals, plants, microfauna, and equipment causally real. They consume, transform, compete for, store, or export matter and energy through the parameter model. `EBF`, `DI`, claims: `ORG-001`, `ORG-002`, `ORG-004`, `ORG-005`, `ORG-010`, `SP-008`.
5. Teach uncertainty honestly. The player sees organisms and the environment directly, but instruments have resolution, lag, calibration, drift, noise, fouling, and failure. `DI`, claims: `SP-007`, `GP-002`.
6. Make the shortest complete player journey possible: plan a mode-correct tank, commission it without animals, stabilize it, introduce compatible livestock gradually, maintain and grow the system, attempt breeding when capacity exists, upgrade measured bottlenecks, and recover from incidents. `DI`, `EWC`, claim: `GP-001`.

### Ethical floors

- Animal-in cycling is unavailable and unrewarded. `EWC`, claims: `SP-006`, `MR-003`, `FW-003`, `ORG-014`.
- Cross-namespace livestock, consumables, microbial seed, chemistry, and mode-specific equipment behavior are hard blocked. `EWC`, claims: `FW-009`, `GP-004`.
- Adult-space, normal-behavior, required-habitat, social, life-support, and unavoidable-predation failures are hard purchase and transfer gates. `EWC`, claims: `ORG-006`, `ORG-007`, `ORG-009`.
- Unknown compatibility never displays as safe. `EWC`, `DI`, claim: `ORG-008`.
- Deliberate routine predator-prey feeding, starvation as cleanup, blind medication, environmental release, harmful commerce, and offspring production without humane capacity are unavailable or explicitly refused. `EWC`, claim: `ORG-014`.
- Essential humane life support is available at project start. It is not locked behind level, rarity, premium currency, or campaign completion. `EWC`, `DI`, claim: `GP-005`.
- Difficulty never disables cycling, water namespace, adult-space, required-habitat, or unavoidable-predation gates. `EWC`, `TBV`, claim: `GP-007`.

### Non-goals

- No universal gallons-per-animal, fish-inch, rock-weight, sand-depth, flow-turnover, coral PAR, water-change, or calendar-cycle rule.
- No binary `cycled`, `mature`, `reef_safe`, or universal compatibility flag.
- No single coral health bar, extension score, color score, or bleaching-equals-death rule.
- No magic cleanup, instant biofilter, broad cure button, brand prestige bonus, or filtration upgrade that waives a different limiting capacity.
- No complete species database, treatment protocol, legal-commerce rule set, structural approval, or electrical approval in this package.

Claims: `SP-006`, `MR-001`, `MR-005`, `MR-009`, `ORG-002`, `ORG-006`, `ORG-007`, `ORG-008`, `GP-003`, `GP-009`.

## Universal causal gameplay grammar

Every interactive system must implement this complete loop:

`action -> state mutation -> delayed consequence -> observable feedback -> diagnosis -> recovery`

| Loop field | Required implementation | Classification and claims |
|---|---|---|
| Action | A specific player verb with a target, quantity or setting, mode compatibility, preconditions, and cost in time or resources. | `DI`, `GP-002`, `GP-004` |
| State mutation | The immediate physical, chemical, spatial, equipment, organism, or ledger change. Hidden state changes even when no sensor can yet resolve it. | `DI`, `GP-002`; domain claim for each mechanic |
| Delayed consequence | A time-dependent biological, ecological, behavioral, maintenance, or reliability response. | `DI`, `GP-002`; domain claim for each mechanic |
| Observable feedback | At least one glance cue and, when measurable, one instrument or log cue. Visuals can be ambiguous. | `DI`, `SP-007`, `GP-002` |
| Diagnosis | One or more confirmatory actions that discriminate live hypotheses. A gross sign creates a differential, not an automatic pathogen identity. | `EWC`, `DI`, `ORG-011`, `MR-012`, `FW-010` |
| Recovery | A bounded correction that protects organisms, removes proximate load, restores the failed process, corrects gradually, and verifies a recovery trend or function. | `EWC`, `DI`, `MR-012`, `GP-006` |

### Feedback contract

Each mechanic exposes the following channels:

- **Glance cue:** animation, sound, surface motion, water clarity, growth, behavior, posture, color, deposition, equipment noise, leakage, or alarm state.
- **Instrument cue:** a reading, trend, confidence band, test result, calibration state, controller event, equipment telemetry, or maintenance log.
- **Context cue:** the latest relevant actions, feed events, additions, maintenance, power changes, and environmental changes.
- **Confirmatory action:** repeat with a valid method, calibrate, inspect locally, compare another location, isolate a subsystem, test a prepared fluid, or observe over time.
- **Recovery evidence:** a stabilized trend, restored processing challenge, normal delivered flow, normal water level, improved behavior, resumed feeding, regrowth, or another claim-appropriate function.

Fair warning means that a diligent player can notice a meaningful cue, use available tools to narrow causes, and take a bounded protective action. It does not mean the UI exposes perfect hidden state. Exact latency, cue salience, assistance strength, and alarm thresholds are `TBV`; sensor uncertainty is not optional in the highest-realism mode. Claims: `SP-007`, `GP-002`, `GP-006`, `GP-007`.

## Measurement and chemistry UI language

The dashboard preserves the difference between hidden state, a sensor observation, a scoped reference profile, and a player-selected goal. It never paints every value inside a generic green band or presents one reading as perfect knowledge. Claims: `SP-007`, `MR-011`, `FW-002`, `GP-002`.

- Actual operating water volume is the calculation state. Marketed tank size is catalog context, and displayed US gallons are a UI conversion. Claim: `SP-001`.
- The base artificial-mix computed display is `S_eq`, the reference-composition salt-equivalent mass fraction in `g kg^-1`. Instrument-specific `S_P` and `SG` remain separate observations with their own conventions. `S_A`, Absolute Salinity, is available only when an explicitly compliant TEOS-10 profile is active. The base game does not derive `S_A` from `S_eq`. Claim: `MR-011`.
- Named marine chemistry profiles remain separate and provenance-tagged. The game does not average an experimental profile and an exhibit profile into a universal reef target. Claim: `MR-011`.
- Marine nitrate and phosphate observations are displayed with trend, unit basis, profile, recent inputs, export, and biological uptake context. An analytical zero is not a universal objective. Claim: `MR-008`.
- Freshwater temperature, pH, GH, KH or alkalinity, TAN and calculated un-ionized ammonia, nitrite, nitrate, dissolved oxygen, conductivity or TDS, light, flow, and source composition are evaluated against the selected species or biotope profile, not one freshwater target. Claim: `FW-002`.
- Nitrogen, phosphate, and alkalinity labels retain their chemical basis. The UI never silently swaps `as N`, `as ion`, or another basis. Claims: `FW-002`, `MR-008`.
- Aquarium PAR is presented as local PPFD over the declared waveband, with spectrum, photoperiod, DLI, orientation, shading, measurement location, and acclimation history available. Claim: `MR-009`.
- Filtration-loop turnover, nominal display circulation, local velocity or shear, and actual water replacement remain separate readouts. Claims: `SP-002`, `MR-010`.
- Top-off, water change, salt correction, and dosing have distinct verbs, icons, logs, confirmation language, and undo or recovery guidance. Claim: `SP-005`.

Reference-profile selection, default dashboard layout, alert bands, graph windows, and tutorial simplification are `TBV` or `DI`. Chemistry and unit relationships are not balance values.

## The 14-stage lifecycle

Stages are workflow states, not level locks or countdowns. A player can revisit maintenance, diagnosis, planning, quarantine, and recovery whenever system state requires it. Claim: `GP-001`.

| Stage | Player work | State or gate produced | Feedback and recovery | Claims |
|---|---|---|---|---|
| 1. Mode and plan | Select `marine_reef` or `freshwater`, tank purpose, adult inhabitants, habitat, and life-support concept. | A hard project namespace plus an adult-preview feasibility plan. | Catalog previews show hard failures, unknowns, limiting dimensions, and mode-correct alternatives. Revise the plan before purchase. | `MR-001`, `FW-002`, `FW-007`, `FW-009`, `ORG-006`, `ORG-007` |
| 2. Site and leak test | Place tank and support, assemble plumbing, fill for a non-livestock wet test, exercise pump-off and restart states. | Verified containment, operating level, drain-down behavior, delivered flow, and equipment access. | Leaks, unstable level, dry equipment, noise, trapped air, or insufficient freeboard block commissioning. Drain, repair, and retest. | `SP-001`, `SP-002`, `SP-008`, `GP-003`, `GP-006` |
| 3. Prepare water and habitat | Prepare mode-correct source water, add conditioned water, substrate, rock, wood, plants, or reef structure, then commission heat, flow, gas exchange, light, and filtration. | A mode-correct physical habitat and running life-support baseline. | Source tests, mixing status, temperature, level, local flow, hardscape stability, and accessible service paths must pass. Correct the source or layout before animals. | `MR-002`, `MR-004`, `MR-005`, `FW-001`, `FW-002`, `FW-005`, `SP-008` |
| 4. Fishless cycle | Add a defined animal-free challenge and monitor ammonia-oxidation and nitrite-oxidation capacity under actual conditions. | Measured processing capacity, not a binary age flag. | Concentration trends and challenge completion show progress. If processing stalls, verify oxygen, alkalinity, temperature, pH, flow, surfaces, and load before re-challenging. | `SP-006`, `MR-003`, `FW-003` |
| 5. Contingent maturation | Let inocula, surfaces, light, nutrients, grazing, deposition, and maintenance shape emerging communities. | A maturing ecological state that may include ugly-phase guilds. | Films, mats, algae, detritus, microfauna, tests, and spatial maps show change. Diagnose drivers rather than waiting for a scripted day or using an eradication button. | `MR-006`, `MR-007`, `FW-006`, `ORG-004`, `ORG-005` |
| 6. Stability proof | Repeat mode-appropriate challenges and observe trends across normal operating variation. | Evidence that life support and habitat remain within the selected profile under planned load and disturbances. | Stable trend and recovery after a bounded challenge unlock eligible additions. Failure returns the player to capacity, equipment, or source-water diagnosis. | `SP-006`, `MR-003`, `FW-003`, `GP-002` |
| 7. Quarantine | Commission a separate mode-correct isolation system, receive a cohort, inspect, feed, and monitor it with separate tools and transfer paths. | A biosecurity history and transfer eligibility record, not a zero-risk certificate. | Feeding, behavior, gross signs, tests, inspection, and exposure history support the transfer decision. Problems extend isolation and trigger differential diagnosis. | `ORG-011`, `ORG-012`, `ORG-014` |
| 8. Gradual introduction | Acquire only eligible livestock and transfer a bounded load from quarantine into prepared habitat. | Increased metabolic, spatial, social, and trophic load. | Behavior, feeding, chemistry, oxygen, territories, coral reach, and biofilter trends show fit. If a limit emerges, stop additions and recover capacity or habitat before proceeding. | `ORG-006`, `ORG-007`, `ORG-008`, `ORG-010` |
| 9. Feeding | Schedule and deliver species-appropriate foods by place and time, then inspect consumption and leftovers. | Individual intake, uneaten particles, metabolism, oxygen demand, nutrient load, and live-prey state. | Feeding response, body or colony condition, leftover distribution, oxygen and nutrient trends guide correction. Reduce or redistribute input, remove leftovers, and restore export without starving dependents. | `ORG-005`, `ORG-010` |
| 10. Maintenance | Test, calibrate, clean, replace media or consumables, harvest biomass, siphon detritus, top off, perform mode-correct water changes, and service equipment. | Restored observability, capacity, fluid inventory, and explicit mass export or replacement. | Logs and before-and-after trends show whether the intended process changed. Revert or correct one bounded action when a maintenance step causes instability. | `SP-005`, `SP-007`, `SP-008`, `FW-004`, `FW-008`, `GP-003` |
| 11. Growth review | Re-measure adult-route clearance, territory, shading, coral reach, local PPFD, local flow, plant mass, detritus, and carrying-capacity dimensions. | Updated future-fit forecast and relocation, trimming, fragmentation, or expansion decisions. | 3D overlays expose crowding and local exposure. Reconfigure habitat or capacity before current growth becomes a hard welfare failure. | `MR-009`, `MR-010`, `ORG-001`, `ORG-002`, `ORG-006`, `ORG-008` |
| 12. Breeding | Meet taxon-specific maturity, condition, compatibility, cue, habitat, gamete or egg, first-food, larval, and grow-out prerequisites. | A reproductive attempt and, when successful, a new dependent cohort. | Courtship, nests, gametes, eggs, planulae, larvae, settlement, and juvenile survival appear only through the relevant path. Pause attempts or separate stages when capacity is insufficient. | `ORG-003`, `ORG-013`, `ORG-014` |
| 13. Evidence-led upgrade | Inspect the limiting dimension, compare equipment by delivered capability, install, commission, and verify the change. | Increased capacity, control, observability, labor efficiency, serviceability, or redundancy in the targeted dimension only. | Before-and-after delivered performance proves benefit. A wrong-dimension upgrade leaves the bottleneck visible and can be returned or repurposed under `TBV` economy rules. | `SP-008`, `ORG-006`, `GP-003`, `GP-005` |
| 14. Incident recovery | Respond to a causal equipment, water, ecological, organism, or biosecurity event. | Protected organisms, contained damage, restored process, gradual correction, and verified recovery. | Alerts and symptoms start a differential. Confirm, stabilize, correct, monitor, and close only after trend or functional recovery. | `MR-012`, `FW-010`, `ORG-011`, `GP-002`, `GP-006` |

## Project, mode, and planning systems

### Hard mode selection

At new-project creation, the player selects exactly one water namespace:

- `marine_reef`: artificial seawater, conservative reference-composition salt-equivalent mass `m_salt_eq`, its derived `S_eq` state in `g kg^-1`, separate `S_P` and `SG` observations, reef RO/DI ATO, marine rock and sand provenance, coral biology, marine organisms, and marine consumables. `S_A` exists only in a separately compliant TEOS-10 profile and is not derived by the base game.
- `freshwater`: source disinfectant, dechlorination, GH, KH or alkalinity, conductivity or TDS, freshwater substrates and hardscape chemistry, plants, freshwater organisms, and freshwater top-off composition.

The project namespace is immutable after confirmation. A player may create another project, but cannot convert a running project by toggling a label. Brackish or migratory life stages are unavailable unless a separately curated third namespace is later added. Project immutability and multi-project access are `DI` product choices; the no-leak boundary is `EWC`. Claims: `FW-009`, `ORG-007`, `GP-004`.

Namespace validation occurs at catalog query, purchase, inventory storage, equipment configuration, fluid preparation, microbial inoculation, quarantine, transfer, and plumbing connection. A mismatch returns an explicit refusal before any currency or state change.

### Purpose and adult-preview planner

The planner begins with purpose, not stocked gallons. The player can choose a display intent such as coral-focused reef, mixed marine habitat, planted freshwater habitat, species-focused freshwater habitat, breeding project, or observation and ecology project. These labels filter tools and tutorials but do not waive requirements. `DI`, claims: `MR-001`, `FW-002`, `ORG-006`, `ORG-007`.

The 3D adult preview must show:

- marketed tank size alongside actual operating water volume after displacement;
- footprint, depth, usable route, turn and resting space, substrate and cover zones;
- expected adult geometry and growth envelope for each planned organism;
- social-group, territory, feeding-zone, current, habitat, and refuge needs;
- directional predator, aggression, coral, plant, and invertebrate interactions;
- projected metabolic, oxygen, feeding, filtration, sessile-space, and reproductive loads;
- unresolved profile fields as `unknown`, never as a pass.

The preview is a planning visualization, not a universal safe-volume calculator. Claims: `SP-001`, `MR-001`, `FW-007`, `ORG-006`, `ORG-007`, `ORG-008`.

### Setup purchase sequence

1. Choose the intended adult community and habitat.
2. Choose tank geometry and operating layout that passes the hard plan gates.
3. Choose substrate, rockwork, hardscape, plants, or coral attachment layout based on habitat function.
4. Choose mode-compatible essential life support and tests.
5. Reserve maintenance access, quarantine capacity, food storage, top-off source, and incident-response capacity.
6. Purchase optional convenience or resilience upgrades only after the base plan passes.

Prices, bundles, stock rotation, rewards, delivery times, resale, and service costs are `TBV`. All biological and welfare eligibility checks run before the economy transaction. Claims: `GP-005`, `GP-008`, `ORG-007`.

## Habitat construction, source water, and commissioning

### Rock, substrate, and hardscape loop

`select material and geometry -> mutate displacement, surfaces, flow paths, shelter, substrate and provenance -> alter deposition, oxygen gradients, habitat use, chemistry or hitchhiker exposure over time -> observe local flow, detritus, animal use, films and tests -> inspect material, map flow, identify inhabitants and compare profile -> reposition, isolate, export, clean or replace the bounded cause and verify habitat function`

Marine live rock can carry biofilms, hitchhikers, and die-off risk. Dry or manufactured rock begins primarily as structure and future surface. Sand and bare bottom create different habitat, deposition, bioturbation, oxygen-gradient, and maintenance consequences. No rock-mass or sand-depth formula authorizes a plan. Claims: `MR-004`, `MR-005`, `ORG-004`, `ORG-005`.

Freshwater substrate, wood, rock, and plants change habitat, behavior, rooting, detritus, light, chemistry, and stability. Calcareous material is offered only when the selected biotope profile supports it. Claims: `FW-005`, `FW-008`.

### Marine reef water preparation loop

`prepare suitable purified freshwater and add a formulated marine salt mix -> create a separate mixing-container water and m_salt_eq ledger with derived S_eq -> allow measured mixing and equilibration -> observe mixing state, temperature, S_eq basis, separate instrument-specific S_P or SG reading and undissolved material -> verify instruments, source, mass and preparation history -> correct the batch outside the display, then transfer only after the selected profile passes`

Normal reef top-off is a different action. It adds unsalted purified freshwater, normally RO/DI, to replace evaporated H2O only. Marine water changes, salt correction, and dosing use separate buttons, containers, confirmations, ledgers, and tutorials. Claims: `SP-004`, `SP-005`, `MR-002`.

### Freshwater preparation loop

`sample source water and select the actual source treatment -> mutate disinfectant and mineral composition through a declared conditioner or preparation process -> expose the prepared water to a testable completion state -> observe source report, test results and preparation history -> confirm the disinfectant and species or biotope profile -> correct or discard the batch before exposure, then transfer only after validation`

Standing water cannot be offered as a chloramine treatment. Freshwater top-off adds freshwater without marine salt, with reservoir composition matched to the mineral plan. It restores evaporated water but does not export nitrate, organics, hardness, or conductivity. Claims: `FW-001`, `FW-002`, `FW-004`.

### Equipment commissioning loop

`install, configure and exercise equipment across normal and failure states -> establish actual-condition capacity, spatial coverage, control, sensor, maintenance and safety state -> reveal delivered performance, heat, noise, water use, flow and failure behavior -> observe telemetry, water motion, sound, level, temperature and alarms -> test duty point, calibration, pump-off, restart, blockage and access conditions -> adjust installation or replace the mismatched component, then rerun commissioning`

Nameplate capacity and purchase price never substitute for verified delivered performance. Claims: `SP-002`, `SP-007`, `SP-008`, `GP-003`, `GP-006`.

## Cycling, ugly phases, stabilization, and staged stocking

### Animal-free commissioning

The game never exposes an animal as a cycling input. The player applies a defined mode-correct, animal-free challenge and watches separate ammonia-oxidation and nitrite-oxidation capacity develop under oxygen, alkalinity, temperature, pH, flow, surface, and load constraints.

`apply defined challenge -> add a known nitrogen load to the empty system -> nitrifying capacity processes or fails to process the load over time -> observe test trends, oxygen and supporting conditions -> verify units, method and limiting conditions, then repeat the challenge -> correct the limiting process and recommission until the functional challenge passes`

The UI uses `commissioned` only for a passed functional challenge and `maturing` for continuing ecological development. Elapsed time is context and history, never an unlock. Marine and freshwater inocula and biofilter communities cannot transfer across namespaces. Claims: `SP-006`, `MR-003`, `FW-003`, `FW-009`.

### Ugly-phase ecology

The maturation system simulates competing bacterial films, diatoms, algae, cyanobacteria, marine dinoflagellate-like taxa where curated, calcifying crusts, freshwater biofilms, plants, grazers, microfauna, predators, resources, and disturbances. It does not queue a fixed visual sequence. Claims: `MR-006`, `FW-006`, `ORG-004`, `ORG-005`.

`change light, feeding, export, inoculum, grazing, disturbance or deposition -> change local resources, habitat and population pressures -> guilds grow, decline, coexist or move spatially -> observe films, mats, bubbles, color, detritus, grazing marks, nighttime activity and chemistry trends -> inspect locally, test, review recent actions and identify organisms only to the available evidence level -> remove proximate load, restore failed processes, export biomass carefully, adjust one driver gradually and verify trend`

The campaign never requires every ugly-phase guild to appear. A stable, low-visibility community and a conspicuous succession are both valid outcomes if causal state supports them. Spawn pressure, discovery pacing, cosmetic intensity, and tutorial timing are `TBV`; guild resource use and mass transfer are not.

### Cyanobacteria loop

Marine cyanobacterial mat risk combines organic loading, phosphorus and iron availability, light, temperature, local deposition, and low-oxygen sediment interfaces. Low local flow can modify deposition and interfaces, but is not a sole cause. Freshwater appearance likewise cannot establish toxicity, and a sudden biomass crash can worsen oxygen demand. Claims: `MR-007`, `FW-006`, `FW-010`.

`permit an interacting risk state or disturb an existing mat -> change cyanobacterial biomass, detritus trapping, local exchange and oxygen demand -> mat coverage and coupled stress change over time -> observe spatial mat growth, trapped material, gas or surface cues, nighttime oxygen trend and organism response -> distinguish identity uncertainty, local flow, source input, feeding, export, light, temperature and oxygen hypotheses -> protect animals, avoid blind eradication, remove biomass in bounded steps, correct verified drivers and confirm oxygen plus regrowth trend`

### Stability proof and staged stocking

Readiness requires a current functional challenge, stable mode-specific trends, commissioned life support, and a compatible quarantine plan. The game calculates a load envelope across independent capacity dimensions. Passing metabolic capacity does not pass adult geometry, social structure, habitat, sessile space, predation, or reproduction.

`transfer one eligible cohort -> add its actual spatial, metabolic, social and trophic load -> biofilter, oxygen, territory, feeding and waste states respond -> observe chemistry, feeding, behavior, local habitat use and equipment load -> compare trends with pre-transfer baseline and inspect directional interactions -> pause additions, reduce proximate load or restore the limiting capacity, then prove stability before the next cohort`

Claims: `ORG-006`, `ORG-007`, `ORG-008`, `ORG-010`, `GP-001`.

## Livestock shop, compatibility, and biosecurity

### Catalog boundary

The shop is queried inside the project namespace. `marine_reef` and `freshwater` use separate livestock, plant, coral, microfauna, feed, consumable, seed-media, and equipment catalogs. An item from the other namespace is not merely hidden by a visual filter. Purchase, inventory transfer, quarantine transfer, placement, and shared-water plumbing are validated against the hard namespace. Claims: `FW-009`, `GP-004`.

Catalog records with incomplete adult, habitat, social, diet, prey, reproduction, treatment, or welfare fields display the missing fields and default to `unavailable` or `unknown`. Product completion of species profiles is outside this packet.

### Acquisition gate order

The purchase and transfer validator runs in this exact order:

1. Water namespace and any curated life-stage salinity transition.
2. Temperature and core chemistry overlap for the applicable life stage.
3. Expected adult size, body shape, growth trajectory, turn radius, usable footprint, depth, and unobstructed route.
4. Normal swimming, resting, burrowing, clinging, schooling, diel, and escape behavior.
5. Required social group, pair, harem, sex ratio, hierarchy, and conspecific constraints.
6. Required substrate, cover, cave, host, plant, attachment, nesting, or spawning habitat.
7. Directional predation, severe aggression, venom, stinging, toxin, unavoidable feeding exclusion, and coral or invertebrate predation.
8. Oxygen, waste, feed, biological filtration, temperature-control, and redundancy capacity at expected load.
9. Quarantine or source protocol, treatment compatibility, and biosecurity separation.
10. Current legal, collection, trade, provenance, invasive-species, and release controls only when a later current-control source is available.

Any failed hard gate stops the transaction before soft scoring. Claims: `ORG-006`, `ORG-007`, `ORG-009`, `ORG-012`, `ORG-014`.

### Compatibility result states

| Result | Shop and transfer behavior | Educational explanation |
|---|---|---|
| `hard_incompatible` | Purchase for this project and transfer into this system are refused. No currency changes. | Names the first failed hard gate, shows the adult or directional risk in 3D, explains why current size, player level, price, future upgrade, or filtration cannot waive it, and suggests only mode-correct plan changes. |
| `unavailable` | Item cannot be acquired. | Lists missing curated evidence, biosecurity, provenance, life-stage, or welfare data. Missing evidence is not interpreted as safety. |
| `unknown` | Direct placement is refused. Research-mode observation or a later curated record may resolve it. | Shows which directional interactions or profile fields are unknown and avoids a safe label. |
| `conditionally_compatible` | Acquisition may proceed only after named, monitorable conditions and quarantine gates pass. | Lists directional risks, triggers, monitoring cues, fallback habitat, and the declared scope of the assessment. |
| `curated_exception` | A specific, source-controlled exception can proceed at its declared scope. | Shows the exact record and why it does not generalize to similar common names or another life stage. |
| `compatible_at_declared_scope` | Acquisition can proceed through quarantine. | States project, life stage, geometry, community, and evidence scope. It is not a permanent guarantee. |

Result names and welfare meaning are `EWC` and `DI`; messaging detail and presentation are `TBV`. Claims: `ORG-007`, `ORG-008`.

### Directional compatibility

After all hard gates pass, the system evaluates directional, time-varying modifiers: territory overlap, visual barriers, refuge, current preference, feeding zone and time, resource competition, fin nipping, coral nipping, bulldozing, aggression reach, breeding state, hunger, individual history, juvenile risk, microfauna predation, and future growth.

`alter inhabitants, geometry, refuge, feeding or breeding state -> change directional encounter and resource pressure -> behavior, injury risk, exclusion and prey pressure change -> observe pursuit, hiding, missed feeding, damaged tissue, displaced substrate or prey decline -> inspect event direction, time, location, hunger and territory overlays -> separate, rearrange, restore feeding access or provide a validated alternative habitat, then verify behavior and intake`

Claims: `ORG-008`, `ORG-010`.

### Shark restrictions

There is no generic shark catalog entry. A shark record is unavailable until it contains curated adult size, enclosure geometry, unobstructed run or benthic use, swimming and ventilation mode, substrate, diet, prey profile, life-support load, and handling risk. Gallons, juvenile size, player level, rarity, planned later upgrades, or filtration cannot authorize it alone.

The selected shark record is evaluated directionally against every proposed tank mate. A documented prey match is `hard_incompatible`. A shark and clownfish pairing is therefore blocked only when the selected shark's curated prey profile makes that fish a defensible prey match. Otherwise the result remains `conditionally_compatible` or `unknown`, never automatically safe and never a claim that every shark kills every clownfish. Claims: `MR-001`, `ORG-007`, `ORG-009`.

### Quarantine and biosecurity

Quarantine is a separate mode-correct system with mature filtration, appropriate habitat, light or flow, separate tools, feeding, monitoring, cohort separation, and a transfer history. Its duration is profile and evidence dependent, not a shared fixed timer.

`receive a quarantined cohort and use dedicated tools -> create an isolated epidemiological state and exposure history -> feeding, signs and possible transmission evolve within that boundary -> observe behavior, gross signs, tests, inspection and tool-use log -> form a syndrome and differential, verify husbandry and use curated diagnosis gates -> extend isolation, contain transfer paths, restore environment and use only a curated treatment context before re-evaluation`

Visual signs cannot unlock a universal medication. Medication actions require a curated diagnosis, organism tolerance, treatment setting, and source-controlled protocol that is outside this packet. Claims: `ORG-011`, `ORG-012`, `ORG-014`.

## Feeding, maintenance, and matter accounting

### Feeding system

Each organism or functional group has a profile for food type, particle or prey suitability, feeding place and time, acquisition behavior, life stage, and observable intake. Exact schedules, portion-assistance, automation cadence, and reminder timing are `TBV`; the intake and waste consequences are causal.

`choose food, amount, timing and delivery zone -> divide input among captured food, live prey, uneaten particles and inaccessible deposits -> change organism energy, metabolism, oxygen demand, excretion, detritus and nutrients -> observe feeding response, body or colony condition, leftover distribution, scavenger activity and water trends -> compare individual intake with feed log, inspect deposits and test coupled state -> redistribute or reduce input, remove leftovers, restore oxygen and export, and verify intake plus trend`

Overfeeding can simultaneously improve short-term intake for some organisms and increase waste, oxygen demand, microbial activity, nutrient availability, deposition, cyanobacteria risk, and maintenance load. Underfeeding can reduce condition and increase competition or predation pressure. Cleanup organisms have their own food budgets and cannot be used as starvation tools. Claims: `ORG-005`, `ORG-010`, `ORG-014`, `MR-007`, `FW-010`.

### Maintenance verbs remain separate

| Player verb | Immediate mutation | What it cannot do | Claims |
|---|---|---|---|
| Top off | Adds mode-correct replacement freshwater to restore evaporated H2O. | Does not remove accumulated solutes, nutrients, organics, or waste. Reef top-off does not add marine salt. | `SP-004`, `SP-005`, `MR-002`, `FW-004` |
| Water change | Removes water and carried material, then adds a prepared replacement fluid. | Does not equal top-off, dosing, or a universal fixed schedule. | `SP-005`, `MR-002`, `FW-004` |
| Salt correction | Deliberately changes the marine salt ledger through a separate, measured plan. | Is not an ATO action and is not offered in freshwater. | `SP-005`, `MR-002`, `FW-009` |
| Dosing | Adds named solutes through an explicit dose ledger. | Is not hidden in baseline reef ATO. Additive top-off becomes a coupled dosing subsystem. | `SP-005`, `MR-002` |
| Harvest or siphon | Exports named biomass, detritus, organisms, or water from a location. | Does not occur when a cleanup organism merely consumes material. | `ORG-005`, `FW-008` |
| Clean or replace media | Changes capture, biological surface, chemical media, fouling, or delivered flow. | Cannot restore every capacity dimension or justify instant total replacement without consequences. | `SP-006`, `SP-008`, `GP-003` |
| Calibrate or verify | Changes the observation model or confidence, not the hidden water state. | Does not directly fix the measured condition. | `SP-007`, `GP-002` |

Maintenance cadence, labor time, reminder intensity, consumable prices, and convenience bonuses are `TBV`. Mass export, equipment degradation, sensor uncertainty, and mode boundaries remain causal. Claims: `GP-003`, `GP-005`, `GP-008`.

## Coral placement, polyps, growth, and reproduction

### Coral placement workflow

The placement tool overlays local PPFD, spectrum, photoperiod, DLI, orientation, shading, turbidity, local flow or shear, deposition, neighbor reach, and acclimation history. It does not convert coral class names into universal target bands.

`place or move a colony, change light schedule, alter flow or change neighbors -> change local exposure and acclimation mismatch at colony faces and polyps -> photosynthesis, feeding encounter, respiration, energy, calcification, sediment stress, competition and recovery respond over different timescales -> observe extension, retraction, capture, mucus, color or fluorescence change, growth edge, tissue condition, sediment and neighbor interaction -> measure local light and flow, review history, inspect multiple signs and rule out chemistry or injury -> acclimate gradually, reposition, redirect flow, reduce deposition or separate competitors, then verify trend and function`

Claims: `MR-009`, `MR-010`, `ORG-001`, `ORG-002`, `ORG-008`.

### Polyp and colony state

A coral colony is a connected set of living local modules. A polyp can be extended, feeding, energy-limited, calcifying, injured, competing, reproducing, and sharing resources with the colony at the same time. The UI must render concurrent layers rather than collapse them into one health value.

| Layer | Visible and interactive expression | Diagnostic limit | Claims |
|---|---|---|---|
| Structure and connection | Tissue continuity, skeletal form, local damage, repair edge, colony geometry. | Colony sharing can buffer local state but cannot erase local damage. | `ORG-001`, `ORG-002` |
| Extension and retraction | Local tentacle extension, partial retraction, time-of-day and flow-dependent motion. | Extension alone is not health or diagnosis. | `ORG-001`, `ORG-002` |
| Feeding | Prey encounter, capture, handling, rejection, digestion and satiation animation. | Food contact is not equivalent to useful intake. | `ORG-001`, `ORG-002`, `ORG-010` |
| Symbiosis and energy | Pigment, fluorescence, photosynthetic contribution, heterotrophic intake, respiration, mucus, repair and reserves. | Color alone is not a health score. | `ORG-001`, `ORG-002`, `MR-009` |
| Calcification and growth | Skeletal deposition, growth margins, budding, form change and maintenance cost. | Visible extension rate does not prove all local processes are healthy. | `ORG-001`, `ORG-002` |
| Stress and bleaching | Acclimation lag, chronic stress, acute distress, paling or bleaching-like visual change, tissue loss risk and recovery trend. | Bleaching is not automatically death and appearance does not identify a single cause. | `ORG-001`, `ORG-002`, `ORG-011` |
| Competition | Contact, overgrowth, shading, chemical exposure, filaments or sweepers with directional reach. | Compatibility is neighbor, distance, geometry and time dependent. | `ORG-001`, `ORG-002`, `ORG-008` |
| Reproduction | Budding, fragmentation, brooding, broadcast spawning, settlement and post-event cost as distinct paths. | A random reward roll cannot bypass maturity, cue, fertilization, settlement or juvenile capacity. | `ORG-003`, `ORG-013` |
| Disease observation | Gross signs and spatial progression with photo and history tools. | The UI provides syndrome and differential levels only until curated evidence supports more. | `ORG-011`, `MR-012` |

### Coral growth and reproduction

Growth can improve visual complexity while creating new shading, flow, sediment, neighbor, maintenance, fragmentation, and capacity problems. The growth-review overlay forecasts these local conflicts from current geometry and declared profiles.

Asexual budding and fragmentation, brooding, and broadcast spawning remain separate systems. Sexual reproduction checks species-specific maturity, cues, compatible reproductive type, fertilization opportunity, settlement habitat, and juvenile capacity. Spawn probability, campaign frequency, cosmetic density, and rewards are `TBV`; the prerequisite chain is not. Claims: `ORG-003`, `ORG-013`.

## Microfauna, micro-invertebrates, and hitchhikers

Marine and freshwater microfauna use different catalogs. Represented records may include copepods, amphipods, isopods, worms, gastropods, small crustaceans, plankton, protozoa or rotifers where appropriate, eggs, and larvae. A record can graze, scavenge, deposit-feed, filter, predate, parasitize, serve as prey, or engineer habitat. Claims: `ORG-004`, `FW-009`.

### Inspection interface

- Macro view shows water-column clouds, grazing traces, burrows, detritus processing, nocturnal movement, prey responses, and localized decline.
- Magnifier view samples glass, substrate, rock, filter media, refuges, coral surfaces, and water at a declared location and time.
- Identification quality depends on view, life stage, curated key, sensor or microscope quality, and player evidence.
- Hitchhikers progress through `unknown_taxon`, `known_low_risk`, `conditional_nuisance`, `documented_predator_or_parasite`, or `biosecurity_restricted`.
- An unknown hitchhiker cannot be declared beneficial or harmful solely from appearance.

Identification assistance, sampling time, discovery rewards, and interface magnification are `TBV`; identity uncertainty and local sampling are `DI`. Claims: `ORG-004`, `ORG-005`, `ORG-011`.

### Population loop

`add food, habitat, refuge, predators, filtration, treatment, harvest or a new inoculum -> change resources, reproduction, immigration, mortality and export pressures -> microfauna populations boom, crash, shift life stage or redistribute -> observe samples, nocturnal activity, grazing, prey intake, filter capture and detritus -> compare spatial samples with feed, treatment, predator and maintenance history -> restore verified food or refuge, reduce proximate excess, adjust capture or predation, isolate restricted taxa, and confirm population plus system trend`

Cleanup guilds transform material into respiration, excretion, growth, reproduction, detritus, or prey biomass. Only explicit siphoning, harvest, filtration removal, biomass removal, or water removal exports matter from the system. Claims: `ORG-004`, `ORG-005`, `ORG-010`.

## Breeding and dependent-life-stage systems

Breeding is a management project, not a random bonus. The attempt validator requires:

1. maturity and adequate condition;
2. compatible reproductive type, pair or social structure;
3. species-specific cue and timing profile;
4. nesting, spawning, attachment, brooding, or settlement habitat;
5. gamete, egg, embryo, or planula survival conditions;
6. appropriate first food and feeding density where required;
7. a separate larval or juvenile environment when the display cannot support that stage;
8. humane grow-out, separation, feeding, filtration, and destination capacity.

`prepare breeders and life-stage habitat, then permit a reproductive event -> consume energy and create gametes, eggs, planulae, larvae or fragments through the declared path -> fertilization, development, settlement, feeding and survival proceed through stage-specific conditions -> observe courtship, nests, spawn, eggs, larvae, settlement, feeding and post-event condition -> verify each failed prerequisite from logs and local state -> stop new attempts, restore breeder condition, correct one life-stage bottleneck, or move dependents to commissioned capacity and verify survival trend`

Players may disable breeding cues or separate compatible animals when capacity is absent. The game refuses deliberate offspring production when no humane grow-out path exists. Spawn chance, campaign cadence, offspring count abstraction, market reward, and prestige are `TBV`; the prerequisite and capacity gates are `EWC`. Claims: `ORG-003`, `ORG-013`, `ORG-014`.

## Equipment shop, upgrades, degradation, and redundancy

### Comparison dimensions

Every equipment card compares:

- actual-condition capacity and duty point;
- spatial coverage and delivered effect;
- control range and controllability;
- observability, telemetry, alarms and calibration needs;
- maintenance access, interval, consumables and fouling sensitivity;
- safety states, failure modes and fallback behavior;
- energy, heat, water use, noise and footprint;
- water namespace, media, sensing principle and biological compatibility;
- serviceability, spare availability and redundancy role.

Cards do not show a universal quality score based on price, rarity, wattage, brand, or nameplate maximum. Claims: `SP-008`, `GP-003`, `GP-004`.

### Upgrade categories

| Upgrade dimension | Legitimate benefit | Explicit limit | Claims |
|---|---|---|---|
| Capacity | Increases delivered heat, cooling, flow, gas exchange, processing, capture, water preparation, light coverage, or reservoir endurance under actual conditions. | Cannot waive adult geometry, social, habitat, trophic, sessile-space, predation, or reproductive limits. | `SP-008`, `ORG-006`, `GP-003`, `GP-005` |
| Control | Narrows or shapes delivered operation and permits mode-correct schedules or setpoints. | Does not guarantee correct configuration or eliminate sensor error. | `SP-007`, `SP-008`, `GP-003` |
| Observability | Adds measurements, logs, confidence, spatial sampling, alarms, or failure telemetry. | Does not expose perfect hidden state or diagnose a pathogen from one sign. | `SP-007`, `ORG-011`, `GP-002` |
| Labor | Automates a repeated action or makes service access easier. | Automation still consumes supplies, requires commissioning, and can fail. | `SP-008`, `GP-003`, `GP-005` |
| Efficiency | Reduces energy, heat, water, consumable, or time cost for a delivered result. | Economy and convenience do not change biological requirements. | `GP-003`, `GP-005`, `GP-008` |
| Serviceability | Improves isolation, cleaning, calibration, replacement, or recovery access. | Does not prevent degradation. | `SP-008`, `GP-003` |
| Redundancy | Adds an independent fallback, reserve, backup sensor, alternate aeration, or power path. | Common-mode failures and bad configuration remain possible. | `SP-008`, `GP-005`, `GP-006` |

### Maintenance and degradation loop

`run equipment and defer or perform service -> change wear, fouling, calibration, media, consumables, delivered performance and failure probability -> capacity, noise, heat, control and observability drift -> observe telemetry, trend, alarm, sound, flow, temperature, water level, energy or water use -> inspect and isolate the component, verify sensor and delivered output -> service, clean, calibrate, refill, replace or switch to commissioned redundancy, then prove restored performance`

Degradation curves, wear rates, service intervals, fault probabilities, repair times, warranties, return rules, and prices are `TBV` equipment-profile data. The mechanism, delivered-performance check, maintenance state, and explicit failure modes are required. Claims: `SP-007`, `SP-008`, `GP-003`, `GP-006`, `GP-008`.

## Incident, diagnosis, and recovery library

Every incident begins from a simulated cause, not a random damage animation. Randomness may select time or component within a declared `TBV` failure distribution, but the event must mutate real state, emit proportionate cues, permit discriminating checks, and respond to bounded correction. Claims: `GP-002`, `GP-006`.

| Incident | Action or initiating state -> state mutation -> delayed consequence | Feedback and diagnosis | Bounded recovery | Claims |
|---|---|---|---|---|
| Reef ATO reservoir empty or pump blocked | Evaporation continues while replacement flow stops -> water mass and level fall while `m_salt_eq` remains -> `S_eq` and equipment exposure risk rise. | Falling return-compartment level, pump runtime or dry-run alarm, `S_eq` trend with separate instrument-specific `S_P` or `SG` observation and sensor confidence, reservoir inspection and manual mass check. | Protect exposed equipment, verify the ATO fault and salinity basis, restore unsalted purified freshwater gradually through the top-off path, service the pump or refill reservoir, then confirm level and `S_eq` trend. | `SP-004`, `SP-005`, `MR-002`, `SP-007`, `GP-006` |
| Reef ATO stuck on, siphon, false-low or leak response | Excess unsalted purified freshwater enters or water leaves through a separate leak path -> water and `m_salt_eq` ledgers diverge from target -> `S_eq` falls or the system overfills, with distinct leak versus top-off signatures. | High-level alarm, abnormal runtime, reservoir loss, floor leak cue, `S_eq` trend, separate instrument-specific `S_P` or `SG` observation, sensor inspection and isolated pump test. | Stop top-off, contain water, distinguish leak from false-low or siphon, correct installation and sensor state, make any salt correction through the separate salt-correction path, and verify no recurrence. | `SP-005`, `SP-007`, `SP-008`, `MR-002`, `GP-006` |
| Freshwater top-off mismatch | Player uses reservoir water inconsistent with the mineral plan -> added water also adds an unintended conservative-solute load -> hardness or conductivity drifts across repeated top-offs. | Reservoir history, conductivity or hardness trend, source test and volume ledger. | Stop the reservoir, prepare profile-correct freshwater, use a separate gradual water-change or correction plan, and verify the trend. Never add marine salt. | `FW-004`, `FW-009`, `GP-006` |
| Heater stuck on or off | Control or power failure changes heat input -> temperature drifts -> metabolism, oxygen availability, behavior and biological processes respond. | Temperature trend with cross-check, heater status, room condition, animal behavior and alarm. | Switch to commissioned redundancy or remove failed heat input, protect organisms, correct gradually, repair or replace and confirm stable control. | `SP-003`, `SP-007`, `SP-008`, `FW-010`, `GP-006` |
| Pump obstruction, wear or failure | Delivered duty-point flow and local circulation fall or redistribute -> filtration, gas exchange, heat distribution, feeding encounter and deposition change. | Sound, pump telemetry, water motion, surface exchange, local-flow map, detritus and organism cues. | Restore aeration and critical circulation, isolate and inspect the pump and plumbing, clear or service it, use redundancy, and verify actual delivered flow rather than nameplate status. | `SP-002`, `SP-003`, `SP-008`, `MR-010`, `GP-006` |
| Filter or media failure | Fouling, bypass, exhausted consumable, loss of surface, or flow interruption reduces actual processing or capture -> waste, particles, chemistry or biofilter capacity shift. | Pressure or flow cue where available, water clarity, media inspection, ammonia and nitrite challenge trend, maintenance log. | Protect organisms, restore oxygen and flow, service the specific failed process without assuming instant biological replacement, then re-prove required capacity. | `SP-006`, `SP-008`, `FW-010`, `GP-006` |
| Light fault or abrupt schedule change | Output, spectrum, coverage or timing changes -> DLI and acclimation mismatch change by location -> coral, plant and ecological responses emerge on different timescales. | Visual output, controller log, local PPFD and schedule check, polyp, plant and film trends. | Protect light-sensitive organisms, verify fixture and sensor, restore a profile-based gradual schedule or relocate temporarily, then confirm acclimation and function. | `MR-009`, `ORG-002`, `FW-008`, `GP-006` |
| Power outage | Multiple life-support processes stop -> circulation, gas exchange, heat and filtration decline together -> oxygen, temperature and waste risks accumulate. | Power-state alarm, surface motion, temperature, oxygen where available, equipment status and behavior. | Prioritize commissioned oxygen and circulation backup, manage temperature, reduce new feed load, restore systems in a safe sequence, inspect restart and drain states, and verify water plus animal trends. | `SP-003`, `SP-008`, `FW-010`, `GP-005`, `GP-006` |
| Drain, overflow or restart fault | Pump state, blockage, siphon or freeboard failure moves water among compartments or outside the system -> operating volume and equipment submergence change -> flood, dry-run and life-support loss can follow. | Level changes, floor leak cue, pump sound, high or low alarms, compartment inspection and pump-off test history. | Stop the driving pump, contain the leak, protect submerged equipment and organisms, clear or repair the cause, repeat an animal-safe wet test, and verify restart plus drain-down. | `SP-001`, `SP-008`, `GP-006` |
| RO/DI or source-water failure | Treatment performance degrades or the wrong source is used -> unintended source constituents enter mixing or top-off water -> chemistry and biological effects accumulate. | Product-water test, source history, consumable state, reject or production trend, downstream chemistry. | Isolate the source, stop transfers, replace or service the treatment stage, validate new product water, discard or separately correct affected batches, and verify display trend. | `MR-002`, `FW-001`, `FW-004`, `SP-008`, `GP-006` |
| Dosing fault | Wrong fluid, rate, calibration, reservoir or schedule adds a named solute incorrectly -> local and system chemistry shift -> organism and process stress can follow. | Dose log, reservoir mass, calibration test, local and system measurements, animal signs. | Stop dosing, verify identity and measurement, protect organisms, use a separate gradual correction or water-change plan, recommission dosing, and monitor recovery. | `SP-005`, `SP-007`, `MR-012`, `GP-006` |
| Probe drift, fouling or failure | Observation bias changes without the same hidden-water change -> controller or player may take a wrong action -> false reassurance or overcorrection risk grows. | Implausible trend, disagreement among methods or nearby state, calibration status, fouling inspection and response lag. | Place dependent automation in a safe state, cross-check independently, clean or calibrate, repair or replace, and reassess any actions taken from the bad reading. | `SP-007`, `SP-008`, `GP-002`, `GP-006` |
| Biofilter overload or interruption | Added load, oxygen loss, chemistry shift, flow loss or surface disruption exceeds processing capacity -> ammonia or nitrite processing lags -> organism risk and oxygen demand rise. | Ammonia and nitrite trends with explicit basis, oxygen and supporting-condition tests, load and maintenance history. | Stop additions, reduce proximate load, protect organisms, restore oxygen, flow and supporting conditions, then re-prove processing capacity before restocking. | `SP-006`, `MR-003`, `FW-003`, `FW-010`, `GP-006` |
| Overfeeding and organic overload | Excess feed is captured unevenly or remains uneaten -> detritus, respiration, oxygen demand and nutrient availability increase -> films, cyanobacteria, stress and maintenance load can rise. | Leftovers, feeding response, detritus map, oxygen and nutrient trends, filter load and mat growth. | Stop excess input without starving dependents, remove accessible leftovers, restore oxygen and export, correct feeding distribution and verify intake plus chemistry trend. | `MR-007`, `FW-010`, `ORG-005`, `ORG-010`, `GP-006` |
| Skimmer fault in marine mode | Air, water, foam path or collection failure changes marine export and gas interaction -> dissolved and particulate load or gas state can shift. | Foam and collection state, air and water flow, overflow cue, maintenance log and chemistry trend. | Contain overflow, verify air and water delivery, clean or service, use alternate export or gas support if commissioned, and confirm function. Freshwater mode does not receive a default skimmer benefit. | `SP-008`, `FW-009`, `GP-004`, `GP-006` |
| Aggression or predation escalation | Growth, hunger, breeding, territory or refuge change crosses a directional interaction threshold -> exclusion, injury or prey loss increases. | Event direction, pursuit, hiding, missed feed, wound, disappearance, territory and time log. | Separate immediately when harm is likely, restore feeding or refuge only if the hard gate still passes, re-evaluate compatibility, and refuse reintegration when unavoidable harm is established. | `ORG-007`, `ORG-008`, `ORG-009`, `ORG-014` |
| Gross health sign or pathogen event | Exposure, environment, injury or infection produces a nonspecific sign -> syndrome can progress or transmit -> blind intervention may add harm. | Behavior, appetite, appearance, distribution, cohort history, quarantine path, water tests and curated diagnostic evidence. | Isolate when appropriate, correct verified environmental problems, contain transfer paths, pursue the curated evidence level, and allow treatment only in a compatible documented context. | `MR-012`, `ORG-011`, `ORG-012`, `ORG-014`, `GP-006` |

Fault incidence, component selection, warning lead time, repair cost, and recurrence probability are `TBV`. Causal state, conservation, namespace behavior, diagnostic uncertainty, and bounded recovery are not.

## Tutorials, campaign, and onboarding

### Tutorial structure

The onboarding tutorial uses two separate playable projects, never a mode toggle inside one tank.

1. **Shared physical orientation:** camera, 3D placement, actual operating volume, displacement, local flow, levels, equipment access, time controls, logs, and uncertainty.
2. **Marine reef setup:** purpose and adult preview, wet test, purified source water, marine salt mixing, reef ATO with unsalted purified freshwater, fishless challenge, contingent maturation, quarantine, staged livestock, coral placement, feeding, maintenance, and incident recovery.
3. **Freshwater setup:** purpose and biotope profile, source-water characterization, disinfectant-specific treatment, mineral plan, hardscape and plants, freshwater fishless challenge, contingent ecology, quarantine, staged livestock, feeding, top-off, water change, and incident recovery.
4. **Diagnostic apprenticeship:** ambiguous signs, sensor disagreement, local versus system measurements, incident containment, and verified recovery.
5. **Advanced stewardship:** growth review, breeding prerequisites, larval or settlement systems, microfauna management, redundancy, and long-term ecosystem goals.

Tutorial task order is a `DI` product choice grounded in `GP-001`; exact prompt timing, skip rules, reward and assistance are `TBV`. Tutorials cannot demonstrate animal-in cycling, blind treatment, namespace leakage, or harmful acquisition. Claims: `GP-001`, `GP-002`, `GP-007`, `ORG-014`.

### Campaign progression

Campaign progression unlocks complexity, diagnostics, optional automation, specialized habitats, advanced breeding projects, cosmetic expression, and larger management scope. It does not lock essential humane equipment or turn welfare into a level check.

Recommended campaign goals are:

- complete a mode-correct setup and functional cycle challenge;
- stabilize a contingent maturation event through diagnosis rather than eradication;
- maintain a compatible community through a growth review;
- identify and resolve a limiting capacity dimension;
- demonstrate reef ATO, freshwater top-off, water change, salt correction, and dosing as distinct actions where applicable;
- diagnose a sensor or equipment fault from conflicting evidence;
- document a microfauna boom or crash and its trophic cause;
- complete a breeding or coral propagation project only with dependent-life-stage capacity;
- maintain redundant life support through an outage scenario;
- build long-term habitat fidelity, biodiversity, stability, and maintenance efficiency without unsafe stocking.

Mission rewards, unlock order, reputation, achievement thresholds, campaign length, and cosmetic tiers are `TBV`. Claims: `GP-005`, `GP-007`, `GP-008`.

## Time, difficulty, accessibility, economy, and loss

### Time progression

- Pause freezes simulation time and does not allow hidden deterioration. `TBV` product rule.
- Time compression accelerates the same causal model with bounded integration and exact threshold events. It cannot substitute for a readiness challenge or permit unexplained mass drift. `DI`, `TBV`, claims: `SP-006`, `SP-009`, `GP-001`.
- Optional protective auto-slow or auto-pause can trigger on severe alarms, unresolved critical uncertainty, or new animal distress. Trigger sensitivity is `TBV`; the setting is enabled by default in learning modes.
- Equipment wear, feeding, ecological succession, growth, disease observation, breeding, and recovery continue only while simulation time advances.
- Offline progression is an explicit `TBV` setting. If enabled, the game must preview elapsed-time consequences and apply the same pause protections selected by the player.

### Difficulty and realism controls

| Control | What may change | What never changes | Claims |
|---|---|---|---|
| Information assistance | Highlight strength, tutorial hints, differential suggestions, trend interpretation and adult-preview explanation. | Hidden state remains distinct from observation; unknown never becomes compatible. | `SP-007`, `ORG-008`, `GP-002`, `GP-007` |
| Sensor realism | Noise, drift, fouling, lag, calibration burden and cross-check assistance. | Highest-realism mode models uncertainty; no mode grants pathogen identity from a gross sign. | `SP-007`, `ORG-011`, `GP-007` |
| Procedural detail | Number of explicit preparation, commissioning, feeding, cleaning, calibration and transfer steps. | Top-off, water change, salt correction and dosing remain separate ledger operations. | `SP-005`, `GP-007` |
| Time pressure | Warning lead, task timers, growth pace and incident response window. | State-based readiness and welfare gates remain. | `SP-006`, `GP-007` |
| Reliability | Wear and incident frequency. | Equipment still has mechanisms, maintenance and explicit failures. | `SP-008`, `GP-006`, `GP-007` |
| Economy | Prices, rewards, resale, operating costs and convenience multipliers. | Essential life support is available, and money cannot waive eligibility. | `GP-005`, `GP-007`, `GP-008` |
| Ecological visibility | Visual intensity, discovery prompts and sampling assistance. | Ugly phases remain contingent and cleanup conserves matter. | `MR-006`, `FW-006`, `ORG-005`, `GP-007` |

### Diagnostic accessibility

- Never rely on color alone. Every critical visual cue has text, icon, sound, haptic or log alternatives according to platform capabilities. `TBV` accessibility requirement.
- Trend direction, confidence, calibration, unit basis, and measurement location are available in text.
- Local PPFD, flow, territory, feeding, deposition, and growth overlays use patterns and labels in addition to color.
- Screen-reader labels state action, target, immediate mutation, warning, confidence, and refusal reason.
- Tutorials can slow the system and replay causal histories without converting uncertainty into false certainty.

These interface provisions are `DI` and `TBV`; the underlying uncertainty and causal relationships follow `SP-007`, `GP-002`, `GP-007`.

### Economy abstraction

The economy uses abstract credits, operating costs, inventory capacity, service time, and reputation. All numeric values are `TBV`. No price or brand ranking is evidence-backed in this packet.

Economy design rules:

- eligibility and welfare validate before affordability;
- humane base life support and mode-correct testing are accessible at project start;
- upgrades earn value through measured capability, observability, labor, efficiency, serviceability, or redundancy;
- resale never launders an incompatible or biosecurity-restricted organism into another project;
- livestock availability requires curated provenance and welfare data, not only currency or player level;
- breeding rewards require dependent-life-stage and destination capacity;
- the abstract marketplace does not claim current real-world price, trade, collection, or legal status.

Claims: `GP-005`, `GP-008`, `ORG-007`, `ORG-013`, `ORG-014`.

### Reversible loss and ethical presentation

Learning modes provide a pre-incident checkpoint and a causal replay after a severe welfare outcome. Rewind resets the complete simulation state, ledger, inventory, and economy to the checkpoint rather than selectively resurrecting an organism. Checkpoint interval and reward consequences are `TBV`.

The replay identifies missed cues and safer decision points without rewarding suffering or turning animals into disposable inputs. Higher-realism modes may make state loss less reversible, but can never relax purchase gates or encourage deliberate harm. Pause, sandbox planning, and non-animal failure drills remain available. Claims: `ORG-014`, `GP-007`.

## Long-term goals

Long-term play is built around stewardship rather than maximal stocking:

- maintain stable function across seasonal room changes, growth, maintenance, and equipment aging;
- improve habitat fidelity and adult behavioral opportunity;
- develop coral colonies, plants, and microfauna through causal ecological management;
- build diagnostic competence with less assistance and better evidence;
- reduce labor, energy, water, and consumable use without reducing welfare;
- create resilient redundancy and recover cleanly from incidents;
- complete taxon-appropriate breeding, propagation, larval, settlement, and grow-out projects;
- document biodiversity, individual history, lineage, provenance, and ecosystem change;
- operate multiple strictly separated projects without cross-contamination.

Scores, titles, campaign endpoints, prestige, collection completion, and reward curves are `TBV`. A high score cannot offset unresolved welfare failures. Claims: `GP-005`, `GP-008`, `ORG-006`, `ORG-013`, `ORG-014`.

## Acceptance scenarios

Each scenario must be executable through the full causal grammar. Exact initial values, elapsed time, economy values, and random seeds are `TBV` fixtures supplied by implementation tests. The expected relationships and gates below are required.

### AS-01: Marine reef setup and commissioning

- **Action:** Create a `marine_reef` project, plan adult inhabitants, wet-test the tank, prepare artificial seawater from suitable purified freshwater and marine salt, commission equipment, and run a fishless challenge.
- **Expected state and delay:** Geometry, displacement, mixed-water, equipment, microbial-capacity, and maturation states change. No animal enters during cycling.
- **Feedback and diagnosis:** Actual operating volume, source and mixing history, base `S_eq` in `g kg^-1`, separate instrument-specific `S_P` or `SG` reading, delivered equipment state, ammonia and nitrite trends, and maturation cues remain inspectable. The base game does not derive `S_A` from `S_eq`.
- **Recovery and pass:** A failed challenge names supporting conditions to inspect and blocks stocking until a repeated functional challenge passes. Calendar age alone never unlocks livestock.
- **Claims:** `SP-001`, `SP-006`, `MR-001`, `MR-002`, `MR-003`, `GP-001`.

### AS-02: Freshwater setup and source treatment

- **Action:** Create a `freshwater` project, choose a biotope and adult plan, characterize source water, apply disinfectant-specific treatment, construct habitat, commission equipment, and run a freshwater fishless challenge.
- **Expected state and delay:** Disinfectant, mineral, habitat, biofilter and ecological states change only through freshwater actions.
- **Feedback and diagnosis:** Source report, prepared-water tests, chemistry profile, delivered equipment and challenge trends are visible.
- **Recovery and pass:** Untreated or incorrectly treated source water is refused before animal exposure. Standing water is not offered as a chloramine solution. Marine seed and consumables remain blocked.
- **Claims:** `FW-001`, `FW-002`, `FW-003`, `FW-005`, `FW-009`.

### AS-03: Reef evaporation and correct ATO

- **Action:** Advance time under evaporation, then let a commissioned reef ATO add unsalted purified freshwater.
- **Expected state and delay:** Evaporation reduces water mass while `m_salt_eq` remains, so base `S_eq` rises. Correct ATO restores water mass without adding marine salt.
- **Feedback and diagnosis:** Water level, ATO reservoir and runtime, `S_eq` trend, separate instrument-specific `S_P` or `SG` observation with uncertainty, and fluid ledger distinguish the cause.
- **Recovery and pass:** Correct top-off returns level and `S_eq` toward the prior state. The UI never labels marine replacement water, dosing fluid, or a water change as normal reef ATO. `S_A` appears only under an explicitly compliant TEOS-10 profile and is not derived from `S_eq`.
- **Claims:** `SP-004`, `SP-005`, `MR-002`, `SP-007`, `GP-006`.

### AS-04: Reef ATO failure

- **Action:** Trigger an empty reservoir, blocked pump, stuck-on state, false-low sensor, siphon, or leak-linked level change.
- **Expected state and delay:** Each cause mutates the water and `m_salt_eq` ledgers differently, with `S_eq`, level, overflow or exposure consequences.
- **Feedback and diagnosis:** Runtime, reservoir, high or low level, leak, `S_eq`, separate instrument-specific `S_P` or `SG`, calibration and isolated pump checks discriminate causes.
- **Recovery and pass:** The player stops the fault, protects equipment and organisms, corrects level with unsalted purified freshwater or uses the separate salt-correction path as appropriate, recommissions safeguards, and verifies no recurrence.
- **Claims:** `SP-004`, `SP-005`, `SP-007`, `SP-008`, `MR-002`, `GP-006`.

### AS-05: Contingent cyanobacteria event

- **Action:** Create interacting organic, nutrient, light, temperature, deposition and local-interface pressures, then change one verified driver.
- **Expected state and delay:** Cyanobacterial coverage responds spatially and temporally; low flow alone is neither necessary nor sufficient.
- **Feedback and diagnosis:** Mat location, detritus, nighttime oxygen trend, recent input and local-flow context support a differential. Appearance alone does not prove toxicity.
- **Recovery and pass:** Bounded biomass removal and verified driver correction improve oxygen and regrowth trends. A magic eradication button and sudden unprotected die-off are absent.
- **Claims:** `MR-007`, `FW-006`, `FW-010`, `GP-002`.

### AS-06: Coral PPFD placement and acclimation

- **Action:** Place a coral under one local light and flow history, then move it or change the schedule abruptly.
- **Expected state and delay:** Local PPFD, spectrum, DLI, orientation, shading, flow and acclimation mismatch change; polyp, pigment, energy, calcification and stress layers respond at different rates.
- **Feedback and diagnosis:** Multiple polyp and colony visuals plus local measurement and history are available. Extension or color alone does not provide a health verdict.
- **Recovery and pass:** Gradual profile-based acclimation or relocation restores trend and function. No universal coral-class PAR target is required in realistic mode.
- **Claims:** `MR-009`, `MR-010`, `ORG-001`, `ORG-002`.

### AS-07: Shark purchase refusal

- **Action:** Attempt to buy a shark without a complete curated adult geometry, swim or rest mode, ventilation, substrate, diet, prey, load and handling profile, or attempt to place a curated shark in inadequate geometry.
- **Expected state and delay:** No project, inventory, currency or animal state changes.
- **Feedback and diagnosis:** The refusal shows missing profile fields or failed adult geometry in the 3D preview and explains why gallons, juvenile size, level, rarity or future filtration cannot pass it.
- **Recovery and pass:** The player must choose a compatible curated plan or a different project. No convenience or economy setting bypasses the refusal.
- **Claims:** `MR-001`, `ORG-006`, `ORG-007`, `ORG-009`, `GP-007`.

### AS-08: Directional predator-prey incompatibility

- **Action:** Attempt a shark and clownfish pairing where the selected shark record contains a defensible prey match, then test a second pairing whose evidence is incomplete.
- **Expected state and delay:** The documented prey match returns `hard_incompatible`; the incomplete case returns `unknown` or `conditionally_compatible`, not safe.
- **Feedback and diagnosis:** The result cites direction, life stage, prey profile and scope. It does not claim every shark kills every clownfish.
- **Recovery and pass:** Direct transfer is refused for the hard match. The unresolved case remains blocked or controlled according to its explicit conditions.
- **Claims:** `ORG-008`, `ORG-009`.

### AS-09: Microfauna boom and crash

- **Action:** Increase food and refuge, then add predation, filtration export, treatment pressure, siphoning, or resource loss.
- **Expected state and delay:** A mode-correct microfauna population grows, changes life-stage structure, redistributes, or crashes through explicit demographic pressures.
- **Feedback and diagnosis:** Spatial samples, night observation, filter capture, predator and feed histories explain the trend imperfectly but usefully.
- **Recovery and pass:** Restoring verified resources or refuge, reducing a proximate excess, or changing capture pressure alters the population trend. No cleanup value deletes mass.
- **Claims:** `ORG-004`, `ORG-005`, `ORG-010`.

### AS-10: Overfeeding and cleanup consequences

- **Action:** Feed more than inhabitants capture, then add cleanup organisms without accounting for their food needs.
- **Expected state and delay:** Uneaten food, detritus, oxygen demand, excretion, nutrients, microbial activity and maintenance load rise. Cleanup organisms transform material and can starve after resource collapse.
- **Feedback and diagnosis:** Leftover distribution, feeding response, scavenger activity, oxygen and nutrient trends, and filter load remain visible.
- **Recovery and pass:** The player protects oxygen, removes accessible leftovers, corrects input and feeding zones, exports matter explicitly, and verifies both animal intake and water trend.
- **Claims:** `ORG-005`, `ORG-010`, `ORG-014`, `MR-007`, `FW-010`.

### AS-11: Breeding with and without grow-out capacity

- **Action:** Meet maturity, compatibility, cue and spawning-habitat requirements first without, then with, commissioned first-food, larval and grow-out capacity.
- **Expected state and delay:** The first attempt is refused or safely suppressed before dependent offspring are created. The complete chain permits the taxon-specific reproductive path and life-stage transitions.
- **Feedback and diagnosis:** The prerequisite panel shows exactly which biological, habitat or capacity gate is missing. Success exposes egg, larval, settlement, juvenile and breeder-cost state as applicable.
- **Recovery and pass:** The player can disable cues, separate animals, restore breeder condition or commission the missing dependent system. Breeding is never a context-free random reward.
- **Claims:** `ORG-003`, `ORG-013`, `ORG-014`.

### AS-12: Equipment degradation and failure

- **Action:** Allow a pump, heater, filter, light, probe or consumable to degrade, then compare a service action, redundancy switch and replacement upgrade.
- **Expected state and delay:** Delivered capacity, local coverage, control, observability, wear, heat, noise or failure state changes according to the component mechanism.
- **Feedback and diagnosis:** Telemetry, sound, water motion, trend, calibration and isolated component tests distinguish bad observation from bad delivered performance.
- **Recovery and pass:** Service or redundancy restores measured function. A more expensive wrong-dimension upgrade does not remove the original bottleneck.
- **Claims:** `SP-007`, `SP-008`, `GP-003`, `GP-005`, `GP-006`.

### AS-13: Power outage and restart

- **Action:** Interrupt power long enough to stop multiple systems, use backup oxygen or circulation, then restore power.
- **Expected state and delay:** Flow, gas, heat and filtration change together; restart may also exercise drain, overflow and dry-run states.
- **Feedback and diagnosis:** Power, oxygen or behavior, temperature, level, equipment status and restart logs provide fair warning.
- **Recovery and pass:** The player prioritizes life support, reduces new load, restores equipment in a safe sequence, inspects restart, and verifies water plus organism trends.
- **Claims:** `SP-003`, `SP-008`, `FW-010`, `GP-005`, `GP-006`.

### AS-14: Cross-mode separation

- **Action:** From a freshwater project, attempt to buy or transfer a coral, marine fish, marine live rock, marine biofilter seed, salt mix, reef salinity control, conductivity-dependent marine ATO sensor, or default marine skimmer effect. Repeat with freshwater livestock, disinfectant treatment, plant control and microbial seed in a reef project.
- **Expected state and delay:** Every mismatch is rejected before inventory, currency, plumbing, fluid or organism state changes.
- **Feedback and diagnosis:** The refusal names the source and target namespaces, the incompatible mechanism, and the correct mode-specific category.
- **Recovery and pass:** Only a new project in the correct namespace can use the item. A common name, shared equipment class, or visual similarity cannot bypass the boundary.
- **Claims:** `FW-009`, `GP-004`, `ORG-007`.

### AS-15: Gross sign and diagnostic uncertainty

- **Action:** Present a fish or coral gross sign that has multiple environmental, injury and disease hypotheses, plus one drifting sensor.
- **Expected state and delay:** The UI records a syndrome and differential while the true cause continues to affect state. It does not reveal an etiologic diagnosis automatically.
- **Feedback and diagnosis:** Water checks, sensor calibration, spatial pattern, cohort and transfer history, feeding and progression narrow the hypotheses.
- **Recovery and pass:** The player protects or isolates organisms, fixes verified environmental causes, and can use medication only if a later curated diagnosis and compatible treatment context authorizes it.
- **Claims:** `SP-007`, `MR-012`, `ORG-011`, `ORG-012`, `ORG-014`.

### AS-16: Freshwater plant harvest and top-off

- **Action:** Grow plants under a selected profile, top off evaporated water repeatedly, then remove plant biomass and perform a separately justified water change.
- **Expected state and delay:** Top-off restores water but does not export accumulated solutes. Plants store assimilated material; harvest exports the removed biomass.
- **Feedback and diagnosis:** Conductivity or hardness, nutrients, plant mass, detritus, top-off composition and export ledger show distinct effects.
- **Recovery and pass:** The player corrects reservoir composition, harvests deliberately, and uses a water change for waterborne export when trends require it. Plants never become magic filtration.
- **Claims:** `FW-004`, `FW-008`, `SP-005`.

## Mechanic-to-claim traceability index

| Gameplay system | A0 causal claims | Product and tuning classification |
|---|---|---|
| Core loop and feedback | `GP-002`, `SP-007`, `MR-012`, `FW-010`, `ORG-011` | Cue salience, latency and assistance are `TBV`; uncertainty is causal. |
| Measurement and chemistry dashboard | `SP-001`, `SP-002`, `SP-005`, `SP-007`, `MR-008`, `MR-009`, `MR-010`, `MR-011`, `FW-002` | Profile selection and alert presentation are `TBV` or `DI`; unit basis and scoped profiles remain explicit. |
| Lifecycle and progression | `GP-001`, `GP-005`, `GP-007` | Mission order, pacing and rewards are `TBV`; readiness and welfare are not. |
| Hard mode boundary | `FW-009`, `GP-004`, `ORG-007` | Project immutability and UI layout are `DI`; no-leak behavior is `EWC`. |
| Tank planning and adult preview | `SP-001`, `MR-001`, `FW-007`, `ORG-006`, `ORG-007`, `ORG-008` | Visualization and forecast presentation are `DI` or `TBV`; adult fit is `EWC`. |
| Habitat and hardscape | `MR-004`, `MR-005`, `FW-005`, `ORG-004`, `ORG-005` | Placement tools are `DI`; material consequences are causal. |
| Marine water and reef ATO | `SP-004`, `SP-005`, `MR-002`, `GP-006` | Control thresholds and convenience are `TBV`; unsalted purified freshwater replacement is required. |
| Freshwater source and top-off | `FW-001`, `FW-002`, `FW-004`, `FW-009` | Preparation UI is `DI`; disinfectant and mineral consequences are causal. |
| Equipment commissioning | `SP-002`, `SP-007`, `SP-008`, `GP-003`, `GP-006` | Profile values and reliability are `TBV`; actual delivered performance is required. |
| Fishless cycling and stability | `SP-006`, `MR-003`, `FW-003` | Challenge magnitude and tutorial pacing require parameter profiles; no timer unlock. |
| Ugly phases and cyanobacteria | `MR-006`, `MR-007`, `FW-006`, `FW-010` | Visual intensity and incident frequency are `TBV`; ecology remains contingent. |
| Acquisition and compatibility | `ORG-006`, `ORG-007`, `ORG-008`, `ORG-009`, `ORG-012`, `ORG-014` | Messaging is `TBV`; hard-gate order and unknown handling are `EWC`. |
| Feeding and maintenance | `SP-005`, `ORG-005`, `ORG-010`, `FW-008` | Schedule and economy are `TBV`; intake, waste and export are causal. |
| Coral polyps and placement | `MR-009`, `MR-010`, `ORG-001`, `ORG-002`, `ORG-003`, `ORG-008` | Animation detail and hint bands are `TBV`; no universal health score or PAR target. |
| Microfauna and hitchhikers | `ORG-004`, `ORG-005`, `ORG-010`, `FW-009` | Sampling and discovery presentation are `TBV`; population and matter flows are causal. |
| Breeding and grow-out | `ORG-003`, `ORG-013`, `ORG-014` | Probability and reward are `TBV`; prerequisite and capacity gates are `EWC`. |
| Equipment shop and upgrades | `SP-008`, `ORG-006`, `GP-003`, `GP-004`, `GP-005`, `GP-008` | Price, availability, wear and repair values are `TBV`; mechanisms and boundaries are causal. |
| Incidents and recovery | `SP-007`, `SP-008`, `MR-012`, `FW-010`, `GP-002`, `GP-006` | Failure distributions and time pressure are `TBV`; causal mutation and verified recovery are required. |
| Difficulty, accessibility and loss | `SP-007`, `ORG-014`, `GP-002`, `GP-007` | Assistance, checkpoint and accessibility implementation are `TBV`; welfare gates never change. |
| Time progression | `SP-006`, `SP-009`, `GP-001`, `GP-007` | Compression rate and pause behavior are `TBV`; conservation and event handling remain causal. |
| Economy and long-term goals | `GP-005`, `GP-008`, `ORG-013`, `ORG-014` | All monetary and pacing values are `TBV`; harmful incentives are prohibited. |

## Handoff and validation contract

The following criteria governed integrated review and final acceptance:

- every required loop above is represented in the parameter model by compatible state or an explicit implementation requirement;
- marine reef and freshwater names, catalogs, fluids, microbes, equipment behavior, and examples remain separated across the package;
- reef ATO adds unsalted purified freshwater for evaporation only;
- livestock hard gates precede affordability and soft compatibility;
- shark restrictions use curated adult geometry and prey profiles;
- coral, microfauna, cleanup, feeding, breeding, equipment, and incident systems conserve causal meaning;
- all prices, rewards, pacing, failure probability and convenience choices remain labeled `TBV`;
- integrated review samples the claim mappings against the exact evidence revision and checks the companion links.

RAQ-V1 integrated causal, science, welfare, traceability, and cross-file review, all activated bounded corrections, and RAQ-F1 final packaging are complete for this evidence revision. No required automated validation remains. Optional audience feedback did not gate closeout.
