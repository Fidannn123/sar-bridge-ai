"""Export reproducible radar-change vs optical-proxy comparisons from existing rasters.

No downloads or model calls. This is a sensor comparison, NOT ground-truth validation.
"""
from __future__ import annotations

import hashlib
import importlib
import json

import numpy as np
import pyproj
from rasterio.features import rasterize
from shapely.geometry import shape
from shapely.ops import transform

from common import read_json, write_json, utc_now, step
from config import CONTEXT, WEB_DATA, CLASS_GAIN, CLASS_LOSS, PIXEL_AREA_HA
from grid import analysis_grid, zone_mask, load
from validation_metrics import binary_scores


def main():
    step("Independent optical-proxy comparison")
    detection = importlib.import_module("05_change_detection")
    stats = read_json(WEB_DATA / "stats.json")
    analysis = read_json(WEB_DATA / "analysis.json")
    grid = analysis_grid()
    zone = zone_mask(grid)
    study = read_json(CONTEXT / "study_area.json")
    projection = pyproj.Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True).transform
    dam = study.get("dam")
    sectors, _ = detection.build_sectors(
        grid, transform(projection, shape(study["zone_geojson_lonlat"])),
        transform(projection, shape(study["reservoir_geojson_lonlat"])),
        projection(dam["lon"], dam["lat"]) if dam else None)
    sid = rasterize([(s["geom_utm"], s["id"]) for s in sectors], out_shape=grid.shape,
                    transform=grid.transform, fill=0, dtype="uint8")
    sid[~zone] = 0
    db, valid, water = {}, {}, {}
    for side in ("before", "after"):
        mask = load(f"nisar_{side}_valid.tif") == 1
        db[side] = detection.speckle_db(load(f"nisar_{side}_HH.tif"), mask)
        hv = detection.speckle_db(load(f"nisar_{side}_HV.tif"), mask)
        valid[side] = mask & np.isfinite(db[side]) & np.isfinite(hv)
        water[side] = detection.water_mask(db[side], stats["thresholds"][f"{side}_HH"]["threshold_db"], valid[side])
    both = valid["before"] & valid["after"] & zone
    classes, _ = detection.change_classes(water["before"], water["after"], db["after"] - db["before"], both, zone)
    optical = {side: load(f"s2_{side}_water.tif") for side in ("before", "after")}
    common = both & (optical["before"] > 0) & (optical["after"] > 0) & (sid > 0)
    reference_loss = (optical["before"] == 2) & (optical["after"] == 1)
    reference_gain = (optical["before"] == 1) & (optical["after"] == 2)

    def unit_result(unit, selection):
        dc = unit["detected_change"]
        for kind, code in (("loss", CLASS_LOSS), ("gain", CLASS_GAIN)):
            recomputed = round(float(((classes == code) & selection).sum()) * PIXEL_AREA_HA, 1)
            if abs(recomputed - dc[f"{kind}_ha"]) > .11:
                raise ValueError(f"Raster/export mismatch for {unit['name']}: {kind}")
        domain = common & selection
        after_domain = both & selection & (optical["after"] > 0)
        after_n = int(after_domain.sum())
        return {"id": unit.get("id"), "name": unit["name"],
                "common_valid_px": int(domain.sum()),
                "common_valid_ha": round(float(domain.sum()) * PIXEL_AREA_HA, 2),
                "excluded_from_comparison_ha": round(float((selection & ~common).sum()) * PIXEL_AREA_HA, 2),
                "radar_loss_ha": dc["loss_ha"], "radar_gain_ha": dc["gain_ha"],
                "loss": binary_scores(classes == CLASS_LOSS, reference_loss, domain),
                "gain": binary_scores(classes == CLASS_GAIN, reference_gain, domain),
                "after_water_mask_agreement": round(float((after_domain & (water["after"] == (optical["after"] == 2))).sum()) / after_n, 6) if after_n else None}

    source = {"stats_sha256": hashlib.sha256((WEB_DATA / "stats.json").read_bytes()).hexdigest(),
              "analysis_sha256": hashlib.sha256((WEB_DATA / "analysis.json").read_bytes()).hexdigest()}
    result = {"schema_version": 1, "generated_utc": utc_now(), "source": source,
              "reference_type": "independent_optical_proxy", "ground_truth_validated": False,
              "radar_dates": analysis["study_area"]["detected_change"]["dates"],
              "optical_scenes": {side: stats["optical_scenes"][side] for side in ("before", "after")},
              "method": {"comparison": "pixel_exact", "grid_m": stats["parameters"]["pixel_size_m"],
                         "pixel_area_ha": PIXEL_AREA_HA,
                         "domain": "Both NISAR dates and both cloud-masked Sentinel-2 dates valid inside the analysis sectors.",
                         "change_rule": "Existing HH land/water flip, minimum 3 dB change, minimum 1 ha patch; no tolerance dilation in these confusion counts."},
              "limitations": ["Sentinel-2 is an independent optical proxy, not field ground truth.",
                              "The before optical observation is eight calendar days after the before radar observation; after scenes share a calendar date, not an acquisition time.",
                              "Pixel-exact comparison penalises thin shoreline bands and sensor misregistration; spatial-tolerance checks remain separate evidence.",
                              "Stable areas dominate overall mask agreement. It is not change-detection accuracy or causal confidence.",
                              "Precision is undefined when radar predicts no pixels of a class. Undefined metrics are null, never perfect scores."],
              "study_area": unit_result(analysis["study_area"], zone & (sid > 0)),
              "sectors": [unit_result(unit, sid == unit["id"]) for unit in analysis["sectors"]]}
    version_material = {k: v for k, v in result.items() if k not in ("generated_utc", "package_id")}
    result["package_id"] = hashlib.sha256(json.dumps(version_material, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    write_json(WEB_DATA / "validation.json", result)
    print(f"  Compared {result['study_area']['common_valid_px']:,} common-valid pixels; exported optical-proxy metrics for {len(sectors)} sectors")


if __name__ == "__main__":
    main()
