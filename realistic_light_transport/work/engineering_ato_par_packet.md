# RAQ-R3 Engineering, PAR, Evaporation, and ATO Research Packet

## Bottom Line

A physically coherent aquarium simulation should conserve water mass, dissolved-salt mass, and energy before it applies husbandry rules. The model should track actual operating water volume after rock, substrate, equipment, headspace, and sump displacement; distinguish filtration-loop turnover from local in-tank velocity; compute light at the organism rather than at the fixture; and let evaporation remove water but not salt. A reef ATO then adds only unsalted purified freshwater, normally RO/DI, to replace the missing water. Water changes, salt correction, and chemical dosing are separate operations.

The safest implementable baseline is a compartment model with a display, optional sump chambers, plumbing/device holdup, an ATO reservoir, and room air. Continuous water, salt, temperature, and light-dose states can use bounded integration, while pump starts, sensor thresholds, siphon breaks, dry-running, clogged drains, and overflows should be event driven. Marine reef and freshwater use separate rulesets. Some physical equations are shared, but marine salinity, reef ATO, marine foam fractionation, coral PAR, and conductivity-dependent ATO sensors must not leak into freshwater behavior.

## Scope and Research Posture

This is a refinement research packet for simulation engineers. It covers tank and sump geometry, pumps and flow, filtration, thermal control, gas exchange, PAR and photoperiod, spatial lighting, evaporation, salt-mass conservation, reef ATO operation and failure, water changes, dosing separation, and equipment capability tiers. It does not select livestock, prescribe a final tank build, or draft the final user-facing report.

Evidence labels used below:

- **Fact**: directly supported by a cited source.
- **Husbandry convention**: a practice or numeric guide, not a universal biological law.
- **Derived equation**: a mass, volume, energy, or photon balance derived from declared assumptions.
- **Design inference**: a recommended simulation abstraction based on facts and engineering constraints.
- **Tunable gameplay parameter**: a value that must be calibrated or selected for playability.
- **Welfare constraint**: a guardrail that prevents the game from treating predictably dangerous operation as harmless.

The research was planned as three bounded probes: physical life-support and hydraulics, lighting/PAR, and evaporation/salinity/ATO. The closure mode was discriminating source review plus deterministic unit checks. The surprise triggers were conflicting salinity conventions, universalized coral PAR ranges, and manufacturer-dependent ATO safeguards. All three occurred and are preserved rather than averaged away.

## Core State and Unit Contract

Use SI internally. Convert to US gallons only at the presentation boundary. NIST gives `1 US gal = 3.785411784 L`, with `1 L = 10^-3 m^3` ([NIST SI conversion factors](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8), [NIST volume definition](https://www.nist.gov/pml/special-publication-330/sp-330-section-4)).

| Symbol | Meaning | Internal unit | Notes |
|---|---|---:|---|
| `V_d`, `V_s`, `V_p` | Display, sump operating, and plumbing/device water volume | `m^3` | Derived from internal wetted geometry |
| `V_sys` | Total circulating system water volume | `m^3` | Excludes ATO reservoir and dry freeboard |
| `m_w` | Liquid water mass | `kg` | Conserved except evaporation, top-off, removal, and leaks |
| `m_s` | Conserved dissolved-salt-equivalent mass | `kg` | Marine state only; evaporation does not remove it |
| `m_sol` | Solution mass, `m_w + m_s` | `kg` | Add other solute ledgers if higher fidelity is needed |
| `S_A` | Mass-based salinity proxy, `1000 m_s / m_sol` | `g kg^-1` | Use as an implementable conservative state, with the composition limitation below |
| `S_P` | Practical Salinity from conductivity, temperature, pressure | dimensionless | Instruments often display legacy `PSU`; do not call it `g/kg` |
| `SG` | Specific gravity or relative density | dimensionless | Must carry sample and reference-temperature convention |
| `Q` | Volumetric flow | `m^3 s^-1` | Store actual duty-point flow, not only nameplate flow |
| `u(x,t)` | Local water velocity vector | `m s^-1` | Biologically relevant flow field |
| `T` | Water temperature | `deg C` or `K` deltas | Store sensor readings separately from true state |
| `E_PAR(x,t)` | Local PPFD over 400 to 700 nm | `umol photons m^-2 s^-1` | Common aquarium use of “PAR” |
| `DLI(x)` | Daily light integral | `mol photons m^-2 day^-1` | Time integral of local PPFD |
| `h` | Water elevation | `m` | Chamber-specific |
| `dot_m_e` | Evaporation mass rate | `kg s^-1` | Positive when water leaves the system |

## 1. Tank Volume, Dimensions, Sump, and Displacement

### Geometry and actual water volume

**Derived equation, rectangular compartment:**

```text
V_wetted = L_internal * W_internal * h_water
V_net = V_wetted - V_rock - V_substrate - V_equipment - V_other_displacement
V_sys = V_display_net + sum(V_sump_chambers_operating) + V_plumbing + V_reactors
```

All lengths must be in the same unit before multiplication. `1,000 cm^3 = 1 L`. Use internal dimensions and the actual operating water height. A marketed “gallon” size is not an adequate physics state because glass thickness, headspace, overflow boxes, rock, sand, equipment, and sump operating level change the water quantity.

**Derived worked example, hypothetical geometry:** a display with internal dimensions `120 cm x 50 cm x 50 cm` is `300 L` gross. At a `46 cm` operating height it contains `276 L` before displacement. Subtracting `35 L` of rock, substrate, and equipment leaves `241 L` in the display. Adding `60 L` of operating sump water and `5 L` of plumbing/reactor holdup gives `306 L`, or `80.84 US gal` using the NIST conversion above.

**Design inference:** volume should be recalculated after every hardscape, equipment, and operating-level change. A simpler game may use measured fill volume as authoritative and geometry as a visual cross-check. Density-dependent conversions should use `V = m_sol / rho(S,T,p)` rather than assuming that every liter has exactly 1 kg.

### Sump behavior

In a normally operating overflow system, display height is held near the overflow weir while evaporation appears mainly as a falling level in the variable-height return chamber. Oklahoma State describes the sump as the lowest system point and the only vessel whose level should fall from overall loss in its recirculating design ([Oklahoma State Extension](https://extension.okstate.edu/fact-sheets/recirculating-aquaculture-tank-production-systems-aquaponics-integrating-fish-and-plant-culture)). This is a physical compartment principle, not a reef-specific husbandry number.

**Design inference:** represent at least two sump regions if present:

1. fixed-height processing chambers controlled by baffles and the overflow;
2. a variable-height return chamber where evaporation, the low-water sensor, return-pump intake, and ATO sensor interact.

With no sump, the display itself is the variable-level compartment.

## 2. Circulation, Filtration Turnover, and Local Flow

### Keep four different rates separate

1. **Filtration-loop or whole-system turnover:** `N_filter = Q_return_actual / V_sys`, in `h^-1`.
2. **Nominal in-tank circulation ratio:** `N_circ = sum(Q_powerhead_actual) / V_display_net`, in `h^-1`.
3. **Local hydrodynamics:** velocity `u(x,t)`, turbulence, oscillation, shear, and direction at an organism or detritus cell.
4. **Net exchange or replacement:** true water added and removed by flow-through operation or water changes.

These quantities are not interchangeable. A Georgia Aquarium reef exhibit moved its entire volume through life support in about an hour yet produced no detectable in-exhibit current from the return, while separate surge pumps created noticeable flow ([public-aquarium husbandry chapter](https://static1.1.sqspcdn.com/static/f/639985/9530288/1290461460013/Carlson%2Bet%2Bal.%2BDesigning%2Band%2Bmaintaining%2BSS2%2B-%2Bchapter%2B28%2Bas%2Bpublished%2B%2B2009.pdf)). NOAA experimental-aquarium guidance likewise says there is no defined universal flow standard, offers ten tank-volumes per hour only as a rule of thumb, and recommends variable turbulent eddies rather than a direct unidirectional jet at coral ([NOAA technical memorandum](https://www.coris.noaa.gov/activities/cdhc_experimental_sys/crcp_tech_memo_18.pdf)).

**Derived worked example using the hypothetical system above:** an actual return flow of `1,200 L/h` through `306 L` yields `3.92 h^-1` filtration turnover. Two circulation pumps delivering an actual combined `8,000 L/h` in the `241 L` display yield a nominal `33.20 h^-1` in-tank ratio. Neither result determines the velocity at a coral behind rockwork.

### Actual pump flow

**Fact:** a centrifugal pump operates where its descending pump curve intersects the system head-loss curve; piping losses rise approximately with flow squared. Therefore, nameplate zero-head flow should not be used as actual flow ([US Department of Energy pump fundamentals](https://www.energy.gov/sites/default/files/2026-04/DOE-HDBK-1012-92_VOL3.pdf)). Aquaculture pump sizing must account for static lift, friction, fittings, and the selected pump performance diagram ([UF/IFAS pump-sizing guide](https://ask.ifas.ufl.edu/publication/AE579)).

**Design inference:** calculate or look up `Q_actual = pump_curve(H_total, speed, fouling)` where:

```text
H_total(Q) = H_static + H_pipe(Q) + H_fittings(Q) + H_filter(Q)
```

Filter loading, algae, pipe deposits, a partially closed valve, and a clogged intake raise system resistance. Variable-speed approximations may use the pump affinity laws only within their stated limitations. For a fixed impeller, flow varies roughly with speed, head with speed squared, and power with speed cubed, but systems with static head need a full system-curve calculation ([US Department of Energy](https://stage.energy.gov/sites/prod/files/2014/05/f16/adjust_speed_pumping.pdf)).

### Local flow as organism input

**Fact:** flow affects mass transfer, photosynthesis, heat, gas exchange, feeding, and waste removal at coral surfaces. Peer-reviewed work shows that oscillatory and turbulent flow can produce effects different from equal nominal unidirectional flow ([coral heat and mass-transfer study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6303798/), [flow and coral photosynthesis study](https://pmc.ncbi.nlm.nih.gov/articles/PMC2823876/)).

**Design inference:** use a low-cost vector field or zone graph rather than full CFD. Each pump contributes a time-varying jet/gyre field that is attenuated by distance and occluded or redirected by rock and colonies. Track dead zones, direct-jet stress, oscillation, and detritus-settling tendency separately from `N_circ`.

### Filtration categories

UF/IFAS identifies mechanical, chemical, and biological filtration as the core categories in recirculating systems; biological filters provide surface for nitrifiers that convert ammonia and nitrite toward nitrate ([UF/IFAS urban aquaculture overview](https://ask.ifas.ufl.edu/publication/FA217)). Oregon State describes chemical adsorption, marine protein skimming, and UV operation in aquatic life-support systems ([Oregon State animal-care resources](https://hmsc.oregonstate.edu/facilities/animal-care/animal-care-resources)).

Model these as distinct processes:

| Process | Removes or transforms | Capacity/failure state |
|---|---|---|
| Mechanical clarification | Suspended particles and detritus | Loading, bypass, pore size, cleaning interval |
| Biological filtration | Ammonia to nitrite to nitrate through microbial activity | Mature biomass, oxygen, alkalinity, temperature, surface area, toxic shock |
| Chemical media | Selected dissolved compounds by adsorption, ion exchange, or reaction | Finite capacity, selectivity, exhaustion, channeling |
| Foam fractionation/protein skimming | Surface-active dissolved organics and fine solids | Air draw, bubble/contact performance, salinity, neck fouling, cup overflow |
| UV | Organisms passing through an irradiated chamber | Lamp output, sleeve fouling, flow/contact dose |
| Ozone/oxidation | Oxidizable compounds and microbes in the treated stream | Dose, contact, off-gas and residual safety |
| Refugium/algal export | Nutrients incorporated into harvested biomass | Light, biomass, nutrient availability, harvest |

**Marine/freshwater separation:** foam fractionation works more dependably in saltwater and can be marginal or erratic in freshwater ([Southern Regional Aquaculture Center review hosted by Texas A&M](https://extension.rwfm.tamu.edu/wp-content/uploads/sites/8/2013/09/SRAC-Publication-No.-453-Recirculating-Aquaculture-Tank-Production-Systems-A-Review-of-Current-Design-Practice.pdf)). Do not give freshwater tanks a marine-skimmer benefit by default.

**Design inference:** equipment throughput is not system capacity by itself. Biofilter and solids capacity should be linked to feed and waste production, oxygen, and maintenance. UF/IFAS explicitly recommends redundancy for important filters and pumps and emergency protocols for power, pump, aeration, and temperature failures ([UF/IFAS RAS health-management guide](https://ask.ifas.ufl.edu/publication/FA101)).

## 3. Heating, Cooling, and Gas Exchange

### Energy balance

**Derived equation:** for a well-mixed compartment or coupled set of compartments,

```text
C_sys * dT/dt = P_heater*eta + P_pumps_to_water + P_light_to_water
                 - UA*(T - T_air) - dot_m_e*L_v - Q_chiller

C_sys = sum(m_i * c_p,i)
```

All right-side terms are watts, equivalent to joules per second. `UA` is an effective heat-transfer coefficient in `W/K`; `L_v` is latent heat in `J/kg`. Use a seawater property function or table for `rho`, `c_p`, and `L_v`. TEOS-10 provides a thermodynamically consistent seawater formulation and a specific-heat function in `J kg^-1 K^-1` ([TEOS-10 overview](https://www.teos-10.org/), [TEOS-10 heat-capacity function](https://www.teos-10.org/pubs/gsw/html/gsw_cp_t_exact.html)).

**Derived worked example, intentionally ignoring losses:** `100 kg` of seawater using the TEOS-10 reference heat-capacity constant `3,991.868 J kg^-1 K^-1` would warm by about `0.902 deg C` under `200 W` of net heat for `30 minutes`. Real warming is smaller while conductive, convective, radiative, and evaporative losses operate.

NOAA reports that many reef-building corals grow optimally in roughly `23 to 29 deg C`, while also making clear that tolerance varies and is not an aquarium setpoint prescription ([NOAA Ocean Service](https://oceanservice.noaa.gov/facts/coralwaters.html?os=io..)). Species and provenance, rather than a single reef-wide number, should own the welfare response curve.

### Control and failure states

**Design inference:** model true temperature, sensor temperature, sensor lag/bias, thermostat/controller state, and actuator output separately. Include hysteresis or a controller so the heater does not switch infinitely fast at one exact threshold.

Failures to expose:

- heater stuck off, stuck on, exposed above water, or locally overheating in poor flow;
- chiller or fan loss, blocked heat exchanger, hot room, or rejected heat warming the room;
- sensor detached from the water, biased, fouled, or reading a warmer/cooler chamber;
- power loss stopping both temperature control and circulation.

The Marine Biological Laboratory requires sump arrangements that preserve water over a submerged heater during unintended pump-out and uses marked safe sump levels verified by pump-off trials ([Marine Biological Laboratory heater guidance](https://new-www.mbl.edu/research/resources-research-facilities/laboratory-operations/submersible-heaters)). Treat low-water heater exposure as an electrical and thermal hazard, not merely an efficiency penalty.

### Gas exchange

**Derived process model:** for dissolved oxygen in one well-mixed compartment,

```text
dC_O2/dt = k_La * (C_star_O2(T,S,p_air) - C_O2)
            + photosynthetic_O2 - respiration_O2 - oxidation_demand
```

`k_La` is a calibrated gas-transfer coefficient in `s^-1`, and `C_star` is temperature-, salinity-, and pressure-dependent equilibrium concentration. Apply a corresponding carbon-dioxide flux rather than treating oxygen alone.

**Fact:** recirculating systems must include aeration and carbon-dioxide stripping among their core processes ([Southern Regional Aquaculture Center review hosted by Texas A&M](https://extension.rwfm.tamu.edu/wp-content/uploads/sites/8/2013/09/SRAC-Publication-No.-453-Recirculating-Aquaculture-Tank-Production-Systems-A-Review-of-Current-Design-Practice.pdf)). UF/IFAS also warns that suction-side pump leaks can cause gas supersaturation ([UF/IFAS](https://ask.ifas.ufl.edu/publication/FA101)).

**Design inference:** surface agitation, overflow cascades, skimmer air, and dedicated aeration modify `k_La`. A lid reduces open exchange and evaporation. A pump can create strong local circulation without adequate air-water exchange, and an air stone can improve exchange without providing suitable coral flow.

## 4. PAR, Spectrum, Photoperiod, and Spatial Lighting

### What PAR measures

NASA defines photosynthetically active radiation as the `400 to 700 nm` waveband ([NASA Earthdata](https://gcmd.earthdata.nasa.gov/KeywordViewer/scheme/sciencekeywords/b7410899-350a-4443-9430-c7fe1fa3a499/)). NOAA PAR instruments commonly report photon flux in `umol photons m^-2 s^-1` ([NOAA instrument definition](https://www.ncei.noaa.gov/archive/archive-management-system/OAS/bin/prd/jquery/insttype/details/153)).

**Fact:** equal total PAR does not imply equal spectral usefulness or equal coral response. Deep- and shallow-origin *Stylophora pistillata* showed opposite photosynthetic responses to blue-rich versus full-spectrum light, demonstrating depth-associated chromatic acclimation ([Journal of Experimental Biology](https://journals.biologists.com/jeb/article/213/23/4084/10071/The-spectral-quality-of-light-is-a-key-driver-of)). Store spectral distribution in bands alongside total PPFD. Do not derive coral health from Kelvin color temperature, human-visible brightness, watts, or fixture percentage.

### Daily light dose and dark period

**Derived equation:**

```text
DLI(x) = 10^-6 * integral_over_day(E_PAR(x,t) dt)
```

Here `E_PAR` is in `umol m^-2 s^-1` and time is in seconds, yielding `mol m^-2 day^-1`.

**Derived worked example:** constant `200 umol m^-2 s^-1` for `10 h` gives `7.2 mol m^-2 day^-1`. The same DLI from a shorter, higher peak is not assumed biologically equivalent.

An aquarium experiment on *Galaxea fascicularis* found that raising intensity or extending photoperiod did not necessarily raise growth, and continuous `24 h` light at `150 umol m^-2 s^-1` caused bleaching followed by mortality in that experiment ([Wageningen research record](https://research.wur.nl/en/publications/light-intensity-photoperiod-duration-daily-light-flux-and-coral-g/)). This supports an explicit dark period and separate instantaneous-intensity and DLI responses.

### Spatial light field

**Derived direct-light baseline by spectral band:**

```text
E_lambda(x,t) = sum_j[
  E0_j,lambda(t) * G_j(r,theta) * T_surface(lambda,theta)
  * exp(-K_d,lambda * z) * O_j(x)
] + E_scattered_lambda(x,t)
```

- `G_j` is fixture geometry, distance, lens, and angular falloff.
- `T_surface` is air-water interface transmission.
- `K_d,lambda` is a wavelength-dependent attenuation coefficient in `m^-1`.
- `O_j` is a `0..1` occlusion/transmission term for lids, braces, rock, colonies, and fouling.
- `E_scattered` represents reflected and scattered light rather than fully black shadows.

Beer-law attenuation is a valid optical baseline, but a measured clear-ocean coefficient is not an aquarium constant ([NOAA-hosted coral irradiance study](https://repository.library.noaa.gov/view/noaa/23872/noaa_23872_DS1.pdf)). Water clarity, yellowing compounds, particles, algae on covers, surface motion, fixture lenses, coral orientation, and hardscape can dominate a shallow tank. A PLOS ONE study measured much lower daily exposure on vertical than horizontal coral surfaces, demonstrating that colony face and orientation matter ([PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0295283)).

**Design inference:** precompute a light field on a coarse 3D grid and update it when fixtures, water clarity, surface state, rock, or colony geometry materially change. Layer fast visual caustics on top. Do not automatically translate shimmer into biological damage because experiments found large caustic variability without a detectable physiological effect in the tested species and conditions ([Journal of Experimental Biology study record](https://research.monash.edu/en/publications/shallow-water-wave-lensing-in-coral-reefs-a-physical-and-biologic/)).

### Coral acclimation state

**Design inference:** give each colony or illuminated face a light-history state. One implementable first-order form is:

```text
dA_i/dt = (ln(E_target_i + epsilon) - A_i) / tau_i
E_acclimated_i = exp(A_i)
```

Use separate fast photoprotection and slower pigment/symbiont acclimation states if fidelity permits. Positive jumps above acclimated exposure should be able to create damage faster than a healthy acclimation response develops.

**Fact:** time constants are species-specific. In a DLI-switching experiment, *Pachyseris speciosa* changed over about `3 to 5 days`, while *Acropora millepora* acclimation was slower than `20 days` ([peer-reviewed study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6150484/)). Those are experimental anchors for the named species and conditions, not universal ramp durations.

### PAR range limitation

NOAA institutional guidance gives `100 to 200 umol m^-2 s^-1` at coral depth for `10 to 12 light-hours` as a general experimental-system target and about `50 umol m^-2 s^-1` for new coral quarantine, but explicitly notes the lack of a defined universal standard ([NOAA coral experimental-systems memorandum](https://repository.library.noaa.gov/view/noaa/736/noaa_736_DS1.pdf)). Commercial hobby guidance often suggests soft coral `75 to 150`, LPS `150 to 250`, and SPS `250 to 350+ umol m^-2 s^-1` ([Bulk Reef Supply](https://www.bulkreefsupply.com/content/post/how-to-use-a-par-meter)).

**Source limitation:** the commercial bands are optional easy-mode placement hints, not biological limits. “Soft,” “LPS,” and “SPS” are too coarse to determine one optimum. The production database should prefer species, provenance, prior exposure, symbiont, colony face, spectrum, photoperiod, DLI, flow, feeding, temperature, and response endpoint. Any PUR score also requires an organism- and endpoint-specific spectral weighting function.

### Measurement realism

Planar downwelling PPFD and spherical scalar irradiance are different measurements. A sensor should be placed underwater at organism depth and should carry angular response, immersion correction, calibration, noise, and fouling states. Apogee, for example, publishes different underwater correction factors for different sensor models, illustrating that correction is device-specific rather than biology ([Apogee manufacturer guidance](https://www.apogeeinstruments.com/underwater-par-measurements/)).

## 5. Evaporation Mechanics

### Drivers

ASHRAE identifies water-surface area, water temperature, room-air moisture/dew point, air velocity, and activity/disturbance as evaporation drivers ([ASHRAE indoor pools](https://handbook.ashrae.org/Handbooks/A23/IP/A23_Ch06/A23_Ch06_ip.aspx)). Its mass-transfer discussion explains that saturated air at the interface must be replaced by drier air for rapid evaporation ([ASHRAE mass transfer](https://handbook.ashrae.org/Handbooks/F25/IP/F25_Ch06/F25_Ch06_ip.aspx)). Aquarium lids, fans, surface agitation, overflow cascades, skimmer air, room humidity, and room ventilation alter those same mechanisms.

Pool correlations should not be copied as exact aquarium calibrations. Aquarium surface scale, salt, lighting heat, canopies, turbulent pumps, overflow teeth, and wet equipment differ. Use a mechanistic form with a calibrated coefficient:

```text
dot_m_e = k_e * A_effective * [p_sat(T_water) - p_v,air]
p_v,air = RH * p_sat(T_air)
```

`k_e` has units `kg m^-2 s^-1 Pa^-1`, `A_effective` is `m^2`, and pressure is `Pa`, so `dot_m_e` is `kg s^-1`. A signed result can model condensation; a simpler game may clamp negative values to zero and disclose that choice. `k_e` should vary with air speed, surface disturbance, lid coverage, and air-exchange geometry.

**Derived timestep update:**

```text
Delta_m_evap = min(m_w_available, max(0, dot_m_e) * Delta_t)
m_w_next = m_w - Delta_m_evap
m_s_next = m_s
```

**Derived worked example using a measured/calibrated rate, not a universal recommendation:** if the current tank-room configuration loses `1.8 L/day`, then an `18 h` interval loses `1.35 L` of water, approximately `1.35 kg` at this precision. Record that loss at the variable-level chamber and remove the latent heat in the energy balance.

Salt does not evaporate. Salt can still leave through splash, aerosol, salt creep, skimmer export, leaks, harvested algae, removed livestock, and water changes. Those are separate salt-export fluxes. A perfect `dm_s/dt = 0` rule applies only to pure evaporation in a closed salt ledger.

## 6. Salinity, Practical Salinity, and Specific Gravity

TEOS-10 replaced EOS-80 as the official marine-science thermodynamic description. It uses Absolute Salinity `S_A` in `g/kg`, a mass-fraction measure, rather than Practical Salinity `S_P`, which is based principally on conductivity ([TEOS-10](https://www.teos-10.org/)). Practical Salinity is dimensionless under PSS-78 even though instruments and legacy datasets often display “PSU” ([NOAA salinity procedure](https://www.nodc.noaa.gov/archive/arc0001/9900162/2.2/data/0-data/jgofscd/Files/protocols/chap5.html)).

Specific gravity is a relative-density ratio, not a salt mass fraction. NIST defines it as the mass of a given volume relative to an equal volume of water under a stated convention ([NIST glossary](https://www.nist.gov/glossary-term/32421)). Aquarium instruments use calibration and temperature-compensation conventions that can differ. One aquarium calibration standard, for example, specifies its expected reading at `25 deg C`, which illustrates why reference metadata matters ([Brightwell manufacturer standard](https://brightwellaquatics.com/products/refractometer-hydrometer_cal.php)).

**Required implementation distinction:**

```text
SG(T_sample/T_reference) = rho_solution(S,T_sample,p) / rho_reference_water(T_reference,p_reference)
```

Do not convert salinity to SG with a single timeless constant. Use a TEOS-10 or validated artificial-seawater lookup with temperature, pressure, salt composition assumption, and instrument convention. Keep the hidden mass ledger authoritative; measurement devices report noisy, biased, calibrated observations.

**Composition limitation:** natural-ocean `S_A`, artificial-seawater salt mix concentration, `S_P`, and total dissolved solids are not strictly identical. TEOS-10 notes that spatial composition variation prevents a universally simple proportional conversion ([TEOS-10 getting-started guide](https://www.teos-10.org/pubs/gsw/v3_06_11/pdf/Getting_Started_test.pdf)). For an implementable game, `m_s/m_sol` may be named “reference-composition salt-equivalent mass fraction,” with instrument display derived separately.

## 7. Salt-Mass Conservation and Reef ATO

### Canonical marine mass state

Let `m_s` be dissolved salt-equivalent mass and `m_sol = m_w + m_s`. Then:

```text
S_A = 1000 * m_s / m_sol                       [g/kg]
V = m_sol / rho(S_A,T,p)                       [m^3]
```

### Evaporation concentration

Under pure-water evaporation `Delta_m_e`:

```text
m_s,1 = m_s,0
m_sol,1 = m_sol,0 - Delta_m_e
S_A,1 = 1000 * m_s,0 / (m_sol,0 - Delta_m_e)
```

**Derived worked example:** a `100 kg` solution at `35 g/kg` contains `3.5 kg` of dissolved salt equivalent. Evaporating `2 kg` of water leaves `98 kg` solution, so salinity rises to `35.714 g/kg`. This is concentration by water loss, not salt production.

### Freshwater top-off restoration

With freshwater top-off mass `Delta_m_f` whose salt-equivalent mass is zero:

```text
m_s,2 = m_s,1
m_sol,2 = m_sol,1 + Delta_m_f
S_A,2 = 1000 * m_s,1 / m_sol,2
```

Adding the missing `2 kg` to the worked example restores exactly `100 kg` and `35.000 g/kg`. UF/IFAS explicitly instructs that evaporated reef water be replaced with fresh RO water only because salt has not evaporated ([UF/IFAS marine aquarium guide](https://ask.ifas.ufl.edu/publication/4H433)).

**Locked welfare constraint:** normal reef ATO fluid is unsalted purified freshwater, normally RO/DI. Saltwater top-off progressively raises salinity. ATO is not a water change, salt correction, or dosing channel.

### ATO controller state machine

**Design inference:**

```text
OFF -> REQUEST_FILL     when h <= h_on for debounce_time
REQUEST_FILL -> FILLING when pump available, reservoir not empty, no lockout
FILLING -> OFF          when h >= h_off
FILLING -> LOCKOUT      on high sensor, max runtime, max dose, leak,
                         reservoir empty, pump fault, or implausible level response
LOCKOUT -> OFF          only after safe reset/recovery rule
```

Use `h_off > h_on` to create hysteresis. Pump addition is bounded every step:

```text
Delta_m_ATO = min(
  dot_m_pump(H) * Delta_t,
  m_reservoir,
  m_daily_cap_remaining,
  m_safe_level_remaining
)
```

Place the primary level sensor in the variable-height compartment. Store primary low sensor, independent high sensor or mechanical float, runtime timer, pump-current/dry-run state, reservoir-low sensor, leak detector, and alarm state separately.

Real systems demonstrate several architectures, not one standard. TUNZE documents an optical primary sensor, independent high safety sensor, dry-run protection, and a final `10 minute` safety timer on one Osmolator model ([TUNZE manual](https://www.tunze.com/fileadmin/gebrauchsanleitungen/x3151.8888.pdf)). Red Sea documents a normal `3 mm` control band, backup high probes about `2.5 cm` above normal cutoff, learned timeout behavior, dry/blocked pump detection, and leak lockout ([Red Sea ReefATO+ manual](https://g1.redseafish.com/wp-content/uploads/2023/02/9245ENG_ReefATO-Manual-w.pdf)). These are vendor-specific examples of safeguards, not universal thresholds.

### Siphon and reservoir placement

A stopped pump does not guarantee stopped flow if the outlet and reservoir geometry establish a siphon. Red Sea requires a siphon breaker when the feed outlet is below the reservoir water surface ([Red Sea support](https://g1.redseafish.com/support/video-guides/products/reefato-videos/tabs/faq/)).

**Design inference:** compute gravity-flow eligibility from elevation and tube continuity. A pump-off event must continue siphon flow until air enters, the reservoir empties, or an anti-siphon device succeeds. Model check valves and siphon breakers as maintainable components with fouling and failure probability, not magic booleans.

### Reservoir sizing tradeoff

**Design inference:**

```text
V_res_needed = evap_rate_design * unattended_duration * uncertainty_factor
V_res_incident_cap = volume that could reach the aquarium before independent cutoff
```

The reservoir must bridge the intended unattended period, but a larger connected reservoir increases worst-case dilution and flood volume. Treat the uncertainty factor and unattended duration as explicit design or gameplay inputs, not universal numbers.

**Derived failure example:** in the `100 kg`, `35 g/kg` system, `2 kg` first evaporates. If a stuck-on ATO then adds `8 kg` of freshwater instead of `2 kg`, total solution mass becomes `106 kg` while salt remains `3.5 kg`; salinity falls to `33.019 g/kg`. The connected reservoir and independent shutdown therefore bound incident severity.

### ATO fill-time example

**Derived hypothetical controller example:** an ATO pump delivering an actual `120 L/h` at installed head needs `45 s` to replace `1.5 L`. A `2 min` runtime cap would permit at most `4 L` during one uninterrupted run at that duty point. Both flow and timer are hypothetical tunable inputs; vendor pump curves, priming, head, tubing, and controller logic must replace them in an equipment profile.

### ATO failure matrix

| Failure | Immediate physical effect | Downstream risk | Detect/limit |
|---|---|---|---|
| Primary sensor stuck dry/low | Pump stays on | Dilution, sump/display overflow | Independent high sensor, runtime/dose cap, small connected reservoir, leak sensor |
| Primary sensor stuck wet/high | Pump never starts | Falling return level, rising salinity, pump dry | Reservoir and level trend, salinity trend, low-low sensor |
| Empty reservoir or blocked line | Commanded fill gives no level rise | Same as stuck-off; pump wear | Pump current/flow, reservoir sensor, response timeout |
| Siphon after pump stops | Uncommanded freshwater continues | Dilution and overflow | Outlet geometry, siphon break, high sensor, leak sensor |
| Sensor fouling, bubbles, snail, waves | False fills or missed fills | Oscillation, drift, incident | Debounce, sheltered placement, diverse redundant sensor, maintenance |
| Leak in aquarium or plumbing | ATO masks water loss by adding fresh water | Salinity decline, flood, reservoir exhaustion | Leak detector, abnormal daily-volume cap, salinity and fill-rate anomaly |
| Conductivity-dependent sensor used in freshwater | Sensor may not detect level correctly | Fill failure | Ruleset/equipment compatibility gate |
| Controller or power failure | Pump state freezes off or, depending on hardware, unsafe | Concentration or overfill | Fail-off hardware, independent mechanical cutoff, alarm/UPS |

Red Sea states that its ReefATO+ sensing depends on seawater conductivity and is not suitable for freshwater systems ([Red Sea support](https://g1.redseafish.com/support/video-guides/products/reefato-videos/tabs/faq/)). Equipment compatibility must therefore include sensing principle, not only tank size.

## 8. Water Changes, Salinity Correction, and Dosing Separation

### General well-mixed water-change balance

Remove fraction `f` of a well-mixed solution, then add replacement solution mass `m_rep` at salinity `S_rep`:

```text
m_s,new = (1-f)*m_s,old + (S_rep/1000)*m_rep
m_sol,new = (1-f)*m_sol,old + m_rep
S_new = 1000*m_s,new / m_sol,new
```

If the replacement mass exactly equals removed mass, this simplifies to:

```text
S_new = (1-f)*S_old + f*S_rep
```

**Derived example:** replacing `20%` of a `36 g/kg` system with equal mass at `35 g/kg` yields `35.8 g/kg`. Equal displayed volume is not necessarily equal mass if temperatures or salinities differ, so high-fidelity mode should convert through density.

Water-change schedules are husbandry choices driven by nutrient, contaminant, and element budgets. One UF/IFAS youth guide suggests `20 to 25%` monthly for its reef project, but that is a project convention rather than a universal optimum ([UF/IFAS marine aquarium guide](https://ask.ifas.ufl.edu/publication/4H433)). The simulation should apply the equation to whatever schedule the player selects.

### Dosing is not ATO

Each dosing pump adds named solute and carrier-water masses to chemical ledgers. Water changes remove all well-mixed dissolved species proportionally; selective precipitation, adsorption, biological uptake, skimming, and gas exchange then act on their own species.

**Locked design:** the baseline ATO reservoir contains clean RO/DI only. Red Sea advises against additives in its top-up reservoir because precipitation can block the float valve ([Red Sea support](https://g1.redseafish.com/support/product-support/products/reefer-xl-525-v3a/tabs/faq/Automatic%20Top%20Up/)). If an advanced mode permits kalkwasser or another additive in replacement water, instantiate it as a coupled dosing subsystem with concentration, precipitation, pH, pump-rate, and overdose consequences. Do not silently fold it into pure-water ATO.

## 9. Overflow, Drain-Down, and Low-Water Risk

### Return-pump-off drain-down

When the return pump stops, water above the overflow stop level and water in return plumbing can drain to the sump.

**Derived equation:**

```text
V_drainback = A_display * Delta_h_to_siphon_break
              + V_return_plumbing_drainable
              + V_overflow_and_device_drainable

V_sump_free = sum[A_chamber * (h_safe - h_run)]
safe when V_sump_free >= V_drainback + V_surge_margin
```

`V_surge_margin` is a design allowance for waves, uncertainty, and transient drainage. It is not a universal percentage.

**Derived hypothetical example:** a `120 cm x 50 cm` display falling `2 cm` contributes `12 L`. If plumbing and devices add `3 L`, drain-back is `15 L`. An `80 cm x 40 cm` sump with `8 cm` safe empty height has `25.6 L` freeboard. A tunable `20%` uncertainty allowance would require `18 L`, leaving `7.6 L` margin.

The Marine Biological Laboratory establishes safe sump level by actual shutdown trials ([Marine Biological Laboratory](https://new-www.mbl.edu/research/resources-research-facilities/laboratory-operations/submersible-heaters)). A simulated commissioning test should be a required safety gate.

### Drain restriction or blockage

If return inflow exceeds working-drain outflow:

```text
Q_net_display = max(0, Q_return - Q_working_drains)
t_to_display_overflow = V_display_headroom / Q_net_display
```

The volume actually available to flood the display is bounded initially by the return chamber above pump intake, but an enabled ATO can replenish it and worsen the incident.

**Derived hypothetical example:** `18 L` of display headroom with a fully blocked drain and `2,000 L/h` return flow overflows in `32.4 s` if the pump remains supplied. A return chamber with only `10 L` accessible above the pump intake runs low in `18 s`, potentially preventing the display flood but exposing the pump. A high display-level cutoff and emergency drain are therefore different safeguards from sump freeboard.

### ATO-off low-water event

Under normal recirculation, the pump does not consume net water. Evaporation lowers the variable chamber:

```text
V_return_margin = A_return * (h_current - h_min_pump)
t_to_pump_exposure = V_return_margin / dot_V_evap
```

**Derived hypothetical example:** a `40 cm x 30 cm` return chamber with `5 cm` water-height margin contains `6 L`; at `2 L/day` evaporation, an ATO-off fault exposes the intake in about `3 days`, ignoring chamber-shape and pump-vortex effects.

## 10. Equipment Capability Tiers

These are **design inferences for game progression**, not claims that one branded product or price guarantees welfare.

| Capability tier | Engineering capabilities | New failure/maintenance states |
|---|---|---|
| Manual/basic | Measured tank volume, basic mechanical/biological filter, single circulation source, timer light, thermostatic heater where needed, manual freshwater top-off, handheld salinity/temperature observations | Human delay, coarse observation, single-point failures, filter loading, heater failure |
| Controlled | Sump or organized filter path, pump curve-aware return, variable circulation, PAR mapping, skimmer for marine, RO/DI production, single primary ATO sensor with runtime cap, logged temperature and salinity | Sensor fouling, calibration, tubing/head loss, reservoir depletion, controller settings |
| Resilient | Independent ATO high cutoff, leak detector, dose/volume caps, anti-siphon protection, redundant temperature sensing, staged heaters, cooling, emergency aeration, high-display-level cutoff, emergency drain, flow/pump monitoring | Diverse-sensor disagreement, failover logic, alarm fatigue, maintenance debt |
| Advanced/automated | Multi-zone flow schedules, spectral lighting with acclimation program, equipment energy model, remote alarms, isolated dosing pumps, automated water-change subsystem, backups or spare capacity | Automation coupling, software/configuration fault, simultaneous failures, consumable exhaustion |

Upgrades should improve controllability, observability, efficiency, redundancy, or maintenance interval. They must not suspend conservation laws or make incompatible equipment valid. A high-tier marine conductivity ATO sensor is still incompatible with freshwater if its sensing principle requires saline water.

## 11. Numerical Stability and Gameplay-Time Contract

The following are **tunable gameplay inferences**, not husbandry facts:

1. Keep `m_w`, `m_s`, energy, and individual chemical masses as authoritative extensive states. Derive salinity, concentration, density, level, and SG after each accepted step.
2. Use adaptive substeps or event splitting so no pump, drain, leak, evaporation, or water-change operation removes more mass than is present or adds more than reservoir, chamber, or safe-capacity limits.
3. Treat sensor threshold crossings, pump dry state, siphon start/break, drain blockage, display overflow, sump overflow, and safety lockout as exact events within a coarse gameplay tick.
4. A practical real-time physics substep can be `1 to 60 s`, provided the solver additionally limits every flux to a small fraction of the affected compartment and resolves earlier threshold events. Accelerated time should increase the number of substeps, not multiply one unstable Euler jump.
5. Recompute density from salinity and temperature when converting mass to volume. A lookup table is acceptable if interpolation error is validated over the modeled range.
6. Compartment mixing must not be instantaneous across a stopped or weak pump. Exchange mass between compartments as `Delta_m = rho * Q * Delta_t`, bounded by donor mass.
7. DLI integrates the actual ramped, clouded, shaded local PPFD. Resetting DLI at a calendar boundary must not erase longer acclimation and damage states.
8. Seeded noise can vary evaporation, waves, sensor readings, and failure timing, but deterministic conservation tests should run with noise disabled.

### Required deterministic invariants

For a closed, no-leak, no-water-change marine test:

```text
evaporation only:       m_s(t1) == m_s(t0)
exact ATO restoration:  m_w(t2) == m_w(t0) and m_s(t2) == m_s(t0)
internal circulation:   sum(compartment masses) unchanged
light integration:      DLI == 10^-6 * sum(PPFD_k * Delta_t_k)
heater only, no losses: Delta_T == P * Delta_t / C_sys
```

Add tolerance only for floating-point operations, not for unexplained mass drift.

## 12. Marine and Freshwater Separation Contract

Shared physical modules may include geometry, water mass, pumps, head loss, heat transfer, overflow, evaporation, and sensor failure. The rule profiles remain separate:

| Surface | Marine reef | Freshwater |
|---|---|---|
| Salinity state | Explicit salt-mass ledger plus `S_A`, `S_P`, SG observation | No marine target; optional conductivity, hardness, TDS, or deliberate brackish salt are separate species-aware states |
| Evaporation replacement | Unsalted RO/DI freshwater in the baseline ATO | Fresh makeup water compatible with the freshwater system; mineral/hardness consequences remain possible |
| ATO sensor | Optical, float, pressure, or marine-conductivity design if compatible | Optical, float, pressure, or freshwater-rated design; block marine-conductivity-only sensor |
| Protein skimmer | Valid marine foam-fractionation process | Disabled or strongly performance-limited unless a sourced freshwater design says otherwise |
| Lighting biology | Coral species/symbiont PAR, spectrum, DLI, acclimation | Plant/algae or non-photosynthetic animal profile; do not reuse coral bands |
| Saltwater change | Premixed replacement salinity and salt balance | Freshwater chemistry and dechlorination/mineral balance; no marine salt mix unless explicitly brackish |

## 13. Limitations and Open Questions

1. No universal PAR, spectrum, photoperiod, or acclimation ramp exists across corals. Production values require a species/provenance database and explicit response endpoint.
2. Household-aquarium evaporation coefficients are highly installation-specific. The proposed vapor-pressure model needs calibration against measured losses across lid, fan, room humidity, sump, and surface-motion configurations.
3. The salt-equivalent ledger is conservative and implementable, but artificial salt mixes and changing chemical composition are not exactly natural TEOS-10 seawater. Decide whether density/SG uses a reference-seawater approximation or mix-specific tables.
4. Nominal pump flow and turnover cannot validate local hydrodynamics. The zone/vector approximation needs comparison with dye traces or a higher-fidelity reference scene.
5. Filter process capacities, sensor reliability, fouling rates, anti-siphon reliability, and equipment pump curves are product- and maintenance-dependent. They require equipment-profile data, not invented universal ratings.
6. Gas-exchange coefficients need empirical calibration. Surface agitation, overflow, skimmer air, lids, and room ventilation interact.
7. Structural glass/acrylic stress, stand loading, electrical codes, GFCI/RCD behavior, corrosion, and household damage are outside this packet and need a separate safety/structural control source before a real-world build guide.
8. Freshwater makeup chemistry can shift hardness, alkalinity, and conductivity even though no marine salt is added. That chemistry belongs in the freshwater packet.
9. Livestock welfare limits, tank footprints, swimming space, coral aggression, feeding, micro-invertebrates, and compatibility belong to their respective research packets.

## 14. Exact Downstream Instructions

### For A0 Aggregator

1. Carry forward the five-way distinction among evidence-backed fact, husbandry convention, derived equation, design inference, and tunable gameplay parameter. Do not silently promote a convention into a welfare law.
2. Preserve all four flow measures. Specifically cite the Georgia Aquarium example when explaining why life-support turnover does not determine local coral current.
3. Make the marine hidden state mass-based: `m_w`, `m_s`, and energy are authoritative; salinity, volume, and SG are derived observations. Preserve the TEOS-10 composition caveat.
4. Lock reef ATO to unsalted purified freshwater, normally RO/DI. Keep ATO, salt correction, water change, and dosing as separate verbs and state transitions.
5. Preserve SG temperature/reference metadata and Practical Salinity's dimensionless status. Do not write `35 PSU = 35 g/kg = SG 1.026` as an identity.
6. Preserve source limitations for PAR. Use commercial soft/LPS/SPS bands only as labeled easy-mode hints; select species/provenance profiles for realistic mode.
7. Retain overflow risk in both directions: pump-off drain-back into the sump and drain-blocked pump-up into the display. Include ATO masking of leaks as a coupled failure.
8. Route the open calibration questions to D2 as tunable profile fields, not invented constants.

### For D2 Engineering/Mechanics Drafter

1. Use the exact variable and unit contract in this packet. Present US gallons as a UI conversion only.
2. Include the `306 L` geometry example, the `100 kg at 35 g/kg` evaporation/ATO example, the equal-mass water-change equation, and both overflow examples. Label every input hypothetical or derived.
3. Present the evaporation driver equation with a calibrated `k_e`; do not copy a swimming-pool correlation as an exact aquarium law.
4. Present ATO as a hysteretic state machine with primary low sensing, independent high cutoff, runtime or dose cap, reservoir bound, leak detection, and siphon geometry. Describe TUNZE and Red Sea numbers only as vendor-specific examples.
5. Present PAR as local PPFD plus spectral bands, DLI, dark period, spatial occlusion/attenuation, and acclimation history. Preserve the absence of a universal coral-class target.
6. Present filtration-loop turnover, in-tank circulation ratio, and local velocity in separate fields and UI labels.
7. Show equipment progression as capability, observability, efficiency, redundancy, and maintenance improvements. Upgrades may reduce risk but never override conservation or freshwater/marine compatibility.
8. Keep marine and freshwater subsections visibly separate. Do not mention saltwater ATO in freshwater, do not grant freshwater a default marine-skimmer effect, and do not reuse coral PAR bands for plants.
9. Bind every factual statement and numeric recommendation to a nearby working Markdown link. Equations and hypothetical calculations must be labeled derived.

## 15. Source-Quality Summary

The strongest sources are TEOS-10/IOC for seawater properties and salinity definitions, NIST for units and specific-gravity framing, NOAA and peer-reviewed coral research for light and flow, university extension and professional animal-care programs for recirculating life support, and US Department of Energy material for pump/system curves. Manufacturer manuals are used only to demonstrate product-specific ATO sensing, cutoff, timeout, leak, and siphon behavior. Commercial hobby PAR bands and the UF/IFAS project water-change schedule are explicitly labeled conventions.

Confidence is high for conservation equations, the salinity-versus-SG distinction, pure-water reef top-off, pump/system-curve behavior, DLI integration, overflow/freeboard balances, and the need to model local flow and species-specific light history. Confidence is moderate for a low-cost spatial flow approximation and generic gas-transfer abstraction. Confidence is low for universal evaporation coefficients, coral-class PAR ranges, universal acclimation ramps, and brand-independent ATO timing or reliability.

## Receipt Metadata

- Artifact: `/Volumes/git/games/reef/work/engineering_ato_par_packet.md`
- Ticket: `RAQ-R3`
- Evidence revision: `reef-packet-v1-2026-09-02`
- Surface state: `before_surface_ready`
- Real audience entrypoint after downstream drafting: `/Volumes/git/games/reef/reef_aquarium_research_packet.md`
- Optional feedback gating: none; downstream A0, D1-D3, V1, corrections, and F1 remain required.
