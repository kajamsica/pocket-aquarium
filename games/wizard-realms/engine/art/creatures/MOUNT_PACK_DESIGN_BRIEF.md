# Wizard Realms mount pack: five distinct rideable species (asset contract)

Status (2026-10-20): all five current author scripts have generated a `.blend`, `.glb` and measured manifest
in this checkout. Manifest hashes match the exports; every structural check passes, including the Aether ray's
corrected landed `Idle` floor. The mounts span 26.2k to 32.1k evaluated triangles and 0.89 to 1.09 MB per GLB.
These are staging assets, not visually approved mounts or gameplay traversal support; the runtime still only
knows the adult Sedgehorn ground mount. Each species folder holds one self-contained Blender author script and
a manifest. The author scripts rewrite their manifest with measured evidence when run on the render machine,
keeping the hand-written `design`, `traversalRole`, `riderClipMap` and `renders` blocks.

Measured seat heights from current exports (glTF Y, metres): newt 1.043 (stirrup drop 0.346), gecko 1.123
(0.446), ray 1.148 (0.540), beetle 1.577 (0.505), mole 1.662 (0.466); Sedgehorn 1.97. Measured widths:
beetle 3.08 m across the claw tips (the sheet below says 2.7 m across the planted feet; the claws add the
rest), mole 3.06 m across the spade claws.

Reference assets (read-only, not edited by this pack):

- `sedgehorn_mount/author_sedgehorn.py` and `sedgehorn_manifest.json`: the approved adult ground mount. Its
  conventions are the baseline below (procedural metaball core, lofted parts, tack sampled off the body with a
  BVH, 25-joint rig, in-place clips with a floor solve, reference empties, GLB checks, manifest evidence).
- `../characters/wayfarer_v9_game/male_manifest.json` `rideClips`: the V9 Wayfarer (2.31 m) seated contract.
  `riderSeatOffsetRule`: rider root = `Seat.glbPosition + (0, -0.823, +0.02 forward)`, no rotation. The leg
  solve is a 2-bone IK from the hip to `Stirrup tread + (0, -0.035 back, +0.115 up)`; the arm solve aims the
  open hand at `ReinHand`. Rider thigh + shin reach is about 1.0 m, so every seat below keeps the hip-to-ankle
  distance between 0.55 m and 0.9 m.

## 1. Shared contract (all five species)

| Item | Rule |
| --- | --- |
| Axes | Authored in Blender metres, +Y forward, Z up, lowest rest contact on Z = 0. Exported with `export_yup`: glTF +Y up, -Z forward. |
| Scale | Sized against the 2.31 m V9 Wayfarer. Current measured seat heights span 1.043 m (newt) to 1.662 m (mole), with the ray at 1.148 m, so the five mounts read differently next to each other and next to the Sedgehorn (1.97 m). |
| Rig | One armature, one skin, `Root` unkeyed at the origin. One body root bone (`Thorax`, `Pelvis` or `Body`) carries the only keyed location (vertical floor solve or hover bob). All other bones are rotation only, quaternion keys. Bone names use `<Part><Segment>.<L|R>` like the Sedgehorn. |
| Reference nodes | Empties parented to the seat bone, exported with `extras.role`: `Seat` (`rider_seat`, top surface of the seat on the centre line), `Stirrup.L/R` (`rider_stirrup`, tread top where the sole rests), `ReinHand.L/R` (`rider_rein_hand`, where the open hands rest). ReinHand is always `Seat + (±0.17, +0.22 forward, +0.32 up)` so the V9 arm solve carries over. Species extras use other role prefixes (`cargo_socket`, `rail_grip`). |
| Clips | `Idle` plus a species slow-travel and fast-travel clip, all in place, 24 fps, loop-closed (pose at phase 1 equals phase 0). `riderClipMap` in each manifest maps `RideIdle/RideWalk/RideRun` to the species clips. Fast clip is shorter than slow clip. |
| Floor | Planted feet never drop below Z = 0 in any ground clip (measured per frame, written to `clipEvidence`). The ray has no feet; its flight clips record how far wing tips dip below the origin plane instead. |
| Seat motion | `clipEvidence.<clip>.seatDeltaPerFrameGlb` is published for every clip exactly as the Sedgehorn does, so the rider's seated clips can be re-solved per species. |
| Budgets | Evaluated triangles <= 40,000 per mount (body core 12k to 15k after decimate). No textures: vertex colour `COLOR_0` on the skin mesh plus flat Principled materials, same as the Sedgehorn; bump is procedural noise and stays inside the .blend. GLB <= 1.5 MB. |
| Materials | Principled BSDF only. Realm tack language: violet blanket (0.17, 0.07, 0.46) with gold trim (0.80, 0.55, 0.16), brown saddle leather, dark strap leather, iron fittings. Skin, shell, fur and fin materials are species specific (section 2). |
| Exclusions | No cameras or lights in the GLB; camera and three area lights are saved in the .blend for the review renders. No external meshes, textures or protected designs. |
| Visual checks (rendered on the remote machine, sequentially, one Blender process at a time) | front, side, three-quarter, slow-travel and fast-travel stills at 1024x768 orthographic; later a ride set with the V9 rider once a per-species ride solve exists. Pass criteria: silhouette cannot be mistaken for a horse or for any other pack species from any of the five views; seat node sits on a visible seat surface; no tack vertex inside the body; feet on the floor in travel stills; surface is smooth and sculpted (no visible primitive seams) at the same reading distance as the Sedgehorn stills. |

Automated checks every author script writes into `glbChecks`: clip set and durations, one skin with the planned
joint count, lowest point on the floor, forward is -Z, rider reference nodes present, no cameras or lights,
loop closure, planted feet on the floor, tack outside the body, reins clear of the body, triangle budget, plus
the species checks listed below.

Run command (render machine only, never on the authoring Mac): `blender -b -t 4 --factory-startup --python
author_<species>.py`. Author scripts keep the metaball resolution at 0.045 to 0.055 m so peak memory stays
near the Sedgehorn's 305 MB.

## 2. Species sheets

### 2.1 Ironback pack beetle (`ironback_beetle/`)

- Silhouette: broad, low, six-legged. 3.9 m long including mandibles, 2.7 m across the planted feet, shell
  1.52 m high. A front pronotum shield overhangs a small tucked head with short down-curved mandibles and
  clubbed antennae. Behind it five stepped, overlapping dorsal plates (elytra bands) with bronze rims. The
  knees rise beside the shell. Nothing equine: no neck, no long head, no hooves, no mane or tail.
- Scale and seat: cargo saddle on the first plate, just behind the pronotum rim (the rim is the natural
  pommel). Current export seat 1.577 m. Stirrup pegs are bolted to the plate rim at x = ±0.93 (tread 0.505 m below the
  seat), so the rider's legs drape over the dome like an elephant rider. Side panniers and a bundle roll
  behind the cantle carry the hauling role. Extra nodes `Pack.L/R` (`cargo_socket`).
- Reins: no bridle. Two guide lines from bronze hooks on the pronotum front rim back to the rider's hands.
- Rig (34 joints): Root, Thorax (keyed), Abdomen, Head, Mandible.L/R, Antenna1/2.L/R, six legs x
  Coxa/Femur/Tibia/Tarsus. Legs stride by yawing the coxa around the vertical, so stance feet stay on the
  floor without extra solving.
- Clips: `Idle` 96 f (antennae, mandibles, breathing), `Trundle` 40 f (alternating tripod walk),
  `Haul` 24 f (faster tripod, knees up, body carried low). Map: RideWalk -> Trundle, RideRun -> Haul.
- Palette: iron blue-black shell (rough 0.32, slight metallic), bronze rims, warm umber underbelly and legs,
  dark faceted compound eyes, olive-drab canvas panniers, violet blanket with gold trim.
- Budget: ~36k triangles (body 12k, plates ~1.3k each, tack and cargo ~8k).

### 2.2 Reedskipper newt (`reedskipper_newt/`)

- Silhouette: low-slung amphibian. 5.0 m from snout to tail tip, back only 0.98 m high, 1.9 m across the
  sprawled feet. Broad flat head with raised frog-like eyes, three pairs of feathery coral gill frills behind
  the head, sprawled legs with elbows out and webbed four-toed feet, long laterally flattened tail with a
  dorsal fin crest from mid-back to the tip and a ventral fin under the tail.
- Scale and seat: ridge saddle behind the gills at y ~0.45. Current export seat 1.043 m. Swim draft (waterline when
  the mount swims) is published at Z = 0.62 m; the seat sits 0.423 m above it and the stirrup treads
  (x = ±0.62, 0.346 m below the seat) stay 0.077 m above it. This is the "knees up" perch exception; the
  manifest records the drop so the rider solve can accept it.
- Reins: soft headstall behind the eyes plus a nose loop; reins to the hands.
- Rig (27 joints): Root, Pelvis (keyed), Spine1, Spine2, Chest, Neck, Head, Jaw, Tail1-5, Gill.L/R,
  four legs x Upper/Lower/Foot.
- Clips: `Idle` 96 f (throat pulse, gill flutter, tail sway), `Crawl` 48 f (sprawling diagonal walk with
  lateral spine wave), `Swim` 24 f (legs tucked, travelling tail wave; no floor solve, draft documented).
  Map: RideWalk -> Crawl, RideRun -> Swim.
- Palette: wet dark teal back (rough 0.25, high sheen), cream-yellow belly, orange spots via vertex colour,
  coral gills, translucent-looking paler fin, gold eyes.
- Budget: ~32k triangles.

### 2.3 Cragclaw gecko (`cragclaw_gecko/`)

- Silhouette: compact, stocky climber. 3.6 m snout to tail tip, back 1.05 m high, 1.8 m across the splayed
  feet. Broad triangular head with large side-set eyes under brow ridges, wide mouth, knobbly tubercle rows
  along the back, five-toed splayed feet with round gripping toe pads, long thick counterbalance tail carried
  curled up off the ground.
- Scale and seat: climbing saddle between shoulders and hips, high cantle, knee rolls, breast collar and a
  crupper under the tail root so the saddle cannot slide on steep routes. Current export seat 1.123 m, stirrups at
  x = ±0.58, 0.446 m below the seat.
- Reins: light headstall and reins to the hands.
- Rig (23 joints): Root, Pelvis (keyed), Spine, Chest, Neck, Head, Jaw, Tail1-4, four legs x
  Upper/Lower/Foot.
- Clips: `Idle` 96 f (head tilt, throat pulse, tail-tip curl), `Creep` 56 f (deliberate high-lift diagonal
  walk), `Scurry` 24 f (fast diagonal trot with lateral body wave). Map: RideWalk -> Creep, RideRun -> Scurry.
- Palette: slate blue-grey skin with ochre bands and a pale throat (rough 0.6, bump 0.35 for grain), pale
  toe pads, amber eyes with dark vertical pupils, darker tubercles.
- Budget: ~33k triangles.

### 2.4 Barrow mole (`barrow_mole/`)

- Silhouette: heavy pear-shaped burrower. 3.9 m long, 1.75 m at the shoulder hump, 1.6 m across the
  shoulders. No neck: the wedge snout continues straight out of the shoulders with a pink nose pad and tiny
  bead eyes. Huge outward-facing spade forepaws with five long ivory claws, short plantigrade hind feet,
  stubby tail. Five overlapping dorsal plates from the neck to the rump sit in the fur, plus two shoulder
  guard plates.
- Scale and seat: saddle behind the shoulder hump between dorsal plates two and three (the plate ahead acts
  as a pommel). Current export seat 1.662 m, stirrups at x = ±0.76, 0.466 m below the seat.
- Reins: no bit. A broad head harness behind the snout with two lead lines to the hands.
- Rig (19 joints): Root, Pelvis (keyed), Spine, Chest, Head, Snout, Tail, four legs x Upper/Lower/Paw.
- Clips: `Idle` 96 f (breathing, snout wiggle, head sweep), `Shuffle` 44 f (lateral-sequence walk, heavy
  roll, head low), `Lope` 24 f (bounding gallop), `Dig` 36 f (in place: alternating outward claw strokes,
  body low, snout driving forward; staged for the tunnelling role). Map: RideWalk -> Shuffle,
  RideRun -> Lope; `Dig` is listed as an extra role clip.
- Palette: dark umber fur (rough 0.95, sheen 0.3, bump 0.3), warm grey-brown flanks, pale muzzle, pink nose,
  iron-brown plates with lighter worn edges, ivory claws.
- Budget: ~34k triangles.

### 2.5 Aether ray (`aether_ray/`)

- Silhouette: wide gliding manta form. 6.0 m wingspan, 3.2 m body chord, tail to 4.6 m behind the head.
  Thin tapering wing membrane, two forward-curling cephalic lobes framing a wide mouth, side-set eyes, small
  dorsal fin, long whip tail with a diamond fin. Glowing aether spots along the wings (separate emissive
  spot meshes so the glow exports to glTF). Not a winged quadruped: no legs at all.
- Scale and seat: a raised dorsal riding platform (padded deck with a tall seat base) behind the head.
  Current export seat 1.148 m above the landed origin; stirrup loops on the deck at x = ±0.60, 0.540 m below the
  seat. A curved grip rail replaces reins; its hand points are exported as `ReinHand.L/R` so the rider arm
  solve is unchanged, plus `Rail.L/R` (`rail_grip`) at the rail ends.
- Rig (16 joints): Root, Body (keyed hover bob), Head, Lobe.L/R, WingA/B/C.L/R, Tail1-4, Fin.
- Clips: `Idle` 96 f (landed: wing-tip ripple upward only, lobes curl, tail sway), `Glide` 48 f (slow
  travelling wing wave, small amplitude), `Soar` 32 f (deep flap with body pitch). Map: RideWalk -> Glide,
  RideRun -> Soar. Manifest publishes `flightClipLowestPointMeters` so the runtime keeps flight altitude above
  the wing dip.
- Palette: deep indigo dorsal skin fading to pale lavender-white underside (rough 0.35, sheen 0.4), darker
  gill bands underneath, aether-cyan emissive spots (emission strength 4), violet deck with gold trim.
- Budget: ~26k triangles.

## 3. Open items after rendering

1. Per-species rider solve: the V9 `author_v9_game.py` reads one mount manifest; it needs a mount argument
   and per-species `RIDER_SEAT_OFFSET` before ride stills exist. Not part of this pack.
2. Runtime `characterCatalog.ts` requires `Idle/Walk/Run` names. These species use mapped names on purpose;
   a catalog entry per species should read `riderClipMap` from the manifest. Not part of this pack.
3. Newt swim draft and ray flight altitude are documentation only until traversal exists.
4. Review front, side, three-quarter and motion stills for all five current exports before visual approval.
   Inspect `tackClearance` alongside the images: Aether ray stirrup loops have 32 vertices about 2 cm inside
   the body despite passing structural checks, so confirm whether the attachment is hidden or visibly clips.
   Organic features rooted in the body on purpose (newt gills, gecko brow ridges) can also report inside
   vertices; structural checks alone do not establish visual fit or rider readiness.
