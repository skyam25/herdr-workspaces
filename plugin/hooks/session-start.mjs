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

const NOTE_RULE = [
  "When the person asks to update the current note or the current state, or to catch up on where this work stands, load the herdr-workspaces:tidy skill before you read or write anything, and follow it.",
  "Never rewrite the current note yourself. Only a tidy pass may, because it records what the note covers.",
].join(" ");

const LISTED_ARTIFACTS = 12;

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

const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

// What the workspace tracks, and how much it does not track yet.
function artifactsContext(scan) {
  const live = (scan?.tracked ?? []).filter((item) => item.status !== "superseded");
  const parts = [];
  if (live.length > 0) {
    const rows = live.slice(0, LISTED_ARTIFACTS).map((item) => `- ${oneLine(item.title) || item.id} (${item.type}, id ${item.id}): ${item.path}`);
    const more = live.length - rows.length;
    parts.push(["Artifacts this workspace tracks:", ...rows, ...(more > 0 ? [`- and ${more} more, listed by \`hws artifact scan\``] : [])].join("\n"));
  }
  const untracked = (scan?.candidates?.length ?? 0) + (scan?.more ?? 0);
  if (untracked > 0) parts.push(`${untracked} existing ${untracked === 1 ? "file or link looks" : "files and links look"} like this workspace's work but ${untracked === 1 ? "is" : "are"} not tracked. Run \`hws artifact scan\` before you judge what this workspace holds.`);
  return parts.join("\n\n");
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
  const [status, scan] = line ? (await Promise.all([hws(["tidy", "status", "--json"]), hws(["artifact", "scan", "--json"])])).map(parse) : [null, null];
  const freshness = typeof status?.line === "string" ? status.line.trim() : "";
  const workspace = [line, placesSentence(status?.places ?? {}, folder), freshness];

  const kept = Boolean(status?.places?.current);
  const context = [workspace.filter(Boolean).join(" "), kept && NOTE_RULE, kept && artifactsContext(scan), line && inHerdrApp() && TASK_LIST].filter(Boolean).join("\n\n");
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
