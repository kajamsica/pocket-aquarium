"""Stylophora pistillata (hood coral; aquarium "blueberry" morph): species-local body plan `branching_sps_coral`.

Anatomy choices (WoRMS 206982, Corals of the World factsheet, Coral Trait Database 1441, Malik et al. 2022; see
source-references.json). Source space: metres, up +Z, flow +X, origin base_center (the colony rests on z = 0).

- Rock plug (`part_rock`): closed dome loft, bare rock material, static.
- Colony base (`part_mound`): closed dome loft embedded in the rock, the thick submassive encrusting base from which
  the branches rise. Tissue covered (skeleton material) and carrying polyps of its own.
- Branches: stout closed tubes (8 to 15 mm thick after scaling) that fork dichotomously. A forking branch widens
  into an elliptical blade at the fork (the thick crotch of Stylophora forks) and its two children leave from the
  two ends of that blade. Terminal branches taper very little, swell slightly (club shaped) and end in a rounded
  knob (extra rings following a hemisphere). Every tube is closed locally: the shared `meshing.loft` cap fans are
  wound opposite to the side quads, so caps are added here with the side winding.
- Corallites: 0.5 to 1.5 mm calices with a coenosteal hood on the side facing the branch tip (WoRMS description) are
  painted into the tissue albedo / roughness / normal (cells noise; the hood is the pit mask shifted distally). The
  extended polyps are modelled as short four sided nubs (embedded base ring, flared crown ring, recessed mouth cap),
  one per ~5 mm of surface with seeded per polyp length, radius, tilt and spin: the modelled polyps are the
  prominent fraction of the real dense field, the texture speckle suggests the rest (listed as visual debt).
- USER RULE FOR STONY CORALS: the skeleton never moves. Every skeleton vertex is weighted 1.0 to `Base`, which has
  no animation channel in any clip. Only the polyps deform: each branch (and the mound) owns one cluster bone that
  runs along the branch axis from root to knob apex. A polyp's base ring stays with `Base`; its crown and mouth
  blend to the cluster bone with a per polyp weight chosen so that a perpendicular bone scale of `retractScale`
  pulls the crown exactly its own length toward the branch axis (retraction into the corallite). Bone location
  along the flow leans the crowns (sway / flow), a small scale oscillation pulses them, a small twist shimmers them.
- Clips: `sway` (idle loop), `flow` (locomotion loop: travelling downstream wave with a cumulative lean),
  `retract` (response, hold envelope: polyps pull into the corallites, then re-extend).

Everything derives from asset.source.json plus fixed seeds (noise.scalar_hash); no random, no time, no imagery.
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
from ..lib.noise import cells, fbm, scalar_hash, smoothstep
from ..lib.rigging import RigBuilder

UP = Vector((0.0, 0.0, 1.0))
FLOW = Vector((1.0, 0.0, 0.0))
GOLDEN_ANGLE = math.radians(137.50776)
TEXTURE_LENGTH_CM = 6.0  # branch tissue u axis spans this many design cm measured back from the apex

DEFAULTS = {
    "rock": {"radius": 3.5, "height": 1.05, "exponent": 2.3, "rimNoise": 0.09, "segments": 22, "rings": 5},
    "mound": {"radius": 2.45, "height": 1.55, "z0": 0.5, "exponent": 2.1, "rimNoise": 0.06, "segments": 22, "rings": 6},
    "primaries": 5, "primaryRootRadius": 1.3, "primaryElevation": 55.0, "primaryElevationJitter": 7.0,
    "primaryAzimuthJitter": 10.0, "primaryLength": 2.0, "primaryLengthJitter": 0.45, "primaryRadius": 0.6,
    "primaryRings": 5, "primaryCurl": 10.0,
    "leader": True, "leaderLength": 2.2, "leaderRadius": 0.55, "leaderElevation": 86.0,
    "secondaryLength": 2.3, "secondaryLengthJitter": 0.4, "secondaryRings": 6, "secondaryCurl": 16.0,
    "tertiaryProbability": 0.45, "tertiaryLength": 1.6, "tertiaryLengthJitter": 0.3, "tertiaryRings": 5, "tertiaryCurl": 14.0,
    "maxDepth": 3, "maxClusterBones": 31,
    "forkHalfAngle": 25.0, "forkHalfAngleJitter": 5.0, "forkEllipse": 1.42, "childRadiusFactor": 0.86,
    "taper": 0.92, "club": 1.06, "wobble": 2.5, "segments": 10,
    "knobPsis": [70.0, 48.0, 27.0, 10.0], "forkKnobPsis": [62.0, 35.0, 12.0],
    "embed": 0.3, "minGap": 0.22, "siblingGap": 0.05, "nearMargin": 1.0,
    "polyp": {
        "spacing": 0.28, "length": 0.10, "lengthJitter": 0.25, "radius": 0.038, "radiusJitter": 0.2, "flare": 1.1,
        "recess": 0.35, "embed": 0.03, "tilt": 8.0, "tiltJitter": 6.0, "segments": 4, "retractScale": 0.75,
        "knobPsiRange": [38.0, 82.0], "moundBand": [0.2, 0.78], "clearance": 0.05, "maxWeight": 0.95, "minWeight": 0.03,
    },
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


def jit(seed: int, *keys) -> float:
    """Deterministic jitter in [-1, 1]."""
    return 2.0 * scalar_hash(*_numeric_keys(keys), seed=seed) - 1.0


def hash01(seed: int, *keys) -> float:
    return scalar_hash(*_numeric_keys(keys), seed=seed)


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def sstep(value: float) -> float:
    value = clamp(value)
    return value * value * (3.0 - 2.0 * value)


def perpendicular_frame(direction: Vector):
    d = direction.normalized()
    n = UP if abs(d.dot(UP)) < 0.9 else Vector((0.0, 1.0, 0.0))
    n = (n - d * n.dot(d)).normalized()
    return n, d.cross(n).normalized()


def direction_from(azimuth_deg: float, elevation_deg: float) -> Vector:
    a, e = math.radians(azimuth_deg), math.radians(elevation_deg)
    return Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))


def rotate(vector: Vector, axis: Vector, angle: float) -> Vector:
    return Matrix.Rotation(angle, 3, axis.normalized()) @ vector


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


def ellipse_factor(theta: float, a: float) -> float:
    """Radius multiplier of an ellipse with semi-axes a (along theta = 0) and 1."""
    if a <= 1.0 + 1e-9:
        return 1.0
    c, s = math.cos(theta), math.sin(theta)
    return 1.0 / math.sqrt(c * c / (a * a) + s * s)


def close_caps(geometry, segments: int, ring_count: int, u_values, apex=None, base_center=None):
    """Close an open loft with centre-fan caps wound consistently with its side quads.

    The shared `meshing.loft` caps are wound opposite to the side quads (their normals point into the solid), so
    tubes and domes are closed here. Vertex order matches the shared helper: start centre first, end centre second.
    """
    vertices, faces, uvs, face_uvs = geometry
    vertices = list(vertices)
    faces = list(faces)
    uvs = list(uvs)
    face_uvs = list(face_uvs)

    def add_cap(ring: int, reverse: bool, centre):
        base = ring * segments
        if centre is None:
            centre = tuple(sum(vertices[base + s][i] for s in range(segments)) / segments for i in range(3))
        centre_index = len(vertices)
        vertices.append(tuple(centre))
        uvs.append((u_values[ring], 0.5))
        for s in range(segments):
            nxt = (s + 1) % segments
            uv_s = (u_values[ring], s / segments)
            uv_n = (u_values[ring], (s + 1) / segments)
            if reverse:
                faces.append((centre_index, base + nxt, base + s))
                face_uvs.append(((u_values[ring], 0.5), uv_n, uv_s))
            else:
                faces.append((centre_index, base + s, base + nxt))
                face_uvs.append(((u_values[ring], 0.5), uv_s, uv_n))

    add_cap(0, False, base_center)
    add_cap(ring_count - 1, True, apex)
    return vertices, faces, uvs, face_uvs


# ---------------------------------------------------------------- skeleton nodes

@dataclass
class Node:
    """One solid of the skeleton: a dome (rock, mound) or a branch tube."""

    name: str
    kind: str  # dome | tube
    material: str = "skeleton"
    parent: "Node | None" = None
    depth: int = 0
    points: list = field(default_factory=list)
    radii: list = field(default_factory=list)
    segments: int = 10
    dome: tuple = ()  # (radius, height, exponent, rim_noise, z0)
    spread: object = None  # fork spread direction (Vector) for forked branches
    ellipse: float = 1.0
    terminal: bool = True
    knob_psis: list = field(default_factory=list)
    frames: list = field(default_factory=list)
    cumulative: list = field(default_factory=list)
    theta_spread: float = 0.0
    apex: object = None
    geometry: tuple = ()
    attach: set = field(default_factory=set)
    exit_length: float = 0.0
    bone: str | None = None
    polyps: list = field(default_factory=list)

    # ---- shaft parameterisation

    @property
    def length(self) -> float:
        return self.cumulative[-1] if self.cumulative else 0.0

    @property
    def end(self) -> Vector:
        return self.points[-1]

    @property
    def tangent_end(self) -> Vector:
        return (self.points[-1] - self.points[-2]).normalized()

    def a_at(self, t: float) -> float:
        """Ellipse factor along the shaft (t in [0, 1]); ramps up over the distal half of a forking branch."""
        return 1.0 + (self.ellipse - 1.0) * sstep((t - 0.45) / 0.55)

    def sample(self, arc: float):
        """(centre, tangent, normal, binormal, radius, ellipse) at arc length `arc` along the shaft."""
        arc = clamp(arc, 0.0, self.length)
        index = 0
        while index < len(self.cumulative) - 2 and self.cumulative[index + 1] < arc:
            index += 1
        span = max(self.cumulative[index + 1] - self.cumulative[index], 1e-9)
        t = clamp((arc - self.cumulative[index]) / span)
        centre = self.points[index].lerp(self.points[index + 1], t)
        radius = self.radii[index] + (self.radii[index + 1] - self.radii[index]) * t
        tangent, normal, binormal = self.frames[index]
        t2, n2, b2 = self.frames[index + 1]
        tangent = (tangent.lerp(t2, t)).normalized()
        normal = (normal.lerp(n2, t))
        normal = (normal - tangent * normal.dot(tangent)).normalized()
        binormal = tangent.cross(normal).normalized()
        return centre, tangent, normal, binormal, radius, self.a_at(arc / max(self.length, 1e-9))

    # ---- geometry queries (design cm)

    def dome_surface_radius(self, z: float) -> float:
        radius, height, exponent, _noise, z0 = self.dome
        z_frac = clamp((z - z0) / height)
        return radius * max(1.0 - z_frac ** exponent, 0.0) ** (1.0 / exponent)

    def signed_gap(self, p: Vector) -> float:
        """Approximate distance from p to the solid surface (negative inside)."""
        if self.kind == "dome":
            radius, height, exponent, _noise, z0 = self.dome
            rho = math.hypot(p.x, p.y)
            if p.z < z0:
                return max(rho - radius, z0 - p.z)
            if p.z > z0 + height:
                return max(rho - self.dome_surface_radius(z0 + height), p.z - (z0 + height))
            return rho - self.dome_surface_radius(p.z)
        best = 1e9
        for i, (a, b) in enumerate(zip(self.points, self.points[1:])):
            ab = b - a
            t = clamp((p - a).dot(ab) / max(ab.length_squared, 1e-12))
            d = (p - (a + ab * t)).length
            ra = self.radii[i] * self.a_at(self.cumulative[i] / max(self.length, 1e-9))
            rb = self.radii[i + 1] * self.a_at(self.cumulative[i + 1] / max(self.length, 1e-9))
            best = min(best, d - (ra + (rb - ra) * t))
        knob_r = self.radii[-1] * self.ellipse
        best = min(best, (p - self.end).length - knob_r)
        return best

    def inside(self, p: Vector, margin: float) -> bool:
        return self.signed_gap(p) < margin


def build_node_frames(node: Node):
    node.frames = msh.frames_along([tuple(p) for p in node.points])
    cumulative = [0.0]
    for a, b in zip(node.points, node.points[1:]):
        cumulative.append(cumulative[-1] + (b - a).length)
    node.cumulative = cumulative
    if node.spread is not None:
        _t, normal, binormal = node.frames[-1]
        node.theta_spread = math.atan2(node.spread.dot(binormal), node.spread.dot(normal))
    node.apex = node.end + node.tangent_end * node.radii[-1]


def ring_points(centre: Vector, normal: Vector, binormal: Vector, radius: float, a: float, theta_s: float, segments: int):
    ring = []
    for s in range(segments):
        theta = s / segments * math.tau
        f = ellipse_factor(theta - theta_s, a)
        ring.append(tuple(centre + (normal * math.cos(theta) + binormal * math.sin(theta)) * (radius * f)))
    return ring


def make_branch(node: Node):
    """Closed tube along the shaft points with an elliptical fork blade (forked) or a rounded knob (terminal)."""
    seg = node.segments
    rings, u_values = [], []
    total = node.length + node.radii[-1]
    for i, point in enumerate(node.points):
        tangent, normal, binormal = node.frames[i]
        t = node.cumulative[i] / max(node.length, 1e-9)
        rings.append(ring_points(point, normal, binormal, node.radii[i], node.a_at(t), node.theta_spread, seg))
        u_values.append(clamp(0.94 - 0.94 * (total - node.cumulative[i]) / TEXTURE_LENGTH_CM, 0.02, 0.94))
    tangent, normal, binormal = node.frames[-1]
    tangent = node.tangent_end
    r = node.radii[-1]
    for psi_deg in node.knob_psis:
        psi = math.radians(psi_deg)
        centre = node.end + tangent * (r * math.cos(psi))
        rings.append(ring_points(centre, normal, binormal, r * math.sin(psi), node.ellipse, node.theta_spread, seg))
        u_values.append(clamp(0.94 - 0.94 * (total - node.length - r * math.cos(psi)) / TEXTURE_LENGTH_CM, 0.02, 0.94))
    geometry = msh.loft(rings, u_values=u_values, cap_start=False, cap_end=False)
    geometry = close_caps(geometry, seg, len(rings), u_values, apex=tuple(node.apex))
    node.geometry = geometry
    return geometry


def make_dome(node: Node, seed: int, rings: int, u_range):
    radius, height, exponent, rim_noise, z0 = node.dome
    ring_list, u_values = [], []
    for k in range(rings):
        t = k / (rings - 1)
        h = height * (t ** 1.25) * 0.94
        base_r = radius * (1.0 - (h / height) ** exponent) ** (1.0 / exponent)
        ring = []
        for segment in range(node.segments):
            angle = segment / node.segments * math.tau
            wobble = 1.0 + rim_noise * (0.6 * math.sin(3.0 * angle + 0.7 + t * 2.0) + 0.4 * jit(seed, node.name, "dome", k, segment))
            ring.append((math.cos(angle) * base_r * wobble, math.sin(angle) * base_r * wobble, z0 + h))
        ring_list.append(ring)
        u_values.append(u_range[0] + (u_range[1] - u_range[0]) * t)
    geometry = msh.loft(ring_list, u_values=u_values, cap_start=False, cap_end=False)
    geometry = close_caps(geometry, node.segments, rings, u_values, apex=(0.0, 0.0, z0 + height))
    node.geometry = geometry
    node.apex = Vector((0.0, 0.0, z0 + height))
    return geometry


def compute_exit(node: Node):
    """Arc length at which the shaft centre line first clears the parent solid."""
    if node.parent is None:
        node.exit_length = 0.0
        return
    steps = max(int(node.length / 0.08), 4)
    for k in range(steps + 1):
        arc = node.length * k / steps
        centre, _t, _n, _b, radius, _a = node.sample(arc)
        if not node.parent.inside(centre, radius * 0.85):
            node.exit_length = arc
            return
    node.exit_length = node.length * 0.5


def attach_group(node: Node) -> set[int]:
    """Vertices that sit inside (or hug) the parent solid: excluded from clearance checks."""
    if node.parent is None:
        return set()
    margin = 0.18 if node.parent.kind == "tube" else 0.25
    hosts = [node.parent]
    if node.parent.kind == "dome" and node.parent.parent is not None:
        hosts.append(node.parent.parent)  # the mound sits in the rock; a root ring may hug both
    return {index for index, vertex in enumerate(node.geometry[0]) if any(host.inside(Vector(vertex), margin) for host in hosts)}


# ---------------------------------------------------------------- colony layout (design units: cm)

def capsules(node: Node, skip_first: bool):
    """Conservative capsule cover of a tube node (shaft segments plus the knob sphere)."""
    out = []
    n = len(node.points)
    for i in range(n - 1):
        if skip_first and i == 0:
            continue
        ta = i / (n - 1)
        tb = (i + 1) / (n - 1)
        radius = max(node.radii[i] * node.a_at(ta), node.radii[i + 1] * node.a_at(tb))
        out.append((node.points[i], node.points[i + 1], radius))
    out.append((node.end, node.end, node.radii[-1] * node.ellipse))
    return out


def node_gap(a: Node, b: Node, skip_first_a: bool = False, skip_first_b: bool = False) -> float:
    """Smallest surface gap between two nodes (negative when they overlap)."""
    if a.kind == "dome" and b.kind == "dome":
        return 1e9
    if a.kind == "dome":
        a, b = b, a
        skip_first_a, skip_first_b = skip_first_b, skip_first_a
    if b.kind == "dome":
        best = 1e9
        for p, q, radius in capsules(a, skip_first_a):
            for k in range(6):
                point = p.lerp(q, k / 5)
                best = min(best, b.signed_gap(point) - radius)
        return best
    best = 1e9
    for p1, q1, r1 in capsules(a, skip_first_a):
        for p2, q2, r2 in capsules(b, skip_first_b):
            best = min(best, segment_distance(p1, q1, p2, q2) - r1 - r2)
    return best


def pair_gap(a: Node, b: Node) -> float:
    siblings = a.parent is not None and a.parent is b.parent
    return node_gap(a, b, skip_first_a=siblings, skip_first_b=siblings)


def shaft_radii(r0: float, rings: int, taper: float, club: float, terminal: bool) -> list[float]:
    radii = []
    for index in range(rings):
        s = index / (rings - 1)
        radii.append(r0 * (1.0 - (1.0 - taper) * s))
    if terminal:
        radii[-1] *= club
        if rings > 2:
            radii[-2] *= 1.0 + (club - 1.0) * 0.5
    return radii


class Layout:
    def __init__(self, P: dict, seed: int):
        self.P = P
        self.seed = seed
        self.nodes: list[Node] = []
        self.counter = 0

    def dome_surface_point(self, node: Node, azimuth_deg: float, rho: float) -> Vector:
        radius, height, exponent, _noise, z0 = node.dome
        z = z0 + height * (1.0 - clamp(rho / radius) ** exponent) ** (1.0 / exponent)
        a = math.radians(azimuth_deg)
        return Vector((math.cos(a) * rho, math.sin(a) * rho, z))

    def make_tube(self, parent: Node, depth: int, root: Vector, direction: Vector, length: float, r0: float, rings: int,
                  curl: float, key) -> Node:
        P = self.P
        points = grow(root, direction, length, rings, curl, P["wobble"], self.seed, key)
        node = Node(f"branch_{self.counter:02d}", "tube", parent=parent, depth=depth, points=points, segments=int(P["segments"]))
        node.radii = shaft_radii(r0, rings, P["taper"], P["club"], True)
        node.knob_psis = list(P["knobPsis"])
        self.counter += 1
        return node

    def tentative_children(self, parent: Node, spread: Vector, length: float, depth: int, rings: int, curl: float, key):
        P = self.P
        tangent = (parent.points[-1] - parent.points[-2]).normalized()
        axis = tangent.cross(spread).normalized()
        half = math.radians(P["forkHalfAngle"] + P["forkHalfAngleJitter"] * jit(self.seed, key, "half"))
        r_parent = parent.radii[-1]
        a = P["forkEllipse"]
        r_child = r_parent * P["childRadiusFactor"]
        offset = max(a * r_parent - r_child, 0.0)
        children = []
        for side, sign in (("a", 1.0), ("b", -1.0)):
            direction = rotate(tangent, axis, sign * half * (1.0 + 0.12 * jit(self.seed, key, side, "asym")))
            root = parent.points[-1] - tangent * (P["embed"] * r_parent) + spread * (sign * offset)
            child_length = length * (1.0 + 0.5 * P["secondaryLengthJitter"] / max(length, 1e-9) * jit(self.seed, key, side, "len"))
            children.append(self.make_tube(parent, depth, root, direction, child_length, r_child, rings, curl, (key, side)))
        return children

    def score(self, children: list[Node], parent: Node) -> tuple[float, float]:
        P = self.P
        worst = 1e9
        for child in children:
            for other in self.nodes:
                if other is parent:
                    continue
                gap = node_gap(child, other, skip_first_a=(other.parent is parent))
                worst = min(worst, gap)
        sibling = node_gap(children[0], children[1], True, True) - P["siblingGap"] + P["minGap"]
        worst = min(worst, sibling)
        tips_z = min(child.points[-1].z for child in children)
        bonus = 0.12 * tips_z - 0.4 * max(0.0, 1.6 - tips_z)
        return worst, bonus

    def fork(self, parent: Node, depth: int):
        """Dichotomous fork at the parent's tip; chooses the spread direction with the most clearance."""
        P = self.P
        if depth > int(P["maxDepth"]):
            return
        if depth == 3 and hash01(self.seed, "fork3", parent.name) > P["tertiaryProbability"]:
            return
        if depth == 2:
            length, rings, curl = P["secondaryLength"], int(P["secondaryRings"]), P["secondaryCurl"]
        else:
            length, rings, curl = P["tertiaryLength"], int(P["tertiaryRings"]), P["tertiaryCurl"]
        length += (P["secondaryLengthJitter"] if depth == 2 else P["tertiaryLengthJitter"]) * jit(self.seed, "flen", parent.name)
        tangent = (parent.points[-1] - parent.points[-2]).normalized()
        radial = Vector((parent.points[-1].x, parent.points[-1].y, 0.0))
        tangential = UP.cross(radial).normalized() if radial.length > 1e-6 else Vector((0.0, 1.0, 0.0))
        s0 = tangential - tangent * tangential.dot(tangent)
        if s0.length < 1e-6:
            s0 = perpendicular_frame(tangent)[0]
        s0.normalize()
        base_psi = math.radians(18.0) * jit(self.seed, "fpsi", parent.name)
        best = None
        for length_scale in (1.0, 0.85, 0.7):
            for psi_deg in (0.0, 20.0, -20.0, 40.0, -40.0, 60.0, -60.0, 80.0, -80.0, 10.0, -10.0, 30.0, -30.0, 50.0, -50.0, 70.0, -70.0, 90.0):
                spread = rotate(s0, tangent, base_psi + math.radians(psi_deg))
                saved = self.counter
                children = self.tentative_children(parent, spread, length * length_scale, depth, rings, curl, (parent.name, psi_deg, length_scale))
                worst, bonus = self.score(children, parent)
                self.counter = saved
                candidate = (worst + bonus, worst, spread, children)
                if best is None or candidate[0] > best[0]:
                    best = candidate
            if best is not None and best[1] >= P["minGap"]:
                break
        if best is None or best[1] < P["minGap"]:
            print(f"[stylophora] {parent.name}: fork dropped (best gap {best[1]:+.3f} cm)" if best else f"[stylophora] {parent.name}: fork dropped")
            return
        _score, worst, spread, children = best
        parent.terminal = False
        parent.spread = spread
        parent.ellipse = P["forkEllipse"]
        parent.knob_psis = list(P["forkKnobPsis"])
        parent.radii = shaft_radii(parent.radii[0], len(parent.radii), P["taper"], P["club"], False)
        for child in children:
            child.name = f"branch_{self.counter:02d}"
            self.counter += 1
            self.nodes.append(child)
        print(f"[stylophora] {parent.name} forks into {children[0].name}, {children[1].name} (gap {worst:+.3f} cm)")
        for child in children:
            self.fork(child, depth + 1)

    def build(self) -> list[Node]:
        P = self.P
        rock_cfg, mound_cfg = P["rock"], P["mound"]
        rock = Node("rock", "dome", material="rock", segments=int(rock_cfg["segments"]),
                    dome=(rock_cfg["radius"], rock_cfg["height"], rock_cfg["exponent"], rock_cfg["rimNoise"], 0.0))
        mound = Node("mound", "dome", material="skeleton", parent=rock, segments=int(mound_cfg["segments"]),
                     dome=(mound_cfg["radius"], mound_cfg["height"], mound_cfg["exponent"], mound_cfg["rimNoise"], mound_cfg["z0"]))
        self.nodes = [rock, mound]
        count = int(P["primaries"])
        primaries = []
        for i in range(count):
            azimuth = 360.0 * i / count + P["primaryAzimuthJitter"] * jit(self.seed, "paz", i)
            elevation = P["primaryElevation"] + P["primaryElevationJitter"] * jit(self.seed, "pel", i)
            root = self.dome_surface_point(mound, azimuth, P["primaryRootRadius"]) - UP * (P["embed"] * 1.3)
            length = P["primaryLength"] + P["primaryLengthJitter"] * jit(self.seed, "plen", i)
            radius = P["primaryRadius"] * (1.0 + 0.08 * jit(self.seed, "prad", i))
            node = self.make_tube(mound, 1, root, direction_from(azimuth + 6.0 * jit(self.seed, "pdir", i), elevation), length, radius,
                                  int(P["primaryRings"]), P["primaryCurl"], ("primary", i))
            self.nodes.append(node)
            primaries.append(node)
        if P["leader"]:
            root = Vector((0.0, 0.0, mound_cfg["z0"] + mound_cfg["height"] - P["embed"] * 1.3))
            node = self.make_tube(mound, 1, root, direction_from(200.0 + 60.0 * jit(self.seed, "laz"), P["leaderElevation"]), P["leaderLength"],
                                  P["leaderRadius"], int(P["primaryRings"]), 4.0, "leader")
            self.nodes.append(node)
            primaries.append(node)
        for node in primaries:
            self.fork(node, 2)
        return self.nodes


def check_layout(nodes: list[Node], P: dict) -> dict:
    """Final capsule gaps between every pair of tube nodes; raises when the layout is too tight."""
    tubes = [n for n in nodes if n.kind == "tube"]
    gaps = {}
    tight = []
    for i, a in enumerate(tubes):
        for b in tubes[i + 1:]:
            if a.parent is b or b.parent is a:
                continue
            gap = pair_gap(a, b)
            gaps[tuple(sorted((a.name, b.name)))] = gap
            siblings = a.parent is b.parent
            if gap < (P["siblingGap"] if siblings else P["minGap"]):
                tight.append((gap, a.name, b.name))
    for a in tubes:
        for dome in nodes:
            if dome.kind != "dome" or a.parent is dome:
                continue
            # a branch rooted in the mound starts inside the mound, just above the rock: its first segment is the junction
            gap = node_gap(a, dome, skip_first_a=(a.parent is not None and a.parent.parent is dome))
            gaps[tuple(sorted((a.name, dome.name)))] = gap
            if gap < P["minGap"]:
                tight.append((gap, a.name, dome.name))
    tight.sort()
    if tight:
        raise ValueError("Branch layout too tight: " + ", ".join(f"{na}/{nb} {gap:.3f}" for gap, na, nb in tight[:8]))
    return gaps


# ---------------------------------------------------------------- polyps

@dataclass
class Polyp:
    base: Vector
    axis: Vector
    length: float
    radius: float
    spin: float
    weight: float


def bone_axis_of(node: Node):
    if node.kind == "dome":
        _r, _h, _e, _n, z0 = node.dome
        return Vector((0.0, 0.0, z0)), UP
    head = node.points[0]
    return head, (node.apex - head).normalized()


def perpendicular_distance(p: Vector, head: Vector, axis: Vector) -> float:
    rel = p - head
    return (rel - axis * rel.dot(axis)).length


def place_polyps(node: Node, nodes: list[Node], P: dict, seed: int, travel: dict) -> list[Polyp]:
    """Seeded spiral of polyps over a node's surface; candidates whose extended or leaning crown would reach another
    solid are dropped so the validator can prove every polyp cluster clear of every other skeleton part."""
    pp = P["polyp"]
    cell = pp["spacing"] * pp["spacing"] * 0.866
    others = [other for other in nodes if other is not node]
    head, bone_dir = bone_axis_of(node)
    candidates = []  # (base, axis, key)
    if node.kind == "tube":
        l_start = node.exit_length + 0.2
        l_end = node.length if node.terminal else node.length - 0.35 * node.radii[-1]
        if l_end > l_start:
            r_mean = 0.5 * (node.sample(l_start)[4] + node.sample(l_end)[4])
            area = (l_end - l_start) * math.tau * r_mean * (1.0 + (node.ellipse - 1.0) * 0.25)
            count = int(round(area / cell))
            for k in range(count):
                arc = l_start + (l_end - l_start) * (k + 0.5 + 0.3 * jit(seed, node.name, "pl", k)) / count
                theta = k * GOLDEN_ANGLE + 0.5 * jit(seed, node.name, "pth", k)
                centre, tangent, normal, binormal, radius, a = node.sample(arc)
                f = ellipse_factor(theta - node.theta_spread, a)
                radial = (normal * math.cos(theta) + binormal * math.sin(theta)).normalized()
                tilt = math.radians(pp["tilt"] + pp["tiltJitter"] * jit(seed, node.name, "ptilt", k))
                axis = (radial * math.cos(tilt) + tangent * math.sin(tilt)).normalized()
                candidates.append((centre + radial * (radius * f), axis, ("shaft", k)))
        if node.terminal:
            psi_min, psi_max = (math.radians(v) for v in pp["knobPsiRange"])
            r = node.radii[-1]
            tangent = node.tangent_end
            _t, normal, binormal = node.frames[-1]
            area = math.tau * r * r * (math.cos(psi_min) - math.cos(psi_max))
            count = int(round(area / cell))
            for k in range(count):
                cos_psi = math.cos(psi_min) - (math.cos(psi_min) - math.cos(psi_max)) * (k + 0.5) / count
                psi = math.acos(clamp(cos_psi, -1.0, 1.0))
                theta = k * GOLDEN_ANGLE + 1.3 + 0.5 * jit(seed, node.name, "kth", k)
                radial = (normal * math.cos(theta) + binormal * math.sin(theta)).normalized()
                direction = (tangent * math.cos(psi) + radial * math.sin(psi)).normalized()
                candidates.append((node.end + direction * r, direction, ("knob", k)))
    else:
        radius, height, exponent, _noise, z0 = node.dome
        t0, t1 = pp["moundBand"]
        area = math.tau * radius * height * (t1 - t0) * 0.8
        count = int(round(area / cell))
        for k in range(count):
            t = t0 + (t1 - t0) * (k + 0.5 + 0.3 * jit(seed, node.name, "mt", k)) / count
            theta = k * GOLDEN_ANGLE + 0.5 * jit(seed, node.name, "mth", k)
            z = z0 + height * t
            rho = node.dome_surface_radius(z)
            base = Vector((math.cos(theta) * rho, math.sin(theta) * rho, z))
            # gradient of (rho/R)^e + ((z - z0)/H)^e = 1
            g_rho = exponent * (rho / radius) ** (exponent - 1.0) / radius
            g_z = exponent * (t ** (exponent - 1.0)) / height
            axis = (Vector((math.cos(theta), math.sin(theta), 0.0)) * g_rho + UP * g_z).normalized()
            candidates.append((base, axis, ("mound", k)))

    out = []
    dropped = 0
    for base, axis, key in candidates:
        length = pp["length"] * (1.0 + pp["lengthJitter"] * jit(seed, node.name, key, "len"))
        radius = pp["radius"] * (1.0 + pp["radiusJitter"] * jit(seed, node.name, key, "rad"))
        tip = base + axis * length
        d_tip = perpendicular_distance(tip, head, bone_dir)
        weight = clamp(length / (pp["retractScale"] * max(d_tip, 1e-6)), pp["minWeight"], pp["maxWeight"])
        lean = weight * travel["lean"]
        margin = radius * 1.3 + pp["clearance"]
        probes = [base, tip, tip + axis * (length * travel["pulse"]),
                  tip + FLOW * lean, tip - FLOW * lean, tip + Vector((0.0, lean, 0.0)), tip - Vector((0.0, lean, 0.0))]
        if any(other.inside(p, margin) for other in others for p in probes):
            dropped += 1
            continue
        out.append(Polyp(base, axis, length, radius, math.tau * hash01(seed, node.name, key, "spin"), weight))
    if dropped:
        print(f"[stylophora] {node.name}: {len(out)} polyps placed, {dropped} dropped near neighbouring solids")
    return out


def polyp_geometry(polyp: Polyp, pp: dict):
    """Four sided nub: embedded base ring, flared crown ring, recessed mouth cap. Faces are wound outward
    explicitly (base ring counter-clockwise about the polyp axis)."""
    seg = int(pp["segments"])
    e1, e2 = perpendicular_frame(polyp.axis)
    e1, e2 = rotate(e1, polyp.axis, polyp.spin), rotate(e2, polyp.axis, polyp.spin)
    base_centre = polyp.base - polyp.axis * pp["embed"]
    crown_centre = polyp.base + polyp.axis * polyp.length
    mouth = polyp.base + polyp.axis * (polyp.length * (1.0 - pp["recess"]))
    vertices, uvs, faces, face_uvs = [], [], [], []
    for centre, radius, u in ((base_centre, polyp.radius, 0.0), (crown_centre, polyp.radius * pp["flare"], 1.0)):
        for s in range(seg):
            theta = s / seg * math.tau
            vertices.append(tuple(centre + (e1 * math.cos(theta) + e2 * math.sin(theta)) * radius))
            uvs.append((u, s / seg))
    for s in range(seg):
        nxt = (s + 1) % seg
        faces.append((s, nxt, seg + nxt, seg + s))
        face_uvs.append(((0.0, s / seg), (0.0, (s + 1) / seg), (1.0, (s + 1) / seg), (1.0, s / seg)))
    centre_index = len(vertices)
    vertices.append(tuple(mouth))
    uvs.append((1.0, 0.5))
    for s in range(seg):
        nxt = (s + 1) % seg
        faces.append((centre_index, seg + s, seg + nxt))
        face_uvs.append(((1.0, 0.5), (1.0, s / seg), (1.0, (s + 1) / seg)))
    weights = [0.0] * seg + [polyp.weight] * (seg + 1)
    return (vertices, faces, uvs, face_uvs), weights


def concat_geometry(pieces):
    vertices, faces, uvs, face_uvs = [], [], [], []
    for v, f, u, fu in pieces:
        offset = len(vertices)
        vertices.extend(v)
        faces.extend(tuple(i + offset for i in face) for face in f)
        uvs.extend(u)
        face_uvs.extend(fu)
    return vertices, faces, uvs, face_uvs


# ---------------------------------------------------------------- textures

def _lighter(color, amount=0.35):
    return tuple(min(1.0, c * (1.0 + amount) + 0.04) for c in color)


def _darker(color, amount=0.55):
    return tuple(c * (1.0 - amount) for c in color)


def paint_tissue(palette: dict, width: int, height: int, seed: int, normal_strength: float):
    """Tissue covered skeleton: corallite pits with distal hoods, spinule grain, paler branch tips, polyp speckle."""
    U, V = textures.uv_grid(width, height)
    Vm = 0.5 - np.abs(V - 0.5)  # mirrored around the tube so the UV seam is invisible
    shape = U.shape
    body, tip, calice, polyp = palette["body"], palette["tip"], palette["calice"], palette["polyp"]
    hood_color = palette.get("hood", _lighter(body, 0.22))
    mottle = fbm(U * 7.0, Vm * 5.0, octaves=3, seed=seed + 1)
    grain = fbm(U * 150.0, Vm * 75.0, octaves=2, seed=seed + 2)
    d, _cid = cells(U * 52.0, Vm * 26.0, seed=seed + 3)
    pit = 1.0 - smoothstep(0.15, 0.27, d)
    core = 1.0 - smoothstep(0.0, 0.10, d)
    # the hood is the calice mask shifted a quarter cell toward the branch tip (+u): a crescent on the distal rim
    d_shift, _ = cells((U - 0.0044) * 52.0, Vm * 26.0, seed=seed + 3)
    hood = np.clip((1.0 - smoothstep(0.17, 0.29, d_shift)) - pit, 0.0, 1.0)
    tip_mask = smoothstep(0.72, 0.93, U)
    albedo = textures.rgba(body, 1.0, shape)
    albedo = textures.scale_rgb(albedo, 0.86 + 0.28 * mottle)
    albedo = textures.mix(albedo, _lighter(body, 0.18), 0.35 * smoothstep(0.55, 0.85, grain))
    albedo = textures.mix(albedo, tip, tip_mask * (0.82 + 0.18 * mottle))
    albedo = textures.mix(albedo, hood_color, hood * 0.7)
    albedo = textures.mix(albedo, calice, pit * 0.6)
    albedo = textures.mix(albedo, polyp, core * float(palette.get("fuzz", 0.7)))
    height_field = np.clip(0.5 + 0.06 * (mottle - 0.5) + 0.05 * (grain - 0.5) - 0.26 * pit + 0.22 * hood + 0.08 * core, 0.0, 1.0)
    roughness = np.clip(0.66 + 0.10 * (grain - 0.5) + 0.14 * pit - 0.06 * tip_mask - 0.12 * core, 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, normal_strength)}


def paint_polyp(palette: dict, width: int, height: int, seed: int):
    U, V = textures.uv_grid(width, height)
    shape = U.shape
    body, polyp, tip = palette["body"], palette["polyp"], palette["polypTip"]
    stem = tuple(0.45 * b + 0.55 * p for b, p in zip(body, polyp))
    grain = fbm(U * 10.0, V * 3.0, octaves=2, seed=seed + 5)
    albedo = textures.rgba(stem, 1.0, shape)
    albedo = textures.mix(albedo, polyp, smoothstep(0.2, 0.62, U))
    albedo = textures.mix(albedo, tip, smoothstep(0.78, 0.98, U))
    grooves = (0.5 + 0.5 * np.cos(V * math.tau * 6.0)) * smoothstep(0.6, 1.0, U)
    albedo = textures.scale_rgb(albedo, (0.92 + 0.16 * grain) * (1.0 - 0.14 * grooves))
    roughness = 0.42 + 0.1 * (grain - 0.5) + 0.05 * grooves
    height_field = 0.5 + 0.08 * (grain - 0.5) - 0.06 * grooves
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, 0.5)}


def paint_rock(palette: dict, width: int, height: int, seed: int):
    U, V = textures.uv_grid(width, height)
    Vm = 0.5 - np.abs(V - 0.5)
    shape = U.shape
    rock, algae, coralline = palette["rock"], palette["algae"], palette.get("coralline", (0.46, 0.18, 0.34))
    coarse = fbm(U * 4.0, Vm * 14.0, octaves=4, seed=seed + 7)
    cracks = smoothstep(0.6, 0.72, fbm(U * 8.0, Vm * 24.0, octaves=3, seed=seed + 8))
    pit_d, _ = cells(U * 12.0, Vm * 40.0, seed=seed + 9)
    pits = 1.0 - smoothstep(0.12, 0.3, pit_d)
    albedo = textures.rgba(rock, 1.0, shape)
    albedo = textures.scale_rgb(albedo, 0.72 + 0.56 * coarse - 0.22 * pits)
    albedo = textures.mix(albedo, _darker(rock, 0.6), cracks * 0.7)
    algae_mask = smoothstep(0.5, 0.72, fbm(U * 3.0, Vm * 10.0, octaves=3, seed=seed + 10)) * (1.0 - smoothstep(0.55, 0.85, U))
    albedo = textures.mix(albedo, algae, algae_mask * 0.6)
    coralline_mask = smoothstep(0.58, 0.72, fbm(U * 2.5 + 1.0, Vm * 9.0 + 3.0, octaves=3, seed=seed + 11))
    albedo = textures.mix(albedo, coralline, coralline_mask * 0.75)
    height_field = np.clip(0.5 + 0.25 * (coarse - 0.5) - 0.3 * cracks - 0.2 * pits, 0.0, 1.0)
    roughness = np.clip(0.9 - 0.15 * coralline_mask + 0.06 * (coarse - 0.5), 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, 1.4)}


def write_set(prefix: str, texture_dir, stem: str, paint: dict, written: list):
    images = {}
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = texture_dir / f"{stem}-{key}.png"
        images[key] = textures.write_image(f"{prefix}_{stem}_{key}", path, paint[key], non_color)
        written.append(path)
    return images


# ---------------------------------------------------------------- animation

def key_every_kind(channels: list[Channel], envelope: str | None) -> list[Channel]:
    """Every animated bone keys rotation, location and scale in every clip; a clip that keys only some kinds would
    inherit the previous clip's pose for the rest when the validator plays clips back to back."""
    kinds_by_bone: dict[str, set[str]] = {}
    for channel in channels:
        kinds_by_bone.setdefault(channel.target, set()).add(channel.kind)
    padded = list(channels)
    for bone in sorted(kinds_by_bone):
        for kind in ("rotation", "location", "scale"):
            if kind not in kinds_by_bone[bone]:
                padded.append(Channel(bone, kind, (0.0, 1.0, 0.0), 0.0, 1.0, 0.0, "const", envelope=envelope))
    return padded


def build_clips(spec: dict, rig, cluster_bones: list[str], bone_x: dict, seed: int, scale: float, retract_scale: float) -> list[ClipSpec]:
    def local_axis(bone: str, world_axis) -> tuple:
        m3 = rig.data.bones[bone].matrix_local.to_3x3()
        local = m3.transposed() @ Vector(world_axis)
        return tuple(local.normalized())

    clips = []
    for name, clip in spec["animation"].items():
        loop = bool(clip["loop"])
        env = None if loop else clip.get("envelope", "hold")
        lean = float(clip.get("lean", 0.0)) * scale
        lean_bias = float(clip.get("leanBias", 0.0)) * scale
        wobble = float(clip.get("wobble", 0.0)) * scale
        pulse = float(clip.get("pulse", 0.0)) * retract_scale
        retract = float(clip.get("retract", 0.0)) * retract_scale
        twist = float(clip.get("twist", 0.0))
        wave_number = float(clip.get("waveNumber", 0.0))
        spread = float(clip.get("phaseSpread", 0.0))
        channels: list[Channel] = []
        for index, bone in enumerate(cluster_bones):
            phase = -wave_number * bone_x[bone] + 0.9 * index * spread + 0.6 * jit(seed, name, "phase", bone)
            gain = 1.0 + 0.25 * jit(seed, "gain", bone)
            if lean or lean_bias:
                channels.append(Channel(bone, "location", local_axis(bone, FLOW), lean * gain, float(clip.get("leanFrequency", 1)), phase,
                                        bias=lean_bias * gain, envelope=env))
            if wobble:
                channels.append(Channel(bone, "location", local_axis(bone, (0.0, 1.0, 0.0)), wobble * gain, float(clip.get("wobbleFrequency", 2)),
                                        phase + 1.3, envelope=env))
            if pulse:
                channels.append(Channel(bone, "scale", (1.0, 0.0, 1.0), pulse * gain, float(clip.get("pulseFrequency", 1)), phase + 0.7,
                                        bias=-pulse * gain, envelope=env))
            if retract:
                channels.append(Channel(bone, "scale", (1.0, 0.0, 1.0), -retract * (1.0 - 0.06 * hash01(seed, "ret", bone)), 1.0, 0.0, "const",
                                        envelope=env))
            if twist:
                channels.append(Channel(bone, "rotation", (0.0, 1.0, 0.0), twist * gain, float(clip.get("twistFrequency", 1)), phase + 2.1,
                                        envelope=env))
        clips.append(ClipSpec(name, int(clip["frames"]), loop, key_every_kind(channels, env)))
    return clips


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morphology = spec["morphology"]
    seed = int(morphology.get("seed", 11))
    P = {**DEFAULTS, **{k: v for k, v in morphology.items() if k not in ("rock", "mound", "polyp", "notes", "seed")}}
    P["rock"] = {**DEFAULTS["rock"], **morphology.get("rock", {})}
    P["mound"] = {**DEFAULTS["mound"], **morphology.get("mound", {})}
    P["polyp"] = {**DEFAULTS["polyp"], **morphology.get("polyp", {})}
    pp = P["polyp"]
    palette = spec["palette"]

    # ---- skeleton layout and geometry (design cm)
    nodes = Layout(P, seed).build()
    for node in nodes:
        if node.kind == "tube":
            build_node_frames(node)
    for node in nodes:
        if node.kind == "dome":
            make_dome(node, seed, int(P["rock"]["rings"] if node.name == "rock" else P["mound"]["rings"]),
                      (0.0, 1.0) if node.name == "rock" else (0.02, 0.3))
    for node in nodes:
        if node.kind == "tube":
            compute_exit(node)
            make_branch(node)
    for node in nodes:
        node.attach = attach_group(node)
    gaps = check_layout(nodes, P)
    branches = [node for node in nodes if node.kind == "tube"]

    # ---- polyps (design cm); travel budget covers the largest lean / pulse any clip asks for
    travel = {"lean": 0.0, "pulse": 0.0}
    for clip in spec["animation"].values():
        travel["lean"] = max(travel["lean"], float(clip.get("lean", 0.0)) + abs(float(clip.get("leanBias", 0.0))), float(clip.get("wobble", 0.0)))
        travel["pulse"] = max(travel["pulse"], float(clip.get("pulse", 0.0)) * 1.3)
    carriers = [node for node in nodes if node.material == "skeleton"]
    for node in carriers:
        node.polyps = place_polyps(node, nodes, P, seed, travel)
    carriers = [node for node in carriers if node.polyps]

    # cluster bones: mound, then branches shallow to deep; deeper branches share their parent's bone if the budget runs out
    max_bones = int(P["maxClusterBones"])
    ordered = sorted(carriers, key=lambda n: (n.depth, n.name))
    cluster_bones: list[str] = []
    for node in ordered:
        if len(cluster_bones) < max_bones:
            node.bone = "Mound" if node.kind == "dome" else f"Br_{node.name[-2:]}"
            cluster_bones.append(node.bone)
        else:
            node.bone = node.parent.bone if node.parent is not None and node.parent.bone else cluster_bones[0]
            print(f"[stylophora] {node.name} shares bone {node.bone} (bone budget)")

    # ---- normalise the colony width to the reference size (axis xy) and convert cm -> m
    xs, ys = [], []
    for node in nodes:
        xs.extend(v[0] for v in node.geometry[0])
        ys.extend(v[1] for v in node.geometry[0])
    for node in carriers:
        for polyp in node.polyps:
            tip = polyp.base + polyp.axis * polyp.length
            xs.extend((tip.x, polyp.base.x))
            ys.extend((tip.y, polyp.base.y))
    extent_cm = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = float(spec["referenceSize"]["meters"]) / extent_cm

    def S(p):
        return (p[0] * scale, p[1] * scale, p[2] * scale)

    # ---- textures & materials
    tex = spec.get("textures", {})
    written: list = []
    sk_w, sk_h = tex.get("tissueResolution", [1024, 512])
    po_w, po_h = tex.get("polypResolution", [128, 32])
    ro_w, ro_h = tex.get("rockResolution", [512, 256])
    tissue_images = write_set(prefix, ctx.texture_dir, "tissue", paint_tissue(palette, sk_w, sk_h, seed, float(tex.get("tissueNormalStrength", 1.2))), written)
    polyp_images = write_set(prefix, ctx.texture_dir, "polyp", paint_polyp(palette, po_w, po_h, seed), written)
    rock_images = write_set(prefix, ctx.texture_dir, "rock", paint_rock(palette, ro_w, ro_h, seed), written)
    tissue_mat = mat.principled(f"{prefix}_Tissue", palette["body"], 0.7, coat=0.0, subsurface=0.08, specular=0.3)
    mat.attach_textures(tissue_mat, albedo=tissue_images["albedo"], roughness=tissue_images["roughness"], normal=tissue_images["normal"],
                        normal_strength=float(tex.get("tissueMapStrength", 0.9)))
    polyp_mat = mat.principled(f"{prefix}_Polyp", palette["polyp"], 0.45, coat=0.03, subsurface=0.15, specular=0.3)
    mat.attach_textures(polyp_mat, albedo=polyp_images["albedo"], roughness=polyp_images["roughness"], normal=polyp_images["normal"], normal_strength=0.4)
    rock_mat = mat.principled(f"{prefix}_Rock", palette["rock"], 0.88, coat=0.0, subsurface=0.0, specular=0.25)
    mat.attach_textures(rock_mat, albedo=rock_images["albedo"], roughness=rock_images["roughness"], normal=rock_images["normal"],
                        normal_strength=float(tex.get("rockNormalStrength", 1.0)))
    material_map = {"skeleton": tissue_mat, "polyp": polyp_mat, "rock": rock_mat}

    # ---- rig: Base (static, whole skeleton) plus one cluster bone per polyp carrier
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Base", (0.0, 0.0, 0.0), S((0.0, 0.0, P["rock"]["height"])), roll_up=(1.0, 0.0, 0.0))
    bone_x: dict[str, float] = {}
    for node in ordered:
        if node.bone in bone_x:
            continue
        head, direction = bone_axis_of(node)
        if node.kind == "dome":
            tail = node.apex
        else:
            tail = node.apex
        roll = (1.0, 0.0, 0.0) if abs(direction.dot(UP)) > 0.9 else (0.0, 0.0, 1.0)
        rb.bone(node.bone, S(head), S(tail), "Base", roll_up=roll)
        bone_x[node.bone] = 0.5 * (head.x + tail.x) * scale
    rig = rb.finish()

    # ---- skeleton object (every vertex rigid to Base)
    skeleton_parts = []
    for node in nodes:
        vertices, faces, uvs, face_uvs = node.geometry
        geometry = ([S(v) for v in vertices], faces, uvs, face_uvs)
        groups = {f"attach_{node.name}": set(node.attach)} if node.attach else {}
        skeleton_parts.append(msh.make_part(node.name, geometry, node.material, lambda i, v: {"Base": 1.0}, closed=True, groups=groups))
    skeleton_obj = msh.assemble(f"{prefix}_Skeleton", skeleton_parts, material_map, rig, f"{prefix}_Armature", preserve_volume=False)
    skeleton_obj["lod"] = 1
    skeleton_obj["colonyWidthMeters"] = spec["referenceSize"]["meters"]

    # ---- polyp object: one part per carrier, base rings on Base, crowns blended to the carrier's cluster bone
    polyp_parts = []
    polyp_clouds: dict[str, np.ndarray] = {}
    polyp_total = 0
    for node in carriers:
        pieces, weights = [], []
        for polyp in node.polyps:
            geometry, w = polyp_geometry(polyp, pp)
            pieces.append(geometry)
            weights.extend(w)
        vertices, faces, uvs, face_uvs = concat_geometry(pieces)
        polyp_clouds[node.name] = np.asarray(vertices, dtype=np.float64)
        polyp_total += len(node.polyps)
        bone = node.bone

        def weight_fn(i, v, weights=weights, bone=bone):
            w = weights[i]
            return {"Base": 1.0} if w <= 0.0 else {bone: w, "Base": 1.0 - w}

        polyp_parts.append(msh.make_part(f"polyps_{node.name}", ([S(v) for v in vertices], faces, uvs, face_uvs), "polyp", weight_fn, closed=False))
    polyps_obj = msh.assemble(f"{prefix}_Polyps", polyp_parts, material_map, rig, f"{prefix}_Armature", preserve_volume=False)
    polyps_obj["lod"] = 1

    # ---- animation (skeleton bone Base is never a channel target)
    clips = build_clips(spec, rig, cluster_bones, bone_x, seed, scale, float(pp["retractScale"]))
    mesh_objects = {skeleton_obj.name: skeleton_obj, polyps_obj.name: polyps_obj}
    for clip in clips:
        bake_clip(rig, clip, mesh_objects=mesh_objects)

    # ---- contract
    meshes = [skeleton_obj, polyps_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="xy", sample_stride=4)
    for node in nodes:
        contract["closedParts"].append({"object": skeleton_obj.name, "group": f"part_{node.name}", "volumeFloor": 0.9})
    near = float(P["nearMargin"])

    def entry(node: Node):
        return [skeleton_obj.name, f"part_{node.name}", f"attach_{node.name}"] if node.attach else [skeleton_obj.name, f"part_{node.name}"]

    # static skeleton: prove every non adjacent pair that is anywhere near each other
    for i, a in enumerate(nodes):
        for b in nodes[i + 1:]:
            if a.parent is b or b.parent is a or (a.kind == "dome" and b.kind == "dome"):
                continue
            if gaps.get(tuple(sorted((a.name, b.name))), 0.0) > 3.0 * near:
                continue
            contract["clearance"].append({"a": entry(a), "b": entry(b), "label": f"skeleton_{a.name}_{b.name}"})

    def cloud_gap(points: np.ndarray, node: Node) -> float:
        if node.kind == "dome":
            radius, height, exponent, _noise, z0 = node.dome
            rho = np.hypot(points[:, 0], points[:, 1])
            z = np.clip(points[:, 2], z0, z0 + height)
            surface = radius * np.maximum(1.0 - ((z - z0) / height) ** exponent, 0.0) ** (1.0 / exponent)
            return float(np.min(np.maximum(rho - surface, points[:, 2] - (z0 + height))))
        best = 1e9
        for p, q, radius in capsules(node, False):
            ab = np.asarray(q - p, dtype=np.float64)
            rel = points - np.asarray(p, dtype=np.float64)
            denom = float(ab @ ab)
            t = np.clip(rel @ ab / denom, 0.0, 1.0) if denom > 1e-12 else np.zeros(len(points))
            best = min(best, float(np.min(np.linalg.norm(rel - t[:, None] * ab, axis=1) - radius)))
        return best

    # polyp clusters may only hug the solid they grow on
    for node in carriers:
        points = polyp_clouds[node.name]
        for other in nodes:
            if other is node or cloud_gap(points, other) > near:
                continue
            contract["clearance"].append({"a": [polyps_obj.name, f"part_polyps_{node.name}"], "b": [skeleton_obj.name, f"part_{other.name}"],
                                          "label": f"polyps_{node.name}_vs_{other.name}"})
    for i, a in enumerate(carriers):
        for b in carriers[i + 1:]:
            pa, pb = polyp_clouds[a.name], polyp_clouds[b.name]
            distance = float(np.min(np.linalg.norm(pa[:, None, :] - pb[None, :, :], axis=2)))
            if distance > 0.6 * near:
                continue
            contract["clearance"].append({"a": [polyps_obj.name, f"part_polyps_{a.name}"], "b": [polyps_obj.name, f"part_polyps_{b.name}"],
                                          "label": f"polyps_{a.name}_vs_polyps_{b.name}"})
    contract["axialChain"] = None
    register_clips(contract, clips)

    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    notes = {
        "seed": seed, "designExtentCm": extent_cm, "scaleMetersPerCm": scale, "branches": len(branches),
        "terminalBranches": sum(1 for n in branches if n.terminal), "polyps": polyp_total, "clusterBones": cluster_bones,
        "branchThicknessMm": [round(n.radii[0] * 2.0 * scale * 1000.0, 2) for n in branches],
        "triangles": triangles, "clearancePairs": len(contract["clearance"]),
        "staticSkeleton": "every skeleton vertex is weighted 1.0 to Base; Base has no animation channel in any clip",
    }
    print(f"[stylophora] triangles={triangles} branches={len(branches)} polyps={polyp_total} bones={len(rb.deform_names)} "
          f"extent={extent_cm:.2f}cm scale={scale:.4f} clearance_pairs={len(contract['clearance'])}")
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
