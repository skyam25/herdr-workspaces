# Next steps

Handoff for the next session. Updated 2026-11-09.

Start with `README.md` for setup and `docs/CONTRACT.md` for interfaces.

## Status

| Part | State | Tests |
|---|---|---|
| `hws` CLI | Built | 317 pass |
| Herdr mods | Built and installed | 149 simulated pass, 39 forced states |
| Claude plugin | Built, enabled for every session | 84 pass |
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
| Starting work | The launcher offers New terminal, New workspace, Throwaway, Find throwaway, New board and New note |
| Folders | Workspaces start in one parent folder. Nothing creates a folder per workspace |
| Phone review | One listener per machine runs in a Herdr terminal, on port 47614 beside Agent Brief. The iOS app pairs with it as another host. See `docs/CONTRACT.md` |
| Context rules | `CLAUDE.md` in the parent folder holds them. Claude Code already reads it |
| Custom instructions | Each workspace has its own, and agents get them at session start |
| Manifest | JSON that lives until the workspace closes. Artifacts outlive it |
| Done | Delivers to the owning terminal with `hc send` and collapses the pane |
| Standalone | Shows Open terminal and Copy link in place of Done |
| Throwaway | Asks Keep or Trash on close only if something was made. Closes itself after 24 idle hours and stays findable for 30 days |
| Studio | Removed. New board and New note cover the need |
| Rendering | Boards open in their own window, which stays as a resumable draft when closed. Notes and pages stay on Pixel in a pane. A native GPUI board was rejected as too costly |
| Context lifecycle | Working context stays messy in the stream. A tidy pass the person triggers rewrites one current note and demotes the rest. `docs/context-lifecycle.md` holds the design |
| Places | `hws` speaks in roles (`current`, `artifacts`, `scratch`, `decisions`, `history`, `meetings`). Folder names belong to the user and live in the manifest `places` map |
| Tidy | `hws tidy start` opens a Claude tab on a packet. The agent writes a proposal and opens it in a page. Done delivers feedback to the agent, which runs `hws tidy apply`. Only `hws` writes the note |
| Freshness | Counted from the stream against `current.covers`, never from the clock. Sessions, artifacts, commits and Done cards |
| Throwaway scratch | Shells start in `<state>/workspaces/<id>/scratch`. Keep moves it under `~/Documents/Herdr Workspaces/<name>/`, Trash and purge trash it |

## Next steps, in order

### 1. Test by hand

Nothing below has been done with a real pointer or keyboard.

- [x] Draw on a board and judge the lag. Pixel lagged, and a real window felt much better, so boards moved to a window.
- [ ] Click the Done button.
- [ ] Press ⌘Enter on the physical keyboard. Herdr or Ghostty may claim it first.
- [ ] Record Talk and annotate.
- [ ] Open a `page` surface and pin a comment on an HTML file.
- [ ] Open the new form and the Instructions dialog, and check their sizes.
- [ ] Press Open terminal and Copy link on a standalone surface.
- [ ] Run Promote on a throwaway.
- [ ] Reboot or kill a kept workspace's agents, then run `hws resume`.
- [ ] Open Find throwaway, type a search, and reopen a row with the pointer and with Enter.

Drawing lag decides whether Pixel stays. Herdr app reports itself as Ghostty, and nobody has measured whether it gets partial or full frames.

### 2. Turn it on

- [x] Add the bindings from `mods/keys.example.json` to `~/.config/herdr-app/keys.json`.
- [x] Enable the plugin for every session, through the local marketplace in `.claude-plugin/`.
- [x] Add a Workspaces section to the sidebar of the `hws` layout.
- [ ] Click the section's +, New workspace, a row and the panel button with a real pointer.
- [x] Make the `keys.json` test in `mods/test/simulate.test.mjs` independent of the real file.

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
- [x] Add `install.sh`, `hws doctor`, CI and a release workflow.
- [ ] Confirm that Pixel draws correctly in a real Herdr window on Linux. CI covers the install and tests but has no Herdr window.
- [ ] Report to terminal-browser that its `ls` and `action` commands assume Ghostty inside Herdr app.

### 7. Later

- [x] Add an orchestrator that runs a space's board, using `hc run` children.
- [ ] Decide whether this replaces the Agent Brief panel or runs beside it, including on the work Mac.

### 8. Finish the chat flip

- [ ] Test the composer, Send and the model picker with a real keyboard and pointer.
- [x] Add the `PermissionRequest` hook so permissions and questions arrive as cards.
- [ ] Confirm a real Claude session fires that hook and honours a card's answer. Only fakes have run it.
- [ ] Press Cmd+V on a real screenshot and confirm the tile appears. The clipboard reader is tested, the keypress is not.
- [x] Make the attach button work on macOS.
- [ ] Find Codex 0.167's session log. The app-server owns the file, so the chat shows "Can't find this conversation".
- [x] Show flipped agents in the sidebar's Agents list and tab status.
- [x] Make `hws surface open` work for a flipped agent.
- [ ] Revisit the iOS shell around a web client.

### 9. Move surfaces to a native web view

Pixel streams frames through the terminal. Herdr shows a full-window board at 1-2 fps ([herdr-app #498](https://github.com/herdrdev/herdr-app/issues/498)). A web view draws directly, and mods cannot host one today.

- [x] Serve board surfaces over loopback behind `HWS_SURFACE_WEB=1`. `node scripts/verify-web.mjs` in `surface/app` checks WebKit and Chromium.
- [ ] Ask on [#218](https://github.com/herdrdev/herdr-app/issues/218) whether the official browser mod can load a local app. This decides the host.
- [ ] Serve page surfaces, which load from the Electron-only review scheme today.
- [ ] Test notes, Talk and the microphone in WebKit.
- [ ] Scan the pairing code with a real iPhone and iPad, then send a page and a board and press Send on the device.
- [ ] Replace the remaining Electron APIs in `src/main`, so the host is a plain Node process.
- [ ] Revisit a board inside the pane if Herdr ships a browser mod that can load a local app. Patching Herdr is ruled out.
- [ ] Add the host address to the manifest through `hws`.

### 10. Test the new UI homes by hand

`docs/CONTRACT.md` describes these under UI homes.

- [ ] Open the `+` menu from a Terminal pane and a Chat pane, and check its height.
- [ ] Confirm Review a page opens after the macOS chooser takes focus.
- [ ] Start an orchestrator from a real Board with cards that overlap and cards that don't.
- [ ] Open the Board from the Tasks button and return with it.
- [ ] Drag a to-do between columns. Nothing has confirmed hover and release order during a real press.
- [ ] Add, edit, send and archive a to-do in the dialog.
- [ ] Press Done on a surface opened from a flipped agent.
- [ ] Count flipped agents in the status bar, and make `agent.next` and `agent.prev` reach them.

### 11. Test the context lifecycle by hand

Built 2026-11-09 by six Opus workers against fakes. Nothing has run in the real window.

- [x] Open the workspace panel on this repo and read the header line. It should say "No current note yet" until a pass runs. `hws tidy status --line` said that on 2026-11-09, and the first pass wrote a proposal with a note, 17 cards to archive and one artifact superseded.
- [ ] Press Open current. The note should open in a pane. The default place is `CURRENT.md`. Decide whether this file should become the current note instead, knowing a tidy pass rewrites the whole note.
- [ ] Press Tidy. A Tidy tab should open, write a proposal and open it in a page. Press Done and check the note, the Trash and the archived cards.
- [ ] Read the Since last tidy rows after a commit and after a card moves to Done.
- [ ] Edit a Places row, clear one, and press Suggest from folder.
- [ ] Open a throwaway, make a scratch file, close it, and check the Keep or Trash dialog lists the scratch folder.
- [ ] Start a Claude session in a kept workspace and read the three session-start sentences.
- [ ] Judge how Current lines wrap and where the cite chips sit in a narrow pane.
- [ ] Decide whether the stage pill should change the stage.

## State outside this repo

| Thing | Where | Note |
|---|---|---|
| `hws` command | `~/.local/bin/hws` | Symlink into this repo |
| Mods | `~/.config/herdr-app/mods/hws-*` | Reinstall with `sh mods/install.sh --force` |
| Earlier Brief mod | `~/.config/herdr-app/mods/agent-brief` | Superseded by `hws-brief`, safe to delete |
| terminal-browser | Homebrew cask | Installed for testing |
| Spike pane | Terminal `t17` | Test copy of Agent Brief. Ctrl+Q closes it |

## Agent Brief repo

- The Herdr app detection fix is committed as `a71d5a5` and installed. Open sessions need `/reload-plugins` or a restart to report `hcTerminal`.
- Branch `worktree-agent-af9944c917614d5bf` holds the Pixel spike.
- Branch `worktree-agent-a16a8fa756df58c45` holds the first Brief mod.
- Neither branch needs merging, because this repo now carries that work.
