#!/bin/sh
# Prints the executable for a surface in its own window, building it on first use.
# On macOS it is a copy of Pixel named Herdr Surfaces, with Herdr's icon and a Dock icon, so its
# windows show in the Dock, in Cmd-Tab and in App Exposé. Anywhere else it is Pixel itself.
# A build that fails prints Pixel, whose window works but has no Dock icon.

here="$(cd "$(dirname "$0")" && pwd)"
pixel="$(sh "$here/pixel-path.sh")"

[ "$(uname -s)" = Darwin ] || { echo "$pixel"; exit 0; }

source_app="$(dirname "$(dirname "$(dirname "$pixel")")")"
target_dir="$here/node_modules/.herdr-surfaces"
target="$target_dir/Herdr Surfaces.app"
executable="$target/Contents/MacOS/pixel"

# The stamp names this script's version and Pixel's, so a new Pixel rebuilds the copy.
stamp="2 $(cat "$source_app/../version" 2>/dev/null)"
if [ -x "$executable" ] && [ "$(cat "$target_dir/stamp" 2>/dev/null)" = "$stamp" ]; then
  echo "$executable"
  exit 0
fi

build() {
  mkdir -p "$target_dir" || return 1
  work="$(mktemp -d "$target_dir/build.XXXXXX")" || return 1
  app="$work/Herdr Surfaces.app"
  plist="$app/Contents/Info.plist"

  # An APFS clone costs no disk space. Other volumes fall back to a plain copy.
  cp -cR "$source_app" "$app" 2>/dev/null || cp -R "$source_app" "$app" || return 1

  plutil -replace CFBundleName -string 'Herdr Surfaces' "$plist" &&
    plutil -replace CFBundleDisplayName -string 'Herdr Surfaces' "$plist" &&
    plutil -replace CFBundleIdentifier -string 'dev.herdr.workspaces.surfaces' "$plist" || return 1
  plutil -remove LSUIElement "$plist" 2>/dev/null

  for herdr in /Applications/Herdr.app "$HOME/Applications/Herdr.app"; do
    icon="$herdr/Contents/Resources/Herdr.icns"
    if [ -f "$icon" ]; then
      cp "$icon" "$app/Contents/Resources/herdr.icns" &&
        plutil -replace CFBundleIconFile -string herdr.icns "$plist"
      break
    fi
  done

  # Editing Info.plist breaks Pixel's signature, so the copy is signed again, locally.
  codesign --force --sign - --options runtime --preserve-metadata=entitlements "$app" >/dev/null 2>&1 || return 1

  rm -rf "$target" && mv "$app" "$target" && printf '%s\n' "$stamp" > "$target_dir/stamp"
}

if build; then
  rm -rf "$work"
  echo "$executable"
else
  [ -n "${work:-}" ] && rm -rf "$work"
  echo "surface/window-app.sh: could not build Herdr Surfaces.app, so the window uses Pixel" >&2
  echo "$pixel"
fi
