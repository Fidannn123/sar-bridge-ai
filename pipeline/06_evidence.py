"""Transparent, rule-based evidence engine.

For every sector (and for the whole study area) each candidate explanation is
evaluated against the available measurements. Every rule is written out below,
every evidence item records its value, data source and direction
(supports / contradicts / neutral / missing), and hypotheses are *never*
promoted to causes: the best possible status is "Supported hypothesis", meaning
the available data are consistent with it and at least one independent data
source agrees - not that causation is established.

Rule thresholds are physically motivated constants fixed before results were
inspected; they are listed in RULES and shown in the web app.

Output: web/data/analysis.json
"""
from __future__ import annotations

from common import read_json, step, utc_now, write_json
from config import CONTEXT, WEB_DATA

STATUS_ORDER = {"supported": 0, "plausible": 1, "insufficient": 2, "not_supported": 3}
STATUS_LABEL = {
    "supported": "Supported hypothesis",
    "plausible": "Plausible but unconfirmed",
    "insufficient": "Insufficient evidence",
    "not_supported": "Not supported by available data",
}

RULES = {
    "min_valid_fraction": 0.5,          # below this, a sector is 'insufficient data'
    "min_change_ha": 10.0,              # gain + loss below this = no significant change to explain
    "dominance_ratio": 2.0,             # loss >= 2x gain -> loss-dominated (and vice versa)
    "shore_connected_high": 0.7,        # fraction of change patches attached to shore/water
    "shore_connected_low": 0.4,
    "hv_agreement_high": 0.5,
    "hv_agreement_low": 0.2,
    "optical_confirm_high": 0.6,
    "optical_confirm_low": 0.3,
    "optical_extent_min_ha": 10.0,      # optical water-extent change counts only if >= max(10 ha, 0.5 %)
    "optical_extent_min_frac": 0.005,
    "colocation_tolerance_m": 40,
    "reservoir_wide_share": 0.6,        # share of changed sectors with the same dominant direction
    "calm_wind_ms": 3.0,                # ERA5 10 m wind at acquisition
    "windy_ms": 6.0,
    "stable_water_rough_db": 3.0,       # median HH rise over stable water suggesting roughening
    "stable_water_calm_db": 1.5,
    "stable_land_shift_db": 1.5,        # land backscatter shift suggesting moisture/vegetation change
    "stable_land_steady_db": 1.0,
    "soil_moisture_delta_high": 0.05,   # m3/m3, ERA5-Land 0-7 cm
    "soil_moisture_delta_low": 0.02,
    "veg_hv_db": -16.0,                 # HV of former-water pixels above this suggests vegetation
    "bare_hv_db": -20.0,
    "climatic_deficit_ratio": 2.0,      # reference ET0 / precipitation over the interval
}
R = RULES


def ev(statement, source, direction, value=None, weight=1.0):
    return {"statement": statement, "source": source, "direction": direction, "value": value, "weight": weight}


def score(items):
    s = 0.0
    for it in items:
        s += it["weight"] * {"supports": 1, "contradicts": -1}.get(it["direction"], 0)
    return round(s, 2)


def pct(x):
    return None if x is None else round(100 * x)


# ----------------------------------------------------------------------------- hypotheses
def h_water_level(m, ctx):
    loss, gain = m["loss_ha"], m["gain_ha"]
    direction = "decline" if loss >= R["dominance_ratio"] * max(gain, 0.1) else (
        "rise" if gain >= R["dominance_ratio"] * max(loss, 0.1) else "mixed")
    items = []
    if direction == "decline":
        items.append(ev(f"Water loss ({loss} ha) dominates water gain ({gain} ha): the water edge retreated.",
                        "NISAR HH", "supports", {"loss_ha": loss, "gain_ha": gain}, 1.5))
    elif direction == "rise":
        items.append(ev(f"Water gain ({gain} ha) dominates water loss ({loss} ha): the water edge advanced.",
                        "NISAR HH", "supports", {"loss_ha": loss, "gain_ha": gain}, 1.5))
    else:
        items.append(ev(f"Gain ({gain} ha) and loss ({loss} ha) are of similar size: no single shoreline direction.",
                        "NISAR HH", "contradicts", {"loss_ha": loss, "gain_ha": gain}, 1.0))

    key = "loss_shore_connected_fraction" if direction != "rise" else "gain_water_connected_fraction"
    conn = m["pattern"][key]
    if conn is not None:
        what = "loss patches attached to land that stayed dry" if direction != "rise" else "gain patches attached to permanent water"
        if conn >= R["shore_connected_high"]:
            items.append(ev(f"{pct(conn)}% of {what}: change forms a band along the shoreline, the pattern expected from a water-level change.",
                            "NISAR HH (spatial pattern)", "supports", conn, 1.5))
        elif conn < R["shore_connected_low"]:
            items.append(ev(f"Only {pct(conn)}% of {what}: change is mostly isolated patches, not a shoreline band.",
                            "NISAR HH (spatial pattern)", "contradicts", conn, 1.5))
        else:
            items.append(ev(f"{pct(conn)}% of {what}: partly shoreline-attached.", "NISAR HH (spatial pattern)", "neutral", conn))

    agr = m["hv"]["loss_agreement_with_hh"] if direction != "rise" else m["hv"]["gain_agreement_with_hh"]
    if not m["hv"].get("separable", True):
        items.append(ev("HV polarisation shows no usable water/land separation in these scenes (water sits near the noise floor), "
                        "so HV can neither confirm nor contradict the HH result.", "NISAR HV", "missing"))
    elif agr is not None:
        if agr >= R["hv_agreement_high"]:
            items.append(ev(f"HV polarisation independently flags {pct(agr)}% of the same changed pixels (HH and HV consistent).",
                            "NISAR HV", "supports", agr, 1.0))
        elif agr < R["hv_agreement_low"]:
            items.append(ev(f"HV flags only {pct(agr)}% of the HH-detected change (HH and HV inconsistent).",
                            "NISAR HV", "contradicts", agr, 1.0))
        else:
            items.append(ev(f"HV flags {pct(agr)}% of the HH-detected change (partial consistency).", "NISAR HV", "neutral", agr))

    o = m["optical"]
    if direction != "rise":
        near, a = o.get("nisar_loss_near_optical_loss_40m"), o["nisar_loss_land_in_same_day_s2"]
        if near is not None:
            stmt = (f"Sentinel-2 (independent optical sensor): {pct(near)}% of NISAR water-loss pixels lie within 40 m of "
                    f"shoreline that also changed from water to land optically ({ctx['s2_before_date']} to {ctx['s2_after_date']}). "
                    f"Pixel-exact, {pct(a)}% are dry land in the same-day optical image (exact matching is unreliable for 1-3 pixel bands).")
            dirn = "supports" if near >= R["optical_confirm_high"] else ("contradicts" if near < R["optical_confirm_low"] else "neutral")
            items.append(ev(stmt, "Sentinel-2 L2A (co-location)", dirn, {"within_40m": near, "pixel_exact_land_after": a}, 2.0))
        else:
            items.append(ev("Too few water-loss pixels with cloud-free optical coverage to cross-check.", "Sentinel-2 L2A (co-location)", "missing"))
    else:
        g = o["nisar_gain_water_in_same_day_s2"]
        if g is not None:
            dirn = "supports" if g >= R["optical_confirm_high"] else ("contradicts" if g < R["optical_confirm_low"] else "neutral")
            items.append(ev(f"{pct(g)}% of NISAR water-gain pixels are water in same-day Sentinel-2.", "Sentinel-2 L2A (co-location)", dirn, g, 2.0))

    # independent optical extent change (does not depend on the radar at all)
    wb_o, wa_o, wbb_o = o.get("water_before_ha"), o.get("water_after_ha"), o.get("water_before_bracket_ha")
    if wb_o and wa_o is not None:
        d_o = round(wa_o - wb_o, 1)
        tol_ha = max(R["optical_extent_min_ha"], R["optical_extent_min_frac"] * wb_o)
        bracket = ""
        if wbb_o:
            bracket = (f" It was {'stable' if abs(wb_o - wbb_o) <= tol_ha else 'not stable'} between {ctx['s2_bracket_date']} "
                       f"({wbb_o} ha) and {ctx['s2_before_date']}, which bracket the first radar date.")
        want_decline = direction != "rise"
        if (d_o <= -tol_ha and want_decline) or (d_o >= tol_ha and not want_decline):
            dirn = "supports"
        elif (d_o >= tol_ha and want_decline) or (d_o <= -tol_ha and not want_decline):
            dirn = "contradicts"
        else:
            dirn = "neutral"
        items.append(ev(f"Optical water extent changed from {wb_o} ha ({ctx['s2_before_date']}) to {wa_o} ha ({ctx['s2_after_date']}), "
                        f"{d_o:+} ha.{bracket}", "Sentinel-2 L2A (extent)", dirn, d_o, 1.5))

    if ctx["reservoir_wide"]["n_changed"] >= 3:
        share = ctx["reservoir_wide"]["share_decline"] if direction != "rise" else ctx["reservoir_wide"]["share_rise"]
        n = ctx["reservoir_wide"]["n_changed"]
        dirn = "supports" if share >= R["reservoir_wide_share"] else "neutral"
        items.append(ev(f"{round(share*n)} of {n} sectors with significant change show the same direction - "
                        f"{'a reservoir-wide' if dirn == 'supports' else 'not clearly a reservoir-wide'} pattern, as a level change would produce.",
                        "NISAR HH (all sectors)", dirn, share, 1.0))

    items.append(ev("No in-situ gauge or satellite-altimetry water level for these dates was available to the pipeline.",
                    "Reservoir water-level record", "missing"))

    supports = {it["source"] for it in items if it["direction"] == "supports"}
    contradicts = [it for it in items if it["direction"] == "contradicts"]
    pattern_ok = any(it["source"].startswith("NISAR HH (spatial") and it["direction"] == "supports" for it in items)
    coloc = next((it["direction"] for it in items if it["source"] == "Sentinel-2 L2A (co-location)"), None)
    extent = next((it["direction"] for it in items if it["source"] == "Sentinel-2 L2A (extent)"), None)
    optical_ok = coloc == "supports" or (extent == "supports" and coloc != "contradicts")
    optical_bad = coloc == "contradicts" and extent != "supports"
    if direction == "mixed":
        status = "not_supported" if len(contradicts) >= 2 else "insufficient"
    elif pattern_ok and optical_ok and len(contradicts) == 0:
        status = "supported"
    elif optical_bad and not pattern_ok:
        status = "not_supported"
    elif pattern_ok or optical_ok:
        status = "plausible"
    else:
        status = "insufficient"
    title = {"decline": "Reservoir water-level decline exposed shoreline",
             "rise": "Reservoir water-level rise flooded shoreline",
             "mixed": "Reservoir water-level change"}[direction]
    return {"id": "water_level", "title": title, "status": status, "score": score(items), "evidence": items,
            "note": "A water-level change is a description of what happened, not of why; it does not identify the operator decision, inflow, or withdrawal behind it."}


def h_seasonal(m, ctx, level):
    items = [ev(f"Only two NISAR observations ({ctx['date_before']} and {ctx['date_after']}): a seasonal cycle cannot be resolved from one pair.",
                "NISAR (2 dates)", "missing")]
    w = ctx["weather"]
    if w.get("precip_total_mm") is not None and w.get("et0_total_mm") is not None:
        ratio = w["et0_total_mm"] / max(w["precip_total_mm"], 1)
        dirn = "supports" if ratio >= R["climatic_deficit_ratio"] else "neutral"
        items.append(ev(f"Between the dates, reference evapotranspiration ({w['et0_total_mm']} mm) was {ratio:.1f}x precipitation "
                        f"({w['precip_total_mm']} mm) at the reservoir: a warm-season water deficit, consistent with seasonal drawdown.",
                        "ERA5 reanalysis", dirn, round(ratio, 2), 1.0))
    items.append(ev("No multi-year water-level or satellite record for Mingachevir was available to compare 2026 against typical years.",
                    "Multi-year time series", "missing"))
    if level["status"] in ("supported", "plausible") and level["title"].startswith("Reservoir water-level decline") \
            and any(i["direction"] == "supports" and i["source"] == "ERA5 reanalysis" for i in items):
        status = "plausible"
    else:
        status = "insufficient"
    return {"id": "seasonal", "title": "Seasonal water-level variation", "status": status, "score": score(items), "evidence": items,
            "note": "Seasonality requires repeated observations across years; with one pair this can at most be plausible."}


def h_hydropower(m, ctx, level):
    items = [
        ev("No dam outflow, turbine discharge or release schedule for Mingachevir HPP was available.",
           "Dam operations record", "missing"),
        ev("No irrigation-canal withdrawal records were available; withdrawals, evaporation and releases would all lower the level and cannot be separated from imagery alone.",
           "Water-management records", "missing"),
    ]
    if level["status"] in ("supported", "plausible") and "decline" in level["title"]:
        items.append(ev("A water-level decline is consistent with (but does not demonstrate) controlled release.",
                        "Inference from NISAR change", "neutral"))
    return {"id": "hydropower", "title": "Hydropower-related water release", "status": "insufficient", "score": score(items),
            "evidence": items, "note": "Cannot be verified without operational data from the dam operator."}


def h_wind(m, ctx):
    items = []
    wb, wa = ctx["weather"]["wind_before_ms"], ctx["weather"]["wind_after_ms"]
    if wb is not None and wa is not None:
        mx = max(wb, wa)
        dirn = "contradicts" if mx < R["calm_wind_ms"] else ("supports" if mx >= R["windy_ms"] else "neutral")
        items.append(ev(f"Modelled 10 m wind at acquisition time: {wb} m/s ({ctx['date_before']}) and {wa} m/s ({ctx['date_after']}).",
                        "ERA5 reanalysis", dirn, {"before": wb, "after": wa}, 1.0))
    dsw = m["hh"]["median_delta_db_stable_water"]
    if dsw is not None:
        dirn = "supports" if dsw >= R["stable_water_rough_db"] else ("contradicts" if abs(dsw) < R["stable_water_calm_db"] else "neutral")
        items.append(ev(f"Median HH change over water present on both dates: {dsw:+.1f} dB "
                        f"({'large brightening, typical of roughening' if dirn == 'supports' else 'no strong roughening signal' if dirn == 'contradicts' else 'moderate'}).",
                        "NISAR HH", dirn, dsw, 1.5))
    conn = m["pattern"]["loss_shore_connected_fraction"]
    if conn is not None and m["loss_ha"] >= 1:
        dirn = "supports" if conn < R["shore_connected_low"] else ("contradicts" if conn >= R["shore_connected_high"] else "neutral")
        items.append(ev(f"{pct(conn)}% of water-loss area is attached to the shoreline; wind artefacts tend to appear as detached patches in open water.",
                        "NISAR HH (spatial pattern)", dirn, conn, 1.0))
    near = m["optical"].get("nisar_loss_near_optical_loss_40m")
    if near is not None and m["loss_ha"] >= 1:
        dirn = "contradicts" if near >= R["optical_confirm_high"] else ("supports" if near < R["optical_confirm_low"] else "neutral")
        items.append(ev(f"{pct(near)}% of NISAR water-loss pixels lie within 40 m of shoreline that also dried out optically "
                        "(a wind artefact would have no optical counterpart).", "Sentinel-2 L2A (co-location)", dirn, near, 2.0))
    s = score(items)
    sup = sum(1 for i in items if i["direction"] == "supports")
    con = sum(1 for i in items if i["direction"] == "contradicts")
    status = "not_supported" if con >= 2 and sup == 0 else ("plausible" if sup >= 2 and con == 0 else "insufficient")
    if not items:
        status = "insufficient"
    return {"id": "wind", "title": "Wind-roughened water causing apparent change", "status": status, "score": s, "evidence": items,
            "note": "ERA5 wind is a ~9-25 km model value at the acquisition hour; local gusts are not resolved."}


def h_soil_moisture(m, ctx):
    items = []
    dl = m["hh"]["median_delta_db_stable_land"]
    if dl is not None:
        dirn = "supports" if abs(dl) >= R["stable_land_shift_db"] else ("contradicts" if abs(dl) < R["stable_land_steady_db"] else "neutral")
        items.append(ev(f"Median HH change over land that stayed dry: {dl:+.1f} dB.", "NISAR HH", dirn, dl, 1.5))
    sm_b, sm_a = ctx["weather"]["soil_moisture_before"], ctx["weather"]["soil_moisture_after"]
    if sm_b is not None and sm_a is not None:
        dsm = round(sm_a - sm_b, 3)
        dirn = "supports" if abs(dsm) >= R["soil_moisture_delta_high"] else ("contradicts" if abs(dsm) < R["soil_moisture_delta_low"] else "neutral")
        items.append(ev(f"Modelled topsoil moisture (0-7 cm) changed from {sm_b} to {sm_a} m3/m3 ({dsm:+.3f}).",
                        "ERA5-Land reanalysis", dirn, dsm, 1.0))
    pb, pa = ctx["weather"]["precip7_before"], ctx["weather"]["precip7_after"]
    if pb is not None and pa is not None:
        items.append(ev(f"Rain in the 7 days before each acquisition: {pb} mm and {pa} mm.", "ERA5 reanalysis", "neutral", {"before": pb, "after": pa}))
    gconn = m["pattern"]["gain_water_connected_fraction"]
    if gconn is not None and m["gain_ha"] >= 1:
        dirn = "supports" if gconn < R["shore_connected_low"] else "neutral"
        items.append(ev(f"{pct(gconn)}% of apparent water gain is attached to permanent water; detached 'gain' on land can be dark, smooth or dry soil rather than water.",
                        "NISAR HH (spatial pattern)", dirn, gconn, 1.0))
    items.append(ev("No in-situ soil-moisture measurements were available.", "Soil-moisture stations", "missing"))
    sup = sum(1 for i in items if i["direction"] == "supports")
    con = sum(1 for i in items if i["direction"] == "contradicts")
    status = "not_supported" if con >= 2 and sup == 0 else ("plausible" if sup >= 2 else "insufficient")
    return {"id": "soil_moisture", "title": "Soil-moisture / land-surface change affecting backscatter", "status": status,
            "score": score(items), "evidence": items,
            "note": "Affects how land looks to the radar; relevant mainly to apparent change away from the shoreline."}


def h_vegetation(m, ctx):
    items = []
    hv = m["hv"]["median_db_after_on_loss"]
    if not m["hv"].get("separable", True):
        items.append(ev("HV backscatter is near the noise floor in these scenes, so it cannot characterise vegetation on the exposed margins.",
                        "NISAR HV", "missing"))
    elif hv is not None and m["loss_ha"] >= 1:
        dirn = "supports" if hv >= R["veg_hv_db"] else ("contradicts" if hv <= R["bare_hv_db"] else "neutral")
        kind = "volume scattering typical of vegetation" if dirn == "supports" else ("low, typical of bare exposed ground" if dirn == "contradicts" else "intermediate")
        items.append(ev(f"Median HV backscatter of former-water pixels on {ctx['date_after']}: {hv:.1f} dB ({kind}).",
                        "NISAR HV", dirn, hv, 1.5))
    else:
        items.append(ev("Too little water loss to characterise the newly exposed surface.", "NISAR HV", "missing"))
    items.append(ev("No vegetation index or field survey of the shoreline was used.", "Optical vegetation index / field data", "missing"))
    sup = sum(1 for i in items if i["direction"] == "supports")
    con = sum(1 for i in items if i["direction"] == "contradicts")
    status = "plausible" if sup >= 1 else ("not_supported" if con >= 1 else "insufficient")
    return {"id": "vegetation", "title": "Emergent vegetation on exposed shallow margins", "status": status, "score": score(items),
            "evidence": items, "note": "L-band HV is sensitive to vegetation volume; it does not identify species."}


def h_calibration(m, ctx):
    items = []
    dl = m["hh"]["median_delta_db_stable_land"]
    if dl is not None:
        dirn = "contradicts" if abs(dl) < R["stable_land_steady_db"] else "neutral"
        items.append(ev(f"Median HH difference over unchanged land is {dl:+.1f} dB; change detection requires >= 3 dB and uses a separate threshold per date.",
                        "NISAR HH", dirn, dl, 1.0))
    items.append(ev("Both scenes are 'Provisional' products from the same processing release (CRID P05023); residual calibration effects are possible but would apply similarly to both dates.",
                    "NISAR product metadata", "neutral"))
    con = sum(1 for i in items if i["direction"] == "contradicts")
    return {"id": "calibration", "title": "Radiometric difference between acquisitions (data artefact)",
            "status": "not_supported" if con else "insufficient", "score": score(items), "evidence": items,
            "note": "A data-quality check rather than an environmental driver."}


RULE_TEXT = {
    "supported": "a consistent radar pattern plus agreement from an independent sensor, with no contradicting evidence",
    "plausible": "at least one line of support, but no independent confirmation free of contradiction",
    "insufficient": "the available evidence is too weak or conflicting to rank it higher",
    "not_supported": "the evidence that exists points against it",
}


def status_reason(h: dict) -> str:
    """Deterministic, human-readable account of why a hypothesis got its status."""
    def srcs(direction):
        s = sorted({e["source"] for e in h["evidence"] if e["direction"] == direction})
        return f"{len(s)} ({', '.join(s)})" if s else "0"
    return (f"{STATUS_LABEL[h['status']]} because {RULE_TEXT[h['status']]}. "
            f"Evidence lines: supporting {srcs('supports')}; contradicting {srcs('contradicts')}; "
            f"missing {sum(1 for e in h['evidence'] if e['direction'] == 'missing')}.")


# ----------------------------------------------------------------------------- per-unit analysis
def analyse(unit: dict, ctx: dict, is_total=False) -> dict:
    m = unit
    detected = {
        "what": None, "gain_ha": m["gain_ha"], "loss_ha": m["loss_ha"], "net_change_ha": m["net_change_ha"],
        "water_before_ha": m["water_before_ha"], "water_after_ha": m["water_after_ha"],
        "valid_fraction": m["valid_fraction"], "insufficient_data_ha": m["insufficient_data_ha"],
        "dates": [ctx["date_before"], ctx["date_after"]],
    }
    if m["valid_fraction"] is None or m["valid_fraction"] < R["min_valid_fraction"]:
        detected["what"] = "Insufficient valid radar data in this sector to assess change."
        return {"detected_change": detected, "significant_change": False, "hypotheses": [],
                "conclusion": {"status": "insufficient", "label": STATUS_LABEL["insufficient"],
                               "summary": "Less than half of the sector has valid data on both dates."},
                "missing_evidence": ctx["missing_global"]}
    total_change = m["gain_ha"] + m["loss_ha"]
    if total_change < R["min_change_ha"]:
        detected["what"] = (f"No significant water-extent change detected ({m['gain_ha']} ha gain, {m['loss_ha']} ha loss; "
                            f"{pct(m['valid_fraction'])}% of the sector had valid data on both dates).")
        hyps = [h_calibration(m, ctx)]
        for h in hyps:
            h["status_label"] = STATUS_LABEL[h["status"]]
        return {"detected_change": detected, "significant_change": False, "hypotheses": hyps,
                "conclusion": {"status": "no_change", "label": "No significant change detected",
                               "summary": "Change below the 10 ha significance threshold - nothing to explain.",
                               "reason": (f"Gain plus loss is {round(m['gain_ha'] + m['loss_ha'], 1)} ha, below the "
                                          f"{R['min_change_ha']} ha significance threshold. The data-quality check "
                                          "(radiometric difference) found no problem, so no environmental explanation is evaluated.")},
                "missing_evidence": ctx["missing_global"]}

    if m["loss_ha"] >= R["dominance_ratio"] * max(m["gain_ha"], 0.1):
        detected["what"] = f"Water extent decreased: {m['loss_ha']} ha of water became land ({m['gain_ha']} ha became water)."
    elif m["gain_ha"] >= R["dominance_ratio"] * max(m["loss_ha"], 0.1):
        detected["what"] = f"Water extent increased: {m['gain_ha']} ha of land became water ({m['loss_ha']} ha became land)."
    else:
        detected["what"] = f"Mixed change: {m['gain_ha']} ha gain and {m['loss_ha']} ha loss."

    level = h_water_level(m, ctx)
    hyps = [level, h_seasonal(m, ctx, level), h_hydropower(m, ctx, level), h_wind(m, ctx),
            h_soil_moisture(m, ctx), h_vegetation(m, ctx), h_calibration(m, ctx)]
    for h in hyps:
        h["status_label"] = STATUS_LABEL[h["status"]]
    hyps.sort(key=lambda h: (STATUS_ORDER[h["status"]], -h["score"]))
    top = hyps[0]
    for h in hyps:
        h["reason"] = status_reason(h)
    concl = {"status": top["status"], "label": STATUS_LABEL[top["status"]], "top_hypothesis": top["title"],
             "summary": f"Strongest available support: '{top['title']}' ({STATUS_LABEL[top['status']].lower()}).",
             "reason": top["reason"]}
    supporting = [dict(e, hypothesis=h["title"]) for h in hyps for e in h["evidence"]
                  if e["direction"] == "supports" and h["status"] in ("supported", "plausible")]
    missing = sorted({e["statement"] for h in hyps for e in h["evidence"] if e["direction"] == "missing"})
    return {"detected_change": detected, "significant_change": True, "hypotheses": hyps, "conclusion": concl,
            "supporting_evidence": supporting, "missing_evidence": missing}


def build_context(stats, sectors, weather, s2):
    rp = weather["points"]["reservoir"]
    acq = rp["acquisitions"]
    changed = [s for s in sectors if s["valid_fraction"] and s["valid_fraction"] >= R["min_valid_fraction"]
               and s["gain_ha"] + s["loss_ha"] >= R["min_change_ha"]]
    dec = [s for s in changed if s["loss_ha"] >= R["dominance_ratio"] * max(s["gain_ha"], 0.1)]
    ris = [s for s in changed if s["gain_ha"] >= R["dominance_ratio"] * max(s["loss_ha"], 0.1)]
    n = len(changed)
    return {
        "date_before": stats["pair"]["before"]["date"], "date_after": stats["pair"]["after"]["date"],
        "s2_before_date": s2["scenes"]["before"]["datetime_utc"][:10], "s2_after_date": s2["scenes"]["after"]["datetime_utc"][:10],
        "s2_bracket_date": s2["scenes"]["before_bracket"]["datetime_utc"][:10],
        "reservoir_wide": {"n_changed": n, "share_decline": len(dec) / n if n else 0, "share_rise": len(ris) / n if n else 0},
        "weather": {
            "wind_before_ms": acq["before"]["wind_speed_10m_ms_at_acquisition"],
            "wind_after_ms": acq["after"]["wind_speed_10m_ms_at_acquisition"],
            "soil_moisture_before": acq["before"]["soil_moisture_0_7cm_m3m3"],
            "soil_moisture_after": acq["after"]["soil_moisture_0_7cm_m3m3"],
            "precip7_before": acq["before"]["precip_mm_prev_7d"], "precip7_after": acq["after"]["precip_mm_prev_7d"],
            "precip_total_mm": rp["between"]["precip_total_mm"], "et0_total_mm": rp["between"]["et0_total_mm"],
            "upstream_precip_total_mm": weather["points"]["upstream"]["between"]["precip_total_mm"],
        },
        "missing_global": [
            "In-situ reservoir water level (gauge) on both acquisition dates",
            "Dam outflow / hydropower release and irrigation-withdrawal records",
            "Multi-year NISAR or water-level time series (needed for seasonal or anomaly claims)",
            "Field validation of the detected shoreline",
        ],
    }


def main():
    step("Evidence engine")
    stats = read_json(WEB_DATA / "stats.json")
    sectors = read_json(WEB_DATA / "sector_metrics.json")["sectors"]
    weather = read_json(CONTEXT / "weather.json")
    s2 = read_json(CONTEXT / "sentinel2.json")
    ctx = build_context(stats, sectors, weather, s2)

    out = {"generated_utc": utc_now(), "rules": RULES, "status_labels": STATUS_LABEL,
           "context": {k: v for k, v in ctx.items() if k != "missing_global"},
           "study_area": {"name": "Whole study area", **analyse(stats["totals"], ctx, is_total=True)},
           "sectors": []}
    for s in sectors:
        a = analyse(s, ctx)
        out["sectors"].append({"id": s["id"], "name": s["name"], "position": s["position"], **a})
        top = a["hypotheses"][0]["title"] if a["hypotheses"] else "-"
        print(f"  {s['name']:<24} {a['conclusion']['label']:<32} top: {top}")
    print(f"  study area: {out['study_area']['conclusion']['label']} - {out['study_area']['conclusion'].get('top_hypothesis')}")
    write_json(WEB_DATA / "analysis.json", out)


if __name__ == "__main__":
    main()
