#!/usr/bin/env bash
# Télécharge (une seule fois) les sources d'OpenTTD et ses jeux de base libres officiels,
# depuis le CDN d'OpenTTD, et vérifie leurs sommes SHA-256.
# Rien d'autre n'est téléchargé : ni image, ni son, ni police, ni NewGRF tiers.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${CACHE_DIR:-$ROOT/third_party/cache}"
mkdir -p "$CACHE"

CDN=https://cdn.openttd.org
FILES=(
  "openttd-releases/15.3/openttd-15.3-source.tar.xz 5ea21eea7d59c78a42071924ac18c6bc0116088f2e96b14cfee9369175973be7"
  "opengfx-releases/8.0/opengfx-8.0-all.zip 43a0c1dabf39cb865394f3a6cc36d4da5c10ecfaaf55652043104806810903be"
  "opensfx-releases/1.0.3/opensfx-1.0.3-all.zip e0a218b7dd9438e701503b0f84c25a97c1c11b7c2f025323fb19d6db16ef3759"
  "openmsx-releases/0.4.2/openmsx-0.4.2-all.zip 5a4277a2e62d87f2952ea5020dc20fb2f6ffafdccf9913fbf35ad45ee30ec762"
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

# Extraction des jeux de base (zip -> tar -> fichiers)
for set in opengfx-8.0 opensfx-1.0.3 openmsx-0.4.2; do
  if [ ! -d "$CACHE/$set" ]; then
    tmp="$(mktemp -d)"
    python3 -I -m zipfile -e "$CACHE/$set-all.zip" "$tmp"
    tar -xf "$tmp/$set.tar" -C "$CACHE"
    rm -rf "$tmp"
  fi
done
echo "==> Sources prêtes dans $CACHE"
