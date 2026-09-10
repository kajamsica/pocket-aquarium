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
    """Small irregular scale-associated pearls, concentrated on the lateral flank."""
    fine = paint.spots(u, v, density=38.0, radius=0.22, seed=73, jitter_radius=0.42)
    broken = smoothstep(0.44, 0.72, fbm(u * 31.0, v * 19.0, octaves=2, seed=79))
    lateral = 1.0 - smoothstep(0.76, 0.98, np.abs(zeta))
    head_keep = 1.0 - 0.38 * smoothstep(0.80, 0.97, u)
    return np.clip(fine * (0.42 + 0.58 * broken) * lateral * head_keep, 0.0, 1.0)


def _flower_line(u, v, zeta):
    """Broken mid-lateral characters, never a continuous stripe."""
    center = 0.03 * np.sin(u * math.pi * 7.0) + (fbm(u * 18.0, v * 5.0, octaves=2, seed=43) - 0.5) * 0.10
    corridor = 1.0 - smoothstep(0.14, 0.30, np.abs(zeta - center))
    cells = smoothstep(0.54, 0.72, fbm(u * 12.0, v * 7.0, octaves=3, seed=47))
    segments = (0.5 + 0.5 * np.cos((u * 12.0 + 0.18 * np.sin(v * math.pi * 5.0)) * math.pi)) ** 4
    end_fade = smoothstep(0.09, 0.19, u) * (1.0 - smoothstep(0.78, 0.93, u))
    return np.clip(corridor * np.maximum(cells * 0.90, segments * 0.72) * end_fade, 0.0, 1.0)


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
        pearls = paint.spots(ctx.U, ctx.V, density=25.0, radius=0.20, seed=97, jitter_radius=0.38)
        pearls *= smoothstep(0.05, 0.24, ctx.V) * (1.0 - smoothstep(0.84, 0.98, ctx.V))
        breaks = smoothstep(0.42, 0.68, fbm(ctx.U * 24.0, ctx.V * 15.0, octaves=2, seed=101))
        albedo = textures.mix(albedo, PEARL_BLUE, pearls * (0.45 + 0.55 * breaks) * 0.80)
        albedo = textures.mix(albedo, FIN_DARK, (1.0 - smoothstep(0.0, 0.12, ctx.V)) * 0.38)
        alpha = 0.94 - 0.10 * smoothstep(0.76, 1.0, ctx.V)
    else:
        albedo = textures.mix(albedo, (0.88, 0.36, 0.14), rays * 0.18)
        alpha = 0.62 - 0.22 * smoothstep(0.48, 1.0, ctx.V)

    albedo[..., 3] = np.clip(alpha, 0.0, 1.0)
    height = np.clip(0.34 + 0.50 * rays, 0.0, 1.0)
    return {"albedo": albedo, "height": height}


def extra_channels(clip_name, spec, envelope):
    """Keep the heavy cichlid upright and add a readable display yaw."""
    clip = spec["animation"][clip_name]
    channels = []
    roll = float(clip.get("bodyRoll", 0.0))
    if roll:
        channels.append(Channel("Body", "rotation", (0.0, 1.0, 0.0), roll,
                                float(clip.get("pectoralFrequency", 2.0)), math.pi / 2,
                                envelope=envelope))
    if clip_name == "display":
        channels.append(Channel("Body", "rotation", (0.0, 0.0, 1.0), 13.0, 1.0, 0.0,
                                envelope=envelope))
    return channels
