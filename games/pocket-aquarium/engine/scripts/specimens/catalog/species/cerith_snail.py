"""Cerithium sp. (Cerith Snail): species-local gastropod body plan for the Pocket Aquarium catalog.

Anatomy choices (Cerithium, Cerithiidae):
- Shell: Raup-style logarithmic conispiral sweep. Eleven whorls with a 25 degree spire angle give the slender,
  straight-sided turreted outline (about three times as long as wide). The generating curve is a slightly
  axially elongated superellipse in the radial plane; successive whorls overlap so the sutures read as impressed
  lines. Sculpture: four granulose spiral cords per whorl (beads aligned across the cords so they also read as
  weak axial ribs) plus two finer marginal threads, geometric on the last five whorls and carried by the normal
  map on the small early whorls. The body whorl is slightly inflated, the aperture constricted to a small oval
  with a thickened outer lip, a short anterior canal notch and a recessed dark interior. The apex is worn pale.
- Life pose: the shell is dragged behind with the coiling axis nearly horizontal, apex trailing low on the
  substrate, yawed to the animal's right; the aperture faces down onto the posterior half of the foot.
- Soft body: small flat-soled foot (sole on z = 0) with a neck hump rising into the aperture, short broad snout,
  two long slim cephalic tentacles with eyes on bulges at their outer bases, short inhalant siphon at the anterior
  canal (anatomical left).
- Rig: Shell (1 bone), Foot_A -> Foot_B -> Foot_C -> Head chain, Tentacle_L / Tentacle_R (children of Head),
  Siphon (child of Shell). Eight deform bones.
- Clips: rest (tentacle sway, foot pulse), crawl (pedal wave of sequential scale/shift channels along the foot
  chain, head bob, slow tentacle wave, shell rocking pulse), retract (foot, head, tentacles and siphon pull toward
  the aperture under a hold envelope).
Deterministic: every coordinate and texel derives from asset.source.json constants and seeded value noise.
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

TAU = math.tau
MM = 0.001
DEFORM_BONES = ("Shell", "Foot_A", "Foot_B", "Foot_C", "Head", "Tentacle_L", "Tentacle_R", "Siphon")


def _smooth(t: float) -> float:
    return msh.smoothstep(t)


def _sculpture_relief(k: int, segments: int, cord_set: set[int], thread_set: set[int], cord_relief: float,
                      bead_relief: float, bead: float) -> float:
    if k in cord_set:
        return cord_relief + bead_relief * bead
    if k in thread_set:
        return cord_relief * 0.45
    return 0.0


# ---------------------------------------------------------------- shell

class Shell:
    """Logarithmic conispiral in a local frame: apex at the origin, coiling axis +Z, growth toward -Z."""

    def __init__(self, m: dict):
        self.whorls = int(m.get("whorls", 11))
        self.spire_angle = math.radians(float(m.get("spireAngleDegrees", 25.0)))
        self.exposed_ratio = float(m.get("exposedWhorlRatio", 0.5))
        self.axis_overlap = float(m.get("axisOverlap", 0.35))
        self.whorl_overlap = float(m.get("whorlOverlap", 0.22))
        self.body_half_width = float(m.get("bodyWhorlHalfWidthMm", 4.0))
        self.section_exponent = float(m.get("sectionExponent", 2.3))
        self.segments = int(m.get("segments", 24))
        self.coarse_rings = int(m.get("coarseRingsPerWhorl", 12))
        self.fine_rings = int(m.get("fineRingsPerWhorl", 36))
        self.fine_whorls = int(m.get("fineWhorls", 5))
        self.beads_per_whorl = int(m.get("beadsPerWhorl", 12))
        step = 360.0 / self.segments
        self.cord_set = {int(round(float(a) / step)) % self.segments for a in m.get("cordAngles", [-45, -15, 15, 45])}
        self.thread_set = {int(round(float(a) / step)) % self.segments for a in m.get("threadAngles", [-75, 75])}
        self.cord_relief = float(m.get("cordRelief", 0.03))
        self.bead_relief = float(m.get("beadRelief", 0.055))
        self.body_inflation = float(m.get("bodyWhorlInflation", 0.10))
        self.aperture_constriction = float(m.get("apertureConstriction", 0.14))
        self.aperture_descent = float(m.get("apertureDescent", 1.0))
        self.canal_notch = float(m.get("canalNotch", 0.35))
        # the inner half of the generating curve is clamped at this fraction of R so the sweep never crosses
        # the coiling axis (a crossing strip would be inside-out); the flat wall it forms is the columella
        self.columella_radius = float(m.get("columellaRadius", 0.06))
        self.canal_angle = float(m.get("canalAngleDegrees", 250.0))
        self.canal_segment = int(round(self.canal_angle / step)) % self.segments
        self.lip_flare = float(m.get("lipFlare", 1.06))
        self.lip_thickness = float(m.get("lipThickness", 0.20))
        self.throat_recess = float(m.get("throatRecess", 0.5))
        tan_b = math.tan(self.spire_angle / 2.0)
        # exposed whorl height / whorl diameter fixes the expansion rate; the envelope cone fixes the translation rate
        self.W = 1.0 + 2.0 * tan_b * self.exposed_ratio
        self.T = (2.0 + self.axis_overlap) / tan_b
        self.R_N = self.body_half_width / (2.0 + self.axis_overlap)
        # axial elongation of the generating curve so that successive whorls overlap by `whorlOverlap`
        self.s = self.T * (self.W - 1.0) / (2.0 * (1.0 + self.axis_overlap) * (1.0 - self.whorl_overlap))
        self.theta_N = TAU * self.whorls

    def radius(self, theta: float) -> float:
        return self.R_N * self.W ** ((theta - self.theta_N) / TAU)

    def bead(self, theta: float) -> float:
        return max(0.0, math.cos(self.beads_per_whorl * theta)) ** 1.0

    def section(self, theta: float):
        """Generating-curve centre and semi-axes at sweep angle theta (local frame, millimetres)."""
        R = self.radius(theta)
        a_r = R * (1.0 + self.axis_overlap)
        a_z = a_r * self.s
        taper = 0.3 + 0.7 * _smooth(theta / TAU)
        inflate = 1.0 + self.body_inflation * _smooth((theta - (self.theta_N - 1.5 * TAU)) / TAU)
        constrict = 1.0 - self.aperture_constriction * _smooth((theta - (self.theta_N - 0.35 * TAU)) / (0.35 * TAU))
        a_r_eff = a_r * taper * inflate * constrict
        a_z_eff = a_z * taper * inflate * (1.0 - 0.5 * (1.0 - constrict))
        # the last third of a turn descends toward the substrate so the outer lip meets the foot
        descent = self.aperture_descent * a_r * _smooth((theta - (self.theta_N - 0.3 * TAU)) / (0.3 * TAU))
        centre = Vector((R * math.cos(theta), -R * math.sin(theta) - descent, -self.T * R))
        e_r = Vector((math.cos(theta), -math.sin(theta), 0.0))
        return centre, e_r, a_r_eff, a_z_eff

    def ring(self, centre: Vector, e_r: Vector, a_r: float, a_z: float, theta: float, fine: bool, scale: float = 1.0,
             sculpt: bool = True, notch: float = 0.0):
        ring = []
        bead = self.bead(theta) if fine else 0.0
        n = self.section_exponent
        R = self.radius(theta)
        axis_point = centre - e_r * R
        floor_radius = self.columella_radius * R
        for k in range(self.segments):
            psi = TAU * k / self.segments
            c, s = math.cos(psi), math.sin(psi)
            cr = math.copysign(abs(c) ** (2.0 / n), c)
            sz = math.copysign(abs(s) ** (2.0 / n), s)
            relief = 0.0
            if sculpt and c > 0.05:
                relief = _sculpture_relief(k, self.segments, self.cord_set, self.thread_set, self.cord_relief,
                                           self.bead_relief, bead)
            f = (1.0 + relief) * scale
            # anterior canal: the basal (-Z local) end of the aperture is drawn out into a short notch that is
            # twisted toward the columellar side, where the inhalant siphon emerges
            if notch > 0.0:
                delta = math.degrees(psi) - self.canal_angle
                f *= 1.0 + notch * math.exp(-(delta / 28.0) ** 2)
            radial = max(R + a_r * cr * f, floor_radius)
            point = axis_point + e_r * radial + Vector((0.0, 0.0, a_z * sz * f))
            ring.append(tuple(point))
        return ring

    def columella_points(self):
        """Axis polyline and radii for the thin columella plug that closes the base pinhole."""
        z_top = -self.T * self.radius(1.5 * TAU)
        _centre, _e_r, _a_r, a_z = self.section(self.theta_N)
        z_bottom = -self.T * self.R_N - 0.6 * a_z
        points, radii = [], []
        count = 14
        for i in range(count):
            t = i / (count - 1)
            z = z_top + (z_bottom - z_top) * t
            points.append((0.0, 0.0, z))
            radii.append(max(0.04, 0.14 * (-z / self.T)))
        return points, radii

    def build_rings(self):
        thetas = []
        for w in range(self.whorls):
            fine = w >= self.whorls - self.fine_whorls
            n = self.fine_rings if fine else self.coarse_rings
            for j in range(n):
                thetas.append((TAU * (w + j / n), fine))
        thetas.append((self.theta_N, True))
        rings, u_values = [], []
        for theta, fine in thetas:
            centre, e_r, a_r, a_z = self.section(theta)
            notch = self.canal_notch * _smooth((theta - (self.theta_N - 0.25 * TAU)) / (0.25 * TAU))
            rings.append(self.ring(centre, e_r, a_r, a_z, theta, fine, notch=notch))
            u_values.append(theta / self.theta_N)
        # aperture: flared thick outer lip, then the surface turns inward to a recessed throat and cap
        centre, e_r, a_r, a_z = self.section(self.theta_N)
        facing = Vector((0.0, -1.0, 0.0))
        lip_out = centre + facing * (0.10 * a_r)
        rings.append(self.ring(lip_out, e_r, a_r, a_z, self.theta_N, True, scale=self.lip_flare, notch=self.canal_notch))
        rim_in = centre + facing * (0.04 * a_r)
        rings.append(self.ring(rim_in, e_r, a_r, a_z, self.theta_N, True, scale=1.0 - self.lip_thickness, sculpt=False))
        throat = centre - facing * (self.throat_recess * a_r)
        rings.append(self.ring(throat, e_r, a_r, a_z, self.theta_N, True, scale=0.62 - self.lip_thickness * 0.5, sculpt=False))
        u_values += [1.0, 1.0, 1.0]
        aperture_ring_index = len(thetas) - 1
        return rings, u_values, aperture_ring_index, centre

    def frame(self, pose: dict):
        """Rotation taking the local shell frame into the animal frame (forward +X, up +Z)."""
        pitch = math.radians(float(pose.get("pitchDegrees", 15.0)))
        yaw = math.radians(float(pose.get("yawDegrees", 12.0)))
        roll = math.radians(float(pose.get("rollDegrees", 0.0)))
        apex = Vector((-math.cos(pitch), 0.0, -math.sin(pitch)))
        facing = Vector((math.sin(pitch), 0.0, -math.cos(pitch)))
        facing = Matrix.Rotation(-roll, 3, apex) @ facing
        spin = Matrix.Rotation(yaw, 3, "Z")
        apex = spin @ apex
        facing = spin @ facing
        y_world = -facing
        x_world = y_world.cross(apex)
        return Matrix((x_world, y_world, apex)).transposed(), apex


def superellipse_profile_ring(x, half_width, dorsal, ventral, centre_z, segments, exp_d, exp_v):
    return msh.superellipse_ring(x, half_width, dorsal, ventral, 0.0, centre_z, segments, exp_d, exp_v)


# ---------------------------------------------------------------- textures

def paint_shell(spec: dict, shell: Shell, width: int, height: int):
    palette = spec.get("palette", {})
    U, V = textures.uv_grid(width, height)
    theta = U * shell.theta_N
    psi_deg = (V * 360.0 + 180.0) % 360.0 - 180.0  # 0 at the outer face centre
    outer = noise.smoothstep(-0.25, 0.35, np.cos(np.radians(psi_deg)))
    bead = np.clip(np.cos(shell.beads_per_whorl * theta), 0.0, 1.0) ** 1.4
    cords = np.zeros_like(U)
    for angle in spec["morphology"]["shell"].get("cordAngles", [-45, -15, 15, 45]):
        cords = np.maximum(cords, paint.band(psi_deg, float(angle), 4.5, 3.0))
    threads = np.zeros_like(U)
    for angle in spec["morphology"]["shell"].get("threadAngles", [-75, 75]):
        threads = np.maximum(threads, paint.band(psi_deg, float(angle), 2.5, 2.0))
    cords *= outer
    threads *= outer
    growth = paint.shell_growth_lines(U, V, count=shell.whorls * 26.0, strength=0.6, seed=4)
    grain = noise.fbm(U * 120.0, V * 30.0, octaves=3, seed=21)
    flame = noise.fbm(U * 34.0, V * 5.0, octaves=3, seed=9)
    flecks = paint.spots(U * 6.0, V * 1.2, density=9.0, radius=0.22, seed=13, jitter_radius=0.5)

    base = textures.rgba(palette.get("shell", (0.16, 0.12, 0.09)), 1.0, U.shape)
    albedo = textures.scale_rgb(base, 0.8 + 0.45 * flame)
    # darker brown flames wander across the whorls between the cords
    albedo = textures.mix(albedo, (0.07, 0.05, 0.04), noise.smoothstep(0.62, 0.8, flame) * (0.35 + 0.35 * outer) * (1.0 - cords))
    # cream flecks everywhere (denser on the exposed face) and cream beads on the cords
    albedo = textures.mix(albedo, palette.get("shellPale", (0.8, 0.74, 0.62)), flecks * (0.3 + 0.35 * outer))
    albedo = textures.mix(albedo, palette.get("shellPale", (0.8, 0.74, 0.62)), cords * (0.35 + 0.65 * bead) * 0.78)
    albedo = textures.mix(albedo, (0.55, 0.48, 0.38), threads * 0.5)
    # worn pale apex and a paler protoconch
    albedo = textures.mix(albedo, palette.get("shellApex", (0.72, 0.66, 0.56)), noise.smoothstep(0.28, 0.02, U) * 0.85)
    # only the lip rings (u = 1) sample the pale glossy interior colour
    interior = noise.smoothstep(1.0 - 1.6 / width, 1.0 - 0.6 / width, U)
    albedo = textures.mix(albedo, palette.get("shellInterior", (0.86, 0.8, 0.72)), interior)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * grain)

    height_field = 0.5 + 0.22 * cords * (0.4 + 0.6 * bead) + 0.08 * threads + 0.10 * (growth - 0.5) + 0.05 * (grain - 0.5)
    roughness = 0.58 - 0.22 * cords * bead - 0.1 * flecks * outer + 0.08 * (grain - 0.5) - 0.3 * interior
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(np.clip(height_field, 0.0, 1.0), 1.6)}


def paint_body(spec: dict, width: int, height: int):
    palette = spec.get("palette", {})
    U, V = textures.uv_grid(width, height)
    skin = palette.get("skin", (0.13, 0.11, 0.09))
    pale = palette.get("skinPale", (0.44, 0.40, 0.34))
    mottle = noise.fbm(U * 18.0, V * 40.0, octaves=3, seed=31)
    speck = paint.spots(U * 3.0, V * 6.0, density=26.0, radius=0.2, seed=17, jitter_radius=0.6)
    albedo = textures.rgba(skin, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.85 + 0.35 * mottle)
    albedo = textures.mix(albedo, pale, speck * 0.55)
    # foot region v in [0, 0.5]: the sole (v about 0.25) is paler and smoother
    foot = 1.0 - noise.smoothstep(0.49, 0.51, V)
    sole = paint.band(V, 0.25, 0.085, 0.05) * foot
    albedo = textures.mix(albedo, palette.get("sole", (0.5, 0.45, 0.38)), sole * 0.9)
    # head region v in [0.5, 0.7]: paler snout tip
    head = noise.smoothstep(0.49, 0.51, V) * (1.0 - noise.smoothstep(0.69, 0.71, V))
    albedo = textures.mix(albedo, pale, head * noise.smoothstep(0.75, 1.0, U) * 0.4)
    # tentacle region v in [0.7, 0.85]: pale speckled tentacles with darker rings toward the tip
    tent = noise.smoothstep(0.69, 0.71, V) * (1.0 - noise.smoothstep(0.84, 0.86, V))
    rings = 0.5 + 0.5 * np.cos(U * TAU * 7.0)
    albedo = textures.mix(albedo, pale, tent * (0.45 + 0.35 * speck) * (0.6 + 0.4 * U))
    albedo = textures.mix(albedo, skin, tent * noise.smoothstep(0.55, 0.9, rings) * 0.5)
    # siphon region v in [0.85, 0.95]: dark with a pale rim
    siphon = noise.smoothstep(0.84, 0.86, V) * (1.0 - noise.smoothstep(0.94, 0.96, V))
    albedo = textures.mix(albedo, pale, siphon * noise.smoothstep(0.8, 1.0, U) * 0.5)
    height_field = 0.5 + 0.18 * (mottle - 0.5) + 0.12 * speck - 0.08 * sole
    roughness = 0.36 + 0.12 * (mottle - 0.5) - 0.06 * sole
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(np.clip(height_field, 0.0, 1.0), 1.0)}


def _region(v0: float, v1: float):
    def transform(u, v):
        return (u, v0 + v * (v1 - v0))
    return transform


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morphology = spec["morphology"]
    shell = Shell(morphology["shell"])
    pose = morphology.get("pose", {})
    foot_m = morphology["foot"]
    head_m = morphology["head"]
    tent_m = morphology["tentacle"]
    eye_m = morphology["eye"]
    siph_m = morphology["siphon"]
    palette = spec.get("palette", {})
    tex = spec.get("textures", {})

    # ---- textures & materials
    shell_w, shell_h = tex.get("shellResolution", [1024, 512])
    body_w, body_h = tex.get("bodyResolution", [512, 512])
    written = []
    images = {}
    for label, painted in (("shell", paint_shell(spec, shell, shell_w, shell_h)), ("body", paint_body(spec, body_w, body_h))):
        for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
            path = ctx.texture_dir / f"{label}-{key}.png"
            images[(label, key)] = textures.write_image(f"{prefix}_{label}_{key}", path, painted[key], non_color)
            written.append(path)
    shell_material = mat.principled(f"{prefix}_Shell", palette.get("shell", (0.16, 0.12, 0.09)), 0.55, coat=0.18, subsurface=0.0, specular=0.45)
    mat.attach_textures(shell_material, albedo=images[("shell", "albedo")], roughness=images[("shell", "roughness")],
                        normal=images[("shell", "normal")], normal_strength=float(tex.get("shellNormalStrength", 0.9)))
    body_material = mat.principled(f"{prefix}_Body", palette.get("skin", (0.13, 0.11, 0.09)), 0.36, coat=0.12, subsurface=0.25, specular=0.35)
    mat.attach_textures(body_material, albedo=images[("body", "albedo")], roughness=images[("body", "roughness")],
                        normal=images[("body", "normal")], normal_strength=float(tex.get("bodyNormalStrength", 0.4)))
    eye_material = mat.principled(f"{prefix}_Eye", palette.get("eye", (0.02, 0.015, 0.012)), 0.18, coat=0.5, subsurface=0.0)
    material_map = {"shell": shell_material, "body": body_material, "eye": eye_material}

    # ---- shell geometry (millimetres, design frame: aperture centre over the origin)
    rings, u_values, aperture_index, aperture_centre = shell.build_rings()
    M, apex_dir = shell.frame(pose)
    world_rings = [[tuple(M @ (Vector(p) - aperture_centre)) for p in ring] for ring in rings]
    # the shell rests on the substrate: its lowest point (the body whorl behind the foot) sits at shellRestZMm
    shell_min_z = min(p[2] for ring in world_rings for p in ring)
    lift = float(pose.get("shellRestZMm", 0.15)) - shell_min_z
    world_rings = [[(x, y, z + lift) for x, y, z in ring] for ring in world_rings]
    shell_geometry = msh.loft(world_rings, u_values=u_values, cap_start=True, cap_end=True)
    shell_part = msh.make_part("shell", shell_geometry, "shell", lambda i, v: {"Shell": 1.0}, closed=True)
    plug_points, plug_radii = shell.columella_points()
    plug_points = [tuple(M @ (Vector(p) - aperture_centre) + Vector((0.0, 0.0, lift))) for p in plug_points]
    columella_part = msh.make_part("columella", msh.tube(plug_points, plug_radii, 8), "shell", lambda i, v: {"Shell": 1.0},
                                   closed=True, uv_transform=lambda u, v: (1.0, v))
    shell_pivot = Vector((0.0, 0.0, lift))
    aperture_ring = [Vector(p) for p in world_rings[aperture_index]]
    aperture_world = sum(aperture_ring, Vector()) / len(aperture_ring)
    canal_point = aperture_ring[shell.canal_segment]
    apex_point = Vector(world_rings[0][0])
    axial_length = max((Vector(p) - apex_point).dot(-apex_dir) for ring in world_rings for p in ring)

    # ---- foot: flat-soled closed loft along x with a neck hump rising into the aperture
    x_rear, x_front = float(foot_m["rearXMm"]), float(foot_m["frontXMm"])
    foot_half = float(foot_m["halfWidthMm"])
    foot_height = float(foot_m["heightMm"])
    sole = float(foot_m["soleDepthMm"])
    hump_c, hump_w = float(foot_m["humpCenter"]), float(foot_m["humpWidth"])
    foot_rings_n = int(foot_m.get("rings", 24))
    foot_segments = int(foot_m.get("segments", 20))

    def base_dorsal(t: float) -> float:
        return 0.24 + (foot_height - sole - 0.24) * math.sin(math.pi * t) ** 0.7

    # the neck hump rises into the aperture so the soft body visibly fills the shell opening
    hump = max(float(foot_m.get("humpMinMm", 0.6)), aperture_world.z + float(foot_m.get("humpAboveApertureMm", 0.35)) - sole - base_dorsal(hump_c))

    def foot_profile(t: float):
        bell = math.sin(math.pi * t)
        half = 0.32 + (foot_half - 0.32) * bell ** 0.42 * (1.0 - 0.08 * t)
        dorsal = base_dorsal(t) + hump * math.exp(-((t - hump_c) / hump_w) ** 2)
        return half, dorsal

    foot_rings = []
    foot_u = []
    for i in range(foot_rings_n):
        t = i / (foot_rings_n - 1)
        t_eased = t
        x = x_rear + (x_front - x_rear) * t_eased
        half, dorsal = foot_profile(t_eased)
        foot_rings.append(superellipse_profile_ring(x, half, dorsal, sole, sole, foot_segments, 2.0, 4.5))
        foot_u.append(t)
    foot_geometry = msh.loft(foot_rings, u_values=foot_u, cap_start=True, cap_end=True)

    joints = (x_rear + 0.4, x_rear + (x_front - x_rear) * 0.36, x_rear + (x_front - x_rear) * 0.7, x_front - 0.6)
    foot_bones = ("Foot_A", "Foot_B", "Foot_C")

    def foot_weights(x: float) -> dict[str, float]:
        blend = 1.4
        if x <= joints[1] - blend / 2:
            return {"Foot_A": 1.0}
        if x < joints[1] + blend / 2:
            t = _smooth((x - (joints[1] - blend / 2)) / blend)
            return msh.blend_weights({"Foot_A": 1.0}, {"Foot_B": 1.0}, t)
        if x <= joints[2] - blend / 2:
            return {"Foot_B": 1.0}
        if x < joints[2] + blend / 2:
            t = _smooth((x - (joints[2] - blend / 2)) / blend)
            return msh.blend_weights({"Foot_B": 1.0}, {"Foot_C": 1.0}, t)
        return {"Foot_C": 1.0}

    foot_part = msh.make_part("foot", foot_geometry, "body", lambda i, v: foot_weights(v[0]), closed=True,
                              uv_transform=_region(0.0, 0.5))

    # ---- head: short broad snout seated in the foot's anterior dorsal surface
    h_rear, h_front = float(head_m["rearXMm"]), float(head_m["frontXMm"])
    head_rings = []
    head_u = []
    head_n = int(head_m.get("rings", 9))
    for i in range(head_n):
        t = i / (head_n - 1)
        x = h_rear + (h_front - h_rear) * t
        taper = 1.0 - float(head_m["taper"]) * t ** 1.3
        end_round = math.sqrt(max(0.04, 1.0 - max(0.0, (t - 0.62) / 0.38) ** 2))
        half = float(head_m["halfWidthMm"]) * taper * end_round
        dorsal = float(head_m["dorsalMm"]) * (1.0 - 0.3 * t) * end_round
        ventral = float(head_m["ventralMm"]) * (1.0 - 0.25 * t) * end_round
        centre_z = float(head_m["centerZMm"]) - 0.22 * t
        head_rings.append(superellipse_profile_ring(x, half, dorsal, ventral, centre_z, int(head_m.get("segments", 16)), 2.2, 2.0))
        head_u.append(t)
    head_geometry = msh.loft(head_rings, u_values=head_u, cap_start=True, cap_end=True)

    def head_weights(i, v):
        t = (v[0] - h_rear) / (h_front - h_rear)
        return msh.blend_weights({"Foot_C": 1.0}, {"Head": 1.0}, _smooth(t / 0.5))

    head_part = msh.make_part("head", head_geometry, "body", head_weights, closed=True, uv_transform=_region(0.5, 0.7))

    # ---- tentacles (left, y < 0) mirrored to the right; eyes on bulges at their outer bases
    base = Vector(tent_m["baseMm"])
    base.y = -abs(base.y)
    direction = Vector(tent_m["direction"])
    direction.y = -abs(direction.y)
    direction.normalize()
    length = float(tent_m["lengthMm"])
    curl = float(tent_m["curl"])
    points_n = int(tent_m.get("points", 7))
    tent_points = []
    tent_radii = []
    for i in range(points_n):
        t = i / (points_n - 1)
        along = base + direction * (length * t)
        along.z += curl * t * t
        tent_points.append(tuple(along))
        tent_radii.append(float(tent_m["baseRadiusMm"]) + (float(tent_m["tipRadiusMm"]) - float(tent_m["baseRadiusMm"])) * t ** 0.8)
    tent_tip = Vector(tent_points[-1])
    tentacle_geometry = msh.tube(tent_points, tent_radii, int(tent_m.get("segments", 8)))
    tentacle_L = msh.make_part("tentacle_L", tentacle_geometry, "body", lambda i, v: {"Tentacle_L": 1.0}, closed=True,
                               uv_transform=_region(0.7, 0.85))
    tentacle_R = tentacle_L.mirror_y(rename={"_L": "_R"})
    eye_centre = Vector(eye_m["centerMm"])
    eye_centre.y = -abs(eye_centre.y)
    eye_r = float(eye_m["radiusMm"])
    eye_L = msh.make_part("eye_L", msh.ellipsoid(tuple(eye_centre), (eye_r, eye_r, eye_r), 10, 6), "eye",
                          lambda i, v: {"Head": 1.0}, closed=True)
    eye_R = eye_L.mirror_y(rename={"_L": "_R"})

    # ---- siphon emerging from the anterior canal notch (anatomical left, y > 0)
    s_base = canal_point + (aperture_world - canal_point) * float(siph_m.get("inset", 0.3))
    s_dir = Vector(siph_m["direction"]).normalized()
    s_end = s_base + s_dir * float(siph_m["lengthMm"])
    s_n = int(siph_m.get("points", 5))
    siphon_points = []
    siphon_radii = []
    for i in range(s_n):
        t = i / (s_n - 1)
        p = s_base.lerp(s_end, t)
        p.z += 0.15 * math.sin(math.pi * t)
        siphon_points.append(tuple(p))
        siphon_radii.append(float(siph_m["baseRadiusMm"]) + (float(siph_m["tipRadiusMm"]) - float(siph_m["baseRadiusMm"])) * t)
    siphon_part = msh.make_part("siphon", msh.tube(siphon_points, siphon_radii, int(siph_m.get("segments", 8))), "body",
                                lambda i, v: {"Siphon": 1.0}, closed=True, uv_transform=_region(0.85, 0.95))

    # ---- recentre x on the footprint (y stays on the bilateral midline of the soft body, the shell hangs to
    # one side as in life) and scale the crawling length to the reference size
    parts = [shell_part, columella_part, foot_part, head_part, tentacle_L, tentacle_R, eye_L, eye_R, siphon_part]
    xs = [v[0] for part in parts for v in part.vertices]
    x_min, x_max = min(xs), max(xs)
    offset = Vector((-(x_min + x_max) / 2.0, 0.0, 0.0))
    scale = float(spec["referenceSize"]["meters"]) / ((x_max - x_min) * MM)
    unit = MM * scale

    def to_world(p) -> tuple[float, float, float]:
        q = (Vector(p) + offset) * unit
        return (q.x, q.y, q.z)

    for part in parts:
        part.vertices = [to_world(v) for v in part.vertices]

    # ---- rig
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, 0.0), (0.004 * scale, 0.0, 0.0), deform=False)
    shell_head = to_world(shell_pivot)
    rb.bone("Shell", shell_head, to_world(shell_pivot + apex_dir * 12.0), "Root")
    bone_z = 0.45
    rb.bone("Foot_A", to_world((joints[0], 0.0, bone_z)), to_world((joints[1], 0.0, bone_z)), "Root")
    rb.bone("Foot_B", to_world((joints[1], 0.0, bone_z)), to_world((joints[2], 0.0, bone_z)), "Foot_A", connected=True)
    rb.bone("Foot_C", to_world((joints[2], 0.0, bone_z)), to_world((joints[3], 0.0, bone_z)), "Foot_B", connected=True)
    head_z = float(head_m["centerZMm"])
    rb.bone("Head", to_world((h_rear + 1.2, 0.0, head_z)), to_world((h_front, 0.0, head_z - 0.2)), "Foot_C")
    rb.bone("Tentacle_L", to_world(base), to_world(tent_tip), "Head")
    mirrored_base = Vector((base.x, -base.y, base.z))
    mirrored_tip = Vector((tent_tip.x, -tent_tip.y, tent_tip.z))
    rb.bone("Tentacle_R", to_world(mirrored_base), to_world(mirrored_tip), "Head")
    rb.bone("Siphon", to_world(s_base), to_world(s_end), "Shell")
    rig = rb.finish()

    shell_obj = msh.assemble(f"{prefix}_Shell", [shell_part, columella_part], material_map, rig, f"{prefix}_Armature")
    body_obj = msh.assemble(f"{prefix}_Body", [foot_part, head_part, tentacle_L, tentacle_R, eye_L, eye_R, siphon_part],
                            material_map, rig, f"{prefix}_Armature")
    for obj in (shell_obj, body_obj):
        obj["adultLengthMeters"] = spec["referenceSize"]["meters"]
        obj["lod"] = 1

    # ---- animation
    clips = []
    for clip_name, clip in spec["animation"].items():
        loop = bool(clip["loop"])
        env = None if loop else clip.get("envelope", "hold")
        channels: list[Channel] = []
        if clip_name == spec["clipRoles"]["idle"]:
            pulse = float(clip.get("footPulse", 0.025))
            for index, bone in enumerate(foot_bones):
                channels.append(Channel(bone, "scale", (1.0, 0.0, 1.0), pulse, 1.0, -index * 0.9))
            channels.append(Channel("Head", "rotation", (0.0, 0.0, 1.0), float(clip.get("headYaw", 2.5)), 1.0, 0.4))
            for side, suffix in ((-1, "L"), (1, "R")):
                channels.append(Channel(f"Tentacle_{suffix}", "rotation", (0.0, 0.0, 1.0), -side * float(clip.get("tentacleYaw", 9.0)), 1.0, 0.0 if side < 0 else 1.3))
                channels.append(Channel(f"Tentacle_{suffix}", "rotation", (1.0, 0.0, 0.0), float(clip.get("tentaclePitch", 5.0)), 2.0, 0.7 * side))
            channels.append(Channel("Siphon", "rotation", (1.0, 0.0, 0.0), float(clip.get("siphonSway", 6.0)), 1.0, 0.9))
            channels.append(Channel("Siphon", "rotation", (0.0, 0.0, 1.0), float(clip.get("siphonSway", 6.0)) * 0.6, 1.0, 2.1))
            # the shell settles almost imperceptibly with the foot pulse (apex lifts, never dips into the substrate)
            channels.append(Channel("Shell", "rotation", (1.0, 0.0, 0.0), float(clip.get("shellSettle", 0.3)), 1.0, 0.0, waveform="pulse"))
        elif clip_name == spec["clipRoles"]["locomotion"]:
            freq = float(clip.get("pedalFrequency", 2.0))
            lag = float(clip.get("pedalLag", 1.5))
            for index, bone in enumerate(foot_bones):
                channels.append(Channel(bone, "scale", (0.0, 1.0, 0.0), float(clip.get("pedalScale", 0.07)), freq, -index * lag))
                channels.append(Channel(bone, "location", (0.0, 1.0, 0.0), float(clip.get("pedalShiftMm", 0.25)) * unit, freq, -index * lag - 0.6))
            channels.append(Channel("Head", "rotation", (1.0, 0.0, 0.0), float(clip.get("headBob", 3.5)), freq, -3 * lag))
            channels.append(Channel("Head", "location", (0.0, 1.0, 0.0), float(clip.get("headShiftMm", 0.3)) * unit, freq, -3 * lag - 0.6))
            for side, suffix in ((-1, "L"), (1, "R")):
                channels.append(Channel(f"Tentacle_{suffix}", "rotation", (0.0, 0.0, 1.0), -side * float(clip.get("tentacleYaw", 7.0)), 1.0, 0.0 if side < 0 else 1.1))
                channels.append(Channel(f"Tentacle_{suffix}", "rotation", (1.0, 0.0, 0.0), float(clip.get("tentaclePitch", 4.0)), 1.0, 1.6 + 0.5 * side))
            channels.append(Channel("Shell", "rotation", (1.0, 0.0, 0.0), float(clip.get("shellRock", 1.2)), freq, -0.4, waveform="pulse", exponent=1.5))
            channels.append(Channel("Siphon", "rotation", (1.0, 0.0, 0.0), float(clip.get("siphonSway", 4.0)), 1.0, 0.5))
        else:
            foot_scale = clip.get("footScale", [-0.16, -0.2, -0.22])
            foot_shift = clip.get("footShiftMm", [0.0, -0.45, -0.85])
            for index, bone in enumerate(foot_bones):
                channels.append(Channel(bone, "scale", (0.0, 1.0, 0.0), float(foot_scale[index]), 1.0, waveform="const", envelope=env))
                if abs(float(foot_shift[index])) > 1e-9:
                    channels.append(Channel(bone, "location", (0.0, 1.0, 0.0), float(foot_shift[index]) * unit, 1.0, waveform="const", envelope=env))
            channels.append(Channel("Head", "location", (0.0, 1.0, 0.0), float(clip.get("headShiftMm", -0.8)) * unit, 1.0, waveform="const", envelope=env))
            channels.append(Channel("Head", "scale", (0.0, 1.0, 0.0), float(clip.get("headScale", -0.25)), 1.0, waveform="const", envelope=env))
            channels.append(Channel("Head", "rotation", (1.0, 0.0, 0.0), float(clip.get("headNod", -8.0)), 1.0, waveform="const", envelope=env))
            for side, suffix in ((-1, "L"), (1, "R")):
                channels.append(Channel(f"Tentacle_{suffix}", "rotation", (0.0, 0.0, 1.0), -side * float(clip.get("tentacleYaw", 28.0)), 1.0, waveform="const", envelope=env))
                channels.append(Channel(f"Tentacle_{suffix}", "rotation", (1.0, 0.0, 0.0), float(clip.get("tentaclePitch", -14.0)), 1.0, waveform="const", envelope=env))
                channels.append(Channel(f"Tentacle_{suffix}", "scale", (0.0, 1.0, 0.0), float(clip.get("tentacleScale", -0.45)), 1.0, waveform="const", envelope=env))
            channels.append(Channel("Siphon", "scale", (0.0, 1.0, 0.0), float(clip.get("siphonScale", -0.5)), 1.0, waveform="const", envelope=env))
            channels.append(Channel("Siphon", "rotation", (1.0, 0.0, 0.0), float(clip.get("siphonPitch", -10.0)), 1.0, waveform="const", envelope=env))
            channels.append(Channel("Shell", "rotation", (1.0, 0.0, 0.0), float(clip.get("shellLift", 0.5)), 1.0, waveform="const", envelope=env))
        # key rotation, location and scale on every deform bone in every clip so no property value can leak from
        # one clip into the next when actions are swapped without a pose reset (validator and runtime parity)
        for bone in DEFORM_BONES:
            channels.append(Channel(bone, "rotation", (0.0, 0.0, 1.0), 0.0, 1.0))
            channels.append(Channel(bone, "location", (0.0, 1.0, 0.0), 0.0, 1.0))
            channels.append(Channel(bone, "scale", (0.0, 1.0, 0.0), 0.0, 1.0))
        clips.append(ClipSpec(clip_name, int(clip["frames"]), loop, channels))
    for clip in clips:
        bake_clip(rig, clip, mesh_objects={shell_obj.name: shell_obj, body_obj.name: body_obj})

    # ---- contract
    meshes = [shell_obj, body_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="x")
    contract["closedParts"] += [
        {"object": shell_obj.name, "group": "part_shell", "volumeFloor": 0.9},
        {"object": body_obj.name, "group": "part_foot", "volumeFloor": 0.6},
        {"object": body_obj.name, "group": "part_head", "volumeFloor": 0.6},
    ]
    contract["clearance"] += [
        {"a": [body_obj.name, "part_tentacle_L"], "b": [body_obj.name, "part_tentacle_R"], "minDistance": 0.4 * unit, "label": "tentacle_L_vs_R"},
        {"a": [body_obj.name, "part_tentacle_L"], "b": [body_obj.name, "part_foot"], "minDistance": 0.3 * unit, "label": "tentacle_L_vs_foot"},
        {"a": [body_obj.name, "part_tentacle_R"], "b": [body_obj.name, "part_foot"], "minDistance": 0.3 * unit, "label": "tentacle_R_vs_foot"},
        {"a": [body_obj.name, "part_tentacle_L"], "b": [shell_obj.name, "part_shell"], "minDistance": 0.5 * unit, "label": "tentacle_L_vs_shell"},
        {"a": [body_obj.name, "part_tentacle_R"], "b": [shell_obj.name, "part_shell"], "minDistance": 0.5 * unit, "label": "tentacle_R_vs_shell"},
        {"a": [body_obj.name, "part_head"], "b": [shell_obj.name, "part_shell"], "minDistance": 0.2 * unit, "label": "head_vs_shell"},
        {"a": [body_obj.name, "part_siphon"], "b": [body_obj.name, "part_head"], "minDistance": 0.3 * unit, "label": "siphon_vs_head"},
        {"a": [body_obj.name, "part_siphon"], "b": [body_obj.name, "part_tentacle_R"], "minDistance": 0.3 * unit, "label": "siphon_vs_tentacle_R"},
    ]
    contract["centerPlane"] += [
        {"object": body_obj.name, "group": "part_tentacle_L", "exclude": None, "side": -1},
        {"object": body_obj.name, "group": "part_tentacle_R", "exclude": None, "side": 1},
        {"object": body_obj.name, "group": "part_eye_L", "exclude": None, "side": -1},
        {"object": body_obj.name, "group": "part_eye_R", "exclude": None, "side": 1},
    ]
    contract["symmetry"] = [
        {"object": body_obj.name, "left": "part_tentacle_L", "right": "part_tentacle_R", "tolerance": 1e-6},
        {"object": body_obj.name, "left": "part_eye_L", "right": "part_eye_R", "tolerance": 1e-6},
    ]
    register_clips(contract, clips)

    notes = {
        "shellLengthMeters": round(axial_length * unit, 6),
        "apertureCentreMeters": [round(c, 6) for c in to_world(aperture_world)],
        "neckHumpMm": round(hump, 4),
        "shellWhorls": shell.whorls,
        "whorlExpansionRate": round(shell.W, 5),
        "translationRate": round(shell.T, 5),
        "generatingCurveElongation": round(shell.s, 5),
        "designScale": round(scale, 6),
        "footLengthMeters": round((x_front - x_rear) * unit, 6),
        "shellMinZMeters": round(min(v[2] for v in shell_part.vertices), 6),
        "canalPointMeters": [round(c, 6) for c in to_world(canal_point)],
    }
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
