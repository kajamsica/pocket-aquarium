"""Millepora sp. (fire coral): species-local `hydrocoral_colony` body plan.

Millepora is a hydrozoan (Hydrozoa: Anthoathecata: Milleporidae), not a scleractinian. Its calcareous
coenosteum carries no corallites: the smooth surface is pierced by minute gastropores (0.15 to 0.36 mm)
each ringed by roughly five to seven smaller dactylopores (cyclosystems). Short knob-tentacled
gastrozooids sit in the gastropores; long, hair-like dactylozooids protrude from the dactylopores and give
live colonies their fuzzy look (Razak & Hoeksema 2003, de Weerdt 1981, Ruiz-Ramos et al. 2014; see
source-references.json).

Anatomy choices (source space: metres, up +Z, current along +X, origin base_center, colony rests on z = 0):
- Encrusting base (`part_mound`): one closed loft mound whose lower rim is bare rock and whose top is
  tissue-covered coenosteum.
- Two morphologies selected by `morphology.form` (asset variants `blade` and `branching`):
    blade:      upright plates (M. complanata / M. platyphylla habit): three wavy, laterally offset blades
                rise from the base, thick at the root and thinning toward a rounded, lobed upper margin.
                Each blade is one closed loft along its length (fan outline, seeded waves, lobes, twist).
    branching:  blunt dichotomous branching (M. alcicornis habit): stout, laterally compressed stems fork
                twice in alternating planes into rounded, blunt-tipped branchlets. Every segment is a
                closed tube; children start inside the parent's knuckle so forks read as fused.
- USER RULE (stony corals): the skeleton never moves. Every skeleton vertex is weighted 1.0 to `Base`,
  which carries no animation channel in any clip.
- Dactylozooids ("hairs"): hundreds of tiny closed three-sided tubes rooted 0.3 mm inside the coenosteum
  with deterministic per-hair length, lean and sway gain. Hairs are grouped into cluster bones (<= 31):
  blade faces, blade upper edges, one per branch segment, mound sectors. A hair's root ring is weighted to
  `Base` (it stays in its pore); its tip ring blends toward the cluster bone, so bone translation and
  twist bend the hair while bone scale along the cluster's inward axis pulls the tips into the pores.
- Clips: sway (idle loop: per-cluster drift and wobble at two integer frequencies plus a slow twist), flow
  (loop: lean toward +X travelling across the colony, faster flutter), retract (hold envelope: hairs
  shorten to about 15 % of their length, then re-extend).
- Textures (numpy, project authored): skeleton albedo / roughness / normal (mustard to tan-brown with
  cyclosystem pore speckle and pale tips or edges), base (rock rim, tissue top), hair (translucent whitish
  grading to a bright tip). No emission.
- Shared `meshing.loft` centre-fan caps are wound against the side quads, so lofts are closed here with
  locally wound caps (`_add_caps`).

Everything derives from asset.source.json plus fixed seeds: no random, no time, no third-party pixels.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from mathutils import Matrix, Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.noise import cells, fbm, scalar_hash, smoothstep, value_noise
from ..lib.rigging import RigBuilder

UP = Vector((0.0, 0.0, 1.0))
FLOW = Vector((1.0, 0.0, 0.0))
GOLDEN = math.radians(137.50776)


# ---------------------------------------------------------------- deterministic helpers

def _keys(values) -> list[float]:
    out: list[float] = []
    for value in values:
        if isinstance(value, str):
            acc = 7
            for char in value:
                acc = (acc * 131 + ord(char)) % 1000003
            out.append(float(acc))
        elif isinstance(value, (tuple, list)):
            out.extend(_keys(value))
        else:
            out.append(float(value))
    return out


def h01(seed: int, *keys) -> float:
    return scalar_hash(*_keys(keys), seed=seed)


def jit(seed: int, *keys) -> float:
    return 2.0 * h01(seed, *keys) - 1.0


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def snoise(x: float, y: float, seed: int) -> float:
    """Scalar smooth value noise in [0, 1] (same lattice as the texture noise)."""
    return float(value_noise(np.array([x]), np.array([y]), seed)[0])


def _local_axis(rig, bone_name: str, world_axis) -> tuple[float, float, float]:
    """Express an armature-space direction in the bone's rest frame (unit length preserved)."""
    m3 = rig.data.bones[bone_name].matrix_local.to_3x3()
    local = m3.transposed() @ Vector(world_axis)
    return (local.x, local.y, local.z)


def _key_every_kind(channels: list[Channel], envelope: str | None) -> list[Channel]:
    """Pad zero channels so every animated bone keys rotation, location and scale in every clip
    (the validator plays clips back to back and un-keyed kinds would leak between clips)."""
    kinds: dict[str, set[str]] = {}
    for channel in channels:
        kinds.setdefault(channel.target, set()).add(channel.kind)
    padded = list(channels)
    for bone in sorted(kinds):
        for kind in ("rotation", "location", "scale"):
            if kind not in kinds[bone]:
                padded.append(Channel(bone, kind, (0.0, 1.0, 0.0), 0.0, 1.0, 0.0, "const", envelope=envelope))
    return padded


def _add_caps(geometry, segments: int, ring_count: int, u_values):
    """Close an open loft with centre-fan caps wound consistently with its side quads."""
    vertices, faces, uvs, face_uvs = geometry
    vertices = list(vertices)
    faces = list(faces)
    uvs = list(uvs)
    face_uvs = list(face_uvs)

    def ring_uv(ring: int, s: int):
        return (u_values[ring], s / segments)

    def add_cap(ring: int, reverse: bool):
        base = ring * segments
        center = tuple(sum(vertices[base + s][i] for s in range(segments)) / segments for i in range(3))
        center_index = len(vertices)
        vertices.append(center)
        uvs.append((u_values[ring], 0.5))
        for s in range(segments):
            nxt = (s + 1) % segments
            if reverse:
                faces.append((center_index, base + nxt, base + s))
                face_uvs.append(((u_values[ring], 0.5), ring_uv(ring, s + 1), ring_uv(ring, s)))
            else:
                faces.append((center_index, base + s, base + nxt))
                face_uvs.append(((u_values[ring], 0.5), ring_uv(ring, s), ring_uv(ring, s + 1)))

    add_cap(0, reverse=False)
    add_cap(ring_count - 1, reverse=True)
    return vertices, faces, uvs, face_uvs


def concat_geometry(pieces):
    vertices, faces, uvs, face_uvs = [], [], [], []
    for v, f, u, fu in pieces:
        offset = len(vertices)
        vertices.extend(v)
        faces.extend(tuple(i + offset for i in face) for face in f)
        uvs.extend(u)
        face_uvs.extend(fu)
    return vertices, faces, uvs, face_uvs


def grow(start: Vector, direction: Vector, length: float, steps: int, curl_deg: float, wobble_deg: float,
         seed: int, key) -> list[Vector]:
    """Polyline of `steps` points with constant step, phototropic curl toward +Z and seeded wobble."""
    d = direction.normalized()
    points = [start.copy()]
    step = length / (steps - 1)
    curl = math.radians(curl_deg) / (steps - 1)
    for index in range(1, steps):
        up_perp = UP - d * d.dot(UP)
        if up_perp.length > 1e-6:
            d = (d + up_perp.normalized() * math.tan(curl)).normalized()
        n = UP if abs(d.dot(UP)) < 0.9 else Vector((0.0, 1.0, 0.0))
        n = (n - d * n.dot(d)).normalized()
        b = d.cross(n).normalized()
        wa = math.radians(wobble_deg) * jit(seed, key, index, 1)
        wb = math.radians(wobble_deg) * jit(seed, key, index, 2)
        d = (d + n * math.tan(wa) + b * math.tan(wb)).normalized()
        points.append(points[-1] + d * step)
    return points


def segment_distance(p1: Vector, q1: Vector, p2: Vector, q2: Vector) -> float:
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1.dot(d1), d2.dot(d2), d2.dot(r)
    if a < 1e-14 and e < 1e-14:
        return r.length
    if a < 1e-14:
        s, t = 0.0, clamp(f / e)
    else:
        c = d1.dot(r)
        if e < 1e-14:
            s, t = clamp(-c / a), 0.0
        else:
            b = d1.dot(d2)
            denom = a * e - b * b
            s = clamp((b * f - c * e) / denom) if denom > 1e-14 else 0.0
            t = (b * s + f) / e
            if t < 0.0:
                t, s = 0.0, clamp(-c / a)
            elif t > 1.0:
                t, s = 1.0, clamp((b - c) / a)
    return ((p1 + d1 * s) - (p2 + d2 * t)).length


# ---------------------------------------------------------------- solids (static skeleton)

@dataclass
class Solid:
    name: str
    material: str
    parent: "Solid | None" = None
    geometry: tuple = ()
    attach: set = field(default_factory=set)
    area: float = 0.0
    siblings: set = field(default_factory=set)

    def inside(self, p: Vector, margin: float) -> bool:  # pragma: no cover - overridden
        raise NotImplementedError

    def sample_points(self) -> list[Vector]:
        return [Vector(v) for v in self.geometry[0]]


class Mound(Solid):
    """Encrusting base: superellipse dome over an irregular outline, rock rim below `tissueFrom`."""

    def __init__(self, cfg: dict, seed: int):
        super().__init__("mound", "base")
        self.R0 = float(cfg.get("radius", 0.06))
        self.H = float(cfg.get("height", 0.013))
        self.pe = float(cfg.get("exponent", 3.0))
        self.tissue_from = float(cfg.get("tissueFrom", 0.42))
        self.segments = int(cfg.get("segments", 28))
        self.rings = int(cfg.get("rings", 7))
        self.undulation = float(cfg.get("undulation", 0.05))
        amplitudes = cfg.get("outline", [0.07, 0.05, 0.03, 0.015])
        self.harm = [(k + 2, float(a)) for k, a in enumerate(amplitudes)]
        self.phases = [math.tau * h01(seed, "mound", k) for k in range(len(self.harm) + 2)]
        self.seed = seed

    def outline(self, theta: float) -> float:
        factor = 1.0
        for (order, amplitude), phase in zip(self.harm, self.phases):
            factor += amplitude * math.sin(order * theta + phase)
        return self.R0 * factor

    def top(self, x: float, y: float) -> float:
        r = math.hypot(x, y)
        theta = math.atan2(y, x)
        rho = r / self.outline(theta)
        if rho >= 1.0:
            return 0.0
        base = self.H * (1.0 - rho ** self.pe) ** (1.0 / self.pe)
        und = 1.0 + self.undulation * (0.6 * math.sin(3.0 * theta + self.phases[-1]) + 0.4 * math.sin(5.0 * theta - self.phases[-2])) * rho ** 1.5
        return base * und

    def normal(self, x: float, y: float) -> Vector:
        d = 5e-4
        dzdx = (self.top(x + d, y) - self.top(x - d, y)) / (2 * d)
        dzdy = (self.top(x, y + d) - self.top(x, y - d)) / (2 * d)
        return Vector((-dzdx, -dzdy, 1.0)).normalized()

    def inside(self, p: Vector, margin: float) -> bool:
        if p.z < -margin:
            return False
        r = math.hypot(p.x, p.y)
        theta = math.atan2(p.y, p.x)
        R = self.outline(theta) + margin
        rho = r / R
        if rho >= 1.0:
            return False
        return p.z <= self.H * (1.0 - rho ** self.pe) ** (1.0 / self.pe) * (1.0 + self.undulation) + margin

    def tissue_rho(self) -> float:
        return (1.0 - self.tissue_from ** self.pe) ** (1.0 / self.pe)

    def build(self):
        rings = []
        u_values = []
        for k in range(self.rings):
            t = 0.94 * k / (self.rings - 1)
            ang = t * math.pi / 2
            rho = math.cos(ang) ** (2.0 / self.pe) if k else 1.0
            ring = []
            for s in range(self.segments):
                theta = s / self.segments * math.tau
                R = self.outline(theta)
                x, y = rho * R * math.cos(theta), rho * R * math.sin(theta)
                ring.append((x, y, self.top(x, y) if k else 0.0))
            rings.append(ring)
            u_values.append(sum(v[2] for v in ring) / self.segments / self.H)
        vertices, faces, uvs, face_uvs = _add_caps(msh.loft(rings, u_values=u_values, cap_start=False, cap_end=False),
                                                  self.segments, self.rings, u_values)
        vertices[-1] = (0.0, 0.0, self.top(0.0, 0.0))
        uvs[-1] = (1.0, 0.5)
        for f_index in range(len(faces) - self.segments, len(faces)):
            c0, c1, c2 = face_uvs[f_index]
            face_uvs[f_index] = ((1.0, 0.5), c1, c2)
        self.geometry = (vertices, faces, uvs, face_uvs)
        self.area = math.pi * (self.tissue_rho() * self.R0) ** 2
        return self.geometry


class Blade(Solid):
    """One upright plate: a loft along its length through rounded-rectangle cross-sections (thick keel,
    flat faces, elliptically rounded ridge with vertices concentrated at the top)."""

    def __init__(self, index: int, cfg: dict, defaults: dict, seed: int):
        super().__init__(f"blade_{index}", "skeleton")
        P = {**defaults, **cfg}
        self.index = index
        self.seed = seed
        self.C = Vector((float(P["x"]), float(P["y"]), 0.0))
        phi = math.radians(float(P["azimuthDegrees"]))
        self.e_s = Vector((math.cos(phi), math.sin(phi), 0.0))
        self.e_n = Vector((-math.sin(phi), math.cos(phi), 0.0))
        self.Lh = float(P["halfLength"])
        self.H0 = float(P["height"])
        self.T0 = float(P["thickness"])
        self.wave_amp = float(P["wave"])
        self.wave_freq = float(P["waveFrequency"])
        self.lobes = float(P["lobes"])
        self.lobe_amp = float(P["lobeAmplitude"])
        self.lean = float(P["lean"])
        self.twist = math.radians(float(P["twistDegrees"]))
        self.z0 = float(P["embed"])
        self.top_cap = float(P["topCap"])
        self.top_thin = float(P["topThin"])
        self.relief = float(P["relief"])
        self.Ns = int(P["ringsAlong"])
        self.zfs = [float(v) for v in P["faceLevels"]]
        self.Na = 2 + 2 * len(self.zfs)
        self.s_max = float(P.get("sMax", 0.985))
        self.sections = int(P["sections"])
        self.ph = [math.tau * h01(seed, "blade", index, k) for k in range(6)]

    def wave(self, s: float) -> float:
        return self.wave_amp * (math.sin(math.pi * self.wave_freq * s + self.ph[0]) + 0.45 * math.sin(math.pi * self.wave_freq * 2.3 * s + self.ph[1]))

    def axis(self, s: float) -> Vector:
        return self.C + self.e_s * (s * self.Lh) + self.e_n * self.wave(s)

    def normal_dir(self, s: float) -> Vector:
        return Matrix.Rotation(self.twist * s, 3, "Z") @ self.e_n

    def env(self, s: float) -> float:
        return max(1e-4, 1.0 - abs(s) ** 1.7) ** 0.85

    def height(self, s: float) -> float:
        lobe = 1.0 + self.lobe_amp * (math.sin(math.pi * self.lobes * s + self.ph[2]) + 0.5 * math.sin(math.pi * self.lobes * 2.3 * s + self.ph[3]))
        return max(0.02 * self.H0, self.H0 * self.env(s) * lobe)

    def thickness(self, s: float, zf: float) -> float:
        return self.T0 * (0.35 + 0.65 * math.sqrt(max(0.0, 1.0 - s * s))) * (1.0 - self.top_thin * zf)

    def profile(self, zf: float) -> float:
        """Rounded-rectangle half-width factor: flat faces, elliptical rounding over the top cap."""
        if zf > 1.0 - self.top_cap:
            t = (zf - (1.0 - self.top_cap)) / self.top_cap
            return math.sqrt(max(0.0, 1.0 - t * t))
        return 1.0

    def ring_params(self) -> list[tuple[float, float, float]]:
        """(zf, side, uv_v) around one cross-section: keel, face A up, ridge, face B down."""
        params = [(0.0, 0.0, 0.0)]
        for zf in self.zfs:
            params.append((zf, 1.0, math.acos(clamp(1.0 - 2.0 * zf, -1.0, 1.0)) / math.tau))
        params.append((1.0, 0.0, 0.5))
        for zf in reversed(self.zfs):
            params.append((zf, -1.0, 1.0 - math.acos(clamp(1.0 - 2.0 * zf, -1.0, 1.0)) / math.tau))
        return params

    def surface(self, s: float, zf: float, side: float) -> Vector:
        z = self.z0 + self.height(s) * zf
        half = 0.5 * self.thickness(s, zf) * self.profile(zf)
        relief = 1.0 + self.relief * (snoise(s * 7.0 + 3.1 + self.index * 11.0, zf * 9.0 + 1.7, self.seed + 40) - 0.5) * 2.0
        return self.axis(s) + self.normal_dir(s) * (side * half * relief + self.lean * (z - self.z0)) + UP * z

    def normal(self, s: float, zf: float, side: float) -> Vector:
        ds, dz = 2e-3, 4e-3
        p_s = self.surface(s + ds, zf, side) - self.surface(s - ds, zf, side)
        p_z = self.surface(s, min(zf + dz, 1.0), side) - self.surface(s, max(zf - dz, 0.0), side)
        n = p_z.cross(p_s)
        point = self.surface(s, zf, side)
        center = self.axis(s) + UP * (self.z0 + zf * self.height(s)) + self.normal_dir(s) * (self.lean * zf * self.height(s))
        outward = point - center
        if outward.length < 1e-6:
            outward = UP
        if n.dot(outward) < 0:
            n = -n
        return n.normalized()

    def inside(self, p: Vector, margin: float) -> bool:
        along = (p - self.C).dot(self.e_s)
        if abs(along) > self.Lh + margin:
            return False
        s = clamp(along / self.Lh, -1.0, 1.0)
        zloc = p.z - self.z0
        Hs = self.height(s)
        if zloc < -margin or zloc > Hs + margin:
            return False
        zf = clamp(zloc / Hs)
        half = 0.5 * self.thickness(s, zf) * (1.0 + self.relief) * max(self.profile(zf), 0.35)
        d = (p - self.axis(s)).dot(self.normal_dir(s)) - self.lean * max(zloc, 0.0)
        return abs(d) <= half + margin

    def build(self):
        params = self.ring_params()
        rings = []
        u_values = []
        for k in range(self.Ns):
            s = -self.s_max + 2.0 * self.s_max * k / (self.Ns - 1)
            rings.append([tuple(self.surface(s, zf, side)) for zf, side, _v in params])
            u_values.append(k / (self.Ns - 1))
        vertices, faces, uvs, face_uvs = _add_caps(msh.loft(rings, u_values=u_values, cap_start=False, cap_end=False), self.Na, self.Ns, u_values)
        # the loft spaces v evenly by vertex index; remap it to the equivalent uniform-angle v so the
        # painted edge band lands on the ridge regardless of how the face levels are distributed
        vmap = [v for _zf, _side, v in params] + [1.0]

        def remap(uv):
            index = int(round(uv[1] * self.Na))
            return (uv[0], vmap[min(index, self.Na)] if abs(uv[1] * self.Na - index) < 1e-6 else uv[1])

        uvs = [remap(uv) for uv in uvs]
        face_uvs = [tuple(remap(uv) for uv in corners) for corners in face_uvs]
        self.geometry = (vertices, faces, uvs, face_uvs)
        # fan area of both faces (height integral of the envelope is about 0.78 of the rectangle)
        self.area = 2.0 * 0.78 * self.H0 * 2.0 * self.Lh
        return self.geometry


class Branch(Solid):
    """One skeleton segment: a laterally compressed tube with a rounded blunt tip."""

    def __init__(self, name: str, points: list[Vector], radii: list[float], segments: int, aspect: float,
                 in_plane: Vector, parent: Solid, terminal: bool, level: int, u_range: tuple[float, float]):
        super().__init__(name, "skeleton", parent=parent)
        self.points = points
        self.radii = radii
        self.segments = segments
        self.aspect = aspect
        self.in_plane = in_plane
        self.terminal = terminal
        self.level = level
        self.u_range = u_range
        self.frames = msh.frames_along([tuple(p) for p in points], up_hint=tuple(in_plane))
        self.cum = [0.0]
        for a, b in zip(points, points[1:]):
            self.cum.append(self.cum[-1] + (b - a).length)
        self.length = self.cum[-1]
        self.s_exit = 0.0
        self.bone = ""

    def _locate(self, s: float):
        target = clamp(s) * self.length
        for index in range(len(self.points) - 1):
            if self.cum[index + 1] >= target or index == len(self.points) - 2:
                span = max(self.cum[index + 1] - self.cum[index], 1e-12)
                return index, clamp((target - self.cum[index]) / span)
        return len(self.points) - 2, 1.0

    def point_at(self, s: float) -> Vector:
        index, t = self._locate(s)
        return self.points[index].lerp(self.points[index + 1], t)

    def radius_at(self, s: float) -> float:
        index, t = self._locate(s)
        return lerp(self.radii[index], self.radii[index + 1], t)

    def tangent_at(self, s: float) -> Vector:
        index, _t = self._locate(s)
        return (self.points[index + 1] - self.points[index]).normalized()

    def frame_at(self, s: float):
        index, t = self._locate(s)
        _ta, n0, b0 = self.frames[index]
        _tb, n1, b1 = self.frames[index + 1]
        n = n0.lerp(n1, t).normalized()
        b = b0.lerp(b1, t).normalized()
        return n, b

    def surface(self, s: float, a: float) -> Vector:
        n, b = self.frame_at(s)
        r = self.radius_at(s)
        return self.point_at(s) + n * (math.cos(a) * r) + b * (math.sin(a) * r * self.aspect)

    def normal(self, s: float, a: float) -> Vector:
        n, b = self.frame_at(s)
        return (n * math.cos(a) + b * (math.sin(a) / self.aspect)).normalized()

    def inside(self, p: Vector, margin: float) -> bool:
        for a, b, ra, rb in zip(self.points, self.points[1:], self.radii, self.radii[1:]):
            ab = b - a
            t = clamp((p - a).dot(ab) / max(ab.length_squared, 1e-14))
            if (p - (a + ab * t)).length < lerp(ra, rb, t) + margin:
                return True
        return False

    def compute_exit(self):
        for index, point in enumerate(self.points):
            if not self.parent.inside(point, self.radii[index] * 0.8):
                self.s_exit = self.cum[index] / self.length
                return
        self.s_exit = 0.5

    def build(self):
        u0, u1 = self.u_range
        u_values = [u0 + (u1 - u0) * c / self.length for c in self.cum]
        geometry = msh.tube([tuple(p) for p in self.points], self.radii, self.segments, cap_start=False, cap_end=False,
                            up_hint=tuple(self.in_plane), aspect=self.aspect, u_values=u_values)
        vertices, faces, uvs, face_uvs = _add_caps(geometry, self.segments, len(self.points), u_values)
        direction = (self.points[-1] - self.points[-2]).normalized()
        vertices[-1] = tuple(self.points[-1] + direction * (self.radii[-1] * 0.9))
        self.geometry = (vertices, faces, uvs, face_uvs)
        mean_r = sum(self.radii[:-3]) / max(len(self.radii) - 3, 1)
        self.area = 2.0 * math.pi * mean_r * (0.5 + 0.5 * self.aspect) * self.length * (1.0 - self.s_exit)
        return self.geometry


# ---------------------------------------------------------------- layouts (nominal metres)

def round_tip(points: list[Vector], radii: list[float], knuckle: bool = False):
    """Append rounding rings beyond the last polyline point: a hemisphere for terminal tips, a shorter
    blunt knuckle for forking parents so the children cover it."""
    direction = (points[-1] - points[-2]).normalized()
    r = radii[-1]
    tip = points[-1]
    if knuckle:
        points = points + [tip + direction * (0.25 * r), tip + direction * (0.48 * r), tip + direction * (0.62 * r)]
        radii = radii + [0.90 * r, 0.62 * r, 0.24 * r]
    else:
        points = points + [tip + direction * (0.38 * r), tip + direction * (0.72 * r), tip + direction * (0.94 * r)]
        radii = radii + [0.92 * r, 0.68 * r, 0.30 * r]
    return points, radii


def layout_blades(cfg: dict, seed: int) -> list[Blade]:
    defaults = cfg.get("defaults", {})
    return [Blade(index, item, defaults, seed) for index, item in enumerate(cfg["blades"])]


def layout_branching(cfg: dict, mound: Mound, seed: int) -> list[Branch]:
    P = cfg
    branches: list[Branch] = []
    stems = int(P["stems"])
    segments = int(P["segments"])
    aspect = float(P["aspect"])
    wobble = float(P["wobble"])

    def fork(parent: Branch, level: int, plane_normal: Vector, key):
        """Two children diverging from inside the parent's knuckle in the plane orthogonal to plane_normal."""
        s_fork = float(P["forkStart"])
        origin = parent.point_at(s_fork)
        d_parent = parent.tangent_at(0.97)
        r_parent = parent.radius_at(s_fork)
        half = math.radians(float(P["forkHalfAngle"][level - 1]) + float(P["forkAngleJitter"]) * jit(seed, key, "half"))
        skew = math.radians(float(P["forkSkew"]) * jit(seed, key, "skew"))
        children = []
        for side in (-1.0, 1.0):
            d = Matrix.Rotation(side * half + skew, 3, plane_normal) @ d_parent
            length = float(P["length"][level]) * (1.0 + float(P["lengthJitter"]) * jit(seed, key, side, "len"))
            steps = int(P["rings"][level])
            points = grow(origin + d * (r_parent * 0.15), d, length, steps, float(P["curl"][level]), wobble, seed, (key, side))
            r0 = r_parent * float(P["childRadiusFactor"])
            r1 = r0 * float(P["taper"][level])
            radii = [lerp(r0, r1, k / (steps - 1)) for k in range(steps)]
            terminal = level >= 2 or h01(seed, key, side, "fork") > float(P["secondaryForkChance"])
            points, radii = round_tip(points, radii, knuckle=not terminal)
            u_range = (0.25, 1.0) if terminal else (0.12, 0.5)
            in_plane = (plane_normal.cross(d)).normalized()
            name = f"{parent.name}{'ab'[0 if side < 0 else 1]}"
            child = Branch(name, points, radii, segments, aspect, in_plane, parent, terminal, level, u_range)
            children.append(child)
        children[0].siblings.add(children[1].name)
        children[1].siblings.add(children[0].name)
        for child in children:
            branches.append(child)
            if not child.terminal:
                twist = math.radians(float(P["planeTwistDegrees"]) * (1.0 + 0.3 * jit(seed, child.name, "tw")))
                next_normal = (Matrix.Rotation(twist, 3, child.tangent_at(0.9)) @ plane_normal).normalized()
                fork(child, level + 1, next_normal, child.name)

    for i in range(stems):
        az = math.radians(360.0 * i / stems + float(P["stemAzimuthJitter"]) * jit(seed, "az", i))
        radial = Vector((math.cos(az), math.sin(az), 0.0))
        tangential = Vector((-math.sin(az), math.cos(az), 0.0))
        root_r = float(P["stemRootRadius"]) * (1.0 + 0.25 * jit(seed, "rr", i))
        root = radial * root_r
        root.z = mound.top(root.x, root.y) - float(P["stemEmbed"])
        elevation = math.radians(float(P["stemElevation"]) + float(P["stemElevationJitter"]) * jit(seed, "el", i))
        d = (radial * math.cos(elevation) + UP * math.sin(elevation)).normalized()
        length = float(P["length"][0]) * (1.0 + float(P["lengthJitter"]) * jit(seed, "sl", i))
        steps = int(P["rings"][0])
        points = grow(root, d, length, steps, float(P["curl"][0]), wobble * 0.6, seed, ("stem", i))
        r0 = float(P["stemRadius"]) * (1.0 + 0.08 * jit(seed, "sr", i))
        r1 = r0 * float(P["taper"][0])
        radii = [lerp(r0, r1, k / (steps - 1)) for k in range(steps)]
        points, radii = round_tip(points, radii, knuckle=True)
        plane_normal = d.cross(tangential).normalized()
        stem = Branch(f"stem_{i}", points, radii, segments, aspect, tangential, mound, False, 0, (0.0, 0.3))
        branches.append(stem)
        fork(stem, 1, plane_normal, stem.name)
    return branches


def check_layout(branches: list[Branch], min_gap: float) -> dict:
    """Capsule gaps between every pair of tubes; junction segments of parent/child and sibling pairs are skipped."""
    report = {}
    worst = []
    for i, a in enumerate(branches):
        for b in branches[i + 1:]:
            related = a.parent is b or b.parent is a
            siblings = b.name in a.siblings
            skip_a = int(round(a.s_exit * (len(a.points) - 1))) + 1
            skip_b = int(round(b.s_exit * (len(b.points) - 1))) + 1
            if siblings:
                skip_a = max(skip_a, int(0.5 * (len(a.points) - 1)))
                skip_b = max(skip_b, int(0.5 * (len(b.points) - 1)))
            gap = 1e9
            # segments still inside the parent solid are hidden and excluded from the contract too
            for ia, (p1, q1) in enumerate(zip(a.points, a.points[1:])):
                if ia < skip_a:
                    continue
                for ib, (p2, q2) in enumerate(zip(b.points, b.points[1:])):
                    if ib < skip_b:
                        continue
                    d = segment_distance(p1, q1, p2, q2) - max(a.radii[ia], a.radii[ia + 1]) - max(b.radii[ib], b.radii[ib + 1])
                    gap = min(gap, d)
            report[tuple(sorted((a.name, b.name)))] = gap
            worst.append((gap, a.name, b.name, related or siblings))
    worst.sort()
    for gap, na, nb, related in worst[:6]:
        print(f"[millepora] gap {gap * 1000:+.2f} mm between {na} and {nb}{' (junction pair)' if related else ''}")
    # junction pairs fuse by design; beyond the junction they may touch but must not run into each other
    tight = [w for w in worst if w[0] < (-0.0005 if w[3] else min_gap)]
    if tight:
        raise ValueError("Branch layout too tight: " + ", ".join(f"{na}/{nb} {gap * 1000:.2f} mm" for gap, na, nb, _r in tight[:8]))
    return report


# ---------------------------------------------------------------- hairs (dactylozooids) and clusters

@dataclass
class Cluster:
    bone: str
    head: Vector
    axis: Vector          # bone Y direction (world), points out of the skeleton or along a branch
    tangent: Vector       # a world direction lying in the hair-root surface plane
    kind: str             # face | edge | tube | mound
    owner: str
    depth: float          # distance from the bone head to the hair roots along the retract axis
    retract_axis: tuple
    hairs: list = field(default_factory=list)


@dataclass
class Hair:
    root: Vector
    tip: Vector
    r0: float
    gain: float
    length: float


def make_hair(root_surface: Vector, normal: Vector, cfg: dict, seed: int, key, up_bias: float) -> Hair:
    length = lerp(float(cfg["length"][0]), float(cfg["length"][1]), h01(seed, key, "len"))
    lean = float(cfg["lean"]) * h01(seed, key, "lean")
    angle = math.tau * h01(seed, key, "ang")
    t1 = normal.cross(UP if abs(normal.dot(UP)) < 0.9 else Vector((1.0, 0.0, 0.0))).normalized()
    t2 = normal.cross(t1).normalized()
    direction = (normal + (t1 * math.cos(angle) + t2 * math.sin(angle)) * lean + UP * up_bias).normalized()
    embed = float(cfg["embed"])
    root = root_surface - normal * embed
    tip = root + direction * (length + embed)
    r0 = float(cfg["radius"]) * (0.85 + 0.3 * h01(seed, key, "rad"))
    gain = lerp(float(cfg["gain"][0]), float(cfg["gain"][1]), h01(seed, key, "gain"))
    return Hair(root, tip, r0, gain, length)


def hair_clear(hair: Hair, others: list[Solid], margin: float) -> bool:
    mid = hair.root.lerp(hair.tip, 0.5)
    for other in others:
        if other.inside(hair.root, margin * 0.8) or other.inside(mid, margin) or other.inside(hair.tip, margin):
            return False
    return True


def hair_geometry(hair: Hair, cfg: dict, seed: int, key):
    direction = (hair.tip - hair.root).normalized()
    up_hint = (1.0, 0.0, 0.0) if abs(direction.x) < 0.9 else (0.0, 1.0, 0.0)
    radii = [hair.r0, hair.r0 * float(cfg["tipRadiusFactor"])]
    geometry = msh.tube([tuple(hair.root), tuple(hair.tip)], radii, 3, cap_start=False, cap_end=False, up_hint=up_hint, u_values=[0.0, 1.0])
    return _add_caps(geometry, 3, 2, [0.0, 1.0])


def hair_weights(hair: Hair, bone: str) -> list[dict]:
    root = {"Base": 1.0}
    tip = {bone: hair.gain, "Base": 1.0 - hair.gain} if hair.gain < 0.999 else {bone: 1.0}
    return [root, root, root, tip, tip, tip, root, tip]


# ---------------------------------------------------------------- textures

def _rgb(palette: dict, key: str, default):
    return tuple(float(v) for v in palette.get(key, default))


def _pores(U, V, frequency: float, v_ratio: float, seed: int):
    """Cyclosystem speckle: sparse gastropores each ringed by smaller dactylopores. Returns (mask, gastro)."""
    gd, _gid = cells(U * frequency, V * frequency * v_ratio, seed)
    gastro = 1.0 - smoothstep(0.09, 0.19, gd)
    annulus = smoothstep(0.24, 0.32, gd) * (1.0 - smoothstep(0.44, 0.56, gd))
    dd, _did = cells(U * frequency * 3.1 + 0.37, V * frequency * v_ratio * 3.1 + 0.11, seed + 5)
    dactyl = (1.0 - smoothstep(0.13, 0.27, dd)) * annulus
    return np.maximum(gastro, 0.75 * dactyl), gastro


def paint_skeleton(palette: dict, width: int, height: int, seed: int, mode: str, pore_frequency: float, v_ratio: float, normal_strength: float):
    U, V = textures.uv_grid(width, height)
    body = _rgb(palette, "body", (0.80, 0.62, 0.22))
    dark = _rgb(palette, "bodyDark", (0.55, 0.38, 0.14))
    light = _rgb(palette, "bodyLight", (0.90, 0.76, 0.36))
    tip = _rgb(palette, "tip", (0.94, 0.91, 0.82))
    pore = _rgb(palette, "pore", (0.30, 0.22, 0.10))
    mottle = fbm(U * 5.0 + 1.3, V * 4.0 + 0.7, octaves=4, seed=seed + 11)
    blotch = fbm(U * 14.0 + 7.1, V * 11.0 + 3.3, octaves=3, seed=seed + 12)
    grain = fbm(U * 110.0, V * 70.0, octaves=2, seed=seed + 13)
    albedo = textures.rgba(body, 1.0, U.shape)
    albedo = textures.mix(albedo, dark, smoothstep(0.38, 0.80, mottle) * 0.6)
    albedo = textures.mix(albedo, light, smoothstep(0.58, 0.85, blotch) * 0.45)
    albedo = textures.scale_rgb(albedo, 0.93 + 0.14 * grain)
    pores, gastro = _pores(U, V, pore_frequency, v_ratio, seed + 21)
    if mode == "branch":
        tip_mask = smoothstep(0.83, 0.95, U + 0.06 * (mottle - 0.5))
    else:
        zf = 0.5 - 0.5 * np.cos(V * math.tau)
        edge = smoothstep(0.84, 0.955, zf + 0.06 * (mottle - 0.5))
        ends = smoothstep(0.90, 0.99, np.abs(2.0 * U - 1.0))
        tip_mask = np.maximum(edge, ends)
    albedo = textures.mix(albedo, pore, pores * (0.62 - 0.35 * tip_mask))
    albedo = textures.mix(albedo, tip, tip_mask * 0.9)
    albedo[..., 3] = 1.0
    roughness = 0.80 + 0.08 * (grain - 0.5) + 0.06 * pores - 0.05 * tip_mask
    height_field = np.clip(0.5 + 0.05 * (mottle - 0.5) + 0.04 * (blotch - 0.5) + 0.03 * (grain - 0.5) - 0.24 * pores - 0.06 * gastro, 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, normal_strength)}


def paint_base(palette: dict, width: int, height: int, seed: int, tissue_from: float, pore_frequency: float):
    U, V = textures.uv_grid(width, height)
    rock = _rgb(palette, "rock", (0.32, 0.29, 0.25))
    coralline = _rgb(palette, "coralline", (0.55, 0.28, 0.40))
    body = _rgb(palette, "body", (0.80, 0.62, 0.22))
    dark = _rgb(palette, "bodyDark", (0.55, 0.38, 0.14))
    pore = _rgb(palette, "pore", (0.30, 0.22, 0.10))
    coarse = fbm(U * 4.0, V * 9.0, octaves=4, seed=seed + 31)
    cracks = smoothstep(0.62, 0.74, fbm(U * 9.0, V * 18.0, octaves=3, seed=seed + 32))
    albedo = textures.rgba(rock, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.72 + 0.55 * coarse)
    albedo = textures.mix(albedo, tuple(c * 0.45 for c in rock), cracks * 0.7)
    patches = smoothstep(0.55, 0.72, fbm(U * 3.0 + 2.0, V * 7.0 + 4.0, octaves=3, seed=seed + 33))
    albedo = textures.mix(albedo, coralline, patches * 0.7)
    boundary = tissue_from + 0.08 * (fbm(V * 6.0, np.full_like(V, 0.4), octaves=2, seed=seed + 34) - 0.5)
    tissue = smoothstep(boundary - 0.03, boundary + 0.05, U)
    mottle = fbm(U * 6.0, V * 10.0, octaves=3, seed=seed + 35)
    pores, gastro = _pores(U, V, pore_frequency, 2.6, seed + 36)
    tissue_rgba = textures.rgba(body, 1.0, U.shape)
    tissue_rgba = textures.mix(tissue_rgba, dark, smoothstep(0.35, 0.8, mottle) * 0.55)
    tissue_rgba = textures.mix(tissue_rgba, pore, pores * 0.8)
    albedo = albedo * (1.0 - tissue[..., None]) + tissue_rgba * tissue[..., None]
    albedo[..., 3] = 1.0
    grain = fbm(U * 40.0, V * 90.0, octaves=2, seed=seed + 37)
    height_field = np.clip(0.5 + (0.3 * (coarse - 0.5) - 0.3 * cracks) * (1.0 - tissue) + (0.04 * (mottle - 0.5) - 0.22 * pores) * tissue + 0.03 * (grain - 0.5), 0.0, 1.0)
    roughness = np.clip(0.9 - 0.1 * tissue - 0.12 * patches * (1.0 - tissue) + 0.06 * (grain - 0.5), 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, 1.4)}


def paint_hair(palette: dict, width: int, height: int, seed: int):
    U, V = textures.uv_grid(width, height)
    root = _rgb(palette, "hairRoot", (0.86, 0.78, 0.60))
    mid = _rgb(palette, "hair", (0.93, 0.92, 0.86))
    tip = _rgb(palette, "hairTip", (0.99, 0.98, 0.95))
    albedo = textures.rgba(root, 1.0, U.shape)
    albedo = textures.mix(albedo, mid, smoothstep(0.05, 0.40, U))
    albedo = textures.mix(albedo, tip, smoothstep(0.65, 0.97, U))
    grain = fbm(U * 8.0, V * 2.0, octaves=2, seed=seed + 41)
    albedo = textures.scale_rgb(albedo, 0.95 + 0.1 * grain)
    albedo[..., 3] = 1.0
    roughness = 0.36 + 0.06 * (grain - 0.5) - 0.08 * smoothstep(0.7, 1.0, U)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(0.5 + 0.03 * (grain - 0.5), 0.4)}


def write_set(prefix: str, texture_dir, stem: str, paint: dict, written: list):
    images = {}
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = texture_dir / f"{stem}-{key}.png"
        images[key] = textures.write_image(f"{prefix}_{stem}_{key}", path, paint[key], non_color)
        written.append(path)
    return images


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morph = spec["morphology"]
    form = morph.get("form", "blade")
    if form not in ("blade", "branching"):
        raise ValueError(f"Unknown Millepora form {form}")
    seed = int(morph.get("seed", 5))
    palette = spec["palette"]
    tex = spec.get("textures", {})
    hair_cfg = morph["hairs"]
    reach = float(hair_cfg["clearMargin"])

    # ---- skeleton solids (nominal metres)
    mound = Mound(morph["mound"][form], seed)
    mound.build()
    solids: list[Solid] = [mound]
    blades: list[Blade] = []
    branches: list[Branch] = []
    if form == "blade":
        blades = layout_blades(morph["blade"], seed)
        for blade in blades:
            blade.parent = mound
            blade.build()
            solids.append(blade)
    else:
        branches = layout_branching(morph["branching"], mound, seed)
        for branch in branches:
            branch.compute_exit()
            branch.build()
            solids.append(branch)
        gaps = check_layout(branches, float(morph["branching"]["minGap"]))
    for solid in solids[1:]:
        solid.attach = {index for index, v in enumerate(solid.geometry[0]) if solid.parent.inside(Vector(v), 0.0025)}

    # ---- hair placement (jittered grids per solid, area proportional density)
    total_area = sum(s.area for s in solids)
    density = float(hair_cfg["count"]) / max(total_area, 1e-9)
    spacing = math.sqrt(1.0 / density)
    clusters: dict[str, Cluster] = {}
    hairs_total = 0
    rejected = 0

    def other_solids(owner: Solid) -> list[Solid]:
        return [s for s in solids if s is not owner]

    def add_hair(cluster: Cluster, hair: Hair):
        nonlocal hairs_total
        cluster.hairs.append(hair)
        hairs_total += 1

    # mound sectors
    mound_sectors = int(morph["mound"][form].get("hairSectors", 4))
    rho_t = mound.tissue_rho() * 0.9
    for k in range(mound_sectors):
        theta_c = (k + 0.5) / mound_sectors * math.tau
        rc = 0.55 * rho_t * mound.R0
        cx, cy = rc * math.cos(theta_c), rc * math.sin(theta_c)
        head = Vector((cx, cy, mound.top(cx, cy) - float(hair_cfg["moundDepth"])))
        clusters[f"Md_{k}"] = Cluster(f"Md_{k}", head, UP.copy(), Vector((-math.sin(theta_c), math.cos(theta_c), 0.0)), "mound", mound.name,
                                      float(hair_cfg["moundDepth"]), (0.0, 1.0, 0.0))
    mound_count = int(round(mound.area * density))
    others = other_solids(mound)
    for k in range(mound_count):
        rho = rho_t * math.sqrt((k + 0.5) / mound_count)
        theta = k * GOLDEN + 0.4 * jit(seed, "mth", k)
        R = mound.outline(theta)
        x, y = rho * R * math.cos(theta), rho * R * math.sin(theta)
        z = mound.top(x, y)
        if z / mound.H < mound.tissue_from + 0.06:
            continue
        normal = mound.normal(x, y)
        hair = make_hair(Vector((x, y, z)), normal, hair_cfg, seed, ("mh", k), 0.0)
        if not hair_clear(hair, others, reach):
            rejected += 1
            continue
        sector = int(((theta % math.tau) / math.tau) * mound_sectors) % mound_sectors
        add_hair(clusters[f"Md_{sector}"], hair)

    # blade faces and edges
    for blade in blades:
        others = other_solids(blade)
        n_sec = blade.sections
        for sec in range(n_sec):
            s_c = -1.0 + 2.0 * (sec + 0.5) / n_sec
            mid_z = blade.z0 + 0.5 * blade.height(s_c)
            n_c = blade.normal_dir(s_c)
            centre = blade.axis(s_c) + UP * mid_z + n_c * (blade.lean * 0.5 * blade.height(s_c))
            for side, tag in ((1.0, "P"), (-1.0, "N")):
                bone = f"B{blade.index}{tag}{sec}"
                clusters[bone] = Cluster(bone, centre.copy(), n_c * side, blade.e_s.copy(), "face", blade.name,
                                         0.5 * blade.thickness(s_c, 0.5), (0.0, 1.0, 0.0))
            edge_depth = float(hair_cfg["edgeDepth"])
            top = blade.axis(s_c) + UP * (blade.z0 + blade.height(s_c) - edge_depth) + n_c * (blade.lean * blade.height(s_c))
            bone = f"B{blade.index}E{sec}"
            clusters[bone] = Cluster(bone, top, UP.copy(), blade.e_s.copy(), "edge", blade.name, edge_depth, (0.0, 1.0, 0.0))
        n_s = max(4, int(round(2.0 * blade.Lh * 0.93 / spacing)))
        edge_from = float(hair_cfg["edgeFrom"])
        for side, tag in ((1.0, "P"), (-1.0, "N")):
            for i in range(n_s):
                s = -0.93 + 1.86 * (i + 0.5 + 0.6 * jit(seed, "bs", blade.index, tag, i)) / n_s
                n_z = max(1, int(round(0.92 * blade.height(s) / spacing)))
                for j in range(n_z):
                    zf = 0.04 + 0.945 * (j + 0.5 + 0.6 * jit(seed, "bz", blade.index, tag, i, j)) / n_z
                    root = blade.surface(s, zf, side)
                    normal = blade.normal(s, zf, side)
                    hair = make_hair(root, normal, hair_cfg, seed, ("bh", blade.index, tag, i, j), float(hair_cfg["upBias"]))
                    if not hair_clear(hair, others, reach):
                        rejected += 1
                        continue
                    sec = min(n_sec - 1, int((s + 1.0) / 2.0 * n_sec))
                    bone = f"B{blade.index}E{sec}" if zf > edge_from else f"B{blade.index}{tag}{sec}"
                    add_hair(clusters[bone], hair)

    # branch tubes: one cluster per segment
    for branch in branches:
        others = other_solids(branch)
        s_lo = min(0.9, max(branch.s_exit, 0.05) + 0.05)
        s_hi = float(hair_cfg["tubeTop"])
        head = branch.point_at(0.5 * (s_lo + s_hi))
        axis = branch.tangent_at(0.5 * (s_lo + s_hi))
        branch.bone = f"Br_{len([c for c in clusters if c.startswith('Br_')]):02d}"
        n_side, _b = branch.frame_at(0.5)
        clusters[branch.bone] = Cluster(branch.bone, head, axis, n_side, "tube", branch.name,
                                        branch.radius_at(0.5 * (s_lo + s_hi)) * (0.5 + 0.5 * branch.aspect), (1.0, 0.0, 1.0))
        if s_hi <= s_lo:
            continue
        r_mean = branch.radius_at(0.5 * (s_lo + s_hi))
        n_a = max(3, int(round(2.0 * math.pi * r_mean * (0.5 + 0.5 * branch.aspect) / spacing)))
        n_s = max(1, int(round(branch.length * (s_hi - s_lo) / spacing)))
        for i in range(n_s):
            s = s_lo + (s_hi - s_lo) * (i + 0.5 + 0.6 * jit(seed, "ts", branch.name, i)) / n_s
            for j in range(n_a):
                a = math.tau * (j + 0.5 * (i % 2) + 0.6 * jit(seed, "ta", branch.name, i, j)) / n_a
                root = branch.surface(s, a)
                normal = branch.normal(s, a)
                hair = make_hair(root, normal, hair_cfg, seed, ("th", branch.name, i, j), 0.0)
                if not hair_clear(hair, others, reach):
                    rejected += 1
                    continue
                add_hair(clusters[branch.bone], hair)

    clusters = {name: cluster for name, cluster in clusters.items() if cluster.hairs}
    if len(clusters) + 1 > 32:
        raise RuntimeError(f"{len(clusters)} hair clusters exceed the deform bone budget")
    if hairs_total == 0:
        raise RuntimeError("No hairs could be placed")

    # ---- normalise the colony width (axis xy) to the reference size
    xs, ys, zs = [], [], []
    for solid in solids:
        xs.extend(v[0] for v in solid.geometry[0])
        ys.extend(v[1] for v in solid.geometry[0])
        zs.extend(v[2] for v in solid.geometry[0])
    for cluster in clusters.values():
        for hair in cluster.hairs:
            xs.extend((hair.root.x, hair.tip.x))
            ys.extend((hair.root.y, hair.tip.y))
            zs.extend((hair.root.z, hair.tip.z))
    if min(zs) < -1e-9:
        raise ValueError("Colony geometry dips below the base plane")
    shift = Vector(((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0, 0.0))
    nominal_width = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = float(spec["referenceSize"]["meters"]) / nominal_width

    def S(point) -> Vector:
        return (Vector(point) - shift) * scale

    # ---- textures and materials
    written: list = []
    sk_w, sk_h = tex.get("skeletonResolution", [1024, 512])
    ba_w, ba_h = tex.get("baseResolution", [512, 256])
    ha_w, ha_h = tex.get("hairResolution", [128, 32])
    pore_frequency = float(tex.get("poreFrequency", {}).get(form, 90.0))
    v_ratio = float(tex.get("poreVRatio", {}).get(form, 1.0))
    skeleton_images = write_set(prefix, ctx.texture_dir, "skeleton",
                                paint_skeleton(palette, int(sk_w), int(sk_h), seed, "branch" if form == "branching" else "blade",
                                               pore_frequency, v_ratio, float(tex.get("skeletonHeightStrength", 1.2))), written)
    base_images = write_set(prefix, ctx.texture_dir, "base", paint_base(palette, int(ba_w), int(ba_h), seed, mound.tissue_from, 40.0), written)
    hair_images = write_set(prefix, ctx.texture_dir, "hair", paint_hair(palette, int(ha_w), int(ha_h), seed), written)
    skeleton_mat = mat.principled(f"{prefix}_Skeleton", _rgb(palette, "body", (0.8, 0.62, 0.22)), 0.82, coat=0.0, subsurface=0.05, specular=0.3)
    mat.attach_textures(skeleton_mat, albedo=skeleton_images["albedo"], roughness=skeleton_images["roughness"], normal=skeleton_images["normal"],
                        normal_strength=float(tex.get("skeletonNormalStrength", 0.9)))
    base_mat = mat.principled(f"{prefix}_Base", _rgb(palette, "rock", (0.32, 0.29, 0.25)), 0.9, coat=0.0, subsurface=0.02, specular=0.25)
    mat.attach_textures(base_mat, albedo=base_images["albedo"], roughness=base_images["roughness"], normal=base_images["normal"],
                        normal_strength=float(tex.get("baseNormalStrength", 1.0)))
    hair_mat = mat.principled(f"{prefix}_Hair", _rgb(palette, "hair", (0.93, 0.92, 0.86)), 0.36, coat=0.0, subsurface=0.5, specular=0.4)
    mat.attach_textures(hair_mat, albedo=hair_images["albedo"], roughness=hair_images["roughness"], normal=hair_images["normal"], normal_strength=0.3)
    material_map = {"skeleton": skeleton_mat, "base": base_mat, "hair": hair_mat}

    # ---- rig: static Base plus one bone per hair cluster
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, -0.004), (0.0, 0.0, 0.0), deform=False)
    rb.bone("Base", (0.0, 0.0, 0.0), (0.0, 0.0, 0.012 * scale), "Root")
    for name in sorted(clusters):
        cluster = clusters[name]
        head = S(cluster.head)
        tail = head + cluster.axis * (0.009 * scale)
        roll = (1.0, 0.0, 0.0) if abs(cluster.axis.dot(UP)) > 0.9 else (0.0, 0.0, 1.0)
        rb.bone(name, tuple(head), tuple(tail), "Base", roll_up=roll)
    rig = rb.finish()

    # ---- skeleton object (all vertices rigid to Base)
    skeleton_parts = []
    for solid in solids:
        vertices, faces, uvs, face_uvs = solid.geometry
        geometry = ([tuple(S(v)) for v in vertices], faces, uvs, face_uvs)
        skeleton_parts.append(msh.make_part(solid.name, geometry, solid.material, lambda i, v: {"Base": 1.0}, closed=True,
                                            groups={f"attach_{solid.name}": set(solid.attach)} if solid.attach else {}))
    skeleton_obj = msh.assemble(f"{prefix}_Skeleton", skeleton_parts, material_map, rig, f"{prefix}_Armature", preserve_volume=False)
    skeleton_obj["lod"] = 1
    skeleton_obj["colonyWidthMeters"] = spec["referenceSize"]["meters"]

    # ---- hair object: one part per cluster, roots on Base, tips on the cluster bone
    hair_parts = []
    hair_extent = {}
    for name in sorted(clusters):
        cluster = clusters[name]
        pieces, weights = [], []
        points = []
        for k, hair in enumerate(cluster.hairs):
            scaled = Hair(S(hair.root), S(hair.tip), hair.r0 * scale, hair.gain, hair.length * scale)
            pieces.append(hair_geometry(scaled, hair_cfg, seed, (name, k)))
            weights.extend(hair_weights(scaled, name))
            points.append(hair.root)
            points.append(hair.tip)
        geometry = concat_geometry(pieces)
        hair_parts.append(msh.make_part(f"hairs_{name}", geometry, "hair", lambda i, v, w=weights: dict(w[i]), closed=True))
        hair_extent[name] = points
    hairs_obj = msh.assemble(f"{prefix}_Polyps", hair_parts, material_map, rig, f"{prefix}_Armature", preserve_volume=False)
    hairs_obj["lod"] = 1

    # ---- animation
    anim = spec["animation"]
    clips: list[ClipSpec] = []
    ordered = [clusters[name] for name in sorted(clusters)]
    mean_length = sum(h.length for c in ordered for h in c.hairs) / hairs_total * scale

    def in_plane(cluster: Cluster, direction: Vector, keep_normal: float) -> Vector:
        """Project a world direction onto the cluster's hair-root plane, keeping a fraction of the normal part."""
        normal_part = cluster.axis * direction.dot(cluster.axis)
        if cluster.kind == "tube":
            return direction
        return direction - normal_part * (1.0 - keep_normal)

    sway = anim["sway"]
    channels: list[Channel] = []
    frequency = int(sway.get("frequency", 1))
    for index, cluster in enumerate(ordered):
        ha, hb, hc, hd = (h01(seed, "sway", cluster.bone, k) for k in range(4))
        amplitude = float(sway["driftMeters"]) * (0.75 + 0.5 * hc) * scale
        if cluster.kind == "tube":
            drift = cluster.axis
            wobble = cluster.axis.cross(cluster.tangent).normalized()
        else:
            spin = Matrix.Rotation(math.tau * ha, 3, cluster.axis)
            drift = (spin @ cluster.tangent).normalized()
            wobble = cluster.axis.cross(drift).normalized()
        channels.append(Channel(cluster.bone, "location", _local_axis(rig, cluster.bone, drift), amplitude, frequency, math.tau * hb))
        channels.append(Channel(cluster.bone, "location", _local_axis(rig, cluster.bone, wobble), amplitude * float(sway.get("wobbleFraction", 0.4)),
                                frequency + int(sway.get("wobbleFrequencyOffset", 1)), math.tau * hc + 0.9))
        channels.append(Channel(cluster.bone, "rotation", (0.0, 1.0, 0.0), float(sway.get("twistDegrees", 1.5)) * (0.7 + 0.6 * hd), frequency, math.tau * hd))
    clips.append(ClipSpec("sway", int(sway["frames"]), True, _key_every_kind(channels, None)))

    flow = anim["flow"]
    channels = []
    frequency = int(flow.get("frequency", 2))
    wave_number = float(flow.get("waveNumber", 30.0))
    flutter_frequency = int(flow.get("flutterFrequency", 3))
    for cluster in ordered:
        ha, hb = (h01(seed, "flow", cluster.bone, k) for k in range(2))
        push = in_plane(cluster, FLOW, float(flow.get("keepNormal", 0.35)))
        magnitude = push.length
        if magnitude < 0.05:
            push, magnitude = cluster.tangent, 0.4
        push = push.normalized()
        flutter = cluster.axis.cross(push).normalized() if cluster.kind != "tube" else cluster.axis
        head_x = rig.data.bones[cluster.bone].head_local.x
        phase = -wave_number * head_x + 0.6 * (ha - 0.5)
        channels.append(Channel(cluster.bone, "location", _local_axis(rig, cluster.bone, push), float(flow["driftMeters"]) * magnitude * scale * (0.85 + 0.3 * hb),
                                frequency, phase, bias=float(flow.get("leanMeters", 0.0)) * magnitude * scale))
        channels.append(Channel(cluster.bone, "location", _local_axis(rig, cluster.bone, flutter), float(flow.get("flutterMeters", 0.0003)) * scale,
                                flutter_frequency, math.tau * ha))
        channels.append(Channel(cluster.bone, "rotation", (0.0, 1.0, 0.0), float(flow.get("twistDegrees", 1.0)), flutter_frequency, math.tau * hb))
    clips.append(ClipSpec("flow", int(flow["frames"]), True, _key_every_kind(channels, None)))

    retract = anim["retract"]
    envelope = retract.get("envelope", "hold")
    residual = float(retract.get("residualFraction", 0.15))
    channels = []
    for cluster in ordered:
        depth = cluster.depth * scale
        length = sum(h.length for h in cluster.hairs) / len(cluster.hairs) * scale
        s_ret = (depth + residual * length) / (depth + length)
        channels.append(Channel(cluster.bone, "scale", cluster.retract_axis, -(1.0 - s_ret), 1.0, 0.0, "const", envelope=envelope))
    clips.append(ClipSpec("retract", int(retract["frames"]), False, _key_every_kind(channels, envelope)))

    mesh_objects = {obj.name: obj for obj in (skeleton_obj, hairs_obj)}
    for clip in clips:
        bake_clip(rig, clip, mesh_objects=mesh_objects)

    # ---- contract
    meshes = [skeleton_obj, hairs_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="xy",
                             sample_stride=int(spec.get("validation", {}).get("sampleStride", 3)))
    for solid in solids:
        contract["closedParts"].append({"object": skeleton_obj.name, "group": f"part_{solid.name}", "volumeFloor": 0.9})

    def cloud_gap(points: list[Vector], solid: Solid) -> float:
        """Coarse minimum distance from a point cloud to a solid (probe margins)."""
        for margin in (0.002, 0.005, 0.008, 0.012):
            if any(solid.inside(p, margin) for p in points):
                return margin
        return 1.0

    near = float(hair_cfg.get("nearMeters", 0.012))
    by_name = {s.name: s for s in solids}
    for i, a in enumerate(solids):
        for b in solids[i + 1:]:
            if b.parent is a:
                entry_a = [skeleton_obj.name, f"part_{a.name}"]
                entry_b = [skeleton_obj.name, f"part_{b.name}", f"attach_{b.name}"]
            elif a.parent is b:
                entry_a = [skeleton_obj.name, f"part_{a.name}", f"attach_{a.name}"]
                entry_b = [skeleton_obj.name, f"part_{b.name}"]
            elif b.name in a.siblings:
                continue  # dichotomous forks fuse at the knuckle by design
            else:
                if cloud_gap(b.sample_points(), a) > near:
                    continue
                entry_a = [skeleton_obj.name, f"part_{a.name}"] + ([f"attach_{a.name}"] if a.attach else [])
                entry_b = [skeleton_obj.name, f"part_{b.name}"] + ([f"attach_{b.name}"] if b.attach else [])
            contract["clearance"].append({"a": entry_a, "b": entry_b, "label": f"skeleton_{a.name}_vs_{b.name}"})
    for name in sorted(clusters):
        cluster = clusters[name]
        for solid in solids:
            if solid.name == cluster.owner or cloud_gap(hair_extent[name], solid) > near:
                continue
            contract["clearance"].append({"a": [hairs_obj.name, f"part_hairs_{name}"], "b": [skeleton_obj.name, f"part_{solid.name}"],
                                          "label": f"hairs_{name}_vs_{solid.name}"})
    register_clips(contract, clips)

    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    notes = {
        "form": form, "seed": seed, "nominalWidthMeters": nominal_width, "colonyScale": scale,
        "skeletonParts": [s.name for s in solids], "hairs": hairs_total, "hairsRejected": rejected,
        "clusters": {name: len(c.hairs) for name, c in clusters.items()}, "deformBones": len(rb.deform_names),
        "meanHairLengthMeters": round(mean_length, 6), "triangles": triangles, "clearancePairs": len(contract["clearance"]),
    }
    if branches:
        notes["branchExits"] = {b.name: round(b.s_exit, 3) for b in branches}
        notes["minBranchGapMeters"] = round(min(gaps.values()), 5) if gaps else None
    print(f"[millepora] form={form} triangles={triangles} hairs={hairs_total} rejected={rejected} bones={len(rb.deform_names)} pairs={len(contract['clearance'])}")
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec.get("preview", {}).get("action", spec["clipRoles"]["locomotion"]), textures=written, notes=notes)
