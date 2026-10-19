# Wayfarer v3 Step 2: improved static head study, not game-ready

The [approved male sheet](../../concepts/wayfarer-male-concept-v4.png) remains
the target. Compare the editable `wayfarer_v3_step2_head.blend` and its
`step2_front.png`, `step2_three_quarter.png`, `step2_side.png`, and
`step2_back.png` with the Step 1 renders in this directory. `author_step2.py`
composes `face_pass.py` and `hair_pass.py` over the pinned Blender Human Base
Meshes v1.4.1 CC0 anatomy recorded in `STAGING_MANIFEST.json`. The concept
pixels are a visual guide, not a model texture.

Step 2 covers the crown and nape in all four views, gives the side and rear
hair different swept layers, and narrows and seats the eyes. The coherent
face is an improvement over the detached features of v2. It remains short of
the sheet: the cheeks and chin read youthful and round, the heavy lids and
brows read severe or sleepy rather than calmly confident, and the hair layers
read as smooth plates. Skin and hair materials are flat. This crop does not
prove the robe, equipment, body silhouette, rig, or animation.

Reproduction from this directory: `blender -b -t 2 --python author_step2.py`.
The accepted single-process run used Blender 5.2.2 LTS, Eevee at 16 samples,
four 720 x 800 PNGs, 1.35 seconds real time, 439,402,496 bytes maximum
resident set, and 2,049,623,624 bytes macOS peak memory footprint. The scene
has 22 non-studio meshes, 19,541 faces, 38,854 triangles, and the preserved
2.257 m body height. Six known legacy mask-driver warnings remain; no new
render error appeared.

**Decision:** GO to show this as an improved, editable static head study only.
NO-GO for the character workbench or playable game. The next fidelity pass
needs direct facial sculpting, hand-modeled flowing hair masses, and painted
surface detail, followed by costume, rig, and animation only after the head
meets the approved sheet. More procedural constant tuning is not approval.
