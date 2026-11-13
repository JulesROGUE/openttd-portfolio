#!/usr/bin/env bash
# Compile OpenTTD patché en natif (build/native) : version sans affichage ni son qui génère
# la carte puis relève tout ce qu'il faut au moteur JavaScript (scripts/export-js.sh).
# Il n'y a plus de version WebAssembly : le navigateur exécute un port JavaScript (web/ottd).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOBS="${JOBS:-$(nproc)}"
SRC="$ROOT/build/src"
[ -d "$SRC" ] || "$ROOT/scripts/prepare-src.sh"
python3 "$ROOT/tools/gen_data.py" "$ROOT/data/projects.json" "$SRC" "$ROOT/gamescript"

echo "==> OpenTTD natif"
# polices en sprites (OpenGFX) uniquement, comme dans le navigateur : ni FreeType ni Fontconfig
cmake -S "$SRC" -B "$ROOT/build/native" -DCMAKE_BUILD_TYPE=Release -DOPTION_USE_ASSERTS=OFF \
  -DCMAKE_DISABLE_FIND_PACKAGE_Freetype=ON -DCMAKE_DISABLE_FIND_PACKAGE_Fontconfig=ON \
  -DCMAKE_DISABLE_FIND_PACKAGE_ICU=ON -DCMAKE_DISABLE_FIND_PACKAGE_Harfbuzz=ON >/dev/null
make -C "$ROOT/build/native" -j"$JOBS" openttd
ls -la "$ROOT/build/native/openttd"
