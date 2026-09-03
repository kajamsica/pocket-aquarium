"""Ctenochaetus tominiensis: warm brown body, orange-yellow fin margins, pale lunate tail."""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep

BROWN = (0.30, 0.15, 0.07)
DARK = (0.14, 0.07, 0.035)
BELLY = (0.42, 0.28, 0.16)
ORANGE = (0.92, 0.48, 0.05)
PALE = (0.72, 0.78, 0.84)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    base = textures.rgba(BROWN, 1.0, ctx.shape)
    albedo = textures.mix(base, DARK, smoothstep(0.3, 1.0, Z) * 0.5)
    albedo = textures.mix(albedo, BELLY, smoothstep(-0.4, -1.0, Z) * 0.6)
    # fine pale-orange spots on the head grading into faint longitudinal lines on the flank
    head_spots = paint.spots(U, V, density=70.0, radius=0.2, seed=19) * smoothstep(0.68, 0.82, U)
    albedo = textures.mix(albedo, (0.85, 0.55, 0.25), head_spots * 0.55)
    lines = smoothstep(0.7, 0.95, 0.5 + 0.5 * np.sin(V * np.pi * 2 * 30.0 + fbm(U * 10, V * 3, 2, seed=6) * 2.0))
    albedo = textures.mix(albedo, (0.5, 0.3, 0.14), lines * 0.25 * (1.0 - smoothstep(0.62, 0.75, U)) * smoothstep(0.1, 0.25, U))
    sheen = fbm(U * 26.0, V * 15.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.2 * sheen)
    height = paint.scales_height(U, V, 85, 32, seed=5) * 0.7 + 0.15 * sheen
    roughness = 0.38 + 0.14 * height
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, 16.0, 4.0)
    if ctx.fin == "caudal":
        albedo = textures.rgba(PALE, 1.0, ctx.shape)
        albedo = textures.mix(albedo, BROWN, (1.0 - smoothstep(0.1, 0.5, V)) * 0.8)
        albedo = textures.mix(albedo, (0.92, 0.94, 0.96), smoothstep(0.75, 1.0, V) * 0.6)
        albedo = textures.mix(albedo, DARK, 0.25 * ray)
    elif ctx.fin in ("dorsal", "anal"):
        albedo = textures.rgba(BROWN, 1.0, ctx.shape)
        # yellow-orange soft posterior portion (u=0 is the posterior end of a median fin)
        albedo = textures.mix(albedo, ORANGE, (1.0 - smoothstep(0.35, 0.65, U)) * smoothstep(0.15, 0.5, V))
        albedo = textures.mix(albedo, DARK, 0.3 * ray)
        albedo = textures.mix(albedo, (0.4, 0.65, 0.95), smoothstep(0.93, 1.0, V) * 0.5)
    else:
        albedo = textures.rgba((0.5, 0.35, 0.22), 1.0, ctx.shape)
        albedo = textures.mix(albedo, DARK, 0.3 * ray)
        albedo[..., 3] = 0.85
    albedo[..., 3] = np.minimum(albedo[..., 3], 1.0 - 0.15 * smoothstep(0.93, 1.0, V))
    return albedo
