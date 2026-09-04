# Visual iteration loop

One observation, one owner, one rebuild, same view. Paths are relative to
`realistic_light_transport/`.

## 1. Capture the failing view exactly

Record, before changing anything:

- Source of the observation: gate message (quote it), `renders/three-view.png` panel (`side` |
  `top` | `front`, left to right), `renders/author-preview.png`, or the workbench.
- Workbench state: URL (`?workbench=<id>&candidate=<name>&scale=shared|fit`), preset (`1` side,
  `2` front, `3` top, `4` three-quarter), clip, paused phase (0 / 25 / 50 / 75 / 100 %), rate,
  `W`/`K` toggles. Take a screenshot; name it `<candidate>-<preset>-<clip>-<phase>.png` outside
  the repo.
- The concrete defect in anatomical terms ("dorsal soft lobe floats 1 mm above the ridge at
  swim 50 %", not "fins look off").

## 2. Pick the single owner

| Observation | Gate that catches it | Smallest owner |
| --- | --- | --- |
| Body too long/short or `reference_size` fails ("Rest size ... outside ... +/- 3%") | source `reference_size` | Fish: `controlStations[].x` span and caudal `length` so the measured axis matches `referenceSize.meters`; never edit `meters`/`kind` to fit the mesh. Non-fish: the dimension the `note` says the gate measures (`base_contract(size_axis=...)`) |
| Body slab-sided, too round, or wrong from the front/top while the side view is right | none (visual) | `crossSection.dorsalExponent/ventralExponent`, per-station `halfWidth`; compare `front`/`top` panels only |
| Forehead/snout profile wrong, chin too deep | none (visual) | The 2-3 head stations' `dorsalHeight`/`ventralDepth`/`centerZ`; keep the rest of the stations |
| Fin floats off the body or shows a gap at the root | source `animated_clearance_bvh` (`fin_body_<name>`) | Median fins: `xStart`/`xEnd`/`heights[0]`/`lean`; paired fins: `rootX`, `rootHeight`, `rootLength` so the root row sits inside the loft (the plan already embeds roots by `embed_median`/`embed_paired`) |
| Dorsal and anal (or dorsal and caudal) fins intersect | source `animated_clearance_bvh` (`fin_fin_<a>_<b>`) | Shorten the overlapping `xEnd`/`heights` tail, or declare the pair in `morphology.finAdjacency` only when the real fish's fins genuinely touch |
| Head touches tail in `burst`, or "intersection zone_head/zone_caudal" | source `animated_clearance_bvh` (`head_tail_clearance`, zone pairs) | Reduce `animation.<clip>.axial` amplitudes (tail-most first) or `axialLag`; if the body is realistic and still fails, raise `validation.maxJointDegreesResponse` only with a cited reason |
| Kinked spine, "axial reversal at n", or joint/cumulative bend over limit | source `axial_curvature` | `rig.axialJoints` spacing (six x values, monotone, snout to tail) and `axial[]` progression (monotonic increase toward the tail); do not add sign flips |
| Left fin crosses to the right side | source `center_plane` | Paired fin `spread`/`sweepDegrees`/`droopDegrees`, or the `pectoral` amplitude in the failing clip |
| Watertight/manifold failure on `part_body` | source `closed_parts_watertight_manifold` | `sampling.ringSegments`/`ringCount`, degenerate station (zero `halfWidth`) or duplicated `x` values in `controlStations` |
| Fin membrane collapses or inverts mid-clip | source `closed_part_orientation_and_volume` / inverted triangle | Reduce `median`/`pectoral` amplitude for that clip, or thicken `finThickness.base` |
| Loop pops at the seam | runtime `loop_seam` | Every frequency in that clip must be an integer number of cycles over `frames`; `axialLag` and phase offsets are fine, fractional frequencies are not |
| Response clip starts from a bent pose | source clip check "does not start at the neutral pose" | The clip's `envelope` (`bell` or `hold`, never `null`) and any `extra_channels` `Channel` built without `envelope=envelope` |
| Declared bone never moves | source `clip_targets_move` | The species module's `extra_channels` or the plan's per-clip amplitude for that bone; remove the bone from the clip's declared targets only if it is truly static |
| Texture blank, roughness/normal flat or washed out | none (visual) or determinism texture mismatch | `paint_body`/`paint_fin`; masks and normal/roughness must be written `non_color=True` (`lib/textures.write_image`); fixed seeds only |
| Pattern seam along the dorsal ridge or mirrored wrongly | none (visual) | Sample noise on `(cos, |sin|)` of the ring angle (`ctx.ZETA`, `ctx.SIDE`) as `species/black_storm_ocellaris.py` does, not on raw `V` |
| Runtime says `inventory_matches_manifest` / triangle mismatch | runtime | Stale `export`: rerun from `author` (the manifest is rewritten at export) |
| `determinism` fails | determinism | Non-fixed seed, `set` iteration order, time or path dependence in the species module |
| Species reads wrong beside neighbours in `scale=shared` | none (visual) | Check `referenceSize.meters` against the citation first; if correct, the fault is proportion, not scale |
| Appendage drags or shell floats at rest (non-fish) | source clearance / visual | The rest transform of that part in `build()` (e.g. scarlet hermit: shell parented to the body so walk drags it) |

Species-local plans map the same way: the failing `label` in the gate message names the
`clearance`/`closedParts` entry the plan registered, and that entry names the mesh part and
therefore the code block to change.

## 3. Rebuild the minimum

Inner loop (no renders, no determinism, keeps the candidate directory):

```bash
node scripts/specimens/build_catalog_asset.mjs --asset <id>[:<variant>] --candidate <name> --jobs 1 \
  --stages author,source,export,runtime --no-render
```

Then re-load the workbench URL (the candidate service re-reads the directory on request) and
re-check the identical preset/clip/phase. Once the defect is gone, run the full build (all
stages, with renders) so `renders/`, `determinism.json` and `validation-receipt.json` match the
final geometry.

## 4. Compare the identical view

- Put the new screenshot beside the captured one; judge only the recorded defect.
- Confirm nothing else moved: `geometry-digest.json#objects[].vertexDigest` changes only for
  the meshes you intended; `statistics.triangles` stays within budget; the other two panels of
  `three-view.png` are unchanged in silhouette.
- Log the loop in the handoff as `view -> owner -> result` (one line each). Stop when the
  recorded defect is gone and no gate regressed; a new observation starts a new loop entry
  rather than widening this one.

## 5. When not to iterate

- The change needed is in `lib/` or `plans/`: it rehashes every dependent candidate's receipt.
  Stop and ask unless the task authorized shared changes.
- The fix requires loosening `validation.contract.json`, `triangleBudget`, joint limits, or
  `referenceSize` without a citation: stop and report the gate output.
- The defect is a matter of taste not tied to an invariant or to the human's stated feedback:
  note it under `visualDebt` and leave it.
