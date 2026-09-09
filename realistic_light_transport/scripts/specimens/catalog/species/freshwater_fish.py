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
    navy = textures.rgba((0.018, 0.055, 0.12), 1.0, ctx.shape)
    cobalt = textures.rgba((0.018, 0.22, 0.52), 1.0, ctx.shape)
    turquoise = textures.rgba((0.015, 0.38, 0.43), 1.0, ctx.shape)
    dark = (0.012, 0.025, 0.05)
    height = _scale_relief(ctx, 52.0, 24.0)

    # Keep the blue-green sheen coherent along the scale rows. The rejected source
    # thresholded broad FBM islands, producing camouflage-like pale patches that do
    # not read as iridescent Betta scales.
    fine_variation = fbm(u * 76.0, v * 36.0, octaves=2, seed=31)
    scale_sheen = np.clip(0.72 * height + 0.28 * fine_variation, 0.0, 1.0)
    albedo = textures.mix(navy, cobalt, 0.48 + 0.32 * scale_sheen)
    lateral_sheen = (1.0 - np.abs(z)) * smoothstep(0.24, 0.84, scale_sheen)
    albedo = textures.mix(albedo, turquoise, lateral_sheen * 0.34)

    # A dark dorsum, face and caudal peduncle frame the metallic flank without
    # inventing a hard body patch not present in the phenotype references.
    albedo = textures.mix(albedo, dark, smoothstep(0.20, 0.92, z) * 0.44)
    albedo = textures.mix(albedo, dark, smoothstep(0.76, 0.98, u) * 0.58)
    albedo = textures.mix(albedo, dark, (1.0 - smoothstep(0.02, 0.16, u)) * 0.24)
    belly = smoothstep(-0.24, -0.94, z)
    albedo = textures.mix(albedo, (0.08, 0.18, 0.24), belly * 0.36)
    roughness = 0.27 + 0.11 * height + 0.08 * smoothstep(0.72, 1.0, u)
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(height, 0.95)}


def _fin_base(ctx, colour, edge_colour, alpha=0.90, edge_start=0.54):
    ray = paint.rays(ctx.U, 16.0, 4.0)
    albedo = textures.rgba(colour, 1.0, ctx.shape)
    distal = smoothstep(edge_start, 0.96, ctx.V)
    albedo = textures.mix(albedo, edge_colour, distal * 0.88)
    albedo = textures.scale_rgb(albedo, 0.82 + 0.22 * ray)
    albedo[..., 3] = np.clip(alpha - 0.18 * smoothstep(0.84, 1.0, ctx.V), 0.0, 1.0)
    return albedo


def paint_fin(ctx):
    if ctx.spec.get("textureStyle") != "betta_splendens_male":
        raise ValueError(f"Unsupported freshwater fish textureStyle: {ctx.spec.get('textureStyle')}")
    if ctx.fin == "pectoral":
        return _fin_base(ctx, (0.035, 0.22, 0.38), (0.34, 0.035, 0.065), 0.64, 0.72)
    if ctx.fin == "pelvic":
        return _fin_base(ctx, (0.26, 0.012, 0.035), (0.78, 0.035, 0.055), 0.94, 0.38)
    return _fin_base(ctx, (0.025, 0.12, 0.30), (0.72, 0.018, 0.035), 0.90, 0.52)
