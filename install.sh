#!/bin/sh
# Installs or updates Herdr Workspaces from this checkout. Safe to run again.
# --force replaces installed mods and rebuilds the surface.

set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
RELEASES="${HWS_RELEASE_URL:-https://github.com/skyam25/herdr-workspaces/releases/download}"
BUNDLE="$ROOT/surface/app/out/main/index.cjs"
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
PNPM_VERSION=12.15.0
FORCE=0
MODS_OK=1

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) echo "usage: install.sh [--force]" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$1"; }
warn() { echo "warning: $1" >&2; }
stop() { echo "error: $1" >&2; exit 1; }

check_prerequisites() {
  case "$(uname -s)" in
    Darwin|Linux) ;;
    *) stop "Herdr Workspaces runs on macOS and Linux" ;;
  esac
  command -v node >/dev/null || stop "Node 20 or newer is required"
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || stop "Node 20 or newer is required"
  command -v npm >/dev/null || stop "npm is required"
  command -v herdr-app >/dev/null || stop "herdr-app is not on PATH. Install Herdr from https://herdr.dev first"
}

link_cli() {
  say "CLI"
  link="$HOME/.local/bin/hws"
  mkdir -p "$HOME/.local/bin"
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$ROOT/bin/hws" ]; then
    echo "already linked: $link"
  elif [ -L "$link" ] && [ "$FORCE" -eq 1 ]; then
    ln -sfn "$ROOT/bin/hws" "$link" && echo "relinked: $link"
  elif [ -e "$link" ] || [ -L "$link" ]; then
    warn "$link belongs to something else, so it stays. A symlink can be replaced with --force"
  else
    ln -s "$ROOT/bin/hws" "$link" && echo "linked: $link"
  fi
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) warn "$HOME/.local/bin is not on PATH, so typing hws in a shell won't find it" ;;
  esac
}

install_mods() {
  say "Herdr mods"
  if [ "$FORCE" -eq 1 ]; then
    sh "$ROOT/mods/install.sh" --force || { warn "some mods failed their check"; MODS_OK=0; }
  else
    sh "$ROOT/mods/install.sh" || { warn "some mods failed their check"; MODS_OK=0; }
  fi
}

# A new install shows its layout. Later runs keep the layout the person chose.
show_layout() {
  [ "$NEW_LAYOUT" -eq 1 ] && [ "$MODS_OK" -eq 1 ] || return 0
  say "Layout"
  if herdr-app do layout.switch --name hws >/dev/null 2>&1; then
    echo "The Herdr window now shows the hws layout. Run herdr-app do layout.switch --name main to go back."
  else
    echo "Herdr is not open. Open it and run herdr-app do layout.switch --name hws to show Workspaces in the sidebar."
  fi
}

# Pixel downloads its Electron build from GitHub, which can answer 504 for a minute at a time.
install_pixel_packages() {
  for attempt in 1 2 3 4; do
    (cd "$ROOT/surface" && npm ci) && return 0
    [ "$attempt" -eq 4 ] && break
    warn "Pixel did not download on attempt $attempt of 4, so trying again"
    sleep $((attempt * ${HWS_RETRY_SECONDS:-15}))
  done
  return 1
}

install_pixel() {
  say "Pixel"
  pixel="$(sh "$ROOT/surface/pixel-path.sh")"
  if [ -x "$pixel" ] && [ "$FORCE" -eq 0 ]; then
    echo "already installed"
  else
    install_pixel_packages || warn "Pixel did not install, so boards, notes and page review won't open. Run this script again to retry"
  fi
}

# CI publishes a prebuilt surface for each version of surface/app, named by its git tree.
# Local edits to surface/app have no prebuilt version, so they build.
download_app() {
  [ -z "$(git -C "$ROOT" status --porcelain -- surface/app 2>/dev/null)" ] || return 1
  tree="$(git -C "$ROOT" rev-parse HEAD:surface/app 2>/dev/null)" || return 1
  command -v curl >/dev/null || return 1
  tmp="$(mktemp -d)" || return 1
  url="$RELEASES/surface-prebuilt/surface-$tree.tar.gz"
  if curl -fsSL "$url" -o "$tmp/app.tgz" \
    && curl -fsSL "$url.sha256" -o "$tmp/app.sha256" \
    && node -e 'const c=require("crypto"),f=require("fs"),[a,s]=process.argv.slice(1);process.exit(c.createHash("sha256").update(f.readFileSync(a)).digest("hex")===f.readFileSync(s,"utf8").trim().split(/\s+/)[0]?0:1)' "$tmp/app.tgz" "$tmp/app.sha256" \
    && mkdir "$tmp/unpacked" \
    && tar -xzf "$tmp/app.tgz" -C "$tmp/unpacked" \
    && [ -f "$tmp/unpacked/out/main/index.cjs" ]; then
    rm -rf "$ROOT/surface/app/out"
    mv "$tmp/unpacked/out" "$ROOT/surface/app/out"

    # The dictation helper is a macOS binary.
    [ "$(uname -s)" = Darwin ] || rm -f "$tmp/unpacked/bin/agent-brief-dictate"
    mkdir -p "$ROOT/surface/app/bin"
    cp -f "$tmp/unpacked/bin/"* "$ROOT/surface/app/bin/"

    rm -rf "$tmp"
    echo "downloaded the prebuilt surface"
    return 0
  fi
  rm -rf "$tmp"
  echo "no prebuilt surface for this commit, so building it"
  return 1
}

# npm supplies the pnpm that the lockfile and allowBuilds expect, so nobody installs it.
pnpm_run() {
  npm exec --yes --package="pnpm@$PNPM_VERSION" -- pnpm "$@"
}

build_app() {
  say "Surface app"
  if [ -f "$BUNDLE" ] && [ "$FORCE" -eq 0 ]; then
    echo "already built"
    return
  fi
  download_app && return
  (cd "$ROOT/surface/app" && pnpm_run install --frozen-lockfile && pnpm_run build) \
    || warn "the surface did not build, so boards, notes and page review won't open. Run this script again to retry"
}

install_plugin() {
  say "Claude plugin"
  if ! command -v claude >/dev/null; then
    warn "Claude Code is not on PATH, so the plugin was skipped"
    return
  fi
  if ! claude plugin marketplace list 2>/dev/null | grep -q herdr-workspaces; then
    claude plugin marketplace add "$ROOT" || { warn "could not add the plugin marketplace"; return; }
  fi
  claude plugin marketplace update herdr-workspaces || warn "could not refresh the plugin marketplace"
  claude plugin install herdr-workspaces@herdr-workspaces || warn "could not install the plugin"
  claude plugin update herdr-workspaces@herdr-workspaces || warn "could not update the plugin"
}

check_prerequisites
NEW_LAYOUT=1
[ ! -f "$APP_HOME/layouts/hws.json" ] || NEW_LAYOUT=0
link_cli
install_mods
install_pixel
build_app
install_plugin
show_layout

say "Check"
"$ROOT/bin/hws" doctor
status=$?

if [ "$status" -eq 0 ]; then
  say "Next"
  echo "Herdr loads mods and layouts live, so it needs no restart."
  echo "Run /reload-plugins in open Claude Code sessions, or start new ones, to load the plugin."
  echo "Keep this folder at $ROOT, because hws and the plugin run from it."
  echo "Optional key bindings are in $ROOT/mods/keys.example.json. Copy the ones you want to $APP_HOME/keys.json."
fi

exit "$status"
