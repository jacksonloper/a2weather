#!/usr/bin/env python3
"""
Process the National Weather Service Coded Surface Bulletins dataset
(Zenodo record 2646544) into compact "episode" JSON files for the web app.

The source archive contains one JSON bulletin every 3 hours since 2003,
describing the locations of weather fronts, troughs, and pressure centers
analyzed by the NWS Weather Prediction Center.

Shipping every bulletin for the whole 2003-2018 record would be far too much
data for a web page, so instead we export a handful of short **episodes** at
full 3-hourly time resolution. Each episode is a 24-day window around a
notable weather event. For every 3-hour slot we keep the high-resolution (HR)
analysis when available and fall back to the low-resolution (LR) analysis
otherwise. Coordinates are rounded to one decimal degree (the native HR
precision) to keep each episode around a megabyte.

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
from datetime import date, timedelta

OUTPUT_DIR = os.path.join(
    os.path.dirname(__file__), "..", "public", "data", "fronts"
)

# Curated 24-day episodes at full 3-hourly resolution. Each is chosen around a
# memorable North American weather event so the animation has plenty of motion.
EPISODES = [
    {
        "id": "blizzard-2011",
        "label": "Feb 2011 Blizzard",
        "note": "The groundhog-day blizzard buried the Midwest and Northeast.",
        "start": date(2011, 1, 26),
        "days": 24,
    },
    {
        "id": "outbreak-2011",
        "label": "Apr 2011 Tornado Outbreak",
        "note": "The 2011 Super Outbreak — one of the largest on record.",
        "start": date(2011, 4, 14),
        "days": 24,
    },
    {
        "id": "sandy-2012",
        "label": "Hurricane Sandy 2012",
        "note": "Sandy's transition into a massive hybrid storm over the East.",
        "start": date(2012, 10, 18),
        "days": 24,
    },
]

# Frontal feature keys in the source JSON -> short names used by the web app.
FRONT_KEYS = {
    "ColdFronts": "cold",
    "WarmFronts": "warm",
    "OccludedFronts": "occluded",
    "StationaryFronts": "stationary",
    "Troughs": "trough",
}

NAME_RE = re.compile(r"Codsus_(\d{4})(\d{2})(\d{2})(\d{2})_(HR|LR)\.json$")


def episode_dates(ep):
    """Set of ISO date strings covered by an episode window."""
    return {(ep["start"] + timedelta(days=i)).isoformat()
            for i in range(ep["days"])}


def choose_bulletins(names, wanted_dates):
    """Pick one bulletin per (date, hour) slot within the wanted dates.

    Preference: high-resolution over low-resolution. Returns a dict mapping
    member name -> (iso_date, hour) for the winners.
    """
    # (iso_date, hour) -> list of (name, is_hr)
    by_slot = {}
    for name in names:
        m = NAME_RE.search(name)
        if not m:
            continue
        year, month, day, hour = (int(m.group(i)) for i in range(1, 5))
        iso = f"{year:04d}-{month:02d}-{day:02d}"
        if iso not in wanted_dates:
            continue
        is_hr = m.group(5) == "HR"
        by_slot.setdefault((iso, hour), []).append((name, is_hr))

    winners = {}
    for (iso, hour), entries in by_slot.items():
        entries.sort(key=lambda e: (not e[1],))  # HR first
        winners[entries[0][0]] = (iso, hour)
    return winners


def round_line(lats, lons):
    return [[round(float(la), 1), round(float(lo), 1)]
            for la, lo in zip(lats, lons)]


def build_frame(raw, iso_date, hour):
    frame = {"date": iso_date, "hour": hour}
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
    ep_dir = os.path.join(out_dir, "episodes")
    os.makedirs(ep_dir, exist_ok=True)

    # Union of all wanted dates, and which episode each member belongs to.
    ep_date_sets = {ep["id"]: episode_dates(ep) for ep in EPISODES}
    all_wanted = set().union(*ep_date_sets.values())

    print(f"Scanning archive {archive_path} ...")
    with tarfile.open(archive_path, "r:gz") as tar:
        names = [m.name for m in tar.getmembers() if m.isfile()]
    print(f"Found {len(names)} bulletins")

    winners = choose_bulletins(names, all_wanted)
    print(f"Selected {len(winners)} full-resolution bulletins across "
          f"{len(EPISODES)} episodes")

    frames_by_ep = {ep["id"]: [] for ep in EPISODES}
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
            iso, hour = winners[member.name]
            frame = build_frame(raw, iso, hour)
            for ep_id, dates in ep_date_sets.items():
                if iso in dates:
                    frames_by_ep[ep_id].append(frame)

    index = []
    for ep in EPISODES:
        frames = sorted(frames_by_ep[ep["id"]], key=lambda f: (f["date"], f["hour"]))
        path = os.path.join(ep_dir, f"{ep['id']}.json")
        with open(path, "w") as f:
            json.dump(frames, f, separators=(",", ":"))
        size_kb = os.path.getsize(path) / 1024
        end = ep["start"] + timedelta(days=ep["days"] - 1)
        index.append({
            "id": ep["id"],
            "label": ep["label"],
            "note": ep["note"],
            "start": ep["start"].isoformat(),
            "end": end.isoformat(),
            "frames": len(frames),
        })
        print(f"  wrote episodes/{ep['id']}.json  "
              f"({len(frames)} frames, {size_kb:.0f} KB)")

    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump({
            "source": "NWS Coded Surface Bulletins (Zenodo 2646544)",
            "sourceUrl": "https://zenodo.org/records/2646544",
            "resolution": "3-hourly",
            "episodes": index,
        }, f, indent=2)

    print("Done.")


if __name__ == "__main__":
    main()
