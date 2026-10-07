"""Pygoplites diacanthus (Regal Angelfish), Indo-Pacific colour form: species paint and idle sway
for the shared `fish` body plan.

Anatomy (every station lives in asset.source.json): a Pomacanthidae oval body, strongly
compressed (depth 0.52 SL, width 0.27 of depth), a steep rounded forehead falling to a short snout
with a small terminal mouth below the body axis, a high-set eye 22 mm behind the snout tip, a
short defined caudal peduncle and a rounded caudal fin. The dorsal (XIV,17-19) and anal (III,17-19)
fins are long based; their soft posterior lobes are rounded and swept back past the caudal base
(negative `lean`). The pectoral is a moderately long rounded fan at the shoulder, the pelvics are
pointed. The diagnostic preopercular spine is a backward-pointing spike on the lower rear cheek,
built from four overlapping tapered `sphere` adornments per side because the shared plan offers no
rotated adornment; it sits 17 mm below the pectoral root and ends 5 mm ahead of the opercular edge.

Colour (Indo-Pacific form; the Red Sea form has a yellow thorax and is not modelled): golden orange
body, a little darker on the back and paler yellow on the belly, crossed by eight narrow white bars
edged in dark blue that lean backward toward the dorsal fin base, bow slightly and narrow toward the
belly; a ninth bar runs from the nape down through the eye region, which carries a dark blue-black
patch around the eye; the thorax is pale grey-blue; lips and forehead carry a blue wash. The bars
continue up the spinous dorsal fin and into the anal fin base. The soft dorsal lobe is deep
blue-black with close-set small pale blue dots and a blue margin; the anal fin carries alternating
blue and orange stripes parallel to its margin; caudal, pectoral and pelvic fins are yellow.
Every bar is a function of (x, zeta) so the pattern mirrors exactly left/right and is continuous
across the dorsal and ventral seams. Nothing is sampled from imagery; all noise seeds are fixed.

Animation: `extra_channels` adds a slow body roll at the pectoral beat (`bodyRoll` degrees per
clip) and an optional hover pitch for idle (`hoverPitch`, `hoverFrequency`), the angelfish
pectoral-led hover. The shared plan reads `pelvic` amplitudes from the clip spec.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import paint, textures
from ..lib.animation import Channel
from ..lib.noise import fbm, smoothstep

ORANGE = (0.96, 0.52, 0.03)
ORANGE_BACK = (0.88, 0.40, 0.01)
YELLOW_BELLY = (0.98, 0.68, 0.14)
BAR_WHITE = (0.92, 0.95, 0.97)
BAR_PALE_BLUE = (0.72, 0.84, 0.97)
BAR_BLUE = (0.03, 0.06, 0.32)
EYE_PATCH = (0.03, 0.04, 0.13)
THORAX = (0.62, 0.70, 0.76)
LIP_BLUE = (0.30, 0.46, 0.82)
DORSAL_BLUE_BLACK = (0.02, 0.03, 0.11)
DOT_BLUE = (0.42, 0.66, 0.96)
FIN_BLUE = (0.12, 0.34, 0.88)
FIN_MARGIN_BLUE = (0.30, 0.56, 0.98)
FIN_ORANGE = (0.95, 0.56, 0.08)
FIN_YELLOW = (0.96, 0.76, 0.14)
FIN_RAY = (0.86, 0.60, 0.06)
PELVIC_EDGE = (0.86, 0.92, 0.98)

# bar layout, metres in body space (forward +x). Centres are given at the lateral midline (zeta 0)
BAR_CENTRES = (0.050, 0.031, 0.012, -0.007, -0.026, -0.045, -0.064, -0.083)
BAR_HALF_WIDTH = 0.0026
SLANT = 0.016  # backward shift per unit zeta: the bars lean back toward the dorsal fin base
CURVE = 0.004  # gentle bow (bars are slightly convex forward at mid flank)
EDGE = 0.002  # dark blue edging width
SOFT = 0.0004  # anti-aliasing half-width of every edge
HEAD_BAR = 0.079  # head bar centre at eye level (eye centre x 0.083)
EYE_X = 0.083
EYE_ZETA = 0.48  # cos(ring angle) of the eye centre for zFraction 0.45 and dorsal exponent 1.85


def _bar(X, centre, half_width, grow=0.0, soft=SOFT):
    distance = np.abs(X - centre)
    return 1.0 - smoothstep(half_width + grow - soft, half_width + grow + soft, distance)


def _body_bars(X, Z, wobble, head=True):
    """White and dark blue outline masks of the bars for body coordinates X (metres) and
    Z (zeta, +1 dorsal ridge, -1 ventral ridge; values beyond +-1 extend the bars onto fins)."""
    white = np.zeros(X.shape)
    outline = np.zeros(X.shape)
    Zc = np.clip(Z, -1.0, 1.0)
    half_width = BAR_HALF_WIDTH * (0.85 + 0.15 * Zc)  # bars narrow toward the belly
    for c0 in BAR_CENTRES:
        centre = c0 - SLANT * Z + CURVE * (Zc * Zc - 0.3) + wobble
        white = np.maximum(white, _bar(X, centre, half_width))
        outline = np.maximum(outline, _bar(X, centre, half_width, EDGE))
    if head:
        # nape -> behind the eye -> throat: leans back above the eye, near vertical below it
        centre = HEAD_BAR - 0.022 * np.clip(Z - EYE_ZETA, 0.0, 1.0) + 0.004 * np.clip(EYE_ZETA - Z, 0.0, 1.5) + wobble
        hw = BAR_HALF_WIDTH * (0.9 + 0.1 * Zc)
        white = np.maximum(white, _bar(X, centre, hw))
        outline = np.maximum(outline, _bar(X, centre, hw, EDGE))
    blue = np.clip(outline - white, 0.0, 1.0)
    return white, blue


def paint_body(ctx):
    U, Z, V, X = ctx.U, ctx.ZETA, ctx.V, ctx.X
    wobble = (fbm(X * 45.0 + 0.7, Z * 3.0 + 1.3, octaves=2, seed=11) - 0.5) * 0.0014
    white, blue = _body_bars(X, Z, wobble)
    # bars taper out along the belly midline and fade over the grey-blue thorax
    belly_keep = 1.0 - smoothstep(-0.82, -0.97, Z)
    # grey-blue thorax: an oval on the chest between the pectoral bases and the pelvic fins
    thorax = np.sqrt(((X - 0.05) / 0.028) ** 2 + ((Z + 0.78) / 0.42) ** 2)
    thorax = 1.0 - smoothstep(0.7, 1.1, thorax)
    keep = belly_keep * (1.0 - 0.55 * thorax)
    white = white * keep
    blue = blue * keep

    albedo = textures.rgba(ORANGE, 1.0, ctx.shape)
    albedo = textures.mix(albedo, ORANGE_BACK, 0.5 * smoothstep(0.3, 0.95, Z))
    albedo = textures.mix(albedo, YELLOW_BELLY, 0.5 * smoothstep(-0.4, -1.0, Z))
    sheen = fbm(U * 26.0, V * 12.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.9 + 0.12 * sheen)
    albedo = textures.mix(albedo, THORAX, 0.85 * thorax)
    # blue wash on the forehead and lips
    forehead = smoothstep(0.092, 0.101, X) * smoothstep(-0.25, 0.45, Z)
    albedo = textures.mix(albedo, LIP_BLUE, 0.45 * forehead)
    albedo = textures.mix(albedo, LIP_BLUE, 0.6 * smoothstep(0.1015, 0.1045, X))
    # dark patch around the eye (adult Indo-Pacific colouration)
    patch = np.sqrt(((X - EYE_X) / 0.0098) ** 2 + ((Z - EYE_ZETA) / 0.44) ** 2)
    patch = 1.0 - smoothstep(0.8, 1.15, patch)
    albedo = textures.mix(albedo, EYE_PATCH, 0.8 * patch)

    grain = fbm(U * 40.0, V * 18.0, octaves=2, seed=8)
    white_col = textures.rgba(BAR_WHITE, 1.0, ctx.shape)
    white_col = textures.mix(white_col, BAR_PALE_BLUE, 0.35 * (1.0 - smoothstep(0.55, 1.0, white)) + 0.15 * grain)
    albedo = albedo * (1.0 - white[..., None]) + white_col * white[..., None]
    albedo = textures.mix(albedo, BAR_BLUE, blue)
    albedo[..., 3] = 1.0

    height = paint.scales_height(U, V, 96, 40, seed=5) * 0.55 + 0.18 * fbm(U * 60.0, V * 30.0, 2, seed=8)
    height = 0.5 + (height - 0.5) * (1.0 - 0.5 * smoothstep(0.78, 0.96, U))  # flatter, finer over the head
    roughness = 0.34 + 0.1 * height - 0.08 * white + 0.05 * blue + 0.04 * thorax
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.85)}


def _fin_spec(spec, name):
    for fin in spec["morphology"]["fins"]:
        if fin["name"] == name:
            return fin
    return None


def paint_fin(ctx):
    """Per-fin RGBA tile: U runs along the fin base (median fins posterior -> anterior, caudal
    bottom -> top, paired fins anterior -> posterior root), V root (0) -> free edge (1)."""
    U, V = ctx.U, ctx.V
    fin = _fin_spec(ctx.spec, ctx.fin) or {}
    ray = paint.rays(U, float(fin.get("rayCount", 14)), 5.0) * 0.6 + paint.rays(U, 4.0, 3.0) * 0.4
    jag = (fbm(U * 7.0, V * 3.0, octaves=2, seed=41) - 0.5) * 0.04
    if ctx.fin == "dorsal":
        X = fin["xStart"] + U * (fin["xEnd"] - fin["xStart"])
        Zext = 1.0 + 1.3 * V  # bars keep their slant as they climb the spinous fin
        white, blue = _body_bars(X, Zext, 0.0, head=False)
        spinous = textures.rgba(FIN_ORANGE, 1.0, ctx.shape)
        spinous = textures.mix(spinous, FIN_RAY, 0.4 * ray)
        spinous = textures.mix(spinous, BAR_WHITE, white)
        spinous = textures.mix(spinous, BAR_BLUE, blue)
        spinous = textures.mix(spinous, FIN_MARGIN_BLUE, 0.7 * smoothstep(0.9 + jag, 0.96 + jag, V))
        soft_lobe = textures.rgba(DORSAL_BLUE_BLACK, 1.0, ctx.shape)
        soft_lobe = textures.mix(soft_lobe, FIN_BLUE, 0.25 * ray)
        dots = paint.spots(U * 3.9, V * 2.0, density=12.0, radius=0.2, seed=17, jitter_radius=0.25)
        dots *= smoothstep(0.03, 0.1, V) * (1.0 - smoothstep(0.86, 0.93, V))
        soft_lobe = textures.mix(soft_lobe, DOT_BLUE, 0.9 * dots)
        soft_lobe = textures.mix(soft_lobe, FIN_MARGIN_BLUE, 0.8 * smoothstep(0.9 + jag, 0.96 + jag, V))
        boundary = 0.47 + 0.06 * V
        soft = 1.0 - smoothstep(boundary - 0.02, boundary + 0.02, U)
        albedo = spinous * (1.0 - soft[..., None]) + soft_lobe * soft[..., None]
        albedo[..., 3] = 0.97 - 0.1 * smoothstep(0.6, 1.0, V)
        return albedo
    if ctx.fin == "anal":
        X = fin["xStart"] + U * (fin["xEnd"] - fin["xStart"])
        Zext = -1.0 - 1.3 * V
        white, blue = _body_bars(X, Zext, 0.0, head=False)
        reach = 1.0 - smoothstep(0.12, 0.3, V)  # the body bars run a little way into the fin base
        albedo = textures.rgba(FIN_ORANGE, 1.0, ctx.shape)
        albedo = textures.mix(albedo, FIN_RAY, 0.4 * ray)
        albedo = textures.mix(albedo, BAR_WHITE, white * reach)
        albedo = textures.mix(albedo, BAR_BLUE, blue * reach)
        stripes = np.zeros(ctx.shape)
        for centre in (0.36, 0.58, 0.78):
            stripes = np.maximum(stripes, paint.band(V + jag * 0.5, centre, 0.05, 0.02))
        stripes *= smoothstep(0.0, 0.12, U)  # stripes fade out at the posterior lobe tip
        albedo = textures.mix(albedo, FIN_BLUE, stripes)
        albedo = textures.mix(albedo, FIN_MARGIN_BLUE, 0.85 * smoothstep(0.91 + jag, 0.96 + jag, V))
        albedo[..., 3] = 0.97 - 0.1 * smoothstep(0.6, 1.0, V)
        return albedo
    if ctx.fin == "caudal":
        albedo = textures.rgba(FIN_YELLOW, 1.0, ctx.shape)
        albedo = textures.scale_rgb(albedo, 0.9 + 0.16 * ray)
        albedo = textures.mix(albedo, FIN_ORANGE, 0.45 * (1.0 - smoothstep(0.05, 0.22, V)))
        albedo = textures.mix(albedo, (0.99, 0.92, 0.6), 0.4 * smoothstep(0.86, 1.0, V))
        albedo[..., 3] = 0.97 - 0.18 * smoothstep(0.65, 1.0, V)
        return albedo
    if ctx.fin == "pectoral":
        albedo = textures.rgba((0.97, 0.78, 0.24), 1.0, ctx.shape)
        albedo = textures.scale_rgb(albedo, 0.92 + 0.12 * ray)
        albedo = textures.mix(albedo, FIN_ORANGE, 0.5 * (1.0 - smoothstep(0.05, 0.25, V)))
        albedo[..., 3] = 0.92 - 0.3 * smoothstep(0.4, 1.0, V)
        return albedo
    # pelvic: yellow with a pale blue-white leading spine
    albedo = textures.rgba(FIN_YELLOW, 1.0, ctx.shape)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.12 * ray)
    albedo = textures.mix(albedo, PELVIC_EDGE, 0.8 * (1.0 - smoothstep(0.05, 0.16, U)) * smoothstep(0.05, 0.3, V))
    albedo[..., 3] = 0.96 - 0.12 * smoothstep(0.6, 1.0, V)
    return albedo


def extra_channels(clip_name, spec, envelope):
    """Angelfish hover: a small roll of the Body bone at the pectoral beat plus an optional slow
    hover pitch. Body's local Y is the longitudinal axis and local X the lateral axis."""
    clip = spec["animation"][clip_name]
    channels = []
    roll = float(clip.get("bodyRoll", 0.0))
    if roll > 0.0:
        frequency = float(clip.get("pectoralFrequency", 2.0))
        channels.append(Channel("Body", "rotation", (0.0, 1.0, 0.0), roll, frequency, math.pi / 2, envelope=envelope))
    pitch = float(clip.get("hoverPitch", 0.0))
    if pitch > 0.0:
        channels.append(Channel("Body", "rotation", (1.0, 0.0, 0.0), pitch, float(clip.get("hoverFrequency", 1.0)), 0.0, envelope=envelope))
    return channels
