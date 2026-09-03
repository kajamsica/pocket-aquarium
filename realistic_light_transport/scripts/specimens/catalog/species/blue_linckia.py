"""Linckia laevigata (blue Linckia starfish): species-local asteroid body plan.

Anatomy (WoRMS 207610; SeaLifeBase max 40 cm WD; Laxton 1974 Heron Island data via the UQ GBRI fact sheet:
disc diameter 30-40 mm, arm length 80-120 mm; Wikimedia Commons category for proportion study only):

- Five long, almost uniform cylindrical arms (about 2.2 cm thick on a 25 cm animal) tapering gently to rounded
  hemispherical tips; arm reach about six times the interradial disc radius. Tips are held a few millimetres
  off the substrate, as resting animals usually do. Front arm points +X; the two mirrored pairs sit at +/-72
  and +/-144 degrees, with mild length variation between the three radial positions.
- Cross-section: convex aboral half, flattened oral half with a shallow ambulacral groove dip. The oral side
  rests flat on z = 0 (origin base_center).
- The "disc" of Linckia is really the confluence of the arm bases, so it is modelled as a small, low,
  pentagonally lobed cushion dome covering the centre where the five arm tubes meet. Every arm and the disc
  is its own closed solid; overlapping solids share one mesh object and one material.
- Rig: Root (non deform) -> Disc -> five 4-bone arm chains (21 deform bones). Left arms are built once and
  mirrored to the right so the bilateral symmetry gate compares identical vertex orders.
- Clips: rest (barely visible tip lifts), crawl (slow metachronal lift wave around the star with a small
  lateral sway plus a subtle body drift), arm_curl (front arm and one left arm curl up and relax, bell envelope).
- Texture atlas (one 1024x1024 set): arms in v < 0.62 with u along the arm and v around it (seam on the oral
  midline, hidden by the groove), disc in v > 0.64 as a planar aboral projection. Granules are Worley cells
  evaluated in world millimetres so plate density matches between the two windows; paler yellowish tube-foot
  groove; cream madreporite on the disc; matte roughness.

Everything is deterministic: geometry from asset.source.json numbers, noise with fixed seeds, no random.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import noise, textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.rigging import RigBuilder

ARM_V = 0.62      # arm atlas window: v in [0, ARM_V]
DISC_V0 = 0.64    # disc atlas window: v in [DISC_V0, 1]
LETTERS = ("A", "B", "C", "D")
# (key, radial index, side, angle degrees) in cyclic order around the star (used for metachronal phases
# and for adjacency); left arms have y < 0, right arms y > 0.
ARMS = (("Arm0", 0, "", 0.0), ("Arm1_R", 1, "R", 72.0), ("Arm2_R", 2, "R", 144.0),
        ("Arm2_L", 2, "L", -144.0), ("Arm1_L", 1, "L", -72.0))


def _smooth(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def _bone(key: str, letter: str) -> str:
    side = key[5:]
    return f"Arm{key[3]}_{letter}" + (f"_{side}" if side else "")


def _part_name(key: str) -> str:
    return "arm" + key[3:]


# ---------------------------------------------------------------- morphology

class Morph:
    def __init__(self, spec: dict):
        m = spec["morphology"]
        self.disc_radius = float(m["discRadius"])
        self.disc_height = float(m["discHeight"])
        self.disc_lobing = float(m.get("discLobing", 0.06))
        self.disc_exponent = float(m.get("discExponent", 2.3))
        self.disc_bottom = float(m.get("discBottomLift", 0.0004))
        self.arm_radius = float(m["armRadius"])
        self.arm_reach = float(m["armReach"])
        self.arm_start = float(m.get("armStart", 0.006))
        self.arm_taper = float(m.get("armTaper", 0.88))
        self.arm_flare = float(m.get("armFlare", 0.08))
        self.tip_lift = float(m.get("tipLift", 0.006))
        self.length_factors = [float(v) for v in m.get("armLengthFactors", [1.0, 1.0, 1.0])]
        cross = m.get("crossSection", {})
        self.flatten = float(cross.get("bottomFlatten", 0.72))
        self.bottom_exponent = float(cross.get("bottomExponent", 2.4))
        self.groove_depth = float(cross.get("grooveDepth", 0.12))
        self.groove_width = float(cross.get("grooveWidth", 0.32))
        sampling = m.get("sampling", {})
        self.arm_segments = int(sampling.get("armSegments", 24))
        self.arm_rings = int(sampling.get("armRings", 28))
        self.cap_rings = int(sampling.get("capRings", 6))
        self.disc_segments = int(sampling.get("discSegments", 40))
        self.disc_rings = int(sampling.get("discRings", 12))
        self.root_cut = float(m.get("rootCutDiscRadii", 1.5)) * self.disc_radius
        self.blend_window = float(m.get("blendWindow", 0.02))
        self.disc_blend = [float(v) for v in m.get("discBlend", [0.0105, 0.028])]
        self.min_arm_gap = float(m.get("minArmGap", 0.0015))
        self.joint_fractions = [float(v) for v in spec.get("rig", {}).get("armJointFractions", [0.05, 0.3, 0.55, 0.78])]

    def reach(self, radial_index: int) -> float:
        return self.arm_reach * self.length_factors[radial_index]

    def body_radius(self, s: float) -> float:
        """Cylinder radius along the arm (fraction s of the reach) before tip rounding."""
        taper = 1.0 - (1.0 - self.arm_taper) * _smooth(s)
        flare = 1.0 + self.arm_flare * (1.0 - _smooth(s / 0.25)) ** 1.5
        return self.arm_radius * taper * flare

    def lift(self, s: float) -> float:
        return self.tip_lift * _smooth((s - 0.62) / 0.38) ** 1.4

    def arm_samples(self, reach: float):
        """(s, ring radius, axis z) per ring: uniform body rings, then hemispherical cap rings."""
        length = reach - self.arm_start
        s_cap = 1.0 - self.body_radius(1.0) / length
        r_end = self.body_radius(s_cap)
        main = self.arm_rings - self.cap_rings
        samples = []
        for index in range(main):
            s = s_cap * index / (main - 1)
            radius = self.body_radius(s)
            samples.append((s, radius, self.flatten * radius + self.lift(s)))
        for k in range(1, self.cap_rings + 1):
            phi = k / (self.cap_rings + 0.35) * (math.pi / 2)
            s = s_cap + (1.0 - s_cap) * math.sin(phi)
            samples.append((s, r_end * math.cos(phi), self.flatten * r_end + self.lift(s)))
        return samples, s_cap

    def axis_point(self, reach: float, d: float, angle_deg: float):
        """Point on the arm axis at radial distance d for the arm at angle_deg."""
        length = reach - self.arm_start
        s = (d - self.arm_start) / length
        s_cap = 1.0 - self.body_radius(1.0) / length
        z = self.flatten * self.body_radius(min(s, s_cap)) + self.lift(s)
        theta = math.radians(angle_deg)
        return (d * math.cos(theta), d * math.sin(theta), z)

    def ring_fn_for(self, samples):
        flatten, n = self.flatten, self.bottom_exponent

        def ring_fn(index: int, angle: float) -> float:
            # up_hint is -Z, so angle 0 is the oral midline and cos(angle) points down
            up = -math.cos(angle)
            lat = math.sin(angle)
            if up >= 0.0:
                rho = 1.0
            else:
                rho = (abs(lat) ** n + (abs(up) / flatten) ** n) ** (-1.0 / n)
            s = samples[index][0]
            wrapped = math.atan2(math.sin(angle), math.cos(angle))
            fade = _smooth(s / 0.08) * (1.0 - _smooth((s - 0.86) / 0.1))
            groove = self.groove_depth * fade * math.exp(-(wrapped / self.groove_width) ** 2)
            return rho * (1.0 - groove)

        return ring_fn


# ---------------------------------------------------------------- weights

def _arm_weights(d: float, joints: list[float], bones: list[str], m: Morph) -> dict[str, float]:
    window = m.blend_window
    weights = {bones[0]: 1.0}
    for index in range(1, len(bones)):
        t = _smooth((d - (joints[index] - window / 2.0)) / window)
        if t <= 0.0:
            break
        moved = weights[bones[index - 1]] * t
        weights[bones[index - 1]] -= moved
        weights[bones[index]] = moved
    chain = {name: value for name, value in weights.items() if value > 1e-6}
    t_disc = _smooth((d - m.disc_blend[0]) / (m.disc_blend[1] - m.disc_blend[0]))
    return msh.blend_weights({"Disc": 1.0}, chain, t_disc)


# ---------------------------------------------------------------- geometry

def _fix_cap_winding(geometry, segments: int):
    """lib.meshing.loft winds its two centre-fan caps opposite to the side quads (the gates only test
    watertightness and total volume, so this renders as dark inverted caps). Reverse the last 2 * segments
    faces so each closed part is a consistently oriented surface; ensure_outward then fixes the global sign."""
    verts, faces, uvs, face_uvs = geometry
    faces = list(faces)
    face_uvs = list(face_uvs) if face_uvs else None
    for index in range(len(faces) - 2 * segments, len(faces)):
        faces[index] = tuple(reversed(faces[index]))
        if face_uvs:
            face_uvs[index] = tuple(reversed(face_uvs[index]))
    return verts, faces, uvs, face_uvs


def _arm_part(m: Morph, key: str, radial_index: int, angle_deg: float, joints: list[float]) -> msh.MeshPart:
    reach = m.reach(radial_index)
    samples, _s_cap = m.arm_samples(reach)
    length = reach - m.arm_start
    points = [(m.arm_start + s * length, 0.0, z) for s, _r, z in samples]
    radii = [r for _s, r, _z in samples]
    geometry = msh.tube(points, radii, m.arm_segments, cap_start=True, cap_end=True, up_hint=(0.0, 0.0, -1.0),
                        ring_fn=m.ring_fn_for(samples), u_values=[s for s, _r, _z in samples])
    verts, faces, uvs, face_uvs = _fix_cap_winding(geometry, m.arm_segments)
    theta = math.radians(angle_deg)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    rotated = [(x * cos_t - y * sin_t, x * sin_t + y * cos_t, z) for x, y, z in verts]
    segments = m.arm_segments
    ring_count = len(samples)
    bones = [_bone(key, letter) for letter in LETTERS]

    def d_of(index: int) -> float:
        if index < ring_count * segments:
            ring = index // segments
        else:
            ring = 0 if index == ring_count * segments else ring_count - 1
        return m.arm_start + samples[ring][0] * length

    root = {index for index in range(len(rotated)) if d_of(index) < m.root_cut}
    name = _part_name(key)
    return msh.make_part(name, (rotated, faces, uvs, face_uvs), "skin",
                         lambda index, vertex: _arm_weights(d_of(index), joints, bones, m), closed=True,
                         groups={f"root_{name}": root}, uv_transform=lambda u, v: (u, v * ARM_V))


def _disc_part(m: Morph) -> msh.MeshPart:
    n = m.disc_exponent
    rings = []
    for j in range(m.disc_rings):
        phi = (j / m.disc_rings) * (math.pi / 2) * 0.92
        rho = math.cos(phi) ** (2.0 / n)
        zeta = math.sin(phi) ** (2.0 / n)
        z = m.disc_bottom + (m.disc_height - m.disc_bottom) * zeta
        ring = []
        for k in range(m.disc_segments):
            theta = k / m.disc_segments * math.tau
            radius = m.disc_radius * (1.0 + m.disc_lobing * math.cos(5.0 * theta)) * rho
            ring.append((radius * math.cos(theta), radius * math.sin(theta), z))
        rings.append(ring)
    verts, faces, _uvs, _face_uvs = _fix_cap_winding(msh.loft(rings, cap_start=True, cap_end=True), m.disc_segments)
    verts[-1] = (0.0, 0.0, m.disc_height)
    span = 2.4 * m.disc_radius * (1.0 + m.disc_lobing)
    planar = [(0.5 + x / span, 0.5 + y / span) for x, y, _z in verts]
    return msh.make_part("disc", (verts, faces, planar, None), "skin", lambda index, vertex: {"Disc": 1.0}, closed=True,
                         uv_transform=lambda u, v: (u, DISC_V0 + (1.0 - DISC_V0) * v))


# ---------------------------------------------------------------- textures

def _granules(X, Y, mm: float, seed: int, period: float | None = None, blend: float = 7.0):
    """Rounded plate relief from Worley cells in millimetres; optionally periodic across Y = period."""
    dist, ident = noise.cells(X / mm, Y / mm, seed)
    if period is not None:
        dist2, ident2 = noise.cells(X / mm, (Y - period) / mm, seed)
        w = noise.smoothstep(period - blend, period, Y)
        dist = dist * (1.0 - w) + dist2 * w
        ident = ident * (1.0 - w) + ident2 * w
    bump = (1.0 - noise.smoothstep(0.26, 0.64, dist)) ** 0.85
    return bump, ident


def _periodic_fbm(X, Y, scale: float, seed: int, period: float, blend: float = 7.0):
    a = noise.fbm(X / scale, Y / scale, 3, seed=seed)
    b = noise.fbm(X / scale, (Y - period) / scale, 3, seed=seed)
    w = noise.smoothstep(period - blend, period, Y)
    return a * (1.0 - w) + b * w


def _paint(spec: dict, m: Morph, width: int, height: int) -> dict:
    U, V = textures.uv_grid(width, height)
    palette = spec["palette"]
    blue = palette["skin"]
    pale = palette.get("skinPale", (0.05, 0.17, 0.82))
    dark = palette.get("skinDark", (0.004, 0.024, 0.25))
    foot = palette.get("tubeFoot", (0.66, 0.55, 0.36))
    madre = palette.get("madreporite", (0.82, 0.75, 0.55))
    tex = spec.get("textures", {})
    mm = float(tex.get("granuleMillimeters", 1.7))
    is_arm = V < (ARM_V + DISC_V0) / 2.0

    # arm window: u along the arm (base -> tip), v around it, seam on the oral midline
    length_mm = (m.arm_reach - m.arm_start) * 1000.0
    circ_mm = 2.0 * math.pi * m.arm_radius * 1000.0 * 0.93
    Xa = U * length_mm
    Ya = np.clip(V / ARM_V, 0.0, 1.0) * circ_mm
    bump_a, ident_a = _granules(Xa, Ya, mm, 11, period=circ_mm)
    mottle_a = _periodic_fbm(Xa, Ya, 16.0, 23, circ_mm)

    # disc window: planar aboral projection centred on the disc
    span_mm = 2.4 * m.disc_radius * (1.0 + m.disc_lobing) * 1000.0
    Xd = (U - 0.5) * span_mm
    Yd = (np.clip((V - DISC_V0) / (1.0 - DISC_V0), 0.0, 1.0) - 0.5) * span_mm
    bump_d, ident_d = _granules(Xd, Yd, mm, 31)
    mottle_d = noise.fbm(Xd / 16.0, Yd / 16.0, 3, seed=37)

    bump = np.where(is_arm, bump_a, bump_d)
    ident = np.where(is_arm, ident_a, ident_d)
    mottle = np.where(is_arm, mottle_a, mottle_d)

    # the plates are mostly a relief feature; keep the albedo an even cobalt with subtle plate tone
    albedo = textures.rgba(blue, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.94 + 0.12 * ident + 0.14 * (mottle - 0.5))
    albedo = textures.mix(albedo, pale, 0.12 * bump ** 2)
    albedo = textures.mix(albedo, dark, 0.28 * (1.0 - bump) ** 1.5)
    tip = noise.smoothstep(0.86, 1.0, U) * is_arm
    albedo = textures.mix(albedo, pale, 0.25 * tip)

    # ambulacral groove with two rows of tube feet along the oral midline (arm window only)
    seam = np.minimum(Ya, circ_mm - Ya)
    along = noise.smoothstep(0.02, 0.08, U) * (1.0 - noise.smoothstep(0.9, 0.96, U)) * is_arm
    groove = (1.0 - noise.smoothstep(2.0, 3.4, seam)) * along
    feet = np.exp(-((np.mod(Xa, 2.6) - 1.3) / 0.75) ** 2) * np.exp(-((seam - 1.9) / 0.65) ** 2) * along
    albedo = textures.mix(albedo, foot, 0.8 * groove)
    albedo = textures.mix(albedo, (0.95, 0.91, 0.78), 0.6 * feet)

    # madreporite: cream plate in the interradius between the front arm and the right +72 arm
    mx = 0.5 * m.disc_radius * 1000.0 * math.cos(math.radians(36.0))
    my = 0.5 * m.disc_radius * 1000.0 * math.sin(math.radians(36.0))
    mad = (1.0 - noise.smoothstep(1.7, 2.5, np.hypot(Xd - mx, Yd - my))) * (~is_arm)
    albedo = textures.mix(albedo, madre, 0.9 * mad)

    height_field = np.clip(0.30 + 0.55 * bump + 0.12 * (mottle - 0.5) - 0.18 * groove + 0.25 * feet + 0.2 * mad, 0.0, 1.0)
    roughness = 0.76 - 0.16 * bump + 0.05 * (1.0 - bump) - 0.2 * groove - 0.1 * mad
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(height_field, float(tex.get("reliefStrength", 1.8)))}


# ---------------------------------------------------------------- animation

def _clip(name: str, clip: dict) -> ClipSpec:
    loop = bool(clip["loop"])
    env = None if loop else clip.get("envelope", "bell")
    frequency = float(clip.get("frequency", 1.0))
    lag = float(clip.get("lag", 0.8))
    channels: list[Channel] = []
    pitch = clip.get("pitch")
    yaw = clip.get("yaw")
    for index, (key, _radial, _side, _angle) in enumerate(ARMS):
        arm_phase = index * math.tau / 5.0
        for j, letter in enumerate(LETTERS):
            bone = _bone(key, letter)
            if pitch and float(pitch[j]) > 0.0:
                # pulse keeps the lift non-negative so the oral side never dips through the substrate
                channels.append(Channel(bone, "rotation", (1.0, 0.0, 0.0), float(pitch[j]), frequency,
                                        arm_phase - j * lag, waveform="pulse", envelope=env))
            if yaw and float(yaw[j]) > 0.0:
                channels.append(Channel(bone, "rotation", (0.0, 0.0, 1.0), float(yaw[j]), frequency,
                                        arm_phase - j * lag + math.pi / 2.0, envelope=env))
    for key, amplitudes in clip.get("curl", {}).items():
        for j, letter in enumerate(LETTERS):
            if float(amplitudes[j]) > 0.0:
                channels.append(Channel(_bone(key, letter), "rotation", (1.0, 0.0, 0.0), float(amplitudes[j]), 1.0, 0.0,
                                        waveform="const", envelope=env))
    drift = clip.get("drift")
    if drift:
        if float(drift.get("forward", 0.0)) > 0.0:
            channels.append(Channel("Disc", "location", (0.0, 1.0, 0.0), float(drift["forward"]),
                                    float(drift.get("forwardFrequency", 1.0)), 0.0, envelope=env))
        if float(drift.get("lift", 0.0)) > 0.0:
            channels.append(Channel("Disc", "location", (0.0, 0.0, 1.0), float(drift["lift"]),
                                    float(drift.get("liftFrequency", 2.0)), 0.0, waveform="pulse", envelope=env))
    return ClipSpec(name, int(clip["frames"]), loop, channels)


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    m = Morph(spec)
    target = float(spec["referenceSize"]["meters"])

    # ---- parts (metres, front arm along +X, oral side down)
    parts = [_disc_part(m)]
    bone_specs = []  # (name, head, tail, parent, connected, deform)
    axis_z0 = m.flatten * m.arm_radius
    bone_specs.append(("Root", (-0.004, 0.0, axis_z0), (0.004, 0.0, axis_z0), None, False, False))
    bone_specs.append(("Disc", (-0.008, 0.0, axis_z0), (0.008, 0.0, axis_z0), "Root", False, True))
    left_parts = {}
    for key, radial, side, angle in ARMS:
        reach = m.reach(radial)
        length = reach - m.arm_start
        joints = [m.arm_start + length * f for f in m.joint_fractions]
        stations = joints + [reach]
        parent = "Disc"
        for j, letter in enumerate(LETTERS):
            name = _bone(key, letter)
            head = m.axis_point(reach, stations[j], angle)
            tail = m.axis_point(reach, stations[j + 1], angle)
            bone_specs.append((name, head, tail, parent, j > 0, True))
            parent = name
        if side == "R":
            continue  # right arms are mirrored from the left ones below
        part = _arm_part(m, key, radial, angle, joints)
        if side == "L":
            left_parts[key] = part
        parts.append(part)
    for key in ("Arm1_L", "Arm2_L"):
        parts.append(left_parts[key].mirror_y(rename={"_L": "_R"}))

    # ---- normalise: exact reference span across the widest arm tips, oral side resting on z = 0
    xs = [v[0] for part in parts for v in part.vertices]
    ys = [v[1] for part in parts for v in part.vertices]
    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = target / extent
    for part in parts:
        part.vertices = [(x * scale, y * scale, z * scale) for x, y, z in part.vertices]
    z_min = min(v[2] for part in parts for v in part.vertices)
    for part in parts:
        part.translate((0.0, 0.0, -z_min))

    def fix(point):
        return (point[0] * scale, point[1] * scale, point[2] * scale - z_min)

    # ---- rig
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    for name, head, tail, parent, connected, deform in bone_specs:
        rb.bone(name, fix(head), fix(tail), parent, connected=connected, deform=deform)
    rig = rb.finish()

    # ---- textures & material
    tex = spec.get("textures", {})
    width, height = tex.get("bodyResolution", [1024, 1024])
    paint = _paint(spec, m, int(width), int(height))
    images = {}
    written = []
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = ctx.texture_dir / f"body-{key}.png"
        images[key] = textures.write_image(f"{prefix}_Body_{key}", path, paint[key], non_color)
        written.append(path)
    skin = mat.principled(f"{prefix}_Skin", spec["palette"]["skin"], 0.7, coat=0.0, subsurface=0.04, specular=0.3)
    mat.attach_textures(skin, albedo=images["albedo"], roughness=images["roughness"], normal=images["normal"],
                        normal_strength=float(tex.get("normalStrength", 0.9)))

    # ---- mesh
    body = msh.assemble(f"{prefix}_Body", parts, {"skin": skin}, rig, f"{prefix}_Armature")
    body["adultArmSpanMeters"] = target
    body["lod"] = 1

    # ---- animation
    clips = [_clip(name, clip) for name, clip in spec["animation"].items()]
    for clip in clips:
        bake_clip(rig, clip, mesh_objects={body.name: body})

    # ---- contract
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [body.name], size_axis="xy")
    contract["closedParts"].append({"object": body.name, "group": "part_disc", "volumeFloor": 0.8})
    names = [_part_name(key) for key, _r, _s, _a in ARMS]
    for name in names:
        contract["closedParts"].append({"object": body.name, "group": f"part_{name}", "volumeFloor": 0.6})
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            item = {"a": [body.name, f"part_{names[i]}", f"root_{names[i]}"],
                    "b": [body.name, f"part_{names[j]}", f"root_{names[j]}"],
                    "label": f"arm_arm_{names[i]}_{names[j]}"}
            if (j - i) in (1, len(names) - 1):
                item["minDistance"] = m.min_arm_gap
            contract["clearance"].append(item)
    for key, _radial, side, _angle in ARMS:
        if side:
            name = _part_name(key)
            contract["centerPlane"].append({"object": body.name, "group": f"part_{name}", "exclude": f"root_{name}",
                                            "side": -1 if side == "L" else 1})
    contract["symmetry"] = [{"object": body.name, "left": f"part_arm{k}_L", "right": f"part_arm{k}_R", "tolerance": 0.0002}
                            for k in (1, 2)]
    register_clips(contract, clips)

    return BuildResult(rig=rig, root=None, meshes=[body], clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written,
                       notes={"normalisationScale": round(scale, 6), "restLiftMeters": round(z_min, 6),
                              "armReachMeters": [round(m.reach(k) * scale, 5) for k in range(3)],
                              "discRadiusMeters": round(m.disc_radius * scale, 5),
                              "armRadiusMeters": round(m.arm_radius * scale, 5), "arms": names})
