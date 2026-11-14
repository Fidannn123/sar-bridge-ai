"""Fetch real meteorological context for the two NISAR acquisition dates.

Source: Open-Meteo Historical Weather API, which serves ECMWF ERA5 / ERA5-Land
reanalysis (https://open-meteo.com/en/docs/historical-weather-api). Reanalysis
is a model-based reconstruction constrained by observations - it is labelled as
such everywhere it is shown. No API key required.

Output: data/context/weather.json
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

import requests

from common import USER_AGENT, read_json, step, utc_now, write_json
from config import CONTEXT, WEATHER_POINTS

API = "https://archive-api.open-meteo.com/v1/archive"


def acquisition_times():
    meta = read_json(CONTEXT / "nisar_granules.json")
    return {k: datetime.strptime(v["start_time"], "%Y-%m-%dT%H:%M:%SZ") for k, v in meta["pair"].items()}


def fetch_point(lat: float, lon: float, start: date, end: date) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": ",".join([
            "precipitation_sum", "temperature_2m_mean", "temperature_2m_max",
            "wind_speed_10m_max", "et0_fao_evapotranspiration",
        ]),
        "hourly": ",".join(["wind_speed_10m", "wind_direction_10m", "soil_moisture_0_to_7cm", "precipitation"]),
        "wind_speed_unit": "ms",
        "timezone": "UTC",
    }
    r = requests.get(API, params=params, timeout=120, headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    return r.json()


def _sum(values):
    vals = [v for v in values if v is not None]
    return round(sum(vals), 1) if vals else None


def _mean(values):
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), 2) if vals else None


def summarise(raw: dict, t_before: datetime, t_after: datetime) -> dict:
    d = raw["daily"]
    days = [date.fromisoformat(x) for x in d["time"]]
    h = raw["hourly"]
    hours = [datetime.fromisoformat(x) for x in h["time"]]

    def daily_between(key, a: date, b: date):
        return [v for day, v in zip(days, d[key]) if a <= day <= b]

    def hourly_at(key, t: datetime):
        target = t.replace(minute=0, second=0) + (timedelta(hours=1) if t.minute >= 30 else timedelta())
        for hh, v in zip(hours, h[key]):
            if hh == target:
                return v
        return None

    def hourly_window(key, t: datetime, hours_before: int):
        return [v for hh, v in zip(hours, h[key]) if t - timedelta(hours=hours_before) <= hh <= t]

    out = {"acquisitions": {}, "between": {}}
    for name, t in (("before", t_before), ("after", t_after)):
        dt = t.date()
        out["acquisitions"][name] = {
            "time_utc": t.strftime("%Y-%m-%dT%H:%MZ"),
            "wind_speed_10m_ms_at_acquisition": hourly_at("wind_speed_10m", t),
            "wind_direction_10m_deg_at_acquisition": hourly_at("wind_direction_10m", t),
            "max_wind_speed_10m_ms_prev_6h": max([v for v in hourly_window("wind_speed_10m", t, 6) if v is not None], default=None),
            "precip_mm_prev_24h": _sum(hourly_window("precipitation", t, 24)),
            "precip_mm_prev_7d": _sum(daily_between("precipitation_sum", dt - timedelta(days=7), dt - timedelta(days=1))),
            "soil_moisture_0_7cm_m3m3": hourly_at("soil_moisture_0_to_7cm", t),
            "temperature_2m_mean_c_day": (daily_between("temperature_2m_mean", dt, dt) or [None])[0],
        }
    a, b = t_before.date(), t_after.date()
    out["between"] = {
        "days": (b - a).days,
        "precip_total_mm": _sum(daily_between("precipitation_sum", a, b)),
        "et0_total_mm": _sum(daily_between("et0_fao_evapotranspiration", a, b)),
        "temperature_2m_mean_c": _mean(daily_between("temperature_2m_mean", a, b)),
        "temperature_2m_max_c": max([v for v in daily_between("temperature_2m_max", a, b) if v is not None], default=None),
        "monthly_precip_mm": {},
    }
    for day, v in zip(days, d["precipitation_sum"]):
        if a <= day <= b and v is not None:
            key = day.strftime("%Y-%m")
            out["between"]["monthly_precip_mm"][key] = round(out["between"]["monthly_precip_mm"].get(key, 0) + v, 1)
    # compact daily series for the UI sparkline
    out["daily_series"] = {
        "dates": [x.isoformat() for x in days],
        "precipitation_sum_mm": d["precipitation_sum"],
        "temperature_2m_mean_c": d["temperature_2m_mean"],
    }
    return out


def main():
    step("Weather context (ERA5 / ERA5-Land via Open-Meteo)")
    times = acquisition_times()
    t0, t1 = times["before"], times["after"]
    start, end = (t0 - timedelta(days=30)).date(), t1.date()
    result = {
        "source": "ECMWF ERA5 / ERA5-Land reanalysis via Open-Meteo Historical Weather API",
        "source_url": "https://open-meteo.com/en/docs/historical-weather-api",
        "nature": "Model reanalysis (not in-situ station measurements); grid ~9-25 km",
        "retrieved_utc": utc_now(),
        "points": {},
    }
    for key, pt in WEATHER_POINTS.items():
        print(f"  {pt['label']} ...")
        raw = fetch_point(pt["lat"], pt["lon"], start, end)
        summary = summarise(raw, t0, t1)
        result["points"][key] = {**pt, "grid_elevation_m": raw.get("elevation"), **summary}
        acq = summary["acquisitions"]
        print(f"    wind at acquisition: before={acq['before']['wind_speed_10m_ms_at_acquisition']} m/s, "
              f"after={acq['after']['wind_speed_10m_ms_at_acquisition']} m/s; "
              f"precip between dates={summary['between']['precip_total_mm']} mm")
    write_json(CONTEXT / "weather.json", result)


if __name__ == "__main__":
    main()
