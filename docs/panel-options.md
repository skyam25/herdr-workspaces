# Workspace panel options

## Problem

- `mods/hws-panel/main.js:77` opens the panel with `pane.split` to the right of the terminal.
- The split takes the full column height, and the content fills about the top third.
- The panel holds reference and occasional actions, so it rarely needs to stay open.

## Contents

| Group | Items | Use |
|---|---|---|
| Identity | Name, folder, kind | Glance |
| Create | New board, New note, Instructions | Occasional action |
| Tabs and agents | Tab rows, agent status | Glance, partly repeated in Agents |
| Open surfaces, Artifacts | Lists | Glance and open |
| Close workspace | Button | Rare |

## Options

| | A. Popup from the sidebar | B. Child of the right panel | C. Fold into the sidebar |
|---|---|---|---|
| Opens from | Existing panel icon, `sidebar.js:139` | New Workspace button beside Tasks and Outputs | Expanding the active workspace row |
| Terminal room while open | None | Shares the right panel column | None |
| Stays open | No, it closes when dismissed | Yes, until toggled | Yes, while expanded |
| Empty space | Sized to content | Same empty column below the content | Sized to content |
| Build size | Small, swap `pane.split` for `openOverlay` with `kind: "popup"` | Medium, change `mods/layouts/hws.json` and the `hws-tabs` buttons | Large, rework `sidebar.js` for narrow widths |
| Main risk | Long artifact lists need scrolling | Keeps the column layout you disliked | The sidebar gets crowded with several workspaces |

## Recommendation

Build option A. The panel is mostly glance and occasional action, so it should appear on demand and leave the terminal alone.

Choose B if you want the panel to stay open while you work. Choose C if you want workspace details always in view.

## Decision needed

- Which option to build
- What bothers you most today: the room it takes from the terminal, that it stays open, or that most of it is empty

The answer to the second question can change the first. If staying open is useful and only the width is the problem, B wins.
