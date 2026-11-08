# Herdr Workspaces

Typed workspaces for the Herdr desktop app, with boards, notes and page review in panes glued to the terminal that opened them.

Read `docs/NEXT-STEPS.md` for current status and the task list. `docs/CONTRACT.md` is the specification for every command, path and manifest field.

## Layout

| Path | Holds |
|---|---|
| `bin/hws`, `core/` | CLI that creates, tracks and closes workspaces. Node, ESM, no runtime dependencies |
| `surface/` | Pixel host. `surface/app/` is an owned copy of Agent Brief's Electron app |
| `mods/` | Herdr mods `hws-new`, `hws-panel`, `hws-brief`, `hws-pane` and `hws-chat*`, written in GPUI JavaScript. `mods/NOTICE.md` records the Shepherdr import |
| `plugin/` | Claude Code plugin with the session hook, skill and `/workspace` command |

## Commands

| Task | Command |
|---|---|
| CLI tests | `npm test` |
| Mod tests | `cd mods && node --import ./test/register.mjs --test test/simulate.test.mjs test/pane.test.mjs test/statusline.test.mjs test/clipboard.test.mjs test/imagelabels.test.mjs test/codexfind.test.mjs test/codeximages.test.mjs` |
| Mod states | `node mods/test/forced-check.mjs` |
| Plugin tests | `cd plugin && node --test tests/*.test.mjs` |
| Surface tests | `cd surface/app && pnpm test && pnpm compile` |
| Surface in a pty | `python3 surface/test/verify.py` |
| Rebuild the surface | `cd surface/app && pnpm build` |
| Install the mods | `sh mods/install.sh --force` |

## Rules

- Update `docs/CONTRACT.md` when an interface changes.
- Only `hws` writes the manifest. Mods, the surface and the plugin call `hws`.
- Never create a folder per workspace. Workspaces start in the existing parent folder.
- Never guess a terminal. A surface with no live owner offers Open terminal and Copy link.
- User work goes to the macOS Trash and is never deleted outright.
- No background jobs or notifications. Pruning runs inside `hws` commands.
- Keep `hws.js` identical in `mods/hws-new` and `mods/hws-panel`. A test compares them.
- Every mod change must pass `herdr-app check <mod folder>`.
- The Herdr mod reference is `~/.config/herdr-app/AGENTS.md`, with types in `herdr.d.ts` and `gpui-kit.d.ts` beside it.

## Herdr facts

- Herdr app terminals report `TERM_PROGRAM=ghostty`. Identify them by `__CFBundleIdentifier=dev.herdr.app` and `HC_TERMINAL_ID`.
- `HERDR_ENV` and `HERDR_PANE_ID` belong to the older Herdr TUI.
- `surface/run.sh` changes `XDG_STATE_HOME` for Pixel. Children that call `hc` need the original value, or its socket path is too long.

## Testing in the real window

- Tests use fake `herdr-app` and `hc` through `HWS_HERDR_APP` and `HWS_HC`, with a temporary `HWS_HOME`.
- Only the lead session touches the real Herdr window. Subagents use fakes or the pty driver.
- Never automate the pointer on the user's display. `herdr-app shot` captures the window.
- `hc send` to a plain shell runs the text as a command, so point test deliveries at `cat`.
