"""Valenciennea puellaris (Diamond Goby, orange-spotted sleeper goby): benthic sand-sifting gobiid.

Anatomy choices (all dimensions live in art/specimens/diamond_goby/asset.source.json):
- elongate body, depth 5.3 in SL (FishBase 4.8 to 6.0), broad blunt head about as wide as deep,
  high dorsolateral eyes, large oblique terminal mouth, flattened belly for the resting posture;
- two dorsal fins (VI + I,11-12) on separate Dorsal1/Dorsal2 bones, long anal fin, rounded caudal
  (3.0 to 4.2 in SL), large rounded fan pectorals, ventral pelvic fans right below them;
- Pacific colour form: pale grey-cream body, white belly, a mid-lateral row of large orange spots,
  staggered smaller orange spots on the back, orange dashes with blue rims on the lower flank,
  two rows of light blue dashes on the cheek, translucent fins with rows of fine orange spots.

Animation hooks:
- swim adds a shallow pitch/heave bob on the Body bone so the locomotion reads as short hops and
  glides rather than continuous cruising;
- sift (the response clip) is an honest sand-sifting bout: the Body pitches nose-down and settles
  toward the substrate, Spine_A arches the back so the tail stays low, the mouth cue tilts down and
  chews with fast pulses and the gill arcs pump quickly; everything rides a hold envelope so the
  clip starts and ends at the neutral pose.

Everything is deterministic: only spec numbers, fixed seeds and closed-form masks.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import paint, textures
from ..lib.animation import Channel
from ..lib.noise import fbm, scalar_hash, smoothstep

DORSUM = (0.50, 0.47, 0.42)
FLANK = (0.76, 0.73, 0.66)
BELLY = (0.93, 0.92, 0.89)
ORANGE = (0.93, 0.44, 0.06)
ORANGE_DEEP = (0.84, 0.30, 0.03)
BLUE_RIM = (0.32, 0.58, 0.94)
BLUE_PALE = (0.62, 0.82, 0.97)
MEMBRANE = (0.87, 0.85, 0.79)

# spot rows in physical body coordinates (metres along x, arc fraction w from the dorsal ridge:
# w = 0 ridge, 0.25 flank midline, 0.5 belly midline). Each entry: (w, x_start, x_end, count,
# radius_anterior, radius_posterior, aspect (arc radius / x radius), stagger)
BODY_ROWS = (
    # mid-lateral row of large orange spots, slightly taller than long
    (0.235, -0.056, 0.020, 8, 0.0024, 0.0016, 1.15, 0.0),
    # upper flank, smaller spots staggered between the large ones
    (0.135, -0.054, 0.026, 8, 0.0014, 0.0010, 1.0, 0.5),
    # small dots along the back either side of the dorsal fins
    (0.060, -0.052, 0.024, 9, 0.0009, 0.0007, 1.0, 0.0),
)
# lower flank dashes (blue rimmed), staggered below the large spots
LOWER_DASHES = (0.365, -0.056, 0.018, 8, 0.0030, 0.0022, 0.32, 0.5)


def _blob(X, S, cx, cs, rx, rs, soft=0.16):
    d = np.sqrt(((X - cx) / rx) ** 2 + ((S - cs) / rs) ** 2)
    return 1.0 - smoothstep(1.0 - soft, 1.0 + soft, d)


def _row(X, S, half_perim, row, scale=1.0):
    w, x0, x1, count, r0, r1, aspect, stagger = row
    mask = np.zeros_like(X)
    for k in range(count):
        f = (k + 0.5 + stagger) / count
        if f >= 1.0:
            continue
        cx = x0 + (x1 - x0) * f
        radius = (r1 + (r0 - r1) * f) * scale
        cs = w * 2.0 * half_perim
        mask = np.maximum(mask, _blob(X, S, cx, cs, radius, radius * aspect))
    return mask


def paint_body(ctx):
    U, V, Z, X = ctx.U, ctx.V, ctx.ZETA, ctx.X
    body = ctx.body
    # arc-length coordinate from the dorsal ridge so spots stay round on the tapering body
    w = np.where(V <= 0.5, V, 1.0 - V)
    half_perim = np.array([math.pi * 0.5 * (body.half_width(x) + 0.5 * (body.dorsal(x) + body.ventral(x))) for x in X[0]])
    half_perim = np.tile(half_perim, (X.shape[0], 1))
    S = w * 2.0 * half_perim
    wobble_x = (fbm(U * 40.0, V * 20.0, octaves=2, seed=23) - 0.5) * 0.0006
    wobble_s = (fbm(U * 40.0 + 7.0, V * 20.0, octaves=2, seed=29) - 0.5) * 0.0005
    Xw = X + wobble_x
    Sw = S + wobble_s

    # base: grey-brown dorsum grading to pale flank and white belly
    albedo = textures.rgba(FLANK, 1.0, ctx.shape)
    albedo = textures.mix(albedo, DORSUM, smoothstep(0.05, 0.9, Z))
    albedo = textures.mix(albedo, BELLY, smoothstep(-0.35, -0.85, Z))
    sheen = fbm(U * 26.0, V * 14.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.93 + 0.14 * sheen)
    # faint darker mottling on the back only
    mottle = paint.mottle(U, V, 9.0, seed=11) * smoothstep(0.35, 0.95, Z)
    albedo = textures.mix(albedo, (0.50, 0.48, 0.44), mottle * 0.25)

    # flank spot rows (kept off the head, which has its own markings)
    trunk = 1.0 - smoothstep(0.80, 0.86, U)
    spots = np.zeros_like(U)
    for row in BODY_ROWS:
        spots = np.maximum(spots, _row(Xw, Sw, half_perim, row))
    spots *= trunk
    dashes = _row(Xw, Sw, half_perim, LOWER_DASHES) * trunk
    dash_rim = np.clip(_row(Xw, Sw, half_perim, LOWER_DASHES, scale=1.45) * trunk - dashes, 0.0, 1.0)
    albedo = textures.mix(albedo, BLUE_RIM, dash_rim * 0.75)
    albedo = textures.mix(albedo, ORANGE, np.clip(spots + dashes, 0.0, 1.0))
    # deeper orange core on the big spots
    core = _row(Xw, Sw, half_perim, BODY_ROWS[0], scale=0.55) * trunk
    albedo = textures.mix(albedo, ORANGE_DEEP, core * 0.6)

    # head: two rows of light blue dashes on the cheek and operculum, orange flecks between
    head = smoothstep(0.76, 0.82, U)
    cheek = np.zeros_like(U)
    for (w_row, xs) in ((0.30, (0.030, 0.037, 0.044)), (0.38, (0.028, 0.035, 0.042, 0.049))):
        for cx in xs:
            cheek = np.maximum(cheek, _blob(Xw, Sw, cx, w_row * 2.0 * half_perim, 0.0026, 0.0007))
    # short streak below and behind the eye
    cheek = np.maximum(cheek, _blob(Xw, Sw, 0.041, 0.235 * 2.0 * half_perim, 0.0032, 0.00045))
    cheek *= head * (1.0 - smoothstep(0.42, 0.5, w))
    albedo = textures.mix(albedo, BLUE_PALE, cheek * 0.9)
    flecks = np.zeros_like(U)
    for (cx, w_row, r) in ((0.033, 0.20, 0.0011), (0.040, 0.335, 0.0010), (0.047, 0.30, 0.0009), (0.031, 0.345, 0.0010)):
        flecks = np.maximum(flecks, _blob(Xw, Sw, cx, w_row * 2.0 * half_perim, r, r))
    flecks *= head
    albedo = textures.mix(albedo, ORANGE, flecks * 0.9)
    # pale grey lips / snout and pale throat
    snout = smoothstep(0.955, 1.0, U)
    albedo = textures.mix(albedo, (0.70, 0.66, 0.60), snout * 0.5)
    throat = head * smoothstep(-0.3, -0.8, Z)
    albedo = textures.mix(albedo, BELLY, throat * 0.6)

    # relief: fine ctenoid scales on the trunk (79 to 91 in the lateral series), scaleless head
    scales = paint.scales_height(U, V, 88, 36, seed=5)
    skin = fbm(U * 70.0, V * 34.0, octaves=2, seed=8)
    height = np.clip(0.5 + (scales - 0.5) * 0.55 * trunk + (skin - 0.5) * 0.18 + spots * 0.05, 0.0, 1.0)
    roughness = 0.40 + 0.10 * (height - 0.5) - 0.08 * np.clip(spots + dashes + cheek, 0.0, 1.0) + 0.06 * smoothstep(0.3, 0.9, Z)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.8)}


def _fin_spots(U, V, rows, columns, radius, offset=0.5, seed=1):
    mask = np.zeros_like(U)
    for r_index, v in enumerate(rows):
        shift = offset * (r_index % 2)
        for k in range(columns):
            u = (k + 0.5 + shift) / columns
            if u >= 0.99:
                continue
            jitter_u = (scalar_hash(k, r_index, seed=seed) - 0.5) * 0.02
            jitter_v = (scalar_hash(k, r_index, seed=seed + 11) - 0.5) * 0.03
            d = np.sqrt(((U - u - jitter_u) / radius) ** 2 + ((V - v - jitter_v) / radius) ** 2)
            mask = np.maximum(mask, 1.0 - smoothstep(0.8, 1.15, d))
    return mask


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    fin = ctx.fin
    if fin == "pectoral":
        ray = paint.rays(U, 19.0, 4.0)
    elif fin == "caudal":
        ray = paint.rays(U, 15.0, 4.0)
    elif fin == "dorsal1":
        ray = paint.rays(U, 6.0, 4.0)
    elif fin == "pelvic":
        ray = paint.rays(U, 6.0, 4.0)
    else:
        ray = paint.rays(U, 12.0, 4.0)
    albedo = textures.rgba(MEMBRANE, 1.0, ctx.shape)
    albedo = textures.scale_rgb(albedo, 0.94 + 0.10 * ray)
    alpha = 0.66 + 0.22 * ray
    if fin == "dorsal1":
        spots = _fin_spots(U, V, (0.30, 0.62), 5, 0.075, seed=2)
        albedo = textures.mix(albedo, ORANGE, spots * 0.92)
        albedo = textures.mix(albedo, BLUE_PALE, smoothstep(0.86, 0.96, V) * 0.5)
    elif fin == "dorsal2":
        spots = _fin_spots(U, V, (0.26, 0.52, 0.78), 10, 0.055, seed=3)
        albedo = textures.mix(albedo, ORANGE, spots * 0.9)
        albedo = textures.mix(albedo, BLUE_PALE, smoothstep(0.88, 0.97, V) * 0.5)
    elif fin == "anal":
        flecks = _fin_spots(U, V, (0.28, 0.55), 9, 0.04, seed=4)
        albedo = textures.mix(albedo, ORANGE, flecks * 0.55)
        albedo = textures.mix(albedo, BLUE_PALE, smoothstep(0.80, 0.95, V) * 0.65)
    elif fin == "caudal":
        upper = smoothstep(0.45, 0.6, U)
        spots = _fin_spots(U, V, (0.25, 0.5, 0.75), 8, 0.05, seed=5) * upper
        albedo = textures.mix(albedo, ORANGE, spots * 0.9)
        albedo = textures.mix(albedo, BLUE_PALE, (1.0 - smoothstep(0.04, 0.14, U)) * 0.5)
        alpha = alpha - 0.05 * upper
    elif fin == "pectoral":
        albedo = textures.mix(albedo, (0.92, 0.88, 0.74), 0.5)
        flecks = _fin_spots(U, V, (0.18,), 6, 0.04, seed=6)
        albedo = textures.mix(albedo, ORANGE, flecks * 0.5)
        alpha = alpha - 0.08
    else:  # pelvic
        albedo = textures.mix(albedo, BELLY, 0.6)
        alpha = alpha - 0.06
    alpha = alpha * (1.0 - 0.25 * smoothstep(0.9, 1.0, V))
    albedo[..., 3] = np.clip(alpha, 0.0, 1.0)
    return albedo


def extra_channels(clip_name, spec, envelope):
    if clip_name == "sift":
        # sand-sifting bout: nose-down pitch about the Body bone, settle toward the substrate, arch the
        # back so the tail stays low, tilt the mouth cue down and chew, pump the gills. Hold envelope.
        return [
            Channel("Body", "rotation", (1.0, 0.0, 0.0), 14.0, 1.0, 0.0, "const", envelope="hold"),
            Channel("Body", "location", (0.0, 0.0, 1.0), -0.007, 1.0, 0.0, "const", envelope="hold"),
            Channel("Spine_A", "rotation", (1.0, 0.0, 0.0), -9.0, 1.0, 0.0, "const", envelope="hold"),
            Channel("Jaw", "rotation", (1.0, 0.0, 0.0), -9.0, 1.0, 0.0, "const", envelope="hold"),
            Channel("Jaw", "rotation", (1.0, 0.0, 0.0), -3.0, 4.0, math.pi / 2.0, "sin", envelope="hold"),
        ]
    if clip_name == "swim":
        # hop-and-glide: shallow heave with a matching pitch, one bob per tail beat (integer frequency)
        return [
            Channel("Body", "rotation", (1.0, 0.0, 0.0), 3.0, 2.0, 0.0, "sin"),
            Channel("Body", "location", (0.0, 0.0, 1.0), 0.0025, 2.0, math.pi / 2.0, "sin"),
        ]
    return []
