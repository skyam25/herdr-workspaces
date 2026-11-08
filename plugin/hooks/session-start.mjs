import { spawnSync } from "node:child_process";

// These limits sum to 5s, which stays under the 6s timeout in hooks.json.
const STDIN_MS = 1000;
const HWS_MS = 2000;

async function readStdin() {
  const chunks = [];
  const finished = (async () => {
    for await (const chunk of process.stdin) chunks.push(chunk);
  })();

  let timer;
  await Promise.race([finished, new Promise((resolve) => (timer = setTimeout(resolve, STDIN_MS)))]);
  clearTimeout(timer);

  return Buffer.concat(chunks).toString("utf8");
}

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

async function main() {
  const sessionId = JSON.parse(await readStdin()).session_id;
  if (typeof sessionId !== "string" || sessionId === "") return;

  const terminal = process.env.HC_TERMINAL_ID;

  // A failed register only loses resume, so the session still learns its workspace.
  hws(["register", "--terminal", terminal, "--session", sessionId, "--json"]);

  const line = hws(["current", "--line"])?.trim();
  if (!line) return;

  await print(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: line },
    }),
  );
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
