"""Gramma loreto (Royal Gramma, fairy basslet): paint hooks for the shared fish plan.

Anatomy choices (geometry lives in asset.source.json, built by plans/fish.py):
- Small elongate-oval basslet, SL 64 mm inside an 80 mm adult total length; body depth
  about SL/2.8, width behind the head about SL/6, head about SL/2.85 (Grammatidae ranges
  from Bohlke and Randall 1963 and the STRI Shorefishes account).
- Large eye seated high in a short snout; small terminal, slightly oblique mouth.
- Long continuous dorsal fin (XII, 10) from above the opercle edge to the peduncle with a
  rounded soft-rayed posterior lobe; anal fin (III, 10) with a matching rounded lobe;
  slightly emarginate caudal with rounded corners; rounded pectorals; long pointed pelvics
  whose first soft ray reaches the anal fin origin.

Paint (all procedural numpy, no sampled imagery):
- Violet anterior half grading into golden yellow along a diagonal that runs from the
  anterior dorsal fin base down and back to the anal fin origin, with an orange, speckled
  transition zone.
- Thin black line from the snout tip through the eye to the nape; faint pale yellow
  streaks radiating from the eye (one forward, two backward).
- Large black spot on the anterior dorsal fin between the first spines; fins carry the
  local body colour (violet spinous dorsal, pelvics and pectorals; yellow soft dorsal,
  anal and caudal).

Texture coordinates: U runs tail (0) to snout (1); ZETA is +1 on the dorsal ridge, 0 on
the flank and -1 on the belly; V is the ring angle fraction.
"""

from __future__ import annotations

import numpy as np

from ..lib import paint, textures
from ..lib.noise import fbm, smoothstep

VIOLET = (0.34, 0.03, 0.60)
VIOLET_DEEP = (0.20, 0.014, 0.42)
MAGENTA = (0.54, 0.09, 0.62)
YELLOW = (1.0, 0.64, 0.03)
YELLOW_BRIGHT = (1.0, 0.80, 0.10)
ORANGE = (0.98, 0.32, 0.02)
PALE_YELLOW = (1.0, 0.9, 0.45)
BLACK = (0.006, 0.005, 0.010)

# eye centre in body texture space (see asset.source.json eyes.x / zFraction)
EYE_U = 0.866
EYE_ZETA = 0.44
# ZETA unit expressed in U units on the head (half body height / body length)
ZETA_TO_U = 0.125


def _segment_mask(U, Z, a, b, half_width, softness):
    """Soft band around the segment a -> b given in (U, ZETA) space, measured in U units."""
    ax, az = a[0], a[1] * ZETA_TO_U
    bx, bz = b[0], b[1] * ZETA_TO_U
    px, pz = U, Z * ZETA_TO_U
    dx, dz = bx - ax, bz - az
    length_sq = max(dx * dx + dz * dz, 1e-12)
    t = np.clip(((px - ax) * dx + (pz - az) * dz) / length_sq, 0.0, 1.0)
    cx, cz = ax + t * dx, az + t * dz
    distance = np.sqrt((px - cx) ** 2 + (pz - cz) ** 2)
    return paint.band(distance, 0.0, half_width, softness)


def _colour_boundary(U, Z, V):
    """Signed distance (in U) to the violet/yellow diagonal; positive on the violet (anterior) side."""
    wobble = (fbm(U * 26.0, V * 12.0, octaves=3, seed=23) - 0.5) * 0.045
    return U - (0.43 + 0.065 * Z) + wobble


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    d = _colour_boundary(U, Z, V)
    speck = fbm(U * 90.0, V * 45.0, octaves=2, seed=31) - 0.5
    violet_mask = smoothstep(-0.028, 0.028, d + 0.06 * speck)

    violet = textures.rgba(VIOLET, 1.0, ctx.shape)
    violet = textures.mix(violet, VIOLET_DEEP, smoothstep(0.35, 0.95, Z) * 0.6)
    violet = textures.mix(violet, MAGENTA, smoothstep(-0.3, -0.95, Z) * 0.55)

    yellow = textures.rgba(YELLOW, 1.0, ctx.shape)
    yellow = textures.mix(yellow, YELLOW_BRIGHT, np.clip(smoothstep(0.30, -0.05, U) * 0.5 + smoothstep(-0.2, -0.9, Z) * 0.35, 0.0, 1.0))
    # orange halo on the yellow side of the transition, plus violet flecks invading it
    yellow = textures.mix(yellow, ORANGE, paint.band(d, -0.03, 0.035, 0.035) * 0.65)
    flecks = smoothstep(0.62, 0.70, fbm(U * 120.0, V * 60.0, octaves=2, seed=37)) * paint.band(d, -0.045, 0.035, 0.02)
    yellow = textures.mix(yellow, VIOLET, flecks * 0.6)

    albedo = textures.mix(yellow, violet, violet_mask)

    # scale-edge sheen and a slightly darker dorsum
    sheen = fbm(U * 34.0, V * 18.0, octaves=3, seed=3)
    albedo = textures.scale_rgb(albedo, 0.92 + 0.16 * sheen)
    albedo = textures.scale_rgb(albedo, 1.0 - 0.10 * smoothstep(0.6, 1.0, Z))

    # pale yellow streaks radiating from the eye: one forward, two backward
    streaks = np.zeros(ctx.shape)
    streaks = np.maximum(streaks, _segment_mask(U, Z, (EYE_U + 0.05, 0.28), (0.975, 0.06), 0.0022, 0.003))
    streaks = np.maximum(streaks, _segment_mask(U, Z, (EYE_U - 0.05, 0.56), (0.785, 0.72), 0.0022, 0.003))
    streaks = np.maximum(streaks, _segment_mask(U, Z, (EYE_U - 0.05, 0.30), (0.795, 0.06), 0.0022, 0.003))
    streaks *= violet_mask
    albedo = textures.mix(albedo, PALE_YELLOW, streaks * 0.4)

    # black eye line: snout tip through the eye to the nape (slope in U per ZETA unit)
    u_line = EYE_U - (Z - EYE_ZETA) / 4.0
    line = paint.band(U - u_line, 0.0, 0.013, 0.008)
    line *= smoothstep(-0.22, -0.06, Z) * (1.0 - smoothstep(0.84, 0.97, Z))
    line *= smoothstep(0.70, 0.75, U)
    albedo = textures.mix(albedo, BLACK, line)

    # slightly darker lips at the snout tip
    albedo = textures.mix(albedo, VIOLET_DEEP, smoothstep(0.975, 1.0, U) * 0.5)

    height = paint.scales_height(U, V, 42, 24, seed=5) * 0.65 + 0.2 * fbm(U * 60.0, V * 30.0, octaves=2, seed=8)
    roughness = 0.33 + 0.12 * height + 0.10 * line - 0.04 * (1.0 - violet_mask)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


def _ellipse(U, V, center, radii):
    du = (U - center[0]) / radii[0]
    dv = (V - center[1]) / radii[1]
    return np.sqrt(du * du + dv * dv)


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, 16.0, 5.0) * 0.5 + paint.rays(U, 5.0, 3.0) * 0.5
    wobble = (fbm(U * 20.0, V * 8.0, octaves=2, seed=41) - 0.5) * 0.05
    alpha = np.full(ctx.shape, 1.0)
    if ctx.fin == "dorsal":
        boundary = 0.735
        violet_mask = smoothstep(boundary - 0.03, boundary + 0.03, U + wobble)
        albedo = textures.rgba(YELLOW, 1.0, ctx.shape)
        albedo = textures.mix(albedo, ORANGE, paint.band(U + wobble, boundary - 0.04, 0.04, 0.04) * 0.6)
        albedo = textures.mix(albedo, VIOLET, violet_mask)
        albedo = textures.mix(albedo, MAGENTA, violet_mask * smoothstep(0.7, 1.0, V) * 0.35)
        albedo = textures.mix(albedo, PALE_YELLOW, (1.0 - violet_mask) * smoothstep(0.86, 1.0, V) * 0.2)
        spot = 1.0 - smoothstep(0.82, 1.06, _ellipse(U, V, (0.92, 0.42), (0.062, 0.34)))
        albedo = textures.mix(albedo, BLACK, spot)
        alpha = 1.0 - 0.10 * smoothstep(0.9, 1.0, V)
    elif ctx.fin == "anal":
        boundary = 0.80
        violet_mask = smoothstep(boundary - 0.03, boundary + 0.03, U + wobble)
        albedo = textures.rgba(YELLOW, 1.0, ctx.shape)
        albedo = textures.mix(albedo, ORANGE, paint.band(U + wobble, boundary - 0.04, 0.04, 0.04) * 0.6)
        albedo = textures.mix(albedo, VIOLET, violet_mask)
        albedo = textures.mix(albedo, PALE_YELLOW, smoothstep(0.86, 1.0, V) * 0.3)
        alpha = 1.0 - 0.10 * smoothstep(0.9, 1.0, V)
    elif ctx.fin == "caudal":
        albedo = textures.rgba(YELLOW, 1.0, ctx.shape)
        albedo = textures.mix(albedo, ORANGE, (1.0 - smoothstep(0.0, 0.25, V)) * 0.45)
        albedo = textures.mix(albedo, YELLOW_BRIGHT, smoothstep(0.35, 0.9, V) * 0.6)
        albedo = textures.mix(albedo, PALE_YELLOW, smoothstep(0.9, 1.0, V) * 0.35)
        alpha = 1.0 - 0.14 * smoothstep(0.86, 1.0, V)
    elif ctx.fin == "pectoral":
        albedo = textures.rgba((0.50, 0.16, 0.70), 1.0, ctx.shape)
        albedo = textures.mix(albedo, (0.70, 0.42, 0.82), smoothstep(0.3, 1.0, V) * 0.5)
        alpha = 0.82 - 0.18 * smoothstep(0.4, 1.0, V)
    else:  # pelvic
        albedo = textures.rgba(VIOLET, 1.0, ctx.shape)
        albedo = textures.mix(albedo, MAGENTA, smoothstep(0.4, 1.0, V) * 0.4)
        alpha = 0.95 - 0.10 * smoothstep(0.6, 1.0, V)
    albedo = textures.scale_rgb(albedo, 0.90 + 0.18 * ray)
    albedo[..., 3] = alpha
    return albedo
