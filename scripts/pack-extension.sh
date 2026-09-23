#!/usr/bin/env bash
# Packs extension/ into a zip the site can hand out directly, and records what it packed.
#
# The site is the distribution channel until the Chrome Web Store listing exists, and for a
# security tool "download this zip" is only acceptable with something to check it against -
# so the SHA-256 travels with it and is printed in the download dialog. Anyone can run
# `shasum -a 256` on the file they got and compare.
#
# Chrome writes _metadata/ into a loaded unpacked extension; it is generated, machine-local
# and must never ship.

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/extension"
out="$root/frontend/public/edgerun-extension.zip"
meta="$root/frontend/lib/extension-meta.json"

if ! command -v zip >/dev/null 2>&1; then
  if [ -f "$out" ]; then
    echo "pack-extension: no zip(1) available, keeping the existing $out" >&2
    exit 0
  fi
  echo "pack-extension: zip(1) is required and there is no existing archive to fall back to" >&2
  exit 1
fi

version="$(node -p "require('$src/manifest.json').version")"

rm -f "$out"
mkdir -p "$(dirname "$out")" "$(dirname "$meta")"
( cd "$src" && zip -qr "$out" . -x '_metadata/*' 'tests/*' '.DS_Store' '*/.DS_Store' '*.map' )

bytes="$(wc -c < "$out" | tr -d ' ')"
if command -v shasum >/dev/null 2>&1; then
  sha="$(shasum -a 256 "$out" | cut -d' ' -f1)"
else
  sha="$(sha256sum "$out" | cut -d' ' -f1)"
fi

cat > "$meta" <<JSON
{
  "version": "$version",
  "bytes": $bytes,
  "sha256": "$sha",
  "packedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "pack-extension: v$version, $bytes bytes"
echo "pack-extension: sha256 $sha"
