"""Zebrasoma gemmatum (Gem Tang): species paint for the shared fish plan.

Anatomy (stations live in asset.source.json): the deepest Zebrasoma disc, body depth about
0.58 of standard length, a steep convex forehead, a short defined caudal peduncle and a compressed
proboscis-like snout that projects from the disc under a dished profile at eye level, ending in a
small terminal mouth. Very tall dorsal and anal sails, a truncate pale yellow caudal fin.

Colour: dark brown-black skin covered in dense small white spots. The spots are authored
procedurally in a row lattice laid out in physical units on the body: rows run front-to-back
along the body axis (they follow the flank contour like scale rows, converging toward the snout
and the peduncle), every row carries its own phase along the body so spots never stack into
columns, and the along-row pitch is a little tighter than the row pitch so the rows read
horizontally. Distances are measured in
metres along the body and along the ring arc so the spots stay round on the deep disc; the local
pitch follows the ring perimeter (clamped) so spots are slightly smaller and denser on the head
and the peduncle. The ring coordinate is mirrored about the dorsal ridge so the lattice has no
seam (left and right flanks share one pattern). The snout tip and lips are bare. Dorsal and anal
fins carry finer spots and a thin pale margin; the pectoral is dark at the root and yellow on its
distal half; the caudal fin is pale yellow with a dark base wash. Nothing is sampled from imagery;
every texel derives from the fixed-seed hashing in lib.noise.
"""

from __future__ import annotations

import math

import numpy as np

from ..lib import noise, paint, textures
from ..lib.noise import fbm, smoothstep

BLACK = (0.022, 0.016, 0.012)
BROWN = (0.062, 0.042, 0.026)
SPOT = (0.9, 0.9, 0.85)
PALE_YELLOW = (0.86, 0.80, 0.42)
FIN_EDGE = (0.62, 0.72, 0.78)

# spot lattice (metres at the deepest section): row pitch, along-row pitch fraction, spot radius
ROW_PITCH = 0.00475
COLUMN_FRACTION = 0.85
SPOT_RADIUS = 0.0011
PITCH_FLOOR_HEAD = 0.6  # head pitch never drops below this fraction of the flank pitch
PITCH_FLOOR_TAIL = 0.8  # peduncle spots shrink only a little
JITTER_ALONG = 0.15  # along-row jitter (fraction of a cell) on top of the per-row phase
JITTER_ACROSS = 0.1  # across-row jitter stays small so the rows remain legible
ROW_WAVE = 0.12  # low-frequency undulation of the rows, fraction of a cell


def _ring_perimeter(body, xs: np.ndarray) -> np.ndarray:
    """Approximate superellipse ring perimeter per column (Ramanujan ellipse estimate)."""
    out = np.empty_like(xs)
    for index, x in enumerate(xs):
        a = max(body.half_width(float(x)), 1e-5)
        b = max((body.dorsal(float(x)) + body.ventral(float(x))) * 0.5, 1e-5)
        out[index] = math.pi * (3.0 * (a + b) - math.sqrt((3.0 * a + b) * (a + 3.0 * b)))
    return out


def _row_spots(X: np.ndarray, arc: np.ndarray, half_perimeter: np.ndarray, pitch: np.ndarray, column_index: np.ndarray,
               radius_fraction: float, seed: int) -> np.ndarray:
    """Staggered rows of round spots.

    `pitch` is the local row pitch in metres (constant along a ring), `column_index` the
    cumulative along-body column coordinate (integral of dx over the column pitch), `arc` the
    ring arc length in metres from the dorsal ridge. Rows sit at constant arc / pitch, columns at
    integer column_index shifted by a per-row phase. Nearest lattice point over the 3x3
    neighbourhood, distance measured in metres so spots are round on the surface. Rows whose
    centre lies within half a pitch of the belly midline (`half_perimeter`) are dropped so the
    mirrored flanks meet along the belly without doubled spots."""
    column_pitch = pitch * COLUMN_FRACTION
    rho = arc / pitch + ROW_WAVE * (fbm(column_index * 0.35, arc / pitch * 0.5, octaves=2, seed=seed + 3) - 0.5) * 2.0
    row0 = np.floor(rho).astype(np.int64)
    belly_row_limit = half_perimeter / pitch - 0.5
    best = np.full(X.shape, 9.0)
    for dr in (-1, 0, 1):
        r = row0 + dr
        # every row carries its own phase along the body so no two rows stack their spots into
        # columns (a fixed half-cell stagger reads as vertical arcs in oblique views)
        stagger = noise._hash(r, np.zeros_like(r), seed + 29)
        xi = column_index - stagger
        col0 = np.floor(xi).astype(np.int64)
        for dc in (-1, 0, 1):
            c = col0 + dc
            jx = (noise._hash(c, r, seed + 7) - 0.5) * 2.0 * JITTER_ALONG
            jy = (noise._hash(c, r, seed + 19) - 0.5) * 2.0 * JITTER_ACROSS
            row_centre = r + 0.5 + jy
            dx = (c + 0.5 + jx - xi) * column_pitch
            dy = (row_centre - rho) * pitch
            distance = np.sqrt(dx * dx + dy * dy) / pitch
            distance = np.where(row_centre > belly_row_limit, 9.0, distance)
            best = np.minimum(best, distance)
    return 1.0 - noise.smoothstep(radius_fraction * 0.7, radius_fraction, best)


def paint_body(ctx):
    U, Z, V = ctx.U, ctx.ZETA, ctx.V
    X = ctx.X
    xs = X[0]
    perimeter_row = _ring_perimeter(ctx.body, xs)
    # local pitch follows the ring perimeter (spots shrink and pack tighter toward the head, a
    # little toward the peduncle) with a floor on each side of the deepest section
    deepest = int(np.argmax(perimeter_row))
    floor = np.where(np.arange(xs.size) >= deepest, PITCH_FLOOR_HEAD, PITCH_FLOOR_TAIL)
    pitch_row = ROW_PITCH * np.clip(perimeter_row / perimeter_row.max(), floor, 1.0)
    # cumulative column coordinate so along-body spacing equals the local column pitch
    dx = np.gradient(xs)
    column_row = np.cumsum(dx / (pitch_row * COLUMN_FRACTION))
    column_row -= column_row[0]
    pitch = np.tile(pitch_row, (ctx.shape[0], 1))
    column_index = np.tile(column_row, (ctx.shape[0], 1))
    perimeter = np.tile(perimeter_row, (ctx.shape[0], 1))
    # mirrored ring coordinate: 0 on the dorsal ridge, P/2 on the belly, back to 0 at the seam, so
    # the spot lattice is continuous across the UV seam (left and right flanks share one pattern)
    ring = 0.5 - np.abs(V - 0.5)
    arc = ring * perimeter

    base = textures.rgba(BLACK, 1.0, ctx.shape)
    albedo = textures.mix(base, BROWN, fbm(U * 12.0, ring * 16.0, octaves=3, seed=4) * 0.45)

    spots = _row_spots(X, arc, perimeter * 0.5, pitch, column_index, SPOT_RADIUS / ROW_PITCH, seed=9)
    spots *= 1.0 - smoothstep(0.072, 0.081, X)  # bare snout tip and lips
    spots *= 1.0 - 0.25 * smoothstep(-0.7, -1.0, Z)  # slightly sparser along the belly
    spots *= 0.82 + 0.18 * fbm(U * 6.0, ring * 8.0, octaves=2, seed=21)  # gentle brightness variation
    albedo = textures.mix(albedo, SPOT, spots * 0.94)

    height = paint.scales_height(U, V, 90, 34, seed=5) * 0.55 + 0.35 * spots
    roughness = 0.4 + 0.12 * height - 0.14 * spots
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


def paint_fin(ctx):
    U, V = ctx.U, ctx.V
    ray = paint.rays(U, 18.0, 4.0)
    if ctx.fin == "caudal":
        albedo = textures.rgba(PALE_YELLOW, 1.0, ctx.shape)
        albedo = textures.scale_rgb(albedo, 0.9 + 0.16 * ray)
        albedo = textures.mix(albedo, BLACK, (1.0 - smoothstep(0.0, 0.12, V)) * 0.75)
        albedo = textures.mix(albedo, (0.95, 0.92, 0.7), smoothstep(0.86, 1.0, V) * 0.5)
    else:
        albedo = textures.rgba(BLACK, 1.0, ctx.shape)
        albedo = textures.mix(albedo, BROWN, 0.5 * ray)
        spots = paint.spots(U, V, density=30.0, radius=0.19, seed=17, jitter_radius=0.3)
        if ctx.fin in ("dorsal", "anal"):
            spots *= 1.0 - smoothstep(0.8, 0.95, V)
            albedo = textures.mix(albedo, SPOT, spots * 0.85)
            albedo = textures.mix(albedo, FIN_EDGE, smoothstep(0.9, 1.0, V) * 0.55)
        elif ctx.fin == "pectoral":
            spots *= 1.0 - smoothstep(0.35, 0.55, V)
            albedo = textures.mix(albedo, SPOT, spots * 0.8)
            albedo = textures.mix(albedo, PALE_YELLOW, smoothstep(0.45, 0.72, V) * 0.9)
            albedo = textures.scale_rgb(albedo, 0.92 + 0.12 * ray)
        else:
            spots *= 1.0 - smoothstep(0.75, 0.95, V)
            albedo = textures.mix(albedo, SPOT, spots * 0.7)
    albedo[..., 3] = 1.0 - 0.15 * smoothstep(0.93, 1.0, V)
    return albedo
