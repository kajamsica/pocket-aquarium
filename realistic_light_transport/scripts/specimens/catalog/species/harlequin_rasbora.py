"""Trigonostigma heteromorpha, Harlequin Rasbora procedural paint hooks.

The shared fish plan owns the body, fins, eyes, cues, rig and clips. This module
keeps the species-specific surface work local: a copper-orange cyprinid ground,
the diagnostic dark triangular axine, and warm translucent fins. Every texel is
derived from fixed equations and seeds, with no sampled imagery.
"""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep


COPPER = (0.72, 0.22, 0.07)
COPPER_LIGHT = (0.92, 0.39, 0.12)
GOLD = (0.96, 0.58, 0.18)
RED = (0.66, 0.10, 0.035)
AXINE = (0.018, 0.014, 0.012)
AXINE_RIM = (0.10, 0.055, 0.028)
FIN_AMBER = (0.76, 0.18, 0.045)
FIN_EDGE = (0.98, 0.46, 0.12)


def _require_species(ctx):
    if ctx.spec.get("textureStyle") != "harlequin_rasbora":
        raise ValueError(f"Unsupported Harlequin Rasbora textureStyle: {ctx.spec.get('textureStyle')}")


def _axine(ctx):
    """Return the soft-edged dark wedge in body texture coordinates.

    U runs from the caudal base to the snout, and ZETA runs from belly to
    dorsal ridge. The anterior edge starts high under the dorsal origin and
    steps posteriorly toward the belly, giving the patch its triangular slope.
    """
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    wander = (fbm(Z * 3.0 + 1.7, V * 4.0 + U * 0.4, octaves=2, seed=17) - 0.5) * 0.018
    boundary = 0.62 - 0.15 * smoothstep(0.72, -0.78, Z) + wander
    edge = smoothstep(boundary + 0.012, boundary - 0.012, U)
    tail_taper = smoothstep(0.035, 0.11, U)
    dorsal_taper = 0.74 + 0.26 * smoothstep(-0.7, 0.82, Z)
    return np.clip(edge * tail_taper * dorsal_taper, 0.0, 1.0)


def paint_body(ctx):
    _require_species(ctx)
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    wedge = _axine(ctx)

    albedo = textures.rgba(COPPER, 1.0, ctx.shape)
    albedo = textures.mix(albedo, COPPER_LIGHT, smoothstep(-0.15, -0.8, Z) * 0.48)
    albedo = textures.mix(albedo, RED, smoothstep(0.6, 0.98, Z) * 0.28)
    sheen = fbm(U * 27.0, V * 13.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.89 + 0.20 * sheen)

    # A muted halo keeps the wedge edge legible without turning it into a hard decal.
    halo = paint.band(U - (0.62 - 0.15 * smoothstep(0.72, -0.78, Z)), 0.0, 0.03, 0.018)
    albedo = textures.mix(albedo, AXINE_RIM, halo * 0.45)
    albedo = textures.mix(albedo, AXINE, wedge)

    scales = paint.scales_height(U, V, 78.0, 30.0, seed=5)
    grain = fbm(U * 62.0, V * 31.0, octaves=2, seed=8)
    height = np.clip(0.5 + (scales - 0.5) * 0.62 + (grain - 0.5) * 0.16, 0.0, 1.0)
    roughness = 0.31 + 0.13 * height + 0.13 * wedge
    return {
        "albedo": albedo,
        "roughness": textures.grey(roughness),
        "normal": textures.normal_from_height(height, 0.82),
    }


def _fin_height(ctx, count: float):
    ray = (0.5 + 0.5 * np.cos(ctx.U * np.pi * 2.0 * count)) ** 1.65
    membrane = fbm(ctx.U * 18.0, ctx.V * 6.0, octaves=2, seed=41)
    root_fade = 0.28 + 0.72 * smoothstep(0.0, 0.28, ctx.V)
    return np.clip(0.35 + 0.45 * ray * root_fade + 0.1 * (membrane - 0.5), 0.0, 1.0)


def paint_fin(ctx):
    _require_species(ctx)
    U, V = ctx.U, ctx.V
    counts = {"dorsal": 11.0, "anal": 10.0, "caudal": 15.0, "pectoral": 13.0, "pelvic": 7.0}
    count = counts.get(ctx.fin, 11.0)
    ray = paint.rays(U, count, 4.6)

    if ctx.fin == "caudal":
        albedo = textures.rgba(FIN_AMBER, 1.0, ctx.shape)
        albedo = textures.mix(albedo, FIN_EDGE, smoothstep(0.72, 0.98, V) * 0.62)
        albedo = textures.mix(albedo, AXINE_RIM, smoothstep(0.0, 0.18, V) * 0.38)
        alpha = 0.94 - 0.16 * smoothstep(0.87, 1.0, V)
    elif ctx.fin in ("dorsal", "anal"):
        albedo = textures.rgba(FIN_AMBER, 1.0, ctx.shape)
        albedo = textures.mix(albedo, RED, ray * 0.40)
        albedo = textures.mix(albedo, FIN_EDGE, smoothstep(0.86, 0.98, V) * 0.45)
        alpha = 0.88 - 0.16 * smoothstep(0.82, 1.0, V)
    elif ctx.fin == "pectoral":
        albedo = textures.rgba((0.82, 0.31, 0.10), 0.72, ctx.shape)
        albedo = textures.mix(albedo, FIN_EDGE, ray * 0.30)
        alpha = 0.64 - 0.20 * smoothstep(0.55, 1.0, V)
    else:
        albedo = textures.rgba(RED, 0.94, ctx.shape)
        albedo = textures.mix(albedo, FIN_EDGE, ray * 0.32)
        alpha = 0.88 - 0.14 * smoothstep(0.72, 1.0, V)

    albedo = textures.scale_rgb(albedo, 0.88 + 0.18 * ray)
    albedo[..., 3] = np.clip(alpha, 0.0, 1.0)
    return {"albedo": albedo, "height": _fin_height(ctx, count)}
