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


COPPER = (0.43, 0.19, 0.09)
COPPER_LIGHT = (0.79, 0.42, 0.23)
SILVER = (0.58, 0.63, 0.57)
BELLY = (0.76, 0.73, 0.62)
RED = (0.54, 0.12, 0.045)
AXINE = (0.018, 0.014, 0.012)
AXINE_RIM = (0.08, 0.045, 0.026)
FIN_AMBER = (0.62, 0.28, 0.10)
FIN_EDGE = (0.86, 0.43, 0.19)


def _require_species(ctx):
    if ctx.spec.get("textureStyle") != "harlequin_rasbora":
        raise ValueError(f"Unsupported Harlequin Rasbora textureStyle: {ctx.spec.get('textureStyle')}")


def _axine(ctx):
    """Return the sharply bounded three-apex axine in body coordinates.

    U runs from the caudal base to the snout, and ZETA runs from belly to
    dorsal ridge. The dorsal and ventral apices sit near their fin origins;
    a nearly straight anterior edge spans the posterior flank before both
    edges converge on a narrow caudal apex. This is the species-defining
    harlequin wedge, not a generic tetra stripe.
    """
    U, Z = ctx.U, ctx.ZETA
    anterior = 0.54 - 0.07 * smoothstep(0.68, -0.62, Z)
    anterior_edge = smoothstep(anterior + 0.010, anterior - 0.010, U)

    growth = smoothstep(0.045, 0.48, U)
    dorsal_edge = 0.035 + 0.60 * growth
    ventral_edge = -0.025 - 0.56 * growth
    inside_dorsal = 1.0 - smoothstep(dorsal_edge - 0.018, dorsal_edge + 0.018, Z)
    inside_ventral = smoothstep(ventral_edge - 0.018, ventral_edge + 0.018, Z)
    caudal_taper = smoothstep(0.020, 0.060, U)
    return np.clip(anterior_edge * inside_dorsal * inside_ventral * caudal_taper, 0.0, 1.0)


def paint_body(ctx):
    _require_species(ctx)
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    wedge = _axine(ctx)

    albedo = textures.rgba(COPPER_LIGHT, 1.0, ctx.shape)
    albedo = textures.mix(albedo, COPPER, smoothstep(0.12, 0.92, Z) * 0.72)
    albedo = textures.mix(albedo, SILVER, smoothstep(0.18, -0.58, Z) * 0.72)
    albedo = textures.mix(albedo, BELLY, smoothstep(-0.35, -0.92, Z) * 0.64)
    albedo = textures.mix(albedo, RED, smoothstep(0.68, 0.98, Z) * 0.12)
    sheen = fbm(U * 27.0, V * 13.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.94 + 0.10 * sheen)

    # A muted halo follows the bounded wedge edge without becoming a second broad patch.
    halo = np.clip(4.0 * wedge * (1.0 - wedge), 0.0, 1.0)
    albedo = textures.mix(albedo, AXINE_RIM, halo * 0.30)
    albedo = textures.mix(albedo, AXINE, wedge)

    scales = paint.scales_height(U, V, 78.0, 30.0, seed=5)
    grain = fbm(U * 62.0, V * 31.0, octaves=2, seed=8)
    height = np.clip(0.5 + (scales - 0.5) * 0.38 + (grain - 0.5) * 0.10, 0.0, 1.0)
    roughness = 0.29 + 0.10 * height + 0.12 * wedge
    return {
        "albedo": albedo,
        "roughness": textures.grey(roughness),
        "normal": textures.normal_from_height(height, 0.58),
    }


def _fin_height(ctx, count: float):
    ray = (0.5 + 0.5 * np.cos(ctx.U * np.pi * 2.0 * count)) ** 1.65
    membrane = fbm(ctx.U * 18.0, ctx.V * 6.0, octaves=2, seed=41)
    root_fade = 0.28 + 0.72 * smoothstep(0.0, 0.28, ctx.V)
    return np.clip(0.40 + 0.30 * ray * root_fade + 0.07 * (membrane - 0.5), 0.0, 1.0)


def paint_fin(ctx):
    _require_species(ctx)
    U, V = ctx.U, ctx.V
    counts = {"dorsal": 11.0, "anal": 10.0, "caudal": 15.0, "pectoral": 13.0, "pelvic": 7.0}
    count = counts.get(ctx.fin, 11.0)
    ray = paint.rays(U, count, 4.6)

    if ctx.fin == "caudal":
        albedo = textures.rgba(FIN_AMBER, 1.0, ctx.shape)
        albedo = textures.mix(albedo, FIN_EDGE, smoothstep(0.76, 0.98, V) * 0.32)
        albedo = textures.mix(albedo, AXINE_RIM, smoothstep(0.0, 0.18, V) * 0.22)
        alpha = 0.58 - 0.28 * smoothstep(0.20, 1.0, V)
    elif ctx.fin in ("dorsal", "anal"):
        albedo = textures.rgba(FIN_AMBER, 1.0, ctx.shape)
        albedo = textures.mix(albedo, RED, ray * 0.20)
        albedo = textures.mix(albedo, FIN_EDGE, smoothstep(0.86, 0.98, V) * 0.24)
        alpha = 0.56 - 0.26 * smoothstep(0.20, 1.0, V)
    elif ctx.fin == "pectoral":
        albedo = textures.rgba((0.72, 0.48, 0.31), 0.30, ctx.shape)
        albedo = textures.mix(albedo, FIN_EDGE, ray * 0.14)
        alpha = 0.30 - 0.14 * smoothstep(0.36, 1.0, V)
    else:
        albedo = textures.rgba(FIN_AMBER, 0.46, ctx.shape)
        albedo = textures.mix(albedo, FIN_EDGE, ray * 0.18)
        alpha = 0.46 - 0.20 * smoothstep(0.30, 1.0, V)

    albedo = textures.scale_rgb(albedo, 0.92 + 0.12 * ray)
    albedo[..., 3] = np.clip(alpha, 0.0, 1.0)
    return {"albedo": albedo, "height": _fin_height(ctx, count)}
