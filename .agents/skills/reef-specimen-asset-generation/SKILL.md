---
name: reef-specimen-asset-generation
description: Research a real marine species and author, gate, review, and hand off a Blender-built animated GLB candidate for the Pocket Aquarium visual catalog (realistic_light_transport/art/specimens). Use for a new species or colour variant, for refining an existing candidate's morphology, paint, or clips, or for diagnosing source/runtime/determinism gate and workbench failures. Not for accepting or promoting candidates, editing bundled runtime GLBs or acceptance records, or gameplay, husbandry, chemistry, store, or UI work.
---

# Reef specimen asset generation

Produces one `awaiting_user_acceptance` candidate package under
`realistic_light_transport/art/specimens/<species_id>/candidates/<candidate>/`, built by the
pinned Blender through the existing catalog pipeline, reviewed in the specimen workbench, and
handed to a human with evidence. The candidate is the deliverable. Acceptance and runtime
promotion are separate human-gated steps that this skill never performs.

All paths and commands below are relative to `realistic_light_transport/` (the Vite app) unless
prefixed with the repository root.

## When this applies

- Adding a species or colour variant to the visual catalog, or a `fable-vN` refinement of an
  existing candidate (including the accepted Ocellaris, which is refined only through candidates).
- A candidate fails a gate (`validation-source.json`, `validation-runtime.json`,
  `determinism.json`) or looks wrong in the workbench and needs a smallest-owner fix.

Do not use it to accept, promote, roll back, or re-label candidates; to edit
`src/assets/specimens/**`, `art/specimens/user-acceptance.v1.json`, or the accepted Ocellaris
package; or for anything outside the specimen art pipeline. Read
[references/acceptance-boundary.md](references/acceptance-boundary.md) before touching any
file under `art/specimens/` or `src/`.

## Invariants (every step must hold)

1. Real morphology from at least side, front, and top evidence, each source recorded in
   `source-references.json` (`id`, `title`, `publisher`, `url`, `accessedAt`, `evidenceClass`,
   `allowedUse`, plus `license` when the source states one). No pixel sampling; a single side
   cutout is not a body.
2. Explicit `referenceSize.kind` + `meters` from a citable adult measurement; the mesh must land
   inside the size gate on the axis the contract declares.
3. Straight rest spine, watertight closed body, fins/appendages attached (clearance gate), no
   part-part intersections, species-appropriate proportions in all three views.
4. Three semantic clip roles (`idle`, `locomotion`, `response`); idle/locomotion loop, response
   starts and ends at the rest pose. Checked in Blender and in the three.js workbench.
5. Deterministic: same source + toolchain rebuilds to the same `geometryDigest`; all seeds fixed.
6. Every available check runs before handoff (gates, catalog `--check`, `tsc -b`, vitest,
   workbench load, `candidate_handoff.mjs`).
7. Candidate/accepted boundary is absolute; exclusion history is append-only and never reversed.
8. One Blender build driver and one Vite server per worktree at a time.

## Inputs

- `species_id` (lowercase snake, e.g. `blue_hippo_tang`), optional `variant_id`, candidate name
  (`fable-v1`, `fable-v2`, ...; never reuse a name listed in the exclusion record).
- Body plan: shared `fish` (`scripts/specimens/catalog/plans/fish.py` + a species paint module)
  or a species-local plan (`scripts/specimens/catalog/species/<species_id>.py` exposing
  `build(spec, species, ctx)`); pick by anatomy, see the contracts reference.
- Pinned Blender: `art/toolchain.json` -> `/tmp/pocket-aquarium-tools/blender-5.2.1/...`.
  Verify the DMG sha256 against the manifest before first use; never install globally.
- Node 20+ with `npm ci` run once in `realistic_light_transport/` (needed for `tsc`, `vitest`,
  and the dev server; the build driver and catalog builder are dependency-free).

## Workflow

### 0. Isolate

Work in a dedicated git worktree on its own branch. Confirm no other Blender build or Vite dev
server belongs to this worktree (`pgrep -fl "build_catalog_asset|vite"`). Do not stop processes
you did not start.

### 1. Research and provenance

Collect adult total length or the plan's size axis (FishBase/SeaLifeBase/WoRMS), and side,
front (head-on) and top (dorsal) references, plus fin/appendage counts and pattern layout.
Record every source in `art/specimens/<species_id>/source-references.json`. Derive proportions
as ratios of standard length (depth, width/depth, head length, eye diameter and position,
peduncle length/depth, fin base spans) and write them into the species module docstring so the
next agent can audit the numbers.

### 2. Write the source spec

Create or edit only `art/specimens/<species_id>/asset.source.json`,
`source-references.json`, and the species module. Copy the nearest accepted example of the same
body plan (`ocellaris`, `black_storm_ocellaris` for fish; `trochus_snail`, `torch_coral`,
`zoanthid` for non-fish). Field contract: [references/pipeline-contracts.md](references/pipeline-contracts.md).

### 3. Build the candidate

```bash
node scripts/specimens/build_catalog_asset.mjs --asset <species_id>[:<variant_id>] --candidate fable-v1
```

Stages: author -> source gate -> export -> runtime gate (fresh process) -> determinism rebuild
-> receipt. Multiple `--asset` flags run in parallel only when parallelism has been authorized;
otherwise pass `--jobs 1`. `--skip-determinism`/`--no-render` are for inner-loop iteration
only; the handoff build runs all stages. Output: `build-receipt.json`, `build.log` (ignored by
git), `renders/author-preview.png`, `renders/three-view.png`.

### 4. Read the gates

Open `validation-source.json` and `validation-runtime.json` first, then `build.log`. Every
`GateFailure` names the offending check; map it to its owner with
[references/visual-iteration-loop.md](references/visual-iteration-loop.md) and change only that
owner. Do not loosen `validation.contract.json` limits or `referenceSize` to pass a gate.

### 5. Review in the workbench

```bash
npm run dev -- --host 127.0.0.1 --port 5173
# http://127.0.0.1:5173/?workbench=<species_id>&candidate=<candidate>&scale=shared
```

Candidates are served only over loopback by `candidateCatalogService`. Check in this order:
preset `1` side, `2` front, `3` top, `4` three-quarter; `W` wireframe and `K` skeleton at rest;
each role clip at rate 1.0 and 0.25; pause and scrub phase 0 %, 25 %, 50 %, 75 %, 100 % on the
loop clips; response clip start/end pose; `scale=shared` beside the accepted Ocellaris and a
species of similar length. The workbench uses the same GLTFLoader, SkeletonUtils clone and
AnimationMixer stack as `src/scene/specimens/RiggedSpecimen.tsx`; a candidate cannot be placed
in the live tank before human acceptance, and the skill must not fake that by editing the
registry.

### 6. Iterate

Capture the failing view exactly (preset, clip, phase, scale mode, or the three-view panel),
change the single owner, rebuild with `--stages author,source,export,runtime --no-render` while
iterating, then a full build, then compare the identical view. Stop when no invariant is
violated; do not chase taste changes the human did not ask for.

### 7. Repository checks

```bash
node scripts/specimens/build_visual_catalog.mjs          # regenerates src/catalog/visual-catalog.v1.json
node scripts/specimens/build_visual_catalog.mjs --check
npx tsc -b && npx vitest run
node ../.agents/skills/reef-specimen-asset-generation/scripts/candidate_handoff.mjs --asset <species_id> --candidate <candidate>
```

`src/catalog/visual-catalog.v1.json` is the only generated file under `src/` a generation lane
may change. `candidate_handoff.mjs` is read-only: it verifies package/hash coherence (including
that `asset.source.json` still matches the build, so superseded candidates fail `stale_source`
by design), the accepted Ocellaris hash, the exclusion record, the acceptance/runtime records,
and that no acceptance or runtime-promotion path is dirty (`--base <ref>` also scans commits
since a branch base). It exits non-zero on any FAIL and prints the handoff block.

## Stopping conditions

- Stop and report (do not work around) when: a size or morphology source cannot be found; the
  pinned Blender is missing or fails its checksum; a gate can only pass by relaxing the contract;
  the requested candidate name is in `user-acceptance.v1.json#excluded`; a shared
  `lib/`/`plans/` change would alter other species' builder hashes without authorization.
- Done when: the full build passes all stages, workbench review found no invariant violation,
  step 7 commands all exit 0, and the handoff block is written.

## Outputs and handoff

Commit the candidate package (everything `build_catalog_asset.mjs` writes except `build.log`),
`asset.source.json`, `source-references.json`, the species module, and the regenerated
`src/catalog/visual-catalog.v1.json`. Report by pasting the block `candidate_handoff.mjs`
prints (`candidate`, `candidateHash`, `lod1.glb sha256`, `geometryDigest`, `gates`, `size`,
`clips`, `statistics`, `renders`, `workbench`, `provenance`, `boundary`, `visual debt`,
`requested action`, `status`) and appending two lines the script cannot know:

```
workbench checks: presets 1 2 3 4 at rest; <idle>/<locomotion> phases 0/25/50/75/100 at 1.0 and 0.25x; <response> start/end neutral; scale=shared vs ocellaris and <neighbour>
iteration log:    <view> -> <owner> -> <result>; ...   (or "none")
```

Never write the acceptance entry yourself, even when asked to "finish"; the human records
`userApprovedLook`/`user_accepted` and a separate promotion lane binds it to the runtime.
