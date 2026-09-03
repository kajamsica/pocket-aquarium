"""Zebrasoma gemmatum: near-black body with dense pale spots and a pale yellow caudal fin."""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep

BLACK = (0.022, 0.016, 0.012)
BROWN = (0.06, 0.04, 0.025)
SPOT = (0.85, 0.85, 0.72)
PALE_YELLOW = (0.86, 0.80, 0.42)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    base = textures.rgba(BLACK, 1.0, ctx.shape)
    albedo = textures.mix(base, BROWN, fbm(U * 12.0, V * 8.0, octaves=3, seed=4) * 0.5)
    # dense small pale spots; the body-length axis has ~2x the ring axis so scale density by aspect
    spots = paint.spots(U, V, density=85.0, radius=0.2, seed=9, jitter_radius=0.3)
    spots *= 1.0 - smoothstep(0.94, 1.0, U)  # bare snout tip
    spots *= 1.0 - 0.6 * smoothstep(-0.75, -1.0, Z)  # sparser under the belly
    albedo = textures.mix(albedo, SPOT, spots * 0.92)
    height = paint.scales_height(U, V, 90, 34, seed=5) * 0.55 + 0.35 * spots
    roughness = 0.38 + 0.12 * height - 0.12 * spots
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, 18.0, 4.0)
    if ctx.fin == "caudal":
        albedo = textures.rgba(PALE_YELLOW, 1.0, ctx.shape)
        albedo = textures.scale_rgb(albedo, 0.9 + 0.16 * ray)
        albedo = textures.mix(albedo, BLACK, (1.0 - smoothstep(0.0, 0.1, V)) * 0.7)
    else:
        albedo = textures.rgba(BLACK, 1.0, ctx.shape)
        albedo = textures.mix(albedo, BROWN, 0.5 * ray)
        spots = paint.spots(U, V, density=24.0, radius=0.2, seed=17) * (1.0 - smoothstep(0.85, 1.0, V))
        albedo = textures.mix(albedo, SPOT, spots * 0.8)
        if ctx.fin == "pectoral":
            albedo = textures.mix(albedo, PALE_YELLOW, smoothstep(0.7, 1.0, V) * 0.6)
    albedo[..., 3] = 1.0 - 0.15 * smoothstep(0.93, 1.0, V)
    return albedo
