#!/usr/bin/env bash
# Relève la carte pour la version JavaScript (sans WebAssembly) : la version native du moteur,
# sans affichage ni son, charge la carte générée et enregistre le déroulé de la partie.
#   scripts/export-js.sh <dossier de build natif> <carte .sav> <dossier de sortie>
# Produit world.json, world.bin et sprites.bin (voir engine/src/portfolio_export.cpp).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="$(cd "$1" && pwd)"
SAVE="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
mkdir -p "$3"
OUT="$(cd "$3" && pwd)"
CACHE="${CACHE_DIR:-$ROOT/third_party/cache}"
# deux ans de jeu (74 ticks par jour) : le déroulé est ensuite rejoué en boucle
TICKS="${TICKS:-54020}"

WORK="$(mktemp -d)"
[ -n "${KEEP_WORK:-}" ] || trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home" XDG_DATA_HOME="$WORK/home/.local/share" XDG_CONFIG_HOME="$WORK/home/.config"
DATA="$XDG_DATA_HOME/openttd"
mkdir -p "$DATA/baseset" "$XDG_CONFIG_HOME/openttd"
cp "$CACHE"/opengfx-8.0/*.grf "$CACHE"/opengfx-8.0/opengfx.obg "$DATA/baseset/"
# mêmes réglages que dans le navigateur (affichage, zoom, indicateurs de chargement...)
cp "$ROOT/config/openttd.cfg" "$WORK/openttd.cfg"

cd "$NATIVE"
OPENTTD_PORTFOLIO_EXPORT="$OUT" OPENTTD_PORTFOLIO_EXPORT_TICKS="$TICKS" \
  ./openttd -vnull:ticks="$((TICKS + 2))" -snull -mnull -c "$WORK/openttd.cfg" -g "$SAVE" 2>&1 | grep -E "portfolio-export|rror" || true
[ -s "$OUT/world.json" ] || { echo "ERREUR : relevé de la carte incomplet" >&2; exit 1; }
ls -la "$OUT"
