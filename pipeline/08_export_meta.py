"""Bundle provenance, methodology and limitations for the web app.

Output: web/data/meta.json
"""
from __future__ import annotations

from common import read_json, step, utc_now, write_json
from config import CONTEXT, WEB_DATA

LIMITATIONS = [
    "Pairwise comparison of two dates only: no seasonal-anomaly detection, trend estimation or forecasting is possible or claimed.",
    "Both NISAR scenes are 'Provisional' data-maturity products (validated GCOV over this area only begins on 2026-10-23); residual calibration artefacts are possible.",
    "Water is identified by low radar backscatter. Wind-roughened water can look like land; smooth dry soil, radar shadow and some paved surfaces can look like water.",
    "Pixels without valid data on either date are reported as 'insufficient data', never as 'no change'.",
    "20 m analysis grid with speckle filtering: shoreline position uncertainty is on the order of one to two pixels (20-40 m), more on gently sloping mudflats.",
    "Sentinel-2 scenes used for cross-checking are not simultaneous with the 'before' NISAR scene (8 days later; a second scene 12 days earlier brackets it).",
    "Weather and soil moisture come from ERA5 / ERA5-Land reanalysis (model, ~9-25 km grid), not from stations at the reservoir.",
    "No in-situ water level, dam outflow or irrigation-withdrawal data were available, so operational explanations (e.g. hydropower release) cannot be verified.",
    "The evidence engine evaluates hypotheses; it does not establish causation. The LLM only rephrases the engine's structured output, and every number it writes is checked against the measurements.",
    "This is a research prototype, not a dam-safety, hazard-warning or disaster-prediction system.",
]

METHOD_STEPS = [
    "Selected two NISAR L2 GCOV granules with identical geometry (track 157 Ascending, frame 22, mode 40+5 MHz, dual-pol HH/HV, same processing release P05023).",
    "Streamed only the reservoir window of the HHHH and HVHV covariance layers (gamma0, radiometrically terrain-corrected) and the product mask over HTTPS - no full download.",
    "Resampled both dates to a common 20 m UTM 38N grid (block averaging in linear power); excluded pixels flagged by the product mask.",
    "Applied a 5x5 boxcar speckle filter in linear power, converted to dB.",
    "Built water masks per date and polarisation with an Otsu threshold computed inside the analysis zone (OSM reservoir outline + 2.5 km), clamped to a physically plausible L-band range; removed specks < 1 ha.",
    "Classified water gain / loss only where the land-water state flipped AND HH backscatter changed by at least 3 dB; removed change patches < 1 ha.",
    "Divided the zone into 10 sectors along the reservoir's principal NW-SE axis and computed per-sector areas, coverage, HH/HV consistency, spatial pattern and backscatter diagnostics.",
    "Cross-checked water extent and change against Sentinel-2 L2A (NDWI > 0, cloud-masked) including a same-day scene for the 'after' date.",
    "Evaluated seven candidate explanations per sector with transparent rules; an LLM (OpenAI) rephrased the structured result, with automatic number verification.",
]


def main():
    step("Export metadata for the web app")
    gran = read_json(CONTEXT / "nisar_granules.json")
    read_log = read_json(CONTEXT / "nisar_read_log.json") if (CONTEXT / "nisar_read_log.json").exists() else {}
    weather = read_json(CONTEXT / "weather.json")
    s2 = read_json(CONTEXT / "sentinel2.json")
    study = read_json(CONTEXT / "study_area.json")

    inv = sorted(gran["inventory"], key=lambda r: r["start_time"])
    sizes = {r["granule_id"]: r.get("size_mb") for r in inv}
    for g in gran["pair"].values():
        if not g.get("size_mb"):
            g["size_mb"] = sizes.get(g["granule_id"])
    limitations = list(LIMITATIONS)
    stats_path = WEB_DATA / "stats.json"
    if stats_path.exists():
        t = read_json(stats_path)["totals"]
        hh_w, hv_w = t["hh"].get("median_db_water_before"), t["hv"].get("median_db_water_before")
        hh_l = t["hh"].get("median_db_land_before")
        if hh_w is not None and hv_w is not None:
            limitations.insert(2, (
                f"Measured contrast is modest: over unchanged water the median backscatter was {hh_w} dB (HH) and "
                f"{hv_w} dB (HV), versus {hh_l} dB (HH) over unchanged land, on 2026-06-25. Water this bright, with HH close to HV, "
                "suggests the water signal sits near the noise floor of these Provisional products. Smooth ground and wet exposed mud "
                "can therefore be hard to separate from water, and part of a real shoreline change may go undetected."))
    meta = {
        "generated_utc": utc_now(),
        "nisar": {
            "pair": gran["pair"],
            "selection_rationale": gran["selection_rationale"],
            "inventory_count": len(inv),
            "inventory": [{k: r[k] for k in ("start_time", "track", "direction", "frame", "maturity", "polarization_code", "crid")} for r in inv],
            "read_log": {k: {kk: v.get(kk) for kk in ("native_spacing_m", "native_epsg", "subset_rows_cols", "mask_decoding",
                                                      "number_of_looks_median_in_subset", "valid_fraction_of_grid", "identification", "seconds")}
                         for k, v in read_log.get("granules", {}).items()},
        },
        "study_area": {k: study[k] for k in ("source", "reservoir_name", "reservoir_name_en", "reservoir_osm_id",
                                             "reservoir_osm_area_km2", "buffer_m", "analysis_crs", "dam")},
        "weather": {"source": weather["source"], "source_url": weather["source_url"], "nature": weather["nature"],
                    "points": {k: {kk: v[kk] for kk in ("label", "lat", "lon", "acquisitions", "between", "daily_series")}
                               for k, v in weather["points"].items()}},
        "sentinel2": s2,
        "method_steps": METHOD_STEPS,
        "limitations": limitations,
        "sources": [
            {"name": "NASA-ISRO NISAR L2 GCOV (Provisional)", "provider": "NASA JPL / ISRO, distributed by ASF DAAC",
             "url": "https://search.asf.alaska.edu/", "license": "NASA open data policy"},
            {"name": "Copernicus Sentinel-2 L2A", "provider": "ESA, via Element 84 Earth Search (AWS Open Data)",
             "url": "https://earth-search.aws.element84.com/v1", "license": "Copernicus open licence"},
            {"name": "ERA5 / ERA5-Land reanalysis", "provider": "ECMWF Copernicus Climate Change Service, via Open-Meteo",
             "url": "https://open-meteo.com/en/docs/historical-weather-api", "license": "CC BY 4.0"},
            {"name": "Reservoir outline & dam location", "provider": "OpenStreetMap contributors",
             "url": "https://www.openstreetmap.org/relation/373981", "license": "ODbL"},
            {"name": "Granule search & metadata", "provider": "NASA Common Metadata Repository (CMR)",
             "url": "https://cmr.earthdata.nasa.gov/search", "license": "public"},
        ],
    }
    write_json(WEB_DATA / "meta.json", meta)


if __name__ == "__main__":
    main()
