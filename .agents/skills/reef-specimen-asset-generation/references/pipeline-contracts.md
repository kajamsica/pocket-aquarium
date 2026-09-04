# Pipeline contracts

Paths are relative to `realistic_light_transport/`. Read the accepted examples named here before
writing a new spec; they are the contract in practice.

## Files a generation lane writes

| Path | Role | Written by |
| --- | --- | --- |
| `art/specimens/<id>/asset.source.json` | Species spec, schema `pocket-aquarium.asset-source/v1` | you |
| `art/specimens/<id>/source-references.json` | Provenance record, `{ "sources": [...] }` | you |
| `scripts/specimens/catalog/species/<id>.py` | Paint (+ optional extra channels) for a shared plan, or the whole `build()` for a species-local plan | you |
| `scripts/specimens/catalog/plans/<plan>.py` | Shared plan; today only `fish` | shared, changes alter every fish candidate's builder hash |
| `art/specimens/<id>/candidates/<candidate>/**` | Candidate package | `build_catalog_asset.mjs` only |
| `src/catalog/visual-catalog.v1.json` | Derived workbench catalog | `build_visual_catalog.mjs` only |

Variants: `asset.source.json#variants.<variantId> = { displayName, overrides }`; `overrides` is
deep-merged over the spec (`author.py#deep_merge`) and the candidate directory becomes
`candidates/<candidate>-<variantId>/`. Passing no `--variant` on a spec that defines variants
is an error; `build_catalog_asset.mjs --asset <id>:<variantId>` passes it for you. Example:
`torch_coral` (`green_pink_tips`, `gold_white_tips`).

## `asset.source.json` fields the pipeline reads

Common to every plan (see `author.py#export` for how each lands in the GLB extras and manifest):

- `schemaVersion` = `pocket-aquarium.asset-source/v1`, `id` = directory name, `displayName`,
  `scientificLabel`, `category` (`fish` | `coral` | `invertebrate` | `cleanup_crew`),
  `waterType` (`saltwater`), `bodyPlan`, `assetVersion` (`<semver>-candidate`),
  `referenceGrade` (`A`-`C`) with `referenceGradeRationale`, `taxonomyConfidence`.
- `referenceSize`: `{ meters, kind, note }`. `kind` is free text but must name what is measured;
  in use: `adult_total_length`, `adult_body_length`, `adult_shell_length`,
  `adult_shell_diameter`, `adult_crawling_length`, `adult_extended_length_crawling`,
  `adult_arm_span`, `adult_carapace_width_including_legs`,
  `adult_total_length_including_borrowed_shell`, `colony_width`. `note` cites the source and
  states which mesh axis the gate measures. The runtime scales by `meters` alone
  (`RiggedSpecimen.tsx` `referenceAdultLengthMeters`), so `meters` is the visible relative size.
- `origin`: `anatomical_midbody` (fish) or `base_center` (every sessile/benthic plan so far);
  the root stays at the zero transform and the export flips source `+Z` up to runtime `+Y` up,
  forward `+X`.
- `clipRoles`: `{ idle, locomotion, response }` mapping roles to clip names. Every clip named
  here must exist in `animation` with `frames` and `loop`; idle and locomotion `loop: true`,
  response `loop: false` with an `envelope` so it starts and ends at rest: `bell` (fish burst),
  `hold` (rise 22 %, hold, fall over the last 28 %; used by retract/withdraw clips) or `attack`
  (`lib/animation.py#envelope`). Conventions in the accepted catalog: fish `idle/swim/burst`,
  corals `sway/flow/retract`, zoanthids `open/flow/close`, gastropods `rest/crawl/retract`,
  decapods `rest/walk/threat|snap`, cleaner shrimp `hover/walk/clean`, echinoderms
  `rest/crawl/arm_curl|arm_recoil`, goby `idle/swim/sift`.
- `animation.<clip>`: per-clip amplitudes and integer frequencies (cycles per clip). Non-integer
  loop frequencies fail `loop_seam`.
- `validation.triangleBudget` `[min, max]` (default `[5000, 20000]`); fish also
  `maxJointDegrees`, `maxJointDegreesResponse` for the axial-chain gate.
- `palette`, `textures` (`bodyResolution`, `finResolution`, `normalStrength`, ...), `preview`
  (`frame`, `azimuthDegrees`, `elevationDegrees`), `visualDebt` (list of honest, specific
  shortfalls; carried into the handoff), `references` (mirror of `source-references.json`
  entries, kept in sync).

Fish plan (`plans/fish.py`) additionally reads `morphology`:
`controlStations[]` (`id`, `x`, `halfWidth`, `dorsalHeight`, `ventralDepth`, `centerZ`, caudal
base to snout, 14 stations in both accepted fish; the loft is a monotone PCHIP through them),
`crossSection` (`dorsalExponent`, `ventralExponent` superellipse exponents), `sampling`
(`ringSegments`, `ringCount`), `zoneFractions` (four x-fractions splitting
head/anterior/midbody/peduncle/caudal clearance zones), `finThickness` (`base`, `edge`),
`fins[]` by `type`: median (`xStart`, `xEnd`, `lean`, `heights` profile), caudal (`length`,
`spanTop`, `spanBottom`, `fork`, `forkPower`, `rounding`, `baseFraction`), paired (`rootX`,
`rootHeight`, `rootLength`, `length`, `spread`, `sweepDegrees`, `droopDegrees`, `flare`,
`taper`, `power`, `rayCount`), all with `rows`/`columns`; `finAdjacency`, `eyes`, `mouth`,
`gill`, `adornments`; plus `rig.axialJoints` (x positions of the six axial bones, snout to
tail). `ocellaris/asset.source.json` and `black_storm_ocellaris/asset.source.json` are the
reference specs; the module docstring of `species/black_storm_ocellaris.py` records the ratio
derivation to copy.

## Species module contract

`author.py#import_species` imports `catalog.species.<id>` (or `spec.backend`).

- Shared plan (`bodyPlan` has `plans/<plan>.py`): the module provides optional hooks the plan
  calls: `paint_body(ctx: PaintContext) -> {"albedo", "roughness", "normal"}` (ctx exposes
  `U`, `V`, `X` in metres, `ZETA` = cos of the ring angle, `SIDE`, `body`, `noise`, `paint`),
  `paint_fin(ctx: FinPaintContext) -> RGBA array` (one atlas tile per fin, `ctx.fin` names it),
  and `extra_channels(clip_name, spec, envelope) -> list[Channel]` (see `species/ocellaris.py`:
  waddle roll and hover pitch). Missing hooks fall back to `default_body_paint`/`default_fin_paint`.
- Species-local plan (no shared file): the module defines `build(spec, species, ctx)` returning
  `lib.contract.BuildResult(rig, root, meshes, clips, contract, preview_action, textures, notes)`.
  Templates: `species/trochus_snail.py` (gastropod: shell + soft body, shape-key retract),
  `species/torch_coral.py` (LPS: corallites, tentacle chains), `species/zoanthid.py` (polyp
  field). Build with `lib.meshing` (`loft`, `tube`, `ellipsoid`, `membrane`, `make_part`,
  `assemble`), `lib.rigging.RigBuilder` (max 32 deform bones; `finish()` enforces it),
  `lib.animation` (`ClipSpec`, `Channel`, `travelling_wave`, `bake_clip`), `lib.textures` and
  `lib.paint` (numpy, fixed seeds; write masks with `non_color=True`), `lib.materials.principled`.

Deterministic rules the gates rely on: fixed seeds everywhere, no `random`/time, no
topology-changing modifiers (`evaluated()` raises), object names `PA_<id>_Body|Fins|Details|...`,
one armature, root at identity.

## `validation.contract.json` (written by the builder, consumed by `validate.py`)

`lib.contract.base_contract(spec, rig_name, root_name, meshes, size_axis="x",
size_tolerance=0.03, ...)` sets `speciesId`, `rig`, `root`, `meshes`, `size`
(`{ axis, meters, tolerance, kind }`), `clipRoles`, `triangleBudget`, `maxDeformBones` (32),
`sampleStride`; `register_clips` fills `clips.<name>` `{ loop, frames, animatedBones,
shapeKeys, ... }` and fails if any role maps to a missing clip. The plan adds:

- `closedParts[]` `{ object, group, volumeFloor }`: vertex groups that must be watertight,
  manifold, outward-wound at rest and keep `volume >= volumeFloor * rest` in every clip frame.
- `clearance[]` `{ a: [object, group, exclude?], b: [...], minDistance?, label }`: pairs that
  may never intersect in any frame; with `minDistance`, a BVH nearest-point floor. Fish use
  `zone_*` body zones against each other and `fin_*` against `part_body` minus the `attach_*`
  seam so attached fins pass while floating fins fail.
- `symmetry[]` `{ left, right }` mirrored vertex groups; `centerPlane[]` `{ object, group,
  exclude, side }` left/right appendages that must not cross the sagittal plane.
- `axialChain` (fish): `{ bones, maxJointDegrees, maxJointDegreesResponse, maxCumulativeDegrees }`;
  `check_axial` fails on a sign reversal between consecutive joints (kinked spine), a joint over
  the limit, or cumulative curvature over the cap.
- `clips.<name>`: declared `animatedBones`/`shapeKeys` must actually move
  (`clip_targets_move`); non-looping clips must start at the neutral pose.

Gate names as reported: source `finite_vertices_and_weights`, `triangle_budget`,
`reference_size`, `closed_parts_watertight_manifold`, `bilateral_symmetry`,
`animated_clearance_bvh`, `closed_part_orientation_and_volume`, `clip_targets_move`,
`axial_curvature` (fish), `center_plane`, `clip_roles_resolve`; runtime
`accessors_in_bounds_and_finite`, `skin_weights_normalised`, `inventory_matches_manifest`,
`single_skin`, `embedded_png_textures`, `clip_inventory`, `clip_roles_resolve`,
`clip_channels_animate_declared_targets`, `blender_import_parity`, `loop_seam`,
`rest_bounds_parity`; determinism `geometryDigestMatch`, `textureHashMatch`, `rigDigestMatch`.

## Candidate package inventory

`build_catalog_asset.mjs` stages and outputs (pinned Blender from `art/toolchain.json`, or
`BLENDER_BIN` override, which the receipt records as `blenderVersion`):

| Stage | Command (run by the driver) | Writes |
| --- | --- | --- |
| author | `Blender --background --factory-startup --python scripts/specimens/catalog/author.py -- --asset <id> --candidate-dir <dir> --mode author [--variant v] [--no-render]` | `source.blend`, `textures/*.png`, `geometry-digest.json`, `validation.contract.json`, `renders/author-preview.png` (3/4 view mid-`previewAction`), `renders/three-view.png` (side, top, front at rest, 640 px panels) |
| source | `Blender <dir>/source.blend --background --python .../validate.py -- --asset <id> --candidate-dir <dir> --stage source` | `validation-source.json` (gates, per-clip metrics, pose snapshots at phases 0/.25/.5/.75) |
| export | `Blender <dir>/source.blend --background --python .../author.py -- ... --mode export` | `lod1.glb` (extras: speciesId, referenceSizeMeters/Kind, axes, `candidate: true`), `candidate.manifest.json` |
| runtime | `Blender --background --factory-startup --python .../validate.py -- ... --stage runtime` | `validation-runtime.json`; sets `manifest.validator.status = passed` |
| determinism | author `--no-render --allow-scratch` into an `os.tmpdir()` scratch dir (removed afterwards), then `--stage determinism --rebuild-dir <scratch>` | `determinism.json` |
| receipt | `--stage receipt` | `validation-receipt.json` (`candidateHash` = sha256 of canonical `{sourceSha256, sourceReferencesSha256, candidateGlbHash, geometryDigest, builder, blenderVersion, acceptedOcellarisHash}`), updates `manifest.candidate` |

The driver also writes `build-receipt.json` (stage exit codes and durations) and `build.log`
(git-ignored). `candidate.manifest.json#builder` hashes `author.py`, `validate.py`, the plan,
the species module and every `lib/*.py`; editing any of those invalidates every existing
candidate's receipt for that plan, which is why shared-library edits need authorization.

## Workbench and catalog

- `node scripts/specimens/build_visual_catalog.mjs` scans `asset.source.json`, candidate
  manifests/receipts, the accepted Ocellaris package and `user-acceptance.v1.json` (read-only
  approval source) into `src/catalog/visual-catalog.v1.json`; `--check` exits 1 when stale.
  `src/catalog/buildVisualCatalog.test.ts` pins determinism of the output.
- Dev server only: `src/workbench/candidateCatalogService.ts` serves
  `/__catalog/v1/candidates` and each candidate's `lod1.glb`, manifest, receipt and renders to
  loopback clients. `?workbench=<speciesId>&candidate=<candidate>&scale=shared|fit` selects the
  view; `src/workbench/workbenchCatalog.ts#preferredCandidate` picks the default candidate.
- Runtime resolution (`src/scene/specimens/assetRegistry.ts`) reads only
  `src/assets/specimens/runtime-acceptance.v1.json`; candidates are never visible in the tank.
