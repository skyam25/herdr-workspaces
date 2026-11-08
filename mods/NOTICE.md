# Third-party code

| Mods | Source | License |
|---|---|---|
| `hws-chat`, `hws-chat-models`, `hws-chat-image` | [Shepherdr](https://github.com/eliasstravik/shepherdr) commit `9dce4b2`, mods `chat`, `chat-models`, `chat-image` | MIT, in `LICENSE-shepherdr` |
| `hws-pane` | Shepherdr `pane-chat`, cloned from Herdr's `pane` | MIT and Apache 2.0, in `LICENSE-shepherdr` and `LICENSE-herdr` |

## Local changes

- Mod names and asset paths carry the `hws-` prefix.
- `hws-chat/addons.js` turns off voice, reactions, artifacts, task browser, Autopilot, machine sync and usage insights.
- `hws-pane` drops Autopilot and Assistant slots and runs the parked-agent sweep.
- `hws-chat` shows the CLI's status lines under the box, in `statusline.js`.
- `hws-chat` reads the macOS clipboard and accepts Finder's copied files, in `clipboard.js` and `attach.js`.
