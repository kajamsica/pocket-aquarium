# RAQ-R1 Marine Reef Setup, Chemistry, Cycling, and Succession Research Packet

Evidence revision: `reef-packet-v1-2026-09-02`

## Bottom line

A defensible marine reef simulation should not implement one universal recipe or a scripted sequence of ugly phases. It should model a purpose-sized saltwater system whose chemistry, biofilter capacity, light, water motion, organic loading, inoculation history, and disturbance history create opportunities for competing microbial and benthic guilds. The most transferable rules are mass conservation, nitrogen transformation, gas exchange, carbonate buffering, species-specific environmental requirements, and the lag between adding biological load and building enough process capacity.

The strongest commissioning gate is functional, not calendar-based: no animal should be used to establish the biofilter, and livestock should remain locked until an empty system can process a defined nitrogen challenge without residual ammonia or nitrite at the test endpoint. The veterinary literature warns that a new biofilter can take up to about eight weeks to establish, while an institutional marine-animal guide gives about 30 days as a typical example. Both instruct observation and water-quality testing rather than reliance on elapsed time alone ([Merck Veterinary Manual](https://www.merckvetmanual.com/exotic-and-laboratory-animals/aquarium-fish/management-of-aquarium-fish), [Oregon State University Hatfield Marine Science Center](https://hmsc.oregonstate.edu/facilities/animal-care/animal-care-resources)).

The common hobby narrative of a predictable diatom, cyanobacteria, dinoflagellate, then green-algae sequence is not established as a universal ecological law. A small aquarium study found clear microbial succession and multiple stable community states, but it followed only two systems and microbial changes did not always track water chemistry ([Bik et al., 2019](https://pubmed.ncbi.nlm.nih.gov/30787117/)). The simulation should therefore make visible outbreaks contingent and partly stochastic, not mandatory milestones.

## Original question and lane question

**Original question:** What evidence should support a future hyperrealistic interactive 3D reef and freshwater aquarium simulation, including realistic setup, chemistry, evaporation and top-off, maturation, ugly phases, livestock, polyps, micro-invertebrates, feeding, breeding, equipment, incidents, and progression?

**RAQ-R1 lane question:** What marine-only baseline is defensible for purpose-driven system sizing, initial reef setup, seawater and salinity, nitrogen cycling, rock and substrate choices, filtration and flow, chemical operating profiles, microbial succession, ugly-phase organisms, maturation, nutrient imbalance, and corrective action?

This packet does not define the freshwater rules, species-by-species welfare requirements, coral polyp behavior, lighting recipes, or whole-game progression. Those must be integrated by other lanes. Marine and freshwater systems must remain separate chemistry and livestock rule sets.

## Evidence labels used in this packet

| Label | Meaning | How A0 should use it |
|---|---|---|
| Evidence-backed fact | Supported by primary literature or a public institutional source | Implement as a mechanism, while preserving its stated scope |
| Facility operating profile | A target used by one research or public-aquarium system | Offer as a selectable profile, never as a universal safe range |
| Husbandry convention | Recognized practice with weaker or mixed direct evidence | Present as guidance or an optional strategy |
| Welfare constraint | Rule that prevents avoidable exposure or suffering | Implement as a hard gate that can override player preference |
| Game-design inference | Mechanic derived from evidence but not itself tested as animal-outcome science | Keep tunable and label in design documentation |
| Unknown | Evidence is insufficient, conflicting, or strongly species-specific | Require a species or system profile, or leave unresolved |

## 1. Purpose-driven tank volume and dimensions

### Evidence-backed position

There is no defensible universal gallons-per-coral, gallons-per-fish, or pounds-of-rock-per-gallon rule. NOAA's coral-system guide states that tank size depends on space, practicality, biomass per volume, and duration, and it explicitly says there is no standard tank-size-to-biomass ratio. It also notes that larger water volumes tend to be more stable under greater biological load and longer duration, but cost more and take more space ([NOAA coral-system guide](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)).

Volume and geometry solve different problems:

- Total operating water volume determines the dilution reservoir for waste, supplements, evaporation error, and heat input. The useful value is actual system water volume after displacement by rock, sand, equipment, and the air gap, not the tank's advertised capacity.
- Length and unobstructed footprint constrain swimming routes, territorial separation, rock placement, and access for cleaning. Those are species and welfare questions that a nominal gallon number cannot answer.
- Depth changes hydrostatic placement, light attenuation, gas-exchange geometry, and the difficulty of obtaining suitable flow at the benthos.
- Surface area, overflow design, and water motion affect gas exchange. A large nominal volume does not compensate for inadequate oxygenation or poor circulation.
- Sump or reservoir water increases system volume and equipment capacity, but it does not enlarge an animal's display footprint or swimming path.

### Required simulation sizing flow

1. Select the intended habitat and organisms first.
2. Apply hard species gates for adult size, swimming mode, territory, depth, substrate, social group, predation, and escape risk.
3. Calculate actual operating volume and open footprint after aquascape displacement.
4. Size life support against peak expected feeding and waste load, not only current animal count.
5. Reserve hydraulic capacity for pump-off drain-down and evaporation range.
6. Reject the build if any welfare gate fails, even when chemistry equipment could keep the water analytically clean.

**Game-design inference:** Larger volume should slow concentration and temperature changes for the same absolute perturbation, but it should not grant a blanket compatibility bonus. Geometry and adult-animal rules must remain independent state variables.

## 2. Initial marine setup sequence

The following is a defensible order of operations, not a claim that every competent aquarist uses an identical workflow.

| Phase | Required action | Evidence status and rationale | Completion evidence |
|---|---|---|---|
| 1. Define the system | Lock marine mode, habitat profile, actual volume, footprint, expected biomass, substrate policy, source-water policy, and life-support architecture | Evidence-backed planning requirement. NOAA makes size, water, lighting, hydrodynamics, filtration, biomass, and duration interdependent ([NOAA coral-system guide](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) | A coherent design profile with no failed welfare or hydraulic gate |
| 2. Dry commissioning | Level and support the tank, leak-test plumbing, verify overflow and pump-off capacity, fit drip loops and protected electrical distribution, and confirm access for service | Husbandry and engineering convention. The game should model leakage and flood risk, but exact building-load rules are jurisdiction-specific | Leak test, pump-off test, and service-access check pass |
| 3. Prepare source water | Use purified freshwater suitable for the selected artificial salt, measure it, add salt to water, circulate and aerate, then verify salinity and temperature | NOAA recommends DI, RO, or RO/DI freshwater with vigorous agitation or aeration and recommends overnight equilibration for its experimental protocol ([NOAA coral-system guide](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) | Mixed water has equilibrated and matches the selected profile |
| 4. Build habitat | Secure rockwork against collapse, create cleaning access and flow paths, add the chosen sand or leave the bottom bare, then fill without destabilizing the structure | Welfare constraint plus husbandry convention. Rock mass per gallon and sand depth are not universal | Stable structure, usable habitat, no trapped pump intakes or inaccessible hazard zones |
| 5. Start life support | Run circulation, temperature control, gas exchange, biological media, and monitoring. Use mechanical filtration as needed for construction dust | Evidence-backed process requirement. Nitrification is aerobic and biofilms require wetted surface and oxygenated flow ([SRAC 4502](https://www.uprm.edu/edpac/wp-content/uploads/sites/13/2024/05/starting_biofilter.pdf)) | Stable temperature, salinity, circulation, and oxygenation |
| 6. Inoculate and feed the cycle | Add a non-animal nitrogen source and, optionally, established biofilm-bearing media from a biosecure source | Welfare constraint. Merck describes fishless cycling and warns that gradual cycling with live fish can be inhumane ([Merck Veterinary Manual](https://www.merckvetmanual.com/exotic-and-laboratory-animals/aquarium-fish/management-of-aquarium-fish)) | Ammonia rises and then conversion to nitrite and nitrate is observed |
| 7. Prove capacity | Re-test ammonia, nitrite, nitrate, pH, alkalinity, salinity, and temperature. Challenge the system with a defined nitrogen input and confirm clearance | Game-design inference grounded in biofilter function. A zero reading without a known recent input can mean no load rather than adequate capacity | Defined challenge clears within the profile's validation window, with no residual ammonia or nitrite |
| 8. Introduce light and animals gradually | Apply the habitat's light profile, quarantine animals through the appropriate downstream rule set, and increase biological load in steps | Welfare constraint plus husbandry convention. The biofilter adapts to load; a passed empty-tank cycle is not infinite capacity | Each addition is preceded by compatibility, quarantine, and capacity checks |

No stage should require sacrificing fish or invertebrates. A player who attempts fish-in cycling should encounter a hard welfare warning and, in modes that enforce ethical husbandry, a blocked action.

## 3. Seawater mixing, salinity, evaporation, and top-off

### Seawater mixing

Artificial seawater mixes are formulations, not interchangeable quantities of pure sodium chloride. NOAA advises preparing artificial seawater with DI, RO, or RO/DI freshwater, vigorous mixing or aeration, preferably overnight equilibration with atmospheric carbon dioxide, and at least a salinity check before use ([NOAA coral-system guide](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)). The guide also warns that freshly mixed water can show elevated pH before equilibration.

A simulation should track at least source-water impurity load, salt mass, freshwater mass, temperature, mixing time, aeration, and whether a measurement instrument is calibrated for seawater. Specific gravity is temperature- and method-dependent; salinity in parts per thousand or practical salinity should be the canonical internal variable, with instrument readings derived from it.

### Evaporation mass balance

Evaporation removes water while leaving ordinary dissolved sea salts behind. NOAA states that salinity rises as aquarium water evaporates and recommends slow addition of DI water in a high-flow area to restore it ([NOAA coral-system guide](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)). A University of Florida extension guide likewise specifies fresh RO top-off because the salt has not evaporated ([UF/IFAS marine aquarium guide](https://ask.ifas.ufl.edu/publication/4H433.pdf)).

For a simplified, well-mixed system in which salt mass is conserved and salinity is treated as proportional to concentration:

```text
S_after = S_before * V_before / V_after
```

Example: a 100 L system at 35 ppt that loses 2 L of water becomes approximately 35.714286 ppt before top-off. Restoring 2 L of purified freshwater returns the simplified model to approximately 35 ppt. The arithmetic was independently checked with a deterministic calculation. A high-fidelity implementation should conserve water and dissolved-solute masses and account for density, displacement, splashing, salt creep, water removal, and additions rather than treating volume as exact mass.

**Hard marine rule:** An automatic top-off unit replaces evaporated water with unsalted purified freshwater, normally RO/DI. It is not a saltwater-change system and not a dosing pump. Water changes remove both water and dissolved material, then replace the removed seawater with matched new seawater. Top-off and water change must be separate actions.

### ATO fault states for downstream modeling

| Fault | Physical result | Immediate clues | Corrective logic |
|---|---|---|---|
| Reservoir empty or pump failed | Water level falls and salinity rises | Falling return-section level, pump noise or bubbles, upward salinity trend | Restore top-off cautiously, verify salinity and pump condition |
| Float or optical sensor stuck on | Excess freshwater enters, water level rises, salinity falls, overflow risk increases | ATO runtime anomaly, falling salinity, high-water alarm | Stop ATO, remove excess only with a matched correction plan, repair sensor |
| Saltwater placed in ATO reservoir | Evaporated water is replaced but salt mass also rises | Salinity continues upward despite stable water level | Stop, replace reservoir with purified freshwater, correct salinity slowly |
| Dosing solution placed in ATO reservoir | Evaporation rate controls an unrelated chemical dose | Chemistry changes correlate with weather, fan use, or lid state | Disconnect dosing from top-off and correct the affected chemistry |
| Sensor mounted in unstable chamber | Wave or return-pump state causes short cycling or false refill | Rapid on-off events and salinity noise | Move sensor to a stable return chamber and add runtime safeguards |

These fault responses are design inferences from mass conservation. Exact correction rates and animal tolerances are species-specific and belong in the welfare profile.

## 4. Nitrogen cycle and biofilter capacity

### Transferable mechanism

1. Feeding, animal excretion, dead organisms, and degrading organic matter add reduced nitrogen to the system.
2. In seawater, un-ionized ammonia, NH3, and ammonium, NH4+, coexist. Their proportions depend strongly on pH and temperature, so reports must state whether a result is total ammonia nitrogen, total ammonia, NH3, or NH4+ and whether it is expressed as nitrogen or as the full ion. NOAA cautions that test methods differ and that un-ionized ammonia is the more toxic form ([NOAA coral-system guide](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)).
3. Aerobic ammonia oxidizers convert ammonia to nitrite. Aerobic nitrite oxidizers convert nitrite to nitrate. Saltwater filters can contain ammonia-oxidizing archaea, ammonia-oxidizing bacteria, nitrite-oxidizing bacteria, and complete ammonia oxidizers, so the game should not hard-code a two-species textbook story ([new public saltwater aquarium study](https://pmc.ncbi.nlm.nih.gov/articles/PMC12108315/), [comammox aquarium-biofilter study](https://pmc.ncbi.nlm.nih.gov/articles/PMC11267875/)).
4. Nitrification consumes oxygen and alkalinity and is acid-producing. Oxygen limitation, inadequate wetted media, clogging, loss of flow, abrupt load increases, and insufficient buffering can therefore reduce capacity or depress pH ([SRAC 451](https://extension.rwfm.tamu.edu/wp-content/uploads/sites/8/2013/09/SRAC-Publication-No.-451-Recirculating-Aquaculture-Tank-Production-Systems-An-Overview-of-Critical-Considerations.pdf), [SRAC 4502](https://www.uprm.edu/edpac/wp-content/uploads/sites/13/2024/05/starting_biofilter.pdf)).
5. Nitrate is not made harmless merely because the ammonia spike ended. It must be managed through water exchange, biological assimilation followed by harvest, or suitable denitrifying processes. Each path has a capacity and possible side effects.

### Readiness and capacity

The cycle is not a binary flag. The simulation should maintain a process capacity in mass of total ammonia nitrogen converted per day. Capacity grows with colonized oxygenated surface, temperature and pH suitability, oxygen, alkalinity, and substrate availability. It falls with drying, toxic exposure, extended starvation, flow loss, severe cleaning, or media replacement.

**Welfare constraint:** Cycling must be fishless. Merck notes that new-tank syndrome commonly occurs in the first six weeks and that a tropical biofilter can take up to eight weeks to establish. Oregon State gives around 30 days as a typical tropical marine or freshwater example and recommends daily water-quality testing during cycling ([Merck Veterinary Manual](https://www.merckvetmanual.com/exotic-and-laboratory-animals/aquarium-fish/management-of-aquarium-fish), [Oregon State University Hatfield Marine Science Center](https://hmsc.oregonstate.edu/facilities/animal-care/animal-care-resources)). These are variable observations, not completion timers.

## 5. Rock, sand, filtration, and water motion

### Live rock and dry or artificial rock

Established live rock can introduce complex biofilms and nitrogen-transforming organisms. In one two-aquarium study, adding established live rock and sediment on day 12 was followed by rapid microbial-community change, increased representation of nitrogen-transforming taxa, and falling ammonia and nitrite. A second live-rock addition on day 45 changed the community again without loss of nitrogen-cycle function ([Bik et al., 2019](https://pubmed.ncbi.nlm.nih.gov/30787117/)). An earlier controlled study found that coralline-covered live rock supported nitrogen removal and microbial nitrogen pathways under its experimental conditions ([Yuen et al., 2009](https://doi.org/10.1016/j.aquaeng.2009.06.004)).

Live rock also carries uncertainty. Shipping-related die-off can create an organic and ammonia load, and imported material can carry unwanted organisms. Bik et al. describe curing shipped live rock before introduction because of decaying material ([Bik et al., 2019](https://pubmed.ncbi.nlm.nih.gov/30787117/)). Biosecure aquacultured or established captive material therefore deserves a different risk profile from freshly shipped wild-collected material.

Dry or manufactured porous rock supplies structure and future biofilm area but does not begin with a mature living community. It needs deliberate inoculation and time. Artificial porous rock can also reduce pressure associated with extracting wild live rock; one study evaluated oyster-shell-based artificial live rock as a nitrifying alternative ([Liu et al., 2022](https://www.sciencedirect.com/science/article/abs/pii/S0959652621035113)). The simulation should not assign a universal amount of rock per gallon. Porosity, exposed surface, flow, fouling, habitat geometry, and actual nitrification capacity matter more than gross mass.

### Sand and bare bottom

Sand supplies habitat and surface for microbes and small benthic organisms, traps or transports particles depending on grain size and flow, and can develop steep oxygen gradients. Bare bottoms simplify detritus observation and removal but remove burrowing habitat and much benthic area. Neither choice is universally superior. Grain size, bed depth, animal requirements, circulation, cleaning regime, and disturbance risk should be separate variables.

**Game-design inference:** Treat the bed as spatial cells with oxygen, organic matter, porewater nutrients, particle size, bioturbation, and local flow. Deep or poorly exchanged cells can become chemically different from the water column. Do not reduce all sand to a passive decoration or a fixed nitrate-removal bonus.

### Filtration functions

| Function | What it does | Failure or tradeoff |
|---|---|---|
| Biological surface | Hosts biofilms that transform nitrogen and other compounds | Capacity lags load, depends on oxygenated flow, and can be lost by drying or over-cleaning |
| Mechanical capture | Removes suspended particles from circulation for later disposal | Captured material continues decomposing if media is not serviced |
| Protein skimming | Removes some suspended particles and dissolved organic compounds, while aiding aeration and gas exchange | Performance depends on design, water level, air intake, and tuning. It is not a substitute for biofiltration or water changes ([NOAA coral-system guide](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Activated media and adsorbents | Bind selected dissolved substances | Media is selective and exhaustible; aggressive use can create nutrient imbalance |
| Water exchange | Dilutes accumulated products and restores the salt mix's ionic profile | New water must be matched; a water change is not top-off. Required frequency depends on load and filtration ([NOAA coral-system guide](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Refugium or harvested primary production | Converts available nutrients into biomass that can be removed | Needs suitable light and export. Biomass death returns stored material |

### Flow

NOAA states that no single flow standard applies to corals. Many small-polyp stony corals benefit from stronger motion, while some low-flow-adapted species respond poorly to excessive current. The same guide calls ten tank volumes per hour only a rule of thumb and recommends avoiding a direct unidirectional jet in favor of more variable turbulent motion ([NOAA coral-system guide](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)).

The simulation should distinguish:

- return-system turnover from in-display circulation;
- pump nameplate flow from delivered flow after head pressure and fouling;
- bulk flow from local velocity at each coral or substrate cell;
- steady laminar exposure from oscillating or turbulent flow;
- sufficient movement for gas exchange and detritus transport from damaging tissue-level shear.

## 6. Structured marine state-variable table

The bands below are not universal safety limits. Most are either the Steinhart Aquarium Philippine Coral Reef exhibit's operating targets or NOAA's narrow experimental-coral recommendations. They are useful selectable baselines because their context is known. NOAA itself says origin can require different temperature and salinity, and the Steinhart values describe one unusually large, professionally managed mixed reef ([Steinhart husbandry paper](https://www.mdpi.com/2673-5636/4/4/52), [NOAA coral-system guide](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)).

| State variable | Unit | Reference operating band or condition | Concern band or trigger | Principal causal inputs and outputs | Evidence type and confidence |
|---|---|---|---|---|---|
| Actual system water | L or US gal | Purpose-sized after displacement; no universal numeric band | Below animal footprint, dilution, pump, or drain-down requirement | Tank geometry, sump, rock, sand, water level, evaporation | Fact, high for volume calculation; species threshold unresolved |
| Salinity | ppt or practical salinity | Steinhart 33 to 36 ppt; NOAA experimental recommendation 35 ppt | Outside the selected habitat profile or changing faster than its species tolerance | Salt and water mass, evaporation, top-off, water changes, leaks, salt creep | Facility profile, high for reported values; universal safety low ([Steinhart](https://www.mdpi.com/2673-5636/4/4/52), [NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Temperature | degrees C | Steinhart 24 to 26 C; NOAA experimental 24.5 to 28 C | Outside species-origin profile, abrupt change, or equipment runaway | Room, lights, pumps, heater, chiller, evaporation | Facility profile, high for reported values; species-specific ([Steinhart](https://www.mdpi.com/2673-5636/4/4/52), [NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Dissolved oxygen | percent saturation, plus mg/L | Stable near the selected system setpoint; report saturation because solubility changes with temperature and salinity | Persistent decline, large night minimum, poor gas exchange, or animal respiratory distress | Photosynthesis, respiration, temperature, salinity, aeration, surface exchange, bacterial demand | Mechanism, high; universal coral threshold unresolved ([FAO oxygen guidance](https://www.fao.org/fishery/docs/CDrom/aquaculture/a0844t/docrep/009/T1623E/T1623E03.htm)) |
| pH | total-scale preference for scientific model | Steinhart 8.0 to 8.4; NOAA experimental 8.1 to 8.3 | Outside chosen profile, abrupt movement, or widening diel swing | Carbon dioxide, gas exchange, photosynthesis, respiration, alkalinity, dosing | Facility profile and mechanism, high ([Steinhart](https://www.mdpi.com/2673-5636/4/4/52), [NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Total alkalinity | mEq/L and dKH | Steinhart 3.0 to 3.5 mEq/L; NOAA experimental 8 to 10 dKH. NOAA gives 1 mEq/L = 2.8 dKH = 50 mg/L as CaCO3 | Outside selected profile, rapid dosing change, or inability to buffer biological acid production | Salt mix, calcification, nitrification, acids and bases, water changes | Facility profile and chemistry, high ([Steinhart](https://www.mdpi.com/2673-5636/4/4/52), [NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Calcium | mg/L | Steinhart 400 to 460 mg/L; NOAA experimental 380 to 450 mg/L | Outside selected calcifier profile or changing inconsistently with alkalinity | Salt mix, calcification, precipitation, water changes, supplements | Facility profile, high for reported values ([Steinhart](https://www.mdpi.com/2673-5636/4/4/52), [NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Magnesium | mg/L | Steinhart 1300 to 1400 mg/L; NOAA experimental 1250 to 1350 mg/L | Outside chosen profile or ionic imbalance | Salt mix, water changes, supplements, precipitation | Facility profile, high for reported values ([Steinhart](https://www.mdpi.com/2673-5636/4/4/52), [NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Ammonium, NH4+ | mg/L, specify as ion or N | Steinhart target below 0.01 mg/L as NH4+ | Any sustained post-cycle increase or any species-specific welfare threshold | Excretion, decay, feeding, ammonia oxidation, water exchange | Facility profile, moderate because unit/speciation comparisons are easy to misuse ([Steinhart](https://www.mdpi.com/2673-5636/4/4/52)) |
| Total ammonia nitrogen | mg/L as N | No universal reef-safe band adopted; should clear the validated challenge | Detectable accumulation after stocking, rising trend, or failure to clear challenge | Same as above, plus pH and temperature control toxic NH3 fraction | Mechanism high, numeric universal threshold low ([NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Nitrite | mg/L, specify as ion or N | Steinhart target below 0.01 mg/L as NO2- | Sustained detectable concentration after cycling or failed challenge | Ammonia oxidation, nitrite oxidation, biofilter oxygen and surface | Facility profile, moderate across unit conventions ([Steinhart](https://www.mdpi.com/2673-5636/4/4/52)) |
| Nitrate | mg/L, specify as NO3- or N | Steinhart target below 10 mg/L as NO3-. NOAA experimental recommendation below 0.2 ppm | Above selected system profile, rapid rise, or an undetectable value paired with coral nutrient-starvation signs | Nitrification, feeding, uptake, harvest, denitrification, water exchange | Conflicting facility profiles, high confidence that no single number is universal ([Steinhart](https://www.mdpi.com/2673-5636/4/4/52), [NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Orthophosphate | mg/L as PO4 or P, must specify | Steinhart target below 0.15 mg/L as PO4; NOAA experimental recommendation below 0.03 ppm | Above selected profile, or persistently undetectable with a strongly skewed nitrogen-to-phosphorus supply | Feeding, decay, adsorption, precipitation, uptake, export, water exchange | Conflicting facility profiles plus strong evidence against a universal zero target ([Steinhart](https://www.mdpi.com/2673-5636/4/4/52), [NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf), [Rosset et al., 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5441187/)) |
| Dissolved inorganic N:P balance | molar ratio and absolute concentrations | Species and experiment profile required; no universal aquarium ratio | High nitrogen with phosphate limitation, or both nutrients below reliable detection with coral decline | Feeding composition, remineralization, selective adsorbents, dosing, uptake | Mechanism moderate to high, universal target low ([Wiedenmann et al., 2013](https://www.nature.com/articles/nclimate1661), [Rosset et al., 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5441187/)) |
| Dissolved or particulate organics | mg/L when measured, otherwise calibrated index | Stable system-specific baseline | Rapid rise, decaying biomass, cloudy water, surface scum, or high benthic oxygen demand | Feeding, mucus, death, detritus, skimming, mechanical capture, microbes | Mechanism moderate; hobby measurement often indirect |
| Dissolved silica | micromol/L Si(OH)4 or mg/L Si, specify basis | No validated universal reef-aquarium target | Source-water or substrate pulse coincident with identified diatom growth | Source water, salt, substrate leaching, dissolution, diatom uptake | Diatom requirement high, aquarium outbreak threshold low ([Scientia Marina review](https://scientiamarina.revistas.csic.es/index.php/scientiamarina/article/view/688)) |
| Display circulation | delivered L/h, tank volumes/h, and local cm/s | Species and geometry profile; ten volumes per hour is only a husbandry rule of thumb | Persistent dead zones, direct tissue-damaging jet, sand storm, poor gas exchange | Pumps, head loss, placement, fouling, rock geometry | Species-specific fact high; universal numeric target low ([NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) |
| Light at organism | micromol photons m-2 s-1 PAR, spectrum, and photoperiod | Species and acclimation profile required | Outside organism profile or changed too quickly | Fixture, depth, shading, water clarity, schedule | Important mechanism, but numeric bands deferred to lighting lane |
| Benthic guild cover | percent of each surface cell | Dynamic mosaic, not a universal target | Rapid expansion of a harmful mat or loss of functional diversity | Light, nutrients, grazers, inoculation, substrate, disturbance, local flow | Game-design state, moderate |
| Nitrification capacity | mg TAN-N converted per day | Greater than validated peak input with a configurable reserve | Load exceeds capacity or challenge fails | Colonized surface, oxygen, alkalinity, temperature, pH, toxins, cleaning | Game-design inference grounded in high-confidence process science |

### Important numeric conflict

NOAA's research-system recommendation of nitrate below 0.2 ppm and phosphate below 0.03 ppm is much tighter than Steinhart's large-exhibit targets of nitrate below 10 mg/L and phosphate below 0.15 mg/L ([NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf), [Steinhart](https://www.mdpi.com/2673-5636/4/4/52)). This is a real scope difference, not a number to average. NOAA's table is for controlled coral experiments and was adapted partly from aquarium husbandry sources. Steinhart reports one large, multi-taxa public exhibit. A0 should expose profile provenance and never label either set as the safe reef range.

## 7. Maturation and the ugly phase

### Better model: opportunistic guilds, not scripted stages

New surfaces are initially open ecological space. Inoculum arrives through water, rock, sand, animals, food, air, tools, and deliberate cultures. Temperature, salinity, light, nutrients, grazing, toxins, local flow, and disturbance then filter which organisms proliferate. A two-aquarium time series observed rapid changes after inoculation and multiple stable microbial states over three months, including community shifts that did not cause a nitrogen-chemistry failure ([Bik et al., 2019](https://pubmed.ncbi.nlm.nih.gov/30787117/)).

The term ugly phase is therefore best represented as a player-facing label for visible colonization and nuisance risk during a period of low ecological resistance, not as a scientific phase with fixed start and end dates.

| Guild or event | Evidence-backed enabling conditions | Visual or measured clue | What must not be assumed | Defensible response |
|---|---|---|---|---|
| Heterotrophic bacterial film or water-column bloom | Available dissolved and particulate organic matter, viable inoculum, suitable temperature, and oxygen | Slime or haze, falling oxygen, increased respiratory demand | Cloudiness identifies a species or proves a mature biofilter | Find and remove decay or overfeeding, verify oxygen and ammonia, improve mechanical export and aeration |
| Diatoms | Light, available silicon, other nutrients, and diatom inoculum. Diatoms have an obligate silicon requirement for their siliceous frustules ([Scientia Marina review](https://scientiamarina.revistas.csic.es/index.php/scientiamarina/article/view/688)) | Brown or golden dust/film, confirmed by microscopy | Every brown film is a diatom, every new tank must bloom, or silica alone predicts outbreak magnitude | Verify identity, source water, substrate and light; manually export if it threatens organisms; avoid treating a harmless film as an emergency |
| Green microalgae, turf, or filamentous algae | Light, available nitrogen and phosphorus, open substrate, suitable propagules, and insufficient grazing or export | Green film, turf, or filaments; nutrient tests can read low while biomass is taking nutrients up | A low water-column nutrient reading proves nutrients are unavailable, or one grazer controls every alga | Identify morphology, remove biomass, correct loading and export, apply compatible grazing only through livestock welfare rules |
| Benthic cyanobacterial mat | Multiple drivers can interact, including organic loading, bioavailable phosphorus and iron, light, temperature, and low-oxygen sediment interfaces. Marine cyanobacteria are diverse and not all fix nitrogen ([Ford et al., 2018](https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2018.00018/full)) | Cohesive colored mat, bubbles possible, low oxygen under the mat, microscope confirmation | Cyanobacteria is caused only by low flow or only by high phosphate; color alone identifies it | Siphon and export mat, reduce decay and organic loading, correct local detritus traps and oxygenation, verify nutrient balance, avoid unexamined broad antimicrobials |
| Benthic dinoflagellate-like outbreak | Species and strains differ in light, temperature, salinity, nutrient response, mixotrophy, life cycle, and toxin production ([Grigoriyan et al., 2024](https://pubmed.ncbi.nlm.nih.gov/38331537/), [Ostreopsis review](https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2020.00498/full)) | Brown strings, dust, mucus or bubbles may occur, but microscopy is needed for useful identification | All brown mucus is dinoflagellate, zero nitrate or phosphate is a universal cause, or UV and blackout are universal cures | Treat as an identification problem first; use genus or functional-trait-specific interventions and human-exposure precautions if a potentially toxic taxon is suspected |
| Coralline and other calcifying crusts | Suitable inoculum, light, calcium-carbonate chemistry, and time | Hard pink, purple, red, or other calcified crust depending on taxon | Its presence proves every water parameter is ideal | Treat as a competing benthic guild, desired in some profiles but still capable of fouling equipment |

### Cyanobacteria nuance

Benthic cyanobacterial mats can be normal members of reef communities yet become harmful when they expand. A review links mat abundance to context-dependent combinations of organic matter, phosphorus, iron, temperature, light, and water-quality change. Organic loading and low oxygen at the sediment interface can promote anoxia that releases reactive phosphate and iron from sediments. Mats can overgrow corals, with harm associated with oxygen deficiency, allelochemicals, abrasion, and light reduction ([Ford et al., 2018](https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2018.00018/full); [Brocke et al., 2015](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0125445)).

**Game-design inference:** Low local flow should increase risk indirectly when it permits particle deposition, diffusion limitation, or low oxygen. It should not be a universal direct cause flag. Increasing flow without correcting organic loading, source nutrients, or substrate conditions should sometimes relocate the problem rather than solve it.

### Dinoflagellate nuance and safety

Aquarium nuisance labels often group distinct benthic dinoflagellates together. A systematic review of Ostreopsis cf. ovata, the Prorocentrum lima complex, and Coolia malayensis found that culture conditions and strain origin affect growth, while other reviews document varied nutrition and toxicity ([Grigoriyan et al., 2024](https://pubmed.ncbi.nlm.nih.gov/38331537/), [Ostreopsis chemical-ecology review](https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2020.00498/full)). Some members can produce potent toxins, but genus appearance does not prove a particular strain is toxic.

The simulation should therefore support microscope identification, a trait record for benthic versus water-column behavior, toxin potential, mixotrophy, and intervention sensitivity. A blanket dinoflagellate-cure button would overstate the evidence. Human-exposure procedures for suspected toxins are outside this lane and require a safety review before inclusion.

## 8. Nutrient excess, limitation, and imbalance

Nitrate and phosphate should not be modeled as poisons whose ideal value is always zero. Corals and their symbiotic algae use nitrogen and phosphorus, and experimental studies show both positive and negative effects depending on species, nutrient form, amount, balance, feeding, light, and temperature.

- Long-term nutrient-limited experiments across several coral species found stagnating growth and calcification and eventual bleaching in the nutrient-limited condition, while controlled nutrient pulses supported the symbiosis ([Wiedenmann et al., 2023](https://www.nature.com/articles/s41586-023-06442-5)). This does not define a home-aquarium target.
- Phosphate undersupply, especially with high nitrogen relative to phosphorus, disrupted the coral-algal symbiosis and promoted bleaching in controlled experiments ([Rosset et al., 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5441187/), [Wiedenmann et al., 2013](https://www.nature.com/articles/nclimate1661)).
- A systematic review found coral responses to nutrient enrichment complex and recommended conservative interpretation, and a separate synthesis found genus and stoichiometry differences in skeletal response ([Nalley et al., 2023](https://repository.library.noaa.gov/view/noaa/57756/noaa_57756_DS1.pdf), [Buckingham et al., 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC10276130/)).

**Simulation consequence:** Use nonlinear response curves. Excess nitrogen or phosphorus can favor nuisance biomass and disturb coral physiology, but aggressive export to analytical zero can also create imbalance or starvation. Uptake can make the water test low while nutrients remain stored in algae, microbes, detritus, and animal biomass.

## 9. Corrective-action ladder

The game should reward diagnosis before treatment.

1. **Verify the observation.** Repeat the test, check units, calibration, expiration, sample handling, salinity compensation, and whether ammonia is reported as TAN, NH3, NH4+, or nitrogen. Use microscopy for visually ambiguous brown films.
2. **Protect organisms.** Pause livestock additions. If oxygen, ammonia, nitrite, temperature, or salinity is outside the selected welfare profile, stabilize gas exchange and circulation and perform an appropriately matched partial water change. Exact emergency thresholds and correction rates must come from species profiles.
3. **Remove the proximate load.** Remove dead material, reduce excess feeding, siphon mats or detritus, harvest algae, and service mechanical media before captured waste decomposes.
4. **Restore the failed process.** Check pump delivery, blocked media, skimmer air and water level, alkalinity, ATO behavior, source water, and whether a recent cleaning or medication damaged biofiltration.
5. **Correct balance gradually.** Change light, nutrient input, export, or chemistry one cause at a time where possible. Avoid chasing pH alone when carbon dioxide or alkalinity is the real driver.
6. **Use targeted interventions only after identification.** UV, adsorbents, antibiotics, algaecides, oxidants, and blackout strategies have taxon- and system-specific effects. Broad antimicrobial treatment can also damage beneficial biofilms. No universal chemical cure is supported by this packet.
7. **Confirm recovery by trend and function.** A clean-looking surface is not enough. Require stable oxygen, nitrogen conversion, chemistry, and organism behavior after the intervention.

## 10. Qualified timeline for the simulation

| Event | Defensible time statement | Variability warning |
|---|---|---|
| Artificial seawater preparation | NOAA's experimental protocol prefers overnight mixing and aeration before use ([NOAA](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)) | Product instructions and emergency contexts differ; completion is verified chemistry, not a universal clock |
| Biofilter establishment | Around 30 days is an institutional example for tropical marine systems; Merck says a tropical biofilter can take up to eight weeks ([Oregon State](https://hmsc.oregonstate.edu/facilities/animal-care/animal-care-resources), [Merck](https://www.merckvetmanual.com/exotic-and-laboratory-animals/aquarium-fish/management-of-aquarium-fish)) | Temperature, inoculum, surface, oxygen, alkalinity, pH, ammonia input, and test definition change the time. Require a capacity challenge |
| Response to established inoculum | In two experimental tanks, community changes were measurable within hours after established live rock and sediment were added on day 12 ([Bik et al., 2019](https://pubmed.ncbi.nlm.nih.gov/30787117/)) | This is a two-system case study, not a promise that seeding instantly completes a cycle |
| Visible early films and blooms | Days to weeks after light, nutrients, and inoculum become available is a plausible game window | This is a tunable husbandry inference. No guild or order is guaranteed, and an outbreak can recur much later after disturbance |
| Ecological maturation | Months and ongoing. A three-month aquarium study still observed succession and multiple stable states ([Bik et al., 2019](https://pubmed.ncbi.nlm.nih.gov/30787117/)) | There is no validated mature-on-day-X threshold. New animals, rock, cleaning, medication, flow changes, and outages can redirect succession |

## 11. Recommended causal model for A0

This section is game-design inference grounded in the mechanisms above.

### Core conserved pools

- Water mass
- Major dissolved-salt mass
- Reduced nitrogen, nitrite, nitrate, inorganic phosphorus, silica, alkalinity, calcium, magnesium, dissolved inorganic carbon, and oxygen
- Dissolved and particulate organic matter
- Living biomass by functional guild
- Settled detritus by spatial cell

### Process graph

```text
feeding and mortality
  -> dissolved and particulate organic matter
  -> ammonification and TAN
  -> ammonia oxidation
  -> nitrite
  -> nitrite oxidation
  -> nitrate

light + dissolved nutrients + inoculum + open surface
  -> photosynthetic guild growth
  -> grazing, harvest, detritus, or overgrowth

respiration + nitrification
  -> oxygen consumption + carbon dioxide / acid load

photosynthesis
  -> daytime oxygen gain + carbon dioxide drawdown + pH rise

evaporation
  -> water loss -> salinity rise

freshwater ATO
  -> water replacement -> salinity restoration
```

### Spatial modifiers

Each display cell should have light, local flow, shear, particle deposition, grazer access, substrate type, oxygen exchange, and neighboring cover. This permits a cyanobacterial mat to exploit an organic-rich low-oxygen pocket while another area remains clean, and permits a direct pump jet to damage one coral while bulk tank turnover appears adequate.

### Uncertainty and player feedback

- Provide measurement error, detection limits, and unit labels.
- Separate visible biomass from water-column concentration. A low nutrient test can coincide with rapid uptake into nuisance biomass.
- Show trend arrows and causal clues, not a single hidden health score.
- Represent inoculation and species arrival probabilistically within biosecurity constraints.
- Permit multiple stable functional communities, consistent with the small aquarium succession study.
- Label all numeric gameplay thresholds as profile values, validation thresholds, or tunable abstractions.

## 12. Source-quality summary

| Source class | Main uses in this packet | Strength | Limitation |
|---|---|---|---|
| NOAA technical memorandum | Coral-system design, mixing, parameter context, flow, salinity, evaporation, testing | Authoritative institutional synthesis with explicit context | Built for small experimental coral systems; some target numbers were adapted from husbandry literature |
| Peer-reviewed public-aquarium husbandry paper | One large mixed-reef operating profile | Direct, inspectable facility values | One highly managed exhibit, not a universal range |
| Peer-reviewed aquarium microbiome studies | Succession, inoculation, stable states, nitrifier diversity | Direct aquarium evidence | Few systems and specific protocols |
| Veterinary and university animal-care guidance | Fishless cycle welfare gate and variable timing | Strong welfare and operational authority | Broad aquarium guidance, not coral-species physiology |
| Peer-reviewed reef and coral ecology | Cyanobacterial drivers, coral nutrient limitation and enrichment | Mechanistic and primary evidence | Natural reefs or controlled experiments do not translate directly to home-aquarium thresholds |
| University extension husbandry guide | RO top-off convention and familiar workflow | Recognized educational source | Contains simplified hobby guidance, so it is not used here for universal chemistry or cycle rules |
| Hobby and vendor material | Background only | Useful for discovering common terms and claims | Not used as primary support for material mechanisms or numeric bands |

## 13. Limitations and unresolved specificity

- No universal minimum tank volume is supplied. Adult size, movement, social structure, territory, substrate, and husbandry profile must determine it.
- No universal salinity, temperature, pH, alkalinity, nitrate, phosphate, PAR, or flow target is defensible for all reef organisms. The table contains scoped facility profiles only.
- The two-aquarium microbiome study cannot establish a universal succession path, a universal healthy microbiome, or a mature-tank date.
- Aquarium-specific controlled evidence for nuisance dinoflagellate triggers and treatments is weak. Genus, strain, life history, mixotrophy, and toxin potential remain unresolved.
- A brown film cannot be reliably assigned to diatoms, dinoflagellates, or another guild from color alone.
- Cyanobacterial drivers are multicausal. Low flow is an indirect risk modifier, not a sufficient universal cause.
- Sand-bed redox and nutrient processing depend on depth, grain size, fauna, loading, and flow. This packet does not validate a universal sand depth.
- The parameter literature uses inconsistent units. TAN versus ammonia, ion versus element, and nitrate or phosphate as the ion versus as nitrogen or phosphorus must be explicit throughout the data model.
- The simplified evaporation equation is appropriate for an explanatory game layer, but the high-fidelity engine should conserve mass and handle density and non-evaporative losses.
- Exact welfare thresholds, safe rates of correction, quarantine rules, coral PAR profiles, and livestock compatibility require downstream species-specific work.

## 14. Downstream instructions for A0

1. Keep marine and freshwater systems as separate biological and chemistry rule sets. Reuse only valid physical mechanisms.
2. Preserve the locked ATO rule: purified unsalted freshwater replaces reef evaporation. Saltwater replaces removed saltwater during water changes.
3. Implement purpose-driven sizing and species geometry gates. Do not invent gallon-per-animal or rock-mass formulas.
4. Use the Steinhart and NOAA values as named selectable profiles with provenance, not averaged or universalized targets.
5. Store chemistry units and chemical basis in the schema. A numeric value without `as N`, `as ion`, salinity basis, pH scale, or temperature compensation can be misleading.
6. Replace a binary `cycled` flag with measured nitrogen-processing capacity and a fishless challenge gate.
7. Model ugly phases as probabilistic competition among functional guilds. Do not force a fixed diatom-to-cyanobacteria-to-dinoflagellate-to-green-algae progression.
8. Preserve non-monotonic nutrient effects. Do not reward players for driving nitrate and phosphate indiscriminately to zero.
9. Require identification and causal checks before high-impact treatments. Species or genus uncertainty should remain visible.
10. Route all numeric thresholds through habitat and organism profiles, and mark gameplay abstractions as tunable.
11. Carry the stated limitations into integrated review. The largest unresolved items are species-specific safe bands, aquarium dinoflagellate ecology, sand-bed parameterization, and treatment safety.
12. Integrate this research into the real audience entrypoint at `/Volumes/git/games/reef/reef_aquarium_research_packet.md`. This lane file is upstream evidence, not the final deliverable.
