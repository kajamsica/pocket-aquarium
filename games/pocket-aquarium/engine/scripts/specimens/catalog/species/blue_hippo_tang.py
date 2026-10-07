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


def _ellipse(u, zeta, center, radii):
    du = (u - center[0]) / radii[0]
    dz = (zeta - center[1]) / radii[1]
    return np.sqrt(du * du + dz * dz)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    # small organic wobble only: the palette edges are smooth curves, not noise-torn bands
    wobble = (fbm(U * 22.0, V * 10.0, octaves=2, seed=17) - 0.5) * 0.02
    zeta = Z + wobble
    edge = 0.035
    # the "palette": a black ring on the flank (outer ellipse minus the blue window)
    outer = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, _ellipse(U, zeta, (0.33, 0.40), (0.31, 0.60)))
    window = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, _ellipse(U, zeta, (0.34, 0.31), (0.20, 0.36)))
    ring = outer * (1.0 - window)
    # dorsal band: continues from the ring forward along the back and tapers into the eye
    lower_edge = 0.50 + 0.28 * smoothstep(0.55, 0.88, U)
    dorsal_band = smoothstep(lower_edge - edge, lower_edge + edge, zeta) * (1.0 - smoothstep(0.86, 0.905, U)) * smoothstep(0.05, 0.10, U)
    # the flank pattern lives on the sides; fade it out under the belly midline
    black_mask = np.clip(ring + dorsal_band, 0.0, 1.0) * (1.0 - smoothstep(-0.72, -0.92, Z))

    base = textures.rgba(BLUE, 1.0, ctx.shape)
    belly = smoothstep(-0.55, -1.0, Z) * 0.35
    albedo = textures.mix(base, PALE_BLUE, belly)
    sheen = fbm(U * 30.0, V * 16.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.2 * sheen)
    albedo = textures.mix(albedo, BLACK, black_mask)
    # lighter snout
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
        albedo = textures.rgba((0.012, 0.05, 0.26), 1.0, ctx.shape)
        albedo = textures.mix(albedo, BLUE, 0.4 * ray)
        albedo = textures.mix(albedo, NAVY, smoothstep(0.55, 0.8, V) * (1.0 - smoothstep(0.84, 0.9, V)))
        albedo = textures.mix(albedo, PALE_BLUE, smoothstep(0.88, 0.97, V))
    elif ctx.fin == "pectoral":
        albedo = textures.rgba(BLUE, 1.0, ctx.shape)
        albedo = textures.mix(albedo, YELLOW, smoothstep(0.42, 0.72, V))
        albedo = textures.mix(albedo, BLACK, smoothstep(0.90, 1.0, U) * (1.0 - smoothstep(0.5, 0.8, V)))
    else:
        albedo = textures.rgba(NAVY, 1.0, ctx.shape)
        albedo = textures.mix(albedo, BLUE, 0.4 * ray)
    albedo[..., 3] = 1.0 - 0.15 * smoothstep(0.93, 1.0, V)
    return albedo
