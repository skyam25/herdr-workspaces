#!/bin/sh
# Copies the Herdr Workspaces mods into the Herdr app home and checks each one.
# An installed mod is left alone unless --force is given. Never edits keys.json.
#
# Herdr reloads a mod whenever one of its files is saved, so only files that
# differ are written.

set -eu

SOURCE="$(cd "$(dirname "$0")" && pwd)"
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
TARGET="$APP_HOME/mods"
LAYOUTS="$APP_HOME/layouts"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) echo "usage: install.sh [--force]" >&2; exit 2 ;;
  esac
done

changed=0

# Copies a file or folder, skipping every file that already matches.
put() {
  if [ -d "$1" ]; then
    mkdir -p "$2"
    for entry in "$1"/*; do
      [ -e "$entry" ] || continue
      put "$entry" "$2/$(basename "$entry")"
    done
  elif ! cmp -s "$1" "$2"; then
    cp "$1" "$2"
    changed=$((changed + 1))
  fi
}

mkdir -p "$TARGET"

failed=0
for folder in "$SOURCE"/hws-*/; do
  mod="$(basename "$folder")"
  dest="$TARGET/$mod"
  if [ -d "$dest" ] && [ "$FORCE" -eq 0 ]; then
    echo "$mod: already installed, skipped (use --force to replace)"
  else
    mkdir -p "$dest"
    changed=0

    # Source files only. Herdr writes its own gpui-kit.d.ts and jsconfig.json.
    for file in "$SOURCE/$mod"/*; do
      name="$(basename "$file")"
      case "$name" in
        gpui-kit.d.ts|jsconfig.json) ;;
        *.js|*.json|*.svg|*.py|core) put "$file" "$dest/$name" ;;
      esac
    done

    if [ "$changed" -gt 0 ]; then
      echo "$mod: updated $changed file(s) in $dest"
    else
      echo "$mod: already current"
    fi
  fi

  if herdr-app check "$dest"; then
    echo "$mod: check passed"
  else
    echo "$mod: check FAILED" >&2
    failed=1
  fi
done

mkdir -p "$LAYOUTS"
if [ -f "$LAYOUTS/hws.json" ] && [ "$FORCE" -eq 0 ]; then
  echo "hws layout: already installed, skipped (use --force to replace)"
else
  changed=0
  put "$SOURCE/layouts/hws.json" "$LAYOUTS/hws.json"
  if [ "$changed" -gt 0 ]; then
    echo "hws layout: installed to $LAYOUTS/hws.json"
  else
    echo "hws layout: already current"
  fi
fi

exit "$failed"
