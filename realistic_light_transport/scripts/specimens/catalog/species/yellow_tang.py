"""Zebrasoma flavescens: uniform yellow with subtle material variation and a white scalpel."""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep

YELLOW = (0.86, 0.60, 0.025)
OLIVE = (0.62, 0.46, 0.03)
PALE = (0.95, 0.80, 0.22)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    base = textures.rgba(YELLOW, 1.0, ctx.shape)
    # slightly olive back, paler belly, faint pale lateral line following the flank
    back = smoothstep(0.35, 0.95, Z)
    belly = smoothstep(-0.45, -1.0, Z)
    albedo = textures.mix(base, OLIVE, back * 0.45)
    albedo = textures.mix(albedo, PALE, belly * 0.35)
    lateral = paint.band(Z, 0.28 - 0.1 * (1 - U), 0.025, 0.02) * smoothstep(0.15, 0.3, U) * (1 - smoothstep(0.8, 0.9, U))
    albedo = textures.mix(albedo, PALE, lateral * 0.35)
    mottle = fbm(U * 24.0, V * 14.0, octaves=3, seed=21)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * mottle)
    # dark eye ring / snout shading
    snout = smoothstep(0.9, 1.0, U)
    albedo = textures.mix(albedo, OLIVE, snout * 0.3)
    height = paint.scales_height(U, V, 95, 36, seed=5) * 0.7 + 0.15 * fbm(U * 50, V * 26, 2, seed=8)
    roughness = 0.36 + 0.14 * height
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.8)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, 18.0, 4.0)
    albedo = textures.rgba(YELLOW, 1.0, ctx.shape)
    albedo = textures.mix(albedo, OLIVE, 0.35 * ray)
    if ctx.fin in ("dorsal", "anal"):
        albedo = textures.mix(albedo, PALE, smoothstep(0.9, 0.99, V) * 0.5)
    elif ctx.fin == "caudal":
        albedo = textures.mix(albedo, PALE, smoothstep(0.85, 1.0, V) * 0.3)
    else:
        albedo = textures.mix(albedo, PALE, smoothstep(0.5, 1.0, V) * 0.4)
    albedo[..., 3] = 1.0 - 0.2 * smoothstep(0.9, 1.0, V)
    return albedo
