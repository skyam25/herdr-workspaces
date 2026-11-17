---
name: feedback-items
description: This skill should be used when the user hands over feedback, interview transcripts or review notes about an output such as a prototype or PRD, asks to log, catalog or triage feedback, or sends feedback decisions from the Feedback tab of a Herdr review page. Catalogs each round of SME, customer or stakeholder feedback as tracked items in <output>.feedback.md beside the output, with `hws surface cli -- feedback`, and acts on the user's decisions.
---

# Feedback items

Each output can carry a feedback file beside it, so `prototype/checkout.html` gets `prototype/checkout.html.feedback.md`. Every point from every round becomes an item there. The user decides on each item in the Feedback tab of the output's review page, and the items outlast sessions.

Run `~/.local/bin/hws` if `hws` is not on PATH.

Write the file only through `hws surface cli -- feedback`. The surface checks versions, adds dates and keeps the file add-only. These commands run against this terminal's open surface, so open the output with `hws review <output>` first when none is open. If a command fails, say the items were not recorded, and never claim they were. Run each command on its own, with no shell loops, variables or `&&` chains, so the user can allow it once.

The Feedback tab shows only on the review page of an `.html` or `.md` output. For any other output, catalog the round the same way, and tell the user that Herdr has no Feedback tab for that kind of file, so they decide in chat. Log each decision they give in chat as `Claude "note · decided in chat · <their words>"` before you act on it.

## Catalog first

Change nothing in the output until the user decides. A round is cataloged, not applied.

1. Run `hws surface cli -- feedback list` and `hws surface cli -- feedback show <output>` to see what exists.
2. Run `hws output add --title "<title>" --path <output> --status ready`, even when you only catalog against it. It lists the output under Outputs in Herdr's right panel, so the feedback is in reach.
3. Check every point for look-alikes in one call, `hws surface cli -- feedback related <output> --text "<point 1>" --text "<point 2>"`.
   - The same point seen again is the same item. Join it with `"same": <n>`, never a new item.
   - A near-repeat, or the same point on another output, is a new item with a `related` link.
   - A later quote that asks again about an existing item joins it as a `src` line. A quote that only praises or confirms a fix, such as "works now", is not a `src` line, because a new `src` on a closed item flags it as raised again. Log it on the item instead, as `Claude "note · round 2 · Lena · 00:40 · \"The skip link works now\""`.
   - Never guess which build a speaker saw, or decide for the user that a repeat needs no change. Record the conflict, such as "Raised again after commit 3a62d74; the transcript doesn't say which build Maya saw". Say in the reply which items need the user to look.
4. Catalog the round and all its points in one call. Write the points as JSON with your Write tool to a new file named after the transcript, such as `.feedback/scratch/catalog-sme-2.json`, then pass the file. A heredoc makes the command unique each time, so the user can't allow it once. The call adds the round unless the file has it, skips points already cataloged, and names look-alikes it finds.

```json
[
  {"title": "Hard to find the filters", "src": ["Ana · 03:02 · \"Where do I filter?\""],
   "change": "Move the filter row above the results.", "where": "#filters", "related": ["pricing.html #3"]},
  {"title": "Empty saved box is confusing", "src": ["Ben · 05:40 · \"It says \"Nothing yet\" and then what?\""],
   "options": ["A · Explain how to save an item", "B · Hide the box until something is saved"]},
  {"same": 2, "src": ["Maya · 00:14 · \"Still no filters\""], "change": "Make the filter row sticky too."}
]
```

```bash
hws surface cli -- feedback catalog prototype/checkout.html --label SME --source transcripts/sme-2.md --date 2026-10-18 --items .feedback/scratch/catalog-sme-2.json
```

5. Reply with how many items the round added or joined, mention any praise, and name `<output>` by its path. When the user asks to see the items, run `hws review <output>` and end the turn. The items are in its Feedback tab.

| Field | Holds |
|---|---|
| `--date` | The transcript's date, from its header or name. Leave it off when the transcript has none |
| `title` | The problem as the speaker felt it, in a few words |
| `src` | `<speaker> · <time> · "<quote>"`, in the catalog's round. Quote word for word, inner quotes as said. Only JSON escapes them, and the file keeps them raw. The time is the transcript timestamp, or `-` |
| `change` | The change you propose, in one concrete line |
| `options` | `<letter> · <text>` when a point has real alternatives. The user picks one when they accept |
| `where` | Optional. A unique CSS selector for an HTML output, such as `#filters`, or a heading (`## Pricing`) or line (`L42`) for a text output |
| `related` | `<output path relative to this file's folder> #N` |
| `same` | The item a repeat joins. Its `src` lines go on that item, and a `change` revises it |

Catalog every point, quick ones included. Pure praise is not an item, so mention it in the reply instead.

When a later round changes what an item asks for, revise it with `hws surface cli -- feedback change <output> <n> "<the revised change>"`. Earlier `Change:` lines stay as history. A revision after the user accepted puts the item back to open, so the user decides again. Never revise an accepted item to widen what you build. Add a new item instead.

Round numbers are project-wide. One transcript has one number in every file, so a file's numbers may skip. `round` and `catalog` say when the round already exists. To add a single point, run `hws surface cli -- feedback add <output> --title … --src '<round> · <speaker> · <time> · "<quote>"' [--change …] [--where …] [--option "A · …"]… [--related …] [--round N]`.

## The file

```
# Feedback · checkout.html

## Round 2 · SME · 2026-10-18 · transcripts/sme-2.md
## Round 1 · customers · 2026-10-12 · transcripts/cust-1.md

- [ ] #6 Hard to find the filters
    Round: 1
    Src: 1 · Ana · 03:02 · "Where do I filter?"
    Src: 2 · Maya · 00:14 · "I couldn't find the filters"
    Change: Move the filter row above the results.
    Change: Make the filter row sticky too.
    Option: A · Above the results
    Option: B · In a side panel
    Where: #filters
    Claude: 2026-10-12 · cataloged
    You: 2026-10-12 · accept · option A · keep it sticky on scroll
    Claude: 2026-10-12 · done · commit 3f2a91c
```

- Rounds are a registry, newest first. Items follow in the order they came in. Item numbers never repeat.
- The last `Change:` is the item's proposed change. An accept may pick an option, as `accept · option A`.
- The file is add-only. Writes append a line, add an item or round, or flip a checkbox. Never edit or delete a past line, even a wrong one. Correct it with a new line.
- `Claude:`, `You:`, `Workspace:` and `Review:` lines are dated events. You write `Claude:` lines. `You:` lines come only from the user, in the Feedback tab.
- An item's state comes from its last state verb. It is open after `cataloged` or `reopen`, accepted after `accept`, rejected after `reject` or `rejected`, and done after `done`, or after `closed` unless it was rejected. `[x]` marks done or rejected.
- `You: … · sent · through N` marks what the user already sent you, the item's first N dated events. Events after it are still unsent. An old `You: … · sent` without `through` covers the events above it.
- Older files may carry `Workspace:` lines that name a saved picture. Read that PNG as part of the user's answer on the item.

## Act on decisions

The user's decisions message starts with `@<output>.feedback.md` and lists the items decided since the last send.

1. Read the file with `hws surface cli -- feedback show <output>`. The newest `You:` lines on each item are the decision and its reasons.
2. Accepted means make the change, within what the user authorized. `accept · option B` means build option B.
   - Anything you would add beyond the accepted change is a new proposed item, added with `feedback add`. Never fold it in silently.
   - A note can narrow an accept, as in "Review order is good, fees next round". Build the part the user approved. Add each deferred part as a new open item with `related` set to this one, quoting the user's note in its change. Then log the done line for the part you built. Never leave deferred work only in a note.
   - Commit the output with `<output>.feedback.md` and the `<output>.feedback/` folder, then log the change with `hws surface cli -- feedback done <output> <n> "<what changed, briefly>" --commit <sha>`. Once every item is logged, commit `<output>.feedback.md` again, such as `Log feedback #1, #3 done`, so the tree is clean. Outside a git repo, leave `--commit` off.
3. Rejected means change nothing. The item is already closed.
4. Answer notes and voice notes with `hws surface cli -- feedback log <output> <n> Claude "note · <answer>"`. Give reopened items a fresh look and a `Claude` line.
5. Log what you did not do, too, such as `Claude "note · blocked on the pricing API"`. Every change gets a dated line.
6. Say which items you closed and which still wait on the user. Name the before and after pictures by path when they help, because the item cards in the Feedback tab show them too.
7. If the prompt's last line asks you to run `hws review <output>`, run it, then end the turn.

A closed item that a later round's `Src:` line names again shows as raised again. Give it a fresh look and a `Claude` line, and the user decides whether to reopen it.

## Review pins on an output with feedback

A `review.md` from a review page can tie a pin to feedback items, with a line like `- Feedback: item #3 in checkout.html.feedback.md`.

- Make the change the pin asks for, as with any review.
- For each named item, log the pin with `hws surface cli -- feedback log <output> 3 Review 'pin 2 · "<the pin's words, short>"'`.
- `- Feedback: no item matches this element` means the pin is not on any item's `Where:`. If it is new feedback, catalog it as a new item with the pin's element as `Where:`, in a `review` round whose source is the review.md path. If it is only a small fix, make it and say so.

On a conflict the command reads the file again and retries once. If it still fails, run `show` and repeat only your own line.

## Before and after pictures

For an HTML output, picture the item before you change it and again after.

- Run `hws surface cli -- feedback snap <output> <n> --before`, then make the change, then run it with `--after`.
- It captures the section or card around the item's `Where:` element, with the element outlined, or the whole page without one. It writes `<output>.feedback/<n>-r<round>-<side>.png` and appends the `Before:` or `After:` line. The round defaults to the item's latest, and `--round N` picks another.
- A picture taller than 10000 CSS pixels keeps only its top, and the line ends `· clipped to the top 10000px`. Say so when you report it.
- Pictures never change. A retake writes `<n>-r<round>-<side>-2.png` and its own line. Picture the before once per round, and snap `--after` again for each later fix. Other outputs return an error, so skip pictures for them.
- The item card's slider shows each round's first before against its latest after.

## Project graph

`hws surface cli -- feedback graph` lists every item by output, with the sources that raised it, its `Related:` links both ways, and its workspaces. Add `--json` for nodes and edges. Use it to see how a transcript spread across outputs.
