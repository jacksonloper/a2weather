#!/usr/bin/env python3
"""
Fetch historical 100m wind data for the continental United States from
Open-Meteo (ERA5) and store it as a compact binary for the web app.

The output is a low-resolution regular lat/lon grid with one wind vector per
grid cell at a fixed sub-daily cadence (default 6-hourly) over a chosen date
range (default one quarter). The sub-daily sampling lets moving features such
as hurricanes glide smoothly instead of hopping between daily snapshots. For
each timestep we take the 100m hourly wind (speed + direction), converted to
eastward (u) and northward (v) components. Values are quantized to signed
16-bit integers to keep the download small (a few MB).

Outputs (under public/data/wind/):
  - wind_100m_<year>.bin   Int16 little-endian, layout [frame][row][col][u,v]
  - wind_meta.json         grid + scaling metadata for the front-end
  - us-states.json         simplified US state boundaries (lon/lat) for context

Usage:
  python scripts/fetch_wind.py [--start-date 2023-08-01] [--end-date 2023-10-31]
                               [--step-hours 6]
"""

import argparse
import json
import math
import os
import struct
import time
from urllib.request import urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError

# ---------------------------------------------------------------------------
# Grid definition (low resolution, continental US + surrounding waters)
# ---------------------------------------------------------------------------
LON_MIN, LON_MAX = -125.0, -67.0   # west coast .. Maine
LAT_MIN, LAT_MAX = 24.0, 50.0      # southern FL .. northern border
STEP = 1.0                          # degrees (low resolution)

SCALE = 100                         # stored int = round(value_m_s * SCALE)
BATCH = 100                         # grid points per API request
STEP_HOURS = 3                      # temporal cadence (3h = 8 frames/day)
API_URL = "https://archive-api.open-meteo.com/v1/archive"

# Default date range: Atlantic hurricane peak quarter (~one quarter of a year).
DEFAULT_START = "2023-08-01"
DEFAULT_END = "2023-10-31"

BASE_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data", "wind")
STATES_URL = (
    "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/"
    "master/data/geojson/us-states.json"
)


def frange(start, stop, step):
    """Inclusive float range."""
    vals = []
    n = int(round((stop - start) / step))
    for i in range(n + 1):
        vals.append(round(start + i * step, 4))
    return vals


def build_grid():
    lons = frange(LON_MIN, LON_MAX, STEP)
    lats = frange(LAT_MIN, LAT_MAX, STEP)
    # Row-major order: for each latitude (south -> north), for each longitude.
    points = [(lat, lon) for lat in lats for lon in lons]
    return lons, lats, points


def fetch_batch(points, start_date, end_date, retries=6):
    """Fetch hourly 100m wind for a list of (lat, lon) points (single request)."""
    lat = ",".join(str(p[0]) for p in points)
    lon = ",".join(str(p[1]) for p in points)
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": "wind_speed_100m,wind_direction_100m",
        "wind_speed_unit": "ms",
        "timezone": "GMT",
    }
    url = f"{API_URL}?{urlencode(params)}"

    delay = 2
    for attempt in range(retries):
        try:
            with urlopen(url, timeout=180) as resp:
                data = json.loads(resp.read().decode())
            # A single point returns a dict; multiple points return a list.
            if isinstance(data, dict):
                data = [data]
            return data
        except (HTTPError, URLError, TimeoutError) as e:
            if attempt == retries - 1:
                raise
            print(f"    request failed ({e}); retrying in {delay}s...")
            time.sleep(delay)
            delay *= 2
    return []


def speed_dir_to_uv(speed, direction):
    """Convert meteorological wind (speed m/s, direction FROM in degrees)
    to eastward u and northward v components (direction of motion)."""
    if speed is None or direction is None:
        return 0.0, 0.0
    rad = math.radians(direction)
    u = -speed * math.sin(rad)
    v = -speed * math.cos(rad)
    return u, v


def clamp_int16(value):
    iv = int(round(value * SCALE))
    if iv > 32767:
        iv = 32767
    elif iv < -32767:
        iv = -32767
    return iv


def fetch_wind(start_date, end_date, step_hours):
    lons, lats, points = build_grid()
    nlon, nlat = len(lons), len(lats)

    nframes = None
    # frames[frame] -> flat list of int16 in row-major (row, col, [u, v]) order.
    frames = None
    speeds = []  # collect for color-scale hint

    total_batches = (len(points) + BATCH - 1) // BATCH
    print(f"Grid: {nlon} lon x {nlat} lat = {len(points)} points")
    print(f"Range {start_date}..{end_date}, every {step_hours}h")
    print(f"Fetching in {total_batches} batches of up to {BATCH}...")

    for b in range(total_batches):
        batch_points = points[b * BATCH:(b + 1) * BATCH]
        print(f"  Batch {b + 1}/{total_batches} ({len(batch_points)} points)...")
        results = fetch_batch(batch_points, start_date, end_date)
        if len(results) != len(batch_points):
            raise RuntimeError(
                f"Expected {len(batch_points)} results, got {len(results)}"
            )

        for local_idx, res in enumerate(results):
            global_idx = b * BATCH + local_idx
            row = global_idx // nlon
            col = global_idx % nlon
            hourly = res.get("hourly", {})
            times = hourly.get("time", [])
            spd = hourly.get("wind_speed_100m", [])
            drc = hourly.get("wind_direction_100m", [])

            # Subsample the hourly series every `step_hours`.
            frame_hours = list(range(0, len(times), step_hours))
            if nframes is None:
                nframes = len(frame_hours)
                frames = [[0] * (nlat * nlon * 2) for _ in range(nframes)]

            base = (row * nlon + col) * 2
            for f_idx, h in enumerate(frame_hours):
                s = spd[h] if h < len(spd) else None
                di = drc[h] if h < len(drc) else None
                u, v = speed_dir_to_uv(s, di)
                if s is not None:
                    speeds.append(s)
                arr = frames[f_idx]
                arr[base] = clamp_int16(u)
                arr[base + 1] = clamp_int16(v)

        # Be gentle with the API between batches.
        time.sleep(1)

    # Determine a reasonable color-scale ceiling (95th percentile speed).
    speeds.sort()
    speed_max = speeds[int(len(speeds) * 0.95)] if speeds else 25.0

    os.makedirs(BASE_DIR, exist_ok=True)
    year = int(start_date[:4])
    bin_name = f"wind_100m_{year}.bin"
    bin_path = os.path.join(BASE_DIR, bin_name)

    with open(bin_path, "wb") as f:
        for frame in frames:
            f.write(struct.pack(f"<{len(frame)}h", *frame))

    size_mb = os.path.getsize(bin_path) / (1024 * 1024)
    print(f"Wrote {bin_path} ({size_mb:.2f} MB, {nframes} frames)")

    meta = {
        "variable": "wind_100m",
        "description": f"{step_hours}-hourly 100m wind (ERA5) as u/v components",
        "source": "Open-Meteo ERA5 archive",
        "units": "m/s",
        "year": year,
        "startDate": start_date,
        "endDate": end_date,
        "stepHours": step_hours,
        "nframes": nframes,
        "lonMin": LON_MIN,
        "latMin": LAT_MIN,
        "step": STEP,
        "nlon": nlon,
        "nlat": nlat,
        "scale": SCALE,
        "speedMax": round(speed_max, 1),
        "bin": bin_name,
    }
    meta_path = os.path.join(BASE_DIR, "wind_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote {meta_path}")


def fetch_states():
    """Download and simplify US state boundaries for map context."""
    print("Fetching US state boundaries...")
    with urlopen(STATES_URL, timeout=120) as resp:
        gj = json.loads(resp.read().decode())

    def round_ring(ring):
        return [[round(x, 2), round(y, 2)] for x, y in ring]

    features = []
    for feat in gj.get("features", []):
        geom = feat.get("geometry")
        if not geom:
            continue
        gtype = geom["type"]
        coords = geom["coordinates"]
        if gtype == "Polygon":
            new_coords = [round_ring(r) for r in coords]
        elif gtype == "MultiPolygon":
            new_coords = [[round_ring(r) for r in poly] for poly in coords]
        else:
            continue
        features.append({
            "type": "Feature",
            "properties": {"name": feat.get("properties", {}).get("name", "")},
            "geometry": {"type": gtype, "coordinates": new_coords},
        })

    out = {"type": "FeatureCollection", "features": features}
    os.makedirs(BASE_DIR, exist_ok=True)
    path = os.path.join(BASE_DIR, "us-states.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    size_kb = os.path.getsize(path) / 1024
    print(f"Wrote {path} ({size_kb:.1f} KB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-date", default=DEFAULT_START)
    parser.add_argument("--end-date", default=DEFAULT_END)
    parser.add_argument("--step-hours", type=int, default=STEP_HOURS)
    parser.add_argument("--skip-states", action="store_true")
    parser.add_argument("--skip-wind", action="store_true")
    args = parser.parse_args()

    if not args.skip_states:
        fetch_states()
    if not args.skip_wind:
        fetch_wind(args.start_date, args.end_date, args.step_hours)


if __name__ == "__main__":
    main()
