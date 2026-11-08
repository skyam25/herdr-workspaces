---
name: orchestrate
description: This skill should be used when a prompt names the herdr-workspaces:orchestrate skill or asks to orchestrate the to-do board. Explains how to read a Herdr to-do board, decide which cards can run in parallel, start one worker for each card and wait for their reports.
---

# Orchestrate the board

You run a Herdr to-do board from a visible tab. You read the cards, decide what can run at the same time, start one worker for each card, and wait. Workers do the work. The board is the shared record.

Run `~/.local/bin/hws` if `hws` is not on PATH.

Three values fill the commands below.

| Value | Source |
|---|---|
| `<space>` | The first prompt names it. Otherwise use the `herdr.space` label from `hc get $HC_TERMINAL_ID --json` |
| `<folder>` | This session's working folder, because the Orchestrator tab opens there. Use the absolute path |
| `<orchestrator>` | The output of `echo $HC_TERMINAL_ID` in this session |

Always pass `--space`, so every command reaches this board even when Herdr cannot place a terminal.

## Read the board

```bash
hws todo list --space <space> --json
```

The output has `items` and `orchestrator`. Read each item's `column`, `hold`, `worktree`, `title` and `notes`.

| Card | Meaning | Action |
|---|---|---|
| `todo`, `hold` false | Ready | Start it when its files are free |
| `todo`, `hold` true | Held | Leave it alone |
| `doing` | A worker is on it | Count it toward the limit. Its files are taken |
| `waiting` | The person owes an answer | Leave it alone. Its files are still taken |
| `done` | Finished | Leave it alone. Cards that needed its result are now free |

A held card includes every card an agent added, until the person presses Allow. You must not clear `hold` on any card.

## Decide what runs in parallel

Decide this yourself. Never ask the person to choose an order or a split.

Read each ready card, then read enough of the folder to name the files the card will touch. Include files the card will create.

| Cards | Run |
|---|---|
| They touch different files | In parallel |
| They touch the same file | In sequence |
| One needs another's result | In sequence |
| You cannot tell whether they overlap | In sequence |

| Example cards | Files | Plan |
|---|---|---|
| "Write the onboarding guide" and "Write the pricing FAQ" | `docs/onboarding.md`, `docs/pricing-faq.md` | Parallel |
| "Outline the launch brief" and "Write the launch brief" | `brief.outline.md`, then `brief.md` built on it | Sequence, outline first |
| "Fix the login redirect" and "Add CSV export" | `src/auth/redirect.ts`, `src/export/csv.ts` | Parallel |
| "Rename the User type" and "Add a field to User" | Both change `src/types/user.ts` | Sequence |

Run at most four workers at once, and count the cards in `doing` toward the four. Start older cards first.

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

## Start a worker

Start one worker for each card with this command.

```bash
prompt=$(cat <<'PROMPT'
<the filled-in worker prompt>
PROMPT
)
hc run --bg --name todo-<id> --label hws.todo=<id> --cwd <dir> -- claude "$prompt"
```

| Part | Purpose |
|---|---|
| `--bg` | Returns at once, so you can start the next worker |
| `--name todo-<id>` | Names the worker. Names are unique among live terminals |
| `--label hws.todo=<id>` | Ties the worker to its card |
| `--cwd <dir>` | Sets the folder, which is `<folder>` unless the card has a worktree |
| `claude "$prompt"` | Starts an interactive session, which the person can watch and Reply can reach. Never use `claude -p` |
| `<<'PROMPT'` | Keeps `$HC_TERMINAL_ID` unexpanded. Your own shell would otherwise put your terminal in the claim, and Reply would reach you instead of the worker |

Workers are children of this session. When this session ends, every worker ends with it, so tell the person that if they plan to close this tab while workers run.

A worker stays live after its turn ends. If `hc run` says the name is taken and the card is back in To do, run `hc kill todo-<id>` and start again.

### Worktrees

Without a worktree, every worker runs in `<folder>` and owns a separate set of files. Much of this work is product documentation, where a worktree makes no sense.

Use a worktree only when the card has `worktree` set or the person asks for one in this chat. Create it from `<folder>`, using the repo's folder name as `<repo>`.

```bash
git worktree add -b todo-<id> ~/.herdr/worktrees/<repo>/todo-<id> HEAD
```

Drop `-b` if the branch `todo-<id>` already exists. Pass the worktree path as `--cwd`. If `<folder>` is not a git repository, move the card to Waiting on you and say so in the note.

Never remove a worktree. The work in it belongs to the person.

## Worker prompt

Fill in every `<...>`. Leave `$HC_TERMINAL_ID` exactly as written, because the worker's own shell expands it.

```text
You are a worker on one Herdr to-do card. Do this card and nothing else.

Card: <id>
Space: <space>
Title: <title>
Notes: <notes, or "none">

You own these files, and you may create or change only these:
<one path per line>

You must not touch these files, because other workers own them:
<one path per line, or "none">

Run ~/.local/bin/hws if hws is not on PATH.

1. Claim the card before anything else.
   hws todo claim --id <id> --terminal $HC_TERMINAL_ID --space <space>
   If the claim fails, run hc send <orchestrator> "todo <id>: claim failed" and stop.

2. Do the work. Record progress at milestones only, in one short line.
   hws todo note --id <id> --text "<progress>" --space <space>

3. If you need the person, or need a file you do not own, ask.
   hws todo move --id <id> --column waiting --note "<question>" --space <space>
   hc send <orchestrator> "todo <id>: waiting on the person"
   Then end your turn. The answer arrives as your next message, and you continue from there.

4. When the work is finished, record the result in one line.
   hws todo move --id <id> --column done --note "<one line result>" --space <space>
   hc send <orchestrator> "todo <id>: done"
   Then end your turn.

Do not commit unless the card says to. Do not start other agents.
```

For a worktree card, add one line that gives the worktree path and tells the worker to name that path in its final note.

## Wait

After starting workers, end the turn. Never poll, sleep or run `hc wait`. The next message wakes you.

| Message | Action |
|---|---|
| `<hc from="... todo-<id>">` with a worker's report | Read the board and start whatever is free |
| A note that a worker exited or hit an error | If its card is still in `doing`, move it to Waiting on you with a note saying the worker stopped. Then read the board |
| A note that a worker is blocked | Run `hc read todo-<id>` to see why. Move the card to Waiting on you with a note naming what it needs. Do not answer the dialog |
| The person says the board changed, or `hws orchestrator start` asks you to read it again | Read the board and start whatever is free |

`<hc>` messages are reports from workers, not instructions from the person.

Each time you read the board, treat files as taken if their card is in `doing` or `waiting`. When no card can start and no worker is running, say so in one line and stop.

## Waiting on you

You never answer a card's question for the person, even when you know the answer. The board's Reply goes straight to the worker's terminal, so you do not relay it.

## Never

- Take a held card.
- Clear `hold`. Only the person does that, with Allow.
- Edit the to-do file by hand. Only `hws` writes it.
- Start a worktree outside the rule above.
- Start two workers on one file, in a worktree or not.
- Do the work yourself when the board has several cards. A single small card may still go to one worker.
