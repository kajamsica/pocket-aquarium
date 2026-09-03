"""Anacropora sp. (briar coral, thin-branching acroporid): species-local body plan `branching_sps_coral`.

Anatomy choices (WoRMS genus diagnosis after Veron 1986, Corals of the World factsheets for A. forbesi and
A. puertogalerae, Veron and Wallace 1984 via the Naturalis Indo-Malayan reef coral key; see source-references.json):

- Arborescent colony of slender cylindrical branches (3 to 6 mm diameter once the colony is scaled to its 12 cm
  reference width) that fork irregularly at wide angles and taper to blunt, slightly pointed tips WITHOUT an axial
  corallite. That missing axial corallite is the diagnostic difference from Acropora, whose every branch tip carries a
  large tubular axial corallite; here the tip is a smooth, paler rounded point.
- Radial corallites: small (about 1 mm), immersed to slightly protuberant, "widely spaced" and even, laid out as a
  staggered lattice measured back from the branch tip. The lattice is painted into the branch texture (pit, raised
  lower lip, pale rim in albedo, roughness and normal) and, because the branch UVs are anchored at the tip in
  physical units, the same lattice positions the modelled polyps in 3D, so every polyp sits on a painted corallite.
- Polyps: "small, with fine tentacles, extended day and night, widely spaced" (Veron 1986). A subset of the
  corallites carries a modelled polyp: a short closed column tube rising from the calice plus six short closed
  tentacle tubes splayed around it (real acroporid polyps have twelve tentacles; six is the LOD1 stylisation, listed
  as visual debt). Per-polyp column height, tentacle lengths, splay, spin, distal tilt and skin gain come from seeded
  hashes so no two polyps are identical.
- USER RULE FOR STONY CORALS: the skeleton never moves. The rock plug and every branch tube are weighted 1.0 to the
  `Base` bone, which has no animation channel in any clip. Only the polyps move.
- Rig (<= 32 deform bones): `Base` (static) plus one cluster bone per branch laid along the best-fit axis of that
  branch. Polyp roots stay with `Base`, polyp tips blend toward the cluster bone, so a bone translation leans every
  polyp of the branch, a roll about the bone axis swirls the tentacles tangentially, a small bend about the bone head
  grades the motion toward the branch tip, and a scale on the two axes perpendicular to the bone pulls every polyp
  radially toward the branch axis, i.e. back into its corallite, for the retract clip.
- Clips: `sway` (idle loop: slow lean, drift and swirl with per-branch phases), `flow` (locomotion loop: downstream
  lean bias, phase travelling along +X, faster roll and pulsing), `retract` (response, hold envelope: polyps pull into
  the corallites with a slight twist, then re-extend).
- Colour variants change the palette and the layout seed; the geometry recipe is shared.

The shared `meshing.loft` / `meshing.tube` centre-fan caps are wound opposite to the side faces, so every closed
solid here is capped locally (`_close_loft`, same vertex order as the shared helper). Everything derives from
asset.source.json plus fixed seeds (noise.scalar_hash); no random module, no time, no imagery.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from mathutils import Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.noise import cells, fbm, scalar_hash, smoothstep
from ..lib.rigging import RigBuilder

UP = Vector((0.0, 0.0, 1.0))
FLOW = Vector((1.0, 0.0, 0.0))
TEXTURE_LENGTH_CM = 6.0  # branch texture u axis spans this many cm measured back from the tip (u = 1 at the tip)

# Design units are centimetres; the colony is scaled so its xy extent equals referenceSize.meters.
DEFAULTS = {
    "rock": {"radius": 1.7, "height": 1.0, "exponent": 2.2, "rimNoise": 0.08, "segments": 20, "rings": 7},
    "primaries": {
        "count": 5, "central": True, "rootRadius": 0.8, "embed": 0.45, "elevation": [36.0, 58.0],
        "centralElevation": [70.0, 80.0], "azimuthJitter": 14.0, "directionJitter": 18.0,
        "length": [4.2, 5.6], "centralLength": 3.8, "radius": 0.20, "tipRadius": 0.12, "ringStep": 0.52,
        "segments": 10, "curl": 7.0, "wobble": 1.6,
    },
    "forks": {
        "firstAt": [0.35, 0.60], "secondAt": [0.70, 0.84], "secondChance": 0.65, "angle": [30.0, 50.0],
        "lengthFactor": [0.55, 0.80], "radiusFactor": 0.9, "tertiaryMinLength": 2.3, "tertiaryChance": 0.75,
        "tertiaryAt": [0.48, 0.66], "tertiaryLengthFactor": [0.5, 0.66], "minRings": 5, "minElevation": 18.0,
        "curl": 9.0,
    },
    "layout": {"minGap": 0.5, "attempts": 12, "minBranches": 10, "maxBranches": 28, "zFloor": 0.35},
    "tip": {"lengthFactor": 1.25, "exponent": 1.8, "taperStart": 0.45},
    "corallites": {"rowSpacing": 0.22, "perRow": 6, "firstFromTip": 0.30, "pitRadius": 0.038, "jitter": 0.22},
    "polyps": {
        "rowStride": 2, "extraChance": 0.55, "exitMargin": 0.35, "embed": 0.035, "maxPolyps": 120,
        "columnRadius": 0.032, "columnHeight": 0.08, "columnSegments": 5,
        "tentacles": 6, "tentacleLength": [0.13, 0.18], "tentacleRadius": 0.011, "tentacleTipRadius": 0.0055,
        "splay": [28.0, 42.0], "distalTilt": 18.0, "probeReach": 0.23, "probeSide": 0.13, "probeMargin": 0.28,
        "neighbourGap": 0.55, "gain": [0.75, 1.0],
    },
    "clearanceNearCm": 0.5,
}


# ---------------------------------------------------------------- deterministic helpers

def _numeric_keys(keys) -> list[float]:
    """Flatten strings / tuples into stable numbers (never Python's randomised hash())."""
    out: list[float] = []
    for key in keys:
        if isinstance(key, (tuple, list)):
            out.extend(_numeric_keys(key))
        elif isinstance(key, str):
            value = 7
            for char in key:
                value = (value * 131 + ord(char)) % 1000003
            out.append(float(value))
        else:
            out.append(float(key))
    return out


def hash01(seed: int, *keys) -> float:
    return scalar_hash(*_numeric_keys(keys), seed=seed)


def jit(seed: int, *keys) -> float:
    """Deterministic jitter in [-1, 1]."""
    return 2.0 * hash01(seed, *keys) - 1.0


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def sstep(value: float) -> float:
    value = clamp(value)
    return value * value * (3.0 - 2.0 * value)


def merged(defaults: dict, overrides: dict) -> dict:
    out = {}
    for key, value in defaults.items():
        if isinstance(value, dict):
            out[key] = merged(value, overrides.get(key, {}) if isinstance(overrides.get(key), dict) else {})
        else:
            out[key] = overrides.get(key, value)
    for key, value in overrides.items():
        if key not in out:
            out[key] = value
    return out


def perpendicular_frame(direction: Vector):
    d = direction.normalized()
    n = UP if abs(d.dot(UP)) < 0.9 else Vector((0.0, 1.0, 0.0))
    n = (n - d * n.dot(d)).normalized()
    return n, d.cross(n).normalized()


def direction_from(azimuth_deg: float, elevation_deg: float) -> Vector:
    a, e = math.radians(azimuth_deg), math.radians(elevation_deg)
    return Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))


def segment_distance(p1: Vector, q1: Vector, p2: Vector, q2: Vector) -> float:
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1.dot(d1), d2.dot(d2), d2.dot(r)
    if a < 1e-12 and e < 1e-12:
        return r.length
    if a < 1e-12:
        s, t = 0.0, clamp(f / e)
    else:
        c = d1.dot(r)
        if e < 1e-12:
            s, t = clamp(-c / a), 0.0
        else:
            b = d1.dot(d2)
            denom = a * e - b * b
            s = clamp((b * f - c * e) / denom) if denom > 1e-12 else 0.0
            t = (b * s + f) / e
            if t < 0.0:
                t, s = 0.0, clamp(-c / a)
            elif t > 1.0:
                t, s = 1.0, clamp((b - c) / a)
    return ((p1 + d1 * s) - (p2 + d2 * t)).length


def grow(start: Vector, direction: Vector, length: float, rings: int, curl_deg: float, wobble_deg: float,
         seed: int, key) -> list[Vector]:
    """Polyline of `rings` points: constant step, phototropic curl towards +Z, seeded wobble."""
    d = direction.normalized()
    points = [start.copy()]
    step = length / (rings - 1)
    curl = math.radians(curl_deg) / (rings - 1)
    for index in range(1, rings):
        up_perp = UP - d * d.dot(UP)
        if up_perp.length > 1e-6:
            d = (d + up_perp.normalized() * math.tan(curl)).normalized()
        n, b = perpendicular_frame(d)
        wa = math.radians(wobble_deg) * jit(seed, key, index, 1)
        wb = math.radians(wobble_deg) * jit(seed, key, index, 2)
        d = (d + n * math.tan(wa) + b * math.tan(wb)).normalized()
        points.append(points[-1] + d * step)
    return points


def radius_profile(s: float, r_root: float, r_tip: float, taper_start: float) -> float:
    """Anacropora branches keep an even thickness and taper only toward the tip."""
    if s <= taper_start:
        return r_root
    return lerp(r_root, r_tip, sstep((s - taper_start) / max(1.0 - taper_start, 1e-6)))


def _close_loft(geometry, segments: int, ring_count: int, u_values, apex=None):
    """Close an open loft with centre-fan caps wound consistently with its side faces.

    The shared `meshing.loft` caps are wound opposite to the side quads (they render as dark discs and invert the
    tip of every tube), so this species caps its lofts locally. Vertex order matches the shared helper: start centre
    first, end centre second. `apex` optionally relocates the end-cap centre (a rounded branch tip, a dome summit).
    """
    vertices, faces, uvs, face_uvs = geometry
    vertices = list(vertices)
    faces = list(faces)
    uvs = list(uvs)
    face_uvs = list(face_uvs) if face_uvs is not None else None

    def ring_uv(ring: int, s: int):
        return (u_values[ring], s / segments)

    def add_cap(ring: int, reverse: bool, centre_override=None):
        base = ring * segments
        centre = tuple(sum(vertices[base + s][i] for s in range(segments)) / segments for i in range(3))
        if centre_override is not None:
            centre = tuple(centre_override)
        centre_index = len(vertices)
        vertices.append(centre)
        uvs.append((u_values[ring], 0.5))
        for s in range(segments):
            nxt = (s + 1) % segments
            if reverse:
                faces.append((centre_index, base + nxt, base + s))
                if face_uvs is not None:
                    face_uvs.append(((u_values[ring], 0.5), ring_uv(ring, s + 1), ring_uv(ring, s)))
            else:
                faces.append((centre_index, base + s, base + nxt))
                if face_uvs is not None:
                    face_uvs.append(((u_values[ring], 0.5), ring_uv(ring, s), ring_uv(ring, s + 1)))

    add_cap(0, reverse=False)
    add_cap(ring_count - 1, reverse=True, centre_override=apex)
    return vertices, faces, uvs, face_uvs


def closed_tube(points, radii, segments: int, u_values, up_hint=(0.0, 0.0, 1.0), apex=None):
    geometry = msh.tube([tuple(p) for p in points], list(radii), segments, cap_start=False, cap_end=False,
                        up_hint=tuple(up_hint), u_values=list(u_values))
    return _close_loft(geometry, segments, len(points), list(u_values), apex=apex)


def concat_geometry(pieces):
    vertices, faces, uvs, face_uvs = [], [], [], []
    for v, f, u, fu in pieces:
        offset = len(vertices)
        vertices.extend(v)
        faces.extend(tuple(i + offset for i in face) for face in f)
        uvs.extend(u)
        face_uvs.extend(fu if fu else [tuple(u[i] for i in face) for face in f])
    return vertices, faces, uvs, face_uvs


# ---------------------------------------------------------------- solids (design cm)

class Rock:
    """Superellipse rock plug the colony encrusts; static (bone Base)."""

    def __init__(self, cfg: dict, seed: int):
        self.radius = float(cfg["radius"])
        self.height = float(cfg["height"])
        self.exponent = float(cfg["exponent"])
        self.rim_noise = float(cfg["rimNoise"])
        self.segments = int(cfg["segments"])
        self.rings = int(cfg["rings"])
        self.seed = seed
        self.name = "rock"
        self.geometry = ()

    def surface_z(self, r: float) -> float:
        if r >= self.radius:
            return 0.0
        return self.height * (1.0 - (r / self.radius) ** self.exponent) ** (1.0 / self.exponent)

    def inside(self, p: Vector, margin: float) -> bool:
        r = math.hypot(p.x, p.y)
        if p.z < -margin or r > self.radius + margin or p.z > self.height + margin:
            return False
        z_frac = clamp(p.z / self.height)
        surface_r = self.radius * (1.0 - z_frac ** self.exponent) ** (1.0 / self.exponent)
        return r < surface_r + margin

    def build(self):
        ring_list = []
        u_values = []
        for k in range(self.rings):
            t = k / (self.rings - 1)
            z = self.height * (t ** 1.3) * 0.985
            base_r = self.radius * (1.0 - (z / self.height) ** self.exponent) ** (1.0 / self.exponent)
            ring = []
            for segment in range(self.segments):
                angle = segment / self.segments * math.tau
                wobble = 1.0 + self.rim_noise * (0.6 * math.sin(3.0 * angle + 0.7 + t * 2.0) + 0.4 * jit(self.seed, "rock", k, segment))
                r = base_r * wobble
                ring.append((math.cos(angle) * r, math.sin(angle) * r, z))
            ring_list.append(ring)
            u_values.append(t)
        geometry = msh.loft(ring_list, u_values=u_values, cap_start=False, cap_end=False)
        self.geometry = _close_loft(geometry, self.segments, self.rings, u_values, apex=(0.0, 0.0, self.height))
        return self.geometry


@dataclass
class Branch:
    """One closed branch tube of the skeleton, with its polyp cluster bone."""

    name: str
    index: int
    parent: object  # Rock or Branch (the solid this tube grows out of)
    depth: int
    points: list
    radii: list
    apex: Vector
    segments: int
    regular_points: int
    exit_index: int = 0
    cumulative: list = field(default_factory=list)
    length: float = 0.0
    frames: list = field(default_factory=list)
    geometry: tuple = ()
    attach: set = field(default_factory=set)
    bone: str = ""
    polyps: list = field(default_factory=list)
    children: list = field(default_factory=list)

    def __post_init__(self):
        self.cumulative = [0.0]
        for a, b in zip(self.points, self.points[1:]):
            self.cumulative.append(self.cumulative[-1] + (b - a).length)
        self.length = self.cumulative[-1]
        self.frames = msh.frames_along([tuple(p) for p in self.points])

    # ---- queries

    def axis_distance(self, p: Vector):
        best, best_r = 1e9, 0.0
        for a, b, ra, rb in zip(self.points, self.points[1:], self.radii, self.radii[1:]):
            ab = b - a
            t = clamp((p - a).dot(ab) / max(ab.length_squared, 1e-12))
            d = (p - (a + ab * t)).length
            if d < best:
                best, best_r = d, ra + (rb - ra) * t
        return best, best_r

    def inside(self, p: Vector, margin: float) -> bool:
        d, r = self.axis_distance(p)
        return d < r + margin

    def span_at(self, arc: float):
        arc = clamp(arc, 0.0, self.length)
        for k in range(len(self.points) - 1):
            if arc <= self.cumulative[k + 1] or k == len(self.points) - 2:
                span = max(self.cumulative[k + 1] - self.cumulative[k], 1e-9)
                return k, clamp((arc - self.cumulative[k]) / span)
        return len(self.points) - 2, 1.0

    def point_at(self, arc: float) -> Vector:
        k, t = self.span_at(arc)
        return self.points[k].lerp(self.points[k + 1], t)

    def tangent_at(self, arc: float) -> Vector:
        k, _t = self.span_at(arc)
        return (self.points[k + 1] - self.points[k]).normalized()

    def radius_at(self, arc: float) -> float:
        k, t = self.span_at(arc)
        return lerp(self.radii[k], self.radii[k + 1], t)

    def surface_at(self, arc: float, theta: float):
        """Mesh surface point at (arc from root, ring angle) and its outward radial direction.

        Ring vertices are `point + radius * (normal * cos + binormal * sin)` in the rotation-minimising frames the
        tube helper uses, and the loft interpolates linearly between rings, so this matches the mesh exactly and the
        angle maps to texture v = theta / tau.
        """
        k, t = self.span_at(arc)
        cos_t, sin_t = math.cos(theta), math.sin(theta)
        _ta, n0, b0 = self.frames[k]
        _tb, n1, b1 = self.frames[k + 1]
        radial0 = n0 * cos_t + b0 * sin_t
        radial1 = n1 * cos_t + b1 * sin_t
        p0 = self.points[k] + radial0 * self.radii[k]
        p1 = self.points[k + 1] + radial1 * self.radii[k + 1]
        radial = radial0.lerp(radial1, t).normalized()
        return p0.lerp(p1, t), radial, (self.points[k + 1] - self.points[k]).normalized()

    def exit_arc(self) -> float:
        return self.cumulative[self.exit_index]

    def u_values(self) -> list[float]:
        return [clamp(1.0 - (self.length - c) / TEXTURE_LENGTH_CM, 0.0, 1.0) for c in self.cumulative]

    def s_of_vertex(self, index: int) -> int:
        """Ring index of a tube vertex (caps map to the first / last ring)."""
        ring_count = len(self.points)
        if index >= ring_count * self.segments:
            return 0 if index == ring_count * self.segments else ring_count - 1
        return index // self.segments


def make_branch(name: str, index: int, parent, depth: int, root: Vector, direction: Vector, length: float,
                r_root: float, r_tip: float, ring_step: float, segments: int, curl: float, wobble: float,
                tip_cfg: dict, seed: int, key) -> Branch:
    rings = max(5, int(round(length / ring_step)) + 1)
    regular = grow(root, direction, length, rings, curl, wobble, seed, key)
    apex = regular[-1]
    tangent = (regular[-1] - regular[-2]).normalized()
    taper_start = float(tip_cfg["taperStart"])
    points = list(regular[:-1])
    radii = [radius_profile(k / (rings - 1), r_root, r_tip, taper_start) for k in range(rings - 1)]
    tip_length = float(tip_cfg["lengthFactor"]) * r_tip
    exponent = float(tip_cfg["exponent"])
    # blunt, slightly pointed tip without an axial corallite: superellipse rounding over the last tip_length
    for f in (1.0, 0.62, 0.30, 0.08):
        points.append(apex - tangent * (tip_length * f))
        radii.append(r_tip * (1.0 - (1.0 - f) ** exponent) ** (1.0 / exponent))
    return Branch(name, index, parent, depth, points, radii, apex, segments, rings - 1)


def compute_exit(branch: Branch):
    """Index of the first ring whose centre lies clear of the parent solid."""
    for index, point in enumerate(branch.points):
        if not branch.parent.inside(point, branch.radii[index] * 0.8):
            branch.exit_index = index
            return
    branch.exit_index = len(branch.points) // 2


def pair_gap(a: Branch, b: Branch, skip_a: int, skip_b: int) -> float:
    gap = 1e9
    for ia, (p1, q1) in enumerate(zip(a.points, a.points[1:])):
        if ia < skip_a:
            continue
        ra = max(a.radii[ia], a.radii[ia + 1])
        for ib, (p2, q2) in enumerate(zip(b.points, b.points[1:])):
            if ib < skip_b:
                continue
            gap = min(gap, segment_distance(p1, q1, p2, q2) - ra - max(b.radii[ib], b.radii[ib + 1]))
    return gap


def fits(candidate: Branch, branches: list[Branch], rock: Rock, layout_cfg: dict) -> bool:
    min_gap = float(layout_cfg["minGap"])
    z_floor = float(layout_cfg["zFloor"])
    skip_c = candidate.exit_index
    for k, point in enumerate(candidate.points):
        if k >= skip_c and point.z < z_floor:
            return False
        if k >= skip_c and candidate.parent is not rock and rock.inside(point, candidate.radii[k] + min_gap * 0.6):
            return False
    for other in branches:
        related = other is candidate.parent
        skip_o = other.exit_index
        gap = pair_gap(candidate, other, skip_c + (1 if related else 0), skip_o)
        if related:
            if gap < 0.02:
                return False
        elif gap < min_gap:
            return False
    return True


def attach_group(branch: Branch) -> set[int]:
    """Vertices that sit inside (or hug) the parent solid: excluded from that clearance pair."""
    members = set()
    parent = branch.parent
    for index, vertex in enumerate(branch.geometry[0]):
        p = Vector(vertex)
        if isinstance(parent, Rock):
            margin = 0.12 * parent.radius + 0.22
        else:
            _d, r = parent.axis_distance(p)
            margin = 0.3 * r + 0.12
        if parent.inside(p, margin):
            members.add(index)
    return members


# ---------------------------------------------------------------- colony layout

def layout(P: dict, seed: int):
    rock = Rock(P["rock"], seed)
    rock.build()
    pc, fc, lc, tip_cfg = P["primaries"], P["forks"], P["layout"], P["tip"]
    branches: list[Branch] = []
    dropped = []

    def try_add(name, parent, depth, root, direction_fn, length, r_root, r_tip, curl, key) -> Branch | None:
        if len(branches) >= int(lc["maxBranches"]):
            dropped.append(name)
            return None
        for attempt in range(int(lc["attempts"])):
            direction = direction_fn(attempt)
            candidate = make_branch(name, len(branches), parent, depth, root, direction, length, r_root, r_tip,
                                    float(pc["ringStep"]), int(pc["segments"]), curl, float(pc["wobble"]), tip_cfg, seed,
                                    (key, attempt))
            compute_exit(candidate)
            if fits(candidate, branches, rock, lc):
                branches.append(candidate)
                if isinstance(parent, Branch):
                    parent.children.append(candidate)
                return candidate
        dropped.append(name)
        return None

    # primaries rise from the rock plug, leaning outward
    count = int(pc["count"])
    primaries = []
    for i in range(count):
        azimuth = 360.0 * i / count + float(pc["azimuthJitter"]) * jit(seed, "paz", i)
        root_r = float(pc["rootRadius"]) * (0.8 + 0.2 * hash01(seed, "prr", i))
        root = Vector((math.cos(math.radians(azimuth)) * root_r, math.sin(math.radians(azimuth)) * root_r,
                       rock.surface_z(root_r) - float(pc["embed"])))
        elevation = lerp(*[float(v) for v in pc["elevation"]], hash01(seed, "pel", i))
        length = lerp(*[float(v) for v in pc["length"]], hash01(seed, "plen", i))
        base_az = azimuth + float(pc["directionJitter"]) * jit(seed, "pda", i)

        def direction(attempt, base_az=base_az, elevation=elevation):
            swing = 17.0 * ((attempt + 1) // 2) * (1.0 if attempt % 2 else -1.0)
            return direction_from(base_az + swing, clamp(elevation + 3.0 * (attempt % 3), 30.0, 80.0))

        node = try_add(f"branch_{len(branches):02d}", rock, 0, root, direction, length, float(pc["radius"]),
                       float(pc["tipRadius"]), float(pc["curl"]), ("primary", i))
        if node:
            primaries.append(node)
    if pc.get("central", True):
        root = Vector((0.18 * jit(seed, "crx"), 0.18 * jit(seed, "cry"), rock.height - float(pc["embed"])))
        elevation = lerp(*[float(v) for v in pc["centralElevation"]], hash01(seed, "cel"))
        base_az = 360.0 * hash01(seed, "caz")

        def central_direction(attempt, base_az=base_az, elevation=elevation):
            return direction_from(base_az + 47.0 * attempt, clamp(elevation - 2.0 * attempt, 60.0, 85.0))

        node = try_add(f"branch_{len(branches):02d}", rock, 0, root, central_direction, float(pc["centralLength"]),
                       float(pc["radius"]), float(pc["tipRadius"]), float(pc["curl"]) * 0.5, ("central",))
        if node:
            primaries.append(node)

    # forks: breadth first so every daughter sees every earlier branch
    queue = list(primaries)
    while queue:
        parent = queue.pop(0)
        plans = []
        if parent.depth == 0:
            plans.append(("first", fc["firstAt"], fc["lengthFactor"]))
            if hash01(seed, "second", parent.index) < float(fc["secondChance"]):
                plans.append(("second", fc["secondAt"], fc["lengthFactor"]))
        elif parent.depth == 1 and parent.length >= float(fc["tertiaryMinLength"]) \
                and hash01(seed, "tertiary", parent.index) < float(fc["tertiaryChance"]):
            plans.append(("tertiary", fc["tertiaryAt"], fc["tertiaryLengthFactor"]))
        for plan_name, at_range, length_range in plans:
            key = ("fork", parent.index, plan_name)
            s = lerp(float(at_range[0]), float(at_range[1]), hash01(seed, key, "s"))
            arc = max(parent.exit_arc() + 0.35, s * parent.length)
            junction = parent.point_at(arc)
            tangent = parent.tangent_at(arc)
            up_perp = (UP - tangent * tangent.dot(UP))
            up_perp = up_perp.normalized() if up_perp.length > 1e-6 else Vector((1.0, 0.0, 0.0))
            side = tangent.cross(up_perp).normalized()
            outward = Vector((junction.x, junction.y, 0.0))
            outward = outward.normalized() if outward.length > 1e-6 else Vector((1.0, 0.0, 0.0))
            theta = math.radians(lerp(*[float(v) for v in fc["angle"]], hash01(seed, key, "theta")))
            psi0 = math.radians(lerp(-95.0, 95.0, hash01(seed, key, "psi")))
            length = parent.length * lerp(float(length_range[0]), float(length_range[1]), hash01(seed, key, "len"))
            r_root = parent.radius_at(arc) * float(fc["radiusFactor"])
            r_tip = max(float(pc["tipRadius"]) * float(fc["radiusFactor"]) ** parent.depth * 0.95, 0.09)

            def fork_direction(attempt, tangent=tangent, up_perp=up_perp, side=side, outward=outward, theta=theta, psi0=psi0):
                psi = psi0 + math.radians(38.0) * ((attempt + 1) // 2) * (1.0 if attempt % 2 else -1.0)
                lateral = up_perp * math.cos(psi) + side * math.sin(psi)
                direction = (tangent * math.cos(theta) + lateral * math.sin(theta)).normalized()
                # prefer daughters that leave the colony centre; a daughter aimed inward flips its side
                horizontal = Vector((direction.x, direction.y, 0.0))
                if horizontal.length > 1e-6 and horizontal.normalized().dot(outward) < -0.25:
                    lateral = up_perp * math.cos(-psi) + side * math.sin(-psi)
                    direction = (tangent * math.cos(theta) + lateral * math.sin(theta)).normalized()
                min_z = math.sin(math.radians(float(fc["minElevation"])))
                if direction.z < min_z:
                    flat = Vector((direction.x, direction.y, 0.0))
                    flat = flat.normalized() if flat.length > 1e-6 else outward
                    direction = (flat * math.sqrt(1.0 - min_z * min_z) + UP * min_z).normalized()
                return direction

            child = try_add(f"branch_{len(branches):02d}", parent, parent.depth + 1, junction, fork_direction, length,
                            r_root, r_tip, float(fc["curl"]), key)
            if child:
                queue.append(child)
    if len(branches) < int(lc["minBranches"]):
        raise ValueError(f"Only {len(branches)} branches could be placed (dropped {dropped}); adjust the layout seed")
    return rock, branches, dropped


def check_layout(branches: list[Branch], min_gap: float) -> dict:
    """Final capsule gaps between every branch pair (beyond each tube's exit); raises when too tight."""
    gaps = {}
    tight = []
    for i, a in enumerate(branches):
        for b in branches[i + 1:]:
            related = a.parent is b or b.parent is a
            skip_a = a.exit_index + (1 if a.parent is b else 0)
            skip_b = b.exit_index + (1 if b.parent is a else 0)
            gap = pair_gap(a, b, skip_a, skip_b)
            gaps[(a.name, b.name)] = gap
            if gap < (0.02 if related else min_gap):
                tight.append((gap, a.name, b.name))
    for (na, nb), gap in sorted(gaps.items(), key=lambda item: item[1])[:5]:
        print(f"[anacropora] gap {gap:+.3f} cm between {na} and {nb}")
    if tight:
        raise ValueError("Branch layout too tight: " + ", ".join(f"{na}/{nb} {gap:.3f}" for gap, na, nb in tight))
    return gaps


# ---------------------------------------------------------------- corallites and polyps

def corallite_lattice(cfg: dict, seed: int, max_distance: float):
    """Staggered rows of radial corallites measured back from the branch tip: (row, column, distance, v)."""
    spacing = float(cfg["rowSpacing"])
    per_row = int(cfg["perRow"])
    jitter = float(cfg["jitter"])
    first = float(cfg["firstFromTip"])
    out = []
    row = 0
    distance = first
    while distance <= max_distance:
        for column in range(per_row):
            v = ((column + 0.5 * (row % 2)) / per_row + jitter * (hash01(seed, "pit", row, column) - 0.5) / per_row) % 1.0
            out.append((row, column, distance, v))
        row += 1
        distance = first + row * spacing
    return out


@dataclass
class Polyp:
    branch: Branch
    index: int
    geometry: tuple
    weights: list  # per-vertex blend toward the cluster bone in [0, 1]
    top: Vector
    tip_points: list


def polyp_geometry(surface: Vector, radial: Vector, tangent: Vector, cfg: dict, seed: int, key):
    tilt = math.radians(float(cfg["distalTilt"]) * (0.7 + 0.6 * hash01(seed, key, "tilt")))
    axis = (radial + tangent * math.tan(tilt)).normalized()
    gain = lerp(*[float(v) for v in cfg["gain"]], hash01(seed, key, "gain"))
    column_r = float(cfg["columnRadius"]) * (0.9 + 0.2 * hash01(seed, key, "cr"))
    column_h = float(cfg["columnHeight"]) * (0.85 + 0.3 * hash01(seed, key, "ch"))
    base_c = surface - radial * float(cfg["embed"])
    top_c = base_c + axis * column_h
    segments = int(cfg["columnSegments"])
    column = closed_tube([base_c, top_c], [column_r, column_r * 0.9], segments, [0.0, 0.35])
    # skin gain: column base rigid to Base, column top 0.7, tentacle roots 0.8, tentacle tips 1.0 (times the
    # per-polyp gain) so the polyp leans as a unit instead of stretching its tentacles
    pieces = [column]
    weights = [0.0] * (2 * segments) + [0.0, 0.7 * gain]
    for index in range(segments, 2 * segments):
        weights[index] = 0.7 * gain
    n, b = perpendicular_frame(axis)
    spin = math.tau * hash01(seed, key, "spin")
    count = int(cfg["tentacles"])
    tr, tr_tip = float(cfg["tentacleRadius"]), float(cfg["tentacleTipRadius"])
    tips = []
    for k in range(count):
        theta = spin + math.tau * k / count + 0.35 * (math.tau / count) * jit(seed, key, "tth", k)
        splay = math.radians(lerp(*[float(v) for v in cfg["splay"]], hash01(seed, key, "tsp", k)))
        rad_k = n * math.cos(theta) + b * math.sin(theta)
        direction = (axis * math.cos(splay) + rad_k * math.sin(splay)).normalized()
        length = lerp(*[float(v) for v in cfg["tentacleLength"]], hash01(seed, key, "tl", k))
        root = top_c - axis * 0.018 + rad_k * (column_r * 0.55)
        tip = root + direction * length
        pieces.append(closed_tube([root, tip], [tr, tr_tip], 3, [0.35, 1.0], up_hint=tuple(axis)))
        weights.extend([0.8 * gain] * 3 + [gain] * 3 + [0.8 * gain, gain])
        tips.append(tip)
    geometry = concat_geometry(pieces)
    if len(weights) != len(geometry[0]):
        raise RuntimeError("Polyp weight list does not match its geometry")
    return geometry, weights, top_c, tips, axis, n, b, column_h


def place_polyps(branches: list[Branch], rock: Rock, P: dict, seed: int) -> list[Polyp]:
    cfg = P["polyps"]
    lattice_cfg = P["corallites"]
    stride = int(cfg["rowStride"])
    extra_chance = float(cfg["extraChance"])
    exit_margin = float(cfg["exitMargin"])
    reach, side, margin = float(cfg["probeReach"]), float(cfg["probeSide"]), float(cfg["probeMargin"])
    neighbour_gap = float(cfg["neighbourGap"])
    per_row = int(lattice_cfg["perRow"])
    polyps: list[Polyp] = []
    placed_tops: list[tuple[Vector, Branch]] = []
    for branch in branches:
        others = [rock] + [other for other in branches if other is not branch]
        max_distance = branch.length - branch.exit_arc() - exit_margin
        lattice = corallite_lattice(lattice_cfg, seed, max_distance)
        chosen = []
        for row, column, distance, v in lattice:
            if row % stride != branch.index % stride:
                continue
            pick = int(hash01(seed, "pick", branch.index, row) * per_row) % per_row
            if column == pick:
                chosen.append((row, column, distance, v))
            elif hash01(seed, "extra", branch.index, row) < extra_chance and column == (pick + 2 + int(hash01(seed, "extra2", branch.index, row) * 2.0)) % per_row:
                chosen.append((row, column, distance, v))
        for row, column, distance, v in chosen:
            arc = branch.length - distance
            surface, radial, tangent = branch.surface_at(arc, v * math.tau)
            key = ("polyp", branch.index, row, column)
            geometry, weights, top_c, tips, axis, n, b, column_h = polyp_geometry(surface, radial, tangent, cfg, seed, key)
            probes = [surface, top_c, top_c + axis * (reach - column_h)]
            for lateral in (n, -n, b, -b):
                probes.append(top_c + axis * 0.07 + lateral * side)
            if any(other.inside(p, margin) for other in others for p in probes):
                continue
            if any((top_c - other_top).length < neighbour_gap for other_top, owner in placed_tops if owner is not branch):
                continue
            polyps.append(Polyp(branch, len(branch.polyps), geometry, weights, top_c, tips))
            branch.polyps.append(polyps[-1])
            placed_tops.append((top_c, branch))
    # triangle budget guard: keep an even spread by dropping the highest per-branch indices first
    max_polyps = int(cfg.get("maxPolyps", 0))
    if max_polyps and len(polyps) > max_polyps:
        polyps = sorted(polyps, key=lambda polyp: (polyp.index, polyp.branch.index))[:max_polyps]
        polyps.sort(key=lambda polyp: (polyp.branch.index, polyp.index))
        for branch in branches:
            branch.polyps = [polyp for polyp in polyps if polyp.branch is branch]
    return polyps


# ---------------------------------------------------------------- textures

def _rgb(palette: dict, key: str, default):
    return tuple(float(v) for v in palette.get(key, default))


def _lighter(color, amount=0.35):
    return tuple(min(1.0, c * (1.0 + amount) + 0.04) for c in color)


def _darker(color, amount=0.55):
    return tuple(c * (1.0 - amount) for c in color)


def paint_branch(palette: dict, width: int, height: int, seed: int, P: dict, nominal_length: float, normal_strength: float):
    """Branch albedo / roughness / normal: u runs root -> tip (u = 1 at the tip, 6 cm span), v around."""
    U, V = textures.uv_grid(width, height)
    body = _rgb(palette, "body", (0.50, 0.37, 0.24))
    body_dark = _rgb(palette, "bodyDark", _darker(body, 0.45))
    tip = _rgb(palette, "tip", (0.78, 0.42, 0.68))
    tip_core = _rgb(palette, "tipCore", _lighter(tip, 0.25))
    pit_color = _rgb(palette, "pit", _darker(body, 0.6))
    rim_color = _rgb(palette, "rim", _lighter(body, 0.3))
    pc, tip_cfg, cor = P["primaries"], P["tip"], P["corallites"]
    r_root, r_tip = float(pc["radius"]), float(pc["tipRadius"])
    circumference = 2.0 * math.pi * r_root

    # reticulate coenosteum: fine pores between ridges, isotropic in world units
    pore_d, pore_id = cells(U * (TEXTURE_LENGTH_CM / 0.032), V * (circumference / 0.032), seed=seed + 2)
    pores = 1.0 - smoothstep(0.16, 0.42, pore_d)
    grain = fbm(U * 90.0, V * 20.0, octaves=3, seed=seed + 3)
    mottle = fbm(U * 6.0, V * 1.5, octaves=3, seed=seed + 4)
    streak = fbm(U * 14.0, V * 0.6, octaves=2, seed=seed + 5)

    albedo = textures.rgba(body, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.86 + 0.28 * mottle + 0.08 * (grain - 0.5))
    albedo = textures.mix(albedo, body_dark, 0.55 * pores)
    albedo = textures.mix(albedo, body_dark, 0.25 * smoothstep(0.55, 0.8, streak))
    albedo = textures.mix(albedo, _lighter(body, 0.18), 0.35 * smoothstep(0.6, 0.85, grain) * (1.0 - pores))
    height_field = 0.5 + 0.09 * (0.5 - pores) + 0.05 * (grain - 0.5)
    roughness = 0.80 + 0.07 * pores + 0.04 * (grain - 0.5)

    # corallite lattice (identical to the one that positions the polyps)
    pit_r = float(cor["pitRadius"])
    pit_mask = np.zeros(U.shape)
    rim_mask = np.zeros(U.shape)
    lip_mask = np.zeros(U.shape)
    taper_start = float(tip_cfg["taperStart"])
    for _row, _column, distance, v_c in corallite_lattice(cor, seed, TEXTURE_LENGTH_CM):
        u_c = 1.0 - distance / TEXTURE_LENGTH_CM
        s_nominal = 1.0 - distance / nominal_length
        local_r = radius_profile(clamp(s_nominal), r_root, r_tip, taper_start)
        du = pit_r / TEXTURE_LENGTH_CM
        dv = pit_r / (2.0 * math.pi * local_r)
        # this lattice row only touches a narrow column band of the texture
        c0 = max(0, int((u_c - 3.2 * du) * width) - 1)
        c1 = min(width, int((u_c + 3.2 * du) * width) + 2)
        if c1 <= c0:
            continue
        u_win = U[:, c0:c1]
        v_win = V[:, c0:c1]
        dvv = ((v_win - v_c + 0.5) % 1.0) - 0.5
        q = np.sqrt(((u_win - u_c) / du) ** 2 + (dvv / dv) ** 2)
        pit = 1.0 - smoothstep(0.55, 1.0, q)
        rim = np.exp(-((q - 1.3) / 0.32) ** 2)
        # the lower lip (root side, smaller u) is the prominent one in Anacropora
        lip = rim * smoothstep(0.2, 1.1, (u_c - u_win) / du)
        pit_mask[:, c0:c1] = np.maximum(pit_mask[:, c0:c1], pit)
        rim_mask[:, c0:c1] = np.maximum(rim_mask[:, c0:c1], rim)
        lip_mask[:, c0:c1] = np.maximum(lip_mask[:, c0:c1], lip)
    albedo = textures.mix(albedo, rim_color, 0.28 * rim_mask + 0.3 * lip_mask)
    albedo = textures.mix(albedo, pit_color, 0.62 * pit_mask)
    height_field = height_field + 0.08 * rim_mask + 0.16 * lip_mask - 0.30 * pit_mask
    roughness = roughness + 0.06 * pit_mask - 0.03 * rim_mask

    # smooth pale growing tip (no axial corallite): pigment fades over the last centimetre
    tip_mask = smoothstep(1.0 - 1.05 / TEXTURE_LENGTH_CM, 1.0 - 0.18 / TEXTURE_LENGTH_CM, U)
    tip_mask = tip_mask * (0.88 + 0.12 * fbm(U * 30.0, V * 4.0, octaves=2, seed=seed + 6))
    albedo = textures.mix(albedo, tip, tip_mask)
    albedo = textures.mix(albedo, tip_core, smoothstep(1.0 - 0.22 / TEXTURE_LENGTH_CM, 1.0, U) * 0.7)
    height_field = height_field * (1.0 - 0.6 * tip_mask) + 0.5 * 0.6 * tip_mask
    roughness = roughness - 0.08 * tip_mask
    albedo[..., 3] = 1.0
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(np.clip(height_field, 0.0, 1.0), normal_strength)}


def paint_polyp(palette: dict, width: int, height: int, seed: int):
    U, V = textures.uv_grid(width, height)
    base = _rgb(palette, "polyp", (0.82, 0.72, 0.58))
    tip = _rgb(palette, "polypTip", (0.95, 0.91, 0.84))
    mouth = _rgb(palette, "pit", (0.20, 0.13, 0.09))
    albedo = textures.rgba(base, 1.0, U.shape)
    grain = fbm(U * 10.0, V * 3.0, octaves=2, seed=seed + 8)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * grain)
    albedo = textures.mix(albedo, _darker(base, 0.25), (1.0 - smoothstep(0.02, 0.12, U)) * 0.5)
    albedo = textures.mix(albedo, mouth, (1.0 - smoothstep(0.30, 0.36, U)) * smoothstep(0.26, 0.31, U) * 0.35)
    albedo = textures.mix(albedo, tip, smoothstep(0.55, 0.92, U))
    albedo = textures.scale_rgb(albedo, 1.0 + 0.06 * np.abs(np.sin(V * math.pi)))
    albedo[..., 3] = 1.0
    roughness = 0.42 + 0.08 * (grain - 0.5) - 0.06 * smoothstep(0.6, 1.0, U)
    relief = 0.5 + 0.05 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(relief, 0.5)}


def paint_rock(palette: dict, width: int, height: int, seed: int):
    """Rock plug: bare rock below, encrusting tissue (body colour) over the upper part; u runs bottom -> summit."""
    U, V = textures.uv_grid(width, height)
    rock = _rgb(palette, "rock", (0.42, 0.38, 0.33))
    algae = _rgb(palette, "algae", (0.30, 0.36, 0.18))
    coralline = _rgb(palette, "coralline", (0.55, 0.25, 0.42))
    body = _rgb(palette, "body", (0.50, 0.37, 0.24))
    body_dark = _rgb(palette, "bodyDark", _darker(body, 0.45))
    # the rock loft is about ten times wider around than it is tall, so noise is sampled anisotropically
    coarse = fbm(U * 4.0, V * 40.0, octaves=4, seed=seed + 11)
    cracks = smoothstep(0.6, 0.72, fbm(U * 8.0, V * 70.0, octaves=3, seed=seed + 12))
    albedo = textures.rgba(rock, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.7 + 0.6 * coarse)
    albedo = textures.mix(albedo, _darker(rock, 0.6), cracks * 0.7)
    algae_mask = smoothstep(0.5, 0.72, fbm(U * 3.0, V * 30.0, octaves=3, seed=seed + 13)) * (1.0 - smoothstep(0.45, 0.7, U))
    albedo = textures.mix(albedo, algae, algae_mask * 0.6)
    coralline_mask = smoothstep(0.64, 0.8, fbm(U * 2.5, V * 22.0, octaves=3, seed=seed + 14)) * (1.0 - smoothstep(0.45, 0.65, U))
    albedo = textures.mix(albedo, coralline, coralline_mask * 0.7)
    edge = 0.56 + 0.1 * (fbm(V * 9.0, np.full_like(V, 0.3), octaves=2, seed=seed + 15) - 0.5)
    tissue = smoothstep(edge - 0.03, edge + 0.05, U)
    pore_d, _ = cells(U * 40.0, V * 160.0, seed=seed + 16)
    pores = 1.0 - smoothstep(0.16, 0.42, pore_d)
    tissue_color = textures.rgba(body, 1.0, U.shape)
    tissue_color = textures.scale_rgb(tissue_color, 0.88 + 0.24 * coarse)
    tissue_color = textures.mix(tissue_color, body_dark, 0.5 * pores)
    albedo = albedo * (1.0 - tissue[..., None]) + tissue_color * tissue[..., None]
    albedo[..., 3] = 1.0
    height_field = np.clip(0.5 + (0.3 * (coarse - 0.5) - 0.3 * cracks) * (1.0 - tissue) + (0.09 * (0.5 - pores)) * tissue, 0.0, 1.0)
    roughness = np.clip(0.88 - 0.10 * tissue + 0.08 * (coarse - 0.5) - 0.12 * coralline_mask, 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, 1.4)}


def write_set(prefix: str, texture_dir, stem: str, paint: dict, written: list):
    images = {}
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = texture_dir / f"{stem}-{key}.png"
        images[key] = textures.write_image(f"{prefix}_{stem}_{key}", path, paint[key], non_color)
        written.append(path)
    return images


# ---------------------------------------------------------------- animation helpers

def _key_every_kind(channels: list[Channel], envelope: str | None) -> list[Channel]:
    """Add zero-amplitude channels so every animated bone keys rotation, location and scale in every clip;
    otherwise a clip that keys only some kinds inherits the previous clip's pose for the rest (the validator plays
    clips back to back)."""
    kinds_by_bone: dict[str, set[str]] = {}
    for channel in channels:
        kinds_by_bone.setdefault(channel.target, set()).add(channel.kind)
    padded = list(channels)
    for bone in sorted(kinds_by_bone):
        for kind in ("rotation", "location", "scale"):
            if kind not in kinds_by_bone[bone]:
                padded.append(Channel(bone, kind, (0.0, 1.0, 0.0), 0.0, 1.0, 0.0, "const", envelope=envelope))
    return padded


def _local_axis(rig, bone_name: str, world_axis) -> tuple[float, float, float]:
    """Express an armature-space axis in the bone's local (rest) frame for rotation and location channels."""
    m3 = rig.data.bones[bone_name].matrix_local.to_3x3()
    local = (m3.transposed() @ Vector(world_axis)).normalized()
    return (local.x, local.y, local.z)


def build_clips(spec: dict, rig, branches: list[Branch], scale: float, seed: int) -> list[ClipSpec]:
    clips = []
    for clip_name, cfg in spec["animation"].items():
        loop = bool(cfg["loop"])
        env = None if loop else cfg.get("envelope", "hold")
        waveform = "sin" if loop else "const"
        spread = float(cfg.get("phaseSpread", 1.0))
        wave_number = float(cfg.get("waveNumber", 0.0))
        channels: list[Channel] = []
        for branch in branches:
            if not branch.polyps:
                continue
            bone = branch.bone
            rest = rig.data.bones[bone]
            bone_dir = (rest.tail_local - rest.head_local).normalized()
            gain = 0.85 + 0.3 * hash01(seed, "anim", clip_name, branch.index, "gain")
            phase = math.tau * hash01(seed, "anim", clip_name, branch.index, "phase") * spread
            travel = -wave_number * (rest.head_local.x / scale)
            bend_world = bone_dir.cross(FLOW)
            if bend_world.length < 0.2:
                bend_world = Vector((0.0, 1.0, 0.0))
            lean_axis = _local_axis(rig, bone, FLOW)
            drift_axis = _local_axis(rig, bone, (0.0, 1.0, 0.0))
            bend_axis = _local_axis(rig, bone, bend_world.normalized())
            roll_axis = (0.0, 1.0, 0.0)
            lean = float(cfg.get("leanCm", 0.0)) * scale
            lean_bias = float(cfg.get("leanBiasCm", 0.0)) * scale
            if lean or lean_bias:
                channels.append(Channel(bone, "location", lean_axis, lean * gain, float(cfg.get("leanFrequency", 1)),
                                        travel + phase, waveform, bias=lean_bias * gain, envelope=env))
            drift = float(cfg.get("driftCm", 0.0)) * scale
            if drift:
                channels.append(Channel(bone, "location", drift_axis, drift * gain, float(cfg.get("driftFrequency", 1)),
                                        travel + phase + 1.4, waveform, envelope=env))
            roll = float(cfg.get("rollDegrees", 0.0))
            if roll:
                sign = 1.0 if hash01(seed, "anim", clip_name, branch.index, "rollsign") < 0.5 else -1.0
                channels.append(Channel(bone, "rotation", roll_axis, roll * gain * sign, float(cfg.get("rollFrequency", 1)),
                                        travel + phase + 0.6, waveform, envelope=env))
            bend = float(cfg.get("bendDegrees", 0.0))
            if bend:
                channels.append(Channel(bone, "rotation", bend_axis, bend * gain, float(cfg.get("bendFrequency", 1)),
                                        travel + phase, waveform, envelope=env))
            pulse = float(cfg.get("pulse", 0.0))
            if pulse:
                channels.append(Channel(bone, "scale", (1.0, 0.0, 1.0), pulse * gain, float(cfg.get("pulseFrequency", 1)),
                                        travel + phase + 2.1, waveform, envelope=env))
            contract = float(cfg.get("contract", 0.0))
            if contract:
                channels.append(Channel(bone, "scale", (1.0, 0.0, 1.0), -contract, 1.0, 0.0, "const", envelope=env))
        clips.append(ClipSpec(clip_name, int(cfg["frames"]), loop, _key_every_kind(channels, env)))
    return clips


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morphology = spec["morphology"]
    seed = int(morphology.get("seed", 11))
    P = merged(DEFAULTS, morphology)
    palette = spec["palette"]

    # ---- skeleton layout (cm)
    rock, branches, dropped = layout(P, seed)
    for branch in branches:
        branch.geometry = closed_tube(branch.points, branch.radii, branch.segments, branch.u_values(), apex=tuple(branch.apex))
    for branch in branches:
        branch.attach = attach_group(branch)
    gaps = check_layout(branches, float(P["layout"]["minGap"]))

    # ---- polyps (cm)
    polyps = place_polyps(branches, rock, P, seed)
    if not polyps:
        raise ValueError("No polyps could be placed")

    # ---- normalise the colony width to the reference size (axis xy) and convert cm -> m
    xs, ys = [], []
    for vertex in rock.geometry[0]:
        xs.append(vertex[0])
        ys.append(vertex[1])
    for branch in branches:
        xs.extend(v[0] for v in branch.geometry[0])
        ys.extend(v[1] for v in branch.geometry[0])
    for polyp in polyps:
        xs.extend(v[0] for v in polyp.geometry[0])
        ys.extend(v[1] for v in polyp.geometry[0])
    extent_cm = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = float(spec["referenceSize"]["meters"]) / extent_cm
    shift_x = (max(xs) + min(xs)) / 2.0
    shift_y = (max(ys) + min(ys)) / 2.0

    def S(p):
        return ((p[0] - shift_x) * scale, (p[1] - shift_y) * scale, p[2] * scale)

    # ---- textures and materials
    tex = spec.get("textures", {})
    written: list = []
    br_w, br_h = tex.get("branchResolution", [1024, 512])
    po_w, po_h = tex.get("polypResolution", [128, 32])
    ro_w, ro_h = tex.get("rockResolution", [512, 256])
    nominal_length = sum(float(v) for v in P["primaries"]["length"]) / 2.0
    branch_images = write_set(prefix, ctx.texture_dir, "branch",
                              paint_branch(palette, int(br_w), int(br_h), seed, P, nominal_length, float(tex.get("branchNormalStrength", 1.3))), written)
    polyp_images = write_set(prefix, ctx.texture_dir, "polyp", paint_polyp(palette, int(po_w), int(po_h), seed), written)
    rock_images = write_set(prefix, ctx.texture_dir, "rock", paint_rock(palette, int(ro_w), int(ro_h), seed), written)
    branch_mat = mat.principled(f"{prefix}_Branch", _rgb(palette, "body", (0.5, 0.37, 0.24)), 0.80, coat=0.0, subsurface=0.08, specular=0.28)
    mat.attach_textures(branch_mat, albedo=branch_images["albedo"], roughness=branch_images["roughness"], normal=branch_images["normal"],
                        normal_strength=float(tex.get("branchNormalMapStrength", 0.9)))
    polyp_mat = mat.principled(f"{prefix}_Polyp", _rgb(palette, "polyp", (0.82, 0.72, 0.58)), 0.45, coat=0.05, subsurface=0.3, specular=0.35)
    mat.attach_textures(polyp_mat, albedo=polyp_images["albedo"], roughness=polyp_images["roughness"], normal=polyp_images["normal"], normal_strength=0.3)
    rock_mat = mat.principled(f"{prefix}_Rock", _rgb(palette, "rock", (0.42, 0.38, 0.33)), 0.88, coat=0.0, subsurface=0.02, specular=0.25)
    mat.attach_textures(rock_mat, albedo=rock_images["albedo"], roughness=rock_images["roughness"], normal=rock_images["normal"],
                        normal_strength=float(tex.get("rockNormalStrength", 1.0)))
    material_map = {"branch": branch_mat, "polyp": polyp_mat, "rock": rock_mat}

    # ---- rig: static Base plus one polyp cluster bone per branch along the branch's best-fit axis
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, -0.004), (0.0, 0.0, 0.0), deform=False)
    rb.bone("Base", (0.0, 0.0, 0.0), (0.0, 0.0, rock.height * scale), "Root")
    for branch in branches:
        branch.bone = f"Br_{branch.index:02d}"
        centroid = Vector((0.0, 0.0, 0.0))
        for point in branch.points:
            centroid += point
        centroid /= len(branch.points)
        axis = (branch.apex - branch.points[0]).normalized()
        head = centroid + axis * (branch.points[0] - centroid).dot(axis)
        tail = centroid + axis * (branch.apex - centroid).dot(axis)
        rb.bone(branch.bone, S(head), S(tail), "Base")
    rig = rb.finish()

    # ---- skeleton object (rock + branches), every vertex rigid to Base
    def static_weights(i, v):
        return {"Base": 1.0}

    skeleton_parts = [msh.make_part("rock", ([S(v) for v in rock.geometry[0]], *rock.geometry[1:]), "rock", static_weights, closed=True)]
    for branch in branches:
        vertices, faces, uvs, face_uvs = branch.geometry
        skeleton_parts.append(msh.make_part(branch.name, ([S(v) for v in vertices], faces, uvs, face_uvs), "branch", static_weights,
                                            closed=True, groups={f"attach_{branch.name}": set(branch.attach)}))
    skeleton_obj = msh.assemble(f"{prefix}_Skeleton", skeleton_parts, material_map, rig, f"{prefix}_Armature")
    skeleton_obj["lod"] = 1
    skeleton_obj["colonyWidthMeters"] = spec["referenceSize"]["meters"]

    # ---- polyps object: roots with Base, tips toward the branch cluster bone
    polyp_parts = []
    for polyp in polyps:
        vertices, faces, uvs, face_uvs = polyp.geometry

        def polyp_weights(i, v, weights=polyp.weights, bone=polyp.branch.bone):
            w = weights[i]
            if w <= 1e-6:
                return {"Base": 1.0}
            if w >= 1.0 - 1e-6:
                return {bone: 1.0}
            return {"Base": 1.0 - w, bone: w}

        polyp_parts.append(msh.make_part(f"polyp_{polyp.branch.index:02d}_{polyp.index:02d}", ([S(v) for v in vertices], faces, uvs, face_uvs),
                                         "polyp", polyp_weights, closed=True,
                                         groups={f"polyps_{polyp.branch.name}": set(range(len(vertices)))}))
    polyps_obj = msh.assemble(f"{prefix}_Polyps", polyp_parts, material_map, rig, f"{prefix}_Armature", preserve_volume=False)
    polyps_obj["lod"] = 1

    # ---- animation (polyps only; Base is never a channel target)
    clips = build_clips(spec, rig, branches, scale, seed)
    for clip in clips:
        bake_clip(rig, clip, mesh_objects={skeleton_obj.name: skeleton_obj, polyps_obj.name: polyps_obj})

    # ---- contract
    meshes = [skeleton_obj, polyps_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="xy", sample_stride=4)
    contract["closedParts"].append({"object": skeleton_obj.name, "group": "part_rock", "volumeFloor": 0.9})
    for branch in branches:
        contract["closedParts"].append({"object": skeleton_obj.name, "group": f"part_{branch.name}", "volumeFloor": 0.9})

    near = float(P["clearanceNearCm"])
    min_gap = float(P["layout"]["minGap"])
    # skeleton pairs: every parent/child junction (attach ring excluded) and every unrelated pair that is not
    # provably far apart at rest (the skeleton is static, so a rest gap beyond 2 x minGap can never close)
    for i, a in enumerate(branches):
        for b in branches[i + 1:]:
            if b.parent is a:
                entry_a, entry_b = [skeleton_obj.name, f"part_{a.name}"], [skeleton_obj.name, f"part_{b.name}", f"attach_{b.name}"]
            elif a.parent is b:
                entry_a, entry_b = [skeleton_obj.name, f"part_{a.name}", f"attach_{a.name}"], [skeleton_obj.name, f"part_{b.name}"]
            else:
                if gaps.get((a.name, b.name), 0.0) > 2.0 * min_gap:
                    continue
                entry_a = [skeleton_obj.name, f"part_{a.name}", f"attach_{a.name}"] if a.attach else [skeleton_obj.name, f"part_{a.name}"]
                entry_b = [skeleton_obj.name, f"part_{b.name}", f"attach_{b.name}"] if b.attach else [skeleton_obj.name, f"part_{b.name}"]
            contract["clearance"].append({"a": entry_a, "b": entry_b, "label": f"skeleton_{a.name}_{b.name}"})
    for branch in branches:
        if branch.parent is rock:
            contract["clearance"].append({"a": [skeleton_obj.name, "part_rock"], "b": [skeleton_obj.name, f"part_{branch.name}", f"attach_{branch.name}"],
                                          "label": f"skeleton_rock_{branch.name}"})

    def cloud_gap(points: np.ndarray, solid) -> float:
        if isinstance(solid, Rock):
            r = np.hypot(points[:, 0], points[:, 1])
            z = np.clip(points[:, 2], 0.0, solid.height)
            surface = solid.radius * np.maximum(1.0 - (z / solid.height) ** solid.exponent, 0.0) ** (1.0 / solid.exponent)
            return float(np.min(np.maximum(r - surface, points[:, 2] - solid.height)))
        best = 1e9
        for a, b, ra, rb in zip(solid.points, solid.points[1:], solid.radii, solid.radii[1:]):
            ab = np.asarray(b - a, dtype=np.float64)
            rel = points - np.asarray(a, dtype=np.float64)
            t = np.clip(rel @ ab / max(float(ab @ ab), 1e-12), 0.0, 1.0)
            distance = np.linalg.norm(rel - t[:, None] * ab, axis=1) - (ra + (rb - ra) * t)
            best = min(best, float(distance.min()))
        return best

    clouds = {branch.name: np.asarray([v for polyp in branch.polyps for v in polyp.geometry[0]], dtype=np.float64)
              for branch in branches if branch.polyps}
    polyp_pairs = 0
    for carrier_name, points in clouds.items():
        for solid in [rock, *branches]:
            if solid.name == carrier_name or cloud_gap(points, solid) > near:
                continue
            group = "part_rock" if isinstance(solid, Rock) else f"part_{solid.name}"
            contract["clearance"].append({"a": [polyps_obj.name, f"polyps_{carrier_name}"], "b": [skeleton_obj.name, group],
                                          "label": f"polyps_{carrier_name}_vs_{solid.name}"})
            polyp_pairs += 1
    names = sorted(clouds)
    for i, first in enumerate(names):
        for second in names[i + 1:]:
            delta = clouds[first][:, None, :] - clouds[second][None, :, :]
            if float(np.sqrt((delta ** 2).sum(axis=2)).min()) > near:
                continue
            contract["clearance"].append({"a": [polyps_obj.name, f"polyps_{first}"], "b": [polyps_obj.name, f"polyps_{second}"],
                                          "label": f"polyps_{first}_vs_polyps_{second}"})
            polyp_pairs += 1
    contract["axialChain"] = None
    register_clips(contract, clips)

    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    notes = {
        "seed": seed, "designExtentCm": extent_cm, "scaleMetersPerCm": scale, "branches": len(branches), "droppedBranches": dropped,
        "polyps": len(polyps), "polypsPerBranch": {branch.name: len(branch.polyps) for branch in branches},
        "branchDiameterMm": [round(2.0 * float(P["primaries"]["radius"]) * scale * 1000.0, 2), round(2.0 * float(P["primaries"]["tipRadius"]) * scale * 1000.0, 2)],
        "polypReachMm": round(float(P["polyps"]["probeReach"]) * scale * 1000.0, 2),
        "triangles": triangles, "clearancePairs": len(contract["clearance"]), "polypClearancePairs": polyp_pairs,
        "staticSkeletonBone": "Base", "clusterBones": [branch.bone for branch in branches],
    }
    print(f"[anacropora] seed={seed} branches={len(branches)} polyps={len(polyps)} triangles={triangles} "
          f"bones={len(rb.deform_names)} extent={extent_cm:.2f}cm scale={scale:.5f} pairs={len(contract['clearance'])}")
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec.get("preview", {}).get("action", spec["clipRoles"]["locomotion"]), textures=written, notes=notes)
