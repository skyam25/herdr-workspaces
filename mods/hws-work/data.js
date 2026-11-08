// Pure logic for the Tasks and Outputs panel. Nothing here calls Herdr.

export const POLL_MS = 10000;
export const DONE_SHOWN = 8;

// The board's columns. `drop` marks the ones a to-do can move to.
export const COLUMNS = [
  { key: "todo", name: "To do", color: "idle", drop: true },
  { key: "doing", name: "In progress", color: "working", drop: true },
  { key: "waiting", name: "Waiting on you", color: "blocked", drop: false },
  { key: "done", name: "Done", color: "done", drop: true },
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

// Same format as companion/src/shared/items.ts.
export function parseItems(text) {
  const items = [];
  let current;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const item = /^- \[( |x|X)\] #(\d+)\s*(.*)$/.exec(line);
    if (item) {
      current = { n: Number(item[2]), title: item[3].trim(), done: item[1] !== " ", lines: [] };
      items.push(current);
    } else if (line.trim() !== "" && /^\s+/.test(line) && current) {
      const spoken = /^(Claude|You):\s?(.*)$/.exec(line.trim());
      if (spoken) current.lines.push({ by: spoken[1] === "You" ? "you" : "claude", text: spoken[2].trim() });
    } else if (line.trim() !== "") {
      current = undefined;
    }
  }
  return items;
}

export const awaitsUser = (item) => !item.done && item.lines.at(-1)?.by === "claude";

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

// The active space's Claude agents.
export function roster(lists) {
  const space = lists.spaces.find((s) => s.active);
  if (!space || space.machine) return [];
  return agentsIn(space, lists)
    .filter((x) => isClaude(x.info))
    .map(({ address, tab, chatPane }) => ({ address, tab, chatPane, space: space.id }));
}

// The agents a to-do can be sent to, each named for the Send to list.
export function sendTargets(lists, spaceId) {
  const space = lists.spaces.find((s) => s.id === spaceId);
  if (!space) return [];
  return agentsIn(space, lists).map(({ info, address, tab, chatPane }) => ({
    address,
    name: info.program?.name ?? info.app ?? "Agent",
    tab: space.tabs.find((x) => x.id === tab)?.name ?? "",
    flipped: Boolean(chatPane),
  }));
}

// The newest session reporting exactly this terminal. A restart briefly leaves two.
export function sessionFor(sessions, address) {
  return (sessions ?? [])
    .filter((s) => s.host?.hcTerminal === address)
    .reduce((best, s) => (best === null || (s.lastSeen ?? 0) > (best.lastSeen ?? 0) ? s : best), null);
}

// Sorts items into Tasks columns. Items carry no timestamps, so a higher #n counts as newer.
export function board(bound, docs) {
  const columns = { waiting: [], progress: [], done: [] };
  for (const { agent, session } of bound) {
    for (const item of docs.get(session.sessionId)?.items ?? []) {
      const last = item.lines.filter((l) => l.by === "claude").at(-1)?.text ?? null;
      const card = { n: item.n, title: item.title, agent, name: agentName(session), last };
      (item.done ? columns.done : awaitsUser(item) ? columns.waiting : columns.progress).push(card);
    }
  }
  columns.done.sort((a, b) => b.n - a.n);
  return columns;
}

export const todoItems = (listed) => listed?.items ?? [];

export const notesLine = (notes) => (notes ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";

// Puts the person's to-dos beside the agents' items. To-dos come first in each column.
export function mergeBoard(todos, agentColumns) {
  const mine = (column) => todos.filter((x) => x.column === column).map((x) => ({ ...x, kind: "todo" }));
  return {
    todo: mine("todo"),
    doing: [...mine("doing"), ...agentColumns.progress],
    waiting: [...mine("waiting"), ...agentColumns.waiting],
    done: [...mine("done"), ...agentColumns.done],
  };
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

// Dialog heights in px. The forms draw with these and the board adds them up.
export const FORM = { pad: 18, gap: 12, heading: 20, label: 15, labelGap: 5, input: 34, notes: 96, lines: 170, chip: 26, sendRow: 28, sendGap: 4, note: 48, problem: 16, footerTop: 4, button: 30, frame: 4 };

const MAX_SEND_ROWS = 4;
const labeled = (height) => FORM.gap + FORM.label + FORM.labelGap + height;

// Padding, heading, the error line, the footer and Herdr's frame.
const shellHeight = () => FORM.pad * 2 + FORM.heading + FORM.gap + FORM.problem + FORM.footerTop + FORM.button + FORM.pad + FORM.frame;

// Fits every control and one error line without scrolling. Send to scrolls past four agents.
export function todoDialogHeight({ editing, waiting, targets }) {
  const fields = labeled(FORM.input) + labeled(FORM.notes) + labeled(FORM.chip) + FORM.gap + FORM.chip;
  const rows = Math.min(Math.max(targets, 1), MAX_SEND_ROWS);
  const sendTo = editing ? labeled(rows * FORM.sendRow + (rows - 1) * FORM.sendGap) : 0;
  const reply = waiting ? labeled(FORM.note) + labeled(FORM.input) : 0;
  return shellHeight() + fields + sendTo + reply;
}

export const severalDialogHeight = () => shellHeight() + labeled(FORM.lines);

// True when a session reports tracking on or already has an items file.
export const isTracked = (session, doc) => Boolean(session.trackItems || session.itemsPath || (doc && doc.items !== null));

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
