import { relative } from "node:path";

import { hws, parse } from "./hws.mjs";
import { readStdin } from "./stdin.mjs";

// Stdin (1s) and two rounds of 2s hws calls stay under the 6s timeout in hooks.json.
const NAMED_MATCHES = 3;

const TASK_LIST = [
  "This Herdr workspace has a shared task list that the person sees in Tasks.",
  'Read it with `hws todo list --json`, and add follow-up work the person should see with `hws todo add --title="..."`.',
  "A card you add lands unassigned until the person presses Allow. A card marked mine is the person's, so you only read it. You do not take or move cards unless asked.",
  "Run `~/.local/bin/hws` if `hws` is not on PATH.",
].join(" ");

const REVIEW = [
  "To get the person's comments on a page or document you wrote, run `hws review FILE` with an .html or .md file, then end the turn.",
  "It opens beside this agent, and their comments arrive as your next prompt.",
  "Never open it with --standalone, because that pane has no agent to answer.",
  "When the person only wants to read or edit a Markdown file, open it in a note instead.",
].join(" ");

// A plain tab gets no skill hint, so without this an agent falls back to `open`, which sends .md to VS Code.
const NOTE_EDITOR = [
  "To show the person a Markdown file to read or edit, run `hws surface open --type note --file F --terminal $HC_TERMINAL_ID`, then end the turn.",
  "It opens in a Herdr note window, in a workspace or not.",
  "When you want their comments on something you wrote, run `hws review FILE` instead.",
  "Never open the file with `open`, VS Code or another editor.",
].join(" ");

const PASTE = [
  "When the person asks for text to paste somewhere else, such as a message, an email or a post, write it to a Markdown file instead of printing it, and open it with `hws surface open --type note --file F --terminal $HC_TERMINAL_ID`, then end the turn.",
  "In a workspace, put the file in `hws place scratch`.",
  "The note's Copy button copies it as rich text.",
  "When they ask for changes, edit the same file, because the open note reloads it.",
].join(" ");

const OUTPUTS = [
  "When the person asks for a doc, brief, report, spec, page or deck, run `hws output add --title T --path P --status drafting` as you start it, and run it again with `--status ready` when it is done.",
  "Use `--url U` in place of `--path` for a web document. The work then shows under Outputs in Herdr's right panel.",
  "Outputs already lists every document you write as touched, so declare only the deliverable the person asked for.",
  "Never declare code, config or tests.",
].join(" ");

const ASK = [
  "When a request leaves real choices open and the answers would change what you build, run `hws ask` with 1 to 8 questions as JSON on stdin or with `--file`, then end the turn.",
  "Each question is `{id, text, kind, options}`, where kind is `options` for 2 to 4 short choices, `select` for up to 6 or `text` for an open answer.",
  "The answers arrive as your next prompt.",
  "Run `~/.local/bin/hws` if `hws` is not on PATH.",
].join(" ");

const NOTE_RULE = [
  "When the person asks to update the current note or the current state, or to catch up on where this work stands, load the herdr-workspaces:tidy skill before you read or write anything, and follow it.",
  "Never rewrite the current note yourself. Only a tidy pass may, because it records what the note covers.",
].join(" ");

// The pane header shows this address, so the person quotes it across conversations.
// A tab name can't stand in for it, because one tab holds several terminals.
const terminalContext = (terminal) => [
  `This session runs in the Herdr terminal ${terminal}, and the person sees that address in this pane's header.`,
  "When the person names a terminal by an address such as `t7`, or `machine/t7` on another machine, it is a herdr-core address.",
  "Pass it straight to `hc read`, `hc send` or `--terminal`, and run `hc ls` to list every live terminal. A tab name is not an address, because one tab can hold several terminals.",
  "`hc --skill` prints the full hc manual. The older `herdr` command, `HERDR_ENV` and pane ids belong to the Herdr TUI and do not work here.",
].join(" ");

const LISTED_ARTIFACTS = 12;

// `hws current --line` says a workspace has no Tasks in its first line. Instructions follow on later lines.
function hasNoTasks(line) {
  return / has no Tasks, /.test(line.split("\n")[0]);
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

const quoted = (name) => `"${oneLine(name)}"`;

function listNames(names) {
  if (names.length < 3) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// Tells the agent once that this plain space shares a folder with a workspace it is not part of.
function matchContext(match) {
  const candidates = (Array.isArray(match?.candidates) ? match.candidates : []).filter((item) => typeof item?.name === "string" && item.name.trim());
  if (candidates.length === 0) return "";
  const names = candidates.slice(0, NAMED_MATCHES).map((item) => quoted(item.name));
  const more = candidates.length - names.length;
  const owner =
    candidates.length === 1
      ? `This folder belongs to the Herdr workspace ${names[0]}`
      : `This folder belongs to the Herdr workspaces ${listNames(more > 0 ? [...names, `${more} more`] : names)}`;
  return [
    `${owner}, but this space is not part of ${candidates.length === 1 ? "it" : "any of them"}, so ${candidates.length === 1 ? "its" : "their"} instructions and task list do not apply here.`,
    "The person can add this space from the Workspace panel.",
    "Mention this only if the person asks about the workspace, its task list or its notes, and do not act on it yourself.",
  ].join(" ");
}

async function main() {
  const input = JSON.parse(await readStdin());
  const sessionId = input.session_id;
  if (typeof sessionId !== "string" || sessionId === "") return;

  const terminal = process.env.HC_TERMINAL_ID;
  const folder = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();

  // A failed register only loses resume and Outputs, so the session still learns its workspace.
  // The folder tells Outputs where this session's outputs file lives.
  const [, line] = await Promise.all([
    hws(["register", "--terminal", terminal, "--session", sessionId, "--folder", folder, "--json"]),
    hws(["current", "--line"]),
  ]);

  // Places and freshness only exist inside a workspace. Reading them never creates a folder.
  // Outside one, the same round asks which workspace owns this folder. A failed current asks nothing.
  const outside = line === "" && Boolean(terminal);
  const [status, scan, match] = line
    ? [...(await Promise.all([hws(["tidy", "status", "--json"]), hws(["artifact", "scan", "--json"])])).map(parse), null]
    : [null, null, outside ? parse(await hws(["space", "match", "--json"])) : null];
  const freshness = typeof status?.line === "string" ? status.line.trim() : "";
  const workspace = [line, placesSentence(status?.places ?? {}, folder), freshness];

  const kept = Boolean(status?.places?.current);
  const tasks = Boolean(line) && !hasNoTasks(line);
  const context = [workspace.filter(Boolean).join(" "), inHerdrApp() && terminalContext(terminal), kept && NOTE_RULE, kept && artifactsContext(scan), tasks && inHerdrApp() && TASK_LIST, line && inHerdrApp() && REVIEW, inHerdrApp() && NOTE_EDITOR, inHerdrApp() && PASTE, inHerdrApp() && OUTPUTS, inHerdrApp() && ASK, matchContext(match)].filter(Boolean).join("\n\n");
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
