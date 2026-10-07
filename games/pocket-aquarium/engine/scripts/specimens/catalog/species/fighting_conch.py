"""Fighting conch, Strombus sp. (Florida fighting conch S. alatus / West Indian S. pugilis).

Species-local gastropod body plan (`bodyPlan: "gastropod_strombid"`): there is no shared plan for
gastropods, so `build(spec, species, ctx)` lives here. All dimensions come from asset.source.json
(meters, forward +X, up +Z, `base_center` origin: the animal rests on z = 0, soft-body midline y = 0).

Anatomy choices
- Shell: a dextral conispiral built as ONE closed loft. Each ring is a quadrant-wise superellipse
  generating curve in the meridional plane; the whorl radial semi-axis, the centre offset from the
  coiling axis and the axial drop all grow as W**t (t in whorls), which makes the spire a straight cone
  (spire angle from `expansion` and `dropRatio`) with a shallow shoulder ramp. Successive whorls overlap
  inside the shell exactly as in a real shell. The last whorls add a row of blunt shoulder knobs
  (periodic radial displacement at the shoulder angle), the body whorl elongates anteriorly into a short
  siphonal canal, and the last part-whorl flares into a thickened outer lip with a posterior wing and the
  stromboid notch; three in-plane rings then fold the lip inwards to a recessed aperture floor.
- Orientation: aperture down, apex back and slightly raised, outer lip on the animal's right (-Y), the
  aperture plane rolled so the lip edge rests near the substrate the way a crawling strombid carries it.
- Soft body: narrow flattened foot on z = 0, head at the canal mouth, two long eyestalks with big
  target-patterned eyes plus the small sensory filament strombids carry on each stalk, a proboscis
  reaching the substrate, a short siphon in the canal and a sickle-shaped operculum on the metapodium.
- Rig (10 deform bones): Root > Shell > (Siphon, Foot_C > Head > (Proboscis, Eyestalk_L, Eyestalk_R));
  Root > Foot_B > Foot_A > Operculum. Chain bones point +X so bone-local Y is world forward. The anterior
  foot and head ride with the shell (as the columellar muscle dictates) while the mid and posterior foot
  hang off Root, so a hop lifts and pitches the shell and head and stretches the foot from the planted operculum.
- Clips: `rest` (eyestalk scanning, proboscis probing, foot pulse), `hop` (the strombid leap: a
  harmonic-sawtooth forward lurch of the shell with lift and pitch while the operculum stays planted and
  the foot stretches), `withdraw` (eyestalks, proboscis, siphon and foot pull into the aperture, hold envelope).
- Textures are project-authored numpy paint only: shell albedo (orange-brown mottling, cream flammules
  on the ramp, spiral bands, glossy salmon lip, dark aperture), roughness and a relief normal map
  (growth striae, anterior spiral cords, knob relief); one atlas for the soft parts (foot, head,
  proboscis, eyestalk, siphon, operculum, eye).
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

SHELL_U_SPIRAL = 0.90  # u range of the spiral surface; the lip and aperture floor use the remainder


# ---------------------------------------------------------------- scalar helpers

def _sm(edge0: float, edge1: float, x: float) -> float:
    t = (x - edge0) / (edge1 - edge0)
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return t * t * (3.0 - 2.0 * t)


def _gauss(x, center, width):
    d = (x - center) / width
    return np.exp(-d * d) if isinstance(x, np.ndarray) else math.exp(-d * d)


def _unit(v) -> Vector:
    v = Vector(v)
    return v.normalized()


# ---------------------------------------------------------------- shell coil

class Coil:
    """Conispiral generating-curve model of the shell (shell-local coordinates: axis +z', apex up)."""

    def __init__(self, shell: dict):
        self.N = float(shell["whorls"])
        self.W = float(shell["expansion"])
        self.a_end = float(shell["finalRadialSemiAxis"])
        self.offset_ratio = float(shell["centerOffsetRatio"])
        self.drop_ratio = float(shell["dropRatio"])
        self.b_up_ratio = float(shell["upperSemiAxisRatio"])
        self.b_down_spire = float(shell["lowerSemiAxisRatioSpire"])
        self.b_down_body = float(shell["lowerSemiAxisRatioBody"])
        self.exponents = shell["quadrantExponents"]
        self.knobs = shell["knobs"]
        self.canal = shell["canal"]
        self.lip = shell["lip"]

    def scale(self, t: float) -> float:
        return self.W ** (t - self.N)

    def a(self, t: float) -> float:
        return self.a_end * self.scale(t)

    def rc(self, t: float) -> float:
        return self.offset_ratio * self.a(t)

    def zc(self, t: float) -> float:
        return -self.drop_ratio * self.a_end * self.scale(t)

    def b_down(self, t: float) -> float:
        f = _sm(self.N - 1.0, self.N, t)
        return self.a(t) * (self.b_down_spire + (self.b_down_body - self.b_down_spire) * f)

    def knob(self, t, phi_deg):
        """Knob strength in [0, 1] (works on scalars and numpy arrays)."""
        k = self.knobs
        N = self.N
        if isinstance(t, np.ndarray):
            gate = self._sm_np(N - k["startWhorlsBeforeEnd"], N - k["startWhorlsBeforeEnd"] + 0.8, t)
            gate = gate * (1.0 - self._sm_np(N - k["fadeWhorlsBeforeLip"], N - k["fadeWhorlsBeforeLip"] * 0.35, t))
            angular = np.maximum(0.0, np.cos(math.tau * k["perWhorl"] * t + k["phase"])) ** k["sharpness"]
        else:
            gate = _sm(N - k["startWhorlsBeforeEnd"], N - k["startWhorlsBeforeEnd"] + 0.8, t)
            gate *= 1.0 - _sm(N - k["fadeWhorlsBeforeLip"], N - k["fadeWhorlsBeforeLip"] * 0.35, t)
            angular = max(0.0, math.cos(math.tau * k["perWhorl"] * t + k["phase"])) ** k["sharpness"]
        shoulder = _gauss(phi_deg, k["shoulderDegrees"], k["widthDegrees"])
        return gate * angular * shoulder

    @staticmethod
    def _sm_np(edge0, edge1, x):
        return noise.smoothstep(edge0, edge1, x)

    def profile(self, t: float, phi_deg: float) -> tuple[float, float]:
        """Offset (rho, zeta) of the generating curve point from the ring centre in the meridional plane."""
        phi = math.radians(phi_deg)
        c, s = math.cos(phi), math.sin(phi)
        a = self.a(t)
        b = self.b_up_ratio * a if s >= 0 else self.b_down(t)
        if c >= 0:
            e = self.exponents["outerUpper"] if s >= 0 else self.exponents["outerLower"]
        else:
            e = self.exponents["innerUpper"] if s >= 0 else self.exponents["innerLower"]
        rho = math.copysign(abs(c) ** (2.0 / e), c) * a
        zeta = math.copysign(abs(s) ** (2.0 / e), s) * b
        k = self.knob(t, phi_deg) * self.knobs["amplitude"]
        if k > 1e-9:
            # blunt knobs point outward and slightly up from the shoulder corner
            lift = math.radians(self.knobs["liftDegrees"])
            rho += math.cos(lift) * k * a
            zeta += math.sin(lift) * k * a
        canal = self.canal
        canal_gate = _sm(self.N - canal["startWhorlsBeforeEnd"], self.N, t)
        zeta -= canal["length"] * canal_gate * _gauss(phi_deg, -90.0, canal["widthDegrees"])
        rho *= 1.0 - canal["pinch"] * canal_gate * _gauss(phi_deg, -90.0, canal["widthDegrees"] * 1.6)
        lip = self.lip
        flare = _sm(self.N - lip["flareWhorls"], self.N, t) ** 1.2
        rho += flare * a * lip["flare"] * max(0.0, c) ** 0.8
        zeta += flare * a * lip["wing"] * _gauss(phi_deg, lip["wingDegrees"], lip["wingWidthDegrees"])
        notch = _sm(self.N - lip["notchWhorls"], self.N, t)
        rho -= notch * a * lip["notchDepth"] * _gauss(phi_deg, lip["notchDegrees"], lip["notchWidthDegrees"])
        return rho, zeta

    def u_of_t(self, t: float) -> float:
        return SHELL_U_SPIRAL * (self.W ** t - 1.0) / (self.W ** self.N - 1.0)

    def t_of_u(self, u):
        u = np.clip(np.asarray(u, dtype=np.float64) / SHELL_U_SPIRAL, 0.0, 1.0)
        return np.log(1.0 + u * (self.W ** self.N - 1.0)) / math.log(self.W)


def phi_table(segments: int, outer_share: float) -> list[float]:
    """Ring angles in degrees (-180 .. 180) with denser sampling on the exposed outer half."""
    n_outer = int(round(segments * outer_share))
    n_inner = segments - n_outer
    n_low = n_inner // 2
    n_up = n_inner - n_low
    phis = [-180.0 + 90.0 * k / n_low for k in range(n_low)]
    phis += [-90.0 + 180.0 * k / n_outer for k in range(n_outer)]
    phis += [90.0 + 90.0 * k / n_up for k in range(n_up)]
    return phis


def ring_parameters(coil: Coil, sampling: dict) -> list[float]:
    N = coil.N
    base = float(sampling["ringsPerWhorlApex"])
    peak = float(sampling["ringsPerWhorlBody"])
    ramp_start = N - float(sampling["densityRampWhorls"])
    ramp_end = N - float(sampling["densityPlateauWhorls"])
    ts = [0.0]
    t = 0.0
    while True:
        rpw = base + (peak - base) * _sm(ramp_start, ramp_end, t)
        t += 1.0 / rpw
        if t >= N - 1e-9:
            break
        ts.append(t)
    ts.append(N)
    return ts


def shell_orientation(shell: dict) -> Matrix:
    """Shell-local (x' lip side, y' dorsum, z' apex) -> world (forward +X, up +Z, lip on -Y)."""
    base = Matrix(((0.0, 0.0, -1.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0)))
    pitch = Matrix.Rotation(math.radians(float(shell["pitchDegrees"])), 3, "Y")
    roll = Matrix.Rotation(math.radians(float(shell["rollDegrees"])), 3, "X")
    return roll @ pitch @ base


def build_shell(coil: Coil, shell: dict):
    """Return (loft geometry in local coords, u_values, aperture ring index, ring count, phis)."""
    sampling = shell["sampling"]
    phis = phi_table(int(sampling["ringSegments"]), float(sampling["outerShare"]))
    ts = ring_parameters(coil, sampling)
    rings = []
    u_values = []
    for t in ts:
        theta = -math.tau * t
        ct, st = math.cos(theta), math.sin(theta)
        ring = []
        for phi in phis:
            rho, zeta = coil.profile(t, phi)
            radial = coil.rc(t) + rho
            ring.append((radial * ct, radial * st, coil.zc(t) + zeta))
        rings.append(ring)
        u_values.append(coil.u_of_t(t))
    aperture_index = len(rings) - 1
    # lip fold: three rings in the aperture plane (y' = 0 is the plane, -y' points out of the aperture)
    N = coil.N
    final2d = []
    for phi in phis:
        rho, zeta = coil.profile(N, phi)
        final2d.append((coil.rc(N) + rho, coil.zc(N) + zeta))
    cx = sum(p[0] for p in final2d) / len(final2d)
    cz = sum(p[1] for p in final2d) / len(final2d)
    thickness = float(coil.lip["thickness"])
    recess = float(coil.lip["recess"])
    for shrink, y_off, u in ((0.45 * thickness, -0.75 * thickness, 0.925), (1.15 * thickness, 0.10 * thickness, 0.95),
                             (1.6 * thickness, recess, 0.975)):
        ring = []
        for r, z in final2d:
            dx, dz = r - cx, z - cz
            dist = math.hypot(dx, dz)
            f = max(0.0, 1.0 - shrink / dist)
            ring.append((cx + dx * f, y_off, cz + dz * f))
        rings.append(ring)
        u_values.append(u)
    geometry = msh.loft(rings, u_values=u_values, cap_start=True, cap_end=True)
    return geometry, u_values, aperture_index, len(phis), phis


# ---------------------------------------------------------------- textures

def paint_shell(coil: Coil, phis: list[float], palette: dict, width: int, height: int):
    U, V = textures.uv_grid(width, height)
    T = coil.t_of_u(U)
    v_nodes = np.array([k / len(phis) for k in range(len(phis))] + [1.0])
    phi_nodes = np.array(phis + [phis[0] + 360.0])
    PHI = np.interp(V, v_nodes, phi_nodes)
    PHI = np.where(PHI > 180.0, PHI - 360.0, PHI)
    N = coil.N
    spiral = 1.0 - noise.smoothstep(SHELL_U_SPIRAL - 0.004, SHELL_U_SPIRAL + 0.004, U)
    lip_mask = noise.smoothstep(SHELL_U_SPIRAL - 0.004, SHELL_U_SPIRAL + 0.004, U) * (1.0 - noise.smoothstep(0.955, 0.965, U))
    floor_mask = noise.smoothstep(0.955, 0.965, U)

    base = textures.rgba(palette["shellBase"], 1.0, U.shape)
    mottle = noise.fbm(T * 9.0, PHI / 28.0, octaves=4, seed=21)
    albedo = textures.mix(base, palette["shellDark"], noise.smoothstep(0.48, 0.78, mottle) * 0.7)
    albedo = textures.mix(albedo, palette["shellLight"], noise.smoothstep(0.45, 0.22, mottle) * 0.38)
    # irregular axial flammules (cream and dark streaks running across the whorl), strongest on the ramp
    ramp_zone = 0.4 + 0.6 * noise.smoothstep(-20.0, 5.0, PHI) * (1.0 - noise.smoothstep(110.0, 140.0, PHI))
    later = noise.smoothstep(N - 5.0, N - 3.5, T)
    streak_field = noise.fbm(U / SHELL_U_SPIRAL * 110.0, PHI / 90.0, octaves=3, seed=5)
    flammule = noise.smoothstep(0.56, 0.70, streak_field) * ramp_zone * later
    albedo = textures.mix(albedo, palette["shellCream"], flammule * 0.42)
    dark_field = noise.fbm(U / SHELL_U_SPIRAL * 90.0 + 7.0, PHI / 110.0, octaves=3, seed=13)
    dark_streak = noise.smoothstep(0.60, 0.74, dark_field) * ramp_zone * later
    albedo = textures.mix(albedo, palette["shellDark"], dark_streak * 0.45)
    # spiral bands below the shoulder on the flank
    band_a = paint.band(PHI, -24.0, 6.0, 5.0) * 0.4
    band_b = paint.band(PHI, -47.0, 5.0, 5.0) * 0.35
    band_c = paint.band(PHI, -68.0, 4.0, 4.0) * 0.3
    albedo = textures.mix(albedo, palette["shellDark"], np.clip(band_a + band_b + band_c, 0.0, 1.0) * (0.45 + 0.55 * mottle))
    knob = coil.knob(T, PHI)
    albedo = textures.mix(albedo, palette["shellCream"], noise.smoothstep(0.3, 0.9, knob) * 0.55)
    # eroded pale apex
    apex = 1.0 - noise.smoothstep(N - 4.0, N - 2.2, T)
    albedo = textures.mix(albedo, palette["shellApex"], apex * 0.8)
    # glossy lip and dark aperture floor
    lip_gradient = noise.smoothstep(SHELL_U_SPIRAL, 0.955, U)
    lip_color = textures.mix(textures.rgba(palette["lipInner"], 1.0, U.shape), palette["lipEdge"], 1.0 - lip_gradient)
    albedo = albedo * (1.0 - lip_mask[..., None]) + lip_color * lip_mask[..., None]
    albedo = textures.mix(albedo, palette["apertureFloor"], floor_mask)
    albedo[..., 3] = 1.0

    growth = paint.shell_growth_lines(U / SHELL_U_SPIRAL, V, count=170.0, strength=0.35, seed=4)
    cords_zone = noise.smoothstep(-92.0, -82.0, PHI) * (1.0 - noise.smoothstep(-30.0, -12.0, PHI)) * noise.smoothstep(N - 1.6, N - 0.9, T)
    cords = (0.5 + 0.5 * np.sin(PHI * math.tau / 6.5)) * cords_zone
    fine = noise.fbm(U * 160.0, V * 60.0, octaves=2, seed=9)
    height = 0.5 + 0.10 * (growth - 0.5) * spiral + 0.14 * (cords - 0.5) + 0.25 * knob + 0.05 * (fine - 0.5) + 0.05 * (mottle - 0.5)
    height = np.clip(height, 0.0, 1.0)
    roughness = 0.5 + 0.08 * (growth - 0.5) + 0.12 * (mottle - 0.5)
    roughness = roughness * (1.0 - lip_mask) + 0.14 * lip_mask
    roughness = roughness * (1.0 - floor_mask) + 0.22 * floor_mask
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 1.25)}


SOFT_TILES = {"foot": 0, "head": 1, "proboscis": 2, "eyestalk": 3, "siphon": 4, "operculum": 5, "eye": 6, "filament": 7}


def tile_transform(index: int, columns: int = 4, rows: int = 2):
    col = index % columns
    row = index // columns

    def transform(u, v):
        return ((col + 0.02 + u * 0.96) / columns, (row + 0.02 + v * 0.96) / rows)

    return transform


def paint_soft_atlas(palette: dict, width: int, height: int):
    columns, rows = 4, 2
    tile_w, tile_h = width // columns, height // rows
    albedo = np.zeros((height, width, 4), dtype=np.float64)
    roughness = np.full((height, width), 0.5, dtype=np.float64)
    relief = np.full((height, width), 0.5, dtype=np.float64)
    U, V = textures.uv_grid(tile_w, tile_h)
    dark = palette["soft"]
    speck_color = palette["softSpeckle"]
    for name, index in SOFT_TILES.items():
        speckle = paint.spots(U, V, density=26.0, radius=0.22, seed=30 + index, jitter_radius=0.5)
        grain = noise.fbm(U * 18.0, V * 18.0, octaves=3, seed=60 + index)
        if name in ("foot", "head"):
            tile = textures.rgba(dark, 1.0, U.shape)
            tile = textures.scale_rgb(tile, 0.85 + 0.3 * grain)
            tile = textures.mix(tile, speck_color, speckle * 0.75)
            if name == "foot":
                sole = paint.band(V, 0.5, 0.17, 0.07)
                tile = textures.mix(tile, palette["sole"], sole * 0.85)
            rough = 0.48 + 0.12 * (grain - 0.5)
            h = 0.5 + 0.12 * (grain - 0.5) + 0.1 * speckle
        elif name == "proboscis":
            tile = textures.rgba(dark, 1.0, U.shape)
            tile = textures.scale_rgb(tile, 0.85 + 0.3 * grain)
            tile = textures.mix(tile, speck_color, speckle * 0.5)
            tile = textures.mix(tile, palette["proboscisTip"], noise.smoothstep(0.78, 0.97, U))
            rings = 0.5 + 0.5 * np.sin(U * math.tau * 14.0)
            rough = 0.45 + 0.1 * (grain - 0.5)
            h = 0.5 + 0.1 * (rings - 0.5) + 0.08 * (grain - 0.5)
        elif name == "eyestalk":
            tile = textures.rgba(palette["eyestalk"], 1.0, U.shape)
            tile = textures.scale_rgb(tile, 0.88 + 0.24 * grain)
            tile = textures.mix(tile, dark, speckle * 0.6)
            rough = 0.42 + 0.1 * (grain - 0.5)
            h = 0.5 + 0.08 * (grain - 0.5)
        elif name == "filament":
            tile = textures.rgba(palette["eyestalk"], 1.0, U.shape)
            tile = textures.mix(tile, dark, noise.smoothstep(0.7, 1.0, U) * 0.5)
            rough = np.full(U.shape, 0.45)
            h = np.full(U.shape, 0.5)
        elif name == "siphon":
            tile = textures.rgba(dark, 1.0, U.shape)
            tile = textures.mix(tile, palette["siphonTip"], noise.smoothstep(0.7, 0.95, U))
            tile = textures.mix(tile, speck_color, speckle * 0.4)
            rough = 0.45 + 0.1 * (grain - 0.5)
            h = 0.5 + 0.08 * (grain - 0.5)
        elif name == "operculum":
            tile = textures.rgba(palette["operculum"], 1.0, U.shape)
            striae = 0.5 + 0.5 * np.sin(U * math.tau * 26.0 + (grain - 0.5) * 3.0)
            tile = textures.scale_rgb(tile, 0.8 + 0.35 * striae)
            tile = textures.mix(tile, palette["operculumEdge"], noise.smoothstep(0.82, 1.0, U) * 0.7)
            rough = 0.30 + 0.12 * (striae - 0.5)
            h = 0.5 + 0.2 * (striae - 0.5)
        else:  # eye: pupil at the outer pole (u = 0), golden iris, dark ring, pale speckled sclera
            tile = textures.rgba(palette["sclera"], 1.0, U.shape)
            tile = textures.mix(tile, dark, speckle * 0.35 * noise.smoothstep(0.42, 0.55, U))
            dark_ring = noise.smoothstep(0.29, 0.315, U) * (1.0 - noise.smoothstep(0.40, 0.43, U))
            tile = textures.mix(tile, palette["irisDark"], dark_ring)
            tile = textures.mix(tile, palette["iris"], 1.0 - noise.smoothstep(0.29, 0.315, U))
            tile = textures.mix(tile, palette["irisDark"], (1.0 - noise.smoothstep(0.17, 0.19, U)) * 0.35)
            tile = textures.mix(tile, palette["pupil"], 1.0 - noise.smoothstep(0.13, 0.155, U))
            rough = 0.12 + 0.25 * noise.smoothstep(0.42, 0.6, U)
            h = np.full(U.shape, 0.5)
        col, row = index % columns, index // columns
        window = (slice(row * tile_h, (row + 1) * tile_h), slice(col * tile_w, (col + 1) * tile_w))
        albedo[window] = tile
        roughness[window] = rough
        relief[window] = h
    albedo[..., 3] = 1.0
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(relief, 1.0)}


# ---------------------------------------------------------------- soft-part geometry helpers

def tube_weights(count: int, segments: int, blend_fn):
    """Weight function for `msh.tube` output: rings first (ring-major), then start and end cap centres."""
    def weights(index, _vertex):
        if index < count * segments:
            ring = index // segments
        else:
            ring = 0 if index == count * segments else count - 1
        return blend_fn(ring / max(count - 1, 1))
    return weights


def tube_attach(count: int, segments: int, rings: int) -> set[int]:
    members = set(range(rings * segments))
    members.add(count * segments)  # start cap centre
    return members


def bezier(p0, p1, p2, p3, n: int):
    out = []
    for k in range(n):
        s = k / (n - 1)
        a = (1 - s) ** 3
        b = 3 * (1 - s) ** 2 * s
        c = 3 * (1 - s) * s * s
        d = s ** 3
        out.append(tuple(a * p0[i] + b * p1[i] + c * p2[i] + d * p3[i] for i in range(3)))
    return out


def min_vertex_distance(a: list, b: list) -> float:
    if not a or not b:
        return 1.0
    pa = np.array(a, dtype=np.float64)
    pb = np.array(b, dtype=np.float64)
    best = 1.0
    for start in range(0, len(pa), 512):
        chunk = pa[start:start + 512]
        d = np.sqrt(((chunk[:, None, :] - pb[None, :, :]) ** 2).sum(axis=-1))
        best = min(best, float(d.min()))
    return best


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    shell_spec = spec["shell"]
    soft = spec["softBody"]
    palette = spec["palette"]
    tex = spec.get("textures", {})
    coil = Coil(shell_spec)

    # ---- shell geometry (local -> world)
    geometry, u_values, aperture_index, segments, phis = build_shell(coil, shell_spec)
    vertices, faces, uvs, face_uvs = geometry
    orient = shell_orientation(shell_spec)
    world = [orient @ Vector(v) for v in vertices]
    aperture = world[aperture_index * segments:(aperture_index + 1) * segments]
    min_z = min(v.z for v in world)
    min_x = min(v.x for v in world)
    max_x = max(v.x for v in world)
    ap_center = sum(aperture, Vector()) / len(aperture)
    shift = Vector((-(min_x + max_x) / 2.0 + float(shell_spec["centerX"]),
                    float(shell_spec["apertureCenterY"]) - ap_center.y,
                    float(shell_spec["restClearance"]) - min_z))
    world = [v + shift for v in world]
    aperture = [v + shift for v in aperture]
    ap_center = ap_center + shift
    canal_tip = max(aperture, key=lambda v: v.x)
    ap_posterior = min(aperture, key=lambda v: v.x)
    x_ct = canal_tip.x
    shell_geometry = ([tuple(v) for v in world], faces, uvs, face_uvs)
    shell_vertices = [tuple(v) for v in world]

    # ---- soft body layout (all relative to the aperture anchors)
    foot = soft["foot"]
    x_f0 = ap_posterior.x + float(foot["posteriorInset"])
    x_f1 = x_ct - float(foot["anteriorInset"])
    foot_len = x_f1 - x_f0
    foot_h = float(foot["height"])
    foot_hw = float(foot["halfWidth"])
    sole_lift = float(foot["soleThickness"])
    head = soft["head"]
    head_r = float(head["radius"])
    x_hf = x_ct - float(head["frontInset"])
    head_path = bezier((x_hf - float(head["length"]), 0.0, sole_lift + foot_h * 0.45),
                       (x_hf - float(head["length"]) * 0.55, 0.0, sole_lift + foot_h * 0.75),
                       (x_hf - float(head["length"]) * 0.2, 0.0, float(head["frontHeight"]) + head_r * 0.15),
                       (x_hf, 0.0, float(head["frontHeight"])), 7)
    head_radii = [head_r * f for f in (0.72, 0.9, 1.0, 1.0, 0.93, 0.72, 0.36)]
    head_front = Vector(head_path[-1])
    head_mid = Vector(head_path[3])
    prob = soft["proboscis"]
    prob_base = Vector((head_front.x - float(prob["baseSetback"]), 0.0, head_front.z - head_r * 0.45))
    prob_tip = Vector((x_ct + float(prob["tipAhead"]), 0.0, float(prob["tipHeight"])))
    prob_ctrl = prob_base + (prob_tip - prob_base) * 0.5 + Vector((0.0, 0.0, -0.0015))
    prob_path = bezier(tuple(prob_base), tuple(prob_base + Vector((0.004, 0.0, -0.001))), tuple(prob_ctrl), tuple(prob_tip), 7)
    prob_r = float(prob["radius"])
    prob_radii = [prob_r * f for f in (1.0, 1.0, 0.94, 0.86, 0.78, 0.66, 0.42)]
    stalk = soft["eyestalk"]
    stalk_base = Vector((head_mid.x + float(stalk["baseForward"]), -head_r * float(stalk["baseSideFraction"]),
                         head_mid.z + head_r * float(stalk["baseUpFraction"])))
    stalk_dir = _unit(stalk["direction"])
    stalk_dir = Vector((stalk_dir.x, -abs(stalk_dir.y), stalk_dir.z))
    stalk_len = float(stalk["length"])
    stalk_tip = stalk_base + stalk_dir * stalk_len
    bow = Vector((0.0, 0.0, float(stalk["bow"])))
    stalk_path = bezier(tuple(stalk_base), tuple(stalk_base + stalk_dir * stalk_len * 0.35 + bow),
                        tuple(stalk_base + stalk_dir * stalk_len * 0.7 + bow * 0.6), tuple(stalk_tip), 7)
    stalk_r = float(stalk["radius"])
    stalk_radii = [stalk_r * f for f in (1.15, 1.05, 1.0, 0.95, 0.9, 0.85, 0.8)]
    eye_r = float(stalk["eyeRadius"])
    eye_center = stalk_tip + stalk_dir * (eye_r * 0.55)
    fil = soft["filament"]
    fil_base = Vector(stalk_path[5])
    fil_dir = _unit((0.55, -0.35, -0.75))
    fil_path = [tuple(fil_base + fil_dir * (float(fil["length"]) * k / 3)) for k in range(4)]
    siphon = soft["siphon"]
    siphon_base = Vector((x_ct - float(siphon["baseSetback"]), ap_center.y + float(siphon["sideOffset"]), float(siphon["baseHeight"])))
    siphon_dir = _unit(siphon["direction"])
    siphon_path = [tuple(siphon_base + siphon_dir * (float(siphon["length"]) * k / 4)) for k in range(5)]
    siphon_r = float(siphon["radius"])
    op = soft["operculum"]
    op_base = Vector((x_f0 + float(op["baseForward"]), 0.0, sole_lift + foot_h * 0.55))
    op_tip = Vector((x_f0 - float(op["reach"]), float(op["sideCurl"]), float(op["tipHeight"])))
    op_path = bezier(tuple(op_base), tuple(op_base + Vector((-float(op["reach"]) * 0.35, 0.0, 0.001))),
                     tuple(op_tip + Vector((float(op["reach"]) * 0.3, 0.0, 0.0025))), tuple(op_tip), 8)
    op_r = float(op["radius"])
    op_radii = [op_r * f for f in (1.0, 1.05, 1.0, 0.9, 0.78, 0.62, 0.42, 0.22)]

    # ---- textures and materials
    shell_w, shell_h = tex.get("shellResolution", [1024, 512])
    soft_w, soft_h = tex.get("softResolution", [1024, 512])
    written = []
    images = {}
    shell_paint = paint_shell(coil, phis, palette, shell_w, shell_h)
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = ctx.texture_dir / f"shell-{key}.png"
        images[f"shell_{key}"] = textures.write_image(f"{prefix}_Shell_{key}", path, shell_paint[key], non_color)
        written.append(path)
    soft_paint = paint_soft_atlas(palette, soft_w, soft_h)
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = ctx.texture_dir / f"soft-{key}.png"
        images[f"soft_{key}"] = textures.write_image(f"{prefix}_Soft_{key}", path, soft_paint[key], non_color)
        written.append(path)
    shell_mat = mat.principled(f"{prefix}_Shell", palette["shellBase"], 0.45, coat=0.15, subsurface=0.02, specular=0.5)
    mat.attach_textures(shell_mat, albedo=images["shell_albedo"], roughness=images["shell_roughness"], normal=images["shell_normal"],
                        normal_strength=float(tex.get("shellNormalStrength", 1.0)))
    soft_mat = mat.principled(f"{prefix}_Soft", palette["soft"], 0.5, coat=0.08, subsurface=0.18, specular=0.35)
    mat.attach_textures(soft_mat, albedo=images["soft_albedo"], roughness=images["soft_roughness"], normal=images["soft_normal"],
                        normal_strength=float(tex.get("softNormalStrength", 0.6)))
    operculum_mat = mat.principled(f"{prefix}_Operculum", palette["operculum"], 0.3, coat=0.4, subsurface=0.0, specular=0.5)
    mat.attach_textures(operculum_mat, albedo=images["soft_albedo"], roughness=images["soft_roughness"], normal=images["soft_normal"],
                        normal_strength=0.8)
    material_map = {"shell": shell_mat, "soft": soft_mat, "operculum": operculum_mat}

    # ---- rig
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    z_chain = sole_lift + foot_h * 0.45
    rb.bone("Root", (x_f0 + foot_len * 0.5 + 0.004, 0.0, z_chain), (x_f0 + foot_len * 0.5, 0.0, z_chain), deform=False)
    shell_bone_z = ap_center.z + 0.012
    rb.bone("Shell", (ap_center.x - 0.015, ap_center.y, shell_bone_z), (ap_center.x + 0.015, ap_center.y, shell_bone_z), "Root")
    third = foot_len / 3.0
    rb.bone("Foot_B", (x_f0 + third, 0.0, z_chain), (x_f0 + 2 * third, 0.0, z_chain), "Root")
    rb.bone("Foot_A", (x_f0, 0.0, z_chain), (x_f0 + third, 0.0, z_chain), "Foot_B")
    rb.bone("Foot_C", (x_f0 + 2 * third, 0.0, z_chain), (x_f1, 0.0, z_chain), "Shell")
    rb.bone("Head", tuple(Vector(head_path[1])), tuple(head_front), "Foot_C")
    rb.bone("Proboscis", tuple(prob_base), tuple(prob_tip), "Head")
    rb.bone("Eyestalk_L", tuple(stalk_base), tuple(eye_center), "Head")
    rb.bone("Eyestalk_R", (stalk_base.x, -stalk_base.y, stalk_base.z), (eye_center.x, -eye_center.y, eye_center.z), "Head")
    rb.bone("Siphon", tuple(siphon_base), siphon_path[-1], "Shell")
    rb.bone("Operculum", tuple(op_base), tuple(op_tip), "Foot_A")
    rig = rb.finish()

    # ---- shell mesh object
    shell_part = msh.make_part("shell", shell_geometry, "shell", lambda i, v: {"Shell": 1.0}, closed=True)
    shell_obj = msh.assemble(f"{prefix}_Shell", [shell_part], material_map, rig, f"{prefix}_Armature")
    shell_obj["lod"] = 1
    shell_obj["adultShellLengthMeters"] = spec["referenceSize"]["meters"]

    # ---- soft body parts
    parts = []
    foot_rings = []
    foot_count = int(foot["rings"])
    foot_segments = int(foot["segments"])
    for k in range(foot_count):
        s = k / (foot_count - 1)
        x = x_f0 + foot_len * s
        taper = math.sin(math.pi * s) ** 0.55
        hw = max(foot_hw * taper, 0.0012)
        height = max(foot_h * (0.35 + 0.65 * math.sin(math.pi * s) ** 0.7), 0.0022)
        center_z = sole_lift
        foot_rings.append(msh.superellipse_ring(x, hw, height - sole_lift, sole_lift, 0.0, center_z, foot_segments, 2.1, 6.0))
    foot_geometry = msh.loft(foot_rings, cap_start=True, cap_end=True)

    def foot_weights(_index, vertex):
        s = (vertex[0] - x_f0) / foot_len
        return segment_weights(min(max(s, 0.0), 1.0), ["Foot_A", "Foot_B", "Foot_C"], 1.0)

    parts.append(msh.make_part("foot", foot_geometry, "soft", foot_weights, closed=True, uv_transform=tile_transform(SOFT_TILES["foot"])))

    head_geometry = msh.tube(head_path, head_radii, int(head["segments"]), aspect=float(head["aspect"]))
    parts.append(msh.make_part("head", head_geometry, "soft",
                               tube_weights(len(head_path), int(head["segments"]),
                                            lambda s: msh.blend_weights({"Foot_C": 1.0}, {"Head": 1.0}, msh.smoothstep(s / 0.55))),
                               closed=True, uv_transform=tile_transform(SOFT_TILES["head"])))

    prob_segments = int(prob["segments"])
    prob_geometry = msh.tube(prob_path, prob_radii, prob_segments)
    parts.append(msh.make_part("proboscis", prob_geometry, "soft",
                               tube_weights(len(prob_path), prob_segments,
                                            lambda s: msh.blend_weights({"Head": 1.0}, {"Proboscis": 1.0}, msh.smoothstep(s / 0.4))),
                               closed=True, groups={"attach_proboscis": tube_attach(len(prob_path), prob_segments, 2)},
                               uv_transform=tile_transform(SOFT_TILES["proboscis"])))

    stalk_segments = int(stalk["segments"])
    stalk_geometry = msh.tube(stalk_path, stalk_radii, stalk_segments)
    stalk_all = set(range(len(stalk_geometry[0])))
    stalk_part = msh.make_part("eyestalk_L", stalk_geometry, "soft", lambda i, v: {"Eyestalk_L": 1.0}, closed=True,
                               groups={"app_eyestalk_L": stalk_all, "attach_eyestalk_L": tube_attach(len(stalk_path), stalk_segments, 2)},
                               uv_transform=tile_transform(SOFT_TILES["eyestalk"]))
    eye_rotation = Vector((0.0, 0.0, 1.0)).rotation_difference(stalk_dir).to_matrix()
    eye_geometry = msh.ellipsoid(tuple(eye_center), (eye_r, eye_r, eye_r * 0.96), int(stalk["eyeSegments"]), int(stalk["eyeRings"]), eye_rotation)
    eye_part = msh.make_part("eye_L", eye_geometry, "soft", lambda i, v: {"Eyestalk_L": 1.0}, closed=True,
                             groups={"app_eyestalk_L": set(range(len(eye_geometry[0])))}, uv_transform=tile_transform(SOFT_TILES["eye"]))
    fil_r = float(fil["radius"])
    fil_geometry = msh.tube(fil_path, [fil_r, fil_r * 0.85, fil_r * 0.6, fil_r * 0.35], 6)
    fil_part = msh.make_part("filament_L", fil_geometry, "soft", lambda i, v: {"Eyestalk_L": 1.0}, closed=True,
                             groups={"app_eyestalk_L": set(range(len(fil_geometry[0])))}, uv_transform=tile_transform(SOFT_TILES["filament"]))
    left_parts = [stalk_part, eye_part, fil_part]
    right_parts = [part.mirror_y(rename={"_L": "_R"}) for part in left_parts]
    parts.extend(left_parts)
    parts.extend(right_parts)

    siphon_segments = int(siphon["segments"])
    siphon_geometry = msh.tube(siphon_path, [siphon_r * f for f in (1.0, 0.95, 0.88, 0.78, 0.55)], siphon_segments)
    parts.append(msh.make_part("siphon", siphon_geometry, "soft",
                               tube_weights(len(siphon_path), siphon_segments,
                                            lambda s: msh.blend_weights({"Shell": 1.0}, {"Siphon": 1.0}, msh.smoothstep(s / 0.35))),
                               closed=True, uv_transform=tile_transform(SOFT_TILES["siphon"])))

    op_segments = int(op["segments"])
    op_geometry = msh.tube(op_path, op_radii, op_segments, aspect=float(op["aspect"]), up_hint=(0.0, 1.0, 0.0))
    parts.append(msh.make_part("operculum", op_geometry, "operculum",
                               tube_weights(len(op_path), op_segments,
                                            lambda s: msh.blend_weights({"Foot_A": 1.0}, {"Operculum": 1.0}, msh.smoothstep(s / 0.3))),
                               closed=True, groups={"attach_operculum": tube_attach(len(op_path), op_segments, 2)},
                               uv_transform=tile_transform(SOFT_TILES["operculum"])))

    body_obj = msh.assemble(f"{prefix}_Body", parts, material_map, rig, f"{prefix}_Armature")
    body_obj["lod"] = 1

    # ---- diagnostics (deterministic, printed into build.log to guide placement)
    def part_vertices(name, exclude_group=None):
        for part in parts:
            if part.name == name:
                if exclude_group and exclude_group in part.groups:
                    return [v for i, v in enumerate(part.vertices) if i not in part.groups[exclude_group]]
                return part.vertices
        return []
    stalk_free = part_vertices("eyestalk_L", "attach_eyestalk_L") + part_vertices("eye_L") + part_vertices("filament_L")
    diagnostics = {
        "canalTipX": round(x_ct, 5), "aperturePosteriorX": round(ap_posterior.x, 5),
        "apertureCenter": [round(c, 5) for c in ap_center], "shellMinZ": round(min(v[2] for v in shell_vertices), 5),
        "footX": [round(x_f0, 5), round(x_f1, 5)],
        "eyeMaxX": round(max(v[0] for v in part_vertices("eye_L")), 5),
        "proboscisMaxX": round(max(v[0] for v in part_vertices("proboscis")), 5),
        "minDistEyestalkShell": round(min_vertex_distance(stalk_free, shell_vertices), 5),
        "minDistEyestalkRShell": round(min_vertex_distance([(x, -y, z) for x, y, z in stalk_free], shell_vertices), 5),
        "minDistEyestalkHead": round(min_vertex_distance(stalk_free, part_vertices("head")), 5),
        "minDistProboscisShell": round(min_vertex_distance(part_vertices("proboscis"), shell_vertices), 5),
        "minDistProboscisFoot": round(min_vertex_distance(part_vertices("proboscis", "attach_proboscis"), part_vertices("foot")), 5),
        "minDistOperculumShell": round(min_vertex_distance(part_vertices("operculum", "attach_operculum"), shell_vertices), 5),
        "minDistHeadShell": round(min_vertex_distance(part_vertices("head"), shell_vertices), 5),
    }
    print("fighting_conch diagnostics:", diagnostics)

    # ---- animation
    anim = spec["animation"]
    clips = []

    def ch(target, kind, axis, amplitude, frequency=1.0, phase=0.0, waveform="sin", exponent=1.0, envelope=None):
        return Channel(target, kind, tuple(axis), float(amplitude), float(frequency), float(phase), waveform, float(exponent), 0.0, envelope)

    # Every clip drives the same (bone, kind) pairs. The validator evaluates clips back to back without
    # resetting the pose, so a kind left unkeyed in one clip would inherit the previous clip's last value.
    shrink_axis = (0.35, 1.0, 0.35)
    tiny = 0.00025  # metres, a barely visible breathing translation that keeps location kinds keyed

    rest = anim["rest"]
    rest_channels = [
        ch("Shell", "rotation", (0, 1, 0), rest["shellRock"], 1, 0.0),
        ch("Shell", "location", (0, 0, 1), tiny, 1, 0.0),
        ch("Foot_A", "rotation", (1, 0, 0), rest["footFlex"], 1, 0.0),
        ch("Foot_A", "location", (0, 1, 0), tiny, 1, 0.6),
        ch("Foot_B", "scale", (0, 1, 0), rest["footPulse"], 2, 0.0),
        ch("Foot_B", "location", (0, 0, 1), tiny, 2, 0.0),
        ch("Foot_C", "scale", (1, 0, 1), rest["footPulse"] * 0.6, 2, 1.0),
        ch("Foot_C", "location", (0, 1, 0), tiny, 2, 1.0),
        ch("Head", "rotation", (1, 0, 0), rest["headNod"], 1, 0.5),
        ch("Head", "location", (0, 1, 0), tiny, 1, 0.5),
        ch("Proboscis", "rotation", (1, 0, 0), rest["proboscisNod"], 1, 2.0),
        ch("Proboscis", "rotation", (0, 0, 1), rest["proboscisSwing"], 2, 0.7),
        ch("Proboscis", "scale", shrink_axis, 0.015, 2, 0.0),
        ch("Eyestalk_L", "rotation", (1, 0, 0), rest["eyestalkNod"], 1, 0.0),
        ch("Eyestalk_L", "rotation", (0, 0, 1), rest["eyestalkSwing"], 1, 1.3),
        ch("Eyestalk_L", "scale", shrink_axis, 0.012, 1, 0.4),
        ch("Eyestalk_R", "rotation", (1, 0, 0), rest["eyestalkNod"], 1, 2.1),
        ch("Eyestalk_R", "rotation", (0, 0, 1), rest["eyestalkSwing"], 1, 3.9),
        ch("Eyestalk_R", "scale", shrink_axis, 0.012, 1, 2.5),
        ch("Operculum", "rotation", (1, 0, 0), rest["operculumSway"], 1, 1.0),
        ch("Siphon", "rotation", (1, 0, 0), rest["siphonSway"], 2, 0.0),
        ch("Siphon", "rotation", (0, 0, 1), rest["siphonSway"] * 0.8, 1, 0.9),
        ch("Siphon", "scale", shrink_axis, 0.015, 2, 0.8),
    ]
    clips.append(ClipSpec("rest", int(rest["frames"]), True, rest_channels))

    hop = anim["hop"]
    f = int(hop["hopsPerLoop"])
    lurch = float(hop["lurch"])
    lead = -math.pi / 2.0
    plant = float(hop["plantFraction"])
    hop_channels = [
        # harmonic sawtooth: slow drift back relative to the moving root, fast forward lurch
        ch("Shell", "location", (0, 1, 0), -lurch, f, 0.0),
        ch("Shell", "location", (0, 1, 0), lurch / 2.0, 2 * f, 0.0),
        ch("Shell", "location", (0, 1, 0), -lurch / 3.0, 3 * f, 0.0),
        ch("Shell", "location", (0, 0, 1), hop["lift"], f, lead, "pulse", 2.0),
        ch("Shell", "rotation", (1, 0, 0), hop["pitch"], f, lead, "pulse", 1.5),
        ch("Shell", "rotation", (0, 1, 0), hop["rollWobble"], f, 0.4),
        # the anterior foot and head ride with the shell (columellar muscle); the mid foot follows half
        # way in translation only and the operculum end stays planted, so the foot stretches in between
        ch("Foot_B", "location", (0, 1, 0), -lurch * 0.5, f, 0.0),
        ch("Foot_B", "location", (0, 1, 0), lurch / 4.0, 2 * f, 0.0),
        ch("Foot_B", "location", (0, 1, 0), -lurch / 6.0, 3 * f, 0.0),
        ch("Foot_B", "scale", (0, 1, 0), hop["footStretch"], f, lead, "pulse", 1.5),
        ch("Foot_A", "location", (0, 1, 0), lurch * 0.5 * plant, f, 0.0),
        ch("Foot_A", "location", (0, 1, 0), -lurch / 4.0 * plant, 2 * f, 0.0),
        ch("Foot_A", "location", (0, 1, 0), lurch / 6.0 * plant, 3 * f, 0.0),
        ch("Foot_A", "rotation", (1, 0, 0), hop["footFlex"], f, lead, "pulse", 1.5),
        ch("Foot_C", "scale", (0, 1, 0), hop["footStretch"] * 0.6, f, lead, "pulse", 1.5),
        ch("Foot_C", "location", (0, 1, 0), tiny, f, lead, "pulse", 1.5),
        ch("Operculum", "rotation", (1, 0, 0), -hop["operculumDig"], f, lead + 0.7, "pulse", 1.5),
        ch("Head", "rotation", (1, 0, 0), -hop["headDip"], f, lead, "pulse", 1.5),
        ch("Head", "location", (0, 1, 0), 2.0 * tiny, f, lead, "pulse", 1.5),
        ch("Proboscis", "rotation", (1, 0, 0), hop["proboscisLift"], f, lead, "pulse", 1.5),
        ch("Proboscis", "scale", shrink_axis, -0.04, f, lead, "pulse", 1.5),
        ch("Eyestalk_L", "rotation", (1, 0, 0), -hop["eyestalkWhip"], f, lead, "pulse", 1.5),
        ch("Eyestalk_R", "rotation", (1, 0, 0), -hop["eyestalkWhip"], f, lead, "pulse", 1.5),
        ch("Eyestalk_L", "rotation", (0, 0, 1), hop["eyestalkSwing"], f, 0.9),
        ch("Eyestalk_R", "rotation", (0, 0, 1), hop["eyestalkSwing"], f, 2.4),
        ch("Eyestalk_L", "scale", shrink_axis, -0.03, f, lead, "pulse", 1.5),
        ch("Eyestalk_R", "scale", shrink_axis, -0.03, f, lead, "pulse", 1.5),
        ch("Siphon", "rotation", (1, 0, 0), hop["siphonSway"], f, 0.3),
        ch("Siphon", "scale", shrink_axis, -0.03, f, lead, "pulse", 1.5),
    ]
    clips.append(ClipSpec("hop", int(hop["frames"]), True, hop_channels))

    wd = anim["withdraw"]
    env = wd.get("envelope", "hold")
    withdraw_channels = [
        ch("Shell", "rotation", (1, 0, 0), -wd["shellSettle"], 1, 0.0, "const", 1.0, env),
        ch("Shell", "location", (0, 0, 1), -wd["shellSettleDrop"], 1, 0.0, "const", 1.0, env),
        ch("Foot_A", "location", (0, 1, 0), wd["footDraw"], 1, 0.0, "const", 1.0, env),
        ch("Foot_A", "rotation", (1, 0, 0), wd["footFlex"], 1, 0.0, "const", 1.0, env),
        ch("Foot_B", "scale", (0, 1, 0), -wd["footCompress"], 1, 0.0, "const", 1.0, env),
        ch("Foot_B", "location", (0, 1, 0), -wd["footDraw"] * 0.25, 1, 0.0, "const", 1.0, env),
        ch("Foot_C", "location", (0, 1, 0), -wd["footDraw"], 1, 0.0, "const", 1.0, env),
        ch("Foot_C", "scale", (0, 1, 0), -wd["footCompress"] * 0.5, 1, 0.0, "const", 1.0, env),
        ch("Head", "location", (0, 1, 0), -wd["headRetreat"], 1, 0.0, "const", 1.0, env),
        ch("Head", "rotation", (1, 0, 0), -wd["headTuck"], 1, 0.0, "const", 1.0, env),
        ch("Proboscis", "rotation", (1, 0, 0), wd["proboscisLift"], 1, 0.0, "const", 1.0, env),
        ch("Proboscis", "scale", shrink_axis, -wd["proboscisShrink"], 1, 0.0, "const", 1.0, env),
        ch("Eyestalk_L", "rotation", (1, 0, 0), wd["eyestalkFold"], 1, 0.0, "const", 1.0, env),
        ch("Eyestalk_R", "rotation", (1, 0, 0), wd["eyestalkFold"], 1, 0.0, "const", 1.0, env),
        ch("Eyestalk_L", "scale", shrink_axis, -wd["eyestalkShrink"], 1, 0.0, "const", 1.0, env),
        ch("Eyestalk_R", "scale", shrink_axis, -wd["eyestalkShrink"], 1, 0.0, "const", 1.0, env),
        ch("Operculum", "rotation", (1, 0, 0), wd["operculumClose"], 1, 0.0, "const", 1.0, env),
        ch("Siphon", "scale", shrink_axis, -wd["siphonShrink"], 1, 0.0, "const", 1.0, env),
        ch("Siphon", "rotation", (1, 0, 0), wd["siphonLift"], 1, 0.0, "const", 1.0, env),
    ]
    clips.append(ClipSpec("withdraw", int(wd["frames"]), False, withdraw_channels))

    kinds_by_clip = [{(c.target, c.kind) for c in clip.channels} for clip in clips]
    if any(k != kinds_by_clip[0] for k in kinds_by_clip[1:]):
        raise ValueError("fighting_conch clips must drive identical (bone, kind) sets so no pose state leaks between clips")
    for clip in clips:
        bake_clip(rig, clip, mesh_objects={shell_obj.name: shell_obj, body_obj.name: body_obj})

    # ---- contract
    meshes = [shell_obj, body_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis=spec["referenceSize"].get("axis", "x"))
    contract["closedParts"] += [
        {"object": shell_obj.name, "group": "part_shell", "volumeFloor": 0.9},
        {"object": body_obj.name, "group": "part_foot", "volumeFloor": 0.55},
        {"object": body_obj.name, "group": "part_head", "volumeFloor": 0.6},
        {"object": body_obj.name, "group": "part_proboscis", "volumeFloor": 0.3},
        {"object": body_obj.name, "group": "part_eyestalk_L", "volumeFloor": 0.2},
        {"object": body_obj.name, "group": "part_eyestalk_R", "volumeFloor": 0.2},
        {"object": body_obj.name, "group": "part_eye_L", "volumeFloor": 0.2},
        {"object": body_obj.name, "group": "part_eye_R", "volumeFloor": 0.2},
        {"object": body_obj.name, "group": "part_operculum", "volumeFloor": 0.6},
        {"object": body_obj.name, "group": "part_siphon", "volumeFloor": 0.3},
    ]
    stalk_l = [body_obj.name, "app_eyestalk_L", "attach_eyestalk_L"]
    stalk_r = [body_obj.name, "app_eyestalk_R", "attach_eyestalk_R"]
    contract["clearance"] += [
        {"a": stalk_l, "b": stalk_r, "minDistance": 0.0015, "label": "eyestalk_left_right"},
        {"a": stalk_l, "b": [body_obj.name, "part_foot"], "label": "eyestalk_foot_L"},
        {"a": stalk_r, "b": [body_obj.name, "part_foot"], "label": "eyestalk_foot_R"},
        {"a": stalk_l, "b": [body_obj.name, "part_proboscis"], "label": "eyestalk_proboscis_L"},
        {"a": stalk_r, "b": [body_obj.name, "part_proboscis"], "label": "eyestalk_proboscis_R"},
        # eyestalks vs shell is deliberately not declared: the withdraw clip draws the stalks back into
        # the aperture, where they pass the parietal wall of the shell as the animal retracts
        {"a": [body_obj.name, "part_proboscis", "attach_proboscis"], "b": [body_obj.name, "part_foot"], "label": "proboscis_foot"},
        {"a": [body_obj.name, "part_operculum", "attach_operculum"], "b": [shell_obj.name, "part_shell"], "label": "operculum_shell"},
    ]
    contract["centerPlane"] += [
        {"object": body_obj.name, "group": "app_eyestalk_L", "exclude": "attach_eyestalk_L", "side": -1},
        {"object": body_obj.name, "group": "app_eyestalk_R", "exclude": "attach_eyestalk_R", "side": 1},
    ]
    contract["symmetry"] = [{"object": body_obj.name, "left": "app_eyestalk_L", "right": "app_eyestalk_R", "tolerance": 0.0003}]
    contract["axialChain"] = None
    register_clips(contract, clips)

    preview_clip = spec.get("preview", {}).get("clip", spec["clipRoles"]["locomotion"])
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract, preview_action=preview_clip,
                       textures=written, notes={"shellRings": aperture_index + 1, "shellSegments": segments, "diagnostics": diagnostics,
                                                "bodyPlan": "species_local_gastropod_strombid"})
