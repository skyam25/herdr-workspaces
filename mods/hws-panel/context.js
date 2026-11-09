// Pure helpers for the panel's context sections. They read `hws tidy status`,
// the current note and the manifest, and touch no Herdr API, so tests call them directly.

export const ROLES = ["current", "artifacts", "scratch", "decisions", "history", "meetings"];

// What a role means when the manifest leaves it out. See docs/CONTRACT.md, Places.
export const ROLE_DEFAULTS = {
  current: "CURRENT.md",
  artifacts: "Boards and notes, in .herdr-workspace/",
  scratch: "Working files, in .herdr-workspace/",
  decisions: "Decision log, in .herdr-workspace/",
  history: "Earlier notes and archived docs, in .herdr-workspace/",
  meetings: "Meeting notes, not set",
};

// Above this many items behind, the dot reads stale.
const STALE_ABOVE = 5;

export const FRESHNESS_COLOR = { fresh: "ansi2", behind: "ansi3", stale: "ansi1" };

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

// Fresh at zero, behind up to five, stale above. Only what landed counts, so exploring leaves the ring alone.
export function freshness(status) {
  if (!validStatus(status)) return null;
  const count = status.landed ? Number(status.landed.total) || 0 : behindCount(status);
  if (count > STALE_ABOVE) return "stale";
  return count > 0 ? "behind" : "fresh";
}

export const countsLine = (behind) => SOURCES.map((s) => plural(Number(behind?.[s.key]) || 0, s.one)).join(" · ");

// Splits a line into its words and its cites. The cites become chips after the words.
function splitCites(text) {
  const cites = [...text.matchAll(CITE)].map((m) => ({ kind: m[1], value: m[2] }));
  return { text: text.replace(CITE, "").replace(/\s{2,}/g, " ").trim(), cites };
}

// The first screen of the current note, as heading, bullet and text lines.
export function noteLines(markdown) {
  const lines = [];
  for (const raw of (markdown ?? "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (heading) lines.push({ kind: "heading", ...splitCites(heading[2]) });
    else if (bullet) lines.push({ kind: "bullet", ...splitCites(bullet[1]) });
    else lines.push({ kind: "text", ...splitCites(line) });
  }
  return { lines: lines.slice(0, NOTE_LINES), all: lines, more: Math.max(0, lines.length - NOTE_LINES) };
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
  return { source, title: item?.edited ? `${title} (edited)` : title, at: item?.at ?? null, cite };
}

export function backlog(status) {
  const items = Array.isArray(status?.items) ? status.items : [];
  return items.map(backlogRow);
}

// The live pass, the manifest's `tidy` while its terminal runs.
export const livePass = (status) => (status?.live?.terminal ? status.live : null);

// Newest first, with superseded ones held apart so the section can fold them.
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

export const SUGGEST_PROMPT = "Look at this workspace's folder and propose a place map for Herdr Workspaces. The roles are current, artifacts, scratch, decisions, history and meetings. Show me the map first. Once I confirm, record it with `hws set --place ROLE=PATH`, one --place per role.";
