"""Generate the compact, exact theoretical timetable used by the extension.

The generated format keeps stable GTFS station identifiers and the exact
calendar dates attached to every service profile. This prevents same-name
stops (for example the many stops named "Mairie") from being merged and avoids
applying an ordinary weekday timetable to school holidays.

Usage:
    python3 scripts/build_schedules.py
    python3 scripts/build_schedules.py --gtfs /path/to/gtfs.zip
"""

import argparse
import collections
import csv
from datetime import datetime
import io
import json
from pathlib import Path
import re
import unicodedata
import urllib.request
import zipfile


GTFS_URL = "https://media.ilevia.fr/opendata/gtfs.zip"
OUT_PATH = Path(__file__).parent.parent / "src" / "data" / "schedules.json"


def strip_accents(value):
    return "".join(
        char for char in unicodedata.normalize("NFD", value)
        if unicodedata.category(char) != "Mn"
    )


def normalize_stop(name):
    return strip_accents(str(name or "").strip()).upper()


def extract_city(description):
    """Extract the municipality following the postal code in stops.txt."""
    match = re.search(r"\b\d{5}\s+(.+?)\s*$", str(description or ""))
    return normalize_stop(match.group(1)) if match else ""


def station_label(name, city, duplicate_name=False):
    """Return a concise label, adding the municipality only when useful."""
    name = normalize_stop(name)
    city = normalize_stop(city)
    if duplicate_name and city and city not in name:
        return f"{name} — {city}"
    return name


def is_regular_bus(route_short_name, route_type):
    name = str(route_short_name or "").strip().upper()
    return bool(name) and str(route_type) not in ("0", "1", "2", "12")


def normalize_time(value):
    """Convert a GTFS time (including 25:10) to minutes since service midnight."""
    parts = str(value or "").split(":")
    if len(parts) < 2:
        return None
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return None


def is_boardable_stop_time(row, last_sequence):
    """Exclude a trip's final row and rows explicitly forbidding pickup."""
    try:
        sequence = int(row.get("stop_sequence", ""))
    except (TypeError, ValueError):
        return False
    if last_sequence is None or sequence >= last_sequence:
        return False
    return row.get("pickup_type", "").strip() != "1"


def base36(number):
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    if number == 0:
        return "0"
    result = ""
    while number:
        number, remainder = divmod(number, 36)
        result = alphabet[remainder] + result
    return result


def read_zip(path=None):
    if path:
        print(f"Reading GTFS from {path} ...")
        return zipfile.ZipFile(path)
    print(f"Downloading GTFS from {GTFS_URL} ...")
    request = urllib.request.Request(GTFS_URL, headers={"User-Agent": "build_schedules/2.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        content = response.read()
    print(f"  {len(content) / 1e6:.1f} MB downloaded")
    return zipfile.ZipFile(io.BytesIO(content))


def read_rows(archive, filename):
    with archive.open(filename) as handle:
        yield from csv.DictReader(io.TextIOWrapper(handle, encoding="utf-8-sig"))


def main(gtfs_path=None):
    archive = read_zip(gtfs_path)

    print("Reading stops.txt ...")
    stop_rows = {row["stop_id"]: row for row in read_rows(archive, "stops.txt")}
    station_meta = {}
    stop_to_station = {}
    for stop_id, row in stop_rows.items():
        parent = str(row.get("parent_station", "")).strip()
        station_id = parent or stop_id
        stop_to_station[stop_id] = station_id
        source = stop_rows.get(station_id, row)
        metadata = station_meta.setdefault(station_id, {
            "name": normalize_stop(source.get("stop_name", "")),
            "city": extract_city(source.get("stop_desc", "")),
            "lat": source.get("stop_lat", ""),
            "lon": source.get("stop_lon", ""),
        })
        if not metadata["name"]:
            metadata["name"] = normalize_stop(row.get("stop_name", ""))

    print("Reading routes.txt ...")
    bus_routes = {}
    route_meta = {}
    for row in read_rows(archive, "routes.txt"):
        if not is_regular_bus(row.get("route_short_name"), row.get("route_type", "3")):
            continue
        code = row["route_short_name"].strip().upper()
        bus_routes[row["route_id"]] = code
        long_name = row.get("route_long_name", "").strip().title()
        raw_terminus = row.get("route_desc", "").strip().title()
        parts = [part.strip() for part in re.split(r"\s*[/<>]+\s*", raw_terminus) if part.strip()]
        terminus = " <> ".join(parts) if len(parts) > 1 else (parts[0] if parts else "")
        route_meta[code] = {"long_name": long_name, "terminus": terminus}
    print(f"  {len(bus_routes)} bus routes")

    print("Reading trips.txt ...")
    bus_trips = {}
    used_services = set()
    for row in read_rows(archive, "trips.txt"):
        route_id = row.get("route_id", "")
        if route_id not in bus_routes:
            continue
        service_id = row.get("service_id", "")
        bus_trips[row["trip_id"]] = (
            bus_routes[route_id],
            normalize_stop(row.get("trip_headsign", "")),
            service_id,
        )
        used_services.add(service_id)
    print(f"  {len(bus_trips)} bus trips")

    print("Reading exact service calendars ...")
    service_dates = collections.defaultdict(set)
    for row in read_rows(archive, "calendar_dates.txt"):
        service_id = row.get("service_id", "")
        if service_id in used_services and row.get("exception_type") == "1":
            service_dates[service_id].add(row["date"])
    if not service_dates:
        raise RuntimeError("No active bus service dates found in calendar_dates.txt")
    all_dates = sorted({value for dates in service_dates.values() for value in dates})
    date_min, date_max = all_dates[0], all_dates[-1]

    patterns = sorted({tuple(sorted(dates)) for dates in service_dates.values()})
    pattern_ids = {pattern: base36(index) for index, pattern in enumerate(patterns)}
    service_profile = {
        service_id: pattern_ids[tuple(sorted(dates))]
        for service_id, dates in service_dates.items()
    }
    calendar = collections.defaultdict(list)
    for pattern, profile_id in pattern_ids.items():
        for raw_date in pattern:
            key = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
            calendar[key].append(profile_id)
    exact_calendar = {day: sorted(ids) for day, ids in sorted(calendar.items())}
    print(f"  {len(patterns)} compact profiles, {len(exact_calendar)} exact dates")

    print("Identifying terminal stop_times ...")
    last_stop_sequence = {}
    for row in read_rows(archive, "stop_times.txt"):
        trip_id = row.get("trip_id", "")
        if trip_id not in bus_trips:
            continue
        try:
            sequence = int(row.get("stop_sequence", ""))
        except (TypeError, ValueError):
            continue
        last_stop_sequence[trip_id] = max(sequence, last_stop_sequence.get(trip_id, -1))
    print(f"  {len(last_stop_sequence):,} trip termini identified")

    schedules = collections.defaultdict(
        lambda: collections.defaultdict(
            lambda: collections.defaultdict(lambda: collections.defaultdict(set))
        )
    )
    stop_ids_map = collections.defaultdict(
        lambda: collections.defaultdict(lambda: collections.defaultdict(set))
    )
    row_count = kept = skipped_terminal = 0
    print("Reading stop_times.txt ...")
    for row in read_rows(archive, "stop_times.txt"):
        row_count += 1
        if row_count % 500_000 == 0:
            print(f"  ... {row_count:,} rows / {kept:,} kept")
        trip_id = row.get("trip_id", "")
        trip = bus_trips.get(trip_id)
        if not trip:
            continue
        line, direction, service_id = trip
        profile_id = service_profile.get(service_id)
        if profile_id is None:
            continue
        if not is_boardable_stop_time(row, last_stop_sequence.get(trip_id)):
            skipped_terminal += 1
            continue
        physical_stop_id = row.get("stop_id", "")
        station_id = stop_to_station.get(physical_stop_id)
        departure = normalize_time(row.get("departure_time", ""))
        if not station_id or not station_meta.get(station_id, {}).get("name") or departure is None:
            continue
        schedules[station_id][line][direction][profile_id].add(departure)
        stop_ids_map[station_id][line][direction].add(physical_stop_id)
        kept += 1

    used_name_counts = collections.Counter(station_meta[key]["name"] for key in schedules)
    out_stops = {}
    label_counts = collections.Counter()
    for station_id, lines in schedules.items():
        meta = station_meta[station_id]
        label = station_label(meta["name"], meta["city"], used_name_counts[meta["name"]] > 1)
        label_counts[label] += 1
        if label_counts[label] > 1:
            label = f"{label} · {station_id}"
        out_lines = {}
        for line, directions in lines.items():
            out_lines[line] = {}
            for direction, by_profile in directions.items():
                out_lines[line][direction] = {
                    "times": {
                        profile_id: sorted(times)
                        for profile_id, times in sorted(by_profile.items())
                    },
                    "_stopIds": sorted(stop_ids_map[station_id][line][direction]),
                }
        station = {"name": meta["name"], "label": label, "lines": out_lines}
        if meta["city"]:
            station["city"] = meta["city"]
        try:
            station["lat"] = round(float(meta["lat"]), 6)
            station["lon"] = round(float(meta["lon"]), 6)
        except (TypeError, ValueError):
            pass
        out_stops[station_id] = station

    result = {
        "meta": {
            "format": 2,
            "generated": datetime.now().strftime("%Y-%m-%d"),
            "gtfs_from": f"{date_min[:4]}-{date_min[4:6]}-{date_min[6:]}",
            "gtfs_until": f"{date_max[:4]}-{date_max[4:6]}-{date_max[6:]}",
            "source": GTFS_URL,
            "calendar": exact_calendar,
        },
        "routes": route_meta,
        "stops": dict(sorted(out_stops.items())),
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, separators=(",", ":"))

    total_times = sum(
        len(times)
        for station in out_stops.values()
        for directions in station["lines"].values()
        for entry in directions.values()
        for times in entry["times"].values()
    )
    print(
        f"  {row_count:,} rows read, {kept:,} kept, "
        f"{skipped_terminal:,} terminal/no-pickup rows skipped"
    )
    print(f"  {len(out_stops):,} stations, {total_times:,} timetable entries")
    print(f"  {OUT_PATH.name} — {OUT_PATH.stat().st_size / 1e6:.2f} MB")
    print(f"  Period: {result['meta']['gtfs_from']} -> {result['meta']['gtfs_until']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--gtfs", type=Path, help="Use an existing GTFS zip instead of downloading")
    arguments = parser.parse_args()
    main(arguments.gtfs)
