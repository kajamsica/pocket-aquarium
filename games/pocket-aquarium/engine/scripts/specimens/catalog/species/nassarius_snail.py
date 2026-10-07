"""Nassarius sp. (Nassarius snail, trade spelling "Nasseria"): species-local gastropod build.

Every dimension comes from `asset.source.json` (meters, forward +X, up +Z, origin base_center so
the sole rests on z = 0). Anatomy choices:

- Shell: dextral logarithmic conispiral lofted as one closed tube. Whorl centre distance and axial
  drop grow exponentially (constant spire angle), the generating curve is a tall ellipse so successive
  whorls stay appressed with an impressed suture, the body whorl inflates over the last 1.2 whorls
  (ovate-conical, cyrtoconoid outline) and the final quarter whorl shortens axially and flares into a
  thickened outer lip around an ovate aperture. Beaded cancellate sculpture (axial ribs crossed by
  spiral cords) is a geometric radius relief on the outer face of every whorl and is repeated in the
  normal map. The shell is carried apex back and up (tilt from `shell.pose`) with the aperture facing
  the foot; a soft body column lofts from inside the aperture down into the foot so no open cap shows.
- Soft body: broad flat foot wider than the shell with a truncate bilobed anterior edge, two
  anterolateral horns and two metapodial tails, a small head, two slender cephalic tentacles with eyes
  on their thickened bases, and the long inhalant siphon that leaves the anterior siphonal notch and is
  held forward and up over the head.
- Rig (11 deform bones): Shell, foot chain Foot_A/Foot_B/Foot_C (rear to front), Head, Tentacle_L/R,
  Tail_L/R, Siphon_A/Siphon_B (parented to Shell). Horns and eyes ride on Foot_C / Head.
- Clips: rest (tentacle and siphon sway, foot pulse), crawl (three-phase pedal wave along the foot
  chain with tentacle and tail sway), siphon_probe (siphon raises, extends and sweeps while the
  anterior foot lifts; hold envelope, non-looping).
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
from ..lib.rigging import RigBuilder, segment_weights

FOOT_BONES = ("Foot_A", "Foot_B", "Foot_C")


# ---------------------------------------------------------------- helpers

def _pchip(xs, ys):
    """Monotone cubic (PCHIP) interpolant through station values."""
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    m[0] = d[0] if n < 3 or d[0] * d[1] > 0 else 0.0
    m[-1] = d[-1] if n < 3 or d[-1] * d[-2] > 0 else 0.0

    def f(x: float) -> float:
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        for i in range(n - 1):
            if xs[i] <= x <= xs[i + 1]:
                t = (x - xs[i]) / h[i]
                h00 = 2 * t ** 3 - 3 * t ** 2 + 1
                h10 = t ** 3 - 2 * t ** 2 + t
                h01 = -2 * t ** 3 + 3 * t ** 2
                h11 = t ** 3 - t ** 2
                return h00 * ys[i] + h10 * h[i] * m[i] + h01 * ys[i + 1] + h11 * h[i] * m[i + 1]
        return ys[-1]

    return f


def _subdivide(points, radii, subdivisions: int):
    """Catmull-Rom densification of a polyline with linearly interpolated radii."""
    pts = [Vector(p) for p in points]
    out_p, out_r = [], []
    count = len(pts)
    for i in range(count - 1):
        p0 = pts[max(i - 1, 0)]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[min(i + 2, count - 1)]
        for k in range(subdivisions):
            t = k / subdivisions
            t2, t3 = t * t, t * t * t
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out_p.append(tuple(q))
            out_r.append(radii[i] * (1 - t) + radii[i + 1] * t)
    out_p.append(tuple(pts[-1]))
    out_r.append(radii[-1])
    return out_p, out_r


def _mirror(points):
    return [(x, -y, z) for x, y, z in points]


def _ring_group(count_rings: int, segments: int):
    """Vertex indices of the first `count_rings` rings of a tube/loft (cap triangles follow ring 0)."""
    return set(range(count_rings * segments))


def _ring_index(i: int, ring_total: int, segments: int) -> int:
    """Ring index of loft vertex i; the start-cap centre maps to ring 0 and the end-cap centre to the last ring."""
    if i < ring_total * segments:
        return i // segments
    return 0 if i == ring_total * segments else ring_total - 1


def _rotation_z(degrees: float) -> Matrix:
    return Matrix.Rotation(math.radians(degrees), 3, "Z")


# ---------------------------------------------------------------- shell coil

class Coil:
    """Logarithmic conispiral in normalised units (aperture whorl centre distance = 1)."""

    def __init__(self, shell: dict):
        self.whorls = float(shell["whorls"])
        self.W = float(shell["expansionPerWhorl"])
        self.hk = float(shell["axialRise"])
        self.rho_r = float(shell["radialRatio"])
        self.rho_z = float(shell["axialRatio"])
        self.inflation = float(shell.get("bodyWhorlInflation", 0.1))
        self.inflation_span = float(shell.get("inflationSpanWhorls", 1.2))
        self.shrink = float(shell.get("apertureShrink", 0.15))
        self.shrink_span = float(shell.get("shrinkSpanWhorls", 0.3))
        self.flare = float(shell.get("lipFlare", 0.05))
        self.flare_span = float(shell.get("flareSpanWhorls", 0.12))
        # aperture inclination: the generating curve leans along the coil so the aperture plane is
        # tilted relative to the coiling axis (real nassariid apertures face slightly abapically)
        self.inclination = math.radians(float(shell.get("apertureInclinationDegrees", 0.0)))
        self.ribs = int(shell.get("ribsPerWhorl", 12))
        self.cords = int(shell.get("spiralCords", 12))
        self.bead = float(shell.get("beadRelief", 0.05))
        self.segments = int(shell.get("segments", 32))
        self.r0, self.r1 = (float(v) for v in shell.get("ringsPerWhorl", [10, 60]))
        self.theta_max = math.tau * self.whorls

    def thetas(self) -> list[float]:
        out = []
        theta = 0.0
        while theta < self.theta_max - 1e-9:
            out.append(theta)
            k = theta / self.theta_max
            theta += math.tau / (self.r0 + (self.r1 - self.r0) * k * k)
        # avoid a sliver ring right before the aperture
        if len(out) > 2 and (self.theta_max - out[-1]) < 0.35 * (out[-1] - out[-2]):
            out.pop()
        out.append(self.theta_max)
        return out

    def c(self, theta: float) -> float:
        return self.W ** ((theta - self.theta_max) / math.tau)

    def u(self, theta: float) -> float:
        return (self.W ** (theta / math.tau) - 1.0) / (self.W ** self.whorls - 1.0)

    def profile(self, theta: float):
        remaining = (self.theta_max - theta) / math.tau
        infl = 1.0 + self.inflation * msh.smoothstep(1.0 - remaining / self.inflation_span)
        shrink = 1.0 - self.shrink * msh.smoothstep(1.0 - remaining / self.shrink_span)
        flare = 1.0 + self.flare * msh.smoothstep(1.0 - remaining / self.flare_span)
        return infl, shrink, flare

    @staticmethod
    def visible(cos_phi: float) -> float:
        return msh.smoothstep((cos_phi + 0.35) / 0.45)

    def ring(self, theta: float, last: bool = False) -> list[tuple[float, float, float]]:
        c = self.c(theta)
        psi = math.pi / 2 + (self.theta_max - theta)  # dextral: angle decreases apex -> aperture
        infl, shrink, flare = self.profile(theta)
        edge = 0.96 if last else 1.0
        ar = self.rho_r * c * infl * flare * edge
        az = self.rho_z * c * infl * shrink * edge
        cx, cy, cz = c * math.cos(psi), c * math.sin(psi), -self.hk * c
        radial = (math.cos(psi), math.sin(psi))
        advance = (math.sin(psi), -math.cos(psi))  # horizontal coil direction (dpsi/dtheta = -1)
        lean = math.sin(self.inclination)
        rise = math.cos(self.inclination)
        rib = (0.5 + 0.5 * math.cos(self.ribs * theta)) ** 1.6
        bead = self.bead * (0.3 if last else 1.0)
        ring = []
        for s in range(self.segments):
            phi = s / self.segments * math.tau
            cp, sp = math.cos(phi), math.sin(phi)
            # geometry carries the axial ribs only; the spiral cords that cut them into beads live in
            # the normal map because 28 segments cannot resolve 18 cords without aliasing
            m = 1.0 + bead * rib * self.visible(cp)
            r_off = ar * cp * m
            z_off = az * sp * m
            ring.append((cx + radial[0] * r_off + advance[0] * z_off * lean,
                         cy + radial[1] * r_off + advance[1] * z_off * lean,
                         cz + z_off * rise))
        return ring

    def aperture(self):
        """Normalised aperture centre and the final ring semi-axes (before edge rounding)."""
        infl, shrink, flare = self.profile(self.theta_max)
        return (0.0, 1.0, -self.hk), self.rho_r * infl * flare, self.rho_z * infl * shrink


def build_shell_rings(shell: dict):
    """World-space shell rings, UV u values, pose frame and derived anchors."""
    coil = Coil(shell)
    thetas = coil.thetas()
    rings = [coil.ring(t, last=(i == len(thetas) - 1)) for i, t in enumerate(thetas)]
    u_values = [coil.u(t) for t in thetas]
    z_top = max(p[2] for p in rings[0])
    z_bottom = min(p[2] for ring in rings for p in ring)
    scale = float(shell["lengthMeters"]) / (z_top - z_bottom)
    ap_local, ar_n, az_n = coil.aperture()
    ap = Vector(ap_local) * scale

    pose = shell["pose"]
    tilt = math.radians(float(pose["tiltDegrees"]))
    axis = Vector((-math.cos(tilt), 0.0, math.sin(tilt)))          # local +Z (apex direction): back and up
    opening = Vector((-math.sin(tilt), 0.0, -math.cos(tilt)))      # local +X (coil advance at the aperture)
    side = Vector((0.0, -1.0, 0.0))                                 # local +Y (aperture side of the axis)
    # with inclination the aperture plane normal is rotated towards straight down by that angle
    aperture_normal = Vector((-math.sin(tilt - coil.inclination), 0.0, -math.cos(tilt - coil.inclination)))
    frame = _rotation_z(float(pose.get("yawDegrees", 0.0))) @ Matrix((
        (opening.x, side.x, axis.x),
        (opening.y, side.y, axis.y),
        (opening.z, side.z, axis.z),
    ))
    ap_world = Vector(pose["apertureCenter"])

    def to_world(p) -> Vector:
        return ap_world + frame @ (Vector(p) * scale - ap)

    world_rings = [[tuple(to_world(p)) for p in ring] for ring in rings]
    anchors = {
        "apertureCenter": ap_world,
        "apex": to_world((0.0, 0.0, z_top)),
        "frame": frame,
        "opening": _rotation_z(float(pose.get("yawDegrees", 0.0))) @ aperture_normal,
        "side": frame @ Vector((0.0, 1.0, 0.0)),
        "axis": frame @ Vector((0.0, 0.0, 1.0)),
        "apertureRadial": ar_n * scale,
        "apertureAxial": az_n * scale,
        "scale": scale,
        "coil": coil,
    }
    return world_rings, u_values, anchors


# ---------------------------------------------------------------- textures

def paint_shell(shell: dict, palette: dict, width: int, height: int):
    coil = Coil(shell)
    U, V = textures.uv_grid(width, height)
    theta = math.tau * np.log1p(U * (coil.W ** coil.whorls - 1.0)) / math.log(coil.W)
    whorl = theta / math.tau
    phi = V * math.tau
    cos_phi = np.cos(phi)
    vis = noise.smoothstep(0.0, 1.0, (cos_phi + 0.35) / 0.45)
    rib_soft = 0.5 + 0.5 * np.cos(coil.ribs * theta)
    cord_soft = 0.5 + 0.5 * np.cos(coil.cords * phi)
    rib = noise.smoothstep(0.30, 0.80, rib_soft)
    cord = noise.smoothstep(0.30, 0.80, cord_soft)
    bead = rib * cord * vis
    groove = noise.smoothstep(0.55, 0.85, 1.0 - cord_soft) * vis  # spiral grooves between the cords
    growth = paint.shell_growth_lines(whorl, V, count=36.0, strength=0.7, seed=4)
    mottle = noise.fbm(whorl * 2.4, V * 3.0, octaves=3, seed=21)
    blotch = noise.smoothstep(0.50, 0.70, noise.fbm(whorl * 1.6 + 3.0, V * 2.2, octaves=2, seed=33))
    flammule = noise.smoothstep(0.56, 0.74, noise.fbm(whorl * 9.0, V * 1.4, octaves=2, seed=44)) * vis

    base = textures.rgba(palette.get("shell", (0.80, 0.70, 0.54)), 1.0, U.shape)
    albedo = textures.mix(base, (0.62, 0.48, 0.32), 0.38 * mottle)
    albedo = textures.mix(albedo, (0.50, 0.36, 0.24), 0.55 * blotch * vis)
    albedo = textures.mix(albedo, (0.42, 0.28, 0.16), 0.55 * flammule)
    # spiral colour bands follow constant phi (they run along the whorl)
    band_color = palette.get("shellBand", (0.36, 0.22, 0.12))
    periphery = paint.band(V, 0.944, 0.032, 0.010) * (0.6 + 0.4 * (1.0 - rib))
    shoulder = paint.band(V, 0.125, 0.025, 0.012) * (0.5 + 0.5 * (1.0 - rib))
    subsutural = paint.band(V, 0.222, 0.012, 0.006)
    albedo = textures.mix(albedo, band_color, 0.9 * periphery)
    albedo = textures.mix(albedo, band_color, 0.6 * shoulder)
    albedo = textures.mix(albedo, (0.30, 0.19, 0.11), 0.7 * subsutural)
    # interstices and grooves between the beads darken unevenly (stronger inside the brown mottling),
    # bead crowns are slightly paler: a worn cancellate surface rather than a printed grid
    unevenness = 0.35 + 0.65 * noise.smoothstep(0.35, 0.7, mottle)
    albedo = textures.mix(albedo, (0.50, 0.38, 0.26), 0.14 * (1.0 - np.sqrt(rib_soft)) * vis * unevenness)
    albedo = textures.mix(albedo, (0.44, 0.32, 0.22), 0.18 * groove * unevenness)
    albedo = textures.mix(albedo, palette.get("shellBead", (0.94, 0.90, 0.80)), 0.16 * bead)
    albedo = textures.scale_rgb(albedo, 0.96 + 0.08 * growth)
    # brown protoconch/early spire, pale lip callus
    albedo = textures.mix(albedo, (0.48, 0.34, 0.24), 0.5 * (1.0 - noise.smoothstep(0.02, 0.07, U)))
    albedo = textures.mix(albedo, (0.88, 0.84, 0.76), 0.7 * noise.smoothstep(0.982, 0.996, U))

    height_map = np.clip(0.42 + 0.40 * bead - 0.16 * groove + 0.06 * (growth - 0.5) + 0.05 * (mottle - 0.5), 0.0, 1.0)
    roughness = np.clip(0.36 - 0.14 * bead + 0.08 * groove + 0.10 * (1.0 - vis) + 0.08 * mottle + 0.06 * periphery, 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "height": height_map}


def paint_soft(palette: dict, width: int, height: int):
    U, V = textures.uv_grid(width, height)
    base = textures.rgba(palette.get("soft", (0.80, 0.76, 0.68)), 1.0, U.shape)
    mottle = noise.fbm(U * 6.0, V * 3.0, octaves=3, seed=21)
    albedo = textures.mix(base, (0.66, 0.60, 0.50), 0.35 * mottle)
    speck = paint.spots(U, V, density=64.0, radius=0.17, seed=9, jitter_radius=0.5)
    patch = noise.smoothstep(0.38, 0.66, noise.fbm(U * 4.0, V * 4.0, octaves=2, seed=5))
    albedo = textures.mix(albedo, palette.get("speckle", (0.16, 0.12, 0.10)), 0.85 * speck * patch)
    sole = paint.band(V, 0.5, 0.18, 0.06)
    albedo = textures.mix(albedo, (0.88, 0.85, 0.78), 0.5 * sole)
    tip = noise.smoothstep(0.90, 0.97, U)
    albedo = textures.mix(albedo, (0.30, 0.24, 0.20), 0.55 * tip)
    roughness = np.clip(0.40 + 0.12 * mottle + 0.10 * speck - 0.10 * sole, 0.0, 1.0)
    height_map = np.clip(0.5 + 0.12 * (noise.fbm(U * 40.0, V * 20.0, octaves=3, seed=31) - 0.5) + 0.05 * speck, 0.0, 1.0)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "height": height_map}


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morph = spec["morphology"]
    palette = spec.get("palette", {})
    tex = spec.get("textures", {})
    shell_spec = morph["shell"]

    # ---- textures & materials
    written = []
    shell_w, shell_h = tex.get("shellResolution", [1024, 512])
    soft_w, soft_h = tex.get("softResolution", [512, 256])
    shell_paint = paint_shell(shell_spec, palette, shell_w, shell_h)
    soft_paint = paint_soft(palette, soft_w, soft_h)
    images = {}
    for stem, painted, strength in (("body", shell_paint, 1.6), ("soft", soft_paint, 0.9)):
        for key, non_color in (("albedo", False), ("roughness", True)):
            path = ctx.texture_dir / f"{stem}-{key}.png"
            images[f"{stem}-{key}"] = textures.write_image(f"{prefix}_{stem}_{key}", path, painted[key], non_color)
            written.append(path)
        path = ctx.texture_dir / f"{stem}-normal.png"
        images[f"{stem}-normal"] = textures.write_image(f"{prefix}_{stem}_normal", path,
                                                        textures.normal_from_height(painted["height"], strength), True)
        written.append(path)
    shell_mat = mat.principled(f"{prefix}_Shell", palette.get("shell", (0.8, 0.7, 0.55)), 0.36, coat=0.35, subsurface=0.0, specular=0.5)
    mat.attach_textures(shell_mat, albedo=images["body-albedo"], roughness=images["body-roughness"], normal=images["body-normal"],
                        normal_strength=float(tex.get("shellNormalStrength", 1.2)))
    soft_mat = mat.principled(f"{prefix}_Soft", palette.get("soft", (0.8, 0.76, 0.68)), 0.45, coat=0.08, subsurface=0.3, specular=0.35)
    mat.attach_textures(soft_mat, albedo=images["soft-albedo"], roughness=images["soft-roughness"], normal=images["soft-normal"],
                        normal_strength=float(tex.get("softNormalStrength", 0.5)))
    eye_mat = mat.principled(f"{prefix}_Eye", palette.get("eye", (0.02, 0.015, 0.01)), 0.2, coat=0.5, subsurface=0.0)
    material_map = {"shell": shell_mat, "soft": soft_mat, "eye": eye_mat}

    # ---- shell geometry (needed for the rig anchors)
    shell_rings, shell_u, anchors = build_shell_rings(shell_spec)
    ap_center: Vector = anchors["apertureCenter"]
    apex: Vector = anchors["apex"]

    foot_spec = morph["foot"]
    stations = foot_spec["stations"]
    foot_x0, foot_x1 = stations[0][0], stations[-1][0]
    head_spec = morph["head"]
    tentacle_spec = morph["tentacles"]
    tail_spec = morph["tails"]
    horn_spec = morph["horns"]
    siphon_spec = morph["siphon"]
    eye_spec = morph["eyes"]

    siphon_pts, siphon_radii = _subdivide(siphon_spec["points"], siphon_spec["radii"], int(siphon_spec.get("subdivisions", 3)))
    joint_index = int(siphon_spec.get("jointIndex", 3)) * int(siphon_spec.get("subdivisions", 3))
    tentacle_pts, tentacle_radii = _subdivide(tentacle_spec["points"], tentacle_spec["radii"], int(tentacle_spec.get("subdivisions", 3)))
    tail_pts, tail_radii = _subdivide(tail_spec["points"], tail_spec["radii"], int(tail_spec.get("subdivisions", 3)))
    horn_pts, horn_radii = _subdivide(horn_spec["points"], horn_spec["radii"], int(horn_spec.get("subdivisions", 3)))

    # ---- rig
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.002, 0.0, 0.0005), (-0.002, 0.0, 0.0005), deform=False)
    rb.bone("Shell", tuple(ap_center), tuple(ap_center.lerp(apex, 0.5)), "Root")
    foot_span = foot_x1 - foot_x0
    joints = [foot_x0 + 0.001, foot_x0 + foot_span / 3, foot_x0 + 2 * foot_span / 3, foot_x1 - 0.002]
    rb.bone("Foot_A", (joints[0], 0.0, 0.001), (joints[1], 0.0, 0.0012), "Root")
    rb.bone("Foot_B", (joints[1], 0.0, 0.0012), (joints[2], 0.0, 0.0012), "Foot_A", connected=True)
    rb.bone("Foot_C", (joints[2], 0.0, 0.0012), (joints[3], 0.0, 0.001), "Foot_B", connected=True)
    head_stations = head_spec["stations"]
    rb.bone("Head", (head_stations[1][0], 0.0, head_stations[1][2]), (head_stations[-1][0], 0.0, head_stations[-1][2]), "Foot_C")
    for side, suffix in ((1, "L"), (-1, "R")):
        pts = tentacle_spec["points"] if side > 0 else _mirror(tentacle_spec["points"])
        rb.bone(f"Tentacle_{suffix}", tuple(pts[0]), tuple(pts[-1]), "Head")
        pts = tail_spec["points"] if side > 0 else _mirror(tail_spec["points"])
        rb.bone(f"Tail_{suffix}", tuple(pts[0]), tuple(pts[-1]), "Foot_A")
    rb.bone("Siphon_A", tuple(siphon_pts[0]), tuple(siphon_pts[joint_index]), "Shell")
    rb.bone("Siphon_B", tuple(siphon_pts[joint_index]), tuple(siphon_pts[-1]), "Siphon_A", connected=True)
    rig = rb.finish()

    # ---- shell mesh
    shell_geometry = msh.loft(shell_rings, u_values=shell_u, cap_start=True, cap_end=True)
    shell_part = msh.make_part("shell", shell_geometry, "shell", lambda i, v: {"Shell": 1.0}, closed=True)
    shell_obj = msh.assemble(f"{prefix}_Shell", [shell_part], material_map, rig, f"{prefix}_Armature")
    shell_obj["shellLengthMeters"] = float(shell_spec["lengthMeters"])
    shell_obj["lod"] = 1

    # ---- soft parts
    soft_parts = []

    def foot_weights(x: float) -> dict[str, float]:
        t = (x - foot_x0) / foot_span
        return segment_weights(t, list(FOOT_BONES), softness=0.7)

    # foot: flat-soled loft along x with a rounded dorsum
    half_width = _pchip([s[0] for s in stations], [s[1] for s in stations])
    top = _pchip([s[0] for s in stations], [s[2] for s in stations])
    sole = float(foot_spec.get("soleLift", 0.00025))
    foot_rings = []
    foot_u = []
    ring_count = int(foot_spec.get("rings", 44))
    for k in range(ring_count):
        f = k / (ring_count - 1)
        x = foot_x0 + foot_span * (0.5 - 0.5 * math.cos(math.pi * f))
        foot_rings.append(msh.superellipse_ring(x, half_width(x), max(top(x) - sole, 0.0002), sole, 0.0, sole,
                                                int(foot_spec.get("segments", 28)), float(foot_spec.get("dorsalExponent", 2.0)),
                                                float(foot_spec.get("ventralExponent", 3.5))))
        foot_u.append(f)
    foot_geometry = msh.loft(foot_rings, u_values=foot_u, cap_start=True, cap_end=True)
    soft_parts.append(msh.make_part("foot", foot_geometry, "soft", lambda i, v: foot_weights(v[0]), closed=True,
                                    uv_transform=lambda u, v: (0.04 + 0.80 * u, v)))

    # body column: lofts from inside the aperture down into the foot (visceral hump / columellar muscle)
    column_spec = morph.get("bodyColumn", {})
    opening: Vector = anchors["opening"]
    ap_ring = [Vector(p) for p in shell_rings[-1]]
    embed_z = float(column_spec.get("embedZ", 0.0014))
    # (descent fraction, horizontal scale about the aperture centre): a waisted neck that flares back
    # out where it meets the foot so the soft body reads as a rounded mass, not a box
    profile = column_spec.get("profile", [[0.3, 0.85], [0.6, 0.78], [0.85, 0.82], [1.0, 0.95]])

    def scaled_ring(scale_factor: float, offset: Vector):
        return [ap_center + (p - ap_center) * scale_factor + offset for p in ap_ring]

    column_rings = [scaled_ring(0.86, -opening * 0.0014), scaled_ring(0.94, Vector((0, 0, 0)))]
    at_ap = column_rings[-1]
    for f, scale_xy in profile:
        ring = []
        for p in at_ap:
            z = p.z + (embed_z - p.z) * float(f)
            ring.append(Vector((ap_center.x + (p.x - ap_center.x) * float(scale_xy), ap_center.y + (p.y - ap_center.y) * float(scale_xy), z)))
        column_rings.append(ring)
    column_geometry = msh.loft([[tuple(p) for p in ring] for ring in column_rings], cap_start=True, cap_end=True)
    column_ring_count = len(column_rings)
    column_segments = len(ap_ring)

    def column_weights(i, v):
        ring_index = _ring_index(i, column_ring_count, column_segments)
        f = ring_index / (column_ring_count - 1)
        w = msh.smoothstep((f - 0.3) / 0.55)
        return msh.blend_weights({"Shell": 1.0}, {"Foot_B": 1.0}, w)

    soft_parts.append(msh.make_part("body_column", column_geometry, "soft", column_weights, closed=True))

    # head: elliptical loft along x seated in the anterior foot
    head_hw = _pchip([s[0] for s in head_stations], [s[1] for s in head_stations])
    head_cz = _pchip([s[0] for s in head_stations], [s[2] for s in head_stations])
    head_hh = _pchip([s[0] for s in head_stations], [s[3] for s in head_stations])
    head_x0, head_x1 = head_stations[0][0], head_stations[-1][0]
    head_rings = []
    head_ring_count = int(head_spec.get("rings", 12))
    for k in range(head_ring_count):
        f = k / (head_ring_count - 1)
        x = head_x0 + (head_x1 - head_x0) * (0.5 - 0.5 * math.cos(math.pi * f))
        head_rings.append(msh.superellipse_ring(x, head_hw(x), head_hh(x), head_hh(x), 0.0, head_cz(x),
                                                int(head_spec.get("segments", 16)), 2.0, 2.0))
    head_geometry = msh.loft(head_rings, cap_start=True, cap_end=True)

    def head_weights(i, v):
        t = msh.smoothstep((v[0] - head_x0) / max(head_stations[1][0] - head_x0, 1e-6))
        return msh.blend_weights({"Foot_C": 1.0}, {"Head": 1.0}, t)

    soft_parts.append(msh.make_part("head", head_geometry, "soft", head_weights, closed=True))

    # tubes: tentacles, tails, horns, siphon (left built, right mirrored for exact symmetry)
    def tube_part(name: str, points, radii, segments: int, base_bone: str, tip_bone: str | None, attach_rings: int,
                  blend_from: float = 0.08, blend_span: float = 0.30):
        geometry = msh.tube(points, radii, segments)
        ring_total = len(points)

        def weights(i, v):
            ring_index = _ring_index(i, ring_total, segments)
            t = ring_index / max(ring_total - 1, 1)
            if tip_bone is None:
                return {base_bone: 1.0}
            w = msh.smoothstep((t - blend_from) / blend_span)
            return msh.blend_weights({base_bone: 1.0}, {tip_bone: 1.0}, w)

        groups = {f"attach_{name}": _ring_group(attach_rings, segments)}
        return msh.make_part(name, geometry, "soft", weights, closed=True, groups=groups)

    tentacle_L = tube_part("tentacle_L", tentacle_pts, tentacle_radii, int(tentacle_spec.get("segments", 10)), "Head", "Tentacle_L", 2)
    tail_L = tube_part("tail_L", tail_pts, tail_radii, int(tail_spec.get("segments", 10)), "Foot_A", "Tail_L", 2)
    horn_L = tube_part("horn_L", horn_pts, horn_radii, int(horn_spec.get("segments", 8)), "Foot_C", None, 2)
    soft_parts += [tentacle_L, tentacle_L.mirror_y(rename={"_L": "_R"}), tail_L, tail_L.mirror_y(rename={"_L": "_R"}),
                   horn_L, horn_L.mirror_y(rename={"_L": "_R"})]

    siphon_segments = int(siphon_spec.get("segments", 12))
    siphon_geometry = msh.tube(siphon_pts, siphon_radii, siphon_segments)
    siphon_ring_total = len(siphon_pts)
    joint_t = joint_index / (siphon_ring_total - 1)

    def siphon_weights(i, v):
        ring_index = _ring_index(i, siphon_ring_total, siphon_segments)
        t = ring_index / (siphon_ring_total - 1)
        w = msh.smoothstep((t - (joint_t - 0.16)) / 0.32)
        return msh.blend_weights({"Siphon_A": 1.0}, {"Siphon_B": 1.0}, w)

    attach_rings = int(siphon_spec.get("attachRings", 3)) * int(siphon_spec.get("subdivisions", 3))
    soft_parts.append(msh.make_part("siphon", siphon_geometry, "soft", siphon_weights, closed=True,
                                    groups={"attach_siphon": _ring_group(attach_rings, siphon_segments)}))
    soft_obj = msh.assemble(f"{prefix}_Soft", soft_parts, material_map, rig, f"{prefix}_Armature")
    soft_obj["lod"] = 1

    # ---- eyes on the thickened tentacle bases
    eye_center = tuple(eye_spec["center"])
    eye_radius = float(eye_spec["radius"])
    eye_L = msh.make_part("eye_L", msh.ellipsoid(eye_center, (eye_radius, eye_radius, eye_radius), 12, 8), "eye",
                          lambda i, v: {"Head": 1.0}, closed=True)
    detail_obj = msh.assemble(f"{prefix}_Details", [eye_L, eye_L.mirror_y(rename={"_L": "_R"})], material_map, rig, f"{prefix}_Armature")
    detail_obj["lod"] = 1

    # ---- animation
    # Every bone keys the same transform kinds in every clip it appears in (zero-amplitude channels where
    # a kind is unused): the source gate evaluates clips back to back without resetting the pose, so a
    # kind that one clip animates and another leaves unkeyed would otherwise leak a stale value.
    anim = spec["animation"]
    clips = []

    def zero(bone: str, kind: str, env):
        return Channel(bone, kind, (0, 0, 1) if kind != "location" else (0, 1, 0), 0.0, 1.0, 0.0, envelope=env)

    def rest_channels(clip: dict, env):
        ch = []
        for sign, suffix in ((1, "L"), (-1, "R")):
            ch.append(Channel(f"Tentacle_{suffix}", "rotation", (0, 0, 1), sign * float(clip.get("tentacleYaw", 7.0)), 1.0, 0.0 if sign > 0 else 1.6, envelope=env))
            ch.append(Channel(f"Tentacle_{suffix}", "rotation", (1, 0, 0), float(clip.get("tentaclePitch", 4.0)), 1.0, 1.0 + (0.0 if sign > 0 else 0.7), envelope=env))
            ch.append(Channel(f"Tail_{suffix}", "rotation", (0, 0, 1), sign * float(clip.get("tailSway", 5.0)), 1.0, 0.4 if sign > 0 else 2.3, envelope=env))
        ch.append(Channel("Siphon_A", "rotation", (0, 0, 1), float(clip.get("siphonYaw", 4.0)), 1.0, 0.0, envelope=env))
        ch.append(Channel("Siphon_A", "rotation", (1, 0, 0), float(clip.get("siphonPitch", 2.5)), 1.0, 1.2, envelope=env))
        ch.append(Channel("Siphon_B", "rotation", (1, 0, 0), float(clip.get("siphonPitch", 2.5)) * 1.2, 1.0, 2.0, envelope=env))
        ch.append(zero("Siphon_B", "location", env))
        pulse = float(clip.get("footPulse", 0.03))
        for index, bone in enumerate(FOOT_BONES):
            ch.append(Channel(bone, "scale", (0, 0, 1), pulse, 2.0, -index * math.tau / 3, envelope=env))
            ch.append(zero(bone, "location", env))
        ch.append(zero("Foot_C", "rotation", env))
        ch.append(Channel("Shell", "rotation", (1, 0, 0), float(clip.get("shellRock", 0.6)), 1.0, 0.5, envelope=env))
        ch.append(Channel("Head", "rotation", (1, 0, 0), float(clip.get("headNod", 2.0)), 1.0, 0.8, envelope=env))
        return ch

    def crawl_channels(clip: dict, env):
        ch = []
        freq = float(clip.get("pedalFrequency", 2))
        stride = float(clip.get("pedalStride", 0.00022))
        lift = float(clip.get("pedalLift", 0.05))
        # three-phase wave: the summed offsets vanish so the head does not surge while each segment ripples
        for index, bone in enumerate(FOOT_BONES):
            phase = -(2 - index) * math.tau / 3
            ch.append(Channel(bone, "location", (0, 1, 0), stride, freq, phase, envelope=env))
            ch.append(Channel(bone, "scale", (0, 0, 1), lift, freq, phase + math.pi / 2, envelope=env))
        ch.append(zero("Foot_C", "rotation", env))
        ch.append(zero("Siphon_B", "location", env))
        for sign, suffix in ((1, "L"), (-1, "R")):
            ch.append(Channel(f"Tentacle_{suffix}", "rotation", (0, 0, 1), sign * float(clip.get("tentacleYaw", 9.0)), 1.0, 0.0 if sign > 0 else math.pi, envelope=env))
            ch.append(Channel(f"Tentacle_{suffix}", "rotation", (1, 0, 0), float(clip.get("tentaclePitch", 4.0)), 2.0, 0.9, envelope=env))
            ch.append(Channel(f"Tail_{suffix}", "rotation", (0, 0, 1), sign * float(clip.get("tailSway", 6.0)), 1.0, 0.0 if sign > 0 else math.pi, envelope=env))
        ch.append(Channel("Siphon_A", "rotation", (0, 0, 1), float(clip.get("siphonYaw", 6.0)), 1.0, 0.3, envelope=env))
        ch.append(Channel("Siphon_A", "rotation", (1, 0, 0), float(clip.get("siphonPitch", 3.0)), 2.0, 0.0, envelope=env))
        ch.append(Channel("Siphon_B", "rotation", (1, 0, 0), float(clip.get("siphonPitch", 3.0)) * 1.3, 2.0, 1.0, envelope=env))
        ch.append(Channel("Shell", "rotation", (1, 0, 0), float(clip.get("shellRock", 1.5)), freq, 0.6, envelope=env))
        ch.append(Channel("Shell", "rotation", (0, 0, 1), float(clip.get("shellYaw", 1.0)), 1.0, 0.0, envelope=env))
        ch.append(Channel("Head", "rotation", (1, 0, 0), float(clip.get("headNod", 3.0)), freq, 1.2, envelope=env))
        return ch

    def probe_channels(clip: dict, env):
        ch = []
        sweep_freq = float(clip.get("siphonSweepFrequency", 1.5))
        ch.append(Channel("Siphon_A", "rotation", (1, 0, 0), float(clip.get("siphonRaise", 18.0)), 1.0, 0.0, "const", envelope=env))
        ch.append(Channel("Siphon_A", "rotation", (0, 0, 1), float(clip.get("siphonSweep", 20.0)), sweep_freq, 0.0, envelope=env))
        ch.append(Channel("Siphon_B", "rotation", (1, 0, 0), float(clip.get("siphonCurl", 8.0)), 1.0, 0.0, "const", envelope=env))
        ch.append(Channel("Siphon_B", "rotation", (0, 0, 1), float(clip.get("siphonSweep", 20.0)) * 0.6, sweep_freq, 0.8, envelope=env))
        ch.append(Channel("Siphon_B", "location", (0, 1, 0), float(clip.get("siphonExtend", 0.0018)), 1.0, 0.0, "const", envelope=env))
        ch.append(Channel("Foot_C", "rotation", (1, 0, 0), float(clip.get("footLift", 6.0)), 1.0, 0.0, "const", envelope=env))
        ch.append(zero("Foot_C", "location", env))
        ch.append(zero("Foot_C", "scale", env))
        # the rest of the foot shifts its grip while the front lifts
        for index, bone in enumerate(FOOT_BONES[:2]):
            ch.append(Channel(bone, "scale", (0, 0, 1), float(clip.get("footShift", 0.02)), 1.0, -index * 1.2, envelope=env))
            ch.append(zero(bone, "location", env))
        ch.append(Channel("Head", "rotation", (1, 0, 0), float(clip.get("headRaise", 5.0)), 1.0, 0.0, "const", envelope=env))
        ch.append(Channel("Head", "rotation", (0, 0, 1), float(clip.get("headTurn", 4.0)), 1.0, 0.0, envelope=env))
        for sign, suffix in ((1, "L"), (-1, "R")):
            ch.append(Channel(f"Tentacle_{suffix}", "rotation", (0, 0, 1), sign * float(clip.get("tentacleSpread", 10.0)), 1.0, 0.0, "const", envelope=env))
            ch.append(Channel(f"Tentacle_{suffix}", "rotation", (1, 0, 0), float(clip.get("tentacleSway", 5.0)), 2.0, 0.0 if sign > 0 else 1.2, envelope=env))
        ch.append(Channel("Shell", "rotation", (1, 0, 0), float(clip.get("shellTip", -1.5)), 1.0, 0.0, "const", envelope=env))
        return ch

    builders = {spec["clipRoles"]["idle"]: rest_channels, spec["clipRoles"]["locomotion"]: crawl_channels,
                spec["clipRoles"]["response"]: probe_channels}
    for clip_name, clip in anim.items():
        env = None if clip["loop"] else clip.get("envelope", "hold")
        channels = builders[clip_name](clip, env)
        clips.append(ClipSpec(clip_name, int(clip["frames"]), bool(clip["loop"]), channels))
    for clip in clips:
        bake_clip(rig, clip)

    # ---- contract
    meshes = [shell_obj, soft_obj, detail_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="x")
    contract["closedParts"] += [
        {"object": shell_obj.name, "group": "part_shell", "volumeFloor": 0.9},
        {"object": soft_obj.name, "group": "part_foot", "volumeFloor": 0.6},
        {"object": soft_obj.name, "group": "part_head", "volumeFloor": 0.6},
        {"object": soft_obj.name, "group": "part_siphon", "volumeFloor": 0.6},
        {"object": soft_obj.name, "group": "part_tentacle_L", "volumeFloor": 0.6},
        {"object": soft_obj.name, "group": "part_tentacle_R", "volumeFloor": 0.6},
        {"object": soft_obj.name, "group": "part_tail_L", "volumeFloor": 0.6},
        {"object": soft_obj.name, "group": "part_tail_R", "volumeFloor": 0.6},
    ]
    soft = soft_obj.name
    shell_name = shell_obj.name
    contract["clearance"] += [
        {"a": [soft, "part_tentacle_L", "attach_tentacle_L"], "b": [soft, "part_foot"], "label": "tentacle_L_foot"},
        {"a": [soft, "part_tentacle_R", "attach_tentacle_R"], "b": [soft, "part_foot"], "label": "tentacle_R_foot"},
        {"a": [soft, "part_tentacle_L", "attach_tentacle_L"], "b": [soft, "part_tentacle_R", "attach_tentacle_R"], "label": "tentacle_L_R"},
        {"a": [soft, "part_tentacle_L", "attach_tentacle_L"], "b": [soft, "part_siphon"], "minDistance": 0.0004, "label": "tentacle_L_siphon"},
        {"a": [soft, "part_tentacle_R", "attach_tentacle_R"], "b": [soft, "part_siphon"], "minDistance": 0.0004, "label": "tentacle_R_siphon"},
        {"a": [soft, "part_tentacle_L", "attach_tentacle_L"], "b": [soft, "part_horn_L"], "label": "tentacle_L_horn"},
        {"a": [soft, "part_tentacle_R", "attach_tentacle_R"], "b": [soft, "part_horn_R"], "label": "tentacle_R_horn"},
        {"a": [soft, "part_head"], "b": [soft, "part_siphon"], "minDistance": 0.0003, "label": "head_siphon"},
        {"a": [shell_name, "part_shell"], "b": [soft, "part_siphon", "attach_siphon"], "label": "shell_siphon"},
        {"a": [shell_name, "part_shell"], "b": [soft, "part_head"], "minDistance": 0.0004, "label": "shell_head"},
        {"a": [shell_name, "part_shell"], "b": [soft, "part_tentacle_L", "attach_tentacle_L"], "label": "shell_tentacle_L"},
        {"a": [shell_name, "part_shell"], "b": [soft, "part_tentacle_R", "attach_tentacle_R"], "label": "shell_tentacle_R"},
        {"a": [shell_name, "part_shell"], "b": [soft, "part_tail_L", "attach_tail_L"], "label": "shell_tail_L"},
        {"a": [shell_name, "part_shell"], "b": [soft, "part_tail_R", "attach_tail_R"], "label": "shell_tail_R"},
        {"a": [soft, "part_tail_L", "attach_tail_L"], "b": [soft, "part_tail_R", "attach_tail_R"], "label": "tail_L_R"},
    ]
    # codebase convention (fish plan): "_L" parts live at y < 0 (side -1), "_R" at y > 0 (side +1)
    contract["centerPlane"] += [
        {"object": soft, "group": "part_tentacle_L", "exclude": "attach_tentacle_L", "side": -1},
        {"object": soft, "group": "part_tentacle_R", "exclude": "attach_tentacle_R", "side": 1},
        {"object": soft, "group": "part_tail_L", "exclude": "attach_tail_L", "side": -1},
        {"object": soft, "group": "part_tail_R", "exclude": "attach_tail_R", "side": 1},
        {"object": soft, "group": "part_horn_L", "exclude": "attach_horn_L", "side": -1},
        {"object": soft, "group": "part_horn_R", "exclude": "attach_horn_R", "side": 1},
        {"object": detail_obj.name, "group": "part_eye_L", "exclude": None, "side": -1},
        {"object": detail_obj.name, "group": "part_eye_R", "exclude": None, "side": 1},
    ]
    contract["symmetry"] = [
        {"object": soft, "left": "part_tentacle_L", "right": "part_tentacle_R", "tolerance": 1e-6},
        {"object": soft, "left": "part_tail_L", "right": "part_tail_R", "tolerance": 1e-6},
        {"object": soft, "left": "part_horn_L", "right": "part_horn_R", "tolerance": 1e-6},
        {"object": detail_obj.name, "left": "part_eye_L", "right": "part_eye_R", "tolerance": 1e-6},
    ]
    register_clips(contract, clips)

    shell_low = [min(p[i] for ring in shell_rings for p in ring) for i in range(3)]
    shell_high = [max(p[i] for ring in shell_rings for p in ring) for i in range(3)]
    notes = {
        "shellLengthMeters": float(shell_spec["lengthMeters"]),
        "shellRings": len(shell_rings),
        "shellBounds": {"min": [round(v, 5) for v in shell_low], "max": [round(v, 5) for v in shell_high]},
        "apex": [round(v, 5) for v in apex],
        "apertureCenter": [round(v, 5) for v in ap_center],
        "apertureSemiAxes": {"radial": round(anchors["apertureRadial"], 5), "axial": round(anchors["apertureAxial"], 5)},
        "softParts": [part.name for part in soft_parts],
    }
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
