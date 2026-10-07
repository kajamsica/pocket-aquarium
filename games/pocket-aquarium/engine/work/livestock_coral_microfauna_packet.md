# RAQ-R4 Evidence Packet: Coral Polyps, Livestock Compatibility, Microfauna, and Welfare

## Original Question Anchor

Produce evidence for a future hyperrealistic interactive 3D reef and freshwater aquarium simulation covering coral polyps, livestock compatibility, habitat constraints, predation, feeding, breeding, micro-invertebrates, health, biosecurity, and animal welfare. Marine and freshwater modes must remain separate. This packet supports downstream synthesis and drafting; it is not the final research package and does not claim that simulated outcomes predict real animal outcomes.

## Bottom Line

A biologically defensible organism model cannot be one universal “health bar” or one gallons-per-fish rule. It needs layered state for physiology, behavior, energy, reproduction, injury, and environment, plus curated species records and directional interaction rules. Coral polyps must be modeled as living modules connected within colonies, not as animated decoration. Local light, spectrum, flow, food, oxygen, carbonate chemistry, sediment, neighbors, injury, and disease risk can change polyp extension, feeding, photosynthesis, respiration, calcification, competition, bleaching, tissue loss, and recovery. These responses vary among species, genotypes, symbionts, life stages, and acclimation histories. [NOAA coral anatomy](https://cdhc.noaa.gov/coral-biology/coral-biology/), a [coral growth physiology review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3159950/), and a [coral photobiology review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4141621/) support this multi-driver treatment.

Livestock compatibility is directional and multidimensional. A shared temperature or salinity range is only one gate. Adult body size, habitat geometry, swimming mode, territory, social structure, diet, prey size, venom, coral predation, substrate, shelter, feeding access, life-support capacity, and breeding state all matter. Fish welfare literature rejects one standard criterion for all aquarium fishes and calls for species-specific assessment. [Fish Welfare in Public Aquariums and Zoological Collections](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/) documents this diversity. Shark husbandry makes the same point more strongly: no shark is “typical,” tank shape and unobstructed horizontal swimming space can be as important as water volume, and adult size and species-specific swimming behavior must drive facility design. [University of Florida IFAS shark selection guidance](https://ask.ifas.ufl.edu/publication/FA179) and the professional [Elasmobranch Husbandry Manual chapter](https://manuals.plus/m/537b9e3e7cd4ab08fb3c52622489ba8ab474a5ae48e93a284a6850d649a96b69) support curated shark gates rather than a universal minimum-gallon number.

Microfauna must be functional. Copepods, amphipods, worms, snails, small crustaceans, and plankton can graze, scavenge, deposit-feed, filter-feed, recycle nutrients, transfer energy to fish and corals, engineer sediment, compete, parasitize, or prey. “Cleanup crew” is a guild label, not proof that every member is beneficial or that nutrients disappear. A population should grow or crash with food, refuge, predation, harvesting, water conditions, filtration loss, and species-specific reproduction. Peer-reviewed evidence shows large functional variation even among aquarium cleanup snails, while copepod productivity depends on diet, habitat surface, harvesting, temperature, salinity, species, and strain. [Gastropod cleanup-crew comparison](https://pmc.ncbi.nlm.nih.gov/articles/PMC6023205/) and [harpacticoid copepod culture review](https://pubmed.ncbi.nlm.nih.gov/12846044/) support this rule.

## Evidence-Class Legend

| Label | Meaning | Downstream treatment |
|---|---|---|
| Fact | Directly supported biological or husbandry evidence | May be stated as evidence-backed with a nearby citation. |
| Husbandry convention | Professional practice, often context-specific rather than a biological law | Preserve the stated context and do not universalize. |
| Design inference | Simulation architecture inferred from several facts | Label as an inference and expose assumptions. |
| Tunable gameplay | Parameter chosen for playability rather than as a real-world prescription | Keep configurable and visibly non-authoritative. |
| Ethical or welfare restriction | A prohibited or mandatory behavior needed to avoid normalizing harmful husbandry | Implement as a hard gate unless downstream review finds a stronger rule. |

## Polyp Anatomy and Functional Basis

### Evidence anchors

- A coral polyp is the basic living unit of Anthozoa. It is a cylindrical sac with an oral disk, mouth, tentacles, gastrovascular cavity, mesenteries, epithelial layers, and, in stony corals, a basal relationship to a calcium-carbonate skeleton. Tentacles carry cnidocytes and nematocysts used in prey capture and defense. Respiration and excretion occur through tissue exchange with the surrounding water. [NOAA Coral Disease and Health Consortium anatomy](https://cdhc.noaa.gov/coral-biology/coral-biology/).
- Tentacles capture planktonic and particulate food. Mesenterial filaments participate in digestion and can be extended outside the mouth. Retractor muscles allow contraction and extension. [NOAA coral anatomy](https://cdhc.noaa.gov/coral-biology/coral-biology/).
- In colonial corals, common tissue and gastrovascular canals connect polyps and move resources and signals through the colony. A polyp can therefore have local state while the colony redistributes resources. [NOAA coral anatomy](https://cdhc.noaa.gov/coral-biology/coral-biology/).
- Most shallow reef-building corals host photosynthetic dinoflagellates in family Symbiodiniaceae. Host and symbiont exchange nutrients and metabolites; photosynthate supports coral metabolism, growth, and calcification. Symbiont identity and physiology vary, so “zooxanthellae” must not be one universal bonus. [NOAA zooxanthellae tutorial](https://oceanservice.noaa.gov/education/tutorial_corals/coral02_zooxanthellae.html) and [coral photobiology review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4141621/).
- Photosynthesis does not replace heterotrophy. Corals can capture plankton and particulate or dissolved organic material, and the relative contribution of autotrophy and heterotrophy varies among taxa and conditions. Heterotrophic food can support tissue and skeleton formation and may assist energy balance during stress, but it does not universally cancel heat, light, or chemistry damage. [Coral growth review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3159950/), [wound recovery and nutrition study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6262932/), and [post-heat-stress feeding study](https://pmc.ncbi.nlm.nih.gov/articles/PMC5137022/).
- Photosynthesis produces oxygen during light periods, while the coral holobiont continues to respire and consumes oxygen. At night, respiration continues without photosynthetic oxygen production. Flow influences exchange of oxygen, carbon dioxide, nutrients, and wastes. [Coral photobiology review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4141621/) and [coral growth review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3159950/).
- Stony corals deposit calcium carbonate. Calcification is biologically regulated and responds to light, temperature, dissolved inorganic carbon, pH, alkalinity, calcium, oxygen, food, and flow, with important species differences. [Coral biomineralization review](https://www.sciencedirect.com/science/article/pii/S0022098111003492), [coral calcification mechanisms review](https://pmc.ncbi.nlm.nih.gov/articles/PMC5740286/), and [coral growth review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3159950/).

### Required polyp-state architecture

**Design inference:** use concurrent state layers rather than one mutually exclusive finite-state machine. A polyp can be extended, calcifying, energetically depleted, and locally injured at the same time. Colony-level state aggregates but must not erase local variation.

| State layer | Suggested states or variables | Observable expression | Evidence class and support |
|---|---|---|---|
| Structural | intact, partial tissue loss, exposed skeleton, regenerating edge, dead module | tissue coverage, lesion boundary, skeleton exposure, regrowth | Fact. Tissue loss has multiple causes and must be described before etiology is assigned. [NOAA tissue-loss field manual](https://www.coris.noaa.gov/activities/cdhc_fieldmanual/pdfs/cdhc_2008fieldmanual.pdf). |
| Extension | fully retracted, partially extended, feeding extension, defensive extension, swollen or inflated where taxon-appropriate | tentacle and oral-disk geometry | Fact. Retraction can protect stressed stony polyps; extension is often greatest during feeding. [NOAA coral growth tutorial](https://oceanservice.noaa.gov/education/tutorial_corals/coral03_growth.html). Species overrides required. |
| Feeding | prey encounter, capture, handling, ingestion, digestion, rejection, satiation | nematocyst contact, tentacle transport, mouth activity, mucus capture | Fact. Tentacles and mesenterial structures capture and digest food. [NOAA coral anatomy](https://cdhc.noaa.gov/coral-biology/coral-biology/). |
| Symbiosis | symbiont taxon or functional type, density, pigment state, photosynthetic performance, translocation efficiency | normal color, acclimation, paling, bleaching | Fact. Symbiont diversity and acclimation change coral response. [NOAA symbiosis tutorial](https://oceanservice.noaa.gov/education/tutorial_corals/coral02_zooxanthellae.html) and [photobiology review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4141621/). |
| Carbon and energy | photosynthetic input, heterotrophic input, respiration cost, mucus and repair cost, reserves | growth, reduced extension, feeding effort, reproductive readiness | Design inference from established energy pathways. [Coral growth review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3159950/) and [heterotrophic allocation study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6107511/). |
| Calcification | positive deposition, maintenance, reduced deposition, net dissolution risk | corallite growth, skeletal extension and density | Fact plus design inference. Carbonate chemistry influences calcification but response is species-specific. [NOAA ocean-acidification coral page](https://oceanacidification.noaa.gov/ocean-acidification-research/ocean-acidification-biological-response/corals-2/) and [calcification mechanisms review](https://pmc.ncbi.nlm.nih.gov/articles/PMC5740286/). |
| Stress | acclimating, compensated stress, chronic stress, acute distress | persistent retraction, mucus, paling, reduced growth, abnormal mouth or tissue behavior | Fact. Many signs are nonspecific and can occur after physiology is already compromised. [NOAA coral threats](https://www.aoml.noaa.gov/threats-to-coral/) and [fish welfare review for general stress-sign limits](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| Competition | neutral, space competition, overgrowth, allelopathic exposure, mesenterial attack, sweeper-tentacle attack | contact damage, extended sweepers, dead zone, shading | Fact. Corals use multiple contact and distance mechanisms, and reach and outcome vary by species and environment. [Sweeper-tentacle study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7430897/) and [coral competition synthesis](https://pmc.ncbi.nlm.nih.gov/articles/PMC9198512/). |
| Reproduction | immature, gametogenic, broadcast-ready, brooding, spawning or planulation, post-spawn depleted, budding, fragment healing | gamete bundles, larvae, daughter polyps, fragment attachment | Fact. Corals can broadcast spawn, brood larvae, bud, and fragment, but timing and mode vary strongly among taxa and regions. [Coral reproduction review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4878369/) and [coral holobiont life-cycle review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4286716/). |
| Disease observation | no visible sign, discoloration, growth anomaly, tissue-loss syndrome, laboratory-supported diagnosis | lesion type, spread, affected tissue, colony distribution | Fact and ethical restriction. Visual appearance supports a gross or field description, not automatic etiologic diagnosis. [NOAA coral disease overview](https://cdhc.noaa.gov/coral-disease/) and [NOAA diagnostic levels](https://cdhc.noaa.gov/outbreak-investigation/field-diagnosis/). |

### Local driver matrix

| Local driver | Evidence-backed response family | Required model treatment | Confidence |
|---|---|---|---|
| PAR, spectrum, photoperiod, and acclimation history | Photosynthesis rises from light limitation toward saturation; excess light can cause photoinhibition and oxidative stress. Corals acclimate, and even genetically identical colonies under different light histories can have different response curves. [Coral growth review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3159950/) and [photobiology review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4141621/). | Store species or morph response curves plus acclimation state. Never map one PAR number to “correct for all coral.” Include spectrum and daily light history, not PAR alone. | High for response shape; low for universal thresholds, which must not exist. |
| Flow and turbulence | Flow changes gas exchange, nutrient delivery, waste removal, food encounter, sediment removal, and mass transfer relevant to calcification. Too little or excessive flow can be harmful depending on morphology and species. [Coral growth review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3159950/). | Use a local flow vector and turbulence or shear field. Couple polyp feeding, oxygen, waste, mucus, sediment, and branch form to local conditions. | High for mechanisms; medium for species parameters. |
| Temperature | Heat stress can disrupt symbiosis and cause bleaching; effects depend on exposure duration, acclimation, host, and symbiont. Bleaching is not immediate death, but prolonged stress and energy loss raise mortality risk. [NOAA coral threats](https://www.aoml.noaa.gov/threats-to-coral/) and [NOAA symbiosis tutorial](https://oceanservice.noaa.gov/education/tutorial_corals/coral02_zooxanthellae.html). | Accumulate dose relative to curated tolerance and acclimation, then model recovery opportunity, energy deficit, and secondary disease risk. | High. |
| Salinity and osmotic disturbance | Salinity is part of coral and fish environmental suitability, but taxa and life stages differ. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/) and [NOAA coral physiology measurement review](https://pmc.ncbi.nlm.nih.gov/articles/PMC8215126/). | Hard marine versus freshwater namespace gate, followed by species and life-stage tolerance. Avoid treating euryhalinity as universal. | High for namespace; species data required for thresholds. |
| Carbonate chemistry, calcium, alkalinity, pH, and oxygen | Calcification responds to external carbonate chemistry and internally regulated calcifying-fluid chemistry; species differ in their ability to regulate it. [Calcification mechanisms review](https://pmc.ncbi.nlm.nih.gov/articles/PMC5740286/) and [NOAA carbonate-ion explanation](https://oceanacidification.noaa.gov/ocean-acidification-research/ocean-acidification-biological-response/corals-2/). | Consume a chemistry packet’s variables, not a single “calcium score.” Separate tissue survival from skeletal deposition and dissolution. | High for mechanism; medium for transfer into aquarium parameter curves. |
| Food quantity, particle size, and prey behavior | Heterotrophy supplies carbon and nitrogen and can aid growth, tissue maintenance, and recovery, but capacity varies by coral. [Coral growth review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3159950/) and [wound-recovery nutrition study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6262932/). | Match particle or prey traits to polyp capture capability. Model food encounters under flow, satiation, digestion, and leftover nutrient load. | High for pathway; species-specific for magnitude. |
| Sediment and turbidity | Sediment can reduce light, interfere with feeding and settlement, abrade or smother tissue, and divert energy to mucus and clearing. Recruits can be more sensitive than adults, with strong species and sediment differences. [Systematic sediment review](https://pmc.ncbi.nlm.nih.gov/articles/PMC8818373/). | Track suspended and deposited loads separately, clearing by flow or mucus, morphology, orientation, and life stage. Do not use one sediment damage constant. | High. |
| Injury | Coral tissue can heal, but recovery depends on wound size, nutrition, symbiotic state, species, and secondary stress. [Wound-recovery nutrition study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6262932/). | Create a lesion with area, depth, margin, age, cause-confidence, infection risk, energy cost, and regrowth edge. | Medium to high; healing rate requires curated data. |
| Neighboring organisms | Corals can shade, overgrow, sting, externally digest, release water-borne compounds, or deploy specialized sweepers. [Sweeper-tentacle study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7430897/). | Use directional, distance-limited interaction profiles by taxon or curated species. Damage reach is not a universal genus constant. | High for mechanisms; medium for aquarium distances. |

### Growth-form requirements

NOAA recognizes branching, digitate, table, elkhorn, foliose, encrusting, massive, and related stony-coral forms, while soft corals have different structural organization. [NOAA coral growth tutorial](https://oceanservice.noaa.gov/education/tutorial_corals/coral03_growth.html) and [Florida Keys National Marine Sanctuary coral overview](https://floridakeys.noaa.gov/corals/coralreefs.html). Morphology is partly taxonomic and partly plastic: light, hydrodynamics, competition, fragmentation, and partial mortality can alter form within species. [Quantifying coral morphology](https://link.springer.com/article/10.1007/s00338-019-01842-4).

**Design inference:** represent colony form as a species-constrained growth grammar with environmental modulation. Suggested geometry metadata: attachment mode, corallite spacing, budding mode, branch thickness range, plate or mound tendency, light-seeking bias, flow response, self-shading, breakage resistance, fragmentation viability, and local death or regrowth. Do not let all colonies converge on one generic branching mesh.

### Reproduction and propagation

| Mode | Evidence-backed requirements | Simulation consequence |
|---|---|---|
| Broadcast spawning | Many stony corals release gametes for external fertilization. Timing and synchrony vary by species, location, season, lunar and daily cycles; low density or poor synchrony can reduce fertilization. [Coral reproduction in Western Australia](https://pmc.ncbi.nlm.nih.gov/articles/PMC4878369/) and [coral reproduction synthesis](https://pmc.ncbi.nlm.nih.gov/articles/PMC33228/). | Require mature colonies, compatible reproductive type, readiness, synchronized cues, gamete encounter, fertilization, larval survival, settlement substrate, and post-settlement survival. Do not award offspring from one arbitrary fragment unless the curated species permits selfing or cloning. |
| Brooding | Brooding corals retain fertilization or development internally and release planulae; seasonal output and dispersal differ from broadcasters. [Coral holobiont life-cycle review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4286716/) and [coral reproduction review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4878369/). | Use a curated reproductive mode and release calendar. Larvae still need settlement cues, suitable substrate, and post-settlement conditions. |
| Budding | Colonial growth adds genetically identical polyps by budding. [NOAA coral skeleton page](https://cdhc.noaa.gov/coral-biology/coral-skeleton/). | Add local modules under the colony growth grammar and resource network. |
| Fragmentation | A detached living fragment can sometimes attach and form a colony, but success depends on species, fragment condition, substrate, and environment. [Hawaiʻi Coral Restoration Nursery](https://dlnr.hawaii.gov/coralreefs/hcrn/) and [coral reproduction synthesis](https://pmc.ncbi.nlm.nih.gov/articles/PMC12922984/). | Fragmentation is not guaranteed reproduction. Track tissue injury, attachment, orientation, energy reserves, and survival. |

## Compatibility and Habitat Framework

### Compatibility output classes

| Output | Meaning | Example treatment |
|---|---|---|
| Hard incompatible | A locked water-type, habitat, welfare, or lethal interaction gate fails. | Marine stenohaline fish in freshwater; adult animal cannot turn or perform normal swimming; obligate prey relationship with no defensible mitigation. |
| Conditionally compatible | Compatibility depends on geometry, group structure, hiding resources, feeding access, sex, life stage, or monitored behavior. | Territorial fish with sufficient visual breaks and escape routes; coral neighbors beyond curated aggression reach. |
| Curated exception | A general family or guild tendency has a documented species-level exception. | A shark species with atypical benthic behavior still needs its own adult geometry, diet, and tankmate rules. |
| Unknown or insufficient evidence | Data do not justify a safe result. | Newly cataloged species without defensible adult or social requirements. Default to unavailable, research-required, or conservative placement, not guessed compatibility. |
| Compatible at declared scope | All current hard gates pass and residual risks are monitored. | This is not a promise of permanent harmony; breeding, growth, hunger, illness, and territory can change the result. |

### Species-record schema and gate order

| Gate order | Required catalog metadata | Rule and evidence class |
|---:|---|---|
| 1 | `water_namespace`, salinity mode, euryhaline transition rules, life-stage salinity | **Ethical restriction:** freshwater and marine catalogs are separate. Brackish or migratory transitions exist only as species-specific records. Marine, brackish, and freshwater species generally require different salinities, with life-stage exceptions. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| 2 | temperature range and preferred band by life stage | **Fact:** a shared salinity does not make animals compatible if temperature requirements conflict. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| 3 | adult length, depth, body mass or biomass curve, body shape, growth trajectory | **Ethical restriction:** evaluate expected adult condition, not purchase size. Fish-space needs depend on species and mixed group. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/) and [UF shark guidance](https://ask.ifas.ufl.edu/publication/FA179). |
| 4 | minimum usable footprint, volume context, depth, turn radius, unobstructed run, vertical or benthic use, cover | **Design inference from welfare evidence:** habitat is geometry, not gallons alone. Tank shape, horizontal dimensions, obstruction, and normal posture or swimming can be decisive. [Elasmobranch husbandry manual](https://manuals.plus/m/537b9e3e7cd4ab08fb3c52622489ba8ab474a5ae48e93a284a6850d649a96b69) and [fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| 5 | swimming mode, activity cycle, current use, jumping or escape risk | **Fact:** species may cruise, burst, rest, hover, burrow, cling, or school, and habitat design must allow normal movement. Shark swim-glide requirements and wall abrasion risks illustrate why geometry matters. [Elasmobranch husbandry manual](https://manuals.plus/m/537b9e3e7cd4ab08fb3c52622489ba8ab474a5ae48e93a284a6850d649a96b69). |
| 6 | territory size or resource defended, visual barriers, refuge count, aggression triggers | **Fact:** insufficient shelters can increase competition and aggression, while territorial and sexual state alter interactions. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| 7 | social system, minimum or maximum defensible group, pair or harem structure, sex change, dominance, conspecific aggression | **Ethical restriction:** do not keep a social species alone or force incompatible same-sex or dominance structures when evidence identifies a welfare need. One or two animals do not constitute a school for naturally schooling species. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| 8 | diet guild, prey-size envelope, feeding mode, feeding time, feeding station access, special nutrition | **Fact:** diets and feeding frequencies differ widely; food must match natural-history needs and be recognized by the animal. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| 9 | directional predation matrix, gape or capture feasibility, egg and juvenile predation, scavenging, hunger modifier | **Ethical restriction:** chemistry overlap never erases predation. Public-aquarium welfare guidance says it is undesirable to depend on exhibit predator-prey relationships for feeding. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| 10 | venom, stinging, biting, spine, toxin, allelopathy, contact damage | **Fact plus design inference:** interaction can be directional, distance-limited, and life-stage dependent. Corals use nematocysts, filaments, sweeper tentacles, and chemical mechanisms. [NOAA coral anatomy](https://cdhc.noaa.gov/coral-biology/coral-biology/) and [sweeper-tentacle study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7430897/). |
| 11 | reef-safety dimensions: coral eater, polyp nipper, sessile-invertebrate predator, mobile-invertebrate predator, algae grazer, bulldozer or dislodger | **Design inference:** replace one `reef_safe` boolean with directional traits. UF IFAS notes some sharks acceptable with fishes still prey on invertebrates. [UF shark guidance](https://ask.ifas.ufl.edu/publication/FA179). |
| 12 | substrate grain, burrow depth, hard attachment, rock caves, host or symbiont, open sand, plant cover | **Fact:** substrate and structure can be necessary for normal foraging, shelter, reproduction, and posture, and preferences differ even within broad taxa. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| 13 | oxygen demand, waste or feed load, sensitivity to ammonia and nitrite, life-support redundancy | **Fact:** acceptable density varies with flow, water quality, size, age, health, and feeding. [UK aquatic-animal housing standards](https://www.gov.uk/government/publications/care-and-accommodation-of-animals-in-science-advisory-standards/advisory-standards-for-the-care-and-accommodation-of-animals-bred-supplied-or-used-for-scientific-purposes-accessible). |
| 14 | breeding state, nest site, parental care, larval habitat, juvenile capacity | **Fact:** reproduction can change aggression, space, substrate, feeding, and life-stage requirements. [Marine ornamental larviculture review](https://onlinelibrary.wiley.com/doi/10.1111/raq.12394). |
| 15 | acquisition source, quarantine profile, disease susceptibility, treatment sensitivity | **Husbandry convention and welfare restriction:** new organisms require an isolation workflow and separate equipment appropriate to the organism and risk. [Merck aquarium fish management](https://www.merckvetmanual.com/exotic-and-laboratory-animals/aquarium-fish/management-of-aquarium-fish) and [Hawaiʻi Coral Restoration Nursery](https://dlnr.hawaii.gov/coralreefs/hcrn/). |

### Shark-specific gate

“Shark” must never be a single compatibility template. Sharks differ greatly in adult size, swimming behavior, ventilation, benthic versus pelagic use, diet, activity, social tolerance, stress response, and tankmate risk. Professional husbandry guidance explicitly states that no shark is typical and that habitat design must follow the most demanding species, maximum anticipated size, number, swim pattern, tank shape, and life-support load. Restrictive geometry can prevent normal swimming and produce wall contact or injury. [Elasmobranch Husbandry Manual chapter](https://manuals.plus/m/537b9e3e7cd4ab08fb3c52622489ba8ab474a5ae48e93a284a6850d649a96b69). UF IFAS further separates shark hardiness, availability, spatial requirements, diet, and compatibility, and notes that incompatible species can consume fish and invertebrate tankmates. [UF IFAS shark selection](https://ask.ifas.ufl.edu/publication/FA179).

**Hard gate:** a shark catalog entry is unavailable unless adult geometry, swimming or resting mode, ventilation, diet, prey profile, substrate, cover, water conditions, life-support load, handling risk, and compatibility evidence are curated. Do not derive eligibility from tank volume alone. Do not expose a “buy juvenile and upgrade later” loophole unless the current habitat is already suitable and a verified future facility is part of the scenario.

**Predator-prey example:** clownfish occupy reef habitat, feed on tiny drifting animals and algae, and have species-specific social and host relationships. [Monterey Bay Aquarium clownfish profile](https://www.montereybayaquarium.org/animals-the-ocean/animals-a-to-z/clownfish) and [Aquarium of the Pacific clownfish profile](https://www.aquariumofpacific.org/onlinelearningcenter/species/clown_anemonefish/). A shark and a clownfish do not pass compatibility merely because both can inhabit tropical marine water. If the shark’s curated record identifies non-shark fishes of the clownfish’s size or behavior as prey, the pair is hard incompatible. Even where predation is not documented or can sometimes be reduced by feeding and refuge, the result is conditional or unknown, never chemically compatible by default. This is a welfare rule, not a promise that every shark species will kill every clownfish.

## Feeding, Health, Breeding, and Carrying Capacity

### Feeding model

| Component | Evidence-backed rule | Simulation requirement |
|---|---|---|
| Species diet | Carnivore, herbivore, omnivore, planktivore, grazer, detritivore, corallivore, specialist, and mixed diets are not interchangeable. Captive nutrition is incompletely known for many species. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). | Use curated ingredient, particle, prey, plant, and micronutrient needs with uncertainty. Avoid a universal food pellet. |
| Feeding cadence and behavior | Some animals feed in bouts, some graze continuously, and some are nocturnal. Unrecognized food can remain uneaten or be monopolized by tankmates. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). | Model diel activity, target or broadcast feeding, competition, access, missed meals, and individual intake. |
| Leftovers | Uneaten food decomposes, adds organic and nitrogen load, and can impair water quality. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/) and [UF recirculating-system guidance](https://ask.ifas.ufl.edu/publication/FA101). | Food becomes particles, microbial substrate, detritivore intake, dissolved nutrients, and waste. It must not vanish. |
| Coral feeding | Corals capture particles and plankton, while photosynthetic symbionts provide another energy pathway. [NOAA coral anatomy](https://cdhc.noaa.gov/coral-biology/coral-biology/). | Couple capture to polyp extension, prey size, flow, time, and species. Do not force-feed retracted or damaged tissue without risk. |
| Microfauna as food | Copepods can be valuable live prey, including for fish larvae, but life stage, size, nutritional quality, and culture conditions matter. [Harpacticoid copepod review](https://pubmed.ncbi.nlm.nih.gov/12846044/) and [UF live-feed guide](https://ask.ifas.ufl.edu/publication/FA167). | Treat live prey as a population with nutrition and size classes, not an infinite dispenser. |
| Cleanup animals | Grazers and scavengers need sufficient compatible food and can starve when stocked as decorations. Functional performance differs among snail species. [Gastropod cleanup-crew comparison](https://pmc.ncbi.nlm.nih.gov/articles/PMC6023205/). | Create a food budget and welfare check before adding a cleanup organism. “More cleaners” is not a free maintenance upgrade. |

### Health and stress cues

| Observable cue | Possible meanings | Safe abstraction boundary |
|---|---|---|
| Reduced appetite or missed feeding | stress, unsuitable food, social exclusion, water-quality issue, disease, reproductive state | Show a differential cause list. Do not auto-diagnose. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| Altered swimming, shoaling, hiding, aggression, or surface use | habitat mismatch, low oxygen, social stress, predation pressure, disease, normal diel behavior | Compare with species and individual baseline. One generic “erratic swimming equals disease” rule is unsafe. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| Increased respiration, mucus, lesions, fin or skin damage, weight loss, buoyancy problems, color change | water-quality stress, infection, trauma, nutrition, toxic exposure, or multiple causes | Escalate to isolation and diagnostics. Observable signs often appear after significant compromise. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| Coral paling or bleaching | symbiont pigment or density change caused by stress; coral may remain alive | Separate bleaching from death and from bare white skeleton. Model energy deficit and recovery opportunity. [NOAA coral threats](https://www.aoml.noaa.gov/threats-to-coral/). |
| Coral tissue loss | predation, abrasion, competition, toxic or environmental injury, or infectious disease | Record lesion geometry, rate, age, mucus, nearby predators, and environmental history. Etiology remains unknown without stronger evidence. [NOAA tissue-loss field manual](https://www.coris.noaa.gov/activities/cdhc_fieldmanual/pdfs/cdhc_2008fieldmanual.pdf). |

### Disease abstraction boundary

**Ethical restriction:** the simulation may represent observable syndromes, risk factors, sampling, isolation, and professional diagnosis, but it must not teach players that color or tissue loss uniquely identifies a pathogen or that an arbitrary medication is a universal cure. NOAA distinguishes gross field description, morphologic diagnosis, and etiologic diagnosis, with tissue examination and pathogen evidence required for stronger conclusions. [NOAA diagnostic levels](https://cdhc.noaa.gov/outbreak-investigation/field-diagnosis/). Fish disorders also share signs and often require veterinary examination or laboratory testing. [Merck fish disease manual](https://www.merckvetmanual.com/all-other-pets/fish/disorders-and-diseases-of-fish).

Suggested gameplay abstraction:

1. Detect deviation from species or individual baseline.
2. Check environment, feeding, aggression, injury, and recent additions.
3. Isolate when transmission or predation is plausible and isolation is safe.
4. Run a context-appropriate diagnostic step.
5. Apply a curated treatment only when the diagnosis and organism tolerance support it.
6. Track treatment stress, biofilter effects, withdrawal or reintroduction conditions, and recurrence.

Steps 1 through 6 are a **design inference**, not veterinary advice.

### Breeding prerequisites

- Breeding is a species-specific chain, not a random reward roll. At minimum, require sexual maturity, compatible sex or reproductive type, acceptable body condition and nutrition, social pairing or group structure, environmental cues, spawning or nesting habitat, gamete or egg survival, appropriate incubation, first food, refuge, and juvenile carrying capacity. Photoperiod, temperature, salinity, food, flow, lunar cycle, and social context influence reproduction differently among fishes. [NOAA fish reproduction review](https://repository.library.noaa.gov/view/noaa/56776/noaa_56776_DS1.pdf).
- Marine ornamental fish may spawn naturally in captivity, but sex identification, pairing, and larval rearing remain species-specific challenges. Larvae often require appropriately sized live prey and visual or water-column conditions different from adults. [Marine ornamental larviculture review](https://onlinelibrary.wiley.com/doi/10.1111/raq.12394).
- Clownfish demonstrate why species metadata matters: they have dominance and sex-change dynamics, form a breeding pair within a social hierarchy, prepare a substrate nest, guard and aerate eggs, and produce pelagic larvae with different feeding and habitat needs. [Aquarium of the Pacific clownfish profile](https://www.aquariumofpacific.org/onlinelearningcenter/species/clown_anemonefish/) and [peer-reviewed false-clownfish rearing method](https://pmc.ncbi.nlm.nih.gov/articles/PMC8248105/).
- Coral broadcasting, brooding, budding, and fragmentation must remain separate mechanics, as detailed above. Asexual growth does not prove sexual reproductive capacity or genetic diversity. [Coral holobiont life-cycle review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4286716/).

### Carrying capacity

**Design inference:** calculate several capacities and use the first limiting one. Do not sum “fish inches” or treat an upgraded filter as permission to violate space or social needs.

| Capacity dimension | Limiting variables | Consequence of exceedance |
|---|---|---|
| Metabolic or life-support | feed input, biomass, oxygen, ammonia production, biofilter state, flow, gas exchange, solids, temperature | oxygen deficit, ammonia or nitrite accumulation, pH or carbon-dioxide stress, chronic disease risk |
| Spatial and behavioral | adult geometry, normal posture, turn radius, swimming run, territory, refuge, substrate, vertical or benthic use | collision, wall-hugging, suppressed behavior, chronic aggression, hiding, injury |
| Social | group size, sex ratio, hierarchy, school or shoal need, pair bond, conspecific aggression | isolation stress, dominance injury, failed feeding or breeding |
| Trophic | compatible food production and delivery, grazing area, live-prey supply, prey refuge, competition | starvation, obesity, prey collapse, nuisance biomass, uneaten-food load |
| Sessile space | coral growth envelope, light and flow access, aggression reach, shading, attachment | stinging, overgrowth, shading, tissue loss, detachment |
| Reproductive and juvenile | nests, brooding sites, larval system, first food, grow-out space | egg or larval loss, cannibalism, sudden overcapacity |

Acceptable fish density varies with water flow, current, water quality, size, age, health, and feeding, while behavior and social needs remain independent constraints. [UK aquatic-animal housing standards](https://www.gov.uk/government/publications/care-and-accommodation-of-animals-in-science-advisory-standards/advisory-standards-for-the-care-and-accommodation-of-animals-bred-supplied-or-used-for-scientific-purposes-accessible) and [fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). This evidence rejects a universal minimum-gallon or inch-per-gallon formula.

### Quarantine and biosecurity

| Control | Evidence and context | Simulation mechanic |
|---|---|---|
| Fish isolation | Merck Veterinary Manual recommends a minimum 30-day fish quarantine, with longer periods when needed, separate equipment, early examination, and attention to species-appropriate water and welfare. This is veterinary husbandry guidance, not proof that 30 days detects every pathogen. [Merck aquarium fish management](https://www.merckvetmanual.com/exotic-and-laboratory-animals/aquarium-fish/management-of-aquarium-fish). | Quarantine is a separate epidemiological system with its own mature filtration, water match, shelter, feeding, monitoring, tools, and clock. Some pathogens can remain undetected, so risk never becomes zero. |
| Coral and sessile-invertebrate isolation | Hawaiʻi’s restoration nursery removes invasive species and micropredators and requires corals to be free of disease, aquatic invasive species, and micropredators for at least 30 days before fast-growth work. This is a restoration protocol, not a universal home-aquarium duration. [Hawaiʻi Coral Restoration Nursery](https://dlnr.hawaii.gov/coralreefs/hcrn/). | Inspect tissue, skeleton, plug, eggs, predators, and lesions. Keep coral biosecurity separate from fish parasite logic. |
| Separate tools and flow | Fish quarantine guidance calls for designated nets, buckets, and siphons; NOAA coral-disease precautions emphasize disinfection and avoiding cross-contamination. [Merck aquarium fish management](https://www.merckvetmanual.com/exotic-and-laboratory-animals/aquarium-fish/management-of-aquarium-fish) and [NOAA coral-disease precautions](https://cdhc.noaa.gov/outbreak-investigation/precautions/). | Tools, hands, water, substrate, and plumbing can become transmission edges. Shared water invalidates true quarantine. |
| Source and provenance | Captive-bred stock can reduce some collection pressure and supports traceability, but it is not automatically pathogen-free. Monterey Bay Aquarium encourages captive-raised aquarium fishes for conservation reasons. [Monterey Bay Aquarium clownfish profile](https://www.montereybayaquarium.org/animals-the-ocean/animals-a-to-z/clownfish). | Store source, captive-bred status, collection legality, health documents, transport stress, and prior-system exposure. |

## Microfauna and Micro-Invertebrates

### Functional guild table

| Group | Marine functions and interactions | Freshwater functions and interactions | Harm or pest distinctions | Confidence and sources |
|---|---|---|---|---|
| Copepods | Pelagic and benthic taxa can graze microalgae or biofilm, consume detrital or microbial resources, and feed corals, fish, and larvae. Benthic harpacticoids often depend strongly on surface area and refuge. | Copepods are major freshwater zooplankton and transfer primary production to larger invertebrates and fish; some are predatory or omnivorous. | Some copepods are parasites; free-living “pods” are not one species. Salinity and temperature optima, diet, size, and reproduction are species or strain dependent. | High for trophic role. [Copepod culture review](https://pubmed.ncbi.nlm.nih.gov/12846044/), [FAO copepod culture guide](https://www.fao.org/4/W3732E/w3732e0t.htm), and [EPA freshwater zooplankton](https://www.epa.gov/national-aquatic-resource-surveys/indicators-zooplankton). |
| Amphipods and isopods | Many amphipods graze algae, scavenge, or consume detritus; others are omnivores or predators. They are prey for fishes and invertebrates and occupy rock, algae, and sediment refuge. | Freshwater amphipods and isopods are benthic food-web members and important prey in many systems. | Do not label every amphipod beneficial or every isopod harmful. Parasitic, predatory, and grazing taxa need curated records. | Medium because aquarium taxa are often unidentified. [Crustacean plant-feeding review](https://pmc.ncbi.nlm.nih.gov/articles/PMC5565452/) and [EPA benthic-invertebrate monitoring](https://www.epa.gov/great-lakes-monitoring/great-lakes-benthic-invertebrate-monitoring). |
| Polychaetes and other worms | Worms span deposit feeders, suspension feeders, scavengers, predators, corallivores, and tube-building ecosystem engineers. Tubes can create habitat for smaller fauna. | Oligochaetes, flatworms, nematodes, leeches, and other worms span detrital processing, predation, parasitism, and prey roles. | “Bristleworm” is not a single behavior. Some fireworms, including Hermodice, prey on cnidarians and coral recruits; many unrelated worms occupy non-corallivorous guilds. | High for guild diversity, medium for unknown hitchhikers. [Polychaete feeding-guild review](https://www.annualreviews.org/content/journals/10.1146/annurev-marine-010814-020007), [Diopatra ecology review](https://pmc.ncbi.nlm.nih.gov/articles/PMC9598674/), and [fireworm predation study](https://cris.leibniz-zmt.de/id/eprint/2718/). |
| Snails and other gastropods | Depending on species, snails graze films or macroalgae, collect deposits, scavenge, prey on sessile animals, or consume coral. Grazing rate and behavior vary strongly. | Freshwater snails can scrape biofilm, collect deposits, eat plants or carrion, and serve as prey or intermediate hosts depending on species. | Coral-eating snails and specialist predators are harmful to particular livestock; an algal grazer can still starve or bulldoze fragments. | High for species variation. [Aquarium cleanup-snail comparison](https://pmc.ncbi.nlm.nih.gov/articles/PMC6023205/), [NOAA natural coral predators](https://oceanservice.noaa.gov/education/tutorial_corals/coral08_naturalthreats.html), and [USGS freshwater snail profile](https://nas.er.usgs.gov/queries/factsheet.aspx?speciesid=1012). |
| Small crustaceans | Shrimp, mysids, ostracods, small crabs, and related taxa can graze, scavenge, filter-feed, clean hosts, prey, burrow, compete, or become food. | Shrimp, ostracods, cladocerans, copepods, and amphipods link microbes or algae to fish and process organic particles. | Crabs and shrimp are not universally reef-safe; claw morphology, diet, adult size, and observed predation matter. | Medium, requires species records. [NOAA coral-reef food-web teaching model](https://sanctuaries.noaa.gov/media/docs/20231129-coral-reef-lesson-plan.pdf) and [EPA freshwater zooplankton](https://www.epa.gov/national-aquatic-resource-surveys/indicators-zooplankton). |
| Plankton and larval forms | Phytoplankton, bacterioplankton, protozoa, rotifers, copepod nauplii, eggs, larvae, and other zooplankton form a size-structured food web. Filtration, skimming, flow, and predation change availability. | Rotifers, protozoa, cladocerans, and copepods transfer energy from phytoplankton and bacteria to fish and can alter algal abundance and nutrient turnover. | Plankton is not automatically “good”; blooms can reflect imbalance, some taxa are toxic or parasitic, and larvae may be filtered or eaten. | High for food-web role. [EPA freshwater zooplankton](https://www.epa.gov/national-aquatic-resource-surveys/indicators-zooplankton) and [NOAA plankton overview](https://www.st.nmfs.noaa.gov/copepod/about/what-n-why.html). |

### Population and boom-or-bust mechanics

**Design inference:** for each microfauna population or life stage, track:

```text
next abundance = current survivors
               + reproduction and recruitment
               + immigration or deliberate seeding
               - predation
               - starvation and density stress
               - water-quality and treatment mortality
               - filtration, skimming, siphoning, or overflow export
               - harvesting
```

The terms must be resource and habitat limited. Copepod evidence shows reproduction and productivity can depend on food quality, surface area, density, harvesting, salinity, temperature, species, and strain; overharvesting depletes cultures. [Harpacticoid copepod review](https://pubmed.ncbi.nlm.nih.gov/12846044/). Freshwater zooplankton abundance and composition respond to nutrients, algae, predators, oxygen, temperature, and environmental disturbance. [EPA freshwater zooplankton](https://www.epa.gov/national-aquatic-resource-surveys/indicators-zooplankton) and [UC Davis Tahoe zooplankton](https://tahoe.ucdavis.edu/zooplankton-0).

Suggested causes of a boom:

- a pulse of uneaten food, detritus, algae, bacteria, or phytoplankton;
- added refuge surface or reduced predation;
- favorable temperature, salinity, oxygen, and reproductive state;
- introduction of a reproducing founder population.

Suggested causes of a crash:

- resource depletion after the boom;
- a new or growing predator population;
- overharvesting, aggressive mechanical removal, or filtration capture;
- chemistry, oxygen, temperature, medication, or salinity shock;
- cannibalism, competition, pathogens, or reproductive failure where supported by the taxon.

These causes are **design inferences** from trophic and culture evidence. Their weights must be species or guild parameters, not universal constants.

### Cleanup-function boundary

“Cleanup” means material is consumed, scraped, fragmented, buried, or converted into animal biomass and waste. It does not mean matter leaves the closed aquarium. Export occurs only through harvesting, siphoning, skimming, filtration removal, gas exchange where chemically relevant, water change, or other explicit system outputs. This is a **design inference** from food-web mass flow and prevents cleanup animals from acting as magic nutrient deletion. [EPA freshwater zooplankton](https://www.epa.gov/national-aquatic-resource-surveys/indicators-zooplankton) describes nutrient recycling and trophic transfer, while the [gastropod cleanup-crew study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6023205/) shows that grazing performance is species-specific.

### Hitchhiker classification

Do not label an unknown hitchhiker “pest” merely because it was not purchased. Use these evidence states:

1. `unknown_taxon`: no confident identification, observe or quarantine.
2. `known_functional_commensal_or_neutral`: evidence supports low-risk presence at current abundance and context.
3. `conditional_competitor_or_nuisance`: risk depends on abundance, food, space, or target species.
4. `documented_predator_or_parasite`: curated host or prey relationship supports intervention.
5. `invasive_or_biosecurity_restricted`: legal or ecological restriction applies.

Examples of documented risk include coral-eating flatworms, nudibranchs, corallivorous snails, and some fireworms. Hawaiʻi’s coral nursery identifies nudibranchs, a Montipora-eating flatworm, and corallivorous snails as micropredators, while USGS documents Acropora-eating flatworms as aquarium pests requiring quarantine and biosecurity. [Hawaiʻi Coral Restoration Nursery](https://dlnr.hawaii.gov/coralreefs/hcrn/) and [USGS Acropora flatworm case](https://www.usgs.gov/centers/nwhc/news/pathology-case-month-elkhorn-coral-colony). Conversely, polychaete feeding-guild diversity makes “all bristleworms are harmful” biologically indefensible. [Polychaete feeding-guild review](https://www.annualreviews.org/content/journals/10.1146/annurev-marine-010814-020007).

## Hard Ethical and Welfare Restrictions

| Restriction | Rationale and source |
|---|---|
| No marine/freshwater catalog leakage | Salinity is a fundamental physiological requirement, with only curated brackish or migratory exceptions. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| No purchase or placement when the current habitat cannot meet the animal’s adult geometry, behavior, social, substrate, feeding, or life-support needs | Space and welfare are species-specific and cannot be repaired by filtration alone. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/) and [Elasmobranch Husbandry Manual](https://manuals.plus/m/537b9e3e7cd4ab08fb3c52622489ba8ab474a5ae48e93a284a6850d649a96b69). |
| No chemistry-only compatibility approval | Temperature and salinity overlap do not erase predation, aggression, venom, competition, feeding exclusion, or social incompatibility. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| No deliberate predator-prey stocking as routine feeding | Professional aquarium welfare literature describes reliance on exhibit predator-prey feeding as undesirable for prey welfare. [Fish welfare review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451808/). |
| No use of live animals to “test” an uncycled or unstable simulated habitat | This is a design-level welfare restriction consistent with avoiding poor water quality, stress, and preventable disease. [Merck fish disease manual](https://www.merckvetmanual.com/all-other-pets/fish/disorders-and-diseases-of-fish) and [UF responsible aquarium ownership](https://edis.ifas.ufl.edu/publication/fa124). |
| No starvation-based cleanup crew | Cleanup animals are living consumers with species-specific food needs and variable grazing performance. [Gastropod cleanup-crew comparison](https://pmc.ncbi.nlm.nih.gov/articles/PMC6023205/). |
| No visual-only pathogen certainty or universal medication | Similar lesions and signs have multiple causes; stronger diagnosis requires tissue or pathogen evidence. [NOAA coral diagnostic levels](https://cdhc.noaa.gov/outbreak-investigation/field-diagnosis/) and [Merck fish disease manual](https://www.merckvetmanual.com/all-other-pets/fish/disorders-and-diseases-of-fish). |
| No release of aquarium organisms into the environment | Introductions can create invasive-species and disease risk. [NOAA shallow coral habitat](https://www.fisheries.noaa.gov/national/habitat-conservation/shallow-coral-reef-habitat) and [UF responsible aquarium ownership](https://edis.ifas.ufl.edu/publication/fa124). |
| No trade progression that rewards threatened, illegal, destructive-capture, or unverifiable stock | Source and conservation provenance must be explicit. Captive-raised options should be favored where supported. [Monterey Bay Aquarium clownfish profile](https://www.montereybayaquarium.org/animals-the-ocean/animals-a-to-z/clownfish). |
| No claim that a successful simulation validates real-world husbandry | The proposed model is educational and entertainment software. It cannot reproduce all biological variation, pathogens, individual behavior, or professional judgment. |

## Evidence-Confidence Table

| Rule family | Best evidence used | Confidence | Material limitation |
|---|---|---:|---|
| Polyp anatomy and colony connection | NOAA Coral Disease and Health Consortium | High | Anthozoan diversity still requires soft-coral, stony-coral, solitary-polyp, and colonial overrides. |
| Photosynthesis, respiration, and light response | Peer-reviewed photobiology and growth reviews | High | No universal PAR target; spectrum, acclimation, symbiont, morphology, and time all matter. |
| Heterotrophy and feeding | Peer-reviewed physiology and nutrition studies | High for pathway, medium for magnitude | Feeding benefits do not universally rescue environmental stress. |
| Calcification | Peer-reviewed biomineralization and carbonate-chemistry reviews | High for mechanism, medium for aquarium curves | Species regulate calcifying fluid differently; chemistry packet must provide the shared variables. |
| Extension and retraction | NOAA anatomy and growth tutorial | High for broad function | Diel timing and flow or feeding response are species-specific. |
| Coral competition | Peer-reviewed sweeper-tentacle and competition studies | High for mechanisms | Reach, strength, and chemical effects need species or genus evidence. |
| Coral reproduction | Peer-reviewed life-history reviews and regional studies | High for modes | Timing, selfing, sex system, cues, and settlement success are strongly taxon and region specific. |
| Bleaching and tissue loss | NOAA, USGS, and peer-reviewed studies | High | Gross signs do not establish etiology. |
| Fish compatibility and welfare | Peer-reviewed public-aquarium welfare review | High for dimensions | Many ornamental species lack quantified welfare thresholds. Unknown must remain visible. |
| Shark habitat gates | Professional elasmobranch manual plus university extension | High for need for species-specific geometry | Published captive-space evidence remains limited; do not convert rules of thumb into universal formulas. |
| Microfauna functions | Peer-reviewed copepod, gastropod, worm, and food-web sources | High for functional diversity | Aquarium hitchhikers are often unidentified; species-level outcomes can be uncertain. |
| Population boom and bust | Copepod culture review, EPA and university zooplankton ecology | Medium to high | Closed-aquarium rates require calibration and may differ from culture or natural ecosystems. |
| Quarantine | Veterinary manual and government restoration practice | High for isolation principles | One duration does not detect every pathogen or apply to every organism; treatment requires expertise. |
| Carrying capacity | Government standards, extension design guidance, and welfare review | High for multidimensional constraint | Numeric limits are species, system, and life-stage dependent. |

## Source Quality Summary

- Primary evidence includes peer-reviewed reviews and studies indexed by PubMed or PMC on coral physiology, photobiology, sediment, competition, reproduction, wound recovery, fish welfare, copepods, gastropods, and polychaetes.
- Government and authoritative institutional sources include NOAA, USGS, EPA, Hawaiʻi DLNR, UK government standards, University of Florida IFAS Extension, Merck Veterinary Manual, Monterey Bay Aquarium, and Aquarium of the Pacific.
- The shark geometry discussion also uses a professional public-aquarium husbandry manual. Its captive-space evidence is explicitly limited, which is why the packet rejects a universal formula.
- No hobby forum, retailer, wiki, or unsourced blog is used as the basis for a material rule.
- Numeric husbandry recommendations are limited to clearly contextual quarantine practices with nearby citations. No universal minimum-gallon number is proposed.

## Limitations and Open Questions

1. Many ornamental species lack quantified welfare, social, nutritional, and reproductive thresholds. The catalog needs curated records and an explicit `unknown` state rather than inferred precision.
2. Aquarium coral husbandry often relies on practitioner knowledge not tested across species. Natural-reef and restoration evidence establishes mechanisms, but aquarium response curves require calibration and must remain labeled as design inference or husbandry convention.
3. PAR is only one part of light exposure. Spectrum, photoperiod, daily light integral, angle, self-shading, symbiont, and acclimation history can alter the response. No global PAR number is defensible.
4. Shark-space evidence is especially unsuitable for one minimum-gallon table. Species, adult size, tank geometry, unobstructed runs, ventilation, substrate, and life-support capacity all need curated gates.
5. Gross coral signs cannot reliably separate disease, predation, competition, toxic injury, or environmental stress. Etiologic diagnosis should remain a higher-level mechanic.
6. Microfauna species are frequently unidentified and can switch apparent value with abundance, food, or host context. Unknown hitchhikers require observation or quarantine, not automatic destruction.
7. Population equations require calibration against a declared taxon, system scale, and filtration configuration. A visually plausible boom or crash is not evidence that the rate is biologically accurate.
8. Legal collection, trade, invasive-species, and protected-species restrictions vary by jurisdiction and date. A later control-source lane must supply current legal rules if the game exposes real species commerce.
9. This packet does not provide veterinary diagnosis or treatment protocols. Real treatment recommendations require qualified aquatic-animal health expertise.

## Exact Downstream Instructions

### For A0, Aggregator

1. Preserve the evidence-class labels. Do not rewrite design inferences or tunable gameplay as biological facts.
2. Extract the concurrent polyp-state layers, local driver matrix, compatibility output classes, 15-step species gate order, carrying-capacity dimensions, quarantine controls, and microfauna population terms into the selected-position artifact.
3. Keep marine and freshwater catalogs and chemistry namespaces separate. Permit a brackish or life-stage transition only through an explicit species override.
4. Preserve directional predation and reef-safety traits. Do not collapse them into one compatibility boolean or one `reef_safe` flag.
5. Lock the shark rule: curated adult habitat geometry and prey-risk metadata are mandatory; gallons alone cannot authorize a shark.
6. Lock the disease boundary: gross signs produce a syndrome or differential list, not an etiologic diagnosis.
7. Mark the following as unresolved inputs for other packets: chemistry target variables, equipment and market progression, startup or ugly-phase timing, jurisdictional trade controls, and species-by-species catalog values.
8. Reject any downstream rule that implies simulation success proves safe real-world animal care.

### For D2, Coral, Polyp, and Microfauna Drafting Consumer

1. Draft from the anatomy anchors, concurrent polyp-state table, local driver matrix, growth-form requirements, coral reproduction table, and microfauna functional and population sections.
2. Explain polyps as living modules connected at colony level. Show extension, feeding, symbiosis, respiration, calcification, aggression, reproduction, injury, bleaching, tissue loss, and recovery as concurrent or interacting state layers.
3. Treat local PAR, spectrum, flow, chemistry, food, sediment, neighbors, and injury as spatial fields or contacts. State that thresholds are species and acclimation specific.
4. Preserve the distinction among bleaching, tissue loss, and death. Preserve the diagnostic uncertainty boundary.
5. Describe cleanup organisms as consumers and nutrient recyclers, not nutrient deletion. Include marine and freshwater microfauna examples in separate subsections.
6. Include nearby citations for every material factual or numeric claim. Do not add universal PAR, spacing, stocking, or population constants.

### For D3, Livestock, Compatibility, Feeding, Breeding, and Progression Drafting Consumer

1. Draft from the compatibility output classes, species-record gate order, shark gate, feeding table, health-cue table, breeding prerequisites, carrying-capacity table, quarantine controls, and hard welfare restrictions.
2. Present compatibility as water-type hard gate plus adult habitat, behavior, social, diet, directional predation, reef interaction, substrate, life-support, and breeding checks.
3. Use the shark and clownfish example precisely: chemistry overlap is insufficient; curated prey and habitat rules decide the result. Do not claim every shark species inevitably kills every clownfish.
4. Make welfare-critical placement rules hard gates. Equipment upgrades may improve water processing but cannot waive adult geometry, social, substrate, territory, or predator-prey restrictions.
5. Represent feeding as individual intake plus leftover material and water-quality load. Represent breeding as a prerequisite chain with juvenile capacity, not a random bonus.
6. Treat quarantine as a separate epidemiological system with organism-appropriate welfare, tools, water, and filtration. Do not universalize one duration or treatment.
7. Label prices, unlock pace, probabilities, challenge modifiers, and user-interface warnings as tunable gameplay. Do not present them as husbandry facts.
8. Include nearby citations for every material factual or numeric claim and explicitly state that the simulation is not a substitute for real husbandry or veterinary advice.

## Validation Notes

- Coverage checked against every RAQ-R4 topic: polyp anatomy and states; symbiosis; photosynthesis; heterotrophy; respiration; calcification; extension and retraction; growth forms; aggression; spawning, brooding, fragmentation; stress; bleaching; disease and tissue loss; local light, flow, chemistry, food, sediment, and injury; compatibility dimensions; shark and clownfish example; microfauna; feeding; health; breeding; carrying capacity; quarantine; biosecurity; and ethical restrictions.
- Citation form checked: all citations are navigable Markdown links, and no internal web reference IDs appear.
- Numeric-rule check: no universal minimum-gallon, PAR, stocking-density, coral-spacing, or cleanup-crew count is supplied.
- Mode-separation check: marine and freshwater catalogs remain separate with only curated exceptions.
- Welfare check: chemistry overlap cannot defeat predation, adult habitat, social, or substrate gates.
- Em-dash check: prose was drafted without em dash characters.
