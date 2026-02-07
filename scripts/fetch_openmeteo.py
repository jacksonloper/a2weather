#!/usr/bin/env python3
"""
Fetch historical weather data for Ann Arbor from Open-Meteo API.
Stores daily temperature data (min, mean, max) to CSV.
"""

import csv
import json
import os
from datetime import date, timedelta
from urllib.request import urlopen
from urllib.parse import urlencode

# Ann Arbor, Michigan coordinates
LATITUDE = 42.2808
LONGITUDE = -83.7430

# Open-Meteo Archive API endpoint
API_URL = "https://archive-api.open-meteo.com/v1/archive"

# Output path (relative to repo root)
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "data", "openmeteo", "temps.csv")


def fetch_weather_data(start_date: date, end_date: date) -> list[dict]:
    """Fetch historical weather data from Open-Meteo API."""
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "daily": "temperature_2m_max,temperature_2m_min,temperature_2m_mean",
        "temperature_unit": "fahrenheit",
        "timezone": "America/Detroit",
    }
    
    url = f"{API_URL}?{urlencode(params)}"
    print(f"Fetching data from {start_date} to {end_date}...")
    
    with urlopen(url, timeout=60) as response:
        data = json.loads(response.read().decode())
    
    daily = data.get("daily", {})
    dates = daily.get("time", [])
    temps_max = daily.get("temperature_2m_max", [])
    temps_min = daily.get("temperature_2m_min", [])
    temps_mean = daily.get("temperature_2m_mean", [])
    
    records = []
    for i, d in enumerate(dates):
        if temps_min[i] is not None and temps_max[i] is not None:
            records.append({
                "date": d,
                "temp_min": temps_min[i],
                "temp_max": temps_max[i],
                "temp_mean": temps_mean[i] if temps_mean[i] is not None else (temps_min[i] + temps_max[i]) / 2,
            })
    
    return records


def load_existing_data(filepath: str) -> dict[str, dict]:
    """Load existing CSV data into a dict keyed by date."""
    existing = {}
    if os.path.exists(filepath):
        with open(filepath, "r", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                existing[row["date"]] = row
    return existing


def save_data(filepath: str, records: list[dict]):
    """Save records to CSV file."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    # Sort by date
    records = sorted(records, key=lambda x: x["date"])
    
    with open(filepath, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["date", "temp_min", "temp_max", "temp_mean"])
        writer.writeheader()
        writer.writerows(records)
    
    print(f"Saved {len(records)} records to {filepath}")


def main():
    output_path = os.path.abspath(OUTPUT_PATH)
    
    # Open-Meteo archive goes back to 1940
    # Start from 1950 for cleaner data
    start_date = date(1950, 1, 1)
    # End date is yesterday (today's data may not be complete)
    end_date = date.today() - timedelta(days=1)
    
    # Load existing data to merge
    existing = load_existing_data(output_path)
    print(f"Found {len(existing)} existing records")
    
    # Determine what data we need to fetch
    if existing:
        # Find the latest date in existing data
        latest_existing = max(existing.keys())
        fetch_start = date.fromisoformat(latest_existing) + timedelta(days=1)
        if fetch_start > end_date:
            print("Data is already up to date!")
            return
        print(f"Fetching new data from {fetch_start} to {end_date}")
    else:
        fetch_start = start_date
        print(f"Fetching all data from {fetch_start} to {end_date}")
    
    # Open-Meteo limits requests, so fetch in chunks if needed
    # Max is about 10 years per request for daily data
    all_records = list(existing.values())
    
    current_start = fetch_start
    chunk_days = 365 * 5  # 5 years at a time
    
    while current_start <= end_date:
        current_end = min(current_start + timedelta(days=chunk_days), end_date)
        
        try:
            new_records = fetch_weather_data(current_start, current_end)
            # Convert to dict format matching CSV
            for rec in new_records:
                all_records.append({
                    "date": rec["date"],
                    "temp_min": f"{rec['temp_min']:.1f}",
                    "temp_max": f"{rec['temp_max']:.1f}",
                    "temp_mean": f"{rec['temp_mean']:.1f}",
                })
            print(f"  Fetched {len(new_records)} records")
        except Exception as e:
            print(f"  Error fetching {current_start} to {current_end}: {e}")
        
        current_start = current_end + timedelta(days=1)
    
    # Deduplicate by date (prefer newer data)
    by_date = {}
    for rec in all_records:
        by_date[rec["date"]] = rec
    
    save_data(output_path, list(by_date.values()))


if __name__ == "__main__":
    main()
