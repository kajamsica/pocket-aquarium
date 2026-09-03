"""Astrea snail, Lithopoma sp. (trade "Astrea"; most often Lithopoma tectum, the West Indian starsnail).

Species-local gastropod body plan (there is no shared snail plan). Anatomy choices:

* Shell: a dextral logarithmic conispiral lofted as one closed tube through 6.25 whorls. The
  generating curve is a rounded trapezoid measured in the radial plane of the body whorl
  (sutural shelf, slightly concave outer face, projecting carina, nearly flat base, columellar
  inner wall). Consecutive whorls overlap, so the union of the tube reads as a solid turbinate
  shell with an apical angle near 75 degrees and a whorl expansion of 1.9 per turn. About 22
  axial folds per whorl are modelled in the geometry as knobs that peak on the carina (the
  "star" of the star snail); growth striae, the two impressed spiral lines of the whorl face and
  the five subgranose basal lirae live in the normal map. The last 0.3 whorl is sheared so the
  aperture is oblique, and the shell is rotated into life position (apex back and to the right)
  with the aperture opening downward onto the foot. The shell is scaled so its extent across the
  animal (y) equals the reference basal diameter.
* Soft body: broad flattened foot with its sole on z = 0, a short body column that fills the
  aperture and merges into the foot dorsum, a rounded snout, two long cephalic tentacles and eye
  stalks at their outer bases (Turbinidae carry the eyes on short peduncles).
* Rig (7 deform bones): Foot_A/B/C are siblings under Root so the pedal wave can use location and
  scale channels without leaking scale into children; Head under Root (rotation and location
  only, so its tentacle children inherit clean transforms); Tentacle_L/R under Head; Shell under
  Root with its head at the aperture centroid.
* Clips: rest (loop), crawl (loop, preview action), retract (non-loop, hold envelope).

Everything is a deterministic function of asset.source.json and this module (fixed noise seeds).
"""

from __future__ import annotations

import math

import numpy as np
from mathutils import Matrix, Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import noise, paint, textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.rigging import RigBuilder, segment_weights

MM = 0.001
FOOT_BONES = ("Foot_A", "Foot_B", "Foot_C")

# Generating curve of the body whorl in its radial plane: (name, radial mm from the coiling
# axis, mm below the apex as a negative number, loft samples on the edge leaving this point,
# relative axial-fold amplitude with the carina = 1). Points run shoulder -> outer face ->
# carina -> base -> umbilical region -> columellar wall -> sutural shelf and back to the shoulder.
OUTLINE = (
    ("shoulder", 6.5, -9.1, 3, 0.14),
    ("face_a", 8.0, -11.7, 3, 0.36),
    ("face_b", 10.2, -14.1, 3, 0.64),
    ("carina", 12.5, -16.3, 1, 1.0),
    ("carina_base", 12.1, -16.9, 2, 0.72),
    ("base_a", 9.5, -17.4, 2, 0.27),
    ("base_b", 6.0, -17.7, 2, 0.09),
    ("base_c", 3.0, -17.5, 1, 0.0),
    ("umbilicus", 1.2, -16.9, 2, 0.0),
    ("inner_a", 0.9, -13.5, 2, 0.0),
    ("inner_top", 1.0, -9.8, 1, 0.0),
    ("shelf_a", 2.8, -9.1, 1, 0.0),
    ("shelf_b", 4.8, -8.95, 1, 0.0),
)
CARINA_DEPTH = -16.3


# ---------------------------------------------------------------- small helpers

def _smooth(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


class Curve:
    """Catmull-Rom interpolation through (x, y) samples with clamped ends."""

    def __init__(self, xs, ys):
        self.xs = list(xs)
        self.ys = list(ys)

    def __call__(self, x: float) -> float:
        xs, ys = self.xs, self.ys
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        for i in range(len(xs) - 1):
            if xs[i] <= x <= xs[i + 1]:
                h = xs[i + 1] - xs[i]
                t = (x - xs[i]) / h
                m0 = (ys[i + 1] - ys[max(i - 1, 0)]) / (xs[i + 1] - xs[max(i - 1, 0)])
                m1 = (ys[min(i + 2, len(xs) - 1)] - ys[i]) / (xs[min(i + 2, len(xs) - 1)] - xs[i])
                h00 = 2 * t ** 3 - 3 * t ** 2 + 1
                h10 = t ** 3 - 2 * t ** 2 + t
                h01 = -2 * t ** 3 + 3 * t ** 2
                h11 = t ** 3 - t ** 2
                return h00 * ys[i] + h10 * h * m0 + h01 * ys[i + 1] + h11 * h * m1
        return ys[-1]


def _loft_t(index: int, segments: int, ring_count: int) -> float:
    """Normalised position along a capped loft for vertex `index` (caps map to 0 and 1)."""
    if index < ring_count * segments:
        return (index // segments) / max(ring_count - 1, 1)
    return 0.0 if index == ring_count * segments else 1.0


def _newell(ring) -> Vector:
    normal = Vector((0.0, 0.0, 0.0))
    count = len(ring)
    for i in range(count):
        p = Vector(ring[i])
        q = Vector(ring[(i + 1) % count])
        normal.x += (p.y - q.y) * (p.z + q.z)
        normal.y += (p.z - q.z) * (p.x + q.x)
        normal.z += (p.x - q.x) * (p.y + q.y)
    return normal.normalized()


def _centroid(points) -> Vector:
    total = Vector((0.0, 0.0, 0.0))
    for p in points:
        total += Vector(p)
    return total / len(points)


# ---------------------------------------------------------------- shell

def sample_outline():
    """Sample the generating curve: list of (A_mm, B_mm, kappa), cumulative arc fractions, key v."""
    samples = []
    names = []
    count = len(OUTLINE)
    for i, (name, a, b, edge_samples, kappa) in enumerate(OUTLINE):
        _n2, a2, b2, _s2, kappa2 = OUTLINE[(i + 1) % count]
        for k in range(edge_samples):
            f = k / edge_samples
            samples.append((a + (a2 - a) * f, b + (b2 - b) * f, kappa + (kappa2 - kappa) * f))
            names.append(name if k == 0 else None)
    lengths = []
    for j, (a, b, _k) in enumerate(samples):
        a2, b2, _k2 = samples[(j + 1) % len(samples)]
        lengths.append(math.hypot(a2 - a, b2 - b))
    total = sum(lengths)
    cumulative = [0.0]
    for length in lengths:
        cumulative.append(cumulative[-1] + length / total)
    cumulative[-1] = 1.0
    key_v = {name: cumulative[j] for j, name in enumerate(names) if name}
    return samples, cumulative, key_v


def shell_rings(shell: dict, samples):
    """Conispiral rings (mm, shell frame: coiling axis +Z, apex at the origin, dextral)."""
    whorls = float(shell.get("whorls", 6.25))
    expansion = float(shell.get("whorlExpansion", 1.9))
    rings_body = float(shell.get("bodyWhorlRingsPerTurn", 138))
    min_rings = float(shell.get("minRingsPerTurn", 12))
    knobs = int(shell.get("knobsPerWhorl", 22))
    amplitude = float(shell.get("knobAmplitude", 0.10))
    sharpness = float(shell.get("knobSharpness", 2.2))
    slant = float(shell.get("knobSlantRadiansPerMm", 0.05))
    shear = float(shell.get("apertureShearRadians", 0.4))
    shear_span = float(shell.get("apertureShearWhorls", 0.3)) * math.tau
    lip_constriction = float(shell.get("lipConstriction", 0.08))
    lip_span = float(shell.get("lipWhorls", 0.1)) * math.tau
    big_theta = whorls * math.tau
    k = math.log(expansion) / math.tau

    def scale(theta: float) -> float:
        return math.exp(k * (theta - big_theta))

    thetas = []
    theta = 0.0
    max_step = math.tau / min_rings
    rho = rings_body / math.tau
    while theta < big_theta:
        thetas.append(theta)
        theta += min(max_step, 1.0 / (rho * scale(theta)))
    if len(thetas) > 1 and big_theta - thetas[-1] < 0.35 * (thetas[-1] - thetas[-2]):
        thetas[-1] = big_theta
    else:
        thetas.append(big_theta)

    b_values = [b for _a, b, _k in samples]
    b_min, b_max = min(b_values), max(b_values)
    rings = []
    for theta_i in thetas:
        w = _smooth((theta_i - (big_theta - shear_span)) / shear_span) if shear_span > 0 else 0.0
        ring = []
        for a, b, kappa in samples:
            # oblique (prosocline) lip: the sutural side of the aperture leads and the basal side
            # trails, which tilts the aperture plane toward the base so it can face the substrate
            th = theta_i + w * shear * ((b - b_min) / (b_max - b_min))
            s = scale(th)
            bump = (0.5 + 0.5 * math.cos(knobs * th + slant * (b - CARINA_DEPTH))) ** sharpness
            radial = a * (1.0 + amplitude * kappa * bump)
            ring.append((s * radial * math.cos(th), -s * radial * math.sin(th), s * b))
        # thickened outer lip: the aperture constricts slightly so the tube end reads as a rounded
        # rim rather than a raw cut
        pinch = _smooth((theta_i - (big_theta - lip_span)) / lip_span) if lip_span > 0 else 0.0
        if pinch > 0:
            cx = sum(p[0] for p in ring) / len(ring)
            cy = sum(p[1] for p in ring) / len(ring)
            cz = sum(p[2] for p in ring) / len(ring)
            factor = 1.0 - lip_constriction * pinch
            ring = [(cx + (p[0] - cx) * factor, cy + (p[1] - cy) * factor, cz + (p[2] - cz) * factor) for p in ring]
        rings.append(ring)
    u_values = [t / big_theta for t in thetas]
    tangent = Vector((-math.sin(big_theta), -math.cos(big_theta), 0.0))
    return rings, u_values, tangent


def life_orientation(aperture_normal: Vector, tilt_degrees: float, yaw_degrees: float, bias_degrees: float):
    """Rotation taking the shell frame to life position: coiling axis tilted back (and to +y by
    yaw) with the free spin about the axis chosen so the oblique aperture opens as far downward
    as possible (plus an optional bias)."""
    tau = math.radians(tilt_degrees)
    eps = math.radians(yaw_degrees)
    axis_world = Vector((-math.sin(tau) * math.cos(eps), math.sin(tau) * math.sin(eps), math.cos(tau)))
    z = Vector((0.0, 0.0, 1.0))
    pivot = z.cross(axis_world)
    align = Matrix.Rotation(z.angle(axis_world), 3, pivot.normalized()) if pivot.length > 1e-9 else Matrix.Identity(3)
    best = None
    for step in range(3600):
        gamma = step / 3600 * math.tau
        rotation = align @ Matrix.Rotation(gamma, 3, "Z")
        down = (rotation @ aperture_normal).z
        if best is None or down < best[0]:
            best = (down, gamma)
    gamma = best[1] + math.radians(bias_degrees)
    return align @ Matrix.Rotation(gamma, 3, "Z"), axis_world


def build_shell(spec: dict, samples, cumulative):
    shell = spec["morphology"]["shell"]
    rings_mm, u_values, tangent = shell_rings(shell, samples)
    segments = len(samples)
    vertices, faces, uvs, face_uvs = msh.loft(rings_mm, u_values=u_values, cap_start=True, cap_end=True)

    aperture_local = rings_mm[-1]
    normal_local = _newell(aperture_local)
    if normal_local.dot(tangent) < 0:
        normal_local = -normal_local
    rotation, axis_world = life_orientation(normal_local, float(shell.get("tiltDegrees", 22.0)),
                                            float(shell.get("yawDegrees", 20.0)), float(shell.get("apertureYawBiasDegrees", 0.0)))
    rotated = [rotation @ Vector(v) for v in vertices]
    ys = [v.y for v in rotated]
    factor = float(spec["referenceSize"]["meters"]) / ((max(ys) - min(ys)) * MM)
    scaled = [v * (factor * MM) for v in rotated]
    aperture = [scaled[(len(rings_mm) - 1) * segments + j] for j in range(segments)]
    center = _centroid(aperture)
    floor = float(shell.get("clearanceAboveSubstrate", 0.0065))
    target = shell.get("apertureCenter", [-0.001, -0.002])
    offset = Vector((float(target[0]) - center.x, float(target[1]) - center.y, floor - min(v.z for v in scaled)))
    placed = [tuple(v + offset) for v in scaled]
    aperture = [Vector(placed[(len(rings_mm) - 1) * segments + j]) for j in range(segments)]
    aperture_normal = (rotation @ normal_local).normalized()

    def remap_v(v: float) -> float:
        idx = v * segments
        nearest = int(round(idx))
        if abs(idx - nearest) < 1e-6 and 0 <= nearest <= segments:
            return cumulative[nearest]
        return v

    uvs = [(u, remap_v(v)) for u, v in uvs]
    face_uvs = [tuple((u, remap_v(v)) for u, v in corners) for corners in face_uvs]
    geometry = (placed, faces, uvs, face_uvs)
    info = {"aperture": aperture, "apertureNormal": aperture_normal, "apertureCenter": _centroid(aperture),
            "axis": (rotation @ Vector((0.0, 0.0, 1.0))).normalized(), "scaleFactor": factor * MM,
            "ringCount": len(rings_mm), "segments": segments, "lowestZ": floor}
    return geometry, info


# ---------------------------------------------------------------- soft body

def foot_geometry(foot: dict):
    stations = foot["stations"]
    xs = [s[0] for s in stations]
    half_width = Curve(xs, [s[1] for s in stations])
    height = Curve(xs, [s[2] for s in stations])
    ring_count = int(foot.get("rings", 26))
    segments = int(foot.get("segments", 24))
    exp_d = float(foot.get("dorsalExponent", 2.1))
    exp_v = float(foot.get("ventralExponent", 6.0))
    cz = float(foot.get("soleCenter", 0.00045))
    rings = []
    u_values = []
    for i in range(ring_count):
        t = i / (ring_count - 1)
        x = xs[0] + (xs[-1] - xs[0]) * t
        h = max(height(x), cz * 1.6)
        rings.append(msh.superellipse_ring(x, max(half_width(x), 0.0004), h - cz, cz, 0.0, cz, segments, exp_d, exp_v))
        u_values.append(t)
    return msh.loft(rings, u_values=u_values, cap_start=True, cap_end=True), xs[0], xs[-1]


def tentacle_points(tent: dict, side: int):
    """Polyline of one tentacle; the spec describes the left (y < 0) tentacle, side +1 mirrors it."""
    base = Vector(tent["base"])
    direction = Vector(tent["direction"]).normalized()
    mirror = 1.0 if side < 0 else -1.0
    base.y *= mirror
    direction.y *= mirror
    length = float(tent["length"])
    lift = float(tent.get("lift", 0.0006))
    count = len(tent["radii"])
    points = []
    for i in range(count):
        t = i / (count - 1)
        p = base + direction * (length * t) + Vector((0.0, 0.0, lift * math.sin(math.pi * t)))
        points.append(tuple(p))
    return points


def body_column(info: dict, column: dict, foot_height: Curve):
    """Closed loft from just inside the aperture down into the foot dorsum (the mantle/body mass)."""
    aperture = info["aperture"]
    normal = info["apertureNormal"]
    center = info["apertureCenter"]
    inset = float(column.get("inset", 0.0022))
    shrink_inner = float(column.get("shrinkInner", 0.94))
    shrink_rim = float(column.get("shrinkRim", 0.92))
    ax, ay = (float(v) for v in column.get("footEllipse", [0.0045, 0.004]))
    descent_rings = int(column.get("rings", 8))
    bulge = float(column.get("bulge", 0.05))
    depth = float(column.get("footDepthFraction", 0.75))
    x_axis = Vector((1.0, 0.0, 0.0))
    e1 = (x_axis - normal * x_axis.dot(normal)).normalized()
    e2 = normal.cross(e1)
    angles = [math.atan2((p - center).dot(e2), (p - center).dot(e1)) for p in aperture]
    # the body fills the aperture: one ring seated inside the shell, one flush with the lip
    inner = [tuple(center - normal * inset + (p - center) * shrink_inner) for p in aperture]
    rim = [center + (p - center) * shrink_rim for p in aperture]
    end_center = Vector((center.x + 0.0005, center.y * 0.5, foot_height(center.x + 0.0005) * depth))
    # the foot-side ellipse uses the horizontal projection of the aperture frame (same handedness
    # about its downward normal) so the loft between the two rings carries no twist
    e1_end = Vector((e1.x, e1.y, 0.0))
    e1_end = e1_end.normalized() if e1_end.length > 1e-6 else Vector((1.0, 0.0, 0.0))
    e2_end = Vector((0.0, 0.0, -1.0)).cross(e1_end)
    end = [end_center + e1_end * (ax * math.cos(phi)) + e2_end * (ay * math.sin(phi)) for phi in angles]
    rings = [inner]
    for k in range(descent_rings + 1):
        t = k / descent_rings
        te = _smooth(t)
        ring_center = center.lerp(end_center, te)
        swell = 1.0 + bulge * math.sin(math.pi * t)
        ring = []
        for a, b in zip(rim, end):
            p = a.lerp(b, te)
            ring.append(tuple(ring_center + (p - ring_center) * swell))
        rings.append(ring)
    return msh.loft(rings, cap_start=True, cap_end=True), len(rings), len(aperture)


# ---------------------------------------------------------------- paint

def paint_shell(spec: dict, samples, cumulative, key_v, width: int, height: int):
    palette = spec.get("palette", {})
    shell = spec["morphology"]["shell"]
    U, V = textures.uv_grid(width, height)
    whorls = float(shell.get("whorls", 6.25))
    knobs = int(shell.get("knobsPerWhorl", 22))
    slant = float(shell.get("knobSlantRadiansPerMm", 0.05))
    theta = U * whorls * math.tau
    # depth below the apex (mm at s = 1) as a function of v, from the sampled outline
    b_by_v = np.interp(V, cumulative, [b for _a, b, _k in samples] + [samples[0][1]])
    kappa_by_v = np.interp(V, cumulative, [k for _a, _b, k in samples] + [samples[0][2]])
    crest = (0.5 + 0.5 * np.cos(knobs * theta + slant * (b_by_v - CARINA_DEPTH))) ** 2.2
    v_car = key_v["carina"]
    v_umb = key_v["umbilicus"]
    v_top = key_v["inner_top"]
    face = 1.0 - noise.smoothstep(v_car - 0.01, v_car + 0.01, V)
    base = noise.smoothstep(v_car - 0.005, v_car + 0.015, V) * (1.0 - noise.smoothstep(v_umb - 0.01, v_umb + 0.01, V))
    inner = noise.smoothstep(v_umb - 0.01, v_umb + 0.01, V)

    olive = palette.get("shell", (0.36, 0.31, 0.16))
    pale = palette.get("shellPale", (0.80, 0.74, 0.60))
    cream = palette.get("shellBase", (0.84, 0.80, 0.70))
    algae = palette.get("algae", (0.27, 0.36, 0.13))
    albedo = textures.rgba(olive, 1.0, U.shape)
    # darker olive-brown clouding and greener algal film, stronger toward the spire and shoulder
    cloud = noise.fbm(U * 40.0, V * 6.0, octaves=3, seed=11)
    albedo = textures.mix(albedo, (0.22, 0.17, 0.09), noise.smoothstep(0.55, 0.8, cloud) * 0.7)
    algal = noise.fbm(U * 26.0 + 3.0, V * 5.0, octaves=3, seed=23) * (0.6 + 0.4 * (1.0 - U)) * (1.0 - noise.smoothstep(0.35, 0.8, V / max(v_car, 1e-6)))
    albedo = textures.mix(albedo, algae, noise.smoothstep(0.38, 0.7, algal) * 0.7)
    # pale streaks riding the fold crests, broken up so they read as flame marks not stripes
    streak = crest * noise.smoothstep(0.45, 0.78, noise.fbm(U * 90.0, V * 3.0, octaves=2, seed=31))
    albedo = textures.mix(albedo, pale, np.clip(streak * 0.6, 0.0, 1.0) * face)
    # the two impressed spiral lines on the whorl face darken slightly
    face_lines = paint.band(V, v_car * 0.42, 0.008, 0.006) + paint.band(V, v_car * 0.72, 0.008, 0.006)
    albedo = textures.mix(albedo, (0.18, 0.15, 0.08), np.clip(face_lines, 0.0, 1.0) * 0.35 * face)
    # base: cream with faint tan radial flames and greyer lirae; umbilical tract palest
    base_albedo = textures.rgba(cream, 1.0, U.shape)
    flames = noise.smoothstep(0.5, 0.8, (0.5 + 0.5 * np.cos(knobs * theta * 0.5 + 0.7)) * noise.fbm(U * 60.0, V * 4.0, 2, seed=41) * 1.4)
    base_albedo = textures.mix(base_albedo, (0.64, 0.54, 0.38), flames * 0.45)
    lirae = np.zeros_like(U)
    for index in range(5):
        lirae = np.maximum(lirae, paint.band(V, v_car + (v_umb - v_car) * (0.12 + 0.18 * index), 0.006, 0.005))
    base_albedo = textures.mix(base_albedo, (0.70, 0.68, 0.62), lirae * 0.5)
    base_albedo = textures.mix(base_albedo, (0.72, 0.64, 0.74), noise.smoothstep(v_umb - 0.05, v_umb, V) * 0.5)
    albedo = textures.mix(albedo, base_albedo, base)
    albedo = textures.mix(albedo, (0.82, 0.80, 0.74), inner)
    grain = noise.fbm(U * 160.0, V * 40.0, octaves=3, seed=5)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.2 * grain)
    albedo[..., 3] = 1.0

    roughness = 0.58 + 0.18 * noise.smoothstep(0.38, 0.7, algal) - 0.10 * crest * face
    roughness = roughness * (1.0 - base) + 0.36 * base
    roughness = roughness * (1.0 - inner) + 0.28 * inner
    roughness += 0.06 * (grain - 0.5)

    # relief: fold knobs, growth striae (axial), spiral lines on the face, granulose lirae on the base
    striae = 0.5 + 0.5 * np.sin(theta * knobs * 5.0 + 2.5 * noise.fbm(U * 30.0, V * 8.0, 2, seed=7))
    height_map = 0.5 + 0.22 * crest * kappa_by_v + 0.08 * (striae - 0.5) * (face + 0.5 * base)
    height_map -= 0.18 * np.clip(face_lines, 0.0, 1.0) * face
    granules = (0.5 + 0.5 * np.cos(knobs * theta * 2.0 + 1.3)) ** 2.0
    height_map += 0.16 * lirae * (0.4 + 0.6 * granules) * base
    height_map += 0.05 * (noise.fbm(U * 200.0, V * 60.0, 2, seed=9) - 0.5)
    height_map = np.clip(height_map, 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_map, 1.0)}


def paint_body(spec: dict, width: int, height: int):
    palette = spec.get("palette", {})
    U, V = textures.uv_grid(width, height)
    dark = palette.get("body", (0.11, 0.095, 0.08))
    fleck = palette.get("bodyFleck", (0.30, 0.27, 0.22))
    albedo = textures.rgba(dark, 1.0, U.shape)
    mottle = noise.fbm(U * 14.0, V * 7.0, octaves=3, seed=17)
    albedo = textures.mix(albedo, (0.20, 0.18, 0.15), noise.smoothstep(0.5, 0.75, mottle) * 0.6)
    specks = paint.spots(U, V, density=70.0, radius=0.22, seed=29, jitter_radius=0.5)
    albedo = textures.mix(albedo, fleck, specks * 0.85)
    sole = paint.band(V, 0.5, 0.17, 0.08)
    albedo = textures.mix(albedo, (0.34, 0.30, 0.25), sole * 0.7)
    grain = noise.fbm(U * 120.0, V * 50.0, octaves=2, seed=3)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * grain)
    albedo[..., 3] = 1.0
    roughness = 0.46 + 0.12 * mottle + 0.1 * sole - 0.08 * specks
    height_map = np.clip(0.5 + 0.18 * (noise.fbm(U * 90.0, V * 40.0, 3, seed=13) - 0.5) + 0.12 * specks, 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_map, 0.9)}


# ---------------------------------------------------------------- animation

def build_clips(spec: dict) -> list[ClipSpec]:
    clips = []
    for name, clip in spec["animation"].items():
        frames = int(clip["frames"])
        loop = bool(clip["loop"])
        env = None if loop else clip.get("envelope", "hold")
        channels: list[Channel] = []
        if name == spec["clipRoles"]["idle"]:
            sway = float(clip.get("tentacleSway", 4.0))
            pitch = float(clip.get("tentaclePitch", 3.0))
            pulse = float(clip.get("footPulse", 0.015))
            channels += [
                Channel("Tentacle_L", "rotation", (0, 0, 1), sway, 1, 0.0),
                Channel("Tentacle_R", "rotation", (0, 0, 1), sway, 1, math.pi / 2),
                Channel("Tentacle_L", "rotation", (1, 0, 0), pitch, 2, 0.6),
                Channel("Tentacle_R", "rotation", (1, 0, 0), pitch, 2, 1.4),
                Channel("Head", "rotation", (1, 0, 0), float(clip.get("headNod", 1.5)), 1, 1.0),
                Channel("Foot_A", "scale", (0, 1, 0), pulse * 0.7, 2, 0.0),
                Channel("Foot_B", "scale", (0, 1, 0), pulse, 2, -1.0),
                Channel("Foot_C", "scale", (0, 1, 0), pulse * 0.7, 2, -2.0),
                Channel("Shell", "rotation", (1, 0, 0), float(clip.get("shellRock", 0.4)), 1, 0.5),
            ]
        elif name == spec["clipRoles"]["locomotion"]:
            shift = float(clip.get("pedalShift", 0.00035))
            pedal_scale = float(clip.get("pedalScale", 0.05))
            frequency = float(clip.get("pedalFrequency", 2))
            lag = float(clip.get("pedalLag", 1.05))
            for index, bone in enumerate(FOOT_BONES):
                channels.append(Channel(bone, "location", (0, 1, 0), shift, frequency, -index * lag))
                channels.append(Channel(bone, "scale", (0, 1, 0), pedal_scale, frequency, -index * lag + math.pi / 2))
            sway = float(clip.get("tentacleSway", 7.0))
            pitch = float(clip.get("tentaclePitch", 5.0))
            channels += [
                Channel("Tentacle_L", "rotation", (0, 0, 1), sway, 1, 0.0),
                Channel("Tentacle_R", "rotation", (0, 0, 1), sway, 1, math.pi / 2),
                Channel("Tentacle_L", "rotation", (1, 0, 0), pitch, 2, 0.3),
                Channel("Tentacle_R", "rotation", (1, 0, 0), pitch, 2, 1.1),
                Channel("Head", "rotation", (1, 0, 0), float(clip.get("headNod", 3.0)), frequency, 0.4),
                Channel("Head", "location", (0, 1, 0), float(clip.get("headShift", 0.0003)), frequency, -3 * lag),
                Channel("Shell", "rotation", (1, 0, 0), float(clip.get("shellPitch", 1.2)), frequency, 0.9),
                Channel("Shell", "rotation", (0, 0, 1), float(clip.get("shellYaw", 0.8)), 1, 0.0),
            ]
        else:
            shrink = float(clip.get("tentacleShrink", 0.5))
            lift = float(clip.get("tentacleLift", 15.0))
            compress = float(clip.get("footCompress", 0.1))
            channels += [
                Channel("Tentacle_L", "scale", (0, 1, 0), -shrink, 1, 0.0, "const", envelope=env),
                Channel("Tentacle_R", "scale", (0, 1, 0), -shrink, 1, 0.0, "const", envelope=env),
                Channel("Tentacle_L", "rotation", (1, 0, 0), lift, 1, 0.0, "const", envelope=env),
                Channel("Tentacle_R", "rotation", (1, 0, 0), lift, 1, 0.0, "const", envelope=env),
                Channel("Head", "location", (0, 1, 0), -float(clip.get("headRetract", 0.003)), 1, 0.0, "const", envelope=env),
                Channel("Head", "rotation", (1, 0, 0), -6.0, 1, 0.0, "const", envelope=env),
                Channel("Foot_C", "location", (0, 1, 0), -float(clip.get("footFrontRetract", 0.0012)), 1, 0.0, "const", envelope=env),
                Channel("Foot_C", "scale", (0, 1, 0), -compress * 1.2, 1, 0.0, "const", envelope=env),
                Channel("Foot_A", "location", (0, 1, 0), float(clip.get("footRearAdvance", 0.001)), 1, 0.0, "const", envelope=env),
                Channel("Foot_A", "scale", (0, 1, 0), -compress, 1, 0.0, "const", envelope=env),
                Channel("Foot_B", "scale", (0, 1, 0), -compress * 0.5, 1, 0.0, "const", envelope=env),
                Channel("Foot_B", "scale", (0, 0, 1), compress * 0.6, 1, 0.0, "const", envelope=env),
                Channel("Shell", "rotation", (1, 0, 0), -float(clip.get("shellDip", 4.0)), 1, 0.0, "const", envelope=env),
            ]
        # Key every transform kind on every deform bone in every clip. Clips are evaluated back to
        # back by the validator and the exporter, so an unkeyed property would otherwise carry a
        # stale pose from the previous clip into this one (each bone still moves in every clip).
        present = {(channel.target, channel.kind) for channel in channels}
        for bone in (*FOOT_BONES, "Head", "Tentacle_L", "Tentacle_R", "Shell"):
            for kind in ("rotation", "location", "scale"):
                if (bone, kind) not in present:
                    channels.append(Channel(bone, kind, (0, 0, 1), 0.0, 1, 0.0, "const", envelope=env))
        clips.append(ClipSpec(name, frames, loop, channels))
    return clips


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morphology = spec["morphology"]
    palette = spec.get("palette", {})
    tex = spec.get("textures", {})

    # ---- shell geometry first: the soft body is fitted to where the aperture lands
    samples, cumulative, key_v = sample_outline()
    shell_geometry, shell_info = build_shell(spec, samples, cumulative)

    # ---- textures and materials
    shell_w, shell_h = tex.get("shellResolution", [1024, 512])
    body_w, body_h = tex.get("bodyResolution", [512, 256])
    written = []
    images = {}
    for stem, painted in (("shell", paint_shell(spec, samples, cumulative, key_v, shell_w, shell_h)),
                          ("body", paint_body(spec, body_w, body_h))):
        for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
            path = ctx.texture_dir / f"{stem}-{key}.png"
            images[f"{stem}_{key}"] = textures.write_image(f"{prefix}_{stem.capitalize()}_{key}", path, painted[key], non_color)
            written.append(path)
    shell_material = mat.principled(f"{prefix}_Shell", palette.get("shell", (0.36, 0.31, 0.16)), 0.48, coat=0.12, subsurface=0.0, specular=0.42)
    mat.attach_textures(shell_material, albedo=images["shell_albedo"], roughness=images["shell_roughness"], normal=images["shell_normal"],
                        normal_strength=float(tex.get("shellNormalStrength", 0.6)))
    body_material = mat.principled(f"{prefix}_Body", palette.get("body", (0.11, 0.095, 0.08)), 0.5, coat=0.05, subsurface=0.14, specular=0.35)
    mat.attach_textures(body_material, albedo=images["body_albedo"], roughness=images["body_roughness"], normal=images["body_normal"],
                        normal_strength=float(tex.get("bodyNormalStrength", 0.45)))
    eye_material = mat.principled(f"{prefix}_Eye", palette.get("eye", (0.01, 0.008, 0.008)), 0.2, coat=0.5, subsurface=0.0)
    material_map = {"shell": shell_material, "body": body_material, "eye": eye_material}

    # ---- rig
    rig_spec = spec.get("rig", {})
    joints = [float(v) for v in rig_spec.get("footJoints", [-0.010, -0.003, 0.004, 0.011])]
    head_bone = rig_spec.get("head", [[0.005, 0.0, 0.0035], [0.0135, 0.0, 0.0036]])
    tent = morphology["tentacles"]
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.004), deform=False)
    sole_z = float(morphology["foot"].get("soleCenter", 0.00045))
    for index, name in enumerate(FOOT_BONES):
        rb.bone(name, (joints[index], 0.0, sole_z), (joints[index + 1], 0.0, sole_z), "Root")
    rb.bone("Head", tuple(head_bone[0]), tuple(head_bone[1]), "Root")
    for side, suffix in ((-1, "L"), (1, "R")):
        points = tentacle_points(tent, side)
        rb.bone(f"Tentacle_{suffix}", points[0], points[-1], "Head")
    shell_head = shell_info["apertureCenter"]
    shell_tail = shell_head + shell_info["axis"] * float(rig_spec.get("shellBoneLength", 0.008))
    rb.bone("Shell", tuple(shell_head), tuple(shell_tail), "Root")
    rig = rb.finish()

    # ---- shell object
    shell_part = msh.make_part("shell", shell_geometry, "shell", lambda i, v: {"Shell": 1.0}, closed=True)
    shell_obj = msh.assemble(f"{prefix}_Shell", [shell_part], material_map, rig, f"{prefix}_Armature")
    shell_obj["lod"] = 1

    # ---- soft body
    foot_spec = morphology["foot"]
    foot_geom, foot_x0, foot_x1 = foot_geometry(foot_spec)
    foot_height = Curve([s[0] for s in foot_spec["stations"]], [s[2] for s in foot_spec["stations"]])
    xa, xc = joints[0], joints[-1]

    def foot_weights(_i, v):
        return segment_weights((v[0] - xa) / (xc - xa), list(FOOT_BONES), softness=0.7)

    foot_part = msh.make_part("foot", foot_geom, "body", foot_weights, closed=True)

    column_geom, column_rings, column_segments = body_column(shell_info, morphology.get("bodyColumn", {}), foot_height)

    def column_weights(i, _v):
        t = _loft_t(i, column_segments, column_rings)
        return msh.blend_weights({"Shell": 1.0}, {"Foot_B": 1.0}, _smooth(t))

    column_part = msh.make_part("body_column", column_geom, "body", column_weights, closed=True)

    head_spec = morphology["head"]
    head_points = [tuple(p) for p in head_spec["path"]]
    head_segments = int(head_spec.get("segments", 16))
    head_geom = msh.tube(head_points, [float(r) for r in head_spec["radii"]], head_segments, aspect=float(head_spec.get("aspect", 0.85)))

    def head_weights(i, _v):
        t = _loft_t(i, head_segments, len(head_points))
        return msh.blend_weights({"Foot_C": 1.0}, {"Head": 1.0}, _smooth((t - 0.15) / 0.45))

    head_part = msh.make_part("head", head_geom, "body", head_weights, closed=True)

    tent_segments = int(tent.get("segments", 10))
    tent_points = tentacle_points(tent, -1)
    tent_geom = msh.tube(tent_points, [float(r) for r in tent["radii"]], tent_segments)

    def tentacle_weights(i, _v):
        t = _loft_t(i, tent_segments, len(tent_points))
        return msh.blend_weights({"Head": 1.0}, {"Tentacle_L": 1.0}, _smooth((t - 0.1) / 0.35))

    tentacle_l = msh.make_part("tentacle_L", tent_geom, "body", tentacle_weights, closed=True)
    tentacle_r = tentacle_l.mirror_y(rename={"_L": "_R"})

    eyes = morphology["eyes"]
    stalk_from = Vector(eyes["stalkFrom"])
    stalk_to = Vector(eyes["stalkTo"])
    stalk_radius = float(eyes.get("stalkRadius", 0.0003))
    stalk_geom = msh.tube([tuple(stalk_from), tuple(stalk_from.lerp(stalk_to, 0.5)), tuple(stalk_to)], [stalk_radius, stalk_radius * 0.9, stalk_radius * 0.8], 8)
    stalk_l = msh.make_part("eyestalk_L", stalk_geom, "body", lambda i, v: {"Head": 1.0}, closed=True)
    stalk_r = stalk_l.mirror_y(rename={"_L": "_R"})
    eye_radius = float(eyes.get("radius", 0.00042))
    eye_l = msh.make_part("eye_L", msh.ellipsoid(tuple(stalk_to), (eye_radius, eye_radius, eye_radius), 10, 6), "eye",
                          lambda i, v: {"Head": 1.0}, closed=True)
    eye_r = eye_l.mirror_y(rename={"_L": "_R"})

    body_parts = [foot_part, column_part, head_part, tentacle_l, tentacle_r, stalk_l, stalk_r, eye_l, eye_r]
    body_obj = msh.assemble(f"{prefix}_Body", body_parts, material_map, rig, f"{prefix}_Armature")
    body_obj["lod"] = 1
    shell_obj["adultShellDiameterMeters"] = spec["referenceSize"]["meters"]

    # ---- animation
    clips = build_clips(spec)
    for clip in clips:
        bake_clip(rig, clip)

    # ---- contract
    meshes = [shell_obj, body_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="y")
    contract["closedParts"] += [
        {"object": shell_obj.name, "group": "part_shell", "volumeFloor": 0.9},
        {"object": body_obj.name, "group": "part_foot", "volumeFloor": 0.6},
        {"object": body_obj.name, "group": "part_body_column", "volumeFloor": 0.6},
        {"object": body_obj.name, "group": "part_head", "volumeFloor": 0.6},
        {"object": body_obj.name, "group": "part_tentacle_L", "volumeFloor": 0.4},
        {"object": body_obj.name, "group": "part_tentacle_R", "volumeFloor": 0.4},
    ]
    for suffix in ("L", "R"):
        contract["clearance"] += [
            {"a": [body_obj.name, f"part_tentacle_{suffix}"], "b": [body_obj.name, "part_foot"], "label": f"tentacle_{suffix}_foot"},
            {"a": [body_obj.name, f"part_tentacle_{suffix}"], "b": [shell_obj.name, "part_shell"], "minDistance": 0.0015, "label": f"tentacle_{suffix}_shell"},
            {"a": [body_obj.name, f"part_tentacle_{suffix}"], "b": [body_obj.name, "part_body_column"], "label": f"tentacle_{suffix}_body_column"},
        ]
    contract["clearance"] += [
        {"a": [body_obj.name, "part_tentacle_L"], "b": [body_obj.name, "part_tentacle_R"], "minDistance": 0.0015, "label": "tentacle_pair"},
        {"a": [body_obj.name, "part_head"], "b": [shell_obj.name, "part_shell"], "minDistance": 0.0005, "label": "head_shell"},
        {"a": [body_obj.name, "part_foot"], "b": [shell_obj.name, "part_shell"], "label": "foot_shell"},
    ]
    for side, suffix in ((-1, "L"), (1, "R")):
        for part in ("tentacle", "eye", "eyestalk"):
            contract["centerPlane"].append({"object": body_obj.name, "group": f"part_{part}_{suffix}", "exclude": None, "side": side})
    contract["symmetry"] = [{"object": body_obj.name, "left": f"part_{part}_L", "right": f"part_{part}_R", "tolerance": 0.00002}
                            for part in ("tentacle", "eye", "eyestalk")]
    contract["axialChain"] = None
    register_clips(contract, clips)

    notes = {
        "shellRings": shell_info["ringCount"], "shellSegments": shell_info["segments"],
        "shellScaleFactor": shell_info["scaleFactor"], "apertureNormal": [round(c, 4) for c in shell_info["apertureNormal"]],
        "apertureCenter": [round(c, 5) for c in shell_info["apertureCenter"]], "shellAxis": [round(c, 4) for c in shell_info["axis"]],
        "footExtentX": [foot_x0, foot_x1], "keyV": {k: round(v, 4) for k, v in key_v.items()},
    }
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
