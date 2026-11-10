// `herdr-app check` renders a mod's first state only. This copies each mod with a later
// state forced on and runs the real check on it, so a bad builder call in a dialog fails.
// Copies live in test/.forced and are removed afterwards.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const forced = `${root}test/.forced`;

const MANIFEST = {
  id: "spc1", name: "checkout demo", kind: "throwaway", folder: "/Users/me/Projects/checkout", instructions: "Ship the demo", spaces: ["spc1"],
  tabs: [{ tabId: "tb1", name: "Plan", role: "plan" }],
  terminals: [{ terminal: "t13", tabId: "tb1", sessionId: null, role: "planner" }],
  surfaces: [{ id: "s1", type: "board", title: "flow", terminal: "t13", pane: "p9" }, { id: "s2", type: "note", title: "", terminal: null, pane: "gone" }],
  artifacts: [{ id: "a1", type: "board", title: "newer", path: "/a", prompt: "/a/prompt.md", fromTerminal: "t13", createdAt: 2000, status: "current" }, { id: "a2", type: "note", title: "", path: "/b", prompt: "/b/prompt.md", fromTerminal: null, status: "current" }],
};
const KEPT = {
  ...MANIFEST, name: "checkout", kind: "app", stage: "deciding", board: { space: "spb", tab: "tbb" },
  places: { current: "docs/NEXT-STEPS.md", decisions: { path: "decisions", writer: "pmos" } },
  artifacts: [{ ...MANIFEST.artifacts[0], status: "draft" }, { ...MANIFEST.artifacts[1], status: "superseded" }, { id: "a3", type: "file", title: "spec", path: "/w/spec.md", createdAt: 1500, status: "current" }],
};
const STATUS = {
  tidiedAt: 1794000000000, stage: "deciding", behind: { sessions: 3, artifacts: 2, commits: 4, cards: 1 },
  items: Array.from({ length: 10 }, (_, i) => ({ kind: ["session", "artifact", "commit", "card"][i % 4], id: `x${i}`, title: i === 0 ? null : `Item ${i} with a title long enough to truncate in a narrow pane`, at: 1794000000000 + i, path: null })),
  live: { terminal: "t12", startedAt: 1794000000000, packet: "/p.json" },
  places: { current: "/w/docs/NEXT-STEPS.md", artifacts: "/w/.herdr-workspace/c/artifacts", scratch: "/w/.herdr-workspace/c/scratch", decisions: "/w/decisions", history: null, meetings: null },
  writers: { current: null, artifacts: null, scratch: null, decisions: "pmos", history: null, meetings: null },
  line: "Current is 3 sessions, 2 artifacts, 4 commits and 1 card behind, last tidied Nov 3",
};
const CONTEXT = {
  workspaceId: "spc1", status: STATUS, statusProblem: null, line: "Current is 3 sessions, 2 artifacts, 4 commits and 1 card behind, last tidied Nov 3", currentPath: "/w/docs/NEXT-STEPS.md",
  current: {
    more: 3,
    lines: [
      { kind: "heading", level: 1, text: "Current", cites: [] },
      { kind: "heading", level: 2, text: "Now", cites: [] },
      { kind: "bullet", text: "Boards open in their own window and notes stay in a pane beside the agent that opened them", cites: [{ kind: "commit", value: "ba7d965" }] },
      { kind: "bullet", text: "Studio is removed", cites: [{ kind: "card", value: "17" }, { kind: "session", value: "abcdef1234" }] },
      { kind: "text", text: "A **plain** line with a [link](spec.html)", cites: [] },
      { kind: "table", text: "| When | What |\n|---|---|\n| Now | Boards |", cites: [{ kind: "commit", value: "ba7d965" }] },
      { kind: "bullet", text: "", cites: [{ kind: "file", value: "docs/panel-options.md" }, { kind: "artifact", value: "a1" }] },
    ],
  },
};
const UNAVAILABLE = { workspaceId: "spc1", status: null, statusProblem: "unknown command tidy", line: "", currentPath: "/w/CURRENT.md", current: null };
const RECORD = { workspaceId: "spc1", scratch: "/state/workspaces/spc1/scratch", scratchExists: true };
const withSession = { ...MANIFEST, terminals: [{ terminal: "t13", tabId: "tb1", sessionId: "aaaabbbbcccc", role: "planner" }], artifacts: [{ ...MANIFEST.artifacts[0], status: "superseded" }, MANIFEST.artifacts[1]] };

const AGENT = { address: "t13", space: "spc1", tab: "tb1", status: "blocked", app: "claude-code", program: { name: "Claude Code" }, focused: true };

function live(source) {
  return source
    .replaceAll("focused()", "__focused()").replaceAll("agents()", "__agents()").replaceAll("panes()", "__panes()").replaceAll("spaces()", "__spaces()")
    .replace("this.manifests = null;", "this.manifests = [__MANIFEST];")
    .replace("refresh(cx) {", "refresh(cx) { return;")
    .replace("watch(dir, cx) {", "watch(dir, cx) { return;");
}

const LIVE_HEADER = `
const __MANIFEST = ${JSON.stringify(MANIFEST)};
const __focused = () => ({ space: "spc1", tab: "tb1", pane: "p1", terminal: "t13", cwd: "/w" });
const __agents = () => [${JSON.stringify(AGENT)}];
const __panes = () => [{ pane: "p1", terminal: "t13", tab: "tb1" }, { pane: "p9", terminal: null, tab: "tb1", mod: "x" }];
const __spaces = () => [{ id: "spc1", machine: null, tabs: [{ id: "tb1", name: "Plan", status: "blocked" }, { id: "tb2", name: "Build", status: null }] }];
`;

// A kept workspace with its context loaded, as `loadContext` leaves it.
const keptPanel = (context, extra = "") => (s) => live(s).replace("this.manifests = [__MANIFEST];", `this.manifests = [${JSON.stringify(KEPT)}];`).replace("this.context = null;", `this.context = ${JSON.stringify(context)};`).replace("this.reading = null;", `this.reading = null; ${extra}`);

function flipWorld(source) {
  return source
    .replaceAll("focused()", "__focused()").replaceAll("agents()", "__agents()").replaceAll("panes()", "__panes()")
    .replaceAll("spaces()", "__spaces()").replaceAll("terminals()", "__terminals()");
}

const FLIP_HEADER = `
const __focused = () => ({ space: "spc1", tab: "tb1", pane: "p9", terminal: null, cwd: "/w" });
const __agents = () => [${JSON.stringify({ ...AGENT, pane: "p1", space_name: "demo", tab_name: "Plan", title: "", seq: 1, pinned: false })}];
const __panes = () => [{ pane: "p1", terminal: "t13", tab: "tb1" }, { pane: "p9", terminal: null, tab: "tb2", mod: "hws-chat", title: "Chat", focused: true }];
const __spaces = () => [{ id: "spc1", name: "demo", active: true, machine: null, tabs: [{ id: "tb1", name: "Plan", index: 1, active: true, status: "blocked" }, { id: "tb2", name: "Build", index: 2, active: false, status: null }] }];
const __terminals = () => [
  { address: "t13", state: "live", labels: {}, status: "blocked" },
  { address: "t22", state: "live", labels: { "herdr.chat": "p9", "herdr.pinned": "1" }, status: "working", program: { name: "Claude Code" }, turn: 2 },
  { address: "t30", state: "live", parent: "t22", labels: {}, status: "done", program: { name: "Claude Code" } },
];
`;

const BOARD_CARD = { id: "a1", title: "Held", notes: "", column: "todo", terminal: null, owner: "unassigned", worktree: true, addedBy: "t13", kind: "todo" };
const TASKS_ANCHOR = "tasksBody(t) {";
const boardState = (extra) => (s) => {
  if (!s.includes(TASKS_ANCHOR)) throw new Error(`hws-work/main.js has no "${TASKS_ANCHOR}" to force a state on`);
  return s.replace(TASKS_ANCHOR, `${TASKS_ANCHOR} this.todos = [${JSON.stringify(BOARD_CARD)}]; this.orchestrator = { terminal: "t13", live: true }; ${extra}`);
};
const OWNER_CARDS = [["m1", "mine", "todo"], ["u1", "unassigned", "todo"], ["r1", "agent", "todo"], ["m2", "mine", "doing"]].map(([id, owner, column]) => ({ id, title: `${owner} card`, notes: "", column, owner, addedBy: "t13", kind: "todo" }));
const DONE_CARDS = [{ id: "d1", title: "Shipped", notes: "", column: "done", owner: "agent", kind: "todo" }, { id: "d2", title: "Also shipped", notes: "", column: "done", owner: "mine", kind: "todo" }];

const LINKED_CARD = { id: "a1", title: "Pick a host", notes: "Brief", note: "Which host?", report: "**Changed** the host\\n\\n- Checked it", column: "waiting", terminal: "t13", addedBy: "t22", owner: "agent", worktree: true, createdAt: 1000, updatedAt: 2000, kind: "todo" };
const LINKED_HEADER = `const __terminals = () => [{ address: "t13", state: "live", status: "working", labels: {} }, { address: "t22", state: "exited", labels: {} }];\n`;
const useLinked = (s) => s.replaceAll("terminals()", "__terminals()");
const linkedDialog = (s) => useLinked(s).replaceAll("props()", "__props()").replace("if (this.id) this.load(cx);", `this.item = ${JSON.stringify(LINKED_CARD)}; this.orchestrator = "t13"; this.column = "waiting"; this.owner = "agent";`);

const SPACE_MENU = { view: "space-menu", space: "spc3", workspace: "spc1", workspaceName: "checkout demo", canLeave: true, overlay: "o" };
const MOVE_SPACE = { view: "move-space", id: "spc2", name: "a space with a name long enough to truncate in the heading", folder: "/w/docs", overlay: "o" };
const DESTINATIONS = [{ id: "w1", name: "docs", kind: "app" }, { id: "w2", name: "a workspace with a name long enough to truncate in its row", kind: "general" }, { id: "w3", name: "scrap", kind: "throwaway" }];
const spaceMenuFile = (menuProps) => ({ "spacemenu.js": { header: `const __props = () => (${JSON.stringify(menuProps)});\n`, patch: (s) => s.replaceAll("props()", "__props()") } });

const VARIANTS = [
  { mod: "hws-work", name: "board-run-allow", props: { view: "tasks" }, patch: boardState('this.todos = [{ id: "r1", title: "Ready", notes: "", column: "todo", owner: "agent", kind: "todo" }, { id: "u1", title: "One", notes: "", column: "todo", owner: "unassigned", kind: "todo" }, { id: "u2", title: "Two", notes: "", column: "todo", owner: "unassigned", kind: "todo" }, { id: "x1", title: "Ended", notes: "", column: "done", terminal: "t99", owner: "agent", session: { tool: "codex", id: "c1", folder: "/w" }, kind: "todo" }];') },
  { mod: "hws-work", name: "board-linked-card", props: { view: "tasks" }, header: LINKED_HEADER, patch: (s) => useLinked(boardState(`this.todos = [${JSON.stringify(LINKED_CARD)}];`)(s)) },
  { mod: "hws-work", name: "todo-dialog-linked", props: { view: "todo", space: "spc1", id: "a1", height: 700 }, files: { "todo.js": { header: `const __props = () => (${JSON.stringify({ view: "todo", space: "spc1", id: "a1", height: 700 })});\n${LINKED_HEADER}`, patch: linkedDialog } } },
  { mod: "hws-work", name: "board-orchestrating", props: { view: "tasks" }, patch: boardState("") },
  { mod: "hws-work", name: "board-stop-confirm", props: { view: "tasks" }, patch: boardState("this.confirmingStop = true;") },
  { mod: "hws-work", name: "board-stopping", props: { view: "tasks" }, patch: boardState('this.orchestratorBusy = "stop";') },
  { mod: "hws-work", name: "board-owner-states", props: { view: "tasks" }, patch: boardState(`this.todos = ${JSON.stringify(OWNER_CARDS)};`) },
  { mod: "hws-work", name: "board-archive-confirm", props: { view: "tasks" }, patch: boardState(`this.todos = ${JSON.stringify(DONE_CARDS)}; this.confirmingArchive = true;`) },
  { mod: "hws-work", name: "board-archiving", props: { view: "tasks" }, patch: boardState(`this.todos = ${JSON.stringify(DONE_CARDS)}; this.archiving = true;`) },
  { mod: "hws-actions", name: "actions-orchestrate", props: { terminal: "t13", space: "spc1", cwd: "/w", overlay: "o" } },
  { mod: "hws-new", name: "menu-orchestrate", props: { overlay: "o" }, header: LIVE_HEADER, patch: (s) => s.replaceAll("focused()", "__focused()").replaceAll("spaces()", '__spaces().map((x) => ({ ...x, active: true, folder: "/w" }))') },
  { mod: "hws-new", name: "form", props: { step: "workspace" } },
  { mod: "hws-new", name: "form-from-space", props: { step: "workspace", space: { id: "spc1", name: "a space with a name long enough to truncate in the dialog's heading", folder: "/Users/me/Projects/checkout" } } },
  { mod: "hws-new", name: "form-problem", props: { step: "workspace" }, patch: (s) => s.replace("this.problem = null;", 'this.problem = "That folder does not exist.";') },
  { mod: "hws-new", name: "find-empty", props: { step: "find" } },
  { mod: "hws-new", name: "find-results", props: { step: "find" }, patch: (s) => s.replace("this.results = null;", `this.results = [{ id: "sp1", name: "throwaway-1c26", closedAt: 1, sessions: [{ title: "Fix login" }], artifacts: [{}] }, { id: "sp2", name: "plain", closedAt: 2, sessions: [], artifacts: [] }];`).replace("this.search(cx);\n      focusField", "focusField") },
  { mod: "hws-new", name: "menu-problem", props: { overlay: "o" }, patch: (s) => s.replace("this.problem = null;", 'this.problem = "hws failed";') },
  { mod: "hws-panel", name: "toggle", props: { overlay: "o" }, patch: (s) => s.replace("cx.spawn(async () => this.toggle());", "") },
  { mod: "hws-panel", name: "decide", props: { view: "decide", name: "scratch", artifacts: MANIFEST.artifacts } },
  { mod: "hws-panel", name: "decide-scratch", props: { view: "decide", name: "scratch", artifacts: [], scratch: "/Users/me/.local/state/hws/workspaces/spc1/scratch" } },
  { mod: "hws-panel", name: "decide-problem", props: { view: "decide", artifacts: [] }, patch: (s) => s.replace("this.problem = null;", 'this.problem = "Trash failed";') },
  { mod: "hws-panel", name: "promote", props: { view: "promote", workspace: "spc1", name: "scratch" } },
  { mod: "hws-panel", name: "promote-problem", props: { view: "promote" }, patch: (s) => s.replace("this.problem = null;", 'this.problem = "Choose a folder.";') },
  { mod: "hws-panel", name: "panel", props: {}, header: LIVE_HEADER, patch: live },
  { mod: "hws-panel", name: "panel-note", props: {}, header: LIVE_HEADER, patch: (s) => live(s).replace("this.note = null;", 'this.note = { text: "Link copied.", isError: false };') },
  { mod: "hws-panel", name: "artifact-menu", props: { view: "artifact-menu", artifact: { id: "a1", type: "board", path: "/a", prompt: "/a/prompt.md" }, overlay: "o" }, files: { "artifactmenu.js": { header: `const __props = () => (${JSON.stringify({ view: "artifact-menu", artifact: { id: "a1", type: "board", path: "/a", prompt: "/a/prompt.md" }, overlay: "o" })});\n`, patch: (s) => s.replaceAll("props()", "__props()") } } },
  { mod: "hws-panel", name: "panel-reader", props: {}, header: LIVE_HEADER, patch: (s) => live(s).replace("this.reading = null;", 'this.reading = { title: "Spec", text: "# Hello", isLoading: false, reveal: "/a/spec.md" };') },
  { mod: "hws-panel", name: "panel-outside", props: {}, header: LIVE_HEADER, patch: (s) => live(s).replace("this.manifests = [__MANIFEST];", "this.manifests = [];") },
  { mod: "hws-panel", name: "panel-outside-match", props: {}, header: LIVE_HEADER, patch: (s) => live(s).replace("this.manifests = [__MANIFEST];", "this.manifests = [];").replace("this.match = null;", 'this.match = { spaceId: "spc1", candidates: [{ id: "w1", name: "checkout", folder: "/w", home: null }, { id: "w2", name: "a workspace with a long name", folder: "/", home: null }] };').replace("this.note = null;", 'this.note = { text: "Could not move the space.", isError: true };') },
  { mod: "hws-panel", name: "panel-problem", props: {}, header: LIVE_HEADER, patch: (s) => live(s).replace("this.problem = null;", 'this.problem = "hws failed";') },
  { mod: "hws-panel", name: "panel-kept", props: {}, header: LIVE_HEADER, patch: keptPanel(CONTEXT, 'this.tasks = { workspaceId: "spc1", counts: { todo: 2, doing: 1, waiting: 1 } };') },
  { mod: "hws-panel", name: "panel-kept-no-board", props: {}, header: LIVE_HEADER, patch: (s) => keptPanel(CONTEXT)(s).replace('"board":{"space":"spb","tab":"tbb"}', '"board":null,"stage":null,"home":"/w/docs/a/folder/deep/enough/to/truncate/in/the/middle"') },
  { mod: "hws-panel", name: "panel-kept-unwritten", props: {}, header: LIVE_HEADER, patch: keptPanel({ ...CONTEXT, status: { ...STATUS, tidiedAt: null, line: "No current note yet" }, line: "No current note yet", current: null }, 'this.tasks = { workspaceId: "spc1", counts: null };') },
  { mod: "hws-panel", name: "panel-kept-open", props: {}, header: LIVE_HEADER, patch: keptPanel(CONTEXT, "this.showSuperseded = true; this.showAllBacklog = true; this.showPlaces = true;"), files: { "sections.js": { header: "", patch: (s) => s.replace("const isDirty = typed !== host.placeSaved[row.role];", "const isDirty = true;") } } },
  { mod: "hws-panel", name: "panel-kept-clear", props: {}, header: LIVE_HEADER, patch: keptPanel(CONTEXT, "this.showPlaces = true;"), files: { "sections.js": { header: "", patch: (s) => s.replace("const typed = host.values[key].trim();", 'const typed = "";').replace("const isDirty = typed !== host.placeSaved[row.role];", "const isDirty = true;") } } },
  { mod: "hws-panel", name: "panel-kept-unavailable", props: {}, header: LIVE_HEADER, patch: keptPanel(UNAVAILABLE) },
  { mod: "hws-panel", name: "panel-kept-loading", props: {}, header: LIVE_HEADER, patch: keptPanel(null) },
  { mod: "hws-panel", name: "panel-record", props: {}, header: LIVE_HEADER, patch: (s) => live(s).replace("this.manifests = [__MANIFEST];", `this.manifests = [${JSON.stringify(withSession)}];`).replace("this.context = null;", `this.context = ${JSON.stringify(RECORD)}; this.showSuperseded = true;`) },
  { mod: "hws-panel", name: "sidebar-fresh", props: { view: "sidebar" }, header: LIVE_HEADER, patch: (s) => s.replace("this.sidebar = startSidebar(cx);", `this.sidebar = { workspaces: [${JSON.stringify(KEPT)}, __MANIFEST], problem: null, folded: new Set(), ahead: {}, fresh: { spc1: { level: "stale", title: "Current is 9 sessions behind" } } };`) },
  { mod: "hws-panel", name: "sidebar-tasks", props: { view: "sidebar" }, header: LIVE_HEADER, patch: (s) => s.replace("this.sidebar = startSidebar(cx);", `this.sidebar = { workspaces: [${JSON.stringify({ ...KEPT, spaces: ["spc1", "spb"] })}], problem: null, folded: new Set(), ahead: {}, fresh: { spc1: { level: "unwritten", title: "No current note yet" } } };`), files: { "sidebar.js": { header: 'const __spaces = () => [{ id: "spc1", name: "api", active: true, status: "idle", tabs: [] }, { id: "spb", name: "Board", active: false, status: null, tabs: [] }];\n', patch: (s) => s.replaceAll("spaces()", "__spaces()") } } },
  { mod: "hws-panel", name: "sidebar", props: { view: "sidebar" }, header: LIVE_HEADER, patch: (s) => s.replace("this.sidebar = startSidebar(cx);", "this.sidebar = { workspaces: [__MANIFEST], problem: null, folded: new Set(), ahead: {}, fresh: {} };") },
  { mod: "hws-panel", name: "add-space", props: { view: "add-space", workspace: "spc1", name: "checkout demo", spaces: ["spc1"] }, header: LIVE_HEADER },
  { mod: "hws-panel", name: "sidebar-archived", props: { view: "sidebar" }, header: LIVE_HEADER, patch: (s) => s.replace("this.sidebar = startSidebar(cx);", `this.sidebar = { workspaces: [__MANIFEST], archived: [${JSON.stringify(KEPT)}], showArchived: true, problem: null, folded: new Set(), ahead: {}, fresh: {} };`) },
  { mod: "hws-panel", name: "stage-menu", props: { view: "stage-menu", workspace: "spc1", overlay: "o" }, files: { "rowmenu.js": { header: `const __props = () => (${JSON.stringify({ view: "stage-menu", workspace: "spc1", overlay: "o" })});\n`, patch: (s) => s.replaceAll("props()", "__props()") } } },
  { mod: "hws-panel", name: "row-menu-kept",props: { view: "row-menu", workspace: "spc1", name: "checkout", kind: "app", archived: false, overlay: "o" }, files: { "rowmenu.js": { header: `const __props = () => (${JSON.stringify({ view: "row-menu", workspace: "spc1", name: "checkout", kind: "app", archived: false, overlay: "o" })});\n`, patch: (s) => s.replaceAll("props()", "__props()") } } },
  { mod: "hws-panel", name: "row-menu-archived", props: { view: "row-menu", workspace: "spc1", name: "checkout", kind: "app", archived: true, overlay: "o" }, files: { "rowmenu.js": { header: `const __props = () => (${JSON.stringify({ view: "row-menu", workspace: "spc1", name: "checkout", kind: "app", archived: true, overlay: "o" })});\n`, patch: (s) => s.replaceAll("props()", "__props()") } } },
  { mod: "hws-panel", name: "space-menu-member", props: SPACE_MENU, patch: (s) => s.replace("initSpaceMenu(this, cx);", 'this.git = "linked";'), files: spaceMenuFile(SPACE_MENU) },
  { mod: "hws-panel", name: "space-menu-plain", props: { view: "space-menu", space: "spc2", overlay: "o" }, patch: (s) => s.replace("initSpaceMenu(this, cx);", "this.git = null;"), files: spaceMenuFile({ view: "space-menu", space: "spc2", overlay: "o" }) },
  { mod: "hws-panel", name: "move-space", props: MOVE_SPACE, patch: (s) => s.replace("initMoveSpace(this, cx);", `this.from = { id: "w0", name: "checkout" }; this.matches = new Set(["w1"]); this.workspaces = ${JSON.stringify(DESTINATIONS)}; this.busy = "move-w2"; this.problem = "herdr is not answering";`), files: spaceMenuFile(MOVE_SPACE) },
  { mod: "hws-panel", name: "move-space-loading", props: MOVE_SPACE, patch: (s) => s.replace("initMoveSpace(this, cx);", "this.from = null; this.matches = new Set(); this.workspaces = null;"), files: spaceMenuFile(MOVE_SPACE) },
  { mod: "hws-panel", name: "rename", props: { view: "rename", workspace: "spc1", name: "checkout" }, files: { "rowmenu.js": { header: `const __props = () => (${JSON.stringify({ view: "rename", workspace: "spc1", name: "checkout" })});\n`, patch: (s) => s.replaceAll("props()", "__props()") } } },
  { mod: "hws-panel", name: "confirm-archive", props: { view: "confirm", action: "archive", workspace: "spc1", name: "checkout", kind: "app" }, files: { "rowmenu.js": { header: `const __props = () => (${JSON.stringify({ view: "confirm", action: "archive", workspace: "spc1", name: "checkout", kind: "app" })});\n`, patch: (s) => s.replaceAll("props()", "__props()") } } },
  { mod: "hws-panel", name: "sidebar-empty", props: { view: "sidebar" }, header: LIVE_HEADER, patch: (s) => s.replace("this.sidebar = startSidebar(cx);", "this.sidebar = { workspaces: [], problem: null };") },
  { mod: "hws-panel", name: "sidebar-problem", props: { view: "sidebar" }, header: LIVE_HEADER, patch: (s) => s.replace("this.sidebar = startSidebar(cx);", 'this.sidebar = { workspaces: null, problem: "hws failed" };') },
  { mod: "hws-tabs", name: "tabs-flipped", props: {}, header: FLIP_HEADER, patch: (s) => flipWorld(s).replace('shared("hws.tasks.waiting")', "3") },
  { mod: "hws-agents", name: "agents-flipped", props: {}, header: FLIP_HEADER, patch: (s) => flipWorld(s).replace("this.folded = new Set();", 'this.folded = new Set(); this.hovered = "t22";') },
  { mod: "hws-agents", name: "agents-rail", props: {}, header: FLIP_HEADER, patch: (s) => flipWorld(s).replace("const narrow = () =>", "const narrow = () => true || ") },
  { mod: "hws-spaces", name: "spaces-hidden", props: {}, header: FLIP_HEADER, patch: (s) => s.replaceAll("spaces()", '[...__spaces(), { id: "spc2", name: "hidden", active: false, machine: null, tabs: [] }, { id: "spc3", name: "other", active: false, machine: null, tabs: [] }]').replace("shared(WORKSPACE_SPACES)", '["spc2"]') },
  { mod: "hws-spaces", name: "spaces-all-hidden-rail", props: {}, header: FLIP_HEADER, patch: (s) => s.replaceAll("spaces()", "__spaces()").replace("shared(WORKSPACE_SPACES)", '["spc1"]').replace("const narrow = () =>", "const narrow = () => true || ") },
  { mod: "hws-work", name: "CONTROL-board-typo", props: { view: "tasks" }, expectFailure: true, patch: (s) => boardState("")(s).replace("rowAction(t, id, text, action, color = null) {\n    return div()", "rowAction(t, id, text, action, color = null) {\n    return div().no_such_builder()") },
  { mod: "hws-new", name: "CONTROL-typo", props: { step: "workspace" }, expectFailure: true, patch: (s) => s.replace('dialogRoot(t, "hws-new-form")', 'dialogRoot(t, "hws-new-form").no_such_builder()') },
];

rmSync(forced, { recursive: true, force: true });
let failed = 0;
for (const v of VARIANTS) {
  const dir = `${forced}/${v.name}`;
  mkdirSync(dir, { recursive: true });
  cpSync(`${root}${v.mod}/mod.json`, `${dir}/mod.json`);
  for (const file of ["hws.js", "sidebar.js", "rowmenu.js", "spacemenu.js", "artifactmenu.js", "context.js", "sections.js", "cites.js", "flipped.js", "board.js", "data.js", "open.js", "todo.js"]) {
    if (existsSync(`${root}${v.mod}/${file}`)) cpSync(`${root}${v.mod}/${file}`, `${dir}/${file}`);
  }
  let source = readFileSync(`${root}${v.mod}/main.js`, "utf8").replaceAll("props()", "__props()");
  if (v.patch) source = v.patch(source);
  writeFileSync(`${dir}/main.js`, `const __props = () => (${JSON.stringify(v.props)});\n${v.header ?? ""}${source}`);
  for (const [file, { header, patch }] of Object.entries(v.files ?? {})) {
    const text = patch(readFileSync(`${root}${v.mod}/${file}`, "utf8"));
    const imports = text.match(/^(?:import [^\n]*\n)+/m)[0];
    writeFileSync(`${dir}/${file}`, text.replace(imports, `${imports}${header}`));
  }
  const r = spawnSync("herdr-app", ["check", dir], { encoding: "utf8" });
  const passed = r.status === 0;
  const ok = v.expectFailure ? !passed : passed;
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${v.name}${v.expectFailure ? " (must fail)" : ""}${ok ? "" : `\n${r.stdout}${r.stderr}`}`);
}
rmSync(forced, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
