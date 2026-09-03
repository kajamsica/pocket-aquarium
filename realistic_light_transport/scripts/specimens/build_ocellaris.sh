#!/bin/sh
set -eu

: "${BLENDER_BIN:?Set BLENDER_BIN to the verified Blender 5.2.1 LTS executable}"

version="$($BLENDER_BIN --version | sed -n '1p')"
if [ "$version" != "Blender 5.2.1 LTS" ]; then
  echo "Refusing unpinned Blender binary: $version" >&2
  exit 1
fi

"$BLENDER_BIN" --background --factory-startup --python scripts/specimens/author_ocellaris.py --
