# Herdr Workspaces

Typed workspaces for the Herdr desktop app, with boards, notes and page review in panes glued to the terminal that opened them.

Read `docs/NEXT-STEPS.md` for current status and the task list. `docs/CONTRACT.md` is the specification for every command, path and manifest field.

## Layout

| Path | Holds |
|---|---|
| `bin/hws`, `core/` | CLI that creates, tracks and closes workspaces. Node, ESM, no runtime dependencies |
| `surface/` | Pixel host. `surface/app/` is an owned copy of Agent Brief's Electron app, and `surface/app/src/phone/` is the phone listener |
| `mods/` | Herdr mods `hws-new`, `hws-panel`, `hws-brief`, `hws-pane` and `hws-chat*`, written in GPUI JavaScript. `mods/NOTICE.md` records the Shepherdr import and the forks of Herdr's own mods |
| `plugin/` | Claude Code plugin with the session hook, skill and `/workspace` command |

## Commands

| Task | Command |
|---|---|
| CLI tests | `npm test` |
| Mod tests | `cd mods && node --import ./test/register.mjs --test test/*.test.mjs` |
| Mod states | `node mods/test/forced-check.mjs` |
| Plugin tests | `cd plugin && node --test tests/*.test.mjs` |
| Surface tests | `cd surface/app && pnpm test && pnpm compile` |
| Surface in a pty | `python3 surface/test/verify.py` |
| Rebuild the surface | `cd surface/app && pnpm build` |
| Install the mods | `sh mods/install.sh --force` |
| Forks behind Herdr | `node mods/sync-forks.mjs`, then `--merge` |

## Rules

- Update `docs/CONTRACT.md` when an interface changes.
- Only `hws` writes the manifest. Mods, the surface and the plugin call `hws`.
- Never create a folder per workspace. Workspaces start in the existing parent folder.
- Never guess a terminal. A surface with no live owner offers Open terminal and Copy link.
- User work goes to the macOS Trash and is never deleted outright.
- No background jobs or notifications. Pruning runs inside `hws` commands. The one exception is the phone listener, which runs in a Herdr terminal, starts on `hws phone` and ends with Herdr. The Dock badge counts Waiting on you cards and is not a notification.
- Mods never run `hws` or `hc` during `herdr-app check`. Guard with `checking()`.
- Keep `hws.js` identical in `mods/hws-new` and `mods/hws-panel`. A test compares them.
- Every mod change must pass `herdr-app check <mod folder>`.
- The Herdr mod reference is `~/.config/herdr-app/AGENTS.md`, with types in `herdr.d.ts` and `gpui-kit.d.ts` beside it.

## Herdr facts

- Herdr app terminals report `TERM_PROGRAM=ghostty`. Identify them by `__CFBundleIdentifier=dev.herdr.app` and `HC_TERMINAL_ID`.
- `HERDR_ENV` and `HERDR_PANE_ID` belong to the older Herdr TUI.
- `surface/run.sh` changes `XDG_STATE_HOME` for Pixel. Children that call `hc` need the original value, or its socket path is too long.
- Herdr replaces its shipped mods on every start, so `~/.config/herdr-app/mods/<name>/` always holds the current originals. `herdr-app --version` gives the version.
- A mod can't change what another mod shows. Herdr's supported path is a clone, which never gets Herdr's updates.

## Forks of Herdr's mods

- `hws-tabs`, `hws-agents` and `hws-spaces` are clones of Herdr's `tabs`, `agents` and `spaces`. `hws-pane` shares almost no code with Herdr's `pane`, so it is our own mod.
- Each fork's `mod.json` records `cloned_from` {name, version}, and `mods/upstream/<name>.js` holds Herdr's file at that version. `hws doctor` notes a fork behind Herdr.
- After a Herdr update, run `node mods/sync-forks.mjs --merge`. It merges Herdr's changes with `git merge-file`, moves the base and leaves conflict markers to resolve. Then run the mod tests, `herdr-app check` and the install.
- `engines.herdr` in `package.json` is the oldest Herdr the mods load in. `install.sh`, `hws update` and `hws doctor` refuse an older one. A merge raises it to the merged version. Raise it by hand when a mod starts using an API from a newer Herdr.
- Keep a fork's changes to what Herdr offers no other way to do. Put new features in our own mods. Drop a change once Herdr ships its own version of it.
- Each fork still exists for one of three reasons.
  - Agents flipped to Chat are parked, and `agents()` and tab status count only terminals with a pane. That needs `hws-tabs` and `hws-agents`.
  - The Spaces list hides spaces that belong to a workspace.
  - Right-click on a local space opens our space menu.
- Herdr hooks that would retire them: tab-bar buttons from mods (herdr-app #1045, #246), additions to shipped mods (#888), clone drift (#889), a `space_menu` root option, a spaces filter, and parked agents counted in `agents()`.

## Testing in the real window

- Tests use fake `herdr-app` and `hc` through `HWS_HERDR_APP` and `HWS_HC`, with a temporary `HWS_HOME`.
- Only the lead session touches the real Herdr window. Subagents use fakes or the pty driver.
- Never automate the pointer on the user's display. `herdr-app shot` captures the window.
- `hc send` to a plain shell runs the text as a command, so point test deliveries at `cat`.
