import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { setup, mount, textOf } from "./harness.mjs";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

beforeEach(() => store.clear());

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const CLAUDE = { agent: true, key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: true };
const SPACES = [
  { id: "spc1", name: "alpha", active: true, machine: null, tabs: [
    { id: "tb1", name: "1", index: 1, active: true, status: null },
    { id: "tb2", name: "tb2", index: 2, active: false, status: null },
  ] },
  { id: "spc2", name: "beta", active: false, machine: null, tabs: [{ id: "tb3", name: "1", index: 1, active: true, status: null }] },
];

const listed = (address, tab, space, extra = {}) => ({
  address, pane: `p-${address}`, space, space_name: space === "spc1" ? "alpha" : "beta", tab, tab_index: 1, tab_name: "1",
  status: "working", app: "claude-code", program: CLAUDE, title: "", seq: 1, pinned: false, focused: false, ...extra,
});
const paneOf = (a) => ({ pane: a.pane, terminal: a.address, tab: a.tab, program: a.program, status: a.status, focused: a.focused });
const chatPane = (pane, tab) => ({ pane, terminal: null, tab, mod: "hws-chat", title: "Chat", focused: false });
const flippedTerminal = (address, pane, extra = {}) => ({
  address, state: "live", labels: { "herdr.chat": pane, ...(extra.labels ?? {}) }, status: "working", program: CLAUDE, title: "t", turn: 3,
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "labels")),
});

const nodeOf = (el) => el?.node ?? el;

function nodes(el, out = []) {
  const n = nodeOf(el);
  if (typeof n !== "object" || n === null) return out;
  out.push(n);
  for (const c of n.children ?? []) nodes(c, out);
  return out;
}

const byId = (view, id) => nodes(view.render()).find((n) => n.id === id) ?? null;

function shell(overrides = {}) {
  return setup({
    spaces: SPACES,
    machines: [{ name: null, layout: "ready" }],
    focused: { space: "spc1", tab: "tb1", pane: "p-t1", terminal: "t1", shown: null, agent: null, cwd: "/w" },
    agents: [],
    panes: [],
    terminals: [],
    ...overrides,
  });
}

// Five agents with panes and two flipped ones, as `hc ls` reports seven.
function sevenAgents() {
  const regular = [listed("t1", "tb1", "spc1"), listed("t2", "tb1", "spc1"), listed("t3", "tb2", "spc1"), listed("t4", "tb3", "spc2"), listed("t5", "tb3", "spc2")];
  return {
    agents: regular,
    panes: [...regular.map(paneOf), chatPane("pc1", "tb1"), chatPane("pc2", "tb3")],
    terminals: [
      ...regular.map((a) => ({ address: a.address, state: "live", labels: {}, status: "working", program: CLAUDE })),
      flippedTerminal("t8", "pc1"),
      flippedTerminal("t9", "pc2", { status: "blocked" }),
    ],
  };
}

const agentIds = (view) => nodes(view.render()).map((n) => n.id).filter((id) => /^ag-t/.test(id ?? ""));

test("the agents list holds flipped agents, so hc ls and the sidebar agree", async () => {
  shell(sevenAgents());
  const view = await mount("hws-agents");
  assert.deepEqual(agentIds(view).sort(), ["ag-t1", "ag-t2", "ag-t3", "ag-t4", "ag-t5", "ag-t8", "ag-t9"]);
});

test("a flipped agent sits with its tab and the grouped view keeps its neighbours", async () => {
  const H = shell({ ...sevenAgents(), sharedValues: { "agents.sort": "grouped" } });
  const view = await mount("hws-agents");
  const ids = nodes(view.render()).map((n) => n.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "element ids are unique");
  assert.deepEqual(ids.filter((id) => /^sp-/.test(id)), ["sp-spc1", "sp-spc2"]);
  assert.deepEqual(H.agentOrder, ["t1", "t2", "t3", "t4", "t5"], "agent.next follows agents with a pane only");
});

test("a flipped agent's shape matches agents()", async () => {
  shell({
    agents: [],
    panes: [chatPane("pc1", "tb2")],
    terminals: [flippedTerminal("t8", "pc1", { labels: { "herdr.pinned": "1" }, report: { app: "claude-code" }, status_ms: 99 })],
    focused: { space: "spc1", tab: "tb2", pane: "pc1", terminal: null, shown: null, agent: null, cwd: null },
  });
  const { Flipped } = await import("../hws-agents/flipped.js");
  const H = globalThis.__herdr;
  const [flip] = new Flipped().list(H.panes, H.terminals, H.spaces, H.focused);
  assert.equal(flip.address, "t8");
  assert.equal(flip.pane, "pc1");
  assert.equal(flip.space, "spc1");
  assert.equal(flip.space_name, "alpha");
  assert.equal(flip.tab, "tb2");
  assert.equal(flip.tab_index, 2);
  assert.equal(flip.status, "working");
  assert.equal(flip.app, "claude-code");
  assert.equal(flip.program, CLAUDE);
  assert.equal(flip.seq, 99);
  assert.equal(flip.pinned, true);
  assert.equal(flip.focused, true);
});

test("the flipped rule needs a live terminal with no pane of its own", async () => {
  const { Flipped } = await import("../hws-agents/flipped.js");
  const panes = [chatPane("pc1", "tb1"), chatPane("pc2", "tb1"), chatPane("pc3", "tb1"), { pane: "p7", terminal: "t7", tab: "tb1" }];
  const terminals = [
    flippedTerminal("t1", "pc1", { state: "exited" }),
    flippedTerminal("t7", "pc2"),
    flippedTerminal("t9", ""),
  ];
  assert.deepEqual(new Flipped().list(panes, terminals, SPACES, null), []);
});

test("a remote terminal's label names the pane without its machine", async () => {
  const { Flipped } = await import("../hws-agents/flipped.js");
  const spaces = [{ id: "vps/spc9", name: "remote", machine: "vps", tabs: [{ id: "vps/tb9", name: "1", index: 1 }] }];
  const panes = [chatPane("vps/p3", "vps/tb9")];
  const [flip] = new Flipped().list(panes, [flippedTerminal("vps/t4", "p3")], spaces, null);
  assert.equal(flip.address, "vps/t4");
  assert.equal(flip.pane, "vps/p3");
});

test("clicking a flipped row selects its tab and focuses the chat pane", async () => {
  const H = shell(sevenAgents());
  const view = await mount("hws-agents");
  await view.click("ag-t8");
  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb1" } }, { name: "pane.focus", args: { pane: "pc1" } }]);
});

test("a flipped row in another space selects the space first", async () => {
  const H = shell(sevenAgents());
  const view = await mount("hws-agents");
  await view.click("ag-t9");
  assert.deepEqual(H.runs, [
    { name: "space.select", args: { id: "spc2" } },
    { name: "tab.select", args: { id: "tb3" } },
    { name: "pane.focus", args: { pane: "pc2" } },
  ]);
});

test("a normal row still focuses its pane", async () => {
  const H = shell(sevenAgents());
  const view = await mount("hws-agents");
  await view.click("ag-t2");
  assert.deepEqual(H.runs, [{ name: "pane.focus", args: { pane: "p-t2" } }]);
});

test("the sidebar rail clicks through to a flipped agent's chat", async () => {
  const H = shell({ ...sevenAgents(), layout: { id: "root", children: [{ id: "sidebar", size: { px: 44 } }] } });
  const view = await mount("hws-agents");
  await view.click("ag-t8");
  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb1" } }, { name: "pane.focus", args: { pane: "pc1" } }]);
});

test("pinning a flipped row targets its terminal and the label drives the row", async () => {
  const H = shell(sevenAgents());
  const view = await mount("hws-agents");
  view.view.hovered = "t8";
  await view.click("pin-t8");
  assert.deepEqual(H.runs, [{ name: "terminal.pin", args: { terminal: "t8", pinned: true } }]);

  H.terminals = H.terminals.map((t) => (t.address === "t8" ? { ...t, labels: { ...t.labels, "herdr.pinned": "1" } } : t));
  assert.equal(byId(view, "pinned") !== null, true, "the pinned group appears");
});

test("sub-agent rows peek, and a flipped sub-agent goes to its chat", async () => {
  const world = sevenAgents();
  const H = shell({
    ...world,
    terminals: [
      ...world.terminals,
      { address: "t20", state: "live", parent: "t8", labels: {}, status: "working", program: CLAUDE },
      flippedTerminal("t21", "pc1", { parent: "t1" }),
    ],
    panes: world.panes,
  });
  const view = await mount("hws-agents");
  assert.equal(view.has("sub-t20"), true, "a flipped agent keeps its sub-agent tree");

  await view.click("sub-t20");
  assert.deepEqual(H.runs, [{ name: "terminal.peek", args: { terminal: "t20" } }]);

  H.runs.length = 0;
  H.terminals = H.terminals.filter((t) => t.address !== "t8");
  const flippedKid = byId(view, "sub-t21");
  assert.ok(flippedKid);
  flippedKid.handlers.on_click({}, view.cx);
  await view.settle();
  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb1" } }, { name: "pane.focus", args: { pane: "pc1" } }]);
});

const titledPane = (a, title) => ({ ...paneOf(a), title });
const rowIds = (view, address) => nodes(byId(view, `ag-${address}`)).map((n) => n.id).filter(Boolean);

test("a priority row leads with its title and names its space after it, dim", async () => {
  const a1 = listed("t1", "tb1", "spc1"), a4 = listed("t4", "tb3", "spc2");
  shell({ agents: [a1, a4], panes: [titledPane(a1, "✳ Fix login"), titledPane(a4, "Pick a host")] });
  const view = await mount("hws-agents");
  assert.equal(textOf(byId(view, "title-t1")), "Fix login");
  assert.equal(textOf(byId(view, "where-t1")), "· alpha");
  assert.equal(byId(view, "where-t1").text_color, "color:dim");
  assert.ok(rowIds(view, "t1").indexOf("title-t1") < rowIds(view, "t1").indexOf("where-t1"));
  assert.equal(textOf(byId(view, "title-t4")), "Pick a host");
});

test("a priority row leaves out the space when every agent is in one", async () => {
  const a1 = listed("t1", "tb1", "spc1"), a3 = listed("t3", "tb2", "spc1");
  shell({ agents: [a1, a3], panes: [titledPane(a1, "Fix login"), titledPane(a3, "Pick a host")] });
  const view = await mount("hws-agents");
  assert.equal(textOf(byId(view, "title-t1")), "Fix login");
  assert.equal(byId(view, "where-t1"), null);
  assert.equal(byId(view, "where-t3"), null);
});

test("a grouped row names no space, because its header does", async () => {
  const a1 = listed("t1", "tb1", "spc1"), a4 = listed("t4", "tb3", "spc2");
  shell({ agents: [a1, a4], panes: [titledPane(a1, "Fix login"), titledPane(a4, "Pick a host")], sharedValues: { "agents.sort": "grouped" } });
  const view = await mount("hws-agents");
  assert.equal(textOf(byId(view, "title-t1")), "Fix login");
  assert.equal(byId(view, "where-t1"), null);
});

test("a row with only a tab number reads its program's name", async () => {
  const a1 = listed("t1", "tb1", "spc1"), a4 = listed("t4", "tb3", "spc2");
  shell({ agents: [a1, a4], panes: [a1, a4].map(paneOf) });
  const view = await mount("hws-agents");
  assert.equal(textOf(byId(view, "title-t1")), "Claude Code");
  assert.equal(textOf(byId(view, "where-t1")), "· alpha");
});

test("the sort menu reopens this mod", async () => {
  const H = shell(sevenAgents());
  const view = await mount("hws-agents");
  await view.click("ag-sort");
  assert.equal(H.overlays[0].mod, "hws-agents");
});

test("an error reads as blocked, and done turns idle once someone looks", async () => {
  const { Flipped } = await import("../hws-agents/flipped.js");
  const panes = [chatPane("pc1", "tb1")];
  const focusChat = { pane: "pc1" };
  const elsewhere = { pane: "p-t1" };
  const statusIs = (flipped, terminal, focus) => flipped.list(panes, [terminal], SPACES, focus)[0].status;

  assert.equal(statusIs(new Flipped(), flippedTerminal("t8", "pc1", { status: "error" }), elsewhere), "blocked");
  assert.equal(statusIs(new Flipped(), flippedTerminal("t8", "pc1", { status: { state: "working", app: "codex" } }), elsewhere), "working");

  const flipped = new Flipped();
  assert.equal(statusIs(flipped, flippedTerminal("t8", "pc1", { status: "done", turn: 4 }), elsewhere), "done");
  assert.equal(statusIs(flipped, flippedTerminal("t8", "pc1", { status: "done", turn: 4 }), focusChat), "idle");
  assert.equal(statusIs(flipped, flippedTerminal("t8", "pc1", { status: "done", turn: 4 }), elsewhere), "idle", "the look sticks after leaving");
  assert.equal(statusIs(flipped, flippedTerminal("t8", "pc1", { status: "done", turn: 5 }), elsewhere), "done", "a new turn is news");

  assert.equal(statusIs(new Flipped(), flippedTerminal("t8", "pc1", { status: "done", turn: 4, labels: { "herdr.seen": "4" } }), elsewhere), "idle");
});

const tabWorld = (overrides = {}) => shell({
  panes: [chatPane("pc1", "tb2")],
  terminals: [flippedTerminal("t8", "pc1")],
  layout: { id: "root", children: [{ id: "panel", hidden: true }, { id: "panel-body", active: "files" }] },
  ...overrides,
});

const inTab = (view, tab) => nodes(byId(view, `tab-${tab}`));

test("a tab holding a flipped agent shows its title, icon and status", async () => {
  tabWorld({ terminals: [flippedTerminal("t8", "pc1", { title: "✳ Fix login" })] });
  const view = await mount("hws-tabs");
  const tab = inTab(view, "tb2");
  assert.match(textOf(byId(view, "tab-tb2")), /^Fix login\b/);
  assert.ok(tab.some((n) => n.kind === "svg" && n.src === "icons/claude.svg"), "the agent's icon");
  assert.ok(tab.some((n) => n.kind === "svg" && n.src === "mods/workspace-chrome/spinner.svg"), "a working spinner");
});

test("a tab shows the most urgent of its flipped agent and its own status", async () => {
  const spaces = [{ ...SPACES[0], tabs: [{ ...SPACES[0].tabs[0] }, { ...SPACES[0].tabs[1], status: "working" }] }, SPACES[1]];
  tabWorld({ spaces, terminals: [flippedTerminal("t8", "pc1", { status: "blocked" })] });
  const view = await mount("hws-tabs");
  const tab = inTab(view, "tb2");
  assert.equal(tab.some((n) => n.kind === "svg" && n.src === "mods/workspace-chrome/spinner.svg"), false, "blocked wins over working");
  assert.ok(tab.some((n) => n.kind === "div" && n.children.length === 0), "the status dot");
});

test("tabs named after their program read each agent's own title, and a person's name stays", async () => {
  const tab = (id, name, named, index) => ({ id, name, named, index, active: index === 1, status: null });
  const agentPane = (tabId, title) => ({ pane: `p-${tabId}`, terminal: `t-${tabId}`, tab: tabId, program: CLAUDE, status: "idle", focused: false, title });
  tabWorld({
    spaces: [{ ...SPACES[0], tabs: [tab("tc1", "Claude Code", true, 1), tab("tc2", "Claude Code", true, 2), tab("tc3", "Review", true, 3), tab("tc4", "4", false, 4), tab("tc5", "Claude Code", true, 5)] }],
    panes: [agentPane("tc1", "✳ Fix login"), agentPane("tc2", "Pick a host"), agentPane("tc3", "Write docs"), agentPane("tc4", "Tidy notes"), agentPane("tc5", "Claude Code")],
    terminals: [],
  });
  const view = await mount("hws-tabs");
  const label = (id) => textOf(byId(view, `tab-${id}`)).split(" | ")[0];
  assert.deepEqual(["tc1", "tc2", "tc3", "tc4", "tc5"].map(label), ["Fix login", "Pick a host", "Review", "Tidy notes", "Claude Code"]);
});

test("the two tabtitle.js copies are identical", () => {
  assert.equal(read("hws-tabs/tabtitle.js"), read("hws-agents/tabtitle.js"));
});

test("the Tasks badge shows the active space's count, only above zero", async () => {
  tabWorld({ sharedValues: { "hws.tasks.waiting": { spc1: 3, spc2: 5 } } });
  const shown = await mount("hws-tabs");
  assert.equal(shown.has("panel-tasks-badge"), true);
  assert.equal(textOf(byId(shown, "panel-tasks-badge")), "3");

  const H = globalThis.__herdr;
  H.spaces = [{ ...SPACES[0], active: false }, { ...SPACES[1], active: true }];
  assert.equal(textOf(byId(shown, "panel-tasks-badge")), "5", "the badge follows the space on screen");

  for (const value of [{ spc1: 0 }, { spc2: 4 }, {}, 3, [3], "3", null, undefined]) {
    tabWorld({ sharedValues: { "hws.tasks.waiting": value } });
    assert.equal((await mount("hws-tabs")).has("panel-tasks-badge"), false, JSON.stringify(value));
  }
});

test("the buttons read Tasks, Workspace, a divider, then Outputs, Files, Changes, with Tasks and Outputs even when panels are restricted", async () => {
  tabWorld();
  const view = await mount("hws-tabs");
  const order = nodes(view.render()).map((n) => n.id).filter((id) => /^panel-[a-z]+$/.test(id ?? "") || id === "bar-divider");
  assert.deepEqual(order, ["panel-tasks", "panel-workspace", "bar-divider", "panel-outputs", "panel-files", "panel-changes"]);
  assert.equal(byId(view, "bar-divider").bg, "color:border");

  tabWorld({ sharedValues: { "workspace.panels": ["files"] } });
  const limited = await mount("hws-tabs");
  assert.equal(limited.has("panel-files"), true);
  assert.equal(limited.has("panel-changes"), false);
  assert.equal(limited.has("panel-tasks"), true);
  assert.equal(limited.has("panel-outputs"), true);
});

test("the Workspace button toggles the panel and lights when it is open in this tab", async () => {
  const H = tabWorld();
  const view = await mount("hws-tabs");
  await view.click("panel-workspace");
  assert.deepEqual(H.runs.at(-1), { name: "mod.open", args: { name: "hws-panel" } });
  const lit = (panes) => {
    tabWorld({ panes });
    return mount("hws-tabs").then((v) => byId(v, "panel-workspace").bg);
  };
  const open = await lit([{ pane: "p9", terminal: null, mod: "hws-panel", tab: "tb1" }]);
  const elsewhere = await lit([{ pane: "p9", terminal: null, mod: "hws-panel", tab: "tb2" }]);
  assert.notEqual(open, elsewhere);
});

test("a panel button selects its stack child and shows the panel, then hides it", async () => {
  const H = tabWorld();
  const view = await mount("hws-tabs");
  await view.click("panel-outputs");
  assert.deepEqual(H.runs.slice(-2), [{ name: "layout.select", args: { stack: "panel-body", child: "outputs" } }, { name: "layout.show", args: { id: "panel" } }]);

  H.layout = { id: "root", children: [{ id: "panel", hidden: false }, { id: "panel-body", active: "outputs" }] };
  await view.click("panel-outputs");
  assert.deepEqual(H.runs.at(-1), { name: "layout.hide", args: { id: "panel" } });
});

const BOARD_TAB = { id: "tb9", name: "Board", index: 3, status: null };
const boardPane = (tab = "tb9") => ({ pane: `pb-${tab}`, terminal: null, tab, mod: "hws-work", title: "Work", focused: false });
const spacesOn = (active, tabs = [...SPACES[0].tabs, BOARD_TAB]) => [{ ...SPACES[0], tabs: tabs.map((c) => ({ ...c, active: c.id === active })) }, SPACES[1]];
const boardWorld = (active, overrides = {}) => tabWorld({ spaces: spacesOn(active), panes: [boardPane()], terminals: [], ...overrides });
const selected = (view) => byId(view, "panel-tasks").bg === "color:selected";

test("Tasks in a plain space opens nothing and says Tasks needs a workspace", async () => {
  const H = tabWorld();
  H.notices = [];
  const view = await mount("hws-tabs");
  assert.equal(selected(view), false);
  await view.click("panel-tasks");
  assert.deepEqual(H.runs, []);
  assert.deepEqual(H.notices.at(-1), { title: "Tasks needs a workspace", body: "Add this space to a workspace to use Tasks." });
});

test("Tasks in a workspace shows its Board space and adds no tab", async () => {
  const H = tabWorld();
  H.hws["board open"] = { workspace: "spc1", space: "spb", tab: "tbb" };
  const view = await mount("hws-tabs");
  await view.click("panel-tasks");
  assert.deepEqual(H.runs, [{ name: "space.select", args: { id: "spb" } }, { name: "tab.select", args: { id: "tbb" } }]);
});

test("Tasks in a workspace with no Board adds nothing and says where to add one", async () => {
  const H = tabWorld();
  H.hws["board open"] = { workspace: "spc1", space: null, tab: null };
  H.notices = [];
  const view = await mount("hws-tabs");
  await view.click("panel-tasks");
  assert.deepEqual(H.runs, []);
  assert.deepEqual(H.notices.at(-1), { title: "This workspace has no tasks", body: "Choose Add tasks under the workspace in the sidebar." });
});

test("the tab bar hides a workspace's Board tab and keeps agents beside it", async () => {
  const hidden = { id: "tbb", name: "Workspace board", index: 1, status: null };
  const agent = { id: "tba", name: "Worker", index: 2, status: null };
  tabWorld({ spaces: [{ ...SPACES[0], tabs: [{ ...hidden, active: true }, agent] }], panes: [boardPane("tbb")], terminals: [], sharedValues: { "hws.board.tabs": ["tbb"] } });
  const view = await mount("hws-tabs");
  assert.equal(byId(view, "tab-tbb"), null);
  assert.match(textOf(byId(view, "tab-tba")), /Worker/);
  assert.equal(selected(view), true);
});

test("the tab bar keeps a person's tab that only shares the Board's name", async () => {
  const named = { id: "tbx", name: "Workspace board", index: 1, status: null };
  tabWorld({ spaces: [{ ...SPACES[0], tabs: [{ ...named, active: true }] }], panes: [], terminals: [], sharedValues: { "hws.board.tabs": ["tbb"] } });
  const view = await mount("hws-tabs");
  assert.match(textOf(byId(view, "tab-tbx")), /Workspace board/);
});

test("Tasks on a workspace's Board returns to the space it came from", async () => {
  const H = tabWorld();
  H.hws["board open"] = { workspace: "spc1", space: "spb", tab: "tbb" };
  const view = await mount("hws-tabs");
  await view.click("panel-tasks");
  H.runs.length = 0;
  H.spaces = [{ ...SPACES[0], active: false }, { id: "spb", name: "Board", active: true, machine: null, tabs: [{ id: "tbb", name: "Workspace board", index: 1, active: true, status: null }] }];
  H.panes = [boardPane("tbb")];
  await view.click("panel-tasks");
  assert.deepEqual(H.runs, [{ name: "space.select", args: { id: "spc1" } }]);
});

test("a Board in another space does not count", async () => {
  const H = tabWorld({ panes: [boardPane("tb3")] });
  const view = await mount("hws-tabs");
  await view.click("panel-tasks");
  assert.deepEqual(H.runs, []);
});

test("Tasks selects an inactive Board tab", async () => {
  const H = boardWorld("tb1");
  const view = await mount("hws-tabs");
  assert.equal(selected(view), false);
  await view.click("panel-tasks");
  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb9" } }]);
});

test("Tasks on the active Board returns to the tab shown before it", async () => {
  const H = boardWorld("tb2");
  const view = await mount("hws-tabs");
  view.render();

  H.spaces = spacesOn("tb9");
  assert.equal(selected(view), true);
  await view.click("panel-tasks");
  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb2" } }]);
});

test("each space remembers its own tab before the Board", async () => {
  const H = boardWorld("tb2");
  const view = await mount("hws-tabs");
  view.render();

  const [first, second] = spacesOn("tb2");
  H.spaces = [{ ...first, active: false }, { ...second, active: true }];
  view.render();

  H.spaces = spacesOn("tb9");
  await view.click("panel-tasks");
  assert.deepEqual(H.runs.at(-1), { name: "tab.select", args: { id: "tb2" } });
});

test("when the earlier tab is gone, Tasks selects the first other tab", async () => {
  const H = boardWorld("tb2");
  const view = await mount("hws-tabs");
  view.render();

  H.spaces = spacesOn("tb9", [SPACES[0].tabs[0], BOARD_TAB]);
  await view.click("panel-tasks");
  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb1" } }]);
});

test("a Board that is the space's only tab stays put", async () => {
  const H = boardWorld("tb9", { spaces: spacesOn("tb9", [BOARD_TAB]) });
  const view = await mount("hws-tabs");
  await view.click("panel-tasks");
  assert.deepEqual(H.runs, []);
});

test("a Board tab reads its name, not an agent's, and Tasks when unnamed", async () => {
  const agent = paneOf(listed("t1", "tb9", "spc1"));
  boardWorld("tb1", { panes: [boardPane(), agent] });
  const view = await mount("hws-tabs");
  const tab = inTab(view, "tb9");
  assert.equal(tab.some((n) => n.kind === "svg" && n.src === CLAUDE.icon), false);
  assert.equal(textOf(byId(view, "tab-tb9")).includes("Claude Code"), false);
  assert.match(textOf(byId(view, "tab-tb9")), /Board/);

  const unnamed = { ...BOARD_TAB, name: "tb9" };
  boardWorld("tb1", { spaces: spacesOn("tb1", [...SPACES[0].tabs, unnamed]), panes: [boardPane(), agent] });
  const cleared = await mount("hws-tabs");
  assert.match(textOf(byId(cleared, "tab-tb9")), /Tasks/);
});

test("an old saved tasks choice reads as none", async () => {
  store.set("panels", JSON.stringify({ spc1: "tasks" }));
  const H = tabWorld();
  const view = await mount("hws-tabs");
  view.render();
  assert.deepEqual(H.runs, []);
  assert.equal(JSON.parse(store.get("panels")).spc1, null);
});

test("switching to a space saved on tasks closes the panel and selects nothing", async () => {
  store.set("panels", JSON.stringify({ spc1: "files", spc2: "tasks" }));
  const H = tabWorld({ layout: { id: "root", children: [{ id: "panel", hidden: false }, { id: "panel-body", active: "files" }] }, sharedValues: { "workspace.panels": ["files", "tasks"] } });
  const view = await mount("hws-tabs");
  view.render();
  assert.deepEqual(H.runs, []);

  H.spaces = [{ ...SPACES[0], active: false }, { ...SPACES[1], active: true }];
  view.render();
  assert.deepEqual(H.runs, [{ name: "layout.hide", args: { id: "panel" } }]);
});

// hws-spaces

const WORKSPACE_SPACES = "hws.workspace.spaces";
const space = (id, name, extra = {}) => ({ id, name, active: false, machine: null, folder: `/w/${name}`, status: null, tabs: [{ id: `tb-${id}`, name: "1", index: 1, active: true, status: null }], ...extra });
const THREE = [space("spc1", "alpha"), space("spc2", "beta"), space("spc3", "gamma", { active: true })];
const spaceWorld = (overrides = {}) => shell({ spaces: THREE, panes: [], sharedValues: {}, sharedSets: [], ...overrides });
const spaceRows = (view) => nodes(view.render()).map((n) => n.id).filter((id) => /^space-spc/.test(id ?? ""));
const heading = (view) => textOf(view.render()).split(" | ")[0];

test("with the key unset, every space shows under Spaces", async () => {
  spaceWorld();
  const view = await mount("hws-spaces");
  assert.deepEqual(spaceRows(view), ["space-spc1", "space-spc2", "space-spc3"]);
  assert.equal(heading(view), "Spaces");
});

test("a space in an open workspace is hidden and the heading reads Other spaces", async () => {
  spaceWorld({ sharedValues: { [WORKSPACE_SPACES]: ["spc2"] } });
  const view = await mount("hws-spaces");
  assert.deepEqual(spaceRows(view), ["space-spc1", "space-spc3"]);
  assert.equal(heading(view), "Other spaces");
});

test("an id that matches no local space hides nothing and keeps the heading", async () => {
  spaceWorld({ sharedValues: { [WORKSPACE_SPACES]: ["gone"] } });
  const view = await mount("hws-spaces");
  assert.equal(spaceRows(view).length, 3);
  assert.equal(heading(view), "Spaces");
});

test("a remote space stays listed even when its id is shared", async () => {
  const remote = space("spc2", "beta", { machine: "box" });
  spaceWorld({ spaces: [THREE[0], remote], machines: [{ name: null, layout: "ready" }, { name: "box", layout: "ready" }], sharedValues: { [WORKSPACE_SPACES]: ["spc2"] } });
  const view = await mount("hws-spaces");
  assert.deepEqual(spaceRows(view), ["space-spc1", "space-spc2"]);
  assert.equal(heading(view), "Spaces");
});

test("right-clicking a local space opens the space menu, and a remote one keeps Herdr's menu", async () => {
  const remote = space("spc2", "beta", { machine: "box" });
  const H = spaceWorld({ spaces: [THREE[0], remote], machines: [{ name: null, layout: "ready" }, { name: "box", layout: "ready" }], overlays: [] });
  const view = await mount("hws-spaces");
  byId(view, "space-spc1").handlers.on_mouse_down_right({}, view.cx);
  byId(view, "space-spc2").handlers.on_mouse_down_right({}, view.cx);
  assert.deepEqual(H.overlays.map((o) => [o.mod, o.kind, o.props]), [
    ["hws-panel", "popup", { view: "space-menu", space: "spc1" }],
    ["menu", "popup", { tab: "space", target: { id: "spc2" } }],
  ]);
});

test("with every local space hidden the heading and + remain", async () => {
  const H = spaceWorld({ sharedValues: { [WORKSPACE_SPACES]: ["spc1", "spc2", "spc3"] } });
  const view = await mount("hws-spaces");
  assert.deepEqual(spaceRows(view), []);
  assert.equal(heading(view), "Other spaces");
  await view.click("space-new");
  assert.deepEqual(H.runs.at(-1), { name: "space.new", args: undefined });
});

test("dragging past a hidden space moves by its place among all spaces", async () => {
  const H = spaceWorld({ sharedValues: { [WORKSPACE_SPACES]: ["spc2"] } });
  const view = await mount("hws-spaces");
  byId(view, "space-spc1").handlers.on_mouse_down_left({}, view.cx);
  view.view.over = "spc3";
  byId(view, "space-spc3").handlers.on_mouse_up_left({}, view.cx);
  assert.deepEqual(H.runs, [{ name: "space.move", args: { id: "spc1", index: 3 } }]);
});

test("pressing and releasing a row selects that space, and the active one is highlighted", async () => {
  const H = spaceWorld({ sharedValues: { [WORKSPACE_SPACES]: ["spc2"] } });
  const view = await mount("hws-spaces");
  assert.equal(byId(view, "space-spc3").bg, "color:selected");
  assert.equal(byId(view, "space-spc1").bg, undefined);
  byId(view, "space-spc1").handlers.on_mouse_down_left({}, view.cx);
  byId(view, "space-spc1").handlers.on_mouse_up_left({}, view.cx);
  assert.deepEqual(H.runs, [{ name: "space.select", args: { id: "spc1" } }]);
});

test("the rail numbers each space by its place among all spaces, as space.select:N does", async () => {
  const H = spaceWorld({ sharedValues: { [WORKSPACE_SPACES]: ["spc2"] }, layout: { id: "root", children: [{ id: "sidebar", size: { px: 44 } }] } });
  const view = await mount("hws-spaces");
  assert.deepEqual(spaceRows(view), ["space-spc1", "space-spc3"]);
  assert.match(textOf(byId(view, "space-spc3")), /^3\b/);
  await view.click("space-spc3");
  assert.deepEqual(H.runs, [{ name: "space.select", args: { id: "spc3" } }]);
});

test("ordering a worktree under its checkout still counts hidden spaces", async () => {
  const order = [space("spc2", "beta"), space("spc1", "alpha"), space("spc4", "delta"), space("spc3", "gamma")];
  const H = spaceWorld({ spaces: order, sharedValues: { [WORKSPACE_SPACES]: ["spc2"] } });
  const view = await mount("hws-spaces");
  const repo = JSON.stringify([null, "/w/alpha/.git"]);
  view.view.git[JSON.stringify([null, "/w/alpha"])] = { name: "alpha", branch: "main", ahead: 0, behind: 0, repo, linked: false };
  view.view.git[JSON.stringify([null, "/w/gamma"])] = { name: "alpha", branch: "gamma", ahead: 0, behind: 0, repo, linked: true };
  assert.deepEqual(spaceRows(view), ["space-spc1", "space-spc3", "space-spc4"]);
  assert.deepEqual(H.runs, [{ name: "space.move", args: { id: "spc3", index: 3 } }]);
});

test("a worktree whose checkout is hidden stands alone, and the last shown worktree closes its group", async () => {
  const { visible } = await import("../hws-spaces/main.js");
  const rows = [
    { w: { id: "a" }, tree: null }, { w: { id: "a1" }, tree: "├─" }, { w: { id: "a2" }, tree: "└─" },
    { w: { id: "b" }, tree: null }, { w: { id: "b1" }, tree: "└─" },
  ];
  const shape = (hide) => visible(rows, (w) => hide.includes(w.id)).map((r) => [r.w.id, r.tree]);
  assert.deepEqual(shape([]), [["a", null], ["a1", "├─"], ["a2", "└─"], ["b", null], ["b1", "└─"]]);
  assert.deepEqual(shape(["a2"]), [["a", null], ["a1", "└─"], ["b", null], ["b1", "└─"]]);
  assert.deepEqual(shape(["b"]), [["a", null], ["a1", "├─"], ["a2", "└─"], ["b1", null]]);
  assert.deepEqual(shape(["a"]), [["a1", null], ["a2", null], ["b", null], ["b1", "└─"]]);
});

test("the spaces list draws a top border like Agents and the footer, with room above its heading", () => {
  const border = /\.border_t\(1\)\.border_color\(t\.border\)/;
  assert.match(read("hws-agents/main.js").replace(/\s+/g, ""), border);
  assert.match(read("hws-footer/main.js"), border);
  const render = read("hws-spaces/main.js").split("  render() {")[1];
  assert.match(render, /return v_flex\(\)\.size_full\(\)\.min_h\(0\)\.bg\(t\.chrome\)\.border_t\(1\)\.border_color\(t\.border\)/);
  assert.match(render, /\.child\(h_flex\(\)\.h\(39\)\.pt\(8\)/);
});

test("hws-spaces draws with workspace-chrome's icons and never reaches into the stock spaces mod", () => {
  const source = read("hws-spaces/main.js");
  for (const [, file] of source.matchAll(/mods\/workspace-chrome\/([\w-]+)\.svg/g)) assert.ok(/^(server|monitor|chevron-down|chevron-right|plus|branch)$/.test(file), file);
  assert.equal(/mods\/spaces\//.test(source), false);
  assert.equal(JSON.parse(read("hws-spaces/mod.json")).title, "Spaces");
});

test("the two board.js copies are identical", () => {
  assert.equal(read("hws-tabs/board.js"), read("hws-actions/board.js"));
});

test("the two flipped.js copies are identical", () => {
  assert.equal(read("hws-tabs/flipped.js"), read("hws-agents/flipped.js"));
});

test("hws-tabs carries the assets it references", () => {
  const source = read("hws-tabs/main.js");
  const own = [...source.matchAll(/mods\/hws-tabs\/([\w-]+\.svg)/g)].map((m) => m[1]);
  assert.ok(own.includes("tasks.svg") && own.includes("outputs.svg"));
  for (const file of own) assert.ok(read(`hws-tabs/${file}`).includes("<svg"), file);
  assert.equal(/mods\/tabs\//.test(source), false);
});

test("the layout is valid and installs what it references", () => {
  const layout = JSON.parse(read("layouts/hws.json"));
  const ids = [];
  const mods = new Set();
  const visit = (node) => {
    if (node.id) ids.push(node.id);
    if (node.content?.mod) mods.add(node.content.mod);
    if (node.content?.pane?.header?.content?.mod) mods.add(node.content.pane.header.content.mod);
    (node.children ?? []).forEach(visit);
  };
  visit(layout);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");

  const installs = new Set(readdirSync(new URL("../", import.meta.url)).filter((name) => name.startsWith("hws-")));
  const shipped = new Set(["workspace-chrome", "files", "changes", "workspace-status"]);
  for (const mod of mods) assert.ok(shipped.has(mod) || installs.has(mod), `${mod} is shipped or installed`);
  for (const mod of ["hws-actions", "hws-work", "hws-tabs", "hws-agents", "hws-spaces"]) assert.ok(installs.has(mod), mod);

  const block = (id) => {
    let hit = null;
    const go = (node) => { if (node.id === id) hit = node; (node.children ?? []).forEach(go); };
    go(layout);
    return hit;
  };
  assert.equal(block("tabs").content.mod, "hws-tabs");
  assert.equal(block("agents").content.mod, "hws-agents");
  assert.equal(block("spaces").content.mod, "hws-spaces");
  assert.deepEqual(block("panel-body").children.map((c) => c.id), ["files", "changes", "outputs"]);
  assert.equal(block("tasks"), null);
  assert.deepEqual(block("outputs").content, { mod: "hws-work", props: { view: "outputs" } });
  assert.deepEqual(block("sidebar-lists").children.map((c) => c.id), ["workspaces", "spaces", "agents"]);
});

test("mod.open:hws-brief keeps its key for toggling Outputs", () => {
  assert.equal(JSON.parse(read("keys.example.json")).global["cmd-shift-b"], "mod.open:hws-brief");
});
