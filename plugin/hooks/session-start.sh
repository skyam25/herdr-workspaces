#!/bin/bash

# Stays silent and exits 0 on every path, so it can never fail a session.

[ -n "${HC_TERMINAL_ID:-}" ] || exit 0

# ~/.local/bin comes first, so hws resolves there before the rest of PATH.
export PATH="$HOME/.local/bin:$PATH"

command -v hws >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

node "${0%/*}/session-start.mjs" 2>/dev/null
exit 0
