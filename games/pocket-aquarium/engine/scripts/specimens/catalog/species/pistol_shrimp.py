"""Alpheus bellulus, tiger pistol shrimp: species-local `decapod_shrimp` body plan.

There is no shared crustacean plan, so this module defines `build(spec, species, ctx)` itself.
All coordinates come from `asset.source.json` (design metres, forward +X, up +Z, symmetry plane
y = 0) and the finished design is scaled uniformly so the rest-pose x extent equals
`referenceSize.meters`.

Anatomy choices
- Cephalothorax: one closed superellipse loft (flat sternum, rounded back) with a sharp rostral
  carina tube, two inflated orbital hood ellipsoids roofing small dark eyes (alpheid eyes are hidden
  from above, visible from the front and below).
- Abdomen: six telescoping somites, each an independent closed loft whose anterior ring nests inside
  the somite before it, so the exoskeleton reads as articulated plates. Pleopod paddles hang below.
- Tail fan: flat telson blade plus biramous uropods (protopod, exopod, endopod) on each side.
- Pereiopods: pair 1 are the unequal chelipeds. The major snapping claw sits on y < 0 (the animal's
  right when facing +X with +Z up): stout merus/carpus tube, massive laterally compressed palm with a
  dorsal saddle hint, fixed pollex and a hinged dactyl "hammer" driven by its own bone. The minor
  chela on y > 0 is a slender copy at about 40 percent scale. Pair 2 are slender probing legs (one
  bone each). Pairs 3 to 5 are two-bone walking legs fanned forward, neutral and back.
- Antennae: antennular peduncle with two flagella, antennal peduncle with a scaphocerite scale and
  a long flagellum that bows laterally and back so the antennae never add to the x extent.
- Left/right parts are built once on y < 0 and mirrored with `MeshPart.mirror_y` so the symmetry
  gate can compare vertex order. Suffix `_L` means y < 0 and `_R` means y > 0 (codebase convention).

Clips: `rest` (antennae and minor-claw twitches), `walk` (metachronal leg stepping, antenna sweep,
body bob), `snap` (major dactyl cocks open with an accelerating ramp, drops shut in one frame at 58
percent of the clip, body recoils backward with a tail flick and antenna flare).
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
from ..lib.rigging import RigBuilder

TAU = math.tau
BODY = "Body"
ABDOMEN = ("Abd_A", "Abd_B", "Abd_C", "Tail")
WALKING = ("P3", "P4", "P5")

# UV atlas layout (u0, u1, v0, v1). One shell material carries every exoskeleton tile.
TILES = {
    "carapace": (0.0, 0.5, 0.5, 1.0),
    "leg_P2": (0.0, 0.125, 0.25, 0.5),
    "leg_P3": (0.125, 0.25, 0.25, 0.5),
    "leg_P4": (0.25, 0.375, 0.25, 0.5),
    "leg_P5": (0.375, 0.5, 0.25, 0.5),
    "arm_major": (0.5, 0.58, 0.25, 0.5),
    "palm_major": (0.58, 0.74, 0.25, 0.5),
    "fingers_major": (0.74, 0.82, 0.25, 0.5),
    "arm_minor": (0.82, 0.88, 0.25, 0.5),
    "palm_minor": (0.88, 0.95, 0.25, 0.5),
    "fingers_minor": (0.95, 1.0, 0.25, 0.5),
    "telson": (0.0, 0.18, 0.0, 0.25),
    "exopod": (0.18, 0.34, 0.0, 0.25),
    "endopod": (0.34, 0.5, 0.0, 0.25),
    "antenna": (0.5, 0.64, 0.0, 0.25),
    "antennule": (0.64, 0.74, 0.0, 0.25),
    "scaphocerite": (0.74, 0.84, 0.0, 0.25),
    "pleopod": (0.84, 0.9, 0.0, 0.25),
    "plain": (0.9, 1.0, 0.0, 0.25),
}
SOMITE_TILES = [(0.5 + i / 12.0, 0.5 + (i + 1) / 12.0, 0.5, 1.0) for i in range(6)]


# ---------------------------------------------------------------- interpolation

def _pchip_slopes(xs, ys):
    n = len(xs)
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
    for end, (a, b, hh, dd) in ((0, (0, 1, h[0], delta[0])), (n - 1, (n - 2, n - 3, h[-1], delta[-1]))):
        other_h = h[1] if end == 0 else h[-2]
        other_d = delta[1] if end == 0 else delta[-2]
        slope = ((2 * hh + other_h) * dd - hh * other_d) / (hh + other_h)
        if math.copysign(1, slope) != math.copysign(1, dd):
            slope = 0.0
        elif math.copysign(1, dd) != math.copysign(1, other_d) and abs(slope) > abs(3 * dd):
            slope = 3 * dd
        slopes[end] = slope
    return slopes


class Profile:
    """Monotone cubic interpolation of one channel along a parameter."""

    def __init__(self, xs, ys):
        self.xs = list(xs)
        self.ys = list(ys)
        self.slopes = _pchip_slopes(self.xs, self.ys) if len(xs) >= 3 else [(ys[1] - ys[0]) / (xs[1] - xs[0])] * 2

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


# ---------------------------------------------------------------- geometry helpers

def _uv(rect, pad: float = 0.012):
    u0, u1, v0, v1 = rect

    def transform(u, v):
        return (u0 + (pad + u * (1.0 - 2.0 * pad)) * (u1 - u0), v0 + (pad + v * (1.0 - 2.0 * pad)) * (v1 - v0))

    return transform


def _ellipse_tube(points, rz, ry, segments, up_hint=(0.0, 0.0, 1.0)):
    """Closed tube whose rings are ellipses: rz along the frame normal (up), ry along the binormal."""
    ratios = [max(b, 1e-9) / max(a, 1e-9) for a, b in zip(rz, ry)]

    def ring_fn(index, angle):
        k = ratios[index]
        c, s = math.cos(angle), math.sin(angle)
        return 1.0 / math.sqrt(c * c + (s * s) / (k * k))

    return msh.tube([tuple(p) for p in points], list(rz), segments, True, True, up_hint, 1.0, ring_fn)


def _ring_of(index: int, n_points: int, segments: int) -> int:
    if index < n_points * segments:
        return index // segments
    return 0 if index == n_points * segments else n_points - 1


def _tube_part(name, geometry, n_points, segments, ring_weights, material, tile, attach_rings=0, groups=None):
    """MeshPart from a capped tube: weights per ring, optional attach group on the first rings."""
    groups = dict(groups or {})
    if attach_rings:
        attach = {i for i in range(len(geometry[0])) if _ring_of(i, n_points, segments) < attach_rings and i < n_points * segments}
        attach.add(n_points * segments)  # start cap centre
        groups[f"attach_{name}"] = attach
    return msh.make_part(name, geometry, material, lambda i, v: ring_weights[_ring_of(i, n_points, segments)], closed=True,
                         groups=groups, uv_transform=_uv(tile))


def _blade(name, center, radii, yaw_degrees, weights, material, tile, segments=14, rings=8, pitch_degrees=0.0, groups=None):
    rotation = Matrix.Rotation(math.radians(yaw_degrees), 3, "Z") @ Matrix.Rotation(math.radians(pitch_degrees), 3, "Y")
    geometry = msh.ellipsoid(tuple(center), tuple(radii), segments, rings, rotation)
    return msh.make_part(name, geometry, material, lambda i, v: dict(weights), closed=True, groups=groups or {}, uv_transform=_uv(tile))


def _polyline_with_joints(anchor, knee, foot, radii):
    """Leg polyline: coxa root, embedded ring, mid merus, bevelled knee, mid shank, foot."""
    a, k, f = Vector(anchor), Vector(knee), Vector(foot)
    u1 = (k - a).normalized()
    u2 = (f - k).normalized()
    r_coxa, r_merus, r_knee, r_shank, r_foot = radii
    points = [a, a + u1 * 0.0007, a.lerp(k, 0.5), k - u1 * 0.0005, k + u2 * 0.0005, k.lerp(f, 0.5), f - u2 * 0.0006, f]
    rad = [r_coxa, r_coxa, r_merus, r_knee, r_knee, r_shank, r_shank * 0.8, r_foot]
    return [tuple(p) for p in points], rad


def _smooth_flagellum(points, radii, keep: int = 2, subdivisions: int = 3):
    """Catmull-Rom subdivision of a flagellum polyline; the first `keep` points (embedded attach
    rings) stay untouched so the exit ring keeps its designed position."""
    pts = [Vector(p) for p in points]
    first = max(keep - 1, 0)
    out_p = [tuple(p) for p in pts[:first]]
    out_r = list(radii[:first])
    n = len(pts)
    for i in range(first, n - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)]
        for k in range(subdivisions):
            t = k / subdivisions
            p = 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t)
            out_p.append(tuple(p))
            out_r.append(radii[i] + (radii[i + 1] - radii[i]) * t)
    out_p.append(tuple(pts[-1]))
    out_r.append(radii[-1])
    return out_p, out_r


def _mirror(part: msh.MeshPart) -> msh.MeshPart:
    return part.mirror_y(rename={"_L": "_R"})


def _scale_parts(parts, factor):
    for part in parts:
        part.vertices = [(x * factor, y * factor, z * factor) for x, y, z in part.vertices]


def _xy_extent(parts):
    xs = [v[0] for part in parts for v in part.vertices]
    return min(xs), max(xs)


# ---------------------------------------------------------------- textures

def _tiger(U, V, palette, seed, bands, tilt=0.0, ventral_fade=(-0.95, -0.5), bite=0.55, grain_scale=40.0):
    """Cream shell with irregular, bilaterally symmetric brown-orange transverse bands."""
    zeta = np.cos(V * TAU)
    grain = noise.fbm(U * grain_scale, V * grain_scale * 0.6, 3, seed + 11)
    base = textures.rgba(palette["cream"], 1.0, U.shape)
    base = textures.scale_rgb(base, 0.94 + 0.12 * (noise.fbm(U * 6.0, zeta * 2.5, 3, seed) - 0.5))
    mask = np.zeros_like(U)
    for k, (center, half, soft) in enumerate(bands):
        wander = (noise.value_noise(zeta * 2.2 + 3.1, np.full_like(U, 0.37 * (seed + k)), seed + 17 * k) - 0.5) * 0.10
        width = half * (0.65 + 0.55 * noise.smoothstep(-0.8, 0.5, zeta))
        mask = np.maximum(mask, paint.band(U - wander - tilt * zeta, center, width, soft))
    bites = noise.fbm(U * 9.0, zeta * 4.0 + 2.0, 3, seed + 5)
    mask = mask * ((1.0 - bite) + bite * noise.smoothstep(0.30, 0.50, bites))
    mask = mask * noise.smoothstep(ventral_fade[0], ventral_fade[1], zeta)
    tone = noise.fbm(U * 7.0, zeta * 3.0, 2, seed + 9)
    brown = textures.mix(textures.rgba(palette["brownOrange"], 1.0, U.shape), palette["brownDark"], tone * 0.7)
    albedo = textures.mix(base, brown, mask)
    edge = paint.band(mask, 0.5, 0.25, 0.15)
    albedo = textures.mix(albedo, palette["brownDark"], edge * 0.35)
    rough = 0.30 + 0.10 * grain + 0.06 * mask
    height = 0.5 + 0.06 * (grain - 0.5) + 0.05 * (noise.fbm(U * 110.0, V * 70.0, 2, seed + 21) - 0.5) - 0.04 * edge
    return albedo, rough, height


def _banded_tube(U, V, palette, seed, bands, tip=0.9, bristles=True):
    """Leg/arm tube: cream with brown rings along u and a dark dactyl tip."""
    base = textures.rgba(palette["cream"], 1.0, U.shape)
    base = textures.scale_rgb(base, 0.95 + 0.1 * (noise.fbm(U * 12.0, V * 3.0, 2, seed) - 0.5))
    mask = np.zeros_like(U)
    for k, (center, half) in enumerate(bands):
        wobble = (noise.value_noise(V * 3.0 + 1.7, np.full_like(U, k * 0.61), seed + 7 * k) - 0.5) * 0.04
        mask = np.maximum(mask, paint.band(U - wobble, center, half, 0.02))
    brown = textures.mix(textures.rgba(palette["brownOrange"], 1.0, U.shape), palette["brownDark"], noise.fbm(U * 20, V * 4, 2, seed + 3) * 0.6)
    albedo = textures.mix(base, brown, mask)
    tip_mask = noise.smoothstep(tip, tip + 0.06, U)
    albedo = textures.mix(albedo, palette["brownDark"], tip_mask)
    height = 0.5 + 0.05 * (noise.fbm(U * 60.0, V * 12.0, 2, seed + 21) - 0.5)
    if bristles:
        distance, ident = noise.cells(U * 26.0, V * 6.0, seed + 31)
        specks = (1.0 - noise.smoothstep(0.08, 0.16, distance)) * (ident < 0.35)
        albedo = textures.mix(albedo, palette["brownDark"], specks * 0.7)
        height = height - 0.04 * specks
    rough = 0.32 + 0.08 * noise.fbm(U * 30, V * 8, 2, seed + 41) + 0.06 * mask
    return albedo, rough, height


def _antenna_tile(U, V, palette, seed):
    base = textures.rgba(palette["antennaRed"], 1.0, U.shape)
    rings = (0.5 + 0.5 * np.cos(U * TAU * 70.0)) ** 4
    albedo = textures.scale_rgb(base, 1.0 - 0.22 * rings + 0.08 * (noise.fbm(U * 30, V * 3, 2, seed) - 0.5))
    albedo = textures.mix(albedo, palette["cream"], 0.25 * noise.smoothstep(0.0, 0.18, U) * (1.0 - noise.smoothstep(0.18, 0.4, U)))
    return albedo, 0.35 + 0.1 * rings, 0.5 - 0.06 * rings


def _blade_tile(U, V, palette, seed, band_center=0.05, band_half=0.3, margin=-0.72, rays=18.0):
    """Uropod / scaphocerite blade painted along xi = cos(2 pi v) (+1 root, -1 distal tip)."""
    xi = np.cos(V * TAU)
    base = textures.rgba(palette["cream"], 1.0, U.shape)
    base = textures.scale_rgb(base, 0.96 + 0.08 * (noise.fbm(U * 4.0, V * 6.0, 2, seed) - 0.5))
    wobble = (noise.value_noise(U * 4.0 + 0.3, np.full_like(U, seed * 0.11), seed + 3) - 0.5) * 0.2
    band = paint.band(xi - wobble, band_center, band_half, 0.08)
    brown = textures.mix(textures.rgba(palette["brownOrange"], 1.0, U.shape), palette["brownDark"], 0.3)
    albedo = textures.mix(base, brown, band * 0.9)
    edge = noise.smoothstep(margin + 0.12, margin - 0.1, xi)
    albedo = textures.mix(albedo, textures.mix(textures.rgba(palette["brownOrange"], 1.0, U.shape), palette["antennaRed"], 0.4), edge * 0.85)
    ray = paint.rays(U, rays, 8.0) * noise.smoothstep(0.3, -0.6, xi)
    albedo = textures.scale_rgb(albedo, 1.0 - 0.12 * ray)
    height = 0.5 - 0.05 * ray + 0.03 * (noise.fbm(U * 40, V * 40, 2, seed + 9) - 0.5)
    return albedo, 0.36 + 0.06 * band, height


def _plain_tile(U, V, palette, seed, patch=0.0):
    base = textures.rgba(palette["cream"], 1.0, U.shape)
    mottle = noise.fbm(U * 5.0, V * 5.0, 3, seed)
    albedo = textures.scale_rgb(base, 0.92 + 0.14 * (mottle - 0.5))
    if patch:
        albedo = textures.mix(albedo, palette["brownOrange"], patch * noise.smoothstep(0.55, 0.7, mottle))
    height = 0.5 + 0.05 * (noise.fbm(U * 60.0, V * 60.0, 2, seed + 21) - 0.5)
    return albedo, 0.33 + 0.08 * mottle, height


def _paint_atlas(spec):
    width, height_px = spec.get("textures", {}).get("atlasResolution", [1024, 512])
    palette = {key: tuple(value) for key, value in spec["palette"].items()}
    albedo = np.zeros((height_px, width, 4), dtype=np.float64)
    rough = np.full((height_px, width), 0.4, dtype=np.float64)
    height = np.full((height_px, width), 0.5, dtype=np.float64)

    def fill(rect, fn):
        u0, u1, v0, v1 = rect
        cols = slice(int(round(u0 * width)), int(round(u1 * width)))
        rows = slice(int(round(v0 * height_px)), int(round(v1 * height_px)))
        U, V = textures.uv_grid(cols.stop - cols.start, rows.stop - rows.start)
        a, r, h = fn(U, V)
        albedo[rows, cols] = a
        rough[rows, cols] = r
        height[rows, cols] = h

    fill(TILES["carapace"], lambda U, V: _tiger(U, V, palette, 3, [(0.16, 0.055, 0.03), (0.40, 0.07, 0.03), (0.63, 0.065, 0.03), (0.84, 0.05, 0.03)], tilt=0.02))
    somite_bands = [[(0.48, 0.15, 0.03)], [(0.34, 0.07, 0.03), (0.66, 0.08, 0.03)], [(0.5, 0.14, 0.03)], [(0.36, 0.07, 0.03), (0.68, 0.07, 0.03)],
                    [(0.5, 0.13, 0.03)], [(0.42, 0.09, 0.03), (0.75, 0.06, 0.03)]]
    for index, rect in enumerate(SOMITE_TILES):
        def somite(U, V, index=index):
            a, r, h = _tiger(U, V, palette, 40 + index * 7, somite_bands[index], tilt=0.03, ventral_fade=(-0.98, -0.6), bite=0.4, grain_scale=14.0)
            groove = paint.band(U, 0.955, 0.02, 0.015)
            return textures.mix(a, palette["brownDark"], groove * 0.25), r, h - 0.08 * groove
        fill(rect, somite)
    leg_bands = {"P2": [(0.3, 0.06), (0.62, 0.07)], "P3": [(0.2, 0.06), (0.48, 0.07), (0.76, 0.05)], "P4": [(0.24, 0.06), (0.52, 0.07), (0.78, 0.05)],
                 "P5": [(0.22, 0.06), (0.5, 0.07), (0.77, 0.05)]}
    for index, name in enumerate(("P2", "P3", "P4", "P5")):
        fill(TILES[f"leg_{name}"], lambda U, V, n=name, i=index: _banded_tube(U, V, palette, 60 + i * 5, leg_bands[n], tip=0.9))
    fill(TILES["arm_major"], lambda U, V: _banded_tube(U, V, palette, 80, [(0.42, 0.12), (0.86, 0.06)], tip=1.2))
    fill(TILES["arm_minor"], lambda U, V: _banded_tube(U, V, palette, 85, [(0.4, 0.1), (0.85, 0.06)], tip=1.2))
    fill(TILES["palm_major"], lambda U, V: _tiger(U, V, palette, 90, [(0.30, 0.10, 0.03), (0.70, 0.09, 0.03)], tilt=0.05, ventral_fade=(-1.2, -1.1), bite=0.3, grain_scale=24.0))
    fill(TILES["palm_minor"], lambda U, V: _tiger(U, V, palette, 95, [(0.35, 0.12, 0.03), (0.75, 0.08, 0.03)], tilt=0.05, ventral_fade=(-1.2, -1.1), bite=0.3, grain_scale=24.0))
    fill(TILES["fingers_major"], lambda U, V: _banded_tube(U, V, palette, 100, [(0.45, 0.2)], tip=0.78, bristles=False))
    fill(TILES["fingers_minor"], lambda U, V: _banded_tube(U, V, palette, 105, [(0.4, 0.18)], tip=0.8, bristles=False))
    fill(TILES["telson"], lambda U, V: _banded_tube(U, V, palette, 110, [(0.42, 0.14)], tip=0.86, bristles=False))
    fill(TILES["exopod"], lambda U, V: _blade_tile(U, V, palette, 120, band_center=0.05, band_half=0.28, margin=-0.7))
    fill(TILES["endopod"], lambda U, V: _blade_tile(U, V, palette, 125, band_center=0.1, band_half=0.25, margin=-0.72, rays=14.0))
    fill(TILES["antenna"], lambda U, V: _antenna_tile(U, V, palette, 130))
    fill(TILES["antennule"], lambda U, V: _antenna_tile(U, V, palette, 135))
    fill(TILES["scaphocerite"], lambda U, V: _blade_tile(U, V, palette, 140, band_center=0.6, band_half=0.2, margin=-0.6, rays=10.0))
    fill(TILES["pleopod"], lambda U, V: _plain_tile(U, V, palette, 150, patch=0.5))
    fill(TILES["plain"], lambda U, V: _plain_tile(U, V, palette, 160, patch=0.35))
    strength = float(spec.get("textures", {}).get("normalStrength", 0.55))
    return {"albedo": albedo, "roughness": textures.grey(rough), "normal": textures.normal_from_height(height, 1.3), "normalStrength": strength}


# ---------------------------------------------------------------- design

def _design(spec):
    """Return (body_parts, limb_parts, bones, meta) in design metres."""
    m = spec["morphology"]
    body_parts: list[msh.MeshPart] = []
    limb_parts: list[msh.MeshPart] = []
    bones: list[dict] = []

    def bone(name, head, tail, parent=None, connected=False, deform=True, roll_up=(0.0, 0.0, 1.0)):
        bones.append({"name": name, "head": tuple(head), "tail": tuple(tail), "parent": parent, "connected": connected,
                      "deform": deform, "roll_up": roll_up})

    rig = m["rig"]
    bone("Root", rig["root"]["head"], rig["root"]["tail"], deform=False)
    bone(BODY, rig["body"]["head"], rig["body"]["tail"], "Root")
    joints = rig["abdomenJoints"]
    parent = BODY
    for index, name in enumerate(ABDOMEN):
        bone(name, joints[index], joints[index + 1], parent, connected=index > 0)
        parent = name

    # ---- carapace
    car = m["carapace"]
    stations = sorted(car["stations"], key=lambda s: s["x"])
    xs = [s["x"] for s in stations]
    hw = Profile(xs, [s["halfWidth"] for s in stations])
    dorsal = Profile(xs, [s["dorsal"] for s in stations])
    ventral = Profile(xs, [s["ventral"] for s in stations])
    cz = Profile(xs, [s["centerZ"] for s in stations])
    ring_count = int(car.get("ringCount", 24))
    segments = int(car.get("segments", 32))
    length = xs[-1] - xs[0]
    positions = []
    for k in range(ring_count):
        t = k / (ring_count - 1)
        # denser rings toward the tapering front
        positions.append(xs[0] + length * (1.0 - (1.0 - t) ** 1.25))
    rings = [msh.superellipse_ring(x, hw(x), dorsal(x), ventral(x), 0.0, cz(x), segments, float(car["dorsalExponent"]), float(car["ventralExponent"]))
             for x in positions]
    geometry = msh.loft(rings, u_values=[(x - xs[0]) / length for x in positions], cap_start=True, cap_end=True)
    body_parts.append(msh.make_part("carapace", geometry, "shell", lambda i, v: {BODY: 1.0}, closed=True, uv_transform=_uv(TILES["carapace"])))

    ros = m["rostrum"]
    geometry = msh.tube([tuple(p) for p in ros["points"]], list(ros["radii"]), 10, True, True, (0.0, 0.0, 1.0), float(ros.get("aspect", 0.7)))
    body_parts.append(msh.make_part("rostrum", geometry, "shell", lambda i, v: {BODY: 1.0}, closed=True, uv_transform=_uv(TILES["plain"])))

    hood = _blade("hood_L", m["hoods"]["center"], m["hoods"]["radii"], 0.0, {BODY: 1.0}, "shell", TILES["plain"], 18, 10)
    body_parts.extend([hood, _mirror(hood)])
    eye = _blade("eye_L", m["eyes"]["center"], m["eyes"]["radii"], 0.0, {BODY: 1.0}, "eye", TILES["plain"], 14, 8)
    body_parts.extend([eye, _mirror(eye)])

    # ---- abdomen somites (telescoping closed lofts) and pleopods
    som = m["somites"]
    profile_t = list(som["profileT"])
    profile_s = list(som["profileScale"])
    somite_bones = [ABDOMEN[0], ABDOMEN[0], ABDOMEN[1], ABDOMEN[1], ABDOMEN[2], ABDOMEN[2]]
    ple = m["pleopods"]
    for index, s in enumerate(som["list"]):
        rings = []
        for t, scale in zip(profile_t, profile_s):
            x = s["xFront"] + (s["xBack"] - s["xFront"]) * t
            rings.append(msh.superellipse_ring(x, s["halfWidth"] * scale, s["dorsal"] * scale, s["ventral"] * scale, 0.0, s["centerZ"],
                                               int(som["segments"]), float(som["dorsalExponent"]), float(som["ventralExponent"])))
        geometry = msh.loft(rings, u_values=profile_t, cap_start=True, cap_end=True)
        bone_name = somite_bones[index]
        body_parts.append(msh.make_part(f"somite_{index + 1}", geometry, "shell", lambda i, v, b=bone_name: {b: 1.0}, closed=True,
                                        uv_transform=_uv(SOMITE_TILES[index])))
        if index < 5:
            x_mid = (s["xFront"] + s["xBack"]) / 2
            center = (x_mid, -float(ple["yOffset"]), s["centerZ"] - s["ventral"] * 0.75)
            paddle = _blade(f"pleopod_{index + 1}_L", center, ple["radii"], 0.0, {bone_name: 1.0}, "shell", TILES["pleopod"], 10, 6,
                            pitch_degrees=float(ple["tiltDegrees"]))
            body_parts.extend([paddle, _mirror(paddle)])

    # ---- tail fan
    tail = m["tail"]
    tel = tail["telson"]
    geometry = _ellipse_tube(tel["points"], tel["halfThickness"], tel["halfWidth"], 14)
    body_parts.append(msh.make_part("telson", geometry, "shell", lambda i, v: {"Tail": 1.0}, closed=True, uv_transform=_uv(TILES["telson"])))
    uro = rig["uropod"]
    bone("Uropod_L", uro["head"], uro["tail"], "Tail")
    bone("Uropod_R", (uro["head"][0], -uro["head"][1], uro["head"][2]), (uro["tail"][0], -uro["tail"][1], uro["tail"][2]), "Tail")
    for name, key, tile in (("protopod", "protopod", "plain"), ("exopod", "exopod", "exopod"), ("endopod", "endopod", "endopod")):
        blade_spec = tail[key]
        part = _blade(f"{name}_L", blade_spec["center"], blade_spec["radii"], float(blade_spec.get("yawDegrees", 0.0)), {"Uropod_L": 1.0}, "shell",
                      TILES[tile], 16 if name != "protopod" else 10, 8 if name != "protopod" else 6)
        part.groups["uropod_L"] = set(range(len(part.vertices)))
        body_parts.extend([part, _mirror(part)])

    # ---- legs
    legs = m["legs"]
    leg_names = []
    for name in ("P2",) + WALKING:
        leg = legs[name]
        points, radii = _polyline_with_joints(leg["coxa"], leg["knee"], leg["foot"], leg["radii"])
        if name == "P2":
            bone(f"{name}_L", leg["coxa"], leg["foot"], BODY, roll_up=(1.0, 0.0, 0.0))
            bone(f"{name}_R", _flip(leg["coxa"]), _flip(leg["foot"]), BODY, roll_up=(1.0, 0.0, 0.0))
            ring_weights = [{f"{name}_L": 1.0}] * len(points)
        else:
            a_name, b_name = f"{name}_A_L", f"{name}_B_L"
            bone(a_name, leg["coxa"], leg["knee"], BODY, roll_up=(1.0, 0.0, 0.0))
            bone(b_name, leg["knee"], leg["foot"], a_name, connected=True, roll_up=(1.0, 0.0, 0.0))
            bone(f"{name}_A_R", _flip(leg["coxa"]), _flip(leg["knee"]), BODY, roll_up=(1.0, 0.0, 0.0))
            bone(f"{name}_B_R", _flip(leg["knee"]), _flip(leg["foot"]), f"{name}_A_R", connected=True, roll_up=(1.0, 0.0, 0.0))
            ring_weights = [{a_name: 1.0}, {a_name: 1.0}, {a_name: 1.0}, {a_name: 0.7, b_name: 0.3}, {a_name: 0.3, b_name: 0.7},
                            {b_name: 1.0}, {b_name: 1.0}, {b_name: 1.0}]
        geometry = msh.tube(points, radii, 8, True, True, (0.0, 0.0, 1.0))
        part = _tube_part(f"leg_{name}_L", geometry, len(points), 8, ring_weights, "shell", TILES[f"leg_{name}"], attach_rings=2,
                          groups={"legs_L": set(range(len(geometry[0])))})
        limb_parts.extend([part, _mirror(part)])
        leg_names.append(name)

    # ---- chelipeds (unequal; not mirrored)
    for kind in ("major", "minor"):
        ch = m["chelipeds"][kind]
        arm_bone, chela_bone, dactyl_bone = f"Arm_{kind}", f"Chela_{kind}", f"Dactyl_{kind}"
        arm = ch["arm"]
        palm = ch["palm"]
        bone(arm_bone, arm["points"][0], palm["start"], BODY)
        bone(chela_bone, palm["start"], ch["pollex"]["points"][-1], arm_bone)
        bone(dactyl_bone, ch["dactyl"]["hinge"], ch["dactyl"]["points"][-1], chela_bone)
        group = {f"cheliped_{kind}": None}
        geometry = msh.tube([tuple(p) for p in arm["points"]], list(arm["radii"]), 10, True, True, (0.0, 0.0, 1.0))
        weights = [{arm_bone: 1.0}] * (len(arm["points"]) - 1) + [{arm_bone: 0.5, chela_bone: 0.5}]
        part = _tube_part(f"arm_{kind}", geometry, len(arm["points"]), 10, weights, "shell", TILES[f"arm_{kind}"], attach_rings=2)
        part.groups[f"cheliped_{kind}"] = set(range(len(part.vertices)))
        part.groups[f"attach_cheliped_{kind}"] = set(part.groups[f"attach_arm_{kind}"])
        limb_parts.append(part)
        start, end = Vector(palm["start"]), Vector(palm["end"])
        points = [tuple(start.lerp(end, t)) for t in palm["t"]]
        geometry = _ellipse_tube(points, palm["halfHeight"], palm["halfWidth"], int(palm.get("segments", 18)))
        part = msh.make_part(f"palm_{kind}", geometry, "shell", lambda i, v, b=chela_bone: {b: 1.0}, closed=True,
                             groups={f"cheliped_{kind}": set(range(len(geometry[0])))}, uv_transform=_uv(TILES[f"palm_{kind}"]))
        limb_parts.append(part)
        for finger, finger_bone in (("pollex", chela_bone), ("dactyl", dactyl_bone)):
            fs = ch[finger]
            geometry = _ellipse_tube(fs["points"], fs["halfHeight"], fs["halfWidth"], 12)
            part = msh.make_part(f"{finger}_{kind}", geometry, "shell", lambda i, v, b=finger_bone: {b: 1.0}, closed=True,
                                 groups={f"cheliped_{kind}": set(range(len(geometry[0])))}, uv_transform=_uv(TILES[f"fingers_{kind}"]))
            limb_parts.append(part)

    # ---- antennae
    ant = m["antennae"]
    a = ant["antenna"]
    bone("Antenna_L", a["points"][0], a["boneTail"], BODY)
    bone("Antenna_R", _flip(a["points"][0]), _flip(a["boneTail"]), BODY)
    points, radii = _smooth_flagellum(a["points"], a["radii"], keep=3, subdivisions=3)
    geometry = msh.tube(points, radii, 7, True, True, (0.0, 0.0, 1.0))
    part = _tube_part("antenna_L", geometry, len(points), 7, [{"Antenna_L": 1.0}] * len(points), "shell", TILES["antenna"], attach_rings=2)
    limb_parts.extend([part, _mirror(part)])
    sc = ant["scaphocerite"]
    part = _blade("scaphocerite_L", sc["center"], sc["radii"], float(sc.get("yawDegrees", 0.0)), {"Antenna_L": 1.0}, "shell", TILES["scaphocerite"], 14, 8)
    limb_parts.extend([part, _mirror(part)])
    au = ant["antennule"]
    bone("Antennule_L", au["points"][0], au["boneTail"], BODY)
    bone("Antennule_R", _flip(au["points"][0]), _flip(au["boneTail"]), BODY)
    points, radii = _smooth_flagellum(au["points"], au["radii"], keep=4, subdivisions=3)
    geometry = msh.tube(points, radii, 7, True, True, (0.0, 0.0, 1.0))
    part = _tube_part("antennule_L", geometry, len(points), 7, [{"Antennule_L": 1.0}] * len(points), "shell", TILES["antennule"], attach_rings=2)
    limb_parts.extend([part, _mirror(part)])
    au2 = ant["antennule2"]
    points, radii = _smooth_flagellum(au2["points"], au2["radii"], keep=1, subdivisions=3)
    geometry = msh.tube(points, radii, 6, True, True, (0.0, 0.0, 1.0))
    part = _tube_part("antennule2_L", geometry, len(points), 6, [{"Antennule_L": 1.0}] * len(points), "shell", TILES["antennule"])
    limb_parts.extend([part, _mirror(part)])

    return body_parts, limb_parts, bones, {"legs": leg_names}


def _flip(p):
    return (p[0], -p[1], p[2])


# ---------------------------------------------------------------- animation

def _clips(spec, meta) -> list[ClipSpec]:
    anim = spec["animation"]
    clips = []

    # rest: antennae and small-claw twitches, gentle breathing
    r = anim["rest"]
    ch = []
    sweep = float(r.get("antennaSweep", 6.0))
    ch.append(Channel("Antenna_L", "rotation", (0.25, 0.0, 1.0), sweep, 1.0, 0.0))
    ch.append(Channel("Antenna_R", "rotation", (0.25, 0.0, 1.0), sweep, 1.0, 0.9))
    twitch = float(r.get("antennuleTwitch", 7.0))
    ch.append(Channel("Antennule_L", "rotation", (1.0, 0.0, 0.3), twitch, 2.0, 0.0))
    ch.append(Channel("Antennule_R", "rotation", (1.0, 0.0, 0.3), twitch, 2.0, 1.3))
    ch.append(Channel("Dactyl_minor", "rotation", (1.0, 0.0, 0.0), float(r.get("minorDactyl", 14.0)), 1.0, 0.0, "pulse", 2.0))
    ch.append(Channel("Arm_minor", "rotation", (1.0, 0.0, 0.0), float(r.get("minorArm", 3.0)), 1.0, 0.5))
    for index, (name, amp) in enumerate(zip(ABDOMEN[:3], r.get("abdomen", [0.6, 0.9, 1.2]))):
        ch.append(Channel(name, "rotation", (1.0, 0.0, 0.0), float(amp), 1.0, -0.6 * index))
    fan = float(r.get("uropodFan", 3.0))
    ch.append(Channel("Uropod_L", "rotation", (0.0, 0.0, 1.0), fan, 1.0, 0.0))
    ch.append(Channel("Uropod_R", "rotation", (0.0, 0.0, 1.0), fan, 1.0, 0.0))
    probe = float(r.get("probeLegs", 4.0))
    ch.append(Channel("P2_L", "rotation", (1.0, 0.0, 0.0), probe, 2.0, 0.0))
    ch.append(Channel("P2_R", "rotation", (1.0, 0.0, 0.0), probe, 2.0, math.pi))
    ch.append(Channel(BODY, "location", (0.0, 0.0, 1.0), float(r.get("bodyBob", 0.00006)), 1.0, 0.0))
    clips.append(ClipSpec("rest", int(r["frames"]), True, ch))

    # walk: metachronal stepping, antennae sweep, body bob
    w = anim["walk"]
    ch = []
    stride = float(w.get("strideFrequency", 2.0))
    swing = float(w.get("legSwing", 12.0))
    lift = float(w.get("legLift", 10.0))
    world_phase = {"P3": 0.0, "P4": TAU / 3.0, "P5": 2.0 * TAU / 3.0}
    for name in WALKING:
        for suffix, offset in (("L", 0.0), ("R", math.pi)):
            phase = world_phase[name] + offset
            ch.append(Channel(f"{name}_A_{suffix}", "rotation", (1.0, 0.0, 0.0), swing, stride, phase))
            ch.append(Channel(f"{name}_B_{suffix}", "rotation", (1.0, 0.0, 0.0), lift, stride, phase + math.pi / 2, "pulse", 1.4))
    probe = float(w.get("probeLegs", 6.0))
    ch.append(Channel("P2_L", "rotation", (1.0, 0.0, 0.0), probe, stride, math.pi / 3))
    ch.append(Channel("P2_R", "rotation", (1.0, 0.0, 0.0), probe, stride, math.pi / 3 + math.pi))
    ch.append(Channel(BODY, "location", (0.0, 0.0, 1.0), float(w.get("bodyBob", 0.0002)), stride * 2.0, 0.0))
    ch.append(Channel(BODY, "rotation", (1.0, 0.0, 0.0), float(w.get("bodyPitch", 1.0)), stride, 0.4))
    for index, (name, amp) in enumerate(zip(ABDOMEN[:3], w.get("abdomen", [1.0, 1.4, 1.8]))):
        ch.append(Channel(name, "rotation", (1.0, 0.0, 0.0), float(amp), stride, -0.7 * index))
        ch.append(Channel(name, "rotation", (0.0, 0.0, 1.0), float(w.get("abdomenSway", 0.8)), stride / 2.0, -0.5 * index))
    fan = float(w.get("uropodFan", 4.0))
    ch.append(Channel("Uropod_L", "rotation", (0.0, 0.0, 1.0), fan, stride, 0.0))
    ch.append(Channel("Uropod_R", "rotation", (0.0, 0.0, 1.0), fan, stride, 0.0))
    sweep = float(w.get("antennaSweep", 10.0))
    ch.append(Channel("Antenna_L", "rotation", (0.1, 0.0, 1.0), sweep, 1.0, 0.0))
    ch.append(Channel("Antenna_R", "rotation", (0.1, 0.0, 1.0), sweep, 1.0, math.pi))
    twitch = float(w.get("antennuleTwitch", 8.0))
    ch.append(Channel("Antennule_L", "rotation", (1.0, 0.0, 0.3), twitch, 2.0, 0.0))
    ch.append(Channel("Antennule_R", "rotation", (1.0, 0.0, 0.3), twitch, 2.0, math.pi))
    arm = float(w.get("armBob", 2.5))
    ch.append(Channel("Arm_major", "rotation", (1.0, 0.0, 0.0), arm, stride, 0.0))
    ch.append(Channel("Arm_minor", "rotation", (1.0, 0.0, 0.0), arm * 1.2, stride, math.pi))
    ch.append(Channel("Dactyl_minor", "rotation", (1.0, 0.0, 0.0), float(w.get("minorDactyl", 8.0)), stride, 0.0, "pulse", 2.0))
    clips.append(ClipSpec("walk", int(w["frames"]), True, ch))

    # snap: the major dactyl cocks open along an accelerating ramp and drops shut in one frame;
    # the body recoils backward, the tail flicks under and the antennae flare
    s = anim["snap"]
    ch = []
    cock = float(s.get("cockFraction", 0.58))
    ch.append(Channel("Dactyl_major", "rotation", (1.0, 0.0, 0.0), float(s.get("dactylOpen", 42.0)), 1.0, TAU * (1.0 - cock), "ramp",
                      float(s.get("cockExponent", 6.0))))
    ch.append(Channel("Arm_major", "rotation", (1.0, 0.0, 0.0), float(s.get("armLift", 5.0)), 0.5, 0.0, "pulse", 2.0))
    center = float(s.get("recoilCenter", 0.64))
    recoil_phase = math.pi / 2 - TAU * center
    ch.append(Channel(BODY, "location", (0.0, 1.0, 0.0), -float(s.get("recoilMeters", 0.0016)), 1.0, recoil_phase, "pulse", 8.0))
    ch.append(Channel(BODY, "rotation", (1.0, 0.0, 0.0), float(s.get("recoilPitch", 3.0)), 1.0, recoil_phase, "pulse", 8.0))
    for index, (name, amp) in enumerate(zip(ABDOMEN[:3], s.get("tailFlick", [-4.0, -6.0, -8.0]))):
        ch.append(Channel(name, "rotation", (1.0, 0.0, 0.0), float(amp), 1.0, recoil_phase - 0.12 * index, "pulse", 8.0))
    flick = float(s.get("antennaFlick", -12.0))
    ch.append(Channel("Antenna_L", "rotation", (0.0, 0.0, 1.0), flick, 1.0, recoil_phase, "pulse", 6.0))
    ch.append(Channel("Antenna_R", "rotation", (0.0, 0.0, 1.0), flick, 1.0, recoil_phase, "pulse", 6.0))
    brace = float(s.get("legBrace", -4.0))
    for name in WALKING:
        for suffix in ("L", "R"):
            ch.append(Channel(f"{name}_B_{suffix}", "rotation", (1.0, 0.0, 0.0), brace, 1.0, recoil_phase, "pulse", 6.0))
    flare = float(s.get("uropodFlare", 8.0))
    ch.append(Channel("Uropod_L", "rotation", (0.0, 0.0, 1.0), flare, 1.0, recoil_phase, "pulse", 6.0))
    ch.append(Channel("Uropod_R", "rotation", (0.0, 0.0, 1.0), flare, 1.0, recoil_phase, "pulse", 6.0))
    clips.append(ClipSpec("snap", int(s["frames"]), False, ch))
    return clips


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    body_parts, limb_parts, bones, meta = _design(spec)

    # uniform scale so the rest-pose x extent (major chela tips to tail fan) is the reference size
    all_parts = body_parts + limb_parts
    x_min, x_max = _xy_extent(all_parts)
    factor = float(spec["referenceSize"]["meters"]) / (x_max - x_min)
    _scale_parts(all_parts, factor)
    for b in bones:
        b["head"] = tuple(c * factor for c in b["head"])
        b["tail"] = tuple(c * factor for c in b["tail"])

    # ---- textures & materials
    atlas = _paint_atlas(spec)
    texture_dir = ctx.texture_dir
    written = []
    images = {}
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = texture_dir / f"body-{key}.png"
        images[key] = textures.write_image(f"{prefix}_Shell_{key}", path, atlas[key], non_color)
        written.append(path)
    palette = spec["palette"]
    shell = mat.principled(f"{prefix}_Shell", palette["cream"], 0.36, coat=0.22, subsurface=0.04, specular=0.45)
    mat.attach_textures(shell, albedo=images["albedo"], roughness=images["roughness"], normal=images["normal"], normal_strength=atlas["normalStrength"])
    eye = mat.principled(f"{prefix}_Eye", palette["eye"], 0.18, coat=0.5, subsurface=0.0)
    material_map = {"shell": shell, "eye": eye}

    # ---- rig
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    for b in bones:
        rb.bone(b["name"], b["head"], b["tail"], b["parent"], connected=b["connected"], deform=b["deform"], roll_up=b["roll_up"])
    rig = rb.finish()

    # ---- meshes
    body_obj = msh.assemble(f"{prefix}_Body", body_parts, material_map, rig, f"{prefix}_Armature")
    body_obj["adultLengthMeters"] = spec["referenceSize"]["meters"]
    body_obj["lod"] = 1
    limbs_obj = msh.assemble(f"{prefix}_Limbs", limb_parts, material_map, rig, f"{prefix}_Armature")
    limbs_obj["lod"] = 1
    meshes = [body_obj, limbs_obj]

    # ---- animation
    clips = _clips(spec, meta)
    for clip in clips:
        bake_clip(rig, clip, mesh_objects={obj.name: obj for obj in meshes})

    # ---- contract
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [obj.name for obj in meshes], size_axis="x")
    B, L = body_obj.name, limbs_obj.name
    closed = ["carapace"] + [f"somite_{i}" for i in range(1, 7)] + ["telson", "palm_major"]
    for name in closed:
        contract["closedParts"].append({"object": L if name.startswith("palm") else B, "group": f"part_{name}", "volumeFloor": 0.6})
    clearance = contract["clearance"]

    def check(a, b, label):
        clearance.append({"a": list(a), "b": list(b), "label": label})

    legs = meta["legs"]
    for suffix in ("L", "R"):
        for name in legs:
            check([L, f"part_leg_{name}_{suffix}", f"attach_leg_{name}_{suffix}"], [B, "part_carapace"], f"leg_{name}_{suffix}_carapace")
        for i, first in enumerate(legs):
            for second in legs[i + 1:]:
                check([L, f"part_leg_{first}_{suffix}"], [L, f"part_leg_{second}_{suffix}"], f"legs_{first}_{second}_{suffix}")
        check([L, f"part_leg_P5_{suffix}", f"attach_leg_P5_{suffix}"], [B, "part_somite_1"], f"leg_P5_{suffix}_somite_1")
        check([L, f"part_leg_P5_{suffix}", f"attach_leg_P5_{suffix}"], [B, "part_somite_2"], f"leg_P5_{suffix}_somite_2")
        check([L, f"part_leg_P4_{suffix}", f"attach_leg_P4_{suffix}"], [B, "part_somite_1"], f"leg_P4_{suffix}_somite_1")
        kind = "major" if suffix == "L" else "minor"
        check([L, f"cheliped_{kind}", f"attach_cheliped_{kind}"], [B, "part_carapace"], f"cheliped_{kind}_carapace")
        for name in ("P2", "P3"):
            check([L, f"cheliped_{kind}"], [L, f"part_leg_{name}_{suffix}"], f"cheliped_{kind}_leg_{name}")
        for appendage in ("antenna", "antennule", "antennule2", "scaphocerite"):
            check([L, f"cheliped_{kind}"], [L, f"part_{appendage}_{suffix}"], f"cheliped_{kind}_{appendage}")
        check([L, f"part_antenna_{suffix}", f"attach_antenna_{suffix}"], [B, "part_carapace"], f"antenna_{suffix}_carapace")
        check([L, f"part_antennule_{suffix}", f"attach_antennule_{suffix}"], [B, "part_carapace"], f"antennule_{suffix}_carapace")
        check([L, f"part_scaphocerite_{suffix}"], [B, "part_carapace"], f"scaphocerite_{suffix}_carapace")
        check([L, f"part_antenna_{suffix}"], [L, f"part_antennule_{suffix}"], f"antenna_antennule_{suffix}")
        check([L, f"part_antenna_{suffix}"], [L, f"part_antennule2_{suffix}"], f"antenna_antennule2_{suffix}")
    check([L, "cheliped_major"], [L, "cheliped_minor"], "cheliped_major_minor")
    check([L, "part_antenna_L"], [L, "part_antenna_R"], "antennae")
    check([B, "uropod_L"], [B, "uropod_R"], "uropods")
    check([B, "part_hood_L"], [B, "part_hood_R"], "hoods")
    for first, second in ((1, 3), (2, 4), (3, 5), (4, 6)):
        check([B, f"part_somite_{first}"], [B, f"part_somite_{second}"], f"somites_{first}_{second}")
    check([B, "part_carapace"], [B, "part_somite_2"], "carapace_somite_2")
    check([B, "part_carapace"], [B, "part_somite_3"], "carapace_somite_3")

    for side, suffix in ((-1, "L"), (1, "R")):
        for name in legs:
            contract["centerPlane"].append({"object": L, "group": f"part_leg_{name}_{suffix}", "exclude": f"attach_leg_{name}_{suffix}", "side": side})
        for appendage in ("antenna", "antennule", "antennule2", "scaphocerite"):
            exclude = f"attach_{appendage}_{suffix}" if appendage in ("antenna", "antennule") else None
            entry = {"object": L, "group": f"part_{appendage}_{suffix}", "side": side}
            if exclude:
                entry["exclude"] = exclude
            contract["centerPlane"].append(entry)
        contract["centerPlane"].append({"object": B, "group": f"uropod_{suffix}", "side": side})
        contract["centerPlane"].append({"object": B, "group": f"part_hood_{suffix}", "side": side})
        kind = "major" if side < 0 else "minor"
        contract["centerPlane"].append({"object": L, "group": f"cheliped_{kind}", "exclude": f"attach_cheliped_{kind}", "side": side})

    symmetry = []
    for name in legs:
        symmetry.append({"object": L, "left": f"part_leg_{name}_L", "right": f"part_leg_{name}_R", "tolerance": 1e-5})
    for appendage in ("antenna", "antennule", "antennule2", "scaphocerite"):
        symmetry.append({"object": L, "left": f"part_{appendage}_L", "right": f"part_{appendage}_R", "tolerance": 1e-5})
    for name in ("hood", "eye", "protopod", "exopod", "endopod") + tuple(f"pleopod_{i}" for i in range(1, 6)):
        symmetry.append({"object": B, "left": f"part_{name}_L", "right": f"part_{name}_R", "tolerance": 1e-5})
    contract["symmetry"] = symmetry
    register_clips(contract, clips)

    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written,
                       notes={"designScale": factor, "legs": legs, "majorChelaSide": "y<0"})
