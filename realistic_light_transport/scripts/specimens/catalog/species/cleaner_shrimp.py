"""Skunk cleaner shrimp, Lysmata amboinensis: species-local decapod shrimp body plan.

No shared crustacean plan exists, so this module defines build(spec, species, ctx) itself.
Source space: metres, +X anterior, +Z up, bilateral symmetry about y = 0, origin at midbody.

Anatomy choices (all numbers come from asset.source.json):
- Cephalothorax: one closed superellipse loft, deeper than wide, blunt anterior margin, with a
  separate upturned rostrum tube on the dorsal midline.
- Abdomen: six telescoping closed pleomere lofts along a gently humped axis that descends to the
  tail; pleomeres are rigid to three abdominal bones (1-2, 3-5, 6). Flat tapered telson plus two
  pairs of uropod blades (exopod, endopod) form the tail fan on a single Tail bone.
- Head appendages: stalked eyes under the rostrum, antennular peduncles carrying two flagella per
  side (the forked antennule), second antennae with an antennal scale and a long white flagellum
  that arcs up and back over the body so the rest x-extent is rostrum to tail fan.
- Five pairs of slender pereiopods hang below the thorax, splayed fore/aft so neighbours clear each
  other while stepping. Pairs 1 and 2 are chelipeds with a separately boned hand; pair 1 also has a
  movable dactyl. Third maxillipeds project forward under the mouth. Five pairs of pleopod paddles
  hang under pleomeres 1-5 on two bones per side.
- Rig: 31 deform bones. Clips: hover (loop), walk (loop, metachronal leg stepping with body bob),
  clean (bell response: rapid antenna flicking and cheliped picking).
- Textures: one authored shell atlas (albedo/roughness/normal) with the white dorsal stripe flanked
  by scarlet bands, amber flanks fading to a cream belly, pleomere seams, granular relief, red tail
  fan with white spots, and a pale limb region. Antennae and eyes use untextured principled materials.
Everything is deterministic: geometry from the source numbers, textures from seeded value noise.
"""

from __future__ import annotations

import math

import numpy as np
from mathutils import Matrix, Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.noise import fbm, smoothstep
from ..lib.rigging import RigBuilder

PITCH = (0.0, 1.0, 0.0)
YAW = (0.0, 0.0, 1.0)
ROLL = (1.0, 0.0, 0.0)
SIDES = ((-1, "L"), (1, "R"))
ABD_BONE_FOR_SEGMENT = ("Abd_A", "Abd_A", "Abd_B", "Abd_B", "Abd_B", "Abd_C")
PLEO_BONE_FOR_PAIR = ("Pleo_A", "Pleo_A", "Pleo_B", "Pleo_B", "Pleo_B")


# ---------------------------------------------------------------- small helpers

def pchip_slopes(xs, ys):
    n = len(xs)
    if n < 3:
        return [(ys[1] - ys[0]) / (xs[1] - xs[0])] * 2
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    delta = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    slopes = [0.0] * n
    for i in range(1, n - 1):
        if delta[i - 1] * delta[i] <= 0:
            slopes[i] = 0.0
        else:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            slopes[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i])
    slopes[0] = ((2 * h[0] + h[1]) * delta[0] - h[0] * delta[1]) / (h[0] + h[1])
    if math.copysign(1, slopes[0]) != math.copysign(1, delta[0]):
        slopes[0] = 0.0
    slopes[-1] = ((2 * h[-1] + h[-2]) * delta[-1] - h[-1] * delta[-2]) / (h[-1] + h[-2])
    if math.copysign(1, slopes[-1]) != math.copysign(1, delta[-1]):
        slopes[-1] = 0.0
    return slopes


class Profile:
    """Monotone cubic interpolation of one channel along x (clamped outside the stations)."""

    def __init__(self, xs, ys):
        order = sorted(range(len(xs)), key=lambda i: xs[i])
        self.xs = [xs[i] for i in order]
        self.ys = [ys[i] for i in order]
        self.slopes = pchip_slopes(self.xs, self.ys)

    def __call__(self, x: float) -> float:
        xs, ys, m = self.xs, self.ys, self.slopes
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        for i in range(len(xs) - 1):
            if xs[i] <= x <= xs[i + 1]:
                h = xs[i + 1] - xs[i]
                t = (x - xs[i]) / h
                h00 = 2 * t ** 3 - 3 * t ** 2 + 1
                h10 = t ** 3 - 2 * t ** 2 + t
                h01 = -2 * t ** 3 + 3 * t ** 2
                h11 = t ** 3 - t ** 2
                return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]
        return ys[-1]


def station_profiles(stations):
    xs = [s[0] for s in stations]
    return (Profile(xs, [s[1] for s in stations]), Profile(xs, [s[2] for s in stations]),
            Profile(xs, [s[3] for s in stations]), Profile(xs, [s[4] for s in stations]))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def sstep(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def side_point(point, s: int):
    return (float(point[0]), s * float(point[1]), float(point[2]))


def bezier_point(p0, p1, p2, p3, t: float):
    u = 1.0 - t
    return tuple(u ** 3 * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t ** 3 * p3[k] for k in range(3))


def bezier(p0, p1, p2, p3, count: int):
    return [bezier_point(p0, p1, p2, p3, i / (count - 1)) for i in range(count)]


def taper(r0: float, r1: float, count: int, power: float = 1.0):
    return [lerp(r0, r1, (i / (count - 1)) ** power) for i in range(count)]


def ring_of(index: int, segments: int, count: int) -> int:
    """Ring index of a loft/tube vertex (start cap centre -> 0, end cap centre -> last)."""
    if index < segments * count:
        return index // segments
    return 0 if index == segments * count else count - 1


def basis(direction, width_axis) -> Matrix:
    """Rotation whose local X is the width axis, local Y the thickness axis, local Z the length axis."""
    d = Vector(direction).normalized()
    w = Vector(width_axis)
    w = (w - d * w.dot(d)).normalized()
    n = d.cross(w).normalized()
    return Matrix(((w.x, n.x, d.x), (w.y, n.y, d.y), (w.z, n.z, d.z)))


def blade(root, direction, width_axis, length: float, width: float, thickness: float, segments: int = 12, rings: int = 8):
    """Flat elliptical blade (closed ellipsoid) whose root pole sits at `root` and tip pole at root + direction * length."""
    d = Vector(direction).normalized()
    center = Vector(root) + d * (length / 2.0)
    return msh.ellipsoid(tuple(center), (width / 2.0, thickness / 2.0, length / 2.0), segments, rings, basis(d, width_axis))


def blade_along(index: int, segments: int, rings: int) -> float:
    """0 at the root pole and 1 at the tip pole for the ellipsoid vertex layout."""
    if index < (rings - 1) * segments:
        phi = (index // segments + 1) / rings * math.pi
        return 0.5 + 0.5 * math.cos(phi)
    return 1.0 if index == (rings - 1) * segments else 0.0


def local_axis(rig, bone: str, world_axis):
    rotation = rig.data.bones[bone].matrix_local.to_3x3()
    return tuple(rotation.inverted() @ Vector(world_axis))


def region(u0: float, u1: float):
    return lambda u, v: (u0 + u * (u1 - u0), v)


def all_vertices(geometry):
    return set(range(len(geometry[0])))


def rigid(bone: str):
    return lambda i, v: {bone: 1.0}


# ---------------------------------------------------------------- texture

def paint_shell(spec: dict, width: int, height: int):
    """Shell atlas. u partitions body regions, v is the angle around each ring (0 = dorsal ridge)."""
    pal = spec.get("palette", {})
    flank = pal.get("flank", (0.86, 0.55, 0.24))
    belly = pal.get("belly", (0.93, 0.83, 0.62))
    red = pal.get("stripe", (0.72, 0.05, 0.03))
    white = pal.get("white", (0.96, 0.95, 0.90))
    limb_colour = pal.get("limb", (0.90, 0.78, 0.58))
    U, V = textures.uv_grid(width, height)
    a = np.where(V < 0.5, V, V - 1.0)
    absa = np.abs(a)
    ventral = 0.5 - 0.5 * np.cos(V * math.tau)
    grain = fbm(U * 160.0, V * 80.0, octaves=3, seed=11)
    fine = fbm(U * 420.0, V * 210.0, octaves=2, seed=23)
    wobble = (fbm(U * 34.0, np.full_like(U, 0.5), octaves=2, seed=5) - 0.5) * 0.012

    car = 1.0 - smoothstep(0.44, 0.45, U)
    abd = smoothstep(0.445, 0.455, U) * (1.0 - smoothstep(0.79, 0.80, U))
    tel = smoothstep(0.795, 0.805, U) * (1.0 - smoothstep(0.86, 0.87, U))
    uro = smoothstep(0.865, 0.875, U) * (1.0 - smoothstep(0.93, 0.94, U))
    limb = smoothstep(0.935, 0.945, U)
    body = np.clip(car + abd, 0.0, 1.0)

    albedo = textures.rgba(flank, 1.0, U.shape)
    albedo = textures.mix(albedo, belly, ventral ** 1.3)
    albedo = textures.mix(albedo, belly, car * smoothstep(0.34, 0.44, U) * 0.45)
    albedo = textures.scale_rgb(albedo, 0.93 + 0.14 * (grain - 0.5))

    # white dorsal stripe flanked by scarlet bands; the bands fade into the amber flank below
    w_white = 0.034 * car + 0.028 * abd
    w_red = 0.150 * car + 0.125 * abd
    aa = absa + wobble
    white_mask = (1.0 - smoothstep(w_white - 0.004, w_white + 0.004, aa)) * body
    red_mask = (1.0 - smoothstep(w_red - 0.02, w_red + 0.01, aa)) * body * (1.0 - white_mask)
    red_tex = textures.scale_rgb(textures.rgba(red, 1.0, U.shape), 0.9 + 0.2 * grain)
    albedo = textures.mix(albedo, red_tex, red_mask)
    albedo = textures.mix(albedo, white, white_mask)

    # pleomere seams and the cervical groove
    seam = np.zeros_like(U)
    seg_w = 0.34 / 6.0
    for k in range(6):
        u_seam = 0.45 + (k + 1) * seg_w - 0.006
        seam = np.maximum(seam, 1.0 - smoothstep(0.0025, 0.0045, np.abs(U - u_seam)))
    groove = 1.0 - smoothstep(0.003, 0.006, np.abs(U - 0.30))
    seam_all = np.clip(seam * abd + 0.6 * groove * car, 0.0, 1.0)
    albedo = textures.scale_rgb(albedo, 1.0 - 0.16 * seam_all)

    # tail fan: scarlet with white spots (two on the telson, one per uropod blade)
    fan = np.clip(tel + uro, 0.0, 1.0)
    albedo = textures.mix(albedo, red_tex, fan)
    u_tel = (U - 0.80) / 0.06
    spot_t = np.zeros_like(U)
    for sign in (-1.0, 1.0):
        r = np.sqrt(((u_tel - 0.52) / 0.16) ** 2 + ((a - sign * 0.10) / 0.055) ** 2)
        spot_t = np.maximum(spot_t, 1.0 - smoothstep(0.75, 1.0, r))
    u_uro = (U - 0.87) / 0.06
    r = np.sqrt(((u_uro - 0.5) / 0.14) ** 2 + ((V - 0.25) / 0.13) ** 2)
    spot_u = 1.0 - smoothstep(0.75, 1.0, r)
    spots = np.clip(spot_t * tel + spot_u * uro, 0.0, 1.0)
    albedo = textures.mix(albedo, white, spots)

    # limbs: pale amber with whitish joint bands and tips
    limb_tex = textures.rgba(limb_colour, 1.0, U.shape)
    u_limb = (U - 0.94) / 0.06
    bands = np.maximum(1.0 - smoothstep(0.02, 0.05, np.abs(u_limb - 0.5)), 1.0 - smoothstep(0.02, 0.05, np.abs(u_limb - 0.75)))
    tip = smoothstep(0.90, 0.97, u_limb)
    limb_tex = textures.mix(limb_tex, white, np.clip(bands * 0.8 + tip, 0.0, 1.0))
    limb_tex = textures.scale_rgb(limb_tex, 0.94 + 0.12 * (grain - 0.5))
    albedo = textures.mix(albedo, limb_tex, limb)

    height = 0.5 + 0.12 * (grain - 0.5) + 0.06 * (fine - 0.5) - 0.22 * seam_all + 0.03 * red_mask - 0.02 * white_mask
    roughness = 0.30 + 0.12 * red_mask + 0.05 * white_mask + 0.08 * (grain - 0.5) + 0.05 * fan + 0.06 * limb
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(np.clip(height, 0.0, 1.0), 1.1)}


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morph = spec["morphology"]
    palette = spec.get("palette", {})

    # ---- textures & materials
    tex = spec.get("textures", {})
    shell_w, shell_h = tex.get("shellResolution", [1024, 512])
    paint = paint_shell(spec, shell_w, shell_h)
    written = []
    images = {}
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = ctx.texture_dir / f"shell-{key}.png"
        images[key] = textures.write_image(f"{prefix}_Shell_{key}", path, paint[key], non_color)
        written.append(path)
    shell = mat.principled(f"{prefix}_Shell", palette.get("shell", (0.86, 0.58, 0.28)), 0.36, coat=0.22, subsurface=0.06, specular=0.45)
    mat.attach_textures(shell, albedo=images["albedo"], roughness=images["roughness"], normal=images["normal"],
                        normal_strength=float(tex.get("normalStrength", 0.45)))
    antenna_material = mat.principled(f"{prefix}_Antenna", palette.get("antenna", (0.93, 0.93, 0.88)), 0.45, coat=0.05, subsurface=0.0)
    eye_material = mat.principled(f"{prefix}_Eye", palette.get("eye", (0.02, 0.015, 0.012)), 0.12, coat=0.6, subsurface=0.0)
    material_map = {"shell": shell, "antenna": antenna_material, "eye": eye_material}

    # ---- morphology profiles
    car = morph["carapace"]
    car_hw, car_d, car_v, car_cz = station_profiles(car["stations"])
    car_x0 = car["stations"][0][0]
    car_x1 = car["stations"][-1][0]
    abd = morph["abdomen"]
    abd_hw, abd_d, abd_v, abd_cz = station_profiles(abd["stations"])
    bounds = [float(b) for b in abd["boundaries"]]
    tel = morph["telson"]
    legs = morph["legs"]
    pleo = morph["pleopods"]
    ant = morph["antennae"]
    antl = morph["antennules"]
    eyes = morph["eyes"]

    def abd_bottom(x: float, y_abs: float) -> float:
        ratio = min(y_abs / max(abd_hw(x), 1e-9), 0.98)
        return abd_cz(x) - abd_v(x) * (1.0 - ratio ** 2) ** 0.5

    # antenna curves (left side; the right side mirrors)
    ant_pedal = [side_point(p, -1) for p in ant["peduncle"]]
    ant_p0 = ant_pedal[-1]
    ant_ctrl = [side_point(p, -1) for p in ant["flagellum"]]
    ant_points = int(ant.get("points", 22))
    ant_curve = bezier(ant_p0, *ant_ctrl, ant_points)
    ant_split = float(ant.get("boneSplit", 0.4))
    antl_pedal = [side_point(p, -1) for p in antl["peduncle"]]
    antl_p0 = antl_pedal[-1]
    antl_outer = [side_point(p, -1) for p in antl["outer"]]
    antl_inner = [side_point(p, -1) for p in antl["inner"]]
    antl_points = int(antl.get("points", 12))

    # leg polylines (left side)
    coxa_x = [float(v) for v in legs["coxaX"]]
    coxa_y = float(legs["coxaY"])
    coxa_z = float(legs["coxaZ"])
    cheliped_count = int(legs.get("chelipeds", 2))
    leg_lines = []
    for i, cx in enumerate(coxa_x):
        angle = math.radians(float(legs["splayDegrees"][i]))
        scale = float(legs["lengthScale"][i])
        points = []
        for k in range(5):
            reach = float(legs["reach"][k]) * scale * math.sin(angle)
            drop = float(legs["drop"][k]) * scale
            lateral = float(legs["lateral"][k])
            points.append((cx + reach, -lateral if k else -coxa_y, coxa_z - drop))
        leg_lines.append(points)

    def hand_line(points):
        p2, p3, p4 = Vector(points[2]), Vector(points[3]), Vector(points[4])
        back = (p3 - p2).normalized()
        palm = p3 + (p4 - p3) * 0.5
        return [tuple(p2 - back * 0.0006), tuple(p3), tuple(palm), tuple(p4)], palm, (p4 - p3).normalized()

    def dactyl_line(points):
        _, palm, finger = hand_line(points)
        outward = Vector((0.0, -1.0, 0.0))
        outward = (outward - finger * outward.dot(finger)).normalized()
        p4 = Vector(points[4])
        q0 = palm + outward * 0.0003 + finger * 0.0002
        q1 = p4 + outward * 0.0010
        axis = finger.cross(outward).normalized()
        return [tuple(q0), tuple((q0 + q1) / 2 + outward * 0.0001), tuple(q1)], tuple(axis)

    # pleopod roots (left side)
    pleo_dir_l = Vector(side_point(pleo["direction"], -1)).normalized()
    pleo_roots = []
    for x in pleo["x"]:
        x = float(x)
        z = abd_bottom(x, float(pleo["rootY"])) + float(pleo["embed"])
        pleo_roots.append((x, -float(pleo["rootY"]), z))

    # ---- rig
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.004, 0.0, 0.0), (0.0, 0.0, 0.0), deform=False)
    rb.bone("Body", (bounds[0], 0.0, abd_cz(bounds[0])), (car_x1, 0.0, car_cz(car_x1)), "Root")
    chain = (("Abd_A", bounds[0], bounds[2]), ("Abd_B", bounds[2], bounds[5]), ("Abd_C", bounds[5], bounds[6]))
    parent = "Body"
    for index, (name, xa, xb) in enumerate(chain):
        rb.bone(name, (xa, 0.0, abd_cz(xa)), (xb, 0.0, abd_cz(xb)), parent, connected=index > 0)
        parent = name
    rb.bone("Tail", (bounds[6], 0.0, abd_cz(bounds[6])), (float(tel["xEnd"]), 0.0, float(tel["centerZ"][1])), "Abd_C", connected=True)
    dactyl_axes = {}
    for s, suffix in SIDES:
        def P(point):
            return (point[0], s * -point[1], point[2]) if s > 0 else point

        # pleopod bones: pairs 1-2 on Abd_A, pairs 3-5 on Abd_B
        for name, indices, parent_bone in (("Pleo_A", (0, 1), "Abd_A"), ("Pleo_B", (2, 3, 4), "Abd_B")):
            xs = [pleo_roots[i][0] for i in indices]
            root = P((sum(xs) / len(xs), pleo_roots[indices[0]][1], abd_bottom(sum(xs) / len(xs), float(pleo["rootY"])) + float(pleo["embed"])))
            direction = Vector(P(tuple(pleo_dir_l)))
            rb.bone(f"{name}_{suffix}", root, tuple(Vector(root) + direction * float(pleo["length"]) * 0.8), parent_bone)
        # antennae
        split_point = bezier_point(ant_p0, *ant_ctrl, ant_split)
        rb.bone(f"Ant_A_{suffix}", P(ant_p0), P(split_point), "Body", roll_up=(1.0, 0.0, 0.0))
        rb.bone(f"Ant_B_{suffix}", P(split_point), P(ant_curve[-1]), f"Ant_A_{suffix}", connected=True, roll_up=(1.0, 0.0, 0.0))
        antl_tip = bezier_point(antl_p0, *antl_outer, float(antl.get("boneTip", 0.55)))
        rb.bone(f"Antennule_{suffix}", P(antl_p0), P(antl_tip), "Body", roll_up=(1.0, 0.0, 0.0))
        # legs
        for i, points in enumerate(leg_lines):
            rb.bone(f"Leg{i + 1}_{suffix}", P(points[0]), P(points[2]), "Body", roll_up=(1.0, 0.0, 0.0))
            if i < cheliped_count:
                rb.bone(f"Hand{i + 1}_{suffix}", P(points[2]), P(points[4]), f"Leg{i + 1}_{suffix}", roll_up=(1.0, 0.0, 0.0))
        dactyl_points, dactyl_axis = dactyl_line(leg_lines[0])
        rb.bone(f"Dactyl_{suffix}", P(dactyl_points[0]), P(dactyl_points[-1]), f"Hand1_{suffix}", roll_up=(1.0, 0.0, 0.0))
        dactyl_axes[suffix] = dactyl_axis if s < 0 else (-dactyl_axis[0], dactyl_axis[1], -dactyl_axis[2])
    rig = rb.finish()

    # ---- body object: carapace, rostrum, pleomeres, telson, uropods
    body_parts = []
    ed, ev = [float(e) for e in car.get("exponents", [2.3, 2.0])]
    segs = int(car.get("ringSegments", 28))
    count = int(car.get("ringCount", 24))
    positions = []
    for i in range(count):
        t = i / (count - 1)
        # denser rings towards the tapering anterior margin
        positions.append(car_x0 + (car_x1 - car_x0) * (1.0 - (1.0 - t) ** 1.25))
    rings = [msh.superellipse_ring(x, car_hw(x), car_d(x), car_v(x), 0.0, car_cz(x), segs, ed, ev) for x in positions]
    carapace_geo = msh.loft(rings, cap_start=True, cap_end=True)
    body_parts.append(msh.make_part("carapace", carapace_geo, "shell", rigid("Body"), closed=True,
                                    groups={"carapace_all": all_vertices(carapace_geo)}, uv_transform=region(0.0, 0.44)))
    ros = morph["rostrum"]
    n_ros = int(ros.get("points", 7))
    ros_points = [tuple(lerp(ros["start"][k], ros["end"][k], (i / (n_ros - 1)) ** 1.1) for k in range(3)) for i in range(n_ros)]
    ros_geo = msh.tube(ros_points, taper(float(ros["radius"][0]), float(ros["radius"][1]), n_ros, 0.8), int(ros.get("segments", 8)),
                       aspect=float(ros.get("aspect", 0.62)))
    body_parts.append(msh.make_part("rostrum", ros_geo, "shell", rigid("Body"), closed=True,
                                    groups={"carapace_all": all_vertices(ros_geo)}, uv_transform=region(0.40, 0.44)))

    abd_ed, abd_ev = [float(e) for e in abd.get("exponents", [2.2, 2.0])]
    abd_segs = int(abd.get("ringSegments", 24))
    rings_per = int(abd.get("ringsPerSegment", 6))
    overlap = float(abd.get("overlap", 0.0008))
    front_scale = float(abd.get("frontScale", 0.86))
    rear_scale = float(abd.get("rearScale", 0.97))
    seg_w = 0.34 / 6.0
    for k in range(6):
        xf = bounds[k] + overlap
        xr = bounds[k + 1]
        rings = []
        for i in range(rings_per):
            t = i / (rings_per - 1)
            x = lerp(xf, xr, t)
            # the hidden anterior rim sits inside the previous pleomere; the visible plate is full size and
            # its posterior margin flares slightly so each pleuron reads as a plate overlapping the next
            f = lerp(front_scale, 1.0, sstep(t / 0.45)) * lerp(1.0, rear_scale, sstep((t - 0.7) / 0.3))
            rings.append(msh.superellipse_ring(x, abd_hw(x) * f, abd_d(x) * f, abd_v(x) * f, 0.0, abd_cz(x), abd_segs, abd_ed, abd_ev))
        geo = msh.loft(rings, cap_start=True, cap_end=True)
        body_parts.append(msh.make_part(f"abd_{k + 1}", geo, "shell", rigid(ABD_BONE_FOR_SEGMENT[k]), closed=True,
                                        groups={"abdomen": all_vertices(geo)},
                                        uv_transform=region(0.45 + k * seg_w, 0.45 + (k + 1) * seg_w - 0.003)))
    n_tel = int(tel.get("rings", 6))
    rings = []
    for i in range(n_tel):
        t = i / (n_tel - 1)
        x = lerp(float(tel["xStart"]), float(tel["xEnd"]), t)
        shape = t ** 1.3
        rings.append(msh.superellipse_ring(x, lerp(*[float(v) for v in tel["halfWidth"]], shape), lerp(*[float(v) for v in tel["dorsal"]], shape),
                                           lerp(*[float(v) for v in tel["ventral"]], shape), 0.0, lerp(*[float(v) for v in tel["centerZ"]], t),
                                           int(tel.get("ringSegments", 12)), 2.0, 2.0))
    tel_geo = msh.loft(rings, cap_start=True, cap_end=True)
    body_parts.append(msh.make_part("telson", tel_geo, "shell", rigid("Tail"), closed=True,
                                    groups={"tailfan": all_vertices(tel_geo)}, uv_transform=region(0.80, 0.86)))
    uro = morph["uropods"]
    left_uropods = []
    for name in ("exopod", "endopod"):
        u = uro[name]
        # width axis -Y so the blade normal (local Y) points up and the white spot sits on the upper face
        geo = blade(side_point(u["root"], -1), side_point(u["direction"], -1), (0.0, -1.0, 0.0), float(u["length"]), float(u["width"]), float(u["thickness"]),
                    segments=12, rings=8)
        left_uropods.append(msh.make_part(f"uropod_{name}_L", geo, "shell", rigid("Tail"), closed=True,
                                          groups={"tailfan": all_vertices(geo), "uropods_L": all_vertices(geo)}, uv_transform=region(0.87, 0.93)))
    for part in left_uropods:
        body_parts.append(part)
        body_parts.append(part.mirror_y(rename={"_L": "_R"}))
    body_obj = msh.assemble(f"{prefix}_Body", body_parts, material_map, rig, f"{prefix}_Armature")
    body_obj["adultLengthMeters"] = spec["referenceSize"]["meters"]
    body_obj["lod"] = 1

    # ---- limbs object: pereiopods, chelae, pleopods, maxillipeds
    limb_parts = []
    leg_segments = int(legs.get("segments", 8))
    leg_radii = [float(r) for r in legs["radius"]]
    for i, points in enumerate(leg_lines):
        name = f"leg_{i + 1}"
        leg_groups = lambda geo, part: {"legs_L": all_vertices(geo), f"leg_{i + 1}_L": all_vertices(geo)}
        left = []
        if i < cheliped_count:
            upper_geo = msh.tube(points[:3], leg_radii[:3], leg_segments)
            left.append(msh.make_part(f"{name}_L", upper_geo, "shell", rigid(f"Leg{i + 1}_L"), closed=True,
                                      groups=leg_groups(upper_geo, name), uv_transform=region(0.94, 0.97)))
            hand_points, _, _ = hand_line(points)
            hand_geo = msh.tube(hand_points, [float(r) for r in legs["handRadius"]], leg_segments)
            left.append(msh.make_part(f"hand_{i + 1}_L", hand_geo, "shell", rigid(f"Hand{i + 1}_L"), closed=True,
                                      groups=leg_groups(hand_geo, name), uv_transform=region(0.955, 1.0)))
            if i == 0:
                dactyl_points, _ = dactyl_line(points)
                dr = [float(r) for r in legs["dactylRadius"]]
                dactyl_geo = msh.tube(dactyl_points, [dr[0], lerp(dr[0], dr[1], 0.5), dr[1]], 6)
                left.append(msh.make_part("dactyl_L", dactyl_geo, "shell", rigid("Dactyl_L"), closed=True,
                                          groups=leg_groups(dactyl_geo, name), uv_transform=region(0.97, 1.0)))
        else:
            geo = msh.tube(points, leg_radii, leg_segments)
            left.append(msh.make_part(f"{name}_L", geo, "shell", rigid(f"Leg{i + 1}_L"), closed=True,
                                      groups=leg_groups(geo, name), uv_transform=region(0.94, 1.0)))
        for part in left:
            limb_parts.append(part)
            limb_parts.append(part.mirror_y(rename={"_L": "_R"}))
    pleo_segs = int(pleo.get("segments", 10))
    pleo_rings = int(pleo.get("rings", 7))
    for k, root in enumerate(pleo_roots):
        geo = blade(root, tuple(pleo_dir_l), (0.0, 1.0, 0.0), float(pleo["length"]), float(pleo["width"]), float(pleo["thickness"]),
                    segments=pleo_segs, rings=pleo_rings)
        seg_bone = ABD_BONE_FOR_SEGMENT[k]
        pleo_bone = f"{PLEO_BONE_FOR_PAIR[k]}_L"

        # the embedded root stays with its pleomere; the paddle takes over past the body surface so the
        # shared pleopod bone (whose head is offset in x from most roots) cannot lift a base into the abdomen
        def pleo_weights(index, vertex, seg_bone=seg_bone, pleo_bone=pleo_bone):
            along = blade_along(index, pleo_segs, pleo_rings)
            w = sstep((along - 0.28) / 0.25)
            return msh.blend_weights({seg_bone: 1.0}, {pleo_bone: 1.0}, w)
        root_group = {index for index in range(len(geo[0])) if blade_along(index, pleo_segs, pleo_rings) < 0.42}
        part = msh.make_part(f"pleopod_{k + 1}_L", geo, "shell", pleo_weights, closed=True,
                             groups={"pleopods_L": all_vertices(geo), "pleo_root_L": root_group}, uv_transform=region(0.94, 0.985))
        limb_parts.append(part)
        limb_parts.append(part.mirror_y(rename={"_L": "_R"}))
    mx = morph["maxillipeds"]
    mx_geo = msh.tube([side_point(p, -1) for p in mx["points"]], [float(r) for r in mx["radius"]], 6)
    mx_part = msh.make_part("maxilliped_L", mx_geo, "antenna", rigid("Body"), closed=True, groups={"maxillipeds": all_vertices(mx_geo)})
    limb_parts.append(mx_part)
    limb_parts.append(mx_part.mirror_y(rename={"_L": "_R"}))
    limbs_obj = msh.assemble(f"{prefix}_Limbs", limb_parts, material_map, rig, f"{prefix}_Armature")
    limbs_obj["lod"] = 1

    # ---- head object: eyes, antennular and antennal peduncles, scale, flagella
    head_parts = []
    left = []
    stalk_geo = msh.tube([side_point(p, -1) for p in eyes["stalk"]], [float(r) for r in eyes["stalkRadius"]], 8)
    left.append(msh.make_part("eyestalk_L", stalk_geo, "shell", rigid("Body"), closed=True,
                              groups={"eyes_L": all_vertices(stalk_geo)}, uv_transform=region(0.94, 0.97)))
    eye_geo = msh.ellipsoid(side_point(eyes["center"], -1), (float(eyes["radius"]),) * 3, 14, 9)
    left.append(msh.make_part("eye_L", eye_geo, "eye", rigid("Body"), closed=True, groups={"eyes_L": all_vertices(eye_geo)}))
    ped_geo = msh.tube(ant_pedal, [float(r) for r in ant["peduncleRadius"]], 8)
    left.append(msh.make_part("ant_peduncle_L", ped_geo, "shell", rigid("Body"), closed=True, uv_transform=region(0.94, 0.97)))
    sc = ant["scaphocerite"]
    sc_geo = blade(side_point(sc["root"], -1), side_point(sc["direction"], -1), (0.0, 1.0, 0.0), float(sc["length"]), float(sc["width"]),
                   float(sc["thickness"]), segments=12, rings=8)
    left.append(msh.make_part("scaphocerite_L", sc_geo, "shell", rigid("Body"), closed=True, uv_transform=region(0.94, 0.97)))
    antl_ped_geo = msh.tube(antl_pedal, [float(r) for r in antl["peduncleRadius"]], 8)
    left.append(msh.make_part("antennule_peduncle_L", antl_ped_geo, "shell", rigid("Body"), closed=True, uv_transform=region(0.94, 0.97)))
    flag_geo = msh.tube(ant_curve, taper(float(ant["radius"][0]), float(ant["radius"][1]), ant_points, 0.7), 6)

    def antenna_weights(index, vertex):
        t = ring_of(index, 6, ant_points) / (ant_points - 1)
        w = sstep((t - (ant_split - 0.15)) / 0.3)
        return msh.blend_weights({"Ant_A_L": 1.0}, {"Ant_B_L": 1.0}, w)
    ant_root = {index for index in range(len(flag_geo[0])) if ring_of(index, 6, ant_points) <= 1}
    left.append(msh.make_part("antenna_L", flag_geo, "antenna", antenna_weights, closed=True,
                              groups={"antennae_L": all_vertices(flag_geo), "antenna_L": all_vertices(flag_geo), "ant_root_L": ant_root}))
    for name, ctrl in (("outer", antl_outer), ("inner", antl_inner)):
        curve = bezier(antl_p0, *ctrl, antl_points)
        geo = msh.tube(curve, taper(float(antl["radius"][0]), float(antl["radius"][1]), antl_points, 0.8), 6)
        left.append(msh.make_part(f"antennule_{name}_L", geo, "antenna", rigid("Antennule_L"), closed=True,
                                  groups={"antennae_L": all_vertices(geo), "antennule_L": all_vertices(geo),
                                          "ant_root_L": {index for index in range(len(geo[0])) if ring_of(index, 6, antl_points) == 0}}))
    for part in left:
        head_parts.append(part)
        head_parts.append(part.mirror_y(rename={"_L": "_R"}))
    head_obj = msh.assemble(f"{prefix}_Head", head_parts, material_map, rig, f"{prefix}_Armature")
    head_obj["lod"] = 1

    # ---- animation
    clips = []
    for clip_name, clip in spec["animation"].items():
        env = None if clip["loop"] else clip.get("envelope", "bell")
        channels: list[Channel] = []

        def rot(bone, axis, amplitude, frequency, phase=0.0, waveform="sin"):
            if abs(float(amplitude)) > 1e-9:
                channels.append(Channel(bone, "rotation", local_axis(rig, bone, axis), float(amplitude), float(frequency), float(phase),
                                        waveform, envelope=env))

        def loc(bone, axis, amplitude, frequency, phase=0.0):
            if abs(float(amplitude)) > 1e-12:
                channels.append(Channel(bone, "location", local_axis(rig, bone, axis), float(amplitude), float(frequency), float(phase), envelope=env))

        loc("Body", YAW, clip.get("bob", 0.0), clip.get("bobFrequency", 1))
        rot("Body", PITCH, clip.get("bodyPitch", 0.0), clip.get("bodyPitchFrequency", 1), waveform=clip.get("bodyPitchWaveform", "sin"))
        abd_freq = clip.get("abdomenFrequency", 1)
        for index, (bone, amplitude) in enumerate(zip(("Abd_A", "Abd_B", "Abd_C"), clip.get("abdomen", []))):
            rot(bone, PITCH, amplitude, abd_freq, -0.6 * index)
        rot("Tail", PITCH, clip.get("tail", 0.0), abd_freq, -1.8)
        antenna = clip.get("antenna", [0.0, 0.0])
        sway = clip.get("antennaSway", 0.0)
        ant_freq = clip.get("antennaFrequency", 1)
        antl_amp = clip.get("antennule", 0.0)
        antl_freq = clip.get("antennuleFrequency", 2)
        leg_amp = clip.get("leg", 0.0)
        leg_freq = clip.get("legFrequency", 2)
        for s, suffix in SIDES:
            side_phase = 0.0 if s < 0 else math.pi
            rot(f"Pleo_A_{suffix}", PITCH, clip.get("pleopod", 0.0), clip.get("pleopodFrequency", 3), 0.0)
            rot(f"Pleo_B_{suffix}", PITCH, clip.get("pleopod", 0.0), clip.get("pleopodFrequency", 3), -0.7)
            ant_phase = 0.0 if s < 0 else 0.9
            rot(f"Ant_A_{suffix}", PITCH, antenna[0], ant_freq, ant_phase)
            rot(f"Ant_A_{suffix}", ROLL, s * sway, ant_freq, ant_phase + 1.3)
            rot(f"Ant_B_{suffix}", PITCH, antenna[1], ant_freq, ant_phase - 0.8)
            rot(f"Ant_B_{suffix}", ROLL, s * sway * 0.6, ant_freq, ant_phase + 0.5)
            rot(f"Antennule_{suffix}", PITCH, antl_amp, antl_freq, ant_phase)
            rot(f"Antennule_{suffix}", ROLL, s * antl_amp * 0.4, antl_freq, ant_phase + 1.1)
            for i in range(5):
                amplitude, frequency = leg_amp, leg_freq
                phase = side_phase - i * math.tau / 5
                if i < cheliped_count:
                    if "cheliped" in clip:
                        # picking: both chelipeds of a side reach together so neighbours never close on each other
                        amplitude, frequency, phase = clip["cheliped"], clip.get("chelipedFrequency", leg_freq), side_phase
                    elif "chelipedLeg" in clip:
                        amplitude = clip["chelipedLeg"]
                rot(f"Leg{i + 1}_{suffix}", PITCH, amplitude, frequency, phase)
            hand_freq = clip.get("handFrequency", clip.get("chelipedFrequency", leg_freq))
            for i in range(cheliped_count):
                rot(f"Hand{i + 1}_{suffix}", PITCH, clip.get("hand", 0.0), hand_freq, side_phase + 0.3)
            rot(f"Dactyl_{suffix}", dactyl_axes[suffix], clip.get("dactyl", 0.0), clip.get("dactylFrequency", hand_freq), side_phase + 1.0)
        clips.append(ClipSpec(clip_name, int(clip["frames"]), bool(clip["loop"]), channels))
    for clip in clips:
        bake_clip(rig, clip)

    # ---- contract
    meshes = [body_obj, limbs_obj, head_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="x")
    B, L, H = body_obj.name, limbs_obj.name, head_obj.name
    for part in body_parts:
        contract["closedParts"].append({"object": B, "group": f"part_{part.name}", "volumeFloor": 0.7 if part.name.startswith(("carapace", "abd")) else 0.6})
    for part in limb_parts:
        contract["closedParts"].append({"object": L, "group": f"part_{part.name}", "volumeFloor": 0.6})
    for part in head_parts:
        contract["closedParts"].append({"object": H, "group": f"part_{part.name}", "volumeFloor": 0.6})
    clearance = contract["clearance"]
    for s, suffix in SIDES:
        for i in range(5):
            for j in range(i + 1, 5):
                clearance.append({"a": [L, f"leg_{i + 1}_{suffix}"], "b": [L, f"leg_{j + 1}_{suffix}"], "label": f"leg{i + 1}_leg{j + 1}_{suffix}"})
        clearance.append({"a": [L, f"legs_{suffix}"], "b": [B, "abdomen"], "label": f"legs_abdomen_{suffix}"})
        clearance.append({"a": [L, f"legs_{suffix}"], "b": [L, f"pleopods_{suffix}", f"pleo_root_{suffix}"], "label": f"legs_pleopods_{suffix}"})
        clearance.append({"a": [L, f"legs_{suffix}"], "b": [L, "maxillipeds"], "label": f"legs_maxillipeds_{suffix}"})
        clearance.append({"a": [L, f"pleopods_{suffix}", f"pleo_root_{suffix}"], "b": [B, "abdomen"], "label": f"pleopods_abdomen_{suffix}"})
        clearance.append({"a": [L, f"pleopods_{suffix}", f"pleo_root_{suffix}"], "b": [B, "tailfan"], "label": f"pleopods_tailfan_{suffix}"})
        for group in ("carapace_all", "abdomen", "tailfan"):
            clearance.append({"a": [H, f"antennae_{suffix}", f"ant_root_{suffix}"], "b": [B, group], "label": f"antennae_{group}_{suffix}"})
        clearance.append({"a": [H, f"antennae_{suffix}", f"ant_root_{suffix}"], "b": [H, f"eyes_{suffix}"], "label": f"antennae_eyes_{suffix}"})
        clearance.append({"a": [H, f"antenna_{suffix}", f"ant_root_{suffix}"], "b": [H, f"antennule_{suffix}", f"ant_root_{suffix}"],
                          "label": f"antenna_antennule_{suffix}"})
    clearance.append({"a": [L, "legs_L"], "b": [L, "legs_R"], "label": "legs_left_right"})
    clearance.append({"a": [L, "pleopods_L", "pleo_root_L"], "b": [L, "pleopods_R", "pleo_root_R"], "label": "pleopods_left_right"})
    clearance.append({"a": [H, "antennae_L", "ant_root_L"], "b": [H, "antennae_R", "ant_root_R"], "label": "antennae_left_right"})
    for s, suffix in SIDES:
        contract["centerPlane"].append({"object": L, "group": f"legs_{suffix}", "exclude": None, "side": s})
        contract["centerPlane"].append({"object": L, "group": f"pleopods_{suffix}", "exclude": None, "side": s})
        contract["centerPlane"].append({"object": H, "group": f"antennae_{suffix}", "exclude": None, "side": s})
    contract["symmetry"] = [
        {"object": L, "left": "legs_L", "right": "legs_R", "tolerance": 0.0002},
        {"object": L, "left": "pleopods_L", "right": "pleopods_R", "tolerance": 0.0002},
        {"object": H, "left": "antennae_L", "right": "antennae_R", "tolerance": 0.0002},
        {"object": H, "left": "eyes_L", "right": "eyes_R", "tolerance": 0.0002},
        {"object": B, "left": "uropods_L", "right": "uropods_R", "tolerance": 0.0002},
    ]
    register_clips(contract, clips)

    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written,
                       notes={"bodyLengthMeters": float(ros["end"][0]) - float(tel["xEnd"]), "deformBones": len(rb.deform_names),
                              "parts": {"body": len(body_parts), "limbs": len(limb_parts), "head": len(head_parts)}})
