"""Paint hooks for the first freshwater fish source package.

Geometry remains fully declarative in each asset.source.json and is built by the
existing fish body plan. These hooks only author species-specific colour placement
and surface relief from fixed equations and seeds. No reference pixels are copied.
"""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep


def _scale_relief(ctx, rows: float, columns: float, seed: int = 5):
    scales = paint.scales_height(ctx.U, ctx.V, rows, columns, seed=seed)
    skin = fbm(ctx.U * 58.0, ctx.V * 29.0, octaves=2, seed=seed + 13)
    return np.clip(0.68 * scales + 0.32 * skin, 0.0, 1.0)


def paint_body(ctx):
    if ctx.spec.get("textureStyle") != "betta_splendens_male":
        raise ValueError(f"Unsupported freshwater fish textureStyle: {ctx.spec.get('textureStyle')}")
    u, z, v = ctx.U, ctx.ZETA, ctx.V
    flank = textures.rgba((0.055, 0.34, 0.38), 1.0, ctx.shape)
    cyan = textures.rgba((0.05, 0.62, 0.66), 1.0, ctx.shape)
    red = (0.62, 0.035, 0.055)
    dark = (0.025, 0.045, 0.055)
    iridescence = fbm(u * 42.0, v * 22.0, octaves=3, seed=31)
    albedo = textures.mix(flank, cyan, smoothstep(0.44, 0.78, iridescence) * 0.58)
    albedo = textures.mix(albedo, dark, smoothstep(0.73, 0.95, u) * 0.78)
    belly = smoothstep(-0.30, -0.90, z)
    albedo = textures.mix(albedo, (0.18, 0.38, 0.35), belly * 0.45)
    shoulder = smoothstep(0.58, 0.72, u) * (1.0 - smoothstep(0.80, 0.92, u))
    albedo = textures.mix(albedo, red, shoulder * smoothstep(-0.35, 0.25, z) * 0.24)
    height = _scale_relief(ctx, 52.0, 24.0)
    roughness = 0.30 + 0.13 * height + 0.07 * smoothstep(0.70, 1.0, u)
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(height, 0.95)}


def _fin_base(ctx, colour, edge_colour, alpha=0.90):
    ray = paint.rays(ctx.U, 16.0, 4.0)
    albedo = textures.rgba(colour, 1.0, ctx.shape)
    albedo = textures.mix(albedo, edge_colour, smoothstep(0.70, 1.0, ctx.V) * 0.72)
    albedo = textures.scale_rgb(albedo, 0.88 + 0.18 * ray)
    albedo[..., 3] = np.clip(alpha - 0.14 * smoothstep(0.88, 1.0, ctx.V), 0.0, 1.0)
    return albedo


def paint_fin(ctx):
    if ctx.spec.get("textureStyle") != "betta_splendens_male":
        raise ValueError(f"Unsupported freshwater fish textureStyle: {ctx.spec.get('textureStyle')}")
    if ctx.fin == "pectoral":
        return _fin_base(ctx, (0.10, 0.45, 0.48), (0.55, 0.08, 0.12), 0.72)
    if ctx.fin == "pelvic":
        return _fin_base(ctx, (0.34, 0.025, 0.045), (0.82, 0.10, 0.12), 0.96)
    return _fin_base(ctx, (0.10, 0.30, 0.34), (0.82, 0.06, 0.09), 0.92)
