# Herdr Workspaces contract

Shared interfaces for the four parts. Change this file only through the lead.

## Model

| Term | Meaning |
|---|---|
| Workspace | One or more separate Herdr spaces with one manifest. Its spaces share instructions, a Board, Outputs and surfaces. Kinds are `general`, `app`, `deliverable`, `throwaway` |
| Kept kind | `general`, `app` or `deliverable`. A setting inside the workspace that tells agents what kind of work it is |
| Normal terminal | A plain Herdr tab. No manifest |
| Surface | A board, note or page running in its own Herdr pane through Pixel |
| Glued surface | A surface opened by a terminal. Done returns to that terminal |
| Standalone surface | A surface with no terminal. Offers Open terminal and Copy link |
| Artifact | What a surface leaves behind after Done |

## Rules

- The workspace owns the artifact. The terminal that opened a surface owns the reply.
- A surface knows its workspace and its terminal, and never guesses either.
- If the owning terminal has ended, Done acts like standalone.
- Done writes the artifact, delivers it, and collapses the surface pane.
- The manifest lives until its workspace closes. Artifacts outlive the manifest.
- A closed throwaway leaves a retired record, unless the user chose Trash.
- Only `hws` writes the manifest. Every other part calls `hws`.
- No background jobs and no notifications. Pruning runs inside `hws` commands.
- User work moves to the macOS Trash. It is never deleted outright.

## Paths

| Thing | Location |
|---|---|
| State root | `$HWS_HOME`, default `~/.local/state/herdr-workspaces` |
| Manifest | `<root>/workspaces/<spaceId>/workspace.json` |
| Surface data | `<root>/workspaces/<spaceId>/surfaces/<surfaceId>/` |
| Surface socket | `/tmp/hws-<surfaceId>.sock`, kept short for the Unix limit |
| Kept artifacts | `<folder>/.herdr-workspace/<name>-<id tail>/artifacts/<artifactId>/` |
| Throwaway artifacts | `<root>/workspaces/<spaceId>/artifacts/<artifactId>/` |
| Standalone artifacts | `<root>/standalone/artifacts/<artifactId>/` |
| Retired throwaways | `<root>/retired/<spaceId>.json` |

Standalone surfaces with no workspace use the workspace id `standalone`.

## workspace.json, version 1

```json
{
  "version": 1,
  "id": "spc...",
  "name": "checkout demo",
  "kind": "app",
  "folder": "/Users/me/Projects/checkout",
  "instructions": "Text the user wrote for agents, or empty",
  "createdAt": 1794126748609,
  "spaces": ["spc...", "spd..."],
  "board": { "space": "spe...", "tab": "tb..." },
  "tabs": [{ "tabId": "tb...", "name": "Plan or null", "role": "plan or null" }],
  "terminals": [
    { "terminal": "t13", "tabId": "tb...", "sessionId": "uuid or null", "role": "planner or null" }
  ],
  "surfaces": [
    {
      "id": "s1a2b3",
      "type": "board",
      "title": "flow",
      "terminal": "t13 or null",
      "pane": "p...",
      "socket": "/tmp/hws-s1a2b3.sock",
      "pid": 123
    }
  ],
  "artifacts": [
    {
      "id": "a9f8e7",
      "type": "board",
      "title": "flow",
      "path": "absolute artifact folder",
      "prompt": "absolute path to prompt.md",
      "fromTerminal": "t13 or null",
      "createdAt": 1794126748609
    }
  ]
}
```

`id` is the first space's id and never changes, even after that space closes or leaves. `spaces` lists every space in the workspace. A manifest without it has only `id`. `board` is the workspace's Board space and its Board tab, absent until someone adds a Board.

## CLI: `hws`

Node 20 or newer, ESM, no runtime dependencies. Entry is `bin/hws`.

Every command accepts `--json`. Success exits 0. Failure prints `{"error":"..."}` under `--json`, or the message on stderr, and exits 1. Bad usage exits 2.

| Command | Result |
|---|---|
| `hws new terminal [--folder F]` | Opens a normal tab. No manifest |
| `hws new workspace --name N --folder F [--kind K] [--tabs Plan,Build] [--instructions X]` | F must exist. Creates one space and the manifest, and remembers F as the parent folder. The space has one unnamed tab unless `--tabs` names some. Each tab starts a shell in F. K defaults to `general` |
| `hws board add [--workspace W]` | Adds W's one Board space, or finds it, and prints `{workspace,space,tab}`. W defaults to the current workspace |
| `hws board open --space S` | Finds the Board of S's workspace and prints `{workspace,space,tab}`, with null `space` and `tab` when it has none. Prints `{"workspace":null}` for a plain space. Never creates a Board |
| `hws space add --workspace W [--name N] [--folder F]` | Opens a new space in W. F defaults to W's folder |
| `hws space move --space S --workspace W` | Moves an open local space into W. A plain space's cards join W's Board. A space leaving another workspace leaves its cards there. Fails when S is that workspace's last space or its Board space |
| `hws space remove --space S` | Takes S out of its workspace and leaves it open as a plain space. Its cards stay on the Board. Fails on the workspace's last space or its Board space |
| `hws set [--workspace W] [--kind K] [--instructions X]` | Changes a workspace's instructions, or a kept workspace's kind |
| `hws parent` | Prints the folder new work starts in: the last used, else `~/Projects`, else home |
| `hws new throwaway [--name N]` | Creates a throwaway with one tab running `claude` |
| `hws current [--terminal T] [--line]` | The manifest for T, default `$HC_TERMINAL_ID`. `--line` prints one sentence for agents followed by the workspace instructions, or nothing outside a workspace |
| `hws list` | Every manifest, each with `dir` set to its state folder. `dir` is not stored in the manifest |
| `hws register --terminal T --session S [--role R]` | Records a Claude session against its terminal |
| `hws surface open --type board\|note\|page [--title X] [--file F] [--terminal T [--beside-pane P --space S] \| --standalone] [--in-pane]` | Starts the host and records the surface. A board opens in its own window. Notes, pages and `--in-pane` boards split a pane beside T. For an agent flipped to Chat, `--beside-pane` and `--space` name its chat pane P and space S, and fail unless T's `herdr.chat` label equals P |
| `hws surface focus --id S` | Shows the surface's owning terminal, or its chat pane when flipped, and brings Herdr forward. Fails when that terminal has ended |
| `hws surface list` | Windows and drafts, oldest first, as `[{id,type,title,terminal,workspace,open}]`. Leaves out closed windows with no work |
| `hws surface resume --id S` | Brings an open window forward, or starts a closed one again on the same id and data |
| `hws surface discard --id S` | Moves a draft's data to the Trash and drops its record. Fails while the window is open |
| `hws surface done --id S --bundle DIR` | Moves DIR to the artifact store, delivers, closes the pane |
| `hws surface socket [--terminal T] [--title X]` | Prints the socket of that terminal's surface, so agents can drive it with `agent-brief` |
| `hws artifact list [--workspace W]` | Artifacts, including those of retired throwaways when W is absent |
| `hws link ARTIFACT` | Prints `@<absolute prompt.md path>`, ready to paste into Claude |
| `hws todo list\|add\|edit\|move\|send\|archive` | To-dos for a workspace, or for a space outside one. See [To-dos](#to-dos-hws-todo) |
| `hws artifact terminal ARTIFACT` | Opens a new tab running `claude` with that artifact's prompt |
| `hws promote [--workspace W] --name N --folder F [--kind K]` | Makes a throwaway a kept workspace and moves its artifacts. W defaults to the current workspace |
| `hws close [--workspace W] [--keep\|--trash]` | Closes every space in W, the caller's own last. A throwaway with artifacts and no flag returns `{"decision":"needed","artifacts":[...]}` and closes nothing. `--trash` leaves no retired record |
| `hws resume [--workspace W]` | Runs `claude --resume` in shell panes whose recorded session lost its process |
| `hws prune` | Drops closed spaces from manifests, removes manifests with no open space, expires idle throwaways and purges old retired records. Prints `{pruned,expired,skipped}`. Does nothing when the Herdr window does not answer |
| `hws find [TEXT...]` | Retired throwaways, newest close first. TEXT must match every word in the name, a session title, a last prompt or an artifact title |
| `hws reopen ID` | Opens a retired throwaway in a new space, with one tab per session running `claude --resume`, and removes its record |

## Delivery on Done

1. The host writes a bundle folder with `prompt.md` and any `images/`.
2. It calls `hws surface done --id S --bundle DIR`.
3. `hws` moves the bundle to the artifact store and rewrites paths inside `prompt.md` to the new location.
4. For a glued surface whose terminal is live, `hws` runs `hc send T "<prompt.md text>"`, then `herdr-app do pane.close --pane P`, then `herdr-app do pane.focus --terminal T`.
5. For standalone, or a terminal that ended, `hws` records the artifact and prints `{"standalone":true,"artifact":"...","link":"@..."}`. The host then shows Open terminal and Copy link.

## Temporary throwaways

Throwaways close themselves when idle and stay findable afterwards. `prune` does the work, and the sidebar's `hws list` runs it every 60 seconds.

| Stage | When | Effect |
|---|---|---|
| Expire | 24 hours after the last activity | The space closes and a retired record is written |
| Purge | 30 days after the close | Artifacts under the state root go to the Trash and the record goes. Kept artifacts and transcripts stay |

Last activity is the newest of `createdAt` and the modified time of each session's transcript, `<claude home>/projects/<folder with symbols as dashes>/<sessionId>.jsonl`. The Claude home is `CLAUDE_CONFIG_DIR` or `~/.claude`.

Expiry skips a throwaway in any of these cases.

- It is the selected space, or the window does not report a selected space.
- A listed agent's status is anything but idle. `done` means an answer nobody has seen.
- A listed terminal without an agent is running something other than a shell.
- A flipped agent's status is anything but idle.
- A surface has its own window open.

Every close of a throwaway writes the record, whether by expiry, `hws close` or Herdr's own UI. A throwaway with no transcript and no artifacts has no record. `hws close --trash` sets `discarded` on the manifest, which suppresses the record even if the closing process ends with the space.

```json
{
  "version": 1,
  "id": "spc...",
  "name": "throwaway-1c26",
  "folder": "/Users/me/Projects",
  "createdAt": 1794126748609,
  "closedAt": 1794226748609,
  "sessions": [{ "sessionId": "uuid", "activeAt": 1794200000000, "title": "Fix login", "lastPrompt": "why does login fail" }],
  "artifacts": []
}
```

`sessions` is newest first. `title` and `lastPrompt` come from undocumented transcript lines, `ai-title` and `last-prompt`. When `last-prompt` has no text, `lastPrompt` is the newest typed user message, up to 2,000 characters.

The launcher's Find throwaway dialog calls `hws find -- TEXT` as you type and `hws reopen ID` on a row.

## Host environment

`hws surface open` starts the host with these set.

| Variable | Value |
|---|---|
| `HWS_HOME` | State root |
| `HWS_SURFACE_ID` | Surface id |
| `HWS_WORKSPACE_ID` | Space id, or `standalone` |
| `HWS_TERMINAL` | Owning terminal, empty when standalone |
| `HWS_SURFACE_TYPE` | `board`, `note` or `page` |
| `HWS_SURFACE_TITLE` | Title |
| `HWS_SURFACE_FILE` | File for a page or note, else empty |
| `HWS_FOLDER` | Workspace folder, else `$HOME` |
| `COMPANION_SOCKET` | The surface socket |
| `COMPANION_DATA_DIR` | The surface data folder |

The host's start script is `surface/run.sh`.

## Own window

`hws surface open` shows a board in an ordinary window that other windows can cover, unless `--in-pane` asks for Pixel. It sets `HWS_SURFACE_WINDOW=1` and `HWS_SURFACE_OWNER`, a label naming the owning terminal, and starts the host with `hc run --bg` in a terminal with no pane. The surface record has `pane: null` and `host`, that terminal's address.

Closing the window quits the host. A closed window with a drawing, comments or a note stays in the manifest as a draft, with its data folder. Prune drops a closed window with no work. Done delivers, shows the owning terminal and closes the window. Closing the workspace kills the host and moves drafts to the Trash.

A running host raises its window on `POST /open`. The Window menu's Keep on Top floats it on request.

| Where | Shows | Action |
|---|---|---|
| Pane header, beside Chat \| Terminal | Resume board or Show board for the agent's newest board, with +N for others | `hws surface resume` |
| `+` menu | Resume or Show, and Discard for drafts, per board | `hws surface resume`, `hws surface discard` |
| Workspace panel, Open surfaces | Every window and draft, including standalone ones | `hws surface resume` |

`hws-pane` polls `hws surface list` every 5 seconds, one header copy at a time, and shares the result as `hws-pane.boards`.

## Web host

Setting `HWS_SURFACE_WEB=1` shows a surface in any web view in place of Pixel. Without it the host opens no TCP port.

| Item | Behaviour |
|---|---|
| Listener | `127.0.0.1` on a free port |
| Address | Written to `$COMPANION_DATA_DIR/web-url`, mode 600, as `http://127.0.0.1:<port>/#t=<token>` |
| Page and assets | Served without the token |
| `/api/*` | Needs `Authorization: Bearer <token>` |
| Every request | Must name this server in `Host`. `/api/*` also refuses a foreign `Origin` |
| `POST /api/invoke`, `POST /api/send` | Body is `{channel, args}`. Only channels the main process registered are accepted |
| `GET /api/events` | Server-sent events, each `{channel, args}` |
| Encoding | `shared/web-wire.ts`, which keeps bytes and undefined arguments |

Page surfaces do not work in this mode yet, because reviews load from an Electron-only scheme.

## External commands

Binaries resolve from `HWS_HERDR_APP`, default `herdr-app`, and `HWS_HC`, default `hc`. Tests point these at fakes.

| Need | Command |
|---|---|
| Spaces, tabs, terminals | `herdr-app ls` prints `{"spaces":[{id,name,folder,tabs:[{id,name,terminals:[{terminal,pane,status,app}]}]}],"recent":[...]}` |
| New space | `herdr-app do space.new --name N --folder F [--argv JSON]` prints `{space,tab,terminal}` |
| New tab | `herdr-app do tab.new --name N --space S --folder F [--argv JSON]` prints `{space,tab,terminal}` |
| Split | `herdr-app do pane.split --direction right --pane P --argv JSON` prints `{pane,terminal}` |
| Close and focus | `herdr-app do pane.close --pane P`, `herdr-app do pane.focus --terminal T` |
| Close a space | `herdr-app do space.close --id S --confirmed true` |
| Rename | `herdr-app do tab.rename --id T --name N` |
| Send | `hc send T TEXT` |
| Terminal alive | `hc get T` prints JSON. A finished terminal has `exit_code` or an error |

`herdr-app do` prints `{"error":"..."}` and exits 1 on failure.

## Workspaces sidebar section

The `hws` layout has a `workspaces` block that runs `hws-panel` with `{"view":"sidebar"}`.

| Action | Result |
|---|---|
| Heading + | `mod.open` for `hws-new` |
| New workspace row, shown when there are none | Opens the workspace form |
| Workspace row | `space.select` for its showing space, else its first |
| Chevron, shown with two or more spaces | Folds or unfolds its spaces. The choice is remembered |
| Space row, shown with two or more spaces | `space.select` for that space |
| Board row, listed first and with no minus | `space.select` for the Board space, then `tab.select` for its Board tab |
| Minus on a space row | `hws space remove` |
| Add space, shown under the current workspace | Opens the dialog for `hws space add` and `hws space move` |
| Add board, shown under the current workspace when it has no Board | `hws board add`, then shows the Board |
| Panel button on the current workspace | `mod.open` for `hws-panel` |

The section reloads with `hws list` when the spaces change and every 60 seconds. A workspace row shows its most urgent status and how many commits its folder is ahead of its upstream. Space rows show each space's status. Tabs appear only in the top bar. The section sizes its block with `layout.resize`, up to 300px of rows and then scrolling, and shows only the + when the sidebar is narrower than 160px.

## Chat and Terminal flip

The `hws` layout uses the `hws-pane` header. Claude Code and Codex panes get a Chat | Terminal switch.

| Step | Command |
|---|---|
| Flip the focused pane | `herdr-app do hws-pane.toggle` |
| To chat | `pane.split --mod hws-chat --props {"terminal":T}`, `hc label T herdr.chat=<chat pane>`, `terminal.park --terminal T` |
| To terminal | `terminal.keep --terminal T --place right`, `hc label T herdr.chat=`, `pane.close --pane <chat pane>` |

- The core label `herdr.chat` names the chat pane that shows a parked agent.
- A parked agent has no pane, so `herdr-app ls` lists no terminal for it and `pane.focus --terminal T` fails.
- `hws-pane` ends a parked agent once its chat pane has gone.

### Permission hook

`plugin/hooks/ask-hook.sh` runs on Claude Code's `PermissionRequest` event and shows a flipped agent's requests as cards in `hws-chat`.

The hook acts only when all three hold. Otherwise it exits at once with empty stdout, and Claude shows its own prompt.

- `__CFBundleIdentifier` is `dev.herdr.app`.
- `HC_TERMINAL_ID` is set.
- `hc get T --json` shows a non-empty `herdr.chat` label.

Files live in `<app home>/data/chat-asks`. `<id>` is `<terminal>.<unix seconds>.<hook pid>`, and the app home is `HERDR_APP_HOME` or `~/.config/herdr-app`.

| File | Written by | Holds |
|---|---|---|
| `req/<id>.json` | Hook | The request from stdin, unchanged. The chat drops it once the pid is dead |
| `ans/<id>.json` | Chat | Decision JSON from `core/asks.js`, which the hook prints as it is. An empty file means no decision |
| `end/<id>` | Either | One line saying how the ask closed, kept for 24 hours |
| `open/<terminal>` | Chat | Touched every few seconds, removed when the chat closes |

The hook never decides by itself. It prints nothing, removes its request file and leaves an `end` line in these cases.

| Event | `end` line |
|---|---|
| 30 minutes pass with no answer | `No answer in 30 minutes; it waits in the terminal` |
| The label clears, the flag goes, or the flag is older than 30 seconds | `Chat closed; it waits in the terminal` |
| The terminal ends | `Agent stopped` |
| Claude's status goes from blocked to working, idle or done | `Answered in the terminal` |
| Claude stops the hook with a signal | `Declined or interrupted in the terminal` |

The `timeout` in `hooks.json` is 1830 seconds, 30 seconds above the give-up. `HWS_ASK_WAIT_MS` shortens the wait for tests.

## UI homes

Each region of the `hws` layout has one job.

| Region | Job | Holds |
|---|---|---|
| Left sidebar | Navigate | Workspaces, Spaces, Agents (`hws-agents`, includes flipped agents) |
| Tab bar | Switch tabs, open the Board, toggle the right panel | `hws-tabs`, with Tasks, Files, Changes, Outputs |
| Pane header | Act on this agent | `hws-pane` `+`, always visible on agent and chat panes |
| Chat composer | Act on this agent while typing | The same menu, plus Attach file |
| Own window, or a pane beside the agent | Do the work | Boards in their own window, notes and pages in a pane |
| Board | Plan and dispatch work | Full-width kanban, `hws-work` with `{"view":"tasks"}`. One Board space per workspace, or a Board tab in a plain space |
| Right panel | See what the work produced | Files, Changes, Outputs |

### New menu: `hws-actions`

A popup that the pane header and the chat composer open at the pointer.

| Prop | Meaning |
|---|---|
| `terminal` | The agent the surface attaches to. Required |
| `chat` | True when the agent is flipped to Chat |
| `pane` | The chat pane, when `chat` is true |
| `space` | The agent's space id |
| `cwd` | The agent's folder, when Herdr knows it |
| `lastReply` | The agent's last reply, when the chat has one |
| `boards` | The agent's windows and drafts from `hws surface list`, when it has any |

| Item | Shown | Action |
|---|---|---|
| Sketch | Always | `hws surface open --type board` |
| Write | Always | `hws surface open --type note` |
| Write from last reply | `lastReply` is set | Writes the reply to a file, then opens it with `--type note --file F` |
| Review a page… | Always | macOS file chooser, then `--type page --file F` |
| Attach file… | `chat` is true | `setShared("hws-chat.attach", { pane, at })` |
| Tasks | Always | Opens the Board tab |
| Outputs | Always | Selects `outputs` in `panel-body` and shows `panel` |
| Orchestrate this space | `space` and `cwd` are known | `hws orchestrator start --space S --folder F`, where F is this agent's folder |
| Resume or Show `<title>` | Per entry in `boards` | `hws surface resume --id S` |
| Discard `<title>` | Per closed entry in `boards` | `hws surface discard --id S` |

Every `hws surface open` passes `--terminal T`. A flipped agent also passes `--beside-pane P --space S`.

### Flipped agents

A flipped agent has no pane, and `herdr-app ls` does not list chat panes. Mods find one this way:

1. Take each entry in `panes()` whose `mod` is `hws-chat`.
2. Find the live terminal in `terminals()` whose `herdr.chat` label equals that pane.
3. Its tab is the pane's `tab`. Its space is the entry in `spaces()` that holds that tab.

`hws surface open --terminal T --beside-pane P --space S` opens a board in its own window and splits a note or page beside P. It fails unless T's `herdr.chat` label equals P. On Done, `hws` reads T's `herdr.chat` label again. It focuses that pane when the label is set and the terminal otherwise.

### Board

A Board is a tab whose pane runs `hws-work` with `{"view":"tasks"}`.

A workspace starts with no Board. The person or an agent adds one, at most one, with `hws board add`. It is a Board space, a member of the workspace named Board. Its Board tab is named `Workspace board`, and the tab bar hides a tab with that name. Agents run in other tabs of that space. A plain space has at most one Board tab, shown in the tab bar.

| Tasks button in the tab bar | Result |
|---|---|
| The active space holds a Board that is not showing | `tab.select` |
| The space is in a workspace that has a Board elsewhere | `hws board open`, then `space.select` and `tab.select` |
| The space is in a workspace with no Board | A notification points to Add board. Nothing is created |
| The space is plain and holds no Board | `tab.new` with `name` Board, `mod` `hws-work`, `props` `{"view":"tasks"}` |
| The Board is showing | Returns to the space the button came from, else `tab.select` on the tab shown before it |

The pane header names it Board. The board shows your to-dos beside the agents' items.

| Column | Your to-dos | Agent items |
|---|---|---|
| To do | `column` is `todo` | None |
| In progress | `column` is `doing` | Open, and not waiting |
| Waiting on you | `column` is `waiting` | Open, and the last line is Claude's |
| Done | `column` is `done` | Checked |

- The board always shows four columns side by side, sharing the width. They scroll sideways at 200px each when they do not fit.
- The board always renders. A problem reaching Agent Brief is one quiet line under the header, and to-dos still work.
- `hws-work` keeps `shared("hws.tasks.waiting")` equal to the Waiting on you count, and `hws-tabs` shows it on the Tasks button.

| Card | Shows | Click | Drag |
|---|---|---|---|
| To-do | Title, up to three lines of summary, a `Run by` row when `terminal` is set, owner tag (Unassigned and Agent only in To do), Worktree and From tags, and Allow on an unassigned To do card. The summary is `note`, then `report` on a card in Waiting on you or Done, then the first line of notes. The `Run by` row names the session and its status, with Open while it is live. From appears when a different session added the card | Opens the to-do dialog | Release over To do, In progress or Done |
| Agent item | `#n`, title, agent name, Claude's last line | Focuses the agent | None, because the agent owns the items file |

Drag uses press and release across elements, as Herdr's tab bar does. The column under the pointer highlights during a drag, and Waiting on you never accepts a drop.

Allow runs `hws todo edit --id I --owner=agent`, which lets an orchestrator take that card. The header's label reads Orchestrating, Run finished once every card is done, or Orchestrator needs you when the orchestrator reports blocked or has reported nothing 20 seconds after it started. A blocked worker adds to the header's status. Open focuses a session with a pane and runs `terminal.peek` on a worker without one.

Adding has three routes:

- An input at the top of To do. Enter adds a card, empties the input and keeps focus.
- `+ Add` in the header opens the to-do dialog.
- Add several in the header opens a dialog with a text area. Each non-blank line becomes a card.

The to-do dialog fills the Board up to 920 by 820 px, and is never smaller than 560 by 480. Its left column holds the update, title and notes, and the notes box takes the remaining height. Its right column holds the controls. The dialog has title, notes, a column choice, an owner choice of Unassigned, Agent or Mine (`owner`), Use a worktree (`worktree`), Send to, Archive and Save. Its heading line shows the card id and when it was added and updated. The dialog opens with What happened on a Done card and Latest update on any other. A Done or Waiting on you card shows `report` and then `note`, and other cards show `note` and then `report`. The text renders as markdown and scrolls when long. A card with a linked session lists Run by and Added by under Session, and Open saves the card's edits, closes the dialog and opens that session. Each Send to row has its own Send button, and pressing it moves the card to In progress. A card in Waiting on you has a Reply box, and a Done card with a session has a Feedback box. Both run `hws todo reply`, which sends to a live session or reopens a closed one with the text as its next message, in a new tab, without moving the window.

The header shows `<orchestrator model> → <worker model>`, which opens the Models dialog. It has Orchestrator and Workers rows with model and effort, a tool choice for Workers, and Use recommended. The default is Opus at high effort for the orchestrator and Sonnet at medium for workers. For Codex workers the recommended model is `gpt-6.1-sol`. The header always shows what is running, what waits on you and, when nothing is ready, how many cards need Allow. **Run N ready** appears when a To do card is assigned to an agent. It runs `hws orchestrator start --space S --folder F`, which starts an orchestrator or tells the live one to read the board. Orchestration also starts from the `+` menu or the launcher. **Allow all N** appears on To do when more than one card is unassigned, and assigns each to an agent. A card or Session row whose session has ended and whose `session` is saved shows Resume, which runs `hws todo resume --id I --space S`.

| While an orchestrator is live, the header shows | Action |
|---|---|
| Orchestrating | None. It is the mode's label |
| Go to | Focuses its terminal |
| Stop | Asks in place, as ending an agent does, then runs `hws orchestrator stop --space S` |

### Right panel: `hws-work`

`panel-body` has three children: `files`, `changes` and `outputs`. Outputs runs `hws-work` with `{"view":"outputs"}`. It reads the active space's Claude agents, flipped ones included, and binds each to its session by `host.hcTerminal` from `agent-brief sessions --json`.

Outputs lists each agent's outputs, newest first. A local `.html`, `.htm` or `.md` output opens beside its agent with `hws surface open --type page`. The click shows the agent's tab and focuses the surface. A second click on the same output returns to that surface while its pane lives. Anything else goes to macOS `open`.

`mod.open:hws-brief` shows or hides Outputs in the right panel.

### To-dos: `hws todo`

Only `hws` writes `<state root>/todos/<board>.json`. A workspace's board is its id, and every space in it reads and writes that board. A space outside a workspace has its own board, named by its id, or `<id>~space` when that id also names a workspace it founded and left. Boards survive closing a workspace.

`--space` takes any space id and resolves to its board. `hws todo list` also prints `spaces`, the spaces that share the board. Tasks and Outputs cover the agents in all of them.

```json
{ "version": 1, "space": "sp1", "items": [
  { "id": "t1a2b3", "title": "Fix login", "notes": "", "column": "todo", "terminal": null, "owner": "unassigned", "worktree": false, "note": "", "addedBy": null, "report": "", "reportFrom": null, "session": null, "archived": false, "createdAt": 1, "updatedAt": 1 }
], "orchestrator": { "terminal": "t9", "startedAt": 1 } }
```

| Command | Does |
|---|---|
| `hws todo list [--space S]` | Prints unarchived items, newest `updatedAt` first, and `orchestrator` as `{ terminal, live }` or null |
| `hws todo add --title X [--notes N] [--owner mine\|unassigned\|agent] [--worktree] [--space S]` | Adds to `todo`. `owner` defaults to unassigned |
| `hws todo add --titles T [--space S]` | Adds one card for each non-blank line of T, and prints `{ items }` |
| `hws todo edit --id I [--title X] [--notes N] [--owner mine\|unassigned\|agent] [--worktree true\|false] [--space S]` | Changes the text or flags |
| `hws todo move --id I --column todo\|doing\|waiting\|done [--note X] [--report X] [--space S]` | Changes the column, and sets `note` and `report` when given. An agent cannot use `hws todo edit --owner agent` or send an unassigned card, because only the person assigns cards. A move to any column but To do from a Herdr terminal other than the orchestrator sets an empty `terminal` to that terminal. A move to To do clears `terminal` and `session`. A move to Waiting on you or Done without `--report` sets `reportFrom` to the calling terminal, and any other move clears it |
| `hws todo status [--space S]` | Prints `ready` with each card's `note`, then `inFlight` with `live`, `waiting`, `needsAllow`, `done` and `orchestrator` |
| `hws todo resume --id I [--space S]` | Opens the card's `session` in a new tab of the space with `claude --resume` or `codex resume`, and sets `terminal` to it. Fails when the card has no session or its terminal is still live |
| `hws todo start --ids I,J --folder D [--owns A,B] [--avoid C,D] [--packet-file F] [--space S]` | From the orchestrator's terminal, starts one worker on the cards, in order, with the Models setting. Names it `todo-I-<random>` with label `hws.todo=I,J`, claims the cards for it, and saves a Claude worker's session id, model and effort up front |
| `hws models` | Prints `orchestrator`, `worker`, each `{ tool, model, effort }`, and `catalog` |
| `hws models set --role orchestrator\|worker [--tool claude\|codex] --model M --effort E` | Saves a role. The orchestrator must use Claude Code |
| `hws todo capture --terminal T --text X [--space S]` | Copies X to `report` on the cards whose `reportFrom` is T, then clears it. Only cards T ran take the report. If T is a worker with no card left in progress or waiting, closes T. The plugin's Stop hook runs this with the session's closing message |
| `hws todo note --id I --text X [--space S]` | Sets `note`, the latest word from the worker. A Herdr terminal on a card outside To do that sets it fills an empty `terminal` |
| `hws todo next --terminal T [--space S]` | Claims the oldest To do card owned by agent, and prints it or null |
| `hws todo claim --id I --terminal T [--space S]` | Moves a To do card to `doing` and sets `terminal`. Fails when the owner is not agent or the card is not in To do |
| `hws todo send --id I --terminal T [--space S]` | Pastes the title and notes into T with `hc send`, sets `terminal` and `owner` agent, moves to `doing` |
| `hws todo reply --id I --text X [--space S]` | Pastes X into the card's `terminal`, clears `note`, moves to `doing` |
| `hws todo archive --id I [--space S]` | Sets `archived`. Nothing is deleted |

`--space` defaults to the calling agent's own space, from `$HC_TERMINAL_ID`. A terminal Herdr cannot place is an error, so a card never lands on another space's board. With no `$HC_TERMINAL_ID`, it defaults to the window's selected space. Mods always pass it.

`session` is `{ tool, id, folder }`, where `tool` is `claude` or `codex`. A report or claim from an agent's own shell fills it from `CLAUDE_CODE_SESSION_ID` or `CODEX_THREAD_ID`. `hws todo send` finds it from the terminal's process, or from Codex's thread database when exactly one Codex thread started in that folder since the terminal opened. `replies` lists each `{ question, answer, at }` from `hws todo reply`, and the dialog shows them after the update. `hws todo claim` and `next` clear `note`. `hws orchestrator start`, and `hws board add` from an agent, return the window to where it was. `report` holds what happened, up to 8000 characters. `hws todo list` leaves out `report` and `reportFrom` for a caller with `$HC_TERMINAL_ID` set unless it passes `--reports`.

A card added with `$HC_TERMINAL_ID` set is an agent's. It records `addedBy` as that terminal and starts unassigned, or mine when it passes `--owner mine`, so an orchestrator takes it only after you press Allow. `--owner agent` from an agent fails.

A card has one `owner`. `mine` is yours to track, and agents only read it. A call with `$HC_TERMINAL_ID` set that would change a mine card fails. `unassigned` is the default for every new card. `agent` cards are the only ones `next` and `claim` take. The to-do dialog sets `shared("hws.todos.changed")` after a change, and the board reloads on it.

Items written before these fields existed read `worktree` as false, `note` and `report` as empty, `replies` as empty, and `addedBy`, `reportFrom` and `session` as null. An item from before `owner` converts on read. A held item with `addedBy` becomes unassigned, a held item without it becomes mine, and any other becomes agent.

Every agent can use the list. The session-start hook tells each Claude session in a Herdr terminal that it exists, and the `herdr-workspace` skill explains it.

### Orchestrator

Orchestration is a way of operating on the list, and is off until you start it. An orchestrator is an ordinary Claude session in a visible tab. It reads the board, decides what can run in parallel and starts workers. Nothing runs in the background.

| Command | Does |
|---|---|
| `hws orchestrator start --space S --folder F` | With none live, runs the orchestrator with the Models setting. opens an Orchestrator tab running `claude` with a first prompt that loads the `orchestrate` skill, and records its terminal. With one live, pastes a note into it to read the board again |
| `hws orchestrator stop [--space S]` | Ends the orchestrator and its workers. A card still in `doing` whose worker has ended returns to To do, unassigned, with the note `Stopped before finishing` |
| `hws orchestrator status [--space S]` | Prints `{ terminal, live }` or null |

- The skill is `plugin/skills/orchestrate/SKILL.md`.
- The orchestrator chooses parallel or sequential from the files each card touches and the open decisions cards share.
- The orchestrator writes one run packet of workspace instructions, shared facts, file paths, output format and boundaries, and every worker in the run gets it.
- It uses a worktree only when a card has `worktree` set or the person asks. Otherwise every worker runs in the same folder and owns a separate set of files.
- Workers are `hc run --bg` children labelled `hws.todo=<id>`, so they show under the orchestrator in Agents and report to it when they end.
- Only a card owned by agent is taken.

A surface runs on this computer. The `+` menu is hidden for a remote agent, and `hws surface open` refuses a terminal whose address has a machine prefix.
