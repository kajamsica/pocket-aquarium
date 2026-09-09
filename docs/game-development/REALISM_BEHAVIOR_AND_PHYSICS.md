# Realism, Behavior, and Physics

## Purpose

This chapter defines a reusable method for building believable living systems, creatures, and characters from the ground up. It applies to an aquarium, a freshwater ecosystem, an open-world wizard game, or any other game in which players will notice what an inhabitant does, where it goes, how it moves, what it affects, and whether those facts remain coherent over time.

The central rule is simple:

> **Recommended:** every consequence MUST come from one deterministic world model, every behavior MUST be constrained by an evidence-backed typicality profile, and every animation MUST report realized motion rather than inventing a second motion history.

Visual fidelity matters, but it cannot rescue an incoherent causal model. A beautiful animal that teleports, swims sideways, ignores its habitat, or changes the ecosystem only when a renderer happens to observe contact will not feel alive. A reduced-order model with consistent causes, characteristic timing, and legible consequences often feels more realistic than a more expensive simulation with unclear authority.

This document uses two truth labels:

- **Observed** means the statement is supported by the accepted Pocket Aquarium repository, tests, history, or evidence packets.
- **Recommended** means the statement is a target-state rule selected from those lessons. It does not claim the current repository already implements the rule.

For the suite map and reading order, see the [Game Development Playbook index](./README.md). For the shared vocabulary, top-level content schema, and layer boundaries, see [Foundation and Architecture](./FOUNDATION_AND_ARCHITECTURE.md). For mesh, rig, clip, and runtime-adapter production, see [Asset and Animation Pipeline](./ASSET_AND_ANIMATION_PIPELINE.md). For browser, device, diagnostic, and release proof, see [Product Tooling and Validation](./PRODUCT_TOOLING_AND_VALIDATION.md). Copy-ready interfaces and gate forms are collected in [Reusable Specification Templates](./REUSABLE_SPEC_TEMPLATES.md).

## 1. Define Realism as a Set of Observable Contracts

### 1.1 Research the portrayal, not just the noun

**Recommended:** research MUST answer six distinct questions before an entity receives runtime behavior:

1. What is it, and what variation exists within the represented stage, sex, role, or archetype?
2. What shape, scale, posture, and physical envelope identify it?
3. Where does it usually spend time, and what conditions change that distribution?
4. How does it normally move, turn, pause, accelerate, rest, and interact?
5. Which stimuli produce characteristic responses, and on what time scale?
6. Which actions have persistent consequences for itself, other entities, and the environment?

A source that answers anatomy may not answer social behavior. A husbandry summary may describe environmental requirements without describing locomotion. A video can reveal cadence and response timing while providing weak scale evidence. The evidence record SHOULD therefore keep claims separate and attach confidence to each claim rather than assigning one confidence score to the whole subject.

```ts
interface EvidenceClaim<T> {
  key: string
  value: T
  unit?: string
  populationOrStage: string
  sourceIds: string[]
  confidence: 'high' | 'medium' | 'low' | 'inferred'
  conflicts: string[]
}

interface EvidenceProfile {
  subjectId: string
  revision: string
  claims: EvidenceClaim<unknown>[]
  assumptions: string[]
  evidenceDigest: string
}
```

**Recommended:** high-confidence claims SHOULD define hard identity or safety constraints. Medium-confidence claims SHOULD define broad typical ranges. Low-confidence and inferred claims MAY seed candidate tuning, but they MUST remain identifiable and MUST NOT silently become literal claims about the real subject.

### 1.2 Separate evidence from calibration

Games compress time, simplify perception, and exaggerate feedback. That is compatible with grounded realism when the transformation is explicit.

- The **Evidence Profile** records source claims, units, context, confidence, and contradictions.
- The **Calibration Profile** records game-time scaling, rates, thresholds, probabilities, difficulty modifiers, and the design rationale for departures from literal timing.
- The **Typicality Contract** records the ranges and distributions that the portrayal must preserve after calibration.

**Recommended:** tuning MUST NOT overwrite source facts. A growth event that takes minutes in the game but months in reality is a calibration choice. A fish that occupies the bottom 90 percent of the time is a typicality target. Those are different records and require different review.

### 1.3 Model distributions, not a single canonical performance

Natural and character behavior is variable. A single loop eventually reads as machinery. Unbounded randomness reads as noise. The useful middle is a set of constrained distributions.

```ts
interface DistributionBand {
  minimum: number
  typicalLow: number
  typicalHigh: number
  maximum: number
  unit: string
}

interface TypicalityContract {
  occupancyByRegion: Record<string, DistributionBand>
  behaviorShare: Record<string, DistributionBand>
  speedByMode: Record<string, DistributionBand>
  dwellByMode: Record<string, DistributionBand>
  responseLatency: Record<string, DistributionBand>
  socialDistance: Record<string, DistributionBand>
  invariants: string[]
  knownVariation: string[]
}
```

The `minimum` and `maximum` values describe admissible bounds. The typical band describes where most observations should fall across a declared scenario and time horizon. It is not a per-tick clamp.

**Recommended:** a policy SHOULD vary the following independently, within correlated ranges where evidence supports correlation:

- cruise speed and burst speed;
- movement duration and rest duration;
- turning urgency and preferred turn radius;
- response latency;
- habitat occupancy and excursion frequency;
- social approach and separation tolerance;
- activity phase and energy budget;
- target persistence and exploration interval.

Rare behavior SHOULD be represented by an eligible-state hazard or scheduled opportunity, followed by minimum dwell and cooldown. It SHOULD NOT be implemented as an unconstrained random check every render frame. A per-frame probability changes with frame rate and produces implausible repeated transitions.

```text
if eligible and cooldown expired:
    opportunity = seededHazard(ratePerGameSecond, elapsedGameSeconds)
    if opportunity:
        enter rare mode for a sampled bounded duration
```

Tests SHOULD evaluate the distribution across many fixed seeds and long enough simulated windows. They MUST also verify the hard invariants on every tick.

## 2. One Authoritative World from the First Line of Code

### 2.1 Ownership rule

**Recommended:** the World Model MUST own every fact capable of changing a later legal action, outcome, progression value, save, or replay. This includes spatial facts when contact or location matters.

The renderer MAY own camera state, hover state, interpolation buffers, decorative particles, and other facts that cannot change gameplay. It MUST NOT own hunger, health, targets, contact truth, relationships, locomotion continuation, inventory, collision outcomes, or progression.

This boundary prevents three common failures:

1. The same action has different outcomes at different frame rates.
2. Reloading or changing views reconstructs a different motion history.
3. A visual effect accidentally becomes an ecological or combat cause.

### 2.2 Ground-up interfaces

The following interfaces are a minimal reusable backbone. Exact field names MAY change, but the ownership separation MUST remain.

```ts
type Tick = number
type EntityId = string
type ProfileId = string

interface Vec3 { x: number; y: number; z: number }
interface Pose { position: Vec3; forward: Vec3; up: Vec3 }

interface WorldState {
  schemaVersion: string
  contentRevision: string
  environmentRevision: string
  collisionRevision: string
  tick: Tick
  accumulatorSeconds: number
  rng: StatefulRngState
  environment: EnvironmentState
  economy: EconomyState
  entities: Record<EntityId, EntityState>
  resources: Record<EntityId, ResourceState>
  pendingIntents: PlayerIntent[]
  recentEvents: DomainEvent[]
}

interface EntityState {
  id: EntityId
  profileId: ProfileId
  lifecycleStage: string
  pose: Pose
  velocity: Vec3
  angularVelocity: Vec3
  energy: number
  needs: Record<string, number>
  welfare: Record<string, number>
  conditions: string[]
  behavior: BehaviorState
  relationships: RelationshipState[]
  attachment?: SurfaceAttachment
  rngStreamId: string
}

interface EntityProfile {
  id: ProfileId
  evidenceRevision: string
  calibrationRevision: string
  typicality: TypicalityContract
  environment: EnvironmentEnvelope
  locomotion: LocomotionProfile
  physicalEnvelope: PhysicalEnvelope
  behaviorPolicyId: string
  interactionRoles: string[]
  lifecycleProfileId: string
  presentationAssetId: string
}
```

Content profiles MUST be immutable for a named revision. Live state MUST reference them by stable ID. A save MUST include or pin the revisions needed to interpret the state.

### 2.3 Typed intents in, typed events out

Input surfaces SHOULD submit typed intents. The simulation validates them once against the current authoritative state.

```ts
type PlayerIntent =
  | { type: 'place_entity'; entityId: EntityId; pose: Pose }
  | { type: 'add_resource'; resourceProfileId: string; location: Vec3 }
  | { type: 'use_equipment'; equipmentId: EntityId; action: string }
  | { type: 'interact'; actorId: EntityId; targetId: EntityId; verb: string }
  | { type: 'set_time_scale'; scale: number }

type DomainEvent =
  | { type: 'intent_rejected'; tick: Tick; reason: string }
  | { type: 'contact_committed'; tick: Tick; contactId: string; participants: EntityId[] }
  | { type: 'resource_consumed'; tick: Tick; resourceId: EntityId; consumerId: EntityId }
  | { type: 'service_completed'; tick: Tick; providerId: EntityId; clientId: EntityId; service: string }
  | { type: 'relationship_changed'; tick: Tick; participants: EntityId[]; relationship: string }
  | { type: 'damage_applied'; tick: Tick; sourceId: EntityId; targetId: EntityId; amount: number }
```

Every committed event MUST contain a simulation tick and stable entity IDs. Consequential events SHOULD carry a deterministic event ID or contact ID so the reducer can enforce exactly-once application.

### 2.4 Inject dependencies at the boundary

```ts
interface SimulationDependencies {
  catalog: ReadonlyContentCatalog
  random: StatefulRng
  staticWorld: StaticCollisionWorld
  supportWorld: SupportGraph
  flow: FlowSampler
  eventSink: DomainEventSink
}

function reduceIntent(
  state: WorldState,
  intent: PlayerIntent,
  deps: SimulationDependencies,
): WorldState

function advanceFixed(
  state: WorldState,
  ticks: number,
  deps: SimulationDependencies,
): WorldState
```

Wall time, storage, device resume, networking, and display refresh MUST remain adapters around this boundary. Headless simulation tests SHOULD require no WebGL, browser clock, or platform storage.

## 3. Use One Causal Clock and One Ordered Tick

### 3.1 Fixed-step authority

**Recommended:** gameplay causality MUST advance in fixed simulation steps. Presentation SHOULD interpolate between the two most recent immutable snapshots.

```ts
const fixedDtSeconds = configuredSimulationStepSeconds
const maxAcceptedWallDeltaSeconds = configuredMaximumWallDeltaSeconds
const maxCatchUpSteps = configuredMaximumCatchUpSteps
let accumulatorSeconds = 0

function updateFromWallTime(elapsedSeconds: number): void {
  const nonnegativeDeltaSeconds = Math.max(0, elapsedSeconds)
  const admittedDeltaSeconds = Math.min(
    nonnegativeDeltaSeconds,
    maxAcceptedWallDeltaSeconds,
  )
  const droppedDeltaSeconds = nonnegativeDeltaSeconds - admittedDeltaSeconds
  accumulatorSeconds += admittedDeltaSeconds

  let catchUpSteps = 0
  while (
    accumulatorSeconds >= fixedDtSeconds &&
    catchUpSteps < maxCatchUpSteps
  ) {
    worldPrevious = world
    world = advanceOneTick(world, fixedDtSeconds)
    accumulatorSeconds -= fixedDtSeconds
    catchUpSteps += 1
  }

  const interpolationRemainderSeconds = accumulatorSeconds % fixedDtSeconds
  const deferredBacklogSeconds =
    accumulatorSeconds - interpolationRemainderSeconds

  reportClockBacklog({
    droppedDeltaSeconds,
    deferredBacklogSeconds,
    catchUpSteps,
  })

  publishInterpolation(
    worldPrevious,
    world,
    interpolationRemainderSeconds / fixedDtSeconds,
  )
}
```

This example chooses two explicit policies. It clamps each wall-time contribution and reports the dropped excess, then caps catch-up work per presentation update while retaining and reporting complete deferred steps in the authoritative accumulator. Every simulated step subtracts its time exactly once, so a later update cannot replay time already consumed. A project MAY instead accumulate all elapsed time or route long absences through an offline model, but it MUST record the choice and MUST NOT silently discard elapsed causal time and then claim replay equivalence.

Tick frequency is a measurement-dependent choice. **Recommended:** test candidate rates such as 10, 15, and 20 Hz on the lowest supported device, using contact misses, correction ratio, CPU time, and frame time. Select the cheapest rate that satisfies the declared behavior and contact thresholds.

### 3.2 Ordered phases

Every tick SHOULD use a fixed, documented phase order:

```text
1. collect and deterministically order queued player intents
2. validate intents against the current state and content revision
3. advance equipment, automation, and environmental fluxes
4. advance ecology, lifecycle, resources, and slow fields
5. evaluate needs, motivations, threats, and relationships
6. transition behavior modes using priority, hysteresis, dwell, and cooldown
7. select targets and desired motion within habitat constraints
8. solve support, static collision, walls, portals, and neighbor constraints
9. integrate pose with fixed-step swept contact
10. resolve resource, service, predation, combat, and territory contacts
11. apply exactly-once consequences and welfare changes
12. emit events and an immutable presentation snapshot
```

The exact sequence is itself an interface. Changing it can change outcomes and therefore MUST create a new simulation revision and replay evidence.

### 3.3 Pause, save, and resume

**Recommended:** when no simulation tick advances, domain state, locomotion, contact progress, and surface progress MUST remain unchanged. Camera motion and noncausal UI MAY continue.

A save MUST preserve either:

- the complete pose, velocity, behavior phase, target, cooldown, pass side, attachment, RNG state, and accumulator; or
- enough pinned revision, seed, tick, and checkpoint information to reconstruct the identical next tick.

Reconstruction is valid only after an exact replay probe proves it across supported content revisions. Otherwise, persist full continuation state.

## 4. Select Physics Fidelity by Player-Visible Consequence

### 4.1 Declare the contract before choosing the solver

**Recommended:** every physical subsystem MUST declare:

- units and coordinate system;
- dimensionality;
- authoritative consumers;
- integration step;
- bounded or conserved quantities;
- numerical caps;
- known omissions;
- diagnostics and failure thresholds.

The question is not whether a solver is physically complete. The question is whether it preserves the player-visible causes and consequences within its declared scope.

A reduced-order flow field MAY be authoritative for drift, contact, or biological exposure if it is deterministic, bounded, and sampled by all consequential consumers. A richer visual flow MAY decorate particles or shaders. The richer field MUST NOT quietly alter domain outcomes.

### 4.2 Static world and revision atomicity

The visual environment and collision environment MUST describe the same saved geometry revision. Open passages MUST remain open in both. Solid surfaces MUST block in both.

```ts
interface StaticCollisionWorld {
  revision: string
  queryDistance(point: Vec3): DistanceSample
  sweep(envelope: PhysicalEnvelope, from: Pose, to: Pose): SweepResult
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): Hit | null
}

interface EnvironmentPublish {
  visualRevision: string
  collisionRevision: string
  supportRevision: string
  digest: string
}
```

**Recommended:** an environment edit MUST publish visual geometry, collision acceleration data, and support data atomically. Entities MUST NOT observe a new visual rock, wall, bridge, building, or terrain surface while still using stale collision or support data.

### 4.3 Physical envelopes

An entity's visible bounds and physical envelope are related, but they are not interchangeable.

```ts
interface PhysicalEnvelope {
  kind: 'capsule' | 'capsule_chain' | 'oriented_box' | 'support_points' | 'custom'
  dimensionsMeters: number[]
  clearanceMeters: number
  comfortDistanceMeters: number
  minimumTurnRadiusMeters: number
  maximumSpeedMetersPerSecond: number
  maximumAccelerationMetersPerSecondSquared: number
  maximumYawRadiansPerSecond: number
  maximumPitchRadians: number
  maximumRollRadians: number
  supportKinds?: string[]
  supportProbeLayout?: Vec3[]
}
```

- Compact swimmers or flying creatures MAY use an oriented capsule.
- Long fish, serpentine creatures, mounts, or vehicles SHOULD use a short capsule chain.
- Crawlers SHOULD use a body frame plus support points.
- Flexible radial bodies SHOULD use multiple limb or arm probes.
- Rooted and sessile entities SHOULD use a fixed attachment footprint plus growth-clearance volumes.

The store or placement system SHOULD compare envelope, clearance, and minimum turn radius against environment free dimensions. If the entity cannot perform its required motion, the game SHOULD warn, block, or offer an explicit risk path defined by content data. The movement controller MUST NOT hide an impossible environment by repeated positional correction.

## 5. Compose Behavior from Policies, Motivations, and State

### 5.1 Generic engine, explicit family, data-driven typicality

**Recommended:** every moving entity MUST select a named locomotion family and behavior family. Unknown classes MUST fail closed. An unclassified snail must not inherit swimming because swimming happens to be the generic fallback.

```ts
interface BehaviorPolicy {
  id: string
  locomotionFamily: string
  habitatEnvelopeId: string
  socialMode: 'solitary' | 'tolerant' | 'pairing' | 'schooling' | 'territorial' | 'mixed'
  motivations: MotivationDefinition[]
  states: BehaviorStateDefinition[]
  transitions: BehaviorTransition[]
  minimumDwellTicks: Record<string, number>
  cooldownTicks: Record<string, number>
  partnerRules: PartnerRule[]
  stationRoles: string[]
  excursionRules: ExcursionRule[]
  failClosed: true
}

interface BehaviorState {
  mode: string
  enteredTick: Tick
  minimumDwellUntilTick: Tick
  targetEntityId?: EntityId
  targetPoint?: Vec3
  escapeTarget?: Vec3
  passSide?: -1 | 1
  passSideUntilTick?: Tick
  cooldowns: Record<string, Tick>
  motivationScores: Record<string, number>
}
```

Species or archetype data SHOULD specialize family parameters, habitat use, response timing, and interaction repertoire. It SHOULD NOT inject arbitrary per-frame code when a reusable family can express the behavior.

### 5.2 Motivation scoring

Behavior selection is easier to reason about when the policy exposes why a mode won.

```text
score(mode) =
    baseline(mode, profile)
  + needPressure(mode, entity.needs)
  + stimulusResponse(mode, sensedWorld)
  + relationshipBias(mode, entity.relationships)
  + habitatOpportunity(mode, localEnvironment)
  + boundedSeededVariation(mode, entity.rngStream)
  - transitionCost(currentMode, mode)
```

**Recommended:** transitions MUST use hysteresis so small score changes do not flip modes every tick. Each mode SHOULD define minimum dwell, exit conditions, interrupt priorities, and cooldown. Safety or threat MAY interrupt feeding. Feeding MAY interrupt roaming. Collision resolution may modify realized velocity without changing the high-level mode.

### 5.3 Multiple time, speed, and energy scales

A believable agent rarely moves at one speed forever.

- **Rest or hold:** near-zero movement, posture and local animation continue.
- **Local adjustment:** small turns or repositioning within a site.
- **Cruise or patrol:** sustainable, characteristic locomotion.
- **Approach or investigate:** target-oriented locomotion with response latency.
- **Burst or evade:** bounded high acceleration and speed with an energy cost.
- **Recovery:** reduced speed or enforced rest after a burst.

**Recommended:** an entity's energy budget SHOULD limit burst duration and influence later behavior. Acceleration and deceleration SHOULD be independently calibrated where the subject demands it. Large bodies SHOULD anticipate turns earlier and accept slower yaw, while small agile bodies MAY turn sharply. Pauses SHOULD come from dwell states, not repeated target failure.

### 5.4 Forward-biased movement and turning

For forward-propelled classes, steering MUST rotate the desired forward direction before applying thrust. Ordinary obstacle and neighbor avoidance SHOULD be expressed primarily as yaw and speed changes. Vertical displacement, strafing, or backward motion MUST be explicitly permitted by the locomotion profile.

```ts
interface MotionIntent {
  behaviorMode: string
  targetPoint?: Vec3
  desiredForward: Vec3
  desiredSpeed: number
  preferredAltitudeOrLayer?: number
  urgency: number
  allowedSupports?: string[]
}

function forwardBiasedIntent(
  pose: Pose,
  target: Vec3,
  profile: LocomotionProfile,
): MotionIntent {
  const direction = normalize(target - pose.position)
  const yawOnly = projectOntoAllowedTurnPlane(direction, profile)
  return {
    behaviorMode: 'travel',
    targetPoint: target,
    desiredForward: yawOnly,
    desiredSpeed: profile.cruiseSpeed,
    urgency: 0.5,
  }
}
```

The solver MUST clamp yaw, pitch, roll, acceleration, and speed using the physical envelope. If a collision correction causes sideways displacement, presentation may report that displacement, but diagnostics SHOULD record the correction and tuning SHOULD reduce its frequency.

## 6. Separate Intent, Steering, Kinematics, and Presentation

### 6.1 Solver interface

```ts
interface SteeringContext {
  tick: Tick
  dt: number
  staticWorld: StaticCollisionWorld
  neighbors: NeighborSample[]
  support?: SupportSample
  flow: Vec3
}

interface ContactConstraint {
  id: string
  kind: 'hardscape' | 'wall' | 'support' | 'portal' | 'neighbor'
  normal: Vec3
  separation: number
  timeToImpact?: number
  hard: boolean
}

interface KinematicSolution {
  realizedPose: Pose
  realizedVelocity: Vec3
  realizedAngularVelocity: Vec3
  contacts: ContactConstraint[]
  correctionDistance: number
  support?: SurfaceAttachment
}

function solveKinematics(
  entity: EntityState,
  intent: MotionIntent,
  context: SteeringContext,
): KinematicSolution
```

The behavior layer chooses intent. The spatial solver produces safe realized motion. The presentation adapter consumes realized motion. These stages SHOULD be testable independently and MUST have one directional ownership flow.

### 6.2 Motion continuity invariants

For each fixed tick of duration `dt`, the solver MUST satisfy:

```text
|velocityNext| <= maximumSpeed
|velocityNext - velocityPrevious| <= maximumAcceleration * dt
|yawNext - yawPrevious| <= maximumYawRate * dt
distance(positionNext, positionPrevious)
  <= maximumSpeed * dt + numericalTolerance
pitch and roll remain inside class limits
all numeric state is finite
```

These caps stop a delayed display frame from becoming a teleport. A stall creates multiple bounded authoritative ticks or invokes the declared catch-up policy. It does not authorize one large spatial step.

### 6.3 Predictive hard contact

Hardscape and walls SHOULD use swept contact from the current pose to the candidate pose. A post-step projection MAY remain as a bounded numerical guard, but MUST NOT be the primary movement method.

```text
candidate = integrate(current, limitedVelocity, dt)
hit = staticWorld.sweep(envelope, current.pose, candidate.pose)

if no hit:
    accept candidate
else:
    advance to just before impact
    remove inward velocity component
    choose a turn-compatible tangent response
    integrate remaining time through another bounded sweep

if residual penetration <= numerical tolerance:
    bounded projection may repair it and must be recorded
else:
    emit solver fault and retain last safe pose
```

### 6.4 Soft social avoidance

Animals and characters often tolerate proximity and negotiate motion. Their comfort distance is not a rigid invisible wall.

**Recommended:** neighbor handling SHOULD combine predicted time to closest approach, anisotropic body envelopes, relative velocity, social mode, and current behavior. It SHOULD alter preferred velocity or target selection before contact. It MUST NOT apply large direct positional repulsion every frame.

Rigid repulsion fails because:

- overlapping comfort radii can create contradictory impulses;
- symmetric agents can oscillate or rotate as a group;
- oversized radii prevent legitimate passing;
- direct translation breaks forward-biased locomotion;
- correction magnitude changes with update order and frame rate.

Hard nonpenetration remains a final safety constraint. Soft comfort avoidance should do most of the visible work.

### 6.5 Stable reciprocal passing

Head-on agents need a stable side choice for the duration of an encounter.

```ts
function passSideForPair(a: EntityId, b: EntityId, encounter: number): -1 | 1 {
  const ordered = a < b ? `${a}:${b}` : `${b}:${a}`
  const base = stableHash(`${ordered}:${encounter}`) % 2 === 0 ? -1 : 1
  return a < b ? base : -base
}
```

Both agents MUST retain reciprocal choices through a time-to-live or until separation and heading clearly show the encounter has ended. A pass choice MUST NOT be resampled each tick. For forward-moving ground or swimming classes, the lateral preference SHOULD become a yaw target, not a sideways position jump. Vertical passing MAY occur only when the locomotion and habitat profiles make it typical.

### 6.6 Density-aware crowd response

Crowding SHOULD influence intent before it becomes a collision emergency.

```text
localDensity = weightedNeighborOccupancy(entity, neighborhood)

if localDensity > profile.crowdHigh:
    increase probability of choosing a low-density destination
    reduce social attraction
    preserve stable pass commitments
else if localDensity < profile.crowdLow and socialMode permits:
    modestly increase affiliation or rejoin motivation
```

The response SHOULD change target selection and motivation. It SHOULD NOT become a constant outward force. Schooling or pairing can remain valid at close range because the relationship policy modifies preferred distance, alignment, and group target without welding entities together.

## 7. Concrete Stability Techniques

### 7.1 Anti-jitter

Jitter is usually a disagreement among controllers, not insufficient smoothing.

**Recommended procedure:**

1. Freeze update order and read neighbors from the same prior-tick snapshot.
2. Keep behavior mode and target for a minimum dwell interval.
3. Add hysteresis to obstacle, habitat, and social thresholds.
4. Clamp acceleration and yaw rate.
5. Smooth only the desired signal or presentation, never hide repeated hard corrections.
6. Measure correction distance, target changes, heading reversals, and vertical zero crossings.

Invariant:

```text
neighbor inputs for tick N come only from the immutable snapshot at tick N
no entity reads a neighbor already advanced to tick N + 1
```

### 7.2 Anti-teleport

**Recommended:** authoritative travel MUST be fixed-step and capped by maximum speed. Targets MAY change discontinuously; positions MUST NOT.

```text
distance(realizedPositionNext, realizedPositionCurrent)
  <= maximumSpeed * fixedDt + tolerance
```

Reload MUST restore the next deterministic continuation. A renderer remount MUST NOT reinitialize world position, route phase, or target.

### 7.3 Anti-bounce and anti-wall oscillation

Bounce occurs when an entity penetrates a boundary, is projected away, keeps an inward goal, and repeats the cycle.

**Recommended:**

- predict wall approach using envelope extent and stopping or turning distance;
- bias a tangent turn before contact;
- hold the avoidance side with hysteresis;
- remove inward velocity at contact;
- temporarily inhibit targets whose direct route remains outside the admissible region;
- record projection as an exceptional correction.

```text
turnLeadDistance = speed * turnResponseTime + envelopeForwardExtent

if wallClearance < turnLeadDistance and velocity points inward:
    latch wallAvoidanceSide
    blend desiredForward toward an interior tangent

on contact:
    velocity -= min(0, dot(velocity, outwardNormal)) * outwardNormal
```

A hard reflection SHOULD NOT be the default response for an animal. It reads as a ball bouncing from glass and can invert the goal on every tick.

### 7.4 Anti-corner-loop

Multiple agents can enter a corner with similar escape signals, then rotate one another through social avoidance. A dedicated escape phase breaks the symmetry.

```text
enter corner_escape when:
    clearance to two boundary planes is low
    and outward progress stays below threshold for minimum stuck ticks

on enter:
    choose seeded interior escape target unique to entity and encounter
    latch a turn side
    suppress affiliation and ordinary crowd attraction
    reduce neighbor avoidance to imminent nonpenetration plus pass commitments

exit when:
    both boundary clearances exceed release thresholds
    and progress toward interior persists for release dwell ticks
```

The escape target SHOULD include per-entity variation and SHOULD lie far enough inside the admissible volume to prevent immediate reentry. Social weights SHOULD blend back over several ticks after exit.

Invariant:

```text
every entity that enters corner_escape either clears the corner within the declared time bound
or emits a stuck diagnostic with its retained last-safe pose
```

### 7.5 Collision passing without clipping or deadlock

Use anisotropic envelopes for actual nonpenetration, smaller comfort fields for anticipation, stable reciprocal pass sides, and time-to-collision weighting. Avoid increasing a single spherical boundary until clipping disappears. That strategy usually prevents passage altogether.

The solver SHOULD prefer the smallest heading and speed change that keeps predicted swept envelopes clear. If no feasible passing velocity exists, one agent MAY yield by slowing or pausing according to stable priority. It SHOULD NOT translate sideways or jump vertically unless its locomotion class permits those actions.

### 7.6 Habitat-zone stability

Habitats are distributions plus safety constraints, not one bounding box.

```ts
interface EnvironmentEnvelope {
  admissibleRegions: string[]
  forbiddenRegions: string[]
  occupancyTargets: Record<string, DistributionBand>
  structureAffinity: DistributionBand
  verticalOrElevationBands: Record<string, DistributionBand>
  supportKinds: string[]
  shelterRequirements: string[]
  excursionRules: ExcursionRule[]
}
```

**Recommended:** target selection SHOULD sample under-visited eligible regions so the long-run occupancy converges toward typical bands. The solver MUST still honor hard safety and support constraints. A feeding, fleeing, or social override MUST declare whether it can leave the ordinary habitat and for how long.

An agent at the bottom or at a structure boundary MUST retain feasible navigation corridors. Clamping one coordinate without changing target generation can create a permanent stuck state.

## 8. Locomotion Families

Every family below is universal. Aquarium examples appear later.

### 8.1 Forward-moving open-space agent

Use for agents that normally propel themselves along their forward axis through water, air, or open terrain.

- MUST use bounded yaw, pitch, roll, acceleration, and speed.
- SHOULD explore several eligible regions over time.
- SHOULD vary cruise, surge, and rest phases.
- MUST preserve a high forward-motion ratio outside low-speed turns.
- MUST use stable passing rather than direct lateral displacement.

### 8.2 Structure-associated agent

Use for agents whose range is open but whose occupancy is biased toward shelter, terrain, rocks, buildings, vegetation, or landmarks.

- SHOULD maintain a structure-distance distribution.
- SHOULD include refuge visits and bounded excursions.
- MUST preserve clearance even when structure affinity is high.
- MAY use a different response latency near its refuge.

### 8.3 Benthic or ground transfer-and-dwell agent

Use for subjects that remain near a floor, substrate, trail, or local site, then make short transfers.

- MUST distinguish dwell from transfer.
- SHOULD choose several reachable sites rather than clamp height under open-water navigation.
- MAY permit rare perch or swim excursions as explicit modes.
- MUST include an unstick transition based on lack of progress, not elapsed animation alone.

### 8.4 Surface crawler

Use for agents attached to terrain, walls, sand, rock, vegetation, or other supports.

- MUST route over a connected support graph.
- MUST retain a valid support point and normal.
- MUST NOT receive open-space velocity unless an explicit behavior permits detachment.
- SHOULD traverse permitted seams without popping or floating.

### 8.5 Flexible surface conformer

Use for broad, articulated, radial, or soft bodies spanning uneven surfaces.

- MUST sample multiple support probes.
- SHOULD solve a stable body frame from the support samples.
- SHOULD apply secondary limb deformation in the runtime adapter.
- MUST keep attachment and collision consequences in the world solver, not in bones alone.

### 8.6 Pair, group, or school agent

Use when relationships affect target choice and preferred proximity.

- MUST keep individuals collision-safe and independently navigable.
- SHOULD use soft distance and alignment distributions.
- MAY share a destination when the active mode calls for group travel.
- MUST allow separation and rejoin behavior.
- MUST NOT bind partners to identical transforms.

### 8.7 Station service agent

Use for cleaning, healing, trading, grooming, transport, crafting, dialogue, or other provider-client encounters.

- MUST define eligibility, station availability, approach, contact, service, depart, and cooldown.
- MUST emit the service effect exactly once.
- SHOULD keep the service visibly legible for a minimum dwell.
- MUST abort safely if either participant becomes ineligible.

### 8.8 Large turning-body agent

Use for long or slow-turning bodies.

- MUST use a multi-part physical envelope.
- MUST plan turns before the head or leading extent reaches a wall.
- SHOULD choose routes with curvature above the minimum turn radius.
- MUST pass an environment-admissibility check.
- SHOULD reduce speed before a sharp turn rather than rotate in place.

### 8.9 Rooted or sessile entity

Use for organisms, plants, structures, traps, or props that do not navigate.

- MUST preserve a committed attachment pose.
- MAY use local growth, sway, extension, damage, or activity animation.
- MUST derive gameplay consequences from environment and lifecycle state.
- MUST NOT receive the generic moving-agent controller.

### 8.10 Character navigation agent

Use for a humanoid or creature whose locomotion vocabulary can include forward movement, strafing, climbing, swimming, flying, mounts, or spells.

- Each allowed movement mode MUST be declared.
- Terrain, portal, and support rules MUST remain authoritative.
- Action state machines SHOULD separate preparation, execution, consequence, recovery, and cooldown.
- Animation MUST consume realized movement and committed action events.

## 9. Surface Attachment and Conformance

### 9.1 Connected support graph

```ts
interface SupportNode {
  id: string
  kind: 'terrain' | 'sand' | 'rock' | 'wall' | 'vegetation' | 'structure'
  position: Vec3
  normal: Vec3
  revision: string
}

interface SupportEdge {
  from: string
  to: string
  traversalCost: number
  maximumBodyWidth: number
  permittedFamilies: string[]
}

interface SurfaceAttachment {
  supportId: string
  supportRevision: string
  localPoint: Vec3
  normal: Vec3
  tangent: Vec3
}
```

The route planner selects nodes and edges. The solver advances along the local tangent plane. The presentation adapter aligns the body frame to the realized tangent and support normal.

### 9.2 Multi-probe conformance

For each body or limb probe:

```text
1. transform the authored probe into candidate world space
2. raycast or query distance along the local support direction
3. reject support outside the declared reach
4. filter contact height and normal with bounded lag
5. solve a body frame from the central probes
6. pass residual probe offsets to local rig deformation
```

The filter SHOULD remove mesh sampling noise without allowing visible float. Support changes MUST use hysteresis so a limb does not alternate between two adjacent triangles each tick.

At a seam, such as terrain to rock or floor to wall, the solver SHOULD maintain enough simultaneous probes to bridge the transition. If no admissible support exists, it MUST hold the last safe attachment, choose another route, or enter a declared detach mode. It MUST NOT place the body in open space merely to keep a looping animation moving.

## 10. Interactions and Ecology

### 10.1 Interaction state-machine template

```ts
interface InteractionPolicy {
  type: string
  providerRoles: string[]
  clientEligibility: Rule[]
  phases: Array<'seek' | 'approach' | 'contact' | 'service' | 'depart' | 'cooldown'>
  minimumDwellTicks: Record<string, number>
  contactEnvelope: PhysicalEnvelope
  consequence: string
  abortConditions: Rule[]
}
```

**Recommended:** feeding, cleaning, pairing, predation, combat, territorial defense, treatment, dialogue, and crafting SHOULD use explicit phases when spatial or temporal legibility matters. The world model owns phase, target, and consequence. Presentation owns anticipation, particles, sound, and local action clips.

### 10.2 Feeding and resource contact

Resource targeting SHOULD combine eligibility, need, distance or reachability, competition, and fairness. Deterministic arbitration MUST ensure that one resource is not consumed twice.

```text
eligible = residents satisfying diet, state, habitat reachability, and need
rank = stable sort by urgency, prior allocation count, estimated arrival tick, entity ID
reserve resource for first feasible resident for a short commitment window
resolve swept mouth or interaction-envelope contact
emit one resource_contact event
domain reducer validates reservation and consumes exactly once
```

An agent SHOULD visibly react after sensing food or another valuable resource, with evidence-backed latency, acceleration, and attention. The reaction MUST preserve habitat constraints unless the profile explicitly allows an excursion. Uneaten resources MAY become environmental load, decay, theft opportunity, or another game-specific consequence.

### 10.3 Social behavior and schooling

Sociality SHOULD combine three separable tendencies:

- affiliation or cohesion;
- alignment or shared travel;
- comfort spacing and collision avoidance.

Schooling is not rigid formation. Individuals SHOULD retain independent acceleration, reaction latency, and obstacle paths. A school MAY share a broad destination while local passing and hard constraints remain individual.

Pair bonds SHOULD be relationship state with soft proximity, shared-site preferences, separation tolerance, and rejoin behavior. Pairing MUST NOT override collision or weld positions.

### 10.4 Cleaning, healing, and service stations

Service stations are broadly reusable. A provider establishes or occupies a site. Eligible clients decide whether to visit. Contact begins a bounded service interval. One committed event applies the effect. Both parties then depart or cool down.

The system MUST distinguish:

- the station exists;
- a client is eligible;
- a client is assigned;
- approach is in progress;
- physical contact has occurred;
- the service event has been committed;
- the session has ended.

This distinction prevents a visual approach from producing repeated healing, cleaning, trading, or quest rewards.

### 10.5 Predation and combat

Predation and combat SHOULD be consequences of compatible policies, spatial opportunity, perception, motivation, and success rules. They SHOULD NOT be ambient random damage detached from visible action.

A complete sequence MAY include detect, assess, stalk, pursue, strike, resolve, consume or disengage, and recover. Hard content compatibility rules may warn or block an arrangement before it is created. If risk is accepted, the same model MUST make the predicted consequences possible.

### 10.6 Territorial behavior

Territory SHOULD be a stateful claim over a region or resource, not a permanent radial repulsion field.

- Entry MAY raise vigilance.
- Repeated or close intrusion MAY trigger display, chase, or attack.
- The resident SHOULD stop pursuit beyond a bounded chase region or after an energy threshold.
- The intruder SHOULD remember recent risk for a cooldown.
- Overcrowding MAY increase encounter probability without forcing continuous combat.

This produces legible escalation and recovery instead of constant jitter at an invisible radius.

### 10.7 Ecology as feedback, not decoration

**Recommended:** ecological systems SHOULD be expressed as named fluxes among resources and state variables.

```ts
interface Flux {
  id: string
  source: string
  destination: string
  quantity: number
  unit: string
  causeEventId?: string
}
```

Examples include consumption, waste production, nutrient release, growth uptake, predation, disease transmission, grazing, cleaning, decomposition, recovery, and equipment export. Each change MUST have a named cause. Conserved or bounded quantities SHOULD have per-tick accounting tests.

Behavior and ecology SHOULD be bidirectionally coupled:

```text
environment and welfare -> motivation and capability
behavior and contact -> resource and relationship events
events -> ecology, welfare, economy, and lifecycle changes
new world state -> later behavior opportunities
```

Display-only quantities MUST remain outside this loop. If two fidelity models exist, each consumer's authority MUST be declared.

## 11. Animation Must Follow Realized Motion

### 11.1 Presentation signal contract

```ts
interface LocomotionPresentation {
  normalizedForwardSpeed: number
  normalizedAcceleration: number
  normalizedYawRate: number
  pitch: number
  roll: number
  behaviorMode: string
  actionPulse?: string
  surfaceNormal?: Vec3
  supportDeformation?: number[]
}
```

The adapter SHOULD derive these values from current and previous kinematic solutions:

```text
forwardSpeed = dot(realizedVelocity, realizedPose.forward)
normalizedForwardSpeed = clamp(forwardSpeed / profile.cruiseSpeed, 0, presentationMaximum)
normalizedYawRate = realizedAngularVelocity.y / profile.maximumYawRate
```

Turn clips MUST follow signed realized yaw rate. Locomotion cadence MUST follow realized forward speed. Action clips MUST follow committed domain events or explicit interaction phases. Pose SHOULD remain upright within class limits unless support or an authored action permits another orientation.

### 11.2 Root motion and double authority

Presentation assets SHOULD contain local body deformation: tail beats, limb cycles, banking deformation, head turns, breathing, recoil, fin motion, or cloth response. They SHOULD NOT move the entity root through the world by default.

Root motion MAY be used only when the spatial solver explicitly consumes the clip displacement, validates collision, and writes the realized result back into authoritative state. Otherwise, root motion MUST be stripped or disabled.

Asset axes, scale, root transforms, semantic clip roles, loop seams, and maximum deformation MUST be validated before promotion. The full method belongs in [Asset and Animation Pipeline](./ASSET_AND_ANIMATION_PIPELINE.md).

### 11.3 Turning and body scale

Large or elongated agents SHOULD distribute turning across the body. The world solver still owns the route and root pose. The runtime adapter MAY bend a spine, yaw segments, lean limbs, or adjust fins according to realized curvature.

```text
curvature = realizedYawRate / max(realizedForwardSpeed, lowSpeedFloor)
localSegmentTurn[i] = clamp(curvature * segmentWeight[i], segmentLimit[i])
```

At very low speed, use a separate authored low-speed turn behavior rather than divide by near-zero velocity. A sharp-turn clip MAY blend in when curvature crosses a declared band, but it MUST not create unaccounted translation.

## 12. Tuning and Diagnostics

### 12.1 Tune layers in dependency order

**Recommended tuning order:**

1. Validate scale, axes, envelope, and environment fit.
2. Validate fixed-step continuity and static collision.
3. Validate one agent's cruise, turn, pause, and habitat distribution.
4. Validate two-agent passing and relationship behavior.
5. Validate dense groups and corner escape.
6. Validate resource and service contact.
7. Validate ecological consequences.
8. Align local animation and audio.
9. Validate long-run distributions and low-end performance.

Tuning animation before collision or habitat is stable tends to disguise the wrong owner. Tuning crowd forces before one-agent movement is stable multiplies ambiguity.

### 12.2 Trace the causal story

A development trace SHOULD make one entity understandable without requiring a debugger:

```json
{
  "tick": 840,
  "entityId": "entity-17",
  "profileId": "open-space-example",
  "position": [1.2, 0.8, -0.3],
  "velocity": [0.12, 0.01, 0.04],
  "behaviorMode": "roam",
  "motivationScores": { "roam": 0.62, "feed": 0.18 },
  "target": [2.1, 0.9, 0.4],
  "passSide": -1,
  "wallClearance": 0.31,
  "hardscapeClearance": 0.18,
  "neighborCount": 2,
  "correctionDistance": 0,
  "support": null,
  "animation": { "forwardSpeed": 0.72, "turn": -0.18 }
}
```

Recommended aggregate metrics include:

- correction distance divided by total travel;
- heading reversals and vertical zero crossings per second;
- time below the minimum forward-motion ratio;
- time spent in corner or stuck states;
- repeated pair rotation;
- minimum swept clearance;
- support-normal error;
- target and mode changes per game minute;
- region coverage and habitat occupancy;
- observed dwell and rare-mode distributions;
- animation speed error against realized kinematic speed;
- contact assignments, rejections, commits, and duplicate attempts;
- per-system simulation time and memory.

Thresholds MUST come from typicality, numerical safety, device budgets, or an explicitly approved feel target. They MUST NOT be selected only because one current trace happens to pass.

### 12.3 Use the short observed-failure loop

```text
observed error | owning contract | smallest change | affected restart |
identical retry result | durable guard
```

Classify the retry as `advanced`, `same error`, `new error`, or `passed`. After two grounded repairs produce the same failure, broaden the diagnosis to the next shared boundary. Do not keep adding forces or smoothing to a system whose ownership or timestep is wrong.

## 13. Deterministic Testing

### 13.1 Test invariants and distributions

A natural-looking trace is not a stable golden file. Tests SHOULD combine:

- per-tick invariants;
- exact fixed-seed event expectations;
- scenario completion thresholds;
- long-run distribution bands;
- metamorphic comparisons, such as one elapsed interval versus many chunks;
- runtime presentation checks on promoted assets.

```ts
interface ScenarioDefinition {
  id: string
  seed: number
  worldRevision: string
  contentRevision: string
  initialState: WorldState
  scheduledIntents: Array<{ tick: Tick; intent: PlayerIntent }>
  durationTicks: number
  invariants: ScenarioInvariant[]
  distributionChecks: DistributionCheck[]
  expectedEvents: EventExpectation[]
}

interface ScenarioResult {
  scenarioId: string
  finalStateHash: string
  eventDigest: string
  metrics: Record<string, number>
  invariantFailures: string[]
}
```

Each failure SHOULD report the seed, tick, entity IDs, revisions, last safe pose, active behavior, constraints, and event history needed to replay it.

### 13.2 Required scenario set

Every simulation-rich project SHOULD adapt this base suite:

1. Two equal forward-moving agents approach head-on, retain reciprocal passing sides, and pass without penetration, backward translation, or an undeclared vertical move.
2. A group enters a corner, chooses diverse interior escape targets, suppresses conflicting affiliation, and clears within a declared time bound.
3. A long body approaches a wall, begins turning before contact, and clears without repeated projection.
4. Agents traverse open passages while solid visible geometry remains blocking.
5. An environment edit publishes visual, collision, and support revisions atomically.
6. One resource is fairly assigned, contacted, and consumed exactly once by an eligible reachable entity.
7. A station service requires eligibility, assignment, approach, contact, one committed service event, departure, and cooldown.
8. A transfer-and-dwell agent satisfies habitat, dwell, transfer, perch, and excursion distributions without freezing.
9. Paired or grouped entities maintain soft proximity while retaining independent collision-safe paths.
10. Surface agents traverse every permitted support and seam within normal and clearance limits.
11. Save during motion restores behavior phase, target, pose, RNG, and the same next deterministic tick.
12. One large wall-time update and many smaller wall-time updates yield identical domain events and equivalent presentation snapshots after fixed stepping.
13. Pausing for any number of presentation frames changes no authoritative state.
14. A long soak measures corrections, wall contact, stuck duration, repeated pair rotation, habitat coverage, distribution fit, and finite state.

### 13.3 Example anti-regression invariants

```text
all numerical fields are finite
every entity stays within its admissible world or declared portal
hardscape clearance is nonnegative, except at declared support contacts
travel, acceleration, yaw, pitch, and roll stay within profile limits
forward-biased classes meet their minimum forward-motion ratio
surface classes retain an allowed support within normal-error bounds
habitat occupancy converges to declared long-run bands
rare-mode frequency and dwell remain within declared statistical bands
each consumable, service, reward, strike, or treatment commits at most once
pause is causal stasis
serialize, sanitize, and restore preserve the next-tick state hash
camera, hover, particles, clip phase, and display settings cannot mutate the world
```

### 13.4 Frame-chunk and ordering tests

Determinism requires more than using a seed. The test suite MUST prove that:

- all agents read the same prior-tick snapshot;
- stable entity ordering does not privilege one entity's already-updated state;
- changing presentation frame chunks does not change event history;
- save and reload do not resample targets or pass sides;
- identical content and environment revisions yield identical state and event digests;
- an intentional simulation revision changes the digest and migration evidence explicitly.

## 14. Migrating from Render-Owned Causes

When an existing project already owns locomotion or contacts inside the renderer, migrate by seam rather than rewrite the mature game.

1. **Inventory gameplay truth.** List every render-local value that can affect a later consequence.
2. **Define serializable state.** Add pose, velocity, behavior phase, target, pass commitments, attachments, cooldowns, and RNG continuation.
3. **Extract pure sensing and policy functions.** Give them immutable world snapshots and explicit profiles.
4. **Build the fixed spatial tick.** Preserve the existing domain reducer as authority.
5. **Move consequential contact.** The solver emits typed contact events; the reducer validates and commits them once.
6. **Make rendering read-only.** Interpolate snapshots and submit player intents.
7. **Retarget tests.** Test the new shared boundary rather than restoring superseded renderer helpers.
8. **Persist continuation.** Prove save, reload, pause, and frame-chunk equivalence.
9. **Remove or clearly classify competing authorities.** A laboratory model may remain, but production ownership MUST be unambiguous.

**Recommended:** do not replace a mature ecology, economy, quest, or lifecycle system merely because a newer spatial prototype has cleaner types. Preserve proven behavior and move one causal seam at a time.

## 15. Pocket Aquarium Case Study

The universal method above is the normative guidance. The following observations explain why those rules were selected.

### 15.1 Authority and clocks

**Observed:** [`js/sim.js`](../../js/sim.js) is the effective domain authority for water chemistry, cycling, ecology, welfare, equipment, economy, food inventory, breeding, coral state, and progression. It stores RNG state and advances through fixed game-day substeps. [`realistic_light_transport/src/App.tsx`](../../realistic_light_transport/src/App.tsx) owns production scheduling and persistence, while [`pocketAquariumBridge.ts`](../../realistic_light_transport/src/integration/pocketAquariumBridge.ts) projects the root state into the 3D application and translates actions back.

**Observed gap:** resident pose, velocity, route progress, collision correction, and several consequential contacts remain frame-driven in [`SpecimenFish.tsx`](../../realistic_light_transport/src/scene/SpecimenFish.tsx). Renderer-observed food, nori, and cleaner contact can trigger root actions. The deterministic ecosystem and the visible spatial cause therefore do not yet share one causal clock.

**Recommended:** preserve the mature root ecosystem model and migrate consequential spatial continuation into the authoritative state. Do not describe [`reefSimulation.ts`](../../realistic_light_transport/src/sim/reefSimulation.ts) or [`pocketGameController.ts`](../../realistic_light_transport/src/integration/pocketGameController.ts) as production authorities unless production imports change and new revision-bound evidence proves that status.

### 15.2 Motion recoveries

**Observed failure:** generic circular routes, hard positional repulsion, vertical avoidance, and intended-heading presentation produced recognizable failure families: synchronized motion, bouncing, sideways translation, corner loops, clipping, implausible hopping, and animals using the wrong locomotion class.

**Observed recovery:** the project added seeded route diversity, bounded frame travel, realized-velocity prediction, stable passing sides, species behavior profiles, anisotropic body sampling, exact rendered-rock collision fields, support-specific locomotion, and pose and clip speed derived from actual displacement. The relevant current anchors include [`speciesBehavior.ts`](../../realistic_light_transport/src/scene/speciesBehavior.ts), [`surfaceLocomotion.ts`](../../realistic_light_transport/src/scene/surfaceLocomotion.ts), [`speciesInteractions.ts`](../../realistic_light_transport/src/scene/speciesInteractions.ts), and [`SpecimenFish.test.ts`](../../realistic_light_transport/src/scene/SpecimenFish.test.ts).

**Recommended:** retain those behavior-family and geometry lessons while moving their causal state into a deterministic fixed-step solver. Pure helper tests are useful, but they do not prove the full live integrator.

### 15.3 Habitat and interaction examples

**Observed:** Pocket Aquarium uses explicit policy instead of one universal resident controller:

- open-water and structure-associated fish use bounded waypoint steering;
- benthic animals use lower vertical authority and site-biased behavior;
- Diamond Goby follows long sand holds and transfers with a short rock excursion near five percent of its authored schedule;
- Watchman Goby and pistol shrimp use a shared visible burrow preference without sharing one transform;
- cleaner shrimp use an idle, approach, service, depart sequence with contact-gated treatment;
- snails, sea stars, shrimp, crabs, and urchins use surface circuits rather than generic swimming;
- sea-star support sampling follows rock and rock-to-sand contours;
- tangs receive a strong nori-grazing target while the root owns resource capacity and bite validation.

**Observed:** these behaviors are represented in [`speciesInteractions.ts`](../../realistic_light_transport/src/scene/speciesInteractions.ts), [`surfaceLocomotion.ts`](../../realistic_light_transport/src/scene/surfaceLocomotion.ts), and root ecology in [`js/sim.js`](../../js/sim.js). The exact asset and support presentation is owned outside the domain model.

**Recommended:** use the same state-machine pattern for feeding, cleaning, pairing, grazing, predation, territory, treatment, and breeding. Consequential contact should be resolved by the deterministic spatial service and committed exactly once by the domain reducer.

### 15.4 Ecology and reduced-order models

**Observed:** the root ecology models equipment and husbandry as causes, including environmental fluxes, cycling, succession, cleanup capacity, rock maturation, sand detritus, food decomposition, welfare, disease stress, breeding, and coral growth. [`tests/sim.test.js`](../../tests/sim.test.js) provides deterministic coverage for these interactions.

**Observed:** [`flowField.ts`](../../realistic_light_transport/src/sim/flowField.ts) is deliberately a bounded reduced-order flow model. Display flow and the canonical biological scalar are related but not identical.

**Recommended:** keep reduced-order models when they preserve the intended causal distinction, but declare which representation is authoritative for each consumer. A particle field may be display-only. A food-contact or biological-exposure sampler must be deterministic if it changes gameplay.

### 15.5 Persistence and proof

**Observed recovery:** monotonic save sequencing, action-time persistence, peer adoption, sanitation, and capped offline catch-up reduced cross-view rollback and absence-related failures in [`App.tsx`](../../realistic_light_transport/src/App.tsx).

**Observed gap:** render-owned spatial continuation is not fully persisted, so reload or remount can reconstruct movement separately from domain history.

**Recommended:** include spatial continuation and collision revision in the save contract, then add exact next-tick replay, pause, and multi-view tests. Browser and device proof should follow the validation and diagnostic method in [Product Tooling and Validation](./PRODUCT_TOOLING_AND_VALIDATION.md).

## 16. Transfer Examples

These examples demonstrate reuse. They are not claims about implemented freshwater or wizard products.

### 16.1 Freshwater ecosystem

The same backbone can replace marine content with freshwater profiles:

- water chemistry, planting, filtration, and nutrient state remain world-owned fluxes;
- surface, mid-water, bottom, schooling, territorial, burrowing, and crawler families remain reusable;
- driftwood, caves, vegetation, substrate, and glass publish collision and support revisions;
- plants are rooted entities with local sway, growth, nutrient uptake, light response, and lifecycle state;
- evidence profiles describe species habitat and behavior, while calibration profiles compress time and tune difficulty;
- feeding, breeding, shoaling, grazing, disease, and maintenance remain typed interactions and events.

The transfer should reuse interfaces and tests, not saltwater constants or renamed species tables.

### 16.2 Wizard open world

The same architecture can support a very different fantasy:

- the World Model owns time, terrain revisions, resources, factions, quests, health, mana, relationships, positions, and action phases;
- content profiles describe humanoids, creatures, mounts, plants, structures, props, and spells;
- locomotion families cover walking, flying, swimming, climbing, mounts, patrols, crowds, and companions;
- behavior policies combine goals, needs, threat, territory, schedules, affiliation, and rare opportunities;
- service-station state machines become merchants, healers, trainers, crafting benches, dialogue sites, or transport points;
- feeding and predation patterns become resource gathering, pursuit, combat, and loot contact;
- flow-like reduced-order fields may represent wind, weather, crowd pressure, scent, or magic density;
- animation consumes realized navigation, turning, terrain support, and committed spell or combat events.

The invariant is unchanged: one deterministic causal world, explicit typicality, safe realized motion, presentation as projection, and revision-bound proof.

## 17. Ground-Up Build Order

**Recommended:** build the behavior and physics backbone in this order:

1. Define the world authority, content revision, units, coordinate system, fixed clock, RNG, intent, event, save, and replay contracts.
2. Implement one bounded environment, one static collision representation, and one immutable presentation snapshot.
3. Implement one representative entity with one locomotion family, one habitat envelope, and one deterministic state machine.
4. Prove motion caps, wall avoidance, hardscape clearance, pause, save, and frame-chunk equivalence headlessly.
5. Connect a runtime asset whose local animation follows realized kinematics.
6. Add a second entity and prove passing, comfort spacing, yielding, group separation, and corner escape.
7. Add one resource interaction and prove reservation, swept contact, exactly-once consequence, and ecological feedback.
8. Add support graphs and one surface or terrain-attached entity if the product needs them.
9. Add one representative special relationship, service, territory, or combat sequence.
10. Establish diagnostics, distribution tests, soak tests, and a fixed human feel-review journey.
11. Freeze shared family interfaces before expanding the content catalog.
12. Promote additional profiles only with evidence, typicality, environment-fit, deterministic scenario, runtime animation, and device receipts.

This order creates the smallest complete causal loop early. It also prevents content breadth from hiding a broken clock, collision boundary, or animation contract.

## 18. Acceptance Standard

A behavior and physics backbone is ready for broader content only when all of the following are true:

- The authoritative world state is serializable and deterministic for a fixed seed and input sequence.
- Consequential spatial state and contacts do not depend on presentation frame rate or render traversal order.
- Each entity has an explicit locomotion family, physical envelope, habitat envelope, behavior policy, and typicality contract.
- Unknown content fails closed instead of inheriting an unsafe generic controller.
- Static visual, collision, and support geometry share one atomic revision.
- Hard contacts are swept or continuously constrained; post-step projection is only a measured guard.
- Social spacing is soft, predictive, and compatible with passing, grouping, and yielding.
- Anti-teleport, anti-bounce, anti-jitter, anti-corner-loop, environment-fit, and surface-conformance invariants pass.
- Feeding, service, predation, territory, and other consequential interactions commit exactly once from authoritative contact.
- Ecological or narrative changes have named causes and bounded state.
- Animation speed, orientation, turning, and action clips follow realized kinematics and committed events.
- Pause, save, reload, resume, and frame-chunk tests preserve the same causal continuation.
- Long-run metrics fall inside approved typicality distributions across fixed seed sets.
- A human review at an exact revision finds the motion recognizable, characteristic, legible, and enjoyable.
- Browser and target-device journeys pass without substituting a different mechanics implementation.

## Repository Evidence Anchors

- Root deterministic ecology: [`js/sim.js`](../../js/sim.js), [`tests/sim.test.js`](../../tests/sim.test.js), and [`docs/ECOLOGY_MODEL.md`](../ECOLOGY_MODEL.md)
- Production state and projection: [`realistic_light_transport/src/App.tsx`](../../realistic_light_transport/src/App.tsx) and [`pocketAquariumBridge.ts`](../../realistic_light_transport/src/integration/pocketAquariumBridge.ts)
- Resident behavior and collision: [`SpecimenFish.tsx`](../../realistic_light_transport/src/scene/SpecimenFish.tsx) and [`SpecimenFish.test.ts`](../../realistic_light_transport/src/scene/SpecimenFish.test.ts)
- Species policies and special interactions: [`speciesBehavior.ts`](../../realistic_light_transport/src/scene/speciesBehavior.ts), [`speciesBehavior.test.ts`](../../realistic_light_transport/src/scene/speciesBehavior.test.ts), and [`speciesInteractions.ts`](../../realistic_light_transport/src/scene/speciesInteractions.ts)
- Surface support: [`surfaceLocomotion.ts`](../../realistic_light_transport/src/scene/surfaceLocomotion.ts) and [`surfaceLocomotion.test.ts`](../../realistic_light_transport/src/scene/surfaceLocomotion.test.ts)
- Reduced-order flow: [`flowField.ts`](../../realistic_light_transport/src/sim/flowField.ts) and [`flowField.test.ts`](../../realistic_light_transport/src/sim/flowField.test.ts)
- Current architecture intent: [`docs/THREE_D_MAIN_GAME_TICKET_PACK.md`](../THREE_D_MAIN_GAME_TICKET_PACK.md)
- Integration disposition practice: [`realistic_light_transport/work/pr7-convergence-ledger.md`](../../realistic_light_transport/work/pr7-convergence-ledger.md)
