"""The common analysis grid (UTM 38N, 20 m) every raster is aligned to, plus raster helpers."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import Affine
from shapely.geometry import shape

from common import read_json
from config import ANALYSIS_CRS, ANALYSIS_RES_M, CONTEXT, INTERIM


@dataclass
class Grid:
    crs: str
    transform: Affine
    width: int
    height: int

    @property
    def shape(self):
        return (self.height, self.width)

    @property
    def bounds(self):
        x0, y1 = self.transform.c, self.transform.f
        return (x0, y1 - self.height * ANALYSIS_RES_M, x0 + self.width * ANALYSIS_RES_M, y1)

    def profile(self, dtype="float32", nodata=None, count=1):
        p = {"driver": "GTiff", "crs": self.crs, "transform": self.transform, "width": self.width,
             "height": self.height, "count": count, "dtype": dtype, "compress": "deflate",
             "tiled": True, "blockxsize": 256, "blockysize": 256}
        if dtype.startswith("float"):
            p["predictor"] = 3
        if nodata is not None:
            p["nodata"] = nodata
        return p


def analysis_grid() -> Grid:
    study = read_json(CONTEXT / "study_area.json")
    minx, miny, maxx, maxy = study["analysis_bounds_utm"]
    r = ANALYSIS_RES_M
    x0, y1 = math.floor(minx / r) * r, math.ceil(maxy / r) * r
    x1, y0 = math.ceil(maxx / r) * r, math.floor(miny / r) * r
    return Grid(ANALYSIS_CRS, Affine(r, 0, x0, 0, -r, y1), int((x1 - x0) / r), int((y1 - y0) / r))


def zone_mask(grid: Grid) -> np.ndarray:
    """True inside the analysis zone (OSM reservoir outline + buffer)."""
    import pyproj
    from shapely.ops import transform as shp_transform
    study = read_json(CONTEXT / "study_area.json")
    to_utm = pyproj.Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True).transform
    zone = shp_transform(to_utm, shape(study["zone_geojson_lonlat"]))
    return rasterize([(zone, 1)], out_shape=grid.shape, transform=grid.transform, fill=0, dtype="uint8").astype(bool)


def save(path, arr: np.ndarray, grid: Grid, nodata=None):
    dtype = str(arr.dtype)
    with rasterio.open(path, "w", **grid.profile(dtype=dtype, nodata=nodata)) as dst:
        dst.write(arr, 1)


def load(name: str) -> np.ndarray:
    with rasterio.open(INTERIM / name) as src:
        return src.read(1)
