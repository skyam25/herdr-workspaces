#!/bin/bash

# Records a document this session wrote, so Outputs lists it as touched.
# Exits 0 on every path, so it can never fail a tool call.

[ "${HWS_PLATFORM:-$(uname -s | tr A-Z a-z)}" != darwin ] || [ "${__CFBundleIdentifier:-}" = "dev.herdr.app" ] || exit 0
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0

# ~/.local/bin comes first, so hws resolves there before the rest of PATH.
export PATH="$HOME/.local/bin:$PATH"

command -v hws >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

node "${0%/*}/output-touch.mjs" 2>/dev/null
exit 0
