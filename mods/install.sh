#!/bin/sh
# Copies the Herdr Workspaces mods into the Herdr app home and checks each one.
# An installed mod is left alone unless --force is given. Never edits keys.json.

set -eu

MODS="hws-new hws-panel hws-brief hws-pane hws-chat hws-chat-models hws-chat-image hws-actions hws-work hws-tabs hws-agents"
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
        *.js|*.json|*.svg|*.py) cp "$file" "$dest/" ;;
        core) cp -R "$file" "$dest/" ;;
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

mkdir -p "$LAYOUTS"
if [ -f "$LAYOUTS/hws.json" ] && [ "$FORCE" -eq 0 ]; then
  echo "hws layout: already installed, skipped (use --force to replace)"
else
  cp "$SOURCE/layouts/hws.json" "$LAYOUTS/hws.json"
  echo "hws layout: installed to $LAYOUTS/hws.json"
fi

exit "$failed"
