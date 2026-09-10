"""Corydoras aeneus (Bronze Cory): armored benthic fish paint hooks.

The shared ``fish`` plan carries the source-authored sloping head, inferior
mouth, tapered barbels, fins and rig. This module supplies deterministic
olive-bronze colour, two lateral armor rows and a strong pectoral-spine cue.
No reference pixels are used.
"""

from __future__ import annotations

import numpy as np

from ..lib import animation, paint, textures
from ..lib.noise import fbm, smoothstep


BRONZE = (0.43, 0.40, 0.24)
OLIVE = (0.24, 0.28, 0.18)
FLANK_DARK = (0.15, 0.20, 0.14)
BRONZE_SHEEN = (0.58, 0.50, 0.27)
BELLY = (0.73, 0.68, 0.51)
PLATE = (0.12, 0.16, 0.11)
FIN = (0.74, 0.58, 0.24)
FIN_EDGE = (0.34, 0.27, 0.11)


def _plate_row(u, zeta, center, half_height, count, offset):
    """One shallow row of staggered, overlapping scute-shaped islands."""
    trunk = smoothstep(0.11, 0.17, u) * (1.0 - smoothstep(0.74, 0.82, u))
    plate_u = np.clip((u - 0.13) / 0.67, 0.0, 1.0)
    plate_coordinate = plate_u * count + offset
    plate_index = np.floor(plate_coordinate)
    phase = np.mod(plate_coordinate, 1.0)

    # Alternating centers let adjacent scutes overlap like shingles. Localising
    # both the crown and margin in two dimensions avoids a row of uniform ribs.
    stagger = np.where(np.mod(plate_index, 2.0) < 1.0, -1.0, 1.0) * half_height * 0.075
    local_z = np.abs(zeta - (center + stagger)) / half_height
    local_x = np.abs(phase - (0.54 - 0.07 * np.minimum(local_z, 1.0))) / 0.50
    island_distance = np.power(local_x, 1.65) + np.power(local_z, 2.05)
    crown = 1.0 - smoothstep(0.66, 1.0, island_distance)
    edge_center = 0.09 + 0.07 * np.power(np.minimum(local_z, 1.0), 1.7)
    trailing_margin = (1.0 - smoothstep(0.025, 0.085, np.abs(phase - edge_center))) * (1.0 - smoothstep(0.68, 0.98, local_z))
    relief = trunk * (0.62 * crown + 0.38 * trailing_margin)
    return relief, trunk * trailing_margin


def _plate_relief(ctx):
    """Return distinct staggered armor rows plus restrained skin grain."""
    upper, upper_edge = _plate_row(ctx.U, ctx.ZETA, 0.18, 0.25, 24.0, 0.08)
    lower, lower_edge = _plate_row(ctx.U, ctx.ZETA, -0.20, 0.24, 22.0, 0.56)
    skin = fbm(ctx.U * 72.0, ctx.V * 34.0, octaves=2, seed=23)
    height = 0.42 + 0.28 * upper + 0.28 * lower + 0.05 * (skin - 0.5)
    return np.clip(height, 0.0, 1.0), np.maximum(upper_edge, lower_edge)


def paint_body(ctx):
    if ctx.spec.get("textureStyle") != "bronze_cory":
        raise ValueError(f"Unsupported freshwater fish textureStyle: {ctx.spec.get('textureStyle')}")
    u, z, v = ctx.U, ctx.ZETA, ctx.V
    albedo = textures.rgba(BRONZE, 1.0, ctx.shape)
    back = smoothstep(0.18, 0.88, z)
    belly = smoothstep(-0.18, -0.86, z)
    trunk = smoothstep(0.11, 0.20, u) * (1.0 - smoothstep(0.74, 0.84, u))
    flank_height = smoothstep(-0.54, -0.16, z) * (1.0 - smoothstep(0.42, 0.76, z))
    flank = trunk * flank_height
    albedo = textures.mix(albedo, OLIVE, back * 0.58)
    albedo = textures.mix(albedo, FLANK_DARK, flank * 0.72)
    albedo = textures.mix(albedo, BELLY, belly * 0.86)

    mottling = fbm(u * 24.0, v * 13.0, octaves=3, seed=31)
    sheen_band = paint.band(z, 0.08, 0.30, 0.16) * flank
    albedo = textures.mix(albedo, BRONZE_SHEEN, sheen_band * (0.10 + 0.22 * mottling))
    albedo = textures.scale_rgb(albedo, 0.91 + 0.16 * mottling)
    albedo = textures.mix(albedo, BELLY, smoothstep(0.82, 0.98, u) * belly * 0.18)
    plate_height, plate_edges = _plate_relief(ctx)
    albedo = textures.mix(albedo, PLATE, plate_edges * flank * 0.22)
    roughness = 0.43 + 0.17 * plate_height + 0.05 * belly
    return {"albedo": albedo, "roughness": textures.grey(roughness),
            "normal": textures.normal_from_height(plate_height, 1.05)}


def paint_fin(ctx):
    if ctx.spec.get("textureStyle") != "bronze_cory":
        raise ValueError(f"Unsupported freshwater fish textureStyle: {ctx.spec.get('textureStyle')}")
    count = {"dorsal1": 8, "adipose": 6, "anal": 8, "caudal": 14, "pectoral": 9, "pelvic": 6}.get(ctx.fin, 10)
    ray = paint.rays(ctx.U, float(count), 4.0)
    albedo = textures.rgba(FIN, 0.48, ctx.shape)
    albedo = textures.mix(albedo, FIN_EDGE, ray * 0.18)
    leading_spine = np.zeros(ctx.shape)
    if ctx.fin in ("dorsal1", "pectoral"):
        leading_spine = 1.0 - smoothstep(0.02, 0.11, ctx.U)
        albedo = textures.mix(albedo, FIN_EDGE, leading_spine * 0.72)
    albedo = textures.scale_rgb(albedo, 0.90 + 0.14 * fbm(ctx.U * 18.0, ctx.V * 8.0, octaves=2, seed=41))
    membrane_edge = smoothstep(0.62, 1.0, ctx.V)
    albedo[..., 3] = np.clip(0.48 - 0.22 * membrane_edge + 0.08 * ray + 0.34 * leading_spine, 0.0, 0.88)
    root_fade = 0.30 + 0.70 * smoothstep(0.0, 0.28, ctx.V)
    height = np.clip(0.35 + 0.42 * ray * root_fade + 0.40 * leading_spine, 0.0, 1.0)
    return {"albedo": albedo, "height": height}


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
