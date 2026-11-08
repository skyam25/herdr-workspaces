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
| `hws surface open --type board\|note\|page [--title X] [--file F] [--terminal T \| --standalone] [--in-pane]` | Starts the host and records the surface. A board opens in its own window. Notes, pages and `--in-pane` boards split a pane beside T |
| `hws surface focus --id S` | Shows the surface's owning terminal and brings Herdr forward. Fails when that terminal has ended |
| `hws surface done --id S --bundle DIR` | Moves DIR to the artifact store, delivers, closes the pane |
| `hws surface socket [--terminal T] [--title X]` | Prints the socket of that terminal's surface, so agents can drive it with `agent-brief` |
| `hws artifact list [--workspace W]` | Artifacts |
| `hws link ARTIFACT` | Prints `@<absolute prompt.md path>`, ready to paste into Claude |
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
