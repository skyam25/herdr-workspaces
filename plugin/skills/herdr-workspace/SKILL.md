---
name: herdr-workspace
description: This skill should be used when the user mentions a workspace, a Herdr workspace or "this workspace", mentions the task list, to-dos, Tasks or the Board, asks what is in the workspace, what artifacts it has or where files should land, asks to sketch, draw, write or review something in a pane or window, asks to open a note or file in the Herdr editor rather than VS Code, asks to look over, comment on or give feedback on a page or document, asks to reopen a sketch, note or page from earlier, or names another terminal by its address, such as t7. Explains how to read the workspace, use the space's task list, hand a page to the user for review, reopen earlier work, reach another terminal, declare outputs, ask the user questions and ask for input through a surface.
---

# Herdr workspace

A workspace is one or more separate Herdr spaces with one manifest. The manifest is the source of truth for its spaces, tabs, terminals, surfaces and artifacts. Only `hws` writes the manifest, so never edit `workspace.json` by hand.

Run `~/.local/bin/hws` if `hws` is not on PATH.

## Read the workspace

| Command | Shows |
|---|---|
| `hws current --line` | One sentence, or nothing outside a workspace |
| `hws current --json` | The full manifest |
| `hws artifact list` | Artifacts, each with a `prompt` path to its `prompt.md` |
| `hws artifact scan` | This workspace's artifacts, and existing files and links it does not track yet |
| `hws link ARTIFACT` | An `@path` reference to the artifact's prompt |

Read the manifest before inferring anything from the folder or git state. If `$HC_TERMINAL_ID` is empty or `hws current --line` prints nothing, this session is in a normal terminal with no workspace.

## Places

`hws` names where things land by role. The folders belong to the person, so never guess them from a folder convention.

| Role | Holds |
|---|---|
| `current` | The current note, with Goal, Now, Decisions in force, Open questions and Next |
| `notes` | Notes written in a note surface |
| `artifacts` | Sketches, reviews and registered files |
| `scratch` | Working files and unsent drafts |
| `decisions` | The decision log. Only `hws decision` writes it |
| `history` | Earlier notes, the update log and demoted docs |
| `meetings` | Transcribed meeting notes, when set |

To update the current note, or to catch up on where the work stands, load the `herdr-workspaces:tidy` skill. It starts a pass in this session with `hws tidy start --here`. Never rewrite the note yourself.

Put every document, note and artifact you write for this workspace in one of these places, and register a finished file with `hws artifact add --file F --title X`. Register work that lives elsewhere without moving it, with `hws artifact add --file F --in-place --title X` for a file or `hws artifact add --url URL --title X` for a claude.ai artifact or other web document. A temp folder is only for throwaway work. `hws` resolves these under the workspace's own folder, which can sit below the folder you run in.

To change that folder, run `hws set --home PATH`. PATH must already exist. `hws set --home ""` puts the files back in the folder you run in. The change moves no files and only sets where new work lands, so tell the person if existing work should move too.

Session start names the current, notes, artifacts and scratch paths. Run `hws place ROLE` before you write into a place. It prints the absolute path, creates the `artifacts` or `scratch` folder on first use, and prints nothing when the role is unset.

When the person lands a decision mid-session, such as "we're going with X", offer to log it. Exploring is not deciding, so never log an option they are still weighing, and log nothing without their yes. On yes, run `hws decision add --title X --why Y [--decided-at YYYY-MM-DD] [--cites card:ID,commit:SHA] [--replaces D-001]`, and find what it replaces with `hws decision list`. Then you may add one dated line with a cite under Decisions in force in the current note, such as `- 2026-11-08 Notes open in their own window [commit:ba7d965]`, and remove any line the decision replaced. A cite is `[card:ID]`, `[session:ID]`, `[commit:SHA]`, `[artifact:ID]` or `[file:PATH]`. Cites belong only in the current note and the decision log, so never put them in documents, pages or other artifacts you write. Change nothing else in the note, because the tidy pass rewrites the whole note when the person runs it. A throwaway has no current note, so `hws place current` prints nothing there.

## Kinds

| Kind | Meaning |
|---|---|
| `general` | Kept workspace with no stated type. This is the default |
| `app` | Kept workspace for building software in its folder |
| `deliverable` | Kept workspace for producing a document or other finished output |
| `throwaway` | Short-lived workspace with no project folder. `hws promote` turns it into a kept one |

## Task list

All the spaces in a workspace share one task list. The person sees it in Tasks. Check `hws current --line` before you use it or mention it.

- It prints nothing outside a workspace. Tell the person Tasks needs a workspace, and run none of these commands.
- It says the workspace has no Tasks when no one has added them. Tell the person, and never send them to Tasks or promise a card there.

These commands find the list from this terminal's space. They fail and ask for `--space` when Herdr cannot place the terminal.

| Command | Does |
|---|---|
| `hws todo list --json` | Prints the cards and any orchestrator |
| `hws todo status --json` | Prints what is ready, in flight and waiting, without the text of finished cards |
| `hws todo add --title="..."` | Adds a card for follow-up work the person should see |

A workspace starts with no Tasks space, and `hws todo add` from an agent fails until it has one. Run `hws board add` only when the person asks for Tasks. It adds one Tasks space to this workspace, and running it again finds the same one.

Every card has an owner.

| Owner | Agents may |
|---|---|
| `unassigned` | Read it, and shape it when the person asks. Every card you add lands here until the person presses Allow |
| `agent` | Run it, when a person or orchestrator gives it to them |
| `mine` | Only read it. It is the person's, and `hws` refuses changes from an agent |

Do not take or move cards unless the person asks.

### Add and run cards

| Step | The person does | An agent does, when asked |
|---|---|---|
| Add | Types in the To do box, or + Add | `hws todo add --title="..."` |
| Make it ready | Presses Allow, or Allow all on the To do column | Nothing. Only the person assigns a card |
| Start | Presses Run N ready in the Tasks header | `hws orchestrator start --space S --folder F` when told to |
| Add more during a run | Adds and allows cards, then presses Run again | The orchestrator starts only what is new |

Run starts one orchestrator for the task list, or tells the live one to read it again. Cards in flight, waiting or done are not restarted.

### Finish a card

The person reviews results in Tasks, so a finished card must say what happened.

1. Move the card with a `--note` of up to two sentences that says what changed, where, and how you checked it.
2. End the turn with your usual closing summary. A hook copies that message to every card you moved to Done or Waiting on you in that turn, so do not write it out twice.
3. If you finish several cards in one turn, pass `--report="<this card's part>"` on each move, so each card keeps its own story.

`hws todo list --json` leaves reports out to save tokens. Add `--reports` when you need them.

### Write a card

A title alone is enough to capture something. Shape a card before the person assigns it. A card is ready when a fresh session could finish it without this chat, and it says how to check the result.

| Kind | The card carries | It ends with |
|---|---|---|
| Known change | Files and a check | The change, verified |
| Discovery | The problem, evidence and questions | Options, then new cards after the person picks |
| Build from a decision | A link to the decision, or the decision itself | The change, verified |
| Bug | Steps to reproduce and evidence | A fix and a check |

Sort the context by where it lives.

- Put in the card what exists only in this chat, such as reasoning, decisions and constraints.
- Point to what has a stable home, such as artifacts, docs and screenshots.
- Leave out what a worker can find in the repo.

## Review a page or open a note

| The person wants | Run |
|---|---|
| To comment on a page or document you wrote | `hws review FILE` |
| To read or edit a Markdown file themselves | `hws surface open --type note --file F --terminal $HC_TERMINAL_ID` |
| Text to paste somewhere else, such as a message, an email or a post | Write it to a Markdown file, then open it as a note with the same command |

Use `hws review` when you want comments back on your own work. Use a note when the file is the person's to read or change. Never open either kind of file with macOS `open`, VS Code or another editor.

Paste-ready text goes in a note instead of the chat. In a workspace, put the file in `hws place scratch`. The note's Copy button copies it as rich text. When the person asks for changes, edit the same file, because the open note reloads it. Keep one file per message, so they never have two copies.

## Hand a page to the user for review

Use this when the user wants to look over a page or document you wrote, and again after you change one they commented on.

```bash
hws review FILE
```

FILE is an `.html` or `.md` file, or the id of an artifact that tracks one. The page opens in a pane beside this terminal, or beside the chat when the user has flipped this agent to Chat. Run `hws review FILE --window` instead when the user asks for the page in its own window. A kept workspace tracks the file as an artifact where it sits, so do not register it again.

The round trip has four steps.

1. Run `hws review FILE` and end the turn. Do not poll.
2. The user pins comments and presses Done. The comments arrive as your next prompt, and the page closes.
3. Make the changes in the same file.
4. Run `hws review FILE` again, as the prompt's last line asks. The page opens with the new version and none of the comments you already received.

Each round of comments stays under the artifact in the Workspace panel.

Review the local file, never its published copy. A claude.ai artifact opens in the browser and takes no comments, so register its link with `hws artifact add --url` and review the file it was published from.

Never pass `--standalone` when you have a terminal. That page has no agent attached, so the user's comments reach nobody. If `hws review` fails, show the user the error and stop.

## Ask the user through a surface

A surface is a sketch, note or page tied to this terminal. A sketch or note opens in its own window. A page opens in a pane beside this terminal, or beside the chat for an agent flipped to Chat. Open one only when the user asks for it. Never open a surface unasked. The one exception is the last line of a review's comments, which asks you to run `hws review` again.

```bash
hws surface open --type board|note --title X --terminal $HC_TERMINAL_ID
```

Pass `--file F` to open an existing file in a note. Use `hws review` for a page.

After opening a surface, end the turn and wait. The user presses Done and the feedback arrives as the next prompt. Do not poll for it. A user who closes a sketch or note window early keeps it as a draft and resumes it from the pane header.

The user can move a surface between a pane and a window with Pop out and Pop in. When they ask you to move one, find its id under `surfaces` in `hws current --json` and run `hws surface pop --id S`. Add `--to pane` or `--to window` to choose the place. Without it the surface moves to the other place.

## Reopen earlier work

| Work | Run |
|---|---|
| An `.md` or `.html` file, or the artifact that tracks one | `hws review ARTIFACT` |
| A finished sketch, which is a `board` artifact | `hws surface open --type board --artifact A --terminal $HC_TERMINAL_ID` |
| An `.excalidraw` file | `hws surface open --type board --file F --terminal $HC_TERMINAL_ID` |
| A sketch or note draft listed under `surfaces` in `hws current --json` | `hws surface resume --id S` |

`hws surface resume` brings an open window forward, or starts a closed one again on the same data. Never reopen work with macOS `open`.

A reopened sketch loads its drawing and pinned comments, and the bundle it came from stays as it was. Done delivers the new sketch to you and files it as an artifact that replaces the old one.

## Drive a surface

```bash
hws surface cli -- VERB [ARGS]
```

This runs the surface command line against this terminal's newest open surface. Before `--`, add `--type board` for a sketch or `--type page` for a review page or outline, `--title X` to pick one of several, and `--terminal T` to drive another terminal's surface. Load the skill for the verb you need.

| Verbs | Skill |
|---|---|
| `read`, `png`, `draw`, `update`, `delete`, `snap` | `herdr-workspaces:sketch-board` |
| `outline` | `herdr-workspaces:outline-first` |
| `behavior` | `herdr-workspaces:behavior-review` |
| `feedback` | `herdr-workspaces:feedback-items` |

For a UI mockup that needs no surface, load `herdr-workspaces:wireframe`. It renders an SVG with `${CLAUDE_PLUGIN_ROOT}/bin/wireframe-render.mjs`.

## Keep work

Work from a surface lasts only while something holds it. A Done bundle is a round-trip by default. It sits under the state root and goes to the Trash some days after its terminal ends, 7 by default, set by `recentDays` in hws settings. A surface the person never finished goes the same way.

| When the person asks to | Run |
|---|---|
| Keep a delivered sketch, note or review | `hws artifact keep A`. It moves the bundle into the workspace folder for good |
| Keep a surface that is still open or drafted | `hws surface save --id S` |
| Keep unfiled work | Add `--workspace W` to either command, because kept work lives in a workspace |

Keep only what the person asks to keep. Round-trips are messages, so `hws artifact scan` and freshness leave them out.

## Reach another terminal

Every Herdr terminal has a herdr-core address, such as `t94`, or `macminim1/t14` on another machine. This session's address is `$HC_TERMINAL_ID`. Each pane header shows its terminal's address, and a click copies it, so the person quotes it from one conversation to another.

| To | Run |
|---|---|
| See every live terminal, with its folder and agent | `hc ls` |
| Read a terminal's screen and history | `hc read T --lines 100` |
| Send a terminal a message | `hc send T "text"` |
| Open a surface for another terminal | `hws surface open ... --terminal T` |
| Drive another terminal's surface | `hws surface cli --terminal T -- VERB` |

Use the address the person gives. Never pick a terminal by its tab, because one tab can hold several terminals. The `where` field in `hc ls` names a tab, so it can match several terminals too. `hc --skill` prints the full hc manual. The older `herdr` command, `HERDR_ENV` and pane ids belong to the Herdr TUI and do not work in the Herdr app.

## Declare outputs

When the person asks for a doc, brief, report, spec, page or deck, list it under Outputs in Herdr's right panel.

```bash
hws output add --title "Pricing memo" --path docs/pricing.md --status drafting
```

- Run it with `--status drafting` when you start the work.
- Run it again with `--status ready` when the work is done.
- Use `--url U` in place of `--path` for a web document, such as a claude.ai artifact.
- Declare only the deliverable the person asked for, usually one per request.
- Never declare code, config, tests or other files that serve the code.

Outputs already lists every Markdown, HTML, PDF and Office file you write under Touched, so never declare a file just to list it.

## Ask the user questions

Ask only when the request is underspecified and the answers change what you build.

```bash
hws ask --title "Pricing memo" --file .feedback/scratch/questions.json
```

The file holds a list of questions. `hws ask` also reads the list on stdin.

```json
[
  {"id": "audience", "text": "Who reads the memo first?", "kind": "options", "options": ["Leadership", "Sales", "Support"]},
  {"id": "deadline", "text": "When does it need to be ready?", "kind": "text"}
]
```

| Kind | Use for |
|---|---|
| `options` | 2 to 4 short choices |
| `select` | Up to 6 choices |
| `text` | An open answer |

Explain each option in your reply before you ask, so the person can choose without asking what an option means. End the turn after `hws ask`, because the answers arrive as your next prompt.
