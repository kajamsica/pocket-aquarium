# Wayfarer V9 game asset: visual verdict

Target: the approved V9 Wayfarer sculpt (bottom row of `wayfarer_v9_staging/comparison_vs_reference.png`), completed to a full body and rigged for play. V10 is not used anywhere.

## Verdict

PASS as a faithful V9 transfer, with budget caveats.

- `comparison_vs_v9.png` row 2 renders this asset through the exact V9 bust camera, pivot, distance and lights. Face proportions, eye placement, nose and lip edits, hairline, swept lock mass, layered purple cowl, standing collar, gold trim and brooch match row 1 (approved V9 staging renders) in all four views. Even the small hood nubs on the back view sit in the same places.
- Differences at the V9 camera are shading only: no Subdivision on the game mesh, so the cowl folds and hair locks are slightly crisper, and the procedural bump, sheen and coat layers of the V9 look-dev shader do not export to glTF.
- Row 3 and `contact_sheet.png` show the full body: arms with bell-cuffed gold-trimmed sleeves, leather belt and buckle, cross strap and satchel on the left hip, full-length robe with gold hem and a front opening showing tunic, trousers and boots. No naked base mesh is visible, and there is no bust cut seam: the V9 head and garment code ran on the uncut CC0 body rather than stitching the bust blend to a lower body.
- Head, face and hair were not redesigned. Their generator code is copied verbatim from `author_v9.py`, whose approved copy (sha256 `65d922d3…`) and the approved `wayfarer_v9_head_shoulders.blend` (sha256 `85c98714…`) now live in `../wayfarer_v9_approved` alongside the four approved renders; the authoring script verifies those hashes on every run.
- The earlier workbench stipple on the robe was confirmed renderer-side (shadow-map self-shadowing, fixed in the workbench light); no art was changed for it.

## Footwear variants (barefoot start)

- `V9_feet`: the CC0 base mesh's own feet and lower shins (floor to z 0.58 m, under the trouser hem at 0.42 m), split into a separate skinned object (Thigh/Shin/Foot per side, Decimate 0.45, 2,736 triangles, skin material). `V9_boots` is unchanged in name and role. Both are exported visible; the runtime shows `V9_feet` when `gear.boots` is false and `V9_boots` when true.
- `barefoot_sheet.png` and `male_barefoot_*.png`: feet sit on the floor (min z 0.000), toes visible under the hem, and `male_barefoot_walk.png` shows both feet carried by the Walk clip at frame 7 (max foot displacement 0.30 m / 0.59 m, Turn 0.08 m / 0.13 m).
- Rest clearance between every foot vertex and the boot shell (zone 0.005 < z < 0.44 m): min 5.0 mm, median 17.7 mm, 0 vertices outside the boot, 0 under 2 mm. The boot wall now takes a local maximum of the skin radius over the ring interval so the heel and toe bulges cannot poke through. Only the sole plane is shared (z = 0), which is never visible.
- The booted silhouette and proportions are unchanged except for a boot wall 0 to 8 mm wider around the toe and heel.

## Compromises

- Triangle budget missed: 63,482 evaluated/GLB triangles against a 40,000 target (60,746 before the barefoot variant). Hair locks 15,456, body 12,796, mantle 6,912, robe 5,760, cowl 5,280, feet 2,736. Thinning the locks or mantle sampling changes the approved silhouette, so fidelity was kept and the figure is reported. Draw groups 30 of 32 and GLB 2.17 MB of 5 MB are within budget.
- Below the mantle the robe is torso-fitted with separate sleeves; the V9 bust robe wrapped the arms as a poncho. Above the mantle hem the robe is the V9 surface.
- Cloth is single-sided sheets with double-sided materials (brows and brooch keep a thin Solidify).
- Hair root-to-tip gradient is baked to vertex colour COLOR_0 with a white base colour factor; the original V9 colour ramp was shader-only.
- Skinning is smooth distance falloff tuned for the Idle, Walk and Turn amplitudes, not hand-painted weights.
- Boots and trousers are simple V9-style tubes in dark leather and brown trouser colours; they are mostly hidden by the robe hem.

## Evidence

- `male_front.png`, `male_three_quarter.png`, `male_side.png`, `male_back.png`: 576x1024 orthographic, Cycles CPU 64 spp, boots on.
- `male_barefoot_front.png`, `male_barefoot_three_quarter.png`, `male_barefoot_side.png`, `male_barefoot_walk.png`: same camera, `V9_boots` hidden, `V9_feet` shown; `barefoot_sheet.png` collects them.
- `v9match_*.png`: 512x512 at the V9 bust camera.
- `contact_sheet.png`, `comparison_vs_v9.png`.
- `male_manifest.json`: bounds, budgets, sockets, clips, hashes, GLB structure checks, Blender version, commands and peak RSS.

No runtime (browser or game renderer) proof is claimed.

## WebGL moire report (workbench, robe side/shoulder)

Report: fine striped/stippled moire over a broad area of the robe side/shoulder in the live Three.js workbench; Blender renders clean; wireframe off.

Diagnosis from the exported GLB (`diagnose_layers.py`, results in `layer_diagnostics.json` and `male_manifest.json["webglMoireDiagnosis"]`):

- The robe side sheet (z 0.30 to 1.55, |x| > 0.12, 1,751 vertices) has no neighbour closer than 0.31 mm, only 3 vertices within 1 mm (satchel and belt contact points) and a median clearance of 98 mm to any other mesh. There is no second surface behind it to z-fight with.
- The robe mesh has 0 duplicate faces, 0 zero-area faces, 0 inward-facing faces, 0 zero-weight vertices, consistent smooth normals.
- Robe to mantle clearance in the shoulder band is at least 2.4 mm (median 30 mm). The only genuine crossings are the robe's top rim passing through collar, cowl and mantle at z 1.79 to 1.81 (hidden inside the V9 cowl, identical to the approved V9 bust), the sleeve roots piercing the robe at |x| 0.22 to 0.24 under the mantle, and the satchel box seated into the robe on the left hip.
- The only near-coplanar garment pairs anywhere are mantle over sleeve root (23 verts within 1 mm), mantle over cowl, cowl over hood and tunic over chest; the last three are V9 bust layering and none is a broad robe area.
- Every material is `doubleSided: true` (single-sheet cloth needs it), and the workbench key light is a shadow-casting directional light with `shadows="basic"`, a 1024 px map over a 6 m frustum (5.9 mm texels) and, in the committed source, no bias. Three.js renders double-sided materials into the shadow map with the same faces that receive the shadow, so a broad, gently curved, double-sided sheet at a grazing angle to that light self-shadows in a fine texel-scale stripe or stipple pattern. Cycles ray-traces shadows and cannot show this.

Verdict: no confident art-side cause; the pattern and location match shadow-map acne on open double-sided cloth. The GLB, .blend, renders and hashes are unchanged. Renderer-side remedies (outside this lane): `shadow-bias` and `shadow-normalBias` on the workbench directional light (a normal bias of about 0.02 to 0.04 m covers 3 to 7 texels), or a PCF shadow type instead of basic. If an art-side hardening is wanted later, the robe can be given a solidified lining and exported single-sided at a cost of roughly +6k triangles and one extra material; that was not applied because it changes the robe and the cause is not in the asset.
