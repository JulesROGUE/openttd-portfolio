#!/usr/bin/env bash
# Assemble le client web dans dist/openttd :
#   carte (générée par la version native), paquet de données Emscripten, bruitages et
#   coquille web, avec le numéro de build injecté dans index.html (?v=<build>).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${CACHE_DIR:-$ROOT/third_party/cache}"
OUT="$ROOT/dist/openttd"
FS="$ROOT/build/fsroot"

echo "==> Carte du portfolio"
mkdir -p "$ROOT/build/out"
"$ROOT/scripts/gen-map.sh" "$ROOT/build/native" "$ROOT/build/out/portfolio.sav"

echo "==> Système de fichiers du jeu"
rm -rf "$FS" "$OUT"
mkdir -p "$FS/baseset/opengfx" "$FS/baseset/openmsx" "$FS/lang" "$FS/game/PortfolioGS" "$OUT/sfx"
cp "$ROOT/build/out/portfolio.sav" "$FS/portfolio.sav"
cp "$ROOT/config/openttd.cfg" "$FS/openttd.cfg"
cp "$ROOT/build/wasm/lang/english.lng" "$FS/lang/"
# fichiers d'OpenTTD (graphismes complémentaires, jeux « vides » de secours)
for f in openttd.grf orig_extra.grf no_sound.obs no_music.obm; do cp "$ROOT/build/wasm/baseset/$f" "$FS/baseset/"; done
# OpenGFX : seulement ce que charge le climat tempéré (voir README)
cp "$CACHE"/opengfx-8.0/{opengfx.obg,ogfx1_base.grf,ogfxe_extra.grf,ogfxi_logos.grf,license.txt} "$FS/baseset/opengfx/"
# OpenMSX : musiques MIDI (≈ 0,8 Mo), jouées par le synthé Web Audio
cp "$CACHE"/openmsx-0.4.2/{openmsx.obm,*.mid,license.txt} "$FS/baseset/openmsx/"
cp "$ROOT"/gamescript/*.nut "$FS/game/PortfolioGS/"

echo "==> Paquet de données Emscripten"
PACKAGER="$(dirname "$(command -v emcc)")/tools/file_packager.py"
[ -f "$PACKAGER" ] || PACKAGER="$(dirname "$(command -v emcc)")/tools/file_packager"
python3 "$PACKAGER" "$OUT/openttd.data" --preload "$FS@/" --js-output="$OUT/openttd-data.js" --no-node

echo "==> Bruitages OpenSFX (téléchargés au premier clic)"
cp "$CACHE"/opensfx-1.0.3/{opensfx.obs,opensfx.cat} "$OUT/sfx/"

echo "==> Moteur et coquille web"
cp "$ROOT/build/wasm/openttd.js" "$ROOT/build/wasm/openttd.wasm" "$OUT/"
cp "$ROOT"/web/{index.html,portfolio.js,portfolio.css,midisynth.js} "$OUT/"
BUILD="$(cat "$OUT"/openttd.js "$OUT"/openttd.wasm "$OUT"/openttd-data.js "$OUT"/openttd.data "$OUT"/*.css "$OUT"/portfolio.js "$OUT"/midisynth.js | sha1sum | cut -c1-12)"
sed -i "s/__BUILD__/$BUILD/g" "$OUT/index.html"
echo "==> Build $BUILD"
ls -la "$OUT" "$OUT/sfx"
