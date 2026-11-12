"""
Analyzes mismatches between the API's sens_ligne and GTFS directions in schedules.json.

Usage: python scripts/check_direction_match.py
"""
import urllib.request, urllib.parse, json

base = "https://data.lillemetropole.fr/geoserver/dsp_ilevia/ows"
params = urllib.parse.urlencode({
    "service": "WFS",
    "version": "2.0.0",
    "request": "GetFeature",
    "typeNames": "dsp_ilevia:prochains_passages",
    "outputFormat": "application/json",
    "count": "500",
})
url = base + "?" + params
req = urllib.request.Request(url, headers={"User-Agent": "test/1.0"})
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)

with open("src/data/schedules.json") as f:
    sched = json.load(f)

by_stop_id = {}
for station in sched.get("stops", {}).values():
    for line_code, directions in station.get("lines", {}).items():
        for direction, entry in directions.items():
            for stop_id in entry.get("_stopIds", []):
                by_stop_id.setdefault(str(stop_id), []).append((line_code, direction))

mismatches = []
seen = set()
records = [feature.get("properties", feature) for feature in data.get("features", [])]
for r in records:
    ligne = r.get("code_ligne", "")
    sens  = r.get("sens_ligne", "")
    stop_id = str(r.get("code_arret_physique", ""))
    gtfs_dirs = [direction for line, direction in by_stop_id.get(stop_id, []) if line == ligne]
    if not gtfs_dirs:
        continue
    exact  = sens in gtfs_dirs
    suffix = any(d.endswith(sens) for d in gtfs_dirs)
    if not exact and not suffix:
        key = (ligne, sens, tuple(sorted(gtfs_dirs)))
        if key not in seen:
            seen.add(key)
            mismatches.append((ligne, sens, gtfs_dirs))

print(f"{len(mismatches)} unmatched cases\n")
for ligne, sens, dirs in mismatches[:30]:
    print(f"  API  : {ligne} | {repr(sens)}")
    print(f"  GTFS : {dirs}")
    print()
