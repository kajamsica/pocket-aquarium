"""Paracheirodon innesi procedural paint hooks.

Geometry is declarative in ``art/specimens/neon_tetra/asset.source.json``.
This backend paints the species-diagnostic iridescent lateral stripe and the
posterior-only red stripe from fixed equations and seeds. No reference pixels
are copied, sampled, traced, or redistributed.
"""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep


OLIVE = (0.105, 0.14, 0.12)
SILVER = (0.44, 0.53, 0.50)
BELLY = (0.72, 0.76, 0.68)
BLUE_DEEP = (0.015, 0.23, 0.34)
BLUE_IRIDESCENT = (0.025, 0.74, 0.90)
RED = (0.82, 0.045, 0.035)
RED_LIGHT = (0.96, 0.13, 0.055)
FIN_CLEAR = (0.46, 0.56, 0.54)


def _require_species(ctx):
    if ctx.spec.get("textureStyle") != "neon_tetra":
        raise ValueError(f"Unsupported Neon Tetra textureStyle: {ctx.spec.get('textureStyle')}")


def _blue_stripe(ctx):
    """Eye-to-adipose iridophore band, high on the flank and gently arced."""
    center = 0.16 + 0.11 * ctx.U
    band = paint.band(ctx.ZETA, center, 0.085, 0.025)
    anterior = 1.0 - smoothstep(0.84, 0.92, ctx.U)
    # U=0 is the caudal base. Fade the band inside the adipose-fin span
    # (approximately U 0.145 to 0.228) rather than carrying it to the tail.
    posterior = smoothstep(0.14, 0.23, ctx.U)
    return np.clip(band * anterior * posterior, 0.0, 1.0)


def _red_stripe(ctx):
    """Posterior ventrolateral stripe that stops near midbody, unlike a cardinal tetra."""
    anterior_extent = 1.0 - smoothstep(0.53, 0.64, ctx.U)
    posterior_fill = 1.0 - smoothstep(0.10, 0.58, ctx.U)
    center = -0.31 + 0.06 * posterior_fill
    half_width = 0.08 + 0.23 * posterior_fill
    tapered_band = paint.band(ctx.ZETA, center, half_width, 0.035)
    caudal_fade = smoothstep(0.0, 0.045, ctx.U)
    return np.clip(anterior_extent * tapered_band * caudal_fade, 0.0, 1.0)


def paint_body(ctx):
    _require_species(ctx)
    blue = _blue_stripe(ctx)
    red = _red_stripe(ctx)
    scales = paint.scales_height(ctx.U, ctx.V, 82.0, 27.0, seed=23)
    grain = fbm(ctx.U * 74.0, ctx.V * 34.0, octaves=2, seed=29)

    albedo = textures.rgba(OLIVE, 1.0, ctx.shape)
    lateral_silver = 1.0 - smoothstep(0.12, 0.94, np.abs(ctx.ZETA))
    albedo = textures.mix(albedo, SILVER, lateral_silver * 0.82)
    albedo = textures.mix(albedo, BELLY, smoothstep(-0.20, -0.88, ctx.ZETA) * 0.74)
    albedo = textures.mix(albedo, BLUE_DEEP, blue)
    iridescence = 0.74 + 0.26 * fbm(ctx.U * 22.0, ctx.V * 11.0, octaves=2, seed=37)
    albedo = textures.mix(albedo, BLUE_IRIDESCENT, blue * iridescence)
    albedo = textures.mix(albedo, RED, red)
    albedo = textures.mix(albedo, RED_LIGHT, red * (0.38 + 0.34 * grain))

    height = np.clip(0.5 + (scales - 0.5) * 0.52 + (grain - 0.5) * 0.12, 0.0, 1.0)
    roughness = 0.28 + 0.12 * height - 0.09 * blue + 0.04 * red
    return {
        "albedo": albedo,
        "roughness": textures.grey(roughness),
        "normal": textures.normal_from_height(height, 0.72),
    }


def paint_fin(ctx):
    _require_species(ctx)
    count = {"dorsal": 10.0, "adipose": 4.0, "anal": 14.0, "caudal": 16.0,
             "pectoral": 10.0, "pelvic": 8.0}.get(ctx.fin, 10.0)
    rays = paint.rays(ctx.U, count, 4.2)
    grain = fbm(ctx.U * 19.0, ctx.V * 8.0, octaves=2, seed=47)
    tint = FIN_CLEAR
    alpha = 0.50
    minimum_alpha = 0.24
    if ctx.fin == "adipose":
        tint = (0.20, 0.31, 0.30)
        alpha = 0.42
    elif ctx.fin == "caudal":
        tint = (0.58, 0.66, 0.63)
        alpha = 0.34
        minimum_alpha = 0.14
    albedo = textures.rgba(tint, alpha, ctx.shape)
    albedo = textures.scale_rgb(albedo, 0.84 + 0.13 * rays + 0.05 * grain)
    albedo[..., 3] = np.clip(alpha - 0.16 * smoothstep(0.72, 1.0, ctx.V), minimum_alpha, 0.58)
    height = np.clip(0.38 + 0.42 * rays + 0.08 * (grain - 0.5), 0.0, 1.0)
    return {"albedo": albedo, "height": height}
