import { execFile } from "node:child_process";
import { relative } from "node:path";

import { readStdin } from "./stdin.mjs";

// Stdin (1s) and two rounds of hws calls stay under the 6s timeout in hooks.json.
const HWS_MS = 2000;

const TASK_LIST = [
  "This Herdr workspace has a shared task list that the person sees on the Board.",
  'Read it with `hws todo list --json`, and add follow-up work the person should see with `hws todo add --title="..."`.',
  "A card you add lands unassigned until the person presses Allow. A card marked mine is the person's, so you only read it. You do not take or move cards unless asked.",
  "Run `~/.local/bin/hws` if `hws` is not on PATH.",
].join(" ");

// Resolves to trimmed stdout, or null when hws fails or outlives HWS_MS.
function hws(args) {
  return new Promise((resolve) => {
    execFile("hws", args, { timeout: HWS_MS, killSignal: "SIGKILL" }, (error, stdout) => resolve(error ? null : stdout.trim()));
  });
}

function parse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function print(text) {
  return new Promise((resolve) => process.stdout.write(text, resolve));
}

function inHerdrApp() {
  const platform = process.env.HWS_PLATFORM || process.platform;
  if (platform === "darwin" && process.env.__CFBundleIdentifier !== "dev.herdr.app") return false;
  return Boolean(process.env.HC_TERMINAL_ID);
}

// Shows a path relative to the session folder when it sits inside it.
function show(path, folder, trailing = "") {
  const rel = relative(folder, path);
  const inside = rel !== "" && !rel.startsWith("..");
  return (inside ? rel : path) + trailing;
}

// Builds "Artifacts land in X, drafts in Y, the current note is Z." from the roles that are set.
function placesSentence(places, folder) {
  const [current, artifacts, notes, scratch] = ["current", "artifacts", "notes", "scratch"].map((role) =>
    typeof places[role] === "string" && places[role] ? places[role] : null,
  );

  const clauses = [];
  if (artifacts) clauses.push(`artifacts land in ${show(artifacts, folder, "/")}`);
  if (notes) clauses.push(`${artifacts ? "notes" : "notes land"} in ${show(notes, folder, "/")}`);
  if (scratch) clauses.push(`${artifacts || notes ? "drafts" : "drafts land"} in ${show(scratch, folder, "/")}`);
  if (current) clauses.push(`the current note is ${show(current, folder)}`);
  if (clauses.length === 0) return "";

  const text = clauses.join(", ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

async function main() {
  const input = JSON.parse(await readStdin());
  const sessionId = input.session_id;
  if (typeof sessionId !== "string" || sessionId === "") return;

  const terminal = process.env.HC_TERMINAL_ID;
  const folder = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();

  // A failed register only loses resume, so the session still learns its workspace.
  const [, line] = await Promise.all([
    hws(["register", "--terminal", terminal, "--session", sessionId, "--json"]),
    hws(["current", "--line"]),
  ]);

  // Places and freshness only exist inside a workspace. Reading them never creates a folder.
  const status = line ? parse(await hws(["tidy", "status", "--json"])) : null;
  const freshness = typeof status?.line === "string" ? status.line.trim() : "";
  const workspace = [line, placesSentence(status?.places ?? {}, folder), freshness];

  const context = [workspace.filter(Boolean).join(" "), line && inHerdrApp() && TASK_LIST].filter(Boolean).join("\n\n");
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
