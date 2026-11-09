---
name: herdr-workspace
description: This skill should be used when the user mentions a workspace, a Herdr workspace or "this workspace", mentions the task list, to-dos or the Board, asks what is in the workspace, what artifacts it has or where files should land, or asks to sketch, draw, write or review something in a pane. Explains how to read the workspace, use the space's task list and ask the user for input through a surface.
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
| `artifacts` | Boards, reviews and registered files |
| `scratch` | Working files and unsent drafts |
| `decisions` | The decision log. Only `hws decision` writes it |
| `history` | Earlier notes, the update log and demoted docs |
| `meetings` | Transcribed meeting notes, when set |

To update the current note, or to catch up on where the work stands, load the `herdr-workspaces:tidy` skill. It starts a pass in this session with `hws tidy start --here`. Never rewrite the note yourself.

Put every document, note and artifact you write for this workspace in one of these places, and register a finished file with `hws artifact add --file F --title X`. Register work that lives elsewhere without moving it, with `hws artifact add --file F --in-place --title X` for a file or `hws artifact add --url URL --title X` for a claude.ai artifact or other web document. A temp folder is only for throwaway work. `hws` resolves these under the workspace's own folder, which can sit below the folder you run in.

To change that folder, run `hws set --home PATH`. PATH must already exist. `hws set --home ""` puts the files back in the folder you run in. The change moves no files and only sets where new work lands, so tell the person if existing work should move too.

Session start names the current, notes, artifacts and scratch paths. Run `hws place ROLE` before you write into a place. It prints the absolute path, creates the `artifacts` or `scratch` folder on first use, and prints nothing when the role is unset.

When the person lands a decision mid-session, such as "we're going with X", offer to log it. Exploring is not deciding, so never log an option they are still weighing, and log nothing without their yes. On yes, run `hws decision add --title X --why Y [--decided-at YYYY-MM-DD] [--cites card:ID,commit:SHA] [--replaces D-001]`, and find what it replaces with `hws decision list`. Then you may add one dated line with a cite under Decisions in force in the current note, such as `- 2026-11-08 Notes stay in a pane [commit:ba7d965]`, and remove any line the decision replaced. A cite is `[card:ID]`, `[session:ID]`, `[commit:SHA]`, `[artifact:ID]` or `[file:PATH]`. Change nothing else in the note, because the tidy pass rewrites the whole note when the person runs it. A throwaway has no current note, so `hws place current` prints nothing there.

## Kinds

| Kind | Meaning |
|---|---|
| `general` | Kept workspace with no stated type. This is the default |
| `app` | Kept workspace for building software in its folder |
| `deliverable` | Kept workspace for producing a document or other finished output |
| `throwaway` | Short-lived workspace with no project folder. `hws promote` turns it into a kept one |

## Task list

All the spaces in a workspace share one task list. The person sees it on the Board. The task list and the Board exist only inside a workspace, so when `hws current --line` prints nothing, tell the person the Board needs a workspace and run none of these commands. These commands find the list from this terminal's space. They fail and ask for `--space` when Herdr cannot place the terminal.

| Command | Does |
|---|---|
| `hws todo list --json` | Prints the cards and any orchestrator |
| `hws todo status --json` | Prints what is ready, in flight and waiting, without the text of finished cards |
| `hws todo add --title="..."` | Adds a card for follow-up work the person should see |

A workspace starts with no Board, and cards still save without one. Run `hws board add` when the person asks for a Board or the work needs a place for agents to run from. It adds one Board space to this workspace, and running it again finds the same one.

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
| Start | Presses Run N ready in the Board header | `hws orchestrator start --space S --folder F` when told to |
| Add more during a run | Adds and allows cards, then presses Run again | The orchestrator starts only what is new |

Run starts one orchestrator for the board, or tells the live one to read it again. Cards in flight, waiting or done are not restarted.

### Finish a card

The person reviews results on the Board, so a finished card must say what happened.

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

## Ask the user through a surface

A surface is a board, note or page tied to this terminal. A board opens in its own window, and a note or page opens in a pane beside this terminal. Open one only when the user asks for it. Never open a surface unasked.

```bash
hws surface open --type board|note|page --title X --terminal $HC_TERMINAL_ID
```

Pass `--file F` to open an existing file in a note or page.

After opening a surface, end the turn and wait. The user presses Done and the feedback arrives as the next prompt. Do not poll for it. A user who closes a board early keeps it as a draft and resumes it from the pane header.

## Send to the phone

Use this only when the user asks to review something on their phone or iPad.

```sh
hws phone send FILE_OR_ARTIFACT_ID --prompt "What to look at"
```

The phone opens `.html` and `.excalidraw` files. Render a Markdown note to HTML first. End the turn after sending, because the user's markup arrives as the next prompt. If no phone is paired, run `hws phone pair`, which opens a tab with a QR code for the user to scan.

## Draw on a surface

```bash
COMPANION_SOCKET=$(hws surface socket --terminal $HC_TERMINAL_ID) agent-brief draw ...
```

Add `--title X` to `hws surface socket` when this terminal has more than one surface open. Use the `agent-brief:sketch-board` skill for the drawing format and the other `agent-brief` commands, and keep the same `COMPANION_SOCKET` prefix on each of them.
