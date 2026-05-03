"""
Generates src/data/schedules.json from the Ilevia GTFS feed.

Strategy:
  - 3 day profiles: WEEKDAY, SATURDAY, SUNDAY
  - One representative date per profile (the day with the most active services)
  - Times stored as integers = minutes since midnight (325 for 05:25)
  - Regular bus lines only (excludes tram, metro, night buses)
  - Stores GTFS stop_ids per (stop, line, direction) for reliable matching
    with the live API's identifiant_station field

Output format:
  {
    "meta": { "generated", "gtfs_from", "gtfs_until", "source", "profiles" },
    "routes": {
      "LINE_CODE": {
        "long_name": "LIANE 5",
        "terminus":  "MARCQ FERME AUX OIES / HAUBOURDIN LE PARC"
      }
    },
    "stops": {
      "STOP_NORM_UPPER": {
        "LINE_CODE": {
          "DIRECTION_UPPER": {
            "WEEKDAY":  [int, ...],
            "SATURDAY": [int, ...],
            "SUNDAY":   [int, ...],
            "_stopIds": ["stop_id_1", "stop_id_2", ...]
          }
        }
      }
    }
  }

Usage: python scripts/build_schedules.py
"""

import urllib.request, zipfile, io, csv, json, collections, re, unicodedata
from datetime import datetime, date
from pathlib import Path

GTFS_URL = "https://media.ilevia.fr/opendata/gtfs.zip"
OUT_PATH = Path(__file__).parent.parent / "src" / "data" / "schedules.json"
MIN_TIMES_PER_STOP = 5


def strip_accents(s):
    """Remove diacritical marks from a string."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def normalize_stop(name):
    """Normalize a stop name to uppercase without accents."""
    return strip_accents(name.strip()).upper()


def is_regular_bus(route_short_name, route_type):
    """Returns True if the route is a regular daytime bus (not tram/metro/night)."""
    name = (route_short_name or "").strip().upper()
    if not name:
        return False
    # route_type: 0=tram, 1=metro, 2=rail, 12=monorail — skip all
    if str(route_type) in ("0", "1", "2", "12"):
        return False
    # Night buses start with "N" followed by digits
    if re.match(r"^N\d", name):
        return False
    return True


def normalize_time(t):
    """Convert a GTFS time string (e.g. "25:10:00") to minutes since midnight."""
    parts = t.split(":")
    if len(parts) < 2:
        return None
    try:
        h, m = int(parts[0]), int(parts[1])
        return (h % 24) * 60 + m
    except ValueError:
        return None


def pick_representative_dates(svc_dates):
    """Pick one representative date per day type (WEEKDAY/SATURDAY/SUNDAY)
    by choosing the date with the maximum number of active services."""
    date_counts = collections.Counter()
    for dates in svc_dates.values():
        for d in dates:
            date_counts[d] += 1

    by_type = {"WEEKDAY": [], "SATURDAY": [], "SUNDAY": []}
    for d_str, count in date_counts.items():
        try:
            d = date(int(d_str[:4]), int(d_str[4:6]), int(d_str[6:]))
        except ValueError:
            continue
        wd = d.weekday()
        if wd < 5:
            by_type["WEEKDAY"].append((count, d_str))
        elif wd == 5:
            by_type["SATURDAY"].append((count, d_str))
        else:
            by_type["SUNDAY"].append((count, d_str))

    return {p: max(v)[1] for p, v in by_type.items() if v}


def main():
    print(f"Downloading GTFS from {GTFS_URL} ...")
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "build_schedules/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        content = r.read()
    print(f"  {len(content) / 1e6:.1f} MB downloaded")
    z = zipfile.ZipFile(io.BytesIO(content))

    # ── Read stops.txt ──────────────────────────────────────────────────────
    print("Reading stops.txt ...")
    stops = {}
    with z.open("stops.txt") as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            stops[row["stop_id"]] = normalize_stop(row.get("stop_name", ""))

    # ── Read routes.txt ─────────────────────────────────────────────────────
    print("Reading routes.txt ...")
    bus_routes = {}    # route_id -> line_code (short name)
    route_meta = {}    # line_code -> {long_name, terminus}
    with z.open("routes.txt") as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            if is_regular_bus(row.get("route_short_name", ""), row.get("route_type", "3")):
                code = row["route_short_name"].strip().upper()
                bus_routes[row["route_id"]] = code
                long_name = row.get("route_long_name", "").strip()
                terminus  = row.get("route_desc", "").strip()
                # Title-case both fields for display
                long_name = long_name.title() if long_name else ""
                # Normalize terminus: split on any "/" or "<>" separator, clean each part, rejoin with " <> "
                terminus = terminus.title() if terminus else ""
                parts = [p.strip() for p in re.split(r'\s*[/<>]+\s*', terminus) if p.strip()]
                terminus = " <> ".join(parts) if len(parts) > 1 else (parts[0] if parts else "")
                route_meta[code] = {"long_name": long_name, "terminus": terminus}
    print(f"  {len(bus_routes)} bus routes")

    # ── Read trips.txt ──────────────────────────────────────────────────────
    print("Reading trips.txt ...")
    bus_trips = {}
    with z.open("trips.txt") as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            rid = row.get("route_id", "")
            if rid in bus_routes:
                head = normalize_stop(row.get("trip_headsign", ""))
                bus_trips[row["trip_id"]] = (bus_routes[rid], head, row.get("service_id", ""))
    print(f"  {len(bus_trips)} bus trips")

    # ── Read calendar_dates.txt ─────────────────────────────────────────────
    print("Reading calendar_dates.txt ...")
    svc_dates = collections.defaultdict(set)
    date_min, date_max = "99999999", "00000000"
    with z.open("calendar_dates.txt") as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            if row.get("exception_type") == "1":
                d = row["date"]
                svc_dates[row["service_id"]].add(d)
                if d < date_min:
                    date_min = d
                if d > date_max:
                    date_max = d

    profiles = pick_representative_dates(svc_dates)
    print(f"  Period covered: {date_min} -> {date_max}")
    print(f"  Profiles: {profiles}")

    # Map service_id -> set of profiles it participates in
    svc_profile = collections.defaultdict(set)
    for profile, d_str in profiles.items():
        for svc_id, dates in svc_dates.items():
            if d_str in dates:
                svc_profile[svc_id].add(profile)

    # ── Read stop_times.txt ─────────────────────────────────────────────────
    print("Reading stop_times.txt ...")
    schedules = collections.defaultdict(
        lambda: collections.defaultdict(
            lambda: collections.defaultdict(
                lambda: collections.defaultdict(set)
            )
        )
    )

    # Collect GTFS stop_ids per (stop_norm, line, direction)
    stop_ids_map = collections.defaultdict(
        lambda: collections.defaultdict(
            lambda: collections.defaultdict(set)
        )
    )

    row_count = kept = 0
    with z.open("stop_times.txt") as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            row_count += 1
            if row_count % 500_000 == 0:
                print(f"  ... {row_count:,} rows / {kept:,} kept")
            trip = bus_trips.get(row.get("trip_id", ""))
            if not trip:
                continue
            line, direction, svc_id = trip
            trip_profiles = svc_profile.get(svc_id)
            if not trip_profiles:
                continue
            raw_stop_id = row.get("stop_id", "")
            stop_norm = stops.get(raw_stop_id, "")
            if not stop_norm:
                continue
            tm = normalize_time(row.get("departure_time", ""))
            if tm is None:
                continue
            stop_ids_map[stop_norm][line][direction].add(raw_stop_id)
            for profile in trip_profiles:
                schedules[stop_norm][line][direction][profile].add(tm)
                kept += 1

    print(f"  {row_count:,} rows read, {kept:,} kept, {len(schedules)} stops")

    # ── Build output ────────────────────────────────────────────────────────
    out_stops = {}
    excluded = 0
    profile_order = ["WEEKDAY", "SATURDAY", "SUNDAY"]

    for stop_norm, lines in schedules.items():
        total = sum(
            len(times)
            for dirs in lines.values()
            for pd in dirs.values()
            for times in pd.values()
        )
        if total < MIN_TIMES_PER_STOP:
            excluded += 1
            continue
        out_stops[stop_norm] = {}
        for line, dirs in lines.items():
            out_stops[stop_norm][line] = {}
            for direction, pd in dirs.items():
                entry = {p: sorted(pd[p]) for p in profile_order if p in pd}
                if entry:
                    ids = stop_ids_map.get(stop_norm, {}).get(line, {}).get(direction, set())
                    entry["_stopIds"] = sorted(ids)
                    out_stops[stop_norm][line][direction] = entry

    print(f"  {excluded} stops excluded, {len(out_stops)} kept")
    total_times = sum(
        len(times)
        for lines in out_stops.values()
        for dirs in lines.values()
        for pd in dirs.values()
        for times in pd.values()
    )
    print(f"  {total_times:,} schedule entries stored (integers)")

    result = {
        "meta": {
            "generated": datetime.now().strftime("%Y-%m-%d"),
            "gtfs_from": f"{date_min[:4]}-{date_min[4:6]}-{date_min[6:]}",
            "gtfs_until": f"{date_max[:4]}-{date_max[4:6]}-{date_max[6:]}",
            "source": GTFS_URL,
            "profiles": profiles,
        },
        "routes": route_meta,
        "stops": out_stops,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

    size = OUT_PATH.stat().st_size
    print(f"\n  {OUT_PATH.name}  --  {size / 1024:.0f} KB ({size / 1e6:.2f} MB)")
    print(f"    Period: {result['meta']['gtfs_from']} -> {result['meta']['gtfs_until']}")
    print(f"    Profiles: {profiles}")

    # Print a preview for key stops
    for key in ("CHU EURASANTE", "PORTE DES POSTES", "POINT CENTRAL"):
        entry = out_stops.get(key)
        if entry:
            print(f"\n  Preview: {key}")
            for line, dirs in list(entry.items())[:2]:
                for direction, pd in list(dirs.items())[:1]:
                    stop_ids = pd.get("_stopIds", [])
                    for profile, times in pd.items():
                        if profile.startswith("_"):
                            continue
                        hhmm = [f"{t // 60:02d}:{t % 60:02d}" for t in times[:3]]
                        print(f"    {line} -> {direction[:35]} [{profile}]: {hhmm} ({len(times)} entries)")
                    print(f"      _stopIds: {stop_ids[:5]}{'...' if len(stop_ids) > 5 else ''}")


if __name__ == "__main__":
    main()
