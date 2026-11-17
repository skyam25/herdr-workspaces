---
name: wireframe
description: "This skill should be used when the user wants a UI wireframe, mockup, or schematic of a screen, page, modal, or flow — \"wireframe this\", \"sketch the UI\", \"mock up a screen\", \"show me a layout for…\", \"draw a before/after of this interaction\", or when proposing a UI change that's easier to see than to describe. Authors a compact `wireframe` DSL block and renders it to a standalone SVG with the bundled offline helper, then shows it beside the terminal with `hws review` when the user asks to see it. Works in any repo or doc, with or without a Herdr workspace."
---

# Wireframe

Turn a UI idea into a clean SVG mockup. You write a small, line-oriented `wireframe` DSL block, then render it to an SVG with the bundled helper. The helper runs on bare `node`, reaches no network, and writes only the file you name.

## Where files go

Keep each source and its render together in one folder.

```
wireframes/
  <slug>/
    <slug>.wireframe      # one mockup, or <slug>.md for a set of options
    <slug>.svg            # the render, beside its source
    <slug>.html           # the options page, when there are alternatives
    <slug>.view.md        # a page that embeds the SVG, for hws review
  themes/
    <brand>.json          # custom themes, reused across sketches
```

- In a Herdr workspace, put `wireframes/` under the folder `hws place artifacts` prints. Elsewhere, put it at the project root.
- Follow the project's own convention when it has one, such as `docs/` or `design/`.
- Name the slug after the screen or flow, such as `notification-settings`, never `sketch1`.
- Always keep the `.wireframe` or `.md` source next to the render. The source is the editable original, and the SVG is regenerated from it.

## The loop

1. Write a `wireframe` block to its source file, such as `wireframes/notification-settings/notification-settings.wireframe`. Use the quick reference below.
2. Check and render in one call, with the output beside the source.

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/bin/wireframe-render.mjs --in wireframes/notification-settings/notification-settings.wireframe --out wireframes/notification-settings/notification-settings.svg --strict
   ```

   `--strict` lints first and writes nothing on any warning. It prints the line-numbered problem to fix, so no separate `--check` pass is needed. Add `--theme wireframes/themes/brand.json` to restyle, or `--stdout` to print the SVG.
3. Name the SVG path in your reply.

The renderer draws the real text you put in the block, so use real copy, never lorem ipsum.

## Show it to the user

When the user asks to see the mockup, write a small Markdown page beside the SVG that embeds it, then open that page.

```markdown
# Notification settings

![Notification settings](notification-settings.svg)
```

```bash
hws review wireframes/notification-settings/notification-settings.view.md
```

The page opens beside this terminal. End the turn after `hws review`, because the user's comments arrive as your next prompt. Change the source, render again, and run `hws review` on the same page for the next round.

## Present options

To offer alternatives, put each in its own ```` ```wireframe ```` fence in one `.md` file, such as `wireframes/<slug>/<slug>.md`. Render them to one self-contained HTML page of lettered tabs beside it.

```bash
node ${CLAUDE_PLUGIN_ROOT}/bin/wireframe-render.mjs --in wireframes/<slug>/<slug>.md --html --out wireframes/<slug>/<slug>.html --title "…"
```

Annotate each block with leading `#` comment lines, which the parser ignores.

| Comment | Says |
|---|---|
| `# option: <title>` | The option's name |
| `# best-when: <when>` | When it is the right call |
| `# risk: <cost>` | What it costs |
| `# suggested` | The one you recommend. It opens first |

Run `hws review` on the HTML page so the user can compare the options and pin comments on them. Vary the layout across options, not only the copy.

## Two authoring rules

1. Mirror what exists, and sketch schematically when nothing exists. For a change to a real product, map DSL primitives to its actual components and keep the chrome consistent. With no ground truth, use defaults, label frames generically, and invent no brand specifics.
2. Match the layout to the change. A section landing on one surface is `single`. A pattern swap or a before and after is `transformation`. A staged evolution of one surface is `evolution`.

## DSL quick reference

The DSL is YAML-like, with 2-space indents and no tabs. Quotes are optional unless the string has commas or brackets. Inline arrays use `[a, b]`. Comments start with `#`. In Markdown the fence is exactly ```` ```wireframe ````, with no language alias.

Top-level keys:

- `layout: single | transformation | evolution`. The default is `single`.
- `size: sm | md | lg | page`. The default is `md`, and `page` is a full route with chrome.
- `callouts: ["note", …]` draws a numbered legend below the frames. Pair it with `marker:`.

Layouts:

- `single` puts the frame keys at the top level.
- `transformation` takes `left:` and `right:` child frames and `arrow: { top: "MOVE", bottom: "into the drawer" }`.

```wireframe
layout: transformation
left:
  frame: browser
  label: "current"
  body:
    - heading: "Notifications"
    - row: [toggle, "Mentions"]
arrow:
  top: MOVE
  bottom: into drawer
right:
  frame: panel
  body:
    - heading: "Project · notifications"
    - button: "Save"
```

- `evolution` takes a `frames:` list of frame blocks and `transitions: ["make it punchier", …]`.

Frame keys:

| Key | Takes |
|---|---|
| `frame` | `browser`, `doc`, `dark-app`, `terminal`, `napkin`, `panel` or `none` |
| `label` | A caption above the frame |
| `viewport` | `desktop`, `mobile` or `tablet` |
| `grid` | `{ columns: 12, gap: 16 }` |
| `sidebar` | `{ items: ["Home", { label: "Inbox", badge: "3" }], active: "Home" }`, a left nav rail |
| `topbar` | `{ title: "…", actions: ["Export", "Create"] }`. The last action renders primary |
| `overlay` | `{ variant: modal \| drawer-right \| drawer-left, label: "…", body: [...] }`. It dims the base page and draws the surface on top. Keep the base skeletal, at size `lg` or `page` |
| `body` | The ordered list of entries |

Body entries:

- `heading: "…"`, `para: 3` for three placeholder bars or `para: "real text"`, `accent: "…"` for a highlight bar, `divider` and `spacer`.
- `button: "Save"` and `button: ["Cancel", outlined]`. Two `button:` entries stack. Side-by-side buttons are one `buttons:` list with the same item shapes.

```
  - buttons:
      - "Save"
      - ["Cancel", outlined]
```

- `row: [toggle, "Mentions"]`, also with `checkbox` or `icon`.
- `tabs:` with an active state. `active:` is an indented sibling line, never its own `- ` item. Nav and segmented strips are tabs, never chips. `steps:` takes the same sibling `active:`.

```
  - tabs: ["List", "Calendar", "Search"]
    active: "List"
```

- `chip: ["BETA", { label: "LIVE", tone: ok }]`, for status and tag pills only.
- `breadcrumbs: ["Settings", "Billing"]` and `pagination: { page: 2, pages: 9 }`.
- `list:` of `{ leading: icon | avatar, title: "…", meta: "…", badge: "3" }`.
- `field: { label: "…", placeholder: "…", variant: input | select | search | textarea }`. Use `value:` in place of `placeholder:` for a filled state.
- `banner: { variant: info | warning | error | success, text: "…" }` and `empty: { heading, helper, cta }`.
- `stat: { value: "1,234", label: "…", trend: "+12%" }` and `meter: { label: "Storage", value: 7, max: 10, caption: "7 of 10 GB" }`.
- `avatar: "AB"` and `avatar-stack: ["AB", "CD"]`.
- `table: { columns: ["A", "B"], weights: [3, 2], rows: [["x", { pill: "Live", tone: ok }]] }`. Status cells are pills, not text. Give long columns more weight.
- `media: { label: "…", variant: image | chart }` and `card-grid: { columns: 3, cards: [{ title: "…", meta: "…" }] }`.
- `accordion:` of `{ title: "…", expanded: true, body: [...] }` and `popover: { anchor: bottom, body: [...] }`.
- `columns:` of `{ label: "Main", span: 8, body: [...] }`, for page-grid regions inside `size: page`.
- Any entry with a sibling line `marker: 1` gets a numbered badge, which pairs with `callouts:`.

Rules:

- Use real copy, never placeholders.
- Page-level actions go in `topbar.actions`, not body buttons.
- Keep about 6 entries at `sm`, 12 at `md`, 18 at `lg` and 28 at `page`.
- Alternatives differ in layout, so they read as distinct structural choices.

## Full catalog

The quick reference covers the common case, including overlays, page grids, markers and callouts and every body entry above. Read `references/wireframe-format.md` only for what it lacks, such as `evolution` transition details, edge-case options, worked examples or the table of rendering failures.

## Restyling

The default theme is a clean white and blue palette. Pass `--theme path/to/theme.json` to match a brand. The DSL never carries colors or pixel sizes, because those live in the theme.
