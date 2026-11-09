---
name: tidy
description: This skill should be used when a prompt names the herdr-workspaces:tidy skill or asks to tidy a workspace's current note. Explains how to read the tidy packet, rewrite the current note, propose demotions and open the proposal for the person to review.
---

# Tidy the current note

A workspace keeps two layers. The current note says what is true now, which decisions are in force and what comes next. The stream holds everything else, such as transcripts, artifacts, commits and cards. A tidy pass reads what the stream gained since the last pass and proposes a new current note. You propose, the person reviews, and `hws` applies. You never edit the note or move files yourself.

Run `~/.local/bin/hws` if `hws` is not on PATH.

## Steps

1. Read the packet.
2. Read the current note and every stream item the packet lists.
3. Write `proposal.json` and `proposal.md` in the packet's folder.
4. Open `proposal.md` in a page surface and end the turn.
5. On Done, apply the proposal.

## Read the packet

The first prompt names the packet. Otherwise read `tidy.packet` from `hws current --json`. It sits at `<state>/workspaces/<id>/tidy/packet.json`.

| Field | Use |
|---|---|
| `folder` | The workspace folder. `[file:PATH]` cites are relative to it |
| `stage` | How to treat options and contradictions, below |
| `places` | Absolute path per role. `null` means the role is unset |
| `instructions` | The workspace instructions. Follow them |
| `current` | The note's `path`, whether it `exists`, its `hash`, and the last pass's `tidiedAt` and `covers` |
| `since` | Stream items newer than the last pass, by source |
| `cutoff` | What the pass covers. `hws` stamps it on apply, so leave it alone |

| Stage | Do |
|---|---|
| `discovery` | Keep competing options under Next. Decide nothing the person has not decided |
| `deciding` | Name each contradiction under Next, with cites to both sides |
| `building` | Record decisions, and flag only what contradicts one in force |
| `settled` | Keep the note short, and flag anything that reopens a decision |
| missing | Treat it as `deciding` |

## Read the stream

| Source | Read |
|---|---|
| `since.sessions` | The JSONL at `transcript`. Read the user and assistant text, and skip tool calls and results. For a long file, start from the end, where decisions land |
| `since.artifacts` | The file at `path`. A bundle folder holds `prompt.md` |
| `since.commits` | `subject` first. Run `git -C <folder> show --stat <sha>` when the subject is not enough |
| `since.cards` | `notes`, `note`, `report` and `replies` are inline. A Done card's `report` says what happened |

Read the whole current note when `current.exists` is true. Read only what you need to decide what is true now. You are not writing a log.

## Write the note

The note has three fixed headings, in this order.

```markdown
# Current

## Now
- Boards open in their own window and notes stay in a pane [commit:ba7d965]

## Decisions in force
- 2026-11-06 The task list is separate from orchestration [commit:2a12556]

## Next
- Pick a panel treatment [file:docs/panel-options.md]
```

- Rewrite the whole note. Never append to the old one.
- Keep each line short, one fact per line, with at least one cite at the end.
- Start each decision line with its date, `YYYY-MM-DD`.
- Keep the dated lines agents added during sessions when they still hold. Drop a decision once a later one replaces it, because the stream still has it.
- Move finished items out of Next. Drop Now lines that stopped being true.
- Add nothing the stream does not support.

| Cite | Points at |
|---|---|
| `[card:ID]` | A card on the task list |
| `[session:ID]` | A session id from `since.sessions` |
| `[commit:SHA]` | A short commit sha |
| `[artifact:ID]` | An artifact id |
| `[file:PATH]` | A file, relative to `folder` |

## Demote, mark and archive

Demote a file when the new note absorbs it or a decision replaces it, and nobody needs to read it by default. Set `to` to `history` for a record worth keeping, and to `trash` for the rest. When `places.history` is `null`, `hws` sends a `history` demotion to the Trash, so say so in the proposal.

Never demote the current note, source code, files outside `folder`, any folder a place names, or a file already under the history place. Change an artifact's `status` instead of demoting its file.

| Proposal field | Holds |
|---|---|
| `demote` | Files to move, each with `to` and a `reason` that cites the line that replaced it |
| `artifacts` | Status changes. Mark `superseded` what a newer artifact replaces, and set `supersedes` on the newer one |
| `cards` | Done cards the note now covers, to archive |

## Write the proposal

Write both files in the packet's folder.

`proposal.json`:

```json
{
  "version": 1,
  "workspace": "<packet.workspace>",
  "packet": "/abs/packet.json",
  "summary": "One paragraph for the person",
  "current": "Full text of the new current note",
  "demote": [{ "path": "/abs/docs/panel-options.md", "to": "history", "reason": "Decided Nov 8, see D line" }],
  "artifacts": [{ "id": "a1", "status": "superseded", "supersedes": null }],
  "cards": ["card ids to archive"]
}
```

Use empty arrays when nothing changes. `proposal.md` holds these sections.

1. The summary.
2. The note as a diff in a `diff` block, from `diff -u old new`. Show the full note when none exists yet.
3. Each demotion with its path, destination and reason, and the Trash fallback when `history` is unset.
4. Artifact status changes and cards to archive.

## Review and apply

Open the proposal and end the turn.

```bash
hws surface open --type page --file <packet folder>/proposal.md --terminal $HC_TERMINAL_ID
```

Do not poll. The person reads the page and presses Done, and their feedback arrives as your next prompt.

| Feedback | Do |
|---|---|
| `I reviewed proposal.md in Agent Brief and changed nothing`, or accepts in words | `hws tidy apply --file <packet folder>/proposal.json` |
| Turns down whole parts | Add `--skip` with any of `current`, `demote`, `artifacts`, `cards` |
| `My edited copy of proposal.md`, comments, or asks for changes | Carry the changes into both files and open the page again. `hws tidy apply` reads only `proposal.json` |
| Cancels | `hws tidy stop` |

`hws tidy apply` refuses when the current note changed after the packet was written, when its place moved, or when a listed card has left Done. It checks everything before it writes, so a refused apply changes nothing. Fix the proposal or tell the person, because a new `hws tidy start` writes a fresh packet. When apply succeeds, report what it printed and end the turn.
