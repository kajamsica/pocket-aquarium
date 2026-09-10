"""Gastrodermus pygmaeus (Pygmy Cory) deterministic paint hooks.

The shared ``fish`` plan owns source-authored geometry, appendages, rigging and
clips. This module supplies the species-local silver-grey ground, conspicuous
dark mid-lateral stripe, paired armor-row relief and translucent fins. No
reference pixels are sampled, traced, copied or redistributed.
"""

from __future__ import annotations

import numpy as np

from ..lib import animation, paint, textures
from ..lib.noise import fbm, smoothstep


PEARL = (0.56, 0.57, 0.50)
PEARL_LIGHT = (0.76, 0.75, 0.65)
DORSAL_GREY = (0.29, 0.31, 0.27)
STRIPE = (0.035, 0.045, 0.039)
STRIPE_EDGE = (0.12, 0.14, 0.12)
PLATE = (0.32, 0.34, 0.29)
FIN = (0.61, 0.61, 0.52)
FIN_RAY = (0.34, 0.35, 0.30)


def _require_species(ctx):
    if ctx.spec.get("textureStyle") != "pygmy_cory":
        raise ValueError(f"Unsupported Pygmy Cory textureStyle: {ctx.spec.get('textureStyle')}")


def _plate_row(u, zeta, center, half_height, count, offset):
    """One restrained row of overlapping bony plates."""
    trunk = smoothstep(0.06, 0.13, u) * (1.0 - smoothstep(0.78, 0.92, u))
    row = 1.0 - smoothstep(half_height * 0.62, half_height, np.abs(zeta - center))
    phase = np.mod(np.clip((u - 0.08) / 0.82, 0.0, 1.0) * count + offset, 1.0)
    crown = smoothstep(0.06, 0.22, phase) * (1.0 - smoothstep(0.73, 0.96, phase))
    trailing = 1.0 - smoothstep(0.035, 0.15, phase)
    return row * trunk * (0.38 * crown + 0.62 * trailing), row * trunk * trailing


def _plate_relief(ctx):
    upper, upper_edge = _plate_row(ctx.U, ctx.ZETA, 0.18, 0.22, 23.0, 0.08)
    lower, lower_edge = _plate_row(ctx.U, ctx.ZETA, -0.19, 0.22, 21.0, 0.55)
    grain = fbm(ctx.U * 70.0, ctx.V * 31.0, octaves=2, seed=59)
    height = 0.44 + 0.24 * upper + 0.24 * lower + 0.045 * (grain - 0.5)
    return np.clip(height, 0.0, 1.0), np.maximum(upper_edge, lower_edge)


def _lateral_stripe(ctx):
    """Continuous snout-to-peduncle stripe with naturally softened margins."""
    u, z, v = ctx.U, ctx.ZETA, ctx.V
    center = -0.04 + 0.035 * np.sin((u * 2.2 + v * 0.13) * np.pi)
    width = 0.125 + 0.025 * smoothstep(0.15, 0.72, u)
    stripe = 1.0 - smoothstep(width - 0.018, width + 0.018, np.abs(z - center))
    axial = smoothstep(0.015, 0.07, u) * (1.0 - smoothstep(0.94, 0.995, u))
    return np.clip(stripe * axial, 0.0, 1.0)


def paint_body(ctx):
    _require_species(ctx)
    u, z, v = ctx.U, ctx.ZETA, ctx.V
    stripe = _lateral_stripe(ctx)
    albedo = textures.rgba(PEARL, 1.0, ctx.shape)
    albedo = textures.mix(albedo, DORSAL_GREY, smoothstep(0.28, 0.92, z) * 0.58)
    albedo = textures.mix(albedo, PEARL_LIGHT, smoothstep(-0.18, -0.82, z) * 0.72)

    sheen = fbm(u * 31.0, v * 15.0, octaves=3, seed=47)
    albedo = textures.scale_rgb(albedo, 0.91 + 0.15 * sheen)
    halo = np.clip(4.0 * stripe * (1.0 - stripe), 0.0, 1.0)
    albedo = textures.mix(albedo, STRIPE_EDGE, halo * 0.44)
    albedo = textures.mix(albedo, STRIPE, stripe * 0.94)

    # A second narrow, subdued lower line appears in the verified lateral views.
    lower_line = paint.band(z, -0.48, 0.045, 0.022)
    lower_line *= smoothstep(0.06, 0.17, u) * (1.0 - smoothstep(0.69, 0.84, u))
    albedo = textures.mix(albedo, STRIPE_EDGE, lower_line * 0.42)

    plate_height, plate_edges = _plate_relief(ctx)
    albedo = textures.mix(albedo, PLATE, plate_edges * (1.0 - stripe) * 0.13)
    roughness = 0.43 + 0.13 * plate_height + 0.08 * stripe
    return {
        "albedo": albedo,
        "roughness": textures.grey(roughness),
        "normal": textures.normal_from_height(plate_height, 0.78),
    }


def paint_fin(ctx):
    _require_species(ctx)
    counts = {"dorsal1": 8.0, "adipose": 5.0, "anal": 7.0, "caudal": 13.0,
              "pectoral": 8.0, "pelvic": 6.0}
    count = counts.get(ctx.fin, 8.0)
    ray = paint.rays(ctx.U, count, 4.5)
    albedo = textures.rgba(FIN, 0.68, ctx.shape)
    albedo = textures.mix(albedo, FIN_RAY, ray * 0.22)
    leading_spine = np.zeros(ctx.shape)
    if ctx.fin in ("dorsal1", "pectoral"):
        leading_spine = 1.0 - smoothstep(0.02, 0.12, ctx.U)
        albedo = textures.mix(albedo, FIN_RAY, leading_spine * 0.46)
    albedo[..., 3] = np.clip(
        0.68 - 0.24 * smoothstep(0.64, 1.0, ctx.V) + 0.11 * ray + 0.14 * leading_spine,
        0.0,
        1.0,
    )
    root_fade = 0.28 + 0.72 * smoothstep(0.0, 0.30, ctx.V)
    height = np.clip(0.36 + 0.40 * ray * root_fade + 0.30 * leading_spine, 0.0, 1.0)
    return {"albedo": albedo, "height": height}


def extra_channels(clip_name, spec, envelope):
    """Keep routine movement light while retaining the cory foraging dip."""
    if clip_name == "swim":
        return [
            animation.Channel("Body", "rotation", (0.0, 1.0, 0.0), 1.4, 1.0, 0.0, "sin"),
            animation.Channel("Body", "location", (0.0, 0.0, 1.0), 0.00035, 1.0, 1.5708, "sin"),
        ]
    if clip_name == "forage":
        return [
            animation.Channel("Body", "rotation", (0.0, 1.0, 0.0), 8.0, 1.0, 0.0, "const", envelope=envelope),
            animation.Channel("Body", "location", (0.0, 0.0, 1.0), -0.0008, 1.0, 0.0, "const", envelope=envelope),
        ]
    return []
