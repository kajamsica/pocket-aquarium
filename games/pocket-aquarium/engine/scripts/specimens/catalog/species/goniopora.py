"""Goniopora sp. (flowerpot coral): species-local LPS coral body plan.

Anatomy choices (Veron 1986/2000 via WoRMS; Hoeksema, Reef Corals of the Indo-Malayan Seas):
- A low hemispherical stony corallite dome (closed loft with seeded lumpiness and a painted,
  pitted corallite field with a dark calice under every polyp) sunk slightly into a squat
  rubble/plug base (closed loft). Origin base_center: the colony rests on z = 0 around x = y = 0.
- 26 long fleshy polyps of mixed size. Each polyp is one closed loft: a gently bowed stalk rising
  from its corallite (root ring embedded in the dome) that flares into an oral disc whose top dips
  into a central mouth. Every disc carries 24 short tapered tentacles (open, capped tubes) merged
  into one crown part per polyp.
- Layout: a Fibonacci canopy above the dome with seeded jitter of canopy radius, head size, bow
  direction, tentacle rotation and elevation, then a deterministic relaxation pass so heads keep a
  clearance gap. Nothing repeats rigidly.
- Rig: Root (non-deform), Base (static, dome + rock), one bone per polyp = 27 deform bones. Stalk
  weights blend from Base at the corallite to the polyp bone by mid-stalk so a bone rotation reads
  as a bend rather than a rigid lean; bone Y scale shortens the stalk for contraction.
- Clips: sway (idle loop, gentle downstream travelling sway), flow (locomotion loop, stronger sway
  with a downstream lean, harmonic and head breathing), retract (response, hold envelope, staggered
  downstream to upstream: each polyp shortens along its bone and deflates radially, which gathers
  its tentacles toward the oral axis, then re-extends). A folded-tentacle shape key is computed but
  not baked: the pinned glTF importer renames animated skinned meshes, which the runtime parity gate
  rejects (see /tmp/pa-lanes/goniopora/shared-change-request.md).
- Colour comes from the palette (variants override it): pale porous skeleton, pigmented stalks with
  a contrasting oral disc, tentacle tips in a pale accent.

Everything is derived from asset.source.json with fixed seeds (noise.scalar_hash); no random state.
"""

from __future__ import annotations

import math

import numpy as np
from mathutils import Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import noise, textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.rigging import RigBuilder

GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))
CLOSE_GROUPS = ("a", "b", "c", "d")  # downstream -> upstream retraction order, kept for the layout notes
TINTS = ((1.0, 1.0, 1.0), (0.86, 0.93, 0.86), (1.10, 1.06, 0.94), (0.94, 1.0, 1.10))


def _h(*values, seed: int) -> float:
    """Deterministic scalar in [0, 1)."""
    return noise.scalar_hash(*values, seed=seed)


def _hs(*values, seed: int) -> float:
    """Deterministic scalar in [-1, 1)."""
    return noise.scalar_hash(*values, seed=seed) * 2.0 - 1.0


def _smooth(value: float) -> float:
    return msh.smoothstep(value)


# ---------------------------------------------------------------- skeleton geometry

def dome_center_z(morph: dict) -> float:
    return float(morph["rock"]["height"]) - float(morph["dome"]["sink"])


def dome_theta_max(morph: dict) -> float:
    dome = morph["dome"]
    cos_max = (float(dome["sink"]) - float(dome["seat"])) / float(dome["height"])
    return math.acos(max(-1.0, min(1.0, cos_max)))


def dome_surface(morph: dict, theta: float, phi: float) -> Vector:
    """Point on the lumpy corallite dome at polar angle theta (0 = apex) and azimuth phi."""
    dome = morph["dome"]
    radius = float(dome["radius"])
    height = float(dome["height"])
    lump = float(dome.get("lumpiness", 0.035))
    st = math.sin(theta)
    mod = 1.0 + lump * st * (0.6 * math.sin(2.0 * phi + 1.3) + 0.4 * math.sin(3.0 * phi - 0.4))
    mod += 0.55 * lump * st * st * math.sin(5.0 * phi + 2.1)
    return Vector((radius * mod * st * math.cos(phi), radius * mod * st * math.sin(phi), dome_center_z(morph) + height * math.cos(theta)))


def dome_geometry(morph: dict):
    dome = morph["dome"]
    segments = int(dome["segments"])
    ring_count = int(dome["rings"])
    theta_max = dome_theta_max(morph)
    rings = []
    u_values = []
    for k in range(ring_count):
        theta = theta_max * (1.0 - k / ring_count)
        rings.append([tuple(dome_surface(morph, theta, j / segments * math.tau)) for j in range(segments)])
        u_values.append(k / ring_count)
    return msh.loft(rings, u_values=u_values, cap_start=True, cap_end=True)


def rock_geometry(morph: dict):
    rock = morph["rock"]
    segments = int(rock["segments"])
    radius = float(rock["radius"])
    height = float(rock["height"])
    levels = ((0.0, 0.94), (0.35, 1.0), (0.72, 0.98), (1.0, 0.90))
    rings = []
    for fraction, radius_factor in levels:
        ring = []
        for j in range(segments):
            phi = j / segments * math.tau
            mod = 1.0 + 0.06 * math.sin(3.0 * phi + 0.8) + 0.035 * math.sin(7.0 * phi - 1.9) + 0.02 * math.sin(11.0 * phi + 0.3)
            r = radius * radius_factor * mod
            z = height * fraction + (0.0008 * math.sin(4.0 * phi + 1.0) * fraction if 0.0 < fraction < 1.0 else 0.0)
            ring.append((r * math.cos(phi), r * math.sin(phi), z))
        rings.append(ring)
    return msh.loft(rings, cap_start=True, cap_end=True)


# ---------------------------------------------------------------- polyp layout

class Polyp:
    def __init__(self, index: int):
        self.index = index
        self.name = f"Polyp_{index + 1:02d}"
        self.tag = f"{index + 1:02d}"
        self.head = Vector((0.0, 0.0, 0.0))
        self.base = Vector((0.0, 0.0, 0.0))
        self.head_scale = 1.0
        self.reach = 0.0
        self.theta_base = 0.0
        self.phi_base = 0.0
        self.tile = 0
        self.group = "a"
        self.stagger = 0.0
        self.stalk = None
        self.stalk_rings = 0
        self.crown = None
        self.crown_closed: list = []
        self.crown_offset = 0
        self.stalk_offset = 0
        self.s_values: list[float] = []


def layout_polyps(spec: dict) -> tuple[list[Polyp], dict]:
    morph = spec["morphology"]
    seed = int(morph.get("seed", 7))
    count = int(morph["polypCount"])
    canopy = morph["canopy"]
    disc = morph["disc"]
    tentacles = morph["tentacles"]
    zc = dome_center_z(morph)
    radius = float(canopy["radius"])
    height = float(canopy["height"])
    theta_min = math.radians(float(canopy["minPolarDegrees"]))
    theta_max = math.radians(float(canopy["maxPolarDegrees"]))
    reach_elevation = math.radians(float(tentacles["elevationDegrees"][0]))
    polyps = [Polyp(i) for i in range(count)]
    for polyp in polyps:
        i = polyp.index
        cos_theta = math.cos(theta_min) - (i + 0.5) / count * (math.cos(theta_min) - math.cos(theta_max))
        theta = math.acos(max(-1.0, min(1.0, cos_theta))) + 0.05 * _hs(i, 1, seed=seed)
        phi = i * GOLDEN_ANGLE + 0.12 * _hs(i, 2, seed=seed)
        factor = 1.0 + float(canopy["radialJitter"]) * _hs(i, 3, seed=seed)
        if _h(i, 4, seed=seed) < float(canopy.get("elongateFraction", 0.2)):
            factor += float(canopy.get("elongateBoost", 0.12))
        polyp.head = Vector((radius * factor * math.sin(theta) * math.cos(phi),
                             radius * factor * math.sin(theta) * math.sin(phi),
                             zc + height * factor * math.cos(theta)))
        polyp.head_scale = 1.0 + float(disc["sizeJitter"]) * _hs(i, 5, seed=seed)
        polyp.reach = polyp.head_scale * (float(disc["radius"]) + float(tentacles["length"]) * (1.0 + float(tentacles["lengthJitter"])) * math.cos(reach_elevation))
        polyp.tile = i % int(morph.get("tintTiles", 4))
    # deterministic relaxation: heads keep at least minGap between their tentacle reach spheres,
    # stay on or outside 90 percent of the canopy shell and never sink below the dome's mid height
    gap = float(canopy["minGap"])
    floor_z = zc + 0.35 * height
    for _ in range(int(canopy.get("relaxIterations", 40))):
        for a in range(count):
            for b in range(a + 1, count):
                delta = polyps[a].head - polyps[b].head
                distance = delta.length
                need = polyps[a].reach + polyps[b].reach + gap
                if distance < need and distance > 1e-9:
                    push = (need - distance) * 0.5
                    delta.normalize()
                    polyps[a].head += delta * push
                    polyps[b].head -= delta * push
        for polyp in polyps:
            offset = polyp.head - Vector((0.0, 0.0, zc))
            rho = math.sqrt((offset.x / radius) ** 2 + (offset.y / radius) ** 2 + (offset.z / height) ** 2)
            if rho < 0.9:
                polyp.head = Vector((0.0, 0.0, zc)) + offset * (0.9 / max(rho, 1e-9))
            if polyp.head.z < floor_z:
                polyp.head.z = floor_z
    # corallite bases: project each head direction back onto the dome, with a little jitter
    base_theta_max = math.radians(float(canopy.get("maxBasePolarDegrees", 78.0)))
    min_length = float(morph["stalk"]["minLength"])
    for polyp in polyps:
        i = polyp.index
        direction = polyp.head - Vector((0.0, 0.0, zc))
        horizontal = math.hypot(direction.x, direction.y)
        theta_b = math.atan2(horizontal, direction.z) + 0.04 * _hs(i, 8, seed=seed)
        theta_b = max(0.05, min(base_theta_max, theta_b))
        phi_b = math.atan2(direction.y, direction.x) + 0.05 * _hs(i, 9, seed=seed)
        polyp.theta_base = theta_b
        polyp.phi_base = phi_b % math.tau
        polyp.base = dome_surface(morph, theta_b, phi_b)
        stalk = polyp.head - polyp.base
        if stalk.length < min_length:
            polyp.head = polyp.base + stalk.normalized() * min_length
    # closing groups and retract stagger follow the downstream (+X) order
    order = sorted(polyps, key=lambda p: -p.head.x)
    for rank, polyp in enumerate(order):
        polyp.group = CLOSE_GROUPS[min(len(CLOSE_GROUPS) - 1, rank * len(CLOSE_GROUPS) // count)]
        polyp.stagger = rank / max(count - 1, 1)
    min_gap = min((polyps[a].head - polyps[b].head).length - polyps[a].reach - polyps[b].reach
                  for a in range(count) for b in range(a + 1, count))
    lengths = [(p.head - p.base).length for p in polyps]
    return polyps, {"minHeadGapMeters": min_gap, "stalkLengthMeters": [min(lengths), max(lengths)]}


# ---------------------------------------------------------------- polyp geometry

def stalk_geometry(polyp: Polyp, morph: dict, seed: int):
    """Closed loft: embedded root ring, bowed stalk, flaring oral disc with a mouth dimple."""
    stalk = morph["stalk"]
    disc = morph["disc"]
    i = polyp.index
    base, head = polyp.base, polyp.head
    axis = head - base
    length = axis.length
    direction = axis.normalized()
    reference = Vector((0.0, 0.0, 1.0)) if abs(direction.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    perp_a = (reference - direction * reference.dot(direction)).normalized()
    perp_b = direction.cross(perp_a).normalized()
    bow_angle = _h(i, 6, seed=seed) * math.tau
    bow_lo, bow_hi = (float(v) for v in stalk["bow"])
    bow = (perp_a * math.cos(bow_angle) + perp_b * math.sin(bow_angle)) * length * (bow_lo + (bow_hi - bow_lo) * _h(i, 7, seed=seed))
    droop = Vector((0.0, 0.0, -1.0)) * length * float(stalk.get("droop", 0.04)) * (length / 0.02)
    embed = float(stalk["embed"]) / length
    s_values = [-embed] + [float(v) for v in stalk["sValues"]]
    radius = float(stalk["radius"])
    taper = float(stalk["taper"])
    roll = _h(i, 10, seed=seed) * math.tau
    ripple_phase = _h(i, 11, seed=seed) * math.tau
    points = []
    radii = []
    for s in s_values:
        point = base + axis * s + bow * math.sin(math.pi * max(s, 0.0)) + droop * (max(s, 0.0) ** 2)
        collar = 1.0 + 0.10 * (1.0 - _smooth(max(s, 0.0) / 0.18))
        ripple = 1.0 + 0.05 * math.sin(2.5 * math.pi * max(s, 0.0) + ripple_phase)
        points.append(point)
        radii.append(radius * collar * (1.0 - taper * max(s, 0.0)) * ripple)
    frames = msh.frames_along([tuple(p) for p in points], up_hint=(0.0, 0.0, 1.0))
    segments = int(stalk["segments"])
    rings = []
    u_values = []
    for index, (point, r) in enumerate(zip(points, radii)):
        _tangent, normal, binormal = frames[index]
        ring = []
        for j in range(segments):
            angle = j / segments * math.tau + roll
            ring.append(tuple(point + normal * (math.cos(angle) * r) + binormal * (math.sin(angle) * r)))
        rings.append(ring)
        u_values.append(0.62 * (s_values[index] + embed) / (1.0 + embed))
    tangent, normal, binormal = frames[-1]
    top = points[-1]
    disc_radius = float(disc["radius"]) * polyp.head_scale
    for (offset, fraction), u in zip(disc["profile"], disc["uValues"]):
        center = top + tangent * (float(offset) * polyp.head_scale)
        r = disc_radius * float(fraction)
        ring = []
        for j in range(segments):
            angle = j / segments * math.tau + roll
            ring.append(tuple(center + normal * (math.cos(angle) * r) + binormal * (math.sin(angle) * r)))
        rings.append(ring)
        u_values.append(float(u))
    polyp.s_values = s_values
    polyp.stalk_rings = len(rings)
    polyp.disc_frame = (top, tangent, normal, binormal, disc_radius)
    return msh.loft(rings, u_values=u_values, cap_start=True, cap_end=True)


def crown_geometry(polyp: Polyp, morph: dict, seed: int):
    """24 tapered tentacles around the oral disc rim, merged into one open part.

    Returns (geometry, closed_vertices): closed_vertices holds the folded pose of every vertex
    (same order) used for the retraction shape key: each tentacle rotates from its open
    direction toward the oral axis and shortens along its own length while keeping thickness.
    """
    tentacles = morph["tentacles"]
    i = polyp.index
    count = int(morph["tentacleCount"])
    top, tangent, normal, binormal, disc_radius = polyp.disc_frame
    hs = polyp.head_scale
    elevation_lo, elevation_hi = (math.radians(float(v)) for v in tentacles["elevationDegrees"])
    base_length = float(tentacles["length"]) * hs
    base_radius = float(tentacles["radius"]) * hs
    segments = int(tentacles["segments"])
    closed_length = float(tentacles["closedLength"])
    rim = float(tentacles.get("rimFraction", 0.86))
    seat = float(tentacles.get("seat", 0.0022)) * hs
    roll = _h(i, 12, seed=seed) * math.tau
    vertices: list = []
    faces: list = []
    uvs: list = []
    face_uvs: list = []
    closed: list = []
    for k in range(count):
        alpha = k / count * math.tau + roll + 0.05 * _hs(i, k, 13, seed=seed)
        radial = normal * math.cos(alpha) + binormal * math.sin(alpha)
        elevation = elevation_lo + (elevation_hi - elevation_lo) * _h(i, k, 14, seed=seed)
        d_open = (radial * math.cos(elevation) + tangent * math.sin(elevation)).normalized()
        length = base_length * (1.0 + float(tentacles["lengthJitter"]) * _hs(i, k, 15, seed=seed))
        root = top + tangent * seat + radial * (disc_radius * rim)
        mid = root + d_open * (0.5 * length) + tangent * (0.10 * length)
        tip = root + d_open * length + tangent * (0.24 * length)
        radii = [base_radius, base_radius * 0.90, base_radius * 0.55]
        geometry = msh.tube([tuple(root), tuple(mid), tuple(tip)], radii, segments, cap_start=False, cap_end=True, up_hint=tuple(tangent))
        d_closed = (tangent * 0.94 - radial * 0.34).normalized()
        rotation = d_open.rotation_difference(d_closed)
        offset = len(vertices)
        for vertex in geometry[0]:
            vertices.append(vertex)
            relative = Vector(vertex) - root
            along = relative.dot(d_open)
            perpendicular = relative - d_open * along
            folded = root + rotation @ (d_open * (along * closed_length) + perpendicular)
            closed.append(tuple(folded))
        faces.extend(tuple(index + offset for index in face) for face in geometry[1])
        uvs.extend(geometry[2])
        face_uvs.extend(geometry[3])
    return (vertices, faces, uvs, face_uvs), closed


def scale_geometry(geometry, factor: float):
    vertices, faces, uvs, face_uvs = geometry
    return ([(x * factor, y * factor, z * factor) for x, y, z in vertices], faces, uvs, face_uvs)


def geometry_bounds(geometries):
    low = [1e9, 1e9, 1e9]
    high = [-1e9, -1e9, -1e9]
    for geometry in geometries:
        for vertex in geometry[0]:
            for axis in range(3):
                low[axis] = min(low[axis], vertex[axis])
                high[axis] = max(high[axis], vertex[axis])
    return low, high


# ---------------------------------------------------------------- textures

def tile_tint(V: np.ndarray, tiles: int) -> np.ndarray:
    tile = np.clip(np.floor(V * tiles), 0, len(TINTS) - 1).astype(np.int64)
    return np.asarray(TINTS, dtype=np.float64)[tile]


def paint_tissue(palette: dict, width: int, height: int, tiles: int):
    U, V = textures.uv_grid(width, height)
    local_v = V * tiles - np.floor(V * tiles)
    along = noise.smoothstep(0.0, 0.5, U)
    albedo = textures.mix(textures.rgba(palette["stalkBase"], 1.0, U.shape), palette["stalk"], along)
    stria = 0.5 + 0.5 * np.sin(local_v * math.tau * 14.0 + noise.fbm(U * 6.0, local_v * 3.0, octaves=2, seed=31) * 3.0)
    stalk_zone = 1.0 - noise.smoothstep(0.60, 0.72, U)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.12 * stria * stalk_zone)
    mottle = noise.fbm(U * 9.0, V * 40.0, octaves=3, seed=41)
    albedo = textures.scale_rgb(albedo, 0.86 + 0.26 * mottle)
    rim = 1.0 - noise.smoothstep(0.03, 0.055, np.abs(U - 0.77))
    albedo = textures.mix(albedo, palette["rim"], rim * 0.75)
    disc_mask = noise.smoothstep(0.79, 0.84, U) * (1.0 - noise.smoothstep(0.945, 0.965, U))
    rays = 0.5 + 0.5 * np.cos(local_v * math.tau * 24.0)
    albedo = textures.mix(albedo, palette["disc"], disc_mask)
    albedo = textures.scale_rgb(albedo, 1.0 - 0.16 * rays * disc_mask)
    mouth = noise.smoothstep(0.95, 0.97, U)
    albedo = textures.mix(albedo, palette["mouth"], mouth)
    tint = tile_tint(V, tiles)
    albedo[..., :3] *= tint
    roughness = 0.42 + 0.14 * stria * stalk_zone + 0.10 * disc_mask + 0.06 * (mottle - 0.5)
    relief = 0.5 + 0.22 * (stria - 0.5) * stalk_zone + 0.16 * (mottle - 0.5) + 0.14 * rays * disc_mask - 0.3 * mouth
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(np.clip(relief, 0.0, 1.0), 1.2)}


def paint_tentacle(palette: dict, width: int, height: int, tiles: int):
    U, V = textures.uv_grid(width, height)
    albedo = textures.rgba(palette["tentacle"], 1.0, U.shape)
    mottle = noise.fbm(U * 4.0, V * 30.0, octaves=2, seed=51)
    albedo = textures.scale_rgb(albedo, 0.88 + 0.24 * mottle)
    tip = noise.smoothstep(0.58, 0.92, U)
    albedo = textures.mix(albedo, palette["tentacleTip"], tip)
    albedo[..., :3] *= tile_tint(V, tiles)
    return {"albedo": albedo, "roughness": textures.grey(0.36 + 0.10 * mottle)}


def paint_skeleton(palette: dict, morph: dict, polyps: list[Polyp], width: int, height: int):
    U, V = textures.uv_grid(width, height)
    # densely packed calices: wide shallow cups with thin walls (Worley F1 with a late threshold)
    distance, _ident = noise.cells(V * 60.0, U * 14.0, seed=61)
    walls = noise.smoothstep(0.30, 0.48, distance)
    cup = 1.0 - noise.smoothstep(0.12, 0.36, distance)
    grain = noise.fbm(U * 30.0, V * 120.0, octaves=3, seed=62)
    relief = 0.30 + 0.45 * walls + 0.10 * (1.0 - cup) + 0.15 * (grain - 0.5)
    albedo = textures.rgba(palette["skeleton"], 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.84 + 0.18 * walls - 0.09 * cup + 0.10 * (grain - 0.5))
    algae = (1.0 - noise.smoothstep(0.04, 0.32, U)) * 0.55
    albedo = textures.mix(albedo, (0.42, 0.40, 0.26), algae)
    # living coenosarc: a thin film of polyp-coloured tissue over the upper corallite field
    coenosarc = tuple(0.55 * s + 0.45 * t for s, t in zip(palette["skeleton"], palette["stalkBase"]))
    film = noise.smoothstep(0.30, 0.70, U) * (0.42 - 0.22 * cup) * (0.7 + 0.6 * noise.fbm(U * 4.0, V * 9.0, octaves=2, seed=63))
    albedo = textures.mix(albedo, coenosarc, np.clip(film, 0.0, 1.0))
    # a dark calice under every polyp, placed from the layout in the dome's own UV space
    theta_max = dome_theta_max(morph)
    dome = morph["dome"]
    meridian = theta_max * (float(dome["radius"]) + float(dome["height"])) * 0.5
    stalk_radius = float(morph["stalk"]["radius"]) * 1.15
    calice_total = np.zeros_like(U)
    for polyp in polyps:
        u_b = 1.0 - polyp.theta_base / theta_max
        v_b = polyp.phi_base / math.tau
        du = stalk_radius / meridian
        dv = stalk_radius / max(math.tau * float(dome["radius"]) * math.sin(polyp.theta_base), 1e-6)
        dv_wrap = np.abs(V - v_b)
        dv_wrap = np.minimum(dv_wrap, 1.0 - dv_wrap)
        ellipse = np.sqrt(((U - u_b) / du) ** 2 + (dv_wrap / dv) ** 2)
        calice_total = np.maximum(calice_total, 1.0 - noise.smoothstep(0.8, 1.15, ellipse))
    albedo = textures.mix(albedo, palette["calice"], calice_total * 0.7)
    relief = np.clip(relief - 0.3 * calice_total, 0.0, 1.0)
    roughness = 0.80 + 0.14 * (1.0 - walls) + 0.04 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": relief}


def paint_rock(palette: dict, width: int, height: int):
    U, V = textures.uv_grid(width, height)
    coarse = noise.fbm(U * 5.0, V * 12.0, octaves=3, seed=71)
    fine = noise.fbm(U * 24.0, V * 60.0, octaves=3, seed=72)
    albedo = textures.rgba(palette["rock"], 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.7 + 0.5 * coarse + 0.2 * (fine - 0.5))
    albedo = textures.mix(albedo, (0.30, 0.26, 0.16), noise.smoothstep(0.55, 0.8, coarse) * 0.5)
    relief = np.clip(0.5 + 0.3 * (coarse - 0.5) + 0.25 * (fine - 0.5), 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(0.86 + 0.08 * (fine - 0.5)), "normal": textures.normal_from_height(relief, 1.4)}


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morph = spec["morphology"]
    seed = int(morph.get("seed", 7))
    palette = spec["palette"]
    tiles = int(morph.get("tintTiles", 4))

    # ---- layout and raw geometry (design units), then one honest uniform scale to referenceSize
    polyps, layout_notes = layout_polyps(spec)
    dome = dome_geometry(morph)
    rock = rock_geometry(morph)
    for polyp in polyps:
        polyp.stalk = stalk_geometry(polyp, morph, seed)
        polyp.crown, polyp.crown_closed = crown_geometry(polyp, morph, seed)
    low, high = geometry_bounds([dome, rock] + [p.stalk for p in polyps] + [p.crown for p in polyps])
    extent_xy = max(high[0] - low[0], high[1] - low[1])
    factor = float(spec["referenceSize"]["meters"]) / extent_xy
    dome = scale_geometry(dome, factor)
    rock = scale_geometry(rock, factor)
    for polyp in polyps:
        polyp.stalk = scale_geometry(polyp.stalk, factor)
        polyp.crown = scale_geometry(polyp.crown, factor)
        polyp.crown_closed = [(x * factor, y * factor, z * factor) for x, y, z in polyp.crown_closed]
        polyp.base = polyp.base * factor
        polyp.head = polyp.head * factor
    apex_z = max(v[2] for v in dome[0])

    # ---- textures and materials
    tex = spec.get("textures", {})
    written = []
    images = {}

    def write(kind: str, key: str, pixels, non_color: bool):
        path = ctx.texture_dir / f"{kind}-{key}.png"
        images[f"{kind}:{key}"] = textures.write_image(f"{prefix}_{kind}_{key}", path, pixels, non_color)
        written.append(path)

    tissue = paint_tissue(palette, *tex.get("tissueResolution", [1024, 512]), tiles)
    write("tissue", "albedo", tissue["albedo"], False)
    write("tissue", "roughness", tissue["roughness"], True)
    write("tissue", "normal", tissue["normal"], True)
    tentacle = paint_tentacle(palette, *tex.get("tentacleResolution", [512, 256]), tiles)
    write("tentacle", "albedo", tentacle["albedo"], False)
    write("tentacle", "roughness", tentacle["roughness"], True)
    skeleton = paint_skeleton(palette, morph, polyps, *tex.get("skeletonResolution", [1024, 512]))
    write("skeleton", "albedo", skeleton["albedo"], False)
    write("skeleton", "roughness", skeleton["roughness"], True)
    write("skeleton", "normal", textures.normal_from_height(skeleton["normal"], float(tex.get("skeletonNormalStrength", 1.6))), True)
    rock_paint = paint_rock(palette, *tex.get("rockResolution", [512, 256]))
    write("rock", "albedo", rock_paint["albedo"], False)
    write("rock", "roughness", rock_paint["roughness"], True)
    write("rock", "normal", rock_paint["normal"], True)

    def subsurface_scale(material, value: float):
        shader = material.node_tree.nodes.get("Principled BSDF")
        if shader is not None and "Subsurface Scale" in shader.inputs:
            shader.inputs["Subsurface Scale"].default_value = value

    skeleton_material = mat.principled(f"{prefix}_Skeleton", palette["skeleton"], 0.85, coat=0.0, subsurface=0.0, specular=0.25)
    mat.attach_textures(skeleton_material, albedo=images["skeleton:albedo"], roughness=images["skeleton:roughness"],
                        normal=images["skeleton:normal"], normal_strength=1.0)
    rock_material = mat.principled(f"{prefix}_Rock", palette["rock"], 0.9, coat=0.0, subsurface=0.0, specular=0.2)
    mat.attach_textures(rock_material, albedo=images["rock:albedo"], roughness=images["rock:roughness"], normal=images["rock:normal"], normal_strength=0.8)
    tissue_material = mat.principled(f"{prefix}_Tissue", palette["stalk"], 0.45, coat=0.15, subsurface=0.18, specular=0.4)
    subsurface_scale(tissue_material, 0.003)
    mat.attach_textures(tissue_material, albedo=images["tissue:albedo"], roughness=images["tissue:roughness"], normal=images["tissue:normal"],
                        normal_strength=float(tex.get("tissueNormalStrength", 0.6)))
    tentacle_material = mat.principled(f"{prefix}_Tentacle", palette["tentacle"], 0.4, coat=0.2, subsurface=0.25, specular=0.4)
    subsurface_scale(tentacle_material, 0.002)
    mat.attach_textures(tentacle_material, albedo=images["tentacle:albedo"], roughness=images["tentacle:roughness"])
    material_map = {"skeleton": skeleton_material, "rock": rock_material, "tissue": tissue_material, "tentacle": tentacle_material}

    # ---- rig: Root (non-deform), Base (static), one bone per polyp
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.01 * factor), deform=False)
    rb.bone("Base", (0.0, 0.0, 0.002 * factor), (0.0, 0.0, apex_z), "Root")
    for polyp in polyps:
        rb.bone(polyp.name, tuple(polyp.base), tuple(polyp.head), "Base", roll_up=(1.0, 0.0, 0.0))
    rig = rb.finish()

    # ---- skeleton object: dome + rock, weighted to the static Base bone
    dome_part = msh.make_part("skeleton", dome, "skeleton", lambda i, v: {"Base": 1.0}, closed=True)
    rock_part = msh.make_part("rock", rock, "rock", lambda i, v: {"Base": 1.0}, closed=True)
    skeleton_obj = msh.assemble(f"{prefix}_Skeleton", [dome_part, rock_part], material_map, rig, f"{prefix}_Armature")
    skeleton_obj["lod"] = 1

    # ---- polyp object: stalk (closed) + crown (open) per polyp
    stalk_segments = int(morph["stalk"]["segments"])
    parts = []
    running = 0
    for polyp in polyps:
        polyp.stalk_offset = running
        ring_count = polyp.stalk_rings
        s_values = polyp.s_values
        stalk_root = set(range(stalk_segments)) | {ring_count * stalk_segments}
        all_stalk = set(range(len(polyp.stalk[0])))

        def stalk_weights(index, vertex, name=polyp.name, rings=ring_count, s_values=s_values):
            ring_index = index // stalk_segments
            if ring_index >= rings:  # cap centres: start -> Base, end -> polyp bone
                return {"Base": 1.0} if index == rings * stalk_segments else {name: 1.0}
            s = s_values[ring_index] if ring_index < len(s_values) else 1.0
            w = _smooth((s - 0.04) / 0.50)
            if w <= 0.0:
                return {"Base": 1.0}
            if w >= 1.0:
                return {name: 1.0}
            return {"Base": 1.0 - w, name: w}

        tile = polyp.tile

        def uv_tile(u, v, tile=tile):
            return (u, (tile + v) / tiles)

        stalk_part = msh.make_part(f"stalk_{polyp.tag}", polyp.stalk, "tissue", stalk_weights, closed=True,
                                   groups={f"polyp_{polyp.tag}": all_stalk, f"attach_{polyp.tag}": stalk_root}, uv_transform=uv_tile)
        parts.append(stalk_part)
        running += len(stalk_part.vertices)
        polyp.crown_offset = running
        crown_part = msh.make_part(f"crown_{polyp.tag}", polyp.crown, "tentacle", lambda i, v, name=polyp.name: {name: 1.0}, closed=False,
                                   groups={f"polyp_{polyp.tag}": set(range(len(polyp.crown[0])))}, uv_transform=uv_tile)
        parts.append(crown_part)
        running += len(crown_part.vertices)
    polyps_obj = msh.assemble(f"{prefix}_Polyps", parts, material_map, rig, f"{prefix}_Armature")
    polyps_obj["lod"] = 1
    # Note: a folded-tentacle shape key was authored and validated at source level, but the pinned
    # glTF importer splits any animated skinned mesh node into an empty plus a renamed mesh, which
    # the runtime parity gate rejects, so retraction is expressed through bone scale only (see
    # /tmp/pa-lanes/goniopora/shared-change-request.md). crown_closed stays available for that.

    # ---- animation
    clips = []
    for clip_name, clip in spec["animation"].items():
        channels: list[Channel] = []
        env = None if clip["loop"] else clip.get("envelope", "hold")
        if clip["loop"]:
            sway = float(clip["swayDegrees"])
            wobble = float(clip["wobbleDegrees"])
            breath = float(clip.get("breath", 0.0))
            wavelength = float(clip.get("wavelength", 0.3))
            jitter = float(clip.get("phaseJitter", 0.15))
            lean = float(clip.get("lean", 0.0))
            harmonic = float(clip.get("harmonic", 0.0))
            pulse = float(clip.get("headPulse", 0.0))
            for polyp in polyps:
                i = polyp.index
                amplitude = sway * (0.75 + 0.5 * _h(i, 20, seed=seed))
                phase = -math.tau * polyp.head.x / wavelength + jitter * _hs(i, 21, seed=seed)
                channels.append(Channel(polyp.name, "rotation", (1.0, 0.0, 0.0), amplitude, 1.0, phase, bias=lean))
                if harmonic > 0.0:
                    channels.append(Channel(polyp.name, "rotation", (1.0, 0.0, 0.0), amplitude * harmonic, 2.0, phase * 2.0 + 0.6))
                channels.append(Channel(polyp.name, "rotation", (0.0, 0.0, 1.0), wobble * (0.7 + 0.6 * _h(i, 22, seed=seed)),
                                        2.0 if clip_name == "sway" else 3.0, _h(i, 23, seed=seed) * math.tau))
                if breath > 0.0:
                    channels.append(Channel(polyp.name, "scale", (0.0, 1.0, 0.0), breath, 1.0, phase + 1.0))
                if pulse > 0.0:
                    # slow radial breathing of the flower head (tentacles spread and gather)
                    channels.append(Channel(polyp.name, "scale", (1.0, 0.0, 1.0), pulse, 1.0, _h(i, 26, seed=seed) * math.tau))
        else:
            shorten = float(clip["shorten"])
            deflate = float(clip.get("deflate", 0.22))
            stagger = float(clip.get("stagger", 0.45))
            lean = float(clip.get("lean", 2.5))
            for polyp in polyps:
                i = polyp.index
                phase = stagger * (1.0 - polyp.stagger)
                depth = shorten * (0.85 + 0.3 * _h(i, 24, seed=seed))
                # contraction: the polyp expels water, so it shortens along the bone and deflates
                # radially, which draws the 24 tentacles together toward the oral axis
                channels.append(Channel(polyp.name, "scale", (0.0, 1.0, 0.0), -depth, 0.5, phase, waveform="pulse", exponent=0.8, envelope=env))
                channels.append(Channel(polyp.name, "scale", (1.0, 0.0, 1.0), -deflate, 0.5, phase, waveform="pulse", exponent=0.8, envelope=env))
                # every clip keys rotation as well as scale so each clip starts from, and the
                # validator samples, a fully defined pose; the contracting polyp dips downstream
                channels.append(Channel(polyp.name, "rotation", (1.0, 0.0, 0.0), lean * (0.7 + 0.6 * _h(i, 25, seed=seed)), 0.5, phase,
                                        waveform="pulse", exponent=0.8, envelope=env))
        clips.append(ClipSpec(clip_name, int(clip["frames"]), bool(clip["loop"]), channels))
    mesh_lookup = {skeleton_obj.name: skeleton_obj, polyps_obj.name: polyps_obj}
    for clip in clips:
        bake_clip(rig, clip, mesh_objects=mesh_lookup)

    # ---- contract
    meshes = [skeleton_obj, polyps_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="xy")
    contract["closedParts"].append({"object": skeleton_obj.name, "group": "part_skeleton", "volumeFloor": 0.9})
    contract["closedParts"].append({"object": skeleton_obj.name, "group": "part_rock", "volumeFloor": 0.9})
    for polyp in polyps:
        # a contracting polyp genuinely deflates (shorter and thinner), so its floor is lower than
        # a rigid body's; the skeleton and rock never move and keep a tight floor
        contract["closedParts"].append({"object": polyps_obj.name, "group": f"part_stalk_{polyp.tag}", "volumeFloor": 0.3})
        contract["clearance"].append({"a": [polyps_obj.name, f"polyp_{polyp.tag}", f"attach_{polyp.tag}"],
                                      "b": [skeleton_obj.name, "part_skeleton"], "label": f"polyp_{polyp.tag}_skeleton"})
        contract["clearance"].append({"a": [polyps_obj.name, f"polyp_{polyp.tag}", f"attach_{polyp.tag}"],
                                      "b": [skeleton_obj.name, "part_rock"], "label": f"polyp_{polyp.tag}_rock"})
    neighbour_pairs = 0
    for a in range(len(polyps)):
        for b in range(a + 1, len(polyps)):
            if (polyps[a].head - polyps[b].head).length < 0.4 * float(spec["referenceSize"]["meters"]):
                contract["clearance"].append({"a": [polyps_obj.name, f"polyp_{polyps[a].tag}"], "b": [polyps_obj.name, f"polyp_{polyps[b].tag}"],
                                              "label": f"polyp_{polyps[a].tag}_polyp_{polyps[b].tag}"})
                neighbour_pairs += 1
    register_clips(contract, clips)

    triangles = sum(len(face) - 2 for part in [dome_part, rock_part] + parts for face in part.faces)
    notes = {"polypCount": len(polyps), "tentaclesPerPolyp": int(morph["tentacleCount"]), "uniformScale": factor,
             "estimatedTriangles": triangles, "neighbourClearancePairs": neighbour_pairs,
             "minHeadGapMeters": layout_notes["minHeadGapMeters"] * factor,
             "stalkLengthMeters": [v * factor for v in layout_notes["stalkLengthMeters"]],
             "domeApexMeters": apex_z}
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
