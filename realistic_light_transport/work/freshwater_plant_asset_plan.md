# Freshwater plant asset plan: Anubias and Java fern

Status: source-backed candidate plan only. This document does not add plant geometry, a plant schema, a runtime registration, a GLB, or a workbench/store change.

## Purpose and boundaries

The next freshwater asset pass needs two epiphytic plant candidates that read correctly on rock or wood and do not inherit reef-coral assumptions. The current visual catalog has no established plant author schema or shared plant geometry plan, so this packet records the source contract and a small build plan only. A future implementation should first choose or review a plant asset schema, then author one species-local candidate at a time.

Shared non-negotiables:

- Keep the rhizome as the attachment and growth axis. Do not bury it in a substrate mesh.
- Model leaves or fronds as thin, slightly translucent surfaces with a visible midrib and restrained vein relief. Do not model them as coral polyps, branching SPS, or generic fish fins.
- Treat attachment, current response and slow growth as separate concerns. The first candidate animation should be subtle current response, not a simulated plant-growth system.
- Use source dimensions only as morphology anchors. Do not turn horticultural care ranges into universal gameplay targets.
- No source pixels, traced silhouettes, or seller imagery are to be copied into the asset.

## Candidate A: Anubias barteri var. nana

Taxonomic label: `Anubias barteri var. nana (Engl.) Crusio`. Kew lists the variety under accepted *Anubias barteri* and CATE's description gives the dwarf form's leaf and petiole limits. The Singapore National Parks Board page is the primary care and morphology reference for this candidate.

### Source-backed morphology

- Broad-leaved, herbaceous perennial that can grow emersed or submerged.
- Creeping rhizome with adventitious roots. The rhizome must remain exposed when attached to rock or wood.
- Thick, leathery, dark-green, simple leaves with an oblong to ovate-elliptic blade, acute tip, entire margin and netted venation.
- The NParks account describes the dwarf form as the smallest known form in the genus and records leaf width up to 2.8 cm and petiole length up to 5 cm. These are reference bounds, not a universal aquarium scale.
- Habitat cue: wet forest margins, marshes, streams and riverbanks under shade. Use this to guide low to moderate light presentation, not as a hard light threshold.

### Candidate geometry plan

1. Build one low-poly creeping rhizome with several root nubs and an attachment anchor.
2. Place a small clump of leaves along the rhizome, each with a petiole, central midrib and simple tapered blade. Keep leaf count and dimensions as candidate parameters so the clump can be varied without a new framework.
3. Use a double-sided leaf material with mild subsurface or transmission intent. Keep veins as shallow relief or a controlled texture detail, not dozens of separate ray meshes.
4. Expose `attachmentSurface` as rock or wood in the future source contract. The candidate must remain valid when the substrate changes.

### Candidate animation plan

- `rest`: near-static leaves with a small damped petiole settle.
- `current_response`: low-amplitude phase-offset leaf bend, stronger at tips than at the rhizome, with no snapping or fin-like flapping.
- `growth_preview`: out of scope for the first candidate. If later required, grow a new leaf or rhizome segment discretely and keep it separate from current animation.

## Candidate B: Microsorum pteropus (Java fern)

Taxonomic label: `Microsorum pteropus (Blume) Copel.`. World Flora Online and Flora of China provide the species-level rhizome, frond and venation descriptions. The Royal Botanic Gardens Edinburgh fern sheet is an additional institutional morphology reference.

### Source-backed morphology

- Long-creeping, dorsiventrally flattened rhizome that is closely attached to substrate or rock and bears fronds at intervals.
- Fronds are variable on one plant. Use a simple lanceolate frond for the base candidate, with an optional forked or pinnatifid variant. Do not imply that one aquarium cultivar represents the whole species.
- Stipes are distinct from the lamina. A central midrib and reticulate or anastomosing veins should remain readable at close inspection.
- The source describes leathery to membranous laminae and scattered sori on the underside. Sori are a later detail pass, not a reason to add a second geometry system.
- The fern is epiphytic or lithophytic in the cited flora sources. The rhizome and roots, rather than buried crown geometry, establish attachment.

### Candidate geometry plan

1. Build a thin creeping rhizome with alternating frond attachment points and a small root/scale suggestion.
2. Author one simple frond mesh with a separate midrib control and a data-driven outline. Add forked or pinnatifid outlines as variants only if the first candidate remains legible.
3. Use a matte dark-green leaf material with a subtle wet surface response. Keep the underside and sori as optional texture or relief detail.
4. Reuse the same attachment contract as Anubias, but do not force the Anubias leaf blade or rhizome proportions onto Java fern.

### Candidate animation plan

- `rest`: fronds hold their broad posture with slight settling at the stipe.
- `current_response`: a slow, damped bend along the rachis, with neighboring fronds phase-shifted to avoid synchronized motion.
- `growth_preview`: out of scope for the first candidate. Later growth may add a frond at an existing rhizome node or extend the rhizome, but it must not mutate the current-response rig.

## Provenance and acceptance gates

Required sources:

| ID | Source | Use |
| --- | --- | --- |
| `NPARKS-ANUBIAS-NANA` | [NParks, Anubias barteri var. nana](https://www.nparks.gov.sg/florafaunaweb/flora/5/7/5757) | Taxon label, rhizome, leaf, habitat, attachment and cultivation observations. |
| `KEW-ANUBIAS-BARTERI` | [Kew Plants of the World Online, Anubias barteri](https://powo.science.kew.org/taxon/urn:lsid:ipni.org:names:85520-1/general-information) | Accepted species context and CATE morphology for the nana variety. |
| `WFO-MICROSORUM-PTEROPUS` | [World Flora Online, Microsorum pteropus](https://www.worldfloraonline.org/taxon/wfo-0001117269) | Species morphology, rhizome, frond, stipe, venation and sori. |
| `RBGE-MICROSORUM-PTEROPUS` | [Royal Botanic Gardens Edinburgh, Microsorum pteropus factsheet](https://websites.rbge.org.uk/thaiferns/factsheets/index.php?q=Microsorum_pteropus.xml) | Institutional cross-check for creeping rhizome and frond description. |

Before a future candidate is accepted, require:

1. Source references and license or usage notes are committed beside the candidate.
2. The rhizome attachment reads correctly in at least one rock or wood context, with no buried-rhizome default.
3. The leaf or frond outline, midrib and venation remain distinguishable from generic coral or grass geometry.
4. Current response is damped and phase-offset, with no geometry intersection at sampled poses.
5. The candidate remains unpromoted until source, runtime and visual review gates are run. No exact plant growth rate, water target, PAR value or cultivar claim should be introduced without a source that supports it.

## Explicit non-goals

- No new plant geometry framework, shared runtime behavior, plant store entry, or workbench editor.
- No Blender invocation, GLB export, candidate promotion, or visual catalog regeneration in this prerequisite lane.
- No claims that Anubias or Java fern establish a universal freshwater light, temperature, pH, CO2 or nutrient target.
