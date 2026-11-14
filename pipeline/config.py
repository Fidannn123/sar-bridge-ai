"""Shared configuration for the SAR-BRIDGE AI processing pipeline.

Every value here is either a real identifier (NISAR granule IDs, collection
names) or an explicit, documented processing parameter. Nothing in this file is
a measurement.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
INTERIM = DATA / "interim"          # git-ignored analysis rasters
CONTEXT = DATA / "context"          # small supplemental datasets (committed)
WEB_DATA = ROOT / "web" / "data"    # outputs consumed by the static web app

for _p in (INTERIM, CONTEXT, WEB_DATA):
    _p.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------------------------------
# Study area: Mingachevir Reservoir, Azerbaijan
# --------------------------------------------------------------------------
# Analysis bounding box (lon_min, lat_min, lon_max, lat_max). Refined to the
# OpenStreetMap reservoir outline + buffer by 00_study_area.py.
AOI_BBOX_DEFAULT = (46.40, 40.72, 47.12, 41.12)
RESERVOIR_BUFFER_M = 2500           # analysis zone = reservoir outline + this buffer
ANALYSIS_CRS = "EPSG:32638"         # UTM zone 38N (covers 42-48 E)
ANALYSIS_RES_M = 20.0               # analysis grid posting (metres)
N_SECTORS = 10                      # slices along the reservoir's main (NW-SE) axis

# --------------------------------------------------------------------------
# NISAR observations (found via NASA CMR; see README "Data selection")
# Same track (157), direction (Ascending), frame (022), mode (4005 = 40+5 MHz),
# dual-pol HH/HV, same processing CRID (P05023) -> geometrically comparable.
# --------------------------------------------------------------------------
NISAR_COLLECTION = "NISAR_L2_GCOV_PROVISIONAL_V1"
NISAR_PAIR = {
    "before": {
        "granule_id": "NISAR_L2_PR_GCOV_023_157_A_022_4005_DHDH_A_20260625T015554_20260625T015629_P05023_N_F_J_001",
        "label": "2026-06-25",
    },
    "after": {
        "granule_id": "NISAR_L2_PR_GCOV_032_157_A_022_4005_DHDH_A_20261011T015548_20261011T015626_P05023_N_F_J_001",
        "label": "2026-10-11",
    },
}
NISAR_FREQ = "frequencyA"           # 40 MHz main band
NISAR_POLS = ["HHHH", "HVHV"]       # diagonal covariance terms (gamma0 backscatter, linear power)
NISAR_GRID_PATH = "/science/LSAR/GCOV/grids/" + NISAR_FREQ

# --------------------------------------------------------------------------
# Change-detection parameters (documented in the Methodology panel)
# --------------------------------------------------------------------------
SPECKLE_WINDOW = 5                  # boxcar filter in linear power before thresholding
OTSU_BOUNDS_HH_DB = (-24.0, -12.0)  # plausible L-band HH water/land split; Otsu clamped to this
OTSU_BOUNDS_HV_DB = (-32.0, -18.0)
MAX_CLAMP_DB = 2.0                  # Otsu split this far outside the plausible range => polarisation not separable
MIN_DELTA_DB = 3.0                  # a class flip must also change HH by >= 3 dB to count as change
MIN_PATCH_PX = 25                   # remove change patches smaller than 25 px (1 ha at 20 m)
COLOC_TOL_PX = 2                    # radar/optical co-location tolerance (2 px = 40 m = stated shoreline uncertainty)
PIXEL_AREA_HA = (ANALYSIS_RES_M * ANALYSIS_RES_M) / 10_000.0

# Change-map class codes (shared with the web app legend)
CLASS_NODATA = 0      # insufficient valid data in either observation
CLASS_LAND = 1        # land in both (no detected change)
CLASS_WATER = 2       # water in both (no detected change)
CLASS_GAIN = 3        # land -> water
CLASS_LOSS = 4        # water -> land

# Supplemental-context locations (ERA5 / ERA5-Land via Open-Meteo)
WEATHER_POINTS = {
    "reservoir": {"lat": 40.90, "lon": 46.85, "label": "Mingachevir Reservoir (centre)"},
    "upstream": {"lat": 41.90, "lon": 45.50, "label": "Alazani valley, Georgia (upstream catchment proxy)"},
}

OPENAI_MODEL_DEFAULT = "gpt-5-mini"
