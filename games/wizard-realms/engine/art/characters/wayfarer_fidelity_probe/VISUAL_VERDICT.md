# Sculpted bust fidelity probe: NO-GO

This original, bust-only Blender study tested whether continuous sculpted
surfaces and subdivision would close the gap to the approved male concept at
`../../concepts/wayfarer-male-concept-v4.png`. It does not. It is not a
playable, rigged, or accepted character asset.

## Reproducible evidence

- Editable source: `author_bust_probe.py`, `wayfarer_bust_probe.blend`
- Visuals: `bust_front.png`, `bust_three_quarter.png`
- One Blender 5.2.2 Eevee renderer, two 800 x 850 frames at 24 samples
- Total render command: `blender -b -t 2 --factory-startup --python author_bust_probe.py`
- `/usr/bin/time -l`: 405,454,848 bytes maximum resident set size (387 MiB),
  1,963,132,584 bytes macOS peak memory footprint, 2.61 seconds real time
- 35 mesh objects, 14 materials, 42,202 source triangles before subdivision
- No rig, GLB, female asset, third-party mesh, third-party pixels, or gameplay
  integration was attempted in this fidelity experiment

The first run stopped before rendering with `KeyError: 'hair deep'`, an
undefined brow material. Observed error | change | restart | retry result |
next action: missing material name | used the existing `hair base` material |
restarted the same Blender command | passed and produced both PNGs | inspect
the concept comparison.

## Concept comparison

The continuous facial mesh removes the former detached cheek and nose
primitives, but its contours remain broad and expressionless. Eye shape,
eyelids, lips, cheek planes, and the nose profile still lack the coherent
adult sculpt in the concept. The scalp now covers the head, yet its forelocks
read as flat cut strips, not layered hair volumes. The mantle is an inflated
smooth shell, and the sleeve is a tapered cylinder with weak fold definition.
The cream inset and gold edges show the palette but lack tailoring and
material variation. The crop reveals an unfinished neck transition.

This is a **NO-GO** for extending the procedural method to a full rig or
female variant. Matching the approved sheet needs direct character art:
anatomical sculpting, deliberate hair clump design, cloth pattern and fold
sculpting, UV and painted or baked materials, then retopology and rig polish.
The two renders are honest negative evidence for this script-only approach.
