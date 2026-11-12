#!/usr/bin/env bash
# Compile OpenTTD patché deux fois :
#  - en natif (build/native) : outils de compilation (strgen, settingsgen) et version
#    sans affichage qui génère la carte ;
#  - en WebAssembly (build/wasm) avec Emscripten : openttd.js + openttd.wasm.
# Prérequis : image docker/Dockerfile.web (cible base) ou emsdk 3.1.57 + gcc + SDL2.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOBS="${JOBS:-$(nproc)}"
SRC="$ROOT/build/src"
[ -d "$SRC" ] || "$ROOT/scripts/prepare-src.sh"
python3 "$ROOT/tools/gen_data.py" "$ROOT/data/projects.json" "$SRC" "$ROOT/gamescript"

echo "==> OpenTTD natif"
cmake -S "$SRC" -B "$ROOT/build/native" -DCMAKE_BUILD_TYPE=Release -DOPTION_USE_ASSERTS=OFF >/dev/null
make -C "$ROOT/build/native" -j"$JOBS" openttd

echo "==> OpenTTD WebAssembly"
# port liblzma fourni par OpenTTD (os/emscripten/ports)
PORTS="$(dirname "$(command -v emcc)")/tools/ports/contrib"
[ -f "$PORTS/liblzma.py" ] || cp "$SRC/os/emscripten/ports/liblzma.py" "$PORTS/"
emcmake cmake -S "$SRC" -B "$ROOT/build/wasm" -DHOST_BINARY_DIR="$ROOT/build/native" \
  -DCMAKE_BUILD_TYPE=Release -DOPTION_USE_ASSERTS=OFF >/dev/null
emmake make -C "$ROOT/build/wasm" -j"$JOBS" openttd
ls -la "$ROOT/build/wasm/openttd.js" "$ROOT/build/wasm/openttd.wasm"
