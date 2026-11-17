---
name: sketch-board
description: This skill should be used when the user asks to draw on or read a sketch in Herdr, mentions the sketch, the sketch window or the board they drew on, asks Claude to draw a diagram or flow for them on a sketch, or asks what they drew or sketched. Also use it to look at their sketch before answering a question about it, and to post screenshots of a browser session Claude drives so the user can follow it and mark it up. Explains how to open a sketch with `hws surface open --type board` and drive it with `hws surface cli`.
---

# Sketch board

A sketch is a Herdr surface tied to this terminal. It opens in its own window. You draw on it and read it with `hws surface cli`, the user sees your changes live, and they can draw back. When they press Done, the sketch and their notes arrive as your next prompt.

Run `~/.local/bin/hws` if `hws` is not on PATH.

## Open a sketch

Open one only when the user asks for a sketch, a diagram or a drawing. Never open a surface unasked. A picture that would explain your answer better is a reason to offer one, not to open it.

```bash
hws surface open --type board --title "Signup flow" --terminal $HC_TERMINAL_ID
```

The title names the sketch. `--type board` picks this terminal's newest sketch over any page it has open. When it has more than one sketch open, add `--title X` before the `--` to pick one.

To reopen a sketch the user closed early, find its id under `surfaces` in `hws current --json` and run `hws surface resume --id S`.

To keep drawing on a sketch the user already finished with Done, find its id in `hws artifact list`, where its type is `board`, and reopen it.

```bash
hws surface open --type board --artifact A --terminal $HC_TERMINAL_ID
```

The sketch opens with its drawing and pinned comments. Its next Done files a new artifact that replaces the old one, which stays as it was. Pass `--file F` in place of `--artifact` to open an `.excalidraw` file.

## Commands

Each command runs against this terminal's open sketch. `--json` prints the raw response.

| Command | Does |
|---|---|
| `hws surface cli --type board -- read [--region x,y,w,h]` | Prints the elements as text |
| `hws surface cli --type board -- png [--region x,y,w,h] [--max-edge 1400] [--out <path>]` | Writes a PNG and prints its path |
| `hws surface cli --type board -- draw --file f.json` | Adds elements from a JSON file |
| `hws surface cli --type board -- snap <image> [--caption <text>] [--note <text>] [--width 720]` | Adds a screenshot as the next numbered step |
| `hws surface cli --type board -- update --file f.json` | Changes elements by id |
| `hws surface cli --type board -- delete <id>...` | Removes elements by id |

Write the JSON with your Write tool to a file under `.feedback/scratch/`, then pass `--file`. Run each command on its own, with no shell loops, variables or `&&` chains, so the user can allow it once. Input errors name the element index, such as `elements[2]: "x" must be a number`. If a command fails because no sketch is open, say so and stop. Do not retry in a loop.

## Look at the sketch

Run `read` first. It costs few tokens and gives you ids, positions, labels and who drew each element.

```
board "current" · 7 elements · bounds 0,0 1200×800
r1 rectangle "Header" at 40,40 400×80 blue (claude)
a1 arrow r1 → r2 (claude)
f3 freedraw at 300,420 120×60 (user)
```

`read` gives structure, not appearance. Run `png --region x,y,w,h` and Read the file it prints when any of these hold.

- The sketch has `freedraw` elements. Strokes have no label, so only the picture shows what they mean, such as a circle around a button.
- The user drew on or near an `image`. Text cannot tell you which part of the screenshot they marked.
- You need to check your own drawing. `read` reports an arrow as present even when something covers it.

An image costs about 1 to 2k tokens, so crop to the area you need. A frame's line in `read` gives its region.

Elements marked `(user)` are the user's. Elements marked `(claude)` are yours.

## Draw

Send a JSON object `{"elements": [...]}` or a bare array. Every field except `type` is optional.

| Field | Meaning |
|---|---|
| `type` | `rectangle`, `ellipse`, `diamond`, `text`, `sticky`, `arrow`, `line`, `frame` or `image` |
| `id` | Your own id. Arrows in the same call can bind to it |
| `x`, `y`, `width`, `height` | Position and size in board pixels |
| `label` | Text inside a shape or sticky, the title of a frame, or the content of a `text` |
| `color` | `black`, `gray`, `red`, `orange`, `yellow`, `green`, `blue`, `violet` or `pink` |
| `start`, `end` | Arrow and line ends. `{"id": "r1"}` binds to an element. `{"x": 0, "y": 0}` is a free point |
| `points` | Line points `[[0,0],[100,40]]`, relative to `x`,`y` |
| `align` | `left` or `center` for a label inside its shape. A label of `- ` or `• ` lines is left by default |
| `frameId` | Puts the element inside that frame |
| `file` | An `image` element's png, jpeg, gif or webp path. Give a `width` or a `height` and the other keeps the proportions. With neither it is 720 wide |

- Use `sticky` for short notes and questions to the user. A note with a heading and several points reads best as one `- ` line per point.
- Use `frame` to group a region. Give it a `label` as its title and size it to hold its children.
- Bind arrows by id so they follow the shapes when the user moves them. Use free points only for callouts.
- Colors are names, not hex values. Shapes, arrows and lines draw in violet unless you give a `color`.

This file draws three boxes in a row inside a frame, joined by arrows. The plain arrow gets a 60 px gap. The arrow labelled `ok` gets 100 px, which is 12 per character plus 60, rounded up to 20.

```json
{"elements": [
  {"id": "f", "type": "frame", "x": 0, "y": 0, "width": 840, "height": 160, "label": "Signup flow"},
  {"id": "a", "type": "rectangle", "x": 40,  "y": 40, "width": 200, "height": 80, "label": "Form",        "color": "blue",   "frameId": "f"},
  {"id": "b", "type": "rectangle", "x": 300, "y": 40, "width": 200, "height": 80, "label": "Validate",    "color": "orange", "frameId": "f"},
  {"id": "c", "type": "rectangle", "x": 600, "y": 40, "width": 200, "height": 80, "label": "Create user", "color": "green",  "frameId": "f"},
  {"type": "arrow", "start": {"id": "a"}, "end": {"id": "b"}},
  {"type": "arrow", "start": {"id": "b"}, "end": {"id": "c"}, "label": "ok"}
]}
```

`draw` prints the batch id, then one line per new element in the format `read` uses, then any warnings. Take ids from these lines, not from their order. An element you gave no `id` gets a generated one. Each line shows the element's final size, so a height larger than the one you sent means a label took more lines than you counted. After a big draw, run `png` and Read it to check the result.

| Warning | Fix |
|---|---|
| `arrow … is N px long, so its label … hides it` | Move the shapes it joins apart by the amount it names |
| `rectangle … grew from A to B px tall … and now overlaps …` | Move the named elements down by the amount it names, or widen the box. A `sticky` gets the same warning |
| `frame … grew to W×H … and now overlaps …` | Move the named frame down by the amount it names. Its contents move with it |

### Change and remove

An `update` file lists changes by id, such as `[{"id": "b", "label": "Check input", "color": "violet", "x": 340}]`. It can set `x`, `y`, `width`, `height`, `label` and `color`. A new `x` or `y` on a frame moves everything in it, and arrows bound from outside the frame re-route. `update` also warns when a new label grows a box over a neighbour. `delete c` removes element `c`.

## Layout

Work out every size before you draw. A box or sticky grows taller to hold its label, and then it can cover what sits below it. Sizes from these rules keep the first draw clean.

### Height of a box or sticky

- A label line takes 23 px, and the box adds 16 px above and below. The height a label needs is 23 × lines + 32, rounded up to the grid of 20.

| Lines | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Height | 60 | 80 | 120 | 140 | 160 | 180 | 200 |

- Count lines after wrapping. A line holds about (width − 40) ÷ 10 characters, and a label in capitals holds about two thirds as many.

| Width | 200 | 260 | 300 | 380 | 460 |
|---|---|---|---|---|---|
| Characters per line | 16 | 22 | 26 | 34 | 42 |

- Each line of the label starts a new line, so a heading and three `- ` points start four lines. The `- ` counts as two characters.
- A sticky 260 wide holds 22 characters a line. A heading and three points of about 30 characters take 1 + 3 × 2 = 7 lines, so it needs a height of 200.
- Give long text more width rather than more lines. Make plain boxes 200×80, which holds two lines of 16 characters.
- Give boxes in a row the same width, and the height of the tallest.

### Spacing

- Leave 60 px between boxes in a row when the arrow between them has no label. A row of 200-wide boxes steps by 260 px.
- A labelled arrow needs 12 px per character plus 60 between its boxes, rounded up to 20. `ok` needs 100, `submit` 140 and `POST /login` 200. Keep arrow labels to 20 characters or fewer.
- Leave 60 px between boxes in a column, or 100 px when a labelled arrow joins them.
- Snap positions to a grid of 20. Flow left to right, or top to bottom for long chains.
- Label every shape, and every arrow that is not obvious.

### Frames

- Leave 40 px between a frame's edges and its content. Its height runs to the lowest child's bottom, plus 40.
- A frame's title sits above its top edge, so leave 60 px between one frame's bottom and the next frame's top.

### Placing on a sketch with content

Run `read` before drawing on a sketch that has content. Place new elements in empty space below or to the right of the `bounds` line.

## Follow a browser session

When you drive a browser for the user and they want to follow along, post a screenshot to a sketch after each step that matters.

1. Open a sketch for the run, such as `hws surface open --type board --title "Checkout run" --terminal $HC_TERMINAL_ID`.
2. After each meaningful step, save a screenshot and post it.

   ```bash
   hws surface cli --type board -- snap .feedback/scratch/step-2.png --caption "Added two items to the cart" --note "Total shows $40, expected $36"
   ```

   `snap` puts the picture in a frame titled with the step number and caption, three steps to a row. Use `--note` for a question or anything you are unsure about. Five to ten steps make a readable run.
3. Tell the user the sketch is ready, and that they can mark it up, add notes or record voice, then press Done. End the turn. Their sketch and notes arrive as your next prompt.
4. Read their feedback with `read`. The user's strokes inside a step's frame list under that frame. Crop each marked frame with `png --region` and Read it, because a stroke only means something against the screenshot under it.

Done closes the sketch, so start the next round on a new one.

## Show a picture

There is no tool that draws a picture in the chat. The user sees the sketch window live, so after drawing, tell them what you drew. To point them at a screenshot or a PNG of the sketch, name its path. To have them comment on a screenshot, post it to the sketch with `snap`.

## Rules

- Never delete or move the user's elements unless they ask. Elements marked `(user)` are theirs.
- Change your own elements freely.
- One `draw`, `update` or `delete` call is one undo step. Send related shapes together so the user can undo them with one keystroke.
- Do not redraw the whole sketch to make a small change. Use `update`.
