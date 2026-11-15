# Third-party code

| Mods | Source | License |
|---|---|---|
| `hws-chat`, `hws-chat-models`, `hws-chat-image` | [Shepherdr](https://github.com/eliasstravik/shepherdr) commit `9dce4b2`, mods `chat`, `chat-models`, `chat-image` | MIT, in `LICENSE-shepherdr` |
| `hws-pane` | Shepherdr `pane-chat`, cloned from Herdr's `pane` | MIT and Apache 2.0, in `LICENSE-shepherdr` and `LICENSE-herdr` |
| `hws-tabs`, `hws-agents`, `hws-spaces` | Herdr's `tabs`, `agents` and `spaces`. Each `mod.json` records the Herdr version in `cloned_from`, and `upstream/` holds Herdr's file at that version | Apache 2.0, in `LICENSE-herdr` |
| `plugin/hooks/ask-hook.sh`, `plugin/hooks/ask-hook.mjs` | Shepherdr commit `9dce4b2`, `mods/chat/ask-hook.sh` | MIT, in `LICENSE-shepherdr` |

## Local changes

After a Herdr update, `node mods/sync-forks.mjs` reports which forks are behind, and `--merge` merges Herdr's changes into each one with `git merge-file`. Resolve any conflict markers, then run the mod tests and `herdr-app check`. Keep each fork's changes to what Herdr gives no other way to do.

- Mod names and asset paths carry the `hws-` prefix.
- `hws-chat/addons.js` turns off voice, reactions, artifacts, task browser, Autopilot, machine sync and usage insights.
- `hws-pane` drops Autopilot and Assistant slots and runs the parked-agent sweep.
- `hws-tabs` adds the Tasks, Workspace and Outputs buttons and the Tasks waiting badge, and shows flipped agents' status and titles on tabs, through `flipped.js` and `tabtitle.js`.
- `hws-agents` lists flipped agents, found with `flipped.js`, and sends their rows and sub-agent rows to the chat pane. `agent.next` and `agent.prev` skip flipped agents.
- `hws-spaces` hides local spaces listed in `hws.workspace.spaces` and then heads its list Other spaces. It draws a top border. Right-clicking a local space opens `hws-panel`'s space menu, and a remote space keeps Herdr's menu. It starts no `hc` or `git` runs during `herdr-app check`.
- `hws-chat` shows the CLI's status lines under the box, in `statusline.js`.
- `hws-chat` reads the macOS clipboard and accepts Finder's copied files, in `clipboard.js` and `attach.js`.
- `hws-chat` finds a Codex session by folder and start time when no process holds its log, in `core/chat-log.js`.
- `hws-chat` labels attached images in the box as `[Image #N]`, in `imagelabels.js`, and keeps mid-message labels in the thread.
- `ask-hook` is rewritten in Node, serves Claude Code only, runs only for a flipped agent, and releases when the chat closes.
