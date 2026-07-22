#!/usr/bin/env python3
"""
Process the National Weather Service Coded Surface Bulletins dataset
(Zenodo record 2646544) into compact per-year JSON files for the web app.

The source archive contains one JSON bulletin every 3 hours since 2003,
describing the locations of weather fronts, troughs, and pressure centers
analyzed by the NWS Weather Prediction Center.

For each day we keep a single bulletin (the one whose valid time is closest
to 12:00 UTC), preferring the high-resolution (HR) analysis when available
and falling back to the low-resolution (LR) analysis otherwise. Coordinates
are rounded to one decimal degree to keep the payload small enough to ship
to the browser.

Usage:
    # Download the archive first (77 MB):
    #   curl -sSL -o CODSUS.tgz \
    #     https://zenodo.org/api/records/2646544/files/CODSUS_JSON_2003-2018.tgz/content
    python scripts/process_fronts.py CODSUS.tgz
"""

import json
import os
import re
import sys
import tarfile

OUTPUT_DIR = os.path.join(
    os.path.dirname(__file__), "..", "public", "data", "fronts"
)

# Frontal feature keys in the source JSON -> short names used by the web app.
FRONT_KEYS = {
    "ColdFronts": "cold",
    "WarmFronts": "warm",
    "OccludedFronts": "occluded",
    "StationaryFronts": "stationary",
    "Troughs": "trough",
}

NAME_RE = re.compile(r"Codsus_(\d{4})(\d{2})(\d{2})(\d{2})_(HR|LR)\.json$")


def choose_bulletins(names):
    """From all member names, pick one bulletin per day.

    Preference order: high-resolution over low-resolution, then the valid
    hour closest to 12:00 UTC. Returns a dict mapping member name -> sort key
    (year, month, day, hour) for the winners.
    """
    # day -> list of (member_name, year, month, day, hour, is_hr)
    by_day = {}
    for name in names:
        m = NAME_RE.search(name)
        if not m:
            continue
        year, month, day, hour = (int(m.group(i)) for i in range(1, 5))
        is_hr = m.group(5) == "HR"
        key = (year, month, day)
        by_day.setdefault(key, []).append((name, year, month, day, hour, is_hr))

    winners = {}
    for key, entries in by_day.items():
        has_hr = any(e[5] for e in entries)
        candidates = [e for e in entries if e[5]] if has_hr else entries
        # Closest to 12:00 UTC wins; ties broken by earlier hour.
        best = min(candidates, key=lambda e: (abs(e[4] - 12), e[4]))
        winners[best[0]] = (best[1], best[2], best[3], best[4])
    return winners


def round_line(lats, lons):
    """Zip parallel lat/lon arrays into rounded [lat, lon] pairs."""
    return [[round(float(la), 1), round(float(lo), 1)]
            for la, lo in zip(lats, lons)]


def build_frame(raw, valid_date, hour):
    """Convert one raw bulletin into a compact frame."""
    frame = {"date": valid_date, "hour": hour}
    for src_key, short in FRONT_KEYS.items():
        lines = []
        for feature in raw.get(src_key, []) or []:
            lats = feature.get("lats") or []
            lons = feature.get("lons") or []
            if len(lats) >= 2 and len(lats) == len(lons):
                lines.append(round_line(lats, lons))
        if lines:
            frame[short] = lines

    for src_key, short in (("Highs", "highs"), ("Lows", "lows")):
        centers = raw.get(src_key) or {}
        lats = centers.get("lats") or []
        lons = centers.get("lons") or []
        pressures = centers.get("pressures") or []
        pts = []
        for i, (la, lo) in enumerate(zip(lats, lons)):
            pressure = pressures[i] if i < len(pressures) else None
            pts.append([round(float(la), 1), round(float(lo), 1),
                        int(pressure) if pressure is not None else None])
        if pts:
            frame[short] = pts
    return frame


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/process_fronts.py <archive.tgz>")
        sys.exit(1)

    archive_path = sys.argv[1]
    out_dir = os.path.abspath(OUTPUT_DIR)
    os.makedirs(out_dir, exist_ok=True)

    print(f"Scanning archive {archive_path} ...")
    with tarfile.open(archive_path, "r:gz") as tar:
        names = [m.name for m in tar.getmembers() if m.isfile()]
    print(f"Found {len(names)} bulletins")

    winners = choose_bulletins(names)
    print(f"Selected {len(winners)} daily bulletins")

    # Stream through the archive once, collecting selected frames per year.
    frames_by_year = {}
    processed = 0
    with tarfile.open(archive_path, "r:gz") as tar:
        for member in tar:
            if member.name not in winners:
                continue
            fobj = tar.extractfile(member)
            if fobj is None:
                continue
            try:
                raw = json.loads(fobj.read().decode("utf-8"))
            except (ValueError, UnicodeDecodeError) as exc:
                print(f"  skipping {member.name}: {exc}")
                continue

            year, month, day, hour = winners[member.name]
            valid_date = f"{year:04d}-{month:02d}-{day:02d}"
            frame = build_frame(raw, valid_date, hour)
            frames_by_year.setdefault(year, []).append(frame)
            processed += 1
            if processed % 500 == 0:
                print(f"  processed {processed}/{len(winners)}")

    index = []
    for year in sorted(frames_by_year):
        frames = sorted(frames_by_year[year], key=lambda f: (f["date"], f["hour"]))
        path = os.path.join(out_dir, f"{year}.json")
        with open(path, "w") as f:
            json.dump(frames, f, separators=(",", ":"))
        size_kb = os.path.getsize(path) / 1024
        index.append({"year": year, "frames": len(frames)})
        print(f"  wrote {year}.json  ({len(frames)} frames, {size_kb:.0f} KB)")

    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump({
            "source": "NWS Coded Surface Bulletins (Zenodo 2646544)",
            "sourceUrl": "https://zenodo.org/records/2646544",
            "years": index,
        }, f, indent=2)

    total = sum(e["frames"] for e in index)
    print(f"Done. {total} daily frames across {len(index)} years.")


if __name__ == "__main__":
    main()
