# Third-party code

| Mods | Source | License |
|---|---|---|
| `hws-chat`, `hws-chat-models`, `hws-chat-image` | [Shepherdr](https://github.com/eliasstravik/shepherdr) commit `9dce4b2`, mods `chat`, `chat-models`, `chat-image` | MIT, in `LICENSE-shepherdr` |
| `hws-pane` | Shepherdr `pane-chat`, cloned from Herdr's `pane` | MIT and Apache 2.0, in `LICENSE-shepherdr` and `LICENSE-herdr` |
| `hws-tabs`, `hws-agents`, `hws-spaces` | Herdr's `tabs`, `agents` and `spaces` | Apache 2.0, in `LICENSE-herdr` |
| `plugin/hooks/ask-hook.sh`, `plugin/hooks/ask-hook.mjs` | Shepherdr commit `9dce4b2`, `mods/chat/ask-hook.sh` | MIT, in `LICENSE-shepherdr` |

## Local changes

- Mod names and asset paths carry the `hws-` prefix.
- `hws-chat/addons.js` turns off voice, reactions, artifacts, task browser, Autopilot, machine sync and usage insights.
- `hws-pane` drops Autopilot and Assistant slots and runs the parked-agent sweep.
- `hws-tabs` adds Tasks and Outputs panel buttons, the Tasks waiting badge, and flipped agents' status on tabs.
- `hws-agents` lists flipped agents, found with `flipped.js`, and sends their rows to the chat pane.
- `hws-spaces` hides local spaces listed in `hws.workspace.spaces` and then heads its list Other spaces.
- `hws-chat` shows the CLI's status lines under the box, in `statusline.js`.
- `hws-chat` reads the macOS clipboard and accepts Finder's copied files, in `clipboard.js` and `attach.js`.
- `hws-chat` finds a Codex session by folder and start time when no process holds its log, in `core/chat-log.js`.
- `hws-chat` labels attached images in the box as `[Image #N]`, in `imagelabels.js`, and keeps mid-message labels in the thread.
- `ask-hook` is rewritten in Node, serves Claude Code only, runs only for a flipped agent, and releases when the chat closes.
