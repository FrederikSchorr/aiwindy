#!/usr/bin/env python3
"""
openskiron_fetch.py — Fetch OpenSkiron WRF 4km GRIB2 and extract weather data.

Usage: python scripts/openskiron_fetch.py <domain> <wind_lat> <wind_lon> <city_lat> <city_lon>
Output: JSON to stdout, diagnostics to stderr
"""

import sys
import os
import json
import math
import bz2
from datetime import datetime, timezone
from pathlib import Path

# ── Windows: add DLL directories for ecCodes native library ─────────────────
if sys.platform == "win32":
    _script_dir = Path(__file__).parent
    _pyver = f"Python{sys.version_info.major}{sys.version_info.minor}"
    _dll_candidates = [
        # Bundled DLLs alongside this script
        _script_dir,
        # Python user Scripts directory (where we extracted ecCodes DLLs)
        Path(os.path.expanduser("~")) / "AppData" / "Roaming" / "Python" / _pyver / "Scripts",
        # Windows Universal CRT (needed by MSVC-compiled DLLs)
        Path("C:/Windows/System32/downlevel"),
    ]
    _extra_paths = [str(d) for d in _dll_candidates if d.exists()]
    if _extra_paths:
        os.environ["PATH"] = os.pathsep.join(_extra_paths) + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        for _d in _dll_candidates:
            if _d.exists():
                try:
                    os.add_dll_directory(str(_d))
                except Exception:
                    pass

# Suppress C-level ecCodes "failed to set key 'missingValue'" noise
os.environ.setdefault("ECCODES_LOG_LEVEL", "0")

import requests

OPENSKIRON_WRF_PAGE = "https://openskiron.org/en/openwrf"
OPENSKIRON_BASE = "https://openskiron.org/gribs_wrf_4km/"
CACHE_DIR = Path("cache/openskiron")

WIND_ROSE_16 = [
    "N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
]


def wind_direction_str(u: float, v: float) -> str:
    """Convert U/V wind components to 16-point compass string (FROM direction)."""
    deg = (math.degrees(math.atan2(-u, -v)) + 360) % 360
    idx = int((deg + 11.25) / 22.5) % 16
    return WIND_ROSE_16[idx]


def discover_url(domain: str) -> str:
    """Scrape OpenSkiron WRF page to find the current download URL for a domain prefix."""
    import re
    headers = {"User-Agent": "Mozilla/5.0"}
    r = requests.get(OPENSKIRON_WRF_PAGE, headers=headers, timeout=15)
    r.raise_for_status()
    # Find all 4km GRIB URLs matching our domain prefix
    pattern = rf'https://openskiron\.org/gribs_wrf_4km/({re.escape(domain)}_WRF_WAM_[^"\'<>\s]+\.grb\.bz2)'
    matches = re.findall(pattern, r.text)
    if not matches:
        raise ValueError(f"No GRIB URL found for domain prefix '{domain}' on {OPENSKIRON_WRF_PAGE}")
    filename = matches[0]  # take the first (most recent) match
    url = f"{OPENSKIRON_BASE}{filename}"
    print(f"[discover] {url}", file=sys.stderr)
    return url


def _parse_created(url: str, domain: str) -> str:
    """Extract creation timestamp from GRIB filename like '...260403-00.grb.bz2' → '2026-04-03 00Z'."""
    import re
    m = re.search(rf'{re.escape(domain)}_WRF_WAM_(\d{{6}})-(\d{{2}})\.grb\.bz2', url)
    if m:
        raw, hour = m.group(1), m.group(2)
        return f"20{raw[0:2]}-{raw[2:4]}-{raw[4:6]} {hour}Z"
    return ""


def fetch_grib(domain: str) -> tuple[Path, str]:
    """Download GRIB if not cached or URL changed, return (path, created_stamp)."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"{domain}.grb2"
    url_cache = CACHE_DIR / f"{domain}.url"
    headers = {"User-Agent": "Mozilla/5.0"}

    try:
        url = discover_url(domain)
    except Exception as e:
        print(f"[warn] URL discovery failed: {e}", file=sys.stderr)
        if cache_path.exists():
            print(f"[cache] using existing cache for {domain}", file=sys.stderr)
            cached_url = url_cache.read_text().strip() if url_cache.exists() else ""
            return cache_path, _parse_created(cached_url, domain)
        raise

    created = _parse_created(url, domain)

    if cache_path.exists() and url_cache.exists():
        cached_url = url_cache.read_text().strip()
        if cached_url == url:
            print(f"[cache] {domain} is up-to-date ({url.split('/')[-1]})", file=sys.stderr)
            return cache_path, created

    print(f"[download] {url}", file=sys.stderr)
    resp = requests.get(url, headers=headers, timeout=120, stream=True)
    resp.raise_for_status()
    bz2_data = resp.content
    grb2_data = bz2.decompress(bz2_data)
    cache_path.write_bytes(grb2_data)
    url_cache.write_text(url)
    print(f"[ok] downloaded {domain}: {len(grb2_data):,} bytes", file=sys.stderr)
    return cache_path, created


def extract_data(
    grb2_path: Path,
    wind_lat: float, wind_lon: float,
    city_lat: float, city_lon: float,
) -> dict:
    import cfgrib
    import warnings
    warnings.filterwarnings("ignore")

    # GRIB1 parameter IDs used by OpenSkiron WRF output:
    #   param 33  heightAboveGround/10  → U wind component (m/s)
    #   param 34  heightAboveGround/10  → V wind component (m/s)
    #   param 11  heightAboveGround/2   → 2m temperature (K)
    #   param 61  surface               → total precipitation cumulative (mm)
    #   param 71  entireAtmosphere      → total cloud cover (%, already 0-100)
    #   param 157 surface               → CAPE (J/kg)
    #   param 180 surface               → wind gust speed (m/s)

    def open_param(indicator, level_type, level=None):
        fbk: dict = {"indicatorOfParameter": indicator, "typeOfLevel": level_type}
        if level is not None:
            fbk["level"] = level
        try:
            return cfgrib.open_dataset(str(grb2_path), filter_by_keys=fbk, errors="ignore")
        except Exception as e:
            print(f"[grib] param={indicator}/{level_type}: {e}", file=sys.stderr)
            return None

    def sel(ds, lat, lon):
        return ds.sel(latitude=lat, longitude=lon, method="nearest")

    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo
    tz_athens = ZoneInfo("Europe/Athens")

    def to_iso(t) -> str:
        dt = datetime.utcfromtimestamp(int(t) / 1_000_000_000).replace(tzinfo=timezone.utc)
        local = dt.astimezone(tz_athens)
        offset_h = int(local.utcoffset().total_seconds() // 3600)
        return local.strftime("%Y-%m-%dT%H:%M:%S") + f"+{offset_h:02d}:00"

    def get_values(ds, lat, lon):
        if ds is None:
            return None
        pt = sel(ds, lat, lon)
        # variable name is 'unknown' in GRIB1 when shortName lookup fails
        var = next(iter(pt.data_vars), None)
        if var is None:
            return None
        return [float(v) for v in pt[var].values]

    # U/V wind at 10m
    ds_u = open_param(33, "heightAboveGround", 10)
    ds_v = open_param(34, "heightAboveGround", 10)
    if ds_u is None or ds_v is None:
        raise ValueError("No wind dataset (GRIB1 params 33/34) found")

    pt_u = sel(ds_u, wind_lat, wind_lon)
    valid_times = pt_u.valid_time.values
    timestamps = [to_iso(t) for t in valid_times]
    n = len(timestamps)
    print(f"[grib] {n} timesteps, first={timestamps[0] if timestamps else '?'}", file=sys.stderr)

    u10 = get_values(ds_u, wind_lat, wind_lon)
    v10 = get_values(ds_v, wind_lat, wind_lon)
    wind_speed_kt = [round(math.sqrt(u**2 + v**2) * 1.94384, 1) for u, v in zip(u10, v10)]
    wind_dir = [wind_direction_str(u, v) for u, v in zip(u10, v10)]

    # Gust (GRIB1 param 180 = wind gust speed in m/s)
    gust_vals = get_values(open_param(180, "surface", 0), wind_lat, wind_lon)
    if gust_vals is not None:
        gust_kt = [round(g * 1.94384, 1) for g in gust_vals]
    else:
        gust_kt = wind_speed_kt[:]

    # Total precipitation (cumulative mm)
    cum_vals = get_values(open_param(61, "surface", 0), wind_lat, wind_lon)
    if cum_vals is not None:
        rain_mm = [round(max(0.0, cum_vals[i] - (cum_vals[i - 1] if i > 0 else 0.0)), 2) for i in range(n)]
    else:
        rain_mm = [0.0] * n

    # CAPE (J/kg)
    cape_vals = get_values(open_param(157, "surface", 0), wind_lat, wind_lon)
    if cape_vals is not None:
        cape = [round(v) for v in cape_vals]
    else:
        cape = [0] * n

    # Total cloud cover — GRIB1 param 71, already in % (0–100)
    tcc_vals = get_values(open_param(71, "entireAtmosphere", 0), wind_lat, wind_lon)
    if tcc_vals is not None:
        cloud_cover = [round(v) for v in tcc_vals]
    else:
        cloud_cover = [0] * n

    # Sea surface temperature — not present in OpenSkiron WRF GRIB1
    water_temp_c: list = [None] * n

    # Wave data from WAM model (separate dataset in GRIB, uses open_datasets)
    wave_height_m: list = [None] * n
    wave_period_s: list = [None] * n
    wave_dir: list = [None] * n
    swell_height_m: list = [None] * n
    try:
        all_ds = cfgrib.open_datasets(str(grb2_path), errors="ignore")
        for wds in all_ds:
            if "swh" in wds.data_vars:
                wpt = sel(wds, wind_lat, wind_lon)
                def wave_vals(var):
                    if var not in wpt.data_vars:
                        return None
                    vals = [float(v) for v in wpt[var].values]
                    if all(v != v for v in vals):  # all NaN
                        return None
                    return vals
                swh = wave_vals("swh")
                if swh:
                    wave_height_m = [round(v, 2) if v == v else None for v in swh]
                mpww = wave_vals("mpww")
                if mpww:
                    wave_period_s = [round(v, 1) if v == v else None for v in mpww]
                mdww = wave_vals("mdww")
                if mdww:
                    wave_dir = [wind_direction_str(-math.sin(math.radians(v)), -math.cos(math.radians(v))) if v == v else None for v in mdww]
                sw = wave_vals("swell")
                if sw:
                    swell_height_m = [round(v, 2) if v == v else None for v in sw]
                break
    except Exception as e:
        print(f"[grib] wave extraction: {e}", file=sys.stderr)

    # 2m air temperature at city coordinates (K → °C)
    t2m_vals = get_values(open_param(11, "heightAboveGround", 2), city_lat, city_lon)
    if t2m_vals is not None:
        temp2m_c = [round(v - 273.15, 1) for v in t2m_vals]
    else:
        temp2m_c = [None] * n

    return {
        "timestamps": timestamps,
        "windSpeedKt": wind_speed_kt,
        "windDir": wind_dir,
        "gustKt": gust_kt,
        "rainMm": rain_mm,
        "cape": cape,
        "cloudCover": cloud_cover,
        "waterTempC": water_temp_c,
        "waveHeightM": wave_height_m,
        "wavePeriodS": wave_period_s,
        "waveDir": wave_dir,
        "swellHeightM": swell_height_m,
        "temp2mC": temp2m_c,
    }


def main():
    if len(sys.argv) != 6:
        print(
            f"Usage: {sys.argv[0]} <domain> <wind_lat> <wind_lon> <city_lat> <city_lon>",
            file=sys.stderr,
        )
        sys.exit(1)

    domain = sys.argv[1]
    wind_lat = float(sys.argv[2])
    wind_lon = float(sys.argv[3])
    city_lat = float(sys.argv[4])
    city_lon = float(sys.argv[5])

    try:
        grb2_path, created = fetch_grib(domain)

        cache_key = f"{domain}_{wind_lat:.4f}_{wind_lon:.4f}_{city_lat:.4f}_{city_lon:.4f}"
        json_cache_path = CACHE_DIR / f"{cache_key}.json"
        url_cache_path = CACHE_DIR / f"{domain}.url"
        current_url = url_cache_path.read_text().strip() if url_cache_path.exists() else ""

        if json_cache_path.exists():
            try:
                cached = json.loads(json_cache_path.read_text())
                if cached.get("_cache_url") == current_url:
                    print(f"[json-cache] reusing extracted data for {cache_key}", file=sys.stderr)
                    del cached["_cache_url"]
                    print(json.dumps(cached))
                    sys.exit(0)
            except Exception:
                pass

        result = extract_data(grb2_path, wind_lat, wind_lon, city_lat, city_lon)
        result["created"] = created

        cache_result = dict(result)
        cache_result["_cache_url"] = current_url
        json_cache_path.write_text(json.dumps(cache_result))
        print(f"[json-cache] saved extracted data for {cache_key}", file=sys.stderr)

        print(json.dumps(result))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
