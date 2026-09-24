#!/usr/bin/env bash
# Stamp every screenshot with a content hash, so replacing one is visible immediately.
#
# GitHub Pages serves these with `cache-control: max-age=600`. The filenames never change, so
# after a screenshot is replaced anyone who loaded the page in the last ten minutes keeps
# seeing the old one - which is exactly how a hero image showing a fixed bug went on being
# reported as broken. Ten minutes is not long, but a launch is mostly ten minutes.
#
# The hash goes in the query string rather than the filename: GitHub Pages serves whatever is
# in the directory, so a hashed FILENAME would need the old files left behind or every
# reference rewritten. A query string changes the cache key and nothing else.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shots="$root/frontend/public/shots"
out="$root/frontend/lib/shot-hashes.json"

printf '{\n' > "$out"
first=1
for f in "$shots"/*.jpg "$shots"/*.png; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  sum="$(shasum -a 256 "$f" | cut -c1-8)"
  [ $first -eq 1 ] || printf ',\n' >> "$out"
  printf '  "%s": "%s"' "$name" "$sum" >> "$out"
  first=0
done
printf '\n}\n' >> "$out"

echo "hash-shots: $(grep -c '":' "$out" || true) screenshots stamped"
