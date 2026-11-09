#!/bin/bash

# Exits silently with no decision unless this session runs in a Herdr app terminal.

[ "${HWS_PLATFORM:-$(uname -s | tr A-Z a-z)}" != darwin ] || [ "${__CFBundleIdentifier:-}" = "dev.herdr.app" ] || exit 0
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0

# ~/.local/bin comes first, so hc resolves there before the rest of PATH.
export PATH="$HOME/.local/bin:$PATH"

command -v hc >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

# exec keeps this pid. The request file carries it, and the chat checks that it is alive.
exec node "${0%/*}/ask-hook.mjs" 2>/dev/null
