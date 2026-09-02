# Pocket Aquarium Ecosystem — Ecology Model (FTG4-01B)

This document explains the deterministic simulation in `js/sim.js` and the catalog in
`js/data.js`: what each subsystem models, which real-world husbandry/biology it is
anchored to, and every deliberate abstraction. "Hyper-realistic" here means
**biologically coherent and recognizable**, not a professional life-support calculator.
Real husbandry timescales (weeks/months) are compressed into readable game-days.

The model is a fixed-step, seeded, plain-JSON simulation:

- **Fixed sub-step:** `TICK_DAYS = 0.05` game-day (20 ticks per game day). All rates are
  per game-day and integrated over `dt`, so results are independent of frame rate and of
  how the caller chunks time (`stepDays`, `step`, `offlineCatchUp` all call the same `tick`).
- **Determinism:** the only randomness is a seeded `mulberry32` RNG stored in
  `state.rngState`; identical seed + identical action sequence ⇒ identical output. This is
  what makes `tests/sim.test.js` repeatable.
- **Serializable state:** every state value is a plain number/string/array/object so the
  renderer, the app, and `JSON.stringify` persistence are all safe.

Public surface (all attached to `window.PA`, loaded `data.js → sim.js`):
`PA.DATA`, `PA.validatePurchase`, `PA.createState`, `PA.step`, `PA.stepDays`, `PA.dispatch`,
`PA.sanitizeState`, `PA.snapshotSummary`, `PA.offlineCatchUp`.

---

## Research anchors → model mapping

The evidence sources named in the goal contract map to concrete code as follows.

| Anchor | Source (goal contract) | Where it lives |
|---|---|---|
| Ammonia is toxic; nitrification (AOB: NH₃→NO₂, NOB: NO₂→NO₃) depends on O₂, temperature, pH/alkalinity, and biofilter surface; new biofilters take weeks (accelerated, not deleted) | UF/IFAS "Ammonia in Aquatic Systems" | `stepChemistry`, `nitrifyEnv`, `classifyCycle` |
| Evaporation removes water but leaves salts, raising salinity; freshwater top-off / ATO restore volume without adding salt | Reef husbandry | `updateVolumeAndConcentration`, `applyDilution`, `doTopOff`, equipment `ato` |
| Light is a coral input; polyp extension & growth depend on PAR, photoperiod, flow, feeding, stability, time of day | Peer-reviewed *Goniopora* lighting study | `stepCorals`, `stepLight`, `daylight` |
| New tanks undergo microbial/benthic succession: bacterial haze, diatoms, green algae, cyanobacteria as overlapping outcomes driven by age, silicate/nutrients, flow, light | Peer-reviewed saltwater-succession study | `stepSuccession` |
| Ocellaris are marine reef/lagoon fish, host-associated, form monogamous protandrous pairs, lay substrate-attached eggs, male tends them ~6–8 days; neon tetras are freshwater schooling fish, invalid as lone specimens | Animal Diversity Web / FishBase | `SPECIES.ocellaris`, `SPECIES.neon_tetra`, `stepBreeding`, `stepClutches` |
| Epaulette shark is an expert-only, large-footprint benthic predator; gated to the 757 L tier and incompatible with a nano starter community, never a permanent "baby" | Peer-reviewed epaulette husbandry | `SPECIES.epaulette_shark`, `validatePurchase` |

---

## 1. State, time, and construction

- `createState({seed, credits, now, habitat})` builds a fresh, unstarted state
  (`habitat: null`, `credits: 120`, `tier: "nano20"`, `cycle.stage: "Setup"`, empty water).
- `applyHabitatChoice` (via `CHOOSE_HABITAT` or the `habitat` opt) locks the habitat, resets
  water/cycle/succession/livestock, and seeds a small starter microfauna population (live
  rock carries pods on a reef; leaf litter carries infusoria in freshwater).
- **Habitat aliasing (deliberate):** the first-run shell (`index.html`) submits
  `value="freshwater"`, and the renderer speaks `"marine"`/`"freshwater"`. `normalizeHabitat`
  maps `freshwater|fresh → amazon` and `marine|salt|saltwater → reef` so a canonical catalog
  id is always stored. Canonical ids remain `"amazon"` / `"reef"`.
- **Save keys:** v4 uses `pocket-aquarium-ecosystem-v1`; the arcade save
  `pocket-aquarium-v1` is referenced only as `DATA.arcadeKey` and is **never** written by the
  sim (it belongs to the preserved `checkpoints/arcade-v3` build).

**Time:** 1 game-day = 96 real seconds at 1× (`secondsPerGameDay1x`); speeds `[0,1,4,8]`.
`step(state, realSeconds)` converts to game-days and calls `stepDays`, which integrates in
`TICK_DAYS` sub-steps.

---

## 2. Cycling and the stocking gate

Setup actions (`SETUP_FILL`, `SETUP_LIFE_SUPPORT`, `ADD_AMMONIA_SOURCE`, `INOCULATE_BACTERIA`)
establish water and start the biofilter. Nitrification (`stepChemistry`):

- An ammonia source doses toward ~3 mg/L (`AMMONIA_DOSE`); fish metabolism and decaying
  biomass add ammonia; uneaten food decomposes to ammonia (`stepFeeding`).
- AOB convert NH₃→NO₂ and NOB convert NO₂→NO₃ at rates scaled by an environment factor
  `nitrifyEnv` (oxygen, a temperature optimum near 27 °C, and pH), by the tier's
  `biofilterBase`, and by the filter's `biofilterSurface`. Populations `aob`/`nob` mature
  logistically while substrate is present and attrit slowly without it (`BAC_DECAY`).
- **Stage classification** (`classifyCycle`): `Setup → Ammonia oxidation → Nitrite oxidation
  → Nitrate present → Cycled → Young biome → Mature biome`. "Cycled" requires a sustained
  safe window (`validationDays ≥ VALID_DAYS = 0.75` game-day) with ammonia/nitrite safe,
  nitrate present, and life support on. Biome stages are **tank-age** gates
  (`YOUNG_DAYS = 8`, `MATURE_DAYS = 20`).

**Deliberate abstraction — the "Cycled" label can be skipped.** The stage *label* reflects
the tank's current classification. If validation completes only after the tank has already
aged past 8 days (e.g., an un-inoculated cycle that finishes on ~day 9), the stage reads
**"Young biome"** directly, skipping the literal `"Cycled"` string. This is correct: the
**stocking gate** is `DATA.isCycled(state)`, which is true for any stage at or beyond
`"Cycled"`. Inoculation speeds the cycle so it finishes before day 8 and the `"Cycled"`
label does appear. Tests assert the *gate* opens and `stageIndex ≥ Cycled`, not the literal
label.

**The stocking gate never lets livestock into measurable ammonia/nitrite.** `validatePurchase`
requires `isCycled` for all livestock; `doFeed` raises a warning flag when fed into
dangerous water.

---

## 3. Water volume, evaporation, top-off, ATO

`updateVolumeAndConcentration` evaporates a fraction of volume per day (accelerated by
temperature and PAR). `applyDilution` conserves solute mass across a volume change:

- **Evaporation concentrates** dissolved species (salinity, alkalinity, Ca, Mg, wastes) —
  reef salinity climbs above 35 ppt as water is lost.
- **Manual top-off** (`WATER_TOP_OFF`) refills to full with pure freshwater, diluting salts
  back toward target (restores volume and pulls salinity down).
- **ATO** (`equipment.ato = "ato"`) auto-replaces evaporated freshwater every step, holding
  volume and therefore salinity essentially constant. Net solute mass across
  evaporate(old→new) + refill(new→full) equals a single dilution old→full; because ATO keeps
  the tank full each step, that dilution is a no-op and concentration stays steady — this is
  why an ATO tank reads a flat 35 ppt.

Freshwater tanks concentrate hardness (not salinity) the same way; top-off still dilutes
dissolved wastes.

---

## 4. Succession / "ugly phases" (independent drivers)

`stepSuccession` models four overlapping intensities, each with its **own** driver so they
respond independently (verified by differential tests):

- **Bacterial haze** ← nitrifier immaturity (high while `aob` is low and there is a bioload
  or ammonia source; fades as the filter matures).
- **Diatom film** ← young-tank silicate × light. Diatoms consume silicate, which depletes
  over time; independent of dissolved nutrients.
- **Green film** ← dissolved nutrients (nitrate/phosphate) × light, minus export.
- **Cyanobacteria** ← nutrients × **dead-zone (poor flow)** × long/high light, minus export,
  biodiversity, and flow. Strong circulation (low `deadzone`) and good nutrient export
  suppress it.

The intensities can co-occur (a young, nutrient-rich, poorly-circulated tank shows several
at once), but each is driven by a distinct term, so improving one factor moves only its
outcome.

---

## 5. Equipment and tiers (functional, not cosmetic)

Every equipment level carries coefficients consumed by the sim, so each upgrade produces a
measurable change (all verified in tests):

| Category | Coefficient | Effect |
|---|---|---|
| filter | `biofilterSurface`, `flow` | nitrifier capacity → higher `bioloadCapacity`; base flow |
| heater | `target`, `tempPull`, `stability` | pulls temperature toward target; reduces thermal noise |
| circulation | `flow`, `oxygen`, `deadzone` | raises O₂ and flow; lowers cyano dead-zone pressure |
| light | `parCeiling`, `photoperiodControl` | PAR available to corals (and the tetra dim-light trigger) |
| skimmer (reef-only) | `organicExport` | exports dissolved organics → faster phosphate/nitrate drawdown |
| refugium | `nitrateExport`, `podCapacity` | nitrate export + pod/infusoria carrying capacity |
| ato | `autoTopOff` | replaces evaporated freshwater; stabilizes volume/salinity |

Tiers change `volumeL` (dilution), `footprintCm2` (benthic gate), `biofilterBase`,
`hardscapeSlots`, and `bioloadCap`. Upgrading raises volume and capacity and unlocks
tier-gated species (e.g., pygmy corydoras need the 151 L tier).

---

## 6. Feeding, welfare, death, and waste

- **Feeding:** `FEED` / `FEED_AT` place a pellet at normalized tank coordinates. (`FEED_AT`
  is the renderer's pointer-feed action and is an alias of `FEED`.) The hungriest eligible
  alive fish claims each pellet; bottom feeders only take sunk pellets. Uneaten pellets
  decompose after `FOOD_DECAY_DAYS` into ammonia + phosphate.
- **Hunger → condition → health → death (staged, never one-missed-meal lethal):** hunger
  rises with metabolism; sustained high hunger (`>0.85`) lowers `condition`; low condition
  (`<0.3`) is a starvation stressor that lowers `health`. Toxic ammonia/nitrite, temperature
  and salinity shock, low oxygen, and chronic crowding are additional health stressors. At
  `health ≤ 0` the animal dies (`killAnimal`), the **dominant** stressor is logged as the
  proximate cause, and a memorial record is kept.
- **Corpse ammonia:** a dead animal is decaying biomass that keeps adding ammonia
  (`DECAY_AMMONIA`) until removed. `REMOVE_DEAD` clears it so the water can recover.

---

## 7. Compatibility and capacity (`validatePurchase`)

`validatePurchase(state, request)` is pure and returns **all** blocking reasons, not just the
first. It enforces: water type, habitat, cycle/stability gate, tier/volume/footprint, social
group minimum and maximum, bioload capacity, required tank features, expert gating and strong
filtration, predator↔prey conflicts (both directions), same-layer territoriality, and
invert/coral safety. The epaulette shark against a nano reef holding a clownfish returns the
full stack (tier, footprint, expert, strong-filtration, deep-sand feature, and predation on
the clownfish) — teaching *why* rather than treating "baby" as a permanent size.

---

## 8. Corals and polyps

`stepCorals` (reef only): each colony's **polyp extension** approaches an "open score" from
local PAR, flow, day/night (`daylight`), and water stability — so polyps open in good light
and moderate flow during the day and close at night. Growth accrues only while health is high,
stress is low, and polyps are extended; growth **consumes reef chemistry** (draws down
alkalinity, calcium, magnesium in proportion to `calcification × growth`) and raises polyp
count. Excess or insufficient light, over-strong flow, or unstable chemistry raise stress and
cause tissue loss before death.

**Fix applied in this lane (concrete failure).** The low-light stress term originally scored
`par == 0` at night as maximum "insufficient light" stress (because the PAR band score goes
negative below the band minimum). Combined with the daytime-only recovery window, a coral kept
under otherwise-ideal PAR, in-band flow, and stable chemistry still accrued full stress every
night and declined to zero health within ~2 weeks — the coral system could never thrive and
the `coral_mature` milestone was unreachable. The fix gates the insufficient-light stress by
the daylight factor:

```js
var badLight = (parS < 0.5 ? (0.5 - parS) : 0) * dayF;
```

Natural night darkness is normal for a day-feeder (its polyps simply close, already handled by
the `dayF` term in the open-score) and is no longer scored as harmful. All PAR/flow/stability
*responses are preserved*: too-dim **daytime** light, over-strong flow, and unstable chemistry
each still stress the coral and suppress growth. Under sustained good care a zoanthid now
survives, grows, and reaches a mature colony (~day 50 in the test fixture).

---

## 9. Microfauna

`stepMicrofauna`: pods and infusoria are logistic populations whose carrying capacity is set
by live rock/leaf litter and, especially, a refugium (`podCapacity`). They must be **seeded**
(live culture, refugium, or starter litter/rock) — an empty tank stays empty. Grazing
livestock apply predation pressure that holds the standing population below its ceiling.
Worms track detritus. A biodiversity score aggregates the populations and coral presence and
feeds back into cyanobacteria suppression and larval survival.

---

## 10. Breeding

**Ocellaris (pair-substrate):** two healthy mature clownfish under stable reef parameters with
a host feature and spare capacity form a protandrous hierarchy (largest → female, next →
male), bond over `pairBondDays`, then spawn adhesive eggs. Eggs incubate **7 game-days**
(within the 6–8 day window); unstable water spoils eggs. Larvae then depend on **pods**
(`microfauna.pods > 0.2`) to reach the fry stage — without pods the larvae starve. (In
practice the reef must hold salinity in-band via ATO/top-off, or evaporation drives it out of
the stability band and pairing/spawning stall — realistic husbandry.)

**Neon tetra (egg-scatter):** a school of ≥ 6 healthy adults in soft (`pH ≤ 6.8`,
`hardness ≤ 5`), dim (light PAR ceiling ≤ 80), covered, safe water spawns after a short
readiness window. Eggs incubate briefly (~1.2 days); larvae depend on **infusoria** to reach
fry. Milestones award XP/credits at spawn, hatch, and surviving-fry.

`stepClutches` advances `eggs → hatched → fry → (juveniles)` with stability and microfood
dependencies at each transition.

---

## 11. Persistence, sanitization, and offline catch-up

- `sanitizeState(raw)` never trusts a loaded save: it clamps every numeric range, validates
  enums/ids, keeps only same-habitat known livestock (invalid animals and corals are
  **quarantined to the log**, not rendered), drops malformed clutches, and returns a safe
  fresh state for total garbage. It never throws.
- `offlineCatchUp(elapsedMs)` applies elapsed time capped at `offlineCapDays = 2` game-days
  and returns a report (`requestedDays`, `appliedDays`, `capped`, `deaths`). Because welfare
  loss is gradual, a two-day jump cannot instantly kill a healthy animal without a visible
  causal log.

---

## Tuning constants (single source of truth: `sim.js`)

Rates are per game-day, chosen for readable pacing, not clinical accuracy:
`TICK_DAYS 0.05`, `VALID_DAYS 0.75`, `YOUNG_DAYS 8`, `MATURE_DAYS 20`, `AMMONIA_DOSE 0.7`,
`FOOD_DECAY_DAYS 0.6`, `METAB_AMMONIA 0.045`, `DECAY_AMMONIA 0.28`,
`CONDITION_LOSS 0.30 / RECOVER 0.18`, `HEALTH_STARVE 0.38 / TOX 0.5 / RECOVER 0.16`.
Parameter target/warn bands live in `data.js` (`PARAMS`), habitat-specific where relevant.

All of the above is exercised by `tests/sim.test.js` (151 deterministic assertions, runs in
well under a second).
