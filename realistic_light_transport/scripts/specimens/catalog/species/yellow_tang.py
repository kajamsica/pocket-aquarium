"""Zebrasoma flavescens (Yellow Tang), fable-v2 paint for the shared fish plan.

Anatomy lives in asset.source.json (stations, fins, eye, mouth). Summary of the v2 choices:
deep near-round disc at 57 percent of SL (fable-v1 was 43 percent), steep concave forehead
dropping into a distinct proboscis-like snout with the small terminal mouth at its tip, lateral eye
high on the forehead, short peduncle with a white scalpel, truncate yellow tail, tall dorsal and anal
sails peaking mid-body, compact fan pectorals seated just behind the operculum.

Paint: solid lemon yellow with a slightly deeper olive-yellow back, a paler belly, a very faint
paler mid-flank smudge (the resting stripe), a duller snout, faint scale relief and a soft
darkening around the eye socket. Fins are the same yellow with slightly darker ray shading and a
thin pale margin on the dorsal and anal sails. Everything is procedural numpy with fixed seeds.
"""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep

# display-referred (sRGB) colours
YELLOW = (0.97, 0.82, 0.08)
OLIVE = (0.82, 0.66, 0.06)
PALE = (0.99, 0.90, 0.35)
SNOUT = (0.88, 0.70, 0.08)

RAY_COUNT = {"dorsal": 22.0, "anal": 18.0, "caudal": 16.0, "pectoral": 15.0, "pelvic": 5.0}


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    albedo = textures.rgba(YELLOW, 1.0, ctx.shape)
    # slightly deeper back, paler belly
    back = smoothstep(0.45, 0.95, Z)
    belly = smoothstep(-0.5, -1.0, Z)
    albedo = textures.mix(albedo, OLIVE, back * 0.35)
    albedo = textures.mix(albedo, PALE, belly * 0.25)
    # faint horizontal resting smudge along the mid flank, broken up by noise so it never reads as a stripe
    smudge = paint.band(Z, 0.05, 0.14, 0.12) * smoothstep(0.25, 0.4, U) * (1.0 - smoothstep(0.62, 0.75, U))
    smudge *= 0.6 + 0.4 * fbm(U * 9.0, V * 5.0, octaves=2, seed=17)
    albedo = textures.mix(albedo, PALE, smudge * 0.14)
    # gentle large-scale tonal variation
    mottle = fbm(U * 24.0, V * 14.0, octaves=3, seed=21)
    albedo = textures.scale_rgb(albedo, 0.95 + 0.10 * mottle)
    # duller snout ahead of the eye, and a soft shadow ring around the eye socket
    snout = smoothstep(0.86, 1.0, U)
    albedo = textures.mix(albedo, SNOUT, snout * 0.45)
    # eye centre in paint space: u = (0.052 + 0.085) / 0.168, zeta = cos(ring angle) at 0.69 of the dorsal height
    eye_u, eye_z = 0.815, 0.70
    socket = np.sqrt(((U - eye_u) * 6.0) ** 2 + ((Z - eye_z) * 1.6) ** 2)
    socket_ring = (1.0 - smoothstep(0.18, 0.34, socket)) * smoothstep(0.08, 0.16, socket)
    albedo = textures.mix(albedo, OLIVE, socket_ring * 0.22)
    # scale relief: also baked faintly into the albedo because the committed shared image writer
    # currently saves the roughness and normal PNGs black (see asset.source.json visualDebt)
    height = paint.scales_height(U, V, 100, 40, seed=5) * 0.7 + 0.15 * fbm(U * 50, V * 26, 2, seed=8)
    albedo = textures.scale_rgb(albedo, 0.97 + 0.06 * (height - 0.5))
    roughness = 0.38 + 0.12 * height
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.8)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, RAY_COUNT.get(ctx.fin, 14.0), 4.0)
    albedo = textures.rgba(YELLOW, 1.0, ctx.shape)
    albedo = textures.mix(albedo, OLIVE, 0.28 * ray * (0.4 + 0.6 * V))
    if ctx.fin in ("dorsal", "anal"):
        albedo = textures.mix(albedo, PALE, smoothstep(0.9, 0.99, V) * 0.45)
    elif ctx.fin == "caudal":
        albedo = textures.mix(albedo, PALE, smoothstep(0.85, 1.0, V) * 0.3)
    else:
        albedo = textures.mix(albedo, PALE, smoothstep(0.5, 1.0, V) * 0.35)
    albedo[..., 3] = 1.0 - 0.18 * smoothstep(0.88, 1.0, V)
    return albedo
