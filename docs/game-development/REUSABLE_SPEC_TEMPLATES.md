# Reusable Game Specification Templates

These copyable specifications turn a detailed game idea into versioned contracts that simulation, asset, UI, testing, and release work can share. They are genre-neutral. Aquarium examples show evidence from the project; freshwater and wizard examples only demonstrate transfer.

Read [Foundation and Architecture](./FOUNDATION_AND_ARCHITECTURE.md), [Realism, Behavior, and Physics](./REALISM_BEHAVIOR_AND_PHYSICS.md), [Asset and Animation Pipeline](./ASSET_AND_ANIMATION_PIPELINE.md), and [Product Tooling, Validation, and Release Operations](./PRODUCT_TOOLING_AND_VALIDATION.md) before completing these records. The templates assume one authoritative World Model, typed intents and events, evidence separated from calibration, immutable asset candidates, transactional editing, and revision-bound validation.

## 1. How to use the templates

The requirements use these terms:

- **MUST** is required for the record to be complete.
- **SHOULD** is the default unless evidence supports another choice.
- **MAY** is optional and cannot weaken a MUST.
- **Observed** identifies a repository, runtime, test, or receipt fact.
- **Recommended** identifies a target design selected from evidence.

Every fenced copyable template uses one reserved marker for deliberately blank fields. That marker appears only inside fenced template blocks. Replace every marker before a record can pass its completion gate. Populated examples contain no template blanks and remain intentionally brief.

No template is a substitute for evidence. A completed record MUST link its sources, state its confidence, distinguish real-world or design evidence from game calibration, name the exact artifact revision, and preserve contradictory or missing evidence.

### 1.1 Template index

| Template | Decision it freezes | Primary consumers |
|---|---|---|
| Game Vision | Product fantasy, audience, canonical journey, authority, scope, and success | Entire team |
| Entity Profile | Stable content identity and links to all entity contracts | Catalog, simulation, store, UI |
| Morphology | Shape, scale, materials, rig, and physical envelope | Asset authors, physics, workbench |
| Behavior and Typicality | Characteristic repertoire, habitat use, timing, and motion limits | Behavior, animation, test authors |
| Environment and Biome | Space, fields, supports, capacity, succession, and content legality | World, level, physics, ecology |
| Interaction and Compatibility | Participant rules, phases, contacts, consequences, and resolutions | Simulation, store, HUD, tests |
| Asset Acceptance | Candidate gates, human visual decision, promotion eligibility, and debt | Creator tools, registry, reviewers |
| Simulation Contract | State, clocks, units, RNG, tick phases, invariants, and diagnostics | World and platform engineers |
| Test Matrix | Exact revision coverage across invariant, runtime, journey, and device gates | Test, review, release |
| Promotion Gate | Immutable state transition, exclusive write, validation, and rollback | Asset, content, and release owners |
| Milestone | Outcome, deliverables, surface, ownership, gates, and closeout | Product lead, orchestrator, release |

### 1.2 Shared record rules

All completed specifications MUST include:

- stable record ID and schema version;
- owner and review authority;
- source revision or immutable digest;
- status and superseded predecessor;
- evidence links, access date, permitted use, and confidence;
- assumptions and contradictions;
- acceptance checks with actual receipts;
- downstream consumers and invalidation rules;
- change history or decision record.

Measured values MUST state units and population, life stage, device, or environment where relevant. Probabilities MUST state the interval or event opportunity to which they apply. Rates MUST state their time basis. Ranges MUST state whether bounds are hard, typical, warning, or calibration limits.

## 2. Game Vision Template

Use this record before architecture or content fan-out. It freezes the smallest player promise and the product truth that every later milestone must preserve.

### Field definitions

| Field | Meaning |
|---|---|
| North star | One outcome-oriented statement of what the player repeatedly experiences |
| Player fantasy | The role, agency, and emotional promise |
| Canonical journey | Shortest real entrypoint-to-result player flow |
| Product pillars | A small set of decision filters |
| Authority contract | Which system owns consequential truth |
| Fidelity contract | Where realism or source fidelity is required and where abstraction is allowed |
| Scope locks | Boundaries that workers cannot reinterpret |
| Non-goals | Attractive work explicitly excluded from the current product |
| Platform target | Devices, orientations, controls, and release host states |
| Terminal condition | Observable proof that the vision is delivered |

### Copyable template

```markdown
# Game Vision: <fill in>

## Record

- Vision ID: <fill in>
- Schema version: <fill in>
- Owner: <fill in>
- Review authority: <fill in>
- Source revision: <fill in>
- Status: draft | reviewed | approved | superseded
- Supersedes: <fill in>

## North Star

<fill in>

## Player Fantasy

- Player role: <fill in>
- Repeated meaningful choice: <fill in>
- Desired emotional result: <fill in>
- Cost of failure: <fill in>
- Recovery promise: <fill in>

## Canonical Player Journey

- Entrypoint: <fill in>
- Initial fixture or save state: <fill in>
- Ordered player actions: <fill in>
- Observable world response: <fill in>
- Meaningful decision reached: <fill in>
- Expected duration: <fill in>

## Product Pillars

1. <fill in>
2. <fill in>
3. <fill in>

## Authority and Fidelity

- Authoritative World Model: <fill in>
- Player Intent boundary: <fill in>
- Domain Event boundary: <fill in>
- Presentation-only systems: <fill in>
- High-fidelity concerns: <fill in>
- Reduced-order or abstract concerns: <fill in>
- Typicality standard: <fill in>

## Audience and Platforms

- Primary audience: <fill in>
- Accessibility assumptions: <fill in>
- Target devices and OS range: <fill in>
- Pointer, touch, controller, or keyboard policy: <fill in>
- Portrait, landscape, and wide requirements: <fill in>
- Initial release state: web preview | PWA | device verified | signed internal | store candidate | published

## Scope Locks

- Included: <fill in>
- Excluded: <fill in>
- Existing behavior that MUST remain unchanged: <fill in>
- Decisions workers MUST NOT reopen: <fill in>

## Success Evidence

- Terminal condition: <fill in>
- Canonical acceptance journey: <fill in>
- Automated gates: <fill in>
- Human gates: <fill in>
- Performance and device budgets: <fill in>
- Release evidence required: <fill in>

## Sources and Assumptions

| Source ID | URI or repository anchor | Proposition supported | Accessed | Permitted use | Confidence |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | high / medium / low / inferred |

- Assumptions: <fill in>
- Contradictions: <fill in>
- Outcome-determinative open decisions: <fill in>
- Probe that closes each open decision: <fill in>

## Acceptance Checks

- [ ] North star describes a player outcome, not a feature inventory.
- [ ] Canonical journey reaches one meaningful result through the real entrypoint.
- [ ] World authority and presentation boundary are explicit.
- [ ] Fidelity and abstraction claims are bounded.
- [ ] Platform and input targets are concrete.
- [ ] Scope locks and non-goals prevent uncontrolled fan-out.
- [ ] Automated and human proof are both named where appearance or feel matters.
- [ ] Every source and assumption is traceable.
- [ ] Terminal condition is independently observable.

## Decision Record

- Decision: <fill in>
- Alternatives rejected: <fill in>
- Reason: <fill in>
- Date: <fill in>
- Approver: <fill in>
```

**Brief transfer example.** A freshwater vision can promise a living planted ecosystem governed by water, plant, and animal relationships. A wizard vision can promise travel through a responsive world in which spells, factions, ecology, and consequences persist. Both retain one World Model and one canonical player journey.

## 3. Entity Profile Template

Use one stable profile for every animal, plant, character, prop, vehicle, structure, or system that can appear in content. The profile links evidence and calibration rather than combining them.

### Field definitions

| Field | Meaning |
|---|---|
| Content identity | Stable ID, category, canonical name, variant, and body plan |
| Evidence reference | Immutable source claims and confidence |
| Calibration reference | Versioned gameplay rates and thresholds |
| Environment envelope | Legal and preferred regions and conditions |
| Lifecycle | Stages, needs, growth, decline, death, and reproduction |
| Compatibility | Hard requirements, warnings, relationships, conflict, and capacity |
| Behavior policy | Locomotion family, motivations, states, dwell, and cooldowns |
| Physical envelope | Collision/support shape and movement limits |
| Presentation | Immutable asset references and semantic actions |
| Progression | Unlock, cost, reward, care burden, and rarity |

### Copyable template

```markdown
# Entity Profile: <fill in>

## Record

- Content profile ID: <fill in>
- Schema version: <fill in>
- Content revision: <fill in>
- Owner: <fill in>
- Review authority: <fill in>
- Status: draft | validated | active | deprecated | superseded
- Supersedes: <fill in>

## Identity

- Stable entity ID: <fill in>
- Display name: <fill in>
- Scientific or canonical name: <fill in>
- Category: animal | plant | coral | creature | character | prop | system
- Variant ID: <fill in>
- Life stage or form: <fill in>
- Body plan ID: <fill in>
- Water, terrain, or world domain: <fill in>

## Linked Contracts

- Evidence profile ID and digest: <fill in>
- Calibration profile ID and digest: <fill in>
- Morphology specification: <fill in>
- Behavior and typicality specification: <fill in>
- Environment and biome specification: <fill in>
- Interaction and compatibility specification: <fill in>
- Presentation asset keys: <fill in>
- Physics or support profile: <fill in>

## Lifecycle

| Stage | Entry condition | Typical duration | Growth or capability | Needs | Exit condition |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

- Ideal-condition effects: <fill in>
- Neutral-condition effects: <fill in>
- Poor-condition effects: <fill in>
- Critical-condition effects: <fill in>
- Hunger, energy, or maintenance rate and unit: <fill in>
- Decline and death rules: <fill in>
- Reproduction rules: <fill in>

## Environment Envelope

- Legal regions: <fill in>
- Preferred regions and distribution: <fill in>
- Medium or terrain: <fill in>
- Temperature or climate range: <fill in>
- Chemistry or world-field ranges: <fill in>
- Light range: <fill in>
- Flow, wind, or weather range: <fill in>
- Substrate or support kinds: <fill in>
- Structure affinity: <fill in>
- Shelter requirements: <fill in>

## Compatibility

- Hard requirements: <fill in>
- Warnings: <fill in>
- Pair, group, faction, or party rules: <fill in>
- Territory rules: <fill in>
- Predation or combat rules: <fill in>
- Resource competition rules: <fill in>
- Environment capacity rules: <fill in>
- Allowed resolutions: block | accept modeled risk | remove or sell conflict | modify environment

## Behavior and Physics Summary

- Locomotion family: <fill in>
- Social mode: solitary | tolerant | pairing | schooling | territorial | mixed
- Dominant motivations: <fill in>
- Characteristic interactions: <fill in>
- Physical envelope shape: capsule | capsule chain | oriented box | support points | custom
- Dimensions and units: <fill in>
- Comfort distance: <fill in>
- Minimum clearance: <fill in>
- Cruise and maximum speed: <fill in>
- Maximum acceleration: <fill in>
- Minimum turn radius: <fill in>
- Maximum yaw, pitch, and roll: <fill in>

## Presentation and Progression

- Default promoted asset key: <fill in>
- Optional variants: <fill in>
- Real reference scale: <fill in>
- Required semantic actions: <fill in>
- Lifecycle visual parameters: <fill in>
- Unlock rule: <fill in>
- Cost and economy unit: <fill in>
- Reward or progression effect: <fill in>
- Care or operating burden: <fill in>

## Evidence and Calibration Boundary

- Immutable evidence claims: <fill in>
- Inferred evidence claims: <fill in>
- Deliberate gameplay acceleration: <fill in>
- Deliberate simplifications: <fill in>
- Calibration rationale: <fill in>

## Required Evidence

| Source ID | Proposition | URI or anchor | Accessed | Permission | Confidence |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | high / medium / low / inferred |

## Acceptance Checks

- [ ] Stable ID is unique and catalog-valid.
- [ ] Evidence and calibration digests are separate.
- [ ] Lifecycle rates have units and time bases.
- [ ] Environment and compatibility rules are actionable.
- [ ] Behavior and physical families are explicit and fail closed.
- [ ] Presentation assets cannot redefine gameplay truth.
- [ ] Real scale and variant semantics are unambiguous.
- [ ] Store text does not promise an unmodeled consequence.
- [ ] Content parity and schema validation pass.
- [ ] Downstream invalidation rules are recorded.

## Invalidation Rules

- Evidence changes that require review: <fill in>
- Calibration changes that require replay: <fill in>
- Asset changes that require renewed visual approval: <fill in>
- Schema or migration consequence: <fill in>
```

**Observed example.** Pocket Aquarium assigns stable species identities and separates gameplay authority from GLB presentation. Its broad catalog validation and exhaustive locomotion mapping are stronger than a filename-based asset catalog.

## 4. Morphology Template

Use this record to turn references into a three-dimensional, real-scale construction and validation contract. It applies to fish, plants, creatures, humanoids, vehicles, structures, and other presentation assets.

### Field definitions

| Field | Meaning |
|---|---|
| Measurement basis | Real or canonical dimensions and their exact definition |
| Coordinate contract | Units, forward, up, origin, and runtime conversion |
| View confidence | Evidence quality for side, top, front, and three-quarter views |
| Landmarks | Named repeatable shape anchors with tolerances |
| Sections | Longitudinal stations, cross-sections, volumes, or modular proportions |
| Appendages | Attachment, clearance, range, thickness, and deformation |
| Physical envelope | Physics representation distinct from render mesh |
| Visual debt | Known approximation that survives current acceptance |

### Copyable template

```markdown
# Morphology Specification: <fill in>

## Record

- Morphology ID: <fill in>
- Schema version: <fill in>
- Entity profile ID: <fill in>
- Body plan ID and version: <fill in>
- Owner: <fill in>
- Evidence digest: <fill in>
- Status: draft | evidence ready | candidate ready | approved | superseded
- Supersedes: <fill in>

## Measurement Basis

- Reference population, life stage, form, or variant: <fill in>
- Primary size: <fill in>
- Unit: <fill in>
- Measurement definition: <fill in>
- Typical range: <fill in>
- Hard permissible range: <fill in>
- Scale confidence: high | medium | low | inferred

## Coordinate Contract

- Source units: <fill in>
- Source forward axis: <fill in>
- Source up axis: <fill in>
- Anatomical or canonical origin: <fill in>
- Runtime forward axis: <fill in>
- Runtime up axis: <fill in>
- Scale conversion: <fill in>
- Root transform requirement: <fill in>

## Reference Views

| View | Source IDs | Stage or pose | Landmark baseline | Confidence | Known inference |
|---|---|---|---|---|---|
| Side | <fill in> | <fill in> | <fill in> | high / medium / low / inferred | <fill in> |
| Top | <fill in> | <fill in> | <fill in> | high / medium / low / inferred | <fill in> |
| Front | <fill in> | <fill in> | <fill in> | high / medium / low / inferred | <fill in> |
| Three-quarter | <fill in> | <fill in> | <fill in> | high / medium / low / inferred | <fill in> |

## Landmarks and Ratios

| Landmark or ratio | Definition | Target | Tolerance | Source IDs |
|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## Primary Volumes or Sections

| Section | Position | Height | Depth or width | Center offset | Section type |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## Appendages and Features

| Feature | Anchor | Dimensions | Neutral pose | Motion range | Clearance rule | Evidence |
|---|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## Materials and Surface Identity

- Anatomical or structural zones: <fill in>
- Color and marking boundaries: <fill in>
- Roughness, translucency, or subsurface cues: <fill in>
- Surface microstructure: <fill in>
- Procedural or owned texture inputs: <fill in>
- Prohibited source use: <fill in>

## Rig and Local Deformation

- Required bones, joints, or shape keys: <fill in>
- Deform-bone budget: <fill in>
- Neutral posture: <fill in>
- Local stiffness distribution: <fill in>
- Maximum bend or deformation: <fill in>
- Self-intersection exclusions: <fill in>
- Required semantic clips: <fill in>
- Root-motion policy: disabled | explicitly consumed by spatial solver

## Physical Envelope and Attachment

- Envelope type: capsule | capsule chain | oriented box | support points | custom
- Dimensions and units: <fill in>
- Clearance margin: <fill in>
- Support or attachment points: <fill in>
- Minimum turn radius: <fill in>
- Environment-conformance probes: <fill in>
- Collision mesh revision rule: <fill in>

## Variation and Visual Debt

- Known sex, stage, morph, or individual variation: <fill in>
- Variation represented in this asset: <fill in>
- Inferred dimensions: <fill in>
- Reviewer-approved visual debt: <fill in>
- Debt that blocks promotion: <fill in>

## Required Evidence

| Source ID | URI or anchor | Evidence class | Accessed | Permission | Proposition | Confidence |
|---|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | high / medium / low / inferred |

## Acceptance Checks

- [ ] Side, top, front, and depth claims are evidenced or explicitly inferred.
- [ ] Real scale and measurement definition are unambiguous.
- [ ] Coordinate axes, units, origin, and runtime conversion are tested.
- [ ] Landmarks and tolerances are machine-readable.
- [ ] Appendages attach correctly and remain clear through sampled clips.
- [ ] Closed volumes, thin surfaces, weights, and deformation meet the body-plan contract.
- [ ] Physical envelope fits the render morphology without becoming a visual bounding sphere.
- [ ] Materials use permitted or generated inputs.
- [ ] Distinctive anatomy is not reduced to a palette swap.
- [ ] Visual debt and natural variation are recorded.
```

**Observed example.** Pocket Aquarium fish use station-based lofts, real-world reference size, declarative fin anchors, pinned Blender generation, and separate physical envelopes. Banggai Cardinal evidence also demonstrates the correct practice of labeling strong lateral evidence and inferred top/front depth separately.

## 5. Behavior and Typicality Template

Use this record to describe what an entity usually does, not one scripted trace. It combines evidence-backed ranges with versioned game calibration and statistical acceptance.

### Field definitions

| Field | Meaning |
|---|---|
| Repertoire | Behaviors available to the entity |
| Typicality | Expected distributions, limits, and recognizable responses |
| Motivation | Scored reasons for choosing a state |
| State machine | Phases, entry, dwell, exit, cooldown, and interruption |
| Habitat use | Spatial distribution, support, refuge, and excursion rules |
| Social policy | Solitary, pairing, schooling, territorial, or mixed behavior |
| Kinematic limits | Forward ratio, speed, acceleration, turning, pitch, and roll |
| Presentation signals | Realized-motion and event outputs for animation and audio |

### Copyable template

```markdown
# Behavior and Typicality Specification: <fill in>

## Record

- Behavior policy ID: <fill in>
- Schema version: <fill in>
- Entity profile ID: <fill in>
- Evidence digest: <fill in>
- Calibration digest: <fill in>
- Owner: <fill in>
- Status: draft | scenario proven | spatially integrated | player proven | superseded

## Behavioral Identity

- Locomotion family: <fill in>
- Habitat envelope ID: <fill in>
- Social mode: solitary | tolerant | pairing | schooling | territorial | mixed
- Feeding or resource mode: <fill in>
- Activity schedule: <fill in>
- Signature behaviors: <fill in>
- Behaviors explicitly unavailable: <fill in>

## Evidence-Backed Typicality

| Concern | Typical range or distribution | Hard invariant | Variation | Source IDs |
|---|---|---|---|---|
| Posture | <fill in> | <fill in> | <fill in> | <fill in> |
| Speed and cadence | <fill in> | <fill in> | <fill in> | <fill in> |
| Habitat use | <fill in> | <fill in> | <fill in> | <fill in> |
| Social spacing | <fill in> | <fill in> | <fill in> | <fill in> |
| Stimulus response | <fill in> | <fill in> | <fill in> | <fill in> |

## Motivation Model

| Motivation | Inputs | Score range | Priority override | Suppression | Calibration rationale |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## State Machine

| State | Entry condition | Minimum dwell | Tick behavior | Exit condition | Cooldown | Interruptions |
|---|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## Habitat and Route Policy

- Legal regions or supports: <fill in>
- Preferred occupancy distribution: <fill in>
- Structure, shelter, or landmark affinity: <fill in>
- Coverage expectation: <fill in>
- Perch, dwell, patrol, or excursion distribution: <fill in>
- Target selection cadence: <fill in>
- Corner or deadlock escape rule: <fill in>
- Off-habitat behavior allowed only during: <fill in>

## Social and Relationship Policy

- Comfort distance and unit: <fill in>
- Close-contact exceptions: <fill in>
- Attraction or cohesion condition: <fill in>
- Separation response: <fill in>
- Stable passing-side rule: <fill in>
- Pair, school, party, or territory state: <fill in>
- Crowd response and hysteresis: <fill in>

## Kinematic and Physical Limits

- Cruise speed and unit: <fill in>
- Maximum speed and unit: <fill in>
- Maximum acceleration and unit: <fill in>
- Minimum turn radius and unit: <fill in>
- Maximum yaw rate and unit: <fill in>
- Maximum pitch: <fill in>
- Maximum roll: <fill in>
- Minimum forward-motion ratio: <fill in>
- Reverse or strafe policy: <fill in>
- Per-tick travel cap: <fill in>

## Interaction Hooks

- Eligible stimuli: <fill in>
- Target arbitration: <fill in>
- Required physical contacts: <fill in>
- Typed events emitted: <fill in>
- Exactly-once or cooldown rule: <fill in>
- Welfare, relationship, or progression consequence: <fill in>

## Presentation Contract

- Realized kinematic signals: <fill in>
- Semantic clip roles: <fill in>
- Event-triggered action pulses: <fill in>
- Local deformation limit: <fill in>
- Root-motion policy: <fill in>
- Audio cues: <fill in>

## Required Evidence and Calibration

| Claim or parameter | Evidence or design source | Real-world fact | Game calibration | Confidence | Rationale |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | high / medium / low / inferred | <fill in> |

## Acceptance Checks

- [ ] Entity maps to one named behavior and locomotion family.
- [ ] Unknown classifications fail closed.
- [ ] Every rate, dwell, probability, and distribution has a time or opportunity basis.
- [ ] Evidence and accelerated calibration remain separate.
- [ ] Behavior changes use hysteresis, minimum dwell, or cooldown where rapid flipping is possible.
- [ ] Realized motion, not desired heading, drives visible pose and cadence.
- [ ] Social spacing is soft while hardscape exclusion is hard.
- [ ] Habitat constraints remain active during feeding and other overrides.
- [ ] Deterministic scenarios test invariants and long-run distributions.
- [ ] The real player surface passes a revision-bound human typicality journey.

## Required Scenarios and Metrics

- Fixed-seed scenario list: <fill in>
- Long-run seeds and duration: <fill in>
- Distribution thresholds: <fill in>
- Jitter, stuck, clearance, and correction metrics: <fill in>
- Human workbench journey: <fill in>
- In-world journey: <fill in>
```

**Observed example.** Pocket Aquarium’s Diamond Goby policy uses long sand dwell periods, short transfers, and a rock excursion near five percent of its scheduled cycle. This is more testable and recognizable than a generic bottom-swimmer speed multiplier.

**Transfer example.** A wizard companion can use the same template for follow, investigate, converse, flee, rest, and combat states, with terrain and faction constraints replacing tank habitat and species compatibility.

## 6. Environment and Biome Template

Use this record for a tank, river, forest, dungeon, city district, planet, room, or any environment that constrains content and changes over time.

### Field definitions

| Field | Meaning |
|---|---|
| Spatial bounds | Legal world volume, portals, zones, and scale |
| Supports | Terrain, substrate, wall, rock, structure, water column, or navigation surfaces |
| Fields | Chemistry, light, flow, temperature, weather, visibility, magic, or sound |
| Succession | Time-driven state such as growth, fouling, decay, season, or control |
| Capacity | Physical, ecological, social, compute, or encounter limits |
| Collision revision | Exact geometry-to-physics identity |
| Fidelity declaration | Authoritative, reduced-order, projected, and display-only aspects |

### Copyable template

```markdown
# Environment and Biome Specification: <fill in>

## Record

- Environment ID: <fill in>
- Schema version: <fill in>
- Environment revision: <fill in>
- Hardscape revision: <fill in>
- Collision revision: <fill in>
- Owner: <fill in>
- Status: draft | validated | playable | promoted | superseded

## Player and Content Role

- Player fantasy supported: <fill in>
- Canonical journey segment: <fill in>
- Legal content categories: <fill in>
- Content explicitly excluded: <fill in>
- Progression or unlock role: <fill in>

## Spatial Contract

- World units: <fill in>
- Bounds or dimensions: <fill in>
- Coordinate axes and origin: <fill in>
- Zones and portals: <fill in>
- Traversable free space: <fill in>
- Occlusion and line-of-sight policy: <fill in>
- Large-entity admissibility rule: <fill in>

## Support and Navigation Contract

| Support kind | Geometry source | Legal entities | Normal or slope limit | Attachment rule | Connectivity |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

- Hardscape collision representation: <fill in>
- Dynamic obstacle policy: <fill in>
- Open passage preservation rule: <fill in>
- Draft edit to collision publication transaction: <fill in>

## Environmental Fields

| Field | Unit | Authority | Spatial resolution | Time basis | Bounds | Consumers | Known omissions |
|---|---|---|---|---|---|---|---|
| <fill in> | <fill in> | authoritative / projected / display-only | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## Zones and Habitat Envelopes

| Zone | Conditions | Preferred content | Prohibited content | Capacity | Transition rule |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## Succession and Lifecycle

- Initial state: <fill in>
- Time-driven transitions: <fill in>
- Resource inputs and outputs: <fill in>
- Growth, fouling, decay, season, or restoration: <fill in>
- Entity or equipment effects: <fill in>
- Visual projection of state: <fill in>
- Reversal, treatment, or reset rules: <fill in>

## Capacity and Compatibility

- Physical capacity: <fill in>
- Ecological or resource capacity: <fill in>
- Social or encounter capacity: <fill in>
- Rendering and device budget: <fill in>
- Store or spawn admission checks: <fill in>
- Warning and block thresholds: <fill in>

## Editing Contract

- Draft state: <fill in>
- Preview controls: <fill in>
- Validation rules: <fill in>
- Freeze behavior: <fill in>
- Atomic commit: <fill in>
- Cancel or undo: <fill in>
- Save and migration fields: <fill in>

## Required Evidence

| Source ID | Proposition | URI or anchor | Accessed | Permission | Confidence |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | high / medium / low / inferred |

## Acceptance Checks

- [ ] Units, bounds, axes, zones, and portals are explicit.
- [ ] Render geometry and collision derive from one saved revision.
- [ ] Open visual passages remain open to admissible physical envelopes.
- [ ] Every environmental field declares authority, consumers, fidelity, and omissions.
- [ ] Content admission uses environment and turning/support requirements.
- [ ] Succession changes both authoritative state and its visible projection.
- [ ] Editor preview cannot leak into authoritative state before commit.
- [ ] Static and dynamic spatial scenarios pass.
- [ ] Target-device rendering and memory budgets pass.
- [ ] Save, reload, and migration preserve environment and collision revisions.
```

**Observed example.** Pocket Aquarium links saved rockscape geometry to collision and support preparation, models rock and sand succession, and treats rendered optical flow separately from biological authority. The open-arch tests illustrate why a broad proxy rock volume is not enough.

## 7. Interaction and Compatibility Template

Use this record for feeding, cleaning, pairing, trade, dialogue, combat, predation, territorial conflict, crafting, treatment, or any multi-entity consequence.

### Field definitions

| Field | Meaning |
|---|---|
| Participants | Initiator, target, station, resource, observers, and ownership |
| Eligibility | Lifecycle, environment, relationship, inventory, and cooldown prerequisites |
| Phases | Approach, contact, service, consequence, depart, dwell, and cooldown |
| Contact | Deterministic spatial or logical gate for consequence |
| Domain event | Exactly-once committed result |
| Compatibility | Requirement, warning, modeled risk, capacity, and resolution |
| Player communication | Cause, consequence, options, feedback, and log |

### Copyable template

```markdown
# Interaction and Compatibility Specification: <fill in>

## Record

- Interaction ID: <fill in>
- Schema version: <fill in>
- Owner: <fill in>
- Evidence digest: <fill in>
- Calibration digest: <fill in>
- Status: draft | scenario proven | player proven | promoted | superseded

## Participants

- Initiator roles and eligible profiles: <fill in>
- Target roles and eligible profiles: <fill in>
- Station, item, terrain, or environmental role: <fill in>
- Observers or group participants: <fill in>
- Ownership and reservation rule: <fill in>

## Compatibility Classification

- Hard requirements: <fill in>
- Warnings: <fill in>
- Pair, group, faction, or territory rules: <fill in>
- Predation, combat, or harm rules: <fill in>
- Resource competition: <fill in>
- Capacity effects: <fill in>
- Allowed player resolutions: block | accept modeled risk | remove or sell conflict | modify environment

## Eligibility and Arbitration

- Initiator prerequisites: <fill in>
- Target prerequisites: <fill in>
- Environment prerequisites: <fill in>
- Need, condition, quest, or inventory prerequisites: <fill in>
- Cooldown and reservation checks: <fill in>
- Fairness or priority rule: <fill in>
- Tie-break and RNG stream: <fill in>
- Rejection reasons: <fill in>

## State Machine

| Phase | Entry | Minimum dwell | Target or route | Required contact | Exit | Interruption |
|---|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## Contact and Consequence

- Contact geometry or logical predicate: <fill in>
- Swept or discrete contact method: <fill in>
- Contact owner: deterministic spatial service | authoritative reducer
- Typed contact event: <fill in>
- Domain validation at commit: <fill in>
- Exactly-once key: <fill in>
- State changes: <fill in>
- Welfare, relationship, economy, or progression effects: <fill in>
- Follow-on event: <fill in>

## Presentation and Player Communication

- Anticipation signal: <fill in>
- Contact feedback: <fill in>
- Completion feedback: <fill in>
- HUD cause and consequence copy: <fill in>
- Player choices: <fill in>
- Accessibility equivalent: <fill in>
- Event-log record: <fill in>

## Persistence and Recovery

- Persisted phase and participants: <fill in>
- Save during interaction behavior: <fill in>
- Reload continuation: <fill in>
- Missing participant recovery: <fill in>
- Content-revision migration: <fill in>
- Rollback or cancellation: <fill in>

## Evidence and Calibration

| Rule | Source | Observed or recommended | Game calibration | Confidence | Consequence if wrong |
|---|---|---|---|---|---|
| <fill in> | <fill in> | Observed / Recommended | <fill in> | high / medium / low / inferred | <fill in> |

## Acceptance Checks

- [ ] Every participant and eligibility rule is explicit.
- [ ] Warnings describe modeled consequences and legal resolutions.
- [ ] State phases have dwell, exit, interruption, and cooldown rules.
- [ ] Consequence requires authoritative contact or a named logical predicate.
- [ ] Exactly one committed event can consume or apply each effect.
- [ ] Renderer feedback cannot create the gameplay consequence.
- [ ] Habitat and compatibility remain enforced during approach.
- [ ] Save and reload preserve or safely cancel the interaction.
- [ ] Deterministic success, rejection, interruption, and duplicate-contact scenarios pass.
- [ ] The real player journey makes cause and consequence legible.

## Required Scenarios

- Eligible success: <fill in>
- Ineligible rejection: <fill in>
- Competing initiators: <fill in>
- Interrupted approach: <fill in>
- Duplicate contact: <fill in>
- Save and restore: <fill in>
- Accept-risk consequence: <fill in>
- Remove or sell conflict: <fill in>
```

**Observed example.** Pocket Aquarium cleaner-shrimp service uses an eligible parasitized client, a visible station, approach, physical contact, service, departure, cooldown, and one treatment dispatch. Nori grazing and food contact follow a related pattern, though accepted evidence identifies renderer-owned contact as an authority gap to migrate.

## 8. Asset Acceptance Template

Use this record for each immutable asset candidate. It captures structural validation and the human visual decision without silently promoting runtime content.

### Field definitions

| Field | Meaning |
|---|---|
| Candidate identity | Immutable name, source revision, toolchain, and hashes |
| Candidate Validation | Automated source, runtime, determinism, and budget status |
| Visual Approval | Human decision at exact digest and fixed journey |
| Runtime Promotion | Separate registry state and predecessor |
| Visual debt | Known limitation explicitly carried forward |

### Copyable template

```markdown
# Asset Acceptance Record: <fill in>

## Candidate Identity

- Entity or species ID: <fill in>
- Variant ID: <fill in>
- Asset key: <fill in>
- Candidate ID: <fill in>
- Asset version: <fill in>
- Body plan ID and version: <fill in>
- Source revision: <fill in>
- Source specification SHA-256: <fill in>
- Reference packet SHA-256: <fill in>
- Candidate bundle SHA-256: <fill in>
- Geometry digest: <fill in>
- Rig digest: <fill in>
- Texture hashes: <fill in>
- Builder and validator hashes: <fill in>
- Toolchain and exporter: <fill in>

## Status

- Candidate Status: draft | source_valid | runtime_valid | deterministic | rejected | superseded
- Visual Approval Status: not_reviewed | approved | rejected | revoked
- Runtime Promotion Status: not_promoted | promoted_nondefault | promoted_default | rolled_back
- Predecessor asset key and hash: <fill in>
- Superseded or rejected candidate links: <fill in>

## Evidence Readiness

- Evidence profile ID and digest: <fill in>
- Reference size and measurement kind: <fill in>
- Side/top/front/three-quarter confidence: <fill in>
- Licensed or permitted reference uses: <fill in>
- Inferred anatomy: <fill in>
- Known natural variation: <fill in>

## Automated Candidate Validation

| Gate | Command or validator | Revision | Result | Receipt |
|---|---|---|---|---|
| Source integrity | <fill in> | <fill in> | pass / fail | <fill in> |
| Runtime equivalence | <fill in> | <fill in> | pass / fail | <fill in> |
| Deterministic rebuild | <fill in> | <fill in> | pass / fail | <fill in> |
| Performance budget | <fill in> | <fill in> | pass / fail | <fill in> |
| Registry and content parity | <fill in> | <fill in> | pass / fail | <fill in> |

## Workbench Acceptance Journey

- Workbench entrypoint: <fill in>
- Exact candidate digest: <fill in>
- Promoted predecessor for comparison: <fill in>
- Reference overlay set: <fill in>
- Fit-scale views inspected: side | top | front | three-quarter | turntable
- True shared-scale views inspected: side | top | front | three-quarter
- Wireframe and skeleton inspected: <fill in>
- Clips, speeds, and phases inspected: <fill in>
- Turn and environment-conformance previews: <fill in>
- Runtime statistics inspected: <fill in>
- Screenshot or proof-render hashes: <fill in>

## Human Decision

- Reviewer: <fill in>
- Review time: <fill in>
- Approval statement: <fill in>
- Reference match summary: <fill in>
- Motion typicality summary: <fill in>
- Scale and relative-size summary: <fill in>
- Rejection reason if rejected: <fill in>
- Known visual debt approved by reviewer: <fill in>
- Debt that still blocks promotion: <fill in>

## Runtime and In-World Proof

- Immutable runtime bundle path: <fill in>
- Runtime SHA-256: <fill in>
- Default-for-entity status: <fill in>
- Semantic clip roles and loops: <fill in>
- Root-motion removal proof: <fill in>
- Real-scale player proof: <fill in>
- Collision, support, or attachment proof: <fill in>
- Lifecycle material or state proof: <fill in>
- Desktop, portrait, landscape, and device budget receipts: <fill in>

## Acceptance Checks

- [ ] Candidate identity and every relevant hash are immutable.
- [ ] Source, runtime, determinism, and performance gates have current receipts.
- [ ] Candidate status does not imply human approval.
- [ ] Visual approval identifies the exact candidate digest and fixed journey.
- [ ] Fit scale and true shared scale were both reviewed.
- [ ] Every required local clip and transition was inspected.
- [ ] Rejected and superseded candidates remain recorded.
- [ ] Visual approval does not change the runtime registry.
- [ ] Promotion requires exact hash identity and has a predecessor.
- [ ] In-world proof uses the real player loader and behavior adapter.

## Signature

- Visual reviewer decision: approve | reject | revoke
- Reviewer identity: <fill in>
- Exact signed candidate digest: <fill in>
- Signature or repository receipt: <fill in>
```

**Observed example.** Pocket Aquarium’s Banggai Cardinal successor retained the superseded candidate, rebuilt through deterministic Blender gates, and received a new hash-bound runtime promotion. The history demonstrates why “exported successfully” cannot mean visually approved.

## 9. Simulation Contract Template

Use this record before implementing a consequential system. It fixes authority, units, clocks, transition order, fidelity, diagnostics, persistence, and tests.

### Field definitions

| Field | Meaning |
|---|---|
| State authority | Serializable facts that may affect later outcomes |
| Clock | Fixed causal tick and separate presentation timing |
| Inputs and outputs | Typed Player Intents and Domain Events |
| Transition order | Stable phase ordering inside one tick |
| RNG | Stored state or named deterministic streams |
| Fidelity | What is simulated, approximated, projected, or omitted |
| Invariants | Properties that remain true across every tick |
| Persistence | Save, restore, migration, catch-up, and revision pinning |

### Copyable template

```markdown
# Simulation Contract: <fill in>

## Record

- Simulation ID: <fill in>
- Schema version: <fill in>
- Owner: <fill in>
- Source revision: <fill in>
- Content revision: <fill in>
- Status: draft | headless proven | spatially integrated | player proven | promoted | superseded
- Supersedes: <fill in>

## Authority Boundary

- Consequential state owned: <fill in>
- Read-only projections: <fill in>
- Presentation-only state: <fill in>
- External adapters: wall clock | storage | input | renderer | platform lifecycle
- Competing authority explicitly prohibited: <fill in>

## Units and Fidelity

| Quantity | Unit | Dimension | Bounds | Authority | Consumers | Fidelity and omissions |
|---|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | authoritative / projected / display-only | <fill in> | <fill in> |

- Reduced-order model declaration: <fill in>
- Conserved or balanced quantities: <fill in>
- Numerical caps and their rationale: <fill in>
- Measurement-dependent choices and required probes: <fill in>

## Clock and Randomness

- Fixed tick duration: <fill in>
- Ecology, world, or subsystem cadence: <fill in>
- Presentation interpolation: <fill in>
- Accumulator behavior: <fill in>
- Pause behavior: <fill in>
- Catch-up and maximum elapsed policy: <fill in>
- RNG state representation: <fill in>
- Named random streams and ordering: <fill in>

## Serializable State

- Environment state: <fill in>
- Entity state: <fill in>
- Spatial state: <fill in>
- Behavior phase, target, dwell, and cooldown state: <fill in>
- Relationship and interaction state: <fill in>
- Economy and progression state: <fill in>
- Pending intents and recent events: <fill in>
- Hardscape and collision revisions: <fill in>
- RNG and clock accumulator: <fill in>

## Typed Player Intents

| Intent | Required fields | Validation | Rejection reasons | Persistence priority |
|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## Typed Domain Events

| Event | Emitter phase | Required IDs | Exactly-once key | Consumers |
|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## Ordered Tick

1. <fill in>
2. <fill in>
3. <fill in>
4. <fill in>
5. <fill in>

## State Machines and Spatial Services

- Motivation and behavior transition policy: <fill in>
- Static collision world: <fill in>
- Dynamic neighbor service: <fill in>
- Support graph: <fill in>
- Flow, weather, or field sampler: <fill in>
- Swept contact resolver: <fill in>
- Large-entity admissibility rule: <fill in>
- Animation presentation output: <fill in>

## Invariants

- Finite-state invariant: <fill in>
- Range and conservation invariants: <fill in>
- Per-tick movement and angular invariants: <fill in>
- Hardscape and support invariants: <fill in>
- Interaction uniqueness invariant: <fill in>
- Pause invariant: <fill in>
- Save and restore invariant: <fill in>
- Mode parity invariant: <fill in>

## Persistence and Migration

- Save envelope and monotonic sequence: <fill in>
- Action-time persistence: <fill in>
- Periodic persistence: <fill in>
- Sanitation: <fill in>
- Offline or suspend/resume continuation: <fill in>
- Schema migration: <fill in>
- Content and collision revision migration: <fill in>
- Development and showcase namespaces: <fill in>

## Diagnostics and Performance

- Diagnostic snapshot fields: <fill in>
- Event-ring fields and size: <fill in>
- Deterministic trace format: <fill in>
- CPU, memory, and tick budget: <fill in>
- Low-end device probe: <fill in>
- Degradation policy for presentation-only systems: <fill in>

## Required Evidence

| Claim | Source or design decision | Confidence | Calibration consequence |
|---|---|---|---|
| <fill in> | <fill in> | high / medium / low / inferred | <fill in> |

## Acceptance Checks

- [ ] Every gameplay-relevant fact has one serializable authority.
- [ ] Consequential causes advance only on a fixed causal clock.
- [ ] Units, bounds, consumers, fidelity, and omissions are explicit.
- [ ] Intents and events are exhaustive and typed.
- [ ] Tick phases and RNG ordering are deterministic.
- [ ] Renderer, camera, hover, and particles cannot mutate gameplay truth.
- [ ] Physics resolves intent and presentation follows realized state.
- [ ] Pause, chunking, save, reload, sanitation, and migration scenarios pass.
- [ ] Headless invariants and real player journeys use the same reducer.
- [ ] Device budget and diagnostic receipts bind to the exact revision.

## Required Scenario Set

- Golden replay: <fill in>
- Frame-chunk equivalence: <fill in>
- Pause and resume: <fill in>
- Contact uniqueness: <fill in>
- Collision and support: <fill in>
- Crowd or agent interaction: <fill in>
- Save during active behavior: <fill in>
- Multiple-writer persistence: <fill in>
- Long-run soak: <fill in>
```

**Observed example.** Pocket Aquarium’s root model already stores seeded random state, advances ecology in fixed game-day steps, exposes an action reducer, sanitizes saves, and caps offline catch-up. The recommended extension is to bring spatial continuation and consequential contact under the same deterministic authority.

## 10. Test Matrix Template

Use this record to bind every validation claim to the exact revision, environment, fixture, command or journey, expected result, and receipt.

### Field definitions

| Field | Meaning |
|---|---|
| Layer | Static, unit, property, spatial, runtime, workbench, browser, package, or device |
| Contract | Exact invariant or player promise being tested |
| Fixture and seed | Reproducible initial world and random stream |
| Environment | Runtime, browser, OS, device, viewport, input, and mode |
| Evidence | Command output, state hash, trace, screenshot, video, artifact hash, or human record |
| Invalidation | Change classes that make the receipt stale |

### Copyable template

```markdown
# Test Matrix: <fill in>

## Record

- Matrix ID: <fill in>
- Scope: <fill in>
- Owner: <fill in>
- Source revision: <fill in>
- Build or artifact digest: <fill in>
- Content revision: <fill in>
- Environment revision: <fill in>
- Status: draft | running | passed | failed | superseded

## Coverage Matrix

| Test ID | Level | Contract or journey | Fixture and seed | Environment and mode | Input or command | Expected result | Evidence receipt | Status | Invalidation rule |
|---|---|---|---|---|---|---|---|---|---|
| <fill in> | static / deterministic / spatial / runtime / workbench / browser / packaging / device | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | pass / fail / blocked | <fill in> |

## Canonical Audience Journeys

### Desktop

- Entrypoint and mode: <fill in>
- Viewport and input: <fill in>
- Ordered actions: <fill in>
- Observable result: <fill in>
- Console and network expectation: <fill in>

### Portrait Touch

- Entrypoint and mode: <fill in>
- Device or emulation: <fill in>
- Viewport, safe area, and input: <fill in>
- Ordered actions: <fill in>
- Observable result: <fill in>

### Landscape Touch

- Entrypoint and mode: <fill in>
- Device or emulation: <fill in>
- Viewport, safe area, and input: <fill in>
- Ordered actions: <fill in>
- Observable result: <fill in>

### Workbench or Creator Surface

- Entrypoint and exact candidate digest: <fill in>
- Fixed views and controls: <fill in>
- Automated gates already passed: <fill in>
- Human question: <fill in>
- Decision receipt: <fill in>

### Native Device

- Release status: device_verified | signed_internal | store_candidate | published
- Exact staged build digest: <fill in>
- OS and device: <fill in>
- Install and launch: <fill in>
- Offline, suspend, resume, and rotation: <fill in>
- Memory, thermal, startup, and frame budgets: <fill in>
- Result receipt: <fill in>

## Deterministic and Statistical Coverage

- Fixed-seed replay set: <fill in>
- Property-test ranges: <fill in>
- Long-run seeds and duration: <fill in>
- Distribution thresholds: <fill in>
- Conservation and finite-state checks: <fill in>
- Save, sanitize, migrate, and reload checks: <fill in>

## Failure Loop

| Attempt | Observed error | Owning contract | Smallest change | Affected restart | Identical retry result | Durable guard |
|---|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | advanced / same error / new error / passed | <fill in> |

## Acceptance Checks

- [ ] Every product requirement maps to at least one test or human journey.
- [ ] Receipts identify exact revision, fixture, seed, environment, and input.
- [ ] Static and headless tests do not claim visual or device proof.
- [ ] Human screenshots do not replace state, console, hash, or invariant checks.
- [ ] Desktop, portrait, and landscape use the same mechanics.
- [ ] Creator decisions bind to immutable candidate digests.
- [ ] Packaging proves byte identity before device claims.
- [ ] Failed and blocked results remain visible.
- [ ] Every repair leaves a durable guard.
- [ ] Receipt invalidation rules trigger revalidation after affected changes.

## Coverage Gaps and Disposition

| Requirement | Gap | Risk | Blocking class | Planned probe or explicit deferral |
|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | block now / hardening / nonblocking | <fill in> |
```

**Observed example.** Pocket Aquarium’s strongest browser proof recorded exact revision, route, viewport, state changes, console health, and screenshot hashes on an isolated port. Its root and asset tests answer different questions and should remain separate rows rather than being collapsed into one green status.

## 11. Promotion Gate Template

Use this record whenever a candidate, schema, content set, feature flag, build, or native release becomes active or default. Promotion is an immutable transaction, not a copy command without evidence.

### Field definitions

| Field | Meaning |
|---|---|
| From and to state | Explicit lifecycle transition |
| Immutable identity | Candidate or release digest being promoted |
| Base compare | Expected registry, manifest, or production predecessor hash |
| Exclusive owner | Single authority permitted to write the shared target |
| Prerequisites | Automated, human, security, device, and authorization receipts |
| Post-write validation | Checks against the committed target, not the candidate workspace |
| Rollback | Immutable predecessor, trigger, owner, and compatibility |

### Copyable template

```markdown
# Promotion Gate: <fill in>

## Record

- Promotion ID: <fill in>
- Artifact class: asset | content | simulation | feature | web build | native build | release
- Owner: <fill in>
- Required approver: <fill in>
- Source revision: <fill in>
- Requested transition: <fill in>
- Status: proposed | locked | committed | validated | rejected | rolled back

## Immutable Identity

- Candidate or build ID: <fill in>
- Candidate or build SHA-256: <fill in>
- Source and evidence digests: <fill in>
- Content, schema, and environment revisions: <fill in>
- Toolchain and builder identity: <fill in>
- Expected base registry or release hash: <fill in>
- Predecessor ID and hash: <fill in>

## Prerequisite Gates

| Gate | Required result | Exact receipt revision | Owner | Status |
|---|---|---|---|---|
| Contract and schema | <fill in> | <fill in> | <fill in> | pass / fail / blocked |
| Deterministic or runtime validation | <fill in> | <fill in> | <fill in> | pass / fail / blocked |
| Human visual or product acceptance | <fill in> | <fill in> | <fill in> | pass / fail / blocked |
| Performance and device | <fill in> | <fill in> | <fill in> | pass / fail / blocked |
| Security, privacy, or platform | <fill in> | <fill in> | <fill in> | pass / fail / blocked |
| Explicit authority | <fill in> | <fill in> | <fill in> | pass / fail / blocked |

## Transaction

- Exclusive-write target: <fill in>
- Lock mechanism: <fill in>
- Compare-and-swap check: <fill in>
- Immutable destination: <fill in>
- Registry or manifest update: <fill in>
- Default selection rule: <fill in>
- Save or schema migration: <fill in>
- Failure restoration sequence: <fill in>

## Post-Commit Validation

- Hash and byte identity check: <fill in>
- Registry uniqueness and exclusion check: <fill in>
- Clean runtime loader check: <fill in>
- Canonical player journey: <fill in>
- Persistence and migration check: <fill in>
- Packaging or native staging check: <fill in>
- Monitoring interval and stop thresholds: <fill in>

## Rollback

- Rollback owner: <fill in>
- Trigger thresholds: <fill in>
- Immutable predecessor: <fill in>
- Registry or release restoration: <fill in>
- Save and data compatibility: <fill in>
- User communication: <fill in>
- Rollback validation journey: <fill in>

## Acceptance Checks

- [ ] Promotion identity is immutable and matches every prerequisite receipt.
- [ ] Candidate Validation, Visual Approval, Runtime Promotion, and Release Status are not conflated.
- [ ] Shared target has one exclusive owner and a lock.
- [ ] Expected base hash is verified before write.
- [ ] Destination is versioned and predecessor remains intact.
- [ ] Post-write tests inspect the committed target.
- [ ] One default or active artifact rule passes where applicable.
- [ ] Save, schema, and content compatibility are understood.
- [ ] Rollback trigger, owner, predecessor, and proof journey are complete.
- [ ] Publication or merge occurs only with explicit authority.

## Final Decision

- Decision: promote | reject | hold | roll back
- Approver: <fill in>
- Time: <fill in>
- Exact promoted hash: <fill in>
- Post-commit receipt: <fill in>
- Remaining debt: <fill in>
```

**Observed example.** Pocket Aquarium’s asset registry binds runtime files to exact hashes, preserves one default per species, and excludes superseded candidates. Its strongest atomic locked promotion service is species-specific, so generic transactional promotion remains a recommended next capability.

## 12. Milestone Template

Use this record to turn a broad ambition into one bounded, playable outcome with explicit surface, lanes, gates, release state, and closeout.

### Field definitions

| Field | Meaning |
|---|---|
| Outcome | Player-visible capability, not an activity list |
| Terminal condition | Evidence that no required work remains |
| Surface Ready | Earliest honest usable entrypoint while hardening continues |
| Deliverables | Named artifacts and behaviors required for the outcome |
| Lane ownership | Exclusive files, contracts, runtime, and integration owner |
| Gates | Minimum handoff, automated hardening, human acceptance, and release |
| Roadmap relation | Predecessor assumptions and successor unlocked |
| Closeout | Merge, rebase, retest, docs, ownership release, and decision record |

### Copyable template

```markdown
# Milestone: <fill in>

## Record

- Milestone ID: <fill in>
- Owner: <fill in>
- Review authority: <fill in>
- Merge or release authority: <fill in>
- Base revision: <fill in>
- Target release state: built | ci_verified | device_verified | signed_internal | store_candidate | published
- Status: planning | executing | surface ready | hardening | ready | blocked | completed | superseded

## Outcome Contract

- Player-visible outcome: <fill in>
- Why it matters now: <fill in>
- Terminal condition: <fill in>
- Success evidence: <fill in>
- Scope locks: <fill in>
- Non-goals: <fill in>
- Existing behavior that MUST remain unchanged: <fill in>

## Roadmap Position

- Predecessor milestone and exit receipt: <fill in>
- Assumptions inherited: <fill in>
- Architecture or content contracts already frozen: <fill in>
- Successor capability unlocked: <fill in>

## Required Deliverables

| Deliverable ID | Artifact or behavior | Owner | Dependency | Acceptance proof | Merge unit |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

## Shortest Complete Audience Flow

- Consumer: <fill in>
- Action: <fill in>
- Observable result: <fill in>
- Canonical entrypoint: <fill in>
- Mode, fixture, and seed: <fill in>
- Minimum honest and safe handoff gate: <fill in>
- Known limitations at handoff: <fill in>
- Validation isolation: shared non-disruptive | isolated | not applicable
- Post-readiness automated work: <fill in>

## Surface Receipt

- Surface state: before surface ready | surface ready | final complete
- Exact revision or artifact digest: <fill in>
- Branch, port, URL, PID, or artifact path: <fill in>
- Viewport, device, and input: <fill in>
- Persistence and safety policy: <fill in>
- Smoke checks passed: <fill in>
- Remaining gates: <fill in>

## Lane and Ownership Plan

| Lane | Role | Exclusive artifacts and contracts | Runtime and tool class | RAM class | Dispatch ID | Result receipt |
|---|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | light / browser / Blender / native | <fill in> | <fill in> | <fill in> |

- Integration owner: <fill in>
- Shared files serialized: <fill in>
- Canonical live-surface owner: <fill in>
- Conflict-disposition owner: <fill in>
- Reviewer independence: <fill in>
- Fallback policy: <fill in>

## RAM and Surface Budget

- Physical memory budget: <fill in>
- Green, amber, and red thresholds: <fill in>
- Maximum concurrent heavy jobs: <fill in>
- Canonical server and single-tab policy: <fill in>
- Isolated browser or native validation environment: <fill in>
- Child-process shutdown verification: <fill in>

## Validation Matrix

| Gate | Exact revision | Command or journey | Required result | Receipt | Blocking class |
|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | block now / hardening / nonblocking |

## Observed-Error Loop

| Attempt | Observed error | Owning contract | Smallest change | Affected restart | Identical retry | Durable guard |
|---|---|---|---|---|---|---|
| <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | advanced / same error / new error / passed | <fill in> |

## PR or Delivery Stack

| Unit | Authority seam | Depends on | Canonical surface after unit | Review gate |
|---|---|---|---|---|
| <fill in> | contract / model / spatial / renderer / player / creator / content / packaging | <fill in> | <fill in> | <fill in> |

## Risk and Decisions

| Risk or open decision | Consequence | Closure mode | Probe | Stop condition | Owner |
|---|---|---|---|---|---|
| <fill in> | <fill in> | reasoning / discriminating probe | <fill in> | <fill in> | <fill in> |

## Acceptance Checks

- [ ] Outcome and terminal condition are player-visible and bounded.
- [ ] Canonical entrypoint, fixture, persistence, and safety policy are explicit.
- [ ] Surface Ready has only minimum honest handoff blockers.
- [ ] Automated hardening continues without waiting for optional feedback.
- [ ] Every deliverable has one owner, proof, and merge unit.
- [ ] Shared authorities and registries have serialized ownership.
- [ ] Dispatch and result claims have real receipts.
- [ ] RAM and live-surface budgets protect the workstation and reviewer experience.
- [ ] Exact-revision automated, human, browser, packaging, and device gates are complete where applicable.
- [ ] Overlapping capabilities have keep, adapt, or supersede dispositions.
- [ ] Release state is not overstated.
- [ ] Documentation, rollback, and ownership closeout are included.

## Closeout

- Final revision and artifact digest: <fill in>
- Final canonical journey receipt: <fill in>
- Review verdict: <fill in>
- Merge or release receipt: <fill in>
- Main or production revalidation: <fill in>
- Documentation and decision records updated: <fill in>
- Ownership claims closed or transferred: <fill in>
- Remaining nonblocking debt: <fill in>
- Successor milestone: <fill in>
```

**Brief transfer example.** A freshwater vertical-slice milestone might require one planted environment, one schooling entity, one feeding interaction, and one touch journey. A wizard vertical slice might require one traversable region, one creature, one spell interaction, persistence, and the same desktop-plus-touch proof structure.

## 13. Template composition recipes

### 13.1 One representative entity vertical slice

Complete the records in this order:

1. Game Vision.
2. Environment and Biome.
3. Entity Profile.
4. Morphology and Behavior and Typicality in parallel after identity freezes.
5. Simulation Contract and Interaction and Compatibility after the profile boundaries are stable.
6. Asset Acceptance after candidate generation.
7. Test Matrix across headless, workbench, player, and device gates.
8. Promotion Gate.
9. Milestone closeout.

The first successful entity SHOULD prove the full evidence-to-player lifecycle before catalog fan-out.

### 13.2 Parallel content expansion

Before parallel production:

- freeze body-plan, profile, validation, workbench, and registry contracts;
- assign one exclusive owner per entity’s evidence, source, backend, and candidate tree;
- prohibit content lanes from editing shared body-plan or validator libraries;
- cap heavy jobs by measured memory;
- require one Asset Acceptance record per immutable digest;
- serialize Runtime Promotion because the default registry is an exclusive-write surface.

### 13.3 New interaction or mechanic

Complete Entity Profile, Behavior and Typicality, Interaction and Compatibility, and Simulation Contract deltas. Add deterministic scenarios before animation polish. The animation MUST consume realized kinematics and committed events. The Test Matrix MUST include rejection, interruption, duplicate contact, save/restore, and the real player journey.

### 13.4 Platform release

Complete the Game Vision platform fields, Test Matrix device journeys, Promotion Gate, and Milestone release section. Advance one immutable build through built, CI verified, device verified, signed internal, store candidate, and published states. No state may be inferred from the previous one.

## 14. Documentation maintenance protocol

Each completed template is a decision record, not disposable planning prose.

- Store records near their owning schema or in a stable documentation tree.
- Give records stable IDs and explicit supersession links.
- Update source revision and evidence digest after every material change.
- Revalidate every receipt invalidated by a geometry, behavior, schema, content, environment, toolchain, platform, or build change.
- Preserve rejected candidates, failed gates, and earlier review findings.
- Close active ownership records when work merges or transfers.
- Generate catalog and release status from manifests when possible.
- Label historical architecture at the first relevant paragraph.
- Record bounded open decisions with the exact probe that can close them.
- Cross-link long contracts rather than duplicating competing definitions.

## 15. Suite-level completion check

Before treating a set of specifications as implementation-ready:

- [ ] The Game Vision freezes player outcome, authority, canonical journey, and non-goals.
- [ ] Every content identity has an Entity Profile with separate evidence and calibration.
- [ ] Every visible or physical entity has Morphology and Behavior and Typicality contracts.
- [ ] Every place has an Environment and Biome contract.
- [ ] Every consequential relationship has an Interaction and Compatibility contract.
- [ ] Every asset candidate has independent Candidate Validation, Visual Approval, and Runtime Promotion states.
- [ ] Every consequential system has one Simulation Contract.
- [ ] The Test Matrix covers deterministic, runtime, human, player, packaging, and device questions without conflating them.
- [ ] Every activation uses an immutable Promotion Gate and rollback predecessor.
- [ ] Every milestone exposes the shortest honest surface early, continues hardening, and closes ownership and documentation.
- [ ] Pocket Aquarium, freshwater, wizard, or any other theme changes content and behavior policies without weakening the shared authority and acceptance method.
