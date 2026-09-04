# Candidate versus accepted boundary

Paths are relative to `realistic_light_transport/`. A generation lane ends at a candidate
package in `awaiting_user_acceptance`. Everything past that line is a human decision recorded
by the human, then a separate promotion lane. Violating this boundary is the one failure mode
that cannot be fixed by a rebuild, so `scripts/candidate_handoff.mjs` checks it mechanically.

## The three acceptance layers (all read-only for generation)

1. Look acceptance: `art/specimens/user-acceptance.v1.json`
   (`pocket-aquarium.user-acceptance/v1`). `entries[]` bind `speciesId/candidate` to
   `candidateHash`, `glbSha256`, `geometryDigest`, `status: user_accepted`, `userApprovedLook`;
   `priorApprovals[]` quote the human's statements; `excluded[]` lists
   `"<speciesId>/<candidate> (<reason>)"` strings that are formally rejected. The human writes
   this file. The catalog builder derives its `userApprovals` from it and never from generated
   output (`buildVisualCatalog.test.ts`).
2. Runtime promotion: `src/assets/specimens/runtime-acceptance.v1.json`
   (`pocket-aquarium.runtime-acceptance/v1`) plus the bundled copies
   `src/assets/specimens/<speciesId>/[<variantId>/]v1/lod1.glb`. Each entry carries `sourceCandidate`,
   `sha256`, `referenceSize`, `clips`, `clipRoles`, `clipLoops`, `defaultForSpecies`.
   `src/scene/specimens/assetRegistry.test.ts` requires every entry to bind to a layer-1 entry
   with matching hashes and refuses excluded candidates. Written only by a promotion lane.
3. Accepted Ocellaris v1.1.0 package: `art/specimens/ocellaris/{specimen.package.json,
   ocellaris.asset.json, biology.profile.json, morphology.profile.json,
   simulation.calibration.json, ocellaris.blend, validation-source.json, validation-runtime.json,
   textures/, renders/}`, its bundle `src/assets/specimens/ocellaris/v1/lod1.glb`
   (sha256 `ed4d447b2c7d88e91f45699a76b2ff3768144b57e6acb4199000567bafe37ac0`, pinned in
   `catalog/author.py`, `catalog/validate.py` and the package), and the compiled profiles
   `../js/specimenProfiles.js` from `scripts/specimens/compile_profiles.mjs`. Built by the legacy
   `scripts/specimens/build_ocellaris.sh` / `author_specimen.py` + `author_ocellaris.py` /
   `validate_specimen.py` + `validate_ocellaris.py` and promoted by `promote_specimen.mjs`. Every catalog receipt re-hashes this GLB
   (`write_receipt` raises "Accepted Ocellaris GLB changed during candidate validation").
   Ocellaris improvements are catalog candidates (`ocellaris/candidates/fable-v2`), never edits
   to this package.

## Path policy

| May write during generation | Never write during generation |
| --- | --- |
| `art/specimens/<id>/asset.source.json`, `source-references.json` | `art/specimens/user-acceptance.v1.json` |
| `art/specimens/<id>/candidates/<candidate>/**` (via the build driver) | any other file directly under `art/specimens/<id>/` (accepted package territory) |
| `scripts/specimens/catalog/species/<id>.py` | `src/assets/specimens/**` |
| `scripts/specimens/catalog/{lib,plans}/**` only with authorization (rehashes every dependent candidate) | `src/scene/specimens/assetRegistry.ts`, `src/scene/SpecimenFish.tsx` and their tests |
| `src/catalog/visual-catalog.v1.json` via `build_visual_catalog.mjs` | `../js/specimenProfiles.js`, `scripts/specimens/{build_ocellaris.sh,author_specimen.py,author_ocellaris.py,validate_specimen.py,validate_ocellaris.py,promote_specimen.mjs,compile_profiles.mjs}` |
| | another species' candidates, unless that species is in scope |

`candidate_handoff.mjs` fails when `git status` shows any path in the right-hand column dirty
and warns on shared `lib/`/`plans/` changes.

## Exclusion history

- `excluded[]` is append-only. Never delete, reword, or move an entry, and never create an
  `entries[]` record for a name that appears there.
- A rejected or superseded candidate keeps its name; the replacement gets the next name
  (`fable-v2`, `round-v2`, `approved-v2` are all in use as successors). If a human asks to "fix"
  an excluded candidate, build the successor and report the excluded line unchanged.
- When the human rejects your candidate, they add the line. You may propose the exact text in
  the handoff (`"<speciesId>/<candidate> (<reason>)"`), but do not write it.
- Renaming or deleting a candidate directory that an `entries[]` or `excluded[]` line refers to
  breaks `workbenchCatalog.test.ts` ("never gives formally excluded candidates a user-approved
  badge") and the registry tests; leave rejected packages in place.

## What acceptance and promotion look like (so the handoff can request them precisely)

1. Human reviews the candidate in the workbench and, if satisfied, appends an `entries[]`
   record with the `candidateHash`, `glbSha256`, `geometryDigest` from
   `validation-receipt.json`/`candidate.manifest.json` and sets `userApprovedLook`.
2. A promotion lane (out of scope for this skill) copies `lod1.glb` to
   `src/assets/specimens/<speciesId>/[<variantId>/]v1/`, adds the `runtime-acceptance.v1.json` entry,
   regenerates the visual catalog, and runs `assetRegistry.test.ts`, `workbenchCatalog.test.ts`,
   `SpecimenFish.test.ts`; only then does the species appear in the live tank through
   `specimenAssetFor`.
3. A hash mismatch between layers is a hard test failure, which is why the handoff quotes all
   three hashes verbatim rather than re-deriving them.
