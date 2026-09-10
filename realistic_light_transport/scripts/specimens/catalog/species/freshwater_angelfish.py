"""Wild-type Pterophyllum scalare paint and hover hooks for the shared fish plan.

Geometry is declarative in ``asset.source.json``. This module adds the adult
four-bar silver pattern, restrained warm eye and fin cues, translucent
ray-supported fins, and pectoral-led hover/display motion. It never samples
reference pixels.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import paint, textures
from ..lib.animation import Channel
from ..lib.noise import fbm, smoothstep

SILVER = (0.56, 0.63, 0.60)
PALE = (0.76, 0.79, 0.73)
OLIVE = (0.22, 0.27, 0.21)
BAR = (0.025, 0.030, 0.028)
BAR_EDGE = (0.16, 0.17, 0.14)
FIN = (0.55, 0.55, 0.43)
FIN_DARK = (0.050, 0.057, 0.050)
WARM = (0.82, 0.48, 0.10)
BAR_CENTRES = (0.033, 0.016, -0.007, -0.032)


def _require_species(ctx):
    if ctx.spec.get("textureStyle") != "freshwater_angelfish":
        raise ValueError(f"Unsupported freshwater angelfish textureStyle: {ctx.spec.get('textureStyle')}")


def _bar_mask(x, zeta):
    """Four softly bounded adult bars with life-like bowing, never the juvenile seven."""
    mask = np.zeros(x.shape)
    wander = (fbm(x * 72.0 + 1.7, zeta * 4.2 + 0.3, octaves=2, seed=29) - 0.5) * 0.00085
    for index, centre in enumerate(BAR_CENTRES):
        width = (0.0022, 0.0028, 0.0029, 0.0023)[index]
        bowed = centre - 0.0017 * zeta + 0.0012 * (zeta * zeta - 0.30) + wander
        mask = np.maximum(mask, 1.0 - smoothstep(width - 0.00065, width + 0.00065, np.abs(x - bowed)))
    return np.clip(mask, 0.0, 1.0)


def paint_body(ctx):
    _require_species(ctx)
    u, v, z, x = ctx.U, ctx.V, ctx.ZETA, ctx.X
    bars = _bar_mask(x, z)
    scales = paint.scales_height(u, v, 78.0, 34.0, seed=7)
    grain = fbm(u * 48.0, v * 24.0, octaves=2, seed=17)
    height = np.clip(0.45 + 0.45 * scales + 0.10 * grain, 0.0, 1.0)
    albedo = textures.rgba(SILVER, 1.0, ctx.shape)
    albedo = textures.mix(albedo, OLIVE, smoothstep(0.18, 0.95, z) * 0.58)
    albedo = textures.mix(albedo, PALE, smoothstep(-0.16, -0.95, z) * 0.62)
    warm_throat = smoothstep(0.012, 0.038, x) * smoothstep(-0.18, -0.86, z)
    albedo = textures.mix(albedo, WARM, warm_throat * 0.24)
    flank_sheen = (1.0 - np.abs(z)) * (0.30 + 0.70 * grain)
    albedo = textures.mix(albedo, (0.72, 0.79, 0.76), flank_sheen * 0.36)
    albedo = textures.scale_rgb(albedo, 0.91 + 0.13 * grain)
    edge = np.clip(3.2 * bars * (1.0 - bars), 0.0, 1.0)
    albedo = textures.mix(albedo, BAR_EDGE, edge * 0.34)
    albedo = textures.mix(albedo, BAR, bars * 0.78)
    return {"albedo": albedo, "roughness": textures.grey(0.33 + 0.12 * height + 0.07 * bars),
            "normal": textures.normal_from_height(height, 0.82)}


def paint_fin(ctx):
    _require_species(ctx)
    fin = next(item for item in ctx.spec["morphology"]["fins"] if item["name"] == ctx.fin)
    count = float(fin.get("rayCount", 14))
    rays = paint.rays(ctx.U, count, 4.6)
    if ctx.fin in ("dorsal", "anal"):
        x = float(fin["xStart"]) + ctx.U * (float(fin["xEnd"]) - float(fin["xStart"]))
        z = np.full(ctx.shape, 1.0 if ctx.fin == "dorsal" else -1.0)
        bars = _bar_mask(x, z)
        albedo = textures.rgba(FIN, 1.0, ctx.shape)
        albedo = textures.mix(albedo, WARM, rays * (1.0 - ctx.V) * 0.14)
        albedo = textures.mix(albedo, FIN_DARK, bars * (0.66 - 0.24 * ctx.V))
        alpha = 0.40 + 0.31 * rays - 0.11 * smoothstep(0.72, 1.0, ctx.V)
    elif ctx.fin == "pelvic":
        albedo = textures.rgba(FIN_DARK, 1.0, ctx.shape)
        alpha = 0.48 + 0.30 * rays - 0.08 * smoothstep(0.82, 1.0, ctx.V)
    else:
        albedo = textures.rgba(FIN, 1.0, ctx.shape)
        albedo = textures.mix(albedo, WARM, rays * 0.16)
        alpha = 0.36 + 0.29 * rays - 0.09 * smoothstep(0.60, 1.0, ctx.V)
        if ctx.fin == "caudal":
            albedo = textures.mix(albedo, FIN_DARK, (1.0 - smoothstep(0.0, 0.18, ctx.V)) * 0.55)
    albedo = textures.scale_rgb(albedo, 0.86 + 0.18 * rays)
    albedo[..., 3] = np.clip(alpha, 0.0, 1.0)
    height = np.clip(0.34 + 0.48 * rays * (0.28 + 0.72 * ctx.V), 0.0, 1.0)
    return {"albedo": albedo, "height": height}


def extra_channels(clip_name, spec, envelope):
    """Small roll/pitch cues preserve upright hover and make display readable."""
    clip = spec["animation"][clip_name]
    channels = []
    roll = float(clip.get("bodyRoll", 0.0))
    if roll:
        channels.append(Channel("Body", "rotation", (0.0, 1.0, 0.0), roll,
                                float(clip.get("pectoralFrequency", 2.0)), math.pi / 2, envelope=envelope))
    pitch = float(clip.get("hoverPitch", 0.0))
    if pitch:
        channels.append(Channel("Body", "rotation", (1.0, 0.0, 0.0), pitch,
                                float(clip.get("hoverFrequency", 1.0)), 0.0, envelope=envelope))
    return channels
