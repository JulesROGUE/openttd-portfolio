#!/usr/bin/env bash
# Génère la carte du portfolio avec la version native d'OpenTTD (sans affichage ni son) :
# nouvelle partie avec config/pregen.cfg, le script de jeu PortfolioGS construit villes,
# routes et bus, puis la partie est enregistrée à la sortie (autosave_on_exit).
#   scripts/gen-map.sh <dossier de build natif> <sortie .sav>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="$(cd "$1" && pwd)"
OUT="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
CACHE="${CACHE_DIR:-$ROOT/third_party/cache}"
TICKS="${TICKS:-9000}"

WORK="$(mktemp -d)"
[ -n "${KEEP_WORK:-}" ] || trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home" XDG_DATA_HOME="$WORK/home/.local/share" XDG_CONFIG_HOME="$WORK/home/.config"
DATA="$XDG_DATA_HOME/openttd"
mkdir -p "$DATA/baseset" "$DATA/game/PortfolioGS" "$XDG_CONFIG_HOME/openttd"
cp "$CACHE"/opengfx-8.0/*.grf "$CACHE"/opengfx-8.0/opengfx.obg "$DATA/baseset/"
cp "$ROOT"/gamescript/*.nut "$DATA/game/PortfolioGS/"
cp "$ROOT/config/pregen.cfg" "$WORK/openttd.cfg"

export OPENTTD_PORTFOLIO_PREGEN=1
cd "$NATIVE"
./openttd -vnull:ticks="$TICKS" -snull -mnull -c "$WORK/openttd.cfg" -g -d script=4 2>&1 | tee "$WORK/log.txt" "${LOG:-/dev/null}" | grep -E "dbg: \[script\]|rror" || true
grep -q PORTFOLIO_MAP_DONE "$WORK/log.txt" || { echo "ERREUR : le script de jeu n'a pas terminé la carte" >&2; exit 1; }
SAVE="$(find "$WORK" -name exit.sav | head -1)"
[ -n "$SAVE" ] || { echo "ERREUR : sauvegarde introuvable" >&2; exit 1; }
cp "$SAVE" "$OUT"
echo "==> Carte enregistrée : $OUT ($(stat -c %s "$OUT") octets)"
