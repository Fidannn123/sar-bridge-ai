# SAR-BRIDGE AI

**A satellite water atlas with AI-assisted interpretation of NASA–ISRO NISAR radar change detection. First complete case study: Mingachevir Reservoir, Azerbaijan.**

The entry page introduces the broader water-observation workflow. **Water atlas** opens nine lakes and reservoirs across the Caucasus and the world, with name/country search, region filters and custom-coordinate exploration. Mingachevir has the original **NISAR radar investigation**. The other eight destinations have independent, dated **Sentinel-2 optical water-change investigations**, each with its own imagery, measurements, ten sectors, acquisition provenance, report export and local review form. The Esri basemap remains geographic context; actual study images use the dated Copernicus observations listed in each report. Locations never inherit Mingachevir measurements or evaluation scores. Atlas and analysis selections can be shared through the URL.

SAR-BRIDGE AI compares two real NISAR L-band radar observations of the Mingachevir Reservoir, maps where water appeared or disappeared, and then investigates *why*. A transparent, rule-based evidence engine weighs several candidate explanations (water-level change, seasonal drawdown, hydropower release, wind, soil moisture, vegetation, calibration artefacts) against the radar data, an independent Sentinel-2 optical check and ERA5 weather reanalysis. An LLM then turns the structured result into plain language.

> Research prototype for NASA Space Apps. Pairwise change detection only. It is **not** a dam-safety, hazard-warning or disaster-prediction system.

## What the app shows

| Panel | Content |
|---|---|
| Overview & water atlas | Nine active destinations: one radar and eight optical investigations; dated before/after imagery, water gain/loss, ten selectable sectors, source-linked explanations, report export and local human reviews; search, region filters and custom-coordinate context |
| Map | NISAR HH / HV backscatter for both dates with a draggable before/after slider labelled with the acquisition dates (Sentinel-2 true colour as an optional alternative), detected water gain/loss, insufficient-data areas, 10 clickable sectors, and a γ⁰ backscatter scale in the legend |
| Sector chart | Water gained (up) and lost (down) in each sector, from the NW inflow end to the SE dam; click a column to open that sector |
| Change statistics | Total water gain and loss (ha), sectors analysed, valid-data coverage, same-day NISAR vs Sentinel-2 agreement |
| AI analysis card | For the whole area or a selected sector: (1) detected change, (2) AI interpretation and ranked hypotheses, (3) supporting evidence, (4) missing evidence, (5) conclusion: *Supported hypothesis*, *Plausible but unconfirmed* or *Insufficient evidence* |
| Methodology & data | Granule IDs, acquisition times, polarisations, the full NISAR acquisition inventory, processing steps, thresholds, evidence rules, sources, limitations |
| Review & validation | Separate engine and human statuses; a local, version-linked review history with rationale, evidence reference and next action; import/export; pixel-exact Sentinel-2 proxy confusion counts and class-specific metrics |
| Dashboard | Reservoir overview, loss-sorted sector comparison with a significant-change filter, independent optical metrics, separate engine counts and current-package local review coverage; direct map/review actions |

## Results: 25 June → 11 October 2026

The team supplied a project evaluation summary of **F1 0.88, precision 92%, recall 86%**. These values live in `web/data/evaluation.json` and appear in the Dashboard's **Team-reported results** card and whole-reservoir report. The evaluation dataset, exact scope, averaging method and supporting counts were not supplied. The values are retained as reported, independently of the archived pixel-exact radar/optical comparison below; no per-sector results or confusion counts are inferred from them. In particular, F1 is not recomputed from the two reported percentages because their aggregation method is unspecified.

| | |
|---|---|
| Radar-detected water loss / gain | **495 ha / 0 ha** (100 % valid data), concentrated at the shallow NW inflow end (sectors 1–2: 146 and 280 ha) |
| Independent optical check (Sentinel-2) | Water extent stable 13 Jun → 3 Jul (54,184 → 54,247 ha), then **−864 ha** by 11 Oct; radar vs same-day optical water mask agree on 86.5 % of pixels |
| Radar contrast | Water −14.7 dB vs land −8.8 dB (HH); HV −16.9 vs −15.0 dB, so HV carries almost no water signal (near the noise floor) and is marked *not separable* |
| Evidence engine | Water-level decline: **Supported** in sector 3, **Plausible but unconfirmed** in sector 1, **Insufficient evidence** in sectors 2 and 4 and overall (radar and optical agree that water receded but disagree on exactly where); no significant change in sectors 5–10. Hydropower release and seasonality stay unverifiable without operational and multi-year data. |

The radar highlights wide transitions in the shallow NW, while optical change also includes thin shoreline bands. Differences in dates, classification, filtering and registration can affect overlap; the physical cause of each disagreement remains to be checked.

**Independent change comparison:** on 2,091,430 common-valid 20 m pixels, loss precision is **0.194**, recall **0.105**, F1 **0.136** and IoU **0.073** against the Sentinel-2 proxy. In Sector 03, loss F1 is **0.210**. These low overlaps require investigation; the 86.5% after-date water-mask agreement is **not change accuracy**. Gain precision is undefined because radar predicts no gain; gain F1 is zero because the optical proxy contains gain. No field-labelled ground truth has been used. The exact counts, dates, formulas and exclusions appear in the Validation tab and `web/data/validation.json`.

## Data

### Eight additional water investigations

Shamkir, Araz, Sevan, Enguri, Mead, Powell, Nasser and Atatürk have checked-in Sentinel-2 L2A analyses under `web/data/water-studies/`. Open a place and choose **Open optical investigation**, or use `/?view=atlas&reservoir=mead&analysis=1`. Sector deep links append `&water-sector=6`. Each result is independent of the Mingachevir radar package and the team-reported project evaluation.

`pipeline/10_water_studies.py` retrieves the actual water outline from OpenStreetMap through Nominatim, selects June/October 2026 scenes from Element 84 Earth Search using **cloud-free coverage inside the water body's analysis zone**, and mosaics scenes within a maximum seven-day acquisition window. The scene IDs, exact timestamps, reflectance-offset handling and source links are retained. Measurements use NDWI > 0, Sen2Cor cloud/shadow/snow exclusions and a 1 ha minimum water patch. Both-date validity is required for every reported change. The domain is the mapped water outline plus 750 m; grid size adapts from 20 m upwards for larger water bodies and is stated on screen. These are optical water-surface-area comparisons, not NISAR detections, water-volume estimates, causation assessments or independently validated performance scores.

The static app serves the derived imagery and measurements without API keys or live processing. The comparison slider, change/sector toggles, map labels, ten-sector chart and selector stay synchronized. Reports include the selected area, measurements, method, original scenes and limitations. Reviews are local and tied to the study, sector and package ID; they do not authenticate identities. Arbitrary custom coordinates remain geographic context until a study is processed for them.

Reproduce the optical packages separately from the original radar pipeline:

```powershell
python -m pip install numpy rasterio pyproj shapely scipy pillow requests
python pipeline/10_water_studies.py --year 2026 --workers 2
python pipeline/test_water_studies.py
node --test scripts/test-water-studies.mjs
node scripts/validate-static.mjs
```

Raw search responses, water outlines and coarse cloud-coverage caches remain in ignored `data/interim/water-studies/`. Only derived WebP images and source-linked JSON manifests are published. The deploy gate rejects missing investigations, mixed package IDs, invalid water-area totals, mismatched sectors and imagery that fails its SHA-256 hash check.

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

The independent change comparison reuses the saved radar thresholds and exact change rules, then compares loss and gain against Sentinel-2 on the common-valid grid without spatial dilation. Reproduce it offline with `.venv/Scripts/python pipeline/09_validation.py`; rasters from the existing pipeline are required. SHA-256 source hashes bind the comparison to its measurements and evidence exports. The stable package ID binds human review records to this analysis version.

## Run it

The checked-in observation package is ready to explore without credentials or a new pipeline run:

```powershell
.venv/Scripts/python -m http.server --bind 127.0.0.1 --directory web 8000
```

Open **http://127.0.0.1:8000** for the new overview. **Explore water atlas** opens the geographic explorer; **See the radar case study** opens the Mingachevir introduction. Direct links: `/?view=atlas&reservoir=mead` for a satellite preview, `/?view=demo` for the guided introduction. **Explore the change** starts the presenter-paced investigation: **Observe → Compare → Explain**. The radar divider briefly demonstrates the comparison, the next step reveals the detected change, and the final step focuses on Sector 03 and its source-linked evidence chain. Arrow keys move between steps when an interactive control is not focused. **Present** toggles fullscreen where supported; reduced-motion preferences disable the automatic divider reveal and animated map travel.

**Workspace** skips the guide. It is also available directly at **http://127.0.0.1:8000/?view=workspace**; sector deep links continue to open the full workspace. Select **NISAR HH** to compare the radar observations themselves. The date strip always follows the visible sensor. The coloured change overlay, overview measurements and sector reports always come from the NISAR observation pair. Opening a sector manually during the guide switches to the full workspace so its controls and report match the map selection.

Select a sector through the map labels, chart or analysis-area selector. The map selection, chart highlight, evidence verdict and shareable `#sector-3` URL stay in sync. **Export report** downloads the selected area's Markdown report with measured values, ranked hypotheses, evidence sources, missing observations, original granule identifiers and limitations. **Method & data** contains the processing and provenance details.

**Review & validation** opens the review queue. The queue sorts changed sectors by radar loss area; it is not a hazard ranking. Add a reviewer name, review outcome, rationale and next action. Each save appends a timestamped measurement snapshot without modifying the engine verdict. Reviews survive reload on the same browser and can be exported/imported as JSON. The selected area's Markdown export includes its current-version reviews and optical comparison.

The review dialog now uses a horizontal area selector and one vertical reading flow. **Sensor comparison** highlights the comparison stage, explains precision/recall/F1/IoU in plain language, and puts raw counts and formulas in an expandable technical section. Dashboard metrics retain their measured values; a low loss F1 is explained alongside the distinct after-date water-mask agreement. No analysis package or score is modified by the presentation layer.

This is explicitly a **local browser demo**: names and evidence references are self-reported, identities are not verified, and no requests are sent to operators or agencies. It has no authenticated multi-user review server. Older-package records remain in history but do not apply to a new package. Corrupt imports and storage failures do not overwrite existing records or display a false save success.

### Frontend / processing contract

**Dashboard** is a separate overview at `/?view=dashboard`. Its four summary values are measured radar loss, sectors meeting the existing significant-change rule, sectors with any current-package local review, and valid radar coverage. A recorded review counts a sector once regardless of outcome; it is not scientific approval. The changed-sector filter affects the table while engine totals remain labelled for all sectors. Review saves/imports refresh the overview; inaccessible local storage shows unknown coverage. Each row opens the actual map sector or its review form. The reservoir-report button exports the whole-area report.

The Mission / paper design uses a dark entry panel beside the real interactive optical map, an open observation-provenance band and the three-step investigation rail. Analysis stays on white surfaces with amber actions and terracotta/slate change classes. Possible explanations open on demand; the workspace's human-review actions remain in a fixed footer while the evidence inspector scrolls. The layout adapts from a desktop split to a mobile stack, and reduced-motion preferences disable the panel entrance and automatic divider reveal. See `docs/design-direction.md` for the visual system.

The processing backend is an offline Python pipeline, and the frontend is a buildless static application. There is no live API or browser-side model request. Python writes `web/data/`; `web/js/data.js` loads and checks that package before the workspace starts. `web/js/app.js` controls the map and evidence inspector, and `web/js/report.js` exports the current report. Credentials stay in the Python environment.

The loader checks observation dates, sector IDs, overview/sector totals and map-tooltip measurements. Missing required files or inconsistent exports produce a retryable error with no substitute measurements. Optional change-polygon and reservoir-outline failures leave the remaining workspace usable. Leaflet 1.9.4 is vendored under `web/vendor/leaflet/` with its licence; satellite basemap tiles and the preferred web fonts require internet access. The local observation rasters do not require an external imagery service.

Validate the data package without network requests or model calls:

```powershell
.venv/Scripts/python pipeline/validate_web.py
.venv/Scripts/python pipeline/test_evidence.py
.venv/Scripts/python pipeline/test_validation.py
node --test scripts/test-review.mjs
node scripts/validate-static.mjs
```

`run_all.py` also validates the complete export package after processing. Refresh the browser after regenerating the exports. To regenerate observations and explanations, use the full pipeline workflow below:

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
            04 Sentinel-2 · 05 change detection · 06 evidence engine · 07 LLM explanations · 08 export · 09 proxy comparison
web/        static site (Leaflet), deployed to Render through render.yaml; data/ is generated
data/context/  small provenance + supplemental datasets (committed); data/interim/ rasters (ignored)
```

## Deploy to Render

Live site: **[SAR-BRIDGE AI](https://sar-bridge-ai.onrender.com)**.

[Deploy to Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FFidannn123%2Fsar-bridge-ai)

The root `render.yaml` defines a **Static Site** that publishes only `web/`. Its build command, `node scripts/validate-static.mjs`, checks the observation package, published asset paths and client JavaScript syntax without installing Python/geospatial dependencies, downloading observations or calling a language model. A failed package check prevents deployment.

Connect this repository in Render as a Blueprint, or use these settings for a manually created Static Site:

| Setting | Value |
|---|---|
| Branch | `main` |
| Root Directory | Leave empty (repository root) |
| Build Command | `node scripts/validate-static.mjs` |
| Publish Directory | `web` |
| Environment Variable | `SKIP_INSTALL_DEPS=true` |

No Earthdata or OpenAI credentials are required on Render for this version. The checked-in derived observations and reports are served as static files. To update observations, run the Python pipeline locally and commit the regenerated `web/data/` package. Commits to the linked branch automatically trigger a new deployment. The `/data/*` response header requests browser revalidation so observation files do not remain stale across releases.

Validate the same deploy gate locally with `node scripts/validate-static.mjs`. The GitHub Pages workflow is manual-only; normal pushes to `main` deploy through Render.

## Limitations

- Two dates only: no seasonality, trend, anomaly or forecasting claims.
- Both NISAR scenes are *Provisional*, so residual calibration effects are possible.
- Low-backscatter water detection can confuse wind-roughened water with land, and smooth dry soil or radar shadow with water. The evidence engine tests both cases explicitly.
- In these Provisional scenes, open water is only about 4 dB darker than land in HH, and HV shows almost no water/land contrast: water appears to sit near the noise floor. HV is therefore marked "not separable" by an objective rule and treated as *missing* evidence rather than as a contradiction. Part of a real shoreline change on smooth mudflats may go undetected; the Sentinel-2 comparison quantifies this.
- No in-situ water level, dam outflow or irrigation data were available, so operational explanations (e.g. hydropower release) remain unverified by design.
- ERA5 is a ~9–25 km reanalysis model, not station data.

## Credits

NISAR data: NASA/JPL–ISRO, distributed by ASF DAAC. Sentinel-2: ESA Copernicus. ERA5: ECMWF / Copernicus Climate Change Service via Open-Meteo. Reservoir outline © OpenStreetMap contributors (ODbL). Basemap © Esri.
