#!/usr/bin/env bash
# Assemble le client web dans dist/openttd :
#   carte (générée par la version native), relevé de la carte et de la partie pour le moteur
#   JavaScript (world.json, world.bin, sprites.bin), coquille web et moteur JS, avec le numéro
#   de build injecté dans index.html (?v=<build>). Ni WebAssembly, ni son.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist/openttd"

echo "==> Carte du portfolio"
mkdir -p "$ROOT/build/out"
"$ROOT/scripts/gen-map.sh" "$ROOT/build/native" "$ROOT/build/out/projectsland.sav"

echo "==> Relevé de la carte pour le moteur JavaScript"
rm -rf "$OUT"
mkdir -p "$OUT"
"$ROOT/scripts/export-js.sh" "$ROOT/build/native" "$ROOT/build/out/projectsland.sav" "$OUT"

echo "==> Illustrations des projets (images du portfolio, servies par julesrogue.fr)"
python3 - "$ROOT/data/projects.json" "$OUT/illustrations.json" <<'PY'
import json, sys
projects = json.load(open(sys.argv[1], encoding='utf-8'))
out = {p['id']: {'title': p['title'], 'cover': p.get('cover', ''), 'gallery': p.get('gallery', [])} for p in projects}
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
PY

echo "==> Moteur JavaScript et coquille web"
cp -r "$ROOT"/web/. "$OUT/"
# police du panneau d'illustration : OpenTTD Sans (version TrueType de la police du jeu,
# Zephyris, GPL v2), fournie avec les sources d'OpenTTD
mkdir -p "$OUT/fonts"
cp "$ROOT/build/src/media/baseset/OpenTTD-Sans.ttf" "$ROOT/build/src/media/baseset/OpenTTD-font.md" "$OUT/fonts/"
# licence d'OpenGFX (graphismes relevés dans sprites.bin)
cp "${CACHE_DIR:-$ROOT/third_party/cache}/opengfx-8.0/license.txt" "$OUT/opengfx-license.txt"
BUILD="$(cat "$OUT"/world.json "$OUT"/world.bin "$OUT"/sprites.bin "$OUT"/*.css "$OUT"/portfolio.js "$OUT"/ottd/*.js "$OUT"/illustrations.json | sha1sum | cut -c1-12)"
sed -i "s/__BUILD__/$BUILD/g" "$OUT/index.html"
echo "==> Build $BUILD"
ls -la "$OUT" "$OUT/ottd"
