---
name: outline-first
description: This skill should be used when the user asks to outline first, or to plan a memo, PRD, doc or page before drafting it, or sends any prompt containing "(outline-first)", such as Check the cites, Generate, an Ask from the outline, comments on a target that has an outline, or "Direction accepted". Shapes the work as an outline of points, cites, sources and open questions in a <name>.outline.md that Herdr opens in its outline view with `hws review`, generates the target from it, and folds comments back in as a proposed direction.
---

# Outline first

The user and Claude shape an outline in Herdr's outline view. Generate writes the target, a document or page, from the outline. Comments on the target come back into the same outline as a proposed direction, and the user accepts it before the target changes.

Run `~/.local/bin/hws` if `hws` is not on PATH.

## Commands

Change an outline only through these commands. Never edit a `.outline.md` file directly, because the commands check its version and the outline view reloads live.

| Command | Does |
|---|---|
| `hws outline new "<title>" [--target <path>] [--path <x.outline.md>]` | Makes the file and prints its path first |
| `hws review <x.outline.md>` | Opens the outline in the outline view beside this terminal |
| `hws surface cli -- outline list` | Outlines in the project, with counts |
| `hws surface cli -- outline show <path> [--json]` | The outline and its ids |
| `hws surface cli -- outline apply <path> --ops .feedback/outline-ops.json` | Applies ops. Prints the ids it added |

The `hws surface cli` commands run against this terminal's open surface, so open the outline with `hws review` first. If one fails, say the outline was not changed. Run each command on its own, with no shell loops, variables or `&&` chains, so the user can allow it once.

Write the ops with your Write tool to `.feedback/outline-ops.json`, then run `apply`. Ops target ids such as `s1`, `p3` and `S2`, so run `show` first when you need existing ones. Give an add op a `label`, and later ops in the same batch can name its new id as `@<label>`. Labels share one namespace across sources, sections and points, so use distinct ones such as `src-pilot` and `sec-pilot`. A cite must name a source that exists, so add sources first. `show` prints points in order with their ids, so read it rather than piping `--json` through a script.

```json
[
  {"op": "addSource", "title": "CS ops dashboard export, Oct 2026", "ref": "data/cs-ops.csv", "label": "ops"},
  {"op": "addSection", "title": "Why change onboarding now", "label": "why"},
  {"op": "addPoint", "section": "@why", "text": "New accounts wait a median 6 business days for kickoff.",
   "cites": [{"source": "@ops", "location": "wait times"}], "guide": "State it as today's baseline"},
  {"op": "addPoint", "section": "@why", "kind": "open", "text": "Can support absorb async Q&A without a hire?",
   "default": "Assume no new hire and flag it as a risk"}
]
```

Later batches use the ids that `apply` printed or `show` lists.

```json
[
  {"op": "editPoint", "id": "p1", "cites": [{"source": "S1", "location": "wait times", "mark": "partly", "note": "Q3 accounts only"}]},
  {"op": "setDirection", "direction": {"state": "proposed", "scope": "sections", "from": "3 comments on docs/memo.md",
   "bullets": ["The memo asks leadership to choose among three options"], "changes": ["removed · section Recommendation"]}}
]
```

The other ops are `setMeta` (title, target, kind), `setIntent` (`lines` of `{key, text}`), `editSection`, `moveSection`, `removeSection`, `movePoint`, `removePoint`, `editSource` (`checked` among its fields), `removeSource` and `clearDirection`. An `editPoint` field replaces the old one whole, and `null` clears it, so `cites` lists every cite on the point.

## Start

When the user asks to outline first:

1. Run `hws outline new "<title>"`, with `--target` when the path is known. It prints the outline's path.
2. Run `hws review <path>` so the outline opens beside this terminal.
3. Seed it in one apply. Add the intent (Reader, Goal, Message, Guide), sections with substantive points, and the sources you know. For a page, set `kind` to `page` with `setMeta` in the same batch.
   - Include external sources beside project files. A Slack thread, Google Doc, ticket or web page you read or the user named goes in with its URL as `ref`.
   - Give every source a `ref` when one exists, because the user opens sources from the outline by their ref.
4. Keep it to about one page. Add at most three open points, each with a `default`.
5. Do not write the target yet. Tell the user the outline is open beside this terminal, and end the turn.

## Generate

1. Check the cites. Open and read each source, through a connector or web fetch when its ref is a URL. Mark each cite `supports`, `partly`, `not` or `unknown` (could not open it), with a note when the mark needs one. Record what the source establishes in `supports` and `notShown`, and set `checked` to today with `editSource`. Skip a source already checked today.
2. Write the target fresh from the outline and its sources. Without a target, pick a path beside the outline and set it with `setMeta`.
3. Honor every Guide, Keep and Default. Add no claim the outline lacks. Flag a gap instead of filling it. Soften or drop a point whose cite came back `not`, and tell the user which.
4. Check the result. Each point and each Keep is present. No outline language leaks into the prose, such as "the outline", "per the plan" or "judging by".
5. If the prose says a point differently from the outline, for example to soften a cite marked `partly`, edit that point in the same turn. The outline stays the record the next round builds on.
6. Run `hws output add --title "<title>" --path <target> --status ready`.

An Ask from the outline says "Update the outline only". Change the outline, leave the target alone, and name the outline's path in your reply. A request to check the cites alone runs step 1 and stops.

## Feedback on a target with an outline

Leave the target alone.

1. Read the comments together.
2. Replace superseded content in the outline rather than adding beside it.
3. Run `setDirection` with state `proposed`, a scope (`edit`, `sections` or `regenerate`), `from`, 3 to 6 bullets, and one `changes` line per outline change.
4. Reply in two or three lines and name the outline's path. Run `hws review <outline>` so the user sees your changes marked and can accept the direction, then end the turn.

When "Direction accepted" arrives, revise the target at that scope, check it as Generate does, then run `clearDirection`.

A review can also list edits the user made in the review page's Edit mode. They are already saved in the target, so keep them. Write each one's wording back into its point with `editPoint`, and the next Generate keeps it. In your reply, flag any edit that changes a claim, number or cite.

## Pages

- Sections are screens or regions.
- Points are content and behavior.
- Sources may be sketches or screenshots. Read an open sketch with `hws surface cli --title "<sketch title>" -- read`.
- Write every visible word as static markup. Text a script shows, such as modal captions, goes in hidden elements the script reads, so the review page's Edit mode can retype it.
