# Herdr Workspaces contract

Shared interfaces for the four parts. Change this file only through the lead.

## Model

| Term | Meaning |
|---|---|
| Workspace | A Herdr space with a manifest. Kinds are `general`, `app`, `deliverable`, `throwaway` |
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
  "tabs": [{ "tabId": "tb...", "name": "Plan", "role": "plan" }],
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

## CLI: `hws`

Node 20 or newer, ESM, no runtime dependencies. Entry is `bin/hws`.

Every command accepts `--json`. Success exits 0. Failure prints `{"error":"..."}` under `--json`, or the message on stderr, and exits 1. Bad usage exits 2.

| Command | Result |
|---|---|
| `hws new terminal [--folder F]` | Opens a normal tab. No manifest |
| `hws new workspace --name N --folder F [--kind K] [--tabs Plan,Build] [--instructions X]` | F must exist. Creates the space, its tabs and the manifest, and remembers F as the parent folder. Each tab starts a shell in F. K defaults to `general` |
| `hws set [--workspace W] [--kind K] [--instructions X]` | Changes a workspace's instructions, or a kept workspace's kind |
| `hws parent` | Prints the folder new work starts in: the last used, else `~/Projects`, else home |
| `hws new throwaway [--name N]` | Creates a throwaway with one tab running `claude` |
| `hws current [--terminal T] [--line]` | The manifest for T, default `$HC_TERMINAL_ID`. `--line` prints one sentence for agents followed by the workspace instructions, or nothing outside a workspace |
| `hws list` | Every manifest, each with `dir` set to its state folder. `dir` is not stored in the manifest |
| `hws register --terminal T --session S [--role R]` | Records a Claude session against its terminal |
| `hws surface open --type board\|note\|page [--title X] [--file F] [--terminal T [--beside-pane P --space S] \| --standalone] [--in-pane]` | Starts the host and records the surface. A board opens in its own window. Notes, pages and `--in-pane` boards split a pane beside T. For an agent flipped to Chat, `--beside-pane` and `--space` name its chat pane P and space S, and fail unless T's `herdr.chat` label equals P |
| `hws surface focus --id S` | Shows the surface's owning terminal, or its chat pane when flipped, and brings Herdr forward. Fails when that terminal has ended |
| `hws surface done --id S --bundle DIR` | Moves DIR to the artifact store, delivers, closes the pane |
| `hws surface socket [--terminal T] [--title X]` | Prints the socket of that terminal's surface, so agents can drive it with `agent-brief` |
| `hws artifact list [--workspace W]` | Artifacts |
| `hws link ARTIFACT` | Prints `@<absolute prompt.md path>`, ready to paste into Claude |
| `hws todo list\|add\|edit\|move\|send\|archive` | To-dos for a space. See [To-dos](#to-dos-hws-todo) |
| `hws artifact terminal ARTIFACT` | Opens a new tab running `claude` with that artifact's prompt |
| `hws promote [--workspace W] --name N --folder F [--kind K]` | Makes a throwaway a kept workspace and moves its artifacts. W defaults to the current workspace |
| `hws close [--workspace W] [--keep\|--trash]` | Closes the space. A throwaway with artifacts and no flag returns `{"decision":"needed","artifacts":[...]}` and closes nothing |
| `hws resume [--workspace W]` | Runs `claude --resume` in shell panes whose recorded session lost its process |
| `hws prune` | Removes manifests whose space no longer exists. Does nothing when the Herdr window does not answer |

## Delivery on Done

1. The host writes a bundle folder with `prompt.md` and any `images/`.
2. It calls `hws surface done --id S --bundle DIR`.
3. `hws` moves the bundle to the artifact store and rewrites paths inside `prompt.md` to the new location.
4. For a glued surface whose terminal is live, `hws` runs `hc send T "<prompt.md text>"`, then `herdr-app do pane.close --pane P`, then `herdr-app do pane.focus --terminal T`.
5. For standalone, or a terminal that ended, `hws` records the artifact and prints `{"standalone":true,"artifact":"...","link":"@..."}`. The host then shows Open terminal and Copy link.

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

`hws surface open` shows a board in an ordinary floating window, unless `--in-pane` asks for Pixel. It sets `HWS_SURFACE_WINDOW=1` and `HWS_SURFACE_OWNER`, a label naming the owning terminal, and starts the host with `hc run --bg` in a terminal with no pane. The surface record has `pane: null` and `host`, that terminal's address.

Closing the window quits the host, and the next prune drops the record. Done delivers, shows the owning terminal and closes the window. Closing the workspace kills the host.

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
| Workspace row | `space.select` for that space |
| Panel button on the current workspace | `mod.open` for `hws-panel` |

The section reloads with `hws list` when the spaces change and every 60 seconds. It sizes its block with `layout.resize`, up to five rows, and shows only the + when the sidebar is narrower than 160px.

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
| Tab bar | Switch tabs, toggle the right panel | `hws-tabs`, with Files, Changes, Tasks, Outputs |
| Pane header | Act on this agent | `hws-pane` `+`, always visible on agent and chat panes |
| Chat composer | Act on this agent while typing | The same menu, plus Attach file |
| Own window, or a pane beside the agent | Do the work | Boards in their own window, notes and pages in a pane |
| Right panel | See what the work produced | Files, Changes, Tasks, Outputs |

### New menu: `hws-actions`

A popup that the pane header and the chat composer open at the pointer.

| Prop | Meaning |
|---|---|
| `terminal` | The agent the surface attaches to. Required |
| `chat` | True when the agent is flipped to Chat |
| `pane` | The chat pane, when `chat` is true |
| `space` | The space id, when `chat` is true |
| `lastReply` | The agent's last reply, when the chat has one |

| Item | Shown | Action |
|---|---|---|
| Sketch | Always | `hws surface open --type board` |
| Write | Always | `hws surface open --type note` |
| Write from last reply | `lastReply` is set | Writes the reply to a file, then opens it with `--type note --file F` |
| Review a page… | Always | macOS file chooser, then `--type page --file F` |
| Attach file… | `chat` is true | `setShared("hws-chat.attach", { pane, at })` |
| Tasks | Always | Selects `tasks` in `panel-body` and shows `panel` |
| Outputs | Always | Selects `outputs` in `panel-body` and shows `panel` |

Every `hws surface open` passes `--terminal T`. A flipped agent also passes `--beside-pane P --space S`.

### Flipped agents

A flipped agent has no pane, and `herdr-app ls` does not list chat panes. Mods find one this way:

1. Take each entry in `panes()` whose `mod` is `hws-chat`.
2. Find the live terminal in `terminals()` whose `herdr.chat` label equals that pane.
3. Its tab is the pane's `tab`. Its space is the entry in `spaces()` that holds that tab.

`hws surface open --terminal T --beside-pane P --space S` opens a board in its own window and splits a note or page beside P. It fails unless T's `herdr.chat` label equals P. On Done, `hws` reads T's `herdr.chat` label again. It focuses that pane when the label is set and the terminal otherwise.

### Right panel: `hws-work`

`panel-body` has four children: `files`, `changes`, `tasks` and `outputs`. The last two run `hws-work` with `{"view":"tasks"}` and `{"view":"outputs"}`.

Both views read the active space's Claude agents, flipped ones included, and bind each to its session by `host.hcTerminal` from `agent-brief sessions --json`.

Tasks shows your to-dos beside the agents' items on one board.

| Column | Your to-dos | Agent items |
|---|---|---|
| To do | `column` is `todo` | None |
| In progress | `column` is `doing` | Open, and not waiting |
| Waiting on you | None | Open, and the last line is Claude's |
| Done | `column` is `done` | Checked |

- The board always shows four columns side by side. They share the width at 840px or wider and scroll sideways at 200px each below that.
- The panel widens to 860 while Tasks shows and returns to 368 after. The header's expand button also switches between those widths.
- The board always renders. A problem reaching Agent Brief is one quiet line under the header, and to-dos still work.
- `hws-work` keeps `shared("hws.tasks.waiting")` equal to the Waiting on you count, and `hws-tabs` shows it on the Tasks button.

| Card | Shows | Click | Drag |
|---|---|---|---|
| To-do | Title, first line of notes, the agent it was sent to | Opens the to-do dialog | Release over To do, In progress or Done |
| Agent item | `#n`, title, agent name, Claude's last line | Focuses the agent | None, because the agent owns the items file |

Drag uses press and release across elements, as Herdr's tab bar does. The column under the pointer highlights during a drag, and Waiting on you never accepts a drop.

`+ Add` in the To do column head and in the header opens the dialog. The dialog has title, notes, a column choice, Send to, Archive and Save. Send to lists every agent in the space, flipped ones included, and never picks one for you.

### To-dos: `hws todo`

Only `hws` writes `<state root>/todos/<space id>.json`. To-dos belong to a space, so they work in ordinary spaces as well as workspaces, and they survive closing a workspace.

```json
{ "version": 1, "space": "sp1", "items": [
  { "id": "t1a2b3", "title": "Fix login", "notes": "", "column": "todo", "terminal": null, "archived": false, "createdAt": 1, "updatedAt": 1 }
] }
```

| Command | Does |
|---|---|
| `hws todo list [--space S]` | Prints unarchived items, newest `updatedAt` first |
| `hws todo add --title X [--notes N] [--space S]` | Adds to `todo` |
| `hws todo edit --id I [--title X] [--notes N] [--space S]` | Changes the text |
| `hws todo move --id I --column todo\|doing\|done [--space S]` | Changes the column |
| `hws todo send --id I --terminal T [--space S]` | Pastes the title and notes into T with `hc send`, sets `terminal`, moves to `doing` |
| `hws todo archive --id I [--space S]` | Sets `archived`. Nothing is deleted |

`--space` defaults to the window's selected space. Mods always pass it. The to-do dialog sets `shared("hws.todos.changed")` after a change, and the board reloads on it.

A surface runs on this computer. The `+` menu is hidden for a remote agent, and `hws surface open` refuses a terminal whose address has a machine prefix.

Outputs lists each agent's outputs, newest first. A local `.html`, `.htm` or `.md` output opens beside its agent with `hws surface open --type page`. Anything else goes to macOS `open`.

`mod.open:hws-brief` shows or hides Outputs in the right panel.
