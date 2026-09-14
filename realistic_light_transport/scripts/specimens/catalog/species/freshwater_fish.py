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
    navy = textures.rgba((0.004, 0.018, 0.070), 1.0, ctx.shape)
    cobalt = textures.rgba((0.006, 0.085, 0.350), 1.0, ctx.shape)
    electric_blue = textures.rgba((0.012, 0.260, 0.720), 1.0, ctx.shape)
    dark = (0.003, 0.010, 0.035)
    height = _scale_relief(ctx, 52.0, 24.0)

    # Keep the saturated blue sheen coherent along the scale rows. The rejected source
    # thresholded broad FBM islands, producing camouflage-like pale patches that do
    # not read as iridescent Betta scales.
    fine_variation = fbm(u * 76.0, v * 36.0, octaves=2, seed=31)
    scale_sheen = np.clip(0.72 * height + 0.28 * fine_variation, 0.0, 1.0)
    albedo = textures.mix(navy, cobalt, 0.64 + 0.24 * scale_sheen)
    lateral_sheen = (1.0 - np.abs(z)) * smoothstep(0.24, 0.84, scale_sheen)
    albedo = textures.mix(albedo, electric_blue, lateral_sheen * 0.46)

    # A dark dorsum, face and caudal peduncle frame the metallic flank without
    # inventing a hard body patch not present in the phenotype references.
    albedo = textures.mix(albedo, dark, smoothstep(0.28, 0.94, z) * 0.34)
    albedo = textures.mix(albedo, dark, smoothstep(0.76, 0.98, u) * 0.48)
    albedo = textures.mix(albedo, dark, (1.0 - smoothstep(0.02, 0.16, u)) * 0.24)
    belly = smoothstep(-0.24, -0.94, z)
    albedo = textures.mix(albedo, (0.035, 0.095, 0.260), belly * 0.28)
    roughness = 0.42 + 0.08 * height + 0.05 * smoothstep(0.72, 1.0, u)
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(height, 0.78)}


def _fin_base(ctx, colour, edge_colour, ray_count, seed, alpha=0.82, edge_start=0.40):
    grain = fbm(ctx.U * 11.0, ctx.V * 7.0, octaves=2, seed=seed)
    warp = (grain - 0.5) * (0.018 + 0.035 * ctx.V)
    primary = paint.rays(ctx.U + warp, ray_count, 3.4)
    secondary = paint.rays(ctx.U - warp * 0.55 + 0.004 * np.sin(ctx.V * np.pi * 3.0),
                           ray_count * 0.53 + 0.7, 2.2)
    ray = np.clip(0.78 * primary + 0.22 * secondary, 0.0, 1.0)
    albedo = textures.rgba(colour, 1.0, ctx.shape)
    distal = smoothstep(edge_start + (grain - 0.5) * 0.08, 0.94, ctx.V)
    albedo = textures.mix(albedo, edge_colour, distal * 0.94)
    albedo = textures.scale_rgb(albedo, 0.78 + 0.25 * ray + 0.05 * grain)
    edge_noise = fbm(ctx.U * 17.0, ctx.V * 5.0, octaves=2, seed=seed + 29)
    edge_fade = smoothstep(0.76 + (edge_noise - 0.5) * 0.16, 1.0, ctx.V)
    ray_opacity = 0.04 + 0.28 * ray
    membrane_alpha = alpha - 0.72 * edge_fade + ray_opacity * edge_fade
    membrane_alpha += 0.05 * (ray - 0.5) * (0.25 + 0.75 * ctx.V)
    albedo[..., 3] = np.clip(membrane_alpha, 0.08, 0.90)
    height = np.clip(0.38 + 0.30 * ray * (0.30 + 0.70 * ctx.V) + 0.07 * (grain - 0.5), 0.0, 1.0)
    return {"albedo": albedo, "height": height}


def paint_fin(ctx):
    if ctx.spec.get("textureStyle") != "betta_splendens_male":
        raise ValueError(f"Unsupported freshwater fish textureStyle: {ctx.spec.get('textureStyle')}")
    fin = next(item for item in ctx.spec["morphology"]["fins"] if item["name"] == ctx.fin)
    ray_count = float(fin.get("rayCount", 16))
    if ctx.fin == "pectoral":
        return _fin_base(ctx, (0.010, 0.110, 0.330), (0.40, 0.015, 0.045), ray_count, 131, 0.58, 0.64)
    if ctx.fin == "pelvic":
        return _fin_base(ctx, (0.22, 0.008, 0.030), (0.82, 0.015, 0.035), ray_count, 149, 0.86, 0.22)
    seed = {"dorsal": 167, "anal": 181, "caudal": 199}.get(ctx.fin, 211)
    return _fin_base(ctx, (0.008, 0.055, 0.260), (0.82, 0.008, 0.025), ray_count, seed, 0.84, 0.18)
