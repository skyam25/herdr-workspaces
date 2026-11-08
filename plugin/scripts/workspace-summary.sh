#!/bin/bash

# Prints the manifest as JSON, or one sentence saying why there is none.

if [ -z "${HC_TERMINAL_ID:-}" ]; then
  echo "This session is not running in a Herdr terminal."
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"

if ! command -v hws >/dev/null 2>&1; then
  echo "The hws command is not installed."
  exit 0
fi

if ! line=$(hws current --line 2>/dev/null); then
  echo "The hws command could not read this workspace."
  exit 0
fi

if [ -z "$line" ]; then
  echo "This terminal is a normal Herdr tab with no workspace."
  exit 0
fi

if ! hws current --json 2>/dev/null; then
  echo "The hws command could not read this workspace."
fi

exit 0
