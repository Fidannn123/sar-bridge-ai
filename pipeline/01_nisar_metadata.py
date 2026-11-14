"""Record provenance metadata for the selected NISAR granules from NASA CMR.

CMR search is public (no login). This step also lists every GCOV acquisition
over the study area so the web app can show *why* this pair was chosen.

Output: data/context/nisar_granules.json
"""
from __future__ import annotations

import requests

from common import USER_AGENT, read_json, step, utc_now, write_json
from config import CONTEXT, NISAR_COLLECTION, NISAR_PAIR

CMR = "https://cmr.earthdata.nasa.gov/search"
COLLECTIONS = ["NISAR_L2_GCOV_V1", "NISAR_L2_GCOV_PROVISIONAL_V1"]


def umm_for(granule_id: str) -> dict:
    r = requests.get(f"{CMR}/granules.umm_json", timeout=60, headers={"User-Agent": USER_AGENT},
                     params={"short_name": NISAR_COLLECTION, "granule_ur": granule_id})
    r.raise_for_status()
    items = r.json()["items"]
    if not items:
        raise SystemExit(f"Granule not found in CMR: {granule_id}")
    return items[0]


def attrs(umm: dict) -> dict:
    return {a["Name"]: (a["Values"][0] if len(a.get("Values", [])) == 1 else a.get("Values"))
            for a in umm.get("AdditionalAttributes", [])}


def url_of(umm: dict, kind: str, suffix: str = "") -> str | None:
    for u in umm.get("RelatedUrls", []):
        if u.get("Type") == kind and u["URL"].startswith("https") and u["URL"].endswith(suffix):
            return u["URL"]
    return None


def inventory(bbox: str) -> list[dict]:
    rows = []
    for sn in COLLECTIONS:
        r = requests.get(f"{CMR}/granules.json", timeout=90, headers={"User-Agent": USER_AGENT},
                         params={"short_name": sn, "bounding_box": bbox, "page_size": 500, "sort_key": "start_date"})
        r.raise_for_status()
        for e in r.json()["feed"]["entry"]:
            parts = e["title"].split("_")
            rows.append({
                "collection": sn,
                "maturity": "validated" if sn == "NISAR_L2_GCOV_V1" else "provisional",
                "granule_id": e["title"],
                "start_time": e["time_start"][:19] + "Z",
                "track": int(parts[5]), "direction": parts[6], "frame": int(parts[7]),
                "polarization_code": parts[9], "crid": parts[13],
                "size_mb": round(float(e.get("granule_size", 0)), 0),
            })
    return rows


def main():
    step("NISAR granule metadata (NASA CMR)")
    study = read_json(CONTEXT / "study_area.json")
    w, s, e, n = study["analysis_bbox_lonlat"]
    bbox = f"{w:.4f},{s:.4f},{e:.4f},{n:.4f}"

    pair = {}
    for key, cfg in NISAR_PAIR.items():
        item = umm_for(cfg["granule_id"])
        umm, meta = item["umm"], item["meta"]
        a = attrs(umm)
        pair[key] = {
            "granule_id": cfg["granule_id"],
            "concept_id": meta["concept-id"],
            "collection": NISAR_COLLECTION,
            "data_maturity": "Provisional",
            "start_time": umm["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:19] + "Z",
            "end_time": umm["TemporalExtent"]["RangeDateTime"]["EndingDateTime"][:19] + "Z",
            "track": int(a.get("TRACK_NUMBER")), "frame": int(a.get("FRAME_NUMBER")),
            "direction": a.get("ASCENDING_DESCENDING"),
            "frequency_a_polarizations": a.get("FREQUENCY_A_POLARIZATION"),
            "frequency_a_bandwidth_mhz": a.get("FREQUENCY_A_RANGE_BANDWIDTH"),
            "orbit_type": a.get("ORBIT_TYPE"),
            "product_version": a.get("PRODUCT_VERSION"),
            "processing_center": a.get("PROCESSING_CENTER"),
            "crid": cfg["granule_id"].split("_")[13],
            "size_mb": round(float(umm.get("DataGranule", {}).get("ArchiveAndDistributionInformation", [{}])[0].get("Size", 0)), 0)
                       if umm.get("DataGranule") else None,
            "data_url": url_of(umm, "GET DATA", ".h5"),
            "browse_url": url_of(umm, "GET RELATED VISUALIZATION", "_LATLON_thumbnail.png"),
            "qa_report_url": url_of(umm, "VIEW RELATED INFORMATION", "_QA_REPORT.pdf"),
            "cmr_url": f"{CMR}/concepts/{meta['concept-id']}.html",
        }
        p = pair[key]
        print(f"  {key}: {p['start_time']} track {p['track']}{p['direction'][0]} frame {p['frame']} "
              f"pols {p['frequency_a_polarizations']} CRID {p['crid']} v{p['product_version']}")

    inv = inventory(bbox)
    print(f"  inventory: {len(inv)} GCOV granules intersect the study area")
    write_json(CONTEXT / "nisar_granules.json", {
        "retrieved_utc": utc_now(),
        "source": "NASA Common Metadata Repository (CMR); data distributed by ASF DAAC",
        "pair": pair,
        "selection_rationale": [
            "Same track, direction and frame (157 Ascending, frame 22) -> identical viewing geometry.",
            "Same acquisition mode (4005: 40 MHz + 5 MHz) and dual-pol HH/HV in both scenes.",
            "Same processing release (CRID P05023) -> no processing-version difference between dates.",
            "Track 157A frame 22 fully covers the reservoir (tracks 085A and 021D only partially cover it).",
            "Longest same-geometry baseline available in one processing release (early summer -> mid-autumn).",
            "Validated (V1) GCOV over the reservoir starts on 2026-10-23, and no validated same-track pair exists yet.",
        ],
        "inventory": inv,
    })


if __name__ == "__main__":
    main()
