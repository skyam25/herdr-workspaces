---
name: tidy
description: This skill should be used when a prompt names the herdr-workspaces:tidy skill, asks to tidy a workspace's current note, or, in a Herdr workspace, asks to update the current note or the current state, refresh it, or catch up on where the work stands. Explains how to read the tidy packet, ask what is unclear, rewrite the current note, log decisions, propose demotions and open the proposal for the person to review.
---

# Tidy the current note

A workspace keeps three layers. The current note says what is true now. The decision log records what was decided and what replaced it. The stream holds everything else, such as transcripts, artifacts, commits and cards. A tidy pass reads what the stream gained since the last pass and proposes a new note and any new decisions. You propose, the person reviews, and `hws` applies. You never edit the note or the log or move files yourself.

A pass runs in one of two places. The Tidy button opens a terminal beside the workspace and names the packet in its first prompt. An agent the person is already talking to runs the pass in that same session. Either way, ask here when something is unclear.

Run `~/.local/bin/hws` if `hws` is not on PATH.

## Steps

1. Read the packet, starting one if the prompt names none.
2. Offer to adopt existing work the packet lists under `candidates`.
3. Read the current note, every stream item and every live artifact that bears on the note.
4. Check for conflicts against the live artifacts and decisions.
5. Ask the person what the evidence does not settle.
6. Write `proposal.json` and `proposal.md` in the packet's folder.
7. Open `proposal.md` in a page surface and end the turn.
8. On Done, apply the proposal.

## Read the packet

The first prompt names the packet when the Tidy button started the pass. Otherwise run `hws tidy start --here`, which writes a fresh packet and prints its path, and carry on in this session. It sits at `<state>/workspaces/<id>/tidy/packet.json`.

| Field | Use |
|---|---|
| `folder` | Where agents run. `[file:PATH]` cites are relative to it |
| `home` | Where the workspace's files live, the same as `folder` unless it has its own |
| `stage` | How to treat options and contradictions, below |
| `places` | Absolute path per role. `null` means the role is unset |
| `writers` | The tool that owns a place, or `null` when `hws` writes it |
| `instructions` | The workspace instructions. Follow them |
| `current` | The note's `path`, whether it `exists`, its `hash`, and the last pass's `tidiedAt` and `covers` |
| `live.artifacts` | Every artifact not yet superseded, including old ones the stream no longer lists |
| `live.decisions` | The decision log's `path` and the entries still `inForce` |
| `live.cards` | Cards not yet done. Next draws on these |
| `since` | Stream items newer than the last pass, by source. An artifact with `editedAt` changed after the last pass. Every card in `since.cards` is Done |
| `candidates` | Existing files and web documents the workspace does not track yet, below |
| `cutoff` | What the pass covers. `hws` stamps it on apply, so leave it alone |

| Stage | Do |
|---|---|
| `discovery` | Keep competing options under Open questions. Log only what the person clearly decided |
| `deciding` | Name each contradiction under Open questions, with cites to both sides |
| `building` | Record decisions, and flag only what contradicts one in force |
| `settled` | Keep the note short, and flag anything that reopens a decision |
| missing | Treat it as `discovery` |

## Adopt existing work

A workspace only tracks what was recorded after it was created, so work that came first shows up under `candidates`. A candidate is a suggestion from a folder scan, so never register one without the person's yes.

When `candidates` is not empty, ask with the AskUserQuestion tool which ones belong to this workspace, naming each by title and path. Register each yes, then run `hws tidy start --here` again so the packet lists them.

| Candidate | Register with |
|---|---|
| `kind` `file` | `hws artifact add --file PATH --in-place --title X`, which leaves the file where it is |
| `kind` `link` | `hws artifact add --url URL --title X` |

If you cannot ask, register nothing and read the candidates whose titles bear on the note anyway. Name them in the summary so the person can adopt them later.

## Read the stream

| Source | Read |
|---|---|
| `since.sessions` | The JSONL at `transcript`. Read the user and assistant text, and skip tool calls and results. For a long file, start from the end, where decisions land, then read back far enough to learn what they replaced |
| `since.artifacts` | The file at `path`. A bundle folder holds `prompt.md`, and `comments.md` when someone commented. An item with `type` `note` is a written note, so weigh it like one of the person's own documents |
| `since.commits` | `subject` first. Run `git -C <folder> show --stat <sha>` when the subject is not enough |
| `since.cards` | `notes`, `note`, `report` and `replies` are inline. A Done card's `report` says what happened |

Read the whole current note when `current.exists` is true. Read only what you need to decide what is true now. You are not writing a log.

Each artifact needs the reader that fits it.

| Artifact | Read it with |
|---|---|
| `type` `link`, a claude.ai artifact | The Artifact tool with `action` `read`. List its published files with `scope` `files` and read any bundled page by `path` |
| Another `type` `link` | The connector or web tool that reaches it |
| `.pptx`, `.docx`, `.xlsx` or `.pdf` | The matching document skill, or a text extraction when no skill is listed |
| A file with a `<file>.feedback.md` beside it | Read that log too, because it holds the review decisions |

A link has no modified time, so read every live link on each pass. Read a source before you say the note matches it, because one more read beats writing that it was not checked. When a source truly cannot be read, name it under Open questions and do not claim the work is unchanged.

## Decide what counts

Exploring is not deciding. Most of a discovery session should change nothing in the log.

| Evidence | Goes in |
|---|---|
| The person accepts a direction, such as "we're going with X" or "we landed on X" | Decisions in force and the log |
| A Done card whose report states a choice | Decisions in force and the log |
| A commit that ships something | Now. Add a decision only when it closes off an alternative that was discussed |
| A question, a "what if", a "maybe" or an option being compared | Open questions |
| A draft artifact | Open questions, never Now |
| A `current` artifact that recommends something against a decision in force | Ask, below |
| Something an assistant suggested and the person did not accept, or set aside with "park that" | Nothing |

Recency settles a conflict only when the newer item clearly reverses the older one. A draft or an exploring session never overrides a decision in force.

For each new fact, ask whether it would leave two live answers to the same question. Compare it with the current note, `live.decisions.inForce` and the titles in `live.artifacts`, and read any live artifact a new decision could contradict.

| Result | Do |
|---|---|
| The new item clearly replaces the old one | Rewrite the note to the new answer. Add a decision with `replaces`. Mark a contradicted artifact `superseded` |
| You cannot tell which holds | Ask, below |

These checks come before the stage rules. Ask about any conflict with a decision in force. Options that touch no decision in force go straight under Open questions, in `discovery` without asking.

Mark an artifact `superseded` when someone acting on it would now do the wrong thing, even if part of it still holds. The log and the note carry the parts that hold.

When a decision replaces another, also rewrite every note line that depended on the old one.

## Ask what is unclear

Before you write the proposal, ask the person with the AskUserQuestion tool when an answer would change the note or the log. Ask about these and nothing else.

- Two sources give different answers and the evidence does not settle which holds.
- You cannot tell whether something is decided or still being explored.
- You cannot tell whether a new artifact replaces an older one.

Ask at most four questions, in one round. Each question stands alone, names the things it asks about and says where each side came from. Offer the concrete answers as options, and explain what each one does to the note. Never ask about wording or format.

Skip this step when the evidence settles everything. When the person says something is still open, it goes under Open questions, citing both sides. When an answer settles a conflict, cite the stream items it settled.

## Write the note

The note has five fixed headings, in this order.

```markdown
# Current

## Goal
- Customers get a receipt they can keep [file:README.md]

## Now
- Boards open in their own window and notes stay in a pane [commit:ba7d965]

## Decisions in force
- 2026-11-06 The task list is separate from orchestration [commit:2a12556]

## Open questions
- Should partial refunds list only the returned items? [artifact:a1]

## Next
- Pick a panel treatment [file:docs/panel-options.md]
```

- Rewrite the whole note. Never append to the old one.
- Keep each line short, one fact per line, with at least one cite at the end.
- Keep the note to about one screen, 40 lines at most. Detail belongs in artifacts and the log.
- Say only what is true now. Never write "previously", "no longer" or "we used to". The log and history hold the past.
- Start each decision line with the date it was made, `YYYY-MM-DD`.
- Keep the dated lines agents added during sessions when they still hold. Drop a decision once a later one replaces it.
- Point a kept line at another source when this pass supersedes the artifact it cites. There is no cite for a decision id, so cite the decision's own source.
- Build Next from `live.cards` and what the stream says comes next.
- Move finished items out of Next. Drop Now lines that stopped being true. Drop an open question once it is answered.
- Add nothing the stream does not support.
- Write for a later reader and never as "I". State what is unknown as a fact about the work.
- Say how strong the evidence is. A rough estimate or a placeholder is never a verified fact, and a page cannot verify itself.

| Cite | Points at |
|---|---|
| `[card:ID]` | A card on the task list |
| `[session:ID]` | A session id from `since.sessions`, or one the note already cites |
| `[commit:SHA]` | A short commit sha |
| `[artifact:ID]` | An artifact id |
| `[file:PATH]` | A file, relative to `folder` |

## Log decisions

Add one `decisions` entry for each decision the stream gained. Leave out anything already in `live.decisions.inForce`. Log a decision only when it closes off an alternative or sets a direction others must follow. Corrections and copy edits are not decisions.

| Field | Holds |
|---|---|
| `title` | The decision in one line |
| `why` | The reason, in one to three sentences |
| `decidedAt` | The day it was made, `YYYY-MM-DD`, from the source's own timestamp and never today by default. For a card, use a date its report states, else `updatedAt` |
| `cites` | Cites without brackets, such as `card:t1a2b3` |
| `replaces` | Ids from `live.decisions.inForce` that this overturns. Omit when none |

When `writers.decisions` names another tool, leave `decisions` empty and keep the lines in the note.

## Demote, mark and archive

Demote a file when the new note absorbs it or a decision replaces it, and nobody needs to read it by default. Set `to` to `history`, which is the default place for anything outdated. Use `trash` only for a file with no record value, such as a stray copy.

Never demote the current note, source code, files outside `folder` and `home`, any folder a place names, or a file already under the history place. Change an artifact's `status` instead of demoting its file.

| Proposal field | Holds |
|---|---|
| `demote` | Files to move, each with `to` and a `reason` that cites the line that replaced it |
| `artifacts` | Status changes. Mark `superseded` what a newer artifact or a new decision replaces, and set `supersedes` on a newer artifact |
| `cards` | Done cards the note now covers, to archive |

## Write the proposal

Write both files in the packet's folder.

`proposal.json`:

```json
{
  "version": 1,
  "workspace": "<packet.workspace>",
  "packet": "/abs/packet.json",
  "summary": "What changed since the last pass, in one paragraph for the person",
  "current": "Full text of the new current note",
  "decisions": [{ "title": "Email receipts use HTML", "why": "PDFs fail on older phones", "decidedAt": "2026-11-06", "cites": ["card:t1a2b3"], "replaces": ["D-001"] }],
  "demote": [{ "path": "/abs/docs/panel-options.md", "to": "history", "reason": "Decided Nov 8, see D line" }],
  "artifacts": [{ "id": "a1", "status": "superseded", "supersedes": null }],
  "cards": ["card ids to archive"]
}
```

Use empty arrays when nothing changes. The summary stays in the workspace's update log, so say what changed and name any pivot. `proposal.md` holds these sections.

1. The summary.
2. The note as a diff in a `diff` block, from `diff -u old new`. Show the full note when none exists yet.
3. Each new decision with its reason and anything it replaces.
4. Each demotion with its path, destination and reason.
5. Artifact status changes and cards to archive.

## Review and apply

Open the proposal and end the turn.

```bash
hws surface open --type page --file <packet folder>/proposal.md --title "Current note proposal, press Done to apply" --terminal $HC_TERMINAL_ID
```

Tell the person that the note stays as it is until they press Done. Do not poll. The person reads the page and presses Done, and their feedback arrives as your next prompt.

| Feedback | Do |
|---|---|
| `I reviewed proposal.md in Agent Brief and changed nothing`, or accepts in words | `hws tidy apply --file <packet folder>/proposal.json` |
| Turns down whole parts | Add `--skip` with any of `current`, `decisions`, `demote`, `artifacts`, `cards` |
| `My edited copy of proposal.md`, comments, or asks for changes | Carry the changes into both files and open the page again. `hws tidy apply` reads only `proposal.json` |
| Cancels | `hws tidy stop`, or just end the turn when you started with `--here` |

`hws tidy apply` saves the previous note to history and adds an entry to the update log. It refuses when the current note changed after the packet was written, when its place moved, when a listed card has left Done, or when `replaces` names a decision that is gone or already replaced. It checks everything before it writes, so a refused apply changes nothing. Fix the proposal or tell the person, because a new `hws tidy start` writes a fresh packet. When apply succeeds, report what it printed and end the turn.
