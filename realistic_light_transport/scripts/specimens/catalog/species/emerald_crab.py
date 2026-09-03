"""Mithraculus sculptus (emerald crab): species-local brachyuran crab body plan.

Anatomy choices (all dimensions from asset.source.json, meters, forward +X, up +Z, origin base_center):

* Carapace: one closed vertical-superellipse loft whose plan outline blends an ellipse with a
  flat-fronted hexagon (subhexagonal Mithracidae outline), narrowed anteriorly, with three blunt
  anterolateral teeth per side, a shallow median frontal notch and a low lobe relief (gastric,
  cardiac, branchial, hepatic regions) displaced on the dome. Flat ventral face; a flattened abdomen
  plate is tucked under the sternum.
* Walking legs: four pairs of segmented closed tubes (coxa -> merus -> carpus -> propodus -> dactyl)
  with radius dips at every joint, splayed fore/aft and bent down so every dactyl tip rests on z = 0.
  Two deform bones per leg (merus, carpus+propodus+dactyl) blended at the knee.
* Chelipeds: merus+carpus tube, a laterally compressed palm tube that continues into the fixed
  finger (pollex), and a separate movable dactyl with a spoon-shaped tip; three bones per side.
* Eyestalks with dark corneas in the anterolateral orbits; short antennae between them.
* Left parts are built once and mirrored with MeshPart.mirror_y so vertex order matches for the
  symmetry gate. Clearance is proven between adjacent legs, cheliped and first leg, dactyl and palm,
  every appendage and the carapace; center-plane checks keep every side on its own side.
* Clips: rest (eyestalk/claw/antenna twitch, breathing bob), walk (lateral alternating-tetrapod
  stepping toward the crab's left with lift pulses and knee extension), threat (bell: chelae raise
  and spread, dactyls open, body lifts and pitches up, stance widens).
* Textures: authored numpy paint only. Carapace albedo/roughness/normal (lobes, granular crust,
  pale sternum), leg maps (joint seams, tan setae flecks, darker dactyls), claw maps (green palm,
  dark fingers, pale spoon tips).

The whole rest pose is normalised uniformly so the leg-tip spread along y equals referenceSize.
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

LEG_U = (0.0, 0.08, 0.42, 0.52, 0.80, 1.0)  # texture u at root, coxa, knee, carpus end, propodus end, tip
ARM_U = (0.0, 0.08, 0.42, 0.52)  # cheliped merus/carpus share the leg texture seams


# ---------------------------------------------------------------- scalar helpers

def _sstep(edge0: float, edge1: float, value: float) -> float:
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def _gauss(x: float, y: float, cx: float, cy: float, sx: float, sy: float) -> float:
    return math.exp(-((x - cx) / sx) ** 2 - ((y - cy) / sy) ** 2)


def _fix_caps(geometry, segments: int):
    """Wind the two cap fans of a lib loft/tube/ellipsoid like their side faces.

    lib.meshing.loft and lib.meshing.ellipsoid emit their pole/cap fans with the opposite winding to
    the quads they close (see /tmp/pa-lanes/emerald_crab/shared-change-request.md); on a flat crab
    dome the inverted fan renders as a dark star, so the last 2 * segments faces are reversed here."""
    vertices, faces, uvs, face_uvs = geometry
    faces = list(faces)
    count = len(faces)
    for index in range(count - 2 * segments, count):
        faces[index] = tuple(reversed(faces[index]))
    if face_uvs:
        face_uvs = list(face_uvs)
        for index in range(count - 2 * segments, count):
            face_uvs[index] = tuple(reversed(face_uvs[index]))
    return vertices, faces, uvs, face_uvs


def _tube(points, radii, segments: int, **kwargs):
    return _fix_caps(msh.tube(points, radii, segments, **kwargs), segments)


def _ellipsoid(center, radii, segments: int, rings: int, axis_rotation=None):
    return _fix_caps(msh.ellipsoid(center, radii, segments, rings, axis_rotation), segments)


# ---------------------------------------------------------------- carapace

def _outline(theta: float, ax: float, ay: float, narrow_front: float, narrow_back: float, tooth: float):
    """Plan-view outline point at azimuth theta (0 = anterior midline, increasing toward +y)."""
    ex, ey = ax * math.cos(theta), ay * math.sin(theta)
    wedge = ((theta + math.pi / 6.0) % (math.pi / 3.0)) - math.pi / 6.0
    rh = 1.0 / math.cos(wedge)
    hx, hy = rh * math.cos(theta) * ax, rh * math.sin(theta) * ay / 1.1547005
    x = 0.5 * ex + 0.5 * hx
    y = 0.5 * ey + 0.5 * hy
    fx = x / ax
    y *= 1.0 - narrow_front * _sstep(0.15, 1.0, fx) - narrow_back * _sstep(0.35, 1.0, -fx)
    # blunt anterolateral teeth (three per side) and the shallow median frontal notch
    a = abs(math.atan2(y, x))
    bump = sum(math.exp(-((a - math.radians(deg)) / 0.085) ** 2) for deg in (46.0, 66.0, 86.0))
    scale = 1.0 + tooth * bump
    notch = 1.0 - 0.035 * math.exp(-(a / 0.10) ** 2)
    return x * scale * notch, y * scale


# carapace regions as (amplitude, centre x, centre y, sigma x, sigma y) in normalised plan coordinates;
# the gastric lobe sits on the loft pole so the dome centre is a crest, not a saddle
LOBES = (
    (0.60, 0.10, 0.0, 0.42, 0.45),  # gastric
    (0.40, -0.55, 0.0, 0.25, 0.26),  # cardiac
    (0.42, -0.25, 0.66, 0.33, 0.24),  # branchial right
    (0.42, -0.25, -0.66, 0.33, 0.24),  # branchial left
    (0.28, 0.60, 0.50, 0.20, 0.18),  # hepatic right
    (0.28, 0.60, -0.50, 0.20, 0.18),  # hepatic left
)
LOBE_BASELINE = 0.35


def _relief(nx: float, ny: float) -> float:
    """Normalised lobe height field over the dome (plan coordinates in [-1, 1])."""
    return sum(amp * _gauss(nx, ny, cx, cy, sx, sy) for amp, cx, cy, sx, sy in LOBES) - LOBE_BASELINE


def _lobes_np(px: np.ndarray, py: np.ndarray) -> np.ndarray:
    total = np.zeros_like(px)
    for amp, cx, cy, sx, sy in LOBES:
        total = total + amp * np.exp(-((px - cx) / sx) ** 2 - ((py - cy) / sy) ** 2)
    return total


def carapace_geometry(car: dict):
    ax, ay = float(car["halfLength"]), float(car["halfWidth"])
    zc = float(car["centerZ"])
    h_top, h_bot = float(car["domeHeight"]), float(car["ventralDepth"])
    p_top, p_bot = float(car["domeExponent"]), float(car["ventralExponent"])
    segments, ring_count = int(car["segments"]), int(car["rings"])
    relief = float(car.get("reliefMeters", 0.001))
    narrow_front, narrow_back = float(car.get("anteriorNarrowing", 0.16)), float(car.get("posteriorNarrowing", 0.08))
    tooth = float(car.get("toothBulge", 0.03))
    stations = [0.3] + [float(k) for k in range(1, ring_count)] + [ring_count - 0.3]
    rings, us = [], []
    for k in stations:
        phi = k / ring_count * math.pi
        vertical = -math.cos(phi)
        p = p_top if vertical >= 0 else p_bot
        radial = math.sin(phi) ** (2.0 / p)
        zf = math.copysign(abs(vertical) ** (2.0 / p), vertical)
        z = zc + zf * (h_top if vertical >= 0 else h_bot)
        dome = _sstep(0.25, 0.85, vertical)
        ring = []
        for segment in range(segments):
            theta = segment / segments * math.tau
            ox, oy = _outline(theta, ax, ay, narrow_front, narrow_back, tooth)
            x, y = ox * radial, oy * radial
            dz = _relief(x / ax, y / ay) * relief * dome
            ring.append((x, y, z + dz))
        rings.append(ring)
        us.append(k / ring_count)
    vertices, faces, uvs, face_uvs = _fix_caps(msh.loft(rings, u_values=us, cap_start=True, cap_end=True), segments)
    # the dome cap centre follows the same relief field instead of the mean ring height, so the
    # gastric/cardiac saddle does not read as a dimple in the pole fan
    cx, cy, _cz = vertices[-1]
    vertices[-1] = (cx, cy, zc + h_top + _relief(cx / ax, cy / ay) * relief)
    return plan_uvs((vertices, faces, uvs, face_uvs), ax, ay, zc)


def plan_uv(vertex, ax: float, ay: float, top: bool):
    """Planar UV: the dome occupies the left texture tile, the underside the right tile."""
    nx = max(-1.0, min(1.0, vertex[0] / (ax * 1.06)))
    ny = max(-1.0, min(1.0, vertex[1] / (ay * 1.06)))
    return ((0.25 if top else 0.75) + 0.23 * nx, 0.5 + 0.47 * ny)


def plan_uvs(geometry, ax: float, ay: float, zc: float, force_top: bool | None = None):
    """Replace loft UVs with per-face planar UVs so the carapace paint has no polar pinch."""
    vertices, faces, _uvs, _face_uvs = geometry
    uvs = [plan_uv(v, ax, ay, v[2] >= zc if force_top is None else force_top) for v in vertices]
    face_uvs = []
    for face in faces:
        top = (sum(vertices[i][2] for i in face) / len(face) >= zc) if force_top is None else force_top
        face_uvs.append(tuple(plan_uv(vertices[i], ax, ay, top) for i in face))
    return vertices, faces, uvs, face_uvs


def edge_y(car: dict, x: float) -> float:
    """Lateral half-extent of the carapace outline at x (positive y side)."""
    ax, ay = float(car["halfLength"]), float(car["halfWidth"])
    best = None
    for k in range(400):
        theta = math.pi * 0.08 + (math.pi * 0.84) * k / 399  # sweep the +y half of the outline
        ox, oy = _outline(theta, ax, ay, float(car.get("anteriorNarrowing", 0.16)), float(car.get("posteriorNarrowing", 0.08)), 0.0)
        error = abs(ox - x)
        if best is None or error < best[0]:
            best = (error, oy)
    return best[1]


# ---------------------------------------------------------------- limbs

def _dist(a, b) -> float:
    return math.sqrt(sum((bi - ai) ** 2 for ai, bi in zip(a, b)))


def _limb(joints, radii, u_joints, seam: float = 0.84, fillet: float = 0.0009, mids: int = 1):
    """Densified polyline through the joints with joint seam dips (pure double precision).

    Returns points, radii, u values and the point index of every joint."""
    points, rads, us, joint_index = [], [], [], []
    n = len(joints)
    for j in range(n):
        if j == 0:
            points.append(tuple(float(c) for c in joints[0]))
            rads.append(radii[0])
            us.append(u_joints[0])
            joint_index.append(0)
            continue
        a, b = joints[j - 1], joints[j]
        length = _dist(a, b)
        d = tuple((bi - ai) / length for ai, bi in zip(a, b))
        ua, ub = u_joints[j - 1], u_joints[j]
        ra, rb = radii[j - 1], radii[j]
        f_prev = min(fillet, length * 0.3) if j - 1 > 0 else 0.0
        f_this = min(fillet, length * 0.3) if j < n - 1 else 0.0

        def station(distance: float):
            t = distance / length
            points.append(tuple(ai + di * distance for ai, di in zip(a, d)))
            rads.append(ra + (rb - ra) * t)
            us.append(ua + (ub - ua) * t)

        if f_prev > 0:
            station(f_prev)
        for k in range(1, mids + 1):
            station(f_prev + (length - f_prev - f_this) * k / (mids + 1))
        if f_this > 0:
            station(length - f_this)
        # the joint itself, exactly on the authored coordinate, with the seam dip on interior joints
        joint_index.append(len(points))
        points.append(tuple(float(c) for c in b))
        rads.append(rb * (seam if j < n - 1 else 1.0))
        us.append(ub)
    return points, rads, us, joint_index


def _cumulative(points):
    total = [0.0]
    for a, b in zip(points, points[1:]):
        total.append(total[-1] + _dist(a, b))
    return [t / total[-1] for t in total]


def _tube_ring(index: int, point_count: int, segments: int) -> int:
    """Ring index of a tube vertex (cap centres map to the first/last ring)."""
    if index < point_count * segments:
        return index // segments
    return 0 if index == point_count * segments else point_count - 1


def _ring_group(point_count: int, segments: int, rings: range, include_start_cap: bool = False, include_end_cap: bool = False):
    members = {r * segments + s for r in rings for s in range(segments)}
    if include_start_cap:
        members.add(point_count * segments)
    if include_end_cap:
        members.add(point_count * segments + 1)
    return members


def leg_joints(car: dict, legs: dict, index: int, zc: float):
    """Joint chain (root, coxa, knee, carpus end, propodus end, tip) of the left leg `index`."""
    x0 = float(legs["rootX"][index])
    rho_edge = edge_y(car, x0)
    embed = float(legs["embed"])

    def step(origin, dx, length, angle):
        return (origin[0] + dx, origin[1] - length * math.cos(angle), origin[2] + length * math.sin(angle))

    root = (x0, -(rho_edge - embed), zc - 0.0008)
    coxa = (x0, -(rho_edge + 0.0005), zc - 0.0005)
    dx_knee, dx_tip = float(legs["kneeDx"][index]), float(legs["tipDx"][index])
    a_m = math.radians(float(legs["merusDegrees"][index]))
    knee = step(coxa, dx_knee, float(legs["merusLength"][index]), a_m)
    a_c = math.radians(float(legs["carpusDegrees"]))
    carpus_end = step(knee, (dx_tip - dx_knee) * 0.3, float(legs["carpusLength"]), a_c)
    a_p = math.radians(float(legs["propodusDegrees"]))
    a_d = math.radians(float(legs["dactylDegrees"]))
    ld = float(legs["dactylLength"])
    tip_r = float(legs["tipRadius"])
    # propodus length solved so the dactyl tip rests on the substrate
    lp = (carpus_end[2] + ld * math.sin(a_d) - tip_r) / (-math.sin(a_p))
    propodus_end = step(carpus_end, (dx_tip - dx_knee) * 0.45, lp, a_p)
    tip = step(propodus_end, (dx_tip - dx_knee) * 0.25, ld, a_d)
    joints = [root, coxa, knee, carpus_end, propodus_end, tip]
    radii = [float(legs["rootRadius"]), float(legs["coxaRadius"]), float(legs["kneeRadius"]), float(legs["carpusRadius"]),
             float(legs["propodusEndRadius"]), tip_r]
    return joints, radii


# ---------------------------------------------------------------- textures

def paint_carapace(width: int, height: int, palette: dict, strength: float):
    """Two plan-view tiles: dome (left half) and underside (right half), matching plan_uv."""
    U, V = textures.uv_grid(width, height)
    top = 1.0 - noise.smoothstep(0.495, 0.505, U)
    px = np.where(U < 0.5, (U - 0.25) / 0.23, (U - 0.75) / 0.23)
    py = (V - 0.5) / 0.47
    rr = np.sqrt(px * px + py * py)
    # the same lobe field the geometry is displaced with, so shading and relief agree
    lobes = np.clip(_lobes_np(px, py) / 0.72, 0.0, 1.0)
    grooves = 1.0 - noise.smoothstep(0.25, 0.62, lobes)
    distance, ident = noise.cells(px * 34.0 + 50.0, py * 34.0 + 50.0, seed=31)
    granule = (1.0 - noise.smoothstep(0.10, 0.26, distance)) * noise.smoothstep(0.30, 0.75, lobes) * top
    fine = noise.fbm(px * 14.0 + 7.0, py * 14.0 + 3.0, octaves=3, seed=12)
    margin = noise.smoothstep(0.80, 1.02, rr)
    front_teeth = noise.smoothstep(0.55, 0.9, px) * noise.smoothstep(0.35, 0.7, np.abs(py)) * top
    height_field = np.clip(0.5 + 0.22 * (lobes - 0.5) * top + 0.14 * granule + 0.06 * (fine - 0.5) - 0.06 * margin * top, 0.0, 1.0)

    albedo = textures.rgba(palette["carapace"], 1.0, U.shape)
    albedo = textures.mix(albedo, palette["carapaceDeep"], grooves * 0.8)
    albedo = textures.mix(albedo, palette["carapaceDeep"], margin * 0.45)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.2 * fine)
    crust = granule * noise.smoothstep(0.55, 0.85, ident) * (0.4 + 0.6 * front_teeth)
    albedo = textures.mix(albedo, palette["crust"], crust * 0.55)
    # underside tile: pale sternum with the folded abdomen sutures (transverse lines) and a dark rim
    under = textures.rgba(palette["underside"], 1.0, U.shape)
    under = textures.scale_rgb(under, 0.92 + 0.16 * fine)
    abdomen_mask = (1.0 - noise.smoothstep(0.85, 1.0, np.sqrt(((px + 0.21) / 0.52) ** 2 + (py / 0.42) ** 2)))
    sutures = np.zeros_like(U)
    for cx in (-0.62, -0.44, -0.26, -0.08, 0.10):
        sutures = np.maximum(sutures, paint.band(px, cx, 0.012, 0.010))
    sutures *= abdomen_mask
    under = textures.mix(under, (0.42, 0.45, 0.31), sutures * 0.7 + abdomen_mask * 0.15)
    under = textures.mix(under, palette["carapaceDeep"], margin * 0.5)
    albedo = textures.mix(albedo, under, 1.0 - top)
    height_field = np.clip(height_field - 0.10 * sutures * (1.0 - top), 0.0, 1.0)
    roughness = (0.30 + 0.18 * grooves + 0.24 * granule + 0.06 * (fine - 0.5)) * top + (0.58 + 0.08 * (fine - 0.5)) * (1.0 - top)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, 1.6 * strength)}


def paint_leg(width: int, height: int, palette: dict, strength: float):
    U, V = textures.uv_grid(width, height)  # U along the limb (0 root, 1 dactyl tip), V around
    seam = np.zeros_like(U)
    for u_joint, half in ((LEG_U[1], 0.010), (LEG_U[2], 0.012), (LEG_U[3], 0.011), (LEG_U[4], 0.010)):
        seam = np.maximum(seam, paint.band(U, u_joint, half, 0.006))
    distance, ident = noise.cells(U * 64.0, V * 11.0, seed=44)
    fleck = (1.0 - noise.smoothstep(0.10, 0.22, distance)) * noise.smoothstep(0.35, 0.6, ident)
    fleck *= 1.0 - noise.smoothstep(0.80, 0.90, U)  # dactyls are bare
    fleck *= 1.0 - seam
    grain = noise.fbm(U * 30.0, V * 8.0, octaves=3, seed=9)
    albedo = textures.rgba(palette["leg"], 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.85 + 0.3 * grain)
    albedo = textures.mix(albedo, palette["carapace"], (1.0 - noise.smoothstep(0.05, 0.30, U)) * 0.45)
    albedo = textures.mix(albedo, palette["legDark"], noise.smoothstep(0.78, 0.96, U))
    albedo = textures.mix(albedo, (0.36, 0.32, 0.22), noise.smoothstep(0.965, 1.0, U) * 0.6)
    albedo = textures.mix(albedo, palette["hair"], fleck * 0.8)
    albedo = textures.mix(albedo, (0.07, 0.08, 0.04), seam * 0.8)
    height_field = np.clip(0.5 + 0.28 * fleck - 0.34 * seam + 0.10 * (grain - 0.5), 0.0, 1.0)
    roughness = 0.52 + 0.28 * fleck - 0.10 * seam + 0.08 * noise.smoothstep(0.78, 1.0, U) + 0.06 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, 1.6 * strength)}


def paint_claw(width: int, height: int, palette: dict, strength: float):
    U, V = textures.uv_grid(width, height)  # U 0 wrist -> 1 finger tip, V around
    distance, ident = noise.cells(U * 30.0, V * 12.0, seed=71)
    granule = (1.0 - noise.smoothstep(0.14, 0.32, distance)) * (1.0 - noise.smoothstep(0.55, 0.72, U))
    grain = noise.fbm(U * 24.0, V * 9.0, octaves=3, seed=5)
    finger = noise.smoothstep(0.62, 0.84, U)
    spoon = noise.smoothstep(0.915, 0.975, U)
    seam = paint.band(U, 0.05, 0.010, 0.006)
    albedo = textures.rgba(palette["claw"], 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.88 + 0.24 * grain)
    albedo = textures.mix(albedo, palette["crust"], granule * noise.smoothstep(0.5, 0.8, ident) * 0.55)
    albedo = textures.mix(albedo, palette["clawTip"], finger)
    albedo = textures.mix(albedo, palette["spoon"], spoon)
    albedo = textures.mix(albedo, (0.05, 0.10, 0.04), seam * 0.7)
    height_field = np.clip(0.5 + 0.22 * granule - 0.3 * seam + 0.08 * (grain - 0.5) + 0.06 * spoon, 0.0, 1.0)
    roughness = 0.30 + 0.20 * granule + 0.16 * finger - 0.12 * spoon + 0.05 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height_field, 1.4 * strength)}


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morphology = spec["morphology"]
    car = morphology["carapace"]
    legs_spec = morphology["legs"]
    chel = morphology["chelipeds"]
    eyes = morphology["eyes"]
    ant = morphology["antennae"]
    palette = spec["palette"]
    zc = float(car["centerZ"])

    # ---- textures & materials
    tex = spec.get("textures", {})
    strength = float(tex.get("normalStrength", 0.9))
    written = []
    images = {}
    for key, size_key, painter in (("carapace", "carapaceResolution", paint_carapace), ("leg", "legResolution", paint_leg), ("claw", "clawResolution", paint_claw)):
        width, height = tex.get(size_key, [512, 256])
        maps = painter(int(width), int(height), palette, strength)
        for channel, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
            path = ctx.texture_dir / f"{key}-{channel}.png"
            images[(key, channel)] = textures.write_image(f"{prefix}_{key}_{channel}", path, maps[channel], non_color)
            written.append(path)
    carapace_mat = mat.principled(f"{prefix}_Carapace", palette["carapace"], 0.44, coat=0.08, subsurface=0.0, specular=0.38)
    mat.attach_textures(carapace_mat, albedo=images[("carapace", "albedo")], roughness=images[("carapace", "roughness")],
                        normal=images[("carapace", "normal")], normal_strength=strength)
    leg_mat = mat.principled(f"{prefix}_Leg", palette["leg"], 0.55, coat=0.05, subsurface=0.0, specular=0.35)
    mat.attach_textures(leg_mat, albedo=images[("leg", "albedo")], roughness=images[("leg", "roughness")],
                        normal=images[("leg", "normal")], normal_strength=strength)
    claw_mat = mat.principled(f"{prefix}_Claw", palette["claw"], 0.36, coat=0.15, subsurface=0.0, specular=0.45)
    mat.attach_textures(claw_mat, albedo=images[("claw", "albedo")], roughness=images[("claw", "roughness")],
                        normal=images[("claw", "normal")], normal_strength=strength)
    eye_mat = mat.principled(f"{prefix}_Eye", palette["eye"], 0.12, coat=0.6, subsurface=0.0, specular=0.5)
    stalk_mat = mat.principled(f"{prefix}_Stalk", palette["stalk"], 0.5, coat=0.05, subsurface=0.0)
    material_map = {"carapace": carapace_mat, "leg": leg_mat, "claw": claw_mat, "eye": eye_mat, "stalk": stalk_mat}

    # ---- geometry (left side authored, right side mirrored) and bone definitions in design space
    bone_defs: list[tuple] = []  # (name, head, tail, parent, connected, deform)
    body_parts, leg_parts, chela_parts, detail_parts = [], [], [], []
    leg_names, chela_names, detail_names = [], [], []
    clearance_pairs = []  # (object_key, group_a, exclude_a, object_key_b, group_b, exclude_b, label)

    bone_defs.append(("Root", (0.0, 0.0, 0.0), (0.004, 0.0, 0.0), None, False, False))
    bone_defs.append(("Body", (-0.004, 0.0, zc), (0.006, 0.0, zc), "Root", False, True))

    carapace = msh.make_part("carapace", carapace_geometry(car), "carapace", lambda i, v: {"Body": 1.0}, closed=True)
    body_parts.append(carapace)
    abd = morphology["abdomen"]
    abd_center = (float(abd["center"][0]), float(abd["center"][1]), zc + float(abd["center"][2]))
    abdomen_geometry = plan_uvs(_ellipsoid(abd_center, tuple(float(r) for r in abd["radii"]), 16, 8), float(car["halfLength"]), float(car["halfWidth"]), zc, force_top=False)
    abdomen = msh.make_part("abdomen", abdomen_geometry, "carapace", lambda i, v: {"Body": 1.0}, closed=True)
    body_parts.append(abdomen)

    leg_segments = int(legs_spec.get("segments", 10))
    seam = float(legs_spec.get("seam", 0.84))
    for index in range(4):
        joints, radii = leg_joints(car, legs_spec, index, zc)
        points, rads, us, joint_index = _limb(joints, radii, LEG_U, seam=seam, fillet=0.0009, mids=1)
        knee_index = joint_index[2]
        t_values = _cumulative(points)
        t_knee = t_values[knee_index]
        name = f"leg{index + 1}"
        a_bone, b_bone = f"Leg{index + 1}_A_L", f"Leg{index + 1}_B_L"
        bone_defs.append((a_bone, joints[0], joints[2], "Root", False, True))
        bone_defs.append((b_bone, joints[2], joints[5], a_bone, True, True))
        point_count = len(points)

        def leg_weights(i, v, pc=point_count, tv=t_values, tk=t_knee, a=a_bone, b=b_bone):
            t = tv[_tube_ring(i, pc, leg_segments)]
            w = _sstep(tk - 0.05, tk + 0.05, t)
            return msh.blend_weights({a: 1.0}, {b: 1.0}, w)

        geometry = _tube(points, rads, leg_segments, up_hint=(0.0, 0.0, 1.0), aspect=0.9, u_values=us)
        # rings through the coxa depart station stay inside/against the carapace margin
        coxa_index = joint_index[1]
        attach = _ring_group(point_count, leg_segments, range(0, coxa_index + 2), include_start_cap=True)
        part = msh.make_part(f"{name}_L", geometry, "leg", leg_weights, closed=True, groups={f"attach_{name}_L": attach})
        leg_parts.append(part)
        leg_parts.append(part.mirror_y(rename={"_L": "_R"}))
        leg_names.append(name)

    # chelipeds
    chel_segments = int(chel.get("segments", 12))
    arm_joints = [tuple(float(c) for c in chel[key]) for key in ("root", "edge", "elbow", "wrist")]
    arm_joints = [(x, -abs(y), zc + z) for x, y, z in arm_joints]
    arm_radii = [float(r) for r in chel["armRadii"]]
    points, rads, us, arm_joint_index = _limb(arm_joints, arm_radii, ARM_U, seam=seam, fillet=0.0010, mids=1)
    arm_pc = len(points)
    bone_defs.append(("Arm_L", arm_joints[0], arm_joints[3], "Body", False, True))
    edge_index = arm_joint_index[1]
    arm_attach = _ring_group(arm_pc, chel_segments, range(0, edge_index + 2), include_start_cap=True)
    arm = msh.make_part("arm_L", _tube(points, rads, chel_segments, aspect=0.9, u_values=us), "leg",
                        lambda i, v: {"Arm_L": 1.0}, closed=True, groups={"attach_arm_L": arm_attach})
    chela_parts.extend([arm, arm.mirror_y(rename={"_L": "_R"})])
    chela_names.append("arm")

    palm_stations = [(float(x), -abs(float(y)), zc + float(z), float(r)) for x, y, z, r in chel["palm"]]
    palm_points = [arm_joints[3]] + [(x, y, z) for x, y, z, _r in palm_stations]
    palm_radii = [arm_radii[3] * 0.95] + [r for *_xyz, r in palm_stations]
    palm_u = _cumulative(palm_points)
    bone_defs.append(("Claw_L", arm_joints[3], palm_points[-1], "Arm_L", True, True))
    claw = msh.make_part("claw_L", _tube(palm_points, palm_radii, chel_segments, aspect=float(chel.get("palmAspect", 0.82)), u_values=palm_u),
                         "claw", lambda i, v: {"Claw_L": 1.0}, closed=True)
    chela_parts.extend([claw, claw.mirror_y(rename={"_L": "_R"})])
    chela_names.append("claw")

    dactyl_stations = [(float(x), -abs(float(y)), zc + float(z), float(r)) for x, y, z, r in chel["dactyl"]]
    dactyl_points = [(x, y, z) for x, y, z, _r in dactyl_stations]
    dactyl_radii = [r for *_xyz, r in dactyl_stations]
    dactyl_u = [0.58 + 0.42 * t for t in _cumulative(dactyl_points)]
    bone_defs.append(("Dactyl_L", dactyl_points[0], dactyl_points[-1], "Claw_L", False, True))
    dactyl_pc = len(dactyl_points)
    hinge = _ring_group(dactyl_pc, chel_segments, range(0, 1), include_start_cap=True)
    dactyl = msh.make_part("dactyl_L", _tube(dactyl_points, dactyl_radii, chel_segments, aspect=0.9, u_values=dactyl_u), "claw",
                           lambda i, v: {"Dactyl_L": 1.0}, closed=True, groups={"hinge_dactyl_L": hinge})
    chela_parts.extend([dactyl, dactyl.mirror_y(rename={"_L": "_R"})])
    chela_names.append("dactyl")

    # eyestalks, corneas, antennae
    stalk_points = [(float(x), -abs(float(y)), zc + float(z)) for x, y, z in (eyes["orbitInside"], eyes["orbit"], eyes["stalkMid"], eyes["stalkEnd"])]
    stalk_r = float(eyes["stalkRadius"])
    eye_center = (float(eyes["center"][0]), -abs(float(eyes["center"][1])), zc + float(eyes["center"][2]))
    bone_defs.append(("Eye_L", stalk_points[1], eye_center, "Body", False, True))
    stalk = msh.make_part("eyestalk_L", _tube(stalk_points, [stalk_r, stalk_r * 1.05, stalk_r * 0.95, stalk_r], 8), "stalk",
                          lambda i, v: {"Eye_L": 1.0}, closed=True,
                          groups={"attach_eyestalk_L": _ring_group(len(stalk_points), 8, range(0, 2), include_start_cap=True)})
    eye_r = float(eyes["radius"])
    cornea = msh.make_part("eye_L", _ellipsoid(eye_center, (eye_r, eye_r, eye_r * 1.1), 14, 8), "eye", lambda i, v: {"Eye_L": 1.0}, closed=True)
    detail_parts.extend([stalk, stalk.mirror_y(rename={"_L": "_R"}), cornea, cornea.mirror_y(rename={"_L": "_R"})])
    detail_names.extend(["eyestalk", "eye"])
    ant_points = [(float(x), -abs(float(y)), zc + float(z)) for x, y, z in ant["points"]]
    ant_radii = [float(r) for r in ant["radii"]]
    bone_defs.append(("Antenna_L", ant_points[1], ant_points[-1], "Body", False, True))
    antenna = msh.make_part("antenna_L", _tube(ant_points, ant_radii, 6), "stalk", lambda i, v: {"Antenna_L": 1.0}, closed=True,
                            groups={"attach_antenna_L": _ring_group(len(ant_points), 6, range(0, 2), include_start_cap=True)})
    detail_parts.extend([antenna, antenna.mirror_y(rename={"_L": "_R"})])
    detail_names.append("antenna")

    # ---- normalise: leg-tip spread along y equals the reference size, dactyl tips rest on z = 0
    all_parts = body_parts + leg_parts + chela_parts + detail_parts
    y_max = max(abs(v[1]) for part in all_parts for v in part.vertices)
    target = float(spec["referenceSize"]["meters"])
    scale = target / (2.0 * y_max)
    if not 0.8 <= scale <= 1.25:
        raise ValueError(f"Design spread {2 * y_max:.4f} m is too far from referenceSize {target} m (scale {scale:.3f})")
    z_min = min(v[2] for part in all_parts for v in part.vertices) * scale
    transform = Matrix.Translation((0.0, 0.0, -z_min)) @ Matrix.Scale(scale, 4)
    for part in all_parts:
        part.transform(transform)
    bone_defs = [(name, tuple(transform @ Vector(head)), tuple(transform @ Vector(tail)), parent, connected, deform)
                 for name, head, tail, parent, connected, deform in bone_defs]

    # ---- rig (left bones authored, right bones mirrored in the same order)
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    for name, head, tail, parent, connected, deform in bone_defs:
        rb.bone(name, head, tail, parent, connected=connected, deform=deform)
        if name.endswith("_L"):
            mirror_parent = parent[:-2] + "_R" if parent and parent.endswith("_L") else parent
            rb.bone(name[:-2] + "_R", (head[0], -head[1], head[2]), (tail[0], -tail[1], tail[2]), mirror_parent, connected=connected, deform=deform)
    rig = rb.finish()

    body_obj = msh.assemble(f"{prefix}_Body", body_parts, material_map, rig, f"{prefix}_Armature")
    legs_obj = msh.assemble(f"{prefix}_Legs", leg_parts, material_map, rig, f"{prefix}_Armature")
    chelae_obj = msh.assemble(f"{prefix}_Chelae", chela_parts, material_map, rig, f"{prefix}_Armature")
    details_obj = msh.assemble(f"{prefix}_Details", detail_parts, material_map, rig, f"{prefix}_Armature")
    body_obj["adultSpreadMeters"] = target
    for obj in (body_obj, legs_obj, chelae_obj, details_obj):
        obj["lod"] = 1

    # ---- animation
    anim = spec["animation"]
    clips = []
    for clip_name, clip in anim.items():
        loop = bool(clip["loop"])
        env = None if loop else clip.get("envelope", "bell")
        channels: list[Channel] = []
        if clip_name == spec["clipRoles"]["response"]:
            const = "const"
            for side, suffix in ((-1, "L"), (1, "R")):
                channels.append(Channel(f"Arm_{suffix}", "rotation", (1, 0, 0), float(clip["armRaise"]), 1.0, 0.0, const, envelope=env))
                channels.append(Channel(f"Arm_{suffix}", "rotation", (0, 0, 1), side * float(clip["armSpread"]), 1.0, 0.0, const, envelope=env))
                channels.append(Channel(f"Dactyl_{suffix}", "rotation", (1, 0, 0), float(clip["dactylOpen"]), 1.0, 0.0, const, envelope=env))
                channels.append(Channel(f"Eye_{suffix}", "rotation", (1, 0, 0), float(clip["eye"]), 1.0, 0.0, const, envelope=env))
                channels.append(Channel(f"Antenna_{suffix}", "rotation", (1, 0, 0), float(clip["antenna"]), 2.0, 0.6 * side, "sin", envelope=env))
                for index in range(4):
                    channels.append(Channel(f"Leg{index + 1}_B_{suffix}", "rotation", (1, 0, 0), float(clip["legExtend"]), 1.0, 0.0, const, envelope=env))
            channels.append(Channel("Body", "location", (0, 0, 1), float(clip["bodyLift"]), 1.0, 0.0, const, envelope=env))
            channels.append(Channel("Body", "rotation", (1, 0, 0), float(clip["bodyPitch"]), 1.0, 0.0, const, envelope=env))
        else:
            for side, suffix in ((-1, "L"), (1, "R")):
                offset = 0.0 if side < 0 else 0.9
                channels.append(Channel(f"Eye_{suffix}", "rotation", (1, 0, 0), float(clip["eye"]), float(clip.get("eyeFrequency", 1)), offset, envelope=env))
                channels.append(Channel(f"Eye_{suffix}", "rotation", (0, 0, 1), float(clip["eye"]) * 0.6, float(clip.get("eyeFrequency", 1)) * 2, offset + 0.5, envelope=env))
                channels.append(Channel(f"Antenna_{suffix}", "rotation", (1, 0, 0), float(clip["antenna"]), float(clip.get("antennaFrequency", 2)), offset + 1.2, envelope=env))
                channels.append(Channel(f"Arm_{suffix}", "rotation", (1, 0, 0), float(clip["arm"]), float(clip.get("armFrequency", 1)), offset * 0.5, envelope=env))
                if "dactyl" in clip:
                    channels.append(Channel(f"Dactyl_{suffix}", "rotation", (1, 0, 0), float(clip["dactyl"]), float(clip.get("dactylFrequency", 2)), offset, "pulse", 1.4, envelope=env))
            channels.append(Channel("Body", "location", (0, 0, 1), float(clip["bodyBob"]), float(clip.get("bodyFrequency", 1)), 0.0, envelope=env))
            if clip_name == spec["clipRoles"]["locomotion"]:
                f = float(clip["stepFrequency"])
                # lateral gait toward the crab's left (-y): alternating tetrapods, leading legs reach
                # outward while lifted, trailing legs pull inward while lifted
                for side, suffix in ((-1, "L"), (1, "R")):
                    for index in range(4):
                        group = (index + (0 if side < 0 else 1)) % 2
                        base = 0.0 if group == 0 else math.pi
                        lift_phase = base + (math.pi / 2 if side < 0 else -math.pi / 2)
                        a_bone, b_bone = f"Leg{index + 1}_A_{suffix}", f"Leg{index + 1}_B_{suffix}"
                        channels.append(Channel(a_bone, "rotation", (1, 0, 0), float(clip["hipLift"]), f, lift_phase, "pulse", 1.3, envelope=env))
                        channels.append(Channel(a_bone, "rotation", (1, 0, 0), -float(clip["hipDrop"]), f, base, "sin", envelope=env))
                        channels.append(Channel(a_bone, "rotation", (0, 0, 1), float(clip["yaw"]) * (1 if index % 2 == 0 else -1), f, base + 0.4, "sin", envelope=env))
                        channels.append(Channel(b_bone, "rotation", (1, 0, 0), float(clip["kneeSwing"]), f, base, "sin", envelope=env))
        clips.append(ClipSpec(clip_name, int(clip["frames"]), loop, channels))
    for clip in clips:
        bake_clip(rig, clip)

    # ---- contract
    meshes = [body_obj, legs_obj, chelae_obj, details_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="y")
    contract["closedParts"].append({"object": body_obj.name, "group": "part_carapace", "volumeFloor": 0.7})
    contract["closedParts"].append({"object": body_obj.name, "group": "part_abdomen", "volumeFloor": 0.7})
    for suffix in ("L", "R"):
        for name in leg_names:
            contract["closedParts"].append({"object": legs_obj.name, "group": f"part_{name}_{suffix}", "volumeFloor": 0.6})
        for name in chela_names:
            contract["closedParts"].append({"object": chelae_obj.name, "group": f"part_{name}_{suffix}", "volumeFloor": 0.6})
        for name in detail_names:
            contract["closedParts"].append({"object": details_obj.name, "group": f"part_{name}_{suffix}", "volumeFloor": 0.6})
    for suffix in ("L", "R"):
        # neighbouring legs, cheliped vs first leg, dactyl vs palm/pollex, appendages vs carapace
        for first, second in zip(leg_names, leg_names[1:]):
            contract["clearance"].append({"a": [legs_obj.name, f"part_{first}_{suffix}"], "b": [legs_obj.name, f"part_{second}_{suffix}"],
                                          "label": f"{first}_{second}_{suffix}"})
        contract["clearance"].append({"a": [chelae_obj.name, f"part_arm_{suffix}"], "b": [legs_obj.name, f"part_leg1_{suffix}"], "label": f"arm_leg1_{suffix}"})
        contract["clearance"].append({"a": [chelae_obj.name, f"part_claw_{suffix}"], "b": [legs_obj.name, f"part_leg1_{suffix}"], "label": f"claw_leg1_{suffix}"})
        contract["clearance"].append({"a": [chelae_obj.name, f"part_dactyl_{suffix}", f"hinge_dactyl_{suffix}"], "b": [chelae_obj.name, f"part_claw_{suffix}"],
                                      "label": f"dactyl_palm_{suffix}"})
        for name in leg_names:
            contract["clearance"].append({"a": [legs_obj.name, f"part_{name}_{suffix}", f"attach_{name}_{suffix}"], "b": [body_obj.name, "part_carapace"],
                                          "label": f"{name}_carapace_{suffix}"})
        contract["clearance"].append({"a": [chelae_obj.name, f"part_arm_{suffix}", f"attach_arm_{suffix}"], "b": [body_obj.name, "part_carapace"], "label": f"arm_carapace_{suffix}"})
        contract["clearance"].append({"a": [chelae_obj.name, f"part_claw_{suffix}"], "b": [body_obj.name, "part_carapace"], "label": f"claw_carapace_{suffix}"})
        contract["clearance"].append({"a": [chelae_obj.name, f"part_dactyl_{suffix}"], "b": [body_obj.name, "part_carapace"], "label": f"dactyl_carapace_{suffix}"})
        contract["clearance"].append({"a": [details_obj.name, f"part_eyestalk_{suffix}", f"attach_eyestalk_{suffix}"], "b": [body_obj.name, "part_carapace"],
                                      "label": f"eyestalk_carapace_{suffix}"})
        contract["clearance"].append({"a": [details_obj.name, f"part_antenna_{suffix}", f"attach_antenna_{suffix}"], "b": [body_obj.name, "part_carapace"],
                                      "label": f"antenna_carapace_{suffix}"})
        contract["clearance"].append({"a": [details_obj.name, f"part_antenna_{suffix}"], "b": [chelae_obj.name, f"part_arm_{suffix}"], "label": f"antenna_arm_{suffix}"})
        contract["clearance"].append({"a": [details_obj.name, f"part_eye_{suffix}"], "b": [chelae_obj.name, f"part_arm_{suffix}"], "label": f"eye_arm_{suffix}"})
        contract["clearance"].append({"a": [details_obj.name, f"part_eyestalk_{suffix}"], "b": [chelae_obj.name, f"part_arm_{suffix}"], "label": f"eyestalk_arm_{suffix}"})
    contract["clearance"].append({"a": [chelae_obj.name, "part_claw_L"], "b": [chelae_obj.name, "part_claw_R"], "label": "claw_claw"})
    contract["clearance"].append({"a": [chelae_obj.name, "part_dactyl_L"], "b": [chelae_obj.name, "part_dactyl_R"], "label": "dactyl_dactyl"})
    for obj, names in ((legs_obj, leg_names), (chelae_obj, chela_names), (details_obj, detail_names)):
        for name in names:
            contract["centerPlane"].append({"object": obj.name, "group": f"part_{name}_L", "exclude": None, "side": -1})
            contract["centerPlane"].append({"object": obj.name, "group": f"part_{name}_R", "exclude": None, "side": 1})
    contract["symmetry"] = [{"object": obj.name, "left": f"part_{name}_L", "right": f"part_{name}_R", "tolerance": 0.0001}
                            for obj, names in ((legs_obj, leg_names), (chelae_obj, chela_names), (details_obj, detail_names)) for name in names]
    contract["axialChain"] = None
    register_clips(contract, clips)

    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written,
                       notes={"designScale": scale, "carapaceWidthMeters": 2.0 * float(car["halfWidth"]) * scale,
                              "carapaceLengthMeters": 2.0 * float(car["halfLength"]) * scale, "legs": leg_names, "chelae": chela_names})
