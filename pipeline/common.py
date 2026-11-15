"""Small shared helpers: .env loading, JSON I/O, logging."""
from __future__ import annotations

import json
import math
import os
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

from config import ROOT

warnings.filterwarnings("ignore", category=DeprecationWarning)

# Windows consoles default to a legacy code page; force UTF-8 so place names print.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass

USER_AGENT = "SAR-BRIDGE-AI/0.1 (NASA Space Apps hackathon prototype)"


def load_env(path: Path | None = None) -> None:
    """Load KEY=VALUE lines from .env into os.environ (without overriding)."""
    path = path or ROOT / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if value and key not in os.environ:
            os.environ[key] = value


def _clean(obj):
    """Make objects JSON-safe: NaN/inf -> None (never silently 0), numpy -> python."""
    try:
        import numpy as np
    except ImportError:  # pragma: no cover
        np = None
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if np is not None:
        if isinstance(obj, np.generic):
            obj = obj.item()
        elif isinstance(obj, np.ndarray):
            return _clean(obj.tolist())
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    return str(obj)   # e.g. HDF5 object references in attributes: keep a readable trace, never crash


def write_json(path: Path, obj, indent: int | None = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_clean(obj), indent=indent, ensure_ascii=False), encoding="utf-8", newline="\n")
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size/1024:.1f} KB)")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def step(title: str) -> None:
    print(f"\n=== {title} ===")
