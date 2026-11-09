#!/bin/sh
# Prints the path of the Pixel executable for this platform.

dist="$(cd "$(dirname "$0")" && pwd)/node_modules/@zenbu-labs/pixel/electron/dist"

if [ "$(uname -s)" = Darwin ]; then
  echo "$dist/Electron.app/Contents/MacOS/pixel"
else
  echo "$dist/pixel"
fi
