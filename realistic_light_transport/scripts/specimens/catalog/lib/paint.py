"""Reusable procedural paint primitives (numpy) for species texture functions."""

from __future__ import annotations

import numpy as np

from . import noise


def scales_height(u: np.ndarray, v: np.ndarray, columns: float = 60.0, rows: float = 24.0, seed: int = 3) -> np.ndarray:
    """Overlapping fish-scale relief in [0, 1]: staggered rows of arcs along u."""
    row = np.floor(v * rows)
    offset = np.where(np.mod(row, 2) == 0, 0.0, 0.5)
    fu = (u * columns + offset) % 1.0 - 0.5
    fv = (v * rows) % 1.0
    radius = np.sqrt(fu * fu * 1.6 + (fv - 0.15) ** 2)
    arc = np.clip(1.0 - radius * 1.55, 0.0, 1.0)
    grain = noise.fbm(u * columns * 2.3, v * rows * 2.3, octaves=2, seed=seed)
    return np.clip(0.55 + 0.35 * arc - 0.25 * (1 - fv) + 0.12 * (grain - 0.5), 0.0, 1.0)


def mottle(u: np.ndarray, v: np.ndarray, scale: float = 12.0, seed: int = 11, octaves: int = 3) -> np.ndarray:
    """Soft blotch field in [0, 1]."""
    return noise.fbm(u * scale, v * scale * 0.55, octaves=octaves, seed=seed)


def band(value: np.ndarray, center: float, half_width: float, softness: float) -> np.ndarray:
    """Soft-edged band mask centred on `center` along any coordinate array."""
    distance = np.abs(np.asarray(value) - center)
    return 1.0 - noise.smoothstep(half_width - softness, half_width + softness, distance)


def wavy_band(x: np.ndarray, zeta: np.ndarray, center: float, half_width: float, softness: float, wobble: float,
              frequency: float = 4.0, seed: int = 5) -> np.ndarray:
    """Band along x whose centre wanders with the flank height (organic stripe edges)."""
    wander = (noise.value_noise(zeta * frequency + 3.1, np.full_like(zeta, seed * 0.37), seed) - 0.5) * wobble
    return band(x - wander, center, half_width, softness)


def spots(u: np.ndarray, v: np.ndarray, density: float = 18.0, radius: float = 0.28, seed: int = 9,
          jitter_radius: float = 0.35) -> np.ndarray:
    """Field of soft round spots (0..1) from a jittered lattice."""
    distance, ident = noise.cells(u * density, v * density * 0.5, seed)
    size = radius * (1.0 - jitter_radius + 2.0 * jitter_radius * ident)
    return 1.0 - noise.smoothstep(size * 0.7, size, distance)


def vertical_bars(x: np.ndarray, count: int, start: float, end: float, half_width: float, softness: float,
                  zeta: np.ndarray | None = None, wobble: float = 0.0, seed: int = 21) -> np.ndarray:
    """Regularly spaced vertical bars between start and end along the body axis."""
    mask = np.zeros_like(np.asarray(x, dtype=np.float64))
    for index in range(count):
        center = start + (end - start) * (index + 0.5) / count
        if zeta is not None and wobble:
            mask = np.maximum(mask, wavy_band(x, zeta, center, half_width, softness, wobble, seed=seed + index))
        else:
            mask = np.maximum(mask, band(x, center, half_width, softness))
    return mask


def gradient(value: np.ndarray, low: float, high: float) -> np.ndarray:
    return np.clip((np.asarray(value, dtype=np.float64) - low) / max(high - low, 1e-9), 0.0, 1.0)


def rays(u: np.ndarray, count: float, sharpness: float = 6.0) -> np.ndarray:
    """Fin ray highlight field in [0, 1] along the fin base coordinate u."""
    return np.clip(np.cos(u * np.pi * 2.0 * count) * 0.5 + 0.5, 0.0, 1.0) ** sharpness


def shell_growth_lines(u: np.ndarray, v: np.ndarray, count: float = 40.0, strength: float = 0.5, seed: int = 4) -> np.ndarray:
    """Fine growth striae across a shell surface (height field in [0, 1])."""
    lines = 0.5 + 0.5 * np.sin(u * np.pi * 2.0 * count + noise.fbm(u * 6, v * 6, 2, seed) * 2.0)
    return np.clip(0.5 + (lines - 0.5) * strength, 0.0, 1.0)
