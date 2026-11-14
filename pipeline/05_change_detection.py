"""Pairwise NISAR water-extent change detection + per-sector measurements.

Method (all parameters in config.py, documented in the Methodology panel):
 1. gamma0 HH and HV (linear power, 20 m) -> 5x5 boxcar speckle filter (NaN-aware) -> dB.
 2. Water mask per date and polarisation: Otsu threshold computed inside the analysis
    zone, clamped to a physically plausible L-band range; small blobs / holes removed.
 3. Change: a pixel is "water gain" if land->water AND HH dropped by >= 3 dB, "water loss"
    if water->land AND HH rose by >= 3 dB. Patches < 1 ha are discarded. Pixels lacking
    valid data in either date are "insufficient data" (never counted as "no change").
 4. Sectors: the zone is cut into slices along the reservoir's principal (NW-SE) axis.
 5. Per-sector diagnostics used by the evidence engine (see 06_evidence.py).

Outputs: web/data/stats.json, web/data/sectors.geojson, web/data/sector_metrics.json,
         web/data/change_polygons.geojson, PNG overlays in web/data/img/
"""
from __future__ import annotations

import numpy as np
import pyproj
from rasterio.features import rasterize, shapes
from scipy.ndimage import binary_dilation, uniform_filter
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import transform as shp_transform, unary_union
from skimage.filters import threshold_otsu
from skimage.measure import label
from skimage.morphology import remove_small_holes, remove_small_objects

from common import read_json, step, utc_now, write_json
from config import (CLASS_GAIN, CLASS_LAND, CLASS_LOSS, CLASS_NODATA, CLASS_WATER, CONTEXT, INTERIM, MAX_CLAMP_DB,
                    MIN_DELTA_DB, MIN_PATCH_PX, N_SECTORS, COLOC_TOL_PX, OTSU_BOUNDS_HH_DB, OTSU_BOUNDS_HV_DB,
                    PIXEL_AREA_HA, SPECKLE_WINDOW, WEB_DATA)
from grid import analysis_grid, load, zone_mask
from render import save_class_png, save_gray_png

HA = PIXEL_AREA_HA


# ----------------------------------------------------------------------------- helpers
def speckle_db(lin: np.ndarray, valid: np.ndarray) -> np.ndarray:
    x = np.where(valid, lin, 0.0).astype("float64")
    num = uniform_filter(x, SPECKLE_WINDOW)
    den = uniform_filter(valid.astype("float64"), SPECKLE_WINDOW)
    with np.errstate(invalid="ignore", divide="ignore"):
        filt = num / den
        db = 10 * np.log10(filt)
    db[~valid | (den < 0.5)] = np.nan
    return db.astype("float32")


def otsu(db: np.ndarray, sel: np.ndarray, bounds) -> dict:
    vals = db[sel & np.isfinite(db)]
    vals = vals[(vals > -40) & (vals < 10)]
    raw = float(threshold_otsu(vals, nbins=512))
    used = float(np.clip(raw, *bounds))
    # If the data-driven split lies far outside the physically plausible range, this
    # polarisation shows no usable water/land separation (e.g. water at the noise floor).
    return {"otsu_raw_db": round(raw, 2), "threshold_db": round(used, 2), "clamped": raw != used,
            "separable": abs(raw - used) <= MAX_CLAMP_DB, "n_pixels": int(vals.size)}


def water_mask(db: np.ndarray, thr: float, valid: np.ndarray) -> np.ndarray:
    w = valid & (db < thr)
    w = remove_small_objects(w, max_size=MIN_PATCH_PX - 1)
    w = remove_small_holes(w, max_size=MIN_PATCH_PX - 1) & valid
    return w


def change_classes(wb, wa, delta, both_valid, zone):
    gain = both_valid & ~wb & wa & (delta <= -MIN_DELTA_DB)
    loss = both_valid & wb & ~wa & (delta >= MIN_DELTA_DB)
    gain = remove_small_objects(gain, max_size=MIN_PATCH_PX - 1)
    loss = remove_small_objects(loss, max_size=MIN_PATCH_PX - 1)
    flips = both_valid & (wb != wa)
    ambiguous = flips & ~gain & ~loss
    cls = np.full(wb.shape, CLASS_NODATA, dtype="uint8")
    cls[both_valid & ~wb] = CLASS_LAND          # unchanged (or ambiguous) pixels keep the 'before' state
    cls[both_valid & wb] = CLASS_WATER
    cls[gain] = CLASS_GAIN
    cls[loss] = CLASS_LOSS
    cls[~zone] = CLASS_NODATA
    return cls, ambiguous & zone


def connected_fraction(change: np.ndarray, anchor: np.ndarray) -> float | None:
    """Area fraction of change pixels whose 8-connected patch touches `anchor` (dilated by 1 px)."""
    n = int(change.sum())
    if n == 0:
        return None
    lab = label(change, connectivity=2)
    touching = np.unique(lab[binary_dilation(anchor, np.ones((3, 3), bool)) & change])
    touching = touching[touching > 0]
    return round(float(np.isin(lab, touching).sum()) / n, 3)


def med(a: np.ndarray, sel: np.ndarray, min_n: int = 50):
    v = a[sel & np.isfinite(a)]
    return round(float(np.median(v)), 2) if v.size >= min_n else None


def frac(num_sel: np.ndarray, den_sel: np.ndarray, min_n: int = 25):
    d = int(den_sel.sum())
    return round(float((num_sel & den_sel).sum()) / d, 3) if d >= min_n else None


# ----------------------------------------------------------------------------- sectors
def build_sectors(grid, zone_poly_utm, reservoir_utm, dam_utm):
    coords = np.array(reservoir_utm.exterior.coords if reservoir_utm.geom_type == "Polygon"
                      else max(reservoir_utm.geoms, key=lambda g: g.area).exterior.coords)
    c = coords.mean(axis=0)
    _, _, vt = np.linalg.svd(coords - c, full_matrices=False)
    u = vt[0]
    if dam_utm is not None and np.dot(np.array(dam_utm) - c, u) < 0:
        u = -u                                  # orient axis NW -> SE (dam at the SE end)
    v = np.array([-u[1], u[0]])
    zc = np.array(zone_poly_utm.exterior.coords if zone_poly_utm.geom_type == "Polygon"
                  else np.vstack([g.exterior.coords for g in zone_poly_utm.geoms]))
    t = (zc - c) @ u
    s = (zc - c) @ v
    tmin, tmax, smin, smax = t.min(), t.max(), s.min() - 1000, s.max() + 1000
    edges = np.linspace(tmin, tmax, N_SECTORS + 1)
    sectors = []
    for i in range(N_SECTORS):
        a, b = edges[i], edges[i + 1]
        corners = [c + a * u + smin * v, c + b * u + smin * v, c + b * u + smax * v, c + a * u + smax * v]
        poly = Polygon(corners).intersection(zone_poly_utm)
        km0, km1 = (a - tmin) / 1000, (b - tmin) / 1000
        where = " (NW end)" if i == 0 else (" (SE end, dam)" if i == N_SECTORS - 1 else "")
        sectors.append({"id": i + 1, "name": f"Sector {i+1}{where}",
                        "position": f"{km0:.0f}-{km1:.0f} km from the NW end along the reservoir axis",
                        "geom_utm": poly})
    return sectors, float((tmax - tmin) / 1000)


# ----------------------------------------------------------------------------- main
def main():
    step("NISAR change detection")
    grid = analysis_grid()
    zone = zone_mask(grid)
    study = read_json(CONTEXT / "study_area.json")
    nisar = read_json(CONTEXT / "nisar_granules.json")["pair"]
    to_utm = pyproj.Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True).transform
    to_ll = pyproj.Transformer.from_crs(grid.crs, "EPSG:4326", always_xy=True).transform

    # ---- load NISAR subsets
    d = {}
    for t in ("before", "after"):
        valid = load(f"nisar_{t}_valid.tif") == 1
        for pol in ("HH", "HV"):
            d[(t, pol)] = speckle_db(load(f"nisar_{t}_{pol}.tif"), valid)
        d[(t, "valid")] = valid & np.isfinite(d[(t, "HH")]) & np.isfinite(d[(t, "HV")])
    both_valid = d[("before", "valid")] & d[("after", "valid")] & zone

    # ---- thresholds & water masks
    thr, water = {}, {}
    for t in ("before", "after"):
        sel = zone & d[(t, "valid")]
        for pol, bounds in (("HH", OTSU_BOUNDS_HH_DB), ("HV", OTSU_BOUNDS_HV_DB)):
            thr[(t, pol)] = otsu(d[(t, pol)], sel, bounds)
            water[(t, pol)] = water_mask(d[(t, pol)], thr[(t, pol)]["threshold_db"], d[(t, "valid")])
            print(f"  {t} {pol}: threshold {thr[(t, pol)]['threshold_db']} dB "
                  f"(Otsu {thr[(t, pol)]['otsu_raw_db']}{', clamped' if thr[(t, pol)]['clamped'] else ''})")

    hv_separable = thr[("before", "HV")]["separable"] and thr[("after", "HV")]["separable"]
    hh_separable = thr[("before", "HH")]["separable"] and thr[("after", "HH")]["separable"]
    print(f"  separability: HH {'ok' if hh_separable else 'NOT separable'}, HV {'ok' if hv_separable else 'NOT separable'}")
    dHH = d[("after", "HH")] - d[("before", "HH")]
    dHV = d[("after", "HV")] - d[("before", "HV")]
    cls, ambiguous = change_classes(water[("before", "HH")], water[("after", "HH")], dHH, both_valid, zone)
    cls_hv, _ = change_classes(water[("before", "HV")], water[("after", "HV")], dHV, both_valid, zone)
    gain, loss = cls == CLASS_GAIN, cls == CLASS_LOSS
    st_land, st_water = cls == CLASS_LAND, cls == CLASS_WATER

    # ---- optical cross-check rasters
    s2 = {k: load(f"s2_{k}_water.tif") for k in ("before", "after", "before_bracket")}
    s2_meta = read_json(CONTEXT / "sentinel2.json")

    # ---- sectors
    zone_poly = shp_transform(to_utm, shape(study["zone_geojson_lonlat"]))
    res_poly = shp_transform(to_utm, shape(study["reservoir_geojson_lonlat"]))
    dam = study.get("dam")
    dam_utm = to_utm(dam["lon"], dam["lat"]) if dam else None
    sectors, axis_km = build_sectors(grid, zone_poly, res_poly, dam_utm)
    sid = rasterize([(s["geom_utm"], s["id"]) for s in sectors], out_shape=grid.shape, transform=grid.transform,
                    fill=0, dtype="uint8")
    sid[~zone] = 0

    # Sensor co-location with a 40 m (2-pixel) tolerance: change bands are often only 1-3 pixels wide,
    # so pixel-exact matching between two sensors (different geometry, 8-day offset) is overly strict.
    s2v_all = (s2["before"] > 0) & (s2["after"] > 0) & zone
    o_loss_all = s2v_all & (s2["before"] == 2) & (s2["after"] == 1)
    tol = np.ones((2 * COLOC_TOL_PX + 1, 2 * COLOC_TOL_PX + 1), bool)
    o_loss_near = binary_dilation(o_loss_all, tol)
    n_loss_near = binary_dilation(loss, tol)

    def metrics(sel: np.ndarray) -> dict:
        zone_px = int(sel.sum())
        bv = both_valid & sel
        n_valid = int(bv.sum())
        wb, wa = water[("before", "HH")] & bv, water[("after", "HH")] & bv
        g, l = gain & sel, loss & sel
        g_hv, l_hv = (cls_hv == CLASS_GAIN) & sel, (cls_hv == CLASS_LOSS) & sel
        s2v = (s2["before"] > 0) & (s2["after"] > 0) & sel
        o_gain = s2v & (s2["before"] == 1) & (s2["after"] == 2)
        o_loss = s2v & (s2["before"] == 2) & (s2["after"] == 1)
        m = {
            "zone_area_ha": round(zone_px * HA, 1),
            "valid_area_ha": round(n_valid * HA, 1),
            "valid_fraction": round(n_valid / zone_px, 4) if zone_px else None,
            "insufficient_data_ha": round((zone_px - n_valid) * HA, 1),
            "water_before_ha": round(float(wb.sum()) * HA, 1),
            "water_after_ha": round(float(wa.sum()) * HA, 1),
            "gain_ha": round(float(g.sum()) * HA, 1),
            "loss_ha": round(float(l.sum()) * HA, 1),
            "net_change_ha": round(float(g.sum() - l.sum()) * HA, 1),
            "stable_water_ha": round(float((st_water & sel).sum()) * HA, 1),
            "stable_land_ha": round(float((st_land & sel).sum()) * HA, 1),
            "ambiguous_flip_ha": round(float((ambiguous & sel).sum()) * HA, 1),
            "hh": {
                "median_delta_db_stable_land": med(dHH, st_land & sel),
                "median_delta_db_stable_water": med(dHH, st_water & sel),
                "median_delta_db_loss": med(dHH, l, 10),
                "median_delta_db_gain": med(dHH, g, 10),
                "median_db_water_before": med(d[("before", "HH")], st_water & sel),
                "median_db_water_after": med(d[("after", "HH")], st_water & sel),
                "median_db_after_on_loss": med(d[("after", "HH")], l, 10),
                "median_db_land_before": med(d[("before", "HH")], st_land & sel),
            },
            "hv": {
                "available": True,
                "separable": hv_separable,
                "gain_ha": round(float(g_hv.sum()) * HA, 1),
                "loss_ha": round(float(l_hv.sum()) * HA, 1),
                "median_delta_db_loss": med(dHV, l, 10),
                "median_delta_db_stable_land": med(dHV, st_land & sel),
                "median_db_after_on_loss": med(d[("after", "HV")], l, 10),
                "median_db_water_before": med(d[("before", "HV")], st_water & sel),
                "median_db_water_after": med(d[("after", "HV")], st_water & sel),
                "median_db_land_before": med(d[("before", "HV")], st_land & sel),
                "loss_agreement_with_hh": frac(l_hv, l),   # share of HH-loss pixels also flagged by HV
                "gain_agreement_with_hh": frac(g_hv, g),
            },
            "pattern": {
                "loss_shore_connected_fraction": connected_fraction(l, st_land & sel),
                "gain_water_connected_fraction": connected_fraction(g, st_water & sel),
            },
            "optical": {
                "valid_fraction": round(float(s2v.sum()) / zone_px, 4) if zone_px else None,
                "water_before_ha": round(float(((s2["before"] == 2) & s2v).sum()) * HA, 1),
                "water_after_ha": round(float(((s2["after"] == 2) & s2v).sum()) * HA, 1),
                "water_before_bracket_ha": round(float(((s2["before_bracket"] == 2) & sel).sum()) * HA, 1),
                "gain_ha": round(float(o_gain.sum()) * HA, 1),
                "loss_ha": round(float(o_loss.sum()) * HA, 1),
                "nisar_loss_land_in_same_day_s2": frac(s2["after"] == 1, l & (s2["after"] > 0)),
                "nisar_loss_near_optical_loss_40m": frac(o_loss_near, l & s2v_all),
                "optical_loss_near_nisar_loss_40m": frac(n_loss_near, o_loss),
                "nisar_loss_water_in_s2_before": frac(s2["before"] == 2, l & (s2["before"] > 0)),
                "nisar_gain_water_in_same_day_s2": frac(s2["after"] == 2, g & (s2["after"] > 0)),
                "after_mask_agreement": frac(water[("after", "HH")] == (s2["after"] == 2), bv & (s2["after"] > 0)),
                "before_mask_agreement": frac(water[("before", "HH")] == (s2["before"] == 2), bv & (s2["before"] > 0)),
            },
        }
        return m

    sector_out = []
    for s in sectors:
        m = metrics(sid == s["id"])
        sector_out.append({"id": s["id"], "name": s["name"], "position": s["position"], **m})
        print(f"  {s['name']:<24} valid {m['valid_fraction']*100:5.1f}%  gain {m['gain_ha']:8.1f} ha  "
              f"loss {m['loss_ha']:8.1f} ha  (HV loss {m['hv']['loss_ha']:.0f}, S2 loss {m['optical']['loss_ha']:.0f})")
    total = metrics(zone & (sid > 0))

    # ---- web outputs: sectors geojson
    feats = []
    for s, m in zip(sectors, sector_out):
        geom_ll = shp_transform(to_ll, s["geom_utm"].simplify(30))
        c = geom_ll.representative_point()
        feats.append({"type": "Feature", "geometry": mapping(geom_ll),
                      "properties": {"id": s["id"], "name": s["name"], "label_lat": c.y, "label_lon": c.x,
                                     "gain_ha": m["gain_ha"], "loss_ha": m["loss_ha"],
                                     "net_change_ha": m["net_change_ha"], "valid_fraction": m["valid_fraction"]}})
    write_json(WEB_DATA / "sectors.geojson", {"type": "FeatureCollection", "features": feats}, indent=None)

    # ---- change polygons (vector, for hover/inspection)
    polys = []
    for geom, val in shapes(cls, mask=np.isin(cls, [CLASS_GAIN, CLASS_LOSS]), transform=grid.transform, connectivity=8):
        p = shape(geom)
        area = p.area / 10_000
        if area < 2.0:
            continue
        pll = shp_transform(to_ll, p.simplify(15))
        cen = p.representative_point()
        r, c_ = ~grid.transform * (cen.x, cen.y)
        polys.append({"type": "Feature", "geometry": mapping(pll),
                      "properties": {"change": "gain" if val == CLASS_GAIN else "loss", "area_ha": round(area, 1),
                                     "sector": int(sid[int(c_), int(r)]) if 0 <= int(c_) < grid.height and 0 <= int(r) < grid.width else None}})
    write_json(WEB_DATA / "change_polygons.geojson", {"type": "FeatureCollection", "features": polys}, indent=None)

    # ---- overlays
    for t in ("before", "after"):
        lab = nisar[t]["start_time"][:10]
        save_gray_png(d[(t, "HH")], grid, f"nisar_{t}_HH", -25, 0, date=lab, pol="HH")
        save_gray_png(d[(t, "HV")], grid, f"nisar_{t}_HV", -32, -8, date=lab, pol="HV")
    palette = {CLASS_GAIN: (31, 95, 214, 240), CLASS_LOSS: (217, 72, 28, 240),
               CLASS_WATER: (120, 198, 230, 38), CLASS_NODATA: (0, 0, 0, 0), CLASS_LAND: (0, 0, 0, 0)}
    cls_vis = cls.copy()
    nodata_in_zone = zone & ~both_valid
    cls_vis[nodata_in_zone] = 9
    palette[9] = (150, 150, 150, 170)
    save_class_png(cls_vis, grid, "change_map", palette)

    # ---- stats
    stats = {
        "generated_utc": utc_now(),
        "pair": {k: {"date": v["start_time"][:10], "time_utc": v["start_time"], "granule_id": v["granule_id"]}
                 for k, v in nisar.items()},
        "days_between": (np.datetime64(nisar["after"]["start_time"][:10]) - np.datetime64(nisar["before"]["start_time"][:10])).astype(int),
        "n_sectors": len(sectors),
        "reservoir_axis_length_km": round(axis_km, 1),
        "thresholds": {f"{t}_{p}": v for (t, p), v in thr.items()},
        "separability": {"HH": hh_separable, "HV": hv_separable, "max_clamp_db": MAX_CLAMP_DB},
        "parameters": {"speckle_window_px": SPECKLE_WINDOW, "min_delta_db": MIN_DELTA_DB,
                       "min_patch_ha": MIN_PATCH_PX * HA, "pixel_size_m": 20, "zone_buffer_m": study["buffer_m"]},
        "totals": total,
        "optical_scenes": s2_meta["scenes"],
    }
    write_json(WEB_DATA / "stats.json", stats)
    write_json(WEB_DATA / "sector_metrics.json", {"generated_utc": utc_now(), "sectors": sector_out})
    print(f"\n  TOTAL: gain {total['gain_ha']} ha, loss {total['loss_ha']} ha, valid {total['valid_fraction']*100:.1f}% ; "
          f"water before {total['water_before_ha']} ha -> after {total['water_after_ha']} ha")
    print(f"  same-day NISAR vs Sentinel-2 water-mask agreement (after): {total['optical']['after_mask_agreement']}")


if __name__ == "__main__":
    main()
