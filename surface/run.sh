#!/bin/zsh
# Starts one surface in this terminal pane. Ctrl+Q quits.
# `hws surface open` sets the HWS_* and COMPANION_* variables listed in docs/CONTRACT.md.

here="${0:A:h}"

for name in HWS_SURFACE_ID HWS_SURFACE_TYPE COMPANION_SOCKET COMPANION_DATA_DIR; do
  if [[ -z "${(P)name}" ]]; then
    print -u2 "surface/run.sh: $name is required"
    exit 2
  fi
done

if [[ ! -f "$here/app/out/main/index.cjs" ]]; then
  print -u2 "surface/run.sh: build the app first, with pnpm build in $here/app"
  exit 2
fi

mkdir -p "$COMPANION_DATA_DIR"

export HWS_BIN="${HWS_BIN:-$here/../bin/hws}"

# Pixel's state stays private to this surface. `hws` gets the original back, because hc builds its socket path from it.
export HWS_OUTER_XDG_STATE_HOME="${XDG_STATE_HOME-}"
export XDG_STATE_HOME="$COMPANION_DATA_DIR/state"
export PIXEL_TTY="$(tty)"
unset ELECTRON_RUN_AS_NODE COMPANION_TEST

exec "$here/node_modules/@zenbu-labs/pixel/electron/dist/Electron.app/Contents/MacOS/pixel" "$here/host.cjs" 2>>"$COMPANION_DATA_DIR/host.stderr.log"
