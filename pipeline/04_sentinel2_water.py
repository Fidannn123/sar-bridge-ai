"""Independent optical cross-check: Sentinel-2 L2A water masks near each NISAR date.

Source: ESA Copernicus Sentinel-2 L2A, Cloud-Optimized GeoTIFFs on AWS (Element 84
Earth Search STAC, public, no login). Water = NDWI (McFeeters) > 0 on cloud-free
pixels according to the Sen2Cor scene classification (SCL).

Optical and radar measure different physics; agreement strengthens the
water-extent interpretation, disagreement is reported as such.

Outputs: data/interim/s2_<label>_water.tif (0 = no valid data, 1 = land, 2 = water),
         data/context/sentinel2.json, web/data/img/s2_<label>.png (true-colour quicklook)
"""
from __future__ import annotations

import os
from datetime import datetime

import numpy as np
import rasterio
import requests
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

from common import USER_AGENT, read_json, step, utc_now, write_json
from config import CONTEXT, INTERIM
from grid import analysis_grid, save, zone_mask
from render import save_rgb_png

STAC = "https://earth-search.aws.element84.com/v1/search"
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")

# Sentinel-2 scenes chosen from a STAC search (lowest cloud cover near each NISAR date).
SCENES = {
    "before": "S2A_38TPL_20260703_0_L2A",          # NISAR before = 2026-06-25 (+8 days)
    "before_bracket": "S2A_38TPL_20260613_0_L2A",  # 2026-06-13 (-12 days): brackets the NISAR date
    "after": "S2A_38TPL_20261011_0_L2A",           # NISAR after = 2026-10-11 (same day, ~6 h later)
}
INVALID_SCL = {0, 1, 3, 8, 9, 10, 11}  # nodata, saturated, cloud shadow, cloud med/high, cirrus, snow


def get_item(item_id: str) -> dict:
    r = requests.post(STAC, json={"collections": ["sentinel-2-l2a"], "ids": [item_id]}, timeout=60,
                      headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    feats = r.json()["features"]
    if not feats:
        raise SystemExit(f"Sentinel-2 item not found: {item_id}")
    return feats[0]


def read_to_grid(href: str, grid, resampling, scale=1.0, offset=0.0, dtype="float32"):
    """Read only the study-area window (at reduced resolution) and resample onto the analysis grid."""
    with rasterio.open(href) as src:
        b = transform_bounds(grid.crs, src.crs, *grid.bounds)
        win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        factor = max(1, int(round(20.0 / src.res[0])))
        out_shape = (max(1, int(win.height // factor)), max(1, int(win.width // factor)))
        arr = src.read(1, window=win, out_shape=out_shape, resampling=Resampling.average, boundless=True, fill_value=0)
        win_transform = src.window_transform(win) * rasterio.Affine.scale(win.width / out_shape[1], win.height / out_shape[0])
        src_crs = src.crs
    raw_valid = arr != 0
    data = arr.astype("float32") * scale + offset
    data[~raw_valid] = np.nan
    out = np.full(grid.shape, np.nan, dtype="float32")
    reproject(data, out, src_transform=win_transform, src_crs=src_crs, dst_transform=grid.transform,
              dst_crs=grid.crs, resampling=resampling, src_nodata=np.nan, dst_nodata=np.nan)
    return out


OFFSET_NOTES: list[str] = []


def band_scale(asset: dict):
    rb = (asset.get("raster:bands") or [{}])[0]
    return rb.get("scale", 1.0), rb.get("offset", 0.0)


def checked_reflectance(href: str, grid, asset: dict, zone) -> np.ndarray:
    """Apply the STAC scale/offset, but verify it is physically consistent.

    Some Earth Search items advertise offset -0.1 while their DNs are already
    harmonised; applying it then yields negative reflectance over water. If more
    than 5 % of in-zone pixels go below -0.01 we drop the offset and record it.
    """
    scale, offset = band_scale(asset)
    refl = read_to_grid(href, grid, Resampling.bilinear, scale, offset)
    if offset and np.nanmean(refl[zone] < -0.01) > 0.05:
        refl = refl - offset
        OFFSET_NOTES.append(f"{href.rsplit('/', 2)[-2]}/{href.rsplit('/', 1)[-1]}: advertised offset {offset} "
                            f"gave negative reflectance; DNs treated as already harmonised (offset not applied)")
    return refl


def main():
    step("Sentinel-2 optical water masks (independent cross-check)")
    grid = analysis_grid()
    zone = zone_mask(grid)
    meta = {"source": "Copernicus Sentinel-2 L2A (ESA), COGs via Element 84 Earth Search on AWS",
            "source_url": "https://earth-search.aws.element84.com/v1",
            "method": "NDWI = (B03 - B08) / (B03 + B08) > 0 on pixels the Sen2Cor SCL marks as cloud/shadow/snow-free; resampled to the 20 m analysis grid",
            "retrieved_utc": utc_now(), "scenes": {}}
    nisar = read_json(CONTEXT / "nisar_granules.json")["pair"]
    for label, item_id in SCENES.items():
        item = get_item(item_id)
        a = item["assets"]
        print(f"  {label}: {item_id} (cloud {item['properties']['eo:cloud_cover']:.1f}%) ...")
        green = checked_reflectance(a["green"]["href"], grid, a["green"], zone)
        nir = checked_reflectance(a["nir"]["href"], grid, a["nir"], zone)
        scl = read_to_grid(a["scl"]["href"], grid, Resampling.nearest)
        valid = np.isfinite(green) & np.isfinite(nir) & np.isfinite(scl)
        valid &= ~np.isin(np.nan_to_num(scl, nan=0).astype("uint8"), list(INVALID_SCL))
        with np.errstate(invalid="ignore", divide="ignore"):
            ndwi = (green - nir) / (green + nir)
        water = valid & (ndwi > 0.0)
        cls = np.zeros(grid.shape, dtype="uint8")
        cls[valid] = 1
        cls[water] = 2
        cls[~zone] = 0
        save(INTERIM / f"s2_{label}_water.tif", cls, grid, nodata=0)

        # true-colour quicklook for the map (only for the two scenes paired with NISAR)
        if label in ("before", "after"):
            rgb = np.stack([checked_reflectance(a[b]["href"], grid, a[b], zone) for b in ("red", "green", "blue")])
            save_rgb_png(rgb, grid, f"s2_{label}")

        t = datetime.strptime(item["properties"]["datetime"][:19], "%Y-%m-%dT%H:%M:%S")
        ref = "before" if label.startswith("before") else "after"
        t_nisar = datetime.strptime(nisar[ref]["start_time"], "%Y-%m-%dT%H:%M:%SZ")
        zone_px = int(zone.sum())
        meta["scenes"][label] = {
            "item_id": item_id,
            "datetime_utc": item["properties"]["datetime"][:19] + "Z",
            "days_from_nisar": round((t - t_nisar).total_seconds() / 86400, 2),
            "paired_nisar": ref,
            "scene_cloud_cover_pct": round(item["properties"]["eo:cloud_cover"], 1),
            "valid_fraction_in_zone": round(float((valid & zone).sum()) / zone_px, 4),
            "water_area_ha_in_zone": round(float(water[zone].sum()) * 0.04, 0),
            "stac_url": f"https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/{item_id}",
        }
        print(f"    valid {meta['scenes'][label]['valid_fraction_in_zone']*100:.1f}% of zone, "
              f"water {meta['scenes'][label]['water_area_ha_in_zone']:.0f} ha")
    meta["processing_notes"] = sorted(set(OFFSET_NOTES))
    write_json(CONTEXT / "sentinel2.json", meta)


if __name__ == "__main__":
    main()
