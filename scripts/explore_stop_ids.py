"""
Script d'exploration : télécharge le GTFS + interroge l'API live
pour comparer stop_id GTFS vs identifiant_station API.

Usage : python3 scripts/explore_stop_ids.py
"""
import urllib.request, zipfile, io, csv, json, collections

GTFS_URL = "https://media.ilevia.fr/opendata/gtfs.zip"
API_URL  = "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aprochains_passages/items?f=json&limit=200"

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "explore/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def main():
    # 1) Récupère les stop_id GTFS pour POINT CENTRAL
    print("Téléchargement GTFS ...")
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "explore/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        content = r.read()
    z = zipfile.ZipFile(io.BytesIO(content))

    # stops.txt : stop_id -> stop_name
    stops = {}
    with z.open("stops.txt") as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            stops[row["stop_id"]] = row.get("stop_name", "")

    # Affiche les stop_id pour POINT CENTRAL
    print("\n--- stop_id GTFS contenant 'POINT CENTRAL' ---")
    for sid, name in sorted(stops.items()):
        if "POINT CENTRAL" in name.upper():
            print(f"  stop_id={sid}  name={name}")

    # 2) Interroge l'API live pour POINT CENTRAL
    print("\n--- API live pour POINT CENTRAL ---")
    filter_url = f"{API_URL}&filter=nom_station+LIKE+'%25POINT+CENTRAL'"
    data = fetch_json(filter_url)
    recs = data.get("records", data.get("features", []))
    print(f"Nombre de records API: {len(recs)}")

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

    # 3) Interroge aussi PORTE DES POSTES pour vérifier
    print("\n--- API live pour PORTE DES POSTES ---")
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

    # 4) Comparer les formats
    print("\n--- Comparaison des formats ---")
    print("GTFS stop_id pour POINT CENTRAL:")
    for sid, name in sorted(stops.items()):
        if "POINT CENTRAL" in name.upper():
            print(f"  {sid}")
    print("\nAPI identifiant_station pour POINT CENTRAL:")
    for key in sorted(seen):
        print(f"  {key[0]}")

if __name__ == "__main__":
    main()

