"""Rule-path tests for the evidence engine using synthetic fixtures.

These fixtures are NOT data and are never shown in the app; they only check that
each rule produces the intended verdict. Run: python pipeline/test_evidence.py
"""
import copy
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
ev = importlib.import_module("06_evidence")

BASE = {
    "valid_fraction": 0.95, "insufficient_data_ha": 10.0, "water_before_ha": 5000.0, "water_after_ha": 4600.0,
    "gain_ha": 5.0, "loss_ha": 405.0, "net_change_ha": -400.0, "stable_water_ha": 4595.0, "stable_land_ha": 3000.0,
    "ambiguous_flip_ha": 3.0,
    "hh": {"median_delta_db_stable_land": 0.3, "median_delta_db_stable_water": 0.4, "median_delta_db_loss": 9.0,
           "median_delta_db_gain": None, "median_db_water_before": -23.0, "median_db_water_after": -22.6,
           "median_db_after_on_loss": -12.0},
    "hv": {"available": True, "gain_ha": 2.0, "loss_ha": 330.0, "median_delta_db_loss": 8.0,
           "median_delta_db_stable_land": 0.2, "median_db_after_on_loss": -21.5,
           "loss_agreement_with_hh": 0.78, "gain_agreement_with_hh": None},
    "pattern": {"loss_shore_connected_fraction": 0.91, "gain_water_connected_fraction": None},
    "optical": {"valid_fraction": 0.99, "water_before_ha": 5100.0, "water_after_ha": 4700.0, "water_before_bracket_ha": 5120.0,
                "gain_ha": 4.0, "loss_ha": 390.0, "nisar_loss_land_in_same_day_s2": 0.82,
                "nisar_loss_water_in_s2_before": 0.88, "nisar_gain_water_in_same_day_s2": None,
                "nisar_loss_near_optical_loss_40m": 0.85, "optical_loss_near_nisar_loss_40m": 0.6,
                "after_mask_agreement": 0.96, "before_mask_agreement": 0.95},
}
CTX = {
    "date_before": "2026-06-25", "date_after": "2026-10-11", "s2_before_date": "2026-07-03", "s2_after_date": "2026-10-11", "s2_bracket_date": "2026-06-13",
    "reservoir_wide": {"n_changed": 8, "share_decline": 0.875, "share_rise": 0.0},
    "weather": {"wind_before_ms": 2.9, "wind_after_ms": 0.1, "soil_moisture_before": 0.20, "soil_moisture_after": 0.21,
                "precip7_before": 3.0, "precip7_after": 1.0, "precip_total_mm": 170.0, "et0_total_mm": 520.0,
                "upstream_precip_total_mm": 640.0},
    "missing_global": ["x"],
}


def by_id(res, hid):
    return next(h for h in res["hypotheses"] if h["id"] == hid)


def test_drawdown():
    r = ev.analyse(copy.deepcopy(BASE), CTX)
    assert r["significant_change"]
    assert r["hypotheses"][0]["id"] == "water_level", r["hypotheses"][0]["id"]
    assert by_id(r, "water_level")["status"] == "supported"
    assert by_id(r, "wind")["status"] == "not_supported"
    assert by_id(r, "hydropower")["status"] == "insufficient"          # never verifiable without operator data
    assert by_id(r, "seasonal")["status"] in ("plausible", "insufficient")
    assert by_id(r, "seasonal")["status"] != "supported"               # one pair can never support seasonality
    assert by_id(r, "vegetation")["status"] == "not_supported"         # HV -21.5 dB = bare ground


def test_wind_like_artifact():
    m = copy.deepcopy(BASE)
    m["pattern"]["loss_shore_connected_fraction"] = 0.15               # detached patches in open water
    m["hh"]["median_delta_db_stable_water"] = 4.2                      # water brightened strongly
    m["optical"]["nisar_loss_land_in_same_day_s2"] = 0.1               # still water optically
    m["optical"]["nisar_loss_near_optical_loss_40m"] = 0.05            # no optical shoreline change nearby
    m["optical"]["water_after_ha"] = m["optical"]["water_before_ha"]     # optical extent unchanged
    m["optical"]["nisar_loss_water_in_s2_before"] = 0.9
    ctx = copy.deepcopy(CTX)
    ctx["weather"]["wind_after_ms"] = 8.5
    r = ev.analyse(m, ctx)
    assert by_id(r, "wind")["status"] == "plausible", by_id(r, "wind")
    assert by_id(r, "water_level")["status"] in ("not_supported", "insufficient"), by_id(r, "water_level")["status"]


def test_no_change():
    m = copy.deepcopy(BASE)
    m.update(gain_ha=2.0, loss_ha=3.0, net_change_ha=-1.0)
    r = ev.analyse(m, CTX)
    assert not r["significant_change"] and r["conclusion"]["status"] == "no_change"


def test_insufficient_coverage():
    m = copy.deepcopy(BASE)
    m["valid_fraction"] = 0.3
    r = ev.analyse(m, CTX)
    assert r["conclusion"]["status"] == "insufficient" and not r["hypotheses"]


def test_no_optical_means_not_supported_max_plausible():
    m = copy.deepcopy(BASE)
    m["optical"]["nisar_loss_land_in_same_day_s2"] = None
    m["optical"]["nisar_loss_water_in_s2_before"] = None
    m["optical"]["nisar_loss_near_optical_loss_40m"] = None
    m["optical"]["water_before_ha"] = None
    r = ev.analyse(m, CTX)
    assert by_id(r, "water_level")["status"] == "plausible"           # no independent confirmation -> not 'supported'


def test_hv_not_separable_is_missing_not_contradicting():
    m = copy.deepcopy(BASE)
    m["hv"]["separable"] = False
    m["hv"]["loss_agreement_with_hh"] = 0.01                         # meaningless when HV has no contrast
    r = ev.analyse(m, CTX)
    wl = by_id(r, "water_level")
    hv_items = [e for e in wl["evidence"] if e["source"] == "NISAR HV"]
    assert hv_items and all(e["direction"] == "missing" for e in hv_items)
    assert wl["status"] == "supported"
    assert by_id(r, "vegetation")["status"] == "insufficient"


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  pass  {t.__name__}")
    print(f"{len(tests)} evidence-engine rule tests passed")
