#!/usr/bin/env bash
# Lille Bus Extension - Chrome Web Store Packaging Script
# Creates a clean .zip of the src/ folder ready for CWS upload.
# Usage:  ./scripts/package.sh
# Output: dist/lille-bus-extension-v{version}.zip

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/src"
DIST_DIR="$ROOT/dist"

VERSION=$(python3 -c "import json; print(json.load(open('$SRC_DIR/manifest.json'))['version'])")

echo ""
echo "  Lille Bus Extension - Packaging"
echo "  Version: $VERSION"
echo ""

mkdir -p "$DIST_DIR"

ZIP_NAME="lille-bus-extension-v$VERSION.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

if [ -f "$ZIP_PATH" ]; then
    rm -f "$ZIP_PATH"
fi

echo "  Zipping src/ ..."
(cd "$SRC_DIR" && zip -r -9 "$ZIP_PATH" .)

SIZE_KB=$(python3 -c "import os; print(round(os.path.getsize('$ZIP_PATH') / 1024, 1))")

echo ""
echo "  Done! $ZIP_NAME - ${SIZE_KB} KB"
echo "  $ZIP_PATH"
echo ""
