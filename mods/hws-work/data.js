// Pure logic for the Tasks view and the Outputs panel. Nothing here calls Herdr.

export const POLL_MS = 10000;
export const DONE_SHOWN = 8;

// The Tasks columns. `drop` marks the ones a card can move to, and `empty` says what lands there.
export const COLUMNS = [
  { key: "todo", name: "To do", color: "idle", drop: true, empty: "Cards nobody has started" },
  { key: "doing", name: "In progress", color: "working", drop: true, empty: "Cards an agent is working on" },
  { key: "waiting", name: "Waiting on you", color: "blocked", drop: false, empty: "Cards that need your answer" },
  { key: "done", name: "Done", color: "done", drop: true, empty: "Cards an agent has finished" },
];

const CHAT_MOD = "hws-chat";
const CHAT_LABEL = "herdr.chat";

const isClaude = (x) => x.app === "claude-code" || x.program?.key === "claude";

export const cleanPath = (p) => (p ?? "").replace(/\/+$/, "");
export const feedbackDir = (session) => `${cleanPath(session.cwd)}/.feedback`;
export const lastTouched = (o) => Math.max(o.declaredAt ?? 0, o.lastWriteAt ?? 0);

const lastFolder = (p) => cleanPath(p).split("/").pop() || p;
const hasScheme = (ref) => /^[a-z][a-z0-9+.-]*:/i.test(ref);

export const fileName = (ref) => ref.split("/").filter(Boolean).pop() ?? ref;
export const agentName = (session) => session.name || session.title || lastFolder(session.cwd);

// Same rules as companion/src/shared/output-file.ts.
export function parseOutputs(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (raw?.version !== 1 || !Array.isArray(raw.outputs)) return [];
  const seen = new Set();
  return raw.outputs.filter((o) => {
    if (typeof o?.ref !== "string" || !o.ref.trim() || !["declared", "detected"].includes(o.tier) || typeof o.kind !== "string" || seen.has(o.ref)) return false;
    seen.add(o.ref);
    return true;
  });
}

export function ago(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

// Every agent in a space. A flipped agent has no pane, so its chat pane locates it.
function agentsIn(space, { agents, panes, terminals }) {
  const byAddress = new Map();
  for (const a of agents) {
    if (a.space === space.id) byAddress.set(a.address, { info: a, address: a.address, tab: a.tab, chatPane: null });
  }
  for (const p of panes) {
    if (p.mod !== CHAT_MOD || !space.tabs.some((x) => x.id === p.tab)) continue;
    const k = terminals.find((x) => x.state === "live" && x.labels?.[CHAT_LABEL] === p.pane);
    if (k) byAddress.set(k.address, { info: k, address: k.address, tab: p.tab, chatPane: p.pane });
  }
  return [...byAddress.values()];
}

// A space, and any others in its workspace.
function sharing(lists, spaceId, members) {
  return lists.spaces.filter((s) => s.id === spaceId || members.includes(s.id));
}

// The Claude agents in the active space and the rest of its workspace.
export function roster(lists, members = []) {
  const active = lists.spaces.find((s) => s.active);
  if (!active || active.machine) return [];
  return sharing(lists, active.id, members).flatMap((space) => agentsIn(space, lists)
    .filter((x) => isClaude(x.info))
    .map(({ address, tab, chatPane }) => ({ address, tab, chatPane, space: space.id })));
}

// The agents a to-do can be sent to, each named for the Send to list.
export function sendTargets(lists, spaceId, members = []) {
  const shared = sharing(lists, spaceId, members);
  return shared.flatMap((space) => agentsIn(space, lists).map(({ info, address, tab, chatPane }) => {
    const tabName = space.tabs.find((x) => x.id === tab)?.name ?? "";
    return {
      address,
      name: info.program?.name ?? info.app ?? "Agent",
      tab: shared.length > 1 ? [space.name, tabName].filter(Boolean).join(" · ") : tabName,
      flipped: Boolean(chatPane),
    };
  }));
}

// The newest session reporting exactly this terminal. A restart briefly leaves two.
export function sessionFor(sessions, address) {
  return (sessions ?? [])
    .filter((s) => s.host?.hcTerminal === address)
    .reduce((best, s) => (best === null || (s.lastSeen ?? 0) > (best.lastSeen ?? 0) ? s : best), null);
}

// Summaries are worked out once per load, because Tasks draws every card on each render.
export const todoItems = (listed) => (listed?.items ?? []).map((item) => ({ ...item, summary: cardSummary(item) }));

function modelName(settings, role) {
  const { tool, model } = settings[role];
  return settings.catalog[tool]?.models.find((x) => x.id === model)?.name ?? model;
}

// What Run will use, as the header shows it.
export const modelsLine = (settings) => `${modelName(settings, "orchestrator")} → ${modelName(settings, "worker")}`;

const hasEnded = (item) => item.column === "done" || item.column === "waiting";
const textLines = (text) => (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

// What a card's face says: the result when there is one, and otherwise the brief's first line.
export function cardSummary(item) {
  const note = textLines(item.note).join(" ");
  if (note) return note;
  const report = hasEnded(item) ? textLines(item.report).join(" ").replace(/[*`#|]/g, "") : "";
  return report || (textLines(item.notes)[0] ?? "");
}

// What the dialog shows first, or null when the card has no result yet.
export function cardStory(item) {
  const note = (item.note ?? "").trim();
  const report = (item.report ?? "").trim();
  const update = hasEnded(item) ? report || note : note || report;
  const replies = (item.replies ?? []).map((r) => `- ${r.question ? `${r.question} ` : ""}**You:** ${r.answer}`);
  const text = [update, ...(replies.length > 0 ? ["**Your replies**", replies.join("\n")] : [])].filter(Boolean).join("\n\n");
  return text ? { label: item.column === "done" ? "What happened" : "Latest update", text } : null;
}

// Sized to the text, so a one-line note leaves no gap and a long report scrolls.
export function storyHeight(text) {
  const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / STORY_CHARS)), 0);
  return Math.max(FORM.note, Math.min(FORM.story, lines * STORY_LINE));
}

// The sessions linked to a card, the one running it first.
export function cardSessions(item) {
  const sessions = item.terminal ? [{ role: "Run by", address: item.terminal }] : [];
  if (item.addedBy && item.addedBy !== item.terminal) sessions.push({ role: "Added by", address: item.addedBy });
  return sessions;
}

const STATUS_WORDS = { working: "Working", blocked: "Needs you", idle: "Idle", done: "Finished" };
export const SESSION_ENDED = "Session ended";
export const SOME_AGENT = "an agent";

// Names a session and says whether it can still be opened. `name` is null when only the address is known.
export function describeSession({ terminals, targets, orchestrator }, address) {
  const record = terminals.find((x) => x.address === address);
  const live = record?.state === "live";
  const worker = record?.labels?.["hws.todo"] ? ["Worker", record.name].filter(Boolean).join(" ") : null;
  return {
    name: address === orchestrator ? "Orchestrator" : worker ?? targets.find((x) => x.address === address)?.name ?? null,
    status: live ? STATUS_WORDS[record.status] ?? "" : SESSION_ENDED,
    live,
  };
}

// True when a card asks for a reply that nothing can deliver. Its terminal has ended and it saved no
// session to reopen, so only a move back to To do frees it.
export function replyEnded(item, live) {
  if (item.archived || item.session || live) return false;
  return item.column === "waiting" || (item.column === "done" && Boolean(item.terminal));
}

export const REPLY_ENDED = "This session has ended and cannot be reopened.";
export const NO_SESSION = "No session runs this card, so it cannot take a reply.";

// The shared map of space id to waiting count, with this board's spaces set to `count`.
// Returns null when nothing changes. A value that is not a map counts as empty.
export function mergeWaiting(current, ids, count) {
  const before = current !== null && typeof current === "object" && !Array.isArray(current) ? current : {};
  if (ids.every((id) => before[id] === count)) return null;
  return { ...before, ...Object.fromEntries(ids.map((id) => [id, count])) };
}

export function cardTimes(item, now) {
  const times = item.createdAt ? [`Added ${ago(now - item.createdAt)}`] : [];
  return item.updatedAt && item.updatedAt !== item.createdAt ? [...times, `Updated ${ago(now - item.updatedAt)}`] : times;
}

// Sorts cards into their columns, keeping list order.
export function todoColumns(todos) {
  return Object.fromEntries(COLUMNS.map(({ key }) => [key, todos.filter((x) => x.column === key)]));
}

export const OWNER_NAMES = { mine: "Mine", unassigned: "Needs your OK", agent: "Ready" };

// The one owner tag a card shows. Outside To do only Mine shows.
export function ownerTag(item) {
  if (item.owner === "mine") return OWNER_NAMES.mine;
  return item.column === "todo" ? OWNER_NAMES[item.owner] ?? null : null;
}

// Where an orchestrator starts: the space's first agent's folder, else the space's folder.
export function orchestratorFolder(lists, spaceId) {
  const space = lists.spaces.find((s) => s.id === spaceId);
  if (!space) return null;
  const first = agentsIn(space, lists)[0]?.info;
  const pane = first ? lists.panes.find((p) => p.pane === first.pane) : undefined;
  return pane?.cwd || first?.foreground?.cwd || first?.cwd || space.folder || null;
}

// Finds a terminal's tab, and its chat pane when it is flipped and has no pane of its own.
export function locateTerminal({ panes, terminals }, address) {
  const own = panes.find((p) => p.terminal === address);
  if (own) return { tab: own.tab, chatPane: null };
  const label = terminals.find((x) => x.address === address && x.state === "live")?.labels?.[CHAT_LABEL];
  const chat = panes.find((p) => p.mod === CHAT_MOD && p.pane === label);
  return chat ? { tab: chat.tab, chatPane: chat.pane } : null;
}

// Dialog heights in px. The forms draw with these and Tasks adds them up.
export const FORM = { pad: 18, gap: 12, heading: 20, label: 15, labelGap: 5, input: 34, notes: 96, lines: 170, chip: 26, sendRow: 28, sendGap: 4, note: 48, story: 360, side: 300, columnGap: 24, problem: 16, footerTop: 4, button: 30, frame: 4, sectionName: 18, rowGap: 8 };

export const MODELS_DIALOG = { width: 520 };
const TODO_DIALOG = { width: 920, height: 820, margin: 40, leastWidth: 560, leastHeight: 480 };
const STORY_CHARS = 90;
const STORY_LINE = 18;
const labeled = (height) => FORM.gap + FORM.label + FORM.labelGap + height;

// Padding, heading, the error line, the footer and Herdr's frame.
const shellHeight = () => FORM.pad * 2 + FORM.heading + FORM.gap + FORM.problem + FORM.footerTop + FORM.button + FORM.pad + FORM.frame;

// As large as Tasks allows, up to a size that still reads comfortably.
export function todoDialogSize({ width, height }) {
  const fit = (room, most, least) => Math.max(least, Math.min(most, room - TODO_DIALOG.margin));
  return { width: fit(width, TODO_DIALOG.width, TODO_DIALOG.leastWidth), height: fit(height, TODO_DIALOG.height, TODO_DIALOG.leastHeight) };
}

// The notes box takes what the left column has left, and a report takes at most half.
export function todoLayout({ height, waiting, story }) {
  const column = height - shellHeight() - labeled(FORM.input) - labeled(0) - (waiting ? labeled(FORM.input) : 0) - (story ? labeled(0) : 0);
  const storyBox = story ? Math.min(storyHeight(story.text), Math.floor(column / 2)) : 0;
  return { story: storyBox, notes: Math.max(FORM.notes, column - storyBox) };
}

export const severalDialogHeight = () => shellHeight() + labeled(FORM.lines);

// The recommended line, then a section per role: name, hint and one row per choice.
const roleSectionHeight = (rows) => FORM.gap + FORM.sectionName + 2 + FORM.label + 2 + rows * FORM.chip + (rows - 1) * FORM.rowGap;
export const modelsDialogHeight = () => shellHeight() + FORM.label + roleSectionHeight(2) + roleSectionHeight(3);

const newestFirst = (list) => [...list].sort((a, b) => lastTouched(b) - lastTouched(a));

// Each agent's outputs, newest agent first and newest output first.
export function outputGroups(bound, docs) {
  const groups = [];
  for (const { agent, session } of bound) {
    const outputs = docs.get(session.sessionId)?.outputs ?? [];
    if (outputs.length === 0) continue;
    groups.push({
      agent,
      session,
      name: agentName(session),
      newest: Math.max(...outputs.map(lastTouched)),
      declared: newestFirst(outputs.filter((o) => o.tier === "declared")),
      touched: newestFirst(outputs.filter((o) => o.tier === "detected")),
    });
  }
  return groups.sort((a, b) => b.newest - a.newest);
}

export const opensAsPage = (ref) => !hasScheme(ref) && /\.(html?|md)$/i.test(ref);

export const outputTarget = (ref, cwd) => (hasScheme(ref) || ref.startsWith("/") ? ref : `${cleanPath(cwd)}/${ref}`);

export function surfaceArgs(agent, file) {
  const args = ["surface", "open", "--type", "page", "--file", file, "--terminal", agent.address];
  return agent.chatPane ? [...args, "--beside-pane", agent.chatPane, "--space", agent.space] : args;
}

export function findNode(tree, id) {
  if (tree?.id === id) return tree;
  for (const child of tree?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}
