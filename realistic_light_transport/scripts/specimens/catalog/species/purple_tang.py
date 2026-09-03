"""Zebrasoma xanthurum: blue-purple body, fine dark head spots and flank lines, yellow tail."""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep, value_noise

PURPLE = (0.055, 0.035, 0.46)
DEEP = (0.02, 0.012, 0.2)
INK = (0.01, 0.006, 0.08)
YELLOW = (0.9, 0.68, 0.04)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    base = textures.rgba(PURPLE, 1.0, ctx.shape)
    shade = smoothstep(0.3, 1.0, Z) * 0.35 + smoothstep(-0.5, -1.0, Z) * 0.25
    albedo = textures.mix(base, DEEP, shade)
    # fine horizontal flank lines (wavy) over the body, denser on the anterior half
    lines = 0.5 + 0.5 * np.sin(V * np.pi * 2.0 * 46.0 + (value_noise(U * 18.0, V * 4.0, 7) - 0.5) * 3.0)
    lines = smoothstep(0.62, 0.9, lines)
    line_mask = lines * (1.0 - smoothstep(0.78, 0.9, U)) * smoothstep(0.08, 0.2, U)
    albedo = textures.mix(albedo, INK, line_mask * 0.6)
    # head reticulation: small dark spots
    spots = paint.spots(U, V, density=110.0, radius=0.22, seed=13) * smoothstep(0.72, 0.85, U)
    albedo = textures.mix(albedo, INK, spots * 0.7)
    sheen = fbm(U * 28.0, V * 16.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.2 * sheen)
    height = paint.scales_height(U, V, 95, 36, seed=5) * 0.6 + 0.25 * line_mask
    roughness = 0.34 + 0.14 * height
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, 18.0, 4.0)
    if ctx.fin == "caudal":
        albedo = textures.rgba(YELLOW, 1.0, ctx.shape)
        albedo = textures.scale_rgb(albedo, 0.92 + 0.14 * ray)
        albedo = textures.mix(albedo, PURPLE, (1.0 - smoothstep(0.0, 0.12, V)) * 0.6)
    elif ctx.fin == "pectoral":
        albedo = textures.rgba(PURPLE, 1.0, ctx.shape)
        albedo = textures.mix(albedo, YELLOW, smoothstep(0.55, 0.85, V) * 0.9)
    else:
        albedo = textures.rgba(PURPLE, 1.0, ctx.shape)
        albedo = textures.mix(albedo, DEEP, 0.45 * ray)
        lines = smoothstep(0.6, 0.9, 0.5 + 0.5 * np.sin(V * np.pi * 2.0 * 14.0))
        albedo = textures.mix(albedo, INK, lines * 0.3)
        albedo = textures.mix(albedo, (0.25, 0.35, 0.95), smoothstep(0.92, 1.0, V) * 0.5)
    albedo[..., 3] = 1.0 - 0.15 * smoothstep(0.93, 1.0, V)
    return albedo
