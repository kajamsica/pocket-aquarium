"""Montipora sp. (Acroporidae, small-polyp stony coral): species-local `montipora_colony` body plan.

Genus-level asset (trade names cover many Montipora species) with three morphology variants selected by
`morphology.form`; every variant is a distinct geometry, not a recolour:

- `encrusting`: a low sheet hugging a small rock. The sheet is one closed polar loft whose underside follows
  the rock's top (embedded a little), whose top carries dart-thrown tuberculae (bumps 7 to 11 mm across,
  0.7 to 1.3 mm high), fine relief and a thin growing margin; a short rocky ledge shows on one side.
- `plating` (M. capricornis habit): thin whorling plate scrolling upward around a central column like a vase
  or cabbage. The plate is a single closed loft of thin cross-section rings (top surface, rounded margin,
  bare underside) following a 2.6-turn helix whose width grows outward as it rises; the margin ripples.
  The upper surface is tissue, the underside bare skeleton with costae.
- `digitata` (M. digitata habit): spreading tissue-covered mound on a rock with six upright blunt fingers,
  three of them forked, grown along seeded phototropic paths with hemispherical tips.

USER RULE FOR STONY CORALS: the skeleton never moves. Every skeleton vertex (rock, sheet, plate, column,
mound, fingers) is weighted 1.0 to the `Base` bone which has no animation channel in any clip. Only the
polyps move.

Polyps: Montipora corallites are tiny (0.5 to 1.5 mm) and immersed; at LOD1 each polyp is a small closed
six-sided tube (embedded base ring, flared crown ring, narrow tip, two caps) 1.8 to 2.6 mm long, placed by
deterministic dart throwing on the tissue surfaces. Positions and axes are sampled on the actual mesh
facets (bilinear on the loft rings) so every polyp base sits inside its surface. Polyps are grouped into
at most 30 cluster bones (<= 32 deform bones). Cluster bones are only ever translated: the polyp base ring
stays with `Base`, the crown and tip rings blend to the cluster bone(s), so a bone translation leans or
shortens every polyp of the cluster along its own length without sliding it over the skeleton. Per polyp
weights vary deterministically (tip weight 0.65 to 1.0) so a cluster never moves as a block. For the
finger form each finger owns five direction bones (axis plus four sector directions across the finger) and
every polyp splits its weight between the two or three bones nearest to its own axis; translating each bone
along its direction therefore pulls each polyp along its own axis.
- `sway` (idle, loop): small horizontal drift per cluster plus a slower breathe along the polyp axis.
- `flow` (locomotion, loop): downstream (+X) lean with a travelling pulse across the colony and lateral flutter.
- `retract` (response, hold envelope): every cluster bone translates along minus its retract direction by the
  pull distance, so tips sink to about 0.3 mm above the corallite, then re-extend.

Textures are procedural numpy paint (no imagery): tissue with papillae bumps, painted corallite pits (real
corallite density is far higher than the modelled polyp count), contrasting growth margins or finger tips,
bare skeleton with costae and coralline patches, dark rock, and a polyp atlas grading stalk to crown.
Everything derives from asset.source.json and fixed seeds (noise.scalar_hash); no random, no time.
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
SIDE = Vector((0.0, 1.0, 0.0))
POLYP_SEGMENTS = 6


# ---------------------------------------------------------------- deterministic helpers

def _h(*values, seed: int) -> float:
    return scalar_hash(*values, seed=seed)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _sstep(value: float) -> float:
    value = _clamp(value)
    return value * value * (3.0 - 2.0 * value)


def _perp_frame(direction: Vector, spin: float = 0.0):
    d = direction.normalized()
    ref = UP if abs(d.dot(UP)) < 0.9 else FLOW
    e1 = (ref - d * ref.dot(d)).normalized()
    e2 = d.cross(e1).normalized()
    if spin:
        c, s = math.cos(spin), math.sin(spin)
        e1, e2 = e1 * c + e2 * s, e2 * c - e1 * s
    return e1, e2


def _rgb(palette: dict, key: str, default):
    return tuple(float(v) for v in palette.get(key, default))


def _lighter(color, amount: float = 0.35):
    return tuple(min(1.0, c * (1.0 + amount) + 0.04) for c in color)


def _darker(color, amount: float = 0.5):
    return tuple(c * (1.0 - amount) for c in color)


class Outline:
    """Deterministic harmonic outline factor around a centre."""

    def __init__(self, cfg: dict, seed: int):
        orders = cfg.get("orders", [2, 3, 5])
        amplitudes = cfg.get("amplitudes", [0.06, 0.04, 0.02])
        self.terms = [(int(o), float(a), _h(k, 11, seed=seed) * math.tau) for k, (o, a) in enumerate(zip(orders, amplitudes))]

    def factor(self, theta):
        theta = np.asarray(theta, dtype=np.float64)
        out = np.ones_like(theta)
        for order, amplitude, phase in self.terms:
            out = out + amplitude * np.sin(order * theta + phase)
        return out


# ---------------------------------------------------------------- geometry helpers

def _close_loft(geometry, segments: int, ring_count: int, u_values):
    """Close an open loft with centre-fan caps wound consistently with its side quads.

    The shared `meshing.loft` / `meshing.ellipsoid` caps are wound against the side faces (they read as
    dark discs and invert under `ensure_outward`), so this species closes every loft locally. Vertex
    order matches the shared helper: start centre first, end centre second.
    """
    vertices, faces, uvs, face_uvs = geometry
    vertices = list(vertices)
    faces = list(faces)
    uvs = list(uvs)
    face_uvs = list(face_uvs) if face_uvs is not None else None

    def add_cap(ring: int, reverse: bool):
        base = ring * segments
        centre = tuple(sum(vertices[base + s][i] for s in range(segments)) / segments for i in range(3))
        centre_index = len(vertices)
        vertices.append(centre)
        uvs.append((u_values[ring], 0.5))
        for s in range(segments):
            nxt = (s + 1) % segments
            if reverse:
                faces.append((centre_index, base + nxt, base + s))
                if face_uvs is not None:
                    face_uvs.append(((u_values[ring], 0.5), (u_values[ring], (s + 1) / segments), (u_values[ring], s / segments)))
            else:
                faces.append((centre_index, base + s, base + nxt))
                if face_uvs is not None:
                    face_uvs.append(((u_values[ring], 0.5), (u_values[ring], s / segments), (u_values[ring], (s + 1) / segments)))

    add_cap(0, reverse=False)
    add_cap(ring_count - 1, reverse=True)
    return vertices, faces, uvs, face_uvs


def _rings_geometry(rings, u_values=None):
    count = len(rings)
    u_values = u_values or [k / max(count - 1, 1) for k in range(count)]
    geometry = msh.loft([[tuple(p) for p in ring] for ring in rings], u_values=u_values, cap_start=False, cap_end=False)
    return _close_loft(geometry, len(rings[0]), count, u_values)


def _tube_rings(points, radii, segments: int, up_hint=(0.0, 0.0, 1.0)):
    frames = msh.frames_along([tuple(p) for p in points], up_hint)
    rings = []
    for (point, radius), (_tangent, normal, binormal) in zip(zip(points, radii), frames):
        ring = []
        for s in range(segments):
            a = s / segments * math.tau
            ring.append(Vector(point) + normal * (math.cos(a) * radius) + binormal * (math.sin(a) * radius))
        rings.append(ring)
    return rings


def _bilinear_surface(rings, ring_f: float, seg_f: float, wrap: bool, orient: Vector):
    """Point and outward normal on the quad mesh spanned by `rings` (lists of Vectors)."""
    n = len(rings)
    seg = len(rings[0])
    ring_f = _clamp(ring_f, 0.0, n - 1 - 1e-6)
    j = int(ring_f)
    fj = ring_f - j
    if wrap:
        seg_f = seg_f % seg
        s = int(seg_f)
        fs = seg_f - s
        s1 = (s + 1) % seg
    else:
        seg_f = _clamp(seg_f, 0.0, seg - 1 - 1e-6)
        s = int(seg_f)
        fs = seg_f - s
        s1 = s + 1
    p00, p01, p10, p11 = rings[j][s], rings[j][s1], rings[j + 1][s], rings[j + 1][s1]
    point = p00 * ((1 - fj) * (1 - fs)) + p01 * ((1 - fj) * fs) + p10 * (fj * (1 - fs)) + p11 * (fj * fs)
    normal = (p11 - p00).cross(p01 - p10)
    if normal.length < 1e-16:
        normal = orient.copy()
    normal.normalize()
    if normal.dot(orient) < 0.0:
        normal = -normal
    return point, normal


def _planar_face_uvs(vertices, faces, half: float):
    def planar(v):
        return (0.5 + v[0] / (2.0 * half), 0.5 + v[1] / (2.0 * half))
    return [tuple(planar(vertices[i]) for i in face) for face in faces]


def _planar(geometry, half: float):
    vertices, faces, uvs, _face_uvs = geometry
    return vertices, faces, uvs, _planar_face_uvs(vertices, faces, half)


def _xy_half(*geometries) -> float:
    extent = 0.0
    for geometry in geometries:
        for v in geometry[0]:
            extent = max(extent, abs(v[0]), abs(v[1]))
    return extent * 1.04


def _segment_distance(p1: Vector, q1: Vector, p2: Vector, q2: Vector) -> float:
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1.dot(d1), d2.dot(d2), d2.dot(r)
    if a < 1e-14 and e < 1e-14:
        return r.length
    if a < 1e-14:
        s, t = 0.0, _clamp(f / e)
    else:
        c = d1.dot(r)
        if e < 1e-14:
            s, t = _clamp(-c / a), 0.0
        else:
            b = d1.dot(d2)
            denominator = a * e - b * b
            s = _clamp((b * f - c * e) / denominator) if denominator > 1e-14 else 0.0
            t = (b * s + f) / e
            if t < 0.0:
                t, s = 0.0, _clamp(-c / a)
            elif t > 1.0:
                t, s = 1.0, _clamp((b - c) / a)
    return ((p1 + d1 * s) - (p2 + d2 * t)).length


def _polyline_distance(point: Vector, points: list, radii: list):
    """Distance from a point to a radius-interpolated polyline axis: (distance, radius_there)."""
    best, best_r = 1e9, 0.0
    for a, b, ra, rb in zip(points, points[1:], radii, radii[1:]):
        ab = b - a
        t = _clamp((point - a).dot(ab) / max(ab.length_squared, 1e-14))
        d = (point - (a + ab * t)).length
        if d < best:
            best, best_r = d, ra + (rb - ra) * t
    return best, best_r


# ---------------------------------------------------------------- layout data

@dataclass
class Solid:
    name: str
    geometry: tuple
    material: str
    face_materials: list | None = None
    uv_transform: object = None
    groups: dict = field(default_factory=dict)
    volume_floor: float = 0.9


@dataclass
class ClusterBone:
    name: str
    head: Vector
    direction: Vector


@dataclass
class Polyp:
    position: Vector
    normal: Vector
    length: float
    radius: float
    spin: float
    bones: list            # [(bone name, fraction)] fractions sum to 1
    basis_sum: float       # sum of raw axis coefficients (1 for single-bone clusters)
    cluster: int           # clearance cluster index
    w_tip: float = 1.0


@dataclass
class Layout:
    form: str
    solids: list
    polyps: list
    bones: list
    pairs: list                      # (group_a, exclude_a, group_b, exclude_b, label) on the skeleton object
    pull_factor: float
    tissue_paint: dict
    base_paint: dict | None
    notes: dict
    marks: list = field(default_factory=list)   # polyp (x, y) for planar corallite painting
    half: float = 0.08


def _polyp_defaults(cfg: dict):
    return {
        "length": [float(v) for v in cfg.get("length", [0.0018, 0.0026])],
        "radius": [float(v) for v in cfg.get("radius", [0.00042, 0.00055])],
        "embed": float(cfg.get("embed", 0.0004)),
        "crownFraction": float(cfg.get("crownFraction", 0.72)),
        "crownRadiusFactor": float(cfg.get("crownRadiusFactor", 1.5)),
        "crownRetractFactor": float(cfg.get("crownRetractFactor", 0.85)),
        "leanDegrees": float(cfg.get("leanDegrees", 6.0)),
        "spacing": float(cfg.get("spacing", 0.003)),
        "attempts": int(cfg.get("attempts", 9000)),
    }


def _new_polyp(position: Vector, normal: Vector, pcfg: dict, seed: int, key) -> Polyp:
    length = _lerp(pcfg["length"][0], pcfg["length"][1], _h(*key, 31, seed=seed))
    radius = _lerp(pcfg["radius"][0], pcfg["radius"][1], _h(*key, 32, seed=seed))
    # tiny lean off the surface normal so a field of polyps never reads as a comb
    e1, e2 = _perp_frame(normal)
    lean = math.radians(pcfg["leanDegrees"]) * (_h(*key, 33, seed=seed) - 0.5) * 2.0
    lean_dir = _h(*key, 34, seed=seed) * math.tau
    axis = (normal + (e1 * math.cos(lean_dir) + e2 * math.sin(lean_dir)) * math.tan(lean)).normalized()
    return Polyp(position=position, normal=axis, length=length, radius=radius, spin=_h(*key, 35, seed=seed) * math.tau,
                 bones=[], basis_sum=1.0, cluster=0)


def _too_close(position: Vector, placed: list, spacing: float) -> bool:
    for other in placed:
        if (other.position - position).length < spacing:
            return True
    return False


def _single_bone_clusters(polyps: list, count: int, default_direction: Vector, name_prefix: str = "Pol"):
    """One translated bone per spatial cluster: head at the cluster centroid, direction = mean polyp axis."""
    bones = []
    kept = 0
    for c in range(count):
        group = [p for p in polyps if p.cluster == c]
        if not group:
            continue
        name = f"{name_prefix}_{kept:02d}"
        head = Vector((0.0, 0.0, 0.0))
        direction = Vector((0.0, 0.0, 0.0))
        for p in group:
            head += p.position
            direction += p.normal
        head /= len(group)
        direction = direction.normalized() if direction.length > 1e-6 else default_direction
        for p in group:
            p.bones = [(name, 1.0)]
            p.basis_sum = 1.0
            p.cluster = -(kept + 1)  # temporary negative tag so re-indexing never collides
        bones.append(ClusterBone(name, head, direction))
        kept += 1
    for p in polyps:
        p.cluster = -p.cluster - 1
    return bones, polyps


# ---------------------------------------------------------------- encrusting form

class EncrustingColony:
    def __init__(self, P: dict, seed: int):
        self.seed = seed
        self.outline = Outline(P.get("outline", {}), seed + 1)
        self.R0 = float(P.get("sheetRadius", 0.070))
        rock = P.get("rock", {})
        self.ledge = [float(v) for v in rock.get("ledge", [-0.003, 0.009])]
        self.ledge_phase = _h(3, seed=seed) * math.tau
        self.rock_height = float(rock.get("height", 0.013))
        self.rock_edge_height = float(rock.get("edgeHeight", 0.006))
        self.rock_lumps = float(rock.get("lumpAmplitude", 0.0012))
        sheet = P.get("sheet", {})
        self.center_thickness = float(sheet.get("centerThickness", 0.004))
        self.edge_thickness = float(sheet.get("edgeThickness", 0.0015))
        self.embed = float(sheet.get("embed", 0.0015))
        self.relief = float(sheet.get("fineRelief", 0.00025))
        sampling = P.get("sampling", {})
        self.segments = int(sampling.get("segments", 128))
        self.top_rings = int(sampling.get("topRings", 28))
        self.rim_rings = int(sampling.get("rimRings", 2))
        self.bottom_rings = int(sampling.get("bottomRings", 3))
        self.tubercles = self._place_tubercles(P.get("tubercles", {}))
        self.top_ring_vectors: list = []

    # outlines
    def sheet_radius(self, theta):
        return self.R0 * self.outline.factor(theta)

    def ledge_width(self, theta):
        theta = np.asarray(theta, dtype=np.float64)
        w = 0.5 + 0.4 * np.sin(theta + self.ledge_phase) + 0.1 * np.sin(3.0 * theta + 1.7 + self.ledge_phase)
        w = np.clip(w, 0.0, 1.0)
        return self.ledge[0] + (self.ledge[1] - self.ledge[0]) * w

    def rock_radius(self, theta):
        return self.sheet_radius(theta) + self.ledge_width(theta)

    def polar(self, x, y):
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        return np.hypot(x, y), np.arctan2(y, x)

    # heights
    def rock_top_z(self, x, y):
        r, theta = self.polar(x, y)
        rf = np.clip(r / self.rock_radius(theta), 0.0, 1.0)
        dome = self.rock_edge_height + (self.rock_height - self.rock_edge_height) * (1.0 - rf ** 2) ** 0.9
        lumps = (fbm(np.asarray(x) * 28.0 + 4.1, np.asarray(y) * 28.0 + 8.3, octaves=3, seed=self.seed + 41) - 0.5) * 2.0 * self.rock_lumps
        return dome + lumps

    def sheet_bottom_z(self, x, y):
        return self.rock_top_z(x, y) - self.embed

    def thickness(self, rf):
        return self.center_thickness - (self.center_thickness - self.edge_thickness) * np.clip(rf, 0.0, 1.0) ** 1.3

    def tubercle_field(self, x, y):
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        out = np.zeros(np.broadcast(x, y).shape, dtype=np.float64)
        for tx, ty, radius, height in self.tubercles:
            d = np.hypot(x - tx, y - ty)
            out = out + height * (1.0 - smoothstep(0.15 * radius, radius, d)) ** 1.2
        return out

    def fine_relief(self, x, y):
        n = fbm(np.asarray(x) * 220.0 + 1.3, np.asarray(y) * 220.0 + 6.1, octaves=3, seed=self.seed + 42)
        return (n - 0.5) * 2.0 * self.relief

    def sheet_top_z(self, x, y):
        r, theta = self.polar(x, y)
        rf = r / self.sheet_radius(theta)
        return self.sheet_bottom_z(x, y) + self.thickness(rf) + self.tubercle_field(x, y) + self.fine_relief(x, y)

    def top_ring_rf(self, j: int) -> float:
        return ((j + 0.35) / (self.top_rings - 1 + 0.35)) ** 0.85

    def mesh_top(self, rf: float, theta: float):
        ring_f = (rf ** (1.0 / 0.85)) * (self.top_rings - 1 + 0.35) - 0.35
        seg_f = ((theta % math.tau) / math.tau) * self.segments
        return _bilinear_surface(self.top_ring_vectors, ring_f, seg_f, True, UP)

    def _place_tubercles(self, cfg: dict):
        count = int(cfg.get("count", 70))
        r_min, r_max = (float(v) for v in cfg.get("radius", [0.0035, 0.0055]))
        h_min, h_max = (float(v) for v in cfg.get("height", [0.0007, 0.0013]))
        max_rf = float(cfg.get("maxRadiusFraction", 0.88))
        placed = []
        attempt = 0
        while len(placed) < count and attempt < 4000:
            attempt += 1
            rf = max_rf * math.sqrt(_h(attempt, 1, seed=self.seed + 5))
            theta = _h(attempt, 2, seed=self.seed + 5) * math.tau
            R = float(self.sheet_radius(np.array([theta]))[0])
            x, y = rf * R * math.cos(theta), rf * R * math.sin(theta)
            radius = _lerp(r_min, r_max, _h(attempt, 3, seed=self.seed + 5))
            if any(math.hypot(x - tx, y - ty) < 0.95 * (radius + tr) for tx, ty, tr, _th in placed):
                continue
            placed.append((x, y, radius, _lerp(h_min, h_max, _h(attempt, 4, seed=self.seed + 5))))
        return placed

    def build_solids(self):
        seg = self.segments
        thetas = np.arange(seg) / seg * math.tau
        cos_t, sin_t = np.cos(thetas), np.sin(thetas)
        # ---- rock: side rings then top rings inward
        Rr = self.rock_radius(thetas)
        z_edge = self.rock_top_z(Rr * cos_t, Rr * sin_t)
        rings = []
        for t, factor in ((0.0, 1.0), (0.45, 1.05), (1.0, 1.0)):
            radius = Rr * factor * (1.0 + 0.03 * np.sin(5.0 * thetas + 1.1) * (1.0 - t))
            z = np.zeros_like(thetas) if t == 0.0 else z_edge * t
            rings.append([(float(a), float(b), float(c)) for a, b, c in zip(radius * cos_t, radius * sin_t, z)])
        for rf in (0.8, 0.55, 0.3, 0.12):
            x = rf * Rr * cos_t
            y = rf * Rr * sin_t
            rings.append([(float(a), float(b), float(c)) for a, b, c in zip(x, y, self.rock_top_z(x, y))])
        rock_geometry = _rings_geometry(rings)
        # ---- sheet: top rings centre outward, rim rings, bottom rings inward
        Rs = self.sheet_radius(thetas)
        rings = []
        n_top, n_rim, n_bot = self.top_rings, self.rim_rings, self.bottom_rings
        for j in range(n_top):
            rf = self.top_ring_rf(j)
            x = rf * Rs * cos_t
            y = rf * Rs * sin_t
            z = self.sheet_top_z(x, y)
            rings.append([(float(a), float(b), float(c)) for a, b, c in zip(x, y, z)])
        self.top_ring_vectors = [[Vector(p) for p in ring] for ring in rings]
        edge_top = self.sheet_top_z(Rs * cos_t, Rs * sin_t)
        edge_bot = self.sheet_bottom_z(Rs * cos_t, Rs * sin_t)
        for j in range(n_rim):
            t = (j + 1) / (n_rim + 1)
            f = 1.0 + 0.012 * math.sin(math.pi * t)
            rings.append([(float(a), float(b), float(c)) for a, b, c in zip(f * Rs * cos_t, f * Rs * sin_t, edge_top * (1.0 - t) + edge_bot * t)])
        for j in range(n_bot):
            rf = (n_bot - j) / (n_bot + 1)
            x = rf * Rs * cos_t
            y = rf * Rs * sin_t
            rings.append([(float(a), float(b), float(c)) for a, b, c in zip(x, y, self.sheet_bottom_z(x, y))])
        n_rings = len(rings)
        sheet_geometry = _rings_geometry(rings)
        tissue_rings = n_top + n_rim
        face_materials = []
        for f_index in range(len(sheet_geometry[1])):
            if f_index < (n_rings - 1) * seg:
                ring_index = f_index // seg
                face_materials.append("tissue" if ring_index + 1 <= tissue_rings - 1 else "skeleton")
            elif f_index < (n_rings - 1) * seg + seg:
                face_materials.append("tissue")
            else:
                face_materials.append("skeleton")
        return rock_geometry, sheet_geometry, face_materials


def _polar_cluster(rf: float, theta: float, cfg: dict) -> int:
    bands = [float(v) for v in cfg.get("bands", [0.3, 0.55, 0.78, 1.01])]
    sectors = [int(v) for v in cfg.get("sectors", [3, 6, 8, 11])]
    index = 0
    for band_edge, sector_count in zip(bands, sectors):
        if rf < band_edge:
            return index + int(((theta % math.tau) / math.tau) * sector_count) % sector_count
        index += sector_count
    return index - 1


def layout_encrusting(spec: dict, P: dict, pcfg: dict, seed: int) -> Layout:
    colony = EncrustingColony(P, seed)
    rock_geometry, sheet_geometry, sheet_materials = colony.build_solids()
    half = _xy_half(rock_geometry, sheet_geometry)
    sheet_geometry = _planar(sheet_geometry, half)
    rock_geometry = _planar(rock_geometry, half)
    solids = [
        Solid("rock", rock_geometry, "rock", groups={"skeleton_all": set(range(len(rock_geometry[0])))}),
        Solid("sheet", sheet_geometry, "tissue", face_materials=sheet_materials, groups={"skeleton_all": set(range(len(sheet_geometry[0])))}, volume_floor=0.8),
    ]
    poly_cfg = P.get("polyps", {})
    count = int(poly_cfg.get("count", 220))
    max_rf = float(poly_cfg.get("maxRadiusFraction", 0.9))
    cluster_cfg = P.get("clusters", {})
    cluster_count = sum(int(v) for v in cluster_cfg.get("sectors", [3, 6, 8, 11]))
    polyps: list[Polyp] = []
    attempt = 0
    while len(polyps) < count and attempt < pcfg["attempts"]:
        attempt += 1
        rf = max_rf * math.sqrt(_h(attempt, 1, seed=seed + 7))
        theta = _h(attempt, 2, seed=seed + 7) * math.tau
        position, normal = colony.mesh_top(rf, theta)
        # polyps keep to the flatter tissue (slope <= 17 degrees): the cluster retract direction is the mean
        # normal, so a steep flank would slide a retracting polyp sideways into the neighbouring tubercle
        if normal.z < 0.955 or _too_close(position, polyps, pcfg["spacing"]):
            continue
        polyp = _new_polyp(position, normal, pcfg, seed + 7, (attempt,))
        polyp.cluster = _polar_cluster(rf, theta, cluster_cfg)
        polyps.append(polyp)
    bones, polyps = _single_bone_clusters(polyps, cluster_count, UP)
    return Layout(form="encrusting", solids=solids, polyps=polyps, bones=bones, pairs=[], pull_factor=float(P.get("pullFactor", 1.0)),
                  tissue_paint={"kind": "planar", "colony": colony, "margin": True}, base_paint=None,
                  notes={"tubercles": len(colony.tubercles), "sheetRadiusMeters": colony.R0, "polypAttempts": attempt},
                  marks=[(p.position.x, p.position.y) for p in polyps], half=half)


# ---------------------------------------------------------------- plating form (M. capricornis habit)

class PlatingColony:
    def __init__(self, P: dict, seed: int):
        self.seed = seed
        self.turns = float(P.get("turns", 2.6))
        self.rings_per_turn = int(P.get("ringsPerTurn", 48))
        self.pitch = float(P.get("pitch", 0.014))
        self.z0 = float(P.get("z0", 0.016))
        self.r_in = float(P.get("innerRadius", 0.0035))
        self.r_out = [float(v) for v in P.get("outerRadius", [0.018, 0.074])]
        self.r_out_exponent = float(P.get("outerRadiusExponent", 0.85))
        self.flare = [math.radians(float(v)) for v in P.get("flareDegrees", [20.0, 26.0])]
        self.cup = float(P.get("cup", 0.10))
        ripple = P.get("ripple", {})
        self.ripple_amplitude = float(ripple.get("amplitude", 0.002))
        self.ripple_order = int(ripple.get("order", 9))
        self.ripple_low = float(ripple.get("lowAmplitude", 0.0018))
        self.ripple_phase = _h(1, seed=seed + 3) * math.tau
        self.ripple_phase2 = _h(2, seed=seed + 3) * math.tau
        self.width_wobble = float(P.get("widthWobble", 0.05))
        self.thickness = [float(v) for v in P.get("thickness", [0.0032, 0.0016])]
        self.top_points = int(P.get("topPoints", 11))
        self.bottom_points = int(P.get("bottomPoints", 9))
        self.end_taper = float(P.get("endTaper", 0.10))
        self.end_width = float(P.get("endWidthFraction", 0.25))
        self.theta0 = _h(4, seed=seed + 3) * math.tau
        self.top_ring_vectors: list = []

    def theta(self, t: float) -> float:
        return self.theta0 + t * self.turns * math.tau

    def width(self, t: float) -> float:
        theta = self.theta(t)
        r_out = self.r_out[0] + (self.r_out[1] - self.r_out[0]) * t ** self.r_out_exponent
        r_out *= 1.0 + self.width_wobble * math.sin(5.0 * theta + self.ripple_phase2)
        taper = 1.0
        if t < self.end_taper:
            taper = _lerp(self.end_width, 1.0, _sstep(t / self.end_taper))
        elif t > 1.0 - self.end_taper:
            taper = _lerp(1.0, self.end_width, _sstep((t - (1.0 - self.end_taper)) / self.end_taper))
        return (r_out - self.r_in) * taper

    def z_in(self, t: float) -> float:
        return self.z0 + self.pitch * self.turns * t

    def top_point(self, t: float, u: float) -> Vector:
        theta = self.theta(t)
        rho = Vector((math.cos(theta), math.sin(theta), 0.0))
        W = self.width(t)
        d = u * W
        flare = math.tan(_lerp(self.flare[0], self.flare[1], t))
        ripple = self.ripple_amplitude * math.sin(self.ripple_order * theta + self.ripple_phase) + self.ripple_low * math.sin(3.0 * theta + self.ripple_phase2)
        z = self.z_in(t) + d * flare + self.cup * W * u * u + ripple * u ** 1.5
        return rho * (self.r_in + d) + Vector((0.0, 0.0, z))

    def top_normal(self, t: float, u: float) -> Vector:
        dt, du = 0.002, 0.02
        p_t = self.top_point(min(t + dt, 1.0), u) - self.top_point(max(t - dt, 0.0), u)
        p_u = self.top_point(t, min(u + du, 1.0)) - self.top_point(t, max(u - du, 0.0))
        n = p_u.cross(p_t)
        if n.length < 1e-12:
            return UP.copy()
        n.normalize()
        return n if n.z >= 0.0 else -n

    def cross_section(self, t: float):
        top = [self.top_point(t, k / (self.top_points - 1)) for k in range(self.top_points)]
        th = [_lerp(self.thickness[0], self.thickness[1], k / (self.top_points - 1)) for k in range(self.top_points)]
        normals = [self.top_normal(t, k / (self.top_points - 1)) for k in range(self.top_points)]
        margin_tangent = (top[-1] - top[-2]).normalized()
        margin = top[-1] + margin_tangent * (th[-1] * 0.5) - normals[-1] * (th[-1] * 0.5)
        bottom = []
        for k in range(self.bottom_points):
            u = 1.0 - k / (self.bottom_points - 1)
            index = u * (self.top_points - 1)
            i0 = min(int(index), self.top_points - 2)
            f = index - i0
            point = top[i0].lerp(top[i0 + 1], f)
            normal = normals[i0].lerp(normals[i0 + 1], f).normalized()
            bottom.append(point - normal * _lerp(th[i0], th[i0 + 1], f))
        return top + [margin] + bottom

    def mesh_top(self, t: float, u: float):
        ring_f = t * (len(self.top_ring_vectors) - 1)
        seg_f = u * (self.top_points - 1)
        return _bilinear_surface(self.top_ring_vectors, ring_f, seg_f, False, UP)

    @property
    def ring_size(self) -> int:
        return self.top_points + 1 + self.bottom_points

    @property
    def v_top(self) -> float:
        return self.top_points / self.ring_size


def _lumpy_rock(radius: float, height: float, segments: int, rings: int, roughness: float, seed: int, centre=(0.0, 0.0)):
    thetas = np.arange(segments) / segments * math.tau
    cos_t, sin_t = np.cos(thetas), np.sin(thetas)
    ring_list = []
    for j in range(rings):
        t = j / (rings - 1)
        z = height * math.sin(t * math.pi / 2) ** 0.9
        base_r = radius * (1.0 - 0.36 * t * t) * (0.92 + 0.08 * math.cos(math.pi * t))
        wobble = fbm(cos_t * 1.6 + 3.0 + t * 0.8, sin_t * 1.6 + 5.0 + t * 1.9, octaves=2, seed=seed + 51)
        r = base_r * (1.0 + roughness * (wobble - 0.5) * 2.0)
        ring_list.append([(float(centre[0] + r[k] * cos_t[k]), float(centre[1] + r[k] * sin_t[k]), float(z)) for k in range(segments)])
    geometry = _rings_geometry(ring_list)
    vertices = geometry[0]
    apex = len(vertices) - 1
    vertices[apex] = (vertices[apex][0], vertices[apex][1], height * 1.02)
    return geometry


def layout_plating(spec: dict, P: dict, pcfg: dict, seed: int) -> Layout:
    colony = PlatingColony(P, seed)
    ring_count = int(colony.turns * colony.rings_per_turn) + 1
    ts = [k / (ring_count - 1) for k in range(ring_count)]
    rings = [colony.cross_section(t) for t in ts]
    colony.top_ring_vectors = [ring[:colony.top_points] for ring in rings]
    plate_geometry = _rings_geometry(rings, u_values=ts)
    K = colony.ring_size
    face_materials = []
    side_faces = (ring_count - 1) * K
    for f_index in range(len(plate_geometry[1])):
        if f_index < side_faces:
            s = f_index % K
            face_materials.append("tissue" if s + 1 <= colony.top_points else "skeleton")
        else:
            face_materials.append("tissue")
    # whorl groups for self-clearance (rings of one whorl share no faces with the next whorl's tree)
    whorl_groups: dict[str, set[int]] = {}
    for ring_index, t in enumerate(ts):
        whorl = int((t * colony.turns) + 1e-9)
        whorl_groups.setdefault(f"whorl_{whorl}", set()).update(range(ring_index * K, (ring_index + 1) * K))
    whorl_groups["skeleton_all"] = set(range(len(plate_geometry[0])))
    # ---- column: leaning conical tube with a domed top, the plate's inner edge is embedded in it
    col = P.get("column", {})
    r_col = [float(v) for v in col.get("radius", [0.010, 0.0062])]
    z_top = colony.z_in(1.0) + float(col.get("topExtra", 0.010))
    col_segments = int(col.get("segments", 14))
    lean = Vector((float(col.get("leanX", 0.004)), float(col.get("leanY", -0.002)), 0.0))
    col_points, col_radii = [], []
    shaft_rings = int(col.get("rings", 7))
    z_start = 0.004
    r_tip = r_col[1]
    for k in range(shaft_rings):
        t = k / (shaft_rings - 1)
        z = _lerp(z_start, z_top - r_tip, t)
        col_points.append(lean * t + Vector((0.0, 0.0, z)))
        col_radii.append(_lerp(r_col[0], r_col[1], t ** 0.8) * (1.0 + 0.04 * math.sin(3.0 * t * math.pi)))
    for psi in (22.0, 46.0, 70.0):
        a = math.radians(psi)
        col_points.append(lean + Vector((0.0, 0.0, z_top - r_tip + r_tip * math.sin(a))))
        col_radii.append(r_tip * math.cos(a))
    column_geometry = _rings_geometry(_tube_rings(col_points, col_radii, col_segments))
    cv = column_geometry[0]
    cv[len(cv) - 1] = tuple(lean + Vector((0.0, 0.0, z_top)))
    # ---- rock
    rock = P.get("rock", {})
    rock_geometry = _lumpy_rock(float(rock.get("radius", 0.024)), float(rock.get("height", 0.010)), int(rock.get("segments", 22)),
                                int(rock.get("rings", 6)), float(rock.get("roughness", 0.14)), seed,
                                centre=(float(rock.get("offsetX", 0.003)), float(rock.get("offsetY", -0.002))))
    half = _xy_half(rock_geometry, plate_geometry)
    rock_geometry = _planar(rock_geometry, half)
    solids = [
        Solid("rock", rock_geometry, "rock", groups={"skeleton_all": set(range(len(rock_geometry[0])))}),
        Solid("column", column_geometry, "tissue", uv_transform=lambda u, v: (0.02 + u * 0.25, 0.05 + v * 0.30),
              groups={"skeleton_all": set(range(len(column_geometry[0])))}),
        Solid("plate", plate_geometry, "tissue", face_materials=face_materials, groups=whorl_groups, volume_floor=0.85),
    ]
    whorls = sorted(name for name in whorl_groups if name.startswith("whorl_"))
    pairs = []
    for i, a in enumerate(whorls):
        for b in whorls[i + 1:]:
            pairs.append((a, None, b, None, f"{a}_vs_{b}"))
    pairs.append(("part_plate", None, "part_rock", None, "plate_vs_rock"))
    # ---- polyps on the plate's upper surface (sampled on the mesh facets)
    poly_cfg = P.get("polyps", {})
    count = int(poly_cfg.get("count", 220))
    t_range = [float(v) for v in poly_cfg.get("tRange", [0.06, 0.985])]
    u_range = [float(v) for v in poly_cfg.get("uRange", [0.12, 0.9])]
    cluster_count = int(P.get("clusters", {}).get("count", 28))
    polyps: list[Polyp] = []
    attempt = 0
    while len(polyps) < count and attempt < pcfg["attempts"]:
        attempt += 1
        t = _lerp(t_range[0], t_range[1], _h(attempt, 1, seed=seed + 8))
        u = _lerp(u_range[0], u_range[1], _h(attempt, 2, seed=seed + 8))
        position, normal = colony.mesh_top(t, u)
        if _too_close(position, polyps, pcfg["spacing"]):
            continue
        polyp = _new_polyp(position, normal, pcfg, seed + 8, (attempt,))
        # the innermost plate is buried in the column: keep every polyp (and its leaning tip) clear of it
        clear_column = True
        for probe in (position, position + polyp.normal * (polyp.length * 1.2)):
            d, r = _polyline_distance(probe, col_points, col_radii)
            if d < r + 0.0025:
                clear_column = False
        if not clear_column:
            continue
        polyp.cluster = min(int((t - t_range[0]) / (t_range[1] - t_range[0]) * cluster_count), cluster_count - 1)
        polyps.append(polyp)
    bones, polyps = _single_bone_clusters(polyps, cluster_count, UP)
    return Layout(form="plating", solids=solids, polyps=polyps, bones=bones, pairs=pairs, pull_factor=float(P.get("pullFactor", 1.0)),
                  tissue_paint={"kind": "plate", "vTop": colony.v_top, "lengthMm": colony.turns * math.tau * 0.045 * 1000.0,
                                "widthMm": (colony.r_out[1] - colony.r_in) * 1000.0},
                  base_paint=None,
                  notes={"turns": colony.turns, "plateRings": ring_count, "ringSize": K, "vaseTopMeters": z_top,
                         "outerRadiusMeters": colony.r_out, "polypAttempts": attempt}, half=half)


# ---------------------------------------------------------------- digitata form (M. digitata habit)

class Finger:
    DOME_PSI = (22.0, 46.0, 70.0)

    def __init__(self, name: str, group: int, points: list, radii: list, segments: int, parent: "Finger | None" = None):
        self.name = name
        self.group = group
        self.points = points          # shaft axis points (Vector)
        self.radii = radii            # shaft radii
        self.tip_radius = radii[-1]
        self.segments = segments
        self.parent = parent
        self.axis = (points[-1] - points[0]).normalized()
        self.tip_axis = (points[-1] - points[-2]).normalized()
        self.s_exit = 0.0
        self.cumulative = [0.0]
        for a, b in zip(points, points[1:]):
            self.cumulative.append(self.cumulative[-1] + (b - a).length)
        self.length = self.cumulative[-1]
        self.geometry = None
        self.rings: list = []
        self.attach: set = set()

    def all_points_radii(self):
        points = list(self.points)
        radii = list(self.radii)
        for psi in self.DOME_PSI:
            a = math.radians(psi)
            points.append(self.points[-1] + self.tip_axis * (self.tip_radius * math.sin(a)))
            radii.append(self.tip_radius * math.cos(a))
        return points, radii

    @property
    def apex(self) -> Vector:
        return self.points[-1] + self.tip_axis * self.tip_radius

    def axis_distance(self, p: Vector):
        points, radii = self.all_points_radii()
        points.append(self.apex)
        radii.append(0.0)
        return _polyline_distance(p, points, radii)

    def inside(self, p: Vector, margin: float) -> bool:
        d, r = self.axis_distance(p)
        return d < r + margin

    def at(self, s: float):
        position = _clamp(s) * (len(self.points) - 1)
        index = min(int(position), len(self.points) - 2)
        f = position - index
        return self.points[index].lerp(self.points[index + 1], f), _lerp(self.radii[index], self.radii[index + 1], f)

    def surface(self, ring_f: float, phi: float):
        """Mesh-facet point and outward normal; ring_f counts shaft rings then dome rings then the apex ring."""
        seg_f = (phi % math.tau) / math.tau * self.segments
        j = min(int(_clamp(ring_f, 0.0, len(self.rings) - 1 - 1e-6)), len(self.rings) - 2)
        centre = 0.5 * (sum(self.rings[j], Vector((0.0, 0.0, 0.0))) / self.segments + sum(self.rings[j + 1], Vector((0.0, 0.0, 0.0))) / self.segments)
        point, _n = _bilinear_surface(self.rings, ring_f, seg_f, True, UP)
        orient = point - centre
        if orient.length < 1e-9:
            orient = self.tip_axis
        return _bilinear_surface(self.rings, ring_f, seg_f, True, orient)

    def build_geometry(self):
        points, radii = self.all_points_radii()
        rings = _tube_rings(points, radii, self.segments)
        cumulative = list(self.cumulative)
        for psi in self.DOME_PSI:
            cumulative.append(self.length + self.tip_radius * math.sin(math.radians(psi)))
        total = self.length + self.tip_radius
        u_values = [0.02 + 0.96 * c / total for c in cumulative]
        geometry = _rings_geometry(rings, u_values=u_values)
        vertices = geometry[0]
        vertices[len(vertices) - 1] = tuple(self.apex)
        self.geometry = geometry
        self.rings = rings + [[self.apex.copy() for _ in range(self.segments)]]
        return geometry


def _grow(start: Vector, direction: Vector, length: float, steps: int, curl_degrees: float, wobble_degrees: float, seed: int, key):
    d = direction.normalized()
    points = [start.copy()]
    step = length / steps
    curl = math.radians(curl_degrees) / steps
    for index in range(1, steps + 1):
        up_perp = UP - d * d.dot(UP)
        if up_perp.length > 1e-6:
            d = (d + up_perp.normalized() * math.tan(curl)).normalized()
        n, b = _perp_frame(d)
        wa = math.radians(wobble_degrees) * (2.0 * _h(*key, index, 1, seed=seed) - 1.0)
        wb = math.radians(wobble_degrees) * (2.0 * _h(*key, index, 2, seed=seed) - 1.0)
        d = (d + n * math.tan(wa) + b * math.tan(wb)).normalized()
        points.append(points[-1] + d * step)
    return points


class DigitataColony:
    def __init__(self, P: dict, seed: int):
        self.seed = seed
        mound = P.get("mound", {})
        self.outline = Outline(mound.get("outline", {"orders": [2, 3, 5], "amplitudes": [0.06, 0.04, 0.02]}), seed + 2)
        self.mound_radius = float(mound.get("radius", 0.056))
        self.mound_height = float(mound.get("height", 0.018))
        self.mound_rim = float(mound.get("rimHeight", 0.009))
        self.mound_bottom = float(mound.get("bottom", 0.002))
        self.mound_lumps = float(mound.get("lumpAmplitude", 0.0006))
        self.mound_segments = int(mound.get("segments", 40))
        self.mound_rings = int(mound.get("topRings", 9))
        self.top_ring_vectors: list = []

    def mound_R(self, theta):
        return self.mound_radius * self.outline.factor(theta)

    def mound_z(self, x, y):
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        r = np.hypot(x, y)
        theta = np.arctan2(y, x)
        rf = np.clip(r / self.mound_R(theta), 0.0, 1.0)
        dome = self.mound_rim + (self.mound_height - self.mound_rim) * (1.0 - rf ** 2) ** 1.1
        lumps = (fbm(x * 40.0 + 2.2, y * 40.0 + 7.7, octaves=3, seed=self.seed + 43) - 0.5) * 2.0 * self.mound_lumps
        return dome + lumps

    def top_ring_rf(self, j: int) -> float:
        return ((self.mound_rings - j - 0.5) / self.mound_rings) ** 0.9

    def mesh_top(self, rf: float, theta: float):
        ring_f = self.mound_rings - 0.5 - self.mound_rings * (rf ** (1.0 / 0.9))
        seg_f = ((theta % math.tau) / math.tau) * self.mound_segments
        return _bilinear_surface(self.top_ring_vectors, ring_f, seg_f, True, UP)

    def mound_geometry(self):
        seg = self.mound_segments
        thetas = np.arange(seg) / seg * math.tau
        cos_t, sin_t = np.cos(thetas), np.sin(thetas)
        R = self.mound_R(thetas)
        rings = []
        rings.append([(float(a), float(b), self.mound_bottom) for a, b in zip(R * cos_t, R * sin_t)])
        rings.append([(float(a), float(b), self.mound_bottom + 0.55 * (self.mound_rim - self.mound_bottom)) for a, b in zip(R * 1.03 * cos_t, R * 1.03 * sin_t)])
        rim_z = self.mound_z(R * cos_t, R * sin_t)
        rings.append([(float(a), float(b), float(c)) for a, b, c in zip(R * cos_t, R * sin_t, rim_z)])
        top = []
        for j in range(self.mound_rings):
            rf = self.top_ring_rf(j)
            x = rf * R * cos_t
            y = rf * R * sin_t
            top.append([(float(a), float(b), float(c)) for a, b, c in zip(x, y, self.mound_z(x, y))])
        rings.extend(top)
        self.top_ring_vectors = [[Vector(p) for p in ring] for ring in top]
        return _rings_geometry(rings)


def layout_digitata(spec: dict, P: dict, pcfg: dict, seed: int) -> Layout:
    colony = DigitataColony(P, seed)
    rock = P.get("rock", {})
    rock_geometry = _lumpy_rock(float(rock.get("radius", 0.066)), float(rock.get("height", 0.0085)), int(rock.get("segments", 36)),
                                int(rock.get("rings", 5)), float(rock.get("roughness", 0.12)), seed)
    mound_geometry = colony.mound_geometry()
    half = _xy_half(rock_geometry, mound_geometry)
    mound_geometry = _planar(mound_geometry, half)
    rock_geometry = _planar(rock_geometry, half)
    # ---- fingers
    F = P.get("fingers", {})
    count = int(F.get("count", 6))
    field_radius = float(F.get("fieldRadius", 0.040))
    min_spacing = float(F.get("minSpacing", 0.024))
    r_range = [float(v) for v in F.get("radius", [0.0062, 0.0074])]
    l_range = [float(v) for v in F.get("length", [0.040, 0.066])]
    tilt_range = [float(v) for v in F.get("tiltDegrees", [6.0, 24.0])]
    curl = float(F.get("curlDegrees", 8.0))
    wobble = float(F.get("wobbleDegrees", 4.0))
    shaft_steps = int(F.get("shaftSteps", 9))
    segments = int(F.get("segments", 12))
    embed = float(F.get("embed", 0.006))
    placed_xy = []
    attempt = 0
    while len(placed_xy) < count and attempt < 4000:
        attempt += 1
        r = field_radius * math.sqrt(_h(attempt, 1, seed=seed + 9))
        theta = _h(attempt, 2, seed=seed + 9) * math.tau
        x, y = r * math.cos(theta), r * math.sin(theta)
        if any(math.hypot(x - px, y - py) < min_spacing for px, py in placed_xy):
            continue
        placed_xy.append((x, y))
    if len(placed_xy) < count:
        raise ValueError(f"Only {len(placed_xy)} finger bases fit; loosen fingers.minSpacing or fieldRadius")
    fingers: list[Finger] = []
    for k, (x, y) in enumerate(placed_xy):
        rel = math.hypot(x, y) / field_radius
        radial = Vector((x, y, 0.0)).normalized() if math.hypot(x, y) > 1e-6 else FLOW
        tilt = math.radians(_lerp(tilt_range[0], tilt_range[1], rel) + 3.0 * (2.0 * _h(k, 3, seed=seed + 9) - 1.0))
        direction = (UP * math.cos(tilt) + radial * math.sin(tilt)).normalized()
        length = _lerp(l_range[0], l_range[1], _h(k, 4, seed=seed + 9)) - 0.006 * rel
        radius = _lerp(r_range[0], r_range[1], _h(k, 5, seed=seed + 9))
        # the embedded (tilted) base ring sits inside the mound but always above the rock apex (rock vs finger is proven)
        rock_apex = float(rock.get("height", 0.0085)) * 1.02
        z0 = max(float(colony.mound_z(np.array([x]), np.array([y]))[0]) - embed, rock_apex + 0.0015 + radius * math.sin(tilt))
        points = _grow(Vector((x, y, z0)), direction, length, shaft_steps, curl, wobble, seed + 9, (1, k))
        radii = [radius * (1.0 - 0.08 * (i / shaft_steps)) for i in range(shaft_steps + 1)]
        fingers.append(Finger(f"finger_{k:02d}", k, points, radii, segments))
    fork_cfg = P.get("forks", {})
    fork_on = [int(v) for v in fork_cfg.get("fingers", [0, 2, 4])]
    fork_s = float(fork_cfg.get("s", 0.42))
    fork_angle = math.radians(float(fork_cfg.get("angleDegrees", 26.0)))
    fork_length_factor = float(fork_cfg.get("lengthFactor", 0.72))
    fork_radius_factor = float(fork_cfg.get("radiusFactor", 0.82))
    mains = list(fingers)
    for k in fork_on:
        if k >= len(mains):
            continue
        parent = mains[k]
        point, radius = parent.at(fork_s)
        i0 = min(int(fork_s * shaft_steps), shaft_steps - 1)
        tangent = (parent.points[i0 + 1] - parent.points[i0]).normalized()
        # fork away from the colony centre and from the nearest neighbour so it never runs into another finger
        away = Vector((point.x, point.y, 0.0))
        away = away.normalized() if away.length > 1e-6 else FLOW
        nearest = min((f for f in mains if f is not parent), key=lambda f: (f.points[0] - parent.points[0]).length)
        repel = Vector((point.x - nearest.points[0].x, point.y - nearest.points[0].y, 0.0)).normalized()
        side = away * 0.6 + repel * 0.8 + _perp_frame(tangent)[0] * (0.15 * (2.0 * _h(k, 6, seed=seed + 9) - 1.0))
        side = (side - tangent * tangent.dot(side)).normalized()
        direction = (tangent * math.cos(fork_angle) + side * math.sin(fork_angle)).normalized()
        start = point - side * (radius * 0.35)
        length = parent.length * (1.0 - fork_s) * fork_length_factor + 0.006
        points = _grow(start, direction, length, shaft_steps, float(fork_cfg.get("curlDegrees", 3.0)), wobble, seed + 9, (2, k))
        r0 = radius * fork_radius_factor
        radii = [r0 * (1.0 - 0.08 * (i / shaft_steps)) for i in range(shaft_steps + 1)]
        fingers.append(Finger(f"fork_{k:02d}", k, points, radii, segments, parent=parent))
    for finger in fingers:
        finger.build_geometry()
        if finger.parent is None:
            for index, point in enumerate(finger.points):
                if point.z > float(colony.mound_z(np.array([point.x]), np.array([point.y]))[0]) + finger.radii[index] * 0.9:
                    finger.s_exit = index / shaft_steps
                    break
        else:
            # forks may stay fused to their parent (anastomosing habit); s_exit marks where polyps fit between them
            finger.s_exit = 1.0
            for index, point in enumerate(finger.points):
                d, r = finger.parent.axis_distance(point)
                if d > r + finger.radii[index] + 0.003:
                    finger.s_exit = index / shaft_steps
                    break
            for index, vertex in enumerate(finger.geometry[0]):
                if finger.parent.inside(Vector(vertex), finger.parent.radii[0] * 0.25 + 0.0015):
                    finger.attach.add(index)
    # layout check: unrelated tubes keep a full gap; a fork is checked only where its axis has left the parent
    gaps = {}
    min_gap = float(F.get("minGap", 0.008))
    for i, a in enumerate(fingers):
        for b in fingers[i + 1:]:
            related = a.parent is b or b.parent is a
            pa, ra = a.all_points_radii()
            pb, rb = b.all_points_radii()

            def fused(points, radii, parent):
                out = []
                for point, radius in zip(points, radii):
                    d, r = parent.axis_distance(point)
                    out.append(d < r + radius + 0.0005)
                return out

            fused_a = fused(pa, ra, b) if a.parent is b else [False] * len(pa)
            fused_b = fused(pb, rb, a) if b.parent is a else [False] * len(pb)
            gap = 1e9
            for ia in range(len(pa) - 1):
                if fused_a[ia] or fused_a[ia + 1]:
                    continue
                for ib in range(len(pb) - 1):
                    if fused_b[ib] or fused_b[ib + 1]:
                        continue
                    d = _segment_distance(pa[ia], pa[ia + 1], pb[ib], pb[ib + 1]) - max(ra[ia], ra[ia + 1]) - max(rb[ib], rb[ib + 1])
                    gap = min(gap, d)
            gaps[(a.name, b.name)] = gap
            print(f"[montipora] gap {gap * 1000:+.1f} mm between {a.name} and {b.name}{' (parent/child)' if related else ''}")
            if gap < (0.0005 if related else min_gap):
                raise ValueError(f"Finger layout too tight: {a.name}/{b.name} gap {gap * 1000:.1f} mm")
    solids = [
        Solid("rock", rock_geometry, "rock", groups={"skeleton_all": set(range(len(rock_geometry[0])))}),
        Solid("mound", mound_geometry, "base", groups={"skeleton_all": set(range(len(mound_geometry[0])))}, volume_floor=0.85),
    ]
    pairs = []
    for finger in fingers:
        n = len(finger.geometry[0])
        solids.append(Solid(finger.name, finger.geometry, "tissue", groups={"skeleton_all": set(range(n)), f"attach_{finger.name}": set(finger.attach)}))
    for i, a in enumerate(fingers):
        pairs.append((f"part_{a.name}", None, "part_rock", None, f"{a.name}_vs_rock"))
        for b in fingers[i + 1:]:
            if b.parent is a:
                pairs.append((f"part_{a.name}", None, f"part_{b.name}", f"attach_{b.name}", f"{a.name}_vs_{b.name}"))
            elif a.parent is b:
                pairs.append((f"part_{a.name}", f"attach_{a.name}", f"part_{b.name}", None, f"{a.name}_vs_{b.name}"))
            else:
                pairs.append((f"part_{a.name}", None, f"part_{b.name}", None, f"{a.name}_vs_{b.name}"))
    # ---- direction bones per finger group: axis plus four sector directions across the finger
    bones: list[ClusterBone] = []
    basis: dict[int, dict] = {}
    for g, main in enumerate(mains):
        axis = main.axis
        u0 = (FLOW - axis * axis.dot(FLOW)).normalized()
        u1 = axis.cross(u0).normalized()
        head = main.at(0.5)[0]
        names = {key: f"Pol_{g}_{key}" for key in ("ax", "s0", "s1", "s2", "s3")}
        dirs = {"ax": axis, "s0": u0, "s1": u1, "s2": -u0, "s3": -u1}
        for key in ("ax", "s0", "s1", "s2", "s3"):
            bones.append(ClusterBone(names[key], head, dirs[key]))
        basis[g] = {"names": names, "dirs": dirs, "cluster": g}

    def assign(polyp: Polyp, g: int):
        b = basis[g]
        coefficients = {key: max(polyp.normal.dot(b["dirs"][key]), 0.0) for key in ("ax", "s0", "s1", "s2", "s3")}
        total = sum(coefficients.values())
        if total < 1e-6:
            coefficients = {"ax": 1.0}
            total = 1.0
        polyp.bones = [(b["names"][key], value / total) for key, value in coefficients.items() if value > 1e-6]
        polyp.basis_sum = total
        polyp.cluster = b["cluster"]

    # ---- polyps on fingers and the mound
    poly_cfg = P.get("polyps", {})
    per_finger = int(poly_cfg.get("perFinger", 20))
    dome_per_finger = int(poly_cfg.get("domePerFinger", 4))
    mound_count = int(poly_cfg.get("mound", 40))
    mound_max_rf = float(poly_cfg.get("moundMaxRadiusFraction", 0.86))
    clear = float(poly_cfg.get("clearance", 0.0025))
    polyps: list[Polyp] = []

    def probe_ok(position: Vector, normal: Vector, owner: Finger | None, length: float) -> bool:
        crown = position + normal * (length * 0.75)
        tip = position + normal * (length * 1.15)
        for finger in fingers:
            if finger is owner:
                continue
            for point in (crown, tip):
                d, r = finger.axis_distance(point)
                if d < r + clear:
                    return False
        if owner is not None:
            for point in (crown, tip):
                if point.z < float(colony.mound_z(np.array([point.x]), np.array([point.y]))[0]) + clear:
                    return False
        return True

    dome_rings = len(Finger.DOME_PSI)
    for finger in fingers:
        kind = 0 if finger.parent is None else 1
        attempt = 0
        placed = 0
        target = per_finger if finger.parent is None else int(per_finger * 0.7)
        s_min = min(finger.s_exit + 0.06, 0.6)
        while placed < target and attempt < 700:
            attempt += 1
            s = _lerp(s_min, 0.985, _h(attempt, 1, seed=seed + 10 + finger.group * 7 + kind * 3))
            phi = _h(attempt, 2, seed=seed + 10 + finger.group * 7 + kind * 3) * math.tau
            position, normal = finger.surface(s * shaft_steps, phi)
            if _too_close(position, polyps, pcfg["spacing"]):
                continue
            polyp = _new_polyp(position, normal, pcfg, seed + 10, (finger.group, attempt, kind))
            if not probe_ok(position, polyp.normal, finger, polyp.length):
                continue
            assign(polyp, finger.group)
            polyps.append(polyp)
            placed += 1
        attempt = 0
        placed = 0
        while placed < dome_per_finger and attempt < 300:
            attempt += 1
            ring_f = shaft_steps + _lerp(0.3, dome_rings - 0.15, _h(attempt, 3, seed=seed + 11 + finger.group * 7 + kind * 3))
            phi = _h(attempt, 4, seed=seed + 11 + finger.group * 7 + kind * 3) * math.tau
            position, normal = finger.surface(ring_f, phi)
            if _too_close(position, polyps, pcfg["spacing"]):
                continue
            polyp = _new_polyp(position, normal, pcfg, seed + 11, (finger.group, attempt, 2 + kind))
            if not probe_ok(position, polyp.normal, finger, polyp.length):
                continue
            assign(polyp, finger.group)
            polyps.append(polyp)
            placed += 1
    attempt = 0
    placed = 0
    while placed < mound_count and attempt < 4000:
        attempt += 1
        rf = mound_max_rf * math.sqrt(_h(attempt, 1, seed=seed + 12))
        theta = _h(attempt, 2, seed=seed + 12) * math.tau
        position, normal = colony.mesh_top(rf, theta)
        if _too_close(position, polyps, pcfg["spacing"]):
            continue
        polyp = _new_polyp(position, normal, pcfg, seed + 12, (attempt,))
        if not probe_ok(position, polyp.normal, None, polyp.length):
            continue
        nearest = min(range(len(mains)), key=lambda g: (Vector((mains[g].points[0].x, mains[g].points[0].y, 0.0)) - Vector((position.x, position.y, 0.0))).length)
        assign(polyp, nearest)
        polyps.append(polyp)
        placed += 1
    return Layout(form="digitata", solids=solids, polyps=polyps, bones=bones, pairs=pairs, pull_factor=float(P.get("pullFactor", 1.3)),
                  tissue_paint={"kind": "finger", "lengthMm": (l_range[1] + 0.012) * 1000.0, "circumferenceMm": 2.0 * math.pi * r_range[1] * 1000.0},
                  base_paint={"kind": "planar", "colony": colony, "margin": False},
                  notes={"fingers": len(mains), "forks": len(fingers) - len(mains), "gapsMm": {f"{a}/{b}": round(g * 1000.0, 2) for (a, b), g in gaps.items()},
                         "exits": {f.name: round(f.s_exit, 3) for f in fingers}},
                  marks=[(p.position.x, p.position.y) for p in polyps if p.normal.z > 0.85 and p.position.z < colony.mound_height + 0.004],
                  half=half)


LAYOUTS = {"encrusting": layout_encrusting, "plating": layout_plating, "digitata": layout_digitata}


# ---------------------------------------------------------------- polyp geometry and weights

def _polyp_geometry(polyp: Polyp, pcfg: dict):
    n = polyp.normal
    e1, e2 = _perp_frame(n, polyp.spin)
    base = polyp.position - n * pcfg["embed"]
    crown = pcfg["crownFraction"]
    heights = (0.0, crown * polyp.length, polyp.length)
    radii = (polyp.radius * 0.9, polyp.radius * pcfg["crownRadiusFactor"], polyp.radius * 0.5)
    rings = []
    for k, (h, r) in enumerate(zip(heights, radii)):
        centre = base + n * h
        ring = []
        for s in range(POLYP_SEGMENTS):
            a = s / POLYP_SEGMENTS * math.tau
            star = 1.0 + (0.18 * math.cos(3.0 * a + 0.5) if k == 1 else 0.0)
            ring.append(centre + (e1 * math.cos(a) + e2 * math.sin(a)) * (r * star))
        rings.append(ring)
    return _rings_geometry(rings, u_values=[0.0, crown, 1.0])


def _polyp_weight_fn(polyp: Polyp, pcfg: dict):
    exposed = polyp.length - pcfg["embed"]
    crown_height = pcfg["crownFraction"] * polyp.length - pcfg["embed"]
    mid_ratio = _clamp(crown_height / max(exposed, 1e-9))
    w_tip = polyp.w_tip
    # the crown ring moves a little less than its height fraction so it never touches the surface on retraction
    w_mid = w_tip * mid_ratio * pcfg["crownRetractFactor"]

    def weights(index, _vertex):
        if index < POLYP_SEGMENTS or index == 3 * POLYP_SEGMENTS:
            return {"Base": 1.0}
        w = w_tip if (index >= 2 * POLYP_SEGMENTS) else w_mid
        out = {name: fraction * w for name, fraction in polyp.bones}
        out["Base"] = out.get("Base", 0.0) + (1.0 - w)
        return {name: value for name, value in out.items() if value > 1e-6}

    return weights


# ---------------------------------------------------------------- procedural paint

def _tissue_field(Xmm, Ymm, palette: dict, seed: int):
    """Shared tissue look in millimetre coordinates: mottling, papillae bumps and painted corallite pits."""
    tissue = _rgb(palette, "tissue", (0.7, 0.12, 0.10))
    dark = _rgb(palette, "tissueDark", _darker(tissue, 0.4))
    light = _rgb(palette, "tissueLight", _lighter(tissue, 0.25))
    corallite = _rgb(palette, "corallite", _darker(tissue, 0.6))
    albedo = textures.rgba(tissue, 1.0, Xmm.shape)
    mottle_a = fbm(Xmm / 9.0 + 3.1, Ymm / 9.0 + 9.2, octaves=4, seed=seed + 21)
    albedo = textures.mix(albedo, dark, smoothstep(0.3, 0.75, mottle_a) * 0.6)
    mottle_b = fbm(Xmm / 4.0 + 13.1, Ymm / 4.0 + 1.2, octaves=3, seed=seed + 22)
    albedo = textures.mix(albedo, light, smoothstep(0.55, 0.85, mottle_b) * 0.5)
    pap_d, pap_id = cells(Xmm / 1.35 + 0.3, Ymm / 1.35 + 0.7, seed + 23)
    bumps = (1.0 - smoothstep(0.16, 0.5, pap_d)) * smoothstep(0.15, 0.45, pap_id)
    albedo = textures.scale_rgb(albedo, 1.0 + 0.10 * bumps)
    cor_d, cor_id = cells(Xmm / 2.7 + 5.0, Ymm / 2.7 + 3.0, seed + 24)
    has = smoothstep(0.42, 0.5, cor_id)
    pit = (1.0 - smoothstep(0.05, 0.15, cor_d)) * has
    rim = (1.0 - smoothstep(0.15, 0.27, cor_d)) * smoothstep(0.09, 0.17, cor_d) * has
    albedo = textures.mix(albedo, light, rim * 0.45)
    albedo = textures.mix(albedo, corallite, pit * 0.9)
    height = 0.5 + 0.16 * bumps - 0.22 * pit + 0.05 * rim + 0.05 * (mottle_a - 0.5)
    roughness = 0.56 + 0.08 * (mottle_a - 0.5) - 0.10 * pit + 0.05 * bumps
    return albedo, height, roughness


def paint_tissue_planar(layout: dict, palette: dict, marks: list, size: int, half: float, seed: int):
    colony = layout["colony"]
    U, V = textures.uv_grid(size, size)
    X = (U - 0.5) * 2.0 * half
    Y = (V - 0.5) * 2.0 * half
    albedo, height, roughness = _tissue_field(X * 1000.0, Y * 1000.0, palette, seed)
    margin_color = _rgb(palette, "margin", (0.95, 0.80, 0.78))
    corallite = _rgb(palette, "corallite", (0.3, 0.05, 0.05))
    light = _rgb(palette, "tissueLight", (0.85, 0.3, 0.2))
    theta = np.arctan2(Y, X)
    r = np.hypot(X, Y)
    if isinstance(colony, EncrustingColony):
        rf = r / colony.sheet_radius(theta)
        relief = colony.tubercle_field(X, Y) / 0.0018
        height = height + 0.28 * np.clip(relief, 0.0, 1.2)
        albedo = textures.mix(albedo, light, 0.35 * np.clip(relief, 0.0, 1.0) ** 1.5)
        if layout.get("margin", True):
            growth_line = smoothstep(0.88, 0.915, rf) * (1.0 - smoothstep(0.925, 0.945, rf))
            albedo = textures.mix(albedo, _darker(_rgb(palette, "tissue", (0.7, 0.1, 0.1)), 0.35), growth_line * 0.35)
            edge = smoothstep(0.945, 0.995, rf)
            albedo = textures.mix(albedo, margin_color, edge * 0.8)
            roughness = roughness + 0.06 * edge
    elif isinstance(colony, DigitataColony):
        rf = r / colony.mound_R(theta)
        edge = smoothstep(0.9, 1.0, rf)
        albedo = textures.mix(albedo, margin_color, edge * 0.5)
    # corallite rings at the real polyp positions
    ring = np.zeros(U.shape)
    pit = np.zeros(U.shape)
    for mx, my in marks:
        d = np.hypot(X - mx, Y - my)
        pit = np.maximum(pit, 1.0 - smoothstep(0.0006, 0.0011, d))
        ring = np.maximum(ring, (1.0 - smoothstep(0.0011, 0.0017, d)) * smoothstep(0.0007, 0.0011, d))
    albedo = textures.mix(albedo, light, ring * 0.5)
    albedo = textures.mix(albedo, corallite, pit * 0.85)
    height = height - 0.25 * pit + 0.08 * ring
    albedo[..., 3] = 1.0
    return {"albedo": albedo, "roughness": textures.grey(roughness - 0.08 * pit), "normal": textures.normal_from_height(np.clip(height, 0.0, 1.0), 2.4)}


def paint_tissue_finger(layout: dict, palette: dict, width: int, height_px: int, seed: int):
    U, V = textures.uv_grid(width, height_px)
    Vm = 0.5 - np.abs(V - 0.5)
    albedo, height, roughness = _tissue_field(U * layout["lengthMm"], Vm * layout["circumferenceMm"], palette, seed)
    margin_color = _rgb(palette, "margin", (0.85, 0.75, 0.95))
    tip = smoothstep(0.82, 0.93, U)
    albedo = textures.mix(albedo, margin_color, tip * 0.85)
    apex = smoothstep(0.955, 0.995, U)
    albedo = textures.mix(albedo, _lighter(margin_color, 0.12), apex * 0.6)
    albedo = textures.scale_rgb(albedo, 0.86 + 0.14 * smoothstep(0.0, 0.2, U))
    roughness = roughness + 0.05 * tip
    albedo[..., 3] = 1.0
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(np.clip(height, 0.0, 1.0), 1.6)}


def paint_tissue_plate(layout: dict, palette: dict, width: int, height_px: int, seed: int):
    U, V = textures.uv_grid(width, height_px)
    v_top = layout["vTop"]
    Vt = V / v_top
    albedo, height, roughness = _tissue_field(U * layout["lengthMm"], Vt * layout["widthMm"], palette, seed)
    margin_color = _rgb(palette, "margin", (0.98, 0.85, 0.55))
    tissue = _rgb(palette, "tissue", (0.9, 0.45, 0.1))
    # faint radiating costae under the tissue toward the margin, then the bright growing margin
    wobble = fbm(U * 60.0, V * 6.0, octaves=2, seed=seed + 27)
    stripes = (0.5 + 0.5 * np.sin(U * math.tau * 520.0 + wobble * 4.0)) ** 3
    albedo = textures.mix(albedo, _lighter(tissue, 0.2), stripes * smoothstep(0.45, 0.95, Vt) * 0.22)
    growth_line = smoothstep(0.84, 0.88, Vt) * (1.0 - smoothstep(0.89, 0.92, Vt))
    albedo = textures.mix(albedo, _darker(tissue, 0.3), growth_line * 0.3)
    edge = smoothstep(0.90, 0.985, Vt)
    albedo = textures.mix(albedo, margin_color, edge * 0.9)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.1 * smoothstep(0.0, 0.15, Vt))
    height = height + 0.05 * stripes
    roughness = roughness + 0.05 * edge
    albedo[..., 3] = 1.0
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(np.clip(height, 0.0, 1.0), 1.6)}


def paint_skeleton(palette: dict, width: int, height_px: int, seed: int, costae_along_u: bool):
    U, V = textures.uv_grid(width, height_px)
    base = _rgb(palette, "skeleton", (0.86, 0.83, 0.76))
    coralline = _rgb(palette, "coralline", (0.60, 0.28, 0.46))
    pore_d, _ = cells(U * 140.0, V * 70.0, seed + 31)
    pore = 1.0 - smoothstep(0.10, 0.28, pore_d)
    grain = fbm(U * 60.0, V * 30.0, octaves=4, seed=seed + 32)
    costae = (0.5 + 0.5 * np.cos((U * 520.0 if costae_along_u else V * 40.0) * math.tau)) ** 1.5
    albedo = textures.rgba(base, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.86 + 0.26 * grain - 0.25 * pore + 0.06 * (costae - 0.5))
    patches = smoothstep(0.66, 0.78, fbm(U * 24.0 + 2.0, V * 8.0 + 4.0, octaves=3, seed=seed + 33))
    albedo = textures.mix(albedo, coralline, patches * 0.6)
    roughness = 0.84 + 0.1 * pore - 0.14 * patches
    height = 0.5 - 0.3 * pore + 0.14 * (costae - 0.5) + 0.08 * (grain - 0.5)
    albedo[..., 3] = 1.0
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 1.5)}


def paint_rock(palette: dict, size: int, half: float, seed: int):
    """Planar (top-down) rock paint in millimetres: mottled porous stone with coralline crusts and algae film."""
    U, V = textures.uv_grid(size, size)
    X = (U - 0.5) * 2.0 * half * 1000.0
    Y = (V - 0.5) * 2.0 * half * 1000.0
    rock = _rgb(palette, "rock", (0.26, 0.23, 0.20))
    mottle = fbm(X / 14.0, Y / 14.0, octaves=4, seed=seed + 51)
    grain = fbm(X / 2.5 + 3.0, Y / 2.5 + 1.0, octaves=3, seed=seed + 52)
    pit_d, _ = cells(X / 2.4, Y / 2.4, seed=seed + 53)
    pit = 1.0 - smoothstep(0.12, 0.32, pit_d)
    crust_d, crust_id = cells(X / 7.0 + 2.0, Y / 7.0 + 5.0, seed=seed + 54)
    crust_edge = fbm(X / 3.0, Y / 3.0, octaves=2, seed=seed + 56)
    coralline = (1.0 - smoothstep(0.25 + 0.2 * crust_edge, 0.5 + 0.2 * crust_edge, crust_d)) * smoothstep(0.7, 0.78, crust_id)
    algae = smoothstep(0.58, 0.8, fbm(X / 20.0 + 7.0, Y / 20.0 + 2.0, octaves=3, seed=seed + 55))
    albedo = textures.rgba(rock, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.72 + 0.5 * mottle + 0.18 * (grain - 0.5) - 0.3 * pit)
    albedo = textures.mix(albedo, _rgb(palette, "algae", (0.22, 0.26, 0.14)), 0.55 * algae)
    albedo = textures.mix(albedo, _rgb(palette, "coralline", (0.36, 0.11, 0.27)), 0.5 * coralline)
    roughness = 0.92 + 0.05 * (grain - 0.5) - 0.18 * coralline
    height = 0.5 + 0.22 * (mottle - 0.5) - 0.28 * pit + 0.10 * (grain - 0.5) + 0.06 * coralline
    albedo[..., 3] = 1.0
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 1.6)}


def paint_polyp(palette: dict, width: int, height_px: int, seed: int):
    U, V = textures.uv_grid(width, height_px)
    polyp = _rgb(palette, "polyp", (0.35, 0.85, 0.30))
    tip = _rgb(palette, "polypTip", (0.78, 1.0, 0.6))
    tissue = _rgb(palette, "tissue", (0.7, 0.1, 0.1))
    stalk = _rgb(palette, "polypStalk", tuple(0.5 * a + 0.5 * b for a, b in zip(polyp, tissue)))
    albedo = textures.rgba(stalk, 1.0, U.shape)
    albedo = textures.mix(albedo, polyp, smoothstep(0.35, 0.7, U))
    tentacles = (0.5 + 0.5 * np.cos(V * math.tau * 6.0)) ** 2 * smoothstep(0.6, 0.78, U)
    albedo = textures.mix(albedo, tip, tentacles * 0.55)
    albedo = textures.mix(albedo, tip, smoothstep(0.88, 0.99, U) * 0.8)
    grain = fbm(U * 8.0, V * 4.0, octaves=2, seed=seed + 61)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * grain)
    albedo[..., 3] = 1.0
    roughness = 0.40 + 0.08 * grain - 0.08 * smoothstep(0.7, 1.0, U)
    height = 0.5 + 0.12 * tentacles + 0.04 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.8)}


def _write_set(prefix: str, ctx, stem: str, paint: dict, written: list):
    images = {}
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = ctx.texture_dir / f"{stem}-{key}.png"
        images[key] = textures.write_image(f"{prefix}_{stem}_{key}", path, paint[key], non_color)
        written.append(path)
    return images


# ---------------------------------------------------------------- animation

def _local_axis(rig, bone_name: str, world_axis: Vector) -> tuple[float, float, float]:
    """Express an armature-space direction in the bone's rest frame (pose location / rotation axes)."""
    m3 = rig.data.bones[bone_name].matrix_local.to_3x3()
    local = m3.transposed() @ Vector(world_axis)
    return (local.x, local.y, local.z)


def _key_every_kind(channels: list[Channel], envelope: str | None, bone_names: list[str]) -> list[Channel]:
    """Every animated bone keys rotation, location and scale in every clip so clips never inherit a pose."""
    kinds_by_bone: dict[str, set[str]] = {name: set() for name in bone_names}
    for channel in channels:
        kinds_by_bone.setdefault(channel.target, set()).add(channel.kind)
    padded = list(channels)
    for bone in bone_names:
        for kind in ("rotation", "location", "scale"):
            if kind not in kinds_by_bone[bone]:
                padded.append(Channel(bone, kind, (0.0, 1.0, 0.0), 0.0, 1.0, 0.0, "const", envelope=envelope))
    return padded


def build_clips(spec: dict, rig, bones: list[ClusterBone], pull: float, seed: int) -> list[ClipSpec]:
    anim = spec["animation"]
    names = [b.name for b in bones]
    clips: list[ClipSpec] = []

    sway = anim["sway"]
    channels: list[Channel] = []
    for i, b in enumerate(bones):
        angle = math.tau * _h(i, seed=seed + 61)
        drift = Vector((math.cos(angle), math.sin(angle), 0.0))
        wobble = Vector((-math.sin(angle), math.cos(angle), 0.0))
        gain = 0.8 + 0.4 * _h(i, seed=seed + 62)
        channels.append(Channel(b.name, "location", _local_axis(rig, b.name, drift), float(sway["drift"]) * gain, int(sway.get("driftFrequency", 1)),
                                math.tau * _h(i, seed=seed + 63)))
        channels.append(Channel(b.name, "location", _local_axis(rig, b.name, wobble), float(sway.get("wobble", 0.0)) * gain, int(sway.get("wobbleFrequency", 2)),
                                math.tau * _h(i, seed=seed + 64)))
        channels.append(Channel(b.name, "location", _local_axis(rig, b.name, b.direction), float(sway.get("breathe", 0.0)) * gain, int(sway.get("breatheFrequency", 1)),
                                math.tau * _h(i, seed=seed + 65)))
    clips.append(ClipSpec("sway", int(sway["frames"]), True, _key_every_kind(channels, None, names)))

    flow = anim["flow"]
    channels = []
    wave_number = float(flow.get("waveNumber", 40.0))
    for i, b in enumerate(bones):
        phase = -wave_number * b.head.x + 0.5 * (_h(i, seed=seed + 71) - 0.5)
        gain = 0.85 + 0.3 * _h(i, seed=seed + 72)
        channels.append(Channel(b.name, "location", _local_axis(rig, b.name, FLOW), float(flow["pulse"]) * gain, int(flow.get("pulseFrequency", 2)),
                                phase, bias=float(flow.get("lean", 0.0))))
        channels.append(Channel(b.name, "location", _local_axis(rig, b.name, SIDE), float(flow.get("flutter", 0.0)) * gain, int(flow.get("flutterFrequency", 3)),
                                math.tau * _h(i, seed=seed + 73)))
        # polyps shorten a little as the current presses them (pulse waveform stays >= 0 and loops)
        channels.append(Channel(b.name, "location", _local_axis(rig, b.name, -b.direction), float(flow.get("press", 0.0)) * gain, int(flow.get("pulseFrequency", 2)),
                                phase, waveform="pulse"))
    clips.append(ClipSpec("flow", int(flow["frames"]), True, _key_every_kind(channels, None, names)))

    retract = anim["retract"]
    envelope = retract.get("envelope", "hold")
    channels = []
    for i, b in enumerate(bones):
        channels.append(Channel(b.name, "location", _local_axis(rig, b.name, -b.direction), pull, 1.0, 0.0, "const", envelope=envelope))
        # a faint sideways settle so retracted fields do not collapse in perfect unison
        angle = math.tau * _h(i, seed=seed + 81)
        settle = Vector((math.cos(angle), math.sin(angle), 0.0))
        channels.append(Channel(b.name, "location", _local_axis(rig, b.name, settle), float(retract.get("settle", 0.0)), 1.0, 0.0, "const", envelope=envelope))
    clips.append(ClipSpec("retract", int(retract["frames"]), False, _key_every_kind(channels, envelope, names)))
    return clips


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morphology = spec["morphology"]
    form = morphology.get("form", "encrusting")
    if form not in LAYOUTS:
        raise ValueError(f"Unknown Montipora form {form}")
    seed = int(morphology.get("seed", 5))
    form_cfg = morphology.get(form, {})
    pcfg = _polyp_defaults({**morphology.get("polyps", {}), **form_cfg.get("polypOverrides", {})})
    palette = spec["palette"]
    tex = spec.get("textures", {})

    # ---- layout in metres, then normalise the xy extent (polyp tips included) to the reference width
    layout = LAYOUTS[form](spec, form_cfg, pcfg, seed)
    if not layout.polyps:
        raise ValueError("No polyps were placed")
    xs, ys, zs = [], [], []
    for solid in layout.solids:
        xs.extend(v[0] for v in solid.geometry[0])
        ys.extend(v[1] for v in solid.geometry[0])
        zs.extend(v[2] for v in solid.geometry[0])
    for p in layout.polyps:
        tip = p.position + p.normal * p.length
        xs.append(tip.x)
        ys.append(tip.y)
    if min(zs) < -1e-9:
        raise ValueError("Skeleton dips below the base plane")
    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = float(spec["referenceSize"]["meters"]) / extent
    shift = Vector(((max(xs) + min(xs)) / 2.0, (max(ys) + min(ys)) / 2.0, 0.0))

    def S(v):
        return ((v[0] - shift.x) * scale, (v[1] - shift.y) * scale, v[2] * scale)

    for p in layout.polyps:
        p.position = Vector(S(p.position))
        p.length *= scale
        p.radius *= scale
    for b in layout.bones:
        b.head = Vector(S(b.head))
    pcfg = {**pcfg, "embed": pcfg["embed"] * scale}
    margin = float(spec["animation"]["retract"].get("marginMeters", 0.0003)) * scale
    exposed_max = max(p.length for p in layout.polyps) - pcfg["embed"]
    pull = layout.pull_factor * (exposed_max - margin)
    for p in layout.polyps:
        p.w_tip = _clamp((p.length - pcfg["embed"] - margin) * p.basis_sum / pull, 0.45, 1.0)

    # ---- textures and materials (painted in design space; the planar UVs were built in design space too)
    written: list = []
    tissue_res = tex.get("tissueResolution", [1024, 1024])
    if layout.tissue_paint["kind"] == "planar":
        tissue_paint = paint_tissue_planar(layout.tissue_paint, palette, layout.marks, int(tissue_res[0]), layout.half, seed)
    elif layout.tissue_paint["kind"] == "finger":
        tissue_paint = paint_tissue_finger(layout.tissue_paint, palette, int(tissue_res[0]), int(tissue_res[1]), seed)
    else:
        tissue_paint = paint_tissue_plate(layout.tissue_paint, palette, int(tissue_res[0]), int(tissue_res[1]), seed)
    tissue_images = _write_set(prefix, ctx, "tissue", tissue_paint, written)
    tissue = mat.principled(f"{prefix}_Tissue", _rgb(palette, "tissue", (0.7, 0.1, 0.1)), 0.56, coat=0.04, subsurface=0.12, specular=0.35)
    mat.attach_textures(tissue, albedo=tissue_images["albedo"], roughness=tissue_images["roughness"], normal=tissue_images["normal"],
                        normal_strength=float(tex.get("tissueNormalStrength", 1.0)))
    material_map = {"tissue": tissue}
    materials_used = {solid.material for solid in layout.solids} | {m for solid in layout.solids if solid.face_materials for m in solid.face_materials}
    if "base" in materials_used:
        base_paint = paint_tissue_planar(layout.base_paint, palette, layout.marks, int(tex.get("baseResolution", 1024)), layout.half, seed + 3)
        base_images = _write_set(prefix, ctx, "base", base_paint, written)
        base = mat.principled(f"{prefix}_Base", _rgb(palette, "tissue", (0.7, 0.1, 0.1)), 0.58, coat=0.03, subsurface=0.10, specular=0.32)
        mat.attach_textures(base, albedo=base_images["albedo"], roughness=base_images["roughness"], normal=base_images["normal"],
                            normal_strength=float(tex.get("tissueNormalStrength", 1.0)))
        material_map["base"] = base
    if "skeleton" in materials_used:
        sk_res = tex.get("skeletonResolution", [1024, 512])
        skeleton_images = _write_set(prefix, ctx, "skeleton", paint_skeleton(palette, int(sk_res[0]), int(sk_res[1]), seed, costae_along_u=(form == "plating")), written)
        skeleton = mat.principled(f"{prefix}_Skeleton", _rgb(palette, "skeleton", (0.86, 0.83, 0.76)), 0.85, coat=0.0, subsurface=0.02, specular=0.28)
        mat.attach_textures(skeleton, albedo=skeleton_images["albedo"], roughness=skeleton_images["roughness"], normal=skeleton_images["normal"],
                            normal_strength=float(tex.get("skeletonNormalStrength", 1.0)))
        material_map["skeleton"] = skeleton
    rock_images = _write_set(prefix, ctx, "rock", paint_rock(palette, int(tex.get("rockResolution", 512)), layout.half, seed), written)
    rock = mat.principled(f"{prefix}_Rock", _rgb(palette, "rock", (0.26, 0.23, 0.20)), 0.92, coat=0.0, subsurface=0.0, specular=0.15)
    mat.attach_textures(rock, albedo=rock_images["albedo"], roughness=rock_images["roughness"], normal=rock_images["normal"],
                        normal_strength=float(tex.get("rockNormalStrength", 1.0)))
    material_map["rock"] = rock
    polyp_res = tex.get("polypResolution", [128, 64])
    polyp_images = _write_set(prefix, ctx, "polyp", paint_polyp(palette, int(polyp_res[0]), int(polyp_res[1]), seed), written)
    polyp_material = mat.principled(f"{prefix}_Polyp", _rgb(palette, "polyp", (0.35, 0.85, 0.3)), 0.42, coat=0.08, subsurface=0.25, specular=0.4)
    mat.attach_textures(polyp_material, albedo=polyp_images["albedo"], roughness=polyp_images["roughness"], normal=polyp_images["normal"], normal_strength=0.5)
    material_map["polyp"] = polyp_material

    # ---- rig: static Base plus translated polyp cluster bones
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, 0.0), (0.012, 0.0, 0.0), deform=False)
    top_z = max(zs) * scale
    rb.bone("Base", (0.0, 0.0, 0.0), (0.0, 0.0, max(top_z * 0.5, 0.01)), "Root", roll_up=(1.0, 0.0, 0.0))
    bone_length = 0.004
    for b in layout.bones:
        roll_up = (1.0, 0.0, 0.0) if abs(b.direction.dot(UP)) > 0.9 else (0.0, 0.0, 1.0)
        rb.bone(b.name, tuple(b.head), tuple(b.head + b.direction * bone_length), "Base", roll_up=roll_up)
    rig = rb.finish()

    # ---- skeleton object (every vertex rigid to Base)
    skeleton_parts = []
    for solid in layout.solids:
        vertices, faces, uvs, face_uvs = solid.geometry
        geometry = ([S(v) for v in vertices], faces, uvs, face_uvs)
        part = msh.make_part(solid.name, geometry, solid.material, lambda i, v: {"Base": 1.0}, closed=True, groups=solid.groups,
                             uv_transform=solid.uv_transform)
        if solid.face_materials:
            part.face_materials = list(solid.face_materials)
        skeleton_parts.append(part)
    skeleton_obj = msh.assemble(f"{prefix}_Skeleton", skeleton_parts, material_map, rig, f"{prefix}_Armature", preserve_volume=False)
    skeleton_obj["lod"] = 1
    skeleton_obj["colonyWidthMeters"] = spec["referenceSize"]["meters"]

    # ---- polyp object
    polyp_parts = []
    cluster_ids = sorted({p.cluster for p in layout.polyps})
    for index, p in enumerate(layout.polyps):
        geometry = _polyp_geometry(p, pcfg)
        n = len(geometry[0])
        groups = {"polyp_root": set(range(POLYP_SEGMENTS)) | {3 * POLYP_SEGMENTS}, "polyp_all": set(range(n)), f"cl_{p.cluster:02d}": set(range(n))}
        polyp_parts.append(msh.make_part(f"polyp_{index:03d}", geometry, "polyp", _polyp_weight_fn(p, pcfg), closed=True, groups=groups))
    polyps_obj = msh.assemble(f"{prefix}_Polyps", polyp_parts, material_map, rig, f"{prefix}_Armature", preserve_volume=False)
    polyps_obj["lod"] = 1

    # ---- animation (cluster bones only; Base has no channel in any clip)
    clips = build_clips(spec, rig, layout.bones, pull, seed)
    mesh_objects = {skeleton_obj.name: skeleton_obj, polyps_obj.name: polyps_obj}
    for clip in clips:
        bake_clip(rig, clip, mesh_objects=mesh_objects)

    # ---- contract
    meshes = [skeleton_obj, polyps_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="xy", sample_stride=3)
    for solid in layout.solids:
        contract["closedParts"].append({"object": skeleton_obj.name, "group": f"part_{solid.name}", "volumeFloor": solid.volume_floor})
    for group_a, exclude_a, group_b, exclude_b, label in layout.pairs:
        entry_a = [skeleton_obj.name, group_a] + ([exclude_a] if exclude_a else [])
        entry_b = [skeleton_obj.name, group_b] + ([exclude_b] if exclude_b else [])
        contract["clearance"].append({"a": entry_a, "b": entry_b, "label": label})
    centroids = {}
    reach = {}
    for c in cluster_ids:
        members = [p for p in layout.polyps if p.cluster == c]
        centre = Vector((0.0, 0.0, 0.0))
        for p in members:
            centre += p.position
        centre /= len(members)
        centroids[c] = centre
        reach[c] = max((p.position - centre).length for p in members) + 0.004
        contract["clearance"].append({"a": [polyps_obj.name, f"cl_{c:02d}", "polyp_root"], "b": [skeleton_obj.name, "skeleton_all"], "label": f"polyps_{c:02d}_vs_skeleton"})
    for i, a in enumerate(cluster_ids):
        for b in cluster_ids[i + 1:]:
            if (centroids[a] - centroids[b]).length < reach[a] + reach[b]:
                contract["clearance"].append({"a": [polyps_obj.name, f"cl_{a:02d}", "polyp_root"], "b": [polyps_obj.name, f"cl_{b:02d}", "polyp_root"],
                                              "label": f"polyps_{a:02d}_vs_{b:02d}"})
    register_clips(contract, clips)

    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    notes = {
        "form": form, "seed": seed, "designExtentMeters": extent, "scale": scale, "polyps": len(layout.polyps), "clusterBones": len(layout.bones),
        "pullMeters": pull, "polypLengthMeters": [round(min(p.length for p in layout.polyps), 5), round(max(p.length for p in layout.polyps), 5)],
        "triangles": triangles, "clearancePairs": len(contract["clearance"]), **layout.notes,
    }
    print(f"[montipora] form={form} triangles={triangles} polyps={len(layout.polyps)} bones={len(rb.deform_names)} clearance={len(contract['clearance'])} scale={scale:.4f}")
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
