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

You need [Herdr](https://herdr.dev), Node 20 or newer, and Claude Code. macOS is tested end to end. Linux installs and passes its tests, but nobody has confirmed yet that surfaces draw correctly in a real Herdr window there.

```sh
git clone https://github.com/skyam25/herdr-workspaces.git
cd herdr-workspaces
sh install.sh
```

The installer links `hws`, copies the mods, installs Pixel, prepares the surface, adds the Claude plugin, and finishes with `hws doctor`. It can run again safely. If one part fails, the others still install and the report names the fix.

A checkout of a release tag downloads a prebuilt surface. Any other checkout builds the surface, and that needs [pnpm](https://pnpm.io).

Update with `hws update`, which pulls `main`, reinstalls every part and runs the checks. `hws doctor` checks the install and says when GitHub has newer commits.

`mods/keys.example.json` lists suggested key bindings for `~/.config/herdr-app/keys.json`.

## Test

| Part | Command |
|---|---|
| CLI | `npm test` |
| Plugin | `cd plugin && node --test tests/*.test.mjs` |
| Mods | `cd mods && node --import ./test/register.mjs --test test/*.test.mjs` |
| Surface app | `cd surface/app && pnpm test` |
| Surface in a pty | `python3 surface/test/verify.py` |

## Using it

- The Workspaces section in the sidebar lists workspaces and opens the launcher with its +.
- Open the launcher to pick a normal terminal, a workspace, a throwaway, or a standalone board or note.
- A surface opens with `hws surface open --type board --title X --terminal "$HC_TERMINAL_ID"`.
- Done delivers to the terminal that opened the surface and closes the pane. The work stays in `.herdr-workspace/` inside the workspace folder.
- A standalone surface offers Open terminal and Copy link.
- `hws resume` restarts recorded Claude sessions after a reboot.
- Delivery failures are written to `~/.local/state/herdr-workspaces/delivery.log`.

## License

MIT. See `LICENSE`. `mods/NOTICE.md` records third-party code and its licenses.
