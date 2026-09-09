# Asset and Animation Pipeline

## Purpose

This chapter defines a repeatable way to turn real-world, historical, or invented subject matter into recognizable, correctly scaled, animated runtime assets without allowing art files to become a second source of gameplay truth. The method applies to animals, people, creatures, plants, corals, props, vehicles, structures, effects, and terrain pieces.

The central rule is simple:

> An asset MUST represent appearance and local deformation. The World Model MUST own identity, lifecycle, behavior, world movement, collision outcomes, and every fact that can change later gameplay.

This division lets an aquarium fish, a freshwater plant, and a wizard character use the same production discipline even though their anatomy, locomotion, materials, and actions differ.

Use the canonical terms and lifecycle statuses from [Foundation and Architecture](./FOUNDATION_AND_ARCHITECTURE.md). Use [Realism, Behavior, and Physics](./REALISM_BEHAVIOR_AND_PHYSICS.md) for authoritative motion, contact, and support-surface behavior. Use [Product Tooling and Validation](./PRODUCT_TOOLING_AND_VALIDATION.md) for workbench availability, player journeys, device proof, and release inclusion. Copyable records and gate forms belong in [Reusable Specification Templates](./REUSABLE_SPEC_TEMPLATES.md), not in competing local checklists.

Throughout this chapter:

- **Observed** means directly supported by the accepted Pocket Aquarium repository evidence.
- **Observed failure** means a preserved defect or rejected result.
- **Observed recovery** means a repair supported by repository history, tests, or an acceptance record.
- **Recommended** means the reusable target contract inferred from that evidence.

## 1. The asset contract

### 1.1 What each layer owns

| Owner | MUST own | MUST NOT own |
|---|---|---|
| Evidence Profile | Sources, rights or permission notes, measurements, confidence, inference, known contradictions | Gameplay tuning, live instance state |
| Content Profile | Stable identity, body plan, environment, typicality, lifecycle references, calibration references, asset references | Mutable health, position, behavior phase |
| Presentation Asset | Meshes, materials, UVs, rig, blend shapes, local clips, LODs, attachment and conformance metadata, reference scale | World path, route target, hunger, compatibility, damage, rewards |
| World Model and spatial services | Entity identity, state, behavior, pose, realized velocity, collision, support, contacts, interaction outcomes | Mesh-specific clip names or material implementation |
| Runtime Adapter | Coordinate conversion, semantic clip mapping, crossfades, playback rate, turn deformation, root-motion handling, support deformation | Choosing targets or deciding whether a gameplay event occurred |
| Workbench | Runtime-equivalent inspection, bounded candidate editing, comparison, evidence display, approval-intent capture | Silent promotion or mutation of live saves |
| Promotion service | Exact-hash checks, serialized registry update, immutable copy, predecessor and rollback receipt | Creative editing or subjective approval |

**Recommended:** Treat this table as an interface contract, not a team convention. Encode the boundary in types and tests. A better-looking mesh MUST NOT change its species identity, hit points, locomotion family, habitat, or world-scale meaning simply because an artist authored different metadata.

### 1.2 Typicality is broader than resemblance

An asset is typical when its most important characteristics fall inside declared ranges:

1. Silhouette and body volume.
2. Relative and absolute scale.
3. Neutral posture and characteristic stance.
4. Appendage placement and range.
5. Material and marking placement.
6. Local deformation and cadence.
7. The way animation responds to realized motion and committed actions.
8. Habitat contact and support where presentation must conform to the environment.

Photorealism is optional. Recognizable proportions, characteristic motion, consistent scale, and correct causal response are not.

## 2. The complete reference-to-runtime lifecycle

Every asset MUST pass the same named stages. Teams MAY automate several stages in one command, but MUST keep their evidence and state transitions distinct.

| Stage | Required input | Produced artifact | Exit gate |
|---|---|---|---|
| `E0_EVIDENCE_READY` | Stable content identity and permitted reference sources | Evidence Profile, measurements, view confidence, rights notes, visual debt | Evidence readiness review |
| `C0_CANDIDATE_AUTHORED` | Evidence digest, body-plan contract, declarative source specification, pinned tools | Source scene, meshes, materials, rig, clips, previews, runtime export | Deterministic author command finishes |
| `C1_SOURCE_VALID` | Authored source | Source-validation receipt | Geometry, topology, scale, rig, deformation, and safety rules pass |
| `C2_RUNTIME_EQUIVALENT` | Exported runtime bundle | Fresh-import runtime receipt | Runtime inventory and sampled poses agree with source |
| `C3_DETERMINISTIC` | Complete source, scripts, and pinned toolchain | Scratch-rebuild comparison and candidate digest | Required build products reproduce |
| `C4_WORKBENCH_INSPECTED` | Immutable candidate and references | Inspection receipt with canonical views, clips, statistics, and known debt | Human completes the fixed journey |
| `A1_VISUAL_APPROVED` | Exact candidate digest and inspection receipt | Approval or rejection record | Explicit human decision tied to exact hashes |
| `P1_RUNTIME_PROMOTED` | Approved digest and current registry base | Immutable runtime bundle and atomic promotion receipt | Registry and rollback tests pass |
| `W1_IN_WORLD_PROVEN` | Promoted asset, content profile, behavior policy | Player-runtime proof | Scale, lighting, motion, interaction, lifecycle, and budget checks pass |
| `R1_RELEASE_INCLUDED` | Accepted compiled product digest | Release association | Platform build contains the same promoted bytes |

The shortest honest audience journey is:

```text
open workbench at an immutable candidate
  -> compare side, front, top, and three-quarter views
  -> inspect true scale, wireframe, skeleton, clips, and transitions
  -> record approval or rejection against the candidate digest
```

That journey makes the asset inspectable early. It does not make the asset finished. Runtime promotion, in-world proof, performance validation, and release inclusion continue afterward.

### 2.1 Non-negotiable transition rules

1. Geometry, rig, texture, clip, reference scale, origin, coordinate, or evidence changes MUST create a new candidate digest.
2. Candidate and runtime directories MUST be immutable.
3. Rejected and superseded candidates MUST remain recorded.
4. Candidate validation MUST NOT imply visual approval.
5. Visual approval MUST NOT imply runtime promotion.
6. Promotion MUST require validation and visual approval for the same digest.
7. Shared registry writes MUST be serialized.
8. Runtime failure MUST produce a new candidate or adapter revision. It MUST NOT mutate an approved runtime bundle in place.
9. One representative asset MUST prove a body-plan template through the entire lifecycle before catalog fan-out.
10. Any shared body-plan, validator, exporter, or adapter change MUST invalidate affected candidate receipts and trigger regeneration or revalidation.

## 3. Reference collection, rights, and provenance

### 3.1 The reference packet

Before modeling begins, each subject MUST have a versioned reference packet. The packet MUST contain:

- Stable content, subject, species, archetype, or variant IDs.
- Display and scientific or canonical names.
- Category, life stage, sex, morph, costume, damage state, or growth state when relevant.
- Real or canonical reference size and measurement kind.
- Side, front, top, and three-quarter evidence where available.
- Source URL or durable source identifier, access date, evidence class, and permitted use.
- License or permission notes for every source.
- Named landmarks and measurement baselines.
- Confidence for each view and measurement.
- Explicit inference notes where direct evidence is missing.
- Contradictions between sources and the selected disposition.
- Known visual debt and intentional simplifications.
- A digest covering the packet.

References SHOULD be used to measure and compare. Source pixels MUST NOT be copied, redistributed, traced, or baked into textures unless the recorded rights permit that exact use.

For invented subjects, replace biological provenance with an approved art and world bible. The packet still needs canonical scale, view targets, landmark definitions, and rights for every incorporated source.

### 3.2 Multi-view confidence

The packet MUST record view confidence independently. A strong side photograph does not prove body depth. A front image does not prove tail taper. If top or front evidence is unavailable, the packet MUST identify the selected body-plan prior and label the reconstruction inferred.

**Observed:** Pocket Aquarium source packets already record URLs, access dates, evidence class, permitted use, licenses, reference-size meaning, provenance, and visual debt. Banggai Cardinalfish evidence explicitly distinguished strong lateral support from inferred top and front cross-sections. This is the correct honesty boundary even when the result later needs refinement.

**Recommended:** Add calibrated landmarks for every supported view and let both Blender validation and the workbench consume the same landmark JSON.

### 3.3 Reference normalization procedure

For each accepted reference view:

1. Confirm the life stage, sex, variant, pose, and lens limitations.
2. Establish one measurement baseline, such as total length, shoulder height, shell diameter, arm span, or colony width.
3. Normalize the view into subject coordinates without changing anatomy to fit the frame.
4. Mark anatomical landmarks rather than tracing every contour.
5. Record occluded or ambiguous regions.
6. Compare at least two sources when the visible form can vary materially.
7. Assign confidence to every target, not merely to the source as a whole.
8. Freeze the evidence digest before authoring a candidate.

## 4. Reconstruct morphology in three dimensions

### 4.1 Coordinate and scale contract

Every body plan MUST define:

- Source forward axis.
- Source up axis.
- Runtime forward axis.
- Runtime up axis.
- Unit system, preferably meters.
- Anatomical origin.
- Reference-size meaning.
- Neutral-pose bounds.
- Runtime-scale multiplier, which SHOULD remain `1` when source units are correct.

Scale MUST flow unchanged from evidence to source specification, source scene, candidate manifest, runtime registry, workbench ruler, world envelope, and in-world proof. Fit-to-frame inspection MUST never replace true-scale comparison.

**Observed:** Pocket Aquarium authors in meters, uses source forward `+X` and source up `+Z`, converts to runtime up `+Y`, preserves an anatomical origin, and normally validates reference size within 3 percent unless a source contract overrides that tolerance.

### 4.2 Silhouette targets

Side, front, and top profiles answer different questions:

| View | Primary questions |
|---|---|
| Side | Overall length, dorsal and ventral contour, head/body ratio, tail base, appendage anchors, posture |
| Front | Body depth, symmetry, chest or shoulder shape, eye plane, limb or fin cant, cross-section fullness |
| Top | Width distribution, taper, head and shoulder breadth, limb or fin sweep, tail alignment |
| Three-quarter | Volume continuity, landmark relationships, occluded intersections, perceived character |

A candidate MUST satisfy all supported profiles. It MUST NOT be approved because one flattering perspective looks convincing.

### 4.3 Morphology landmarks

Each body plan MUST name a small, stable landmark vocabulary. For a fish-like body it may include snout tip, eye center, gill or operculum edge, maximum dorsal point, maximum ventral point, caudal peduncle, tail root, fin origins, fin insertions, and mouth plane. A humanoid may instead use head top, chin, shoulders, elbows, wrists, pelvis, knees, ankles, and foot contacts.

Landmarks SHOULD be normalized to the reference baseline, then carried as machine-readable constraints. They SHOULD drive:

- Station or cage placement.
- Body cross-sections.
- Appendage anchors.
- Rig-joint positions.
- Collision-envelope anchors.
- Workbench overlays.
- Automated silhouette and delta reports.

Landmark tolerances MUST be evidence and body-plan specific. A single universal percentage is not sufficient for eyes, tail width, total size, and fin placement.

### 4.4 Body-plan reuse without generic anatomy

A Body Plan SHOULD provide:

- Coordinate, origin, unit, and naming conventions.
- Topology and deformation expectations.
- Rig vocabulary and semantic clip roles.
- Material-slot and attachment conventions.
- Validation hooks and safe deformation limits.
- Runtime adapter integration.

A species or archetype backend MUST provide:

- Evidence-specific body proportions and depth.
- Distinctive appendages and landmarks.
- Markings tied to anatomy.
- Typical stiffness, cadence, and posture.
- Variant-specific material and form changes.
- Known debt and inference notes.

A related subject MAY reuse a body-plan library. It MUST NOT be a palette swap when the target has a different silhouette, body volume, appendage system, neutral posture, or locomotor apparatus.

## 5. Blender and procedural authoring

### 5.1 Blender automation boundary

**Observed:** Pocket Aquarium uses checksum-pinned Blender 5.2.1 LTS, launched with factory startup and Python. Repository scripts author `.blend` sources, generate procedural materials and textures, create rigs and clips, export GLB, render proofs, validate source and runtime forms, and compare deterministic rebuilds. The relevant observed anchors are:

- [`realistic_light_transport/art/toolchain.json`](../../realistic_light_transport/art/toolchain.json)
- [`realistic_light_transport/art/README.md`](../../realistic_light_transport/art/README.md)
- [`realistic_light_transport/scripts/specimens/author_specimen.py`](../../realistic_light_transport/scripts/specimens/author_specimen.py)
- [`realistic_light_transport/scripts/specimens/build_catalog_asset.mjs`](../../realistic_light_transport/scripts/specimens/build_catalog_asset.mjs)
- [`realistic_light_transport/scripts/specimens/catalog/author.py`](../../realistic_light_transport/scripts/specimens/catalog/author.py)
- [`realistic_light_transport/scripts/specimens/catalog/validate.py`](../../realistic_light_transport/scripts/specimens/catalog/validate.py)

No accepted evidence shows that Pocket Aquarium used commercial photogrammetry, automatic multiview reconstruction, motion capture, or an AI mesh service. Do not attribute those methods to the observed project.

**Recommended:** Keep Blender for freeform topology, UV, material, rig, weight, and clip work. Use deterministic scripts for repeatable construction and validation. Use browser tools only for bounded semantic parameters whose effects can be serialized and rebuilt.

### 5.2 What SHOULD be procedural

Procedural authoring is most valuable when the parameters have anatomical or production meaning:

- Axial or height stations.
- Cross-section width and exponent.
- Snout, torso, peduncle, limb, branch, shell, or colony proportions.
- Appendage anchors and taper.
- Named material regions and marking masks.
- Bone positions and influence zones.
- Clip amplitudes, phase offsets, stiffness gradients, and cadence.
- Proof-camera positions.
- Validation thresholds.

Scripts SHOULD be deterministic for the same complete input set. Random variation MAY be used only through an explicit seed included in the candidate identity.

### 5.3 What SHOULD remain manual or DCC-native

Freeform corrections SHOULD remain in Blender when they require:

- Retopology that cannot be expressed as a stable semantic parameter.
- Sculptural plane changes around face, hands, fins, horns, folds, or joints.
- UV seam placement and distortion correction.
- Weight painting around difficult joints.
- Corrective shape keys.
- Material authoring that depends on layered artistic judgment.
- Repair of self-intersection or collapsed deformation.

The final source MUST still be validated and rebuildable. A manual step MUST be represented by a versioned `.blend` source or an explicit source artifact, not by an undocumented edit to exported runtime bytes.

### 5.4 Optional generative tools

**Recommended:** AI-generated mesh, texture, rig, motion, or code tools MAY create candidate hypotheses. They receive no special trust. Their outputs MUST have recorded provenance, usage rights, immutable source inputs where allowed, and the same source, runtime, determinism, visual, performance, approval, and promotion gates. If a tool cannot support reproducibility or rights disclosure, its output MUST NOT enter the promotable path.

## 6. Geometry, topology, UVs, and materials

### 6.1 Geometry and topology contract

Source validation MUST check at least:

- Finite vertex, normal, tangent, UV, and weight data.
- Correct root transform and neutral pose.
- Real-scale bounds.
- Required symmetry and allowed asymmetry.
- Manifold, consistently oriented closed volumes where the surface is intended to be closed.
- Intentional thickness and attachment boundaries for membranes and sheets.
- No body-part self-intersection outside declared attachment zones.
- No detached eyes, teeth, fins, limbs, branches, polyps, accessories, or sockets.
- Adequate deformation loops around joints.
- Body-zone and appendage clearances across sampled clips.
- Triangle and vertex counts within the selected budget profile.

Topology MUST support the expected deformation. It does not need to be uniformly dense. Areas of high curvature or repeated bending SHOULD receive enough resolution to preserve volume. Rigid or distant regions SHOULD remain cheaper.

### 6.2 UV and texture contract

Every texture channel MUST identify its source and color-space meaning. The material manifest SHOULD include:

- Base color or albedo.
- Roughness.
- Normal or bump.
- Metallic only where materially appropriate.
- Emissive only where the subject or art direction requires it.
- Opacity and transmission policy for fins, leaves, membranes, glass, particles, and effects.
- Texture dimensions, format, byte size, mip policy, and compression state.

Procedural textures MUST be derived from versioned parameters and generator code. Hand-authored textures MUST have a versioned source file and rights record. Reference images MUST NOT be treated as texture sources unless the recorded license permits it.

Markings MUST follow anatomy. Stripes, spots, masks, scars, scales, clothing panels, and runes SHOULD be anchored to semantic regions or stable UVs. Stretching a correct pattern over an incorrect body is not acceptable morphology.

### 6.3 Material behavior versus gameplay state

The asset MAY expose material inputs such as `condition`, `growth`, `stress`, `wetness`, `damage`, `corallineCoverage`, or `spellCharge`. The World Model MUST own the values. The Runtime Adapter maps them to bounded presentation changes.

Material animation MUST NOT independently decide growth, healing, disease, damage, or resource consumption.

## 7. Rigging and deformation

### 7.1 Rig contract

Each Body Plan MUST define:

- Root and anatomical reference bones.
- Deform-bone names and hierarchy.
- Required and optional semantic bones.
- Neutral transforms.
- Maximum bone count and influence count.
- Weight normalization and orphan-vertex rules.
- Safe bend, twist, stretch, and compression limits.
- Attachment sockets and support probes.
- Corrective blend-shape or shape-key policy.

**Observed:** Pocket Aquarium uses compact declarative rigs, explicit weights, and a 32-deform-bone cap. Fish rigs use an axial chain plus appendage, jaw, gill, and species-specific controls. The source validator samples animation safety and deformation clearance.

### 7.2 Local deformation only

Default locomotion clips MUST be in place. They MAY translate or rotate internal bones, but MUST NOT move the asset root through the world. If a project elects to use root motion, the deterministic spatial solver MUST explicitly consume, constrain, and validate it. Renderer-only root motion is forbidden for consequential navigation.

Local deformation SHOULD communicate:

- Realized forward speed.
- Acceleration or burst effort.
- Signed turn rate.
- Idle or rest state.
- Committed action events.
- Support-surface normals and conformance.
- Environmental force or flow when that influence is presentation-only.

### 7.3 Flexible and surface-conforming bodies

An authored clip cannot know the current surface. Flexible creatures, roots, tentacles, capes, tails, vines, or cables MAY therefore use runtime secondary deformation. The Runtime Adapter SHOULD consume support points and normals from deterministic spatial services, then deform within asset-declared limits.

Conformance MUST NOT alter the authoritative contact result. It only presents the result. Multi-point support probes SHOULD be used when one origin point cannot prevent visible floating or intersection.

**Observed recovery:** Pocket Aquarium added runtime arm conformance for Blue Linckia so its body and arms follow rock and sand contours. That behavior belongs at the adapter boundary because the asset source cannot predict the current aquascape.

## 8. Clips, transitions, and motion alignment

### 8.1 Semantic clip roles

Gameplay MUST request semantic roles, not asset-specific clip names. A minimal animated asset SHOULD expose:

- `idle`
- `locomotion`
- `response`

Body plans MAY add roles such as `turn`, `sharp_turn`, `burst`, `feed`, `perch`, `walk`, `crawl`, `clean`, `retract`, `attack`, `cast`, `hit`, `die`, or `interact`.

The runtime manifest maps semantic roles to authored clips:

```ts
interface SemanticClipBinding {
  role: string
  clip: string
  loop: boolean
  durationSeconds: number
  neutralStart: boolean
  neutralEnd: boolean
  maximumPlaybackRate: number
}
```

Looping clips MUST close without visible pose or derivative pops. One-shot response clips SHOULD begin and end at a declared neutral or transition-compatible pose.

### 8.2 Clip construction

**Observed:** Pocket Aquarium clip authoring uses declarative rotation, location, scale, and shape-key channels. Loop clips bake integer-frequency waveforms across frames. Response clips use neutral-start and neutral-end envelopes. Semantic roles let a fish map locomotion to `swim`, a shrimp to `walk`, and coral to `sway` without pretending all residents share one motion.

**Recommended:** Author cadence and stiffness by subject, not merely by category. Related body plans MAY reuse channel generators, but MUST provide subject-specific amplitude, phase, stiffness, rest posture, and response timing.

### 8.3 Transition contract

Every pair of clips that can follow one another in gameplay MUST declare one of:

- Direct crossfade with duration bounds.
- Neutral-pose bridge.
- Phase-matched locomotion transition.
- State-locked transition that cannot be interrupted.
- Additive overlay over the current base locomotion.

Transition validation SHOULD sample the start, midpoint, end, and interrupted case. It MUST check pose discontinuity, scale discontinuity, root displacement, attachment drift, and unintended intersections.

### 8.4 Realized motion drives presentation

Use the presentation signal defined by the simulation chapter:

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

The ordering MUST be:

```text
behavior chooses an intent
  -> physics and constraints resolve a safe velocity and pose
  -> kinematics integrate the realized movement
  -> the Runtime Adapter selects and parameterizes local clips
  -> the renderer interpolates and displays the result
```

Clip rate MUST follow realized forward speed. Turn blend MUST follow signed realized yaw rate. Action clips MUST follow committed Domain Events. Mesh facing MUST follow realized travel within body-plan turn limits.

This prevents moonwalking, sideways skating, hyperactive tails on slow movement, frozen tails during bursts, and a turning animation that disagrees with the path.

**Observed recovery:** Pocket Aquarium stripped rig-root translation from cloned runtime clips, synchronized fish pose with actual travel, synchronized animation cadence with path speed, and applied bounded nonaccumulating runtime turn deformation. Tests preserve the original source clip and verify only the runtime clone is made in place.

## 9. Artifact, naming, and version contracts

### 9.1 Stable names

Stable catalog IDs and schema IDs MUST be lowercase ASCII snake case. Candidate directory IDs SHOULD be lowercase kebab case so a producer label and revision remain legible. Asset keys MUST join stable subject and variant IDs with a dot. Display names MUST remain separate. Use:

```text
subjectId        ocellaris
variantId        black_storm
bodyPlanId       perciform_fish
candidateId      fable-v3
assetKey         ocellaris.black_storm
assetVersion     2.1.0
bundleVersion    4
```

Clip names MAY be DCC-specific, but semantic roles MUST be stable. Bones, material slots, sockets, collision metadata, and morph targets SHOULD use a body-plan prefix or stable semantic vocabulary.

### 9.2 Recommended immutable directory layout

The braces below denote required path tokens, not unfinished values:

```text
art/specimens/{subjectId}/
  asset.source.json
  source-references.json
  candidates/{candidateId}/
    source.blend
    lod0.glb
    lod1.glb
    lod2.glb
    textures/
    renders/
      side.png
      front.png
      top.png
      three-quarter.png
      motion-phases.png
    geometry-digest.json
    validation.contract.json
    validation-source.json
    validation-runtime.json
    determinism.json
    candidate.manifest.json
    validation-receipt.json
    build-receipt.json
    build.log

art/specimens/visual-approval.v2.json
src/assets/specimens/runtime-acceptance.v2.json
src/assets/specimens/{subjectId}/{variantId}/v{bundleVersion}/
  lod0.glb
  lod1.glb
  lod2.glb
```

An asset MAY omit an LOD only when its budget profile explicitly permits the omission. The manifest MUST state why.

**Observed:** The current Pocket Aquarium candidate layout includes `source.blend`, `lod1.glb`, procedural textures, preview renders, geometry digest, validation contract, source and runtime validation, determinism report, candidate manifest, receipts, and logs. Runtime bundles are versioned and hash-bound. The observed catalog is LOD1-only, so the three-LOD layout above is a recommendation, not a description of current assets.

### 9.3 Candidate manifest

Every candidate manifest MUST include:

```ts
interface CandidateManifest {
  schemaVersion: string
  candidateId: string
  candidateDigest: string
  subjectId: string
  variantId?: string
  assetKey: string
  assetVersion: string
  bodyPlanId: string
  category: string
  evidenceDigest: string
  sourceSpecSha256: string
  referencePacketSha256: string
  toolchain: {
    blenderVersion: string
    blenderSha256: string
    exporter: string
    builderSha256: string
    bodyPlanSha256: string
    validatorSha256: string
  }
  coordinates: {
    sourceForward: string
    sourceUp: string
    runtimeForward: string
    runtimeUp: string
    units: 'meters'
    origin: string
  }
  referenceSize: { meters: number; kind: string }
  lods: Array<{
    id: string
    path: string
    sha256: string
    bytes: number
    triangles: number
    vertices: number
  }>
  statistics: {
    materials: number
    textures: number
    textureBytes: number
    bones: number
    skinnedVertices: number
    morphTargets: number
    nodes: number
  }
  clips: SemanticClipBinding[]
  candidateStatus: CandidateStatus
  visualApprovalStatus: VisualApprovalStatus
  runtimePromotionStatus: RuntimePromotionStatus
  gates: {
    source: ValidationGateRef
    runtime: ValidationGateRef
    determinism: ValidationGateRef
  }
  visualDebt: string[]
  predecessorCandidateDigest?: string
}

interface ValidationGateRef {
  status: 'not_run' | 'passed' | 'failed' | 'blocked'
  receiptPath?: string
  evidenceRevision: string
}
```

The canonical `CandidateStatus` and separate approval and promotion statuses are defined in [Foundation and Architecture](./FOUNDATION_AND_ARCHITECTURE.md). Do not collapse them into a bare `accepted` field.

### 9.4 Runtime manifest

Each promoted runtime entry MUST identify:

- Stable asset key, subject, variant, category, and body plan.
- Immutable asset and bundle versions.
- Exact source candidate and candidate digest.
- Exact runtime paths and SHA-256 values for every LOD.
- Real reference scale and coordinate contract.
- Semantic clips, loop flags, durations, and transitions.
- Attachment, collision-envelope, and conformance metadata.
- Visual Approval record ID.
- Runtime Promotion receipt ID.
- One default per subject.
- Predecessor entry for rollback.

Runtime paths MUST point only to promoted bundle storage. Candidate paths MUST never appear in the runtime registry.

## 10. Source, runtime, and determinism gates

### 10.1 Source gate

The source validator MUST run in a clean, pinned DCC process and verify:

1. Root transform, axes, origin, units, and reference bounds.
2. Finite geometry and accessor-ready data.
3. Topology, winding, manifold intent, thickness, and required symmetry.
4. Body-zone separation and attachment-zone rules.
5. Skin weights, bone inventory, hierarchy, and deform limits.
6. Required movement of declared bones or shape keys.
7. Clip duration, loop closure, neutral response boundaries, and sampled deformation.
8. Head-tail, limb-body, appendage-body, and appendage-appendage clearances.
9. Maximum axial curvature, joint limits, volume collapse, and inversion.
10. Candidate performance statistics against its budget profile.

### 10.2 Runtime-equivalence gate

The runtime validator MUST inspect the actual exported asset in a fresh process. It MUST verify:

- Bundle structure and all accessor ranges.
- Required meshes, nodes, skins, textures, and embedded resources.
- Names and semantic clip bindings.
- Valid weights and bounds.
- Required clips, durations, loops, and channels.
- Source and runtime pose parity at canonical phases.
- Rest-bound and loop-seam parity.
- Coordinate and reference-scale parity.
- Root-motion policy.

Testing the `.blend` alone is insufficient. The player loads exported runtime bytes, so the exported bytes MUST be independently examined.

### 10.3 Determinism gate

A promotable candidate MUST rebuild in a scratch directory using the same source packet, body plan, scripts, seed, and pinned toolchain. Compare at least:

- Source-spec and reference-packet hashes.
- Geometry digest.
- Rig digest.
- Texture hashes.
- Clip inventory and sampled animation digest.
- Builder, validator, body-plan, backend, and toolchain hashes.
- Exported bundle hash when the exporter is deterministic at the byte level.

If byte-identical export is not possible, the contract MUST name the nondeterministic container metadata and compare normalized semantic digests. The exception MUST be explicit and MUST NOT weaken geometry, rig, texture, or clip equivalence.

### 10.4 Gate receipt

Every gate receipt MUST include:

- Candidate digest and evidence digest.
- Tool and validator versions.
- Command or deterministic invocation identity.
- Start and completion time.
- Pass, fail, or blocked status.
- Named assertions and observed values.
- Artifact hashes.
- Budget profile and measurements.
- Exact failure paths.
- Whether a later change invalidates the receipt.

## 11. The workbench

### 11.1 Required inspection controls

The workbench MUST load assets through the same loader and Runtime Adapter used by the player. It MUST provide:

- Category, subject, variant, candidate, promoted version, and predecessor selectors.
- Orbit, pan, and zoom.
- Orthographic side, front, and top presets.
- Three-quarter, perspective, and turntable views.
- Fit-to-frame and true shared-scale modes.
- A real-unit ruler and reference-size annotation.
- Wireframe, skeleton, bone names, weight influence, material channels, collision envelope, attachment points, and support probes.
- Clip role selector, playback speed, pause, phase scrub, loop seam view, transition preview, and signed turn preview.
- Reference overlays with independent opacity and per-view confidence.
- Landmark overlays and numeric deltas.
- Candidate versus promoted comparison at identical camera, scale, phase, and lighting.
- Statistics for bytes, triangles, vertices, materials, bones, skinned vertices, morph targets, textures, draw calls, and budget class.
- Candidate digest, evidence digest, toolchain, gate receipts, visual debt, approval status, promotion status, and predecessor.
- Separate `Save Candidate`, `Accept` or `Reject`, `Promote`, and `Rollback` actions, with their distinct prerequisites and permissions visible.

The workbench SHOULD permit saving bounded semantic changes as a new candidate revision. It MUST NOT overwrite an existing candidate or promoted source.

### 11.2 Transactional editing

All workbench editing MUST follow:

```text
begin
  -> preview
  -> validate
  -> freeze
  -> save new candidate or cancel
```

Semantic controls MAY include body depth, snout length, peduncle width, shoulder breadth, fin or limb anchors, turning curvature, tail amplitude, gait cadence, growth form, and material-region parameters. Each control MUST map to a versioned source-spec patch and a deterministic rebuild.

Arbitrary browser vertex editing SHOULD NOT be the default. It bypasses anatomical semantics, topology intent, and reproducibility. Freeform correction belongs in Blender.

**Observed:** Pocket Aquarium's active workbench already provides catalog and candidate selection, true-size and fit scale, camera presets, perspective and orthographic modes, turntable, orbit, zoom, pan, clip selection, speed and phase controls, pause, turn preview, wireframe, skeleton, generated renders, and technical statistics. See [`SpecimenWorkbench.tsx`](../../realistic_light_transport/src/workbench/SpecimenWorkbench.tsx) and [`WorkbenchSpecimen.tsx`](../../realistic_light_transport/src/workbench/WorkbenchSpecimen.tsx).

**Observed gap:** Morphology and profile editor components exist in source, but the accepted evidence found no active import from the workbench. The strongest accept and promotion service is Ocellaris-specific. Therefore catalog-wide in-place semantic editing and generic atomic acceptance are recommendations until active-route and transaction tests prove them.

### 11.3 Candidate comparison protocol

Reviewers MUST compare candidate and predecessor using identical:

- Camera transform and projection.
- True or normalized scale mode.
- Lighting and background.
- Clip role and phase.
- Playback speed.
- Reference overlays.
- Runtime Adapter settings.

The review SHOULD begin with the declared defect, then inspect other views for collateral damage. A reviewer MUST record known remaining debt rather than accepting by silence.

## 12. Human approval, promotion, and rollback

### 12.1 Visual approval record

An approval record MUST contain:

- Subject and variant.
- Candidate ID and digest.
- GLB or LOD hashes.
- Geometry digest.
- Evidence digest.
- Reviewer identity or accountable approval role.
- Review time.
- Exact workbench journey, views, scale, clips, and reference revision.
- Approval or rejection statement.
- Known visual debt accepted for this revision.
- Superseded or excluded candidates.

The record MUST use `VisualApprovalStatus`. It MUST NOT set runtime defaults.

### 12.2 Atomic promotion

**Recommended:** Generalize promotion into one subject-agnostic transaction:

1. Require an exact typed confirmation containing subject and candidate digest.
2. Re-read the candidate and approval records.
3. Verify every required gate applies to the same digest.
4. Verify the expected current registry base or predecessor hash.
5. Acquire an exclusive promotion lock.
6. Copy exact accepted bytes to a new immutable runtime directory.
7. Write the new registry to a temporary file.
8. Validate default uniqueness, paths, hashes, clip bindings, and acceptance linkage.
9. Atomically replace the registry.
10. Run runtime smoke and catalog-parity tests.
11. Emit a promotion receipt with predecessor and rollback action.
12. On failure, restore the previous registry and remove only the unreferenced new bundle.

Promotion MUST be compare-and-swap, serialized, and rollback capable. It MUST fail if the current registry changed after review began.

**Observed:** Pocket Aquarium separates candidate receipts, [`user-acceptance.v1.json`](../../realistic_light_transport/art/specimens/user-acceptance.v1.json), and [`runtime-acceptance.v1.json`](../../realistic_light_transport/src/assets/specimens/runtime-acceptance.v1.json). The Ocellaris promotion path implements an exact confirmation, lock, rollback copy, validation, and restoration. Generic catalog promotion is test-guarded repository work, not yet the same generic atomic service.

### 12.3 In-world proof

After promotion, the asset MUST be tested in the canonical player loader, not only the workbench. Verify:

- Correct real and relative scale.
- Correct lighting, transparency, shadows, and material response.
- Correct LOD selection and transition.
- Correct collision or support metadata.
- Correct semantic clip selection and crossfade.
- Motion-vector alignment and turn response.
- Applicable feeding, cleaning, combat, casting, growth, damage, or other response events.
- Lifecycle-driven material or shape changes.
- Selection, inspection, accessibility, and input behavior.
- Load, memory, frame, thermal, and battery budget on target device classes.

The workbench and player receipts answer different questions. Both are required for a visible, animated asset.

## 13. LOD and performance budgets

### 13.1 Budget before fan-out

Every project MUST establish a target device scene budget before mass asset production. Each asset receives a named `budgetClass`, but the player scene remains the real budget owner. Per-asset success does not guarantee that thirty residents, terrain, particles, UI, and postprocessing fit together.

The budget contract MUST record numerical limits for:

- Runtime bundle bytes per LOD.
- Decoded texture memory and maximum texture dimension.
- Triangles and vertices per LOD.
- Draw calls and material slots.
- Bones, skin influences, and skinned vertices.
- Morph targets and active morph channels.
- Shader variants.
- Load and decode time.
- Steady and peak process memory.
- CPU animation time.
- GPU frame time at representative screen resolution.
- LOD switch distance, projected size, and hysteresis.
- Maximum simultaneous instances for the class.
- Thermal and battery behavior during a declared soak duration.

These limits MUST come from the canonical scene on the lowest supported device class. The probe MUST test candidate threshold sets and choose the cheapest set that preserves silhouette, motion readability, and interaction clarity.

### 13.2 Recommended LOD roles

| Role | Use | Preservation priority |
|---|---|---|
| `lod0` | Workbench, close inspection, hero framing | Landmark shape, material detail, full local deformation |
| `lod1` | Normal gameplay range | Silhouette, major markings, semantic clips, bounded rig |
| `lod2` | Far or small projected size | Overall silhouette, color identity, minimal safe deformation |

LOD reduction MAY use manual retopology, controlled decimation, texture atlasing, Meshopt or Draco geometry compression, and KTX2 or Basis textures only after runtime support and material parity are proven. Compression MUST be validated on the actual loader and target devices.

LOD transitions MUST NOT change gameplay envelope, identity, world pose, animation phase, or event state. Crossfade, hysteresis, or stable switching SHOULD prevent visible popping.

### 13.3 Current Pocket Aquarium budget truth

**Observed:** The candidate validator enforces source-specific triangle budgets, real-scale tolerance, finite data, and a 32-deform-bone cap. The runtime catalog contains only `lod1.glb` payloads, and accepted evidence found individual payloads above 8 MB.

**Recommended:** Do not publish arbitrary global byte or frame thresholds in this playbook. Establish Pocket Aquarium's exact GLB, texture-memory, draw-call, skinning, load-time, thermal, and steady-frame limits through a low-to-mid Android scene probe. Record the chosen numerical results in the project budget profile, then rebuild affected assets into high, gameplay, and far levels.

### 13.4 Budget profile schema

```ts
interface AssetBudgetProfile {
  id: string
  targetDeviceClass: string
  viewportClass: string
  sceneFixtureId: string
  maximumVisibleInstances: number
  maximumRuntimeBytes: number
  maximumDecodedTextureBytes: number
  maximumTriangles: number
  maximumDrawCalls: number
  maximumBones: number
  maximumSkinnedVertices: number
  maximumCpuAnimationMilliseconds: number
  maximumGpuFrameMilliseconds: number
  maximumLoadMilliseconds: number
  maximumPeakResidentBytes: number
  soakMinutes: number
  measurementReceipt: string
}
```

The schema is normative. Its project values MUST be revision-bound measurements, not copied from another game.

## 14. Efficient parallel asset production

### 14.1 Freeze shared contracts first

Parallel generation begins only after one representative gold asset completes `W1_IN_WORLD_PROVEN`. Before fan-out, freeze:

- Body-plan coordinate, topology, rig, and naming contracts.
- Semantic clip roles and Runtime Adapter inputs.
- Reference packet schema.
- Candidate directory and manifest schemas.
- Source, runtime, determinism, and budget validators.
- Workbench comparison journey.
- Approval and promotion record schemas.

If a shared contract changes, pause affected production, serialize the change, and invalidate dependent receipts.

### 14.2 Split by morphology and locomotion family

Create asset lanes around genuine shared mechanics:

| Family | Shared mechanics | Subject-specific evidence that remains mandatory |
|---|---|---|
| Axial swimmer or flying creature | Body loft, axial rig, paired appendages, turn deformation | Head and body proportions, depth, fin or wing plan, markings, stiffness, cadence |
| Long flexible body | Capsule-chain alignment, distributed spine, early turn deformation | Cross-section, taper, bend gradient, appendages, minimum curve |
| Decapod or multi-limb crawler | Limb hierarchy, grounded gait, antenna or appendage channels | Segment proportions, claw or hand form, gait timing, station actions |
| Gastropod or slow crawler | Shell/body split, support attachment, slow surface motion | Shell profile, foot, tentacles, texture, speed |
| Flexible radial body | Central body, radial arms, support probes | Arm count, taper, texture, conformance limits |
| Rooted coral, plant, or vegetation | Attachment, branch or blade growth, flow response | Growth form, polyp or leaf layout, color variants, stiffness, lifecycle visuals |
| Humanoid or character | Biped hierarchy, hand/weapon sockets, locomotion roles | Silhouette, costume, face, proportions, action repertoire, style bible |
| Quadruped or creature | Spine and limb vocabulary, gait roles | Limb ratios, paws/hooves, neck/tail form, gait cadence |

Family sharing MUST reduce repeated engineering, not erase subject identity.

### 14.3 Ownership rules

Each parallel lane MUST have exclusive ownership of:

- One subject's reference packet.
- One subject or variant source specification.
- One subject-specific backend when required.
- One candidate directory.
- One lane receipt.

Parallel lanes MUST NOT edit:

- Shared body-plan libraries.
- Shared validators.
- Runtime Adapter contracts.
- Acceptance registry.
- Runtime registry.
- Promotion service.

Shared changes go through one serialized integration owner. Promotions are serialized because default selection and registry state are exclusive-write surfaces.

### 14.4 Parallel stage plan

```text
one gold body-plan asset proves the lifecycle
  -> freeze interfaces and golden receipts
  -> fan out independent evidence and candidate lanes by subject
  -> run source/runtime/determinism gates per lane
  -> batch human comparison by family and true scale
  -> record approval separately for every candidate digest
  -> serialize promotion transactions
  -> run one integrated scene and device budget gate
```

A batch MAY share tool installation and caches. It MUST NOT share writable candidate directories.

### 14.5 Memory-safe scheduling

**Observed:** Pocket Aquarium's catalog builder supports selected assets and bounded parallel jobs, with a ceiling of six. Historical development exceeded roughly 50 GB RAM when Blender, browser, build, and native workloads overlapped.

**Recommended:** Start with two Blender workers until peak resident memory is measured. Allow two to four only when the machine remains inside its declared budget. Treat six as a tooling ceiling, not a default. Run catalog-wide builds, proof rendering, browser E2E, and native builds sequentially when memory is constrained.

Fast diagnostic modes MAY skip renders or operate on selected stages. A promotable candidate MUST rerun the complete author, source validation, export, runtime validation, determinism, receipt, workbench, and promotion sequence.

## 15. Regression quality assurance

### 15.1 Automated regression set

Every promoted asset SHOULD have:

- Manifest and schema validation.
- Content-to-registry identity parity.
- Exact candidate and runtime hashes.
- One-default-per-subject validation.
- Excluded and superseded candidate rejection.
- Coordinate, origin, scale, and reference-bound tests.
- Required mesh, material, skin, bone, socket, and clip inventory tests.
- Root-motion removal and source immutability tests.
- Loop-seam and transition tests.
- Turn deformation symmetry, clamping, and nonaccumulation tests.
- Landmark and silhouette comparison at canonical views.
- Canonical render comparison for materials and deformation.
- Budget tests at each LOD.
- Runtime loader and in-world smoke tests.
- Device scene and soak tests for release candidates.

Image differences MUST be interpreted with body-plan thresholds and human review. A render diff can identify change. It cannot decide that a changed face, fish profile, robe silhouette, or coral form is good.

### 15.2 Human regression set

The human journey MUST inspect:

1. Side, front, top, and three-quarter views.
2. True shared scale against related subjects.
3. Wireframe and skeleton.
4. Every semantic clip at normal and reduced speed.
5. Loop seams and transitions.
6. Signed left and right turn previews.
7. Reference and landmark overlays.
8. Candidate and predecessor at identical settings.
9. In-world scale, lighting, motion, response, and lifecycle state.
10. The target device presentation when the asset can dominate memory or frame cost.

Approval MUST identify the exact candidate digest and remaining debt.

### 15.3 The correction loop

Use this exact loop:

```text
observed error
  | owning contract or stage
  | smallest change
  | affected restart or rebuild
  | identical workbench or player retry
  | retry result: advanced, same error, new error, or passed
  | durable regression guard
```

Examples of one-owner corrections include adjusting a morphology station, moving one fin anchor, correcting a weight region, reducing one bend amplitude, changing a transition envelope, or repairing one runtime mapping. Broaden only when two grounded changes leave the same failure or the evidence identifies a cross-boundary cause.

### 15.4 Pocket Aquarium failures that became contracts

**Observed failure:** Several structurally valid candidates were anatomically or visually unacceptable, including superseded Banggai Cardinalfish and coral strategies.

**Observed recovery:** Failed candidates remained recorded, new immutable candidates were compared in fixed workbench views, and promoted replacements preserved stable runtime subject identity.

**Observed failure:** Generic motion produced broken-looking spines, sideways travel, cadence mismatch, and turns that disagreed with world paths.

**Observed recovery:** Root translation was stripped from runtime clip clones, pose followed realized travel, cadence followed actual speed, and turn deformation became bounded and nonaccumulating.

These histories establish why structural validation, motion alignment, and human approval are independent gates.

## 16. Asset definition of done

An asset is done only after promotion and in-world proof. A good render, a valid `.blend`, a successful export, or a green candidate build is not completion.

### Identity and evidence

- [ ] Stable subject, variant, display, scientific or canonical, category, and Body Plan IDs match the content catalog.
- [ ] Life stage, sex, morph, costume, damage, and growth assumptions are explicit where relevant.
- [ ] Reference size and measurement kind use the project unit contract.
- [ ] Every source has a durable identifier, access date, evidence class, license or permission, and allowed use.
- [ ] Side, front, top, and three-quarter confidence is recorded, with inferred views labeled.
- [ ] Morphology landmarks, known contradictions, visual debt, and gameplay simplifications are documented.
- [ ] Evidence Profile has an immutable digest.

### Morphology and materials

- [ ] Side silhouette, front depth, top width, landmark relationships, and distinctive anatomy satisfy declared tolerances.
- [ ] Source/runtime axes, origin, units, neutral pose, and real-scale bounds conform to the Body Plan.
- [ ] Topology deforms without inversion, collapse, detachment, or unintended self-intersection.
- [ ] Closed surfaces are manifold and thin surfaces use intentional thickness and attachment rules.
- [ ] Eyes, mouth, face, fins, limbs, hands, claws, shell, arms, branches, leaves, polyps, clothing, sockets, and accessories are correctly attached when applicable.
- [ ] UVs and materials preserve anatomy and remain inside texture and draw-call budgets.
- [ ] Every texture and material source has provenance and rights.
- [ ] Markings and surface details follow the intended form rather than disguising generic geometry.

### Rig and animation

- [ ] Rig hierarchy, required bones, influence counts, normalized weights, and neutral transforms pass the Body Plan contract.
- [ ] Every declared bone, shape key, socket, and support probe has a valid role.
- [ ] Required semantic roles resolve to valid clips.
- [ ] Loops close cleanly and responses obey declared transition poses.
- [ ] Local motion expresses subject-specific posture, cadence, stiffness, and appendage contribution.
- [ ] Turn response bends plausibly, mirrors correctly, clamps safely, and does not accumulate.
- [ ] Default authored locomotion is in place; root-motion exceptions are explicitly consumed by the spatial solver.
- [ ] Playback rate and blend ranges match realized game speed without skating or frantic motion.
- [ ] Environment conformance stays within asset limits and follows authoritative support data.

### Candidate and automated validation

- [ ] Pinned, checksum-verified tools rebuild the source from a clean environment.
- [ ] Source, runtime, and determinism gates pass for the same digest.
- [ ] Source scene, runtime LODs, textures, renders, manifests, validation reports, digests, receipts, and logs are complete.
- [ ] Candidate digest covers evidence, specification, body plan, backend, builders, validators, toolchain, geometry, rig, textures, clips, and runtime output.
- [ ] Candidate remains unapproved and unpromoted until separate actions occur.
- [ ] The selected asset budget profile passes at every LOD.

### Workbench and human approval

- [ ] Candidate loads through the player-equivalent loader and Runtime Adapter.
- [ ] Reviewer inspects canonical views at fit and true shared scale.
- [ ] Reviewer plays, slows, pauses, and scrubs every semantic clip and transition.
- [ ] Wireframe and skeleton reveal no broken spine, collapsed joint, detached appendage, hidden intersection, or invalid weights.
- [ ] Reference overlays and landmark deltas are reviewed according to confidence.
- [ ] Candidate is compared against its predecessor at identical settings.
- [ ] Approval or rejection is explicit and bound to exact hashes.
- [ ] Rejected and superseded candidates remain excluded and traceable.

### Promotion, player, and release

- [ ] Exact approved bytes are copied into a new immutable runtime bundle.
- [ ] Runtime manifest records candidate, evidence, bundle, hashes, scale, coordinates, clips, transitions, metadata, approval, promotion, default, and predecessor.
- [ ] Registry validation proves exact hashes, safe paths, one default, and rollback integrity.
- [ ] Player loader resolves the correct subject and variant.
- [ ] Realized motion drives pose, cadence, turning, and action responses.
- [ ] Collision, support, conformance, attachments, and event responses work as applicable.
- [ ] Lifecycle or state-driven material and shape changes remain projections of World Model truth.
- [ ] Catalog, workbench, adapter, regression, scene, and device-budget tests pass.
- [ ] The release artifact contains the promoted runtime digest.
- [ ] Rollback identifies and restores the exact predecessor.

## 17. Transfer to other games

### 17.1 Freshwater system

The method does not change. Evidence packets use freshwater species, plants, wood, substrate, and habitat references. Body plans add rooted plants, schooling fish, shrimp, snails, and hardscape. A plant asset owns mesh, growth-stage forms, sway clips, and attachment metadata. The World Model owns nutrients, light exposure, growth, damage, and position. The Runtime Adapter maps those values to local growth and sway.

### 17.2 Wizard open world

The same pipeline uses a style and world bible instead of a biology packet. Humanoid, quadruped, flying creature, spell, vegetation, prop, and structure Body Plans replace marine families. A wizard mesh owns appearance, rig, local locomotion and action clips, and sockets. The World Model owns faction, health, inventory, mana, route, combat outcomes, and quest state. The Runtime Adapter maps realized velocity and committed actions to gait, turn, cast, hit, and equipment presentation.

In both examples, the invariant remains:

```text
evidence or canon
  -> content and Body Plan contracts
  -> immutable candidate
  -> source, runtime, and determinism proof
  -> workbench human approval
  -> atomic promotion
  -> in-world and device proof
  -> release inclusion
```

## 18. Pocket Aquarium evidence summary

The following statements are repository-grounded at main revision `a2f65b788faa89dce59fb0bf826547f96648da83` unless otherwise noted:

- **Observed:** Blender 5.2.1 LTS is pinned by URL and SHA-256, and task-scoped Python scripts create source scenes, previews, GLBs, validations, and deterministic receipts.
- **Observed:** Source specifications encode reference scale, station-based morphology, cross-sections, appendage anchors, materials, rig, clips, constraints, provenance, and visual debt.
- **Observed:** Candidate generation is generic across several fish, coral, gastropod, decapod, asteroid, and other body plans.
- **Observed:** Candidates remain isolated from the accepted runtime registry and are served only through a loopback development service.
- **Observed:** The workbench provides strong catalog, view, scale, animation, wireframe, skeleton, proof, and statistics inspection.
- **Observed:** Runtime code strips cloned clip-root translation, maps semantic roles, blends clips, and adds bounded turn or environment-conformance deformation.
- **Observed:** Exact hashes, candidate identity, approval linkage, default uniqueness, and excluded-candidate rules are tested.
- **Observed gap:** The runtime catalog is LOD1-only, some single payloads are large, multiview evidence quality varies, workbench editor components are not proven active, and generic promotion lacks the Ocellaris-specific atomic service.
- **Recommended:** Preserve the proven scripted Blender and workbench loop. Add calibrated multiview landmarks, measured mobile budget profiles and LODs, active bounded semantic editing, a generic transactional promotion service, and revision-bound visual and device regression.

The deeper lesson is that fidelity comes from a controlled chain of evidence, morphology, local motion, runtime causality, human judgment, and immutable promotion. No single tool, model, or generator can substitute for that chain.
