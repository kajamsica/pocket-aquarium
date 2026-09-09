# Pocket Aquarium specimen sources

These sources create presentation-only GLB animals for the root Pocket Aquarium roster. Root `PA` remains authoritative for species, individual identity, size, stage, hunger, compatibility, habitat, and world locomotion.

The first asset is a fresh ocellaris model made from anatomical cross-sections. The James PNG is a visual reference for proportions and band placement only. Its pixels are not sampled or copied into the mesh or PBR materials.

Rebuild with the exact checksum-verified binary recorded in `toolchain.json`:

```sh
BLENDER_BIN=/tmp/pocket-aquarium-tools/blender-5.2.1/Blender.app/Contents/MacOS/Blender \
  ./scripts/specimens/build_ocellaris.sh
```

The command regenerates the `.blend`, author preview, versioned GLB, and asset manifest. Blender itself stays outside the repository.

## Reference comparison gate

`build_catalog_asset.mjs` validates `art/specimens/<species>/reference-comparison.json` before starting Blender. The file is required for every species and candidate pair not already named as `user_accepted` in `art/specimens/user-acceptance.v1.json` or as a `sourceCandidate` in `src/assets/specimens/runtime-acceptance.v1.json`. That exact-pair grandfathering keeps accepted legacy rebuilds working, but a new candidate for the same species is gated.

Use this compact v1 shape:

```json
{
  "schemaVersion": "pocket-aquarium.reference-comparison/v1",
  "speciesId": "example_fish",
  "sourceAssetPolicy": {
    "copiedPixels": false,
    "redistributedSourceImages": false,
    "hotlinkedAssets": false
  },
  "sources": [{
    "id": "MUSEUM-PHOTO-123",
    "originalPageUrl": "https://museum.example/specimens/123",
    "creator": "Example Museum",
    "license": "CC BY 4.0",
    "accessedAt": "2026-09-09",
    "allowedUse": "visual reference only"
  }],
  "views": {
    "side": { "status": "observed", "sourceIds": ["MUSEUM-PHOTO-123"], "notes": "Lateral outline." },
    "top": { "status": "inferred", "uncertainty": "medium", "notes": "Width inferred from related anatomy." },
    "front": { "status": "inferred", "uncertainty": "high", "notes": "Head thickness inferred." }
  },
  "silhouetteLandmarks": [{
    "name": "snout to peduncle", "sourceIds": ["MUSEUM-PHOTO-123"],
    "sourceControls": ["morphology.controlStations"], "notes": "Stations follow the outline."
  }],
  "proportions": [{
    "name": "body depth / standard length", "status": "observed",
    "referenceValue": { "value": 0.32, "unit": "ratio" },
    "sourceIds": ["MUSEUM-PHOTO-123"], "sourceControls": ["morphology.controlStations[*].dorsalHeight"],
    "notes": "Station heights control the measured ratio."
  }],
  "colorPatternBoundaries": [{
    "name": "midbody patch", "sourceIds": ["MUSEUM-PHOTO-123"],
    "sourceControls": ["textures.bodyZones"], "notes": "Procedural boundary follows the reference."
  }],
  "candidateComparison": {
    "mismatches": [{ "area": "fin rays", "note": "Represented as normal-map relief." }],
    "acceptanceBlockers": []
  }
}
```

Search and category pages may be kept separately as discovery notes, but cannot appear in `sources`. Every observed view, landmark, observed proportion, and color boundary must resolve to an exact source ID. Inferred views or proportions require an uncertainty label, and all proportions must map to source controls. Any nonempty `acceptanceBlockers` array stops the build and writes a failed preflight receipt. Source images remain outside the repository.

The freshwater source lanes should add this file before building: Betta must replace its Commons category with exact original image pages and label top/front as inferred; Harlequin Rasbora must do the same and map its body-depth and axine controls; Bronze Cory must map body-height, armor, barbel, and color controls while explicitly qualifying top/front/underside inference. None may build until comparison blockers are empty.
