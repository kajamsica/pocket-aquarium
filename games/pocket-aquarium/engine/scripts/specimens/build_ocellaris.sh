#!/bin/sh
set -eu

: "${BLENDER_BIN:?Set BLENDER_BIN to the verified Blender 5.2.1 LTS executable}"

package_dir="art/specimens/ocellaris"
candidate_dir="art/specimens/ocellaris/candidates/local"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --package-dir) package_dir="$2"; shift 2 ;;
    --candidate-dir) candidate_dir="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

version="$($BLENDER_BIN --version | sed -n '1p')"
if [ "$version" != "Blender 5.2.1 LTS" ]; then
  echo "Refusing unpinned Blender binary: $version" >&2
  exit 1
fi

package="$package_dir/specimen.package.json"
blend="$candidate_dir/source.blend"

"$BLENDER_BIN" --background --factory-startup --python scripts/specimens/author_specimen.py -- --package "$package" --candidate-dir "$candidate_dir" --mode author
"$BLENDER_BIN" "$blend" --background --python scripts/specimens/validate_specimen.py -- --package "$package" --candidate-dir "$candidate_dir" --stage source
"$BLENDER_BIN" "$blend" --background --python scripts/specimens/author_specimen.py -- --package "$package" --candidate-dir "$candidate_dir" --mode export
"$BLENDER_BIN" --background --factory-startup --python scripts/specimens/validate_specimen.py -- --package "$package" --candidate-dir "$candidate_dir" --stage runtime
