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
| Tasks | What a person sees of a workspace's Board, its one kanban. The CLI and manifest say `board` and `todo` |
| Sketch | What a person sees of a `board` surface |

## Rules

- The workspace owns the artifact. The terminal that opened a surface owns the reply.
- A surface knows its workspace and its terminal, and never guesses either.
- If the owning terminal has ended, Done acts like standalone.
- Done writes the artifact, delivers it, and collapses the surface pane.
- The manifest lives until its workspace closes. Artifacts outlive the manifest.
- A closed throwaway leaves a retired record, unless the user chose Trash.
- Only `hws` writes the manifest. Every other part calls `hws`.
- No background jobs and no notifications. Pruning runs inside `hws` commands. The one exception is the [phone listener](#phone), which runs in a Herdr terminal, starts on `hws phone` and ends with Herdr.
- User work moves to the macOS Trash. It is never deleted outright.

## Paths

| Thing | Location |
|---|---|
| State root | `$HWS_HOME`, default `~/.local/state/herdr-workspaces` |
| Install version | `<state root>/install-version`, a hash of the git trees at the repo root except `.github`, `.gitignore`, `CLAUDE.md`, `LICENSE`, `README.md`, `bin`, `core` and `docs` |
| Manifest | `<root>/workspaces/<spaceId>/workspace.json` |
| Surface data | `<root>/workspaces/<spaceId>/surfaces/<surfaceId>/` |
| Surface socket | `/tmp/hws-<surfaceId>.sock`, kept short for the Unix limit |
| Kept artifacts | `<notes place>/<title>-<artifactId>/` for a note's Done bundle, `<artifacts place>/<title>-<artifactId>/` for other Done bundles and `<artifacts place>/<file name>` for `hws artifact add`, default place `<folder>/.herdr-workspace/<name>-<id tail>/artifacts/` |
| Kept scratch | `<scratch place>`, default `<folder>/.herdr-workspace/<name>-<id tail>/scratch/` |
| Throwaway scratch | `<root>/workspaces/<spaceId>/scratch/`, which is also the throwaway's `folder` |
| Throwaway artifacts | `<root>/workspaces/<spaceId>/artifacts/<artifactId>/` |
| Kept throwaway work | `~/Documents/Herdr Workspaces/<name>/<artifactId>/` and `.../<name>/scratch-<id tail>/`, written by `hws close --keep` |
| Standalone artifacts | `<root>/standalone/artifacts/<artifactId>/` |
| Retired throwaways | `<root>/retired/<spaceId>.json` |
| Phone data | `<root>/phone/`, holding `ipad/`, `sends/`, `boards/` and `bundles/` |
| Phone socket | `/tmp/hws-phone-<hash of the state root>.sock`, mode 600 |
| Tidy packet | `<root>/workspaces/<spaceId>/tidy/packet.json` |
| Settings | `<root>/settings.json`, which may hold `places`, the default place map for kept workspaces |

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
  "stage": "discovery",
  "places": { "current": "docs/NEXT-STEPS.md", "artifacts": "docs", "decisions": { "path": "decisions", "writer": "pmos" } },
  "current": {
    "tidiedAt": 1794000000000,
    "covers": { "sessionsThrough": 1794000000000, "artifactsThrough": 1794000000000, "commit": "2a12556" }
  },
  "tidy": { "terminal": "t12", "startedAt": 1794000000000, "packet": "<root>/workspaces/<spaceId>/tidy/packet.json" },
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
      "createdAt": 1794126748609,
      "status": "current",
      "supersedes": null
    }
  ]
}
```

`id` is the first space's id and never changes, even after that space closes or leaves. `spaces` lists every space in the workspace. A manifest without it has only `id`. `board` is the workspace's Board space and its Board tab, absent until someone adds a Board.

| Field | Meaning |
|---|---|
| `stage` | `discovery`, `deciding`, `building` or `settled`. Optional. Set with `hws set --stage` |
| `storeName` | The name the default place folders were built from. Set by the first rename of a kept workspace, because `.herdr-workspace/<name>-<id tail>/` holds the name |
| `archived` | `{ at, spaces: [{ name, folder, board, tabs: [{ name, folder, session: { tool, id } or null }] }] }`. Set by `hws archive`, removed by `hws unarchive`. `spaces` at the top level is empty while it is set |
| `places` | Role to place map. Optional. Holds only roles set with `hws set --place` |
| `current.tidiedAt` | When the last tidy pass was applied. Absent until the first |
| `current.covers` | The newest stream item each source had absorbed at that pass. Any key may be null |
| `tidy` | The tidy pass `hws tidy start` opened. Absent when none was started |
| `terminals[].role` | `tidy` on the terminal `hws tidy start` opened. Freshness leaves its session out |
| `artifacts[].role` | `tidy` on a review saved from the tidy terminal, or on any surface showing a file from the workspace's `tidy/` folder. `feedback` on the Done bundle of any other page that shows a file. Freshness and `hws artifact scan` leave both out, and the panel lists neither as an artifact of its own. Absent on other artifacts |
| `artifacts[].file` | On a `feedback` round, the absolute path of the file the page showed. Absent otherwise |
| `artifacts[].reviewOf` | On a `feedback` round, the id of the `file` artifact that tracked that file at Done, or null when none did. Absent otherwise |
| `artifacts[].status` | `draft`, `current` or `superseded`. Done writes `current`. A record without it reads as `current` |
| `artifacts[].supersedes` | The id of the artifact this one replaces, or null. Absent reads as null |
| `artifacts[].type` | `board`, `note` or `page` from Done, `file` or `link` from `hws artifact add` |
| `artifacts[].inPlace` | True on a file registered with `--in-place`, which `hws` never moves. Absent otherwise |
| `artifacts[].url` | The address of a `link` artifact. Absent otherwise |

### Places

`hws` speaks in roles. Folder names belong to the user.

A kept workspace has two folders. `folder` is where its agents run, which sets where tabs start, which transcripts belong to it and which `CLAUDE.md` applies. `home` is where its files live, and is absent when it matches `folder`. Relative place paths resolve against `home`. With a `home` of its own the defaults are plain names inside it, so a workspace at `/product/05-projects/project1` holds:

| Path | Holds |
|---|---|
| `CURRENT.md` | The latest state, rewritten by each tidy pass |
| `notes/` | Written notes, one folder each, named `<title>-<id>` |
| `artifacts/` | Boards, reviews and registered files, named the same way |
| `decisions/decisions.md` | Each decision and what replaced it |
| `history/` | Earlier notes, `updates.md` and archived docs |
| `scratch/` | Working files, and unsent drafts under `drafts/` |

Notes and artifacts reach the note through a tidy pass. Each new or edited one appears under Not in the note yet until a pass folds it in. A throwaway and a surface with no workspace keep everything in the state root.

| Role | Holds | Default for a kept workspace |
|---|---|---|
| `current` | The current note | `CURRENT.md` |
| `notes` | Done bundles from a note surface | `.herdr-workspace/<name>-<id tail>/notes/` |
| `artifacts` | Done bundles from boards and pages, and registered files | `.herdr-workspace/<name>-<id tail>/artifacts/` |
| `scratch` | Working files, and unsent drafts under `drafts/` | `.herdr-workspace/<name>-<id tail>/scratch/` |
| `decisions` | Decision log, `decisions.md` inside the folder. A path ending in `.md` names the file itself | `.herdr-workspace/<name>-<id tail>/decisions/` |
| `history` | Earlier notes, `updates.md` and demoted docs | `.herdr-workspace/<name>-<id tail>/history/` |
| `meetings` | Transcribed meeting notes | Unset |

- A role resolves from the manifest, then from `settings.json` `places`, then from the default above.
- The `settings.json` map applies to every kept workspace without its own entry for that role.
- A throwaway has only `artifacts` and `scratch` under `<root>/workspaces/<spaceId>/`. Standalone has only `artifacts`. Neither reads `settings.json` or accepts `--place`.
- A place is a path string or `{ "path": "...", "writer": "name" }`. Paths are relative to the workspace folder, absolute, or start with `~/`.
- A writer other than `hws` makes the place read-only to `hws`. Done refuses to land there and `hws place` creates nothing there.
- Changing a place moves no files. It changes where new things land.

## CLI: `hws`

Node 20 or newer, ESM, no runtime dependencies. Entry is `bin/hws`.

Every command accepts `--json`. Success exits 0. Failure prints `{"error":"..."}` under `--json`, or the message on stderr, and exits 1. Bad usage exits 2.

| Command | Result |
|---|---|
| `hws doctor [--record]` | Checks Node, `herdr-app`, `hc`, the `~/.local/bin/hws` link, installed mods and layout against this checkout, the layout the window shows, Pixel, the surface build and the Claude plugin, and counts the commits on GitHub's `main` that the checkout lacks. It compares the install version with the recorded one. Being behind, a stale install, or a window on another layout prints a `note` and never fails. `--record` writes the install version once every other check passes, or removes it when tracked files have uncommitted changes. Only `install.sh` passes `--record`, after a run that skipped and failed nothing. No answer from GitHub skips that check. Prints `{ok,checks:[{name,ok,detail,fix}]}` and exits 1 when any check fails |
| `hws update` | Pulls `main` with `--ff-only`, then runs `install.sh --force` with its output on stderr when the checkout's install version differs from `<state root>/install-version` or that file is missing. Prints `{updated,from,commit,installed}`, or `{updated:false,commit}` when the pull found nothing and the install is current. Fails with no change on another branch or with uncommitted changes to tracked files. A failed install records nothing, so the next `hws update` installs again |
| `hws new terminal [--folder F]` | Opens a normal tab. No manifest |
| `hws new workspace --name N --folder F [--home H] [--kind K] [--tabs Plan,Build] [--instructions X]` | F must exist. Creates one space and the manifest, and remembers F as the parent folder. The space has one unnamed tab unless `--tabs` names some. Each tab starts a shell in F. K defaults to `general` |
| `hws board add [--workspace W]` | Adds W's one Board space, or finds it, and prints `{workspace,space,tab}`. W defaults to the current workspace. A new Board space is named `Tasks` |
| `hws board open --space S` | Finds the Board of S's workspace and prints `{workspace,space,tab}`, with null `space` and `tab` when it has none. Prints `{"workspace":null}` for a plain space. Never creates a Board |
| `hws space add --workspace W [--name N] [--folder F]` | Opens a new space in W. F defaults to W's folder |
| `hws space move --space S --workspace W` | Moves an open local space into W. A plain space's cards join W's Board. A space leaving another workspace leaves its cards there. Fails when S is that workspace's last space or its Board space |
| `hws space remove --space S` | Takes S out of its workspace and leaves it open as a plain space. Its cards stay on the Board. Fails on the workspace's last space or its Board space |
| `hws space match [--space S]` | Prints `{ space, folder, candidates: [{ id, name, folder, home }] }`. Candidates are the open kept workspaces S is not in whose `folder` or `home` equals S's folder or holds it, deepest first. A workspace rooted at the home directory or `/` matches only that exact folder. Paths compare after resolving links. A member space, a remote space and a space with no folder give no candidates. S defaults as it does for `hws todo`. Writes nothing |
| `hws set [--workspace W] [--name N] [--kind K] [--instructions X] [--stage S] [--home H] [--place ROLE=PATH ...] [--writer ROLE=NAME ...]` | Changes a workspace's name, instructions and stage, or a kept workspace's kind and places. `--home H` changes where a kept workspace's files live. H must exist, an empty value clears `home`, and no files move. `--name` also renames any space that carries the old name, moves no files and keeps the default place folders where they were. An empty name exits 2. An unknown role or stage exits 2. `--place ROLE=` drops the role from the manifest. A new path keeps the role's writer. `--writer` needs the role to have a manifest path, and `--writer ROLE=hws` clears it |
| `hws tidy status [--workspace W] [--line]` | Prints how far the current note is behind the stream. See [Tidy](#tidy) |
| `hws tidy start [--workspace W] [--pane P]` | Writes the packet and opens the pass in a terminal pane, or asks the live pass to read the packet again. See [Tidy](#tidy) |
| `hws decision add --title X --why Y [--decided-at YYYY-MM-DD] [--cites A,B] [--replaces D-001,D-002] [--workspace W]` | Appends a decision to the log and marks what it replaces. Prints `{ id, decidedAt, title, replaces }`. Fails when another tool writes the `decisions` place, or when `--replaces` names a decision that is gone or already replaced |
| `hws decision list [--workspace W]` | Prints `{ path, writer, decisions }`, each decision `{ id, decidedAt, title, replacedBy }`. Another tool's log has no entries |
| `hws tidy start --here [--workspace W]` | Writes a fresh packet for the agent in this terminal to work from and prints its path. Records no pass, so it opens no terminal and `hws tidy stop` has nothing to end. Fails when another terminal runs a pass |
| `hws tidy apply --file PROPOSAL [--skip current,decisions,demote,artifacts,cards] [--workspace W]` | Applies an accepted proposal, stamps `current` and clears `tidy`. See [Tidy](#tidy) |
| `hws tidy stop [--workspace W]` | Clears `tidy` and ends its terminal. Prints `no tidy pass is running` when none is recorded |
| `hws place ROLE [--workspace W]` | Prints the absolute path for ROLE, or nothing when unset. `--json` prints `{role,path,writer}`. Creates the `scratch` and `artifacts` folders on first use when `hws` is their writer, never the others |
| `hws parent` | Prints the folder new work starts in: the last used, else `~/Projects`, else home |
| `hws new throwaway [--name N]` | Creates a throwaway with one tab running `claude` in its scratch folder. The space opens on a shell in the parent folder, which closes once the tab is open |
| `hws current [--terminal T] [--line]` | The manifest for T, default `$HC_TERMINAL_ID`. `--line` prints one sentence for agents followed by the workspace instructions, or nothing outside a workspace |
| `hws list [--archived]` | Every open manifest, each with `dir` set to its state folder. `dir` is not stored in the manifest. `--archived` lists only archived workspaces |
| `hws register --terminal T --session S [--role R]` | Records a Claude session against its terminal, in `<state root>/terminal-sessions/` for any terminal and in the manifest for a workspace's terminal |
| `hws surface open --type board\|note\|page [--title X] [--file F] [--terminal T [--beside-pane P --space S] \| --standalone] [--in-pane]` | Starts the host and records the surface. A board opens in its own window. Notes, pages and `--in-pane` boards split a pane beside T. For an agent flipped to Chat, `hws` reads the chat pane from T's `herdr.chat` label and finds the space as `hws todo` does, then from the tab T was recorded in. `--beside-pane` and `--space` name the pane P and space S outright, and fail unless T's `herdr.chat` label equals P. A file already open in a pane gets the focus, and the result has `focused: true` |
| `hws review FILE\|ARTIFACT [--title X] [--terminal T]` | Opens an `.html` or `.md` file as a page beside T, default `$HC_TERMINAL_ID`, as `hws surface open --type page --file F --terminal T` does. ARTIFACT is the id of a `file` artifact or of a feedback round. A kept workspace first tracks an untracked file where it sits, as `--in-place` does. Prints the surface with `file` and `artifact`, the tracking artifact's id or null. The text tells the agent to end the turn, or says that the page is already open in a pane with no agent attached. Never opens standalone |
| `hws surface focus --id S` | Shows the surface's owning terminal, or its chat pane when flipped, and brings Herdr forward. Fails when that terminal has ended |
| `hws surface list` | Windows and drafts, oldest first, as `[{id,type,title,terminal,workspace,open}]`. Leaves out closed windows with no work |
| `hws surface resume --id S` | Brings an open window forward, or starts a closed one again on the same id and data |
| `hws surface discard --id S` | Moves a draft's data to the Trash and drops its record. Fails while the window is open |
| `hws surface done --id S --bundle DIR` | Moves DIR under the workspace's `artifacts` place, records it with status `current`, delivers, closes the pane. Fails and leaves DIR when another writer owns that place. See [Delivery on Done](#delivery-on-done) |
| `hws surface socket [--terminal T] [--title X]` | Prints the socket of that terminal's surface, so agents can drive it with `agent-brief` |
| `hws phone pair` | In a terminal, shows a QR code and waits for a phone. Without a terminal on stdout, opens a Pair phone tab that does this. See [Phone](#phone) |
| `hws phone send FILE\|ARTIFACT [--prompt X] [--terminal T] [--space S]` | Puts an `.html` or `.excalidraw` file in the phone's inbox, tied to T. Prints the hand-off. Fails when no phone is paired or the file is another type |
| `hws phone status` | Prints `{running,paired,devices,handoffs}`. Starts the listener when a phone is paired, and never otherwise |
| `hws phone forget NAME\|ID` | Revokes one paired phone |
| `hws phone stop` | Quits the listener |
| `hws phone deliver --send P --bundle DIR` | Called by the listener. Files DIR as an artifact and delivers it. See [Phone](#phone) |
| `hws artifact list [--workspace W]` | Artifacts, including those of retired throwaways when W is absent |
| `hws artifact set ID [--status draft\|current\|superseded] [--supersedes ID]` | Changes an artifact in an open workspace and prints its record. Needs one of the two flags. `--supersedes` must name another artifact of the same workspace, and an empty value clears it |
| `hws artifact add --file F [--title X] [--workspace W]` | Registers F as an artifact with type `file` and status `current`, and prints its record. `path` and `prompt` are the file. A file inside the `artifacts` place stays where it is. Any other file moves to `<artifacts place>/<file name>`, and the command fails when that name is taken or another writer owns the place. The title defaults to the file name |
| `hws artifact add --file F --in-place [--title X] [--workspace W]` | Kept workspaces only. Registers F where it is, anywhere on disk, with `inPlace: true`. Registering the same path again returns the first record with `existing: true` |
| `hws artifact add --url URL [--title X] [--workspace W]` | Kept workspaces only. Registers a web document with type `link`. `path`, `prompt` and `url` hold the URL. Registering the same URL again returns the first record |
| `hws artifact scan [--workspace W]` | Prints `{tracked, candidates, more}`. `candidates` lists output files under the home, files its documents link to and web documents they name, none of them tracked. Writes nothing |
| `hws link ARTIFACT` | Prints `@<absolute prompt.md path>`, ready to paste into Claude |
| `hws todo list\|add\|edit\|move\|send\|archive` | To-dos for a workspace, or for a space outside one. See [To-dos](#to-dos-hws-todo) |
| `hws artifact terminal ARTIFACT` | Opens a new tab running `claude` with that artifact's prompt |
| `hws promote [--workspace W] --name N --folder F [--kind K]` | Makes a throwaway a kept workspace. Artifacts move into the kept `artifacts` place and scratch contents into the kept `scratch` place, both resolved as for any kept workspace. It refuses before moving anything when a place has another writer or the scratch place already holds a name. The emptied scratch folder stays for live shells. W defaults to the current workspace |
| `hws close [--workspace W] [--keep\|--trash]` | On a kept workspace, archives it, as `hws archive` does. On an archived one, removes it for good. Otherwise closes every space in W, the caller's own last. A throwaway with artifacts or scratch files and no flag returns `{"decision":"needed","artifacts":[...],"scratch":PATH\|null}` and closes nothing. `--keep` moves artifacts and the scratch folder under `~/Documents/Herdr Workspaces/<name>/`. `--trash` sends both to the Trash and leaves no retired record |
| `hws archive [--workspace W]` | Closes every space in a kept workspace and keeps its manifest, with its to-dos, artifacts and places. Saves each space's name and folder, and each tab's name, folder and agent session, in `archived`. Ends window hosts and flipped agents. Refuses a throwaway and an archived workspace |
| `hws unarchive --workspace W` | Reopens the saved spaces with new space ids, resumes each saved agent session, makes a new Tasks space if the workspace had one and selects the first space. `id` stays. A tab whose folder is gone falls back to its space's folder and then the workspace's. Fails and changes nothing when the workspace folder is gone |
| `hws resume [--workspace W]` | Runs `claude --resume` in shell panes whose recorded session lost its process |
| `hws prune` | Drops closed spaces from manifests, archives a kept workspace with no open space, removes a throwaway's manifest with no open space, expires idle throwaways and purges old retired records. Prints `{pruned,expired,skipped}`. Does nothing when the Herdr window does not answer or lists no local space |
| `hws find [TEXT...]` | Archived workspaces and retired throwaways, newest first. An archived one has `archived: true`. TEXT must match every word in the name, instructions, a session title, a last prompt or an artifact title |
| `hws reopen ID` | Restores an archived workspace, as `hws unarchive` does. For a retired throwaway, opens it in a new space, with one tab per session running `claude --resume`, and removes its record. The tabs start in the record's `folder`, which `hws` makes again when it sits under the state root. The record's `scratch` becomes the manifest's `scratch` place |

## Delivery on Done

1. The host writes a bundle folder with `prompt.md` and any `images/`.
2. It calls `hws surface done --id S --bundle DIR`.
3. `hws` moves the bundle under the workspace's `artifacts` place and rewrites paths inside `prompt.md` to the new location.
4. For a glued surface whose terminal is live, `hws` runs `hc send T "<prompt.md text>"`, drops the surface's record, then runs `herdr-app do pane.close --pane P` and `herdr-app do pane.focus --terminal T`.
5. For standalone, or a terminal that ended, `hws` records the artifact and prints `{"standalone":true,"artifact":"...","link":"@..."}`. The host then shows Open terminal and Copy link. A surface in a pane keeps its record, so the file opens to the same pane and a second press files a second bundle. A board in its own window loses its record.

### Feedback rounds

A page that shows a file is a round of feedback on that file. Tidy reviews are the exception.

| Item | Behaviour |
|---|---|
| Record | `type: page`, `role: feedback`, `title: Feedback on <surface title>`, `file`, and `reviewOf` |
| `reviewOf` | The `file` artifact whose path is the file, compared after resolving links. `hws review` tracks the file first, so its rounds always have one |
| Prompt | Before a live terminal gets it, `prompt.md` gains a last line. It asks the agent to run `hws review <file>` after changing the page |
| Freshness, scan, session start | Leave rounds out, because a round is a message and not work that landed |
| Panel | Lists a round under the artifact it reviews. See [Workspace panel](#workspace-panel-hws-panel) |

### Clearing what was delivered

The host keeps a sent draft until `hws surface done` succeeds, so a refused bundle loses nothing.

| Case | Behaviour |
|---|---|
| Before the call | The host writes `<data folder>/handed-off.json` with the draft's id and revision |
| `hws` fails | The host removes that file and keeps the draft |
| `hws` succeeds, pane stays open | The host deletes the draft, removes the file, pushes `sent` to the page, and opens the file again. The page drops the delivered comments and keeps any added since |
| `hws` succeeds, pane closes | Closing the pane ends the host. The next host on that data folder finds the file at start and deletes the draft |
| Draft edited after the Send | It stays, because that text did not go out |
| A standalone press with nothing new | Acts on the artifact the last press saved |

A file opens as the same surface each time, so this is what keeps delivered comments off the page when it opens again.

## Temporary throwaways

Throwaways close themselves when idle and stay findable afterwards. `prune` does the work, and the sidebar's `hws list` runs it every 60 seconds.

| Stage | When | Effect |
|---|---|---|
| Expire | 24 hours after the last activity | The space closes and a retired record is written |
| Purge | 30 days after the close | Artifacts and the scratch folder under the state root go to the Trash and the record goes. Kept artifacts, kept scratch and transcripts stay |

Last activity is the newest of `createdAt` and the modified time of each session's transcript, `<claude home>/projects/<folder with symbols as dashes>/<sessionId>.jsonl`. The Claude home is `CLAUDE_CONFIG_DIR` or `~/.claude`.

Expiry skips a throwaway in any of these cases.

- It is the selected space, or the window does not report a selected space.
- A listed agent's status is anything but idle. `done` means an answer nobody has seen.
- A listed terminal without an agent is running something other than a shell.
- A flipped agent's status is anything but idle.
- A surface has its own window open.

Every close of a throwaway writes the record, whether by expiry, `hws close` or Herdr's own UI. A throwaway with no transcript, no artifacts and no file in its scratch folder has no record, and its scratch folder goes. The record keeps the scratch path, and the scratch files stay until purge. `hws close --trash` sets `discarded` on the manifest, which suppresses the record even if the closing process ends with the space.

```json
{
  "version": 1,
  "id": "spc...",
  "name": "throwaway-1c26",
  "folder": "/Users/me/.local/state/herdr-workspaces/workspaces/spc.../scratch",
  "scratch": "/Users/me/.local/state/herdr-workspaces/workspaces/spc.../scratch",
  "createdAt": 1794126748609,
  "closedAt": 1794226748609,
  "sessions": [{ "sessionId": "uuid", "activeAt": 1794200000000, "title": "Fix login", "lastPrompt": "why does login fail" }],
  "artifacts": []
}
```

`folder` is where the sessions started, so `claude --resume` works there. `scratch` is where the scratch files are, which differs from `folder` after `--keep`. Records written before scratch folders have the parent folder and no `scratch`.

`sessions` is newest first. `title` and `lastPrompt` come from undocumented transcript lines, `ai-title` and `last-prompt`. When `last-prompt` has no text, `lastPrompt` is the newest typed user message, up to 2,000 characters.

The launcher's Find past work dialog calls `hws find -- TEXT` as you type and `hws reopen ID` on a row.

## Tidy

A tidy pass rewrites a kept workspace's current note from the stream gathered since the last pass. `hws` gathers and applies. A Claude session with the `herdr-workspaces:tidy` skill reads and proposes.

### Current note

Five fixed headings, short lines, a cite at the end of each line. The pass rewrites the whole note. An agent may add one dated line under Decisions in force after the person confirms a decision mid-session.

```markdown
# Current

## Goal
- Customers get a receipt they can keep [file:README.md]

## Now
- Boards open in their own window and notes stay in a pane [commit:ba7d965]

## Decisions in force
- 2026-11-04 Studio is removed, board and note cover it [card:17]

## Open questions
- Should partial refunds list only the returned items? [artifact:a1]

## Next
- Pick a panel treatment [file:docs/panel-options.md]
```

Cite tokens are `[card:ID]`, `[session:ID]`, `[commit:SHA]`, `[artifact:ID]` and `[file:PATH]`. The panel turns each into an action.

### Decision log and history

The note holds only what is true now. Two files keep how it got there.

`<decisions place>/decisions.md` gains one entry per decision, oldest first. Only `hws` writes it. Replacing a decision adds one line under the old heading and changes nothing else in that entry.

```markdown
## D-001 · 2026-11-04 · Email receipts use PDF

Replaced by D-002.

PDFs print cleanly.

[card:17]

## D-002 · 2026-11-08 · Email receipts use HTML

Replaces D-001.

PDFs fail on the cafe's older phones.

[card:21]
```

`decidedAt` is the day the decision was made, taken from the source. Each `hws tidy apply` also writes to the `history` place, unless another tool writes it.

| File | Holds |
|---|---|
| `current-YYYY-MM-DD.md` | The note this pass replaced. A taken name gains `-2`, `-3` and so on |
| `updates.md` | One entry per pass, newest first, with the summary, decisions, status changes, moved files and archived cards |

### Freshness

Counted on read against `current.covers`.

| Source | Behind when |
|---|---|
| Sessions | A session recorded in `terminals` has a transcript modified after `sessionsThrough`. The tidy terminal's session and sessions with no transcript are left out |
| Artifacts | `createdAt` is after `artifactsThrough`, or the file changed after it, which sets `editedAt`. An artifact with a `role` is left out, which covers tidy reviews and feedback rounds |
| Commits | In `git log covers.commit..HEAD` in the workspace folder, limited to `home` when the workspace has one of its own. With no `covers.commit`, every commit since the workspace's `createdAt`. A commit whose files all sit under the `scratch`, `current`, `decisions` or `history` place is left out |
| Cards | A Done card on the workspace's task list that is not archived |

- With no `current`, every item is behind and `tidiedAt` is null.
- `landed` counts what has actually landed, which is non-draft artifacts, commits and cards, plus their `total`. Sessions and draft artifacts stay in `behind` and `items`, and never move the ring or the sentence.
- A folder outside git, or a `covers.commit` git cannot find, counts zero commits. `git` in the status says which.

### `hws tidy status [--workspace W] [--line]`

```json
{
  "tidiedAt": 1794000000000,
  "stage": "deciding",
  "behind": { "sessions": 3, "artifacts": 2, "commits": 0, "cards": 1 },
  "items": [{ "kind": "session", "id": "uuid", "title": "session title or null", "at": 1794000000000, "path": "/abs/transcript.jsonl" }],
  "git": { "repo": true, "head": "sha", "base": "sha or null", "baseFound": true },
  "live": { "terminal": "t12", "startedAt": 1794000000000, "packet": "/abs/packet.json" },
  "places": { "current": "/abs/CURRENT.md", "artifacts": "/abs/...", "scratch": "/abs/...", "decisions": "/abs/decisions", "history": null, "meetings": null },
  "writers": { "current": null, "artifacts": null, "scratch": null, "decisions": "pmos", "history": null, "meetings": null },
  "line": "Current is 3 sessions, 2 artifacts and 1 card behind, last tidied Nov 3"
}
```

- Status changes nothing on disk. It resolves places without creating the folders `hws place` would create.

- A session's `title` is its first typed prompt when that has real words. A prompt of only an `@path`, a path, a file name or an image marker has none, and the title is then the transcript's first `ai-title`, else the first prompt with real words, else null. The packet's `since.sessions[].title` follows the same rule.
- `items` lists sessions, artifacts, commits and cards in that order, each newest first. `kind` is `session`, `artifact`, `commit` or `card`. `id` is the session id, artifact id, commit sha or card id. `path` is the transcript or artifact folder, and null for commits and cards.
- `live` is the manifest's `tidy` while its terminal is live, and null otherwise.
- `places` maps every role to its absolute path, or null when unset, as in the packet. `writers` maps every role to its writer, or null when `hws` writes it.
- `record` holds `decisions` as `{ path, inForce, replaced }` once the log has an entry, and `updates` as the path of `updates.md` once it exists. Each is null otherwise, and `record` is null for a throwaway.
- An artifact item carries `edited: true` when its file changed after the last pass.
- `line` is the sentence `--line` prints. It is null for a throwaway.
- Without `--json`, prints the sentence below.
- `--line` prints one sentence, `{"line":...}` under `--json`. It prints nothing for a terminal outside a workspace, a throwaway or standalone. W defaults to the calling terminal's workspace.

| State | Sentence |
|---|---|
| No `current` and no note file | `No current note yet` |
| No `current`, with a note file | `Current note not tidied yet` |
| Something landed | `Current is 2 artifacts and 1 card behind, last tidied Nov 3`. Zero sources, sessions and drafts are left out. The year follows the day when it is not this year |
| Only sessions or drafts behind | `Nothing has landed since Nov 3` |
| Nothing behind | `Current is up to date, last tidied Nov 3` |

### `hws tidy start [--workspace W] [--pane P]`

1. Fails on a throwaway or standalone, which have no current note.
2. Writes the packet below.
3. With no live pass, starts `claude` with the orchestrator's Models setting and the first prompt `Use the herdr-workspaces:tidy skill. The packet is at <packet>.` With `--pane P` it splits a terminal below P, and the panel passes its own pane. From a terminal in W it splits to that terminal's right. Each pane starts in W's folder and takes the focus, so the person can answer the agent's questions there. With neither, it opens a `Tidy` tab in W's first space other than the Board and the window keeps its selection.
4. Records that terminal in `terminals` with role `tidy`, and sets `tidy`.
5. With a live pass, opens nothing and runs `hc send <terminal> "The workspace changed. Read the tidy packet again at <packet>"`.

Prints `{ terminal, started, packet }`.

### Packet

```json
{
  "version": 1,
  "workspace": "sp...",
  "folder": "/abs/folder",
  "stage": "discovery, deciding, building, settled or null",
  "places": { "current": "/abs/CURRENT.md", "artifacts": "/abs/...", "scratch": "/abs/...", "decisions": null, "history": null, "meetings": null },
  "writers": { "current": null, "artifacts": null, "scratch": null, "decisions": null, "history": null, "meetings": null },
  "instructions": "workspace instructions",
  "current": { "path": "/abs/CURRENT.md", "exists": true, "hash": "sha256 hex or null", "tidiedAt": null, "covers": null },
  "live": {
    "artifacts": [{ "id": "a1", "title": "...", "path": "/abs", "status": "current", "createdAt": 0, "modifiedAt": 0 }],
    "decisions": { "path": "/abs/decisions.md", "writer": null, "inForce": [{ "id": "D-001", "decidedAt": "2026-11-04", "title": "..." }] },
    "cards": [{ "id": "t1", "title": "...", "column": "todo" }]
  },
  "since": {
    "sessions": [{ "id": "uuid", "transcript": "/abs/path.jsonl", "modifiedAt": 0, "title": "session title or null" }],
    "artifacts": [{ "id": "a1", "title": "...", "path": "/abs", "status": "current", "createdAt": 0 }],
    "commits": [{ "sha": "...", "subject": "...", "at": 0 }],
    "cards": [{ "id": "...", "title": "...", "notes": "...", "note": "...", "report": "...", "replies": [], "updatedAt": 0 }]
  },
  "candidates": [{ "kind": "file", "path": "/abs", "title": null, "foundIn": null, "origin": "folder", "modifiedAt": 0 }, { "kind": "link", "url": "https://claude.ai/artifact/x", "title": null, "foundIn": "README.md" }],
  "cutoff": { "sessionsThrough": 0, "artifactsThrough": 0, "commit": "HEAD sha or null" }
}
```

- `since` holds exactly the items `hws tidy status` counts as behind.
- `live.artifacts` lists every artifact not superseded and with no `role`, so a pass can catch an old one that a new decision contradicts.
- `cutoff` is taken when the packet is written. The time keys hold that moment, and `commit` holds HEAD. Work that lands during the pass stays in the next backlog.
- `current.hash` is the sha256 of the note file, or null when the file does not exist.

### Proposal

The tidy agent writes `proposal.json` beside the packet.

```json
{
  "version": 1,
  "workspace": "sp...",
  "packet": "/abs/packet.json",
  "summary": "One paragraph for the person",
  "current": "Full text of the new current note",
  "decisions": [{ "title": "Email receipts use HTML", "why": "PDFs fail on older phones", "decidedAt": "2026-11-08", "cites": ["card:t1"], "replaces": ["D-001"] }],
  "demote": [{ "path": "/abs/docs/panel-options.md", "to": "history", "reason": "Decided Nov 8" }],
  "artifacts": [{ "id": "a1", "status": "superseded", "supersedes": null }],
  "cards": ["c1"]
}
```

| Field | Rule |
|---|---|
| `version` | 1 |
| `workspace`, `packet`, `summary`, `current` | Text. `packet` is not empty |
| `decisions[]` | Optional. `title` and `why` are text. `decidedAt` is `YYYY-MM-DD`. `cites` and `replaces` are optional arrays of text |
| `demote[]` | `path` is absolute or relative to the workspace folder. `to` is `history` or `trash`. `reason` is optional text |
| `artifacts[]` | `id` and a `status` from the three. `supersedes` is an id, null, or absent to leave it unchanged |
| `cards[]` | Card ids |

A shape error exits 2 and names the field, such as `proposal demote[0].to must be history or trash`.

### `hws tidy apply --file PROPOSAL [--skip current,decisions,demote,artifacts,cards] [--workspace W]`

W defaults to the proposal's `workspace`, and the two must match. The tidy agent runs apply after Done brings the person's verdict. No surface runs it. Done on an unedited page sends `I reviewed proposal.md in Agent Brief and changed nothing.`, which counts as acceptance. Done on an edited page sends the edited copy, and the agent carries the changes into `proposal.md` and `proposal.json` before it opens the page again.

Every check runs before the first write. Apply exits 1 and changes nothing when any of these holds.

- The packet's `workspace` is not W.
- The `current` place resolves to a path other than the packet's `current.path`.
- The note's sha256 differs from the packet's `current.hash`. A null hash requires the note to still be missing.
- `current` is not skipped and another writer owns the `current` place.
- A demotion is missing, is or holds the current note, is the workspace folder or outside it, sits under a place another writer owns, is or holds any set place, or overlaps another demotion.
- A `history` demotion is already under the `history` place, or another writer owns that place.
- An artifact id is not in W, or `supersedes` names itself or an id not in W.
- A card is not on W's task list, or has left Done.
- A decision replaces one that is gone or already replaced, or another tool writes the `decisions` place and the proposal has decisions.

Then, for each part not skipped:

1. `current` saves the old note to the `history` place, then writes the new one to the `current` place through a temporary file and a rename, with a final newline.
2. `decisions` appends each entry to the log and marks what it replaces.
3. `demote` sends `trash` demotions to the macOS Trash. A `history` demotion moves to `<history place>/<name>`, or to the Trash when `history` is unset. A taken name gains `-2`, `-3` and so on before the extension. The history folder is created when needed.
4. `cards` archives each card through the task list's own locked write. The person accepted the proposal, so cards marked as theirs archive too.
5. `artifacts` sets each `status`, and `supersedes` when the proposal gives it.

Apply then adds an entry to `updates.md`, whatever was skipped.

Last, apply sets `current.tidiedAt` to now and `current.covers` to the packet's `cutoff`, and clears `tidy`, whatever was skipped.

```json
{
  "wrote": "/abs/CURRENT.md or null when skipped",
  "demoted": [{ "path": "/abs/docs/plan.md", "to": "/abs/docs/history/plan.md" }, { "path": "/abs/docs/scrap.md", "to": "trash" }],
  "artifacts": [{ "id": "a1", "status": "superseded", "supersedes": null }],
  "archived": ["c1"],
  "skipped": ["cards"]
}
```

A second apply of the same proposal fails on the hash, because the note has changed.

### `hws tidy stop [--workspace W]`

Clears `tidy`, then ends its terminal with `hc kill` when that terminal is live. The record clears first because the tidy agent may run stop from that terminal. Prints `{ stopped: true, terminal }`, or `{ stopped: false, terminal: null }` and `no tidy pass is running` when none is recorded. Fails when the terminal stays live after the kill.

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

## In a pane

Herdr resends a pane's whole image for each change to the page, so a surface in a pane holds still until the person acts. `surface/still.cjs` holds the rules, and a surface in its own window or a web view has none of them.

| Rule | Applies to |
|---|---|
| The caret stays solid | The app's page and every review page |
| Transitions finish at once | The app's page |
| `prefers-reduced-motion` reads `reduce` | The app's page and every review page |
| A hover reaches the page after the pointer rests for 90 ms. A press, a drag and a wheel turn arrive at once | Every page |

## Own window

`hws surface open` shows a board in an ordinary window that other windows can cover, unless `--in-pane` asks for Pixel. It sets `HWS_SURFACE_WINDOW=1` and `HWS_SURFACE_OWNER`, a label naming the owning terminal, and starts the host with `hc run --bg` in a terminal with no pane. The surface record has `pane: null` and `host`, that terminal's address.

Closing the window quits the host. A closed window with a drawing, comments or a note stays in the manifest as a draft, with its data folder. Prune drops a closed window with no work. Done delivers, shows the owning terminal and closes the window. Closing the workspace kills the host and moves drafts to the Trash.

A running host raises its window on `POST /open`. The Window menu's Keep on Top floats it on request.

| Where | Shows | Action |
|---|---|---|
| Pane header, beside Chat \| Terminal | Resume sketch or Show sketch for the agent's newest sketch, with +N for others | `hws surface resume` |
| `+` menu | Resume or Show, and Discard for drafts, per board | `hws surface resume`, `hws surface discard` |
| Workspace panel, Open surfaces | Every window and draft, including standalone ones | `hws surface resume` |

`hws-pane` runs `hws surface list` when the set of live terminals changes and at least every 60 seconds, one header copy at a time, and shares the result as `hws-pane.boards`.

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

## Phone

The Agent Brief app on an iPad or iPhone pairs with Herdr as one more host. `surface/app/src/phone/` wraps the unmodified iPad module in `surface/app/src/ipad/`. Surfaces never listen.

| Item | Behaviour |
|---|---|
| Process | One per state root, plain Node, `surface/app/out/phone/host.cjs`, started with `hc run --bg` in a terminal with no pane |
| Lifetime | Ends with Herdr. `hws phone pair`, `send` and `status` restart it, and the [sidebar footer](#sidebar-footer) runs `status` when Herdr starts. It exits when no phone is paired and no code is open |
| Network | HTTPS on port 47614, peers on this Mac's subnets only. Agent Brief keeps 47613 |
| Pairing | One-use code, 10 minutes. The QR code carries the certificate fingerprint, and the phone pins it |
| Control | HTTP on the phone socket. `hws` is the only client |
| Environment | `HWS_PHONE_DATA`, `HWS_PHONE_SOCKET`, `HWS_BIN`, and optional `HWS_PHONE_HOST`, `HWS_PHONE_PORT` |

| Control route | Result |
|---|---|
| `GET /status` | `{pid,paired,devices,handoffs,error?}`, with only open hand-offs |
| `POST /pair` | Opens pairing and returns `{url,qrSvg,qrText,network?,devices,error?}` |
| `GET /pair` | The same sheet. `url` is gone once a phone has paired |
| `DELETE /pair` | Cancels the code |
| `POST /handoffs` | Body `{session,label,prompt?,page?,root?,board?}` |
| `POST /forget` | Body `{id}` |
| `POST /stop` | Quits |

A send has an id `p<hex>` and a record at `<root>/phone/sends/<id>.json` with its workspace, terminal, type and file. Records and board copies older than 90 days go when a later send runs.

| Sent | Phone shows | Root |
|---|---|---|
| `.html`, `.htm` | The page, to pin comments on | The workspace folder when the file is inside it with no dot segment, and is not home. Otherwise the file's folder |
| `.excalidraw` | A copy of the drawing, to mark up | Not served as files |
| Artifact id | The artifact's file, or its `board.excalidraw`, `index.html` or only `.html` | As above |

The listener never serves a path with a segment starting with a dot. The phone cannot open Markdown, so render a note to HTML first.

An answer from the phone follows these steps.

1. The listener writes a bundle, as Done does, and calls `hws phone deliver`.
2. `hws` adds a first line naming the file, moves the bundle under the workspace's `artifacts` place and records it with `fromTerminal`.
3. A live terminal running an agent gets the prompt through `hc send`. Focus does not move.
4. A terminal that ended or sits at a shell gets nothing, because `hc send` to a shell runs the text. The phone reports the artifact id.
5. When `hws` fails, the phone keeps the work and retries.

The original `.excalidraw` file is never overwritten. The bundle's `board.excalidraw` holds the phone's version.

## External commands

Binaries resolve from `HWS_HERDR_APP`, default `herdr-app`, and `HWS_HC`, default `hc`. `HWS_CLAUDE`, `HWS_GIO` and `HWS_CHECKOUT` override `claude`, `gio` and the checkout that `hws doctor` inspects. `HWS_PLATFORM` overrides the platform the plugin hooks see. Tests point these at fakes.

macOS trashes with `/usr/bin/trash` or Finder. Linux trashes with `gio trash`. A failed trash stops the command and leaves the files in place.

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
| Space row, shown for every space unless folded | `space.select` for that space |
| Tasks row, the Board space listed first and with no minus | `space.select` for the Board space, then `tab.select` for its Board tab |
| Minus on a space row, shown with two or more spaces | `hws space remove` |
| Add space, shown under the current workspace | Opens the dialog for `hws space add` and `hws space move` |
| Add tasks, shown under the current workspace when it has no Board | `hws board add`, then shows Tasks |
| Panel button on the current workspace | `mod.open` for `hws-panel` |

The section reloads with `hws list` when the spaces change and every 60 seconds. Each reload sets `shared("hws.workspace.spaces")` to the sorted ids of every space in an open workspace, Board spaces included, only when the list changes. Each reload also runs `hws tidy status --workspace W` for every kept workspace. A workspace row shows its most urgent status, a freshness ring for a kept workspace and how many commits its folder is ahead of its upstream. The ring's tooltip is the status `line`. A kept workspace with no `tidiedAt` shows a dim unwritten ring, which is neither behind nor stale. A throwaway, or a failed status, shows no ring. Space rows show each space's status. Tabs appear only in the top bar. Right-clicking a workspace row opens a menu with Open panel, Rename and Archive, or Open panel, Rename and Close for a throwaway. Open panel selects the workspace's space and splits the panel beside a terminal on its shown tab, or focuses a panel already there. Archive, Close, Restore and Remove each ask first in a dialog. `hws list --archived` fills a folded Archived row at the end of the list. Clicking an archived workspace offers Restore, and its right-click menu has Restore, Rename and Remove, which runs `hws close`. The section sizes its block with `layout.resize`, up to 300px of rows and then scrolling, and shows only the + when the sidebar is narrower than 160px.

## Spaces sidebar section

The `spaces` block runs `hws-spaces`, a copy of Herdr's `spaces`.

| Item | Behaviour |
|---|---|
| Hidden | Local spaces whose ids are in `hws.workspace.spaces`. Remote spaces always show |
| Unset key | Hides nothing |
| Heading | `Other spaces` while a space is hidden, else `Spaces` |
| Every local space hidden | The heading and + remain |
| Drag, worktree order, rail numbers | Count hidden spaces too, matching `space.move` and `space.select:N` |
| Worktree whose checkout is hidden | Shows as a plain row |

## Sidebar footer

The `sidebar-footer` block runs `hws-footer`, 97px tall. It keeps `workspace-chrome`'s footer rows and adds Phone, because Herdr's Settings has no section a mod can add to.

| Row | Shows | Click |
|---|---|---|
| Settings | An accent dot when an app update is ready | `app.settings` |
| Add machine | Always | `mod.open` for `machine-add` |
| Phone | `Pair phone` when none is paired, else the paired names and a done dot | `hws phone pair`, which opens the Pair phone tab |

The row reads `hws phone status --json` when the footer loads. That restarts the listener for a paired phone each time Herdr starts. After a click it reads status every 3 seconds until a new phone appears or 10 minutes pass. The sidebar rail shows icons with tooltips.

## Chat and Terminal flip

The `hws` layout uses the `hws-pane` header. Claude Code and Codex panes get a Chat | Terminal switch.

| Step | Command |
|---|---|
| Flip the focused pane | `herdr-app do hws-pane.toggle` |
| To chat | `pane.split --mod hws-chat --props {"terminal":T}`, `pane.swap --pane <agent pane> --target <chat pane>`, `hc label T herdr.chat=<chat pane>`, `terminal.park --terminal T` |
| To terminal | `terminal.keep --terminal T --place right`, `hc label T herdr.chat=`, `pane.swap --pane <chat pane> --target <new pane>`, `pane.close --pane <chat pane>` |

- The core label `herdr.chat` names the chat pane that shows a parked agent.
- A parked agent has no pane, so `herdr-app ls` lists no terminal for it and `pane.focus --terminal T` fails.
- `hws-pane` ends a parked agent once its chat pane has gone.
- A flip keeps every pane's size. Herdr gives a closed pane's width to its left neighbor, so the new pane moves left of the old one first.

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
| Left sidebar | Navigate | Workspaces (`hws-panel`), Other spaces (`hws-spaces`), Agents (`hws-agents`, includes flipped agents) |
| Tab bar | Switch tabs, open Tasks, toggle the right panel | `hws-tabs`, with Workspace, Tasks, Files, Changes, Outputs |
| Pane header | Act on this agent | `hws-pane` `+`, always visible on agent and chat panes |
| Chat composer | Act on this agent while typing | The same menu, plus Attach file |
| Own window, or a pane beside the agent | Do the work | Boards in their own window, notes and pages in a pane |
| Board | Plan and dispatch work | Full-width kanban, `hws-work` with `{"view":"tasks"}`. One Board space per workspace. A plain space has none |
| Right panel | See what the work produced | Files, Changes, Outputs |
| Workspace panel | Read and keep the workspace's context | `hws-panel`, a pane beside the terminal. The top bar's Workspace button, the sidebar row's panel icon and `mod.open:hws-panel` toggle it. The sidebar row's right-click menu opens it |

### Workspace panel: `hws-panel`

Each section is a function in `mods/hws-panel/sections.js` that takes `{ t, host, workspace, target, now }`, so a pane, popup or window can host it. `target` is the agent last focused in the space, and actions that need one are off without it.

| Workspace | Sections, top to bottom |
|---|---|
| Reading a document | Back, its title, Show in Finder and the rendered text, in place of every other section. History rows, and Open note with no agent, open here |
| Kept | Header, Current note, Not in the note yet, History once a log exists, Notes once there are any, Artifacts, Open now once something is open, Where files go |
| Throwaway | Header, Record, Open now once something is open |
| Plain space | A sentence, Add this space to NAME for up to three candidates, then New workspace… |

Reads, on each `hws list` refresh:

- A kept workspace runs `hws tidy status --workspace W` and reads `line`, `live`, `places` and `writers` from it. It then reads the file at `places.current`.
- A kept workspace with a Board runs `hws todo list --space <Board space>` beside the status call. Nothing else waits for it, and a failure leaves out the counts.
- A plain space runs `hws space match --space S`. A failure counts as no candidates.
- When status fails, `hws place current --workspace W` supplies the note's path, and Not in the note yet shows the failure.
- A throwaway runs no `hws` call for its Record. Its scratch folder is its manifest `folder`, checked with `test -d`.
- The panel never calls `hws place` per role, because it creates the `scratch` and `artifacts` folders.
- A throwaway's header leaves out its folder, which is its scratch folder. Record shows that folder instead. The sidebar runs no `git` in a throwaway's folder.
- The Keep or Trash dialog lists `artifacts` from `hws close`, then a Scratch folder line when `scratch` is set.

| Control | Result |
|---|---|
| Stage pill | Opens a menu of discovery, deciding, building and settled, which runs `hws set --workspace W --stage S`. Reads Set stage with no stage. A throwaway's pill reads Throwaway and does nothing |
| `···` beside the name | Opens the workspace menu with Rename and Archive, or Rename and Close for a throwaway. Each asks first in a dialog |
| Instructions… | Beside the first line of the instructions, or No instructions yet. Opens the instructions dialog |
| Header path | The folder with `~`, truncated in the middle so its last folder stays visible. With a separate home, `Runs in F · files in H` |
| Freshness ring and sentence | Ring from `landed.total`: fresh at zero, behind up to five, stale above. Exploring alone never moves it. The sentence is `line`, or the same sentence built locally when `line` is null. With no `tidiedAt`, a dim unwritten ring |
| Open note | `hws surface open --type note --file <places.current> --terminal T`. With no T, reads the note in the panel |
| Tidy, or Tidy again with a live pass | The header's one filled button, beside the sentence. `hws tidy start --workspace W --pane <this panel's pane>` |
| Tasks line | Under the freshness line for a kept workspace with a Board. `N to do · N in progress · N waiting on you`, zeros left out, or Nothing open. Shows Tasks the way the `[card:ID]` chip does, without opening a card |
| Add tasks | With no Board, beside No task list yet. Runs `hws board add --workspace W`, then shows Tasks |
| Add this space to NAME | On a plain space. Runs `hws space move --space S --workspace W`, then reloads |
| History rows | Decision log and Updates read in the panel |
| Current note | The first 24 non-blank lines of the note, and a button that shows the rest in place. Each cite becomes a chip. The note's own `# Current` title is left out. With no note, says what the note is and where Tidy writes it |
| `[card:ID]` chip | Shows the Board, then opens `hws-work` with `{view:"todo",space,id}` as a dialog |
| `[session:ID]` chip | Focuses the terminal recorded with that session while it lives. Otherwise `tab.new` in this space running `claude --resume ID` |
| `[commit:SHA]` chip | Copies the sha with `pbcopy` |
| `[artifact:ID]` and `[file:PATH]` chips | A `.md`, `.markdown`, `.html` or `.htm` file opens in the companion with `hws surface open --type page`, beside T when there is one and `--standalone` otherwise, so it can take comments. A board opens its `comments.md`, or its sketch in the default app when it has none. Another Done bundle opens the first it has of `review.md`, `annotations.md`, `comments.md` and `prompt.md`. A file already open there gets the focus. Anything else goes to macOS `open`. A file path is relative to the workspace folder |
| Artifact title and Open | Run the `[artifact:ID]` action. A `file` artifact is the page itself, so its row opens the page |
| `N feedback` on an artifact row | Shown when rounds name the artifact in `reviewOf`. Unfolds them beneath the row, newest first |
| Feedback round row | Reads the round in the panel, from the first it has of `review.md`, `annotations.md`, `comments.md` and `prompt.md`. A round whose `reviewOf` is null or gone is a row of its own at the end of Artifacts, under its title |
| Artifact `···` menu | Open in browser for HTML, Open sketch for a board, otherwise Open in default app. Then Show in Finder and Copy for Claude, which copies the `@path` from `hws link ARTIFACT` |
| Show in Finder, in the reader and the `···` menu | `open -R` on the file, or `xdg-open` on its folder on Linux, where the label reads Show in folder. A bundle reveals its `prompt.md` |
| Not in the note yet | The four `behind` counts, then `items`, eight at first. A row runs its item's cite. A live pass row focuses its terminal |
| Artifact status chip | Shown for `draft` and `superseded`, and left off `current`. A missing status reads as `current`. Superseded ones fold under one row |
| Open now | Shown only with a row. Sketches, notes and pages from `surfaces`, each with its type and the agent it is attached to |
| Where files go | Folded at first and on every space change. Holds the Place fields and Suggest from folder |
| Place field | Holds the manifest's path, with the role's default as placeholder. Enter or Save runs `hws set --workspace W --place ROLE=PATH`. An emptied field shows Clear and runs `--place ROLE=`. The label's tooltip is the resolved path from `places` |
| Place another tool writes | Read only, with its path and `written by NAME`, when `writers` or the stored entry names a writer other than `hws` |
| Suggest from folder | `hc send T` with a prompt asking the agent to propose a place map and record it with `hws set --place` |
| Record session row | The `[session:ID]` action |
| Record scratch folder | macOS `open` on the folder, shown when it exists |
| Promote… | Opens the Promote dialog |

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
| Send to phone… | Always | macOS file chooser, then `hws phone send F --terminal T` |
| Attach file… | `chat` is true | `setShared("hws-chat.attach", { pane, at })` |
| Tasks | Always | Opens the Board tab |
| Outputs | Always | Selects `outputs` in `panel-body` and shows `panel` |
| Orchestrate this space | `space` and `cwd` are known | `hws orchestrator start --space S --folder F`, where F is this agent's folder |
| Resume or Show `<title>` | Per entry in `boards` | `hws surface resume --id S`. An untitled sketch reads `sketch` |
| Discard `<title>` | Per closed entry in `boards` | `hws surface discard --id S` |

Every `hws surface open` passes `--terminal T`. A flipped agent also passes `--beside-pane P --space S`, which the menu already knows.

### Flipped agents

A flipped agent has no pane, and `herdr-app ls` does not list chat panes. Mods find one this way:

1. Take each entry in `panes()` whose `mod` is `hws-chat`.
2. Find the live terminal in `terminals()` whose `herdr.chat` label equals that pane.
3. Its tab is the pane's `tab`. Its space is the entry in `spaces()` that holds that tab.

`hws surface open --terminal T --beside-pane P --space S` opens a board in its own window and splits a note or page beside P. It fails unless T's `herdr.chat` label equals P. On Done, `hws` reads T's `herdr.chat` label again. It focuses that pane when the label is set and the terminal otherwise.

An agent calling `hws` knows neither P nor S, so `--terminal T` alone works too. `hws` takes P from T's `herdr.chat` label. It takes S from T's `herdr.space` label, else from a `where` label that matches one space name, else from the space that holds the tab T was recorded in. With no space it fails and asks for both flags.

### Board

A Board is a tab whose pane runs `hws-work` with `{"view":"tasks"}`.

A workspace starts with no Board. The person or an agent adds one, at most one, with `hws board add`. It is a Board space, a member of the workspace named Tasks. A Board space made earlier keeps its name. Its Board tab is named `Workspace board`, and the tab bar hides it by id, using the ids the sidebar shares as `hws.board.tabs`. Agents run in other tabs of that space. A plain space has at most one Board tab, shown in the tab bar.

| Tasks button in the tab bar | Result |
|---|---|
| The active space holds a Board that is not showing | `tab.select` |
| The space is in a workspace that has a Board elsewhere | `hws board open`, then `space.select` and `tab.select` |
| The space is in a workspace with no Board | A notification says the workspace has no tasks and points to Add tasks. Nothing is created |
| The space is plain | A notification says Tasks needs a workspace. Nothing is created |
| The Board is showing | Returns to the space the button came from, else `tab.select` on the tab shown before it |

The pane header names it Tasks. An unnamed Board tab reads Tasks in the tab bar. Tasks shows only `hws` cards.

| Column | Cards |
|---|---|
| To do | `column` is `todo` |
| In progress | `column` is `doing` |
| Waiting on you | `column` is `waiting` |
| Done | `column` is `done` |

- The board always shows four columns side by side, sharing the width. They scroll sideways at 200px each when they do not fit.
- Tasks never runs `agent-brief`. The quiet line under the header shows only a failed action or load.
- `hws-work` keeps `shared("hws.tasks.waiting")` equal to the number of cards in Waiting on you, and `hws-tabs` shows it on the Tasks button.

| Card | Shows | Click | Drag |
|---|---|---|---|
| To-do | Title, up to three lines of summary, a `Run by` row when `terminal` is set, one owner tag, Worktree and From tags, and Allow on a Needs your OK card in To do. In To do the owner tag is `Mine`, `Needs your OK` or `Ready`, for owner mine, unassigned or agent, and other columns show only `Mine`. The summary is `note`, then `report` on a card in Waiting on you or Done, then the first line of notes. The `Run by` row names a live session and its status, with Open. An ended one reads `Session ended`, with Resume when `session` is saved. From appears when a different session added the card. It reads `From NAME` while that terminal is live and named, and `From an agent` otherwise. A card never shows a terminal address | Opens the to-do dialog | Release over To do, In progress or Done |

Drag uses press and release across elements, as Herdr's tab bar does. The column under the pointer highlights during a drag, and Waiting on you never accepts a drop.

Allow runs `hws todo edit --id I --owner=agent`, which lets an orchestrator take that card. The header's label reads Orchestrating, Run finished once every card is done, or Orchestrator needs you when the orchestrator reports blocked or has reported nothing 20 seconds after it started. A blocked worker adds to the header's status. Open focuses a session with a pane and runs `terminal.peek` on a worker without one.

Adding has three routes:

- An input at the top of To do. Enter adds a card, empties the input and keeps focus.
- `+ Add` in the header opens the to-do dialog.
- Add several in the header opens a dialog with a text area. Each non-blank line becomes a card.

The to-do dialog fills the Tasks pane up to 920 by 820 px, and is never smaller than 560 by 480. Its left column holds the update, title and notes, and the notes box takes the remaining height. Its right column holds the controls. The dialog has title, notes, a column choice, an owner choice of Mine, Needs your OK or Ready (`owner` mine, unassigned or agent), Use a worktree (`worktree`), Send to, Archive and Save. Its heading line shows the card id and when it was added and updated. The dialog opens with What happened on a Done card and Latest update on any other. A Done or Waiting on you card shows `report` and then `note`, and other cards show `note` and then `report`. The text renders as markdown and scrolls when long. A card with a linked session lists Run by and Added by under Session, each by name with its status and address in dim text, and Open saves the card's edits, closes the dialog and opens that session. Each Send to row has its own Send button, and pressing it moves the card to In progress. A card in Waiting on you has a Reply box, and a Done card with a session has a Feedback box. Both run `hws todo reply`, which sends to a live session or reopens a closed one with the text as its next message, in a new tab, without moving the window.

The header shows `Models  <orchestrator model> → <worker model>`, which opens the Models dialog. It opens at the height of its content. A line under the heading names the recommended setup. Each role is a section with labeled rows, Model and Effort for the Orchestrator and Tool, Model and Effort for Workers, and each row is one joined control. The footer shows Use recommended, or the note `Using the recommended setup` once the choices match. The default is Opus at high effort for the orchestrator and Sonnet at medium for workers. For Codex workers the recommended model is `gpt-6.1-sol`. The header always shows what is running, what waits on you and, when nothing is ready, `N need your OK`, or `1 needs your OK` for one. The Done column header shows **Archive done** while Done has a card. It asks in place, as Stop does, then runs `hws todo archive --done --space S --json` and reloads. Moving the pointer away cancels, and a failure goes on the quiet line. **Run N ready** appears when a To do card is assigned to an agent. It runs `hws orchestrator start --space S --folder F`, which starts an orchestrator or tells the live one to read the board. Orchestration also starts from the `+` menu or the launcher. **Allow all N** appears on To do when more than one card is unassigned, and assigns each to an agent. A card or Session row whose session has ended and whose `session` is saved shows Resume, which runs `hws todo resume --id I --space S`.

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

Only `hws` writes `<state root>/todos/<board>.json`. A workspace's board is its id, and every space in it reads and writes that board. A space outside a workspace has no Board. Cards saved for one stay in a file named by its id, or `<id>~space` when that id also names a workspace it founded and left, a name that stays once that workspace closes, and join W's Board on `hws space move`. Boards survive closing a workspace.

`--space` takes any space id and resolves to its board. `hws todo list` also prints `spaces`, the spaces that share the board. Outputs covers the agents in all of them, and Tasks names them on cards and in Send to.

```json
{ "version": 1, "space": "sp1", "items": [
  { "id": "t1a2b3", "title": "Fix login", "notes": "", "column": "todo", "terminal": null, "owner": "unassigned", "worktree": false, "note": "", "addedBy": null, "report": "", "reportFrom": null, "session": null, "archived": false, "createdAt": 1, "updatedAt": 1 }
], "orchestrator": { "terminal": "t9", "startedAt": 1 } }
```

| Command | Does |
|---|---|
| `hws todo list [--archived] [--space S]` | Prints unarchived items, newest `updatedAt` first, `orchestrator` as `{ terminal, live }` or null, and `workspace`, the workspace id. With no `$HC_TERMINAL_ID`, a plain space prints no items and a null `workspace`, and Tasks shows that it needs a workspace. `--archived` adds archived items, which the card dialog shows read-only |
| `hws todo add --title X [--notes N] [--owner mine\|unassigned\|agent] [--worktree] [--space S]` | Adds to `todo`. `owner` defaults to unassigned |
| `hws todo add --titles T [--space S]` | Adds one card for each non-blank line of T, and prints `{ items }` |
| `hws todo edit --id I [--title X] [--notes N] [--owner mine\|unassigned\|agent] [--worktree true\|false] [--space S]` | Changes the text or flags |
| `hws todo move --id I --column todo\|doing\|waiting\|done [--note X] [--report X] [--space S]` | Changes the column, and sets `note` and `report` when given. An agent cannot use `hws todo edit --owner agent` or send an unassigned card, because only the person assigns cards. A move to any column but To do from a Herdr terminal other than the orchestrator sets an empty `terminal` to that terminal. A move to To do clears `terminal` and `session`. A move to Waiting on you or Done without `--report` sets `reportFrom` to the calling terminal, and any other move clears it |
| `hws todo status [--space S]` | Prints `ready` with each card's `note`, then `inFlight` with `live`, `waiting`, `needsAllow`, `done` and `orchestrator` |
| `hws todo resume --id I [--space S]` | Opens the card's `session` in a new tab of the space with `claude --resume` or `codex resume`, and sets `terminal` to it. Fails when the card has no session or its terminal is still live |
| `hws todo start --ids I,J --folder D [--owns A,B] [--avoid C,D] [--packet-file F] [--space S]` | From the orchestrator's terminal, starts one worker on the cards, in order, with the Models setting. Names it `todo-I-<random>` with label `hws.todo=I,J`, claims the cards for it, and saves a Claude worker's session id, model and effort up front |
| `hws models` | Prints `orchestrator`, `worker`, each `{ tool, model, effort }`, `catalog`, and `recommended` with the default `orchestrator` and `worker` |
| `hws models set --role orchestrator\|worker [--tool claude\|codex] --model M --effort E` | Saves a role. The orchestrator must use Claude Code |
| `hws todo capture --terminal T --text X [--space S]` | Copies X to `report` on the cards whose `reportFrom` is T, then clears it. Only cards T ran take the report. If T is a worker with no card left in progress or waiting, closes T. The plugin's Stop hook runs this with the session's closing message, only when `<state root>/capture/<T>` exists. `hws todo move` and `hws todo start` write that marker, and capture removes it once T has nothing left to report |
| `hws todo note --id I --text X [--space S]` | Sets `note`, the latest word from the worker. A Herdr terminal on a card outside To do that sets it fills an empty `terminal` |
| `hws todo next --terminal T [--space S]` | Claims the oldest To do card owned by agent, and prints it or null |
| `hws todo claim --id I --terminal T [--space S]` | Moves a To do card to `doing` and sets `terminal`. Fails when the owner is not agent or the card is not in To do |
| `hws todo send --id I --terminal T [--space S]` | Pastes the title and notes into T with `hc send`, sets `terminal` and `owner` agent, moves to `doing` |
| `hws todo reply --id I --text X [--space S]` | Pastes X into the card's `terminal`, clears `note`, moves to `doing` |
| `hws todo archive --id I [--space S]` | Sets `archived`. Nothing is deleted |
| `hws todo archive --done [--space S]` | Archives every card in Done under one write and prints `{ archived: [ids] }`. A caller with `$HC_TERMINAL_ID` set leaves mine cards alone. `--id` with `--done` exits 2 |

Tasks exists only inside a workspace. Every `hws todo` and `hws orchestrator` command fails on a plain space, apart from the `hws todo list` case above. The session-start hook names the task list only inside a workspace.

`--space` defaults to the calling agent's own space, from `$HC_TERMINAL_ID`. A terminal Herdr cannot place is an error, so a card never lands on another space's board. With no `$HC_TERMINAL_ID`, it defaults to the window's selected space. Mods always pass it.

`session` is `{ tool, id, folder }`, where `tool` is `claude` or `codex`. A report or claim from an agent's own shell fills it from `CLAUDE_CODE_SESSION_ID` or `CODEX_THREAD_ID`. `hws todo send` finds it from what the session gave `hws register`, or from Codex's thread database when exactly one Codex thread started in that folder since the terminal opened. `replies` lists each `{ question, answer, at }` from `hws todo reply`, and the dialog shows them after the update. `hws todo claim` and `next` clear `note`. `hws orchestrator start`, and `hws board add` from an agent, return the window to where it was. `report` holds what happened, up to 8000 characters. `hws todo list` leaves out `report` and `reportFrom` for a caller with `$HC_TERMINAL_ID` set unless it passes `--reports`.

A card added with `$HC_TERMINAL_ID` set is an agent's. It records `addedBy` as that terminal and starts unassigned, or mine when it passes `--owner mine`, so an orchestrator takes it only after you press Allow. `--owner agent` from an agent fails.

A card has one `owner`. `mine` is yours to track, and agents only read it. A call with `$HC_TERMINAL_ID` set that would change a mine card fails. `unassigned` is the default for every new card. `agent` cards are the only ones `next` and `claim` take. The to-do dialog sets `shared("hws.todos.changed")` after a change, and the board reloads on it.

Items written before these fields existed read `worktree` as false, `note` and `report` as empty, `replies` as empty, and `addedBy`, `reportFrom` and `session` as null. An item from before `owner` converts on read. A held item with `addedBy` becomes unassigned, a held item without it becomes mine, and any other becomes agent.

Every agent in a workspace can use the list. The session-start hook tells each Claude session in a workspace that it exists, and the `herdr-workspace` skill explains it.

### Orchestrator

Orchestration is a way of operating on the list, and is off until you start it. An orchestrator is an ordinary Claude session in a visible tab. It reads the board, decides what can run in parallel and starts workers. Nothing runs in the background.

| Command | Does |
|---|---|
| `hws orchestrator start --space S --folder F` | With none live, runs the orchestrator with the Models setting. opens an Orchestrator tab running `claude` with a first prompt that loads the `orchestrate` skill, and records its terminal. With one live, pastes a note into it to read the task list again. The first prompt ends with `Your task list is in space S.` |
| `hws orchestrator stop [--space S]` | Ends the orchestrator and its workers. A card still in `doing` whose worker has ended returns to To do, unassigned, with the note `Stopped before finishing` |
| `hws orchestrator status [--space S]` | Prints `{ terminal, live }` or null |

- The skill is `plugin/skills/orchestrate/SKILL.md`.
- The orchestrator chooses parallel or sequential from the files each card touches and the open decisions cards share.
- The orchestrator writes one run packet of workspace instructions, shared facts, file paths, output format and boundaries, and every worker in the run gets it.
- It uses a worktree only when a card has `worktree` set or the person asks. Otherwise every worker runs in the same folder and owns a separate set of files.
- Workers are `hc run --bg` children labelled `hws.todo=<id>`, so they show under the orchestrator in Agents and report to it when they end.
- Only a card owned by agent is taken.

A surface runs on this computer. The `+` menu is hidden for a remote agent, and `hws surface open` refuses a terminal whose address has a machine prefix.

## Claude Code plugin

`plugin/` holds the hooks and skills. Claude Code finds each skill at `plugin/skills/<name>/SKILL.md`, so no manifest lists them. Bump `version` in `plugin/.claude-plugin/plugin.json` when a hook or skill changes, so installs pick it up.

| Skill | Loaded | Does |
|---|---|---|
| `herdr-workspace` | When the person mentions a workspace, the task list, where files land, a surface, looking over a page, or reviewing on their phone or iPad | Explains the manifest, places, the task list, `hws review` and surfaces. Allows one dated line with a cite under Decisions in force in the current note |
| `orchestrate` | By the first prompt of `hws orchestrator start` | Runs the board |
| `tidy` | By the first prompt of `hws tidy start` | Reads the packet, writes `proposal.json` and `proposal.md` beside it, opens `proposal.md` with `hws surface open --type page --file F --terminal T` and ends the turn. On Done it runs `hws tidy apply --file proposal.json`, with `--skip` for parts the person turned down |

### Session start

`plugin/hooks/session-start.sh` runs on `SessionStart` when `HC_TERMINAL_ID` is set. It exits 0 on every path and prints nothing when a step fails.

In a kept workspace the hook also tells the session to use the `herdr-workspaces:tidy` skill for any update to the current note, lists up to 12 live artifacts and counts the existing work `hws artifact scan` finds untracked.

`plugin/hooks/guard-note.sh` runs on `PreToolUse` for `Write`. It denies a write to the current note when `hws` owns that place and tells the agent to run a tidy pass. `Edit` stays allowed so an agent can add one dated decision line. It exits 0 on every path, so a failed lookup allows the write.

1. Runs `hws register --terminal T --session S --json` and `hws current --line` in parallel.
2. When the line is non-empty, runs `hws tidy status --json`. It reads `places` and `line` from it, and never calls `hws place`, because that creates folders and a session start must not write to the person's folder.
3. Prints `additionalContext` with the line, the places sentence built from `places`, and `line`, joined by spaces. Each sentence is left out when empty. In a Herdr app terminal the task list paragraph follows after a blank line, then a paragraph that teaches `hws review FILE` and rules out `--standalone`. Every Herdr app terminal, in a workspace or not, then gets a paragraph that teaches `hws phone send FILE --prompt X` and says Agent Brief's Outputs panel does not reach the phone.

| Places sentence | |
|---|---|
| Form | `Artifacts land in docs/, drafts in .herdr-workspace/x-1234/scratch/, the current note is docs/NEXT-STEPS.md.` |
| Paths | Relative to the hook's `cwd` when inside it, absolute otherwise. Folders end in `/` |
| Unset role | Its clause is left out. No clauses leaves out the sentence |

Outside a workspace, when `hws current --line` prints nothing, the hook runs `hws space match --json` in the second round. With a candidate it prints one sentence saying this folder belongs to the workspace NAME, this space is not part of it, and the person can add it from the Workspace panel. It names up to three candidates and tells the agent to mention it once and not act on it. No candidate or a failure prints nothing.

Each `hws` call gets 2 seconds and stdin gets 1. The two rounds give a worst case of 5 seconds, under the 6 second `timeout` in `hooks.json`.
