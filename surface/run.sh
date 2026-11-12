#!/bin/sh
# Starts one surface in this terminal pane. Ctrl+Q quits.
# `hws surface open` sets the HWS_* and COMPANION_* variables listed in docs/CONTRACT.md.

here="$(cd "$(dirname "$0")" && pwd)"

for name in HWS_SURFACE_ID HWS_SURFACE_TYPE COMPANION_SOCKET COMPANION_DATA_DIR; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "surface/run.sh: $name is required" >&2
    exit 2
  fi
done

if [ ! -f "$here/app/out/main/index.cjs" ]; then
  echo "surface/run.sh: build the app first, with pnpm build in $here/app" >&2
  exit 2
fi

mkdir -p "$COMPANION_DATA_DIR"

export HWS_BIN="${HWS_BIN:-$here/../bin/hws}"

# Pixel's state stays private to this surface. `hws` gets the original back, because hc builds its socket path from it.
export HWS_OUTER_XDG_STATE_HOME="${XDG_STATE_HOME-}"
export XDG_STATE_HOME="$COMPANION_DATA_DIR/state"
export PIXEL_TTY="$(tty)"
unset ELECTRON_RUN_AS_NODE COMPANION_TEST

# A pane shows about 5 whole frames a second, so the page draws at 30 and not at the display's rate.
export PIXEL_FPS="${PIXEL_FPS:-30}"

# The pane header shows the terminal's title, which is its address until something sets it.
# A control character would end the sequence early, so tr drops them.
title="$(printf '%s' "${HWS_SURFACE_TITLE:-}" | tr -d '\000-\037\177')"
printf '\033]2;%s\007' "${title:-$HWS_SURFACE_TYPE}"

exec "$(sh "$here/pixel-path.sh")" "$here/host.cjs" 2>>"$COMPANION_DATA_DIR/host.stderr.log"
