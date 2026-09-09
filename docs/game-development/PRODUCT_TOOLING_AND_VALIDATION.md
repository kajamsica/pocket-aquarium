# Product Tooling, Validation, and Release Operations

This chapter defines how a detailed simulation game becomes a usable product without splitting its rules across player, developer, creator, desktop, mobile, web, and native surfaces. It applies to ecosystem simulations, character-driven worlds, management games, and other projects in which presentation quality and simulation truth must advance together.

The requirements use normative language:

- **MUST** identifies a condition required for a trustworthy result.
- **SHOULD** identifies the default unless measured evidence supports another choice.
- **MAY** identifies an optional extension that cannot weaken a MUST.

The chapter distinguishes evidence from design:

- **Observed** means directly supported by the accepted Pocket Aquarium repository, history, tests, or receipts at the named revision.
- **Recommended** means the reusable target method selected from that evidence.

For copyable project, entity, simulation, test, and gate records, use [Reusable Specification Templates](./REUSABLE_SPEC_TEMPLATES.md). The companion chapters are [Foundation and Architecture](./FOUNDATION_AND_ARCHITECTURE.md), [Realism, Behavior, and Physics](./REALISM_BEHAVIOR_AND_PHYSICS.md), and [Asset and Animation Pipeline](./ASSET_AND_ANIMATION_PIPELINE.md). For the project evidence behind this chapter, see [Ecology Model](../ECOLOGY_MODEL.md), [Pocket Aquarium Collaboration](../POCKET_AQUARIUM_COLLABORATION.md), and [iOS Deployment](../IOS_DEPLOYMENT.md).

## 1. The product contract

### 1.1 One mechanics system, many surfaces

**Recommended.** A game MUST have one authoritative World Model and one command/event boundary. Every product mode consumes a projection of that world and returns typed Player Intents. A mode MAY change its fixture, persistence namespace, safety policy, available tools, camera, layout, or presentation density. A mode MUST NOT select different simulation, collision, interaction, economy, or click rules.

```text
player input or creator intent
  -> typed command boundary
  -> fixed-step authoritative simulation
  -> committed domain events
  -> immutable projections
  -> presentation adapter
  -> desktop, touch, showcase, workbench, web, or native surface
```

The renderer MUST NOT decide that a consequential contact happened. The renderer MAY display anticipation, particles, camera motion, interpolation, or sound after the authoritative state produces the relevant event.

**Observed.** Pocket Aquarium projects the root ecosystem model through a bridge into React, Three.js, and React Three Fiber. Player actions return through a root dispatcher. Showcase, developer-safe, mobile, wide, and workbench routes exist. Some locomotion and consequential contacts still cross a render-frame boundary, so the current implementation is not yet evidence that all spatial causality follows one authoritative clock.

### 1.2 Player surfaces and creator surfaces

Player and creator surfaces serve different jobs and MUST have visibly different authority.

| Surface class | Primary user | Mutation authority | Required truth label |
|---|---|---|---|
| Player | Player | Validated game commands | Persistent or explicitly temporary world |
| Showcase | Reviewer or designer | Fixture-safe player commands | Deterministic, nonpersistent fixture |
| Developer-safe | Developer | Real commands under an explicit safety policy | Separate save and visible safety badge |
| Workbench | Asset creator and reviewer | Candidate edits only | Candidate digest and promotion state |
| World editor | Player or creator | Draft edits followed by explicit commit | Draft, validation, and lock state |
| Diagnostic overlay | Developer and tester | Read-only | Exact build, seed, tick, and mode |
| Native host | Player or device tester | Same commands as web | Release status and exact build digest |

**Recommended.** Every non-player mode MUST show a persistent mode badge. Good labels state consequence, not only a mode name:

- `SHOWCASE: RESET ON RELOAD`
- `DEV SAFE: SEPARATE SAVE`
- `WORKBENCH: INSPECTION ONLY`
- `CANDIDATE: NOT PROMOTED`

The default player entrypoint SHOULD be the only unlabeled product mode. Unknown or contradictory mode parameters MUST fail with an intelligible warning rather than silently selecting a fallback engine.

### 1.3 Mode contract

Every route or launch mode MUST declare:

| Field | Required meaning |
|---|---|
| Entrypoint | Canonical URL, executable route, or native launch action |
| Fixture | Initial state, seed, catalog revision, and environment revision |
| Mutations | Allowed commands and prohibited commands |
| Persistence | Save namespace, save policy, and reload behavior |
| Safety | Production rules, protected welfare, invulnerability, or inspection-only |
| Tools | Debug, editor, proof, or catalog controls available |
| Release availability | Local development, preview, production web, internal native, or public native |
| Mechanics identity | Proof that the same command, simulation, collision, and projection boundaries are used |

**Observed.** Pocket Aquarium uses `/` for persistent play, `/?showcase=1` for a deterministic nonpersistent accepted-catalog fixture, loopback `/?dev=1` for a separate protected save, their composition for disposable protected showcase review, and `/?workbench=<species-or-key>` for isolated specimen inspection. Compact and wide layouts use the same game state with separate layout preferences.

## 2. Display functions and presentation authority

### 2.1 Display is a projection, not a second simulation

**Recommended.** Each displayed value MUST be classified as one of:

1. **Authoritative:** stored or deterministically derived inside the World Model and capable of affecting later gameplay.
2. **Projected:** read-only transformation of authoritative state for a specific audience.
3. **Display-only:** visual or audible state that cannot affect later gameplay.

Examples of authoritative values include health, position when position affects contact, inventory, equipment state, relationship state, and resource quantity. Examples of projected values include a health label, warning badge, selected-resident card, or accessibility summary. Examples of display-only values include camera exposure, hover glow, water sparkle, decorative particles, and interpolation phase.

Every display control that resembles a simulation control MUST document its classification. A brightness slider MUST NOT change biological light unless it issues an explicit calibrated game command. A cinematic flow field MUST NOT change contact or welfare unless it is the named authoritative flow sampler.

**Observed.** Pocket Aquarium separates render brightness from biological PAR and labels its flow field as reduced-order rather than full computational fluid dynamics. Biology consumes a canonical flow estimate while the visual field is richer. This is valid only when the per-consumer authority difference is explicit.

### 2.2 Presentation adapter

The presentation adapter SHOULD receive realized kinematics and committed events:

```ts
interface LocomotionPresentation {
  normalizedForwardSpeed: number
  normalizedAcceleration: number
  normalizedYawRate: number
  pitch: number
  roll: number
  behaviorMode: string
  actionPulse?: string
  surfaceNormal?: [number, number, number]
  supportDeformation?: number[]
}
```

The adapter MUST map signed realized yaw rate to turning, realized forward speed to locomotion cadence, and committed events to action clips. It MUST strip unconsumed root motion. It MAY add bounded local turn deformation or surface conformance when the World Model already owns the world pose and contact result.

### 2.3 HUD hierarchy

**Recommended.** The HUD SHOULD reveal information in this order:

1. **World first:** the game remains the largest, clearest region.
2. **Immediate state:** critical health, threat, task, or objective is visible without opening a panel.
3. **Primary verbs:** the smallest set of frequent actions stays one touch away.
4. **Contextual inspection:** selection reveals the entity, evidence, status, and available commands.
5. **Management:** inventory, store, equipment, testing, and care use bounded sheets or windows.
6. **Creator and diagnostic tools:** clearly separated from ordinary player actions.

Alerts MUST communicate cause, consequence, and a legal response. A raw number without context SHOULD NOT be the only signal for a critical state. A warning MUST NOT imply that a modeled consequence exists when the game only displays advisory text.

**Observed.** Pocket Aquarium has one HUD that owns tank status, store, care, feeding, automation, residents, and inspection. Its compatibility risk acceptance still warns without acting out all expected ecological consequences. That limitation must remain visible until the simulation owns those outcomes.

## 3. Finger-first interaction and responsive game surfaces

### 3.1 Compact is a control grammar, not scaled desktop

**Recommended.** Desktop and touch surfaces MUST expose the same Player Intents and results. They SHOULD use different layout grammars:

| Concern | Wide pointer surface | Compact touch surface |
|---|---|---|
| Primary navigation | Multiple visible windows or dock | Bottom action dock within thumb reach |
| Secondary tools | Concurrent panels | One full sheet at a time |
| Selection | Precise cursor plus click | Forgiving hit region plus tap feedback |
| Hover | Supplemental information | Never required for a legal action |
| Dragging | Fine positioning with pointer | Coarse drag plus snap, preview, and confirm |
| Dismissal | Close button, escape, click-away | Visible close, swipe where safe, back action |
| Metrics | Persistent multi-panel view | Compact rail, badges, and expandable detail |
| Orientation | Wide workspace | Portrait and landscape profiles |

Touch targets MUST meet the target platform accessibility minimum. They SHOULD be at least 44 CSS pixels in the web surface unless the platform requires more. Critical actions SHOULD have larger effective hit regions than their visible artwork. The interface MUST respect safe-area insets, system gesture zones, keyboard occlusion, and orientation changes.

### 3.2 Touch input rules

- A tap MUST select or invoke one unambiguous action.
- A tap MUST NOT be interpreted as feeding, placing, and selecting simultaneously.
- Drag MUST begin only after a bounded movement threshold or explicit placement mode.
- World orbit, placement drag, and panel scroll MUST have exclusive gesture ownership.
- Long press MAY expose detail, but no required action may depend only on long press.
- Hover information MUST have a tap or focus equivalent.
- A placement gesture MUST end in a reversible frozen preview, not an immediate permanent write.
- Destructive actions MUST require a labeled confirmation or an immediately available undo with reliable persistence.
- Input handlers MUST issue typed intents and MUST NOT directly mutate render or world state.

### 3.3 Orientation profiles

Portrait and landscape SHOULD be distinct saved layout profiles over the same state. Each profile MUST preserve:

- world visibility,
- primary action reachability,
- readable critical status,
- safe-area clearance,
- selection and placement feedback,
- an escape from every sheet,
- no hidden required hover path.

**Observed recovery.** Pocket Aquarium improved mobile usability by keeping the tank dominant, reducing the compact dock to a small number of primary actions, moving secondary tools under a bounded workspace, preserving a one-full-sheet invariant, and saving compact and wide preferences separately.

## 4. Creator tools and transactional editing

### 4.1 One editing state machine

**Recommended.** Asset edits, terrain edits, rockscapes, coral placement, building placement, loadouts, and calibration changes SHOULD share this transaction:

```text
begin -> preview -> validate -> freeze -> commit
                              \-> revise
                              \-> cancel
```

The draft MUST remain outside authoritative saves and runtime registries until commit. Validation MUST run against the same geometry, content revision, and constraints that commit will use. Freeze MUST preserve the exact preview while the user inspects or confirms. Commit MUST be atomic. Cancel MUST restore the previous authoritative state without residue.

### 4.2 World placement and store flow

A purchase and a placement are separate transactions:

1. The store validates economy, progression, capacity, environment, compatibility, and content availability.
2. If a conflict exists, the player sees its cause and modeled consequence.
3. Allowed resolutions MAY include block, accept modeled risk, remove or sell conflicts, or modify the environment.
4. A successful purchase creates inventory, not an arbitrary world mutation.
5. The placement tool starts a draft from inventory.
6. The preview snaps only to legal supports and displays bounds, clearance, environment, and attachment feedback.
7. A tap or drag freezes the candidate location.
8. An explicit lock command commits placement and consumes inventory according to game rules.
9. Save and reload prove the locked position and attachment revision.

The store MUST NOT say a compatibility consequence is modeled unless the World Model applies it. The editor MUST NOT accept placement against one support revision and save against another.

**Observed.** Pocket Aquarium coral placement uses armed, following, frozen, and locked states. Rockscape edits remain temporary until lock, and attached coral constrains unsafe changes. These are evidence for the general transaction, not proof that every current creator tool follows it.

### 4.3 Workbench

The workbench is an isolated runtime-equivalent surface for costly content decisions. It MUST use the same loader, presentation adapter, materials, coordinate conventions, and semantic actions as the player. It SHOULD provide:

- category, entity, variant, candidate, promoted version, and predecessor selection;
- side, front, top, three-quarter, turntable, orthographic, and perspective views;
- fit scale and true shared scale with a real-unit ruler;
- clip selection, speed, pause, phase scrub, transition preview, and signed turn preview;
- wireframe, skeleton, material channels, collision envelope, attachment points, support probes, and levels of detail;
- reference overlays with per-view confidence and landmark deltas;
- runtime statistics and target-device budgets;
- immutable candidate digest, toolchain version, validation receipts, visual debt, approval state, promotion state, and predecessor.

The workbench MUST keep `Candidate Validation`, `Visual Approval`, and `Runtime Promotion` separate. Previewing or approving a candidate MUST NOT promote it. Saving an edit MUST create a new immutable candidate.

**Observed.** Pocket Aquarium has strong inspection controls and a loopback candidate service. Morphology and profile editor components exist in the source tree but were not mounted in the active workbench at the accepted revision. Catalog-wide semantic editing and generic atomic promotion are therefore recommended capabilities, not observed active features.

For candidate construction and Blender-specific gates, use [Asset and Animation Pipeline](./ASSET_AND_ANIMATION_PIPELINE.md). The source record is also summarized in the accepted repository under `realistic_light_transport/art/README.md`.

### 4.4 Showcase, developer-safe mode, and God Mode

**Recommended.** A showcase SHOULD be a deterministic fixture on the exact player mechanics. It MAY disable persistence and prepopulate accepted content. It MUST NOT use a second behavior or collision engine.

Developer-safe mode MAY protect test subjects from death or make store actions free. It MUST:

- be gated to a safe environment such as loopback development,
- show a persistent badge,
- use a separate save namespace,
- preserve normal command, simulation, interaction, and rendering paths,
- log each protection it applies,
- be impossible to activate silently in a production release.

God Mode is a safety policy, not an alternate game. A successful God Mode test does not prove normal balance, mortality, economy, or offline progression.

## 5. Persistence and cross-view coherence

### 5.1 Persistence is a concurrency boundary

Even a single-player simulation has multiple writers: scheduled ticks, explicit actions, browser tabs, native resume, offline catch-up, and creator commits. The persistence coordinator MUST own:

- schema version and migrations,
- content revision and hardscape/collision revision,
- monotonic save ordering,
- action-time persistence,
- bounded periodic persistence,
- sanitation and finite-value checks,
- offline and suspend/resume policy,
- development and showcase namespaces,
- conflict adoption and rejection,
- exact restoration evidence.

Intentional actions SHOULD persist synchronously at the authoritative boundary. Autonomous ticks MAY persist at a slower bounded cadence. A writer MUST adopt or rebase against a newer saved sequence before committing. Wall-clock timestamps MUST NOT be the sole ordering key.

If spatial state affects later gameplay, the save MUST contain that state or enough pinned information to reconstruct the exact continuation. At minimum, preservation must cover pose or reconstruction seed, velocity, behavior phase, target, dwell deadline, cooldowns, pair or station state, support attachment, RNG stream, content revision, and collision revision.

### 5.2 Save acceptance journey

A persistence change MUST pass this journey at the exact build revision:

1. Open two views on the same player save.
2. Perform a durable named action in the first view.
3. Advance autonomous time in the second view.
4. Confirm the second view adopts the newer action before its next write.
5. Reload both views.
6. Confirm state, spatial continuation, content revision, and save sequence agree.
7. Open developer-safe and showcase modes.
8. Confirm neither can overwrite the player save.

**Observed recovery.** Pocket Aquarium uses a monotonic `saveSeq`, action-time saves, storage-event adoption, sanitation, and capped offline catch-up. This fixed a failure in which another open aquarium could revert a newer intentional action.

## 6. Shortest honest live-surface protocol

The earliest real audience surface is a milestone, not completion.

### 6.1 Before surface readiness

The owner MUST write a compact surface contract:

```text
consumer | action | observable result
canonical revision | entrypoint | mode | fixture seed
minimum honest and safe handoff checks
known limitations | validation isolation | remaining gates
```

Only failures that prevent meaningful use, invalidate feedback, violate an explicit contract, or create material risk may block the first handoff. Polish and optional completeness checks continue afterward.

### 6.2 Surface-ready handoff

At `SURFACE_READY`, the owner MUST return:

- exact revision or artifact digest,
- canonical URL, executable, artifact path, or device build,
- mode and persistence semantics,
- fixture and seed,
- checks already passed,
- limitations still visible,
- automated review and validation still running.

The surface SHOULD stay available while validation continues. Disruptive tests MUST use an isolated worktree, process, browser context, port, or device installation.

### 6.3 Single-surface discipline

- One integration branch owns one authoritative user-visible server.
- One documented port and one browser tab represent that surface.
- A branch change MUST stop or clearly retire the previous server before the new one becomes canonical.
- Temporary browser validation MUST use an isolated port and close fully afterward.
- A workbench or showcase link MUST include every mode parameter needed to reproduce the state.
- Every screenshot, video, trace, and human approval MUST name the exact revision and entrypoint.

**Observed.** Pocket Aquarium accumulated ambiguous ports and branches during fast iteration. Its strongest later browser proofs used an isolated port, exact revision, defined viewport, state changes, console status, and screenshot hashes while preserving the user’s comparison surface.

## 7. RAM-safe live development

### 7.1 Resource policy

Heavy work includes Blender authoring or renders, catalog-wide builds, Chromium automation, native Gradle or Xcode builds, and high-resolution runtime capture. Operators MUST measure the host rather than assume that the tool’s maximum worker count is safe.

| Host state | Recommended action |
|---|---|
| Green, below 50% physical RAM | One heavy lane plus one light validation lane MAY run |
| Amber, 50% to 70% | Start no new Blender, native, or browser-heavy lane |
| Red, above 70% or sustained swap | Stop heavy children, keep only the canonical live surface, capture process evidence, then resume sequentially |

These percentages are recommended starting points, not universal hardware facts. A project SHOULD replace them with measured budgets after recording peak resident memory for each job class.

### 7.2 Session protocol

1. Record free memory and active Vite, browser, Blender, Gradle, and Xcode processes.
2. Name the canonical branch, revision, port, URL, PID, mode, and fixture seed.
3. Start at most two Blender workers until measured evidence permits more.
4. Run schema and source checks before expensive exports and proof renders.
5. Do not run catalog-wide Blender, Android Gradle, iOS Xcode, and browser E2E concurrently on a constrained workstation.
6. Reuse one dependency installation and one pinned toolchain.
7. Use a disposable worktree for branch-switching or staged-asset mutation.
8. Terminate each heavy stage and confirm its child processes exited.
9. Preserve the canonical live server during non-disruptive tests.
10. Update the session receipt whenever revision, route, mode, fixture, or owner changes.

**Observed failure.** Pocket Aquarium exceeded roughly 50 GB of RAM when multiple browsers, dev servers, asset builders, and visual jobs ran together. The generic catalog builder’s worker ceiling was not a proof of a safe workstation default.

## 8. Instrumentation and observability

### 8.1 Read-only diagnostic contract

Diagnostics MUST consume projections and event records. A diagnostic toggle MUST NOT change random streams, simulation ordering, collision, chemistry, welfare, or persistence.

The minimum exported snapshot SHOULD contain:

```json
{
  "buildRevision": "a2f65b788faa89dce59fb0bf826547f96648da83",
  "mode": "showcase",
  "fixtureSeed": 88421,
  "saveNamespace": "none",
  "saveSequence": 0,
  "simulationTick": 840,
  "contentRevision": "marine-catalog-v1",
  "collisionRevision": "rockscape-v2",
  "entity": {
    "id": "resident-17",
    "profile": "yellow_tang",
    "behavior": "graze_nori",
    "position": [1.2, 0.8, -0.3],
    "velocity": [0.12, 0.01, 0.04],
    "target": "nori-clip-2",
    "turnRate": -0.18,
    "wallClearance": 0.31,
    "rockClearance": 0.18,
    "neighborCount": 3,
    "passSide": -1,
    "correctionDistance": 0.0,
    "animationRole": "locomotion",
    "playbackRate": 0.72
  },
  "runtime": {
    "fps": 60,
    "frameDeltaMs": 16.7,
    "drawCalls": 148,
    "triangles": 384000,
    "loadedAssetBytes": 26700000,
    "processMemoryMb": 1320
  }
}
```

The values above demonstrate the shape only. They are not performance targets.

### 8.2 Required diagnostic domains

- Build revision, release digest, mode, route, fixture seed, save namespace, save sequence, and simulation tick.
- Entity identity, profile, lifecycle stage, welfare, needs, habitat, behavior, target, velocity, angular rate, support, clearance, and correction.
- Interaction assignment, eligibility, contact, committed event, exactly-once status, rejection reason, and consequence.
- Presentation role, playback rate, kinematic error, level of detail, asset bytes, draw calls, triangles, frame rate, frame delta, and memory.
- Creator candidate digest, toolchain, validation state, visual approval state, runtime promotion state, predecessor, and visual debt.
- A bounded causal event ring with source intent, tick, state delta summary, and presentation acknowledgement.

### 8.3 Behavioral metrics

Natural-looking systems SHOULD be validated with distributions and invariant thresholds rather than one golden motion trace. Useful measures include:

- correction distance divided by total travel,
- wall-contact and stuck duration,
- minimum swept clearance,
- heading reversals and vertical zero crossings,
- backwards or sideways travel ratio,
- time inside habitat bands,
- region coverage,
- repeated pair rotations,
- support-normal error,
- target changes per minute,
- event contact-to-consequence latency,
- animation speed error versus realized speed.

Thresholds MUST come from a typicality contract, a design decision, or a device probe. They MUST NOT be unexplained constants.

## 9. Validation pyramid

Validation layers answer different questions. A higher layer MUST NOT replace a lower invariant, and a lower layer MUST NOT claim human recognizability or device usability.

| Level | Gate | Primary question | Required evidence |
|---|---|---|---|
| 0 | Static contracts | Do schemas, types, imports, routes, manifests, IDs, and paths agree? | Type, schema, build, and exhaustive catalog checks |
| 1 | Deterministic World Model | Are lifecycle, resources, economy, and actions finite, causal, replayable, and sanitizable? | Fixed-seed unit, property, conservation, migration, and offline tests |
| 2 | Spatial and interaction math | Are support, collision, steering, placement, fields, and contacts correct without rendering? | Deterministic scenarios, sweeps, distributions, and long-run invariants |
| 3 | Runtime assets and renderer | Do actual assets load, animate, align, remain bounded, and meet budgets? | Fresh imports, runtime parity, traces, and performance counters |
| 4 | Isolated human acceptance | Is morphology, scale, local motion, readability, and typicality convincing? | Fixed workbench journey and digest-bound approval |
| 5 | Player browser journeys | Do pointer, touch, HUD, modes, edits, saves, reloads, and interactions work? | Desktop, portrait, and landscape journeys with console and network evidence |
| 6 | Packaging contracts | Does one accepted build stage identically into web and native hosts? | Staging manifest, hashes, offline proof, unsigned host builds, APK or simulator artifact |
| 7 | Device and release | Does the immutable artifact install, resume, perform, and meet platform policy? | Signed internal installs, OS/device matrix, thermal/memory/frame metrics, store and rollout receipt |

### 9.1 Automated authority

Automation MUST decide finite state, determinism, conservation and bounds, contact uniqueness, schema parity, hash identity, import parity, persistence ordering, and measurable performance budgets. It SHOULD also produce visual diffs and behavioral distribution reports, but their thresholds still require a declared contract.

### 9.2 Human authority

Humans MUST decide recognizable shape, believable typical motion, control feel, visual hierarchy, readability, delight, and whether an accelerated behavior remains true enough to its subject. Human approval MUST identify the exact revision or digest, entrypoint, view or journey, references, observed defect, accepted result, and known debt.

For visible assets, motion, and player-facing interactions, neither authority may waive the other.

### 9.3 Deterministic and contract tests

Every simulation or behavior change SHOULD have the smallest headless test that proves its causal rule. Every cross-layer change SHOULD have a contract test at the interface. Examples:

- a fixed seed plus actions produces the same state hash;
- pause produces zero authoritative ticks regardless of presentation frames;
- a food item produces at most one consume event after valid contact;
- an unsupported entity classification fails closed;
- a save reloads with the same next tick;
- a candidate GLB hash matches the promoted runtime entry;
- native staging hashes match the accepted web artifact;
- a mode changes fixture or safety policy without changing mechanics imports.

### 9.4 UI, E2E, and human journeys

Browser and device journeys MUST exercise the real player entrypoint, not an internal proxy. Each receipt MUST include:

- exact revision or artifact digest,
- entrypoint and route parameters,
- environment and build mode,
- fixture and seed,
- viewport, orientation, input type, OS, and device where applicable,
- ordered actions,
- visible and state-level result,
- console and network status,
- screenshot, trace, or video digest where captured,
- limitations and deferred gates.

At minimum, the product SHOULD maintain one desktop, one portrait touch, and one landscape touch journey. Creator work SHOULD add one workbench acceptance journey. Native releases MUST add install, cold launch, suspend, resume, offline, rotation, and update journeys on representative devices.

### 9.5 Pocket Aquarium validation anchors

**Observed.** Pocket Aquarium has broad deterministic root tests, pure scene and behavior tests, runtime rendering tests, PWA and native staging contracts, workbench inspection, and exact-revision browser evidence. No accepted packet proved one maintained cross-mode browser E2E suite or signed store release.

Typical repository commands include:

```bash
node tests/sim.test.js
node tests/render.test.js
node tests/pwa.test.js
node tests/native.test.js
npm --prefix realistic_light_transport run build
```

Commands prove only the revision and environment in which they were actually run. Documentation MUST attach their result receipts rather than list them as implied success.

## 10. Observed-error repair loop

When a real surface produces a reproducible failure and repair is authorized, use this exact loop:

```text
observed error | owning contract | smallest change | affected restart |
identical retry result: advanced, same error, new error, or passed | durable guard
```

Procedure:

1. Capture the exact visible error and correlated console, network, log, trace, or state evidence.
2. Identify the smallest authoritative owner. Do not patch a projection to hide a World Model defect.
3. Change the smallest observed owner.
4. Restart only the affected component.
5. Repeat the identical entrypoint, fixture, seed, viewport, input, and actions.
6. Classify the result as `advanced`, `same error`, `new error`, or `passed`.
7. Convert an accepted repair into a deterministic test, scenario threshold, visual digest, performance budget, migration test, or explicit human acceptance record.

Broaden the investigation when two grounded repairs leave the same error, evidence cannot identify one actionable owner, the repair crosses a stable architecture boundary, or the failure requires a product or safety decision.

**Observed recoveries.** This method turned lethal nighttime light into a daylight-weighted biological rule, generic animal motion into fail-closed behavior families, fish sliding into realized-velocity presentation, stale test ownership into boundary-level assertions, and cross-tab rollback into monotonic save sequencing.

## 11. Agent lanes, ownership, and integration

### 11.1 Freeze contracts before fan-out

Parallel work SHOULD start only after the goal, canonical entrypoint, world authority, content schema, persistence namespace, acceptance journey, and shared interfaces are fixed. Work MUST be divided by exclusive artifacts and authority seams, not vague feature names.

Good parallel lanes include:

- independent evidence packets,
- independent entity candidates after a body-plan contract freezes,
- isolated behavior-family scenarios,
- platform hosts consuming one fixed build,
- documentation chapters with disjoint ownership.

Shared World Model reducers, behavior controllers, body-plan libraries, acceptance registries, persistence coordinators, release manifests, and live ports require one active owner.

Every delegated lane MUST return a real dispatch identifier and a result receipt containing:

- role and bounded mission,
- base revision,
- owned and changed artifacts,
- commands and tests actually run,
- hashes, screenshots, or diagnostics where applicable,
- known debt and blockers,
- proposed merge unit,
- runtime, model, and transport,
- fallback use or explicit absence,
- exact evidence revision.

### 11.2 Capability disposition

Integration MUST compare each overlapping capability against present authority:

```text
capability | incoming implementation | current authority | disposition
disposition: keep exact | adapt to current boundary | intentionally supersede
reason | affected tests | migration or rollback | revision proof
```

A whole branch MUST NOT win merely because it is newer or compiles. Superseded controllers, tests, or renderers MUST NOT be restored to satisfy stale white-box assumptions. Tests SHOULD move to the shared boundary they intend to protect.

### 11.3 PR boundaries

The smallest cohesive PR stack SHOULD follow stable authority seams:

1. schema and contracts,
2. authoritative model behavior,
3. deterministic spatial services,
4. projection and renderer adapter,
5. player interaction and HUD,
6. creator tooling,
7. content-only promotions,
8. packaging and release.

A PR MUST leave its declared canonical surface working or clearly state a dependency on an earlier stack member. Binary content-only promotions MAY remain independent when they do not change shared contracts. Shared registry writes SHOULD be serialized.

Before final validation, the owner MUST fetch and rebase onto current main. Conflict resolution MUST preserve the newest authority boundary. Independent review SHOULD be required for World Model, spatial causality, persistence, renderer/asset promotion, security, and native packaging changes.

Merge authority MUST remain explicit. After merge, the owner SHOULD fetch main, rebuild the one canonical surface, rerun the same acceptance journey, and close or revise the ownership record.

## 12. Asset approval and runtime promotion

This chapter owns product and release consequences of promotion. Asset construction belongs to [Asset and Animation Pipeline](./ASSET_AND_ANIMATION_PIPELINE.md), while simulation authority belongs to [Realism, Behavior, and Physics](./REALISM_BEHAVIOR_AND_PHYSICS.md).

Promotion operations MUST consume the canonical `CandidateStatus`, `VisualApprovalStatus`, and `RuntimePromotionStatus` fields defined in [Foundation section 2](./FOUNDATION_AND_ARCHITECTURE.md#2-exact-vocabulary). Product surfaces MUST display the three states independently, and the promotion owner MUST attach validation, approval, and registry-write evidence to the exact candidate digest. The bare word `accepted` SHOULD NOT stand in for these meanings.

Runtime promotion MUST:

1. verify candidate validation and visual approval refer to the exact same immutable digest;
2. acquire exclusive ownership of the registry write;
3. compare the expected base registry hash;
4. copy exact bytes to an immutable versioned runtime path;
5. record asset identity, real scale, semantic clips, hashes, default status, and predecessor;
6. validate one default per content identity;
7. run catalog, loader, interaction, and in-world smoke gates;
8. retain a rollback transaction and all rejected or superseded evidence.

**Observed.** Pocket Aquarium has generic deterministic candidate production and a hash-guarded runtime registry. Its strongest atomic compare-and-swap promotion service is Ocellaris-specific at the accepted revision. Catalog-wide atomic promotion remains recommended.

## 13. One compiled product across web and native

### 13.1 Artifact boundary

**Recommended.** One immutable compiled product digest MUST feed preview web, PWA, native hosts, internal testing, and store candidates. Platform hosts MUST stage those exact bytes and MUST NOT contain alternate gameplay code or a remote runtime URL.

```text
source revision
  -> production web build and aggregate digest
  -> web/PWA host
  -> deterministic native staging manifest
  -> unsigned CI host builds
  -> signed internal builds
  -> store candidate
  -> staged production rollout
```

Native staging SHOULD reject unsafe paths, symlinks, missing entrypoints, and untracked substitutions. It SHOULD emit per-file and aggregate hashes.

### 13.2 Release-state evidence

Release operations MUST consume the canonical `ReleaseStatus` defined in [Foundation section 2](./FOUNDATION_AND_ARCHITECTURE.md#2-exact-vocabulary). The release owner advances that status only when the corresponding evidence below is attached to the same immutable product digest.

Each state requires new evidence:

| State | Minimum proof |
|---|---|
| Built | Clean production build and digest |
| CI verified | Static, test, staging, and unsigned host-build receipts |
| Device verified | Physical install, launch, resume, offline, rotation, memory, thermal, and frame evidence |
| Signed internal | Managed credentials and successful internal distribution |
| Store candidate | Signed AAB or archive, metadata, privacy, rating, screenshots, support URLs, and reviewer checklist |
| Published | Store listing and production version receipt |
| Rolled back | Named prior artifact restored or rollout halted with user-data compatibility checked |

A debug APK is installable test evidence, not a Play Store release. An unsigned simulator app is compile evidence, not an App Store release. Signing keys MUST remain in platform secret stores. Publication authority MUST be granted explicitly.

### 13.3 Rollout and rollback gates

Before rollout, the release owner MUST record:

- artifact digest and source revision,
- schema, catalog, and save migration compatibility,
- minimum and current device matrix,
- privacy and data-safety declarations,
- crash, memory, thermal, frame-time, and startup budgets,
- staged rollout percentages and observation intervals,
- responsible owner and stop thresholds,
- rollback artifact and save compatibility,
- content and server compatibility if applicable.

Rollback MUST restore an immutable predecessor. It MUST NOT silently rebuild the same version. A data migration that cannot read the predecessor MUST have a forward-fix plan before rollout.

**Observed.** Pocket Aquarium Pages and Capacitor staging use the same Vite output and checksum manifest. At the accepted evidence revision, main proved an unsigned iOS simulator host, while Android debug APK evidence was bound to branch revision `dd987d3169e0f0b33012c74f12858f86c3a3736b`. Neither receipt proved signed store release or physical-device acceptance.

## 14. Product operations within the canonical roadmap

The [ground-up execution sequence](./README.md#ground-up-execution-sequence) owns the canonical stage order, and the [Foundation completion checklist](./FOUNDATION_AND_ARCHITECTURE.md#15-foundation-completion-checklist) owns architecture readiness. This chapter adds only the product-operation responsibilities that apply while following them:

- At the vertical-slice stage, expose the real player surface as soon as its minimum honest and safe handoff gate passes, then continue automated validation without making optional feedback a dependency.
- At the gold-asset and creator-platform stages, keep candidate validation, visual approval, runtime promotion, and rollback separate and bind every receipt to one immutable digest.
- At product completeness, require the canonical journeys to use the same mechanics boundary across player, showcase, developer, touch, pointer, compact, and wide surfaces.
- At platform release, stage one compiled product digest into every host, assign an explicit release owner, and require the evidence in section 13 before advancing the canonical release status.
- During live evolution, retain revision-bound telemetry, incident, migration, rollout, and rollback records so later changes do not erase prior evidence.

Teams MUST NOT fan out a large content catalog before one representative item proves the evidence-to-player lifecycle. They SHOULD NOT generalize a creator tool before one manual or scripted process has produced an accepted result. They MUST NOT broaden content while the canonical player journey is broken.

## 15. Documentation and decision-record maintenance

Documentation is an operational interface and MUST follow the same revision discipline as code and content.

### 15.1 Required records

- Current architecture and named authority owners.
- Content, candidate, approval, promotion, and release schemas.
- Mode and route matrix.
- Canonical acceptance journeys.
- Active ownership claims with expiry or merge closure.
- Capability disposition ledgers for overlapping integrations.
- Accepted architecture decisions with alternatives and consequences.
- Known limitations and bounded measurement decisions.
- Validation and release receipts tied to revisions.
- Rollback predecessors and compatibility notes.

### 15.2 Maintenance rules

1. A behavior or architecture change MUST update its governing document and tests in the same merge unit or explicitly deprecate the stale document.
2. A document that describes historical architecture MUST say so at its first relevant section.
3. Generated status MUST come from authoritative manifests or tests where possible.
4. Coordination records MUST close or transfer ownership at merge.
5. Human acceptance notes MUST preserve the rejected state and accepted successor.
6. A bounded open decision MUST state the probe that can close it.
7. Documentation MUST link to source paths, commits, digests, or receipts rather than rely on narrative confidence.

**Observed failure.** Pocket Aquarium’s root README describes both the current React/Three product and an older zero-dependency Canvas architecture as if each were the whole application. Its collaboration ledger also contains a useful process alongside a historical PR baseline. These are examples of why status and architecture prose need revision boundaries.

## 16. Transfer examples

These are design transfers, not claims about implemented products.

### Freshwater ecosystem

The same player/showcase/workbench/native surfaces can remain. Content changes to freshwater chemistry, plants, wood, river or lake habitats, and different compatibility profiles. A planting editor follows the same draft/freeze/commit transaction as coral placement. Schooling, bottom dwelling, plant grazing, and current response use different behavior policies over the same command, simulation, projection, and acceptance boundaries.

### Open-world wizard game

The tank view becomes world, inventory, map, dialogue, combat, and creator-lab projections. Species evidence becomes a mythology and style bible. Fish motion families become humanoid, flying, mount, creature, patrol, and party behavior families. Cleaning-station or feeding interactions become dialogue, spell preparation, crafting, combat, or companion-bond state machines. Terrain, building, loadout, spell, and character editors still use reversible drafts. Web, desktop, console, or mobile hosts still promote one tested release artifact through explicit platform gates.

The transferable result is not aquarium code. It is one authority, typed commands and events, deterministic causality, evidence-backed content, transactional editing, runtime-equivalent workbenches, revision-bound acceptance, and an immutable release ladder.

## 17. Product readiness checklist

Before calling a detailed simulation game ready for a public V1, confirm:

- [ ] One authoritative World Model owns every consequential fact.
- [ ] Every surface uses the same simulation, collision, action, and projection contracts.
- [ ] Showcase, developer-safe, and workbench modes visibly declare persistence and safety semantics.
- [ ] Compact portrait, compact landscape, and wide layouts pass the same player actions.
- [ ] Hover-only and precision-pointer-only requirements have touch and focus equivalents.
- [ ] World and content edits remain drafts until explicit validated commit.
- [ ] Save ordering, restore, migration, offline policy, and multiple-view adoption pass.
- [ ] Diagnostics are read-only and export exact revision, seed, mode, tick, and entity state.
- [ ] The validation pyramid has current revision-bound receipts.
- [ ] Visible assets and feel-critical behaviors have both automated and human acceptance.
- [ ] The live surface uses one branch, port, route, and fixture receipt.
- [ ] Heavy work follows a measured RAM budget and terminates child processes.
- [ ] Delegated work has exclusive ownership, real dispatch IDs, receipts, and a named integration owner.
- [ ] Overlapping branches have capability-level disposition records.
- [ ] Asset promotion is immutable, hash-bound, atomic, and rollback capable.
- [ ] Web and native hosts consume one compiled artifact digest.
- [ ] Debug, unsigned, device-verified, signed, store-candidate, and published states are not conflated.
- [ ] Release and rollback owners, stop thresholds, and save compatibility are recorded.
- [ ] Documentation identifies current authority and labels historical material.
- [ ] Every accepted repair leaves a durable regression guard.

## 18. Pocket Aquarium evidence boundary

**Observed at main revision `a2f65b788faa89dce59fb0bf826547f96648da83`:** the product has a deterministic serializable ecosystem model, a React/Three projection, shared player and showcase mechanics, a touch-first compact workspace, transactional coral and rockscape editors, a strong isolated specimen workbench, hash-bound asset registries, exact web-to-native staging, extensive deterministic tests, and an unsigned iOS simulator build path.

**Observed at Android branch revision `dd987d3169e0f0b33012c74f12858f86c3a3736b`:** the product adds an Android native host, packaging contracts, and a debug APK CI path without signing material.

**Observed gaps:** consequential locomotion and some contacts remain frame-driven; semantic morphology/profile editors are not active in the inspected workbench route; generic atomic asset promotion is not yet proven; some compatibility warnings do not yet produce their implied ecological consequence; a maintained cross-mode browser journey suite was not found; physical-device, signed-internal, and public-store receipts remain unproven at those revisions.

**Recommended next product proof:** choose one canonical player journey that exercises touch selection, feeding contact, a persisted draft-to-lock placement, save/reload, showcase parity, and the promoted asset loader. Bind desktop, portrait, landscape, and physical Android receipts to one compiled digest. This closes more product risk than expanding the content catalog or adding another presentation mode.
