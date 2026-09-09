"""Corydoras aeneus (Bronze Cory): armored, benthic freshwater fish paint hooks.

The shared ``fish`` plan carries the high-backed body, inferior mouth, paired
barbels, fins and rig from ``art/specimens/bronze_cory/asset.source.json``.
This module supplies deterministic bronze/olive colour, lateral plate relief,
and restrained bottom-dweller movement accents. No reference pixels are used.
"""

from __future__ import annotations

import numpy as np

from ..lib import animation, paint, textures
from ..lib.noise import fbm, smoothstep


BRONZE = (0.43, 0.38, 0.24)
OLIVE = (0.30, 0.29, 0.20)
BELLY = (0.70, 0.66, 0.49)
PLATE = (0.16, 0.16, 0.12)
FIN = (0.46, 0.42, 0.27)
FIN_EDGE = (0.22, 0.20, 0.13)


def _plate_relief(ctx):
    """Return seeded plate and skin relief, weighted toward the lateral trunk."""
    scales = paint.scales_height(ctx.U, ctx.V, 30.0, 18.0, seed=17)
    skin = fbm(ctx.U * 72.0, ctx.V * 34.0, octaves=2, seed=23)
    lateral = 1.0 - np.abs(ctx.ZETA)
    plate_edges = 0.5 + 0.5 * np.cos(ctx.U * np.pi * 2.0 * 24.0)
    plate_edges = np.clip(plate_edges, 0.0, 1.0) * smoothstep(0.18, 0.72, lateral)
    return np.clip(0.54 * scales + 0.22 * skin + 0.24 * plate_edges, 0.0, 1.0), plate_edges


def paint_body(ctx):
    if ctx.spec.get("textureStyle") != "bronze_cory":
        raise ValueError(f"Unsupported freshwater fish textureStyle: {ctx.spec.get('textureStyle')}")
    u, z, v = ctx.U, ctx.ZETA, ctx.V
    albedo = textures.rgba(BRONZE, 1.0, ctx.shape)
    back = smoothstep(0.22, 0.90, z)
    belly = smoothstep(-0.28, -0.88, z)
    albedo = textures.mix(albedo, OLIVE, back * 0.72)
    albedo = textures.mix(albedo, BELLY, belly * 0.76)

    mottling = fbm(u * 24.0, v * 13.0, octaves=3, seed=31)
    albedo = textures.scale_rgb(albedo, 0.88 + 0.20 * mottling)
    plate_height, plate_edges = _plate_relief(ctx)
    albedo = textures.mix(albedo, PLATE, plate_edges * smoothstep(0.48, 0.95, back) * 0.14)
    roughness = 0.48 + 0.16 * plate_height + 0.04 * back
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(plate_height, 1.05)}


def paint_fin(ctx):
    if ctx.spec.get("textureStyle") != "bronze_cory":
        raise ValueError(f"Unsupported freshwater fish textureStyle: {ctx.spec.get('textureStyle')}")
    count = {"dorsal1": 9, "adipose": 6, "anal": 8, "caudal": 12, "pectoral": 10, "pelvic": 6}.get(ctx.fin, 10)
    ray = paint.rays(ctx.U, float(count), 4.0)
    albedo = textures.rgba(FIN, 0.92, ctx.shape)
    albedo = textures.mix(albedo, FIN_EDGE, ray * 0.32)
    albedo = textures.scale_rgb(albedo, 0.90 + 0.14 * fbm(ctx.U * 18.0, ctx.V * 8.0, octaves=2, seed=41))
    albedo[..., 3] = np.clip(0.82 - 0.14 * smoothstep(0.72, 1.0, ctx.V) + 0.08 * ray, 0.0, 1.0)
    return albedo


def extra_channels(clip_name, spec, envelope):
    """Add the shallow pitch and settle that distinguish benthic cory movement."""
    if clip_name == "swim":
        return [
            animation.Channel("Body", "rotation", (0.0, 1.0, 0.0), 2.2, 1.0, 0.0, "sin"),
            animation.Channel("Body", "location", (0.0, 0.0, 1.0), 0.0015, 1.0, 1.5708, "sin"),
        ]
    if clip_name == "forage":
        return [
            animation.Channel("Body", "rotation", (0.0, 1.0, 0.0), 11.0, 1.0, 0.0, "const", envelope=envelope),
            animation.Channel("Body", "location", (0.0, 0.0, 1.0), -0.0035, 1.0, 0.0, "const", envelope=envelope),
        ]
    return []
