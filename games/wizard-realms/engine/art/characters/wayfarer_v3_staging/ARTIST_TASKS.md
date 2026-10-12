# Wayfarer v3 artist staging

The [official Blender Human Base Meshes v1.4.1 bundle](https://www.blender.org/download/demo-files/)
is the CC0 anatomy source. `wayfarer_v3_artist_staging.blend` appends its
`Body Male - Stylized` collection as editable geometry and places the approved
male concept sheet beside it as a visual guide. The bundle itself remains in
`/private/tmp/wizard-human-base.8z4fI1/`, outside the repository. This scene
is an artist starting point, **not an approved or playable character**.

Initial validation: three mesh objects, 14,106 vertices, 14,164 faces,
99.1% quads, UVs on every mesh. The stage transform puts the base at 2.257 m
height, floor Z = 0, and centered X = 0, matching the v2 coordinate/height
contract. The source eye centers sit at Y = -0.0843 m relative to the body,
supporting Blender front (-Y); the stage rotates that to game forward (+Y).
Confirm the nose and eye landmarks visually before
rigging. Blender emitted six invalid legacy mask driver warnings during append;
the appended mesh objects have no active modifiers. Inspect and remove or
repair those drivers before production animation.

Artist work needed before any character quality gate:

1. Adjust adult proportions and pose against the approved four-view male
   sheet. Confirm front, three-quarter, side, and back silhouette and forward
   axis in the staging scene.
2. Sculpt a distinct expressive face: brow and eye shape, nose profile,
   cheek and jaw planes, ears, lips, and neck transition. Preserve the useful
   facial loops in the CC0 base while adapting its identity to the concept.
3. Build coherent layered chestnut hair masses over the full scalp and nape.
   Author the swept fringe and side/back shapes from the sheet, with strand
   detail as surface treatment rather than separate spikes.
4. Pattern and sculpt the violet robe, raised collar, draped mantle, sleeve
   folds, split hem, cream tunic, gold trim, leather belt, satchel, trousers,
   and boots. Check deformation clearance for walk and turn poses.
5. Finish topology, UVs, painted or baked materials, and skin weights. Rig to
   the existing 17-bone and seven-socket semantic contract, then author
   polished idle, walk, and turn clips. Export GLB and review four views
   against the sheet before any gameplay integration.

## Step 1 head study: visual NO-GO

`author_step1.py` adds a continuous chestnut scalp, swept lock studies, smaller
hazel irises, narrowed upper eye loops, and brows to the CC0 head. Editable
source: `wayfarer_v3_step1_head.blend`. Inspect `step1_front.png` and
`step1_three_quarter.png` against the approved sheet and v2 three-quarter.
The coherent base face and eye treatment are a real incremental improvement
over v2's detached nose and cheeks. The hair still reads as a helmet with
applied strands, however, and the eyes and expression remain too wide and
simple. This is **not** the approved likeness or a game-ready asset. Direct
sculpting, hair design, painted material detail, cloth, rig, and animation
remain required. Do not promote it into the character workbench or game yet.

Reproduce: `blender -b -t 2 --python author_step1.py` from this directory.
Blender 5.2.2 Eevee, two 720 x 800 images, 16 samples, 1.15 seconds real time,
431,767,552 bytes maximum resident set size, 1,921,467,976 bytes macOS peak
memory footprint. The static scene has 15 non-studio mesh objects, 16,208
vertices and 32,232 base triangles. Anatomy provenance remains the pinned CC0
Blender Human Base Meshes bundle recorded in `STAGING_MANIFEST.json`.
