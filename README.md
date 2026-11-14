# SAR-BRIDGE AI

**AI-assisted interpretation of NASA–ISRO NISAR radar change detection at Mingachevir Reservoir, Azerbaijan.**

SAR-BRIDGE AI compares two real NISAR L-band radar observations of the Mingachevir Reservoir, maps where water appeared or disappeared, and then investigates *why*. A transparent, rule-based evidence engine weighs several candidate explanations (water-level change, seasonal drawdown, hydropower release, wind, soil moisture, vegetation, calibration artefacts) against the radar data, an independent Sentinel-2 optical check and ERA5 weather reanalysis. An LLM then turns the structured result into plain language.

> Research prototype for NASA Space Apps. Pairwise change detection only. It is **not** a dam-safety, hazard-warning or disaster-prediction system.

## What the app shows

| Panel | Content |
|---|---|
| Map | NISAR HH / HV backscatter for both dates with a draggable before/after slider labelled with the acquisition dates (Sentinel-2 true colour as an optional alternative), detected water gain/loss, insufficient-data areas, 10 clickable sectors, and a γ⁰ backscatter scale in the legend |
| Sector chart | Water gained (up) and lost (down) in each sector, from the NW inflow end to the SE dam; click a column to open that sector |
| Change statistics | Total water gain and loss (ha), sectors analysed, valid-data coverage, same-day NISAR vs Sentinel-2 agreement |
| AI analysis card | For the whole area or a selected sector: (1) detected change, (2) AI interpretation and ranked hypotheses, (3) supporting evidence, (4) missing evidence, (5) conclusion: *Supported hypothesis*, *Plausible but unconfirmed* or *Insufficient evidence* |
| Methodology & data | Granule IDs, acquisition times, polarisations, the full NISAR acquisition inventory, processing steps, thresholds, evidence rules, sources, limitations |

## Results: 25 June → 11 October 2026

| | |
|---|---|
| Radar-detected water loss / gain | **495 ha / 0 ha** (100 % valid data), concentrated at the shallow NW inflow end (sectors 1–2: 146 and 280 ha) |
| Independent optical check (Sentinel-2) | Water extent stable 13 Jun → 3 Jul (54,184 → 54,247 ha), then **−864 ha** by 11 Oct; radar vs same-day optical water mask agree on 86.5 % of pixels |
| Radar contrast | Water −14.7 dB vs land −8.8 dB (HH); HV −16.9 vs −15.0 dB, so HV carries almost no water signal (near the noise floor) and is marked *not separable* |
| Evidence engine | Water-level decline: **Supported** in sector 3, **Plausible but unconfirmed** in sector 1, **Insufficient evidence** in sectors 2 and 4 and overall (radar and optical agree that water receded but disagree on exactly where); no significant change in sectors 5–10. Hydropower release and seasonality stay unverifiable without operational and multi-year data. |

The radar captures the wide mudflats exposed in the shallow NW, but misses much of the thin (1–3 pixel) shoreline retreat along the steep central shores that Sentinel-2 sees. That gap is reported, not hidden.

## Data

| Dataset | Use | Access |
|---|---|---|
| **NISAR L2 GCOV** (`NISAR_L2_GCOV_PROVISIONAL_V1`), track 157 ascending, frame 22, 2026-06-25 and 2026-10-11, Frequency A (40 MHz) HH + HV | Water masks and change detection | ASF DAAC; free [NASA Earthdata login](https://urs.earthdata.nasa.gov/users/new) |
| Copernicus Sentinel-2 L2A (2026-06-13, 2026-07-03, 2026-10-11) | Independent optical water check (same-day scene for the "after" date) | Element 84 Earth Search, public |
| ERA5 / ERA5-Land reanalysis | Wind at acquisition time, precipitation, evapotranspiration, soil moisture | Open-Meteo, public |
| OpenStreetMap | Reservoir reference outline (analysis zone) and dam location | Overpass API, public |

**Why this pair:** same track, frame, mode and dual-pol configuration, processed with the same release (CRID P05023), giving identical viewing geometry. Only tracks 157A and 093D fully cover the reservoir. Validated (V1) GCOV over the area begins 2026-10-23 and has no same-track pair yet, so both scenes are *Provisional*.

**No full downloads:** each GCOV granule is about 7 GB. The pipeline opens the HDF5 file over authenticated HTTPS and reads only the reservoir window via HTTP range requests, roughly 100–300 MB of traffic per scene. Only small derived rasters are stored.

## Method (summary)

1. Stream HHHH / HVHV (gamma0, RTC) and the product mask, resampled to a common 20 m UTM 38N grid.
2. Apply a 5×5 speckle filter, then build per-date water masks with Otsu thresholds clamped to physically plausible L-band ranges.
3. Mark *water gain/loss* only where the land/water state flips **and** HH changes by at least 3 dB, discarding patches under 1 ha. Pixels without valid data on either date are reported as *insufficient data*, never as *no change*.
4. Split the zone into 10 sectors along the reservoir's NW–SE axis and compute per-sector areas, coverage, HH/HV agreement, shoreline connectivity of changes, backscatter shifts and Sentinel-2 agreement.
5. Evaluate seven hypotheses per sector with explicit rules (`pipeline/06_evidence.py`). Every evidence item records its value, source and direction.
6. An LLM (OpenAI, model set by `OPENAI_MODEL`) rewrites the structured evidence as prose. Automatic guardrails check that **every number traces to a measurement**, that the exact status label and the engine's stated reason are used, that no causal or dam-safety claims appear, and that loss and gain are not swapped. A draft that fails twice is **rejected**, and a labelled template is shown instead.

Rule-path tests for the evidence engine: `python pipeline/test_evidence.py`.

## Run it

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt        # Windows (use .venv/bin/pip on macOS/Linux)
cp .env.example .env                                 # add Earthdata login + OpenAI key
.venv/Scripts/python pipeline/run_all.py             # ~5-15 min, mostly network
.venv/Scripts/python -m http.server -d web 8000      # open http://localhost:8000
```

Without `OPENAI_API_KEY`, the pipeline still runs, and the explanation is a clearly labelled template generated directly from the evidence engine.

```
pipeline/   00 study area · 01 NISAR metadata (CMR) · 02 NISAR subset streaming · 03 weather
            04 Sentinel-2 · 05 change detection · 06 evidence engine · 07 LLM explanations · 08 export
web/        static site (Leaflet), deployed by .github/workflows/pages.yml; data/ is generated
data/context/  small provenance + supplemental datasets (committed); data/interim/ rasters (ignored)
```

## Limitations

- Two dates only: no seasonality, trend, anomaly or forecasting claims.
- Both NISAR scenes are *Provisional*, so residual calibration effects are possible.
- Low-backscatter water detection can confuse wind-roughened water with land, and smooth dry soil or radar shadow with water. The evidence engine tests both cases explicitly.
- In these Provisional scenes, open water is only about 4 dB darker than land in HH, and HV shows almost no water/land contrast: water appears to sit near the noise floor. HV is therefore marked "not separable" by an objective rule and treated as *missing* evidence rather than as a contradiction. Part of a real shoreline change on smooth mudflats may go undetected; the Sentinel-2 comparison quantifies this.
- No in-situ water level, dam outflow or irrigation data were available, so operational explanations (e.g. hydropower release) remain unverified by design.
- ERA5 is a ~9–25 km reanalysis model, not station data.

## Credits

NISAR data: NASA/JPL–ISRO, distributed by ASF DAAC. Sentinel-2: ESA Copernicus. ERA5: ECMWF / Copernicus Climate Change Service via Open-Meteo. Reservoir outline © OpenStreetMap contributors (ODbL). Basemap © Esri.
