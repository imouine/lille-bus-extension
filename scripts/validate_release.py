"""Validate release metadata and assets without external dependencies."""

from datetime import date, datetime
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"


def fail(message):
    print(f"ERROR: {message}")
    return 1


def png_size(path):
    with path.open("rb") as handle:
        signature = handle.read(24)
    if len(signature) < 24 or signature[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    return struct.unpack(">II", signature[16:24])


def main():
    errors = 0
    manifest = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    version = manifest.get("version")
    if package.get("version") != version:
        errors += fail("package.json and manifest.json versions differ")
    if manifest.get("background", {}).get("type") != "module":
        errors += fail("background service worker must be an ES module")
    if manifest.get("permissions") != ["storage", "alarms"]:
        errors += fail("permissions must remain limited to storage and alarms")
    default_locale = manifest.get("default_locale")
    if default_locale != "fr":
        errors += fail("default_locale must be fr")
    for locale in ("fr", "en"):
        locale_path = SRC / "_locales" / locale / "messages.json"
        if not locale_path.exists():
            errors += fail(f"missing {locale} manifest locale")
        else:
            messages = json.loads(locale_path.read_text(encoding="utf-8"))
            for key in ("extensionName", "extensionDescription", "extensionActionTitle"):
                if not messages.get(key, {}).get("message"):
                    errors += fail(f"missing locale message {locale}/{key}")

    for size in (16, 32, 48, 128):
        relative = manifest.get("icons", {}).get(str(size))
        path = SRC / relative if relative else None
        if not path or not path.exists():
            errors += fail(f"missing {size}px icon")
            continue
        if png_size(path) != (size, size):
            errors += fail(f"{path.name} is not {size}x{size}")

    schedules = json.loads((SRC / "data" / "schedules.json").read_text(encoding="utf-8"))
    meta = schedules.get("meta", {})
    today = date.today().isoformat()
    if meta.get("format") != 2:
        errors += fail("schedules.json must use the exact-calendar v2 format")
    if not meta.get("calendar"):
        errors += fail("schedules.json has no exact service calendar")
    if not (meta.get("gtfs_from", "") <= today <= meta.get("gtfs_until", "")):
        errors += fail(
            f"GTFS fallback does not cover today ({today}); "
            f"range is {meta.get('gtfs_from')} to {meta.get('gtfs_until')}"
        )
    try:
        generated = datetime.strptime(meta.get("generated", ""), "%Y-%m-%d").date()
        age_days = (date.today() - generated).days
        if age_days < 0 or age_days > 30:
            errors += fail(f"schedules.json was generated {age_days} day(s) ago")
    except ValueError:
        errors += fail("schedules.json has an invalid generated date")

    labels = []
    for station_id, station in schedules.get("stops", {}).items():
        if not station_id or not station.get("name") or not station.get("label"):
            errors += fail(f"station {station_id!r} is missing its stable ID, name or label")
            continue
        if not station.get("lines"):
            errors += fail(f"station {station_id} has no lines")
        labels.append(station["label"])
    if len(labels) != len(set(labels)):
        errors += fail("station labels are not unique")

    old_endpoint = "/data/" + "ogcapi/"
    for path in list(SRC.rglob("*.js")) + list(ROOT.glob("scripts/*.py")):
        if old_endpoint in path.read_text(encoding="utf-8"):
            errors += fail(f"legacy MEL endpoint remains in {path.relative_to(ROOT)}")

    if errors:
        print(f"\nRelease validation failed with {errors} error(s).")
        return 1
    print(f"Release {version} validated successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
