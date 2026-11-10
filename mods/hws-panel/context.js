// Pure helpers for the panel's context sections. They read `hws tidy status`,
// the current note and the manifest, and touch no Herdr API, so tests call them directly.

export const ROLES = ["current", "notes", "artifacts", "scratch", "decisions", "history", "meetings"];

// What a role means when the manifest leaves it out. See docs/CONTRACT.md, Places.
export const ROLE_DEFAULTS = {
  current: "CURRENT.md",
  notes: "Written notes, in the workspace files",
  artifacts: "Sketches and reviews, in the workspace files",
  scratch: "Working files and unsent drafts",
  decisions: "Decision log, in the workspace files",
  history: "Earlier notes and archived docs",
  meetings: "Meeting notes, not set",
};

// Above this many items behind, the dot reads stale.
const STALE_ABOVE = 5;

export const FRESHNESS_COLOR = { fresh: "ansi2", behind: "ansi3", stale: "ansi1", unwritten: "dim" };

export const STAGES = ["discovery", "deciding", "building", "settled"];

// The open columns of a task list, in the order the Tasks line names them.
const TASK_COLUMNS = [
  { key: "todo", label: "to do" },
  { key: "doing", label: "in progress" },
  { key: "waiting", label: "waiting on you" },
];

const SOURCES = [
  { key: "sessions", one: "session" },
  { key: "artifacts", one: "artifact" },
  { key: "commits", one: "commit" },
  { key: "cards", one: "card" },
];

export const NOTE_LINES = 24;
export const BACKLOG_ROWS = 8;

export const agentName = (agent) => agent?.program?.name ?? agent?.app ?? "Agent";

const CITE = /\[(card|session|commit|artifact|file):([^\]\s]+)\]/g;

export function ago(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

// A status without `behind` is the fake's empty answer or an older hws, so it counts as none.
export const validStatus = (status) => (status && typeof status === "object" && status.behind && typeof status.behind === "object" ? status : null);

const behindCount = (status) => SOURCES.reduce((sum, s) => sum + (Number(status?.behind?.[s.key]) || 0), 0);

// Unwritten with no tidy yet. Otherwise fresh at zero, behind up to five and
// stale above. Only what landed counts, so exploring leaves the ring alone.
export function freshness(status) {
  if (!validStatus(status)) return null;
  if (!status.tidiedAt) return "unwritten";
  const count = status.landed ? Number(status.landed.total) || 0 : behindCount(status);
  if (count > STALE_ABOVE) return "stale";
  return count > 0 ? "behind" : "fresh";
}

// Open cards per column. Anything that is not a list counts as none.
export function taskCounts(items) {
  const list = Array.isArray(items) ? items : [];
  return Object.fromEntries(TASK_COLUMNS.map(({ key }) => [key, list.filter((item) => item?.column === key && !item.archived).length]));
}

export function tasksLine(counts) {
  const parts = TASK_COLUMNS.filter(({ key }) => counts?.[key] > 0).map(({ key, label }) => `${counts[key]} ${label}`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing open";
}

// "A", "A and B", "A, B and C".
export function nameList(names) {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// The sketch surface and artifact keep the type `board`, but a person reads `sketch`.
export const typeLabel = (type) => (type === "board" ? "sketch" : (type ?? ""));

export const countsLine = (behind) => SOURCES.map((s) => plural(Number(behind?.[s.key]) || 0, s.one)).join(" · ");

// Splits a line into its words and its cites. The cites become chips after the words.
function splitCites(text) {
  const cites = [...text.matchAll(CITE)].map((m) => ({ kind: m[1], value: m[2] }));
  return { text: text.replace(CITE, "").replace(/\s{2,}/g, " ").trim(), cites };
}

const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const startsTable = (line, next) => line.includes("|") && next.includes("|") && TABLE_RULE.test(next);

// The note as heading, bullet, text and table entries. A table is one entry,
// so the first screen never cuts it in half.
export function noteLines(markdown) {
  const source = (markdown ?? "").split("\n").map((raw) => raw.trimEnd());
  const lines = [];
  for (let i = 0; i < source.length; i++) {
    const line = source[i];
    if (!line.trim()) continue;
    if (startsTable(line, source[i + 1] ?? "")) {
      let last = i + 1;
      while (source[last + 1]?.includes("|")) last++;
      lines.push({ kind: "table", ...splitCites(source.slice(i, last + 1).join("\n")) });
      i = last;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (heading) lines.push({ kind: "heading", level: heading[1].length, ...splitCites(heading[2]) });
    else if (bullet) lines.push({ kind: "bullet", ...splitCites(bullet[1]) });
    else lines.push({ kind: "text", ...splitCites(line) });
  }
  return { lines: lines.slice(0, NOTE_LINES), all: lines, more: Math.max(0, lines.length - NOTE_LINES) };
}

function collapsePath(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function decoded(text) {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

// A Markdown link is relative to the note, unlike a [file:PATH] cite.
// A link to a place inside the note returns null.
export function linkCite(url, notePath) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url)) return { kind: "url", value: url };
  const path = decoded(url.replace(/^file:\/\//i, "").replace(/[?#].*$/, ""));
  if (!path) return null;
  const folder = (notePath ?? "").replace(/\/[^/]*$/, "");
  return { kind: "file", value: collapsePath(path.startsWith("/") ? path : `${folder}/${path}`) };
}

export function citeLabel(cite, workspace) {
  if (cite.kind === "commit") return cite.value.slice(0, 7);
  if (cite.kind === "session") return `session ${cite.value.slice(0, 8)}`;
  if (cite.kind === "card") return `card ${cite.value}`;
  if (cite.kind === "file") return cite.value.split("/").filter(Boolean).pop() ?? cite.value;
  const artifact = workspace?.artifacts?.find((a) => a.id === cite.value);
  return artifact?.title || `artifact ${cite.value}`;
}

const CITE_KINDS = new Set(["card", "session", "commit", "artifact"]);

// One `hws tidy status` item as a row. A session's title is null until it has a first prompt.
// A row has a fixed height, so a title with line breaks would spill over its neighbours.
const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

export function backlogRow(item) {
  const source = String(item?.kind ?? "");
  const id = item?.id ?? null;
  const title = oneLine(item?.title) || (source === "session" && id ? `Session ${String(id).slice(0, 8)}` : String(id ?? source));
  const cite = CITE_KINDS.has(source) && id ? { kind: source, value: String(id) } : null;
  return { source: item?.type === "note" ? "note" : source, title: item?.edited ? `${title} (edited)` : title, at: item?.at ?? null, cite };
}

export function backlog(status) {
  const items = Array.isArray(status?.items) ? status.items : [];
  return items.map(backlogRow);
}

// The live pass, the manifest's `tidy` while its terminal runs.
export const livePass = (status) => (status?.live?.terminal ? status.live : null);

// Newest first, with superseded ones held apart so the section can fold them.
export const isNote = (artifact) => artifact.type === "note";

export const isFeedback = (artifact) => artifact.role === "feedback";

// The files that hold a round's words, most useful first.
export const roundFiles = (round) => [...["review.md", "annotations.md", "comments.md"].map((name) => `${round.path}/${name}`), round.prompt].filter(Boolean);

// Sorts feedback rounds under the artifact each reviews, newest first.
// A round whose page is not tracked, or is gone, stands alone.
export function feedbackRounds(artifacts) {
  const all = artifacts ?? [];
  const pages = new Set(all.filter((a) => !a.role).map((a) => a.id));
  const under = {};
  const loose = [];
  for (const round of all.filter(isFeedback).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))) {
    if (pages.has(round.reviewOf)) (under[round.reviewOf] ??= []).push(round);
    else loose.push(round);
  }
  return { under, loose };
}

export function artifactGroups(artifacts) {
  const sorted = [...(artifacts ?? [])].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return { shown: sorted.filter((a) => a.status !== "superseded"), superseded: sorted.filter((a) => a.status === "superseded") };
}

// One row per role. `path` is what the manifest holds, and `resolved` is where
// the role lands after settings.json and the defaults, from `hws tidy status`.
// `writer` is set only when another tool writes the place, so hws only reads there.
export function placeRows(workspace, status = null) {
  return ROLES.map((role) => {
    const raw = workspace?.places?.[role];
    const path = typeof raw === "string" ? raw : typeof raw?.path === "string" ? raw.path : "";
    const named = (raw && typeof raw === "object" ? raw.writer : null) || status?.writers?.[role] || null;
    const writer = named && named !== "hws" ? named : null;
    return { role, path, writer, resolved: status?.places?.[role] ?? null };
  });
}

export const opensAsPage = (path) => /\.(html?|md|markdown)$/i.test(path);

export const resolvePath = (path, folder) => (path.startsWith("/") ? path : `${(folder ?? "").replace(/\/+$/, "")}/${path}`);

// The sessions a throwaway's record lists, one per terminal that recorded one.
export const recordedSessions = (workspace) => (workspace?.terminals ?? []).filter((x) => x.sessionId);

export const SUGGEST_PROMPT = "Look at this workspace's folder and propose a place map for Herdr Workspaces. The roles are current, notes, artifacts, scratch, decisions, history and meetings. Show me the map first. Once I confirm, record it with `hws set --place ROLE=PATH`, one --place per role.";
