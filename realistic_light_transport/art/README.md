# Pocket Aquarium specimen sources

These sources create presentation-only GLB animals for the root Pocket Aquarium roster. Root `PA` remains authoritative for species, individual identity, size, stage, hunger, compatibility, habitat, and world locomotion.

The first asset is a fresh ocellaris model made from anatomical cross-sections. The James PNG is a visual reference for proportions and band placement only. Its pixels are not sampled or copied into the mesh or PBR materials.

Rebuild with the exact checksum-verified binary recorded in `toolchain.json`:

```sh
BLENDER_BIN=/tmp/pocket-aquarium-tools/blender-5.2.1/Blender.app/Contents/MacOS/Blender \
  ./scripts/specimens/build_ocellaris.sh
```

The command regenerates the `.blend`, author preview, versioned GLB, and asset manifest. Blender itself stays outside the repository.
