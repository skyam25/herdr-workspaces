import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setup, mount } from "./harness.mjs";

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

test("a tab holding a flipped agent shows its name, icon and status", async () => {
  tabWorld();
  const view = await mount("hws-tabs");
  const tab = inTab(view, "tb2");
  assert.equal(view.text().includes("Claude Code"), true);
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

test("the Tasks badge shows only above zero", async () => {
  tabWorld({ sharedValues: { "hws.tasks.waiting": 3 } });
  const shown = await mount("hws-tabs");
  assert.equal(shown.has("panel-tasks-badge"), true);
  assert.equal(shown.text().includes("3"), true);

  for (const value of [0, undefined]) {
    tabWorld({ sharedValues: { "hws.tasks.waiting": value } });
    assert.equal((await mount("hws-tabs")).has("panel-tasks-badge"), false);
  }
});

test("four panel buttons by default, Tasks and Outputs even when panels are restricted", async () => {
  tabWorld();
  const view = await mount("hws-tabs");
  for (const id of ["files", "changes", "tasks", "outputs"]) assert.equal(view.has(`panel-${id}`), true, id);

  tabWorld({ sharedValues: { "workspace.panels": ["files"] } });
  const limited = await mount("hws-tabs");
  assert.equal(limited.has("panel-files"), true);
  assert.equal(limited.has("panel-changes"), false);
  assert.equal(limited.has("panel-tasks"), true);
  assert.equal(limited.has("panel-outputs"), true);
});

test("a panel button selects its stack child and shows the panel, then hides it", async () => {
  const H = tabWorld();
  const view = await mount("hws-tabs");
  await view.click("panel-tasks");
  assert.deepEqual(H.runs.slice(-2), [{ name: "layout.select", args: { stack: "panel-body", child: "tasks" } }, { name: "layout.show", args: { id: "panel" } }]);

  H.layout = { id: "root", children: [{ id: "panel", hidden: false }, { id: "panel-body", active: "tasks" }] };
  await view.click("panel-tasks");
  assert.deepEqual(H.runs.at(-1), { name: "layout.hide", args: { id: "panel" } });
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

  const installs = new Set(read("install.sh").match(/^MODS="([^"]+)"/m)[1].split(" "));
  const shipped = new Set(["workspace-chrome", "spaces", "files", "changes", "workspace-status"]);
  for (const mod of mods) assert.ok(shipped.has(mod) || installs.has(mod), `${mod} is shipped or installed`);
  for (const mod of ["hws-actions", "hws-work", "hws-tabs", "hws-agents"]) assert.ok(installs.has(mod), mod);

  const block = (id) => {
    let hit = null;
    const go = (node) => { if (node.id === id) hit = node; (node.children ?? []).forEach(go); };
    go(layout);
    return hit;
  };
  assert.equal(block("tabs").content.mod, "hws-tabs");
  assert.equal(block("agents").content.mod, "hws-agents");
  assert.deepEqual(block("panel-body").children.map((c) => c.id), ["files", "changes", "tasks", "outputs"]);
  assert.deepEqual(block("tasks").content, { mod: "hws-work", props: { view: "tasks" } });
  assert.deepEqual(block("outputs").content, { mod: "hws-work", props: { view: "outputs" } });
  assert.deepEqual(block("sidebar-lists").children.map((c) => c.id), ["workspaces", "spaces", "agents"]);
});

test("mod.open:hws-brief keeps its key for toggling Outputs", () => {
  assert.equal(JSON.parse(read("keys.example.json")).global["cmd-shift-b"], "mod.open:hws-brief");
});
