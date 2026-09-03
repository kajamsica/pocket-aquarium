"""Pseudocheilinus hexataenia: orange-pink body with six blue horizontal lines and a green tail."""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep

ORANGE = (0.72, 0.26, 0.12)
VIOLET = (0.45, 0.14, 0.35)
BLUE = (0.10, 0.28, 0.95)
GREEN = (0.35, 0.62, 0.22)
INK = (0.01, 0.01, 0.02)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    base = textures.rgba(ORANGE, 1.0, ctx.shape)
    albedo = textures.mix(base, VIOLET, smoothstep(0.2, 1.0, Z) * 0.55)
    albedo = textures.mix(albedo, (0.9, 0.55, 0.35), smoothstep(-0.5, -1.0, Z) * 0.4)
    # six horizontal blue lines between the dorsal ridge and the belly on each flank
    lines = np.zeros_like(U)
    for k in range(6):
        zeta_center = 0.72 - k * 0.26
        lines = np.maximum(lines, paint.band(Z, zeta_center, 0.035, 0.02))
    lines *= smoothstep(0.1, 0.2, U) * (1.0 - smoothstep(0.86, 0.95, U))
    albedo = textures.mix(albedo, BLUE, lines * 0.9)
    # black spot at the top of the caudal peduncle and fine orange lines through the eye region
    spot = paint.band(U, 0.12, 0.02, 0.012) * paint.band(Z, 0.75, 0.12, 0.05)
    albedo = textures.mix(albedo, INK, spot)
    eye_lines = smoothstep(0.7, 0.95, 0.5 + 0.5 * np.sin(V * np.pi * 2 * 40.0)) * smoothstep(0.86, 0.9, U) * (1 - smoothstep(0.95, 0.98, U))
    albedo = textures.mix(albedo, (0.95, 0.5, 0.2), eye_lines * 0.4)
    sheen = fbm(U * 30.0, V * 16.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * sheen)
    height = paint.scales_height(U, V, 70, 26, seed=5) * 0.7 + 0.2 * lines
    roughness = 0.34 + 0.14 * height
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, 12.0, 4.0)
    if ctx.fin == "caudal":
        albedo = textures.rgba(GREEN, 1.0, ctx.shape)
        albedo = textures.mix(albedo, ORANGE, (1.0 - smoothstep(0.05, 0.3, V)) * 0.7)
        albedo = textures.mix(albedo, (0.15, 0.3, 0.1), 0.35 * ray)
    elif ctx.fin in ("dorsal", "anal"):
        albedo = textures.rgba((0.78, 0.4, 0.28), 1.0, ctx.shape)
        albedo = textures.mix(albedo, VIOLET, 0.35 * ray)
        albedo = textures.mix(albedo, BLUE, paint.band(V, 0.55, 0.06, 0.03) * 0.6)
        albedo[..., 3] = 0.9
    else:
        albedo = textures.rgba((0.85, 0.55, 0.4), 1.0, ctx.shape)
        albedo = textures.mix(albedo, ORANGE, 0.3 * ray)
        albedo[..., 3] = 0.8
    albedo[..., 3] = np.minimum(albedo[..., 3], 1.0 - 0.2 * smoothstep(0.9, 1.0, V))
    return albedo
