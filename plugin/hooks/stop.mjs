import { spawnSync } from "node:child_process";

import { readStdin } from "./stdin.mjs";

// With the 1s stdin limit this stays under the 5s timeout in hooks.json.
const HWS_MS = 3000;

async function main() {
  const message = JSON.parse(await readStdin()).last_assistant_message;
  if (typeof message !== "string" || message.trim() === "") return;

  spawnSync("hws", ["todo", "capture", "--terminal", process.env.HC_TERMINAL_ID, `--text=${message}`, "--json"], {
    timeout: HWS_MS,
    stdio: "ignore",
  });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
