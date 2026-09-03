"""Hemiscyllium ocellatum (epaulette shark): paint hooks for the shared fish plan.

Anatomy lives in asset.source.json: a long, slender benthic carpet shark whose body is
slightly wider than deep with a flat belly, a blunt flattened snout, two similar dorsal
fins set far back on the tail, thick paddle-like pectoral and pelvic fins, a long low anal
fin just ahead of the tail, and a low heterocercal caudal blade without a ventral lobe.
Station and fin positions follow the Allen, Erdmann, White, Fahmi & Dudgeon (2016)
morphometric ranges (see source-references.json).

This module paints the skin in body-relative physical coordinates so spots stay round on
a 0.75 m body loft: pale grey-tan ground grading to a white belly, dense dark-brown spots
(denser dorsally, absent on the snout in front of the eyes), the diagnostic black
post-cephalic ocellus with its pale halo above the pectoral base, faint dorsal saddles,
five gill slits, spiracles, the subterminal arched mouth with labial furrows, terminal
nostrils, and spotted grey-brown fins with narrow pale posterior margins and dark saddles
along the dorsal-fin margins. Everything is deterministic numpy over fixed seeds.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import noise, paint, textures
from ..lib.noise import fbm, smoothstep

GROUND_DORSAL = (0.45, 0.39, 0.31)
GROUND_FLANK = (0.58, 0.52, 0.44)
BELLY = (0.88, 0.85, 0.79)
SPOT = (0.12, 0.075, 0.045)
SPOT_LIGHT = (0.24, 0.16, 0.10)
OCELLUS = (0.015, 0.012, 0.012)
HALO = (0.90, 0.87, 0.80)
SLIT = (0.07, 0.05, 0.045)
FIN_GROUND = (0.50, 0.42, 0.32)
FIN_MARGIN = (0.90, 0.88, 0.83)

SNOUT_X = 0.36
EYE_X = 0.30
# ocellus centre: x along the body and its position around the section as a fraction of the
# full perimeter measured from the dorsal ridge (0.25 would be the mid-flank)
OCELLUS_CENTER = (0.183, None)
OCELLUS_ARC_FRACTION = 0.205
SPIRACLE_ARC_FRACTION = 0.165
OCELLUS_RADIUS = 0.021
HALO_RADIUS = 0.0265
GILL_SLIT_X = (0.266, 0.255, 0.244, 0.233, 0.222)
SADDLE_X = (0.10, 0.03, -0.04, -0.11, -0.18, -0.25, -0.31, -0.37)


def _columns(ctx):
    """Per-texel body section channels (half width, dorsal, ventral, centre z) along x."""
    body = ctx.body
    xs = ctx.X[0]
    rows = ctx.shape[0]

    def tile(values):
        return np.tile(np.asarray(values, dtype=np.float64), (rows, 1))

    hw = tile([body.half_width(x) for x in xs])
    dorsal = tile([body.dorsal(x) for x in xs])
    ventral = tile([body.ventral(x) for x in xs])
    cz = tile([body.center_z(x) for x in xs])
    return hw, dorsal, ventral, cz


def _physical(ctx):
    """Physical height (z), lateral offset (y) and mirrored arc coordinate for every texel."""
    hw, dorsal, ventral, cz = _columns(ctx)
    body = ctx.body
    zeta = ctx.ZETA
    angle = ctx.V * math.tau
    lateral = np.sin(angle)
    upper = zeta >= 0
    exponent = np.where(upper, body.exp_dorsal, body.exp_ventral)
    z = cz + np.where(upper, np.abs(zeta) ** (2.0 / body.exp_dorsal) * dorsal,
                      -np.abs(zeta) ** (2.0 / body.exp_ventral) * ventral)
    y = np.sign(lateral) * np.abs(lateral) ** (2.0 / exponent) * hw
    perimeter = math.tau * np.sqrt((hw * hw + ((dorsal + ventral) * 0.5) ** 2) * 0.5)
    folded = np.minimum(ctx.V, 1.0 - ctx.V)
    arc = folded * perimeter
    return z, y, arc, perimeter, hw, dorsal, ventral, cz


def _column_at(ctx, x: float) -> int:
    """Texture column whose centre is nearest body x."""
    return int(min(max(round((x - ctx.body.tail_x) / ctx.length * ctx.shape[1] - 0.5), 0), ctx.shape[1] - 1))


def _spots(x, arc, spacing, radius, seed, size_jitter=0.35):
    """Round soft spots on a jittered lattice defined in metres (x along body, arc around it)."""
    k = 1.0 / spacing
    distance, ident = noise.cells(x * k, arc * k, seed)
    size = radius * k * (1.0 - size_jitter + 2.0 * size_jitter * ident)
    mask = 1.0 - smoothstep(size * 0.72, size * 1.08, distance)
    return mask, ident


def _oval(x, z, center, radii):
    return np.sqrt(((x - center[0]) / radii[0]) ** 2 + ((z - center[1]) / radii[1]) ** 2)


def paint_body(ctx):
    U, V, X, zeta = ctx.U, ctx.V, ctx.X, ctx.ZETA
    z, y, arc, perimeter, hw, dorsal, ventral, cz = _physical(ctx)

    # ---- ground colour: grey-tan back, warmer flank, white belly with organic mottle
    ground = textures.rgba(GROUND_FLANK, 1.0, ctx.shape)
    ground = textures.mix(ground, GROUND_DORSAL, smoothstep(0.05, 0.85, zeta))
    belly = smoothstep(-0.25, -0.85, zeta)
    ground = textures.mix(ground, BELLY, belly)
    mottle = fbm(X * 9.0, arc * 9.0, octaves=3, seed=21)
    ground = textures.scale_rgb(ground, 0.93 + 0.14 * mottle)
    # snout slightly paler and greyer than the trunk
    snout = smoothstep(0.30, 0.355, X)
    ground = textures.mix(ground, (0.66, 0.60, 0.52), snout * 0.35 * (1.0 - belly))

    # ---- ocellus: black disc with a pale halo above the pectoral base (both flanks). Painted in
    # (x, arc-from-ridge) so the disc sits on the upper flank instead of wrapping over the back.
    ocellus_column = _column_at(ctx, OCELLUS_CENTER[0])
    ocellus_arc = OCELLUS_ARC_FRACTION * perimeter[0, ocellus_column]
    ocellus_distance = _oval(X, arc, (OCELLUS_CENTER[0], ocellus_arc), (OCELLUS_RADIUS * 1.06, OCELLUS_RADIUS))
    core = 1.0 - smoothstep(0.93, 1.03, ocellus_distance)
    halo_outer = HALO_RADIUS / OCELLUS_RADIUS
    halo = smoothstep(0.95, 1.06, ocellus_distance) * (1.0 - smoothstep(halo_outer - 0.06, halo_outer + 0.06, ocellus_distance))
    ocellus_keep_out = 1.0 - smoothstep(halo_outer + 0.05, halo_outer + 0.6, ocellus_distance)
    flank_only = 1.0 - smoothstep(-0.55, -0.85, zeta)
    core *= flank_only
    halo *= flank_only

    # ---- spotting: dense small spots plus sparser larger ones, denser dorsally, none on the snout
    dense, dense_id = _spots(X, arc, 0.028, 0.0048, seed=3)
    large, large_id = _spots(X, arc, 0.06, 0.0072, seed=11, size_jitter=0.3)
    dorsal_weight = 0.45 + 0.55 * smoothstep(-0.3, 0.55, zeta)
    dropout = smoothstep(0.62, 0.78, noise.value_noise(X * 40.0 + 3.0, arc * 40.0, seed=5))
    spot_mask = dense * dorsal_weight * (1.0 - 0.55 * dropout) + large * smoothstep(-0.15, 0.5, zeta) * 0.9
    spot_mask = np.clip(spot_mask, 0.0, 1.0)
    spot_mask *= 1.0 - smoothstep(-0.35, -0.68, zeta)
    spot_mask *= 1.0 - smoothstep(EYE_X - 0.012, EYE_X + 0.02, X)
    spot_mask *= 1.0 - ocellus_keep_out
    spot_colour = textures.rgba(SPOT, 1.0, ctx.shape)
    spot_colour = textures.mix(spot_colour, SPOT_LIGHT, 0.6 * dense_id * (1.0 - large))

    # ---- faint dorsal saddles between the ocellus and the tail tip
    saddles = np.zeros(ctx.shape)
    for index, centre in enumerate(SADDLE_X):
        saddles = np.maximum(saddles, paint.wavy_band(X, zeta, centre, 0.017, 0.012, 0.02, frequency=3.0, seed=40 + index))
    saddles *= smoothstep(-0.15, 0.55, zeta) * 0.17

    # ---- five gill slits ahead of / above the pectoral base, growing in height rearward
    slits = np.zeros(ctx.shape)
    for index, slit_x in enumerate(GILL_SLIT_X):
        height = 0.0075 + 0.0016 * index
        column = min(int(round((slit_x - ctx.body.tail_x) / ctx.length * (ctx.shape[1] - 1))), ctx.shape[1] - 1)
        centre_z = cz[:, column] - 0.15 * ventral[:, column]
        bow = -0.0022 * ((z - centre_z[:, None]) / height) ** 2
        line = paint.band(X - bow, slit_x, 0.0011, 0.0009)
        vertical = smoothstep(centre_z[:, None] - height, centre_z[:, None] - height + 0.003, z) * (
            1.0 - smoothstep(centre_z[:, None] + height - 0.003, centre_z[:, None] + height, z))
        slits = np.maximum(slits, line * vertical)
    slits *= np.abs(y) > 0.55 * hw

    # ---- underside of the snout: arched subterminal mouth, labial furrows, terminal nostrils
    ventral_face = smoothstep(-0.45, -0.75, zeta)
    mouth_x = SNOUT_X - 0.024
    half_mouth = 0.023
    arch = mouth_x - 0.011 * (np.clip(y / half_mouth, -1.0, 1.0) ** 2)
    mouth = paint.band(X - arch, 0.0, 0.0022, 0.0012) * (1.0 - smoothstep(half_mouth - 0.002, half_mouth + 0.001, np.abs(y)))
    furrows = paint.band(np.abs(y), half_mouth - 0.001, 0.0016, 0.0009) * smoothstep(mouth_x - 0.028, mouth_x - 0.024, X) * (
        1.0 - smoothstep(mouth_x - 0.012, mouth_x - 0.010, X))
    mouth = np.clip(mouth + furrows, 0.0, 1.0) * ventral_face
    nostril_distance = np.minimum(_oval(X, y, (0.351, -0.0095), (0.0035, 0.0028)), _oval(X, y, (0.351, 0.0095), (0.0035, 0.0028)))
    nostrils = (1.0 - smoothstep(0.8, 1.05, nostril_distance)) * smoothstep(-0.2, -0.6, zeta)

    # ---- spiracle behind and below each eye (arc coordinate keeps it on the flank)
    spiracle_arc = SPIRACLE_ARC_FRACTION * perimeter[0, _column_at(ctx, 0.284)]
    spiracle = 1.0 - smoothstep(0.8, 1.05, _oval(X, arc, (0.284, spiracle_arc), (0.0035, 0.0024)))

    # ---- compose
    albedo = textures.mix(ground, SPOT, saddles)
    albedo = textures.mix(albedo, spot_colour, spot_mask)
    albedo = textures.mix(albedo, HALO, halo)
    albedo = textures.mix(albedo, OCELLUS, core)
    albedo = textures.mix(albedo, SLIT, np.clip(slits + mouth + nostrils + spiracle, 0.0, 1.0))
    albedo[..., 3] = 1.0

    # ---- dermal denticle grain rather than scales; spots are flat, slits are grooves
    grain = fbm(U * 320.0, V * 160.0, octaves=3, seed=7)
    coarse = fbm(U * 48.0, V * 24.0, octaves=2, seed=9)
    height = np.clip(0.5 + 0.22 * (grain - 0.5) + 0.12 * (coarse - 0.5) - 0.35 * slits - 0.3 * mouth - 0.25 * spiracle + 0.05 * halo, 0.0, 1.0)
    roughness = 0.54 + 0.10 * (grain - 0.5) + 0.05 * spot_mask + 0.06 * core - 0.10 * belly
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.7)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    albedo = textures.rgba(FIN_GROUND, 1.0, ctx.shape)
    shade = fbm(U * 14.0, V * 8.0, octaves=3, seed=31)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * shade)
    # fin tiles map U along the fin base and V from root to margin; treat them as roughly
    # 7 cm x 10 cm so spots keep the body's spacing
    if ctx.fin in ("pectoral", "pelvic"):
        sx, sy = 0.075, 0.10
    elif ctx.fin == "caudal":
        sx, sy = 0.05, 0.16
    else:
        sx, sy = 0.08, 0.06
    spots, ident = _spots(U * sx, V * sy, 0.03, 0.0048, seed=13 + len(ctx.fin))
    spot_colour = textures.mix(textures.rgba(SPOT, 1.0, ctx.shape), SPOT_LIGHT, 0.5 * ident)
    margin = smoothstep(0.86, 0.97, V)
    if ctx.fin in ("dorsal1", "dorsal2"):
        # two or three dark saddles along the dorsal margin, root slightly darker
        saddle = np.zeros(ctx.shape)
        for centre in (0.22, 0.52, 0.82):
            saddle = np.maximum(saddle, paint.band(U, centre, 0.075, 0.05))
        saddle *= smoothstep(0.55, 0.85, V)
        albedo = textures.mix(albedo, SPOT, saddle * 0.75)
        albedo = textures.mix(albedo, spot_colour, spots * 0.85 * (1.0 - saddle))
        albedo = textures.mix(albedo, GROUND_DORSAL, (1.0 - smoothstep(0.0, 0.25, V)) * 0.5)
    elif ctx.fin == "caudal":
        # dark blotches along the dorsal (U -> 1) margin, pale trailing margin
        blotch = np.zeros(ctx.shape)
        for centre in (0.2, 0.5, 0.78):
            blotch = np.maximum(blotch, paint.band(V, centre, 0.08, 0.05))
        blotch *= smoothstep(0.7, 0.92, U)
        albedo = textures.mix(albedo, SPOT, blotch * 0.7)
        albedo = textures.mix(albedo, spot_colour, spots * 0.8 * (1.0 - blotch))
        albedo = textures.mix(albedo, BELLY, (1.0 - smoothstep(0.08, 0.3, U)) * 0.5)
        albedo = textures.mix(albedo, FIN_MARGIN, margin * 0.7)
    elif ctx.fin == "anal":
        albedo = textures.mix(albedo, BELLY, 0.45)
        albedo = textures.mix(albedo, spot_colour, spots * 0.35)
        albedo = textures.mix(albedo, FIN_MARGIN, margin * 0.6)
    else:
        # paired paddles: spotted grey-brown with a narrow pale posterior margin
        albedo = textures.mix(albedo, spot_colour, spots * 0.9)
        albedo = textures.mix(albedo, FIN_MARGIN, margin * 0.85)
    albedo[..., 3] = 1.0 - 0.08 * smoothstep(0.96, 1.0, V)
    # sharks hide their fin rays under thick skin: soft low relief only, thicker at the root
    height = np.clip(0.5 + 0.10 * (fbm(U * 20.0, V * 10.0, octaves=2, seed=45) - 0.5) + 0.06 * (1.0 - V), 0.0, 1.0)
    return {"albedo": albedo, "height": height}
