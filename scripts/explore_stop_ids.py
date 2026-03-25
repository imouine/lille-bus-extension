"""
Exploration script: downloads the GTFS feed and queries the live API
to compare GTFS stop_ids against API identifiant_station values.

Usage: python scripts/explore_stop_ids.py
"""
import urllib.request, zipfile, io, csv, json

GTFS_URL = "https://media.ilevia.fr/opendata/gtfs.zip"
API_URL  = "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aprochains_passages/items?f=json&limit=200"

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "explore/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def main():
    # 1) Fetch GTFS stop_ids for POINT CENTRAL
    print("Downloading GTFS ...")
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "explore/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        content = r.read()
    z = zipfile.ZipFile(io.BytesIO(content))

    # stops.txt: stop_id -> stop_name
    stops = {}
    with z.open("stops.txt") as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            stops[row["stop_id"]] = row.get("stop_name", "")

    # Print stop_ids matching POINT CENTRAL
    print("\n--- GTFS stop_ids containing 'POINT CENTRAL' ---")
    for sid, name in sorted(stops.items()):
        if "POINT CENTRAL" in name.upper():
            print(f"  stop_id={sid}  name={name}")

    # 2) Query live API for POINT CENTRAL
    print("\n--- Live API for POINT CENTRAL ---")
    filter_url = f"{API_URL}&filter=nom_station+LIKE+'%25POINT+CENTRAL'"
    data = fetch_json(filter_url)
    recs = data.get("records", data.get("features", []))
    print(f"API record count: {len(recs)}")

    seen = set()
    for r in recs:
        props = r.get("properties", r) if "properties" in r else r
        key = (props.get("identifiant_station"), props.get("code_ligne"), props.get("sens_ligne"))
        if key not in seen:
            seen.add(key)
            print(f"  identifiant_station={props.get('identifiant_station')}  "
                  f"code_ligne={props.get('code_ligne')}  "
                  f"sens_ligne={props.get('sens_ligne')}  "
                  f"nom_station={props.get('nom_station')}")

    # 3) Also check PORTE DES POSTES for verification
    print("\n--- Live API for PORTE DES POSTES ---")
    filter_url2 = f"{API_URL}&filter=nom_station+LIKE+'%25PORTE+DES+POSTES'"
    data2 = fetch_json(filter_url2)
    recs2 = data2.get("records", data2.get("features", []))
    seen2 = set()
    for r in recs2:
        props = r.get("properties", r) if "properties" in r else r
        key = (props.get("identifiant_station"), props.get("code_ligne"), props.get("sens_ligne"))
        if key not in seen2:
            seen2.add(key)
            print(f"  identifiant_station={props.get('identifiant_station')}  "
                  f"code_ligne={props.get('code_ligne')}  "
                  f"sens_ligne={props.get('sens_ligne')}  "
                  f"nom_station={props.get('nom_station')}")

    # 4) Compare formats
    print("\n--- Format comparison ---")
    print("GTFS stop_id for POINT CENTRAL:")
    for sid, name in sorted(stops.items()):
        if "POINT CENTRAL" in name.upper():
            print(f"  {sid}")
    print("\nAPI identifiant_station for POINT CENTRAL:")
    for key in sorted(seen):
        print(f"  {key[0]}")

if __name__ == "__main__":
    main()
