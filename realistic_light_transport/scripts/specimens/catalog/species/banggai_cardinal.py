"""Pterapogon kauderni (Banggai cardinalfish): blue-grey silver body, three black bars, ornamental black fins.

Anatomy (all geometry is driven by asset.source.json through the shared fish plan, proportions measured on
the NOAA Fisheries species illustration):
- Short, deep, strongly compressed apogonid body (bony torso SL/BH about 1.95), steep straight forehead,
  deep abrupt chest, large head with a big lateral eye seated in the head bar (`eyes.seat`) and a broad
  oblique terminal mouth, very short thick caudal peduncle.
- Eight fins: `dorsal1` (bone Dorsal1) is the tall black spinous sail whose leading spines bow backward into
  hooks (`curve`); `dorsal2` (Dorsal2) is the large pale swept soft-dorsal sail and `dorsal2_ray`
  (Dorsal2Ray) the thick black anterior ray that runs out as a bowed filament far behind the body; `anal`
  (Anal) is the pale anal sail and `anal_ray` (AnalRay) the broad tapering black anterior lobe in front of
  it; `pelvic` the broad rounded black spotted lobe under the anterior belly; `pectoral` clear; `caudal`
  with long black upper and lower bands framing a pale deeply forked centre.

Paint (this module):
- paint_body: blue-grey metallic silver shading to steel on the back and pearl on the belly with cool
  scale-facet shimmer; a painted oblique gape cleft with a shaded lower jaw; bar 1 through the eye (wider
  over the forehead), bar 2 from the first-dorsal origin to the pelvic base, bar 3 tilted from the
  second-dorsal origin back to the anal origin, each with a faint pale rim and wandering edges; irregular
  white spots dense behind bar 3 and on the peduncle, moderate between bars 2 and 3, sparse low on the
  shoulder, none on the head; spots are laid out in approximate world metres so they stay round.
- paint_fin: first dorsal black with the membrane between the leading spines pale and dissolving toward
  the hooked tips; second-dorsal and anal sails pale translucent with grey rays and faint spots; the
  second-dorsal ray, anal lobe, pelvic lobe and caudal bands black with white spots; caudal centre pale
  translucent; pectoral clear.
- extra_channels: slow sway on the filament bones (Dorsal2Ray, AnalRay) and a smaller one on the sails so
  the ornamental rays trail and flex in the water.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import paint, textures
from ..lib.animation import Channel
from ..lib.noise import cells, fbm, smoothstep

SILVER = (0.44, 0.50, 0.60)
STEEL = (0.28, 0.33, 0.42)
PEARL = (0.80, 0.83, 0.88)
WARM = (0.66, 0.65, 0.63)
COOL = (0.55, 0.64, 0.84)
INK = (0.01, 0.01, 0.01)
WHITE = (0.94, 0.95, 0.97)
SMOKE = (0.30, 0.31, 0.34)
CLEAR = (0.72, 0.75, 0.78)
PALE = (0.80, 0.84, 0.90)
RAY_GREY = (0.40, 0.44, 0.52)
TASSEL = (0.72, 0.75, 0.80)

# bar centres in body metres (x, forward +X): eye bar, first-dorsal bar, second-dorsal bar. Bar 3 tilts so
# its top sits at the second-dorsal origin and its bottom at the anal origin 3 mm further back; bar 1 is
# widest over the forehead and narrows under the eye
BAR_CENTERS = (0.0244, 0.0126, -0.0016)
BAR_HALF_WIDTHS = (0.0033, 0.0026, 0.0023)
BAR_TILTS = (0.0003, 0.0002, 0.0012)  # anterior shift of the bar top relative to its bottom
BAR_FLARES = (0.0008, 0.0003, 0.0)  # extra half-width at the dorsal ridge

RAY_COUNTS = {"dorsal1": 8, "dorsal2": 14, "dorsal2_ray": 1, "anal": 10, "anal_ray": 5, "caudal": 17, "pectoral": 13, "pelvic": 6}
BODY_SPOT_CELL = 0.0016  # metres between body spot lattice points (spots ~0.5 mm across)
FIN_SPOT_CELL = 0.0013  # fins carry a denser spangle than the flank


def _spots(u_world, v_world, seed: int, radius: float = 0.17, jitter: float = 0.5, cell: float = BODY_SPOT_CELL):
    """Round white spots on a jittered lattice laid out in approximate world metres.

    Returns (spot mask scaled by a per-spot brightness, per-spot keep value) so callers can thin spots by
    region with `keep < probability`. Spot size, brightness and local density all vary so the lattice never
    reads as a mechanical grid."""
    distance, ident = cells(u_world / cell, v_world / cell, seed)
    size = radius * (1.0 - jitter + 2.0 * jitter * ident)
    brightness = 0.6 + 0.4 * ((ident * 3.17) % 1.0)
    drift = (fbm(u_world / (cell * 5.0), v_world / (cell * 5.0), octaves=2, seed=seed + 5) - 0.5) * 0.6
    keep = ((ident * 7.31) % 1.0) + drift
    return (1.0 - smoothstep(size * 0.55, size, distance)) * brightness, keep


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
    albedo = textures.mix(base, STEEL, smoothstep(0.2, 1.0, Z) * 0.6)
    albedo = textures.mix(albedo, PEARL, smoothstep(-0.3, -1.0, Z) * 0.4)
    # scale-sized facets lean cool blue on the upper flank and faintly warm low on the mid flank so the
    # silver reads as iridescent metal rather than one flat grey
    shimmer = fbm(U * 48.0, V * 20.0, octaves=2, seed=13)
    albedo = textures.mix(albedo, COOL, smoothstep(0.5, 0.85, shimmer) * smoothstep(-0.7, 0.6, Z) * 0.5)
    albedo = textures.mix(albedo, WARM, smoothstep(0.5, 0.15, shimmer) * smoothstep(-0.9, -0.2, Z) * (1.0 - smoothstep(0.3, 0.8, Z)) * 0.25)
    sheen = fbm(U * 26.0, V * 12.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.82 + 0.32 * sheen)
    # darker forehead and nape
    albedo = textures.mix(albedo, STEEL, smoothstep(0.86, 1.0, U) * smoothstep(0.1, 0.9, Z) * 0.25)
    # broad oblique terminal gape: a dark cleft from the snout tip back and down toward the jaw angle
    # under the front of the eye, tapering as it goes; the shared plan's lip tubes sit at its anterior end
    # and the lower jaw below it sits a shade darker so the jaw reads as a volume rather than a line
    cleft_z = -0.0005 - (body.head_x - X) / 0.0054 * 0.003
    cleft_width = 0.00045 * (1.0 - 0.55 * smoothstep(0.0318, 0.0274, X))
    cleft = paint.band(ZW - cleft_z, 0.0, cleft_width, 0.00015)
    cleft = cleft * smoothstep(0.0270, 0.0280, X) * (1.0 - smoothstep(0.85, 0.97, np.abs(Z)))
    albedo = textures.mix(albedo, INK, cleft)
    jaw = smoothstep(0.0282, 0.0305, X) * smoothstep(cleft_z - 0.0018, cleft_z - 0.0004, ZW) * (1.0 - smoothstep(cleft_z - 0.0002, cleft_z + 0.0002, ZW))
    albedo = textures.mix(albedo, STEEL, jaw * 0.4)

    # three black bars whose edges wander with height, each with a faint pale rim
    wobble = (fbm(Z * 2.5 + 7.0, U * 40.0, octaves=2, seed=11) - 0.5) * 0.0011
    bars = np.zeros_like(U)
    rims = np.zeros_like(U)
    for center, half, tilt, flare in zip(BAR_CENTERS, BAR_HALF_WIDTHS, BAR_TILTS, BAR_FLARES):
        offset = np.abs(X + wobble - (center + tilt * Z))
        width = half + flare * smoothstep(0.0, 1.0, Z)
        bars = np.maximum(bars, 1.0 - smoothstep(width - 0.00035, width + 0.00035, offset))
        rims = np.maximum(rims, paint.band(offset, width + 0.0006, 0.00035, 0.00025))
    albedo = textures.mix(albedo, PEARL, rims * 0.4)
    albedo = textures.mix(albedo, INK, bars)

    # white spots: dense on the posterior flank and peduncle, moderate between bars 2 and 3, a few low on
    # the shoulder between bars 1 and 2, none on the head
    spot_l, keep_l = _spots(X, ZW, seed=31, radius=0.17)
    spot_r, keep_r = _spots(X, ZW, seed=57, radius=0.17)
    spots = np.where(SIDE > 0, spot_r, spot_l)
    keep = np.where(SIDE > 0, keep_r, keep_l)
    behind = 1.0 - smoothstep(-0.006, -0.001, X)
    between = smoothstep(-0.006, -0.001, X) * (1.0 - smoothstep(0.007, 0.011, X))
    shoulder = smoothstep(0.007, 0.011, X) * (1.0 - smoothstep(0.019, 0.022, X)) * (1.0 - smoothstep(-0.3, 0.3, Z))
    probability = 0.75 * behind + 0.45 * between + 0.14 * shoulder
    spots = spots * (keep < probability) * (1.0 - bars) * flank
    albedo = textures.mix(albedo, WHITE, spots * 0.9)

    height = paint.scales_height(U, V, 96, 36, seed=5) * 0.6 + 0.2 * fbm(U * 60, V * 30, 2, seed=8)
    # silver reads glossy and scale-modulated so the flank shimmers; the bars stay matte so they read as
    # neutral black under the workbench key light instead of greying out with specular
    roughness = 0.14 + 0.16 * height + 0.28 * bars - 0.04 * spots
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


# ---------------------------------------------------------------- fins

def _fin_spec(ctx) -> dict:
    for fin in ctx.spec["morphology"]["fins"]:
        if fin["name"] == ctx.fin:
            return fin
    return {}


def _fin_world(ctx, fin: dict):
    """Approximate (along-base, base-to-edge) world metres for a fin tile so spots stay round.

    Median sheets follow the plan's shear (x = base + t * (lean + (0.5 - s) * pinch) + curve * t^2 * h/peak)
    so spots on the swept sails, the bowed filament and the anal lobe are round instead of streaks."""
    U, V = ctx.U, ctx.V
    kind = fin.get("type")
    if kind == "median":
        xs = [p[0] for p in fin["heights"]]
        hs = [p[1] for p in fin["heights"]]
        height = np.interp(U, xs, hs)
        shear = float(fin.get("lean", 0.0)) + (0.5 - U) * float(fin.get("pinch", 0.0))
        bow = float(fin.get("curve", 0.0)) * V * height / max(hs)
        return U * abs(float(fin["xEnd"]) - float(fin["xStart"])) + V * (shear + bow), V * height
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


def _pale_sail(ctx, ray, edge_fade, spots, keep):
    """Translucent pale sail with grey rays and a faint spangle along the rays near the base."""
    albedo = textures.rgba(PALE, 1.0, ctx.shape)
    albedo = textures.mix(albedo, RAY_GREY, 0.55 * ray)
    spots = spots * (keep < 0.3) * smoothstep(0.05, 0.2, ctx.V) * (1.0 - smoothstep(0.6, 0.9, ctx.V))
    albedo = textures.mix(albedo, WHITE, spots * 0.7)
    albedo[..., 3] = 0.48 + 0.22 * ray + 0.2 * spots - 0.2 * edge_fade
    return albedo


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

    u_world, v_world = _fin_world(ctx, fin)
    seed = {"dorsal1": 61, "dorsal2": 71, "dorsal2_ray": 73, "anal": 83, "anal_ray": 89, "caudal": 97, "pelvic": 113}.get(ctx.fin, 127)
    spots, keep = _spots(u_world, v_world, seed=seed, radius=0.22, cell=FIN_SPOT_CELL)

    if ctx.fin == "dorsal1":
        albedo = textures.rgba(INK, 1.0, ctx.shape)
        albedo = textures.mix(albedo, SMOKE, 0.2 * ray * V)
        # the leading two spines stand apart: the membrane between them is pale and translucent and
        # dissolves toward the hooked tips so the spines read as separate bowed rays; the sail behind
        # stays solid black with a sparse spangle low on the membrane
        filament = paint.rays(U, count, 9.0)
        leading = smoothstep(0.68, 0.8, U)
        web = leading * (1.0 - filament)
        albedo = textures.mix(albedo, TASSEL, web * 0.85)
        albedo = textures.mix(albedo, (0.40, 0.42, 0.46), filament * leading * smoothstep(0.3, 0.9, V) * 0.6)
        dissolve = smoothstep(0.45, 0.8, V) * leading
        spots = spots * (keep < 0.45 * smoothstep(0.15, 0.4, V) * (1.0 - leading)) * (1.0 - smoothstep(0.7, 0.85, V))
        albedo = textures.mix(albedo, WHITE, spots * 0.9)
        albedo[..., 3] = np.clip(0.97 - 0.45 * web - dissolve * (1.0 - filament) * 0.5 - 0.05 * edge_fade, 0.0, 1.0)
        return {"albedo": albedo, "height": _ray_relief(ctx, count, 0.4)}

    if ctx.fin in ("dorsal2", "anal"):
        return {"albedo": _pale_sail(ctx, ray, edge_fade, spots, keep), "height": height}

    if ctx.fin == "dorsal2_ray":
        # thick black anterior ray running out as a filament, dotted white along its length
        albedo = textures.rgba(INK, 1.0, ctx.shape)
        spots = spots * (keep < 0.6) * smoothstep(0.04, 0.12, V) * (1.0 - smoothstep(0.85, 0.97, V))
        albedo = textures.mix(albedo, WHITE, spots * 0.9)
        albedo[..., 3] = np.full(ctx.shape, 0.98)
        return {"albedo": albedo, "height": np.full(ctx.shape, 0.6)}

    if ctx.fin == "anal_ray":
        # broad tapering black lobe with blue-white spots growing larger toward the tip
        albedo = textures.rgba(INK, 1.0, ctx.shape)
        albedo = textures.mix(albedo, SMOKE, 0.15 * ray)
        big, keep_big = _spots(u_world, v_world, seed=seed + 2, radius=0.27, cell=FIN_SPOT_CELL * 1.25)
        spots = np.maximum(spots * (keep < 0.45), big * (keep_big < 0.55) * smoothstep(0.35, 0.7, V))
        spots = spots * smoothstep(0.05, 0.15, V) * (1.0 - smoothstep(0.88, 0.98, V))
        albedo = textures.mix(albedo, (0.80, 0.85, 0.94), spots * 0.9)
        albedo[..., 3] = 0.97 - 0.06 * edge_fade
        return {"albedo": albedo, "height": _ray_relief(ctx, count, 0.4)}

    if ctx.fin == "caudal":
        # long black upper and lower bands with white spots framing a pale translucent forked centre; the
        # bands narrow toward the lobe tips so they read as two slender black extensions
        inner = 0.36 + 0.34 * V
        band = smoothstep(inner, inner + 0.14, np.abs(2.0 * U - 1.0))
        albedo = textures.rgba(PALE, 1.0, ctx.shape)
        albedo = textures.mix(albedo, RAY_GREY, 0.5 * ray)
        albedo = textures.mix(albedo, INK, band)
        spots = spots * (keep < 0.7 * band) * smoothstep(0.08, 0.18, V) * (1.0 - smoothstep(0.88, 0.98, V))
        albedo = textures.mix(albedo, WHITE, spots * 0.92)
        albedo[..., 3] = 0.42 + 0.2 * ray * (1.0 - band) + 0.56 * band - 0.12 * edge_fade * (1.0 - band)
        return {"albedo": albedo, "height": height}

    # pelvic: broad rounded black lobe densely covered with large white spots
    albedo = textures.rgba(INK, 1.0, ctx.shape)
    albedo = textures.mix(albedo, SMOKE, 0.12 * ray)
    big, keep_big = _spots(u_world, v_world, seed=seed + 4, radius=0.3, cell=FIN_SPOT_CELL * 1.3)
    spots = np.maximum(spots * (keep < 0.5), big * (keep_big < 0.9))
    spots = spots * smoothstep(0.06, 0.18, V) * (1.0 - smoothstep(0.86, 0.97, V))
    albedo = textures.mix(albedo, WHITE, spots * 0.92)
    albedo[..., 3] = 0.97 - 0.08 * edge_fade
    return {"albedo": albedo, "height": height}


# ---------------------------------------------------------------- animation

def extra_channels(clip_name: str, spec: dict, envelope):
    """Slow sway of the ornamental rays about the fin bones' local X: the filament and anal lobe trail with
    the body wave, the pale sails follow more gently and slightly out of phase."""
    clip = spec["animation"][clip_name]
    frequency = float(clip.get("axialFrequency", 1.0))
    sway = {"idle": 1.5, "swim": 2.4, "burst": 4.0}.get(clip_name, 1.5)
    return [
        Channel("Dorsal2Ray", "rotation", (1.0, 0.0, 0.0), sway, frequency, 0.9, envelope=envelope),
        Channel("AnalRay", "rotation", (1.0, 0.0, 0.0), -sway * 0.8, frequency, 0.9 + math.pi, envelope=envelope),
        Channel("Dorsal2", "rotation", (1.0, 0.0, 0.0), sway * 0.5, frequency, 1.4, envelope=envelope),
        Channel("Anal", "rotation", (1.0, 0.0, 0.0), -sway * 0.4, frequency, 1.4 + math.pi, envelope=envelope),
    ]
