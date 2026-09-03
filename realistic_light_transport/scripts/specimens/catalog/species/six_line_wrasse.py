"""Pseudocheilinus hexataenia (Six-Line Wrasse): species paint and labriform swim hooks.

Anatomy choices (shared fish plan, stations in ``asset.source.json``):
- Body depth 2.9 in SL (slender end of the published 2.5-2.9 range), head 2.8 in SL with a
  straight dorsal head profile to a pointed snout and a small terminal mouth, eye seated high
  in the head just below the profile.
- Long, low dorsal fin (IX,11) from above the opercle to the peduncle with a rounded soft-ray
  lobe; anal fin (III,9) below the soft dorsal; slightly rounded caudal fin about 3.9 in SL;
  rounded fan pectorals used for labriform propulsion; small pelvics below the pectoral base.
- Colour: six alternating dark-blue stripes on the upper two thirds of an orange body,
  purplish-pink lower flank and belly, green caudal peduncle and caudal fin, a small
  blue-edged black ocellus on the upper peduncle, red iris with two thin white lines.
- Animation: pectoral fins carry the swim (flap about the fin axis plus a rowing sweep from
  ``extra_channels``); the axial wave is kept subtle and the burst is a short dart.
All paint is procedural numpy with fixed seeds; nothing is sampled from imagery.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import paint, textures
from ..lib.animation import Channel
from ..lib.noise import fbm, smoothstep

# display-referred (sRGB) colours
ORANGE = (0.89, 0.37, 0.09)
ORANGE_DEEP = (0.8, 0.28, 0.08)
ROSE = (0.95, 0.56, 0.45)
VIOLET_PINK = (0.84, 0.46, 0.58)
BELLY = (0.95, 0.66, 0.66)
BLUE = (0.08, 0.25, 0.82)
BLUE_DEEP = (0.03, 0.08, 0.5)
GREEN = (0.46, 0.72, 0.26)
GREEN_DEEP = (0.27, 0.50, 0.17)
GREEN_PALE = (0.74, 0.86, 0.38)
INK = (0.02, 0.02, 0.03)

STRIPE_TOP = 0.88
STRIPE_SPACING = 0.245


def _stripes(U, Z):
    """Six horizontal blue stripes in flank coordinates: (full mask, darker core mask)."""
    stripes = np.zeros_like(U)
    core = np.zeros_like(U)
    for k in range(6):
        center = STRIPE_TOP - k * STRIPE_SPACING
        wobble = (fbm(U * 14.0 + k * 3.0, np.full_like(U, k * 0.7), octaves=2, seed=21 + k) - 0.5) * 0.02
        stripes = np.maximum(stripes, paint.band(Z + wobble, center, 0.042, 0.018))
        core = np.maximum(core, paint.band(Z + wobble, center, 0.02, 0.014))
    # stripes start at the caudal peduncle, run the whole flank and continue onto the head,
    # converging with the head taper and fading just short of the snout
    run = smoothstep(0.08, 0.16, U) * (1.0 - smoothstep(0.86, 0.96, U))
    return stripes * run, core * run


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    albedo = textures.rgba(ORANGE, 1.0, ctx.shape)
    # upper flank orange grades through purplish pink into the pale belly
    lower = smoothstep(-0.2, -0.75, Z)
    albedo = textures.mix(albedo, VIOLET_PINK, lower * 0.85)
    albedo = textures.mix(albedo, BELLY, smoothstep(-0.78, -1.0, Z) * 0.65)
    # the head is a little lighter and rosier than the trunk
    head = smoothstep(0.66, 0.9, U)
    albedo = textures.mix(albedo, ROSE, head * 0.25)
    # green-yellow caudal peduncle continuing into the caudal fin
    peduncle = 1.0 - smoothstep(0.03, 0.14, U)
    albedo = textures.mix(albedo, GREEN, peduncle * 0.85)

    stripes, core = _stripes(U, Z)
    albedo = textures.mix(albedo, BLUE, stripes)
    albedo = textures.mix(albedo, BLUE_DEEP, core * 0.7)

    # small blue-edged black ocellus on the upper part of the caudal peduncle
    distance = np.sqrt(((U - 0.045) / 0.012) ** 2 + ((Z - 0.62) / 0.16) ** 2)
    spot = 1.0 - smoothstep(0.75, 1.0, distance)
    ring = (1.0 - smoothstep(1.2, 1.55, distance)) * smoothstep(0.7, 1.0, distance)
    albedo = textures.mix(albedo, BLUE, ring * 0.9)
    albedo = textures.mix(albedo, INK, spot)

    # fine red and yellow dotting on the chin and throat
    chin = smoothstep(0.76, 0.9, U) * smoothstep(-0.35, -0.8, Z)
    dots = paint.spots(U, V, density=90.0, radius=0.2, seed=9)
    yellow_dots = paint.spots(U + 0.013, V, density=90.0, radius=0.16, seed=31)
    albedo = textures.mix(albedo, (0.85, 0.16, 0.1), chin * dots * 0.6)
    albedo = textures.mix(albedo, (0.98, 0.85, 0.35), chin * yellow_dots * 0.45)

    sheen = fbm(U * 30.0, V * 16.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.93 + 0.14 * sheen)

    # 16-18 lateral-line scales plus 4-6 on the peduncle: relatively large scales for the size
    height = paint.scales_height(U, V, 26, 18, seed=5) * 0.7 + 0.15 * fbm(U * 60.0, V * 30.0, 2, seed=8) + 0.1 * core
    height = np.clip(height, 0.0, 1.0)
    roughness = 0.32 + 0.14 * height + 0.05 * lower
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


def _fin_height(U, V, count: float):
    ridges = (0.5 + 0.5 * np.cos(U * np.pi * 2.0 * count)) ** 1.8
    root_fade = 0.35 + 0.65 * smoothstep(0.0, 0.25, V)
    membrane = fbm(U * 16.0, V * 5.0, octaves=2, seed=41)
    return np.clip(0.35 + 0.45 * ridges * root_fade + 0.1 * (membrane - 0.5), 0.0, 1.0)


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    if ctx.fin == "caudal":
        count = 13.0
        ray = paint.rays(U, count, 4.0)
        albedo = textures.rgba(GREEN, 1.0, ctx.shape)
        albedo = textures.mix(albedo, GREEN_DEEP, 0.4 * ray)
        albedo = textures.mix(albedo, (0.62, 0.66, 0.3), (1.0 - smoothstep(0.0, 0.14, V)) * 0.35)
        albedo = textures.mix(albedo, GREEN_PALE, smoothstep(0.72, 1.0, V) * 0.6)
        albedo[..., 3] = 1.0 - 0.25 * smoothstep(0.85, 1.0, V)
    elif ctx.fin in ("dorsal", "anal"):
        count = 20.0 if ctx.fin == "dorsal" else 12.0
        ray = paint.rays(U, count, 4.0)
        albedo = textures.rgba((0.91, 0.46, 0.26), 1.0, ctx.shape)
        albedo = textures.mix(albedo, ORANGE_DEEP, 0.4 * ray)
        albedo = textures.mix(albedo, BLUE, paint.band(V, 0.12, 0.05, 0.03) * 0.85)
        albedo = textures.mix(albedo, BLUE, paint.band(V, 0.5, 0.03, 0.03) * 0.5)
        albedo = textures.mix(albedo, BLUE, smoothstep(0.9, 0.98, V) * 0.8)
        albedo[..., 3] = 0.92 - 0.2 * smoothstep(0.8, 1.0, V)
    elif ctx.fin == "pectoral":
        count = 15.0
        ray = paint.rays(U, count, 5.0)
        albedo = textures.rgba((0.92, 0.54, 0.38), 1.0, ctx.shape)
        albedo = textures.mix(albedo, (0.84, 0.33, 0.2), 0.55 * ray)
        albedo = textures.mix(albedo, ORANGE, (1.0 - smoothstep(0.0, 0.25, V)) * 0.6)
        albedo[..., 3] = 1.0 - 0.25 * smoothstep(0.5, 1.0, V)
    else:
        count = 6.0
        ray = paint.rays(U, count, 4.0)
        albedo = textures.rgba((0.95, 0.7, 0.62), 1.0, ctx.shape)
        albedo = textures.mix(albedo, BLUE, 0.5 * ray * smoothstep(0.2, 0.6, V))
        albedo[..., 3] = 0.85 - 0.25 * smoothstep(0.7, 1.0, V)
    return {"albedo": albedo, "height": _fin_height(U, V, count)}


def extra_channels(clip_name: str, spec: dict, envelope):
    """Labriform rowing: sweep the pectorals fore and aft a quarter cycle behind the flap so
    the fin tip traces a loop instead of a flat beat."""
    clip = spec["animation"][clip_name]
    amplitude = float(clip.get("pectoral", 0.0))
    if amplitude <= 0.0:
        return []
    frequency = float(clip.get("pectoralFrequency", 2.0))
    phase = float(clip.get("pectoralPhase", 0.0)) + math.pi / 2.0
    channels = []
    for side, suffix in ((-1, "L"), (1, "R")):
        channels.append(Channel(f"Pectoral_{suffix}", "rotation", (0.0, 0.0, 1.0), side * amplitude * 0.4, frequency, phase,
                                envelope=envelope))
    return channels
