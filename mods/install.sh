#!/bin/sh
# Copies the Herdr Workspaces mods into the Herdr app home and checks each one.
# An installed mod is left alone unless --force is given. Never edits keys.json.

set -eu

MODS="hws-new hws-panel hws-brief"
SOURCE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) echo "usage: install.sh [--force]" >&2; exit 2 ;;
  esac
done

mkdir -p "$TARGET"

failed=0
for mod in $MODS; do
  dest="$TARGET/$mod"
  if [ -d "$dest" ] && [ "$FORCE" -eq 0 ]; then
    echo "$mod: already installed, skipped (use --force to replace)"
  else
    mkdir -p "$dest"

    # Source files only. Herdr writes its own gpui-kit.d.ts and jsconfig.json.
    for file in "$SOURCE/$mod"/*; do
      case "$(basename "$file")" in
        gpui-kit.d.ts|jsconfig.json) ;;
        *.js|*.json|*.svg) cp "$file" "$dest/" ;;
      esac
    done
    echo "$mod: installed to $dest"
  fi

  if herdr-app check "$dest"; then
    echo "$mod: check passed"
  else
    echo "$mod: check FAILED" >&2
    failed=1
  fi
done

exit "$failed"
