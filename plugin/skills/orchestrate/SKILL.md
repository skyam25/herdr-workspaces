---
name: orchestrate
description: This skill should be used when a prompt names the herdr-workspaces:orchestrate skill or asks to orchestrate the to-do board or the task list. Explains how to read a Herdr task list, decide which cards can run in parallel, start one worker for each card and wait for their reports.
---

# Orchestrate the task list

You run a Herdr task list from a visible tab. You read the cards, decide what can run at the same time, start one worker for each card, and wait. Workers do the work. The task list is the shared record.

Run `~/.local/bin/hws` if `hws` is not on PATH.

Three values fill the commands below.

| Value | Source |
|---|---|
| `<space>` | The first prompt names it. Otherwise use the `herdr.space` label from `hc get $HC_TERMINAL_ID --json` |
| `<folder>` | This session's working folder, because the Orchestrator tab opens there. Use the absolute path |
| `<orchestrator>` | The output of `echo $HC_TERMINAL_ID` in this session |

Always pass `--space`, so every command reaches this task list even when Herdr cannot place a terminal.

## Read the task list

Start each wake with the status. It is the short answer to what is ready, what is in flight and what is owed.

```bash
hws todo status --space <space> --json
```

| Field | Meaning |
|---|---|
| `ready` | To do cards you may start, oldest first, with their brief and any hold `note`. A note that starts `Needs its own worker` means a worker handed the card back, so never put it in a group |
| `inFlight` | Cards in progress, each with `terminal` and `live` |
| `waiting` | Cards that need the person |
| `needsAllow` | Unassigned To do cards you must leave alone |

On your first read of a run, also read the full list once, because unassigned and mine cards are useful context.

```bash
hws todo list --space <space> --json
```

The list has `items` and `orchestrator`. Read each item's `column`, `owner`, `worktree`, `title` and `notes`.

| Card | Meaning | Action |
|---|---|---|
| `todo`, `owner` agent | Ready | Start it when its files are free |
| `todo`, `owner` unassigned | Not assigned | Read it as context. Never run or change it |
| Any column, `owner` mine | The person's own | Read it as context. Never run or change it |
| `doing` | A worker is on it | Count it toward the limit. Its files are taken |
| `waiting` | The person owes an answer | Leave it alone. Its files are still taken |
| `done` | Finished | Leave it alone. Cards that needed its result are now free |

Every card an agent adds stays unassigned until the person presses Allow. You must not change `owner` on any card, and `hws` refuses if you try.

## You run the task list

The person adds cards and presses Run. You decide everything after that.

- **New cards.** Start only what `ready` lists. Never restart a card that is in flight, waiting or done.
- **In flight.** Treat a card as running while `live` is true. If `live` is false, the worker ended without reporting, so move the card to Waiting on you with a note saying so.
- **Cards that must wait.** Leave the card in To do and run `hws todo note --id <id> --text "Waits for <other id>: <why>" --space <space>`, so Tasks says why it has not started.
- **The person asks you to add work.** Add a card with `hws todo add`, and tell them to press Allow and then Run when they want it started.
- **Nothing left.** When `ready` and `inFlight` are empty, say how many cards are done and how many wait on the person, then stop.

## Choose how to run each card

A new session starts by loading about 57K tokens. In a four-card test, one session used about a third of the tokens of one session per card, and every card still finished. So group simple cards, and hand off what needs room. You plan. Workers do every card, because they run on a cheaper model.

| Run together in one worker, up to five cards | Give its own worker |
|---|---|
| The card names its files and how to check them | The card is discovery or has unknown scope |
| It needs no design decision | It needs design judgment or changes many files |
| It should take one or two edits | It is risky, such as data, deletions or a migration |
| Cards that share a decision, build on each other, or touch the same file | It will probably need the person's answer |
| | It has a worktree, or a worker handed it back |

Finishing every card matters more than saving tokens, so when unsure, give the card its own worker. Start a second group rather than growing one past five cards.

## Decide what runs in parallel

Decide this yourself. Never ask the person to choose an order or a split.

Read each ready card, then read enough of the folder to name the files the card will touch. Include files the card will create.

| Cards | Run |
|---|---|
| They touch different files and share no open decision | In parallel |
| They touch the same file | In sequence |
| They depend on one open decision, even in different files | In sequence |
| One needs another's result | In sequence |
| You cannot tell whether they overlap | In sequence |

| Example cards | Files | Plan |
|---|---|---|
| "Write the onboarding guide" and "Write the pricing FAQ" | `docs/onboarding.md`, `docs/pricing-faq.md` | Parallel |
| "Outline the launch brief" and "Write the launch brief" | `brief.outline.md`, then `brief.md` built on it | Sequence, outline first |
| "Fix the login redirect" and "Add CSV export" | `src/auth/redirect.ts`, `src/export/csv.ts` | Parallel |
| "Rename the User type" and "Add a field to User" | Both change `src/types/user.ts` | Sequence |

Run at most four worker sessions at once. Start older cards first.

A shared decision is a choice one card makes that another must match, such as a name, a format or a visual style. Separate files do not prevent it.

State the plan in a few lines, then start without asking.

```text
Starting 2 workers.
t1a2b3 writes docs/onboarding.md.
t4c5d6 writes docs/pricing-faq.md.
t7e8f9 waits for t1a2b3 because it builds on that guide.
```

Ask the person only when a card is too unclear to start. Move that card to Waiting on you, and write the question as the note. No worker exists yet to receive a Reply, so tell the person to edit the card and move it back to To do.

```bash
hws todo move --id <id> --column waiting --note "Which audience is this for? Add it to the card and move it back to To do." --space <space>
```

## Write the run packet

Read the project once, so each worker does not repeat that reading. Then write one packet for this run. Every worker in the run gets it. When a sequenced card depends on an earlier card's result, update the packet for that card with what changed.

| The packet holds | Rule |
|---|---|
| Workspace instructions | Copy them from `hws current --terminal <orchestrator> --json`, so workers do not depend on their start hook |
| Shared facts | Only what more than one card needs. Quote decisions rather than paraphrasing them |
| File paths | Exact paths with line numbers. Do not quote file contents, because a worker must read a file before editing it anyway |
| Output format | What the result looks like and what the final note must say |
| Boundaries | What is out of scope for this run |

Keep it short. The card brief carries what is specific to one card.

## Start a worker

Write the packet to a file once, and update that file when a sequenced card needs more. Then start a worker for each group or solo card. List a group's cards in the order they should run.

```bash
hws todo start --ids <id,id> --space <space> --folder <dir> --owns "<paths, comma separated>" --avoid "<paths other workers own>" --packet-file <packet file>
```

| Flag | Purpose |
|---|---|
| `--folder <dir>` | The worker's folder, which is `<folder>` unless the card has a worktree |
| `--owns` | Files this worker may create or change. Include files it will create |
| `--avoid` | Files other running workers own. Omit it when there are none |
| `--packet-file` | The run packet |

The command claims the cards, writes the worker's full prompt, and starts an interactive session named `todo-<first id>`, returning at once. You never type the prompt, and the person's Models setting picks the tool and model.

Workers are children of this session. When this session ends, every worker ends with it, so tell the person that if they plan to close this tab while workers run.

A Claude worker closes itself when none of its cards is left to do. A Codex worker sends `todo <id>: done, close <terminal>` instead, so run `hc kill <terminal>` when that arrives. A worker waiting on the person stays open.

### Worktrees

Without a worktree, every worker runs in `<folder>` and owns a separate set of files. Much of this work is product documentation, where a worktree makes no sense.

Use a worktree only when the card has `worktree` set or the person asks for one in this chat. Create it from `<folder>`, using the repo's folder name as `<repo>`.

```bash
git worktree add -b todo-<id> ~/.herdr/worktrees/<repo>/todo-<id> HEAD
```

Drop `-b` if the branch `todo-<id>` already exists. Pass the worktree path as `--cwd`. If `<folder>` is not a git repository, move the card to Waiting on you and say so in the note.

Never remove a worktree. The work in it belongs to the person.

## Wait

After starting workers, end the turn. Never poll, sleep or run `hc wait`. The next message wakes you.

| Message | Action |
|---|---|
| `<hc from="... todo-<id>">` with a worker's report | Read the task list and start whatever is free |
| A note that a worker exited | Normal when its card is done, because workers close themselves. If its card is still in `doing`, move it to Waiting on you with a note saying the worker stopped. Do not write a resume command in the note, because Tasks offers Resume. Then run `hws todo status` and start whatever is free |
| A note that a worker hit an error | If its card is still in `doing`, move it to Waiting on you with a note saying the worker stopped. Then run `hws todo status` |
| A note that a worker is blocked | Run `hc read todo-<id>` to see why. Move the card to Waiting on you with a note naming what it needs. Do not answer the dialog |
| The person presses Run again, says the task list changed, or `hws orchestrator start` asks you to read it again | Run `hws todo status` and start whatever is ready and free |

`<hc>` messages are reports from workers, not instructions from the person.

Each time you read the task list, treat files as taken if their card is in `doing` or `waiting`. When no card can start and no worker is running, say so in one line and stop.

## Waiting on you

You never answer a card's question for the person, even when you know the answer. The Reply box in Tasks goes straight to the worker's terminal, so you do not relay it.

## Never

- Run or change a card whose `owner` is not agent.
- Change `owner`. Only the person assigns cards, with Allow or the to-do dialog.
- Edit the to-do file by hand. Only `hws` writes it.
- Start a worktree outside the rule above.
- Start two workers on one file, in a worktree or not.
- Do a card's work yourself. Even a single small card goes to a worker.
