# Next steps

Handoff for the next session. Updated 2026-11-12.

Start with `README.md` for setup and `docs/CONTRACT.md` for interfaces.

## Status

| Part | State |
|---|---|
| `hws` CLI | Built |
| Herdr mods | Built and installed |
| Claude plugin | Built, enabled for every session |
| Surface | Built, pty checks pass |

`CLAUDE.md` lists the test commands.

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
| Rendering | A surface shows in a pane through Pixel or in its own window, and Pop out and Pop in move it between the two. Boards and notes open in a window, which stays as a resumable draft when closed. Pages open in a pane beside the agent. A native GPUI board was rejected as too costly |
| Context lifecycle | Working context stays messy in the stream. A tidy pass the person triggers rewrites one current note and demotes the rest. `docs/CONTRACT.md` holds the Tidy section |
| Places | `hws` speaks in roles (`current`, `artifacts`, `scratch`, `decisions`, `history`, `meetings`). Folder names belong to the user and live in the manifest `places` map |
| Tidy | `hws tidy start` opens a Claude tab on a packet. The agent writes a proposal and opens it in a page. Done delivers feedback to the agent, which runs `hws tidy apply`. Only `hws` writes the note |
| Freshness | Counted from the stream against `current.covers`, never from the clock. Only non-draft artifacts, commits and Done cards move the ring, because sessions and drafts are exploring |
| Decisions and history | The note holds what is true now. `decisions.md` keeps each decision and what replaced it. Each pass saves the old note and adds to `updates.md` |
| Names | A person reads Tasks for the kanban and Sketch for a `board` surface. The CLI and manifest keep `board` and `todo` |
| Tasks and Agent Brief | Tasks shows only `hws` cards and never runs `agent-brief` |
| Spaces list | `hws-spaces`, a copy of Herdr's `spaces`, hides the spaces a workspace already lists and titles the rest Other spaces |
| Plain space on a workspace's folder | `hws space match` finds the workspace. The panel offers Add this space to NAME and session start tells the agent once |
| Moving a space | A right-click on a space's sidebar row opens the space menu. Move to workspace… lists every open workspace and New workspace from this space…, which runs `hws new workspace --space S`. A drag between the two sidebar lists is left out, because they are separate mods |
| Throwaway scratch | Shells start in `<state>/workspaces/<id>/scratch`. Keep moves it under `~/Documents/Herdr Workspaces/<name>/`, Trash and purge trash it |
| Agent Brief panel | Herdr comes first. The Agent Brief Mac app stays as the path for terminals outside Herdr. In a Herdr terminal the Agent Brief plugin steps back to pictures, wireframes, Talk, output recording and its skills (plugin 0.6.31, on a branch in the agent-brief repo as of 2026-11-09) |
| App copy | `surface/app` leads for the board, Write and Review inside Herdr. The agent-brief repo leads for the phone app (`companion/ios`) and the phone protocol (`companion/src/ipad`), and `surface/app/src/ipad` follows it |
| Outputs | Read from `.feedback/outputs/<session>.json` through `hws`. The Agent Brief app is not needed |

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
- [x] Decide what the plugin's Brief pane does when the `hws-brief` mod is available. It steps back in a Herdr terminal, under Agent Brief panel in Decisions.
- [x] Remove the leftover `Board` chip from the note footer. A surface in a pane hides it, and the Agent Brief panel keeps it.

### 5. Reduce the cost per surface

- [ ] Try Pixel's `examples/daemon`, where one Electron process serves many terminals. Each surface now costs its own process.
- [ ] Let two surfaces share one board safely. Today each surface has its own data folder.

### 6. Tidy

- [x] Take General, App and Deliverable out of the panel. They only change how a workspace is described to agents, and `hws set --kind` still changes them.
- [ ] Make closing a workspace remove its folder under `~/.local/state/herdr-workspaces/workspaces/`. Closed workspaces leave one behind.
- [x] Add `install.sh`, `hws doctor`, CI and a release workflow.
- [ ] Confirm that Pixel draws correctly in a real Herdr window on Linux. CI covers the install and tests but has no Herdr window.
- [ ] Report to terminal-browser that its `ls` and `action` commands assume Ghostty inside Herdr app.

### 7. Later

- [x] Add an orchestrator that runs a space's board, using `hc run` children.
- [x] Decide whether this replaces the Agent Brief panel or runs beside it. Decided for this Mac under Agent Brief panel in Decisions. The work Mac still needs the same installs.
- [ ] Open Outputs in the real window with the Agent Brief app closed, and click a declared page. Only fakes have run `hws outputs`.

### 8. Finish the chat flip

- [ ] Test the composer, Send and the model picker with a real keyboard and pointer.
- [ ] Type `/exit` in a real chat and check the chat and its terminal close. Type `/clear` and check the old conversation goes at once. Only the simulator has run them.
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
- [ ] Ask on [#853](https://github.com/herdrdev/herdr-app/issues/853) whether the official browser mod can load a local app. This decides the host. #218 was closed as not planned on 2026-11-05.
- [x] Serve page surfaces over loopback, one port per project folder. `node scripts/verify-web.mjs` pins a comment in WebKit and Chromium and checks the review and its picture.
- [ ] Give a dev server's page the overlay in a web view, and give feedback workspace snapshots a picture there.
- [ ] Test notes, Talk and the microphone in WebKit.
- [ ] Scan the pairing code with a real iPhone and iPad, then send a page and a board and press Send on the device.
- [ ] Start a whiteboard on the phone, press Send, pick a Herdr terminal and check the prompt lands there. Only the listener test and the simulator test have run it. `hws phone targets` offers agents flipped to Chat too, tested with fakes only.
- [ ] Replace the remaining Electron APIs in `src/main`, so the host is a plain Node process.
- [ ] Revisit a board inside the pane if Herdr ships a browser mod that can load a local app. Patching Herdr is ruled out.
- [ ] Add the host address to the manifest through `hws`.

Until then a pane's page holds still, through `surface/still.cjs`. Herdr 0.1.15 takes image bytes inline only, so Pixel resends the whole pane for each change.

Measured on 2026-11-12 in a separate Herdr 0.1.15 window of 1994 by 1211 points, with Pixel 0.2.10 and a page that draws its frame number.

| Case | Frames Herdr showed | Blank shots |
|---|---|---|
| Whole frames, half-width and full-tab pane | 5 a second | 0 of 130 |
| Pixel's recorded frames replayed at 10 a second | 10 a second | 4 of 136 |
| The same at 20 a second | 9 a second | 68 of 138 |
| `TERMINAL_BROWSER_PRESENT=patched`, one line changing | 27 a second or more | 0 of 135 |

- Pixel holds inline frames to 3 MB a second, which is 5 frames of about 650 KB. The limit is a constant in Pixel and Herdr starts to blank at twice that rate, so nothing here can raise it.
- With `patched`, Herdr 0.1.15 draws typed characters about half a cell too high. #500 still blocks it.
- `PIXEL_RENDER_SCALE=1` sends the same pixel count and more bytes, so it does not help.
- Pixel 0.2.16 has the same 3 MB limit and the same presenter choice as 0.2.10.
- A window draws at full speed, so `hws surface pop` moves any surface between a pane and a window. A separate Herdr 0.1.15 window ran the real `hws` on a page and a note, from pane to window and back, and the note kept its text.

- [x] Stop the caret blink, transitions and hover sweeps in a pane. In the pty an idle note went from 2 whole-pane resends a second to none.
- [ ] Open a note and a page in the real window and confirm an idle pane no longer flickers. Only the pty has shown it.
- [x] Draw the page at 30 frames a second in a pane, through `PIXEL_FPS` in `surface/run.sh`. Pixel's CPU use fell from 54% of a core to 28% while a page scrolled, and the pane showed the same 5 frames a second.
- [ ] Set `TERMINAL_BROWSER_PRESENT=patched` in `surface/run.sh` once Herdr fixes [#500](https://github.com/herdrdev/herdr-app/issues/500). Pixel then sends only the changed region, which cut typing from 2.4 MB/s to 0.01 MB/s in the pty. Herdr drops the pixel offset the patches are placed with, so they land up to a cell off today.
- [ ] Watch Herdr [#508](https://github.com/herdrdev/herdr-app/pull/508) and [#704](https://github.com/herdrdev/herdr-app/pull/704). They keep the old image on screen during an update and take frames in shared memory, and Pixel uses both with no change here.

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
- [ ] Press Open note. The note should open in its own window. The default place is `CURRENT.md`. Decide whether this file should become the current note instead, knowing a tidy pass rewrites the whole note.
- [ ] Press Tidy. A terminal should open below the panel, ask anything unclear, write a proposal and open it in a page. Press Done and check the note, the Trash and the archived cards.
- [ ] Read the Not in the note yet rows after a commit and after a card moves to Done.
- [ ] Create a workspace with Workspace files in set to a subfolder, then finish a note and a board and check they land in `notes/` and `artifacts/`.
- [ ] Close a kept workspace, then open Find past work in the launcher and restore it.
- [ ] Press Workspace in the top bar, then right-click another workspace in the sidebar and press Open panel. The panel should open beside a terminal in each case.
- [ ] Edit a Places row, clear one, and press Suggest from folder.
- [ ] Open a throwaway, make a scratch file, close it, and check the Keep or Trash dialog lists the scratch folder.
- [ ] Start a Claude session in a kept workspace and read the three session-start sentences.
- [ ] Judge how Current lines wrap and where the cite chips sit in a narrow pane.
- [ ] Decide whether the stage pill should change the stage.

### 12. Test the review changes by hand

Built 2026-11-09 by four Opus workers against fakes, then installed. The lead saw each of these draw in the real window, and nobody has clicked them.

- [ ] Press Add this space to NAME in the panel of a plain space on a workspace's folder, and check the space moves under the workspace.
- [ ] Start a Claude session in such a space and read the session-start sentence.
- [ ] Open the stage menu and the `···` menu in the panel header, and check where each popup lands.
- [ ] Press the Tasks line in the panel, and Add tasks on a workspace with no Board.
- [ ] Press Archive done in Tasks and confirm.
- [ ] Drag a space in Other spaces while workspace spaces are hidden.
- [x] Make the Tasks badge in the tab bar follow the workspace on screen. `hws.tasks.waiting` is a count per space, written by the sidebar and the Tasks pane.

### 13. Test the review loop by hand

Built 2026-11-09 against fakes. Nothing has run in the real window.

- [ ] In a kept workspace, ask an agent in a Terminal pane to show an HTML page for review. `hws review FILE` should split the page beside it and add the file to Artifacts.
- [ ] Flip the agent to Chat and ask again. The page should split beside the chat pane, with no new tab.
- [ ] Pin a comment and press Done. The pane should close, and the prompt's last line should ask for `hws review` again.
- [ ] Let the agent change the page and reopen it. The earlier comment should be gone.
- [ ] Open the Workspace panel. The page's row should show `1 feedback`, unfold the round, and read it in the panel.
- [ ] Open a page from the panel with no agent in the space, comment, and press Copy link twice. The comment should clear after the first press, and the second should copy the same link.
- [ ] Confirm a parked agent keeps a `herdr.space` or `where` label. Without one, `hws` falls back to the tab the agent was recorded in.

### 14. Test moving a space by hand

Built 2026-11-09 against fakes, then installed. The window reported no errors, and nobody has clicked any of it.

- [ ] Right-click a space in Other spaces. The menu should show Rename, the worktree items in a repo, Move to workspace… and Close, and be as tall as its items.
- [ ] Choose Move to workspace… and click a workspace. The space should leave Other spaces and appear under that workspace.
- [ ] Choose New workspace from this space…. The form should start with the space's name and folder, and Create should list the space as a workspace without opening another space.
- [ ] Right-click a space under a workspace with two spaces. Take out of NAME should make it a plain space, and Move to workspace… should leave out its own workspace.
- [ ] Right-click a workspace's only space. The menu should show neither move item.
- [ ] Press Make this space a workspace… in the panel of a plain space.

### 15. Test the UI review fixes by hand

Built 2026-11-09 by six Opus workers against fakes, after a review of the live window. Nobody has clicked any of it.

- [ ] Read the Workspaces list. Each workspace should show a letter tile in its space's colour, every name should start at the same x, and a workspace with one space should list that space indented under it.
- [ ] Select the last workspace in the list. Its rows should stay on screen, and Other spaces and Agents should keep at least 90px each.
- [ ] Right-click a workspace row and choose Add space… and Add tasks.
- [ ] Hover a space row under a workspace with two spaces. The minus should show only on that row.
- [ ] Move a card to Waiting on you. Its count should show on the sidebar's Tasks row and on the tab bar's Tasks button, and the button should follow the space on screen.
- [ ] Open the Waiting on you card whose session has ended. The dialog should offer Move to To do in place of Reply.
- [ ] Read the Tasks heading, the buttons, a Done card and an empty column.
- [ ] Open the Workspace panel on a kept workspace with a separate home, and on a plain space with one matching workspace.
- [ ] Read the Agents list with agents in two spaces, and the tab names of unnamed Claude tabs.
- [ ] Open the launcher and the `+` menu on a plain space. Neither should offer Orchestrate this space.
- [ ] Open a standalone note and read the line under its title. It should name Open terminal and Copy link.
- [ ] Click the Phone row with a phone paired. The Phones popup should open above the row, list the phone as Connected or with its last seen time, and Forget should ask first.
- [ ] Press Pair another phone or iPad in that popup. The Pair phone tab should open, and the row should gain the new name.
- [ ] Close the panes that started before commit 015706a. They still show a terminal address as their title.
- [ ] Section 14 expects a menu on a workspace's only space. That space no longer has a row, so decide whether the workspace row's menu should carry Rename and Close for it.

### 16. Test pop out and pop in by hand

Built 2026-11-12 by three Opus workers against fakes. The lead ran `hws surface pop` against a separate Herdr window. Nobody has pressed the buttons in the real one.

- [ ] Ask an agent to review a page, press Pop out in the pane, and check the window opens with the same comments. Press Pop in and check the pane returns beside that agent.
- [ ] Open a note from the `+` menu. It should open in a window. Type, press Pop in, and check the text is there in the pane.
- [ ] Pop a page out from a flipped agent, then pop it in. The pane should split beside the chat pane.
- [ ] End the owning terminal while its window is open, then press Pop in. The surface should open as a tab.
- [ ] Choose Move into a pane in the `+` menu right after typing in a window, and close a note's pane right after typing. The host saves on a hangup, which the pty and a signal test showed, so nothing typed should be lost.
- [ ] Read the pane header button with a note window and a page window open. It should say note or page, not sketch.
- [ ] Narrow a pane below 460 px and check the bar keeps the Pop out icon, the mic and Done on one line.
