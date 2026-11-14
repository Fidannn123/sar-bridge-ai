"""Define the study area from the OpenStreetMap outline of Mingachevir Reservoir.

The OSM outline is a static cartographic reference (not a measurement of the
2026 water extent). It is used only to (1) bound the analysis zone so that dark
fields far from the reservoir are not mistaken for water, (2) orient the
geographic sectors and (3) locate the dam for labelling.

Output: data/context/study_area.json, web/data/reservoir_osm.geojson
"""
from __future__ import annotations

import json
import time

import requests
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import linemerge, polygonize, transform, unary_union
import pyproj

from common import USER_AGENT, step, utc_now, write_json
from config import ANALYSIS_CRS, CONTEXT, RESERVOIR_BUFFER_M, WEB_DATA

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
QUERY = """
[out:json][timeout:120];
(
  relation["natural"="water"]["name"~"Ming"](40.6,46.2,41.3,47.3);
  way["natural"="water"]["name"~"Ming"](40.6,46.2,41.3,47.3);
  way["waterway"="dam"](40.70,46.95,40.85,47.15);
);
out geom;
"""


def overpass(query: str) -> dict:
    last = None
    for ep in ENDPOINTS:
        for attempt in range(2):
            try:
                r = requests.post(ep, data={"data": query}, timeout=180, headers={"User-Agent": USER_AGENT})
                if r.status_code == 200 and r.text.lstrip().startswith("{"):
                    return r.json()
                last = f"{ep}: HTTP {r.status_code}"
            except requests.RequestException as ex:
                last = f"{ep}: {ex}"
            time.sleep(3)
    raise RuntimeError(f"Overpass unavailable ({last})")


def relation_polygon(el: dict):
    outer, inner = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or "geometry" not in m:
            continue
        line = LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
        (inner if m.get("role") == "inner" else outer).append(line)
    outer_polys = list(polygonize(linemerge(outer)))
    inner_polys = list(polygonize(linemerge(inner))) if inner else []
    poly = unary_union(outer_polys)
    if inner_polys:
        poly = poly.difference(unary_union(inner_polys))
    return poly


def main():
    step("Study area (OpenStreetMap reservoir outline)")
    data = overpass(QUERY)
    water, dams = [], []
    for el in data["elements"]:
        tags = el.get("tags", {})
        if tags.get("waterway") == "dam":
            dams.append({"id": el["id"], "name": tags.get("name"), "name_en": tags.get("name:en"),
                         "geom": LineString([(p["lon"], p["lat"]) for p in el["geometry"]])})
            continue
        if el["type"] == "relation":
            geom = relation_polygon(el)
        else:
            coords = [(p["lon"], p["lat"]) for p in el["geometry"]]
            if len(coords) < 4:
                continue
            geom = Polygon(coords)
        if not geom.is_empty:
            water.append({"id": f"{el['type']}/{el['id']}", "name": tags.get("name"),
                          "name_en": tags.get("name:en"), "geom": geom.buffer(0)})
    for w in water:
        print(f"  {w['id']}: {w['name']} / {w['name_en']}  area={w['geom'].area:.4f} deg2")
    if not water:
        raise SystemExit("Reservoir outline not found in OSM")
    res = max(water, key=lambda w: w["geom"].area)
    print(f"  -> using {res['id']} ({res['name']})")

    to_utm = pyproj.Transformer.from_crs("EPSG:4326", ANALYSIS_CRS, always_xy=True).transform
    to_ll = pyproj.Transformer.from_crs(ANALYSIS_CRS, "EPSG:4326", always_xy=True).transform
    res_utm = transform(to_utm, res["geom"])
    zone_utm = res_utm.buffer(RESERVOIR_BUFFER_M)
    zone_ll = transform(to_ll, zone_utm)
    minx, miny, maxx, maxy = zone_utm.bounds

    # dam: the dam way closest to the reservoir's SE end
    dam_info = None
    if dams:
        nearest = min(dams, key=lambda d: transform(to_utm, d["geom"]).distance(res_utm))
        c = nearest["geom"].centroid
        dam_info = {"osm_id": nearest["id"], "name": nearest["name"], "name_en": nearest["name_en"],
                    "lon": round(c.x, 5), "lat": round(c.y, 5)}
        print(f"  dam: {dam_info}")

    study = {
        "source": "OpenStreetMap contributors (ODbL), via Overpass API",
        "retrieved_utc": utc_now(),
        "reservoir_osm_id": res["id"],
        "reservoir_name": res["name"],
        "reservoir_name_en": res["name_en"],
        "reservoir_osm_area_km2": round(res_utm.area / 1e6, 1),
        "buffer_m": RESERVOIR_BUFFER_M,
        "analysis_crs": ANALYSIS_CRS,
        "analysis_bounds_utm": [minx, miny, maxx, maxy],
        "analysis_bbox_lonlat": list(zone_ll.bounds),
        "dam": dam_info,
        "zone_geojson_lonlat": mapping(zone_ll),
        "reservoir_geojson_lonlat": mapping(res["geom"].simplify(0.0002)),
    }
    write_json(CONTEXT / "study_area.json", study, indent=None)
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"kind": "reservoir_osm", "name": res["name"],
                                           "note": "OpenStreetMap reference outline (not 2026 extent)"},
         "geometry": mapping(res["geom"].simplify(0.0002))},
    ]}
    if dam_info:
        fc["features"].append({"type": "Feature", "properties": {"kind": "dam", "name": dam_info["name"]},
                               "geometry": mapping(Point(dam_info["lon"], dam_info["lat"]))})
    write_json(WEB_DATA / "reservoir_osm.geojson", fc, indent=None)
    print(f"  OSM reference area: {study['reservoir_osm_area_km2']} km2; analysis bbox {study['analysis_bbox_lonlat']}")


if __name__ == "__main__":
    main()
