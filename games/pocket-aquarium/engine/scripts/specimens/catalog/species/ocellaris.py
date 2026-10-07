"""Amphiprion ocellaris, wild-type Ocellaris clownfish (refinement candidate fable-v2).

Refines the accepted v1.1.0 Ocellaris per the user's side-profile feedback. Anatomy comes from the
shared `fish` plan; every station lives in asset.source.json and was derived from the Black Storm
Ocellaris lane's corrected stations (the same species), then tuned toward the wild-type reference:
- compact, deep, high-backed oval body: depth 0.50 SL, width/depth 0.45, SL 0.064 m of 0.080 m TL
  (accepted profile: depth 0.47 SL on a 0.0715 m SL with a 8.5 mm caudal, the "balloon" look)
- fuller rounded forehead flowing into a blunt snout with a small terminal mouth; the snout-tip
  station is tiny so the loft cap never reads as a slab face
- short, defined caudal peduncle (0.15 SL long, 0.16 SL deep) and a rounded fan caudal (~20% TL)
- dorsal fin as an attached lobe starting just behind the head bar: spinous section, shallow notch,
  taller rounded soft lobe; low rounded anal lobe below the soft dorsal
- compact teardrop pectoral fan at the shoulder behind the head bar, small thoracic pelvics
- eye radius 2.7 mm seated in the head contour (protrude 0.36), 8.5 mm behind the snout tip

Paint is procedural numpy only. Wild-type pattern: bright orange body, darker along the back and
paler on the belly; exactly three white bars with thin black edging: a head bar just behind the eye,
a midbody bar with the forward-pointing triangular bulge at mid-flank, and a caudal-peduncle bar.
Fins are orange with a black margin and a thin pale rim; the middle bar runs a little way into the
dorsal and anal fin bases. Bars are functions of (U, ZETA) so they mirror exactly left/right and
stay continuous across the dorsal and ventral seams; all noise seeds are fixed.

Animation: `extra_channels` adds the clownfish "waddle", a small roll of the Body bone at the
pectoral beat frequency (`waddleRoll` degrees per clip) and an optional slow hover pitch
(`hoverPitch`, `hoverFrequency`) for the idle clip.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import paint, textures
from ..lib.animation import Channel
from ..lib.noise import fbm, smoothstep

ORANGE = (0.95, 0.37, 0.02)
ORANGE_DEEP = (0.82, 0.25, 0.01)
ORANGE_BELLY = (0.99, 0.56, 0.18)
WHITE = (0.94, 0.95, 0.95)
PEARL = (0.85, 0.90, 0.94)
BLACK = (0.035, 0.024, 0.02)
FIN_ORANGE = (0.96, 0.42, 0.04)
FIN_RAY = (0.83, 0.30, 0.02)
FIN_BLACK = (0.03, 0.022, 0.02)
FIN_RIM = (0.93, 0.93, 0.90)

EDGE = 0.011  # black outline width in body-U units (about 0.7 mm on a 64 mm standard length)
SOFT = 0.0035  # anti-aliasing half-width of every bar edge


def _bar(U, front, back, grow, soft=SOFT):
    """Mask of a vertical bar between its posterior edge `back` and anterior edge `front` (body-U),
    both expanded by `grow` (used to derive the black outline)."""
    return smoothstep(back - grow - soft, back - grow + soft, U) * (1.0 - smoothstep(front + grow - soft, front + grow + soft, U))


def _bar_edges(U, Z):
    """Anterior/posterior edge fields (in body-U) of the three wild-type bars.

    Z is ZETA (+1 dorsal ridge, -1 ventral ridge). All edges are functions of Z only (plus a tiny
    fbm wobble), so the bars mirror exactly across the sagittal plane."""
    S = np.sqrt(np.clip(1.0 - Z * Z, 0.0, 1.0))
    wob = (fbm(S * 3.0 + 0.7, Z * 3.0 + 1.3, octaves=2, seed=11) - 0.5) * 0.008
    # head bar: just behind the eye, nearly vertical, leaning a touch forward at the throat and
    # slightly wider over the nape than under the throat
    head_c = 0.775 - 0.012 * Z + wob
    head_h = 0.037 + 0.006 * smoothstep(-0.3, 1.0, Z)
    head = (head_c + head_h, head_c - head_h)
    # middle bar: posterior edge nearly straight (a hint of backward bow at the midline), anterior
    # edge bulging forward as a triangle whose apex sits just above the flank midline (the classic
    # ocellaris "bulge")
    bulge = 0.075 * np.clip(1.0 - np.abs(Z - 0.05) / 0.55, 0.0, 1.0) ** 1.05
    mid_back = 0.42 + 0.012 * Z - 0.008 * (1.0 - np.abs(Z)) + wob
    mid_front = 0.51 + bulge + 0.006 * Z + wob
    mid = (mid_front, mid_back)
    # peduncle bar: on the narrow caudal peduncle, stopping short of the orange caudal base
    tail_c = 0.10 + wob
    tail = (tail_c + 0.035, tail_c - 0.035)
    return head, mid, tail


def _bar_masks(ctx):
    U, Z = ctx.U, ctx.ZETA
    white = np.zeros(ctx.shape)
    outline = np.zeros(ctx.shape)
    for front, back in _bar_edges(U, Z):
        white = np.maximum(white, _bar(U, front, back, 0.0))
        outline = np.maximum(outline, _bar(U, front, back, EDGE))
    black = np.clip(outline - white, 0.0, 1.0)
    return white, black


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    white, black = _bar_masks(ctx)

    albedo = textures.rgba(ORANGE, 1.0, ctx.shape)
    # darker, more saturated back; paler belly (not on the chin, which stays orange)
    albedo = textures.mix(albedo, ORANGE_DEEP, 0.55 * smoothstep(0.35, 0.95, Z))
    albedo = textures.mix(albedo, ORANGE_BELLY, 0.6 * smoothstep(-0.45, -1.0, Z) * (1.0 - smoothstep(0.72, 0.9, U)))
    sheen = fbm(U * 24.0, V * 11.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.93 + 0.13 * sheen)
    # a slightly deeper tone on the snout and lips
    albedo = textures.mix(albedo, ORANGE_DEEP, 0.4 * smoothstep(0.955, 1.0, U))

    # white bars carry a faint pearl gradient toward their edges and a little grain
    grain = fbm(U * 40.0, V * 18.0, octaves=2, seed=8)
    white_col = textures.rgba(WHITE, 1.0, ctx.shape)
    white_col = textures.mix(white_col, PEARL, 0.30 * (1.0 - smoothstep(0.55, 1.0, white)) + 0.12 * grain)
    albedo = albedo * (1.0 - white[..., None]) + white_col * white[..., None]
    albedo = textures.mix(albedo, BLACK, black)
    albedo[..., 3] = 1.0

    height = paint.scales_height(U, V, 96, 36, seed=5) * 0.55 + 0.18 * fbm(U * 60.0, V * 30.0, 2, seed=8)
    # scales are finer and flatter over the head
    height = 0.5 + (height - 0.5) * (1.0 - 0.55 * smoothstep(0.74, 0.95, U))
    roughness = 0.30 + 0.10 * height + 0.13 * white + 0.06 * black
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.85)}


def _fin_spec(spec, name):
    for fin in spec["morphology"]["fins"]:
        if fin["name"] == name:
            return fin
    return None


def _body_length(spec):
    xs = [s["x"] for s in spec["morphology"]["controlStations"]]
    return min(xs), max(xs) - min(xs)


def _body_u_to_fin_u(spec, fin, u_body):
    """Map a body-U coordinate onto the base coordinate of a median fin (0 = posterior end)."""
    tail_x, length = _body_length(spec)
    x = tail_x + u_body * length
    return (x - fin["xStart"]) / (fin["xEnd"] - fin["xStart"])


def paint_fin(ctx):
    """Per-fin RGBA tile: U runs along the fin base (posterior -> anterior), V root (0) -> free edge (1)."""
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, 14.0, 5.0) * 0.5 + paint.rays(U, 4.0, 3.0) * 0.5
    jag = (fbm(U * 7.0, V * 3.0, octaves=2, seed=41) - 0.5) * 0.05
    albedo = textures.rgba(FIN_ORANGE, 1.0, ctx.shape)
    albedo = textures.mix(albedo, FIN_RAY, 0.45 * ray)
    # the membrane brightens slightly toward the edge before the black margin
    albedo = textures.mix(albedo, ORANGE_BELLY, 0.25 * smoothstep(0.3, 0.8, V))

    margin = {"caudal": 0.80, "dorsal": 0.86, "anal": 0.86, "pectoral": 0.85, "pelvic": 0.83}.get(ctx.fin, 0.86)
    if ctx.fin == "pectoral":
        # black only along the distal fan edge, fading out toward the leading (anterior) ray
        black = smoothstep(margin - 0.02 + jag, margin + 0.02 + jag, V) * smoothstep(0.0, 0.25, U)
    else:
        black = smoothstep(margin - 0.02 + jag, margin + 0.02 + jag, V)
    if ctx.fin == "pelvic":
        # the pelvic leading edge (anterior spine, fin U = 0) is black as well
        black = np.clip(black + smoothstep(0.10, 0.03, U) * smoothstep(0.15, 0.4, V), 0.0, 1.0)

    if ctx.fin in ("dorsal", "anal"):
        # the middle bar runs a little way into the fin base, with its black outline
        fin = _fin_spec(ctx.spec, ctx.fin)
        z = 1.0 if ctx.fin == "dorsal" else -1.0
        (_, _), (mid_front, mid_back), (_, _) = _bar_edges(np.zeros(ctx.shape), np.full(ctx.shape, z))
        u_front = _body_u_to_fin_u(ctx.spec, fin, mid_front)
        u_back = _body_u_to_fin_u(ctx.spec, fin, mid_back)
        grow = EDGE * _body_length(ctx.spec)[1] / (fin["xEnd"] - fin["xStart"])
        reach = 1.0 - smoothstep(0.05, 0.20, V)
        intrusion = _bar(U, u_front, u_back, 0.0, soft=0.012) * reach
        intrusion_outline = _bar(U, u_front, u_back, grow, soft=0.012) * (1.0 - smoothstep(0.08, 0.24, V))
        albedo = textures.mix(albedo, BLACK, np.clip(intrusion_outline - intrusion, 0.0, 1.0))
        albedo = textures.mix(albedo, WHITE, intrusion)

    albedo = textures.mix(albedo, FIN_BLACK, black)
    rim = smoothstep(0.962 + jag * 0.5, 0.982 + jag * 0.5, V)
    albedo = textures.mix(albedo, FIN_RIM, 0.75 * rim)
    albedo[..., 3] = 0.96 - 0.14 * smoothstep(0.5, 1.0, V)
    return albedo


def extra_channels(clip_name, spec, envelope):
    """Clownfish waddle: a small roll of the Body bone at the pectoral beat, plus an optional
    slow hover pitch. Body's local Y is the longitudinal axis and local X the lateral axis."""
    clip = spec["animation"][clip_name]
    channels = []
    roll = float(clip.get("waddleRoll", 0.0))
    if roll > 0.0:
        frequency = float(clip.get("pectoralFrequency", 2.0))
        channels.append(Channel("Body", "rotation", (0.0, 1.0, 0.0), roll, frequency, math.pi / 2, envelope=envelope))
    pitch = float(clip.get("hoverPitch", 0.0))
    if pitch > 0.0:
        channels.append(Channel("Body", "rotation", (1.0, 0.0, 0.0), pitch, float(clip.get("hoverFrequency", 1.0)), 0.0, envelope=envelope))
    return channels
