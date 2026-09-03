"""Paracanthurus hepatus: royal blue body with the black 'palette' loop and yellow caudal fin."""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep

BLUE = (0.015, 0.14, 0.72)
PALE_BLUE = (0.10, 0.36, 0.92)
BLACK = (0.006, 0.006, 0.010)
YELLOW = (0.93, 0.72, 0.04)
NAVY = (0.006, 0.02, 0.10)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    wobble = (fbm(U * 9.0, V * 6.0, octaves=3, seed=17) - 0.5) * 0.06
    zeta = Z + wobble
    # upper black band runs from the eye back along the dorsum to the peduncle
    upper_center = 0.60 - 0.12 * smoothstep(0.55, 0.95, U)
    upper_half = 0.20 + 0.10 * smoothstep(0.55, 0.85, U)
    upper = paint.band(zeta - upper_center, 0.0, upper_half, 0.04)
    upper *= 1.0 - smoothstep(0.86, 0.905, U)
    upper *= smoothstep(0.06, 0.11, U)
    # lower branch along the mid flank, joining the upper band at the peduncle and mid body
    lower = paint.band(zeta + 0.04, 0.0, 0.14, 0.04) * paint.band(U, 0.31, 0.21, 0.03)
    connector = paint.band(U, 0.535, 0.045, 0.02) * smoothstep(-0.2, -0.08, zeta) * (1.0 - smoothstep(0.55, 0.70, zeta))
    peduncle = paint.band(U, 0.10, 0.06, 0.03) * smoothstep(-0.28, -0.14, zeta) * (1.0 - smoothstep(0.78, 0.92, zeta))
    black_mask = np.clip(upper + lower + connector + peduncle, 0.0, 1.0)

    base = textures.rgba(BLUE, 1.0, ctx.shape)
    belly = smoothstep(-0.55, -1.0, Z) * 0.35
    albedo = textures.mix(base, PALE_BLUE, belly)
    sheen = fbm(U * 30.0, V * 16.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.2 * sheen)
    albedo = textures.mix(albedo, BLACK, black_mask)
    # dark eye socket surround and a lighter snout
    snout = smoothstep(0.93, 1.0, U) * (1.0 - black_mask)
    albedo = textures.mix(albedo, (0.05, 0.22, 0.75), snout * 0.5)

    height = paint.scales_height(U, ctx.V, 110, 40, seed=5) * 0.6 + 0.2 * fbm(U * 60, ctx.V * 30, 2, seed=8)
    roughness = 0.34 + 0.12 * height + 0.10 * black_mask
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, 16.0, 5.0) * 0.5 + paint.rays(U, 5.0, 3.0) * 0.5
    if ctx.fin == "caudal":
        yellow = textures.rgba(YELLOW, 1.0, ctx.shape)
        yellow = textures.scale_rgb(yellow, 0.92 + 0.14 * ray)
        wedge = np.abs(U - 0.5) - (0.16 + 0.34 * V)
        black = smoothstep(-0.03, 0.03, wedge)
        albedo = textures.mix(yellow, BLACK, black)
    elif ctx.fin in ("dorsal", "anal"):
        albedo = textures.rgba(NAVY, 1.0, ctx.shape)
        albedo = textures.mix(albedo, BLUE, 0.35 * ray)
        albedo = textures.mix(albedo, PALE_BLUE, smoothstep(0.86, 0.97, V))
    elif ctx.fin == "pectoral":
        albedo = textures.rgba(BLUE, 1.0, ctx.shape)
        albedo = textures.mix(albedo, YELLOW, smoothstep(0.42, 0.72, V))
        albedo = textures.mix(albedo, BLACK, smoothstep(0.90, 1.0, U) * (1.0 - smoothstep(0.5, 0.8, V)))
    else:
        albedo = textures.rgba(NAVY, 1.0, ctx.shape)
        albedo = textures.mix(albedo, BLUE, 0.4 * ray)
    albedo[..., 3] = 1.0 - 0.15 * smoothstep(0.93, 1.0, V)
    return albedo
