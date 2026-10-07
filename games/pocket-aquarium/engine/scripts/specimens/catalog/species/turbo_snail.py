"""Turbo sp. (aquarium "Mexican turbo", modelled on Turbo fluctuosus): species-local gastropod body plan.

Anatomy choices
- Shell: one closed loft along a Raup-style logarithmic conispiral (five whorls, expansion 2.2 per whorl,
  dextral: clockwise seen from the apex). The generating curve is a circle (Turbo has a round aperture) whose
  radius is modulated by an angulate shoulder carrying a row of nodules and by wavy spiral cords; the normal map
  carries the finer cords, intermediate lirulae, cord beading and axial growth striae. A short peristome flare
  ends the tube and the aperture is capped with a nacre disc (Turbo interiors are iridescent). The shell is carried
  as a crawling turbinid carries it: aperture facing down and forward onto the foot, spire pointing back, right and up.
- Soft body: broad flat-soled foot (closed loft resting on z = 0), neck/head loft that fills the aperture and
  tapers to a blunt snout, two long tapering cephalic tentacles (left built at y < 0, right mirrored), short
  eyestalks with dark eyes at the outer tentacle bases, and a domed calcareous operculum on the posterior foot.
  No siphon: turbinids have none.
- Rig (7 deform bones): Shell; Foot_A/Foot_B/Foot_C along the sole (flat under Root so pedal waves are
  independent); Head; Tentacle_L/Tentacle_R parented to Head.
- Clips: rest (tentacle sway, foot pulse, slight head nod), crawl (posterior-to-anterior pedal wave of
  location and scale along the foot chain, slow tentacle wave, subtle shell rock), retract (foot, head and
  tentacles pull toward the aperture under a hold envelope while the shell settles).

Everything is derived from asset.source.json with fixed noise seeds; no Blender operators shape geometry.
"""

from __future__ import annotations

import math

import numpy as np
from mathutils import Matrix, Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import paint, textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.noise import fbm, smoothstep
from ..lib.rigging import RigBuilder, segment_weights

FOOT_BONES = ("Foot_A", "Foot_B", "Foot_C")
DEFORM_BONES = ("Shell", *FOOT_BONES, "Head", "Tentacle_L", "Tentacle_R")


def _complete_channels(channels: list[Channel], envelope: str | None) -> list[Channel]:
    """Key rotation, location and scale on every deform bone in every clip.

    Clips are evaluated back to back; a property that one clip animates and the next does not would keep the
    previous clip's last value. Zero-amplitude channels pin those properties to the rest value instead.
    """
    present = {(channel.target, channel.kind) for channel in channels}
    completed = list(channels)
    for bone in DEFORM_BONES:
        for kind in ("rotation", "location", "scale"):
            if (bone, kind) not in present:
                completed.append(Channel(bone, kind, (0.0, 0.0, 1.0), 0.0, 1.0, 0.0, "const", envelope=envelope))
    return completed


# ---------------------------------------------------------------- scalar helpers

def _sstep(edge0: float, edge1: float, value: float) -> float:
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _angle_diff(a: float, b: float) -> float:
    return math.atan2(math.sin(a - b), math.cos(a - b))


def _consistent_caps(geometry):
    """Wind cap and pole fan triangles the same way as the side quads.

    lib.meshing.loft/ellipsoid emit their centre-fan triangles with the shared ring edge traversed in the same
    direction as the neighbouring quad, so every cap faces inward relative to the sides. The edge-count
    watertight gate cannot see that, but signed volumes (and the animated volume-floor gate) can once a part has
    caps of unequal size. Reversing every triangle restores a consistently oriented closed surface; the quads are
    already consistent among themselves. See /tmp/pa-lanes/turbo_snail/shared-change-request.md.
    """
    vertices, faces, uvs, face_uvs = geometry
    fixed_faces = [tuple(reversed(face)) if len(face) == 3 else face for face in faces]
    fixed_face_uvs = None
    if face_uvs:
        fixed_face_uvs = [tuple(reversed(corners)) if len(face) == 3 else corners for face, corners in zip(faces, face_uvs)]
    return vertices, fixed_faces, uvs, fixed_face_uvs


# ---------------------------------------------------------------- shell coil

class Coil:
    """Logarithmic conispiral in the shell frame: axis +Z toward the apex, aperture at growth angle tau = 0.

    tau <= 0 runs back toward the apex; every whorl (2*pi of tau) multiplies whorl radius, axial offset and
    drop by `expansion`. The coil angle is psi = -tau so growth advances clockwise seen from the apex (dextral).
    """

    def __init__(self, sh: dict):
        self.whorls = float(sh["whorls"])
        self.expansion = float(sh["expansion"])
        self.k = math.log(self.expansion) / math.tau
        self.a0 = 1.0
        self.c0 = float(sh["axisOffset"])
        self.h0 = float(sh["translation"])
        self.segments = int(sh["segments"])
        self.rings_per_whorl = [int(v) for v in sh["ringsPerWhorl"]]
        if len(self.rings_per_whorl) != int(round(self.whorls)):
            raise ValueError("shell.ringsPerWhorl must list one ring count per whorl")
        self.shoulder = math.radians(float(sh["shoulderDegrees"]))
        self.shoulder_width = math.radians(float(sh["shoulderWidthDegrees"]))
        self.shoulder_amp = float(sh["shoulderAngularity"])
        self.ramp_depth = float(sh.get("rampDepth", 0.0))
        self.nodules = int(sh["nodulesPerWhorl"])
        self.nodule_amp = float(sh["noduleAmplitude"])
        self.cords = int(sh["cords"])
        self.cord_amp = float(sh["cordAmplitude"])
        self.cord_wave = float(sh["cordWave"])
        self.cord_wave_count = float(sh["cordWaveCount"])
        self.lip_flare = float(sh["lipFlare"])
        self.lip_rings = int(sh["lipRings"])

    def growth(self, tau: float) -> float:
        return math.exp(self.k * tau)

    def center(self, tau: float) -> Vector:
        g = self.growth(tau)
        psi = -tau
        return Vector((self.c0 * g * math.cos(psi), self.c0 * g * math.sin(psi), -self.h0 * g))

    def taus(self) -> list[float]:
        values = []
        whorl_count = len(self.rings_per_whorl)
        for whorl, count in enumerate(self.rings_per_whorl):
            start = -(whorl_count - whorl) * math.tau
            end = -(whorl_count - whorl - 1) * math.tau
            for index in range(count):
                values.append(start + (end - start) * index / count)
        values.append(0.0)
        for index in range(1, self.lip_rings + 1):
            values.append(math.tau * 0.018 * index)
        return values

    def sculpture(self, tau: float, phi: float, u: float) -> float:
        """Radius multiplier of the generating circle (shoulder angularity, nodules, wavy cords)."""
        exposure = _sstep(-0.55, 0.25, math.cos(phi))
        d = _angle_diff(phi, self.shoulder)
        bump = math.exp(-(d / self.shoulder_width) ** 2)
        nodule = (0.5 + 0.5 * math.cos(self.nodules * tau)) ** 2.0
        cord = (0.5 + 0.5 * math.cos(self.cords * phi + self.cord_wave * math.sin(math.tau * self.cord_wave_count * u))) ** 2.0
        # sub-sutural ramp: the whorl slopes in from the shoulder up to the suture (turbinid profile)
        ramp = _sstep(self.shoulder + 0.12, self.shoulder + 0.9, phi) * (1.0 - _sstep(1.75, 2.3, phi))
        relief = (self.shoulder_amp * bump + self.nodule_amp * bump * nodule + self.cord_amp * (cord - 0.5) * 2.0
                  - self.ramp_depth * ramp)
        # sculpture fades on the protoconch and the lip is smooth
        relief *= _sstep(0.02, 0.12, u) * (1.0 - _sstep(-0.05, 0.02, tau))
        flare = self.lip_flare * _sstep(-0.35, math.tau * 0.018 * self.lip_rings, tau)
        return 1.0 + exposure * relief + flare

    def rings(self):
        taus = self.taus()
        centers = [self.center(tau) for tau in taus]
        lengths = [0.0]
        for previous, current in zip(centers, centers[1:]):
            lengths.append(lengths[-1] + (current - previous).length)
        total = lengths[-1]
        u_values = [value / total for value in lengths]
        rings = []
        for tau, u in zip(taus, u_values):
            g = self.growth(tau)
            a = self.a0 * g
            c = self.c0 * g
            h = self.h0 * g
            psi = -tau
            ring = []
            for segment in range(self.segments):
                # phi = pi at the inner (axial) side so the UV seam hides against the columella
                phi = math.pi + math.tau * segment / self.segments
                factor = self.sculpture(tau, phi, u)
                rho = c + a * factor * math.cos(phi)
                zeta = -h + a * factor * math.sin(phi)
                ring.append((rho * math.cos(psi), rho * math.sin(psi), zeta))
            rings.append(ring)
        return rings, u_values, taus

    def aperture_tangent(self) -> Vector:
        delta = 1e-4
        return (self.center(delta) - self.center(-delta)).normalized()


def _shell_placement(coil: Coil, sh: dict):
    """Rotation taking the shell frame into the animal frame.

    The spire direction is chosen directly (azimuth back-right, elevation above the substrate). The aperture
    faces along the coil tangent, which sits at a fixed angle to the axis, so the aperture normal is the feasible
    direction on that cone closest to `apertureNormalPreferred` (down and a little forward, onto the foot).
    """
    f1 = coil.aperture_tangent()
    axis = Vector((0.0, 0.0, 1.0))
    cos_angle = axis.dot(f1)
    sin_angle = math.sqrt(max(1.0 - cos_angle * cos_angle, 1e-12))
    f2 = (axis - f1 * cos_angle).normalized()
    f3 = f1.cross(f2)
    azimuth = math.radians(float(sh["axisAzimuthDegrees"]))
    elevation = math.radians(float(sh.get("axisElevationDegrees", 25.0)))
    spire = Vector((-math.cos(elevation) * math.cos(azimuth), -math.cos(elevation) * math.sin(azimuth), math.sin(elevation)))
    preferred = Vector(sh.get("apertureNormalPreferred", (0.3, 0.0, -0.95))).normalized()
    w = (preferred - spire * preferred.dot(spire)).normalized()
    g1 = (spire * cos_angle + w * sin_angle).normalized()
    g2 = (spire - g1 * spire.dot(g1)).normalized()
    g3 = g1.cross(g2)
    rotation = Matrix((g1, g2, g3)).transposed() @ Matrix((f1, f2, f3))
    return rotation


def build_shell_geometry(spec: dict):
    sh = spec["shell"]
    coil = Coil(sh)
    rings, u_values, taus = coil.rings()
    rotation = _shell_placement(coil, sh)
    rotated = [[rotation @ Vector(point) for point in ring] for ring in rings]
    ys = [point.y for ring in rotated for point in ring]
    scale = float(spec["referenceSize"]["meters"]) / (max(ys) - min(ys))
    scaled = [[point * scale for point in ring] for ring in rotated]
    aperture_center = (rotation @ coil.center(0.0)) * scale
    xs = [point.x for ring in scaled for point in ring]
    ys = [point.y for ring in scaled for point in ring]
    min_z = min(point.z for ring in scaled for point in ring)
    # the shell's footprint is centred over the foot; the aperture lands wherever the coil puts it
    offset = Vector((float(sh.get("centerX", 0.0)) - (min(xs) + max(xs)) / 2,
                     float(sh.get("centerY", 0.0)) - (min(ys) + max(ys)) / 2,
                     float(sh["restEmbed"]) - min_z))
    placed = [[tuple(point + offset) for point in ring] for ring in scaled]
    axis_dir = (rotation @ Vector((0.0, 0.0, 1.0))).normalized()
    aperture_normal = (rotation @ coil.aperture_tangent()).normalized()
    geometry = _consistent_caps(msh.loft(placed, u_values=u_values, cap_start=True, cap_end=True))
    info = {
        "apertureCenter": aperture_center + offset,
        "apertureRadius": coil.a0 * scale * (1.0 + coil.lip_flare),
        "axisDirection": axis_dir,
        "apertureNormal": aperture_normal,
        "scale": scale,
        "uValues": u_values,
        "taus": taus,
        "segments": coil.segments,
        "coil": coil,
    }
    return geometry, info


# ---------------------------------------------------------------- soft body

def _foot_profile(F: dict, t: float):
    width = float(F["width"]) * 0.5
    thickness = float(F["thickness"])
    peak = float(F["thicknessPeak"])
    half_width = width * max(1.0 - ((t - 0.5) / 0.5) ** 2, 0.0) ** 0.55
    span = peak if t < peak else (1.0 - peak)
    th = thickness * max(1.0 - ((t - peak) / span) ** 2, 0.085) ** 0.85
    return max(half_width, 0.0012), th


def foot_rings(F: dict):
    count = int(F["rings"])
    x0 = float(F["xStart"])
    length = float(F["length"])
    rings = []
    xs = []
    for index in range(count):
        t = 0.012 + (1.0 - 0.024) * index / (count - 1)
        x = x0 + length * t
        half_width, th = _foot_profile(F, t)
        rings.append(msh.superellipse_ring(x, half_width, th * 0.5, th * 0.5, 0.0, th * 0.5, int(F["segments"]),
                                           float(F["dorsalExponent"]), float(F["ventralExponent"])))
        xs.append(x)
    return rings, xs


def foot_top(F: dict, x: float) -> float:
    t = (x - float(F["xStart"])) / float(F["length"])
    if not 0.0 <= t <= 1.0:
        return 0.0
    return _foot_profile(F, t)[1]


def head_rings(H: dict):
    count = int(H["rings"])
    rings = []
    for index in range(count):
        t = index / (count - 1)
        rounding = 1.0
        if t > 0.74:
            s = (t - 0.74) / 0.26
            rounding = max(math.sqrt(max(1.0 - s * s, 0.0)), 0.16)
        x = _lerp(float(H["xStart"]), float(H["xEnd"]), t)
        half_width = _lerp(float(H["widthStart"]), float(H["widthEnd"]), t) * rounding
        height = _lerp(float(H["heightStart"]), float(H["heightEnd"]), t)
        center_z = _lerp(float(H["centerZStart"]), float(H["centerZEnd"]), t) - (1.0 - rounding) * height * 0.25
        rings.append(msh.superellipse_ring(x, half_width, height * rounding, height * 0.9 * rounding, 0.0, center_z,
                                           int(H["segments"]), 2.1, 1.9))
    return rings


def tentacle_points(T: dict, side: int):
    base = Vector((float(T["baseX"]), side * float(T["baseY"]), float(T["baseZ"])))
    direction = Vector((float(T["direction"][0]), side * float(T["direction"][1]), float(T["direction"][2]))).normalized()
    length = float(T["length"])
    droop = float(T["droop"])
    count = int(T["rings"])
    points = []
    radii = []
    for index in range(count):
        t = index / (count - 1)
        point = base + direction * (length * t) + Vector((0.0, 0.0, -droop)) * (t * t)
        points.append(tuple(point))
        radii.append(_lerp(float(T["radiusBase"]), float(T["radiusTip"]), t ** 0.9))
    return points, radii, base, direction


# ---------------------------------------------------------------- textures

def paint_shell(spec: dict, info: dict, width: int, height: int):
    coil: Coil = info["coil"]
    palette = spec["palette"]
    U, V = textures.uv_grid(width, height)
    tau = np.interp(U, np.asarray(info["uValues"]), np.asarray(info["taus"]))
    phi = V * math.tau + math.pi
    exposure = smoothstep(-0.55, 0.25, np.cos(phi))
    wave = coil.cord_wave * np.sin(math.tau * coil.cord_wave_count * U)
    # coarse carinae match the mesh undulation; three finer lirulae run between each pair of carinae
    cords = (0.5 + 0.5 * np.cos(coil.cords * phi + wave)) ** 2.0
    lirulae = (0.5 + 0.5 * np.cos(4 * coil.cords * phi + wave * 1.1)) ** 3.0
    beads = (0.5 + 0.5 * np.cos(math.tau * U * 300.0)) ** 2.0
    d = np.arctan2(np.sin(phi - coil.shoulder), np.cos(phi - coil.shoulder))
    bump = np.exp(-(d / coil.shoulder_width) ** 2)
    nodule = (0.5 + 0.5 * np.cos(coil.nodules * tau)) ** 2.0
    growth = paint.shell_growth_lines(U, V, count=110.0, strength=0.6, seed=4)
    mottle = fbm(U * 40.0, V * 8.0, octaves=3, seed=11)
    patches = fbm(U * 12.0, V * 4.0, octaves=3, seed=21)

    albedo = textures.rgba(palette["shellBase"], 1.0, U.shape)
    albedo = textures.mix(albedo, palette["shellGreen"], 0.55 * smoothstep(0.4, 0.7, patches))
    # "longitudinally strigate or tessellate with white": axial dark and white flames that zig-zag across the
    # whorl and are interrupted by the carinae, so the pattern reads as a chevron/checker rather than stripes
    zigzag = 10.0 * (fbm(U * 46.0, V * 9.0, octaves=3, seed=7) - 0.5) + 2.8 * np.sin(phi + 0.6)
    flame_phase = math.tau * U * 58.0 + zigzag
    patchy = smoothstep(0.32, 0.62, fbm(U * 9.0, V * 3.0, octaves=3, seed=45))
    dark = smoothstep(0.5, 0.82, 0.5 + 0.5 * np.sin(flame_phase)) * (0.35 + 0.65 * mottle) * (0.35 + 0.65 * patchy)
    white = smoothstep(0.58, 0.88, 0.5 + 0.5 * np.sin(flame_phase + math.pi)) * (0.25 + 0.75 * smoothstep(0.35, 0.7, fbm(U * 18.0, V * 6.0, 3, seed=33)))
    tessellate = 0.5 + 0.5 * cords
    albedo = textures.mix(albedo, palette["shellDark"], dark * 0.85 * tessellate)
    albedo = textures.mix(albedo, palette["shellPale"], white * 0.75 * tessellate)
    albedo = textures.mix(albedo, palette["shellPale"], 0.2 * cords * exposure * (0.5 + 0.5 * beads))
    albedo = textures.mix(albedo, palette["shellPale"], 0.5 * bump * nodule * exposure)
    albedo = textures.mix(albedo, palette["shellPale"], 0.25 * smoothstep(0.14, 0.0, U))
    albedo = textures.scale_rgb(albedo, 0.9 + 0.2 * mottle)

    height_field = (0.5 + 0.20 * (cords - 0.5) * exposure + 0.11 * (lirulae - 0.5) * exposure + 0.10 * cords * beads * exposure
                    + 0.14 * bump * nodule * exposure + 0.09 * (growth - 0.5) + 0.05 * (mottle - 0.5))
    roughness = 0.6 - 0.2 * cords * exposure - 0.08 * lirulae * exposure + 0.08 * dark - 0.06 * white + 0.08 * (mottle - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(np.clip(height_field, 0.0, 1.0), 1.0)}


def paint_soft(spec: dict, width: int, height: int):
    palette = spec["palette"]
    U, V = textures.uv_grid(width, height)
    foot_tile = U < 0.5
    tentacle_tile = U >= 0.75
    local_u = np.where(foot_tile, U / 0.5, np.where(tentacle_tile, (U - 0.75) / 0.25, (U - 0.5) / 0.25))
    speckle = paint.spots(U * 2.0, V, density=70.0, radius=0.22, seed=9, jitter_radius=0.4)
    mottle = fbm(U * 30.0, V * 14.0, octaves=3, seed=13)
    albedo = textures.rgba(palette["soft"], 1.0, U.shape)
    albedo = textures.mix(albedo, palette["softPale"], 0.55 * speckle * (0.4 + 0.6 * mottle))
    albedo = textures.mix(albedo, palette["softPale"], 0.18 * smoothstep(0.55, 0.85, mottle))
    sole = paint.band(V, 0.5, 0.11, 0.05) * foot_tile
    albedo = textures.mix(albedo, palette["sole"], sole * (0.85 + 0.15 * mottle))
    # tentacles carry pale rings along their length
    rings = (0.5 + 0.5 * np.cos(math.tau * local_u * 7.0)) ** 5.0 * tentacle_tile
    albedo = textures.mix(albedo, palette["softPale"], 0.5 * rings)
    grain = fbm(U * 420.0, V * 210.0, octaves=3, seed=17)
    height_field = 0.5 + 0.18 * (grain - 0.5) + 0.12 * (speckle - 0.5)
    roughness = 0.42 + 0.08 * (grain - 0.5) + 0.14 * sole
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(height_field, 1.0)}


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    palette = spec["palette"]
    tex = spec.get("textures", {})
    F, H, T, E = spec["foot"], spec["head"], spec["tentacles"], spec["eyes"]
    operculum_spec = spec.get("operculum", {})

    # ---- shell geometry first: its placement drives the rig
    shell_geometry, info = build_shell_geometry(spec)
    aperture_center: Vector = info["apertureCenter"]
    axis_dir: Vector = info["axisDirection"]

    # ---- textures & materials
    written = []
    shell_w, shell_h = tex.get("shellResolution", [1024, 512])
    soft_w, soft_h = tex.get("softResolution", [1024, 512])
    shell_images = {}
    for key, pixels in paint_shell(spec, info, shell_w, shell_h).items():
        path = ctx.texture_dir / f"body-{key}.png"
        shell_images[key] = textures.write_image(f"{prefix}_Shell_{key}", path, pixels, key != "albedo")
        written.append(path)
    soft_images = {}
    for key, pixels in paint_soft(spec, soft_w, soft_h).items():
        path = ctx.texture_dir / f"soft-{key}.png"
        soft_images[key] = textures.write_image(f"{prefix}_Soft_{key}", path, pixels, key != "albedo")
        written.append(path)

    shell_material = mat.principled(f"{prefix}_Shell", palette["shellBase"], 0.6, coat=0.03, subsurface=0.0, specular=0.4)
    mat.attach_textures(shell_material, albedo=shell_images["albedo"], roughness=shell_images["roughness"],
                        normal=shell_images["normal"], normal_strength=float(tex.get("shellNormalStrength", 0.9)))
    nacre_material = mat.principled(f"{prefix}_Nacre", palette["nacre"], 0.18, coat=0.5, subsurface=0.0, specular=0.6)
    soft_material = mat.principled(f"{prefix}_Soft", palette["soft"], 0.42, coat=0.15, subsurface=0.18, specular=0.4)
    mat.attach_textures(soft_material, albedo=soft_images["albedo"], roughness=soft_images["roughness"],
                        normal=soft_images["normal"], normal_strength=float(tex.get("softNormalStrength", 0.5)))
    eye_material = mat.principled(f"{prefix}_Eye", palette["eye"], 0.15, coat=0.6, subsurface=0.0)
    operculum_material = mat.principled(f"{prefix}_Operculum", palette["operculum"], 0.35, coat=0.3, subsurface=0.0)
    material_map = {"shell": shell_material, "nacre": nacre_material, "soft": soft_material,
                    "eye": eye_material, "operculum": operculum_material}

    # ---- rig
    foot_x0 = float(F["xStart"])
    foot_len = float(F["length"])
    foot_z = 0.0018
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (-0.002, 0.0, 0.0008), (0.002, 0.0, 0.0008), deform=False)
    rb.bone("Shell", tuple(aperture_center), tuple(aperture_center + axis_dir * 0.02), "Root")
    joints = [foot_x0 + 0.001, foot_x0 + foot_len * 0.33, foot_x0 + foot_len * 0.63, foot_x0 + foot_len - 0.001]
    for index, name in enumerate(FOOT_BONES):
        rb.bone(name, (joints[index], 0.0, foot_z), (joints[index + 1], 0.0, foot_z), "Root")
    head_bone_head = Vector((float(H["xStart"]) + 0.004, 0.0, float(H["centerZStart"]) - 0.0004))
    head_bone_tail = Vector((float(H["xEnd"]) - 0.001, 0.0, float(H["centerZEnd"])))
    rb.bone("Head", tuple(head_bone_head), tuple(head_bone_tail), "Root")
    tentacle_geometry = {}
    for side, suffix in ((-1, "L"), (1, "R")):
        points, radii, base, direction = tentacle_points(T, side)
        tentacle_geometry[suffix] = (points, radii, base, direction)
        # plain full scale inheritance: glTF node hierarchies compose parent scale the same way, so import parity holds
        rb.bone(f"Tentacle_{suffix}", tuple(base), tuple(Vector(points[int(round((len(points) - 1) * 0.7))])), "Head")
    rig = rb.finish()

    def foot_weights(x: float) -> dict[str, float]:
        t = (x - foot_x0) / foot_len
        return segment_weights(min(max(t, 0.0), 1.0), list(FOOT_BONES), softness=0.7)

    # ---- shell part (single closed loft, nacre cap on the aperture)
    shell_part = msh.make_part("shell", shell_geometry, "shell", lambda i, v: {"Shell": 1.0}, closed=True)
    segments = info["segments"]
    shell_part.face_materials = ["shell"] * (len(shell_part.faces) - segments) + ["nacre"] * segments
    shell_obj = msh.assemble(f"{prefix}_Shell", [shell_part], material_map, rig, f"{prefix}_Armature")
    shell_obj["lod"] = 1

    # ---- foot
    rings, _xs = foot_rings(F)
    foot_geometry = _consistent_caps(msh.loft(rings, cap_start=True, cap_end=True))
    foot_part = msh.make_part("foot", foot_geometry, "soft", lambda i, v: foot_weights(v[0]), closed=True,
                              uv_transform=lambda u, v: (u * 0.5, v))

    # ---- head / neck: rides entirely on the Head bone so retraction slides it into the shell instead of
    # compressing it (its rear sits hidden inside the body whorl)
    head_geometry = head_rings(H)
    head_loft = _consistent_caps(msh.loft(head_geometry, cap_start=True, cap_end=True))
    head_part = msh.make_part("head", head_loft, "soft", lambda i, v: {"Head": 1.0}, closed=True,
                              uv_transform=lambda u, v: (0.5 + u * 0.25, v))

    # ---- tentacles, eyestalks and eyes (left built, right mirrored)
    points, radii, base, direction = tentacle_geometry["L"]
    t_segments = int(T["segments"])
    t_rings = int(T["rings"])
    tentacle_loft = _consistent_caps(msh.tube(points, radii, t_segments, cap_start=True, cap_end=True))

    def ring_of(index: int) -> int:
        if index < t_rings * t_segments:
            return index // t_segments
        return 0 if index == t_rings * t_segments else t_rings - 1

    def tentacle_weights(i, v):
        t = ring_of(i) / (t_rings - 1)
        s = _sstep(0.0, 0.55, t)
        return msh.blend_weights({"Head": 1.0}, {"Tentacle_L": 1.0}, s)

    attach = {i for i in range(len(tentacle_loft[0])) if ring_of(i) <= 1}
    tentacle_L = msh.make_part("tentacle_L", tentacle_loft, "soft", tentacle_weights, closed=True,
                               groups={"attach_tentacle_L": attach}, uv_transform=lambda u, v: (0.75 + u * 0.25, v))
    tentacle_R = tentacle_L.mirror_y(rename={"_L": "_R"})

    eye_base = Vector((float(E["baseX"]), -float(E["baseY"]), float(E["baseZ"])))
    eye_dir = Vector((float(E["direction"][0]), -float(E["direction"][1]), float(E["direction"][2]))).normalized()
    stalk_len = float(E["stalkLength"])
    stalk_r = float(E["stalkRadius"])
    stalk_points = [tuple(eye_base + eye_dir * (stalk_len * k / 3)) for k in range(4)]
    stalk_L = msh.make_part("eyestalk_L", _consistent_caps(msh.tube(stalk_points, [stalk_r, stalk_r, stalk_r * 0.92, stalk_r * 0.8], 10)), "soft",
                            lambda i, v: {"Head": 1.0}, closed=True, uv_transform=lambda u, v: (0.75 + u * 0.25, v))
    eye_r = float(E["eyeRadius"])
    eye_center = eye_base + eye_dir * (stalk_len + eye_r * 0.55)
    eye_L = msh.make_part("eye_L", _consistent_caps(msh.ellipsoid(tuple(eye_center), (eye_r, eye_r, eye_r), 12, 8)), "eye",
                          lambda i, v: {"Head": 1.0}, closed=True)
    stalk_R = stalk_L.mirror_y(rename={"_L": "_R"})
    eye_R = eye_L.mirror_y(rename={"_L": "_R"})

    soft_parts = [foot_part, head_part, tentacle_L, stalk_L, eye_L, tentacle_R, stalk_R, eye_R]

    # ---- operculum: domed calcareous plate on the posterior dorsal foot, inside the aperture
    if operculum_spec.get("enabled", True):
        ox = float(operculum_spec.get("offsetAlongFoot", -0.009))
        oy = float(operculum_spec.get("offsetY", 0.0025))
        oz = float(operculum_spec.get("z", foot_top(F, ox) + 0.001))
        radii_o = tuple(float(v) for v in operculum_spec.get("radii", [0.006, 0.005, 0.002]))
        tilt = Vector((0.0, 0.0, 1.0)).rotation_difference(Vector((-0.25, 0.0, 1.0)).normalized()).to_matrix()
        operculum = msh.make_part("operculum", _consistent_caps(msh.ellipsoid((ox, oy, oz), radii_o, 16, 10, tilt)), "operculum",
                                  lambda i, v, x=ox: foot_weights(x), closed=True)
        soft_parts.append(operculum)

    soft_obj = msh.assemble(f"{prefix}_Body", soft_parts, material_map, rig, f"{prefix}_Armature")
    soft_obj["lod"] = 1
    soft_obj["adultShellMeters"] = spec["referenceSize"]["meters"]

    # ---- animation
    A = spec["animation"]
    r, c, q = A["rest"], A["crawl"], A["retract"]
    rest_channels = [
        Channel("Tentacle_L", "rotation", (0, 0, 1), float(r["tentacleYaw"]), 1, 0.0),
        Channel("Tentacle_R", "rotation", (0, 0, 1), -float(r["tentacleYaw"]), 1, 0.6),
        Channel("Tentacle_L", "rotation", (1, 0, 0), float(r["tentaclePitch"]), 2, 1.2),
        Channel("Tentacle_R", "rotation", (1, 0, 0), float(r["tentaclePitch"]), 2, 2.3),
        Channel("Head", "rotation", (1, 0, 0), float(r["headPitch"]), 1, 0.3),
        Channel("Head", "location", (0, 1, 0), float(r["headSlide"]), 1, 0.9),
        Channel("Foot_A", "scale", (0, 0, 1), float(r["footPulse"]) * 0.7, 1, 2.0),
        Channel("Foot_B", "scale", (0, 0, 1), float(r["footPulse"]), 1, 1.0),
        Channel("Foot_C", "scale", (0, 0, 1), float(r["footPulse"]) * 0.7, 1, 0.0),
        Channel("Shell", "rotation", (1, 0, 0), float(r.get("shellRock", 0.2)), 1, 1.6),
    ]
    lag = float(c["waveLag"])
    wave_f = float(c["waveFrequency"])
    crawl_channels = []
    for index, name in enumerate(FOOT_BONES):
        crawl_channels.append(Channel(name, "location", (0, 1, 0), float(c["waveAmplitude"]), wave_f, -index * lag))
        crawl_channels.append(Channel(name, "scale", (0, 1, 0), float(c["waveScale"]), wave_f, -index * lag + math.pi / 2))
    crawl_channels += [
        Channel("Head", "location", (0, 1, 0), float(c["headSlide"]), wave_f, -3 * lag),
        Channel("Head", "rotation", (1, 0, 0), float(c["headPitch"]), wave_f, -3 * lag + 0.5),
        Channel("Tentacle_L", "rotation", (0, 0, 1), float(c["tentacleYaw"]), 1, 0.0),
        Channel("Tentacle_R", "rotation", (0, 0, 1), -float(c["tentacleYaw"]), 1, 0.7),
        Channel("Tentacle_L", "rotation", (1, 0, 0), float(c["tentaclePitch"]), 2, 1.0),
        Channel("Tentacle_R", "rotation", (1, 0, 0), float(c["tentaclePitch"]), 2, 1.9),
        Channel("Shell", "rotation", (1, 0, 0), float(c["shellRock"]), wave_f, 0.4),
        Channel("Shell", "rotation", (0, 0, 1), float(c["shellRoll"]), 1, 0.0),
    ]
    env = q.get("envelope", "hold")

    def held(target, kind, axis, amplitude):
        return Channel(target, kind, axis, float(amplitude), 1.0, 0.0, "const", envelope=env)

    retract_channels = [
        held("Head", "location", (0, 1, 0), q["headPull"]),
        held("Head", "scale", (0, 1, 0), q["headShrink"]),
        held("Tentacle_L", "scale", (0, 1, 0), q["tentacleShrink"]),
        held("Tentacle_R", "scale", (0, 1, 0), q["tentacleShrink"]),
        held("Tentacle_L", "rotation", (1, 0, 0), q["tentaclePitch"]),
        held("Tentacle_R", "rotation", (1, 0, 0), q["tentaclePitch"]),
        held("Foot_C", "location", (0, 1, 0), q["footFrontPull"]),
        held("Foot_C", "scale", (0, 1, 0), q["footFrontShrink"]),
        held("Foot_B", "scale", (0, 1, 0), q["footMidShrink"]),
        held("Foot_B", "scale", (0, 0, 1), q["footMidBulge"]),
        held("Foot_A", "location", (0, 1, 0), q["footRearPush"]),
        held("Foot_A", "scale", (0, 1, 0), q["footRearShrink"]),
        held("Shell", "rotation", (1, 0, 0), q["shellSettle"]),
    ]
    clips = [
        ClipSpec("rest", int(r["frames"]), True, _complete_channels(rest_channels, None)),
        ClipSpec("crawl", int(c["frames"]), True, _complete_channels(crawl_channels, None)),
        ClipSpec("retract", int(q["frames"]), False, _complete_channels(retract_channels, env)),
    ]
    mesh_objects = {shell_obj.name: shell_obj, soft_obj.name: soft_obj}
    for clip in clips:
        bake_clip(rig, clip, mesh_objects=mesh_objects)

    # ---- contract
    meshes = [shell_obj, soft_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="y")
    contract["closedParts"] += [
        {"object": shell_obj.name, "group": "part_shell", "volumeFloor": 0.9},
        {"object": soft_obj.name, "group": "part_foot", "volumeFloor": 0.6},
        {"object": soft_obj.name, "group": "part_head", "volumeFloor": 0.5},
    ]
    # Tentacles are proven clear of the foot and of each other in every clip. Shell clearance is not asserted:
    # the retract clip legitimately draws the shrinking tentacles back under the lip into the body whorl.
    for suffix in ("L", "R"):
        contract["clearance"].append({"a": [soft_obj.name, "part_foot"],
                                      "b": [soft_obj.name, f"part_tentacle_{suffix}", f"attach_tentacle_{suffix}"],
                                      "label": f"foot_tentacle_{suffix}"})
    contract["clearance"].append({"a": [soft_obj.name, "part_tentacle_L", "attach_tentacle_L"],
                                  "b": [soft_obj.name, "part_tentacle_R", "attach_tentacle_R"], "label": "tentacle_L_R"})
    contract["centerPlane"] += [
        {"object": soft_obj.name, "group": "part_tentacle_L", "exclude": "attach_tentacle_L", "side": -1},
        {"object": soft_obj.name, "group": "part_tentacle_R", "exclude": "attach_tentacle_R", "side": 1},
        {"object": soft_obj.name, "group": "part_eye_L", "exclude": None, "side": -1},
        {"object": soft_obj.name, "group": "part_eye_R", "exclude": None, "side": 1},
    ]
    contract["symmetry"] = [
        {"object": soft_obj.name, "left": "part_tentacle_L", "right": "part_tentacle_R", "tolerance": 1e-5},
        {"object": soft_obj.name, "left": "part_eyestalk_L", "right": "part_eyestalk_R", "tolerance": 1e-5},
        {"object": soft_obj.name, "left": "part_eye_L", "right": "part_eye_R", "tolerance": 1e-5},
    ]
    register_clips(contract, clips)

    notes = {
        "shellScaleMetersPerUnit": info["scale"],
        "apertureCenter": [round(v, 6) for v in aperture_center],
        "apertureRadiusMeters": round(info["apertureRadius"], 6),
        "axisDirection": [round(v, 4) for v in axis_dir],
        "apertureNormal": [round(v, 4) for v in info["apertureNormal"]],
        "footLengthMeters": foot_len,
    }
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
