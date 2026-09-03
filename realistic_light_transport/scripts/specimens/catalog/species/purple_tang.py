"""Purple Tang, Zebrasoma xanthurum (Blyth, 1852). Species paint for the shared fish plan.

Anatomy (stations live in asset.source.json, fable-v2):
- deep round Zebrasoma disc, body depth 0.100 m at 0.180 m standard length (55.6 percent SL,
  the least deep of the catalog's three Zebrasoma), carried forward so the forehead drops
  steeply just behind the eye and kinks into a dished profile above a projecting
  proboscis-like snout that ends in a small terminal mouth below the body axis;
- short deep caudal peduncle, truncate yellow caudal fin, tall sail-like dorsal and anal fins,
  compact fan pectoral, pointed pelvic.

Paint (display-referred sRGB values, procedural numpy only, no sampled pixels):
- rich blue-purple body, slightly lighter and more electric along the back, dusky violet on
  the belly and the lower posterior flank;
- fine dark spots over the head and anterior third that thin out into fine, broken, wavy
  horizontal lines over the flank; sparse dark spotting on the dorsal and anal fin bases;
- saturated yellow caudal fin with a crisp boundary at the peduncle; yellow pectoral with a
  blue-purple root; dorsal, anal and pelvic membranes in body colour with fine ray lines and
  a paler blue margin.
"""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep, value_noise

PURPLE = (0.20, 0.13, 0.70)
LIGHT = (0.25, 0.21, 0.82)
DEEP = (0.09, 0.05, 0.42)
INK = (0.02, 0.012, 0.15)
YELLOW = (0.98, 0.78, 0.08)
MARGIN = (0.36, 0.48, 0.96)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    base = textures.rgba(PURPLE, 1.0, ctx.shape)
    # back slightly lighter and more electric, belly and lower flank duskier
    albedo = textures.mix(base, LIGHT, smoothstep(0.25, 0.95, Z) * 0.4)
    albedo = textures.mix(albedo, DEEP, smoothstep(-0.35, -1.0, Z) * 0.55)
    lower_flank = (1.0 - smoothstep(-0.75, -0.05, Z)) * smoothstep(-1.0, -0.6, Z)
    albedo = textures.mix(albedo, DEEP, lower_flank * smoothstep(0.18, 0.35, U) * (1.0 - smoothstep(0.55, 0.7, U)) * 0.35)

    # head spots: dense fine dark dots over the head, thinning backwards over the anterior third
    head_spots = paint.spots(U, V, density=150.0, radius=0.2, seed=13, jitter_radius=0.3)
    head_mask = smoothstep(0.66, 0.78, U)
    fade_spots = paint.spots(U + 0.013, V + 0.007, density=120.0, radius=0.18, seed=29, jitter_radius=0.4)
    fade_mask = smoothstep(0.46, 0.62, U) * (1.0 - smoothstep(0.66, 0.78, U))
    fade_mask = fade_mask * smoothstep(0.35, 0.6, fbm(U * 30.0, V * 18.0, octaves=2, seed=17))
    spots = np.maximum(head_spots * head_mask, fade_spots * fade_mask)
    spots = spots * (1.0 - smoothstep(0.93, 0.985, U))  # snout tip stays plain
    albedo = textures.mix(albedo, INK, spots * 0.72)

    # flank lines: fine wavy horizontal lines, broken into dashes, not on the ridge or belly
    wobble = (value_noise(U * 24.0, V * 6.0, 7) - 0.5) * 2.4
    lines = 0.5 + 0.5 * np.sin(V * np.pi * 2.0 * 64.0 + wobble)
    lines = smoothstep(0.72, 0.94, lines)
    dashes = smoothstep(0.26, 0.64, fbm(U * 26.0, V * 22.0, octaves=2, seed=23))
    line_mask = lines * dashes * (1.0 - smoothstep(0.6, 0.74, U)) * smoothstep(0.06, 0.16, U)
    line_mask = line_mask * (1.0 - smoothstep(0.7, 0.9, np.abs(Z)))
    albedo = textures.mix(albedo, INK, line_mask * 0.42)

    sheen = fbm(U * 26.0, V * 14.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * sheen)

    height = paint.scales_height(U, V, 96, 36, seed=5) * 0.6 + 0.2 * line_mask + 0.15 * spots
    roughness = 0.36 + 0.14 * height
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    if ctx.fin == "caudal":
        ray = paint.rays(U, 16.0, 4.0)
        albedo = textures.rgba(YELLOW, 1.0, ctx.shape)
        albedo = textures.scale_rgb(albedo, 0.9 + 0.16 * ray)
        albedo = textures.mix(albedo, (0.9, 0.62, 0.05), smoothstep(0.6, 1.0, V) * 0.35)
        albedo = textures.mix(albedo, PURPLE, 1.0 - smoothstep(0.02, 0.07, V))
    elif ctx.fin == "pectoral":
        ray = paint.rays(U, 15.0, 4.0)
        albedo = textures.rgba(PURPLE, 1.0, ctx.shape)
        albedo = textures.mix(albedo, YELLOW, smoothstep(0.18, 0.42, V) * 0.95)
        albedo = textures.scale_rgb(albedo, 0.9 + 0.16 * ray)
    else:
        count = 24.0 if ctx.fin == "dorsal" else (22.0 if ctx.fin == "anal" else 6.0)
        ray = paint.rays(U, count, 3.0)
        # thin membranes catch the light, so the authored membrane colour sits well below the body colour
        albedo = textures.mix(textures.rgba(PURPLE, 1.0, ctx.shape), DEEP, 0.55)
        albedo = textures.mix(albedo, DEEP, 0.3 * (1.0 - ray))
        gaps = smoothstep(0.55, 0.95, 0.5 + 0.5 * np.cos(U * np.pi * 2.0 * count + np.pi))
        albedo = textures.mix(albedo, INK, gaps * 0.45)
        if ctx.fin in ("dorsal", "anal"):
            base_spots = paint.spots(U, V, density=70.0, radius=0.2, seed=31) * (1.0 - smoothstep(0.12, 0.4, V))
            albedo = textures.mix(albedo, INK, base_spots * 0.5)
        albedo = textures.mix(albedo, MARGIN, smoothstep(0.92, 1.0, V) * 0.3)
    albedo[..., 3] = 1.0 - 0.15 * smoothstep(0.93, 1.0, V)
    return albedo
