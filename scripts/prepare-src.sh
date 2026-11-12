#!/usr/bin/env bash
# Prépare les sources patchées d'OpenTTD dans build/src :
# archive officielle 15.3 + engine/openttd-portfolio.patch + fichiers ajoutés (engine/src,
# engine/os) + données des projets (src/portfolio_data.h, généré).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${CACHE_DIR:-$ROOT/third_party/cache}"
SRC="$ROOT/build/src"

rm -rf "$SRC" "$ROOT/build/openttd-15.3"
mkdir -p "$ROOT/build"
tar -xf "$CACHE/openttd-15.3-source.tar.xz" -C "$ROOT/build"
mv "$ROOT/build/openttd-15.3" "$SRC"
patch -d "$SRC" -p1 --no-backup-if-mismatch < "$ROOT/engine/openttd-portfolio.patch"
cp -r "$ROOT/engine/src/." "$SRC/src/"
cp -r "$ROOT/engine/os/." "$SRC/os/"
python3 "$ROOT/tools/gen_data.py" "$ROOT/data/projects.json" "$SRC" "$ROOT/gamescript"
echo "==> Sources prêtes dans $SRC"
