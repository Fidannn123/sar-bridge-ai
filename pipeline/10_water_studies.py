"""Build independent, reproducible optical investigations for the atlas water bodies.

Public Sentinel-2 L2A COGs, actual OSM outlines, cloud masks, local UTM areas.
No reuse of Mingachevir radar measurements or team-reported evaluation scores.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import time
import warnings

import numpy as np
from PIL import Image
import pyproj
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.windows import from_bounds, Window
from rasterio.warp import reproject, Resampling, transform_bounds, calculate_default_transform
from scipy import ndimage
import requests
from shapely.geometry import shape, mapping, box
from shapely.ops import transform, unary_union

warnings.filterwarnings("ignore", category=DeprecationWarning)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web/data/water-studies"
CACHE = ROOT / "data/interim/water-studies"
STAC = "https://earth-search.aws.element84.com/v1"
AGENT = "SAR-BRIDGE-AI/0.2 (water-resource research prototype)"
CATALOG = [
    {"id": "shamkir", "name": "Shamkir Reservoir", "query": "Shamkir Reservoir", "country": "Azerbaijan"},
    {"id": "araz", "name": "Araz Reservoir", "query": "Aras Reservoir", "country": "Azerbaijan / Iran"},
    {"id": "sevan", "name": "Lake Sevan", "query": "Lake Sevan", "country": "Armenia"},
    {"id": "enguri", "name": "Enguri Reservoir", "query": "Enguri Reservoir", "country": "Georgia"},
    {"id": "mead", "name": "Lake Mead", "query": "Lake Mead", "country": "United States"},
    {"id": "powell", "name": "Lake Powell", "query": "Lake Powell", "country": "United States"},
    {"id": "nasser", "name": "Lake Nasser", "query": "Lake Nasser", "country": "Egypt / Sudan"},
    {"id": "ataturk", "name": "Atatürk Reservoir", "query": "Atatürk Reservoir", "country": "Türkiye"},
]
INVALID_SCL = [0, 1, 3, 8, 9, 10, 11]
for key, value in {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MULTIRANGE": "YES", "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES", "AWS_NO_SIGN_REQUEST": "YES", "GDAL_HTTP_TIMEOUT": "45", "GDAL_HTTP_MAX_RETRY": "2"}.items():
    os.environ.setdefault(key, value)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def request(url, *, payload=None, params=None):
    for attempt in range(3):
        try:
            result = requests.post(url, json=payload, timeout=55, headers={"User-Agent": AGENT}) if payload is not None else requests.get(url, params=params, timeout=55, headers={"User-Agent": AGENT})
            result.raise_for_status()
            return result.json()
        except (requests.RequestException, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def outline(place):
    cache = CACHE / place["id"] / "outline.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    results = request("https://nominatim.openstreetmap.org/search", params={"q": place["query"], "format": "json", "polygon_geojson": 1, "limit": 3})
    candidates = [item for item in results if item.get("geojson", {}).get("type") in ("Polygon", "MultiPolygon")]
    if not candidates:
        raise ValueError(f"No polygon outline found for {place['name']}")
    result = max(candidates, key=lambda item: shape(item["geojson"]).area)
    write(cache, result)
    return result


def scenes(place, bounds, side, year):
    cache = CACHE / place["id"] / f"{year}-{side}-items.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    month = "06" if side == "before" else "10"
    period = f"{year}-{month}-01T00:00:00Z/{year}-{month}-28T23:59:59Z"
    items = request(f"{STAC}/search", payload={"collections": ["sentinel-2-l2a"], "bbox": list(bounds), "datetime": period, "limit": 500, "query": {"eo:cloud_cover": {"lt": 45}}}).get("features", [])
    if not items:
        raise ValueError(f"No Sentinel-2 scenes for {place['id']} / {side} / {year}")
    write(cache, items)
    return items


def select_scenes(items, zone, grid, cache_dir):
    # Select a short window by actual cloud-free AOI coverage, then greedily
    # fill cloud gaps from the listed scenes. Every acquisition is recorded.
    factor = max(1, max(grid["shape"]) / 160)
    h, w = max(1, round(grid["shape"][0]/factor)), max(1, round(grid["shape"][1]/factor))
    coarse = {**grid, "shape": (h, w), "transform": grid["transform"] * rasterio.Affine.scale(grid["shape"][1]/w, grid["shape"][0]/h)}
    projected_zone = transform(pyproj.Transformer.from_crs("EPSG:4326", grid["crs"], always_xy=True).transform, zone)
    domain = rasterize([(projected_zone, 1)], out_shape=(h,w), transform=coarse["transform"], dtype="uint8").astype(bool)
    clear = {}
    cache_dir.mkdir(parents=True, exist_ok=True)
    for item in items:
        cache = cache_dir / f"{item['id']}.npz"
        if cache.exists():
            mask = np.load(cache)["clear"]
        else:
            scl = read_band(item, "scl", coarse, True)
            mask = domain & ~np.isin(scl, INVALID_SCL)
            np.savez_compressed(cache, clear=mask)
        clear[item["id"]] = mask
    days = sorted(set(item["properties"]["datetime"][:10] for item in items))
    ranked = []
    for day in days:
        anchor = datetime.fromisoformat(day)
        near = [item for item in items if abs((datetime.fromisoformat(item["properties"]["datetime"][:10]) - anchor).days) <= 3]
        coverage = np.logical_or.reduce([clear[item["id"]] for item in near]).sum() / domain.sum()
        cloud = sum(item["properties"].get("eo:cloud_cover", 100) for item in near) / len(near)
        ranked.append((coverage >= .995, round(coverage, 3), -cloud, day, near))
    near = max(ranked, key=lambda row: row[:4])[-1]
    chosen, covered = [], np.zeros((h,w), dtype=bool)
    remaining = list(near)
    while remaining:
        item = max(remaining, key=lambda item: (clear[item["id"]] & ~covered).sum())
        extra = (clear[item["id"]] & ~covered).sum()
        if chosen and extra < max(1, domain.sum()*.0005):
            break
        chosen.append(item)
        covered |= clear[item["id"]]
        remaining.remove(item)
    return chosen


def read_band(item, key, grid, categorical=False):
    signature = hashlib.sha256(json.dumps([grid["shape"], list(grid["transform"]), grid["crs"]]).encode()).hexdigest()[:12]
    cache = CACHE / "bands" / f"{item['id']}-{key}-{signature}.npz"
    if cache.exists():
        return np.load(cache)["values"]
    for attempt in range(4):
        try:
            href = item["assets"][key]["href"]
            if attempt % 2:
                href = href.replace("sentinel-cogs.s3.us-west-2.amazonaws.com/", "s3.us-west-2.amazonaws.com/sentinel-cogs/")
            values = read_band_once(item, key, grid, categorical, href)
            cache.parent.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(cache, values=values)
            return values
        except rasterio.errors.RasterioError:
            if attempt == 3:
                raise
            print(f"  retrying {item['id']} / {key}", flush=True)
            time.sleep(1 + attempt*2)


def read_band_once(item, key, grid, categorical=False, href=None):
    asset = item["assets"][key]
    output = np.zeros(grid["shape"], dtype="float32")
    with rasterio.open(href or asset["href"]) as src:
        projected_bounds = transform_bounds(grid["crs"], src.crs, *grid["bounds"])
        try:
            window = from_bounds(*projected_bounds, transform=src.transform).round_offsets().round_lengths().intersection(Window(0, 0, src.width, src.height))
        except rasterio.errors.WindowError:
            return output if categorical else np.full(grid["shape"], np.nan, dtype="float32")
        factor = max(1, max(abs(grid["transform"].a), abs(grid["transform"].e)) / abs(src.res[0]))
        out_shape = (max(1, math.ceil(window.height/factor)), max(1, math.ceil(window.width/factor)))
        array = src.read(1, window=window, out_shape=out_shape, resampling=Resampling.nearest if categorical else Resampling.average)
        source_transform = src.window_transform(window) * rasterio.Affine.scale(window.width/out_shape[1], window.height/out_shape[0])
        reproject(array, output, src_transform=source_transform, src_crs=src.crs, dst_transform=grid["transform"], dst_crs=grid["crs"], src_nodata=0, dst_nodata=0, resampling=Resampling.nearest if categorical else Resampling.average, num_threads=2)
    if not categorical:
        band = (asset.get("raster:bands") or [{}])[0]
        # Earth Search harmonized DNs already have the BOA offset applied.
        offset = 0 if item["properties"].get("earthsearch:boa_offset_applied") else band.get("offset", 0)
        output = np.where(output > 0, output * band.get("scale", .0001) + offset, np.nan)
    return output


def observation(items, grid, zone):
    water = np.zeros(grid["shape"], dtype=bool)
    valid = np.zeros(grid["shape"], dtype=bool)
    rgb = np.zeros((3, *grid["shape"]), dtype="float32")
    for item in items:
        print(f"  reading {item['id']}", flush=True)
        scl = read_band(item, "scl", grid, True)
        green = read_band(item, "green", grid)
        nir = read_band(item, "nir", grid)
        usable = np.isfinite(green) & np.isfinite(nir) & ~np.isin(scl, INVALID_SCL) & ((green + nir) > 0)
        take = usable & ~valid
        with np.errstate(invalid="ignore", divide="ignore"):
            ndwi = (green - nir) / (green + nir)
        water[take] = ndwi[take] > 0
        valid[take] = True
        for index, band in enumerate(("red", "green", "blue")):
            values = green if band == "green" else read_band(item, band, grid)
            rgb[index][take] = np.nan_to_num(values[take])
    labels, _ = ndimage.label(water)
    sizes = np.bincount(labels.ravel())
    water &= sizes[labels] >= max(1, math.ceil(10000 / grid["res"] ** 2))
    return {"water": water & zone, "valid": valid & zone, "rgb": rgb, "image_valid": valid}


def export_image(path, values, grid, categorical=False):
    target_transform, width, height = calculate_default_transform(grid["crs"], "EPSG:3857", grid["shape"][1], grid["shape"][0], *grid["bounds"])
    result = np.zeros((values.shape[0], height, width), dtype="uint8")
    for index in range(values.shape[0]):
        reproject(values[index], result[index], src_transform=grid["transform"], src_crs=grid["crs"], dst_transform=target_transform, dst_crs="EPSG:3857", resampling=Resampling.nearest if categorical else Resampling.bilinear)
    image = Image.fromarray(result.transpose(1, 2, 0), "RGBA")
    image.save(path, "WEBP", lossless=categorical, quality=84, method=4)
    mb = rasterio.transform.array_bounds(height, width, target_transform)
    west, south, east, north = transform_bounds("EPSG:3857", "EPSG:4326", *mb)
    return [[south, west], [north, east]]


def process(place, boundary, year):
    print(f"START {place['id']}", flush=True)
    destination = OUT / place["id"]
    destination.mkdir(parents=True, exist_ok=True)
    source_shape = shape(boundary["geojson"]).buffer(0)
    center = source_shape.centroid
    crs = f"EPSG:{32600 + int((center.x + 180) // 6) + 1}"
    to_m = pyproj.Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
    to_ll = pyproj.Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform
    geometry = transform(to_m, source_shape)
    zone_geom = geometry.buffer(750)
    minx, miny, maxx, maxy = zone_geom.bounds
    res = max(20, math.ceil(max(maxx-minx, maxy-miny) / 1600 / 20) * 20)
    minx, miny = math.floor(minx/res)*res, math.floor(miny/res)*res
    maxx, maxy = math.ceil(maxx/res)*res, math.ceil(maxy/res)*res
    grid = {"crs": crs, "res": res, "transform": from_origin(minx, maxy, res, res), "shape": (round((maxy-miny)/res), round((maxx-minx)/res)), "bounds": (minx, miny, maxx, maxy)}
    zone = rasterize([(zone_geom, 1)], out_shape=grid["shape"], transform=grid["transform"], dtype="uint8").astype(bool)
    geographic_zone = transform(to_ll, zone_geom)
    observations, manifest = {}, {}
    for side in ("before", "after"):
        selected = select_scenes(scenes(place, geographic_zone.bounds, side, year), geographic_zone, grid, CACHE / place["id"] / "quality")
        print(f"{place['id']} {side}: {len(selected)} scenes / {res} m", flush=True)
        observations[side] = observation(selected, grid, zone)
        dates = sorted(item["properties"]["datetime"][:10] for item in selected)
        manifest[side] = {"start_date": dates[0], "end_date": dates[-1], "scenes": [{"id": item["id"], "datetime_utc": item["properties"]["datetime"], "scene_cloud_cover_pct": item["properties"].get("eo:cloud_cover"), "stac_url": f"{STAC}/collections/sentinel-2-l2a/items/{item['id']}", "boa_offset_already_applied": bool(item["properties"].get("earthsearch:boa_offset_applied"))} for item in selected]}
    before, after = observations["before"], observations["after"]
    common = zone & before["valid"] & after["valid"]
    if common.sum() / zone.sum() < .65:
        raise ValueError(f"Insufficient common-valid coverage for {place['id']}: {common.sum()/zone.sum():.1%}")
    classes = np.zeros(grid["shape"], dtype="uint8")
    classes[common] = 1
    classes[common & before["water"] & after["water"]] = 2
    classes[common & ~before["water"] & after["water"]] = 3
    classes[common & before["water"] & ~after["water"]] = 4
    area = res ** 2 / 10000

    def measurement(selection):
        domain = selection & common
        return {"loss_ha": round(float(((classes == 4) & selection).sum()) * area, 2), "gain_ha": round(float(((classes == 3) & selection).sum()) * area, 2), "water_before_ha": round(float((before["water"] & domain).sum()) * area, 2), "water_after_ha": round(float((after["water"] & domain).sum()) * area, 2), "valid_area_ha": round(float(domain.sum()) * area, 2), "zone_area_ha": round(float(selection.sum()) * area, 2), "valid_fraction": round(float(domain.sum()) / max(1, int(selection.sum())), 6)}

    image_bounds = None
    for side, obs in observations.items():
        colours = (np.clip(obs["rgb"] / .3, 0, 1) ** (1/1.8) * 255).astype("uint8")
        rgba = np.concatenate([colours, (obs["image_valid"] * 255).astype("uint8")[None]])
        image_bounds = export_image(destination / f"{side}.webp", rgba, grid)
    overlay = np.zeros((4, *grid["shape"]), dtype="uint8")
    for value, color in {2: (86,135,142,30), 3: (65,144,180,225), 4: (190,92,58,225)}.items():
        overlay[:, classes == value] = np.array(color)[:, None]
    missing = zone & ~common
    hatch = (np.indices(grid["shape"]).sum(axis=0) % 7 < 2) & missing
    overlay[:, hatch] = np.array([188,188,183,110])[:, None]
    export_image(destination / "change.webp", overlay, grid, True)
    # Ten geographic strips, ordered along the longest bounding-box dimension.
    y, x = np.indices(grid["shape"])
    along_x = (maxx-minx) > (maxy-miny)
    axis = x / grid["shape"][1] if along_x else y / grid["shape"][0]
    sector_ids = np.minimum(9, (axis*10).astype(int)) + 1
    sectors, features = [], []
    for index in range(1, 11):
        selected_zone = zone & (sector_ids == index)
        if not selected_zone.any():
            continue
        if along_x:
            lo, hi = minx+(index-1)*(maxx-minx)/10, minx+index*(maxx-minx)/10
            strip = box(lo, miny, hi, maxy)
        else:
            lo, hi = maxy-index*(maxy-miny)/10, maxy-(index-1)*(maxy-miny)/10
            strip = box(minx, lo, maxx, hi)
        section = zone_geom.intersection(strip).simplify(res)
        metric = {"id": index, "name": f"Sector {index:02d}", **measurement(selected_zone)}
        sectors.append(metric)
        features.append({"type": "Feature", "properties": {"id": index, "name": metric["name"]}, "geometry": mapping(transform(to_ll, section))})
    total = measurement(zone)
    limitations = ["Optical Sentinel-2 analysis, not NISAR radar analysis or field validation.", "Water classification uses NDWI > 0 with cloud, shadow and snow masking; dark terrain and mixed shoreline pixels can affect the result.", "Areas are measured only where both observation windows have usable data, inside the OSM water outline plus a 750 m buffer.", "Each observation can mosaic several scenes within a seven-day window; inspect individual acquisition dates in the sources.", f"Analysis grid: {res} m. Boundary uncertainty is approximately one to two pixels; sub-pixel shoreline detail is not resolved.", "Two observation windows show a surface-area difference, not water volume, a long-term trend, a forecast or a confirmed cause.", "Gauge measurements and dam-release records have not been supplied. No causal explanation or model-performance score is inferred."]
    result = {"schema_version": 1, "id": place["id"], "name": place["name"], "country": place["country"], "sensor": "Sentinel-2 L2A", "analysis_type": "optical_water_change", "generated_utc": datetime.now(timezone.utc).isoformat(), "grid_m": res, "bounds": image_bounds, "method": {"water_index": "NDWI = (green - NIR) / (green + NIR) > 0", "invalid_scl_classes": INVALID_SCL, "minimum_water_patch_ha": 1, "outline_buffer_m": 750, "area_crs": crs, "comparison_domain": "Common-valid pixels inside the buffered water outline", "sector_order": "west to east" if along_x else "north to south"}, "observations": manifest, "totals": total, "sectors": sectors, "sector_geojson": {"type": "FeatureCollection", "features": features}, "outline": {"type": "Feature", "properties": {"source": "OpenStreetMap"}, "geometry": mapping(transform(to_ll, geometry.simplify(res)))}, "sources": [{"name": "Copernicus Sentinel-2 L2A / Element 84 Earth Search", "url": STAC}, {"name": "OpenStreetMap water outline", "url": f"https://www.openstreetmap.org/{boundary['osm_type']}/{boundary['osm_id']}"}], "assets": {side: f"data/water-studies/{place['id']}/{side}.webp" for side in ("before", "after", "change")}, "limitations": limitations}
    result["asset_sha256"] = {side: hashlib.sha256((destination / f"{side}.webp").read_bytes()).hexdigest() for side in ("before", "after", "change")}
    material = json.dumps(result, sort_keys=True, ensure_ascii=False).encode()
    result["package_id"] = hashlib.sha256(material).hexdigest()
    write(destination / "analysis.json", result)
    print(f"DONE {place['id']}: loss {total['loss_ha']} ha / gain {total['gain_ha']} ha / valid {total['valid_fraction']:.1%}", flush=True)
    return {"id": place["id"], "name": place["name"], "sensor": result["sensor"], "analysis_url": f"data/water-studies/{place['id']}/analysis.json", "package_id": result["package_id"], "dates": {side: {key: manifest[side][key] for key in ("start_date", "end_date")} for side in manifest}, "grid_m": res}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    selected = [place for place in CATALOG if not args.only or place["id"] in args.only]
    boundaries = {}
    for place in selected:
        print(f"OUTLINE {place['id']}", flush=True)
        boundaries[place["id"]] = outline(place)
        time.sleep(1.1)  # Nominatim public-service request policy.
    errors = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending = {pool.submit(process, place, boundaries[place["id"]], args.year): place for place in selected}
        for future in as_completed(pending):
            try:
                future.result()
            except Exception as error:
                errors.append((pending[future]["id"], str(error)))
                print(f"FAILED {pending[future]['id']}: {error}", flush=True)
    index = []
    for place in CATALOG:
        path = OUT / place["id"] / "analysis.json"
        if path.exists():
            item = json.loads(path.read_text(encoding="utf-8"))
            index.append({"id": item["id"], "name": item["name"], "sensor": item["sensor"], "analysis_url": f"data/water-studies/{item['id']}/analysis.json", "package_id": item["package_id"], "grid_m": item["grid_m"], "dates": {side: {key: item["observations"][side][key] for key in ("start_date", "end_date")} for side in ("before", "after")}})
    write(OUT / "index.json", {"schema_version": 1, "studies": index})
    if errors:
        raise SystemExit(f"Some studies failed: {errors}")


if __name__ == "__main__":
    main()
