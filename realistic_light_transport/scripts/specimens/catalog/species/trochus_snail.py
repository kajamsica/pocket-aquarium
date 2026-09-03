"""Trochus snail (aquarium "banded trochus", Trochus / Rochia sp.): species-local gastropod build.

Anatomy choices (all dimensions come from asset.source.json; meters, forward +X, up +Z, origin base_center):

- Shell: a strict logarithmic conispiral. One quadrangular generating curve (outer lip on the cone
  slope, flat base, narrow columella, a small suture groove that tucks into the previous whorl) is
  swept along a dextral helix (clockwise from above) while scaling exponentially toward the apex, so
  every whorl is a scaled copy of the last and the sides of the cone stay straight (top-shaped cone,
  spire angle about 62 degrees, 7.5 whorls). It is one closed loft capped at the protoconch and at the
  aperture; the aperture cap is painted as nacre. Successive whorls overlap inside the solid, so only
  the outer slope, the base and the aperture are visible. Beaded spiral cords, growth striae and the
  suture live in the relief normal map; the maroon flame streaks and pale spiral band in the albedo.
- Soft body: broad foot with a flat sole on z = 0 and a domed body hump that rises into the aperture
  (mantle/visceral mass), a short snout, two long cephalic tentacles with eyes at their outer bases and
  three pairs of epipodial tentacles along the foot edge (typical of Trochidae/Tegulidae). Trochids have
  no siphon, so none is modelled.
- Rig (13 deform bones): Shell, Foot_A -> Foot_B -> Foot_C -> Head -> Tentacle_L/R, Epi1..3_L/R.
- Clips: rest (tentacle sway, body breathing), crawl (pedal wave: lagged location channels along the
  foot chain, tentacle wave, shell rock), retract (foot, head and tentacles pull toward the aperture
  under a hold envelope).
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

FOOT_BONES = ("Foot_A", "Foot_B", "Foot_C")
EPI_COUNT = 3


# ---------------------------------------------------------------- helpers

class _Profile:
    """Monotone cubic (Fritsch-Carlson) interpolation through (x, y) pairs."""

    def __init__(self, points):
        pts = sorted((float(p[0]), float(p[1])) for p in points)
        self.xs = [p[0] for p in pts]
        self.ys = [p[1] for p in pts]
        n = len(self.xs)
        h = [self.xs[i + 1] - self.xs[i] for i in range(n - 1)]
        d = [(self.ys[i + 1] - self.ys[i]) / h[i] for i in range(n - 1)]
        m = [0.0] * n
        for i in range(1, n - 1):
            if d[i - 1] * d[i] > 0:
                w1 = 2 * h[i] + h[i - 1]
                w2 = h[i] + 2 * h[i - 1]
                m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        m[0] = d[0]
        m[-1] = d[-1]
        self.m = m

    def __call__(self, x: float) -> float:
        xs, ys, m = self.xs, self.ys, self.m
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


def _smooth(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def _ring_param(index: int, ring_count: int, segments: int) -> float:
    """Loft parameter t in [0, 1] of vertex `index` (rings first, then start/end cap centres)."""
    if index < ring_count * segments:
        return (index // segments) / max(ring_count - 1, 1)
    return 0.0 if index == ring_count * segments else 1.0


def _bezier(a, b, c, t):
    return ((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0],
            (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1])


# ---------------------------------------------------------------- shell

def generating_curve(shell: dict):
    """Unit aperture outline in the (r, z) half plane: periphery at (1, 0), apex at (0, H).

    Returns (points, marks, H). Point order: base end of the periphery rounding, up the cone slope to
    just below the suture, suture groove tucked into the previous whorl, top edge inward, columella
    down, base outward. `marks` records the segment indices of those regions for painting."""
    alpha = math.radians(float(shell["spireAngleDegrees"]) / 2)
    H = 1.0 / math.tan(alpha)
    W = float(shell["expansion"])
    rs, zs = 1.0 / W, H * (1.0 - 1.0 / W)
    rc = float(shell["columellaRadius"])
    rp = float(shell["peripheryRounding"])
    groove = float(shell["sutureGroove"]) * H
    inset = float(shell["sutureInset"])
    overlap = float(shell["whorlOverlap"]) * H
    convex = float(shell.get("baseConvexity", 0.012))
    concavity = float(shell.get("sideConcavity", 0.0))
    cone = Vector((rs - 1.0, zs)).normalized()
    inward = Vector((-cone.y, cone.x))  # perpendicular to the slope, pointing into the shell
    pts = []
    marks = {}
    A = (1.0 - rp, 0.0)
    P = (1.0, 0.0)
    B = (1.0 + cone.x * rp, cone.y * rp)
    marks["rounding_start"] = 0
    for k in range(4):
        pts.append(_bezier(A, P, B, k / 4))
    marks["cone_start"] = len(pts)
    z1 = zs - groove
    r1 = (H - z1) * math.tan(alpha)
    n_cone = 11
    for k in range(n_cone):
        t = k / (n_cone - 1)
        # Rochia-like whorls: gently concave sides above a protruding periphery
        dip = concavity * math.sin(math.pi * t) ** 1.3
        pts.append((B[0] + (r1 - B[0]) * t + inward.x * dip, B[1] + (z1 - B[1]) * t + inward.y * dip))
    marks["cone_end"] = len(pts) - 1
    pts.append((r1 - inset, zs))
    r_top = r1 - inset - 0.015
    pts.append((r_top, zs + overlap))
    marks["top_start"] = len(pts) - 1
    for k in range(1, 5):
        t = k / 4
        pts.append((r_top + (rc - r_top) * t, zs + overlap))
    for k in range(1, 5):
        t = k / 4
        pts.append((rc, (zs + overlap) * (1.0 - t)))
    marks["base_start"] = len(pts) - 1
    n_base = 8
    for k in range(1, n_base + 1):
        t = k / (n_base + 1)
        pts.append((rc + (A[0] - rc) * t, -convex * math.sin(math.pi * t)))
    return pts, marks, H


def shell_rings(shell: dict, curve, H: float):
    """Unit-radius conispiral rings (dextral, aperture at `aperturePositionDegrees`, apex up)."""
    W = float(shell["expansion"])
    total = float(shell["whorls"]) * math.tau
    phi_ap = math.radians(float(shell.get("aperturePositionDegrees", 90.0)))
    n0, n1 = (float(v) for v in shell["ringsPerWhorl"])
    gs = [0.0]
    while True:
        g = gs[-1] + math.tau / (n0 + (n1 - n0) * gs[-1] / total)
        if g >= total - 0.3 * math.tau / n1:
            break
        gs.append(g)
    gs.append(total)
    rings = []
    for g in gs:
        s = W ** ((g - total) / math.tau)
        phi = phi_ap + (total - g)
        c, sn = math.cos(phi), math.sin(phi)
        rings.append([(s * r * c, s * r * sn, H - s * (H - z)) for r, z in curve])
    return rings, gs, total


def shell_rotation(shell: dict) -> Matrix:
    pitch = math.radians(float(shell["pitchDegrees"]))
    roll = math.radians(float(shell["rollDegrees"]))
    # apex tips backward (-X) and to the animal's right (+Y)
    return Matrix.Rotation(-pitch, 4, "Y") @ Matrix.Rotation(-roll, 4, "X")


def arc_length_u(rings) -> list[float]:
    centroids = [Vector((sum(p[i] for p in ring) / len(ring) for i in range(3))) for ring in rings]
    lengths = [0.0]
    for a, b in zip(centroids, centroids[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    total = lengths[-1]
    return [value / total for value in lengths]


# ---------------------------------------------------------------- soft body geometry

class Foot:
    def __init__(self, foot: dict):
        self.x0 = float(foot["xStart"])
        self.x1 = float(foot["xEnd"])
        self.xc = (self.x0 + self.x1) / 2
        self.a = (self.x1 - self.x0) / 2
        self.b = float(foot["halfWidth"])
        self.p = float(foot["planExponent"])
        self.vb = float(foot["soleRadius"])
        self.exp_d = float(foot["dorsalExponent"])
        self.exp_v = float(foot["ventralExponent"])
        self.heights = _Profile(foot["heights"])
        self.rings = int(foot["rings"])
        self.segments = int(foot["segments"])

    def half_width(self, x: float) -> float:
        inner = max(1.0 - abs((x - self.xc) / self.a) ** self.p, 1e-6)
        return self.b * inner ** (1.0 / self.p)

    def height(self, x: float) -> float:
        return max(self.heights(x), self.vb + 0.0004)

    def surface_y(self, x: float, z: float) -> float:
        """Lateral half extent of the foot section at x for height z (dorsal superellipse)."""
        dz = z - self.vb
        if dz <= 0:
            return self.half_width(x)
        radius = self.height(x) - self.vb
        ratio = min(dz / radius, 1.0)
        return self.half_width(x) * max(1.0 - ratio ** self.exp_d, 0.0) ** (1.0 / self.exp_d)

    def geometry(self):
        margin = 0.985
        xs = [self.xc + self.a * margin * (-1.0 + 2.0 * k / (self.rings - 1)) for k in range(self.rings)]
        rings = [msh.superellipse_ring(x, self.half_width(x), self.height(x) - self.vb, self.vb, 0.0, self.vb,
                                       self.segments, self.exp_d, self.exp_v) for x in xs]
        return msh.loft(rings, u_values=[(x - self.x0) / (self.x1 - self.x0) for x in xs], cap_start=True, cap_end=True)

    def t(self, x: float) -> float:
        return (x - self.x0) / (self.x1 - self.x0)


def head_geometry(head: dict):
    x0, x1 = float(head["xStart"]), float(head["xEnd"])
    z0, z1 = float(head["zStart"]), float(head["zEnd"])
    radii = _Profile(head["radii"])
    n = int(head["rings"])
    points = []
    values = []
    for k in range(n):
        t = k / (n - 1)
        points.append((x0 + (x1 - x0) * t, 0.0, z0 + (z1 - z0) * t))
        values.append(radii(t))
    return msh.tube(points, values, int(head["segments"]), aspect=float(head["aspect"]), u_values=[k / (n - 1) for k in range(n)])


def tentacle_points(tent: dict, side: int):
    base = Vector((tent["base"][0], side * tent["base"][1], tent["base"][2]))
    direction = Vector((tent["direction"][0], side * tent["direction"][1], tent["direction"][2])).normalized()
    length = float(tent["length"])
    arch = float(tent.get("arch", 0.0))
    n = int(tent["rings"])
    points, radii = [], []
    rb, rt = float(tent["radiusBase"]), float(tent["radiusTip"])
    for k in range(n):
        t = k / (n - 1)
        point = base + direction * (length * t) + Vector((0.0, 0.0, arch * math.sin(math.pi * t)))
        points.append(tuple(point))
        radii.append(rb + (rt - rb) * t ** 0.9)
    return points, radii, base, direction


def epipodial_points(epi: dict, foot: Foot, x: float, side: int):
    z = max(0.0018, float(epi["heightFraction"]) * foot.height(x))
    y = foot.surface_y(x, z) - float(epi["embed"])
    base = Vector((x, side * y, z))
    direction = Vector((epi["direction"][0], side * epi["direction"][1], epi["direction"][2])).normalized()
    length = float(epi["length"])
    n = int(epi["rings"])
    rb, rt = float(epi["radiusBase"]), float(epi["radiusTip"])
    points = [tuple(base + direction * (length * k / (n - 1))) for k in range(n)]
    radii = [rb + (rt - rb) * (k / (n - 1)) for k in range(n)]
    return points, radii, base, direction


# ---------------------------------------------------------------- paint

def paint_shell(spec: dict, shell: dict, marks: dict, n_seg: int, u_table, g_table, total: float, width: int, height: int, aperture_u: float = 0.996):
    U, V = textures.uv_grid(width, height)
    palette = spec.get("palette", {})
    G = np.interp(U, np.asarray(u_table), np.asarray(g_table))
    turn = (G - total) / math.tau  # 0 at the aperture, negative toward the apex
    whorls = float(shell["whorls"])
    seg = V * n_seg

    def span(a, b):
        return np.clip((seg - a) / (b - a), 0.0, 1.0)

    def soft_range(a, b, softness=0.6):
        return noise.smoothstep(a - softness, a + softness, seg) * (1.0 - noise.smoothstep(b - softness, b + softness, seg))

    t_side = span(marks["cone_start"], marks["cone_end"])  # 0 periphery, 1 suture
    side_mask = soft_range(marks["cone_start"] - 0.5, marks["cone_end"] + 0.3)
    base_mask = noise.smoothstep(marks["base_start"] + 0.2, marks["base_start"] + 1.0, seg) + (1.0 - noise.smoothstep(marks["cone_start"] - 0.8, marks["cone_start"] + 0.2, seg))
    base_mask = np.clip(base_mask, 0.0, 1.0)
    t_base = np.where(seg >= marks["base_start"], span(marks["base_start"], n_seg), 1.0)  # 0 columella, 1 periphery
    interior_mask = soft_range(marks["top_start"] - 0.4, marks["base_start"] - 0.4, 0.3)
    groove_mask = soft_range(marks["cone_end"] + 0.35, marks["top_start"] - 0.3, 0.35)

    # ground: cream with a faint grey-green film, chalkier and pinker toward the eroded apex
    ground = textures.rgba(palette.get("shell", (0.9, 0.85, 0.74)), 1.0, U.shape)
    film = noise.fbm(turn * 6.0, V * 5.0, octaves=3, seed=21)
    ground = textures.mix(ground, (0.72, 0.74, 0.62), (film - 0.4) * 0.45 * side_mask)
    apex = 1.0 - noise.smoothstep(0.02, 0.32, U)
    ground = textures.mix(ground, (0.94, 0.82, 0.80), apex * 0.55)

    # oblique maroon flame streaks (about 13 per whorl): wavy, irregular width, some forked,
    # leaning strongly across the whorl, interrupted by a thin pale spiral band
    n_flames = 13.0
    wobble = (noise.fbm(-turn * 26.0, t_side * 7.0, octaves=3, seed=11) - 0.5) * 0.16
    k_side = turn * n_flames + 0.62 * t_side + wobble
    cell = np.floor(k_side)
    frac = k_side - cell
    per_flame = noise.value_noise(cell * 3.7 + 0.5, np.full_like(cell, 0.5), seed=5)
    taper = 0.55 + 0.7 * t_side  # flames widen toward the suture
    half = (0.13 + 0.15 * per_flame) * taper
    edge = 0.025 + 0.03 * noise.fbm(-turn * 90.0, V * 12.0, octaves=2, seed=8)
    flame = noise.smoothstep(0.5 - half - edge, 0.5 - half + edge, frac) * (1.0 - noise.smoothstep(0.5 + half - edge, 0.5 + half + edge, frac))
    # forked flames: a thinner secondary streak on the lower whorl for some cells
    k_fork = k_side + 0.5
    cell_f = np.floor(k_fork)
    frac_f = k_fork - cell_f
    fork_on = noise.smoothstep(0.55, 0.7, noise.value_noise(cell_f * 2.3 + 0.5, np.full_like(cell_f, 3.5), seed=13))
    half_f = 0.07 * (1.0 - noise.smoothstep(0.35, 0.7, t_side))
    fork = noise.smoothstep(0.5 - half_f - edge, 0.5 - half_f + edge, frac_f) * (1.0 - noise.smoothstep(0.5 + half_f - edge, 0.5 + half_f + edge, frac_f)) * fork_on
    flame = np.clip(flame + fork, 0.0, 1.0)
    strength = 0.6 + 0.4 * noise.value_noise(cell * 1.9 + 0.5, np.full_like(cell, 7.5), seed=9)
    # random gaps break long streaks
    gaps = noise.smoothstep(0.3, 0.42, noise.fbm(-turn * 20.0, t_side * 5.0, octaves=2, seed=15))
    band = paint.band(t_side, 0.46, 0.022, 0.02)
    flame_side = flame * strength * side_mask * (1.0 - 0.7 * band) * gaps
    # base: narrower pink rays radiating from the columella
    k_base = turn * n_flames + 0.15 * t_base + wobble * 0.5
    cell_b = np.floor(k_base)
    frac_b = k_base - cell_b
    half_b = 0.12 + 0.1 * noise.value_noise(cell_b * 3.7 + 0.5, np.full_like(cell_b, 0.5), seed=5)
    flame_base = noise.smoothstep(0.5 - half_b - edge, 0.5 - half_b + edge, frac_b) * (1.0 - noise.smoothstep(0.5 + half_b - edge, 0.5 + half_b + edge, frac_b))
    flame_base = flame_base * base_mask * (0.4 + 0.6 * t_base)
    maroon = np.asarray(palette.get("flame", (0.45, 0.09, 0.13)))
    pink = np.array((0.76, 0.34, 0.4))
    plum = np.array((0.38, 0.13, 0.26))
    tint = noise.fbm(-turn * 12.0, V * 4.0, octaves=2, seed=31)
    flame_color = textures.mix(textures.rgba(maroon, 1.0, U.shape), pink, tint * 0.7)
    flame_color = textures.mix(flame_color, plum, noise.smoothstep(0.55, 0.75, noise.value_noise(cell * 2.9 + 0.5, np.full_like(cell, 1.5), seed=33)) * 0.6)
    albedo = ground * (1.0 - flame_side[..., None]) + flame_color * flame_side[..., None]
    albedo[..., 3] = 1.0
    albedo = textures.mix(albedo, textures.mix(flame_color, pink, 0.5 * np.ones_like(tint)), flame_base * 0.8)
    # faint reddish spiral speckle line just below the suture (nodulose early whorls)
    subsutural = paint.band(t_side, 0.9, 0.05, 0.03) * side_mask * (0.5 + 0.5 * np.cos(turn * math.tau * 40.0)) * (0.3 + 0.7 * apex)
    albedo = textures.mix(albedo, (0.62, 0.28, 0.3), subsutural * 0.5)
    albedo = textures.mix(albedo, (0.32, 0.2, 0.18), groove_mask * 0.7)

    # relief: beaded spiral cords near the periphery and on the base, growth striae, suture groove
    cord_period = 2.2
    cords = 0.5 + 0.5 * np.cos(seg * math.tau / cord_period)
    cord_id = np.floor(seg / cord_period)
    beads = 0.55 + 0.45 * np.cos((turn * 48.0 + 0.5 * cord_id) * math.tau)
    lower = 1.0 - noise.smoothstep(0.1, 0.34, t_side)
    fine = 0.5 + 0.5 * np.cos(seg * math.tau / 1.1)
    relief = cords * beads * (lower * side_mask + base_mask * (0.35 + 0.65 * t_base)) + 0.35 * fine * side_mask * (1.0 - lower)
    growth = paint.shell_growth_lines(np.clip(-turn / whorls, 0.0, 1.0), V, count=60.0 * whorls, strength=0.6, seed=4)
    grain = noise.fbm(-turn * 70.0, V * 30.0, octaves=2, seed=17)
    heightfield = np.clip(0.5 + 0.22 * relief + 0.07 * (growth - 0.5) + 0.05 * (grain - 0.5) - 0.3 * groove_mask, 0.0, 1.0)
    normal = textures.normal_from_height(heightfield, 2.6)

    roughness = 0.5 - 0.12 * flame_side + 0.08 * relief + 0.06 * (film - 0.5) + 0.12 * apex
    # aperture lip, throat and interior: nacre (slightly iridescent pink-green tint deeper inside)
    nacre_mask = np.clip(noise.smoothstep(aperture_u - 0.0025, aperture_u + 0.0005, U) + interior_mask, 0.0, 1.0)
    depth = noise.smoothstep(aperture_u, 1.0, U)
    nacre = textures.rgba((0.93, 0.9, 0.88), 1.0, U.shape)
    nacre = textures.mix(nacre, (0.78, 0.84, 0.82), depth * (0.4 + 0.3 * noise.fbm(U * 40.0, V * 6.0, 2, seed=71)))
    nacre = textures.mix(nacre, (0.86, 0.72, 0.78), depth * 0.35 * noise.fbm(U * 30.0, V * 9.0, 2, seed=73))
    # the throat darkens with depth so the aperture reads as a cavity behind the bright lip
    nacre = textures.mix(nacre, (0.22, 0.18, 0.18), noise.smoothstep(0.12, 0.7, depth) * 0.88)
    albedo = albedo * (1.0 - nacre_mask[..., None]) + nacre * nacre_mask[..., None]
    albedo[..., 3] = 1.0
    roughness = roughness * (1.0 - nacre_mask) + 0.14 * nacre_mask
    normal = normal * (1.0 - nacre_mask[..., None]) + textures.rgba((0.5, 0.5, 1.0), 1.0, U.shape) * nacre_mask[..., None]
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": normal}


FLESH_BANDS = {"foot": (0.0, 0.58), "head": (0.6, 0.76), "tentacle": (0.78, 0.88), "epipodial": (0.9, 1.0)}


def flesh_uv(band: str):
    lo, hi = FLESH_BANDS[band]

    def transform(u, v):
        return (u, lo + v * (hi - lo))

    return transform


def paint_flesh(spec: dict, width: int, height: int):
    U, V = textures.uv_grid(width, height)
    palette = spec.get("palette", {})
    dark = np.asarray(palette.get("flesh", (0.24, 0.22, 0.2)))
    sole = np.asarray(palette.get("sole", (0.8, 0.74, 0.6)))
    cream = np.array((0.74, 0.68, 0.54))
    albedo = textures.rgba(dark, 1.0, U.shape)
    heightfield = np.full(U.shape, 0.5)
    roughness = np.full(U.shape, 0.5)

    def band_coord(name):
        lo, hi = FLESH_BANDS[name]
        mask = (V >= lo) & (V < hi)
        return mask, np.clip((V - lo) / (hi - lo), 0.0, 1.0)

    # foot: v goes around (0 dorsal ridge, 0.5 sole); dorsal mottled dark with cream flecks, sole pale
    mask, v = band_coord("foot")
    around = np.cos(v * math.tau)  # 1 top, -1 sole
    sole_mask = noise.smoothstep(-0.55, -0.85, around)
    mottle = noise.fbm(U * 14.0, v * 9.0, octaves=3, seed=41)
    flecks = paint.spots(U, v, density=26.0, radius=0.24, seed=43, jitter_radius=0.5)
    marble = noise.smoothstep(0.56, 0.68, noise.fbm(U * 9.0, v * 5.0, octaves=4, seed=47))
    dorsal_color = textures.mix(textures.rgba(dark, 1.0, U.shape), (0.34, 0.33, 0.26), mottle * 0.7)
    dorsal_color = textures.mix(dorsal_color, (0.16, 0.17, 0.13), noise.smoothstep(0.3, 0.45, mottle) * 0.5)
    dorsal_color = textures.mix(dorsal_color, cream, np.clip(flecks * 0.8 + marble * 0.6, 0.0, 1.0) * (1.0 - sole_mask))
    foot_color = textures.mix(dorsal_color, sole, sole_mask)
    foot_color = textures.mix(foot_color, (0.62, 0.56, 0.44), sole_mask * 0.4 * (noise.fbm(U * 20.0, v * 12.0, 2, seed=44) - 0.3))
    albedo = np.where(mask[..., None], foot_color, albedo)
    cell_d, _ = noise.cells(U * 60.0, v * 40.0, seed=45)
    papillae = (1.0 - noise.smoothstep(0.12, 0.42, cell_d)) * (1.0 - sole_mask)
    heightfield = np.where(mask, 0.5 + 0.3 * papillae + 0.08 * (mottle - 0.5), heightfield)
    roughness = np.where(mask, 0.42 + 0.14 * sole_mask - 0.1 * papillae, roughness)

    # head: dark with pale flecks, paler snout tip
    mask, v = band_coord("head")
    mottle_h = noise.fbm(U * 10.0, v * 8.0, octaves=3, seed=51)
    flecks_h = paint.spots(U, v, density=40.0, radius=0.28, seed=53)
    head_color = textures.mix(textures.rgba(dark, 1.0, U.shape), (0.4, 0.36, 0.3), mottle_h * 0.6)
    head_color = textures.mix(head_color, cream, flecks_h * 0.8)
    head_color = textures.mix(head_color, (0.6, 0.5, 0.4), noise.smoothstep(0.82, 1.0, U) * 0.5)
    albedo = np.where(mask[..., None], head_color, albedo)
    cell_h, _ = noise.cells(U * 50.0, v * 30.0, seed=55)
    heightfield = np.where(mask, 0.5 + 0.25 * (1.0 - noise.smoothstep(0.12, 0.4, cell_h)), heightfield)
    roughness = np.where(mask, 0.4 + 0.1 * mottle_h, roughness)

    # cephalic tentacles: dark and pale rings along the length
    mask, v = band_coord("tentacle")
    rings = 0.5 + 0.5 * np.cos(U * math.tau * 9.0 + 0.6 * (noise.fbm(U * 8.0, v * 3.0, 2, seed=61) - 0.5))
    ring_mask = noise.smoothstep(0.35, 0.65, rings)
    tent_color = textures.mix(textures.rgba((0.15, 0.13, 0.12), 1.0, U.shape), (0.86, 0.8, 0.7), ring_mask)
    albedo = np.where(mask[..., None], tent_color, albedo)
    heightfield = np.where(mask, 0.5 + 0.1 * (rings - 0.5), heightfield)
    roughness = np.where(mask, 0.38 + 0.08 * ring_mask, roughness)

    # epipodial tentacles: dark with a pale tip and faint banding
    mask, v = band_coord("epipodial")
    rings_e = 0.5 + 0.5 * np.cos(U * math.tau * 5.0)
    epi_color = textures.mix(textures.rgba((0.2, 0.18, 0.15), 1.0, U.shape), (0.5, 0.46, 0.38), noise.smoothstep(0.4, 0.6, rings_e) * 0.5)
    epi_color = textures.mix(epi_color, (0.82, 0.76, 0.64), noise.smoothstep(0.7, 0.95, U))
    albedo = np.where(mask[..., None], epi_color, albedo)
    roughness = np.where(mask, 0.42, roughness)

    albedo[..., 3] = 1.0
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(np.clip(heightfield, 0.0, 1.0), 1.6)}


# ---------------------------------------------------------------- animation

def _key_all_kinds(channels: list[Channel]) -> list[Channel]:
    """Add zero-amplitude channels so every bone in the clip keys rotation, location and scale.

    The validator evaluates clips back to back without resetting the pose, so a property that one
    clip animates but the next leaves unkeyed would carry a stale value into the next clip."""
    present = {}
    for channel in channels:
        present.setdefault(channel.target, set()).add(channel.kind)
    extra = []
    for target, kinds in present.items():
        for kind in ("rotation", "location", "scale"):
            if kind not in kinds:
                extra.append(Channel(target, kind, (0.0, 0.0, 1.0), 0.0, 1, 0.0, waveform="const"))
    return channels + extra


def build_clips(spec: dict) -> list[ClipSpec]:
    anim = spec["animation"]
    clips = []

    rest = anim["rest"]
    ch = [
        Channel("Tentacle_L", "rotation", (0, 0, 1), float(rest["tentacleSway"]), 1, 0.0),
        Channel("Tentacle_R", "rotation", (0, 0, 1), -float(rest["tentacleSway"]), 1, 1.3),
        Channel("Tentacle_L", "rotation", (1, 0, 0), float(rest["tentacleNod"]), 2, 0.5),
        Channel("Tentacle_R", "rotation", (1, 0, 0), float(rest["tentacleNod"]), 2, 1.7),
        Channel("Foot_A", "rotation", (1, 0, 0), -0.5 * float(rest["footBreath"]), 1, 0.0),
        Channel("Foot_B", "rotation", (1, 0, 0), float(rest["footBreath"]), 1, 0.4),
        Channel("Foot_C", "rotation", (1, 0, 0), 0.6 * float(rest["footBreath"]), 1, 1.0),
        Channel("Head", "rotation", (1, 0, 0), float(rest["headNod"]), 1, 0.8),
        Channel("Shell", "rotation", (1, 0, 0), float(rest["shellRock"]), 1, 0.0),
    ]
    for index in range(EPI_COUNT):
        for side, suffix in ((-1, "L"), (1, "R")):
            ch.append(Channel(f"Epi{index + 1}_{suffix}", "rotation", (0, 0, 1), side * float(rest["epipodialSway"]), 1, 0.7 * index + (0.0 if side < 0 else 0.9)))
    clips.append(ClipSpec("rest", int(rest["frames"]), True, _key_all_kinds(ch)))

    crawl = anim["crawl"]
    lag = float(crawl["pedalLag"])
    ch = []
    for index, bone in enumerate(FOOT_BONES):
        ch.append(Channel(bone, "location", (0, 1, 0), float(crawl["pedalStride"]), 1, -index * lag))
        ch.append(Channel(bone, "location", (0, 0, 1), float(crawl["pedalLift"]), 1, -index * lag + 0.6, waveform="pulse", exponent=2.0))
    ch += [
        Channel("Head", "location", (0, 1, 0), float(crawl["headStride"]), 1, -3 * lag),
        Channel("Head", "rotation", (1, 0, 0), float(crawl["headNod"]), 1, -3 * lag + 0.4),
        Channel("Tentacle_L", "rotation", (0, 0, 1), float(crawl["tentacleSway"]), 1, 0.3),
        Channel("Tentacle_R", "rotation", (0, 0, 1), -float(crawl["tentacleSway"]), 1, 1.9),
        Channel("Tentacle_L", "rotation", (1, 0, 0), float(crawl["tentacleNod"]), 2, 0.0),
        Channel("Tentacle_R", "rotation", (1, 0, 0), float(crawl["tentacleNod"]), 2, 1.2),
        Channel("Shell", "location", (0, 0, 1), float(crawl["shellStride"]), 1, 0.0),
        Channel("Shell", "rotation", (1, 0, 0), float(crawl["shellRock"]), 1, 0.4),
        Channel("Shell", "rotation", (0, 0, 1), float(crawl["shellRoll"]), 1, 1.6),
    ]
    for index in range(EPI_COUNT):
        for side, suffix in ((-1, "L"), (1, "R")):
            ch.append(Channel(f"Epi{index + 1}_{suffix}", "rotation", (0, 0, 1), side * float(crawl["epipodialSway"]), 1, -index * lag + (0.0 if side < 0 else 0.5)))
    clips.append(ClipSpec("crawl", int(crawl["frames"]), True, _key_all_kinds(ch)))

    retract = anim["retract"]
    env = retract.get("envelope", "hold")

    def held(target, kind, axis, amplitude):
        return Channel(target, kind, axis, float(amplitude), 1, 0.0, waveform="const", envelope=env)

    ch = [
        held("Head", "location", (0, -1, 0), retract["headPull"]),
        held("Head", "scale", (0, 1, 0), -float(retract["headShorten"])),
        held("Foot_C", "location", (0, -1, 0), retract["footPull"]),
        held("Foot_C", "scale", (0, 1, 0), -float(retract["footShorten"])),
        held("Foot_B", "scale", (1, 0, 0), -float(retract["footNarrow"])),
        held("Foot_A", "scale", (0, 1, 0), -0.5 * float(retract["footShorten"])),
        held("Shell", "rotation", (1, 0, 0), float(retract["shellDip"])),
    ]
    for suffix in ("L", "R"):
        ch.append(held(f"Tentacle_{suffix}", "rotation", (1, 0, 0), retract["tentaclePitch"]))
        ch.append(held(f"Tentacle_{suffix}", "scale", (0, 1, 0), -float(retract["tentacleShorten"])))
    for index in range(EPI_COUNT):
        for suffix in ("L", "R"):
            ch.append(held(f"Epi{index + 1}_{suffix}", "scale", (0, 1, 0), -float(retract["epipodialShorten"])))
            ch.append(held(f"Epi{index + 1}_{suffix}", "rotation", (1, 0, 0), retract["epipodialPitch"]))
    clips.append(ClipSpec("retract", int(retract["frames"]), False, _key_all_kinds(ch)))
    return clips


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morphology = spec["morphology"]
    shell_spec = morphology["shell"]
    foot = Foot(morphology["foot"])
    head_spec = morphology["head"]
    tent_spec = morphology["tentacles"]
    epi_spec = morphology["epipodialTentacles"]
    eye_spec = morphology["eyes"]
    tex = spec.get("textures", {})
    palette = spec.get("palette", {})

    # ---- soft-body geometry first (fixed metric dimensions)
    foot_geometry = foot.geometry()
    head_geo = head_geometry(head_spec)
    tent_points, tent_radii, tent_base, tent_dir = tentacle_points(tent_spec, -1)
    tent_geo = msh.tube(tent_points, tent_radii, int(tent_spec["segments"]), u_values=[k / (len(tent_points) - 1) for k in range(len(tent_points))])
    epi_data = []
    for index, x in enumerate(epi_spec["x"]):
        points, radii, base, direction = epipodial_points(epi_spec, foot, float(x), -1)
        geometry = msh.tube(points, radii, int(epi_spec["segments"]), u_values=[k / (len(points) - 1) for k in range(len(points))])
        epi_data.append((index, float(x), points, radii, base, direction, geometry))
    soft_y = [abs(v[1]) for v in foot_geometry[0]] + [abs(v[1]) for v in tent_geo[0]] + [abs(v[1]) for v in head_geo[0]]
    for item in epi_data:
        soft_y += [abs(v[1]) for v in item[6][0]]
    soft_half = max(soft_y)

    # ---- shell: unit conispiral, then solve the radius so the whole rest mesh spans referenceSize across y
    curve, marks, H_unit = generating_curve(shell_spec)
    unit_rings, g_table, total_turn = shell_rings(shell_spec, curve, H_unit)
    rotation = shell_rotation(shell_spec)
    unit_vertices = [rotation @ Vector(p) for ring in unit_rings for p in ring]
    unit_ymin = min(v.y for v in unit_vertices)
    unit_ymax = max(v.y for v in unit_vertices)
    unit_zmin = min(v.z for v in unit_vertices)
    axis_x, axis_y = float(shell_spec["axisX"]), float(shell_spec["axisY"])
    target = float(spec["referenceSize"]["meters"])

    def extent(radius: float) -> float:
        return max(axis_y + radius * unit_ymax, soft_half) - min(axis_y + radius * unit_ymin, -soft_half)

    low, high = 0.002, 0.05
    for _ in range(60):
        mid = (low + high) / 2
        if extent(mid) < target:
            low = mid
        else:
            high = mid
    R = (low + high) / 2
    lift = float(shell_spec["restLift"]) - R * unit_zmin
    offset = Vector((axis_x, axis_y, lift))
    shell_rings_m = []
    for ring in unit_rings:
        shell_rings_m.append([tuple(rotation @ (Vector(p) * R) + offset) for p in ring])
    # aperture throat: the tube turns inward behind the outer lip and closes deep inside the body
    # whorl, so the aperture reads as a thick-lipped nacreous opening instead of a flat plate
    aperture_index = len(shell_rings_m) - 1
    lip = [Vector(p) for p in shell_rings_m[-1]]
    centroid = sum(lip, Vector()) / len(lip)
    previous = sum((Vector(p) for p in shell_rings_m[-2]), Vector()) / len(lip)
    growth = (centroid - previous).normalized()
    aperture_size = max((p - centroid).length for p in lip)
    throat_steps = shell_spec.get("throat", [[0.86, 0.1], [0.68, 0.3], [0.42, 0.55]])
    for shrink, depth in throat_steps:
        shell_rings_m.append([tuple(centroid + (p - centroid) * float(shrink) - growth * (float(depth) * aperture_size)) for p in lip])
        g_table = list(g_table) + [total_turn]
    u_table = arc_length_u(shell_rings_m)
    aperture_u = u_table[aperture_index]
    shell_geometry = msh.loft(shell_rings_m, u_values=u_table, cap_start=True, cap_end=True)
    apex = rotation @ Vector((0.0, 0.0, H_unit * R)) + offset

    # ---- textures & materials
    texture_dir = ctx.texture_dir
    written = []
    shell_w, shell_h = tex.get("shellResolution", [1536, 512])
    shell_paint = paint_shell(spec, shell_spec, marks, len(curve), u_table, g_table, total_turn, int(shell_w), int(shell_h), aperture_u)
    flesh_w, flesh_h = tex.get("fleshResolution", [1024, 512])
    flesh_paint = paint_flesh(spec, int(flesh_w), int(flesh_h))
    images = {}
    for label, painted in (("shell", shell_paint), ("flesh", flesh_paint)):
        for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
            path = texture_dir / f"{label}-{key}.png"
            images[(label, key)] = textures.write_image(f"{prefix}_{label}_{key}", path, painted[key], non_color)
            written.append(path)
    shell_material = mat.principled(f"{prefix}_Shell", palette.get("shell", (0.9, 0.85, 0.74)), 0.5, coat=0.18, subsurface=0.02, specular=0.45)
    mat.attach_textures(shell_material, albedo=images[("shell", "albedo")], roughness=images[("shell", "roughness")],
                        normal=images[("shell", "normal")], normal_strength=float(tex.get("shellNormalStrength", 0.9)))
    flesh_material = mat.principled(f"{prefix}_Flesh", palette.get("flesh", (0.24, 0.22, 0.2)), 0.5, coat=0.1, subsurface=0.3, specular=0.35)
    mat.attach_textures(flesh_material, albedo=images[("flesh", "albedo")], roughness=images[("flesh", "roughness")],
                        normal=images[("flesh", "normal")], normal_strength=float(tex.get("fleshNormalStrength", 0.6)))
    eye_material = mat.principled(f"{prefix}_Eye", palette.get("eye", (0.02, 0.015, 0.012)), 0.22, coat=0.5, subsurface=0.0)
    material_map = {"shell": shell_material, "flesh": flesh_material, "eye": eye_material}

    # ---- rig
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, 0.0), (0.004, 0.0, 0.0), deform=False)
    bone_z = 0.0008
    chain_x = [foot.x0 + 0.002, foot.x0 + (foot.x1 - foot.x0) / 3, foot.x0 + 2 * (foot.x1 - foot.x0) / 3, foot.x1 - 0.001]
    parent = "Root"
    for index, name in enumerate(FOOT_BONES):
        rb.bone(name, (chain_x[index], 0.0, bone_z), (chain_x[index + 1], 0.0, bone_z), parent)
        parent = name
    head_x0, head_x1 = float(head_spec["xStart"]), float(head_spec["xEnd"])
    rb.bone("Head", (head_x0 + 0.002, 0.0, float(head_spec["zStart"])), (head_x1, 0.0, float(head_spec["zEnd"])), "Foot_C")
    for side, suffix in ((-1, "L"), (1, "R")):
        _points, _radii, base, direction = tentacle_points(tent_spec, side)
        rb.bone(f"Tentacle_{suffix}", tuple(base), tuple(base + direction * (float(tent_spec["length"]) * 0.8)), "Head")

    def foot_bone_at(x: float) -> str:
        t = foot.t(x)
        return FOOT_BONES[min(int(t * 3), 2)]

    for index, x, points, radii, base, direction, geometry in epi_data:
        for side, suffix in ((-1, "L"), (1, "R")):
            _p, _r, base_s, direction_s = epipodial_points(epi_spec, foot, x, side)
            rb.bone(f"Epi{index + 1}_{suffix}", tuple(base_s), tuple(base_s + direction_s * (float(epi_spec["length"]) * 0.8)), foot_bone_at(x))
    shell_base = Vector((axis_x, axis_y, lift))
    rb.bone("Shell", tuple(shell_base), tuple(shell_base + (apex - shell_base) * float(shell_spec.get("boneHeightFraction", 0.6))), "Root", roll_up=(1.0, 0.0, 0.0))
    rig = rb.finish()

    # ---- mesh parts
    shell_part = msh.make_part("shell", shell_geometry, "shell", lambda i, v: {"Shell": 1.0}, closed=True)
    shell_obj = msh.assemble(f"{prefix}_Shell", [shell_part], material_map, rig, f"{prefix}_Armature")
    shell_obj["lod"] = 1

    foot_part = msh.make_part("foot", foot_geometry, "flesh", lambda i, v: segment_weights(foot.t(v[0]), list(FOOT_BONES), 0.9),
                              closed=True, uv_transform=flesh_uv("foot"))
    head_rings = int(head_spec["rings"])
    head_segments = int(head_spec["segments"])

    def head_weights(i, v):
        t = _ring_param(i, head_rings, head_segments)
        w = _smooth((t - 0.05) / 0.4)
        return msh.blend_weights({"Foot_C": 1.0}, {"Head": 1.0}, w)

    head_part = msh.make_part("head", head_geo, "flesh", head_weights, closed=True, uv_transform=flesh_uv("head"))
    tent_rings = int(tent_spec["rings"])
    tent_segments = int(tent_spec["segments"])

    def tentacle_weights(i, v):
        # long blend so the retract pitch plus shortening never folds rings over each other
        t = _ring_param(i, tent_rings, tent_segments)
        w = _smooth((t - 0.05) / 0.55)
        return msh.blend_weights({"Head": 1.0}, {"Tentacle_L": 1.0}, w)

    tentacle_L = msh.make_part("tentacle_L", tent_geo, "flesh", tentacle_weights, closed=True, uv_transform=flesh_uv("tentacle"))
    tentacle_R = tentacle_L.mirror_y(rename={"_L": "_R"})
    body_parts = [foot_part, head_part, tentacle_L, tentacle_R]
    epi_rings = int(epi_spec["rings"])
    epi_segments = int(epi_spec["segments"])
    for index, x, points, radii, base, direction, geometry in epi_data:
        bone = foot_bone_at(x)
        name = f"Epi{index + 1}_L"

        def epi_weights(i, v, bone=bone, name=name):
            t = _ring_param(i, epi_rings, epi_segments)
            w = _smooth((t - 0.08) / 0.52)
            return msh.blend_weights({bone: 1.0}, {name: 1.0}, w)

        part = msh.make_part(f"epi{index + 1}_L", geometry, "flesh", epi_weights, closed=True, uv_transform=flesh_uv("epipodial"))
        body_parts.append(part)
        body_parts.append(part.mirror_y(rename={"_L": "_R"}))
    body_obj = msh.assemble(f"{prefix}_Body", body_parts, material_map, rig, f"{prefix}_Armature")
    body_obj["lod"] = 1

    eye_center = eye_spec["center"]
    eye_L = msh.make_part("eye_L", msh.ellipsoid((eye_center[0], -abs(eye_center[1]), eye_center[2]), tuple(eye_spec["radii"]), 14, 8),
                          "eye", lambda i, v: {"Head": 1.0}, closed=True)
    eye_R = eye_L.mirror_y(rename={"_L": "_R"})
    details_obj = msh.assemble(f"{prefix}_Details", [eye_L, eye_R], material_map, rig, f"{prefix}_Armature")
    details_obj["lod"] = 1

    # ---- animation
    clips = build_clips(spec)
    for clip in clips:
        bake_clip(rig, clip)

    # ---- contract
    meshes = [shell_obj, body_obj, details_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="y")
    contract["closedParts"] += [
        {"object": shell_obj.name, "group": "part_shell", "volumeFloor": 0.9},
        {"object": body_obj.name, "group": "part_foot", "volumeFloor": 0.6},
        # the head and tentacles genuinely shrink when the animal withdraws (bone scale plus the
        # inherited foot compression), so their floors are lower than the rigid shell's
        {"object": body_obj.name, "group": "part_head", "volumeFloor": 0.35},
        {"object": body_obj.name, "group": "part_tentacle_L", "volumeFloor": 0.2},
        {"object": body_obj.name, "group": "part_tentacle_R", "volumeFloor": 0.2},
        {"object": details_obj.name, "group": "part_eye_L", "volumeFloor": 0.5},
        {"object": details_obj.name, "group": "part_eye_R", "volumeFloor": 0.5},
    ]
    for suffix in ("L", "R"):
        contract["clearance"].append({"a": [body_obj.name, f"part_tentacle_{suffix}"], "b": [body_obj.name, "part_foot"], "label": f"tentacle_{suffix}_foot"})
        contract["clearance"].append({"a": [body_obj.name, f"part_tentacle_{suffix}"], "b": [shell_obj.name, "part_shell"], "label": f"tentacle_{suffix}_shell"})
        contract["clearance"].append({"a": [details_obj.name, f"part_eye_{suffix}"], "b": [body_obj.name, f"part_tentacle_{suffix}"], "label": f"eye_{suffix}_tentacle"})
    contract["clearance"].append({"a": [body_obj.name, "part_tentacle_L"], "b": [body_obj.name, "part_tentacle_R"], "minDistance": 0.001, "label": "tentacle_L_R"})
    for index in range(EPI_COUNT):
        contract["clearance"].append({"a": [body_obj.name, f"part_epi{index + 1}_L"], "b": [body_obj.name, f"part_epi{index + 1}_R"], "label": f"epi{index + 1}_L_R"})
    for suffix, side in (("L", -1), ("R", 1)):
        contract["centerPlane"].append({"object": body_obj.name, "group": f"part_tentacle_{suffix}", "exclude": None, "side": side})
        contract["centerPlane"].append({"object": details_obj.name, "group": f"part_eye_{suffix}", "exclude": None, "side": side})
        for index in range(EPI_COUNT):
            contract["centerPlane"].append({"object": body_obj.name, "group": f"part_epi{index + 1}_{suffix}", "exclude": None, "side": side})
    contract["symmetry"] = [
        {"object": body_obj.name, "left": "part_tentacle_L", "right": "part_tentacle_R", "tolerance": 0.0001},
        {"object": details_obj.name, "left": "part_eye_L", "right": "part_eye_R", "tolerance": 0.0001},
    ] + [{"object": body_obj.name, "left": f"part_epi{index + 1}_L", "right": f"part_epi{index + 1}_R", "tolerance": 0.0001} for index in range(EPI_COUNT)]
    contract["axialChain"] = None
    register_clips(contract, clips)

    notes = {
        "shellRadiusMeters": R,
        "shellHeightMeters": H_unit * R,
        "shellWhorls": float(shell_spec["whorls"]),
        "shellExpansion": float(shell_spec["expansion"]),
        "shellRings": len(shell_rings_m),
        "apertureU": aperture_u,
        "generatingCurvePoints": len(curve),
        "footLengthMeters": foot.x1 - foot.x0,
    }
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
