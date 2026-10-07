"""Cryptocentrus cinctus, the yellow watchman goby (yellow prawn-goby): paint hooks for the shared fish plan.

Anatomy is carried by ``art/specimens/watchman_goby/asset.source.json``: an elongate benthic body with
its greatest depth (4.4-4.6 in SL, FishBase) just behind a broad, blunt head that is slightly wider than
deep, a steep forehead, high-set eyes that crest the head profile, a large oblique mouth, two dorsal fins
(short rounded spiny D1, long-based D2) with the anal fin opposite D2, large rounded pectoral fans, a
pelvic disc under the shoulder and a rounded caudal fin about equal to head length.

Colour (yellow phase, FishBase / Fishes of Australia diagnosis): canary yellow ground, four to five faint
dusky bars, soft darker mottling, fine pale blue or white spots on the head, anterodorsal body and fins,
a brown snout with a dark streak along the upper jaw, translucent yellowish fins and a paler belly.
Everything is procedural numpy over seeded value noise; no imagery is sampled.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import paint, textures
from ..lib.noise import cells, fbm, smoothstep

YELLOW = (1.00, 0.82, 0.03)
DEEP_YELLOW = (0.90, 0.62, 0.06)
BAR_BROWN = (0.80, 0.50, 0.06)
CREAM = (1.00, 0.94, 0.58)
PALE_BLUE = (0.72, 0.90, 1.00)
BROWN = (0.42, 0.26, 0.09)
DARK_BROWN = (0.20, 0.11, 0.04)
FIN_YELLOW = (0.98, 0.84, 0.18)
RAY_ORANGE = (0.86, 0.60, 0.10)

# ray counts follow the meristics: D1 VI spines, D2 I,10, A I,9, rounded caudal, broad pectoral, pelvic disc
FIN_RAYS = {"dorsal1": 6, "dorsal2": 11, "anal": 10, "caudal": 15, "pectoral": 17, "pelvic": 5}


def _sparse_spots(u, v, density_u: float, density_v: float, seed: int, radius: float = 0.22, keep: float = 0.4):
    """Small round spots on a jittered lattice; only cells whose hash exceeds `keep` carry a spot."""
    distance, ident = cells(u * density_u, v * density_v, seed)
    size = radius * (0.7 + 0.6 * ident)
    spot = 1.0 - smoothstep(size * 0.55, size, distance)
    return spot * np.where(ident > keep, 1.0, 0.0)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    shape = ctx.shape

    albedo = textures.rgba(YELLOW, 1.0, shape)
    tone = fbm(U * 26.0, V * 12.0, octaves=3, seed=21)
    albedo = textures.scale_rgb(albedo, 0.95 + 0.10 * tone)

    # paler belly, slightly deeper back
    belly = smoothstep(-0.45, -0.95, Z)
    albedo = textures.mix(albedo, CREAM, belly * 0.55)
    back = smoothstep(0.45, 0.95, Z)
    albedo = textures.mix(albedo, DEEP_YELLOW, back * 0.3)

    # soft darker mottling over the flank, strongest on the head and the anterodorsal body
    blotch = paint.mottle(U, V, scale=14.0, seed=11, octaves=3)
    blotch_mask = smoothstep(0.52, 0.72, blotch) * (1.0 - smoothstep(-0.4, -0.85, Z))
    blotch_mask *= 0.55 + 0.45 * smoothstep(0.35, 0.8, U)
    albedo = textures.mix(albedo, DEEP_YELLOW, blotch_mask * 0.5)

    # four to five dusky bars between the operculum and the caudal peduncle (faint in the yellow phase)
    bars = paint.vertical_bars(U, 5, 0.12, 0.72, 0.03, 0.03, zeta=Z, wobble=0.04, seed=31)
    bar_mask = bars * (1.0 - smoothstep(-0.2, -0.8, Z)) * (0.6 + 0.4 * smoothstep(0.2, 0.9, Z))
    albedo = textures.mix(albedo, BAR_BROWN, bar_mask * 0.45)

    # fine pale blue spots: dense on the head and cheeks, thinning along the anterodorsal flank
    spot = _sparse_spots(U, V, 72.0, 36.0, seed=9, radius=0.17, keep=0.4)
    head_region = smoothstep(0.66, 0.80, U) * (1.0 - smoothstep(-0.1, -0.65, Z))
    flank_region = smoothstep(0.38, 0.62, U) * (1.0 - smoothstep(0.66, 0.80, U)) * smoothstep(-0.05, 0.55, Z)
    spot_region = np.clip(head_region + flank_region, 0.0, 1.0) * (1.0 - smoothstep(0.965, 0.99, U))
    spot_mask = spot * spot_region
    albedo = textures.mix(albedo, PALE_BLUE, spot_mask * 0.92)

    # brown snout and the dark streak along the upper jaw (the mouth sits just below the section centre)
    snout = smoothstep(0.94, 0.995, U) * (1.0 - smoothstep(0.55, 0.95, Z))
    albedo = textures.mix(albedo, BROWN, snout * 0.5)
    streak = paint.band(Z, -0.10, 0.05, 0.035) * smoothstep(0.87, 0.93, U)
    albedo = textures.mix(albedo, DARK_BROWN, streak * 0.75)

    # relief: small scales (92-95 longitudinal series) on the body, naked skin on the head
    scales = paint.scales_height(U, V, 95, 34, seed=5)
    naked_head = smoothstep(0.70, 0.78, U)
    skin = 0.5 + 0.12 * (fbm(U * 90.0, V * 40.0, octaves=2, seed=8) - 0.5)
    height = scales * (1.0 - naked_head) + skin * naked_head
    height = np.clip(height + 0.08 * spot_mask, 0.0, 1.0)
    roughness = 0.50 + 0.10 * height - 0.05 * naked_head + 0.05 * blotch_mask - 0.05 * spot_mask
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.8)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    count = FIN_RAYS.get(ctx.fin, 12)
    ray = paint.rays(U, float(count), 4.0)
    membrane = fbm(U * 20.0, V * 8.0, octaves=2, seed=33)

    base = textures.rgba(CREAM if ctx.fin == "pelvic" else FIN_YELLOW, 1.0, ctx.shape)
    base = textures.scale_rgb(base, 0.92 + 0.10 * membrane)
    albedo = textures.mix(base, RAY_ORANGE, ray * 0.55)

    if ctx.fin in ("dorsal1", "dorsal2", "anal", "pectoral"):
        spot = _sparse_spots(U, V, 30.0, 10.0, seed=51, radius=0.17, keep=0.5)
        spot *= 1.0 - smoothstep(0.75, 0.95, V)
        albedo = textures.mix(albedo, PALE_BLUE, spot * 0.9)
    if ctx.fin == "dorsal1":
        albedo = textures.mix(albedo, DEEP_YELLOW, smoothstep(0.55, 0.95, V) * 0.4)
    elif ctx.fin == "caudal":
        albedo = textures.mix(albedo, DEEP_YELLOW, (1.0 - smoothstep(0.0, 0.3, V)) * 0.35)

    # translucent membranes thin toward the margin; the pelvic disc stays fleshy
    if ctx.fin == "pelvic":
        alpha = np.full(ctx.shape, 0.96)
    else:
        alpha = 0.95 - 0.22 * smoothstep(0.35, 1.0, V) + 0.05 * ray
    albedo[..., 3] = np.clip(alpha, 0.0, 1.0)

    ridges = (0.5 + 0.5 * np.cos(U * math.tau * count)) ** 1.6
    root_fade = 0.3 + 0.7 * smoothstep(0.0, 0.3, V)
    height = np.clip(0.35 + 0.45 * ridges * root_fade + 0.1 * (membrane - 0.5), 0.0, 1.0)
    return {"albedo": albedo, "height": height}
