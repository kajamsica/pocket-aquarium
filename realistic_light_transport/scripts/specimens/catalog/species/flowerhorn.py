"""Adult male red-pearl Flowerhorn procedural paint and response hooks.

Geometry is declarative in ``art/specimens/flowerhorn/asset.source.json``. The
target is an ornamental cichlid hybrid, not a biological species. This backend
adds deterministic red-orange ground color, a broken dark lateral flower line,
small turquoise-white pearl marks, and a restrained large-cichlid display. It
never samples or copies source pixels.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import paint, textures
from ..lib.animation import Channel
from ..lib.noise import fbm, smoothstep


DEEP_RED = (0.60, 0.045, 0.020)
SCARLET = (0.88, 0.095, 0.025)
ORANGE_RED = (0.92, 0.22, 0.045)
PALE_GOLD = (0.78, 0.37, 0.12)
BELLY = (0.82, 0.28, 0.10)
FLOWER = (0.035, 0.025, 0.024)
FLOWER_EDGE = (0.18, 0.065, 0.035)
PEARL_BLUE = (0.25, 0.86, 0.88)
PEARL_WHITE = (0.78, 0.98, 0.95)
FIN_RED = (0.64, 0.055, 0.020)
FIN_DARK = (0.10, 0.025, 0.020)


def _require_species(ctx):
    if ctx.spec.get("textureStyle") != "flowerhorn_red_pearl":
        raise ValueError(f"Unsupported Flowerhorn textureStyle: {ctx.spec.get('textureStyle')}")


def _pearl_mask(u, v, zeta):
    """Varied, clustered scale-associated pearls concentrated on the lateral flank."""
    warp_u = (fbm(u * 9.0, v * 7.0, octaves=2, seed=71) - 0.5) * 0.035
    warp_v = (fbm(u * 7.0, v * 11.0, octaves=2, seed=72) - 0.5) * 0.055
    fine = paint.spots(u + warp_u, v + warp_v, density=44.0, radius=0.15, seed=73, jitter_radius=0.72)
    coarse = paint.spots(u - warp_u * 0.6, v + warp_v * 0.4, density=27.0, radius=0.18, seed=75, jitter_radius=0.65)
    clusters = smoothstep(0.43, 0.68, fbm(u * 17.0, v * 11.0, octaves=3, seed=79))
    sparse = smoothstep(0.56, 0.78, fbm(u * 31.0, v * 19.0, octaves=2, seed=81))
    lateral = 1.0 - smoothstep(0.76, 0.98, np.abs(zeta))
    head_keep = 1.0 - 0.38 * smoothstep(0.80, 0.97, u)
    varied = np.maximum(fine * clusters, coarse * sparse * 0.72)
    return np.clip(varied * lateral * head_keep, 0.0, 1.0)


def _flower_line(u, v, zeta):
    """Broken mid-lateral characters, never a continuous stripe."""
    center = 0.025 * np.sin(u * math.pi * 5.0) + (fbm(u * 13.0, zeta * 6.0, octaves=2, seed=43) - 0.5) * 0.09
    corridor = 1.0 - smoothstep(0.12, 0.29, np.abs(zeta - center))
    broad = smoothstep(0.47, 0.66, fbm(u * 15.0, zeta * 6.0, octaves=3, seed=47))
    narrow = smoothstep(0.50, 0.67, fbm(u * 29.0 + zeta * 3.0, zeta * 11.0, octaves=2, seed=51))
    breaks = smoothstep(0.41, 0.63, fbm(u * 9.0, zeta * 15.0, octaves=2, seed=53))
    end_fade = smoothstep(0.09, 0.19, u) * (1.0 - smoothstep(0.78, 0.93, u))
    return np.clip(corridor * np.maximum(broad, narrow * 0.68) * breaks * end_fade, 0.0, 1.0)


def paint_body(ctx):
    _require_species(ctx)
    u, v, z, x = ctx.U, ctx.V, ctx.ZETA, ctx.X
    scales = paint.scales_height(u, v, 78.0, 36.0, seed=19)
    grain = fbm(u * 52.0, v * 28.0, octaves=2, seed=23)
    height = np.clip(0.48 + 0.42 * (scales - 0.5) + 0.16 * (grain - 0.5), 0.0, 1.0)

    albedo = textures.rgba(SCARLET, 1.0, ctx.shape)
    anterior = smoothstep(0.48, 0.88, u)
    posterior = 1.0 - smoothstep(0.10, 0.52, u)
    albedo = textures.mix(albedo, DEEP_RED, anterior * 0.52)
    albedo = textures.mix(albedo, ORANGE_RED, posterior * 0.48)
    albedo = textures.mix(albedo, BELLY, smoothstep(-0.22, -0.92, z) * 0.52)
    albedo = textures.mix(albedo, PALE_GOLD, posterior * smoothstep(-0.05, -0.75, z) * 0.32)
    albedo = textures.scale_rgb(albedo, 0.90 + 0.15 * grain)

    flowers = _flower_line(u, v, z)
    flower_edge = np.clip(3.2 * flowers * (1.0 - flowers), 0.0, 1.0)
    albedo = textures.mix(albedo, FLOWER_EDGE, flower_edge * 0.35)
    albedo = textures.mix(albedo, FLOWER, flowers * 0.88)

    pearls = _pearl_mask(u, v, z)
    pearl_glint = smoothstep(0.60, 0.92, fbm(u * 67.0, v * 31.0, octaves=2, seed=83))
    albedo = textures.mix(albedo, PEARL_BLUE, pearls * 0.78)
    albedo = textures.mix(albedo, PEARL_WHITE, pearls * pearl_glint * 0.68)

    roughness = 0.34 + 0.13 * height + 0.08 * flowers - 0.12 * pearls
    return {
        "albedo": albedo,
        "roughness": textures.grey(roughness),
        "normal": textures.normal_from_height(height + pearls * 0.12, 0.90),
    }


def paint_fin(ctx):
    _require_species(ctx)
    fin = next(item for item in ctx.spec["morphology"]["fins"] if item["name"] == ctx.fin)
    rays = paint.rays(ctx.U, float(fin.get("rayCount", 14)), 4.8)
    albedo = textures.rgba(FIN_RED, 1.0, ctx.shape)
    albedo = textures.scale_rgb(albedo, 0.84 + 0.20 * rays)

    if ctx.fin in ("dorsal", "anal", "caudal"):
        warp = (fbm(ctx.U * 8.0, ctx.V * 12.0, octaves=2, seed=95) - 0.5) * 0.045
        fine = paint.spots(ctx.U + warp, ctx.V, density=31.0, radius=0.14, seed=97, jitter_radius=0.72)
        coarse = paint.spots(ctx.U - warp, ctx.V, density=19.0, radius=0.18, seed=99, jitter_radius=0.62)
        clusters = smoothstep(0.46, 0.70, fbm(ctx.U * 18.0, ctx.V * 13.0, octaves=2, seed=101))
        pearls = np.maximum(fine * clusters, coarse * (1.0 - clusters) * 0.58)
        pearls *= smoothstep(0.05, 0.24, ctx.V) * (1.0 - smoothstep(0.84, 0.98, ctx.V))
        albedo = textures.mix(albedo, PEARL_BLUE, pearls * 0.80)
        albedo = textures.mix(albedo, FIN_DARK, (1.0 - smoothstep(0.0, 0.12, ctx.V)) * 0.38)
        alpha = 0.94 - 0.10 * smoothstep(0.76, 1.0, ctx.V)
    else:
        albedo = textures.mix(albedo, (0.88, 0.36, 0.14), rays * 0.18)
        alpha = 0.62 - 0.22 * smoothstep(0.48, 1.0, ctx.V)

    albedo[..., 3] = np.clip(alpha, 0.0, 1.0)
    height = np.clip(0.34 + 0.50 * rays, 0.0, 1.0)
    return {"albedo": albedo, "height": height}


def extra_channels(clip_name, spec, envelope):
    """Keep the heavy cichlid upright while its fins and jaw carry the display."""
    clip = spec["animation"][clip_name]
    channels = []
    roll = float(clip.get("bodyRoll", 0.0))
    if roll:
        channels.append(Channel("Body", "rotation", (0.0, 1.0, 0.0), roll,
                                float(clip.get("pectoralFrequency", 2.0)), math.pi / 2,
                                envelope=envelope))
    return channels
