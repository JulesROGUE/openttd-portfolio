#!/usr/bin/env bash
# Télécharge (une seule fois) les sources d'OpenTTD et le jeu de graphismes libre OpenGFX,
# depuis le CDN d'OpenTTD, et vérifie leurs sommes SHA-256.
# Rien d'autre n'est téléchargé : ni image, ni son, ni musique, ni police, ni NewGRF tiers.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${CACHE_DIR:-$ROOT/third_party/cache}"
mkdir -p "$CACHE"

CDN=https://cdn.openttd.org
FILES=(
  "openttd-releases/15.3/openttd-15.3-source.tar.xz 5ea21eea7d59c78a42071924ac18c6bc0116088f2e96b14cfee9369175973be7"
  "opengfx-releases/8.0/opengfx-8.0-all.zip 43a0c1dabf39cb865394f3a6cc36d4da5c10ecfaaf55652043104806810903be"
)

for entry in "${FILES[@]}"; do
  read -r path sum <<<"$entry"
  file="$CACHE/$(basename "$path")"
  if [ ! -f "$file" ] || ! echo "$sum  $file" | sha256sum -c --quiet - 2>/dev/null; then
    echo "==> Téléchargement de $CDN/$path"
    curl -fsSL --retry 3 -o "$file.part" "$CDN/$path"
    echo "$sum  $file.part" | sha256sum -c --quiet -
    mv "$file.part" "$file"
  fi
done

# Extraction du jeu de base (zip -> tar -> fichiers)
for set in opengfx-8.0; do
  if [ ! -d "$CACHE/$set" ]; then
    tmp="$(mktemp -d)"
    python3 -I -m zipfile -e "$CACHE/$set-all.zip" "$tmp"
    tar -xf "$tmp/$set.tar" -C "$CACHE"
    rm -rf "$tmp"
  fi
done
echo "==> Sources prêtes dans $CACHE"
