"""Stream the study-area subset of two real NISAR L2 GCOV granules.

The full HDF5 granules are ~7 GB each. Instead of downloading them, this script
opens each file over authenticated HTTPS (NASA Earthdata Login via earthaccess)
and reads *only* the rows/columns covering Mingachevir Reservoir, using HTTP
range requests. Nothing large is written to disk.

Layers read (Frequency A, 40 MHz):
  HHHH, HVHV  - diagonal covariance terms = gamma0 backscatter (linear power, RTC)
  mask        - validity / layover-shadow mask (decoded from the file's own attributes)
  numberOfLooks

Outputs (analysis grid, UTM 38N, 20 m): data/interim/nisar_<before|after>_<HH|HV|valid|looks>.tif
Provenance: data/context/nisar_read_log.json
"""
from __future__ import annotations

import os
import sys
import time

import h5py
import numpy as np
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject

from common import load_env, read_json, step, utc_now, write_json
from config import CONTEXT, INTERIM, NISAR_GRID_PATH
from grid import analysis_grid, save

BLOCK = 8 * 1024 * 1024
REFRESH_MASK = "--refresh-mask" in sys.argv   # with --meta-only: re-read the full mask window
MARGIN_M = 400


def _attr(obj, name):
    v = obj.attrs.get(name)
    if isinstance(v, bytes):
        return v.decode()
    if isinstance(v, np.ndarray) and v.dtype.kind in "SO":
        return [x.decode() if isinstance(x, bytes) else x for x in v.tolist()]
    if isinstance(v, np.ndarray):
        return v.tolist()
    if isinstance(v, np.generic):
        return v.item()
    return v


def _scalar(ds):
    v = ds[()]
    return v.decode() if isinstance(v, bytes) else (v.item() if hasattr(v, "item") else v)


def decode_mask(mask: np.ndarray, ds) -> tuple[np.ndarray, str]:
    """Return (invalid_bool, explanation) using the mask dataset's own metadata."""
    meanings = _attr(ds, "flag_meanings")
    values = _attr(ds, "flag_values")
    fill = _attr(ds, "_FillValue")
    desc = _attr(ds, "description")
    invalid = np.zeros(mask.shape, dtype=bool)
    notes = []
    if fill is not None:
        invalid |= mask == fill
        notes.append(f"_FillValue={fill} -> invalid")
    if meanings is not None and values is not None:
        names = meanings.split() if isinstance(meanings, str) else list(meanings)
        vals = values if isinstance(values, list) else [values]
        for v, nm in zip(vals, names):
            if any(k in nm.lower() for k in ("shadow", "layover", "invalid", "not_valid", "fill", "no_data",
                                              "nodata", "outside")):
                invalid |= mask == v
                notes.append(f"{v}:{nm} -> invalid")
    elif fill is None:
        invalid |= mask == 255
        notes.append("no flag metadata found; 255 treated as fill")
    # NISAR GCOV mask semantics (from the dataset description): value = subswath number of a
    # valid sample; 0 = partially focused or invalid radar samples; 255 = outside acquisition.
    if desc and "value 0" in desc and ("invalid" in desc or "partially" in desc):
        invalid |= mask == 0
        notes.append("0 (partially focused / invalid samples, per description) -> invalid")
    return invalid, f"description={desc!r}; " + "; ".join(notes)


def read_granule(fs, url: str, label: str, grid, meta_only: bool = False) -> dict:
    """Stream the subset. With meta_only=True only attributes and a small central
    sample window are read (seconds), to rebuild the provenance log."""
    t0 = time.time()
    log = {"url": url, "label": label}
    with fs.open(url, mode="rb", block_size=BLOCK, cache_type="blockcache") as fobj:
        try:
            h5 = h5py.File(fobj, "r", page_buf_size=64 * 1024 * 1024)
            log["hdf5_paged_buffer"] = True
        except Exception:
            fobj.seek(0)
            h5 = h5py.File(fobj, "r")
            log["hdf5_paged_buffer"] = False
        with h5:
            g = h5[NISAR_GRID_PATH]
            log["available_layers"] = sorted(g.keys())
            x = g["xCoordinates"][:]
            y = g["yCoordinates"][:]
            dx = float(_scalar(g["xCoordinateSpacing"])) if "xCoordinateSpacing" in g else float(x[1] - x[0])
            dy = float(_scalar(g["yCoordinateSpacing"])) if "yCoordinateSpacing" in g else float(y[1] - y[0])
            epsg = int(_attr(g["projection"], "epsg_code") or _scalar(g["projection"]))
            log.update(native_spacing_m=[dx, dy], native_epsg=epsg, native_shape=[len(y), len(x)])
            if f"EPSG:{epsg}" != grid.crs:
                print(f"    note: native EPSG:{epsg} differs from analysis {grid.crs}; reprojecting")
            # subset window (coordinates are pixel centres)
            from rasterio.warp import transform_bounds
            minx, miny, maxx, maxy = transform_bounds(grid.crs, f"EPSG:{epsg}", *grid.bounds)
            minx, miny, maxx, maxy = minx - MARGIN_M, miny - MARGIN_M, maxx + MARGIN_M, maxy + MARGIN_M
            cols = np.where((x >= minx) & (x <= maxx))[0]
            rows = np.where((y >= miny) & (y <= maxy))[0]
            if len(cols) == 0 or len(rows) == 0:
                raise SystemExit(f"{label}: study area not inside granule grid")
            c0, c1, r0, r1 = int(cols.min()), int(cols.max()) + 1, int(rows.min()), int(rows.max()) + 1
            log["subset_rows_cols"] = [r0, r1, c0, c1]
            src_transform = Affine(dx, 0, x[c0] - dx / 2, 0, dy, y[r0] - dy / 2)
            print(f"    native grid EPSG:{epsg}, spacing {dx:g} x {dy:g} m; reading window {r1-r0} x {c1-c0} px")

            layers = {}
            for name in ("HHHH", "HVHV", "mask", "numberOfLooks"):
                if name not in g:
                    print(f"    layer {name} not present")
                    continue
                ds = g[name]
                ts = time.time()
                if meta_only:
                    if name in ("HHHH", "HVHV"):
                        arr = None
                    elif name == "mask" and REFRESH_MASK:   # full mask window to rebuild validity
                        arr = ds[r0:r1, c0:c1]
                    else:   # central 512 x 512 sample for mask statistics / looks
                        rc, cc = (r0 + r1) // 2, (c0 + c1) // 2
                        arr = ds[rc - 256:rc + 256, cc - 256:cc + 256]
                        log.setdefault("sampled_layers", []).append(name)
                else:
                    arr = ds[r0:r1, c0:c1]
                layers[name] = arr
                if name == "mask":
                    layers["_mask_invalid"], log["mask_decoding"] = decode_mask(arr, ds)
                    log["mask_attributes"] = {k: _attr(ds, k) for k in ds.attrs.keys()}
                log.setdefault("layers", {})[name] = {
                    "dtype": str(ds.dtype), "chunks": ds.chunks, "compression": ds.compression,
                    "units": _attr(ds, "units"), "description": _attr(ds, "description"),
                    "fill_value": _attr(ds, "_FillValue"),
                }
                if arr is not None:
                    print(f"    {name}: {arr.shape} {arr.dtype} in {time.time()-ts:.0f}s")
            # identification metadata for provenance
            ident = h5.get("/science/LSAR/identification")
            if ident is not None:
                keep = ("zeroDopplerStartTime", "zeroDopplerEndTime", "lookDirection", "orbitPassDirection",
                        "trackNumber", "frameNumber", "productVersion", "processingType", "isUrgentObservation",
                        "radarBand", "platformName", "missionId", "productType", "absoluteOrbitNumber")
                log["identification"] = {k: _scalar(ident[k]) for k in keep if k in ident}

    out = {}
    if meta_only:
        log["seconds"] = round(time.time() - t0, 1)
        return out, layers, src_transform, epsg, log
    for pol, key in (("HH", "HHHH"), ("HV", "HVHV")):
        a = layers[key].astype("float32")
        a[~np.isfinite(a) | (a <= 0)] = np.nan
        dst = np.full(grid.shape, np.nan, dtype="float32")
        reproject(a, dst, src_transform=src_transform, src_crs=f"EPSG:{epsg}", dst_transform=grid.transform,
                  dst_crs=grid.crs, resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan)
        out[pol] = dst
    log["seconds"] = round(time.time() - t0, 1)
    return out, layers, src_transform, epsg, log


def main():
    step("NISAR GCOV subset (streamed over HTTPS, no full download)")
    load_env()
    if not (os.environ.get("EARTHDATA_TOKEN") or (os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD"))):
        raise SystemExit("Earthdata credentials missing: fill EARTHDATA_USERNAME / EARTHDATA_PASSWORD in .env")
    import earthaccess
    earthaccess.login(strategy="environment")
    fs = earthaccess.get_fsspec_https_session()

    grid = analysis_grid()
    meta = read_json(CONTEXT / "nisar_granules.json")["pair"]
    read_log = {"retrieved_utc": utc_now(), "analysis_grid": {"crs": grid.crs, "shape": grid.shape, "bounds": grid.bounds},
                "granules": {}}
    meta_only = "--meta-only" in sys.argv
    if meta_only:
        print("  metadata-only mode: re-reading attributes + small sample, rasters already on disk")
    for label, info in meta.items():
        print(f"  {label}: {info['granule_id']}")
        out, layers, src_transform, epsg, log = read_granule(fs, info["data_url"], label, grid, meta_only)
        if meta_only:
            import rasterio
            if REFRESH_MASK and layers.get("_mask_invalid") is not None:
                inv = layers["_mask_invalid"]
                log["mask_flagged_fraction_in_subset"] = round(float(inv.mean()), 4)
                v = np.zeros(grid.shape, dtype="float32")
                reproject((~inv).astype("float32"), v, src_transform=src_transform, src_crs=f"EPSG:{epsg}",
                          dst_transform=grid.transform, dst_crs=grid.crs, resampling=Resampling.average, dst_nodata=0)
                with rasterio.open(INTERIM / f"nisar_{label}_HH.tif") as a, rasterio.open(INTERIM / f"nisar_{label}_HV.tif") as b:
                    finite = np.isfinite(a.read(1)) & np.isfinite(b.read(1))
                valid = (v >= 0.99) & finite
                save(INTERIM / f"nisar_{label}_valid.tif", valid.astype("uint8"), grid, nodata=255)
                print(f"    rebuilt validity: {inv.mean()*100:.2f}% of native subset flagged invalid by the product mask")
            with rasterio.open(INTERIM / f"nisar_{label}_valid.tif") as src:
                valid = src.read(1) == 1
            if layers.get("_mask_invalid") is not None:
                log["mask_flagged_fraction_in_sample"] = round(float(layers["_mask_invalid"].mean()), 4)
            if layers.get("numberOfLooks") is not None:
                nl = layers["numberOfLooks"].astype("float32")
                nl[~np.isfinite(nl) | (nl <= 0)] = np.nan
                log["number_of_looks_median_in_subset"] = float(np.nanmedian(nl))
                log["number_of_looks_note"] = "median of a central 512 x 512 native-pixel sample"
            log["valid_fraction_of_grid"] = round(float(valid.mean()), 4)
            read_log["granules"][label] = log
            print(f"    mask: {log.get('mask_decoding')}")
            continue
        for pol, arr in out.items():
            save(INTERIM / f"nisar_{label}_{pol}.tif", arr, grid, nodata=float("nan"))
        # validity: finite in both pols, not flagged by the product mask
        valid_native = np.isfinite(layers["HHHH"]) & (layers["HHHH"] > 0)
        if "_mask_invalid" in layers:
            valid_native &= ~layers["_mask_invalid"]
            log["mask_flagged_fraction_in_subset"] = round(float(layers["_mask_invalid"].mean()), 4)
        v = np.zeros(grid.shape, dtype="float32")
        reproject(valid_native.astype("float32"), v, src_transform=src_transform, src_crs=f"EPSG:{epsg}",
                  dst_transform=grid.transform, dst_crs=grid.crs, resampling=Resampling.average, dst_nodata=0)
        valid = (v >= 0.99) & np.isfinite(out["HH"]) & np.isfinite(out["HV"])
        save(INTERIM / f"nisar_{label}_valid.tif", valid.astype("uint8"), grid, nodata=255)
        if "numberOfLooks" in layers:
            nl = layers["numberOfLooks"].astype("float32")
            nl[~np.isfinite(nl) | (nl <= 0)] = np.nan
            log["number_of_looks_median_in_subset"] = float(np.nanmedian(nl))
        log["valid_fraction_of_grid"] = round(float(valid.mean()), 4)
        print(f"    valid fraction on analysis grid: {log['valid_fraction_of_grid']:.3f}  ({log['seconds']} s)")
        read_log["granules"][label] = log
    write_json(CONTEXT / "nisar_read_log.json", read_log)


if __name__ == "__main__":
    main()
