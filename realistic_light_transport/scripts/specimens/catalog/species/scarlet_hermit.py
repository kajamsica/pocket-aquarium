"""Paguristes cadenati (scarlet reef hermit crab): species-local anomuran hermit body plan.

No shared crustacean plan exists, so this module defines build(spec, species, ctx) itself.
Design units in asset.source.json are millimetres; the finished mesh is uniformly rescaled so its
+X extent equals referenceSize.meters, the walking-leg tips rest on z = 0 and it is centred on x = 0
(origin base_center).

Anatomy choices (family Diogenidae, the left-handed hermits):
- Borrowed dextral turbinate gastropod shell: one closed loft along a logarithmic helico-spiral (axis-
  referenced ring frames, oblique lip, flared rim, recessed aperture floor). It sits low and behind the
  animal: the aperture wraps the rear of the cephalothorax at body height and faces forward and down, the
  lower body whorl rests within about half a millimetre of the substrate, and the spire points back,
  slightly up and towards the crab's right (a dextral carry). With the aperture facing forward-down the
  shell's coiling axis can only lie about 40 degrees off the back-up direction, so a straight-back spire
  would force it either level or lifted; back-right-slightly-up is the realistic compromise.
- Cephalothorax: a superellipse-section loft that leaves the aperture obliquely. Its posterior part sits
  inside the shell (the membranous posterior carapace, painted pale); the calcified shield is a little
  longer than wide with almost parallel sides, a cervical groove and a rounded anterior margin (Forest 1954).
- Chelipeds: merus + carpus tube, propodus (palm plus fixed finger) tube and a hinged dactyl tube per
  side. Both chelae are scarlet; the left is about 8 percent larger than the right, the Diogenidae
  convention summarised for this species (so the two chelae are not declared symmetric).
- Two visible walking-leg pairs (pereopods 2 and 3), each a three-bone segmented tube whose dactyl tip
  rests on the substrate. The abdomen is not modelled: it is hidden inside the shell.
- Long yellow eyestalks (a little swollen distally) with dark green-black corneas, upright antennules
  and long deep-red antennal flagella.
Rig: Root -> Shell -> Body -> limbs. The Shell bone stands at the shell's ground contact, so in the walk
the dragged shell rolls, pitches, lifts and surges about that contact and carries the body and limbs with
it, while the retreat translates Body alone into the aperture.
Clips: rest (antennae, antennules and eyestalks twitch, dactyls flex), walk (alternating tetrapod gait,
shell dragged with the body: rolls, pitches, bobs and surges about its ground contact), retreat (body slides
into the shell along the aperture axis, legs fold up, chelae swing in and up over the aperture and close,
eyes and antennae fold back).
Everything is generated from fixed coordinates and seeded noise, so rebuilds are bit-identical.
"""

from __future__ import annotations

import math

import numpy as np
from mathutils import Matrix, Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import paint, textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.noise import fbm, smoothstep
from ..lib.rigging import RigBuilder, segment_weights

SIDES = ((-1, "L"), (1, "R"))

# ---------------------------------------------------------------- texture atlas (4 x 2 tiles, one exo material)

ATLAS_COLUMNS, ATLAS_ROWS = 4, 2
TILES = {"carapace": (0, 0), "leg": (1, 0), "cheliped": (2, 0), "palm": (3, 0),
         "dactyl": (0, 1), "eyestalk": (1, 1), "antenna": (2, 1), "cornea": (3, 1)}


def tile_transform(tile: str):
    col, row = TILES[tile]

    def transform(u, v):
        return ((col + 0.02 + u * 0.96) / ATLAS_COLUMNS, (row + 0.02 + v * 0.96) / ATLAS_ROWS)

    return transform


def _granules(U, V, density, radius, seed):
    return paint.spots(U, V, density, radius, seed=seed, jitter_radius=0.3)


def _limb_tile(U, V, palette, seams, granule_density=34.0, granule_radius=0.2, seed=3, tip_dark=0.55):
    scarlet = np.asarray(palette["exoskeleton"])
    pale = np.asarray(palette["granule"])
    dark = np.asarray(palette["seam"])
    granules = _granules(U, V, granule_density, granule_radius, seed)
    albedo = textures.rgba(scarlet, 1.0, U.shape)
    albedo = textures.mix(albedo, pale, granules * 0.6)
    shade = 0.88 + 0.24 * fbm(U * 9.0, V * 5.0, octaves=3, seed=seed + 40)
    albedo = textures.scale_rgb(albedo, shade)
    seam = np.zeros_like(U)
    for s in seams:
        seam = np.maximum(seam, paint.band(U, s, 0.014, 0.012))
    albedo = textures.mix(albedo, dark, seam * 0.75)
    # slightly paler arthrodial membrane just distal of every joint
    membrane = np.zeros_like(U)
    for s in seams:
        membrane = np.maximum(membrane, paint.band(U, s + 0.03, 0.012, 0.01))
    albedo = textures.mix(albedo, palette["membrane"], membrane * 0.5)
    tip = smoothstep(0.86, 1.0, U)
    albedo = textures.mix(albedo, palette["tip"], tip * tip_dark)
    height = np.clip(0.5 + 0.34 * (granules - 0.35) - 0.3 * seam + 0.06 * (fbm(U * 40, V * 20, 2, seed=seed + 7) - 0.5), 0.0, 1.0)
    roughness = np.clip(0.40 - 0.14 * granules + 0.18 * seam + 0.08 * tip, 0.0, 1.0)
    return albedo, height, roughness


def paint_exo(width: int, height: int, palette: dict):
    """Atlas for every scarlet exoskeleton part plus eyestalk, antenna and cornea tiles."""
    tile_w, tile_h = width // ATLAS_COLUMNS, height // ATLAS_ROWS
    albedo_atlas = np.zeros((height, width, 4), dtype=np.float64)
    height_atlas = np.full((height, width), 0.5, dtype=np.float64)
    rough_atlas = np.full((height, width), 0.4, dtype=np.float64)
    U, V = textures.uv_grid(tile_w, tile_h)

    def place(tile, albedo, hgt, rough):
        col, row = TILES[tile]
        window = (slice(row * tile_h, (row + 1) * tile_h), slice(col * tile_w, (col + 1) * tile_w))
        albedo_atlas[window] = albedo
        height_atlas[window] = hgt
        rough_atlas[window] = rough

    # carapace: u runs from inside the shell (0) to the anterior margin (1); v = 0 is dorsal
    scarlet = np.asarray(palette["exoskeleton"])
    granules = _granules(U, V, 30.0, 0.19, 5)
    albedo = textures.rgba(scarlet, 1.0, U.shape)
    albedo = textures.mix(albedo, palette["granule"], granules * 0.55)
    dorsal = 0.5 + 0.5 * np.cos(V * math.tau)
    albedo = textures.scale_rgb(albedo, 0.86 + 0.26 * fbm(U * 7.0, V * 4.0, 3, seed=21) + 0.06 * dorsal)
    # u ~0.62 is where the body leaves the shell lip: behind it lies the pale membranous posterior carapace,
    # the cervical groove marks the start of the calcified shield
    posterior = 1.0 - smoothstep(0.56, 0.64, U)
    albedo = textures.mix(albedo, palette["membrane"], posterior * 0.85)
    cervical = paint.band(U, 0.66, 0.012, 0.012)
    albedo = textures.mix(albedo, palette["seam"], cervical * 0.7)
    # shallow paired shield grooves (Forest: deep depressions behind the frontal margin and on the sides)
    grooves = paint.band(V, 0.12, 0.012, 0.012) + paint.band(V, 0.88, 0.012, 0.012)
    grooves = np.clip(grooves, 0.0, 1.0) * smoothstep(0.68, 0.74, U) * (1.0 - smoothstep(0.92, 0.97, U))
    # a slightly paler, more orange shield than the limbs
    albedo = textures.mix(albedo, palette["granule"], smoothstep(0.66, 0.72, U) * 0.12)
    albedo = textures.mix(albedo, palette["seam"], grooves * 0.45)
    hgt = np.clip(0.5 + 0.3 * (granules - 0.35) * (1.0 - posterior) - 0.3 * cervical - 0.2 * grooves, 0.0, 1.0)
    rough = np.clip(0.38 - 0.12 * granules + 0.25 * posterior + 0.15 * cervical, 0.0, 1.0)
    place("carapace", albedo, hgt, rough)

    place("leg", *_limb_tile(U, V, palette, (1 / 3, 2 / 3), 36.0, 0.19, seed=3, tip_dark=0.6))
    place("cheliped", *_limb_tile(U, V, palette, (0.5,), 30.0, 0.21, seed=9, tip_dark=0.0))
    place("palm", *_limb_tile(U, V, palette, (0.62,), 22.0, 0.27, seed=13, tip_dark=0.5))
    place("dactyl", *_limb_tile(U, V, palette, (), 26.0, 0.24, seed=17, tip_dark=0.6))

    # eyestalk: yellow, a little orange at the base, paler distal swelling
    yellow = np.asarray(palette["eyestalk"])
    albedo = textures.rgba(yellow, 1.0, U.shape)
    albedo = textures.mix(albedo, palette["eyestalkBase"], (1.0 - smoothstep(0.1, 0.45, U)) * 0.7)
    albedo = textures.mix(albedo, (0.97, 0.9, 0.55), smoothstep(0.75, 0.95, U) * 0.4)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.14 * fbm(U * 12.0, V * 4.0, 2, seed=31))
    place("eyestalk", albedo, np.full(U.shape, 0.5) + 0.05 * (fbm(U * 30, V * 12, 2, seed=33) - 0.5), np.full(U.shape, 0.36))

    # antenna: deep red with fine annulations along its length
    deep = np.asarray(palette["antenna"])
    albedo = textures.rgba(deep, 1.0, U.shape)
    annuli = 0.5 + 0.5 * np.cos(U * math.tau * 38.0)
    albedo = textures.scale_rgb(albedo, 0.75 + 0.5 * annuli ** 3)
    albedo = textures.mix(albedo, palette["membrane"], smoothstep(0.9, 1.0, U) * 0.5)
    place("antenna", albedo, np.clip(0.5 + 0.25 * (annuli - 0.5), 0.0, 1.0), np.full(U.shape, 0.45))

    cornea = np.asarray(palette["cornea"])
    albedo = textures.rgba(cornea, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.3 * fbm(U * 20.0, V * 10.0, 2, seed=41))
    place("cornea", albedo, np.full(U.shape, 0.5), np.full(U.shape, 0.14))
    return {"albedo": albedo_atlas, "roughness": textures.grey(rough_atlas), "normal": textures.normal_from_height(height_atlas, 1.0)}


def paint_shell(width: int, height: int, palette: dict):
    """Tan turbinate shell: growth striae, spiral cords and colour bands, eroded whitish apex, algal film."""
    U, V = textures.uv_grid(width, height)
    base = textures.rgba(palette["shell"], 1.0, U.shape)
    flame = fbm(U * 70.0, V * 4.0, octaves=3, seed=11)
    flame_mask = smoothstep(0.52, 0.68, flame) * smoothstep(0.25, 0.5, U)
    albedo = textures.mix(base, palette["shellBrown"], flame_mask * 0.8)
    wobble = (fbm(U * 30.0, V * 3.0, 2, seed=12) - 0.5) * 0.05
    for centre, half in ((0.17, 0.035), (0.5, 0.045), (0.83, 0.03)):
        band = paint.band(V + wobble, centre, half, 0.02)
        albedo = textures.mix(albedo, palette["shellBrown"], band * 0.55)
    apex = (1.0 - smoothstep(0.25, 0.6, U)) * (0.5 + 0.5 * fbm(U * 25.0, V * 6.0, 3, seed=14))
    albedo = textures.mix(albedo, palette["shellWorn"], np.clip(apex * 1.3, 0.0, 1.0))
    algae = smoothstep(0.58, 0.75, fbm(U * 18.0, V * 5.0, 3, seed=15)) * (1.0 - smoothstep(0.6, 0.9, U))
    albedo = textures.mix(albedo, palette["shellAlgae"], algae * 0.6)
    lip = smoothstep(0.965, 1.0, U)
    albedo = textures.mix(albedo, palette["shellWorn"], lip * 0.7)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.2 * fbm(U * 90.0, V * 30.0, 2, seed=16))
    striae = paint.shell_growth_lines(U, V, count=120.0, strength=0.6, seed=4)
    cords = 0.5 + 0.5 * np.sin(V * math.tau * 9.0 + (fbm(U * 12.0, V * 2.0, 2, seed=17) - 0.5) * 0.6)
    grain = fbm(U * 120.0, V * 40.0, 2, seed=18)
    hgt = np.clip(0.5 + 0.28 * (striae - 0.5) + 0.22 * (cords - 0.5) + 0.12 * (grain - 0.5) + 0.15 * (algae - 0.3), 0.0, 1.0)
    rough = np.clip(0.60 - 0.1 * (cords - 0.5) + 0.2 * algae + 0.1 * apex - 0.15 * lip, 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(rough), "normal": textures.normal_from_height(hgt, 1.0)}


# ---------------------------------------------------------------- geometry helpers

def _v(p) -> Vector:
    return Vector((float(p[0]), float(p[1]), float(p[2])))


def limb_part(name: str, joints, radii, bones, ring_segments: int, material: str, tile: str, tip_radius=None,
              aspect: float = 1.0, attach_rings: int = 3, groups=(), fractions=(0.12, 0.3, 0.55, 0.8),
              joint_pinch: float = 0.78, taper_last: bool = False, up_hint=(0.0, 0.0, 1.0)) -> msh.MeshPart:
    """Segmented arthropod limb: one closed tube through the joints, pinched at every articulation.

    Segment k (joints[k] -> joints[k+1]) is skinned rigidly to bones[k]; the shared joint ring blends
    50/50 so the exoskeleton flexes only at the articulation. `attach_rings` first rings are grouped as
    attach_<name> (they sit inside the parent body and are excluded from clearance checks)."""
    n = len(joints) - 1
    points, ring_radii, ring_weights, u_values = [], [], [], []
    for k in range(n):
        a, b = _v(joints[k]), _v(joints[k + 1])
        r = float(radii[k])
        last = k == n - 1
        if k == 0:
            points.append(tuple(a))
            ring_radii.append(r * 0.92)
            ring_weights.append({bones[0]: 1.0})
            u_values.append(0.0)
        for f in fractions:
            points.append(tuple(a.lerp(b, f)))
            if last and taper_last:
                t = msh.smoothstep(f)
                ring_radii.append(r * (1.0 - t) + float(tip_radius if tip_radius is not None else r * 0.3) * t)
            else:
                ring_radii.append(r * (1.0 + 0.07 * math.sin(math.pi * f)))
            ring_weights.append({bones[k]: 1.0})
            u_values.append((k + f) / n)
        points.append(tuple(b))
        if last:
            ring_radii.append(float(tip_radius) if tip_radius is not None else r * 0.85)
            ring_weights.append({bones[k]: 1.0})
        else:
            ring_radii.append(min(r, float(radii[k + 1])) * joint_pinch)
            ring_weights.append({bones[k]: 0.5, bones[k + 1]: 0.5})
        u_values.append((k + 1) / n)
    geometry = msh.tube(points, ring_radii, ring_segments, True, True, up_hint, aspect, None, u_values)
    ring_count = len(points)
    body_count = ring_count * ring_segments

    def weight_fn(index, vertex):
        if index >= body_count:
            return dict(ring_weights[0] if index == body_count else ring_weights[-1])
        return dict(ring_weights[index // ring_segments])

    total = len(geometry[0])
    part_groups = {f"attach_{name}": set(range(attach_rings * ring_segments)) | {body_count}}
    for group in groups:
        part_groups[group] = set(range(total))
    return msh.make_part(name, geometry, material, weight_fn, closed=True, groups=part_groups, uv_transform=tile_transform(tile))


def curve_part(name: str, points, radii, bones, ring_segments: int, material: str, tile: str, attach_rings: int = 2,
               groups=(), softness: float = 0.7) -> msh.MeshPart:
    """Closed tube along a smooth polyline, skinned along `bones` by arc length (whip-like antennae)."""
    pts = [_v(p) for p in points]
    lengths = [0.0]
    for a, b in zip(pts, pts[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    u_values = [d / lengths[-1] for d in lengths]
    geometry = msh.tube([tuple(p) for p in pts], list(radii), ring_segments, True, True, (0.0, 0.0, 1.0), 1.0, None, u_values)
    ring_count = len(pts)
    body_count = ring_count * ring_segments

    def weight_fn(index, vertex):
        if index >= body_count:
            t = 0.0 if index == body_count else 1.0
        else:
            t = u_values[index // ring_segments]
        return segment_weights(t, list(bones), softness)

    total = len(geometry[0])
    part_groups = {f"attach_{name}": set(range(attach_rings * ring_segments)) | {body_count}}
    for group in groups:
        part_groups[group] = set(range(total))
    return msh.make_part(name, geometry, material, weight_fn, closed=True, groups=part_groups, uv_transform=tile_transform(tile))


def ellipsoid_part(name, center, radii, direction, segments, rings, material, tile, bone, groups=()):
    rotation = Vector((0.0, 0.0, 1.0)).rotation_difference(_v(direction).normalized()).to_matrix()
    geometry = msh.ellipsoid(tuple(_v(center)), tuple(radii), segments, rings, rotation)
    part_groups = {group: set(range(len(geometry[0]))) for group in groups}
    return msh.make_part(name, geometry, material, lambda i, v: {bone: 1.0}, closed=True, groups=part_groups,
                         uv_transform=tile_transform(tile))


def scale_part_about(part: msh.MeshPart, center, factor: float) -> msh.MeshPart:
    c = _v(center)
    part.vertices = [tuple(c + (_v(p) - c) * factor) for p in part.vertices]
    return part


def scale_point_about(point, center, factor: float):
    c = _v(center)
    return tuple(c + (_v(point) - c) * factor)


# ---------------------------------------------------------------- shell

def build_shell(cfg: dict):
    """Closed helico-spiral loft in shell-local space (coiling axis = +Z, apex up), dextral coiling.

    Returns (geometry, lip_center, lip_tangent, u_values): the lip ring centre and the outward aperture
    tangent are used to seat the shell around the crab."""
    r_ap = float(cfg["apertureRadius"])
    turns = float(cfg["turns"])
    growth = float(cfg["growth"])
    whorl_offset = float(cfg["whorlOffset"])
    descent = float(cfg["descent"])
    rings_per_turn = int(cfg["ringsPerTurn"])
    segments = int(cfg["ringSegments"])
    shoulder = float(cfg.get("shoulder", 0.08))
    aperture_descent = float(cfg.get("apertureDescent", 0.0))
    count = int(round(turns * rings_per_turn))
    s_values = [i / count for i in range(count + 1)]
    centers, radii = [], []
    for s in s_values:
        r = r_ap * math.exp(growth * (s - 1.0))
        theta = math.tau * turns * s
        d = whorl_offset * r
        # the last part of the body whorl descends along the axis so the aperture is oblique (faces partly
        # towards the base), which is what lets a hermit hold the spire tilted back
        drop = aperture_descent * r_ap * msh.smoothstep((s - 0.82) / 0.18)
        # clockwise seen from the apex: a dextral shell (aperture on the right with the apex up)
        centers.append((d * math.cos(theta), -d * math.sin(theta), -descent * r - drop))
        radii.append(r)
    # axis-referenced frames (not rotation-minimising): the ring "normal" always points along the coiling
    # axis, so spiral bands stay level and the lip tilt is towards the base as intended
    axis_dir = Vector((0.0, 0.0, 1.0))
    frames = []
    for index in range(len(centers)):
        previous = Vector(centers[max(index - 1, 0)])
        following = Vector(centers[min(index + 1, len(centers) - 1)])
        tangent = (following - previous).normalized()
        normal = (axis_dir - tangent * axis_dir.dot(tangent)).normalized()
        binormal = tangent.cross(normal).normalized()
        frames.append((tangent, normal, binormal))
    lip_tilt = math.radians(float(cfg.get("lipTiltDegrees", 0.0)))
    rings = []
    tilted = None
    for s, center, radius, (tangent, normal, binormal) in zip(s_values, centers, radii, frames):
        c = Vector(center)
        # the aperture plane of a turbinate shell is inclined to the axis: tilt the last rings about the
        # lateral (binormal) direction so the opening faces partly towards the base
        phi = lip_tilt * msh.smoothstep((s - 0.88) / 0.12)
        tilted_normal = (normal * math.cos(phi) + tangent * math.sin(phi)).normalized()
        tilted = (tangent * math.cos(phi) - normal * math.sin(phi)).normalized(), tilted_normal, binormal
        # radial direction away from the coiling axis, expressed in the ring plane
        outward = Vector((c.x, c.y, 0.0))
        outward = outward.normalized() if outward.length > 1e-9 else tilted_normal
        ring = []
        for seg in range(segments):
            a = seg / segments * math.tau
            offset = tilted_normal * math.cos(a) + binormal * math.sin(a)
            # a subtle shoulder on the outer face so the whorls read as a turbinate shell, not a hose
            factor = 1.0 + shoulder * max(offset.dot(outward), 0.0) ** 2 * math.cos(a * 2.0) ** 2
            ring.append(tuple(c + offset * (radius * factor)))
        rings.append(ring)
    u_values = list(s_values)
    tangent, normal, binormal = tilted
    c_ap = Vector(centers[-1])
    lip_depth = float(cfg.get("lipDepth", 0.25)) * r_ap
    floor_depth = float(cfg.get("floorDepth", 0.25)) * r_ap
    lip_center = c_ap + tangent * lip_depth

    def ring_at(center, radius):
        return [tuple(center + normal * (math.cos(seg / segments * math.tau) * radius) + binormal * (math.sin(seg / segments * math.tau) * radius))
                for seg in range(segments)]

    flare = float(cfg.get("lipFlare", 1.07))
    rings.append(ring_at(lip_center, r_ap * flare))
    u_values.append(1.0)
    rings.append(ring_at(lip_center, r_ap * flare * 0.93))
    u_values.append(1.0)
    rings.append(ring_at(lip_center - tangent * floor_depth, r_ap * float(cfg.get("floorRadius", 0.72))))
    u_values.append(1.0)
    geometry = msh.loft(rings, u_values=u_values, cap_start=True, cap_end=True)
    return geometry, lip_center, tangent.normalized()


def shell_placement(lip_tangent: Vector, aperture_direction, spire_direction) -> Matrix:
    """Rotation taking the coiling axis (+Z local) exactly onto the requested spire direction, then rolled
    about that axis so the aperture normal points as close as possible to the requested aperture direction
    (the angle between axis and aperture normal is fixed by the shell geometry)."""
    spire = _v(spire_direction).normalized()
    first = Vector((0.0, 0.0, 1.0)).rotation_difference(spire).to_matrix()
    normal = first @ lip_tangent.normalized()
    wanted = _v(aperture_direction).normalized()
    normal_p = normal - spire * normal.dot(spire)
    wanted_p = wanted - spire * wanted.dot(spire)
    if normal_p.length < 1e-9 or wanted_p.length < 1e-9:
        return first
    normal_p.normalize()
    wanted_p.normalize()
    roll = math.atan2(spire.dot(normal_p.cross(wanted_p)), normal_p.dot(wanted_p))
    return Matrix.Rotation(roll, 3, spire) @ first


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morph = spec["morphology"]
    palette = spec["palette"]
    anim = spec["animation"]
    tex = spec.get("textures", {})

    # ---- textures & materials
    exo_w, exo_h = tex.get("exoResolution", [1024, 512])
    shell_w, shell_h = tex.get("shellResolution", [1024, 512])
    written = []
    images = {}
    for label, painted in (("exo", paint_exo(exo_w, exo_h, palette)), ("shell", paint_shell(shell_w, shell_h, palette))):
        for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
            path = ctx.texture_dir / f"{label}-{key}.png"
            images[f"{label}-{key}"] = textures.write_image(f"{prefix}_{label}_{key}", path, painted[key], non_color)
            written.append(path)
    exo_material = mat.principled(f"{prefix}_Exoskeleton", palette["exoskeleton"], 0.4, coat=0.18, specular=0.45, subsurface=0.02)
    mat.attach_textures(exo_material, albedo=images["exo-albedo"], roughness=images["exo-roughness"], normal=images["exo-normal"],
                        normal_strength=float(tex.get("exoNormalStrength", 0.6)))
    shell_material = mat.principled(f"{prefix}_Shell", palette["shell"], 0.6, coat=0.04, specular=0.3, subsurface=0.04)
    mat.attach_textures(shell_material, albedo=images["shell-albedo"], roughness=images["shell-roughness"], normal=images["shell-normal"],
                        normal_strength=float(tex.get("shellNormalStrength", 0.7)))
    cornea_material = mat.principled(f"{prefix}_Cornea", palette["cornea"], 0.12, coat=0.7, specular=0.55, subsurface=0.0)
    material_map = {"exo": exo_material, "shell": shell_material, "cornea": cornea_material}

    # ---- shell (design units): the lip centre sits on the midline at apertureHeight above the substrate,
    # at body height, so the aperture wraps the rear of the cephalothorax; apertureHeight is tuned so the
    # lower body whorl comes within about half a millimetre of z = 0 while the leg tips define z = 0
    shell_cfg = morph["shell"]
    shell_geometry, lip_center_local, lip_tangent_local = build_shell(shell_cfg)
    rotation = shell_placement(lip_tangent_local, shell_cfg["apertureDirection"], shell_cfg["spireDirection"])
    aperture_world = (rotation @ lip_tangent_local).normalized()
    placed = [rotation @ (Vector(v) - lip_center_local) for v in shell_geometry[0]]
    A = Vector((0.0, 0.0, float(shell_cfg["apertureHeight"])))  # aperture (lip) centre in design space
    shell_vertices = [tuple(v + A) for v in placed]
    shell_geometry = (shell_vertices, shell_geometry[1], shell_geometry[2], shell_geometry[3])
    shell_part = msh.make_part("shell", shell_geometry, "shell", lambda i, v: {"Shell": 1.0}, closed=True)
    shell_low, shell_high = shell_part.bounds()
    shell_contact = Vector(min(shell_vertices, key=lambda v: (v[2], v[0], v[1])))

    # ---- cephalothorax axis: deep inside the aperture, through the throat, then levelling out forward.
    # The body leaves the opening at its own angle (exitDirection), obliquely to the aperture plane.
    cara = morph["carapace"]
    exit_dir = _v(cara.get("exitDirection", shell_cfg["apertureDirection"])).normalized()
    axis_points = [A - exit_dir * float(cara["insideDepth"])]
    axis_points += [A + exit_dir * float(d) for d in cara["throat"]]
    cursor = axis_points[-1].copy()
    for dx, dz in cara["forward"]:
        cursor = cursor + Vector((float(dx), 0.0, float(dz)))
        axis_points.append(cursor)
    radii = [float(r) for r in cara["radii"]]
    if len(radii) != len(axis_points):
        raise ValueError("morphology.carapace.radii must list one radius per axis point")
    exp_dorsal, exp_ventral = (float(e) for e in cara.get("exponents", [2.8, 2.2]))

    def carapace_ring(index, angle):
        c, s = math.cos(angle), math.sin(angle)
        n = exp_dorsal if c >= 0 else exp_ventral
        return (abs(c) ** n + abs(s) ** n) ** (-1.0 / n)

    lengths = [0.0]
    for a, b in zip(axis_points, axis_points[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    cara_u = [d / lengths[-1] for d in lengths]
    carapace_geometry = msh.tube([tuple(p) for p in axis_points], radii, int(cara.get("ringSegments", 24)), True, True,
                                 (0.0, 0.0, 1.0), float(cara.get("aspect", 1.4)), carapace_ring, cara_u)
    carapace_part = msh.make_part("carapace", carapace_geometry, "exo", lambda i, v: {"Body": 1.0}, closed=True,
                                  uv_transform=tile_transform("carapace"))

    def axis_z(x: float) -> float:
        pts = axis_points
        if x <= pts[0].x:
            return pts[0].z
        for a, b in zip(pts, pts[1:]):
            if a.x <= x <= b.x:
                t = (x - a.x) / max(b.x - a.x, 1e-9)
                return a.z + (b.z - a.z) * t
        return pts[-1].z

    def on_body(p, side):
        """Point given as [x, |y|, dz from the carapace axis at x] for one side (left = -1)."""
        return (float(p[0]), side * abs(float(p[1])), axis_z(float(p[0])) + float(p[2]))

    def sided(p, side):
        """Point given with an absolute z (leg tips on the substrate)."""
        return (float(p[0]), side * abs(float(p[1])), float(p[2]))

    # ---- left-side appendages (side -1, y < 0); the right side is mirrored
    side = -1
    S = "L"
    bones: dict[str, tuple] = {}  # name -> (head, tail, parent)
    body_parts = [carapace_part]
    detail_parts = []
    legs_cfg = morph["legs"]
    for leg in legs_cfg:
        name = leg["name"]
        base = on_body(leg["base"], side)
        knee, ankle = on_body(leg["knee"], side), on_body(leg["ankle"], side)
        tip = sided(leg["tip"], side)
        tag = name.capitalize()
        bone_names = [f"{tag}A_{S}", f"{tag}B_{S}", f"{tag}C_{S}"]
        bones[bone_names[0]] = (base, knee, "Body")
        bones[bone_names[1]] = (knee, ankle, bone_names[0])
        bones[bone_names[2]] = (ankle, tip, bone_names[1])
        body_parts.append(limb_part(f"{name}_{S}", [base, knee, ankle, tip], leg["radii"], bone_names, int(leg.get("ringSegments", 10)),
                                    "exo", "leg", tip_radius=float(leg.get("tipRadius", 0.08)), taper_last=True,
                                    groups=(f"limbs_{S}",)))

    chela = morph["chela"]
    coxa = on_body(chela["coxa"], side)
    merus_end, wrist = on_body(chela["merusEnd"], side), on_body(chela["wrist"], side)
    palm_mid, finger_base, finger_tip = on_body(chela["palmMid"], side), on_body(chela["fingerBase"], side), on_body(chela["fingerTip"], side)
    hinge, dactyl_mid, dactyl_tip = on_body(chela["hinge"], side), on_body(chela["dactylMid"], side), on_body(chela["dactylTip"], side)
    bones[f"Cheliped_{S}"] = (coxa, wrist, "Body")
    bones[f"Palm_{S}"] = (wrist, finger_tip, f"Cheliped_{S}")
    bones[f"Dactyl_{S}"] = (hinge, dactyl_tip, f"Palm_{S}")
    cheliped_part = limb_part(f"cheliped_{S}", [coxa, merus_end, wrist], chela["armRadii"], [f"Cheliped_{S}", f"Cheliped_{S}"],
                              int(chela.get("ringSegments", 10)), "exo", "cheliped", tip_radius=float(chela["armRadii"][1]) * 0.8,
                              attach_rings=3, groups=(f"limbs_{S}", f"chela_{S}"))
    # propodus: wrist -> swollen palm -> fixed finger, taller than wide, u along the length
    palm_radii = [float(r) for r in chela["palmRadii"]]
    palm_points = [_v(wrist), _v(wrist).lerp(_v(palm_mid), 0.35), _v(palm_mid), _v(palm_mid).lerp(_v(finger_base), 0.55),
                   _v(finger_base), _v(finger_base).lerp(_v(finger_tip), 0.45), _v(finger_base).lerp(_v(finger_tip), 0.8), _v(finger_tip)]
    if len(palm_radii) != len(palm_points):
        raise ValueError("morphology.chela.palmRadii must list 8 radii")
    palm_len = [0.0]
    for a, b in zip(palm_points, palm_points[1:]):
        palm_len.append(palm_len[-1] + (b - a).length)
    palm_u = [d / palm_len[-1] for d in palm_len]
    palm_geometry = msh.tube([tuple(p) for p in palm_points], palm_radii, int(chela.get("palmSegments", 12)), True, True,
                             (0.0, 0.0, 1.0), float(chela.get("palmAspect", 0.68)), None, palm_u)
    palm_total = len(palm_geometry[0])
    palm_part = msh.make_part(f"palm_{S}", palm_geometry, "exo", lambda i, v: {f"Palm_{S}": 1.0}, closed=True,
                              groups={f"limbs_{S}": set(range(palm_total)), f"chela_{S}": set(range(palm_total)),
                                      f"attach_palm_{S}": set(range(2 * int(chela.get("palmSegments", 12)))) | {len(palm_points) * int(chela.get("palmSegments", 12))}},
                              uv_transform=tile_transform("palm"))
    dactyl_part = limb_part(f"dactyl_{S}", [hinge, dactyl_mid, dactyl_tip], chela["dactylRadii"], [f"Dactyl_{S}", f"Dactyl_{S}"],
                            int(chela.get("dactylSegments", 8)), "exo", "dactyl", tip_radius=float(chela.get("dactylTipRadius", 0.1)),
                            taper_last=True, attach_rings=3, groups=(f"limbs_{S}", f"chela_{S}"))
    body_parts += [cheliped_part, palm_part, dactyl_part]

    eyes = morph["eyes"]
    eye_base = on_body(eyes["base"], side)
    eye_tip = on_body(eyes["tip"], side)
    bones[f"Eyestalk_{S}"] = (eye_base, eye_tip, "Body")
    detail_parts.append(limb_part(f"eyestalk_{S}", [eye_base, eye_tip], [float(eyes["radius"])], [f"Eyestalk_{S}"], int(eyes.get("ringSegments", 10)),
                                  "exo", "eyestalk", tip_radius=float(eyes["radius"]) * 0.95, attach_rings=2, groups=(f"head_{S}", f"eye_{S}")))
    stalk_dir = _v(eye_tip) - _v(eye_base)
    cornea_center = _v(eye_tip) + stalk_dir.normalized() * float(eyes["corneaRadius"]) * 0.25
    detail_parts.append(ellipsoid_part(f"cornea_{S}", cornea_center, (float(eyes["corneaRadius"]), float(eyes["corneaRadius"]), float(eyes["corneaRadius"]) * 1.15),
                                       stalk_dir, 12, 8, "cornea", "cornea", f"Eyestalk_{S}", groups=(f"head_{S}", f"eye_{S}")))

    antennules = morph["antennules"]
    ant1_base = on_body(antennules["base"], side)
    ant1_tip = on_body(antennules["tip"], side)
    bones[f"Antennule_{S}"] = (ant1_base, ant1_tip, "Body")
    detail_parts.append(limb_part(f"antennule_{S}", [ant1_base, ant1_tip], [float(antennules["radius"])], [f"Antennule_{S}"],
                                  int(antennules.get("ringSegments", 8)), "exo", "antenna", tip_radius=float(antennules.get("tipRadius", 0.09)),
                                  taper_last=True, attach_rings=3, groups=(f"head_{S}",)))

    antennae = morph["antennae"]
    ant_points = [on_body(antennae["base"], side)] + [on_body(p, side) for p in antennae["path"]]
    ant_radii = [float(r) for r in antennae["radii"]]
    if len(ant_radii) != len(ant_points):
        raise ValueError("morphology.antennae.radii must match base + path length")
    mid = (len(ant_points) - 1) // 2
    bones[f"AntennaA_{S}"] = (ant_points[0], ant_points[mid], "Body")
    bones[f"AntennaB_{S}"] = (ant_points[mid], ant_points[-1], f"AntennaA_{S}")
    detail_parts.append(curve_part(f"antenna_{S}", ant_points, ant_radii, [f"AntennaA_{S}", f"AntennaB_{S}"], int(antennae.get("ringSegments", 7)),
                                   "exo", "antenna", attach_rings=2, groups=(f"head_{S}",)))

    # ---- mirror to the right, then enlarge the left chela (Diogenidae: left chela slightly larger)
    rename = {"_L": "_R"}
    body_parts_right = [part.mirror_y(rename=rename) for part in body_parts[1:]]
    detail_parts_right = [part.mirror_y(rename=rename) for part in detail_parts]
    for name, (head, tail, parent) in list(bones.items()):
        if name.endswith("_L"):
            mirrored = lambda p: (p[0], -p[1], p[2])  # noqa: E731
            parent_r = parent[:-2] + "_R" if parent.endswith("_L") else parent
            bones[name[:-2] + "_R"] = (mirrored(head), mirrored(tail), parent_r)
    chela_scale = float(chela.get("leftScale", 1.08))
    for part in (cheliped_part, palm_part, dactyl_part):
        scale_part_about(part, coxa, chela_scale)
    for name in ("Cheliped_L", "Palm_L", "Dactyl_L"):
        head, tail, parent = bones[name]
        bones[name] = (scale_point_about(head, coxa, chela_scale), scale_point_about(tail, coxa, chela_scale), parent)

    all_body_parts = body_parts + body_parts_right
    all_detail_parts = detail_parts + detail_parts_right
    all_parts = [shell_part] + all_body_parts + all_detail_parts

    # ---- normalise: +X extent = referenceSize, rest on z = 0, centred on x = 0
    xs = [v[0] for part in all_parts for v in part.vertices]
    zs = [v[2] for part in all_parts for v in part.vertices]
    extent = max(xs) - min(xs)
    scale = float(spec["referenceSize"]["meters"]) / extent
    x_center = (max(xs) + min(xs)) / 2
    z_floor = min(zs)
    normalise = Matrix.Scale(scale, 4) @ Matrix.Translation(Vector((-x_center, 0.0, -z_floor)))
    for part in all_parts:
        part.transform(normalise)

    def N(p):
        return tuple(normalise @ _v(p))

    # ---- rig
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, 0.0), (0.12 * scale, 0.0, 0.0), deform=False)
    # the shell is the animal's anchor: it is dragged along the substrate, so its bone sits at the ground
    # contact under the lowest point of the body whorl and leans up and back; Body is its child so the
    # whole animal rocks and surges with the shell in the walk, while the retreat slides Body into the shell
    contact = Vector((shell_contact.x, shell_contact.y, 0.0))
    rb.bone("Shell", N(contact), N(contact + Vector((-1.2, 0.3, 3.0))), "Root")
    body_head = A + exit_dir * float(cara["throat"][-1])
    body_tail = A - exit_dir * 1.0
    rb.bone("Body", N(body_head), N(body_tail), "Shell")
    order = ["Eyestalk", "Antennule", "AntennaA", "AntennaB", "Cheliped", "Palm", "Dactyl"] + \
            [f"{leg['name'].capitalize()}{k}" for leg in legs_cfg for k in "ABC"]
    for stem in order:
        for _side, suffix in SIDES:
            name = f"{stem}_{suffix}"
            head, tail, parent = bones[name]
            rb.bone(name, N(head), N(tail), parent)
    rig = rb.finish()

    # ---- assemble
    shell_obj = msh.assemble(f"{prefix}_Shell", [shell_part], material_map, rig, f"{prefix}_Armature")
    body_obj = msh.assemble(f"{prefix}_Body", all_body_parts, material_map, rig, f"{prefix}_Armature")
    details_obj = msh.assemble(f"{prefix}_Details", all_detail_parts, material_map, rig, f"{prefix}_Armature")
    for obj in (shell_obj, body_obj, details_obj):
        obj["lod"] = 1
    body_obj["adultLengthMeters"] = spec["referenceSize"]["meters"]
    meshes = [shell_obj, body_obj, details_obj]

    # ---- animation
    leg_phase = {("leg1", "L"): 0.0, ("leg2", "L"): math.pi, ("leg1", "R"): math.pi, ("leg2", "R"): 0.0}
    clips = []
    for clip_name, clip in anim.items():
        env = None if clip["loop"] else clip.get("envelope", "hold")
        soft = "bell" if env else None
        ch: list[Channel] = []
        f_ant = float(clip.get("antennaFrequency", 1))
        if clip.get("antennaSway"):
            amp = float(clip["antennaSway"])
            for sgn, suffix in SIDES:
                ch.append(Channel(f"AntennaA_{suffix}", "rotation", (0, 0, 1), sgn * amp, f_ant, 0.0 if suffix == "L" else 1.3, envelope=soft))
                ch.append(Channel(f"AntennaB_{suffix}", "rotation", (0, 0, 1), sgn * amp * 1.4, f_ant, -0.7 if suffix == "L" else 0.6, envelope=soft))
                ch.append(Channel(f"AntennaB_{suffix}", "rotation", (1, 0, 0), amp * 0.5, f_ant * 2, 0.4, envelope=soft))
        if clip.get("antennuleFlick"):
            amp = float(clip["antennuleFlick"])
            for sgn, suffix in SIDES:
                ch.append(Channel(f"Antennule_{suffix}", "rotation", (1, 0, 0), -amp, float(clip.get("antennuleFrequency", 3)),
                                  0.0 if suffix == "L" else 2.1, waveform="pulse", exponent=2.0, envelope=soft))
        if clip.get("eyeTwitch"):
            amp = float(clip["eyeTwitch"])
            for sgn, suffix in SIDES:
                ch.append(Channel(f"Eyestalk_{suffix}", "rotation", (0, 0, 1), -sgn * amp, float(clip.get("eyeFrequency", 2)),
                                  0.9 if suffix == "L" else 2.4, waveform="pulse", exponent=3.0, envelope=soft))
                ch.append(Channel(f"Eyestalk_{suffix}", "rotation", (1, 0, 0), amp * 0.5, float(clip.get("eyeFrequency", 2)),
                                  0.9 if suffix == "L" else 2.4, waveform="pulse", exponent=3.0, envelope=soft))
        if clip.get("dactyl"):
            amp = float(clip["dactyl"])
            for sgn, suffix in SIDES:
                ch.append(Channel(f"Dactyl_{suffix}", "rotation", (1, 0, 0), amp, 1.0, 0.3 if suffix == "L" else 1.9, envelope=soft))
        if clip.get("chelipedBob"):
            amp = float(clip["chelipedBob"])
            for sgn, suffix in SIDES:
                ch.append(Channel(f"Cheliped_{suffix}", "rotation", (1, 0, 0), amp, 1.0, 0.0 if suffix == "L" else math.pi, envelope=soft))
        if clip.get("legSwing"):
            step_f = float(clip.get("stepFrequency", 2))
            swing, lift = float(clip["legSwing"]), float(clip["legLift"])
            bend, curl = float(clip.get("propodusBend", 5.0)), float(clip.get("dactylCurl", 4.0))
            for leg in legs_cfg:
                tag = leg["name"].capitalize()
                for sgn, suffix in SIDES:
                    phase = leg_phase[(leg["name"], suffix)]
                    zsign = 1.0 if suffix == "L" else -1.0
                    ch.append(Channel(f"{tag}A_{suffix}", "rotation", (0, 0, 1), zsign * swing, step_f, phase))
                    ch.append(Channel(f"{tag}A_{suffix}", "rotation", (1, 0, 0), lift, step_f, phase + math.pi / 2, waveform="pulse", exponent=1.4))
                    ch.append(Channel(f"{tag}B_{suffix}", "rotation", (1, 0, 0), bend, step_f, phase + math.pi / 2, waveform="pulse", exponent=1.4))
                    ch.append(Channel(f"{tag}C_{suffix}", "rotation", (1, 0, 0), -curl, step_f, phase + math.pi / 2, waveform="pulse", exponent=1.4))
            for sgn, suffix in SIDES:
                ch.append(Channel(f"Cheliped_{suffix}", "rotation", (1, 0, 0), float(clip.get("chelipedSwing", 3.0)), step_f,
                                  0.0 if suffix == "L" else math.pi))
                ch.append(Channel(f"Palm_{suffix}", "rotation", (1, 0, 0), float(clip.get("chelipedSwing", 3.0)) * 0.6, step_f,
                                  0.6 if suffix == "L" else math.pi + 0.6))
            # the dragged shell rolls with each step, pitches twice per cycle, lifts slightly and surges
            # forward as the legs push; Body and every limb ride along as its children
            ch.append(Channel("Shell", "rotation", (0, 0, 1), float(clip.get("shellRoll", 2.5)), step_f, 0.0))
            ch.append(Channel("Shell", "rotation", (1, 0, 0), float(clip.get("shellPitch", 1.2)), step_f * 2, math.pi / 2))
            ch.append(Channel("Shell", "location", (0, 1, 0), float(clip.get("shellBob", 0.1)) * scale, step_f * 2, 0.0))
            ch.append(Channel("Shell", "location", (0, 0, 1), float(clip.get("shellSurge", 0.15)) * scale, step_f, 0.8))
        if not clip["loop"]:
            retract = float(clip.get("retractMillimetres", 2.2)) * scale
            ch.append(Channel("Body", "location", (0, 1, 0), retract, 1.0, 0.0, waveform="const", envelope=env))
            for sgn, suffix in SIDES:
                zsign = 1.0 if suffix == "L" else -1.0
                # chelae swing inward (toward the midline) and rise over the aperture, dactyls close
                ch.append(Channel(f"Cheliped_{suffix}", "rotation", (0, 0, 1), zsign * float(clip.get("chelipedYaw", 12.0)), 1.0, 0.0, waveform="const", envelope=env))
                ch.append(Channel(f"Cheliped_{suffix}", "rotation", (1, 0, 0), float(clip.get("chelipedPitch", 12.0)), 1.0, 0.0, waveform="const", envelope=env))
                ch.append(Channel(f"Palm_{suffix}", "rotation", (1, 0, 0), float(clip.get("palmPitch", 6.0)), 1.0, 0.0, waveform="const", envelope=env))
                ch.append(Channel(f"Dactyl_{suffix}", "rotation", (1, 0, 0), -float(clip.get("dactylClose", 10.0)), 1.0, 0.0, waveform="const", envelope=env))
                for leg in legs_cfg:
                    tag = leg["name"].capitalize()
                    ch.append(Channel(f"{tag}A_{suffix}", "rotation", (1, 0, 0), float(clip.get("legLift", 8.0)), 1.0, 0.0, waveform="const", envelope=env))
                    ch.append(Channel(f"{tag}B_{suffix}", "rotation", (1, 0, 0), float(clip.get("legFold", 18.0)), 1.0, 0.0, waveform="const", envelope=env))
                    ch.append(Channel(f"{tag}C_{suffix}", "rotation", (1, 0, 0), float(clip.get("dactylTuck", -10.0)), 1.0, 0.0, waveform="const", envelope=env))
                ch.append(Channel(f"Eyestalk_{suffix}", "rotation", (1, 0, 0), float(clip.get("eyeFold", 18.0)), 1.0, 0.0, waveform="const", envelope=env))
                ch.append(Channel(f"Eyestalk_{suffix}", "rotation", (0, 0, 1), -zsign * float(clip.get("eyeSplay", 4.0)), 1.0, 0.0, waveform="const", envelope=env))
                ch.append(Channel(f"AntennaA_{suffix}", "rotation", (0, 0, 1), -zsign * float(clip.get("antennaSweep", 15.0)), 1.0, 0.0, waveform="const", envelope=env))
                ch.append(Channel(f"AntennaA_{suffix}", "rotation", (1, 0, 0), float(clip.get("antennaLift", 10.0)), 1.0, 0.0, waveform="const", envelope=env))
                ch.append(Channel(f"AntennaB_{suffix}", "rotation", (0, 0, 1), -zsign * float(clip.get("antennaSweep", 15.0)) * 0.6, 1.0, 0.0, waveform="const", envelope=env))
                ch.append(Channel(f"Antennule_{suffix}", "rotation", (1, 0, 0), float(clip.get("antennuleFold", 15.0)), 1.0, 0.0, waveform="const", envelope=env))
        clips.append(ClipSpec(clip_name, int(clip["frames"]), bool(clip["loop"]), ch))
    mesh_objects = {obj.name: obj for obj in meshes}
    for clip in clips:
        bake_clip(rig, clip, mesh_objects=mesh_objects)

    # ---- contract
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="x")
    contract["closedParts"].append({"object": shell_obj.name, "group": "part_shell", "volumeFloor": 0.9})
    contract["closedParts"].append({"object": body_obj.name, "group": "part_carapace", "volumeFloor": 0.8})
    for _sgn, suffix in SIDES:
        for name in [f"{leg['name']}_{suffix}" for leg in legs_cfg] + [f"cheliped_{suffix}", f"palm_{suffix}", f"dactyl_{suffix}"]:
            contract["closedParts"].append({"object": body_obj.name, "group": f"part_{name}", "volumeFloor": 0.6})
        for name in (f"eyestalk_{suffix}", f"cornea_{suffix}", f"antennule_{suffix}"):
            contract["closedParts"].append({"object": details_obj.name, "group": f"part_{name}", "volumeFloor": 0.6})
        contract["closedParts"].append({"object": details_obj.name, "group": f"part_antenna_{suffix}", "volumeFloor": 0.5})

    def clear(a, b, label, min_distance=None):
        item = {"a": list(a), "b": list(b), "label": label}
        if min_distance:
            item["minDistance"] = min_distance
        contract["clearance"].append(item)

    leg_names = [leg["name"] for leg in legs_cfg]
    for _sgn, suffix in SIDES:
        B, D, Sh = body_obj.name, details_obj.name, shell_obj.name
        for i, first in enumerate(leg_names):
            for second in leg_names[i + 1:]:
                clear((B, f"part_{first}_{suffix}", f"attach_{first}_{suffix}"), (B, f"part_{second}_{suffix}", f"attach_{second}_{suffix}"),
                      f"{first}_{second}_{suffix}")
            # limb bases are embedded side by side inside the cephalothorax; only the exposed limbs are checked
            clear((B, f"part_{first}_{suffix}", f"attach_{first}_{suffix}"), (B, f"chela_{suffix}", f"attach_cheliped_{suffix}"),
                  f"{first}_chela_{suffix}")
            clear((B, f"part_{first}_{suffix}", f"attach_{first}_{suffix}"), (B, "part_carapace"), f"{first}_carapace_{suffix}")
            clear((B, f"part_{first}_{suffix}"), (Sh, "part_shell"), f"{first}_shell_{suffix}")
            clear((B, f"part_{first}_{suffix}"), (D, f"head_{suffix}"), f"{first}_head_{suffix}")
        clear((B, f"part_cheliped_{suffix}", f"attach_cheliped_{suffix}"), (B, "part_carapace"), f"cheliped_carapace_{suffix}")
        clear((B, f"part_palm_{suffix}"), (B, "part_carapace"), f"palm_carapace_{suffix}")
        clear((B, f"part_dactyl_{suffix}"), (B, "part_carapace"), f"dactyl_carapace_{suffix}")
        clear((B, f"part_dactyl_{suffix}", f"attach_dactyl_{suffix}"), (B, f"part_palm_{suffix}"), f"dactyl_palm_{suffix}")
        clear((B, f"chela_{suffix}"), (Sh, "part_shell"), f"chela_shell_{suffix}")
        clear((B, f"chela_{suffix}"), (D, f"head_{suffix}"), f"chela_head_{suffix}")
        clear((D, f"eye_{suffix}"), (D, f"part_antennule_{suffix}"), f"eye_antennule_{suffix}")
        clear((D, f"eye_{suffix}"), (D, f"part_antenna_{suffix}"), f"eye_antenna_{suffix}")
        clear((D, f"part_antenna_{suffix}"), (D, f"part_antennule_{suffix}"), f"antenna_antennule_{suffix}")
        clear((D, f"part_eyestalk_{suffix}", f"attach_eyestalk_{suffix}"), (B, "part_carapace"), f"eyestalk_carapace_{suffix}")
        clear((D, f"part_antennule_{suffix}", f"attach_antennule_{suffix}"), (B, "part_carapace"), f"antennule_carapace_{suffix}")
        clear((D, f"part_antenna_{suffix}", f"attach_antenna_{suffix}"), (B, "part_carapace"), f"antenna_carapace_{suffix}")
        clear((D, f"head_{suffix}"), (Sh, "part_shell"), f"head_shell_{suffix}")
    clear((body_obj.name, "chela_L"), (body_obj.name, "chela_R"), "chela_left_right", min_distance=0.15 * scale)
    clear((details_obj.name, "head_L"), (details_obj.name, "head_R"), "head_left_right")
    for sgn, suffix in SIDES:
        for name in [f"{leg}_{suffix}" for leg in leg_names] + [f"cheliped_{suffix}", f"palm_{suffix}", f"dactyl_{suffix}"]:
            contract["centerPlane"].append({"object": body_obj.name, "group": f"part_{name}", "exclude": None, "side": sgn})
        for name in (f"eyestalk_{suffix}", f"cornea_{suffix}", f"antennule_{suffix}", f"antenna_{suffix}"):
            contract["centerPlane"].append({"object": details_obj.name, "group": f"part_{name}", "exclude": None, "side": sgn})
    contract["symmetry"] = [{"object": body_obj.name, "left": f"part_{leg}_L", "right": f"part_{leg}_R", "tolerance": 2e-5} for leg in leg_names]
    contract["symmetry"] += [{"object": details_obj.name, "left": f"part_{n}_L", "right": f"part_{n}_R", "tolerance": 2e-5}
                             for n in ("eyestalk", "cornea", "antennule", "antenna")]
    contract["axialChain"] = None
    register_clips(contract, clips)

    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written,
                       notes={"designUnit": "millimetre", "designExtentMillimetres": round(extent, 4), "designScale": scale,
                              "apertureHeightMillimetres": round(A.z, 4), "leftChelaScale": chela_scale,
                              "apertureNormalWorld": [round(c, 4) for c in aperture_world],
                              "shellBoundsMillimetres": [list(shell_low), list(shell_high)],
                              "shellContactMillimetres": [round(c, 4) for c in shell_contact],
                              "deformBones": len(rb.deform_names)})
