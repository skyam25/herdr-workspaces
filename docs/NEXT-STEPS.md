# Next steps

Handoff for the next session. Written 2026-11-08 at commit `0ebd2b0`.

Start with `README.md` for setup and `docs/CONTRACT.md` for interfaces.

## Status

| Part | State | Tests |
|---|---|---|
| `hws` CLI | Built | 81 pass |
| Herdr mods | Built and installed | 47 simulated pass |
| Claude plugin | Built, not enabled | 22 pass |
| Surface | Built | 1,209 unit tests pass, pty checks pass |

## Proven in the real Herdr window

- A real Claude session knew its workspace from the plugin.
- Done sent a sketch to that session, and Claude read it.
- Done collapsed the surface pane and returned focus to the terminal.
- The launcher, the workspace panel and a standalone note rendered correctly.
- Closing a throwaway asked first, and Trash used the real macOS Trash.

## Decisions

| Topic | Decision |
|---|---|
| Starting work | The launcher offers New terminal, New workspace, Throwaway, New board and New note |
| Folders | Workspaces start in one parent folder. Nothing creates a folder per workspace |
| Context rules | `CLAUDE.md` in the parent folder holds them. Claude Code already reads it |
| Custom instructions | Each workspace has its own, and agents get them at session start |
| Manifest | JSON that lives until the workspace closes. Artifacts outlive it |
| Done | Delivers to the owning terminal with `hc send` and collapses the pane |
| Standalone | Shows Open terminal and Copy link in place of Done |
| Throwaway | Asks Keep or Trash on close only if something was made |
| Studio | Removed. New board and New note cover the need |
| Rendering | Pixel runs the real React UI in a pane. A native GPUI board was rejected as too costly |

## Next steps, in order

### 1. Test by hand

Nothing below has been done with a real pointer or keyboard.

- [ ] Draw on a board and judge the lag.
- [ ] Click the Done button.
- [ ] Press ⌘Enter on the physical keyboard. Herdr or Ghostty may claim it first.
- [ ] Record Talk and annotate.
- [ ] Open a `page` surface and pin a comment on an HTML file.
- [ ] Open the new form and the Instructions dialog, and check their sizes.
- [ ] Press Open terminal and Copy link on a standalone surface.
- [ ] Run Promote on a throwaway.
- [ ] Reboot or kill a kept workspace's agents, then run `hws resume`.

Drawing lag decides whether Pixel stays. Herdr app reports itself as Ghostty, and nobody has measured whether it gets partial or full frames.

### 2. Turn it on

- [ ] Add the bindings from `mods/keys.example.json` to `~/.config/herdr-app/keys.json`.
- [ ] Enable the plugin for every session. Today it needs `claude --plugin-dir`.

### 3. Close the input gaps

The audit found these from reading code.

| Gap | Smallest fix |
|---|---|
| Herdr takes ⌘1-4, ⌃1-9, ⌘F, ⌘D and ⌘B first | Give the surface its own key map on chords Herdr leaves free |
| Image paste does nothing | Map macOS Ctrl+V to `webContents.paste()` through Pixel's `onKey` |
| Finder drops do not reach the page | Add a drop path, or accept a pasted path |
| Shift-drag is taken for text selection | Ask Herdr for a per-terminal passthrough, or add a toolbar toggle |
| Microphone needs wiring | Grant audio through `onPermissionRequest`, then test it |
| Native tooltips, menus and file dialogs have no window | Replace them with page DOM |
| Draft reordering by drag fails offscreen | Keep the Alt+arrow path, or use pointer drags |

### 4. Connect to the normal flow

- [ ] Make `/sketch` and the band open a glued surface inside Herdr. They still open the old panel.
- [ ] Decide what the plugin's Brief pane does when the `hws-brief` mod is available.
- [ ] Remove the leftover `Board` chip from the note footer.

### 5. Reduce the cost per surface

- [ ] Try Pixel's `examples/daemon`, where one Electron process serves many terminals. Each surface now costs its own process.
- [ ] Let two surfaces share one board safely. Today each surface has its own data folder.

### 6. Tidy

- [ ] Decide whether General, App and Deliverable stay. They only change how a workspace is described to agents.
- [ ] Make closing a workspace remove its folder under `~/.local/state/herdr-workspaces/workspaces/`. Closed workspaces leave one behind.
- [ ] Confirm that a fresh install works. Pixel's patched Electron download returned a GitHub 504, so `surface/node_modules` came from the spike.
- [ ] Report to terminal-browser that its `ls` and `action` commands assume Ghostty inside Herdr app.

### 7. Later

- [ ] Add an orchestrator mode across a workspace, using Orchestrate mode and `hc run` children.
- [ ] Decide whether this replaces the Agent Brief panel or runs beside it, including on the work Mac.

### 8. Finish the chat flip

- [ ] Test the composer, Send and the model picker with a real keyboard and pointer.
- [ ] Add the `PermissionRequest` hook so permissions and questions arrive as cards. Today the chat shows Needs you.
- [ ] Make attach and image paste work on macOS. The imported code uses `wl-paste` and a Linux file picker.
- [ ] Show flipped agents in the sidebar's Agents list and tab status. A parked agent drops out of both.
- [ ] Make `hws surface open` work for a flipped agent. It fails today because the agent has no pane.
- [ ] Revisit the iOS shell around a web client.

## State outside this repo

| Thing | Where | Note |
|---|---|---|
| `hws` command | `~/.local/bin/hws` | Symlink into this repo |
| Mods | `~/.config/herdr-app/mods/hws-*` | Reinstall with `sh mods/install.sh --force` |
| Earlier Brief mod | `~/.config/herdr-app/mods/agent-brief` | Superseded by `hws-brief`, safe to delete |
| terminal-browser | Homebrew cask | Installed for testing |
| Spike pane | Terminal `t17` | Test copy of Agent Brief. Ctrl+Q closes it |

## Agent Brief repo

- The Herdr app detection fix is uncommitted on `main`, across 17 files. Tests pass, and it needs a commit and a rebuild.
- Branch `worktree-agent-af9944c917614d5bf` holds the Pixel spike.
- Branch `worktree-agent-a16a8fa756df58c45` holds the first Brief mod.
- Neither branch needs merging, because this repo now carries that work.
