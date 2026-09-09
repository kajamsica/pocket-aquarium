"""Wild-type Symphysodon discus procedural paint and response hooks.

Geometry is declarative in ``art/specimens/discus/asset.source.json``. This
dedicated backend paints the diagnostic Heckel bar pattern and restrained
blue-green striations with fixed equations and seeds. It uses no source pixels.
"""

from __future__ import annotations

import numpy as np

from ..lib import animation, paint, textures
from ..lib.noise import fbm, smoothstep


BROWN = (0.30, 0.18, 0.085)
AMBER = (0.52, 0.28, 0.10)
BELLY = (0.60, 0.40, 0.19)
BAR = (0.035, 0.025, 0.022)
CENTRAL_BAR = (0.018, 0.014, 0.014)
TURQUOISE = (0.025, 0.48, 0.54)
FIN_BROWN = (0.34, 0.18, 0.075)


def _require_species(ctx):
    if ctx.spec.get("textureStyle") != "discus_wild_heckel":
        raise ValueError(f"Unsupported Discus textureStyle: {ctx.spec.get('textureStyle')}")


def _vertical_bars(ctx):
    """Nine bounded wild-type bars, with the fifth broader and darker."""
    wander = (fbm(ctx.ZETA * 4.0, ctx.V * 5.0, octaves=2, seed=17) - 0.5) * 0.010
    narrow = np.zeros(ctx.shape)
    centers = (0.075, 0.18, 0.285, 0.395, 0.605, 0.715, 0.82, 0.925)
    for center in centers:
        narrow = np.maximum(narrow, paint.band(ctx.U - wander, center, 0.017, 0.008))
    central = paint.band(ctx.U - wander * 0.6, 0.50, 0.036, 0.010)
    flank = smoothstep(-0.94, -0.78, ctx.ZETA) * (1.0 - smoothstep(0.78, 0.94, ctx.ZETA))
    return narrow * flank, central * flank


def _blue_striations(ctx):
    """Fine broken horizontal striations concentrated on head and upper flank."""
    distortion = (fbm(ctx.U * 9.0, ctx.V * 7.0, octaves=3, seed=31) - 0.5) * 3.0
    waves = (0.5 + 0.5 * np.cos((ctx.ZETA + 0.10 * ctx.U) * np.pi * 17.0 + distortion)) ** 10
    upper = smoothstep(-0.30, 0.05, ctx.ZETA)
    head = smoothstep(0.62, 0.88, ctx.U)
    breaks = smoothstep(0.32, 0.58, fbm(ctx.U * 25.0, ctx.V * 13.0, octaves=2, seed=43))
    return waves * upper * (0.35 + 0.65 * head) * breaks


def paint_body(ctx):
    _require_species(ctx)
    narrow_bars, central_bar = _vertical_bars(ctx)
    striations = _blue_striations(ctx)
    albedo = textures.rgba(BROWN, 1.0, ctx.shape)
    albedo = textures.mix(albedo, AMBER, (1.0 - np.abs(ctx.ZETA)) * 0.44)
    albedo = textures.mix(albedo, BELLY, smoothstep(-0.22, -0.90, ctx.ZETA) * 0.52)
    albedo = textures.mix(albedo, BAR, narrow_bars * 0.82)
    albedo = textures.mix(albedo, CENTRAL_BAR, central_bar * 0.94)
    albedo = textures.mix(albedo, TURQUOISE, striations * 0.72)
    scales = paint.scales_height(ctx.U, ctx.V, 66.0, 34.0, seed=11)
    grain = fbm(ctx.U * 72.0, ctx.V * 36.0, octaves=2, seed=7)
    height = np.clip(0.48 + 0.44 * (scales - 0.5) + 0.12 * (grain - 0.5), 0.0, 1.0)
    roughness = 0.34 + 0.12 * height + 0.06 * narrow_bars + 0.08 * central_bar
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(height, 0.82)}


def paint_fin(ctx):
    _require_species(ctx)
    ray_count = {"dorsal": 28.0, "anal": 25.0, "caudal": 18.0, "pectoral": 14.0, "pelvic": 8.0}.get(ctx.fin, 16.0)
    rays = paint.rays(ctx.U, ray_count, 4.5)
    grain = fbm(ctx.U * 24.0, ctx.V * 10.0, octaves=2, seed=59)
    if ctx.fin in ("dorsal", "anal"):
        albedo = textures.rgba(FIN_BROWN, 0.92, ctx.shape)
        bands = paint.vertical_bars(ctx.U, 5, 0.05, 0.95, 0.035, 0.015, ctx.V, 0.012, seed=61)
        blue = (0.5 + 0.5 * np.cos(ctx.V * np.pi * 13.0 + grain * 2.2)) ** 9
        albedo = textures.mix(albedo, BAR, bands * 0.62)
        albedo = textures.mix(albedo, TURQUOISE, blue * 0.58)
        alpha = 0.91 - 0.13 * smoothstep(0.84, 1.0, ctx.V)
    elif ctx.fin == "caudal":
        albedo = textures.rgba((0.42, 0.24, 0.10), 0.88, ctx.shape)
        albedo = textures.mix(albedo, BAR, smoothstep(0.0, 0.16, ctx.V) * 0.45)
        alpha = 0.86 - 0.18 * smoothstep(0.76, 1.0, ctx.V)
    else:
        albedo = textures.rgba((0.48, 0.31, 0.15), 0.62, ctx.shape)
        alpha = 0.60 - 0.22 * smoothstep(0.58, 1.0, ctx.V)
    albedo = textures.scale_rgb(albedo, 0.88 + 0.15 * rays)
    albedo[..., 3] = np.clip(alpha, 0.0, 1.0)
    height = np.clip(0.36 + 0.48 * rays + 0.08 * (grain - 0.5), 0.0, 1.0)
    return {"albedo": albedo, "height": height}


def extra_channels(clip_name, spec, envelope):
    """Add a restrained whole-body yaw for the non-looping display/turn response."""
    if clip_name != "display":
        return []
    return [animation.Channel("Body", "rotation", (0.0, 0.0, 1.0), 18.0, 1.0, 0.0,
                              "const", envelope=envelope)]
