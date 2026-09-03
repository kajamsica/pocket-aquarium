"""Brittle star (Ophiuroidea, reef brittle star, Ophiocoma / Ophioderma group): species-local ophiuroid plan.

Anatomy choices
- Pentaradial animal posed with one arm (the leading arm) along +X so the rest pose is mirror
  symmetric about y = 0: arms A (+-72 deg) and B (+-144 deg) are built on the left (y < 0) and
  mirrored with MeshPart.mirror_y; the leading arm has no sideways snake, only a raised tip.
- Small flattened pentagonal disc (about 18 mm across the lobes, 6 mm thick) resting on z = 0
  with shallow lobes at the arm bases, gently domed dorsal surface, origin base_center.
- Five long, thin arms (about 3.6 x disc diameter) sharply distinct from the disc, tapering to
  fine tips: closed tubes lofted along snaking centrelines with 26 vertebral segments per arm as
  ring bulges (flat plates with V grooves), cross-section wider than tall, flattened ventral face,
  low dorsal ridge. Arms leave the disc at mid height and settle onto the substrate.
- Short lateral spines as tapered spikes rooted in the lateral plates (two per side proximally,
  one distally); plate, groove, granule and spine-base relief lives in the normal map.
- Rig: Disc bone + 5 bones per arm (25) = 26 deform bones. Arm chains are children of Root, not
  of Disc, so the disc can lift on its arms during the crawl while the arm tips stay grounded.
- Clips: rest (slow arm tip curls and sway), crawl (rowing gait: the A pair pulls, the B pair
  pushes with a phase lag, the leading arm drags and probes, the disc lifts and rocks),
  arm_recoil (all arms snap upward and inward toward the disc, then relax; bell envelope).
- Texture: project authored procedural paint only (numpy): dark olive-brown mottled and
  granulated disc with faint radial shields, arms with alternating dark/light bands aligned to
  the plates, pale spines; matte.

Everything derives from asset.source.json and this module with fixed seeds; the arm length is
fitted deterministically so the resting horizontal extent equals referenceSize.meters.
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

# texture atlas tiles (u0, u1, v0, v1): planar disc, spine gradient, arm tube (u along the arm)
DISC_TILE = (0.0, 0.24, 0.26, 0.74)
SPINE_TILE = (0.245, 0.275, 0.05, 0.20)
ARM_TILE = (0.28, 1.0, 0.0, 1.0)

# 1 = dark band plate, 0 = light band plate; dark bands span 2-3 plates, light bands 1-2
BAND_PATTERN = (1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1)

BONES_PER_ARM = 5


def _smooth(edge0: float, edge1: float, value: float) -> float:
    t = max(0.0, min(1.0, (value - edge0) / max(edge1 - edge0, 1e-12)))
    return t * t * (3.0 - 2.0 * t)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


# ---------------------------------------------------------------- arm description

class ArmShape:
    """Analytic centreline, radius profile and vertebral segment layout of one arm."""

    def __init__(self, layout: dict, arms: dict, lobe_radius: float, length: float):
        self.name = str(layout["name"])
        self.mirror = bool(layout.get("mirror", False))
        self.angle = math.radians(float(layout["angleDegrees"]))
        self.dir = Vector((math.cos(self.angle), math.sin(self.angle), 0.0))
        self.perp = Vector((-math.sin(self.angle), math.cos(self.angle), 0.0))
        self.snake = [tuple(float(v) for v in item) for item in layout.get("snake", [])]
        self.tip_curl = float(layout.get("tipCurl", 0.0))
        self.tip_lift = float(layout.get("tipLift", 0.0))
        self.length = length
        self.root_radial = float(arms["rootRadial"])
        self.root_z = float(arms.get("rootHeight", 0.0027))
        self.r_base = float(arms["radiusBase"])
        self.r_tip = float(arms["radiusTip"])
        self.taper = float(arms.get("taperPower", 1.1))
        self.aspect = float(arms.get("aspect", 1.3))
        self.settle_s = float(arms.get("settleFraction", 0.36))
        self.lobe_radius = lobe_radius
        self.s_exit = (lobe_radius - self.root_radial) / length
        count = int(arms["segments"])
        segment_taper = float(arms.get("segmentTaper", 0.58))
        lengths = [1.0 - segment_taper * index / (count - 1) for index in range(count)]
        total = sum(lengths)
        self.bounds = [0.0]
        for value in lengths:
            self.bounds.append(self.bounds[-1] + value / total)
        self.bounds[-1] = 1.0
        self.bone_bounds: list[float] = []

    def radius_v(self, s: float) -> float:
        return self.r_tip + (self.r_base - self.r_tip) * (1.0 - s) ** self.taper

    def radius_h(self, s: float) -> float:
        return self.radius_v(s) * self.aspect

    def radial(self, s: float) -> float:
        return self.root_radial + s * self.length

    def lateral(self, s: float) -> float:
        ramp = _smooth(0.04, 0.30, s)
        total = 0.0
        for amplitude, frequency, phase in self.snake:
            total += amplitude * math.sin(math.tau * frequency * s + phase)
        # distal third curls sideways in one direction (the flexible tips rarely lie straight)
        total += self.tip_curl * _smooth(0.55, 1.0, s) ** 2
        return self.length * ramp * total

    def height(self, s: float) -> float:
        ground = self.radius_v(s) * 0.92 + 0.00005
        blend = _smooth(self.s_exit, self.settle_s, s)
        z = self.root_z * (1.0 - blend) + ground * blend
        return z + self.tip_lift * _smooth(0.45, 1.0, s) ** 1.6

    def point(self, s: float) -> Vector:
        return self.dir * self.radial(s) + self.perp * self.lateral(s) + Vector((0.0, 0.0, self.height(s)))

    def ring_params(self, rings_per_segment: int):
        """(s, segment index, phase within the segment) for every ring from base to tip."""
        out = []
        for index in range(len(self.bounds) - 1):
            start, end = self.bounds[index], self.bounds[index + 1]
            for k in range(rings_per_segment):
                phase = k / rings_per_segment
                out.append((start + (end - start) * phase, index, phase))
        out.append((1.0, len(self.bounds) - 2, 1.0))
        return out


def fit_arm_length(layouts: list[dict], arms: dict, lobe_radius: float, target: float) -> float:
    """Arm length such that the resting horizontal extent (max of x and y) equals `target`."""
    length = float(arms["length"])
    for _ in range(4):
        xs, ys = [], []
        for layout in layouts:
            shape = ArmShape(layout, arms, lobe_radius, length)
            for k in range(201):
                s = k / 200
                p = shape.point(s)
                r = shape.radius_h(s) + 0.0006
                xs += [p.x - r, p.x + r]
                ys += [p.y - r, p.y + r]
                if shape.mirror:
                    ys += [-p.y - r, -p.y + r]
        extent = max(max(xs) - min(xs), max(ys) - min(ys))
        length *= target / extent
    return length


# ---------------------------------------------------------------- geometry

def build_disc(disc: dict):
    """Closed pentagonal lens with lobes at the arm angles; planar dorsal UVs into DISC_TILE."""
    radius = float(disc["radius"])
    blend = float(disc.get("pentagonBlend", 0.55))
    lobe = float(disc.get("lobe", 0.05))
    segments = int(disc.get("ringSegments", 40))
    profile = disc["profile"]

    def radius_at(theta: float) -> float:
        corner_offset = ((theta + math.pi / 5) % (math.tau / 5)) - math.pi / 5
        pentagon = math.cos(math.pi / 5) / math.cos(math.pi / 5 - abs(corner_offset))
        base = (1.0 - blend) + blend * pentagon
        return radius * base * (1.0 + lobe * math.cos(5.0 * theta)) / (1.0 + lobe)

    rings = []
    for z, scale in profile:
        ring = []
        for k in range(segments):
            theta = k / segments * math.tau
            r = radius_at(theta) * float(scale)
            ring.append((r * math.cos(theta), r * math.sin(theta), float(z)))
        rings.append(ring)
    vertices, faces, _uvs, _face_uvs = msh.loft(rings, cap_start=True, cap_end=True)
    u0, u1, v0, v1 = DISC_TILE
    span = 2.6 * radius
    uvs = [(u0 + (u1 - u0) * (0.5 + x / span), v0 + (v1 - v0) * (0.5 + y / span)) for x, y, _z in vertices]
    face_uvs = [tuple(uvs[i] for i in face) for face in faces]
    return (vertices, faces, uvs, face_uvs), radius_at(0.0)


def build_arm_tube(shape: ArmShape, arms: dict):
    rings_per_segment = int(arms.get("ringsPerSegment", 3))
    params = shape.ring_params(rings_per_segment)
    points = [tuple(shape.point(s)) for s, _, _ in params]
    radii = [shape.radius_v(s) for s, _, _ in params]
    joint_depth = float(arms.get("jointDepth", 0.14))
    flatten = float(arms.get("ventralFlatten", 0.14))
    ridge = float(arms.get("dorsalRidge", 0.05))
    plate = [not (phase == 0.0 or phase == 1.0) for _, _, phase in params]

    def ring_fn(index: int, angle: float) -> float:
        vertical = math.cos(angle)
        factor = 1.0 if plate[index] else 1.0 - joint_depth
        factor *= 1.0 - flatten * max(0.0, -vertical) ** 2
        if plate[index]:
            factor *= 1.0 + ridge * max(0.0, vertical) ** 6
        return factor

    geometry = msh.tube(points, radii, int(arms.get("ringSegments", 12)), True, True, (0.0, 0.0, 1.0),
                        shape.aspect, ring_fn, [s for s, _, _ in params])
    return geometry, params, points


def build_spines(shape: ArmShape, params, points, spines: dict, rings_per_segment: int, attach_limit: float):
    """Tapered spikes rooted in the lateral plates; returns merged geometry, per-vertex s and attach indices."""
    frames = msh.frames_along(points, (0.0, 0.0, 1.0))
    length_factor = float(spines.get("lengthFactor", 1.15))
    min_length = float(spines.get("minLength", 0.0005))
    max_length = float(spines.get("maxLength", 0.0024))
    radius_factor = float(spines.get("radiusFactor", 0.24))
    proximal = float(spines.get("proximalFraction", 0.55))
    elev_proximal = [math.radians(float(v)) for v in spines.get("elevationsProximal", [32.0, -18.0])]
    elev_distal = [math.radians(float(v)) for v in spines.get("elevationsDistal", [8.0])]
    distal_tilt = float(spines.get("distalTilt", 0.18))
    start_margin = float(spines.get("startMargin", 0.0025))
    vertices, faces, uvs, face_uvs, vertex_s, attach = [], [], [], [], [], set()
    for index in range(len(shape.bounds) - 1):
        s_mid = (shape.bounds[index] + shape.bounds[index + 1]) / 2
        if shape.radial(s_mid) < shape.lobe_radius + start_margin:
            continue
        ring_index = index * rings_per_segment + 1
        tangent, normal, binormal = frames[ring_index]
        center = (Vector(points[ring_index]) + Vector(points[min(ring_index + 1, len(points) - 1)])) / 2
        rv, rh = shape.radius_v(s_mid), shape.radius_h(s_mid)
        length = _clamp(length_factor * rh, min_length, max_length)
        base_radius = _clamp(radius_factor * rh, 0.00012, 0.0005)
        for side in (-1.0, 1.0):
            for elevation in (elev_proximal if s_mid < proximal else elev_distal):
                base = center + binormal * (side * rh * 0.80 * (1.0 - 0.3 * abs(math.sin(elevation)))) + normal * (rv * 0.6 * math.sin(elevation))
                direction = (binormal * (side * math.cos(elevation)) + normal * math.sin(elevation) + tangent * distal_tilt).normalized()
                tip = base + direction * length
                v, f, uv, fuv = msh.tube([tuple(base), tuple(tip)], [base_radius, base_radius * 0.28], 3, True, True)
                if msh.signed_volume(v, f) < 0:
                    f = [tuple(reversed(face)) for face in f]
                    fuv = [tuple(reversed(corners)) for corners in fuv]
                offset = len(vertices)
                vertices.extend(v)
                faces.extend(tuple(i + offset for i in face) for face in f)
                uvs.extend(uv)
                face_uvs.extend(fuv)
                vertex_s.extend([s_mid] * len(v))
                if shape.radial(s_mid) < attach_limit:
                    attach.update(range(offset, offset + len(v)))
    return (vertices, faces, uvs, face_uvs), vertex_s, attach


def arm_weight_fn(shape: ArmShape, bones: list[str], w_base: float = 0.025, w_joint: float = 0.04):
    heads = shape.bone_bounds

    def weights(s: float) -> dict[str, float]:
        if s < heads[0] - w_base:
            return {"Disc": 1.0}
        if s < heads[0] + w_base:
            t = _smooth(heads[0] - w_base, heads[0] + w_base, s)
            return msh.blend_weights({"Disc": 1.0}, {bones[0]: 1.0}, t)
        for j in range(1, BONES_PER_ARM):
            if abs(s - heads[j]) <= w_joint:
                t = _smooth(heads[j] - w_joint, heads[j] + w_joint, s)
                return msh.blend_weights({bones[j - 1]: 1.0}, {bones[j]: 1.0}, t)
        for j in range(BONES_PER_ARM):
            if s < heads[j + 1]:
                return {bones[j]: 1.0}
        return {bones[-1]: 1.0}

    return weights


def vertex_s(index: int, ring_s: list[float], segments: int) -> float:
    ring = index // segments
    if ring < len(ring_s):
        return ring_s[ring]
    return 0.0 if index == len(ring_s) * segments else 1.0


# ---------------------------------------------------------------- textures

def paint_textures(spec: dict, bounds: list[float]) -> dict:
    tex = spec.get("textures", {})
    width, height = tex.get("bodyResolution", [1024, 512])
    U, V = textures.uv_grid(int(width), int(height))
    shape = U.shape
    palette = spec.get("palette", {})
    dark = palette.get("armDark", (0.075, 0.060, 0.038))
    light = palette.get("armLight", (0.40, 0.34, 0.20))
    ventral_color = palette.get("armVentral", (0.46, 0.42, 0.30))
    disc_dark = palette.get("discDark", (0.10, 0.082, 0.05))
    disc_light = palette.get("discLight", (0.33, 0.29, 0.16))
    shield_color = palette.get("discShield", (0.30, 0.26, 0.15))
    spine_base = palette.get("spineBase", (0.42, 0.37, 0.26))
    spine_tip = palette.get("spineTip", (0.66, 0.62, 0.52))
    grain = noise.fbm(U * 120.0, V * 40.0, octaves=2, seed=3)

    # ---- arm tile: bands and plate relief aligned to the vertebral segments (u = arm parameter s)
    au0, au1, _av0, _av1 = ARM_TILE
    s = np.clip((U - au0) / (au1 - au0), 0.0, 1.0)
    b = np.asarray(bounds, dtype=np.float64)
    idx = np.clip(np.searchsorted(b, s, side="right") - 1, 0, len(b) - 2)
    seg_start = b[idx]
    seg_len = b[idx + 1] - b[idx]
    p = np.clip((s - seg_start) / seg_len, 0.0, 1.0)
    joint = np.minimum(p, 1.0 - p)
    groove = 1.0 - noise.smoothstep(0.05, 0.16, joint)
    plate = 1.0 - (2.0 * p - 1.0) ** 2
    angle = V * math.tau
    dorsal = np.maximum(0.0, np.cos(angle))
    ventral = np.maximum(0.0, -np.cos(angle))
    lateral = np.abs(np.sin(angle))
    pattern = np.asarray(BAND_PATTERN, dtype=np.float64)
    dark_mask = pattern[np.clip(idx, 0, len(pattern) - 1)]
    mottle = noise.fbm(U * 60.0, V * 12.0, octaves=3, seed=7)
    dark_mask = np.clip(dark_mask * (0.85 + 0.15 * mottle) + (1.0 - dark_mask) * 0.35 * noise.smoothstep(0.55, 0.75, mottle), 0.0, 1.0)
    arm = textures.mix(textures.rgba(light, 1.0, shape), dark, dark_mask)
    arm = textures.mix(arm, ventral_color, ventral ** 1.5 * 0.65 * (1.0 - 0.6 * dark_mask))
    arm = textures.scale_rgb(arm, 1.0 + 0.14 * dorsal ** 2 * plate * (1.0 - groove))
    arm = textures.scale_rgb(arm, 1.0 - 0.38 * groove)
    dots = np.exp(-(((lateral - 1.0) / 0.22) ** 2 + ((p - 0.5) / 0.22) ** 2))
    arm = textures.scale_rgb(arm, 1.0 - 0.18 * dots)
    arm = textures.scale_rgb(arm, 0.92 + 0.16 * grain)
    arm_height = np.clip(0.55 - 0.42 * groove + 0.20 * dorsal ** 2 * plate + 0.10 * lateral ** 2 * plate - 0.05 * ventral
                         + 0.05 * (grain - 0.5) + 0.12 * dots, 0.0, 1.0)
    arm_rough = 0.60 + 0.10 * (1.0 - dark_mask) + 0.12 * groove + 0.05 * (grain - 0.5)

    # ---- disc tile: planar dorsal projection, mottled blotches, granules, faint radial shields
    du0, du1, dv0, dv1 = DISC_TILE
    nx = (U - (du0 + du1) / 2) / ((du1 - du0) / 2)
    ny = (V - (dv0 + dv1) / 2) / ((dv1 - dv0) / 2)
    px, py = nx * 1.3, ny * 1.3  # in disc radii
    rho = np.sqrt(px * px + py * py)
    blotch_field = noise.fbm(px * 5.5 + 3.0, py * 5.5 + 1.0, octaves=4, seed=21)
    blotch = noise.smoothstep(0.50, 0.66, blotch_field)
    cell_d, _cell_id = noise.cells(px * 18.0, py * 18.0, seed=33)
    granule = 1.0 - noise.smoothstep(0.26, 0.44, cell_d)
    shield = np.zeros(shape)
    for k in range(5):
        phi = math.radians(72.0 * k)
        for side in (-1.0, 1.0):
            cx = 0.66 * math.cos(phi) - side * 0.11 * math.sin(phi)
            cy = 0.66 * math.sin(phi) + side * 0.11 * math.cos(phi)
            dx, dy = px - cx, py - cy
            along = dx * math.cos(phi) + dy * math.sin(phi)
            across = -dx * math.sin(phi) + dy * math.cos(phi)
            d = np.sqrt((along / 0.16) ** 2 + (across / 0.075) ** 2)
            shield = np.maximum(shield, 1.0 - noise.smoothstep(0.85, 1.05, d))
    disc = textures.mix(textures.rgba(disc_dark, 1.0, shape), disc_light, blotch * 0.7)
    disc = textures.scale_rgb(disc, 1.0 + 0.14 * (granule - 0.4) * (1.0 - shield))
    disc = textures.mix(disc, shield_color, shield * 0.45)
    disc = textures.scale_rgb(disc, 1.0 - 0.22 * noise.smoothstep(0.72, 1.05, rho))
    disc = textures.scale_rgb(disc, 0.94 + 0.12 * grain)
    disc_height = np.clip(0.48 + 0.30 * granule * (1.0 - shield) + 0.16 * shield + 0.04 * (grain - 0.5), 0.0, 1.0)
    disc_rough = 0.74 - 0.08 * granule - 0.06 * shield

    # ---- spine tile: darker root to paler tip
    su0, su1, sv0, sv1 = SPINE_TILE
    t = np.clip((U - su0) / (su1 - su0), 0.0, 1.0)
    spine = textures.mix(textures.rgba(spine_base, 1.0, shape), spine_tip, noise.smoothstep(0.1, 0.9, t))
    spine_height = 0.5 + 0.04 * (grain - 0.5)
    spine_rough = np.full(shape, 0.5)

    arm_mask = U >= au0
    disc_mask = (U >= du0) & (U <= du1) & (V >= dv0) & (V <= dv1)
    spine_mask = (U >= su0 - 0.004) & (U <= su1 + 0.004) & (V >= sv0 - 0.02) & (V <= sv1 + 0.02)
    fill = textures.rgba(disc_dark, 1.0, shape)
    albedo = np.where(arm_mask[..., None], arm, np.where(disc_mask[..., None], disc, np.where(spine_mask[..., None], spine, fill)))
    relief = np.where(arm_mask, arm_height, np.where(disc_mask, disc_height, np.where(spine_mask, spine_height, 0.5)))
    rough = np.where(arm_mask, arm_rough, np.where(disc_mask, disc_rough, np.where(spine_mask, spine_rough, 0.7)))
    return {"albedo": albedo, "roughness": textures.grey(rough),
            "normal": textures.normal_from_height(relief, float(tex.get("reliefStrength", 1.0)))}


# ---------------------------------------------------------------- animation

def _arm_bones(name: str, suffix: str) -> list[str]:
    return [f"Arm{name}_{index}{suffix}" for index in range(BONES_PER_ARM)]


def build_clips(spec: dict, instances: list[tuple[str, str, float]]) -> list[ClipSpec]:
    """instances: (arm name, suffix, mirror sign) for every arm including mirrored ones."""
    clips = []
    animation = spec["animation"]

    rest = animation["rest"]
    channels: list[Channel] = []
    frequency = float(rest.get("frequency", 1.0))
    curl = [float(v) for v in rest.get("curl", [0, 0, 1.6, 3.2, 5.5])]
    sway = [float(v) for v in rest.get("sway", [0, 0.6, 1.0, 1.6, 2.4])]
    for k, (name, suffix, sign) in enumerate(instances):
        base_phase = k * 1.3
        for index, bone in enumerate(_arm_bones(name, suffix)):
            if curl[index] > 0:
                channels.append(Channel(bone, "rotation", (1, 0, 0), curl[index], frequency, base_phase - index * 0.6, bias=curl[index]))
            if sway[index] > 0:
                channels.append(Channel(bone, "rotation", (0, 0, 1), sign * sway[index], frequency, base_phase + 1.1 - index * 0.5))
    if float(rest.get("discRock", 0.0)) > 0:
        channels.append(Channel("Disc", "rotation", (1, 0, 0), float(rest["discRock"]), frequency, 0.4))
    clips.append(ClipSpec("rest", int(rest["frames"]), True, channels))

    crawl = animation["crawl"]
    channels = []
    frequency = float(crawl.get("frequency", 2.0))
    lag = float(crawl.get("lag", 0.5))
    sweep = {"A": [float(v) for v in crawl["sweepA"]], "B": [float(v) for v in crawl["sweepB"]],
             "Lead": [float(v) for v in crawl["leadSway"]]}
    lift = {"A": [float(v) for v in crawl["liftA"]], "B": [float(v) for v in crawl["liftB"]],
            "Lead": [float(v) for v in crawl["leadLift"]]}
    phase = {"A": 0.0, "B": float(crawl.get("phaseB", 0.45)) * math.pi, "Lead": float(crawl.get("phaseLead", 0.8))}
    for name, suffix, sign in instances:
        for index, bone in enumerate(_arm_bones(name, suffix)):
            if sweep[name][index] > 0:
                channels.append(Channel(bone, "rotation", (0, 0, 1), sign * sweep[name][index], frequency, phase[name] - index * lag))
            if lift[name][index] > 0:
                channels.append(Channel(bone, "rotation", (1, 0, 0), lift[name][index], frequency, phase[name] + math.pi / 2 - index * lag,
                                        bias=lift[name][index]))
    if float(crawl.get("discLift", 0.0)) > 0:
        amplitude = float(crawl["discLift"]) / 2
        channels.append(Channel("Disc", "location", (0, 0, 1), amplitude, frequency, -math.pi / 2, bias=amplitude))
    if float(crawl.get("discRock", 0.0)) > 0:
        channels.append(Channel("Disc", "rotation", (1, 0, 0), float(crawl["discRock"]), frequency, 0.3))
    clips.append(ClipSpec("crawl", int(crawl["frames"]), True, channels))

    recoil = animation["arm_recoil"]
    channels = []
    envelope = recoil.get("envelope", "bell")
    curl = [float(v) for v in recoil.get("curl", [7, 12, 18, 24, 28])]
    inward = [float(v) for v in recoil.get("inward", [0, 0, 0, 0, 0])]
    exponent = float(recoil.get("exponent", 0.7))
    for name, suffix, sign in instances:
        for index, bone in enumerate(_arm_bones(name, suffix)):
            if curl[index] > 0:
                channels.append(Channel(bone, "rotation", (1, 0, 0), curl[index], 0.5, 0.0, "sin", exponent, envelope=envelope))
            if inward[index] > 0 and name != "Lead":
                channels.append(Channel(bone, "rotation", (0, 0, 1), sign * inward[index], 0.5, 0.0, "sin", exponent, envelope=envelope))
    clips.append(ClipSpec("arm_recoil", int(recoil["frames"]), False, channels))
    return clips


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morphology = spec["morphology"]
    disc_spec = morphology["disc"]
    arms_spec = morphology["arms"]
    spines_spec = morphology.get("spines", {})
    target = float(spec["referenceSize"]["meters"])

    disc_geometry, lobe_radius = build_disc(disc_spec)
    layouts = arms_spec["layout"]
    length = fit_arm_length(layouts, arms_spec, lobe_radius, target)
    shapes = [ArmShape(layout, arms_spec, lobe_radius, length) for layout in layouts]
    fractions = [float(v) for v in arms_spec.get("boneFractions", [0.24, 0.22, 0.20, 0.18, 0.16])]
    if len(fractions) != BONES_PER_ARM:
        raise ValueError("arms.boneFractions must list five fractions")
    for shape in shapes:
        bounds = [shape.s_exit]
        for fraction in fractions:
            bounds.append(bounds[-1] + (1.0 - shape.s_exit) * fraction)
        bounds[-1] = 1.0
        shape.bone_bounds = bounds

    # ---- textures & material
    tex = spec.get("textures", {})
    paint = paint_textures(spec, shapes[0].bounds)
    written = []
    images = {}
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = ctx.texture_dir / f"body-{key}.png"
        images[key] = textures.write_image(f"{prefix}_Body_{key}", path, paint[key], non_color)
        written.append(path)
    palette = spec.get("palette", {})
    skin = mat.principled(f"{prefix}_Skin", palette.get("skin", (0.16, 0.13, 0.08)), 0.68, coat=0.0, subsurface=0.02, specular=0.3)
    mat.attach_textures(skin, albedo=images["albedo"], roughness=images["roughness"], normal=images["normal"],
                        normal_strength=float(tex.get("normalStrength", 0.8)))
    material_map = {"skin": skin}

    # ---- rig: Root (non-deform) -> Disc; Root -> five arm chains (children of Root so the disc lifts on its arms)
    disc_z = float(disc_spec.get("boneHeight", 0.0028))
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, disc_z), (0.004, 0.0, disc_z), deform=False)
    rb.bone("Disc", (-0.004, 0.0, disc_z), (0.004, 0.0, disc_z), "Root")
    instances: list[tuple[str, str, float]] = []
    for shape in shapes:
        sides = [("_L", False), ("_R", True)] if shape.mirror else [("", False)]
        for suffix, mirrored in sides:
            bones = _arm_bones(shape.name, suffix)
            for index in range(BONES_PER_ARM):
                head = shape.point(shape.bone_bounds[index])
                tail = shape.point(shape.bone_bounds[index + 1])
                if mirrored:
                    head = Vector((head.x, -head.y, head.z))
                    tail = Vector((tail.x, -tail.y, tail.z))
                rb.bone(bones[index], tuple(head), tuple(tail), "Root" if index == 0 else bones[index - 1], connected=index > 0)
            instances.append((shape.name, suffix, -1.0 if mirrored else 1.0))
    rig = rb.finish()

    # ---- meshes
    def arm_uv(u, v):
        return (ARM_TILE[0] + (ARM_TILE[1] - ARM_TILE[0]) * u, v)

    def spine_uv(u, v):
        return (SPINE_TILE[0] + (SPINE_TILE[1] - SPINE_TILE[0]) * u, SPINE_TILE[2] + (SPINE_TILE[3] - SPINE_TILE[2]) * v)

    disc_part = msh.make_part("disc", disc_geometry, "skin", lambda i, v: {"Disc": 1.0}, closed=True)
    disc_obj = msh.assemble(f"{prefix}_Disc", [disc_part], material_map, rig, f"{prefix}_Armature")
    disc_obj["lod"] = 1

    ring_segments = int(arms_spec.get("ringSegments", 12))
    rings_per_segment = int(arms_spec.get("ringsPerSegment", 3))
    attach_limit = lobe_radius + float(arms_spec.get("attachMargin", 0.004))
    parts = []
    arm_ids = []
    for shape in shapes:
        suffix = "_L" if shape.mirror else ""
        arm_id = f"{shape.name}{suffix}"
        bones = _arm_bones(shape.name, suffix)
        weight_of = arm_weight_fn(shape, bones)
        geometry, params, points = build_arm_tube(shape, arms_spec)
        ring_s = [s for s, _, _ in params]
        attach = set()
        for ring_index, s in enumerate(ring_s):
            if shape.radial(s) < attach_limit:
                attach.update(range(ring_index * ring_segments, (ring_index + 1) * ring_segments))
        attach.add(len(ring_s) * ring_segments)  # base cap centre
        tube_part = msh.make_part(f"arm_{arm_id}", geometry, "skin",
                                  lambda i, v, rs=ring_s, w=weight_of: w(vertex_s(i, rs, ring_segments)), closed=True,
                                  groups={f"arm_{arm_id}": set(range(len(geometry[0]))), f"attach_{arm_id}": attach},
                                  uv_transform=arm_uv)
        spine_geometry, spine_s, spine_attach = build_spines(shape, params, points, spines_spec, rings_per_segment, attach_limit)
        spine_part = msh.make_part(f"spines_{arm_id}", spine_geometry, "skin",
                                   lambda i, v, ss=spine_s, w=weight_of: w(ss[i]), closed=True,
                                   groups={f"arm_{arm_id}": set(range(len(spine_geometry[0]))), f"attach_{arm_id}": spine_attach},
                                   uv_transform=spine_uv)
        parts += [tube_part, spine_part]
        arm_ids.append(arm_id)
        if shape.mirror:
            parts += [tube_part.mirror_y({"_L": "_R"}), spine_part.mirror_y({"_L": "_R"})]
            arm_ids.append(f"{shape.name}_R")
    arms_obj = msh.assemble(f"{prefix}_Arms", parts, material_map, rig, f"{prefix}_Armature")
    arms_obj["lod"] = 1

    # ---- animation
    clips = build_clips(spec, instances)
    for clip in clips:
        bake_clip(rig, clip)

    # ---- contract
    meshes = [disc_obj, arms_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="xy")
    contract["closedParts"].append({"object": disc_obj.name, "group": "part_disc", "volumeFloor": 0.7})
    for arm_id in arm_ids:
        contract["closedParts"].append({"object": arms_obj.name, "group": f"part_arm_{arm_id}", "volumeFloor": 0.6})
        contract["clearance"].append({"a": [arms_obj.name, f"arm_{arm_id}", f"attach_{arm_id}"], "b": [disc_obj.name, "part_disc"],
                                      "label": f"arm_disc_{arm_id}"})
    for i, first in enumerate(arm_ids):
        for second in arm_ids[i + 1:]:
            contract["clearance"].append({"a": [arms_obj.name, f"arm_{first}", f"attach_{first}"],
                                          "b": [arms_obj.name, f"arm_{second}", f"attach_{second}"], "label": f"arm_arm_{first}_{second}"})
    for arm_id in arm_ids:
        if arm_id.endswith("_L"):
            contract["centerPlane"].append({"object": arms_obj.name, "group": f"arm_{arm_id}", "exclude": f"attach_{arm_id}", "side": -1})
        elif arm_id.endswith("_R"):
            contract["centerPlane"].append({"object": arms_obj.name, "group": f"arm_{arm_id}", "exclude": f"attach_{arm_id}", "side": 1})
    contract["symmetry"] = [{"object": arms_obj.name, "left": f"arm_{arm_id}", "right": f"arm_{arm_id[:-2]}_R", "tolerance": 0.00002}
                            for arm_id in arm_ids if arm_id.endswith("_L")]
    contract["axialChain"] = None
    register_clips(contract, clips)

    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written,
                       notes={"armLengthMeters": length, "discRadiusMeters": float(disc_spec["radius"]), "arms": arm_ids,
                              "segmentsPerArm": int(arms_spec["segments"])})
