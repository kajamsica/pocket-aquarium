"""Pterapogon kauderni (Banggai cardinalfish): silver body, three black bars, white-spangled black fins.

Anatomy (all geometry is driven by asset.source.json through the shared fish plan):
- Short, deep, strongly compressed apogonid body (SL/BH 2.07 after Ndobe et al. 2013), large head with a
  big lateral eye and a large oblique terminal mouth, short defined caudal peduncle.
- Two separate dorsal fins with their own bones: `dorsal1` (bone Dorsal1) is the tall pointed tasseled
  spinous fin above the pectoral base; `dorsal2` (bone Dorsal2) is the spike-like soft fin whose anterior
  ray trails far back over the tail (lean + pinch shear the sheet so only the tall anterior rays lean).
- Long pointed anal fin opposite the second dorsal, enlarged pointed pelvic fins reaching the anal origin,
  clear pectorals, and a deeply forked caudal fin with long pointed lobes.

Paint (this module):
- paint_body: silver flank shading to steel on the back and pearl on the belly; bar 1 through the eye,
  bar 2 from the first-dorsal origin to the pelvic base, bar 3 from the second-dorsal origin to the anal
  origin, each with a thin pale rim; white spots dense behind bar 3, sparse between bars 2 and 3, none
  on the head; spots are laid out in approximate world metres so they stay round on the flank.
- paint_fin: first dorsal black with pale tassel tips; second dorsal, anal and pelvic black with white
  spots; caudal with white-spotted black lobe margins over a smoky translucent centre; pectoral clear.
- extra_channels: a slow pitch sway on the Dorsal2 and Anal bones so the long rays trail in the water.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import paint, textures
from ..lib.animation import Channel
from ..lib.noise import cells, fbm, smoothstep

SILVER = (0.66, 0.68, 0.70)
STEEL = (0.36, 0.40, 0.46)
PEARL = (0.86, 0.87, 0.88)
INK = (0.008, 0.008, 0.011)
WHITE = (0.94, 0.95, 0.97)
SMOKE = (0.30, 0.31, 0.34)
CLEAR = (0.72, 0.75, 0.78)

# bar centres in body metres (x, forward +X): eye bar, first-dorsal bar, second-dorsal bar
BAR_CENTERS = (0.022, 0.0095, -0.0045)
BAR_HALF_WIDTHS = (0.0026, 0.0020, 0.0022)
BAR_TILTS = (0.0, 0.001, 0.0003)  # anterior shift of the bar top relative to its bottom

RAY_COUNTS = {"dorsal1": 8, "dorsal2": 15, "anal": 15, "caudal": 17, "pectoral": 13, "pelvic": 6}
SPOT_CELL = 0.0021  # metres between spot lattice points (spots ~0.7 mm across)


def _spots(u_world, v_world, seed: int, radius: float = 0.17, jitter: float = 0.3):
    """Round white spots on a jittered lattice laid out in approximate world metres.

    Returns (spot mask, per-spot keep value in [0, 1)) so callers can thin spots by region."""
    distance, ident = cells(u_world / SPOT_CELL, v_world / SPOT_CELL, seed)
    size = radius * (1.0 - jitter + 2.0 * jitter * ident)
    keep = (ident * 7.31) % 1.0
    return 1.0 - smoothstep(size * 0.68, size, distance), keep


# ---------------------------------------------------------------- body

def paint_body(ctx):
    U, V, Z, X, SIDE = ctx.U, ctx.V, ctx.ZETA, ctx.X, ctx.SIDE
    body = ctx.body
    dorsal = np.array([body.dorsal(x) for x in X[0]])[None, :]
    ventral = np.array([body.ventral(x) for x in X[0]])[None, :]
    # approximate world height on the flank so spots stay round and the bars stay vertical
    ZW = np.where(Z >= 0, Z * dorsal, Z * ventral)
    flank = 1.0 - smoothstep(0.80, 0.97, np.abs(Z))

    base = textures.rgba(SILVER, 1.0, ctx.shape)
    albedo = textures.mix(base, STEEL, smoothstep(0.25, 1.0, Z) * 0.55)
    albedo = textures.mix(albedo, PEARL, smoothstep(-0.35, -1.0, Z) * 0.6)
    sheen = fbm(U * 26.0, V * 12.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * sheen)
    # slightly darker forehead and snout
    albedo = textures.mix(albedo, STEEL, smoothstep(0.93, 1.0, U) * smoothstep(0.1, 0.9, Z) * 0.18)

    # three black bars whose edges wander gently with height, each with a thin pale rim
    wobble = (fbm(Z * 2.5 + 7.0, U * 40.0, octaves=2, seed=11) - 0.5) * 0.0007
    bars = np.zeros_like(U)
    rims = np.zeros_like(U)
    for center, half, tilt in zip(BAR_CENTERS, BAR_HALF_WIDTHS, BAR_TILTS):
        offset = np.abs(X + wobble - (center + tilt * Z))
        bars = np.maximum(bars, 1.0 - smoothstep(half - 0.00035, half + 0.00035, offset))
        rims = np.maximum(rims, paint.band(offset, half + 0.0006, 0.00035, 0.00025))
    albedo = textures.mix(albedo, PEARL, rims * 0.55)
    albedo = textures.mix(albedo, INK, bars)

    # white spots: dense on the posterior flank and peduncle, sparse between bars 2 and 3, none on the head
    spot_l, keep_l = _spots(X, ZW, seed=31)
    spot_r, keep_r = _spots(X, ZW, seed=57)
    spots = np.where(SIDE > 0, spot_r, spot_l)
    keep = np.where(SIDE > 0, keep_r, keep_l)
    behind = 1.0 - smoothstep(-0.0075, -0.0015, X)
    between = smoothstep(-0.0075, -0.0015, X) * (1.0 - smoothstep(0.0065, 0.0105, X))
    probability = 0.85 * behind + 0.30 * between
    spots = spots * (keep < probability) * (1.0 - bars) * flank
    albedo = textures.mix(albedo, WHITE, spots * 0.92)

    height = paint.scales_height(U, V, 90, 34, seed=5) * 0.6 + 0.2 * fbm(U * 60, V * 30, 2, seed=8)
    roughness = 0.30 + 0.10 * height + 0.14 * bars - 0.06 * spots
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.8)}


# ---------------------------------------------------------------- fins

def _fin_spec(ctx) -> dict:
    for fin in ctx.spec["morphology"]["fins"]:
        if fin["name"] == ctx.fin:
            return fin
    return {}


def _fin_world(ctx, fin: dict):
    """Approximate (along-base, base-to-edge) world metres for a fin tile so spots stay round."""
    U, V = ctx.U, ctx.V
    kind = fin.get("type")
    if kind == "median":
        xs = [p[0] for p in fin["heights"]]
        hs = [p[1] for p in fin["heights"]]
        return U * abs(float(fin["xEnd"]) - float(fin["xStart"])), V * np.interp(U, xs, hs)
    if kind == "caudal":
        span = float(fin["spanTop"]) + float(fin["spanBottom"])
        centre_offset = np.abs(2.0 * U - 1.0)
        reach = float(fin["length"]) * np.maximum(1.0 - float(fin.get("fork", 0.0)) * (1.0 - centre_offset ** float(fin.get("forkPower", 1.6))), 0.12)
        return U * span, V * reach
    taper = float(fin.get("taper", 0.3))
    extension = taper + (1.0 - taper) * np.sin(np.pi * U) ** float(fin.get("power", 0.7))
    return U * float(fin["rootLength"]) * (1.0 + float(fin.get("flare", 0.6)) * V), V * float(fin["length"]) * extension


def _ray_relief(ctx, count: float, leading_boost: float = 0.0):
    """Ray ridges base -> edge, softer at the root; `leading_boost` thickens the anterior (U -> 1) rays."""
    U, V = ctx.U, ctx.V
    ridges = (0.5 + 0.5 * np.cos(U * math.tau * count)) ** 1.6
    membrane = fbm(U * 18.0, V * 6.0, octaves=2, seed=41)
    root_fade = 0.3 + 0.7 * smoothstep(0.0, 0.3, V)
    boost = 1.0 + leading_boost * smoothstep(0.6, 1.0, U)
    return np.clip(0.35 + 0.45 * ridges * root_fade * boost + 0.1 * (membrane - 0.5), 0.0, 1.0)


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    fin = _fin_spec(ctx)
    count = float(RAY_COUNTS.get(ctx.fin, 12))
    ray = paint.rays(U, count, 5.0)
    edge_fade = smoothstep(0.86, 1.0, V)
    height = _ray_relief(ctx, count)

    if ctx.fin == "pectoral":
        albedo = textures.rgba(CLEAR, 0.34, ctx.shape)
        albedo = textures.mix(albedo, (0.52, 0.55, 0.60), 0.35 * ray)
        albedo[..., 3] = 0.30 + 0.14 * ray - 0.12 * edge_fade
        return {"albedo": albedo, "height": height}

    if ctx.fin == "dorsal1":
        albedo = textures.rgba(INK, 1.0, ctx.shape)
        albedo = textures.mix(albedo, SMOKE, 0.25 * ray * V)
        # tasseled spine tips: pale soft tags at the end of each spine
        tassel = smoothstep(0.88, 1.0, V) * paint.rays(U, count, 3.0)
        albedo = textures.mix(albedo, (0.62, 0.63, 0.66), tassel * 0.7)
        albedo[..., 3] = 0.97 - 0.10 * edge_fade
        return {"albedo": albedo, "height": _ray_relief(ctx, count, 0.3)}

    u_world, v_world = _fin_world(ctx, fin)
    seed = {"dorsal2": 71, "anal": 83, "caudal": 97, "pelvic": 113}.get(ctx.fin, 127)
    spots, keep = _spots(u_world, v_world, seed=seed, radius=0.2)

    if ctx.fin in ("dorsal2", "anal"):
        albedo = textures.rgba(INK, 1.0, ctx.shape)
        # the posterior short rays carry a smoky, slightly translucent membrane; the anterior rays stay solid black
        posterior = 1.0 - smoothstep(0.45, 0.85, U)
        albedo = textures.mix(albedo, SMOKE, (1.0 - ray) * 0.45 * posterior)
        # white spots sit on the basal two thirds of the fin, mostly along the anterior rays
        spot_zone = (1.0 - smoothstep(0.55, 0.8, V)) * smoothstep(0.03, 0.10, V) * (0.35 + 0.65 * smoothstep(0.3, 0.7, U))
        spots = spots * (keep < 0.8 * spot_zone)
        albedo = textures.mix(albedo, WHITE, spots * 0.95)
        albedo[..., 3] = 0.96 - 0.22 * posterior * (1.0 - ray) - 0.08 * edge_fade
        return {"albedo": albedo, "height": _ray_relief(ctx, count, 0.6)}

    if ctx.fin == "caudal":
        # white-spotted black lobe margins over a smoky translucent centre
        lobe = smoothstep(0.62, 0.90, np.abs(2.0 * U - 1.0))
        albedo = textures.rgba(SMOKE, 1.0, ctx.shape)
        albedo = textures.mix(albedo, (0.42, 0.44, 0.47), 0.4 * ray)
        albedo = textures.mix(albedo, INK, lobe)
        # dark band along the fin base where bar pigment continues onto the rays
        albedo = textures.mix(albedo, INK, (1.0 - smoothstep(0.0, 0.12, V)) * 0.7)
        spots = spots * (keep < 0.75 * lobe) * smoothstep(0.08, 0.18, V) * (1.0 - smoothstep(0.85, 0.97, V))
        albedo = textures.mix(albedo, WHITE, spots * 0.95)
        albedo[..., 3] = 0.52 + 0.44 * lobe - 0.10 * edge_fade
        return {"albedo": albedo, "height": height}

    # pelvic: enlarged black fin spangled with white spots
    albedo = textures.rgba(INK, 1.0, ctx.shape)
    albedo = textures.mix(albedo, SMOKE, 0.2 * ray)
    spots = spots * (keep < 0.7) * smoothstep(0.05, 0.15, V) * (1.0 - smoothstep(0.8, 0.95, V))
    albedo = textures.mix(albedo, WHITE, spots * 0.95)
    albedo[..., 3] = 0.96 - 0.10 * edge_fade
    return {"albedo": albedo, "height": height}


# ---------------------------------------------------------------- animation

def extra_channels(clip_name: str, spec: dict, envelope):
    """Slow pitch sway of the long second-dorsal and anal rays (about the fin bones' local X)."""
    clip = spec["animation"][clip_name]
    frequency = float(clip.get("axialFrequency", 1.0))
    sway = {"idle": 1.5, "swim": 2.4, "burst": 4.0}.get(clip_name, 1.5)
    return [
        Channel("Dorsal2", "rotation", (1.0, 0.0, 0.0), sway, frequency, 0.9, envelope=envelope),
        Channel("Anal", "rotation", (1.0, 0.0, 0.0), -sway * 0.8, frequency, 0.9 + math.pi, envelope=envelope),
    ]
