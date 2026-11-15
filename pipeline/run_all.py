"""Run the full SAR-BRIDGE AI pipeline in order.

Usage:  python pipeline/run_all.py            # everything
        python pipeline/run_all.py --from 5   # resume from step 05
"""
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

STEPS = [
    "00_study_area.py",
    "01_nisar_metadata.py",
    "02_fetch_nisar.py",
    "03_weather_context.py",
    "04_sentinel2_water.py",
    "05_change_detection.py",
    "06_evidence.py",
    "07_explain.py",
    "08_export_meta.py",
    "09_validation.py",
]

if __name__ == "__main__":
    start = 0
    if "--from" in sys.argv:
        start = int(sys.argv[sys.argv.index("--from") + 1])
    for name in STEPS:
        if int(name[:2]) < start:
            continue
        runpy.run_path(str(HERE / name), run_name="__main__")
    from validate_web import validate
    validate()
    print("\nDone. Serve the web app with:  python -m http.server -d web 8000")
