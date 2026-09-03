"""Chalice coral: aquarium "chalice" group (Echinophyllia / Mycedium / Oxypora; group-level label).

Species-local `encrusting_coral` body plan (no shared plan exists for scleractinians), built entirely from
`asset.source.json` with fixed seeds:

- Rock base (`part_rock`): irregular closed loft lump resting on z = 0, weighted 1.0 to the static `Base` bone.
- Plate (`part_plate`): one closed polar loft. The top surface is a thick centre thinning toward a slightly
  lifted, undulating free margin (encrusting-to-foliaceous habit of Echinophyllia aspera, which "always hugs
  the surface closely"), carrying deterministic dart-thrown corallite mounds ("eyes") whose calice pit is offset
  toward the colony margin (corallites inclined to the perimeter, the Mycedium/Echinophyllia habit), a thin calice
  lip, and fine tissue relief. A founder corallite sits near the centre. The rim is rounded; the underside is
  bare skeleton. Top and rim faces use the tissue material, the underside the skeleton material.
- Corallites: every corallite owns one `Polyp_NN` deform bone (head under the mouth). The bone tilts the tentacle
  tuft (sway / flow) and scales plus pulls it into the calice (retract). Mound tissue is partially weighted to the
  same bone so the tissue shimmers with the tuft and deflates slightly on retraction.
- Tentacles: short tapering closed tubes around each mouth (feeding tentacles are small in chalices and extend
  mainly under flow / at night). They are not declared closed parts because they retract; clearance is proven
  between tufts of different corallites and between every tuft and the rock.
- Textures: tissue albedo / roughness / normal are planar projections aligned with the geometry's own height
  function (eyes, pits, lips, margin glow, septocostal striations, verrucae); skeleton albedo / roughness / normal
  are a porous matte field with coralline algae patches; tentacle albedo / roughness / normal grade base -> tip.
  Albedo values are authored display-referred (sRGB), no emission is used for the "glow" colours.
- Clips: `sway` (idle, loop), `flow` (locomotion, loop, current lean plus flutter), `retract` (response, hold
  envelope: tufts shrink, sink and curl into the corallites, then re-extend).

Colour variants only change the palette (and, for `jelly_bean`, an optional seeded candy-blotch pattern with a
per-cell hue drawn from a colour list); geometry is shared between pigment variants.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.noise import cells, fbm, scalar_hash, smoothstep
from ..lib.rigging import RigBuilder


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


# ---------------------------------------------------------------- colony description

class Colony:
    """Deterministic colony description shared by the mesh, the skin weights and the textures."""

    def __init__(self, spec: dict):
        m = spec["morphology"]
        self.width = float(spec["referenceSize"]["meters"])
        self.seed = int(m.get("seed", 7))
        outline = m.get("outline", {})
        orders = outline.get("orders", [2, 3, 5])
        amplitudes = outline.get("amplitudes", [0.07, 0.045, 0.025])
        self.harmonics = [(int(o), float(a)) for o, a in zip(orders, amplitudes)]
        self.phases = [scalar_hash(k, 11, seed=self.seed) * math.tau for k in range(len(self.harmonics))]
        self.bulge = float(outline.get("rimBulge", 0.02))
        sampling = m.get("sampling", {})
        self.segments = int(sampling.get("segments", 120))
        self.top_rings = int(sampling.get("topRings", 26))
        self.rim_rings = int(sampling.get("rimRings", 3))
        self.bottom_rings = int(sampling.get("bottomRings", 6))
        rock = m.get("rock", {})
        self.rock_radius = float(rock.get("radius", 0.026))
        self.rock_height = float(rock.get("height", 0.012))
        self.rock_segments = int(rock.get("segments", 24))
        self.rock_rings = int(rock.get("rings", 7))
        self.rock_roughness = float(rock.get("roughness", 0.12))
        plate = m.get("plate", {})
        self.center_thickness = float(plate.get("centerThickness", 0.008))
        self.edge_thickness = float(plate.get("edgeThickness", 0.0035))
        self.margin_lift = float(plate.get("marginLift", 0.006))
        self.undulation = float(plate.get("undulationAmplitude", 0.003))
        self.undulation_scale = float(plate.get("undulationScale", 22.0))
        self.relief = float(plate.get("tissueRelief", 0.0005))
        self.relief_scale = float(plate.get("tissueReliefScale", 80.0))
        self.embed = float(plate.get("rockEmbed", 0.002))
        self.tissue_weight = float(plate.get("tissueWeight", 0.3))
        # size normalisation: the rim ring at half height carries the bulge, so it sets the xy extent
        thetas = np.arange(self.segments) / self.segments * math.tau
        unit = self._outline_factor(thetas)
        ux = unit * np.cos(thetas)
        uy = unit * np.sin(thetas)
        extent = max(float(ux.max() - ux.min()), float(uy.max() - uy.min())) * (1.0 + self.bulge)
        self.R0 = self.width / extent
        self.R_max = float(unit.max()) * self.R0 * (1.0 + self.bulge)
        self.uv_half = self.R_max * 1.06
        self.tentacle_cfg = m.get("tentacles", {})
        self.corallites = self._place_corallites(m.get("corallites", {}))
        self._finish_corallites()

    # ---- outline and polar helpers

    def _outline_factor(self, theta):
        theta = np.asarray(theta, dtype=np.float64)
        factor = np.ones_like(theta)
        for (order, amplitude), phase in zip(self.harmonics, self.phases):
            factor = factor + amplitude * np.sin(order * theta + phase)
        return factor

    def outline(self, theta):
        return self.R0 * self._outline_factor(theta)

    def polar(self, x, y):
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        r = np.hypot(x, y)
        theta = np.arctan2(y, x)
        R = self.outline(theta)
        return r, theta, R, r / R

    # ---- height functions (metres), shared by geometry and textures

    def undulation_field(self, x, y, rf):
        k = self.undulation_scale
        n = fbm(np.asarray(x) * k + 7.3, np.asarray(y) * k + 2.1, octaves=3, seed=self.seed + 3)
        return (n - 0.5) * 2.0 * self.undulation * smoothstep(0.12, 0.55, rf)

    def bottom_z(self, x, y):
        _r, _theta, _R, rf = self.polar(x, y)
        lift = self.margin_lift * smoothstep(0.28, 1.0, rf) ** 1.3
        return self.rock_height - self.embed + lift + self.undulation_field(x, y, rf)

    def thickness(self, rf):
        return self.center_thickness - (self.center_thickness - self.edge_thickness) * np.clip(rf, 0.0, 1.0) ** 1.4

    def corallite_relief(self, x, y):
        """Mound minus calice pit plus a thin calice lip, summed over corallites."""
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        relief = np.zeros(np.broadcast(x, y).shape, dtype=np.float64)
        for c in self.corallites:
            d = np.hypot(x - c["x"], y - c["y"])
            mound = c["height"] * (1.0 - smoothstep(0.15 * c["radius"], c["radius"], d))
            dp = np.hypot(x - c["pitX"], y - c["pitY"])
            pit = c["pitDepth"] * (1.0 - smoothstep(0.0, c["pitRadius"], dp))
            lip = c["pitDepth"] * 0.35 * np.exp(-((dp - 1.1 * c["pitRadius"]) / (0.3 * c["pitRadius"])) ** 2)
            relief = relief + mound - pit + lip
        return relief

    def fine_relief(self, x, y):
        k = self.relief_scale
        n = fbm(np.asarray(x) * k + 1.7, np.asarray(y) * k + 5.9, octaves=3, seed=self.seed + 5)
        return (n - 0.5) * 2.0 * self.relief

    def top_z(self, x, y):
        _r, _theta, _R, rf = self.polar(x, y)
        return self.bottom_z(x, y) + self.thickness(rf) + self.corallite_relief(x, y) + self.fine_relief(x, y)

    def tissue_influence(self, x, y):
        """Per-corallite skin weight of the mound tissue toward its polyp bone, shape (corallites, points)."""
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        out = np.zeros((len(self.corallites), x.shape[0]), dtype=np.float64)
        for i, c in enumerate(self.corallites):
            d = np.hypot(x - c["x"], y - c["y"])
            out[i] = self.tissue_weight * (1.0 - smoothstep(0.35 * c["radius"], 1.25 * c["radius"], d))
        return out

    # ---- corallites

    def _place_corallites(self, cfg: dict) -> list[dict]:
        count = int(cfg.get("count", 16))
        r_min, r_max = (float(v) for v in cfg.get("radius", [0.004, 0.0062]))
        h_min, h_max = (float(v) for v in cfg.get("moundHeight", [0.002, 0.0032]))
        pit_fraction = float(cfg.get("pitRadiusFraction", 0.38))
        pit_depth_fraction = float(cfg.get("pitDepthFraction", 0.55))
        pit_offset = float(cfg.get("pitOffsetFraction", 0.22))
        max_rf = float(cfg.get("maxRadiusFraction", 0.82))
        spacing = float(cfg.get("spacing", 0.7))
        gap = float(cfg.get("gap", 0.010))
        t_min, t_max = (int(v) for v in self.tentacle_cfg.get("count", [6, 8]))
        placed: list[dict] = []
        attempt = 0
        while len(placed) < count and attempt < 6000:
            attempt += 1
            index = len(placed)
            a = scalar_hash(attempt, 1, seed=self.seed)
            b = scalar_hash(attempt, 2, seed=self.seed)
            radius = _lerp(r_min, r_max, scalar_hash(attempt, 3, seed=self.seed))
            if index == 0:
                # founder corallite: the largest calice, just off the plate centre (its mound covers the centre cap)
                rf = 0.16 + 0.08 * b
                radius = r_max * 1.15
            else:
                rf = max_rf * math.sqrt(b)
            theta = a * math.tau
            R = float(self.outline(theta))
            x = rf * R * math.cos(theta)
            y = rf * R * math.sin(theta)
            if (rf * R + 1.15 * radius) / R > 0.93:
                continue
            if any(math.hypot(x - c["x"], y - c["y"]) < spacing * (radius + c["radius"]) + gap for c in placed):
                continue
            if rf > 1e-6:
                ox, oy = x / (rf * R), y / (rf * R)
            else:
                ang = scalar_hash(attempt, 4, seed=self.seed) * math.tau
                ox, oy = math.cos(ang), math.sin(ang)
            pit_radius = radius * pit_fraction
            height = _lerp(h_min, h_max, scalar_hash(attempt, 5, seed=self.seed))
            placed.append({
                "index": index,
                "bone": f"Polyp_{index:02d}",
                "x": x, "y": y, "radius": radius, "height": height,
                "outX": ox, "outY": oy,
                "pitX": x + ox * pit_offset * radius, "pitY": y + oy * pit_offset * radius,
                "pitRadius": pit_radius, "pitDepth": height * pit_depth_fraction,
                "tentacles": t_min + int(scalar_hash(attempt, 6, seed=self.seed) * (t_max - t_min + 1) * 0.9999),
                "spin": scalar_hash(attempt, 7, seed=self.seed) * math.tau,
                "phase": scalar_hash(attempt, 8, seed=self.seed) * math.tau,
                "gain": _lerp(0.8, 1.2, scalar_hash(attempt, 9, seed=self.seed)),
                "curl": 1.0 if scalar_hash(attempt, 10, seed=self.seed) < 0.5 else -1.0,
            })
        return placed

    def _finish_corallites(self):
        if not self.corallites:
            raise ValueError("No corallites could be placed on the plate")
        px = np.array([c["pitX"] for c in self.corallites])
        py = np.array([c["pitY"] for c in self.corallites])
        pit_z = self.top_z(px, py)
        for c, z in zip(self.corallites, pit_z):
            c["pitZ"] = float(z)

    # ---- tentacles

    def tentacles(self):
        """Yield (corallite, k, points, radii) for every tentacle, deterministically ordered."""
        cfg = self.tentacle_cfg
        l_min, l_max = (float(v) for v in cfg.get("length", [0.0042, 0.006]))
        r_min, r_max = (float(v) for v in cfg.get("radius", [0.0006, 0.00085]))
        lean_min, lean_max = (math.radians(float(v)) for v in cfg.get("leanDegrees", [12.0, 26.0]))
        embed = float(cfg.get("embed", 0.0009))
        ring_factor = float(cfg.get("ringFactor", 1.05))
        fractions = (0.0, 0.3, 0.6, 0.85, 1.0)
        taper = (0.9, 1.0, 0.88, 0.6, 0.25)
        for c in self.corallites:
            n = c["tentacles"]
            for k in range(n):
                jitter = (scalar_hash(c["index"], k, 21, seed=self.seed) - 0.5) * (math.tau / n) * 0.5
                phi = c["spin"] + math.tau * k / n + jitter
                ring_r = c["pitRadius"] * ring_factor
                bx = c["pitX"] + ring_r * math.cos(phi)
                by = c["pitY"] + ring_r * math.sin(phi)
                bz = float(self.top_z(np.array([bx]), np.array([by]))[0]) - embed
                length = _lerp(l_min, l_max, scalar_hash(c["index"], k, 22, seed=self.seed))
                lean = _lerp(lean_min, lean_max, scalar_hash(c["index"], k, 23, seed=self.seed))
                radius0 = _lerp(r_min, r_max, scalar_hash(c["index"], k, 24, seed=self.seed))
                # side drift so the tuft is not a perfect radial fan
                drift = (scalar_hash(c["index"], k, 25, seed=self.seed) - 0.5) * 0.6
                ux, uy = math.cos(phi + drift), math.sin(phi + drift)
                points = []
                radii = []
                for s, t in zip(fractions, taper):
                    angle = lean * (0.5 + 0.9 * s)
                    reach = length * s
                    points.append((bx + ux * math.sin(angle) * reach, by + uy * math.sin(angle) * reach, bz + math.cos(angle) * reach))
                    radii.append(radius0 * t)
                yield c, k, points, radii, fractions


# ---------------------------------------------------------------- textures

def _rgb(palette: dict, key: str, default):
    return tuple(float(v) for v in palette.get(key, default))


def _frac(values, scale: float, offset: float):
    """Derive an independent deterministic per-cell value from a Worley cell id."""
    return np.mod(np.asarray(values) * scale + offset, 1.0)


def blotch_layer(X, Y, cfg: dict, seed: int):
    """Round candy blotches from jittered cells: returns (mask, colour index) arrays.

    Each cell decides deterministically whether it carries a blotch (coverage), how large it is and which
    palette colour it takes, so the pattern is irregular but never repeats a rigid lattice.
    """
    scale = float(cfg.get("scale", 300.0))
    coverage = float(cfg.get("coverage", 0.5))
    r_min, r_max = (float(v) for v in cfg.get("radius", [0.2, 0.42]))
    count = int(cfg["colorCount"])
    cell_d, cell_id = cells(X * scale, Y * scale, seed)
    present = _frac(cell_id, 17.31, 0.37) < coverage
    radius = r_min + (r_max - r_min) * _frac(cell_id, 53.7, 0.11)
    mask = (1.0 - smoothstep(radius * 0.72, radius, cell_d)) * present
    index = np.minimum((_frac(cell_id, 91.3, 0.59) * count).astype(np.int64), count - 1)
    return mask, index


def paint_tissue(colony: Colony, palette: dict, size: int, seed: int, pattern: dict | None = None):
    pattern = pattern or {}
    U, V = textures.uv_grid(size, size)
    X = (U - 0.5) * 2.0 * colony.uv_half
    Y = (V - 0.5) * 2.0 * colony.uv_half
    _r, theta, _R, rf = colony.polar(X, Y)
    tissue = _rgb(palette, "tissue", (0.62, 0.10, 0.16))
    dark = _rgb(palette, "tissueDark", (0.35, 0.05, 0.10))
    light = _rgb(palette, "tissueLight", (0.80, 0.25, 0.22))
    eye_color = _rgb(palette, "eye", (0.40, 0.95, 0.30))
    mouth_color = _rgb(palette, "mouth", (0.10, 0.45, 0.15))
    halo_color = _rgb(palette, "eyeHalo", (0.98, 0.72, 0.20))
    edge_color = _rgb(palette, "edge", (0.98, 0.72, 0.20))

    albedo = textures.rgba(tissue, 1.0, U.shape)
    mottle_a = fbm(X * 35.0 + 3.1, Y * 35.0 + 9.2, octaves=4, seed=seed + 21)
    albedo = textures.mix(albedo, dark, smoothstep(0.3, 0.75, mottle_a) * 0.7)
    mottle_b = fbm(X * 60.0 + 13.1, Y * 60.0 + 1.2, octaves=3, seed=seed + 22)
    albedo = textures.mix(albedo, light, smoothstep(0.55, 0.85, mottle_b) * 0.55)
    # septocostal striations radiating to the margin (Mycedium / Echinophyllia habit)
    wobble = fbm(X * 40.0 + 0.7, Y * 40.0 + 4.4, octaves=2, seed=seed + 23)
    stripes = (0.5 + 0.5 * np.sin(theta * 96.0 + wobble * 3.0)) ** 3
    stripe_mask = stripes * smoothstep(0.3, 0.9, rf)
    albedo = textures.mix(albedo, light, stripe_mask * 0.25)
    # verrucae: small tissue bumps between the corallites, plus sparse pale speckles
    cell_d, cell_id = cells(X * 240.0, Y * 240.0, seed + 24)
    bumps = 1.0 - smoothstep(0.15, 0.5, cell_d)
    speckle = (1.0 - smoothstep(0.08, 0.18, cell_d)) * smoothstep(0.68, 0.72, cell_id)
    albedo = textures.mix(albedo, light, speckle * 0.5)
    # optional "jelly bean" candy blotches: large layer first, a smaller layer on top, each cell with its own hue
    blotch_relief = np.zeros(U.shape)
    blotch_cfg = pattern.get("blotches")
    if blotch_cfg:
        colors = [tuple(float(v) for v in c) for c in blotch_cfg["colors"]]
        layers = [dict(blotch_cfg, colorCount=len(colors))]
        if blotch_cfg.get("smallScale"):
            layers.append({"scale": blotch_cfg["smallScale"], "coverage": blotch_cfg.get("smallCoverage", 0.35),
                           "radius": blotch_cfg.get("smallRadius", [0.18, 0.36]), "colorCount": len(colors)})
        for layer_index, layer in enumerate(layers):
            mask, index = blotch_layer(X, Y, layer, seed + 71 + layer_index * 13)
            for color_index, color in enumerate(colors):
                albedo = textures.mix(albedo, color, mask * (index == color_index))
            blotch_relief = np.maximum(blotch_relief, mask)
    # corallite eyes, mouths, radiating septa and halos
    eye = np.zeros(U.shape)
    mouth = np.zeros(U.shape)
    halo = np.zeros(U.shape)
    septa = np.zeros(U.shape)
    for c in colony.corallites:
        d = np.hypot(X - c["x"], Y - c["y"])
        dp = np.hypot(X - c["pitX"], Y - c["pitY"])
        eye = np.maximum(eye, 1.0 - smoothstep(0.5 * c["radius"], 0.8 * c["radius"], d))
        mouth = np.maximum(mouth, 1.0 - smoothstep(0.3 * c["pitRadius"], 0.7 * c["pitRadius"], dp))
        halo = np.maximum(halo, (1.0 - smoothstep(0.8 * c["radius"], 1.2 * c["radius"], d)) * smoothstep(0.45 * c["radius"], 0.75 * c["radius"], d))
        septa_count = 20 + int(scalar_hash(c["index"], 61, seed=seed) * 8.999)
        angle = np.arctan2(Y - c["pitY"], X - c["pitX"])
        spokes = (0.5 + 0.5 * np.cos(angle * septa_count + c["spin"])) ** 3
        septa = np.maximum(septa, spokes * (1.0 - smoothstep(0.4 * c["radius"], 0.8 * c["radius"], d)) * smoothstep(0.25 * c["pitRadius"], 0.6 * c["pitRadius"], dp))
    albedo = textures.mix(albedo, halo_color, halo * 0.55)
    albedo = textures.mix(albedo, eye_color, eye)
    albedo = textures.mix(albedo, mouth_color, septa * 0.45)
    albedo = textures.mix(albedo, mouth_color, mouth)
    # growing margin: a faint growth line, then the bright edge band (albedo only, no emission)
    growth_line = smoothstep(0.83, 0.87, rf) * (1.0 - smoothstep(0.88, 0.905, rf))
    albedo = textures.mix(albedo, dark, growth_line * 0.3)
    edge = smoothstep(0.89, 0.975, rf)
    albedo = textures.mix(albedo, edge_color, edge * 0.88)
    albedo = textures.scale_rgb(albedo, 0.94 + 0.12 * fbm(X * 150.0, Y * 150.0, octaves=2, seed=seed + 26))
    albedo[..., 3] = 1.0

    relief = colony.corallite_relief(X, Y) + colony.fine_relief(X, Y)
    relief_norm = np.clip(relief / 0.0045, -1.0, 1.0)
    height = 0.5 + 0.36 * relief_norm + 0.09 * bumps * (1.0 - eye) + 0.04 * stripe_mask + 0.06 * septa + 0.04 * blotch_relief * (1.0 - eye)
    normal = textures.normal_from_height(np.clip(height, 0.0, 1.0), 3.0)
    roughness = 0.42 + 0.08 * (mottle_a - 0.5) - 0.12 * eye + 0.05 * edge + 0.08 * bumps * (1.0 - eye) - 0.08 * blotch_relief
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": normal}


def paint_skeleton(palette: dict, size: int, seed: int):
    U, V = textures.uv_grid(size, size)
    base = _rgb(palette, "skeleton", (0.66, 0.62, 0.55))
    coralline = _rgb(palette, "coralline", (0.62, 0.26, 0.45))
    pore_d, _ = cells(U * 90.0, V * 90.0, seed + 31)
    pore = 1.0 - smoothstep(0.12, 0.3, pore_d)
    grain = fbm(U * 40.0, V * 40.0, octaves=4, seed=seed + 32)
    albedo = textures.rgba(base, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.85 + 0.3 * grain)
    albedo = textures.mix(albedo, (0.32, 0.28, 0.25), pore * 0.7)
    patches = smoothstep(0.58, 0.7, fbm(U * 6.0 + 2.0, V * 6.0 + 4.0, octaves=3, seed=seed + 33))
    albedo = textures.mix(albedo, coralline, patches * 0.85)
    roughness = 0.82 + 0.1 * pore - 0.15 * patches
    height = 0.5 - 0.35 * pore + 0.1 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 1.6)}


def paint_tentacle(palette: dict, width: int, height: int, seed: int):
    U, V = textures.uv_grid(width, height)
    base = _rgb(palette, "tentacle", (0.85, 0.55, 0.45))
    tip = _rgb(palette, "tentacleTip", (0.95, 0.90, 0.70))
    albedo = textures.rgba(base, 1.0, U.shape)
    albedo = textures.mix(albedo, tip, smoothstep(0.55, 0.9, U))
    grain = fbm(U * 12.0, V * 4.0, octaves=2, seed=seed + 41)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * grain)
    # translucent-looking core: slightly brighter along the tube sides
    albedo = textures.scale_rgb(albedo, 1.0 + 0.08 * np.abs(np.sin(V * math.pi)))
    albedo[..., 3] = 1.0
    roughness = 0.28 + 0.08 * grain
    relief = 0.5 + 0.04 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(relief, 0.6)}


def _write_set(prefix: str, ctx, stem: str, paint: dict, written: list):
    images = {}
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        path = ctx.texture_dir / f"{stem}-{key}.png"
        images[key] = textures.write_image(f"{prefix}_{stem}_{key}", path, paint[key], non_color)
        written.append(path)
    return images


# ---------------------------------------------------------------- geometry

def _add_caps(geometry, segments: int, ring_count: int, u_values):
    """Close an open loft with centre-fan caps wound consistently with its side faces.

    The shared `meshing.loft` caps are wound opposite to the side quads (their normals point into the
    solid, which renders as a dark disc and inverts the tip of every tube), so this species closes its
    lofts locally. Vertex order matches the shared helper: start centre first, end centre second.
    """
    vertices, faces, uvs, face_uvs = geometry
    vertices = list(vertices)
    faces = list(faces)
    uvs = list(uvs)
    face_uvs = list(face_uvs) if face_uvs is not None else None

    def ring_uv(ring: int, s: int):
        return (u_values[ring], s / segments)

    def add_cap(ring: int, reverse: bool):
        base = ring * segments
        center = tuple(sum(vertices[base + s][i] for s in range(segments)) / segments for i in range(3))
        center_index = len(vertices)
        vertices.append(center)
        uvs.append((u_values[ring], 0.5))
        for s in range(segments):
            nxt = (s + 1) % segments
            if reverse:
                faces.append((center_index, base + nxt, base + s))
                if face_uvs is not None:
                    face_uvs.append(((u_values[ring], 0.5), ring_uv(ring, s + 1), ring_uv(ring, s)))
            else:
                faces.append((center_index, base + s, base + nxt))
                if face_uvs is not None:
                    face_uvs.append(((u_values[ring], 0.5), ring_uv(ring, s), ring_uv(ring, s + 1)))

    add_cap(0, reverse=False)
    add_cap(ring_count - 1, reverse=True)
    return vertices, faces, uvs, face_uvs


def build_plate(colony: Colony):
    seg = colony.segments
    n_top, n_rim, n_bot = colony.top_rings, colony.rim_rings, colony.bottom_rings
    thetas = np.arange(seg) / seg * math.tau
    cos_t, sin_t = np.cos(thetas), np.sin(thetas)
    R = colony.outline(thetas)
    rings = []
    # top surface: centre outward, denser toward the rim; ring 0 stays tiny so the centre cap is a pinpoint
    for j in range(n_top):
        rf = ((j + 0.35) / (n_top - 1 + 0.35)) ** 0.85
        x = rf * R * cos_t
        y = rf * R * sin_t
        z = colony.top_z(x, y)
        rings.append([(float(a), float(b), float(c)) for a, b, c in zip(x, y, z)])
    edge_top = colony.top_z(R * cos_t, R * sin_t)
    edge_bot = colony.bottom_z(R * cos_t, R * sin_t)
    for j in range(n_rim):
        t = (j + 1) / (n_rim + 1)
        f = 1.0 + colony.bulge * math.sin(math.pi * t)
        x = f * R * cos_t
        y = f * R * sin_t
        z = edge_top * (1.0 - t) + edge_bot * t
        rings.append([(float(a), float(b), float(c)) for a, b, c in zip(x, y, z)])
    for j in range(n_bot):
        rf = (n_bot - j) / (n_bot + 1)
        x = rf * R * cos_t
        y = rf * R * sin_t
        z = colony.bottom_z(x, y)
        rings.append([(float(a), float(b), float(c)) for a, b, c in zip(x, y, z)])
    n_rings = len(rings)
    u_values = [k / (n_rings - 1) for k in range(n_rings)]
    vertices, faces, uvs, _face_uvs = _add_caps(msh.loft(rings, u_values=u_values, cap_start=False, cap_end=False), seg, n_rings, u_values)
    tissue_rings = n_top + n_rim  # faces whose upper ring index is below this are tissue
    face_materials = []
    for f_index in range(len(faces)):
        if f_index < (n_rings - 1) * seg:
            ring_index = f_index // seg
            face_materials.append("tissue" if ring_index + 1 <= tissue_rings - 1 else "skeleton")
        elif f_index < (n_rings - 1) * seg + seg:
            face_materials.append("tissue")   # top centre cap
        else:
            face_materials.append("skeleton")  # bottom centre cap
    half = colony.uv_half

    def planar(v):
        return (0.5 + v[0] / (2.0 * half), 0.5 + v[1] / (2.0 * half))

    face_uvs = [tuple(planar(vertices[i]) for i in face) for face in faces]
    # skin weights: mound tissue leans on its polyp bone, everything else is rigid to Base
    xs = np.array([v[0] for v in vertices])
    ys = np.array([v[1] for v in vertices])
    influence = colony.tissue_influence(xs, ys)
    top_count = tissue_rings * seg
    cap_top = n_rings * seg

    def weights(index, _v):
        if index < top_count or index == cap_top:
            out = {}
            total = 0.0
            for i, c in enumerate(colony.corallites):
                w = float(influence[i, index])
                if w > 1e-4:
                    out[c["bone"]] = w
                    total += w
            out["Base"] = max(1.0 - total, 0.3)
            return out
        return {"Base": 1.0}

    groups = {"plate_top": set(range(top_count)) | {cap_top}, "plate_bottom": set(range(top_count, n_rings * seg)) | {cap_top + 1}}
    part = msh.make_part("plate", (vertices, faces, uvs, face_uvs), "tissue", weights, closed=True, groups=groups)
    # make_part may reverse every face for outward normals; face order is preserved, so the list stays aligned
    part.face_materials = face_materials
    return part


def build_rock(colony: Colony):
    seg, n = colony.rock_segments, colony.rock_rings
    thetas = np.arange(seg) / seg * math.tau
    cos_t, sin_t = np.cos(thetas), np.sin(thetas)
    rings = []
    for j in range(n):
        t = j / (n - 1)
        z = colony.rock_height * t
        # radius shrinks toward the top and wobbles periodically around the rim
        base_r = colony.rock_radius * (1.0 - 0.28 * t * t) * (0.9 + 0.1 * math.cos(math.pi * t))
        wob = fbm(cos_t * 1.6 + 3.0 + t * 0.8, sin_t * 1.6 + 5.0 + t * 1.9, octaves=2, seed=colony.seed + 51)
        radius = base_r * (1.0 + colony.rock_roughness * (wob - 0.5) * 2.0)
        rings.append([(float(radius[k] * cos_t[k]), float(radius[k] * sin_t[k]), float(z)) for k in range(seg)])
    u_values = [k / (n - 1) for k in range(n)]
    geometry = _add_caps(msh.loft(rings, u_values=u_values, cap_start=False, cap_end=False), seg, n, u_values)
    return msh.make_part("rock", geometry, "skeleton", lambda i, v: {"Base": 1.0}, closed=True,
                         uv_transform=lambda u, v: (u * 0.12, v))


def build_tentacles(colony: Colony):
    parts = []
    tuft_groups: dict[str, set[int]] = {}
    for c, k, points, radii, fractions in colony.tentacles():
        geometry = _add_caps(msh.tube(points, radii, 6, cap_start=False, cap_end=False, up_hint=(1.0, 0.0, 0.0), u_values=list(fractions)),
                             6, len(points), list(fractions))
        name = f"tentacle_{c['index']:02d}_{k:02d}"
        group = f"tuft_{c['index']:02d}"
        part = msh.make_part(name, geometry, "tentacle", lambda i, v, b=c["bone"]: {b: 1.0}, closed=True,
                             groups={group: set(range(len(geometry[0])))})
        parts.append(part)
        tuft_groups.setdefault(group, set())
    return parts, sorted(tuft_groups)


# ---------------------------------------------------------------- animation

def build_clips(spec: dict, colony: Colony) -> list[ClipSpec]:
    clips = []
    for name, clip in spec["animation"].items():
        loop = bool(clip["loop"])
        env = None if loop else clip.get("envelope", "hold")
        channels: list[Channel] = []
        tilt = float(clip.get("tilt", 0.0))
        flutter = float(clip.get("flutter", 0.0))
        shrink = clip.get("shrink")
        sink = float(clip.get("sink", 0.0))
        curl = float(clip.get("curl", 0.0))
        spread = float(clip.get("phaseSpread", 1.0))
        for c in colony.corallites:
            bone = c["bone"]
            if tilt:
                channels.append(Channel(bone, "rotation", (1.0, 0.0, 0.0), tilt * c["gain"], float(clip.get("tiltFrequency", 1)),
                                        c["phase"] * spread, bias=float(clip.get("lean", 0.0)), envelope=env))
            if flutter:
                channels.append(Channel(bone, "rotation", (0.0, 0.0, 1.0), flutter * c["gain"], float(clip.get("flutterFrequency", 2)),
                                        c["phase"] * 1.7 + 0.9, envelope=env))
            if shrink:
                channels.append(Channel(bone, "scale", tuple(-float(s) for s in shrink), 1.0, 1.0, 0.0, waveform="const", envelope=env))
            if sink:
                channels.append(Channel(bone, "location", (0.0, 1.0, 0.0), -sink, 1.0, 0.0, waveform="const", envelope=env))
            if curl:
                channels.append(Channel(bone, "rotation", (1.0, 0.0, 0.0), curl * c["curl"] * c["gain"], 1.0, 0.0, waveform="const", envelope=env))
        clips.append(ClipSpec(name, int(clip["frames"]), loop, channels))
    return clips


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    colony = Colony(spec)
    palette = spec.get("palette", {})
    tex = spec.get("textures", {})

    # ---- textures and materials
    written: list = []
    tissue_images = _write_set(prefix, ctx, "tissue", paint_tissue(colony, palette, int(tex.get("tissueResolution", 1024)), colony.seed,
                                                                    spec.get("pattern", {})), written)
    skeleton_images = _write_set(prefix, ctx, "skeleton", paint_skeleton(palette, int(tex.get("skeletonResolution", 512)), colony.seed), written)
    tw, th = tex.get("tentacleResolution", [256, 64])
    tentacle_images = _write_set(prefix, ctx, "tentacle", paint_tentacle(palette, int(tw), int(th), colony.seed), written)
    tissue = mat.principled(f"{prefix}_Tissue", _rgb(palette, "tissue", (0.6, 0.1, 0.15)), 0.4, coat=0.15, subsurface=0.08, specular=0.45)
    mat.attach_textures(tissue, albedo=tissue_images["albedo"], roughness=tissue_images["roughness"], normal=tissue_images["normal"],
                        normal_strength=float(tex.get("tissueNormalStrength", 1.0)))
    skeleton = mat.principled(f"{prefix}_Skeleton", _rgb(palette, "skeleton", (0.66, 0.62, 0.55)), 0.85, coat=0.0, subsurface=0.0, specular=0.3)
    mat.attach_textures(skeleton, albedo=skeleton_images["albedo"], roughness=skeleton_images["roughness"], normal=skeleton_images["normal"],
                        normal_strength=float(tex.get("skeletonNormalStrength", 1.0)))
    tentacle = mat.principled(f"{prefix}_Tentacle", _rgb(palette, "tentacle", (0.85, 0.55, 0.45)), 0.3, coat=0.2, subsurface=0.15, specular=0.5)
    mat.attach_textures(tentacle, albedo=tentacle_images["albedo"], roughness=tentacle_images["roughness"], normal=tentacle_images["normal"],
                        normal_strength=0.5)
    material_map = {"tissue": tissue, "skeleton": skeleton, "tentacle": tentacle}

    # ---- rig: static Base plus one polyp bone per corallite
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, 0.0), (0.012, 0.0, 0.0), deform=False)
    rb.bone("Base", (0.0, 0.0, 0.0), (0.0, 0.0, colony.rock_height), "Root", roll_up=(1.0, 0.0, 0.0))
    head_depth = float(spec["morphology"].get("polypBoneDepth", 0.0015))
    for c in colony.corallites:
        head = (c["pitX"], c["pitY"], c["pitZ"] - head_depth)
        rb.bone(c["bone"], head, (head[0], head[1], head[2] + 0.006), "Base", roll_up=(1.0, 0.0, 0.0))
    rig = rb.finish()

    # ---- meshes
    plate = build_plate(colony)
    rock = build_rock(colony)
    colony_obj = msh.assemble(f"{prefix}_Colony", [plate, rock], material_map, rig, f"{prefix}_Armature", preserve_volume=False)
    colony_obj["lod"] = 1
    colony_obj["colonyWidthMeters"] = spec["referenceSize"]["meters"]
    tentacle_parts, tuft_names = build_tentacles(colony)
    tentacles_obj = msh.assemble(f"{prefix}_Tentacles", tentacle_parts, material_map, rig, f"{prefix}_Armature", preserve_volume=False)
    tentacles_obj["lod"] = 1

    # ---- animation
    clips = build_clips(spec, colony)
    for clip in clips:
        bake_clip(rig, clip, mesh_objects={colony_obj.name: colony_obj, tentacles_obj.name: tentacles_obj})

    # ---- contract
    meshes = [colony_obj, tentacles_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="xy")
    contract["closedParts"].append({"object": colony_obj.name, "group": "part_plate", "volumeFloor": 0.8})
    contract["closedParts"].append({"object": colony_obj.name, "group": "part_rock", "volumeFloor": 0.9})
    for i, first in enumerate(tuft_names):
        contract["clearance"].append({"a": [tentacles_obj.name, first], "b": [colony_obj.name, "part_rock"], "label": f"{first}_rock"})
        for second in tuft_names[i + 1:]:
            contract["clearance"].append({"a": [tentacles_obj.name, first], "b": [tentacles_obj.name, second], "label": f"{first}_{second}"})
    register_clips(contract, clips)

    triangles = sum(len(face) - 2 for part in (plate, rock, *tentacle_parts) for face in part.faces)
    notes = {
        "corallites": len(colony.corallites),
        "tentacles": len(tentacle_parts),
        "plateRadiusMaxMeters": colony.R_max,
        "sourceTrianglesEstimate": triangles,
        "founderCorallite": {"x": colony.corallites[0]["x"], "y": colony.corallites[0]["y"], "radius": colony.corallites[0]["radius"]},
    }
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
