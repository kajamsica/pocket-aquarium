"""Deterministic hash-based value noise (numpy) for project-authored textures.

No third-party noise libraries and no sampled imagery: every texel is derived
from integer hashing so identical inputs always give identical pixels.
"""

from __future__ import annotations

import numpy as np


def _hash(ix: np.ndarray, iy: np.ndarray, seed: int) -> np.ndarray:
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + int(seed) * 1274126177) & 0x7FFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0x7FFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFF).astype(np.float64) / 65535.0


def _fade(t: np.ndarray) -> np.ndarray:
    return t * t * (3.0 - 2.0 * t)


def value_noise(x: np.ndarray, y: np.ndarray, seed: int = 0) -> np.ndarray:
    """Smooth value noise in [0, 1] for float coordinate arrays of equal shape."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    ix = np.floor(x)
    iy = np.floor(y)
    fx = _fade(x - ix)
    fy = _fade(y - iy)
    ix = ix.astype(np.int64)
    iy = iy.astype(np.int64)
    a = _hash(ix, iy, seed)
    b = _hash(ix + 1, iy, seed)
    c = _hash(ix, iy + 1, seed)
    d = _hash(ix + 1, iy + 1, seed)
    top = a + (b - a) * fx
    bottom = c + (d - c) * fx
    return top + (bottom - top) * fy


def fbm(x: np.ndarray, y: np.ndarray, octaves: int = 4, seed: int = 0, lacunarity: float = 2.0, gain: float = 0.5) -> np.ndarray:
    """Fractal sum of value noise, normalised to [0, 1]."""
    total = np.zeros(np.broadcast(np.asarray(x), np.asarray(y)).shape, dtype=np.float64)
    amplitude = 1.0
    frequency = 1.0
    weight = 0.0
    for octave in range(octaves):
        total += amplitude * value_noise(np.asarray(x) * frequency + octave * 17.17, np.asarray(y) * frequency - octave * 31.3, seed + octave * 101)
        weight += amplitude
        amplitude *= gain
        frequency *= lacunarity
    return total / weight


def cells(x: np.ndarray, y: np.ndarray, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Distance to the nearest jittered lattice point and that point's hash (Worley-style)."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    ix = np.floor(x).astype(np.int64)
    iy = np.floor(y).astype(np.int64)
    best = np.full(x.shape, 9.0)
    best_id = np.zeros(x.shape)
    for ox in (-1, 0, 1):
        for oy in (-1, 0, 1):
            cx = ix + ox
            cy = iy + oy
            jx = _hash(cx, cy, seed + 7)
            jy = _hash(cx, cy, seed + 19)
            dx = cx + jx - x
            dy = cy + jy - y
            distance = np.sqrt(dx * dx + dy * dy)
            closer = distance < best
            best = np.where(closer, distance, best)
            best_id = np.where(closer, _hash(cx, cy, seed + 37), best_id)
    return best, best_id


def smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    edge0 = np.asarray(edge0, dtype=np.float64)
    edge1 = np.asarray(edge1, dtype=np.float64)
    t = np.clip((np.asarray(value, dtype=np.float64) - edge0) / np.maximum(edge1 - edge0, 1e-12), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def scalar_hash(*values: float, seed: int = 0) -> float:
    """Deterministic scalar in [0, 1) from a tuple of numbers (for jittered placement)."""
    h = int(seed) * 1274126177
    for index, value in enumerate(values):
        h = (h * 374761393 + int(round(float(value) * 100003.0)) * (668265263 + index * 97)) & 0x7FFFFFFF
        h = ((h ^ (h >> 13)) * 1274126177) & 0x7FFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65536.0
