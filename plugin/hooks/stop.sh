#!/bin/bash

# Stays silent and exits 0 on every path, so it can never hold up a turn.

[ -n "${HC_TERMINAL_ID:-}" ] || exit 0

# ~/.local/bin comes first, so hws resolves there before the rest of PATH.
export PATH="$HOME/.local/bin:$PATH"

command -v hws >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

node "${0%/*}/stop.mjs" >/dev/null 2>&1
exit 0
