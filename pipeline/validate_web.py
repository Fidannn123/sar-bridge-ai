"""Validate the generated package consumed by the static workspace.

Run after processing, or independently: python pipeline/validate_web.py.
No network, credentials or model calls are needed.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate(web: Path = WEB) -> None:
    def read(name):
        return json.loads((web / "data" / name).read_text(encoding="utf-8"))

    stats = read("stats.json")
    analysis = read("analysis.json")
    sectors = read("sectors.geojson")
    layers = read("layers.json")
    meta = read("meta.json")
    ids = [unit["id"] for unit in analysis["sectors"]]
    require(len(ids) == len(set(ids)) == stats['n_sectors'], 'Duplicate or missing analysis sectors')
    features = {f["properties"]["id"]: f for f in sectors["features"]}
    require(len(features) == len(sectors["features"]), "Duplicate map sectors")
    require(set(features) == set(ids), 'Map and evidence sectors differ')
    dates = [stats["pair"][side]["date"] for side in ("before", "after")]
    for side, date in zip(("before", "after"), dates):
        require(meta['nisar']['pair'][side]['start_time'][:10] == date, 'Provenance date mismatch')
        require(layers[f'nisar_{side}_HH']['date'] == date, 'Radar imagery date mismatch')
    for key in ("gain_ha", "loss_ha"):
        require(abs(stats['totals'][key] - analysis['study_area']['detected_change'][key]) < 0.11, 'Overview and evidence totals differ')
        total = sum(s["detected_change"][key] for s in analysis["sectors"])
        require(abs(total - stats['totals'][key]) <= len(ids) * 0.11, 'Sector totals differ from overview')
    allowed = set(analysis["status_labels"]) | {"no_change"}
    for unit in [analysis["study_area"], *analysis["sectors"]]:
        dc = unit["detected_change"]
        require(dc['dates'] == dates, 'Evidence observation pair mismatch')
        require(unit['conclusion']['status'] in allowed, 'Unknown conclusion status')
        require(0 <= dc['valid_fraction'] <= 1, 'Invalid coverage fraction')
        require(min(dc['gain_ha'], dc['loss_ha']) >= 0, 'Negative gain or loss')
        if "id" in unit:
            props = features[unit["id"]]["properties"]
            for key in ("gain_ha", "loss_ha", "valid_fraction"):
                require(abs(props[key] - dc[key]) < 0.001, f"Map tooltip differs from report: {unit['id']}/{key}")
    for key, layer in layers.items():
        path = (web / layer["url"]).resolve()
        require(path.is_relative_to(web.resolve()) and path.is_file(), f'Missing or invalid image: {key}')
        require(len(layer['bounds']) == 2 and all((len(p) == 2 for p in layer['bounds'])), f'Invalid bounds: {key}')
    print(f"Web package valid: {len(ids)} sectors, {len(layers)} image layers, {dates[0]} -> {dates[1]}")


if __name__ == "__main__":
    validate()
