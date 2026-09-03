"""Procedural PBR texture writing helpers (numpy arrays -> packed Blender images)."""

from __future__ import annotations

from pathlib import Path

import bpy
import numpy as np


def uv_grid(width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Return (U, V) float arrays shaped (height, width); V rows start at the image bottom."""
    u = (np.arange(width, dtype=np.float64) + 0.5) / width
    v = (np.arange(height, dtype=np.float64) + 0.5) / height
    return np.meshgrid(u, v)


def rgba(color, alpha=1.0, shape=None) -> np.ndarray:
    color = np.asarray(color, dtype=np.float64)
    if shape is None:
        return np.array((*color[:3], alpha), dtype=np.float64)
    out = np.empty((*shape, 4), dtype=np.float64)
    out[..., 0] = color[0]
    out[..., 1] = color[1]
    out[..., 2] = color[2]
    out[..., 3] = alpha
    return out


def mix(a: np.ndarray, b, t: np.ndarray) -> np.ndarray:
    """Blend RGBA arrays (or RGB(A) constants) by a scalar mask shaped like the image."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    t = np.clip(np.asarray(t, dtype=np.float64), 0.0, 1.0)[..., None]
    if b.ndim == 1:
        b = rgba(b, b[3] if b.shape[0] == 4 else 1.0, a.shape[:2])
    return a * (1.0 - t) + b * t


def scale_rgb(image: np.ndarray, factor: np.ndarray) -> np.ndarray:
    out = image.copy()
    out[..., :3] *= np.asarray(factor, dtype=np.float64)[..., None]
    return out


def normal_from_height(height: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """Tangent-space normal map RGBA from a height field in [0, 1]."""
    dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(height)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.empty((*height.shape, 4), dtype=np.float64)
    out[..., 0] = 0.5 + 0.5 * nx / length
    out[..., 1] = 0.5 + 0.5 * ny / length
    out[..., 2] = 0.5 + 0.5 * nz / length
    out[..., 3] = 1.0
    return out


def grey(values: np.ndarray) -> np.ndarray:
    values = np.clip(np.asarray(values, dtype=np.float64), 0.0, 1.0)
    out = np.empty((*values.shape, 4), dtype=np.float64)
    out[..., 0] = values
    out[..., 1] = values
    out[..., 2] = values
    out[..., 3] = 1.0
    return out


def write_image(name: str, path: Path, pixels: np.ndarray, non_color: bool = False):
    """Create a packed Blender image from an (h, w, 4) float array and save it as PNG."""
    pixels = np.clip(np.asarray(pixels, dtype=np.float32), 0.0, 1.0)
    height, width = pixels.shape[:2]
    existing = bpy.data.images.get(name)
    if existing:
        bpy.data.images.remove(existing)
    image = bpy.data.images.new(name, width=width, height=height, alpha=True)
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    if non_color:
        image.colorspace_settings.name = "Non-Color"
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save()
    image.pack()
    return image
