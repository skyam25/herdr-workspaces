# Context lifecycle

Design for keeping a workspace's working context messy while it is used and clean when it is read back. Written 2026-11-08 from a design conversation. `docs/CONTRACT.md` stays the specification; each card below updates it when it lands an interface.

## Problem

- A workspace produces transcripts, cards, drafts, sketches and docs while work happens. Nothing marks what is still true.
- PMWorkspace solved this with eight folders per Space and write rules per file class. Its own validation run (`review-samples-space-current-truth-maintenance-20260616-220137`) found agents did not apply the rules reliably on small updates.
- Agent memory systems split a small curated layer that is read by default from a large stream that is searched on demand, and consolidate between them in a separate pass.

## Model

| Layer | Holds | Written | Read |
|---|---|---|---|
| Current | What is true now, decisions in force, what is next | Rewritten by an accepted tidy pass, small inline additions by agents | At session start and by the person |
| Stream | Transcripts, cards and reports, artifacts, commits, scratch files | Every turn, append only | On demand, through cites and `hws find` |

- Working context is never cleaned while work happens.
- The tidy pass is triggered by the person, done by an agent, applied by `hws`.
- Everything hangs off the workspace manifest. The Board is one stream source when it exists.
- A throwaway has no current note. Its retired record is its index.

## Places

`hws` speaks in roles. Folder names belong to the user.

| Role | Lands there | Default for a kept workspace |
|---|---|---|
| `current` | The current note | `CURRENT.md` |
| `artifacts` | Done bundles and registered files | `.herdr-workspace/<name>-<id tail>/artifacts/` |
| `scratch` | Drafts and working files | `.herdr-workspace/<name>-<id tail>/scratch/` |
| `decisions` | Append-only decision log | Unset, decisions stay inline in `current` |
| `history` | Demoted docs | Unset, demotions go to the Trash |
| `meetings` | Transcribed meeting notes | Unset |

- Paths are relative to the workspace folder, or absolute.
- Changing a place never moves files. It changes where new things land.
- `settings.json` may hold `places`, the default map for new kept workspaces.
- An agent proposes a map from an existing folder at setup. The person confirms. `hws set --place` records it.
- A place may name another writer, `{ "path": "decisions", "writer": "pmos" }`. `hws` reads there and never writes.

## Manifest additions

All fields are optional, so version stays 1.

```json
{
  "stage": "discovery",
  "places": { "current": "docs/NEXT-STEPS.md", "artifacts": "docs", "scratch": ".herdr-workspace/x-1234/scratch" },
  "current": {
    "tidiedAt": 1794000000000,
    "covers": { "sessionsThrough": 1794000000000, "artifactsThrough": 1794000000000, "commit": "2a12556" }
  },
  "tidy": { "terminal": "t12", "startedAt": 1794000000000, "packet": "<state>/workspaces/<id>/tidy/packet.json" }
}
```

| Field | Meaning |
|---|---|
| `stage` | `discovery`, `deciding`, `building` or `settled`. Set by hand with `hws set --stage`. Tells agents how to treat options and contradictions |
| `places` | Role to path map. Missing roles take the defaults above |
| `current.tidiedAt` | When the last pass was applied. Absent until the first |
| `current.covers` | The newest stream item each source had absorbed at that pass |
| `tidy` | The live pass, absent when none runs |

Artifacts gain `status`, one of `draft`, `current` or `superseded`, and `supersedes`, an artifact id or null. Done writes `current`.

## Commands

| Command | Does |
|---|---|
| `hws set [--workspace W] --place ROLE=PATH [--place ...] [--stage S]` | Records places and stage. Fails on an unknown role or a stage outside the four |
| `hws place ROLE [--workspace W]` | Prints the absolute path for a role, or nothing when the role is unset. Creates `scratch` and `artifacts` folders on first use, never the others. For display, read `places` from `hws tidy status` instead, which creates nothing |
| `hws tidy status [--workspace W] [--line]` | Prints `{ tidiedAt, stage, behind: { sessions, artifacts, commits, cards }, items: [...], live, git, places, writers, line }`. `places` is the resolved role map, `writers` the role to writer map, and `line` the sentence. Resolves paths and creates nothing. `--line` prints only the sentence, or nothing outside a workspace |
| `hws tidy start [--workspace W]` | Writes the packet, opens a tab running `claude` whose first prompt loads the `herdr-workspaces:tidy` skill, and records `tidy`. With a live pass, pastes a note to read the packet again |
| `hws tidy apply --file PROPOSAL [--skip current,demote,artifacts,cards] [--workspace W]` | Applies a proposal, stamps `current`, clears `tidy`, prints what changed. Refuses when the current note's hash differs from the packet's |
| `hws tidy stop [--workspace W]` | Ends the pass, clears `tidy` |
| `hws artifact set ID --status S [--supersedes ID]` | Changes an artifact's status |
| `hws artifact add --file F [--title X] [--workspace W]` | Registers a file as an artifact with status `current`. Moves it under the `artifacts` place unless it is already there |

Rules that carry over. Only `hws` writes the manifest. Demotions go to the macOS Trash or the `history` place, never deleted. Nothing runs in the background, so freshness is computed on read.

## Freshness

Counted from the stream against `current.covers`, never from the clock alone.

| Source | Behind when |
|---|---|
| Sessions | A tracked transcript's modified time is after `sessionsThrough` |
| Artifacts | `createdAt` is after `artifactsThrough` |
| Commits | `git rev-list covers.commit..HEAD` is non-empty, when the folder is a repo |
| Cards | A Done card is not archived, when the workspace has a Board |

- No `current` yet means every item is behind, and the line reads "No current note yet".
- Dot thresholds are fresh at zero, behind up to five items, stale above five. Later a setting.
- The sentence reads "Current is 3 sessions and 2 artifacts behind, last tidied Nov 3".

## Packet

Written by `hws tidy start` to `<state>/workspaces/<id>/tidy/packet.json`.

```json
{
  "version": 1,
  "workspace": "sp...",
  "folder": "/abs/folder",
  "stage": "deciding",
  "places": { "current": "/abs/docs/NEXT-STEPS.md", "artifacts": "/abs/docs", "scratch": "/abs/.herdr-workspace/x/scratch", "history": null },
  "instructions": "workspace instructions",
  "current": { "path": "/abs/docs/NEXT-STEPS.md", "exists": true, "hash": "sha256", "tidiedAt": null, "covers": null },
  "since": {
    "sessions": [{ "id": "...", "transcript": "/abs/path.jsonl", "modifiedAt": 0, "title": "first prompt or null" }],
    "artifacts": [{ "id": "a1", "title": "...", "path": "/abs", "status": "current", "createdAt": 0 }],
    "commits": [{ "sha": "...", "subject": "...", "at": 0 }],
    "cards": [{ "id": "...", "title": "...", "notes": "...", "note": "...", "report": "...", "replies": [] }]
  },
  "cutoff": { "sessionsThrough": 0, "artifactsThrough": 0, "commit": "sha" }
}
```

`cutoff` is what `covers` becomes on apply, taken when the packet is written, so work that lands during the pass stays in the next backlog.

## Proposal

Written by the tidy agent beside the packet as `proposal.json` and `proposal.md`.

```json
{
  "version": 1,
  "workspace": "sp...",
  "packet": "/abs/packet.json",
  "summary": "One paragraph for the person",
  "current": "Full text of the new current note",
  "demote": [{ "path": "/abs/docs/panel-options.md", "to": "history", "reason": "Decided Nov 8, see D line" }],
  "artifacts": [{ "id": "a1", "status": "superseded", "supersedes": null }],
  "cards": ["card ids to archive"]
}
```

- `to` is `history` or `trash`. `history` falls back to `trash` when the place is unset, and the proposal says so.
- `proposal.md` renders the summary, the note as a diff, and each demotion with its reason. The agent opens it in a page surface and ends the turn. Done delivers the person's feedback to the agent as its next prompt, and the agent runs `hws tidy apply`, with `--skip` for the parts the person turned down, or revises and reopens. No surface runs apply by itself.
- Per-block Accept and Skip inside the surface is later work. `--skip` covers it until then.

## Current note

Three fixed headings, short lines, a cite at the end of each line.

```markdown
# Current

## Now
- Boards open in their own window and notes stay in a pane [commit:ba7d965]

## Decisions in force
- 2026-11-06 The task list is separate from orchestration [commit:2a12556]
- 2026-11-04 Studio is removed, board and note cover it [card:17]

## Next
- Pick a panel treatment [file:docs/panel-options.md]
```

Cite tokens are `[card:ID]`, `[session:ID]`, `[commit:SHA]`, `[artifact:ID]` and `[file:PATH]`. The panel turns each into an action. Agents may add a dated line inline when they land a decision mid-session. The pass rewrites the whole note.

## Throwaway scratch

- A throwaway's shells start in `<state>/workspaces/<spaceId>/scratch/` instead of the parent folder.
- The retired record keeps the path. Purge trashes the folder with the artifacts.
- Promote moves the folder's contents into the kept workspace's `scratch` place.
- A throwaway with an artifact and no transcript still has a record, because the scratch folder may hold work.

## Agent Brief pane

Sections top to bottom. Header with name, folder, stage pill, freshness dot and sentence, Open current and Tidy. Current, the first screen of the note with cite chips. Since last tidy, counts and rows from `hws tidy status`. Outputs with status chips and superseded ones folded. Places as editable rows with Suggest from folder. Then the existing Tabs and agents, Open surfaces, Instructions and Close. A throwaway shows Record and Promote instead of Current and Places. The sidebar row carries the freshness dot. Open current runs `hws surface open --type note --file <current>`.

## Session start

Three sentences. The workspace and its instructions, as today. The places, "Artifacts land in docs/, drafts in .herdr-workspace/x/scratch, the current note is docs/NEXT-STEPS.md". The freshness line from `hws tidy status --line`.

## Work breakdown

| # | Card | Owns | Needs |
|---|---|---|---|
| 1 | Places and stage in the manifest | `core/places.js`, `core/manifest.js`, `core/settings.js`, `core/commands/lifecycle.js`, `core/commands/surface.js`, `core/cli.js`, `core/test/places.test.js` | Nothing |
| 2 | Throwaway scratch folder | `core/commands/new.js`, `core/commands/retired.js`, `core/commands/lifecycle.js` promote path, `core/test/retired.test.js` | Nothing, but runs after 1 because both touch lifecycle.js |
| 3 | `hws tidy status` and `start` with the packet | `core/commands/tidy.js`, `core/cli.js`, `core/test/tidy.test.js` | 1 |
| 4 | `hws tidy apply`, `stop`, artifact statuses | `core/commands/tidy.js`, `core/commands/artifact.js`, `core/test/tidy.test.js` | 3 |
| 5 | Plugin tidy skill and session start | `plugin/skills/tidy/`, `plugin/hooks/session-start.mjs`, `plugin/skills/herdr-workspace/SKILL.md`, `plugin/tests/` | The command shapes here, so it can run beside 3 and 4 |
| 6 | Pane sections and sidebar dot | `mods/hws-panel/`, `mods/hws-work/open.js`, `mods/test/` | The `hws tidy status` shape here, with fakes |
| 7 | Later. Proposal surface with per-block accept, throwaway artifact landing and back link, `hws find` across kept workspaces, a `decisions` log writer | | 4 |

Every card updates `docs/CONTRACT.md` for what it lands and keeps `hws.js` identical across the mods that carry it.
