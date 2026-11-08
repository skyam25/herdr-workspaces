---
name: herdr-workspace
description: This skill should be used when the user mentions a workspace, a Herdr workspace or "this workspace", asks what is in the workspace or what artifacts it has, or asks to sketch, draw, write or review something in a pane. Explains how to read the workspace and how to ask the user for input through a surface.
---

# Herdr workspace

A workspace is a Herdr space with a manifest. The manifest is the source of truth for its tabs, terminals, surfaces and artifacts. Only `hws` writes the manifest, so never edit `workspace.json` by hand.

Run `~/.local/bin/hws` if `hws` is not on PATH.

## Read the workspace

| Command | Shows |
|---|---|
| `hws current --line` | One sentence, or nothing outside a workspace |
| `hws current --json` | The full manifest |
| `hws artifact list` | Artifacts, each with a `prompt` path to its `prompt.md` |
| `hws link ARTIFACT` | An `@path` reference to the artifact's prompt |

Read the manifest before inferring anything from the folder or git state. If `$HC_TERMINAL_ID` is empty or `hws current --line` prints nothing, this session is in a normal terminal with no workspace.

## Kinds

| Kind | Meaning |
|---|---|
| `general` | Kept workspace with no stated type. This is the default |
| `app` | Kept workspace for building software in its folder |
| `deliverable` | Kept workspace for producing a document or other finished output |
| `throwaway` | Short-lived workspace with no project folder. `hws promote` turns it into a kept one |

## Ask the user through a surface

A surface is a board, note or page tied to this terminal. A board opens in its own floating window, and a note or page opens in a pane beside this terminal. Open one only when the user asks for it. Never open a surface unasked.

```bash
hws surface open --type board|note|page --title X --terminal $HC_TERMINAL_ID
```

Pass `--file F` to open an existing file in a note or page.

After opening a surface, end the turn and wait. The user presses Done and the feedback arrives as the next prompt. Do not poll for it.

## Draw on a surface

```bash
COMPANION_SOCKET=$(hws surface socket --terminal $HC_TERMINAL_ID) agent-brief draw ...
```

Add `--title X` to `hws surface socket` when this terminal has more than one surface open. Use the `agent-brief:sketch-board` skill for the drawing format and the other `agent-brief` commands, and keep the same `COMPANION_SOCKET` prefix on each of them.
