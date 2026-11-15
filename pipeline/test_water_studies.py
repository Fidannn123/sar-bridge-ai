"""Offline checks of optical reflectance, cloud masking and local scene selection."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box

spec = importlib.util.spec_from_file_location("water_studies", Path(__file__).with_name("10_water_studies.py"))
water = importlib.util.module_from_spec(spec)
spec.loader.exec_module(water)


def test_reflectance_offset():
    with TemporaryDirectory() as directory:
        path = Path(directory) / "band.tif"
        transform = from_origin(500000, 4500000, 20, 20)
        raw = np.array([[0, 500], [1500, 2500]], dtype="uint16")
        with rasterio.open(path, "w", driver="GTiff", width=2, height=2, count=1, dtype="uint16", nodata=0, crs="EPSG:32638", transform=transform) as dst:
            dst.write(raw, 1)
        grid = {"shape": (2, 2), "transform": transform, "crs": "EPSG:32638", "bounds": (500000, 4499960, 500040, 4500000)}
        item = {"assets": {"green": {"href": str(path), "raster:bands": [{"scale": .0001, "offset": -.1}]}}, "properties": {"earthsearch:boa_offset_applied": True}}
        result = water.read_band_once(item, "green", grid)
        assert np.isnan(result[0, 0])
        np.testing.assert_allclose(result[1], [.15, .25], atol=1e-6)
        item["properties"]["earthsearch:boa_offset_applied"] = False
        result = water.read_band_once(item, "green", grid)
        np.testing.assert_allclose(result[1], [.05, .15], atol=1e-6)


def test_cloud_mask_and_missing_pixels():
    grid = {"shape": (6, 6), "res": 20}
    scl = np.full((6, 6), 6, dtype="float32")
    scl[0, :3] = [3, 9, 11]  # cloud shadow, cloud and snow
    green = np.full((6, 6), .15, dtype="float32")
    green[0, 3] = np.nan
    nir = np.full((6, 6), .05, dtype="float32")
    def band(_item, name, _grid, categorical=False):
        return {"scl": scl, "green": green, "nir": nir, "red": green, "blue": green}[name].copy()
    with patch.object(water, "read_band", side_effect=band):
        result = water.observation([{"id": "test-scene"}], grid, np.ones((6, 6), dtype=bool))
    assert result["valid"].sum() == 32
    assert result["water"].sum() == 32
    assert not result["valid"][0, :4].any()


def test_scene_selection_uses_clear_aoi_and_bounded_dates():
    grid = {"shape": (4, 4), "transform": from_origin(0, 112, 28, 28), "crs": "EPSG:3857", "bounds": (0, 0, 112, 112)}
    left = np.full((4, 4), 9, dtype="float32"); left[:, :2] = 6
    right = np.full((4, 4), 9, dtype="float32"); right[:, 2:] = 6
    small = np.full((4, 4), 9, dtype="float32"); small[:, :1] = 6
    masks = {"left": left, "right": right, "later": small}
    items = [{"id": name, "properties": {"datetime": f"2026-06-{day}T10:00:00Z", "eo:cloud_cover": cloud}} for name, day, cloud in [("left", "10", 30), ("right", "12", 30), ("later", "24", 0)]]
    with TemporaryDirectory() as directory, patch.object(water, "read_band", side_effect=lambda item, *_: masks[item["id"]]):
        selected = water.select_scenes(items, box(0, 0, .001, .001), grid, Path(directory))
    assert {item["id"] for item in selected} == {"left", "right"}


if __name__ == "__main__":
    for case in [test_reflectance_offset, test_cloud_mask_and_missing_pixels, test_scene_selection_uses_clear_aoi_and_bounded_dates]:
        case()
        print("PASS", case.__name__)
