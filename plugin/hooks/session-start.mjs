import { spawnSync } from "node:child_process";

import { readStdin } from "./stdin.mjs";

// With the 1s stdin limit, two calls stay under the 6s timeout in hooks.json.
const HWS_MS = 2000;

const TASK_LIST = [
  "This Herdr workspace or space has a shared task list that the person sees on the Board.",
  'Read it with `hws todo list --json`, and add follow-up work the person should see with `hws todo add --title="..."`.',
  "A card you add lands unassigned until the person presses Allow. A card marked mine is the person's, so you only read it. You do not take or move cards unless asked.",
  "Run `~/.local/bin/hws` if `hws` is not on PATH.",
].join(" ");

// Returns stdout, or null when hws fails or times out.
function hws(args) {
  const run = spawnSync("hws", args, {
    encoding: "utf8",
    timeout: HWS_MS,
    stdio: ["ignore", "pipe", "ignore"],
  });

  return run.error || run.status !== 0 ? null : run.stdout;
}

function print(text) {
  return new Promise((resolve) => process.stdout.write(text, resolve));
}

function inHerdrApp() {
  return process.env.__CFBundleIdentifier === "dev.herdr.app" && Boolean(process.env.HC_TERMINAL_ID);
}

async function main() {
  const sessionId = JSON.parse(await readStdin()).session_id;
  if (typeof sessionId !== "string" || sessionId === "") return;

  const terminal = process.env.HC_TERMINAL_ID;

  // A failed register only loses resume, so the session still learns its workspace.
  hws(["register", "--terminal", terminal, "--session", sessionId, "--json"]);

  const line = hws(["current", "--line"])?.trim();
  const context = [line, inHerdrApp() && TASK_LIST].filter(Boolean).join("\n\n");
  if (!context) return;

  await print(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
    }),
  );
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
