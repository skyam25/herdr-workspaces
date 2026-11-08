---
description: Show the current Herdr workspace
allowed-tools: ["Bash(${CLAUDE_PLUGIN_ROOT}/scripts/workspace-summary.sh:*)"]
disable-model-invocation: true
---

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/workspace-summary.sh"
```

If the output above is one plain sentence, repeat that sentence and stop.

If it is a workspace manifest, show the user a short summary with one line each for the name and kind, folder, instructions, tabs, open surfaces and artifacts. Leave out empty fields. Add nothing else, and run no other commands.
