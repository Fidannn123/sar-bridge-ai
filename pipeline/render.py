"""Render analysis-grid rasters to Web-Mercator PNG overlays for Leaflet.

Leaflet's L.imageOverlay stretches an image linearly between lat/lon corners in
Web-Mercator pixel space, so rasters are warped to EPSG:3857 first; the PNG then
aligns exactly with the basemap. Bounds are recorded in web/data/layers.json.
"""
from __future__ import annotations

import json

import numpy as np
from PIL import Image
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform_bounds

from config import WEB_DATA

IMG_DIR = WEB_DATA / "img"
IMG_DIR.mkdir(parents=True, exist_ok=True)
MANIFEST = WEB_DATA / "layers.json"
MAX_WIDTH = 2400


def _to_3857(arr: np.ndarray, grid, resampling, nodata):
    left, bottom, right, top = grid.bounds
    dst_transform, w, h = calculate_default_transform(grid.crs, "EPSG:3857", grid.width, grid.height,
                                                      left, bottom, right, top)
    scale = max(1.0, w / MAX_WIDTH)
    w, h = int(round(w / scale)), int(round(h / scale))
    dst_transform = dst_transform * dst_transform.scale(scale, scale)
    bands = arr if arr.ndim == 3 else arr[None]
    out = np.full((bands.shape[0], h, w), nodata, dtype=bands.dtype)
    for i in range(bands.shape[0]):
        reproject(bands[i], out[i], src_transform=grid.transform, src_crs=grid.crs, dst_transform=dst_transform,
                  dst_crs="EPSG:3857", resampling=resampling, src_nodata=nodata, dst_nodata=nodata)
    x0, y1 = dst_transform.c, dst_transform.f
    x1, y0 = x0 + w * dst_transform.a, y1 + h * dst_transform.e
    w_, s_, e_, n_ = transform_bounds("EPSG:3857", "EPSG:4326", x0, y0, x1, y1)
    return (out if arr.ndim == 3 else out[0]), [[s_, w_], [n_, e_]]


def _register(name: str, bounds, ext: str = "png", **extra):
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    manifest[name] = {"url": f"data/img/{name}.{ext}", "bounds": [[round(v, 6) for v in p] for p in bounds], **extra}
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    size = (IMG_DIR / f"{name}.{ext}").stat().st_size / 1024
    print(f"  rendered web/data/img/{name}.{ext} ({size:.0f} KB)")


def save_gray_png(db: np.ndarray, grid, name: str, vmin: float, vmax: float, **extra):
    """Backscatter in dB -> 8-bit grayscale with transparent no-data."""
    warped, bounds = _to_3857(db.astype("float32"), grid, Resampling.bilinear, np.nan)
    valid = np.isfinite(warped)
    g = np.clip((np.nan_to_num(warped, nan=vmin) - vmin) / (vmax - vmin), 0, 1)
    g = (g * 255).astype("uint8")
    rgba = np.dstack([g, g, g, np.where(valid, 255, 0).astype("uint8")])
    Image.fromarray(rgba, "RGBA").save(IMG_DIR / f"{name}.webp", quality=85, method=6)
    _register(name, bounds, ext="webp", vmin_db=vmin, vmax_db=vmax, **extra)


def save_rgb_png(rgb: np.ndarray, grid, name: str, max_reflectance: float = 0.3, **extra):
    warped, bounds = _to_3857(rgb.astype("float32"), grid, Resampling.bilinear, np.nan)
    valid = np.all(np.isfinite(warped), axis=0)
    x = np.clip(np.nan_to_num(warped, nan=0) / max_reflectance, 0, 1) ** (1 / 1.6)
    img = (np.moveaxis(x, 0, -1) * 255).astype("uint8")
    rgba = np.dstack([img, np.where(valid, 255, 0).astype("uint8")])
    Image.fromarray(rgba, "RGBA").save(IMG_DIR / f"{name}.webp", quality=82, method=6)
    _register(name, bounds, ext="webp", **extra)


def save_class_png(cls: np.ndarray, grid, name: str, palette: dict[int, tuple], **extra):
    """Integer classes -> RGBA using palette {class: (r, g, b, a)}; unlisted classes are transparent."""
    warped, bounds = _to_3857(cls.astype("uint8"), grid, Resampling.nearest, 0)
    rgba = np.zeros(warped.shape + (4,), dtype="uint8")
    for k, color in palette.items():
        rgba[warped == k] = color
    Image.fromarray(rgba, "RGBA").save(IMG_DIR / f"{name}.png", optimize=True)
    _register(name, bounds, **extra)
