"""Amphiprion ocellaris, Black Storm designer morph (Sea & Reef Aquaculture strain, released 2017).

A visual variant of the Ocellaris clownfish, not a separate species: same anatomy, black base colour
with extensive irregular white "storm" markings and an almost fully white face mask (panda-like).

Anatomy (shared `fish` plan; every station lives in asset.source.json) was derived from the accepted
Ocellaris morphology profile and corrected per the user's side-profile feedback:
- compact, deep, high-backed oval body: depth 0.50 SL, width/depth 0.46, SL 0.064 m of 0.080 m TL
- rounded forehead flowing into a blunt snout and a small terminal mouth; the snout-tip station is tiny
  so the loft cap never reads as a slab face
- short, defined caudal peduncle (0.15 SL, depth 0.14 SL) and a rounded fan caudal fin (~20% TL)
- dorsal fin as an attached lobe: spinous section, shallow notch, taller rounded soft lobe; low rounded anal lobe
- compact teardrop pectoral fan at the shoulder, small pelvics; eye seated in the head contour

Paint is procedural numpy only. fbm-perturbed band masks turn the three ocellaris bars into large torn
white patches on a black ground: a white face mask, a midbody blotch, a peduncle patch and a few white
flecks. Fins are black with pale margins; the caudal carries a white rim. Noise is sampled on the ring's
(cos, |sin|) so every edge is continuous across the dorsal seam and mirrored left/right; all seeds are fixed.
"""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep

BLACK = (0.022, 0.019, 0.018)
SOOT = (0.05, 0.046, 0.044)
WHITE = (0.86, 0.87, 0.86)
PEARL = (0.80, 0.83, 0.86)
FIN_BLACK = (0.018, 0.017, 0.018)
FIN_WHITE = (0.84, 0.85, 0.84)


def _storm_mask(ctx):
    """White coverage in [0, 1] over the body UV grid (U tail -> head, ZETA +1 dorsal / -1 ventral).

    The black ground stays dominant (roughly 55% of the flank)."""
    U, Z = ctx.U, ctx.ZETA
    S = np.sqrt(np.clip(1.0 - Z * Z, 0.0, 1.0))
    # torn edge field in body-U units: a slow wander around the ring, shaped with tanh so the edges plateau
    # and jump (blocky tears rather than drips), plus a little fine tearing
    wander = fbm(S * 2.2 + 1.7, Z * 2.4 + 0.5, octaves=3, seed=23) - 0.5
    tear = fbm(S * 6.0 + U * 0.8, Z * 7.0 + U * 0.5, octaves=3, seed=29) - 0.5
    jag = 0.085 * np.tanh(4.0 * wander) / np.tanh(2.0) + 0.02 * tear
    edge = 0.009

    # 1) face mask: white forward of a torn boundary around the pectoral base (body u ~ 0.715);
    #    it reaches a little further back under the throat than on the nape
    face_edge = 0.715 + jag - 0.02 * smoothstep(0.2, 0.9, Z)
    face = smoothstep(face_edge - edge, face_edge + edge, U)

    # 2) midbody storm patch: the middle bar torn into a blotch, bulging forward on the flank
    #    (the classic ocellaris middle-bar bulge), narrower over the back, wider through the belly
    mid_center = 0.45 + 0.03 * (1.0 - Z * Z) + 0.3 * jag
    mid_half = 0.046 + 0.02 * (1.0 - smoothstep(-0.4, 0.7, Z)) + 0.5 * jag
    mid = paint.band(U, mid_center, mid_half, edge)

    # 3) peduncle patch: the tail bar torn into a smaller blotch, stopping short of the black caudal base
    ped_center = 0.125 + 0.4 * jag
    ped_half = 0.034 + 0.3 * jag
    ped = paint.band(U, ped_center, ped_half, edge) * smoothstep(0.055, 0.08, U)

    # 4) a few white flecks inside the black saddles (sparse fbm islands)
    fleck_field = fbm(U * 13.0 + 0.3, S * 4.0 + Z * 2.5, octaves=3, seed=31)
    flecks = smoothstep(0.655, 0.69, fleck_field)

    return np.clip(face + mid + ped + flecks, 0.0, 1.0)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    white = _storm_mask(ctx)

    base = textures.rgba(BLACK, 1.0, ctx.shape)
    # the black ocellaris ground is not flat: a faint sooty sheen keeps it reading as skin, not a void
    sheen = fbm(U * 26.0, V * 12.0, octaves=3, seed=3)
    base = textures.mix(base, SOOT, 0.35 * sheen + 0.25 * smoothstep(-0.4, -1.0, Z))
    # white patches carry a subtle pearl gradient toward their edges and a little grain
    grain = fbm(U * 40.0, V * 18.0, octaves=2, seed=8)
    white_col = textures.rgba(WHITE, 1.0, ctx.shape)
    white_col = textures.mix(white_col, PEARL, 0.35 * (1.0 - smoothstep(0.55, 1.0, white)) + 0.15 * grain)
    albedo = base * (1.0 - white[..., None]) + white_col * white[..., None]
    albedo[..., 3] = 1.0

    height = paint.scales_height(U, V, 96, 36, seed=5) * 0.55 + 0.18 * fbm(U * 60.0, V * 30.0, 2, seed=8)
    # scales are finer and flatter over the head
    height = 0.5 + (height - 0.5) * (1.0 - 0.55 * smoothstep(0.72, 0.95, U))
    roughness = 0.30 + 0.17 * white + 0.10 * height
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.85)}


def paint_fin(ctx):
    """Per-fin RGBA tile: U runs along the fin base, V from root (0) to free edge (1)."""
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, 14.0, 5.0) * 0.5 + paint.rays(U, 4.0, 3.0) * 0.5
    rim_jag = (fbm(U * 7.0, V * 3.0, octaves=2, seed=41) - 0.5) * 0.08
    black = textures.rgba(FIN_BLACK, 1.0, ctx.shape)
    black = textures.mix(black, SOOT, 0.35 * ray)
    if ctx.fin == "caudal":
        # black fan with a white distal rim and a faint pale wash spreading from the base centre
        rim = smoothstep(0.80 + rim_jag, 0.90 + rim_jag, V)
        wash = (1.0 - smoothstep(0.05, 0.40, V)) * (1.0 - smoothstep(0.15, 0.40, np.abs(U - 0.5)))
        albedo = textures.mix(black, FIN_WHITE, np.clip(rim + 0.45 * wash, 0.0, 1.0))
        albedo[..., 3] = 1.0 - 0.12 * smoothstep(0.94, 1.0, V)
    elif ctx.fin == "dorsal":
        # the midbody patch runs up into the fin base (U 0.45..0.74 of the base); pale rim along the free edge
        intrusion = (1.0 - smoothstep(0.08, 0.36, V)) * smoothstep(0.43, 0.49, U + rim_jag) * (1.0 - smoothstep(0.71, 0.77, U + rim_jag))
        rim = smoothstep(0.88 + rim_jag * 0.5, 0.97 + rim_jag * 0.5, V)
        albedo = textures.mix(black, FIN_WHITE, np.clip(intrusion + 0.8 * rim, 0.0, 1.0))
        albedo[..., 3] = 1.0 - 0.15 * smoothstep(0.93, 1.0, V)
    elif ctx.fin == "anal":
        intrusion = (1.0 - smoothstep(0.08, 0.32, V)) * smoothstep(0.80, 0.87, U + rim_jag)
        rim = smoothstep(0.88 + rim_jag * 0.5, 0.97 + rim_jag * 0.5, V)
        albedo = textures.mix(black, FIN_WHITE, np.clip(intrusion + 0.8 * rim, 0.0, 1.0))
        albedo[..., 3] = 1.0 - 0.15 * smoothstep(0.93, 1.0, V)
    elif ctx.fin == "pectoral":
        # sooty translucent fan with a pale leading margin
        albedo = textures.mix(black, SOOT, 0.5)
        albedo = textures.mix(albedo, FIN_WHITE, 0.6 * smoothstep(0.86, 0.98, V) + 0.35 * (1.0 - smoothstep(0.0, 0.12, U)))
        albedo[..., 3] = 0.92 - 0.22 * smoothstep(0.6, 1.0, V)
    else:
        albedo = black
        albedo = textures.mix(albedo, FIN_WHITE, 0.5 * smoothstep(0.9, 1.0, V))
        albedo[..., 3] = 1.0 - 0.1 * smoothstep(0.93, 1.0, V)
    return albedo
