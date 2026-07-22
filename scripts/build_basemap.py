#!/usr/bin/env python3
"""
Build a compact North America basemap (country outlines + US state
boundaries) for the fronts player from Natural Earth 110m GeoJSON.

Downloads:
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_1_states_provinces.geojson

Usage:
    python scripts/build_basemap.py countries.geojson states.geojson
"""

import json
import os
import sys

OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "public", "data", "fronts", "basemap.json"
)

# Geographic window covering North and Central America.
LON_MIN, LON_MAX = -172.0, -48.0
LAT_MIN, LAT_MAX = 5.0, 78.0


def bbox_intersects(geom):
    """True if the geometry's bounding box overlaps the target window."""
    xs, ys = [], []

    def walk(coords):
        if not coords:
            return
        if isinstance(coords[0], (int, float)):
            xs.append(coords[0])
            ys.append(coords[1])
        else:
            for c in coords:
                walk(c)

    walk(geom.get("coordinates"))
    if not xs:
        return False
    return not (max(xs) < LON_MIN or min(xs) > LON_MAX
                or max(ys) < LAT_MIN or min(ys) > LAT_MAX)


def round_coords(coords):
    """Recursively round coordinates to 2 decimals, dropping repeats."""
    if not coords:
        return coords
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 2), round(coords[1], 2)]
    if isinstance(coords[0][0], (int, float)):
        # A ring / line of positions.
        out = []
        prev = None
        for pt in coords:
            r = [round(pt[0], 2), round(pt[1], 2)]
            if r != prev:
                out.append(r)
                prev = r
        return out
    return [round_coords(c) for c in coords]


def simplify_geometry(geom):
    return {"type": geom["type"],
            "coordinates": round_coords(geom["coordinates"])}


def collect(path):
    data = json.load(open(path))
    geoms = []
    for feat in data["features"]:
        geom = feat.get("geometry")
        if not geom or not bbox_intersects(geom):
            continue
        geoms.append(simplify_geometry(geom))
    return geoms


def main():
    if len(sys.argv) < 3:
        print("Usage: python scripts/build_basemap.py <countries.geojson> <states.geojson>")
        sys.exit(1)

    countries = collect(sys.argv[1])
    states = collect(sys.argv[2])

    out = {"countries": countries, "states": states}
    out_path = os.path.abspath(OUTPUT_PATH)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    size_kb = os.path.getsize(out_path) / 1024
    print(f"Wrote {out_path}: {len(countries)} countries, "
          f"{len(states)} states, {size_kb:.0f} KB")


if __name__ == "__main__":
    main()
