# Herdr Workspaces guide

What Herdr Workspaces adds to Herdr, how agents learn to use it, and how to move off Agent Brief. `docs/CONTRACT.md` holds the exact rules for every command and field.

## What it is

- Typed workspaces for the Herdr desktop app. A workspace groups one or more Herdr spaces, a folder, a task list and the work that comes out of it.
- Surfaces glued to the terminal that opened them. A sketch, note, review page or round of questions opens beside an agent, and Done hands the result back to that agent as its next prompt.
- One place for an agent's output. Notes, sketches, reviews and registered files land in named places and show in the Workspace panel.
- A current note per workspace, kept fresh by a tidy pass the person starts.

## Pieces

| Piece | Lives in | Does |
|---|---|---|
| `hws` | `bin/hws`, `core/` | The only writer of workspace manifests. Every mod, surface and hook calls it |
| Mods | `mods/`, installed into Herdr | Workspaces sidebar, Workspace panel, Tasks, Outputs, pane header, New menu |
| Surface app | `surface/app` | Draws sketches, notes, review pages, outlines and questions, in a pane through Pixel or in its own window |
| Claude plugin | `plugin/` | Session-start text, write hooks, skills and `/workspace` |

## What the person sees

| Where | Shows |
|---|---|
| Sidebar, Workspaces | Each workspace, its spaces and open windows, plus Unfiled work |
| Workspace panel | Current note, what the note doesn't cover yet, artifacts, agents, open surfaces, where files go |
| Right panel, Outputs | Each agent's declared deliverables, then touched documents, with Review, Open as note and Copy path |
| Right panel, Tasks | The workspace's cards, owners and orchestrator |
| Pane header | The terminal's address, such as `t94`, which a click copies. Chat or Terminal for an agent, and Resume or Show for its windows |
| Surfaces | Sketch, note, review page, outline, questions. Done delivers, Pop out and Pop in move them, and Save keeps one from expiring |

## What an agent gets

### Where its instructions come from

| Source | When | Says |
|---|---|---|
| Session-start hook | Every Claude session in a Herdr terminal | The workspace, where files land, how fresh the note is, its own terminal address and how to reach another, the task list when the workspace has Tasks, and how to review, write notes, declare outputs and ask questions |
| `herdr-workspace` skill | The person mentions a workspace, tasks, a surface or review | Full command reference |
| Feature skills | On matching requests | `sketch-board`, `wireframe`, `outline-first`, `behavior-review`, `feedback-items`, `tidy`, `orchestrate` |
| Delivered prompts | Each Done | What the person did and the `hws` command to run next |
| `hws surface cli` help | When the agent asks | Verb usage, written as `hws surface cli` lines |
| Project `CLAUDE.md` | Every session in that project | The project's own rules |

### Commands agents use

| Need | Command |
|---|---|
| Show a page or document for comments | `hws review FILE` |
| Let the person read or edit Markdown | `hws surface open --type note --file F --terminal $HC_TERMINAL_ID` |
| Paste-ready text, such as a message or email | Write a Markdown file, then open it as a note |
| Ask a round of questions | `hws ask --file Q.json` |
| Declare a deliverable | `hws output add --title T --path P --status drafting\|ready` |
| Draw on or read a sketch | `hws surface cli --type board -- draw\|read\|png\|snap ...` |
| Outline before writing | `hws outline new`, `hws review X.outline.md`, `hws surface cli --type page -- outline ...` |
| Feedback items and behavior rules | `hws surface cli --type page -- feedback\|behavior ...` |
| Reopen earlier work | `hws review ARTIFACT`, `hws surface open --type board --artifact A`, `hws surface resume --id S` |
| Update the current note | Load `herdr-workspaces:tidy`. Never rewrite the note directly |
| Keep delivered work, or save a surface | `hws artifact keep A`, `hws surface save --id S` |
| Reach a terminal the person names, such as `t7` | `hc read T`, `hc send T "text"`, `--terminal T`. `hc ls` lists them |

After opening any surface, the agent ends its turn. The person's answer arrives as the next prompt.

## Moving off Agent Brief

### Run the helper

```sh
hws migrate agent-brief            # report only
hws migrate agent-brief --import   # keep old boards and drafts as Unfiled work
hws migrate agent-brief --apply    # uninstall and move the rest to the Trash
```

- The report lists the plugin, CLI link, app, data, caches and inbox, checks that Herdr Workspaces is installed, and lists stale instructions with their replacements.
- `--apply` refuses while the app runs. Everything it removes goes to the Trash.
- `hws doctor` warns while any part of Agent Brief is still installed.

### What replaces what

| Agent Brief | Herdr Workspaces |
|---|---|
| `declare_output` | `hws output add` |
| Touched files in the Brief pane | The output-touch hook and Outputs' Touched group |
| `ask_questions` | `hws ask` |
| `agent-brief draw`, `read`, `png`, `snap` | `hws surface cli --type board -- VERB` |
| `agent-brief outline`, `feedback`, `behavior` | `hws surface cli --type page -- VERB` |
| `agent-brief note`, `open --note` | A Markdown file opened as a note |
| `agent-brief open --output`, Review | `hws review FILE` |
| Initiatives | The workspace's current note and the tidy pass |
| Brief pane | Outputs and Tasks |
| `.feedback/` files in projects | Unchanged. Herdr reads the same formats |

### Dropped

- Talk dictation into the prompt
- Pictures in the chat (`show_image`)
- `/mode` and `/grill`
- `/apply-feedback` from the browser extension
- The floating board outside Herdr
- The iPad hand-off

### Check project instructions

- Search `CLAUDE.md`, `AGENTS.md` and `.claude/` in each project for `agent-brief`, `Agent Brief`, `declare_output`, `ask_questions` and `show_image`. The helper's report lists them.
- Replace each with the command from the table above, or delete it. The session-start hook already teaches the Herdr commands, so a project rarely needs to repeat them.
- Keep project rules about the project. Leave review, notes, outputs and questions to the hook and skills, so one update reaches every project.

## Known gaps

- Codex agents get no session-start text or skills, because both come from the Claude plugin. A Codex agent learns `hws` only from card prompts and delivered prompts.
- Surfaces need a Herdr terminal. A Claude session in another terminal gets none of this.
- Nothing above has been tried with a real pointer yet. `docs/NEXT-STEPS.md` lists the hand checks.
