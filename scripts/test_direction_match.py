"""
Vérifie que la nouvelle directionMatches() couvre tous les cas de mismatch.
"""

def direction_matches(sens, gtfs_dir):
    if not sens or not gtfs_dir:
        return False
    if sens == gtfs_dir:
        return True

    def norm(s):
        import re
        s = s.replace("'", " ").replace("\u2019", " ").replace("-", " ").replace(".", "")
        s = s.upper()
        s = re.sub(r'\bCENTRE\b', 'CTRE', s)
        s = re.sub(r'\bSAINT\b', 'ST', s)
        s = re.sub(r'\bSAINTE\b', 'STE', s)
        return [w for w in s.split() if w]

    sens_words = norm(sens)
    gtfs_words = set(norm(gtfs_dir))
    significant = [w for w in sens_words if len(w) >= 4]
    if not significant:
        return False
    return all(
        w in gtfs_words or any(g.startswith(w) or w.startswith(g) for g in gtfs_words)
        for w in significant
    )

cases = [
    # (sens_ligne API,                  direction GTFS,                          attendu)
    ("MARCQ FERME AUX OIES",            "MARCQ EN BAROEUL FERME AUX OIES",       True),
    ("FACHES CENTRE COMMERCIAL",        "FACHES THUMESNIL CTRE COMMERCIAL",      True),
    ("MARQUETTE LES VOILES",            "MARQUETTE LEZ LILLE LES VOILES",        True),
    ("VILLENEUVE D'ASCQ HOTEL DE VILLE","VILLENEUVE D ASCQ HOTEL DE VILLE",      True),
    ("V. D'ASCQ CONTRESCARPE",          "VILLENEUVE D ASCQ CONTRESCARPE",        True),
    ("HAUBOURDIN LE PARC",              "HAUBOURDIN LE PARC",                    True),
    # Faux positifs à éviter
    ("LOOS LES OLIVEAUX",               "WATTIGNIES CENTRE COMMERCIAL",          False),
    ("HAUBOURDIN LE PARC",              "MARCQ EN BAROEUL FERME AUX OIES",       False),
]

all_ok = True
for sens, gtfs, expected in cases:
    result = direction_matches(sens, gtfs)
    status = "✅" if result == expected else "❌"
    if result != expected:
        all_ok = False
    print(f"{status} {repr(sens)[:40]:<42} -> {repr(gtfs)[:42]:<44} attendu={expected} got={result}")

print()
print("✅ Tous les cas OK" if all_ok else "❌ Des cas échouent")
