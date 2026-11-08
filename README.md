# Herdr Workspaces

Typed workspaces for the Herdr app, with boards, notes and page review glued to the terminal that asked for them.

Interfaces are in `docs/CONTRACT.md`.

## Parts

| Folder | Holds |
|---|---|
| `bin/hws`, `core/` | The CLI that creates, tracks and closes workspaces |
| `surface/` | Agent Brief's board, Write and Review in a Herdr pane, through Pixel |
| `mods/` | Herdr mods: launcher, workspace panel, Brief |
| `plugin/` | Claude Code plugin: workspace awareness and the `/workspace` command |

## Install

```sh
ln -s "$PWD/bin/hws" ~/.local/bin/hws
sh mods/install.sh
(cd surface/app && pnpm build)
claude --plugin-dir "$PWD/plugin"
```

`mods/keys.example.json` lists suggested key bindings for `~/.config/herdr-app/keys.json`.

## Test

| Part | Command |
|---|---|
| CLI | `npm test` |
| Plugin | `cd plugin && node --test tests/*.test.mjs` |
| Mods | `cd mods && node --import ./test/register.mjs --test test/simulate.test.mjs` |
| Surface app | `cd surface/app && pnpm test` |
| Surface in a pty | `python3 surface/test/verify.py` |

## Using it

- Open the launcher to pick a normal terminal, a workspace, a throwaway, or a standalone board or note.
- A surface opens with `hws surface open --type board --title X --terminal "$HC_TERMINAL_ID"`.
- Done delivers to the terminal that opened the surface and closes the pane. The work stays in `.herdr-workspace/` inside the workspace folder.
- A standalone surface offers Open terminal and Copy link.
- `hws resume` restarts recorded Claude sessions after a reboot.
- Delivery failures are written to `~/.local/state/herdr-workspaces/delivery.log`.
