"""Blue-turquoise ornamental Symphysodon discus procedural paint hooks.

Geometry is declarative in ``art/specimens/discus/asset.source.json``. This
dedicated backend paints a vivid blue-turquoise and warm orange phenotype with
fixed equations and seeds. The phenotype is an art target, not a named strain,
and no source pixels are sampled or copied.
"""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep


DEEP_BLUE = (0.018, 0.075, 0.12)
COBALT = (0.025, 0.20, 0.34)
TURQUOISE = (0.035, 0.62, 0.68)
PALE_BLUE = (0.34, 0.88, 0.84)
WARM_GROUND = (0.42, 0.14, 0.035)
ORANGE = (0.82, 0.25, 0.040)
GOLD = (0.96, 0.47, 0.075)
DARK_BAR = (0.010, 0.026, 0.042)
FIN_RED = (0.48, 0.060, 0.030)


def _require_species(ctx):
    if ctx.spec.get("textureStyle") != "discus_blue_turquoise_orange":
        raise ValueError(f"Unsupported Discus textureStyle: {ctx.spec.get('textureStyle')}")


def _orange_marbling(ctx):
    """Broad irregular orange islands that stay organic across both flanks."""
    u, v, z = ctx.U, ctx.V, ctx.ZETA
    warp = (fbm(u * 7.0, v * 5.0, octaves=3, seed=17) - 0.5) * 0.12
    ribbons = 0.5 + 0.5 * np.sin((u + 0.14 * z + warp) * np.pi * 8.0)
    ribbons = smoothstep(0.46, 0.68, ribbons)
    islands = smoothstep(0.42, 0.68, fbm(u * 13.0, v * 8.0, octaves=3, seed=23))
    lateral = 1.0 - smoothstep(0.78, 0.98, np.abs(z))
    end_fade = smoothstep(0.04, 0.15, u) * (1.0 - smoothstep(0.86, 0.98, u))
    return np.clip(np.maximum(ribbons * 0.72, islands) * lateral * end_fade, 0.0, 1.0)


def _turquoise_vermiculation(ctx):
    """Thin intersecting turquoise paths with organic breaks and direction changes."""
    u, v, z = ctx.U, ctx.V, ctx.ZETA
    warp_u = (fbm(u * 8.0, v * 9.0, octaves=3, seed=31) - 0.5) * 0.24
    warp_z = (fbm(u * 11.0, v * 7.0, octaves=3, seed=37) - 0.5) * 0.20
    vertical = (0.5 + 0.5 * np.cos((u + 0.10 * z + warp_u) * np.pi * 18.0)) ** 10
    diagonal = (0.5 + 0.5 * np.cos((z - 0.26 * u + warp_z) * np.pi * 15.0)) ** 11
    paths = np.maximum(vertical, diagonal * 0.62)
    breaks = smoothstep(0.34, 0.60, fbm(u * 25.0, v * 19.0, octaves=2, seed=43))
    lateral = 1.0 - smoothstep(0.80, 0.98, np.abs(z))
    return np.clip(paths * (0.22 + 0.78 * breaks) * lateral, 0.0, 1.0)


def _dark_vertical_bars(ctx):
    """Broad subdued bars beneath the ornamental vermiculation."""
    bars = paint.vertical_bars(
        ctx.U, 6, 0.08, 0.92, 0.024, 0.010,
        ctx.ZETA, wobble=0.018, seed=73,
    )
    lateral = 1.0 - smoothstep(0.82, 0.98, np.abs(ctx.ZETA))
    return bars * lateral


def paint_body(ctx):
    _require_species(ctx)
    u, v, z = ctx.U, ctx.V, ctx.ZETA
    orange = _orange_marbling(ctx)
    lines = _turquoise_vermiculation(ctx)
    bars = _dark_vertical_bars(ctx)
    grain = fbm(u * 54.0, v * 29.0, octaves=2, seed=7)

    albedo = textures.rgba(WARM_GROUND, 1.0, ctx.shape)
    albedo = textures.mix(albedo, ORANGE, orange * 0.68)
    albedo = textures.mix(albedo, GOLD, orange * (1.0 - lines) * 0.24)
    albedo = textures.mix(albedo, DEEP_BLUE, bars * 0.82)
    albedo = textures.mix(albedo, DEEP_BLUE, smoothstep(0.48, 0.96, np.abs(z)) * 0.50)
    albedo = textures.mix(albedo, COBALT, lines * 0.70)
    albedo = textures.mix(albedo, PALE_BLUE, lines * 0.82)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.15 * grain)

    scales = paint.scales_height(u, v, 72.0, 38.0, seed=11)
    height = np.clip(0.48 + 0.43 * (scales - 0.5) + 0.13 * (grain - 0.5), 0.0, 1.0)
    roughness = 0.31 + 0.13 * height - 0.08 * lines + 0.04 * orange
    return {
        "albedo": albedo,
        "roughness": textures.grey(roughness),
        "normal": textures.normal_from_height(height, 0.86),
    }


def paint_fin(ctx):
    _require_species(ctx)
    fin = next(item for item in ctx.spec["morphology"]["fins"] if item["name"] == ctx.fin)
    ray_count = float(fin.get("rayCount", 16))
    rays = paint.rays(ctx.U, ray_count, 4.5)
    grain = fbm(ctx.U * 24.0, ctx.V * 10.0, octaves=2, seed=59)
    if ctx.fin in ("dorsal", "anal"):
        albedo = textures.rgba(FIN_RED, 0.94, ctx.shape)
        blue = (0.5 + 0.5 * np.cos(ctx.V * np.pi * 17.0 + grain * 3.0)) ** 8
        spots = paint.spots(ctx.U, ctx.V, density=23.0, radius=0.17, seed=67, jitter_radius=0.62)
        albedo = textures.mix(albedo, DEEP_BLUE, (1.0 - smoothstep(0.0, 0.30, ctx.V)) * 0.72)
        albedo = textures.mix(albedo, TURQUOISE, blue * 0.74)
        albedo = textures.mix(albedo, PALE_BLUE, spots * 0.66)
        alpha = 0.94 - 0.12 * smoothstep(0.82, 1.0, ctx.V)
    elif ctx.fin == "caudal":
        albedo = textures.rgba(ORANGE, 0.92, ctx.shape)
        albedo = textures.mix(albedo, TURQUOISE, rays * 0.36)
        albedo = textures.mix(albedo, DEEP_BLUE, (1.0 - smoothstep(0.0, 0.14, ctx.V)) * 0.42)
        alpha = 0.91 - 0.14 * smoothstep(0.80, 1.0, ctx.V)
    else:
        albedo = textures.rgba(GOLD, 0.68, ctx.shape)
        albedo = textures.mix(albedo, TURQUOISE, rays * 0.28)
        alpha = 0.66 - 0.20 * smoothstep(0.58, 1.0, ctx.V)
    albedo = textures.scale_rgb(albedo, 0.88 + 0.15 * rays)
    albedo[..., 3] = np.clip(alpha, 0.0, 1.0)
    height = np.clip(0.36 + 0.48 * rays + 0.08 * (grain - 0.5), 0.0, 1.0)
    return {"albedo": albedo, "height": height}
