"""
Analyzes mismatches between the API's sens_ligne and GTFS directions in schedules.json.

Usage: python scripts/check_direction_match.py
"""
import urllib.request, urllib.parse, json

base = "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aprochains_passages/items"
params = urllib.parse.urlencode({"f": "json", "limit": "500"})
url = base + "?" + params
req = urllib.request.Request(url, headers={"User-Agent": "test/1.0"})
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)

with open("src/data/schedules.json") as f:
    sched = json.load(f)

mismatches = []
seen = set()
for r in data.get("records", []):
    nom   = r.get("nom_station", "")
    ligne = r.get("code_ligne", "")
    sens  = r.get("sens_ligne", "")
    line_entry = sched["stops"].get(nom, {}).get(ligne, {})
    if not line_entry:
        continue
    gtfs_dirs = list(line_entry.keys())
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
