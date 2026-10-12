# V75 Wayfarer visual study: diagnostic only

Reference: `../../concepts/wayfarer-male-concept-v4.png`.

The V75 study records three cumulative checkpoints: face, hair, and outfit. It retains the editable Step 2 anatomical source, saves a separate `wayfarer_v4_visual_study.blend`, and renders the final outfit from front, three-quarter, side, and back. These outputs are for comparison, not a workbench or game candidate.

Independent visual review: **GO to show as a failed work-in-progress study; NO-GO for calling it reference-matched; NO-GO for rig, workbench, or game promotion.**

- Face: jaw and nose are more defined than Step 2, but the eyes have become too open and bulging, eyebrows remain high flat strokes, and the expression reads youthful rather than the reference's calm adult.
- Hair: the first V75 render had detached arcs. A bounded repair attached them to the covered scalp, but the result still reads as a smooth helmet with applied ridges, not layered chestnut hair.
- Outfit: a repair closed the boots and brought the sleeves closer, but the front, side, and back still expose shoulders and upper back. The sleeves and mantle remain disconnected-looking, while the tunic and satchel are flat.

The exact same `blender -b -t 2 --python author_v75.py` entrypoint was used before and after those source repairs. The retry advanced all three observed issues but did not pass visual acceptance. One Blender 5.2.2 process produced the eight 720x800 PNGs, saved and reopened the editable blend, and preserved the 2.257 m body height. Retry time was 1.78 seconds, maximum RSS 457,359,360 bytes, and reported peak footprint 2,046,379,664 bytes. The renderer exited.

This study also exceeded the normal 300-net-new-line minimal-diff tripwire across four scripts without achieving the requested fidelity. Keep the scripts and images as diagnostic comparison material, but do not grow this procedural sculpt/loft/wrap method. The next production attempt should use a reference-fitted 3D asset workflow: direct sculpt or a verified multi-view-to-3D base, fitted garments, authored hair and painted materials, followed by four-view and animation review. A separate asset source or service requires its own license, cost, provenance, topology, and memory checks before use.

Observed error | change | restart | retry result | next action: childlike face, detached hair, bare shoulders/feet | bounded face, hair, and costume repairs | identical single-process Blender render | advanced but not passed | switch production method, preserve V75 as an honest failed comparison.
