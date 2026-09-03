"""Acropora sp. (branching small-polyp stony coral): species-local body plan `branching_sps_coral`.

Anatomy choices (source space: metres, up +Z, flow direction +X, origin base_center, colony rests on z = 0):

- Encrusting base: a rocky mound (closed superellipse loft with seeded rim noise) whose upper part is tissue
  covered. It is the static anchor of the colony (bone `Base`, never animated).
- Branches: closed tubes grown along deterministic polylines (phototropic upward curl plus seeded wobble),
  tapering towards an axial corallite: a slightly swollen lip ring and a recessed calice cap at every tip.
- Radial corallites: small appressed tubes (pointing distally, as in Acropora) embedded in the branch wall with a
  recessed calice. Each corallite carries a polyp: a crown of six short tentacle tubes rising from the calice
  (real Acropora polyps carry twelve tentacles; six is the LOD1 stylisation, listed as visual debt).
- Three morphologies selected by `morphology.form`:
    staghorn: arborescent (A. muricata / A. formosa habit): short trunk, long curving primaries with secondaries
              and one upright leader.
    table:    tabular / corymbose (A. hyacinthus habit): stalk, lobed horizontal plate, phyllotaxis field of
              short upright branchlets.
    bushy:    digitate (A. humilis / A. gemmifera habit): broad mound with a bouquet of thick fingers.
  Pigments come from `spec.palette`; variants override form, seed and palette.
- Rig (<= 32 deform bones): `Base` (static), `Trunk` (trunk / stalk + plate), one bone per branch cluster
  (primary branch, plate sector or finger). Roots stay with the parent bone and tips blend to the cluster bone so
  the (very subtle, skeletons are rigid) sway is a smooth bend. Secondaries share their parent's bone.
- Clips: `sway` (idle loop: faint skeleton flex, polyps lean with the flow), `flow` (locomotion loop: stronger
  rhythmic current response with a little polyp pulsing), `retract` (response, hold envelope: polyps pull into
  their corallites via the `retract` shape key, then re-extend).

Everything is derived from asset.source.json with fixed seeds (noise.scalar_hash); no random module, no imagery.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import textures
from ..lib.animation import Channel, ClipSpec, bake_clip, shape_key_target
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.noise import cells, fbm, scalar_hash, smoothstep
from ..lib.rigging import RigBuilder, identity_pose

UP = Vector((0.0, 0.0, 1.0))
FLOW = Vector((1.0, 0.0, 0.0))
GOLDEN_ANGLE = math.radians(137.50776)
TEXTURE_LENGTH_CM = 8.0  # branch texture u axis spans this many cm measured back from the tip

DEFAULTS = {
    "staghorn": {
        "baseRadius": 2.3, "baseHeight": 1.3, "baseSegments": 18, "baseRings": 6,
        "trunkTop": 3.6, "trunkRadius": 1.05, "trunkTipRadius": 0.5,
        "primaries": 6, "primaryLength": 7.4, "primaryLengthJitter": 1.2, "primaryElevation": 29.0,
        "primaryElevationJitter": 8.0, "primaryCurl": 24.0, "primaryRadius": 0.46, "primaryTipRadius": 0.19,
        "primaryRings": 11, "primarySegments": 10, "primaryCorallites": 11,
        "leaderLength": 6.0, "leaderRadius": 0.48, "leaderTipRadius": 0.19,
        "secondaryLength": 3.2, "secondaryAngle": 46.0, "secondaryRadiusFactor": 0.62, "secondaryTipRadius": 0.15,
        "secondaryRings": 8, "secondarySegments": 8, "secondaryCorallites": 5,
        "wobble": 3.0, "corallite": {"radius": 0.095, "length": 0.17, "tilt": 52.0},
        "polyp": {"length": 0.17, "radius": 0.02, "spread": 48.0, "axialLength": 0.22, "axialRadius": 0.024},
        "minGap": 0.2,
    },
    "table": {
        "baseRadius": 2.6, "baseHeight": 1.4, "baseSegments": 18, "baseRings": 6,
        "stalkTop": 3.7, "stalkRadius": 1.35, "stalkTipRadius": 1.05,
        "plateBottom": 3.25, "plateThickness": 0.8, "plateRadius": 6.9, "plateSegments": 26, "plateLobes": 6,
        "plateLobeDepth": 0.075, "plateDome": 0.45,
        "branchlets": 44, "branchletLength": 1.85, "branchletRimExtra": 0.55, "branchletLengthJitter": 0.3,
        "branchletTilt": 26.0, "branchletRadius": 0.35, "branchletTipRadius": 0.15, "branchletRings": 6,
        "branchletSegments": 8, "branchletCorallites": 2, "fieldRadius": 0.94, "sectors": 8,
        "wobble": 4.0, "corallite": {"radius": 0.085, "length": 0.15, "tilt": 55.0},
        "polyp": {"length": 0.15, "radius": 0.018, "spread": 46.0, "axialLength": 0.19, "axialRadius": 0.02},
        "minGap": 0.24,
    },
    "bushy": {
        "baseRadius": 3.7, "baseHeight": 1.15, "baseSegments": 22, "baseRings": 6,
        "fingers": 11, "fieldRadius": 2.7, "fieldSpacing": 0.34, "fingerLength": 4.7, "fingerLengthJitter": 0.9,
        "fingerCentreBonus": 1.5, "fingerTilt": 30.0,
        "fingerRadius": 0.6, "fingerTipRadius": 0.31, "fingerRings": 9, "fingerSegments": 10, "fingerCurl": 7.0,
        "fingerCorallites": 9,
        "wobble": 3.0, "corallite": {"radius": 0.115, "length": 0.21, "tilt": 50.0},
        "polyp": {"length": 0.18, "radius": 0.024, "spread": 50.0, "axialLength": 0.23, "axialRadius": 0.028},
        "minGap": 0.35,
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


def taper(r0: float, r_tip: float, rings: int) -> list[float]:
    """Branch radii from base to tip: smooth taper closing into a rounded tip (the axial corallite is a
    separate small tube, as in Acropora, so the branch itself does not end in a wide crater)."""
    radii = []
    for index in range(rings):
        s = index / (rings - 1)
        radii.append(r_tip + (r0 - r_tip) * (1.0 - s) ** 0.85)
    radii[-2] = max(radii[-2], r_tip * 1.04)
    radii[-1] = r_tip * 0.6
    return radii


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


def spiral_field(count: int, field_radius: float, jitter_degrees: float, min_spacing: float, seed: int, key: str,
                 iterations: int = 24) -> list[tuple[float, float]]:
    """Phyllotactic field of root positions, relaxed so no two roots sit closer than `min_spacing`."""
    points = []
    for k in range(count):
        r = field_radius * math.sqrt((k + 0.55) / count)
        angle = k * GOLDEN_ANGLE + math.radians(jitter_degrees) * jit(seed, key, k)
        points.append([math.cos(angle) * r, math.sin(angle) * r])
    for _ in range(iterations):
        moved = False
        for i in range(count):
            for j in range(i + 1, count):
                dx = points[j][0] - points[i][0]
                dy = points[j][1] - points[i][1]
                distance = math.hypot(dx, dy)
                if distance >= min_spacing:
                    continue
                if distance < 1e-9:
                    dx, dy, distance = 1.0, 0.0, 1.0
                push = (min_spacing - distance) * 0.5 / distance
                points[i][0] -= dx * push
                points[i][1] -= dy * push
                points[j][0] += dx * push
                points[j][1] += dy * push
                moved = True
        for point in points:
            radius = math.hypot(point[0], point[1])
            if radius > field_radius:
                point[0] *= field_radius / radius
                point[1] *= field_radius / radius
        if not moved:
            break
    return [(round(x, 9), round(y, 9)) for x, y in points]


def concat_geometry(pieces):
    vertices, faces, uvs, face_uvs = [], [], [], []
    for v, f, u, fu in pieces:
        offset = len(vertices)
        vertices.extend(v)
        faces.extend(tuple(i + offset for i in face) for face in f)
        uvs.extend(u)
        face_uvs.extend(fu if fu else [tuple(u[i] for i in face) for face in f])
    return vertices, faces, uvs, face_uvs


def recess_end_cap(geometry, points, depth: float, segments: int, cap_u: float = 1.0):
    """Push the end-cap centre into the tube (calice opening) and give it its own texture column."""
    vertices, faces, uvs, face_uvs = geometry
    centre_index = len(vertices) - 1
    tangent = (Vector(points[-1]) - Vector(points[-2])).normalized()
    vertices[centre_index] = tuple(Vector(vertices[centre_index]) - tangent * depth)
    uvs[centre_index] = (cap_u, uvs[centre_index][1])
    for face_index in range(len(faces) - segments, len(faces)):
        corners = face_uvs[face_index]
        face_uvs[face_index] = ((cap_u, corners[0][1]), corners[1], corners[2])
    return vertices, faces, uvs, face_uvs


# ---------------------------------------------------------------- skeleton nodes

@dataclass
class Node:
    """One solid of the skeleton: a dome (base), a plate, or a tube (trunk, stalk, branch)."""

    name: str
    kind: str  # dome | plate | tube
    bone: str
    material: str = "skeleton"
    parent: "Node | None" = None
    root_weights: dict = field(default_factory=lambda: {"Base": 1.0})
    points: list = field(default_factory=list)
    radii: list = field(default_factory=list)
    segments: int = 10
    dome: tuple = ()  # (radius, height, exponent, rim_noise)
    plate: tuple = ()  # (z0, thickness, radius, dome_height)
    is_branch: bool = False
    cluster: bool = False
    corallites: int = 0
    s_exit: float = 0.0
    blend_span: float = 0.38
    geometry: tuple = ()
    attach: set = field(default_factory=set)
    length: float = 0.0
    cumulative: list = field(default_factory=list)

    # ---- geometry queries

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
        if self.kind == "tube":
            d, r = self.axis_distance(p)
            return d < r + margin
        if self.kind == "dome":
            radius, height, exponent, _noise = self.dome
            r = math.hypot(p.x, p.y)
            if p.z < -margin or r > radius + margin:
                return False
            z_frac = clamp(p.z / height)
            surface_r = radius * (1.0 - z_frac ** exponent) ** (1.0 / exponent)
            return r < surface_r + margin and p.z < height + margin
        z0, thickness, radius, dome_height = self.plate
        r = math.hypot(p.x, p.y)
        if r > radius * 1.15 + margin:
            return False
        z_top = z0 + thickness + dome_height * (1.0 - clamp(r / radius))
        return z0 - margin < p.z < z_top + margin

    def point_at(self, s: float) -> Vector:
        position = clamp(s) * (len(self.points) - 1)
        index = min(int(position), len(self.points) - 2)
        t = position - index
        return self.points[index].lerp(self.points[index + 1], t)

    def tangent_at(self, s: float) -> Vector:
        position = clamp(s) * (len(self.points) - 1)
        index = min(int(position), len(self.points) - 2)
        return (self.points[index + 1] - self.points[index]).normalized()

    def radius_at(self, s: float) -> float:
        position = clamp(s) * (len(self.points) - 1)
        index = min(int(position), len(self.points) - 2)
        t = position - index
        return self.radii[index] + (self.radii[index + 1] - self.radii[index]) * t

    def weights_at(self, s: float) -> dict:
        if self.kind != "tube":
            return dict(self.root_weights)
        t = sstep((s - self.s_exit) / self.blend_span)
        return msh.blend_weights(self.root_weights, {self.bone: 1.0}, t)

    def s_of_vertex(self, index: int) -> float:
        rings = len(self.points)
        if index >= rings * self.segments:
            return 0.0 if index == rings * self.segments else 1.0
        return (index // self.segments) / (rings - 1)


def make_tube_node(node: Node, uv_mode: str, recess: float = 0.0):
    """Mesh a tube node; uv_mode 'tip' maps u by distance from the tip, 'trunk' keeps u small."""
    rings = len(node.points)
    cumulative = [0.0]
    for a, b in zip(node.points, node.points[1:]):
        cumulative.append(cumulative[-1] + (b - a).length)
    node.length = cumulative[-1]
    node.cumulative = cumulative
    if uv_mode == "tip":
        # u runs backwards from the tip; short branchlets keep the same relative tip band as long branches
        denom = max(min(node.length, TEXTURE_LENGTH_CM), 2.4)
        u_values = [clamp(0.94 - 0.94 * (node.length - c) / denom, 0.02, 0.94) for c in cumulative]
    else:
        u_values = [0.02 + 0.3 * c / node.length for c in cumulative]
    geometry = msh.tube([tuple(p) for p in node.points], node.radii, node.segments, cap_start=True, cap_end=True,
                        u_values=u_values)
    if recess > 0.0:
        geometry = recess_end_cap(geometry, node.points, recess, node.segments)
    node.geometry = geometry
    return geometry


def make_dome_node(node: Node, seed: int, rings: int):
    radius, height, exponent, rim_noise = node.dome
    ring_list = []
    for k in range(rings):
        t = k / (rings - 1)
        h = height * (t ** 1.25) * 0.94
        base_r = radius * (1.0 - (h / height) ** exponent) ** (1.0 / exponent)
        ring = []
        for segment in range(node.segments):
            angle = segment / node.segments * math.tau
            wobble = 1.0 + rim_noise * (0.6 * math.sin(3.0 * angle + 0.7 + t * 2.0) + 0.4 * jit(seed, "dome", k, segment))
            r = base_r * wobble
            ring.append((math.cos(angle) * r, math.sin(angle) * r, h))
        ring_list.append(ring)
    geometry = msh.loft(ring_list, u_values=[k / (rings - 1) for k in range(rings)], cap_start=True, cap_end=True)
    vertices = geometry[0]
    apex = len(vertices) - 1
    vertices[apex] = (vertices[apex][0], vertices[apex][1], height)
    node.geometry = geometry
    return geometry


def make_plate_node(node: Node, seed: int, lobes: int, lobe_depth: float):
    """Lens shaped tabular plate: thickest over the stalk, thin and lobed at the rim (fused branch tips)."""
    z0, thickness, radius, dome_height = node.plate
    levels = [(0.0, 0.60), (0.34, 0.90), (0.62, 1.0), (0.86, 0.97), (1.0, 0.82)]
    ring_list = []
    for t, factor in levels:
        ring = []
        for segment in range(node.segments):
            angle = segment / node.segments * math.tau
            lobe = (1.0 + lobe_depth * math.sin(lobes * angle + 0.9) + 0.05 * jit(seed, "plate", segment)
                    + 0.02 * math.sin(3.0 * lobes * angle + 2.1))
            r = radius * factor * lobe
            # the rim droops a little, the plate lifts towards the centre, and the upper surface carries radial
            # ridges so it reads as fused horizontal branches rather than a smooth disc
            sag = -0.12 * thickness * max(factor - 0.9, 0.0) / 0.1
            ridge = 0.0
            if t >= 0.6:
                ridge = 0.17 * thickness * (t - 0.5) * (0.5 + 0.5 * math.cos(3.0 * lobes * angle + 0.4))
            ring.append((math.cos(angle) * r, math.sin(angle) * r, z0 + thickness * t + sag + ridge))
        ring_list.append(ring)
    geometry = msh.loft(ring_list, u_values=[0.02 + 0.30 * t for t, _ in levels], cap_start=True, cap_end=True)
    vertices = geometry[0]
    bottom, top = len(vertices) - 2, len(vertices) - 1
    vertices[bottom] = (vertices[bottom][0], vertices[bottom][1], z0 - thickness * 0.2)
    vertices[top] = (vertices[top][0], vertices[top][1], z0 + thickness + dome_height)
    node.geometry = geometry
    return geometry


def compute_exit(node: Node):
    """Arc fraction of the first ring whose centre lies clear of the parent solid."""
    if node.parent is None or node.kind != "tube":
        node.s_exit = 0.0
        return
    rings = len(node.points)
    for index, point in enumerate(node.points):
        margin = node.radii[index] * 0.8
        if not node.parent.inside(point, margin):
            node.s_exit = index / (rings - 1)
            return
    node.s_exit = 0.5


def attach_group(node: Node) -> set[int]:
    """Vertices of a tube node that sit inside (or hug) the parent solid: excluded from clearance checks."""
    if node.parent is None:
        return set()
    members = set()
    parent = node.parent
    for index, vertex in enumerate(node.geometry[0]):
        p = Vector(vertex)
        if parent.kind == "tube":
            _d, r = parent.axis_distance(p)
            margin = 0.3 * r + 0.12
        elif parent.kind == "dome":
            margin = 0.12 * parent.dome[0] + 0.22
        else:
            margin = 0.25
        if parent.inside(p, margin):
            members.add(index)
    return members


# ---------------------------------------------------------------- colony layouts (design units: cm)

def layout_staghorn(P: dict, seed: int) -> list[Node]:
    nodes = []
    base = Node("base", "dome", "Base", material="rock", dome=(P["baseRadius"], P["baseHeight"], 2.2, 0.08),
                segments=P["baseSegments"])
    nodes.append(base)
    trunk_pts = grow(Vector((0.0, 0.0, 0.35)), direction_from(0.0, 86.0), P["trunkTop"] - 0.35, 5, 0.0, 2.0, seed, "trunk")
    trunk_radii = [P["trunkRadius"], P["trunkRadius"] * 0.95, P["trunkRadius"] * 0.85, P["trunkRadius"] * 0.7, P["trunkTipRadius"]]
    trunk = Node("trunk", "tube", "Trunk", parent=base, root_weights={"Base": 1.0}, points=trunk_pts, radii=trunk_radii,
                 segments=12, blend_span=0.5)
    nodes.append(trunk)
    count = int(P["primaries"])
    primaries = []
    for i in range(count):
        azimuth = 360.0 * i / count + 14.0 * jit(seed, "paz", i)
        elevation = P["primaryElevation"] + P["primaryElevationJitter"] * jit(seed, "pel", i) + (10.0 if i % 2 == 0 else -5.0)
        # roots climb the trunk in a spiral so neighbouring azimuths leave the trunk at different heights
        root_s = 0.36 + 0.58 * ((i * 0.618034 + 0.15 * hash01(seed, "proot", i)) % 1.0)
        root = trunk.point_at(root_s) + direction_from(azimuth, 0.0) * (trunk.radius_at(root_s) * 0.35)
        length = P["primaryLength"] + P["primaryLengthJitter"] * jit(seed, "plen", i)
        points = grow(root, direction_from(azimuth, elevation), length, int(P["primaryRings"]), P["primaryCurl"] + 6.0 * jit(seed, "pcurl", i),
                      P["wobble"], seed, ("primary", i))
        radii = taper(P["primaryRadius"] * (1.0 + 0.08 * jit(seed, "prad", i)), P["primaryTipRadius"], int(P["primaryRings"]))
        node = Node(f"branch_{i:02d}", "tube", f"Br_{i:02d}", parent=trunk, root_weights={"Trunk": 1.0}, points=points, radii=radii,
                    segments=int(P["primarySegments"]), is_branch=True, cluster=True, corallites=int(P["primaryCorallites"]))
        nodes.append(node)
        primaries.append(node)
    leader_root = trunk.point_at(0.82)
    leader = Node("leader", "tube", "Br_leader", parent=trunk, root_weights={"Trunk": 1.0},
                  points=grow(leader_root, direction_from(200.0 + 40.0 * jit(seed, "laz"), 79.0), P["leaderLength"], int(P["primaryRings"]),
                              5.0, P["wobble"], seed, "leader"),
                  radii=taper(P["leaderRadius"], P["leaderTipRadius"], int(P["primaryRings"])), segments=int(P["primarySegments"]),
                  is_branch=True, cluster=True, corallites=int(P["primaryCorallites"]))
    nodes.append(leader)
    for i, parent in enumerate(primaries):
        secondaries = 2 if i % 3 == 0 else 1
        for k in range(secondaries):
            s = (0.40 if k == 0 else 0.68) + 0.06 * jit(seed, "ss", i, k)
            junction = parent.point_at(s)
            tangent = parent.tangent_at(s)
            up_perp = (UP - tangent * tangent.dot(UP)).normalized()
            side = tangent.cross(up_perp).normalized()
            side_sign = 1.0 if (i + k) % 2 == 0 else -1.0
            psi = math.radians(38.0 + 26.0 * hash01(seed, "spsi", i, k)) * side_sign
            theta = math.radians(P["secondaryAngle"] + 8.0 * jit(seed, "sth", i, k))
            direction = (tangent * math.cos(theta) + (up_perp * math.cos(psi) + side * math.sin(psi)) * math.sin(theta)).normalized()
            length = P["secondaryLength"] * (1.0 + 0.2 * jit(seed, "slen", i, k))
            r0 = parent.radius_at(s) * P["secondaryRadiusFactor"]
            node = Node(f"branch_{i:02d}{'ab'[k]}", "tube", parent.bone, parent=parent, root_weights=parent.weights_at(s),
                        points=grow(junction, direction, length, int(P["secondaryRings"]), 20.0, P["wobble"], seed, ("secondary", i, k)),
                        radii=taper(r0, P["secondaryTipRadius"], int(P["secondaryRings"])), segments=int(P["secondarySegments"]),
                        is_branch=True, corallites=int(P["secondaryCorallites"]))
            nodes.append(node)
    return nodes


def layout_table(P: dict, seed: int) -> list[Node]:
    nodes = []
    base = Node("base", "dome", "Base", material="rock", dome=(P["baseRadius"], P["baseHeight"], 2.2, 0.08), segments=P["baseSegments"])
    nodes.append(base)
    stalk_pts = grow(Vector((0.0, 0.0, 0.3)), direction_from(30.0, 85.0), P["stalkTop"] - 0.3, 5, 3.0, 1.5, seed, "stalk")
    stalk_radii = [P["stalkRadius"], P["stalkRadius"] * 0.96, P["stalkRadius"] * 0.9, P["stalkTipRadius"], P["stalkTipRadius"] * 0.95]
    stalk = Node("stalk", "tube", "Trunk", parent=base, root_weights={"Base": 1.0}, points=stalk_pts, radii=stalk_radii, segments=14,
                 blend_span=0.5)
    nodes.append(stalk)
    plate = Node("plate", "plate", "Trunk", parent=stalk, root_weights={"Trunk": 1.0},
                 plate=(P["plateBottom"], P["plateThickness"], P["plateRadius"], P["plateDome"]), segments=int(P["plateSegments"]))
    nodes.append(plate)
    count = int(P["branchlets"])
    sectors = int(P["sectors"])
    field_radius = P["plateRadius"] * P["fieldRadius"]
    z_top = P["plateBottom"] + P["plateThickness"]
    field = spiral_field(count, field_radius, 7.0, 2.0 * P["branchletRadius"] + P.get("fieldSpacing", 0.6), seed, "bang")
    for k, (fx, fy) in enumerate(field):
        r = math.hypot(fx, fy)
        angle = math.atan2(fy, fx)
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        rel = r / P["plateRadius"]
        root = radial * r + Vector((0.0, 0.0, z_top + P["plateDome"] * (1.0 - rel) - 0.45))
        tilt = math.radians(P["branchletTilt"] * rel + 5.0 * jit(seed, "btilt", k))
        direction = (UP * math.cos(tilt) + radial * math.sin(tilt)).normalized()
        length = P["branchletLength"] + P["branchletRimExtra"] * rel + P["branchletLengthJitter"] * jit(seed, "blen", k)
        sector = int((angle % math.tau) / math.tau * sectors) % sectors
        node = Node(f"branchlet_{k:02d}", "tube", f"Sector_{sector}", parent=plate, root_weights={"Trunk": 1.0},
                    points=grow(root, direction, length, int(P["branchletRings"]), 4.0, P["wobble"], seed, ("branchlet", k)),
                    radii=taper(P["branchletRadius"] * (1.0 + 0.1 * jit(seed, "brad", k)), P["branchletTipRadius"], int(P["branchletRings"])),
                    segments=int(P["branchletSegments"]), is_branch=True, corallites=int(P["branchletCorallites"]), blend_span=0.5)
        nodes.append(node)
    return nodes


def layout_bushy(P: dict, seed: int) -> list[Node]:
    nodes = []
    base = Node("base", "dome", "Base", material="rock", dome=(P["baseRadius"], P["baseHeight"], 2.3, 0.07), segments=P["baseSegments"])
    nodes.append(base)
    count = int(P["fingers"])
    radius, height, exponent, _ = base.dome
    field = spiral_field(count, P["fieldRadius"], 8.0, 2.0 * P["fingerRadius"] + P["fieldSpacing"], seed, "fang")
    for k, (fx, fy) in enumerate(field):
        r = math.hypot(fx, fy)
        angle = math.atan2(fy, fx)
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        rel = r / P["fieldRadius"]
        surface_z = height * (1.0 - clamp(r / radius) ** exponent) ** (1.0 / exponent)
        root = radial * r + Vector((0.0, 0.0, surface_z - 0.75))
        tilt = math.radians(P["fingerTilt"] * rel + 6.0 * jit(seed, "ftilt", k))
        direction = (UP * math.cos(tilt) + radial * math.sin(tilt)).normalized()
        # the middle of a digitate colony carries the longest digits
        length = P["fingerLength"] + P["fingerLengthJitter"] * jit(seed, "flen", k) + P["fingerCentreBonus"] * (1.0 - rel)
        node = Node(f"finger_{k:02d}", "tube", f"Finger_{k:02d}", parent=base, root_weights={"Base": 1.0},
                    points=grow(root, direction, length, int(P["fingerRings"]), P["fingerCurl"], P["wobble"], seed, ("finger", k)),
                    radii=taper(P["fingerRadius"] * (1.0 + 0.1 * jit(seed, "frad", k)), P["fingerTipRadius"], int(P["fingerRings"])),
                    segments=int(P["fingerSegments"]), is_branch=True, cluster=True, corallites=int(P["fingerCorallites"]), blend_span=0.45)
        nodes.append(node)
    return nodes


LAYOUTS = {"staghorn": layout_staghorn, "table": layout_table, "bushy": layout_bushy}


def check_layout(nodes: list[Node], min_gap: float):
    """Capsule distance between every pair of tube nodes (skipping the junction of parent/child)."""
    tubes = [n for n in nodes if n.kind == "tube"]
    worst = []
    for i, a in enumerate(tubes):
        for b in tubes[i + 1:]:
            gap = 1e9
            skip_a = int(round(a.s_exit * (len(a.points) - 1))) + 1 if a.parent is not None else 0
            skip_b = int(round(b.s_exit * (len(b.points) - 1))) + 1 if b.parent is not None else 0
            for ia, (p1, q1) in enumerate(zip(a.points, a.points[1:])):
                if ia < skip_a:
                    continue
                for ib, (p2, q2) in enumerate(zip(b.points, b.points[1:])):
                    if ib < skip_b:
                        continue
                    d = segment_distance(p1, q1, p2, q2) - max(a.radii[ia], a.radii[ia + 1]) - max(b.radii[ib], b.radii[ib + 1])
                    gap = min(gap, d)
            related = a.parent is b or b.parent is a
            worst.append((gap, a.name, b.name, related))
    worst.sort()
    # parent/child pairs only need to stay clear of each other beyond the junction; unrelated pairs need the full gap
    tight = [w for w in worst if w[0] < (0.05 if w[3] else min_gap)]
    for gap, na, nb, related in worst[:6]:
        print(f"[acropora] gap {gap:+.3f} cm between {na} and {nb}{' (parent/child)' if related else ''}")
    if tight:
        raise ValueError(f"Branch layout too tight (< {min_gap} cm): " + ", ".join(f"{na}/{nb} {gap:.3f}" for gap, na, nb, _r in tight[:8]))
    return {tuple(sorted((na, nb))): gap for gap, na, nb, _related in worst}


# ---------------------------------------------------------------- corallites and polyps

@dataclass
class Corallite:
    name: str
    node: Node
    geometry: tuple
    weights: dict
    calice: Vector
    axis: Vector
    axial: bool = False


def place_corallites(node: Node, nodes: list[Node], P: dict, seed: int) -> list[Corallite]:
    """Radial corallites spiral up the branch; a candidate whose tube or polyp would reach another solid is
    rotated to another azimuth (deterministically) or dropped."""
    out = []
    c = P["corallite"]
    reach = P["polyp"]["length"] * 1.1 + c["radius"] * 1.2
    others = [other for other in nodes if other is not node]
    frames = msh.frames_along([tuple(p) for p in node.points])
    rings = len(node.points)
    count = node.corallites
    s_min = min(node.s_exit + 0.2, 0.7)
    s_max = 0.9
    for k in range(count):
        s_base = s_min + (s_max - s_min) * (k + 0.5 + 0.3 * jit(seed, node.name, "cs", k)) / count
        length = c["length"] * (1.0 + 0.15 * jit(seed, node.name, "clen", k))
        beta = math.radians(c["tilt"] + 7.0 * jit(seed, node.name, "cbeta", k))
        cos_b = math.cos(beta)
        placed = False
        for attempt in range(9):
            s = clamp(s_base + 0.05 * ((attempt + 1) // 2) * (1.0 if attempt % 2 else -1.0), s_min, s_max)
            position = s * (rings - 1)
            index = min(int(position), rings - 2)
            t = position - index
            centre = node.points[index].lerp(node.points[index + 1], t)
            r = node.radii[index] + (node.radii[index + 1] - node.radii[index]) * t
            _tangent, normal, binormal = frames[index]
            tangent = (node.points[index + 1] - node.points[index]).normalized()
            rc = c["radius"] * (1.0 + 0.15 * jit(seed, node.name, "crad", k)) * min(1.0, 0.45 + r / max(node.radii[0], 1e-6))
            t_surface = r * (-0.45 * cos_b + math.sqrt(0.45 * 0.45 * cos_b * cos_b + 1.0 - 0.45 * 0.45))
            phi = k * GOLDEN_ANGLE + math.radians(28.0) * jit(seed, node.name, "cphi", k) + attempt * math.radians(97.0)
            radial = (normal * math.cos(phi) + binormal * math.sin(phi)).normalized()
            direction = (radial * math.cos(beta) + tangent * math.sin(beta)).normalized()
            inner = centre + radial * (r * 0.45)
            points = [inner, inner + direction * (t_surface + 0.42 * length), inner + direction * (t_surface + length)]
            probe = [points[0], points[1], points[2], points[2] + direction * reach * 0.5]
            if any(other.inside(p, reach) for other in others for p in probe):
                continue
            geometry = msh.tube([tuple(p) for p in points], [rc * 0.82, rc, rc * 1.15], 6, u_values=[0.0, 0.55, 0.9], up_hint=tuple(tangent))
            geometry = recess_end_cap(geometry, points, rc * 0.5, 6)
            out.append(Corallite(f"{node.name}_c{k:02d}", node, geometry, node.weights_at(s), points[-1], direction))
            placed = True
            break
        if not placed:
            print(f"[acropora] dropped corallite {node.name} #{k} (no free azimuth)")
    return out


def axial_corallite(node: Node, P: dict) -> Corallite:
    """Tubular axial corallite standing on the branch tip: rooted inside the tip, with a recessed calice."""
    c = P["corallite"]
    axis = (node.points[-1] - node.points[-2]).normalized()
    radius = min(max(node.radii[-2] * 0.62, c["radius"] * 0.9), c["radius"] * 1.9)
    length = c["length"] * 1.55
    root = node.points[-1] - axis * (radius * 1.4 + node.radii[-1] * 0.6)
    points = [root, root + axis * (length * 0.55), root + axis * length]
    radii = [radius * 1.02, radius, radius * 1.1]
    geometry = msh.tube([tuple(p) for p in points], radii, 8, u_values=[0.0, 0.5, 0.9], up_hint=tuple(axis))
    geometry = recess_end_cap(geometry, points, radius * 0.62, 8)
    return Corallite(f"{node.name}_axial", node, geometry, node.weights_at(1.0), points[-1], axis, axial=True)


def polyp_geometry(centre: Vector, axis: Vector, count: int, length: float, radius: float, spread_deg: float, seed: int, key):
    """Crown of tentacle tubes rising from a calice; returns geometry plus retract and lean target positions."""
    normal, binormal = perpendicular_frame(axis)
    pieces, retract, lean = [], [], []
    for k in range(count):
        theta = math.tau * k / count + math.radians(14.0) * jit(seed, key, "pt", k)
        tilt = math.radians(spread_deg + 10.0 * jit(seed, key, "ptilt", k))
        radial = normal * math.cos(theta) + binormal * math.sin(theta)
        tdir = (axis * math.cos(tilt) + radial * math.sin(tilt)).normalized()
        L = length * (1.0 + 0.2 * jit(seed, key, "plen", k))
        base = centre - axis * 0.012 + radial * 0.012
        tip = base + tdir * L
        geometry = msh.tube([tuple(base), tuple(tip)], [radius, radius * 0.5], 3, cap_start=False, cap_end=True)
        pieces.append(geometry)
        stub = base + tdir * 0.02
        for index, p in enumerate(geometry[0]):
            P = Vector(p)
            if index < 3:
                retract.append(tuple(P))
                lean.append(tuple(P))
            else:
                retract.append(tuple(stub + (P - tip) * 0.4))
                lean.append(tuple(P + FLOW * (0.38 * L) - axis * (0.05 * L)))
    return concat_geometry(pieces), retract, lean


# ---------------------------------------------------------------- textures

def _lighter(color, amount=0.35):
    return tuple(min(1.0, c * (1.0 + amount) + 0.04) for c in color)


def _darker(color, amount=0.55):
    return tuple(c * (1.0 - amount) for c in color)


def paint_skeleton(palette: dict, width: int, height: int, seed: int, normal_strength: float):
    U, V = textures.uv_grid(width, height)
    shape = U.shape
    body, tip, lip = palette["body"], palette["tip"], palette["corallite"]
    calice = palette.get("calice", _darker(body, 0.6))
    grain = fbm(U * 150.0, V * 75.0, octaves=3, seed=seed + 1)
    dimple_d, _dimple_id = cells(U * 120.0, V * 60.0, seed=seed + 2)
    dimples = 1.0 - smoothstep(0.17, 0.33, dimple_d)
    mottle = fbm(U * 8.0, V * 4.0, octaves=3, seed=seed + 3)
    albedo = textures.rgba(body, 1.0, shape)
    albedo = textures.scale_rgb(albedo, 0.84 + 0.32 * mottle)
    albedo = textures.mix(albedo, _lighter(body, 0.3), 0.3 * smoothstep(0.58, 0.82, grain))
    albedo = textures.scale_rgb(albedo, 1.0 - 0.2 * dimples)
    branch_band = 1.0 - smoothstep(0.725, 0.745, V)
    cor_band = 1.0 - branch_band
    tip_mask = smoothstep(0.80, 0.915, U) * branch_band
    albedo = textures.mix(albedo, tip, tip_mask * (0.85 + 0.15 * mottle))
    albedo = textures.mix(albedo, _lighter(tip, 0.18), smoothstep(0.905, 0.94, U) * branch_band * 0.5)
    axial = smoothstep(0.955, 0.975, U) * branch_band
    albedo = textures.mix(albedo, calice, axial)
    lip_mask = smoothstep(0.5, 0.86, U) * cor_band
    albedo = textures.mix(albedo, lip, lip_mask)
    calice_mask = smoothstep(0.925, 0.96, U) * cor_band
    albedo = textures.mix(albedo, calice, calice_mask)
    costae = 0.5 + 0.5 * np.cos(V * math.tau * 60.0)
    height_field = np.clip(0.5 + 0.2 * (grain - 0.5) - 0.28 * dimples * branch_band + cor_band * 0.14 * (costae - 0.5)
                           + 0.08 * (mottle - 0.5), 0.0, 1.0)
    roughness = np.clip(0.76 + 0.12 * (grain - 0.5) + 0.06 * dimples - 0.08 * tip_mask, 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, normal_strength)}


def paint_polyp(palette: dict, width: int, height: int, seed: int):
    U, V = textures.uv_grid(width, height)
    shape = U.shape
    albedo = textures.rgba(palette["polyp"], 1.0, shape)
    grain = fbm(U * 12.0, V * 3.0, octaves=2, seed=seed + 5)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.2 * grain)
    albedo = textures.mix(albedo, palette["polypTip"], smoothstep(0.55, 0.92, U))
    roughness = 0.42 + 0.1 * (grain - 0.5)
    height_field = 0.5 + 0.1 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, 0.4)}


def paint_base(palette: dict, width: int, height: int, seed: int):
    U, V = textures.uv_grid(width, height)
    shape = U.shape
    rock, algae, body = palette["rock"], palette["algae"], palette["body"]
    coarse = fbm(U * 6.0, V * 12.0, octaves=4, seed=seed + 7)
    cracks = smoothstep(0.6, 0.72, fbm(U * 10.0, V * 20.0, octaves=3, seed=seed + 8))
    albedo = textures.rgba(rock, 1.0, shape)
    albedo = textures.scale_rgb(albedo, 0.7 + 0.6 * coarse)
    albedo = textures.mix(albedo, _darker(rock, 0.6), cracks * 0.7)
    algae_mask = smoothstep(0.45, 0.7, fbm(U * 5.0, V * 9.0, octaves=3, seed=seed + 9)) * (1.0 - smoothstep(0.5, 0.75, U))
    albedo = textures.mix(albedo, algae, algae_mask * 0.7)
    edge = 0.56 + 0.1 * (fbm(V * 7.0, np.full_like(V, 0.3), octaves=2, seed=seed + 10) - 0.5)
    tissue = smoothstep(edge - 0.03, edge + 0.05, U)
    dimple_d, _ = cells(U * 40.0, V * 90.0, seed=seed + 11)
    dimples = 1.0 - smoothstep(0.17, 0.33, dimple_d)
    tissue_color = textures.rgba(body, 1.0, shape)
    tissue_color = textures.scale_rgb(tissue_color, (0.86 + 0.28 * coarse) * (1.0 - 0.2 * dimples))
    albedo = albedo * (1.0 - tissue[..., None]) + tissue_color * tissue[..., None]
    height_field = np.clip(0.5 + (0.3 * (coarse - 0.5) - 0.3 * cracks) * (1.0 - tissue) - 0.25 * dimples * tissue, 0.0, 1.0)
    roughness = np.clip(0.88 - 0.12 * tissue + 0.08 * (coarse - 0.5), 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, 1.4)}


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
    morphology = spec["morphology"]
    form = morphology.get("form", "staghorn")
    if form not in LAYOUTS:
        raise ValueError(f"Unknown Acropora form {form}")
    seed = int(morphology.get("seed", 11))
    P = {**DEFAULTS[form], **morphology.get(form, {})}
    P["corallite"] = {**DEFAULTS[form]["corallite"], **morphology.get(form, {}).get("corallite", {})}
    P["polyp"] = {**DEFAULTS[form]["polyp"], **morphology.get(form, {}).get("polyp", {})}
    palette = spec["palette"]

    # ---- skeleton layout (cm)
    nodes = LAYOUTS[form](P, seed)
    by_name = {node.name: node for node in nodes}
    for node in nodes:
        if node.kind == "dome":
            make_dome_node(node, seed, int(P["baseRings"]))
        elif node.kind == "plate":
            make_plate_node(node, seed, int(P["plateLobes"]), float(P["plateLobeDepth"]))
    for node in nodes:
        if node.kind == "tube":
            compute_exit(node)
            make_tube_node(node, "tip" if node.is_branch else "trunk")
    for node in nodes:
        node.attach = attach_group(node)
    gaps = check_layout(nodes, float(P["minGap"]))

    # ---- corallites and polyps (cm)
    corallites: list[Corallite] = []
    for node in nodes:
        if node.is_branch:
            corallites.extend(place_corallites(node, nodes, P, seed))
            corallites.append(axial_corallite(node, P))
    polyp_parts = []  # (branch node, geometry, retract, lean)
    pp = P["polyp"]
    for node in nodes:
        if not node.is_branch:
            continue
        pieces, retract, lean = [], [], []
        for cor in corallites:
            if cor.node is not node:
                continue
            count = 6
            length = pp["axialLength"] if cor.axial else pp["length"]
            radius = pp["axialRadius"] if cor.axial else pp["radius"]
            geometry, r_pos, l_pos = polyp_geometry(cor.calice - cor.axis * (0.0 if cor.axial else 0.02), cor.axis, count, length, radius,
                                                    pp["spread"], seed, cor.name)
            pieces.append(geometry)
            retract.extend(r_pos)
            lean.extend(l_pos)
        polyp_parts.append((node, concat_geometry(pieces), retract, lean))

    # ---- normalise the colony width to the reference size (axis xy) and convert cm -> m
    xs, ys = [], []
    for node in nodes:
        xs.extend(v[0] for v in node.geometry[0])
        ys.extend(v[1] for v in node.geometry[0])
    for cor in corallites:
        if cor.geometry:
            xs.extend(v[0] for v in cor.geometry[0])
            ys.extend(v[1] for v in cor.geometry[0])
    for _node, geometry, _r, _l in polyp_parts:
        xs.extend(v[0] for v in geometry[0])
        ys.extend(v[1] for v in geometry[0])
    extent_cm = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = float(spec["referenceSize"]["meters"]) / extent_cm

    def S(p):
        return (p[0] * scale, p[1] * scale, p[2] * scale)

    # ---- textures & materials
    tex = spec.get("textures", {})
    written = []
    sk_w, sk_h = tex.get("skeletonResolution", [1024, 512])
    po_w, po_h = tex.get("polypResolution", [256, 64])
    ba_w, ba_h = tex.get("baseResolution", [512, 256])
    skeleton_images = write_set(prefix, ctx.texture_dir, "skeleton", paint_skeleton(palette, sk_w, sk_h, seed, float(tex.get("normalStrength", 0.9))), written)
    polyp_images = write_set(prefix, ctx.texture_dir, "polyp", paint_polyp(palette, po_w, po_h, seed), written)
    base_images = write_set(prefix, ctx.texture_dir, "base", paint_base(palette, ba_w, ba_h, seed), written)
    skeleton_mat = mat.principled(f"{prefix}_Skeleton", palette["body"], 0.78, coat=0.0, subsurface=0.06, specular=0.3)
    mat.attach_textures(skeleton_mat, albedo=skeleton_images["albedo"], roughness=skeleton_images["roughness"], normal=skeleton_images["normal"],
                        normal_strength=float(tex.get("skeletonNormalStrength", 0.8)))
    polyp_mat = mat.principled(f"{prefix}_Polyp", palette["polyp"], 0.45, coat=0.05, subsurface=0.3, specular=0.35)
    mat.attach_textures(polyp_mat, albedo=polyp_images["albedo"], roughness=polyp_images["roughness"], normal=polyp_images["normal"], normal_strength=0.3)
    rock_mat = mat.principled(f"{prefix}_Rock", palette["rock"], 0.86, coat=0.0, subsurface=0.0, specular=0.25)
    mat.attach_textures(rock_mat, albedo=base_images["albedo"], roughness=base_images["roughness"], normal=base_images["normal"],
                        normal_strength=float(tex.get("rockNormalStrength", 1.0)))
    material_map = {"skeleton": skeleton_mat, "polyp": polyp_mat, "rock": rock_mat}

    # ---- rig
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    base_node = by_name["base"]
    rb.bone("Base", (0.0, 0.0, 0.0), S((0.0, 0.0, base_node.dome[1])))
    trunk_node = next((n for n in nodes if n.bone == "Trunk" and n.kind == "tube"), None)
    if trunk_node is not None:
        top = trunk_node.points[-1]
        plate_node = by_name.get("plate")
        if plate_node is not None:
            top = Vector((0.0, 0.0, plate_node.plate[0] + plate_node.plate[1] + plate_node.plate[3]))
        rb.bone("Trunk", S(trunk_node.points[0]), S(top), "Base")
    cluster_bones = []
    if form == "table":
        plate_node = by_name["plate"]
        centre = Vector((0.0, 0.0, plate_node.plate[0] + plate_node.plate[1] + plate_node.plate[3]))
        for k in range(int(P["sectors"])):
            angle = (k + 0.5) / int(P["sectors"]) * math.tau
            tail = centre + Vector((math.cos(angle), math.sin(angle), 0.0)) * plate_node.plate[2] + Vector((0.0, 0.0, 1.2))
            rb.bone(f"Sector_{k}", S(centre), S(tail), "Trunk")
            cluster_bones.append(f"Sector_{k}")
    for node in nodes:
        if node.cluster:
            parent_bone = "Trunk" if trunk_node is not None else "Base"
            rb.bone(node.bone, S(node.points[0]), S(node.points[-1]), parent_bone)
            cluster_bones.append(node.bone)
    rig = rb.finish()

    # ---- skeleton object
    skeleton_parts = []
    for node in nodes:
        vertices, faces, uvs, face_uvs = node.geometry
        geometry = ([S(v) for v in vertices], faces, uvs, face_uvs)
        if node.kind == "tube":
            weight_fn = (lambda i, v, n=node: n.weights_at(n.s_of_vertex(i)))
        else:
            weight_fn = (lambda i, v, n=node: dict(n.root_weights))
        transform = (lambda u, v: (u, v * 0.72)) if node.material == "skeleton" else None
        skeleton_parts.append(msh.make_part(node.name, geometry, node.material, weight_fn, closed=True,
                                            groups={f"attach_{node.name}": set(node.attach)}, uv_transform=transform))
    skeleton_obj = msh.assemble(f"{prefix}_Skeleton", skeleton_parts, material_map, rig, f"{prefix}_Armature")
    skeleton_obj["lod"] = 1
    skeleton_obj["colonyWidthMeters"] = spec["referenceSize"]["meters"]

    # ---- corallites object (one vertex group per carrying branch, for the clearance contract)
    corallite_parts = []
    corallite_members: dict[str, set[int]] = {}
    offset = 0
    for cor in corallites:
        if cor.geometry is None:
            continue
        vertices, faces, uvs, face_uvs = cor.geometry
        geometry = ([S(v) for v in vertices], faces, uvs, face_uvs)
        corallite_parts.append(msh.make_part(cor.name, geometry, "skeleton", lambda i, v, w=cor.weights: dict(w), closed=True,
                                             uv_transform=lambda u, v: (u, 0.76 + v * 0.24)))
        corallite_members.setdefault(cor.node.name, set()).update(range(offset, offset + len(vertices)))
        offset += len(vertices)
    corallites_obj = msh.assemble(f"{prefix}_Corallites", corallite_parts, material_map, rig, f"{prefix}_Armature")
    corallites_obj["lod"] = 1
    for node_name, members in corallite_members.items():
        group = corallites_obj.vertex_groups.new(name=f"cor_{node_name}")
        group.add(sorted(members), 1.0, "REPLACE")

    # ---- polyp objects: one per branch cluster, rigid unskinned children of the rig.
    # Why not skinned: the glTF importer splits a skinned node that carries animated morph targets into an empty
    # plus a renamed mesh (and it does not preserve bone lengths, so bone parenting shifts too), which breaks the
    # runtime import-parity gate. See /tmp/pa-lanes/acropora_branching/shared-change-request.md. Instead every
    # polyp motion, including the branch bend the crowns ride on, is a morph target driven in lockstep with the
    # matching bone channel, so the crowns stay on their corallites.
    branch_nodes = [node for node in nodes if node.is_branch]
    polyp_objects = []
    polyp_groups: dict[str, list[tuple[Node, tuple, list, list]]] = {}
    for node, geometry, retract, lean in polyp_parts:
        polyp_groups.setdefault(node.bone, []).append((node, geometry, retract, lean))
    polyp_world: dict[tuple[str, str], np.ndarray] = {}
    polyp_rest: dict[str, list[Vector]] = {}
    polyp_targets: dict[str, dict[str, list[tuple]]] = {}
    for bone_name in [b for b in cluster_bones if b in polyp_groups]:
        parts, retract_all, lean_all, rest_all = [], [], [], []
        for node, geometry, retract, lean in polyp_groups[bone_name]:
            vertices, faces, uvs, face_uvs = geometry
            scaled = [S(v) for v in vertices]
            parts.append(msh.make_part(f"polyps_{node.name}", (scaled, faces, uvs, face_uvs), "polyp", lambda i, v: {}, closed=False))
            retract_all.extend(S(p) for p in retract)
            lean_all.extend(S(p) for p in lean)
            rest_all.extend(Vector(v) for v in scaled)
            polyp_world[(bone_name, node.name)] = np.asarray(vertices, dtype=np.float64)
        obj = msh.assemble(f"{prefix}_Polyps_{bone_name}", parts, material_map, None)
        obj["lod"] = 1
        obj.parent = rig
        polyp_rest[bone_name] = rest_all
        polyp_targets[bone_name] = {"retract": retract_all, "lean": lean_all}
        polyp_objects.append(obj)

    # ---- animation
    def bone_local_axis(bone_name: str, world_axis: Vector) -> tuple:
        rest = rig.data.bones[bone_name].matrix_local.to_3x3()
        local = rest.transposed() @ world_axis
        return tuple(local.normalized())

    bend_axes = {}
    for bone_name in cluster_bones:
        bone = rig.data.bones[bone_name]
        d = (bone.tail_local - bone.head_local).normalized()
        bend_world = d.cross(FLOW)
        if bend_world.length < 0.2:
            bend_world = Vector((0.0, 1.0, 0.0))
        bend_world.normalize()
        lateral_world = d.cross(bend_world).normalized()
        bend_axes[bone_name] = (bone_local_axis(bone_name, bend_world), bone_local_axis(bone_name, lateral_world))

    clip_specs = {name: clip for name, clip in spec["animation"].items() if isinstance(clip, dict)}
    bend_ref = max(float(c.get("branchBend", 0.0)) for c in clip_specs.values())
    sweep_ref = max(float(c.get("branchLateral", 0.0)) for c in clip_specs.values())
    bend_scale = {name: 1.0 + 0.3 * jit(seed, "amp", name) for name in cluster_bones}
    # phases live in (pi, 2pi) so every unipolar pulse is exactly zero at both ends of a loop: the colony returns
    # to its rest silhouette at the seam and each cluster surges at its own moment inside the cycle
    span = math.pi - 0.7

    def phase_of(index: int, offset: float, name: str) -> float:
        return math.pi + 0.35 + ((0.85 * index + offset + 0.6 * jit(seed, "phase", name)) % span)

    bend_phase = {name: phase_of(index, 0.0, name) for index, name in enumerate(cluster_bones)}
    sweep_phase = {name: phase_of(index, 1.3, name) for index, name in enumerate(cluster_bones)}

    def cluster_deformation(axis_index: int, degrees: float) -> dict[str, Matrix]:
        """Armature-space transform each cluster bone applies at `degrees` on its bend (0) or sweep (1) axis."""
        identity_pose(rig)
        for name in cluster_bones:
            axis = Vector(bend_axes[name][axis_index])
            rig.pose.bones[name].rotation_quaternion = Quaternion(axis, math.radians(degrees * bend_scale[name]))
        bpy.context.view_layer.update()
        result = {name: rig.pose.bones[name].matrix @ rig.data.bones[name].matrix_local.inverted() for name in cluster_bones}
        identity_pose(rig)
        bpy.context.view_layer.update()
        return result

    bend_deform = cluster_deformation(0, bend_ref) if bend_ref > 0.0 else {}
    sweep_deform = cluster_deformation(1, sweep_ref) if sweep_ref > 0.0 else {}
    for obj in polyp_objects:
        bone_name = obj.name.rsplit("_Polyps_", 1)[1]
        rest = polyp_rest[bone_name]
        targets = polyp_targets[bone_name]
        if bend_deform:
            targets["bend"] = [tuple(bend_deform[bone_name] @ p) for p in rest]
        if sweep_deform:
            targets["sweep"] = [tuple(sweep_deform[bone_name] @ p) for p in rest]
        obj.shape_key_add(name="Basis", from_mix=False)
        for key_name in ("bend", "sweep", "lean", "retract"):
            positions = targets.get(key_name)
            if positions is None:
                continue
            block = obj.shape_key_add(name=key_name, from_mix=False)
            for index, position in enumerate(positions):
                block.data[index].co = position
            block.value = 0.0

    clips = []
    for clip_name, clip in clip_specs.items():
        env = None if clip["loop"] else clip.get("envelope", "hold")
        channels: list[Channel] = []
        bend = float(clip.get("branchBend", 0.0))
        lateral = float(clip.get("branchLateral", 0.0))
        bend_frequency = float(clip.get("bendFrequency", 1.0))
        lateral_frequency = float(clip.get("lateralFrequency", 1.0))
        # branches surge downstream and return (unipolar pulse) so the polyp morph can ride along exactly
        for bone_name in cluster_bones:
            phase = bend_phase[bone_name]
            bend_axis, lateral_axis = bend_axes[bone_name]
            if bend > 0.0:
                channels.append(Channel(bone_name, "rotation", bend_axis, bend * bend_scale[bone_name], bend_frequency, phase,
                                        waveform="pulse", exponent=2.0, envelope=env))
            if lateral > 0.0:
                channels.append(Channel(bone_name, "rotation", lateral_axis, lateral * bend_scale[bone_name], lateral_frequency,
                                        sweep_phase[bone_name], waveform="pulse", exponent=2.0, envelope=env))
        for obj in polyp_objects:
            bone_name = obj.name.rsplit("_Polyps_", 1)[1]
            phase = bend_phase[bone_name]
            if bend > 0.0 and bend_ref > 0.0:
                channels.append(Channel(shape_key_target(obj.name, "bend"), "value", amplitude=bend / bend_ref,
                                        frequency=bend_frequency, phase=phase, waveform="pulse", exponent=2.0, envelope=env))
            if lateral > 0.0 and sweep_ref > 0.0:
                channels.append(Channel(shape_key_target(obj.name, "sweep"), "value", amplitude=lateral / sweep_ref,
                                        frequency=lateral_frequency, phase=sweep_phase[bone_name], waveform="pulse",
                                        exponent=2.0, envelope=env))
            # each cluster's crowns lean and close slightly out of step with its neighbours
            offset_phase = 0.7 * jit(seed, "polypphase", obj.name)
            lean_spec = clip.get("polypLean")
            if lean_spec:
                channels.append(Channel(shape_key_target(obj.name, "lean"), "value", amplitude=float(lean_spec.get("amplitude", 0.3)),
                                        frequency=float(lean_spec.get("frequency", 1.0)),
                                        phase=float(lean_spec.get("phase", 0.0)) + offset_phase,
                                        waveform=lean_spec.get("waveform", "sin"), bias=float(lean_spec.get("bias", 0.35)),
                                        envelope=lean_spec.get("envelope", env)))
            retract_spec = clip.get("polypRetract")
            if retract_spec:
                channels.append(Channel(shape_key_target(obj.name, "retract"), "value", amplitude=float(retract_spec.get("amplitude", 1.0)),
                                        frequency=float(retract_spec.get("frequency", 1.0)),
                                        phase=float(retract_spec.get("phase", 0.0)) + (offset_phase if retract_spec.get("waveform") == "sin" else 0.0),
                                        waveform=retract_spec.get("waveform", "const"), bias=float(retract_spec.get("bias", 0.0)),
                                        envelope=retract_spec.get("envelope", env)))
        clips.append(ClipSpec(clip_name, int(clip["frames"]), bool(clip["loop"]), channels))
    mesh_lookup = {obj.name: obj for obj in polyp_objects}
    for clip in clips:
        bake_clip(rig, clip, mesh_objects=mesh_lookup)
    # The glTF exporter (ACTIONS mode) only exports shape-key actions that are active or sit in an NLA strip on the
    # shape-key datablock; otherwise it bakes an extra animation named after the object. Register every clip as a
    # single-strip track on a muted track (Blender's own evaluation and the validator are unaffected) so the weights
    # channels are exported under the clip name and merged into the action's animation.
    for obj in polyp_objects:
        key = obj.data.shape_keys
        key.animation_data_create()
        for clip in clips:
            action = bpy.data.actions[clip.name]
            key.animation_data.action = action
            slot = key.animation_data.action_slot
            key.animation_data.action = None
            if slot is None:
                continue
            track = key.animation_data.nla_tracks.new()
            track.name = f"export_{clip.name}"
            strip = track.strips.new(clip.name, 1, action)
            strip.action_slot = slot
            track.mute = True

    # ---- contract
    meshes = [skeleton_obj, corallites_obj, *polyp_objects]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="xy", sample_stride=4)
    for node in nodes:
        contract["closedParts"].append({"object": skeleton_obj.name, "group": f"part_{node.name}", "volumeFloor": 0.6})
    for cor in corallites:
        if cor.geometry is not None:
            contract["closedParts"].append({"object": corallites_obj.name, "group": f"part_{cor.name}", "volumeFloor": 0.6})

    # Clearance pairs. Every unrelated pair of solids that could plausibly meet under the (small) branch motion is
    # proven; pairs that are provably far apart at rest (static gap well beyond the animated travel) are omitted so
    # the gate stays fast. `near_margin` is in design centimetres.
    near_margin = 1.2
    cor_points = {name: np.asarray([v for cor in corallites if cor.geometry is not None and cor.node.name == name
                                    for v in cor.geometry[0]], dtype=np.float64) for name in corallite_members}

    def cloud_gap(points: np.ndarray, node: Node) -> float:
        if node.kind == "tube":
            best = 1e9
            for a, b, ra, rb in zip(node.points, node.points[1:], node.radii, node.radii[1:]):
                ab = np.asarray(b - a, dtype=np.float64)
                rel = points - np.asarray(a, dtype=np.float64)
                t = np.clip(rel @ ab / max(float(ab @ ab), 1e-12), 0.0, 1.0)
                distance = np.linalg.norm(rel - t[:, None] * ab, axis=1) - (ra + (rb - ra) * t)
                best = min(best, float(distance.min()))
            return best
        if node.kind == "dome":
            radius, height, exponent, _noise = node.dome
            r = np.hypot(points[:, 0], points[:, 1])
            z = np.clip(points[:, 2], 0.0, height)
            surface = radius * np.maximum(1.0 - (z / height) ** exponent, 0.0) ** (1.0 / exponent)
            return float(np.min(np.maximum(r - surface, points[:, 2] - height)))
        z0, thickness, radius, dome_height = node.plate
        r = np.hypot(points[:, 0], points[:, 1])
        z_top = z0 + thickness + dome_height * np.clip(1.0 - r / radius, 0.0, 1.0)
        return float(np.min(np.maximum(r - radius, np.maximum(z0 - points[:, 2], points[:, 2] - z_top))))

    for i, a in enumerate(nodes):
        for b in nodes[i + 1:]:
            if b.parent is a:
                entry_a = [skeleton_obj.name, f"part_{a.name}"]
                entry_b = [skeleton_obj.name, f"part_{b.name}", f"attach_{b.name}"]
            elif a.parent is b:
                entry_a = [skeleton_obj.name, f"part_{a.name}", f"attach_{a.name}"]
                entry_b = [skeleton_obj.name, f"part_{b.name}"]
            else:
                if gaps.get(tuple(sorted((a.name, b.name))), 0.0) > 3.0 * near_margin:
                    continue
                entry_a = [skeleton_obj.name, f"part_{a.name}", f"attach_{a.name}"] if a.attach else [skeleton_obj.name, f"part_{a.name}"]
                entry_b = [skeleton_obj.name, f"part_{b.name}", f"attach_{b.name}"] if b.attach else [skeleton_obj.name, f"part_{b.name}"]
            contract["clearance"].append({"a": entry_a, "b": entry_b, "label": f"skeleton_{a.name}_{b.name}"})
    # corallites of one branch may never reach another solid; polyp crowns may only hug the branch they grow on
    for carrier_name, points in cor_points.items():
        for node in nodes:
            if node.name == carrier_name or len(points) == 0 or cloud_gap(points, node) > near_margin:
                continue
            contract["clearance"].append({"a": [corallites_obj.name, f"cor_{carrier_name}"], "b": [skeleton_obj.name, f"part_{node.name}"],
                                          "label": f"corallites_{carrier_name}_vs_{node.name}"})
    for obj in polyp_objects:
        for (owner_bone, carrier_name), points in polyp_world.items():
            if owner_bone != obj.parent_bone or len(points) == 0:
                continue
            for node in nodes:
                if node.name == carrier_name or cloud_gap(points, node) > near_margin:
                    continue
                contract["clearance"].append({"a": [obj.name, f"part_polyps_{carrier_name}"], "b": [skeleton_obj.name, f"part_{node.name}"],
                                              "label": f"polyps_{carrier_name}_vs_{node.name}"})
    contract["axialChain"] = None
    register_clips(contract, clips)

    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    notes = {"form": form, "seed": seed, "designExtentCm": extent_cm, "scaleMetersPerCm": scale, "branches": len(branch_nodes),
             "corallites": sum(1 for c in corallites if c.geometry is not None), "polyps": len(corallites),
             "clusterBones": cluster_bones, "polypObjects": [obj.name for obj in polyp_objects], "triangles": triangles,
             "clearancePairs": len(contract["clearance"]),
             "layoutExits": {node.name: round(node.s_exit, 3) for node in nodes if node.kind == "tube"}}
    print(f"[acropora] form={form} triangles={triangles} branches={len(branch_nodes)} corallites={notes['corallites']} bones={len(rb.deform_names)}")
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
