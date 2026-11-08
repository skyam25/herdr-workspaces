import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setup, mount, settle, hwsCalls, usedMethods } from "./harness.mjs";
import { ago, awaitsUser, board, mergeBoard, notesLine, parseItems, parseOutputs, roster, sendTargets, sessionFor } from "../hws-work/data.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const agent = (address, tab = "tb1", space = "spc1") => ({ address, pane: `p-${address}`, space, tab, status: "working", app: "claude-code", program: { key: "claude" } });
const session = (id, terminal, extra = {}) => ({ sessionId: id, cwd: `/w/${id}`, name: `Agent ${id}`, host: { hcTerminal: terminal }, trackItems: true, itemsPath: `/w/${id}/i.md`, outputsPath: `/w/${id}/o.json`, ...extra });
const SPACES = [
  { id: "spc1", active: true, machine: null, tabs: [{ id: "tb1", active: true }, { id: "tb2", active: false }] },
  { id: "spc2", active: false, machine: null, tabs: [{ id: "tb9", active: true }] },
];
const panelLayout = (hidden, active) => ({ id: "root", children: [{ id: "panel", hidden, children: [{ id: "panel-body", active }] }] });

const outputsFile = (outputs) => JSON.stringify({ version: 1, outputs });
const decl = (ref, at, kind = "doc") => ({ ref, tier: "declared", kind, declaredAt: at });
const seen = (ref, at, kind = "file") => ({ ref, tier: "detected", kind, lastWriteAt: at });

function world({ agents = [agent("t1")], sessions = [session("s1", "t1")], files = {}, panes = [], terminals = [], layout, spaces = SPACES, sessionsResult } = {}) {
  const reads = [];
  return setup({
    agents,
    panes,
    terminals,
    spaces,
    layout,
    reads,
    files: new Proxy(files, { get: (target, key) => { reads.push(key); return target[key]; } }),
    sharedValues: {},
    sharedSets: [],
    notices: [],
    other: sessionsResult ?? ((command, args) => (command === "agent-brief" && args[0] === "sessions" ? { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" } : { code: 0, stdout: "", stderr: "" })),
  });
}

const widen = (m, width) => m.render().node.handlers.on_size_change({ width, height: 600 }, m.cx);

const todo = (id, title, extra = {}) => ({ id, title, notes: "", column: "todo", terminal: null, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const todoList = (...items) => ({ items });
const todoLists = (H) => hwsCalls(H).filter((c) => c.args[0] === "todo" && c.args[1] === "list").length;
const moves = (H) => hwsCalls(H).filter((c) => c.args[0] === "todo" && c.args[1] === "move");

function findNode(m, id) {
  let hit = null;
  const go = (el) => {
    const n = el?.node ?? el;
    if (typeof n !== "object" || n === null) return;
    if (n.id === id) hit = n;
    (n.children ?? []).forEach(go);
  };
  go(m.render());
  if (!hit) throw new Error(`no element ${id}`);
  return hit;
}

function textOf(n) {
  const parts = [];
  const go = (el) => {
    const c = el?.node ?? el;
    if (typeof c === "string") parts.push(c);
    else (c?.children ?? []).forEach(go);
  };
  go(n);
  return parts.join(" | ");
}

const press = (m, id) => findNode(m, id).handlers.on_mouse_down_left({}, m.cx);
const hover = (m, id, hovered) => findNode(m, id).handlers.on_hover(hovered, m.cx);

// Fires each element's release handler in the order given: the card, its lane, the root.
async function release(m, ...ids) {
  for (const id of ids) findNode(m, id).handlers.on_mouse_up_left?.({}, m.cx);
  await settle();
}

// Parsing and binding

test("parseOutputs keeps valid, unique refs and rejects bad documents", () => {
  assert.deepEqual(parseOutputs("not json"), []);
  assert.deepEqual(parseOutputs('{"version":2,"outputs":[]}'), []);
  const good = outputsFile([decl("a.md", 1), decl("a.md", 2), { ref: "b", tier: "other", kind: "x" }, seen("c.png", 3)]);
  assert.deepEqual(parseOutputs(good).map((o) => o.ref), ["a.md", "c.png"]);
});

test("parseItems reads items and spoken lines, and awaitsUser follows the last speaker", () => {
  const items = parseItems("- [ ] #1 Pick a name\n  Claude: Which one?\n- [ ] #2 Other\n  You: Done?\n- [x] #3 Finished\nplain line\n- [ ] #4 Silent\n");
  assert.deepEqual(items.map((i) => [i.n, i.done]), [[1, false], [2, false], [3, true], [4, false]]);
  assert.equal(awaitsUser(items[0]), true);
  assert.equal(awaitsUser(items[1]), false);
  assert.equal(awaitsUser(items[2]), false);
  assert.equal(awaitsUser(items[3]), false);
});

test("ago formats elapsed time", () => {
  assert.equal(ago(0), "just now");
  assert.equal(ago(5 * 60000), "5m ago");
  assert.equal(ago(3 * 3600000), "3h ago");
  assert.equal(ago(49 * 3600000), "2d ago");
});

test("sessionFor binds only by exact terminal and prefers the newest", () => {
  const sessions = [{ sessionId: "old", host: { hcTerminal: "t1" }, lastSeen: 1 }, { sessionId: "new", host: { hcTerminal: "t1" }, lastSeen: 2 }, { sessionId: "other", host: { hcTerminal: "t2" } }];
  assert.equal(sessionFor(sessions, "t1").sessionId, "new");
  assert.equal(sessionFor(sessions, "t3"), null);
  assert.equal(sessionFor(null, "t1"), null);
});

test("roster covers the active space and finds flipped agents through the chat pane", () => {
  const lists = {
    agents: [agent("t1"), { ...agent("t2"), app: "codex", program: { key: "codex" } }, agent("t3", "tb9", "spc2")],
    panes: [{ pane: "chat1", mod: "hws-chat", tab: "tb2" }, { pane: "chat2", mod: "hws-chat", tab: "tb9" }, { pane: "chat3", mod: "hws-chat", tab: "tb1" }],
    terminals: [
      { address: "t5", state: "live", labels: { "herdr.chat": "chat1" }, program: { key: "claude" } },
      { address: "t6", state: "live", labels: { "herdr.chat": "chat2" }, program: { key: "claude" } },
      { address: "t7", state: "exited", labels: { "herdr.chat": "chat3" }, program: { key: "claude" } },
    ],
    spaces: SPACES,
  };
  assert.deepEqual(roster(lists), [
    { address: "t1", tab: "tb1", chatPane: null, space: "spc1" },
    { address: "t5", tab: "tb2", chatPane: "chat1", space: "spc1" },
  ]);
  assert.deepEqual(roster({ ...lists, spaces: [{ ...SPACES[0], machine: "vm" }] }), []);
});

test("a flipped terminal already in agents() counts once, as flipped", () => {
  const lists = {
    agents: [agent("t5", "tb1")],
    panes: [{ pane: "chat1", mod: "hws-chat", tab: "tb1" }],
    terminals: [{ address: "t5", state: "live", labels: { "herdr.chat": "chat1" }, program: { key: "claude" } }],
    spaces: SPACES,
  };
  assert.deepEqual(roster(lists), [{ address: "t5", tab: "tb1", chatPane: "chat1", space: "spc1" }]);
});

test("board sorts open items by state and Done by newest number", () => {
  const items = parseItems("- [ ] #1 One\n  Claude: Which?\n- [ ] #2 Two\n  You: Fine\n- [x] #3 Three\n- [x] #9 Nine\n");
  const docs = new Map([["s1", { items, outputs: [] }]]);
  const columns = board([{ agent: { address: "t1" }, session: session("s1", "t1") }], docs);
  assert.deepEqual(columns.waiting.map((c) => c.n), [1]);
  assert.deepEqual(columns.progress.map((c) => c.n), [2]);
  assert.deepEqual(columns.done.map((c) => c.n), [9, 3]);
  assert.equal(columns.waiting[0].last, "Which?");
});

// Tasks view

const ITEMS = "- [ ] #1 Pick a name\n  Claude: Which one?\n- [ ] #2 Build it\n- [x] #3 Shipped\n";

test("Tasks stacks sections below 720 and shows four columns at 720 or wider", async () => {
  world({ files: { "/w/s1/i.md": ITEMS } });
  const m = await mount("hws-work", { view: "tasks" });
  widen(m, 719);
  assert.equal(m.has("stack"), true);
  assert.equal(m.has("board"), false);
  assert.match(m.text(), /Tasks \| 2/);
  assert.match(m.text(), /To do \| 0.*In progress \| 1.*Waiting on you \| 1.*Done \| 1/);
  assert.match(m.text(), /#1 \| Pick a name \| Agent s1 · Which one\?/);
  widen(m, 720);
  assert.equal(m.has("board"), true);
  assert.equal(m.has("stack"), false);
  for (const lane of ["scroll-todo", "scroll-doing", "scroll-waiting", "scroll-done"]) assert.equal(m.has(lane), true);
});

test("expand resizes the panel to 860, and to 368 when wide", async () => {
  const H = world({ files: { "/w/s1/i.md": ITEMS } });
  const m = await mount("hws-work", { view: "tasks" });
  widen(m, 368);
  await m.click("expand");
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "panel", px: 860 } });
  widen(m, 860);
  assert.match(m.text(), /Collapse/);
  await m.click("expand");
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "panel", px: 368 } });
});

test("Tasks sets the waiting count once, and only when it changes", async () => {
  const H = world({ files: { "/w/s1/i.md": ITEMS } });
  const m = await mount("hws-work", { view: "tasks" });
  m.render();
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.tasks.waiting", value: 1 });
  H.sharedValues["hws.tasks.waiting"] = 1;
  const before = H.sharedSets.length;
  m.render();
  m.render();
  assert.equal(H.sharedSets.length, before);
});

test("Outputs never touches the waiting count", async () => {
  const H = world({ files: { "/w/s1/i.md": ITEMS } });
  const m = await mount("hws-work", { view: "outputs" });
  m.render();
  assert.deepEqual(H.sharedSets, []);
});

test("a card focuses the agent's terminal", async () => {
  const H = world({ files: { "/w/s1/i.md": ITEMS } });
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("card-t1-1");
  assert.deepEqual(H.runs, [{ name: "pane.focus", args: { terminal: "t1" } }]);
});

test("a card selects another tab first and focuses a flipped agent's chat pane", async () => {
  const H = world({
    agents: [],
    panes: [{ pane: "chat1", mod: "hws-chat", tab: "tb2" }],
    terminals: [{ address: "t5", state: "live", labels: { "herdr.chat": "chat1" }, program: { key: "claude" } }],
    sessions: [session("s5", "t5")],
    files: { "/w/s5/i.md": ITEMS },
  });
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("card-t5-1");
  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb2" } }, { name: "pane.focus", args: { pane: "chat1" } }]);
});

test("Done shows the newest 8 and a row that expands the rest", async () => {
  const items = Array.from({ length: 11 }, (_, i) => `- [x] #${i + 1} Item ${i + 1}`).join("\n");
  world({ files: { "/w/s1/i.md": items } });
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("card-t1-11"), true);
  assert.equal(m.has("card-t1-4"), true);
  assert.equal(m.has("card-t1-3"), false);
  assert.match(m.text(), /3 more/);
  await m.click("done-more");
  assert.equal(m.has("card-t1-1"), true);
});

test("only the active space's agents load files", async () => {
  const H = world({
    agents: [agent("t1"), agent("t9", "tb9", "spc2")],
    sessions: [session("s1", "t1"), session("s9", "t9")],
    files: { "/w/s1/i.md": ITEMS, "/w/s9/i.md": ITEMS },
  });
  const m = await mount("hws-work", { view: "tasks" });
  m.render();
  await settle();
  assert.equal(H.reads.includes("/w/s9/i.md"), false);
  assert.equal(H.reads.includes("/w/s1/i.md"), true);
  assert.deepEqual([...new Set(H.watches)], ["/w/s1/.feedback"]);
});

test("a folder match without the exact terminal does not bind", async () => {
  world({ sessions: [{ ...session("s1", "t1"), host: { bundleId: "dev.herdr.app" } }], files: { "/w/s1/i.md": ITEMS } });
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("card-t1-1"), false);
  assert.match(m.text(), /no session/);
});

// Quiet line

const quietOf = (m) => findNode(m, "quiet");
const quietText = (m) => textOf(quietOf(m));

test("tracking off is a quiet line and the board still renders", async () => {
  world({ sessions: [session("s1", "t1", { trackItems: false, itemsPath: undefined })] });
  const m = await mount("hws-work", { view: "tasks" });
  assert.match(quietText(m), /Item tracking is off.*Agent Brief app/);
  assert.match(m.text(), /To do \| 0/);
});

test("the quiet line stays away when tracking is on and nothing is wrong", async () => {
  world({ files: { "/w/s1/i.md": "" } });
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("quiet"), false);
  assert.match(m.text(), /Waiting on you \| 0/);
});

test("an agent-brief failure is one quiet line and to-dos still work", async () => {
  const H = world({ sessionsResult: () => ({ code: 1, stdout: "", stderr: "Agent Brief is not running. Start it.\nmore\n" }) });
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  assert.match(quietText(m), /Agent Brief is not running\. Start it\./);
  assert.equal(/\bmore\b/.test(m.text()), false);
  assert.equal(m.has("todo-a1"), true);
  assert.match(m.text(), /To do \| 1/);
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.tasks.waiting", value: 0 });
});

test("agent-brief failing to start shows on Outputs and as the quiet line on Tasks", async () => {
  world({ sessionsResult: () => { throw new Error("spawn ENOENT"); } });
  const outputs = await mount("hws-work", { view: "outputs" });
  assert.match(outputs.text(), /Could not run agent-brief: spawn ENOENT/);

  world({ sessionsResult: () => { throw new Error("spawn ENOENT"); } });
  const tasks = await mount("hws-work", { view: "tasks" });
  assert.match(quietText(tasks), /Could not run agent-brief: spawn ENOENT/);
  assert.match(tasks.text(), /To do \| 0/);
});

test("a space with no Claude agents or on another machine says so", async () => {
  const H = world({ agents: [] });
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  assert.match(quietText(m), /No Claude Code agents in this space/);
  assert.equal(m.has("todo-a1"), true);

  world({ spaces: [{ ...SPACES[0], machine: "vm" }] });
  const m2 = await mount("hws-work", { view: "outputs" });
  assert.match(m2.text(), /another machine/);
});

test("the Waiting on you count stays equal when a space has no agents", async () => {
  const H = world({ agents: [] });
  H.sharedValues["hws.tasks.waiting"] = 3;
  const m = await mount("hws-work", { view: "tasks" });
  m.render();
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.tasks.waiting", value: 0 });
});

// To-dos on the board

test("mergeBoard puts to-dos first and leaves Waiting to agents", () => {
  const agentCards = { waiting: [{ n: 1 }], progress: [{ n: 2 }], done: [{ n: 3 }] };
  const merged = mergeBoard([todo("a", "A"), todo("b", "B", { column: "doing" }), todo("c", "C", { column: "done" })], agentCards);
  assert.deepEqual(merged.todo.map((c) => c.id), ["a"]);
  assert.deepEqual(merged.doing.map((c) => c.id ?? c.n), ["b", 2]);
  assert.deepEqual(merged.waiting.map((c) => c.n), [1]);
  assert.deepEqual(merged.done.map((c) => c.id ?? c.n), ["c", 3]);
});

test("notesLine takes the first line with text", () => {
  assert.equal(notesLine("\n  first \nsecond"), "first");
  assert.equal(notesLine(""), "");
  assert.equal(notesLine(undefined), "");
});

test("sendTargets lists every agent in the space, flipped ones included", () => {
  const lists = {
    agents: [{ ...agent("t1"), program: { key: "claude", name: "Claude Code" } }, { ...agent("t2"), app: "codex", program: { key: "codex", name: "Codex" } }, agent("t3", "tb9", "spc2")],
    panes: [{ pane: "chat1", mod: "hws-chat", tab: "tb2" }, { pane: "chat2", mod: "hws-chat", tab: "tb9" }],
    terminals: [
      { address: "t5", state: "live", labels: { "herdr.chat": "chat1" }, program: { key: "codex", name: "Codex" } },
      { address: "t6", state: "live", labels: { "herdr.chat": "chat2" }, program: { key: "claude", name: "Claude Code" } },
    ],
    spaces: [{ id: "spc1", tabs: [{ id: "tb1", name: "Plan" }, { id: "tb2", name: "Build" }] }, { id: "spc2", tabs: [{ id: "tb9", name: "Other" }] }],
  };
  assert.deepEqual(sendTargets(lists, "spc1"), [
    { address: "t1", name: "Claude Code", tab: "Plan", flipped: false },
    { address: "t2", name: "Codex", tab: "Plan", flipped: false },
    { address: "t5", name: "Codex", tab: "Build", flipped: true },
  ]);
  assert.deepEqual(sendTargets(lists, "gone"), []);
});

test("the board shows to-dos and agent items together", async () => {
  const H = world({
    agents: [{ ...agent("t1"), program: { key: "claude", name: "Claude Code" } }],
    files: { "/w/s1/i.md": ITEMS },
  });
  H.hws["todo list"] = todoList(todo("a1", "Fix login", { notes: "\nCheck the token\nmore" }), todo("a2", "Ship", { column: "doing", terminal: "t1" }), todo("a3", "Old", { column: "done", terminal: "t8" }));
  const m = await mount("hws-work", { view: "tasks" });
  widen(m, 860);
  assert.match(m.text(), /Tasks \| 4/);
  assert.match(m.text(), /To do \| 1 \| \+ \| Fix login \| Check the token/);
  assert.match(m.text(), /In progress \| 2 \| Ship \| Sent to Claude Code/);
  assert.match(m.text(), /Waiting on you \| 1/);
  assert.match(m.text(), /Done \| 2 \| Old \| Sent to t8/);
  assert.equal(/more/.test(m.text()), false);
  assert.deepEqual(hwsCalls(H)[0].args, ["todo", "list", "--space", "spc1", "--json"]);
});

test("to-dos reload on the poll and when a dialog reports a change", async () => {
  const H = world();
  H.hws["todo list"] = todoList();
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(todoLists(H), 1);
  await m.fireTimer(10000);
  assert.equal(todoLists(H), 2);
  H.hws["todo list"] = todoList(todo("a1", "New one"));
  H.sharedValues["hws.todos.changed"] = 5;
  m.render();
  await settle();
  assert.equal(todoLists(H), 3);
  assert.equal(m.has("todo-a1"), true);
});

test("to-dos reload for the new space when the active space changes", async () => {
  const H = world();
  H.hws["todo list"] = (args) => (args.includes("spc2") ? todoList(todo("b1", "Other space")) : todoList(todo("a1", "Here")));
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("todo-a1"), true);
  H.spaces = [{ ...SPACES[0], active: false }, { ...SPACES[1], active: true }];
  m.render();
  await settle();
  assert.equal(hwsCalls(H).at(-1).args.includes("spc2"), true);
  assert.equal(m.has("todo-b1"), true);
  assert.equal(m.has("todo-a1"), false);
});

test("a failed to-do load shows on the quiet line and keeps the board", async () => {
  const H = world({ files: { "/w/s1/i.md": ITEMS } });
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  H.hws["todo list"] = { fail: "the to-do file is damaged" };
  await m.fireTimer(10000);
  assert.match(quietText(m), /the to-do file is damaged/);
  assert.equal(m.has("todo-a1"), true);
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  await m.fireTimer(10000);
  assert.equal(m.has("quiet"), false);
});

test("the add buttons open a new to-do for the active space", async () => {
  const H = world();
  H.hws["todo list"] = todoList();
  const m = await mount("hws-work", { view: "tasks" });
  for (const id of ["add", "add-todo"]) await m.click(id);
  assert.deepEqual(H.overlays.map((o) => o.props), [{ view: "todo", space: "spc1" }, { view: "todo", space: "spc1" }]);
  assert.equal(H.overlays[0].mod, "hws-work");
  assert.equal(H.overlays[0].kind, "dialog");
});

// Dragging

test("dragging a to-do to another column runs hws todo move", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  press(m, "todo-a1");
  hover(m, "todo-a1", false);
  hover(m, "lane-todo", false);
  hover(m, "lane-doing", true);
  assert.equal(findNode(m, "lane-doing").bg, "color:selected");
  assert.equal(findNode(m, "lane-todo").bg, undefined);
  assert.equal(findNode(m, "todo-a1").opacity, 0.45);
  const lists = todoLists(H);
  await release(m, "lane-doing", "root");
  assert.deepEqual(hwsCalls(H).find((c) => c.args[1] === "move").args, ["todo", "move", "--id", "a1", "--column", "doing", "--space", "spc1", "--json"]);
  assert.equal(todoLists(H), lists + 1);
  assert.equal(findNode(m, "lane-doing").bg, undefined);
  assert.equal(findNode(m, "todo-a1").opacity, undefined);
  assert.equal(H.overlays.length, 0);
});

test("a drop on a card in another column lands in that column", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "One"), todo("a2", "Two", { column: "done" }));
  const m = await mount("hws-work", { view: "tasks" });
  press(m, "todo-a1");
  hover(m, "lane-done", true);
  await release(m, "todo-a2", "lane-done", "root");
  assert.equal(hwsCalls(H).find((c) => c.args[1] === "move").args[5], "done");
  assert.equal(H.overlays.length, 0);
});

test("Waiting on you never accepts a drop or lights up", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  press(m, "todo-a1");
  hover(m, "lane-waiting", true);
  assert.equal(findNode(m, "lane-waiting").bg, undefined);
  await release(m, "lane-waiting", "root");
  assert.equal(moves(H).length, 0);
  assert.equal(H.overlays.length, 0);
  assert.equal(m.view.drag, null);
});

test("a release outside any column cancels", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  press(m, "todo-a1");
  hover(m, "lane-doing", true);
  await release(m, "root");
  assert.equal(moves(H).length, 0);
  assert.equal(m.view.drag, null);
});

test("leaving the panel during a drag cancels it", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  press(m, "todo-a1");
  hover(m, "lane-doing", true);
  hover(m, "root", false);
  assert.equal(m.view.drag, null);
  await release(m, "lane-doing", "root");
  assert.equal(moves(H).length, 0);
});

test("a press and release on the same card opens the to-do without a visible drag", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  press(m, "todo-a1");
  assert.equal(findNode(m, "lane-todo").bg, undefined);
  assert.equal(findNode(m, "todo-a1").opacity, undefined);
  await release(m, "todo-a1", "lane-todo", "root");
  assert.deepEqual(H.overlays.map((o) => o.props), [{ view: "todo", space: "spc1", id: "a1" }]);
  assert.equal(moves(H).length, 0);
  assert.equal(m.view.drag, null);
});

test("a release in the card's own column after crossing moves nothing and opens nothing", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  press(m, "todo-a1");
  hover(m, "lane-doing", true);
  hover(m, "lane-doing", false);
  hover(m, "lane-todo", true);
  await release(m, "todo-a1", "lane-todo", "root");
  assert.equal(moves(H).length, 0);
  assert.equal(H.overlays.length, 0);
  assert.equal(m.view.drag, null);
});

test("agent cards never start a drag and still focus the agent", async () => {
  const H = world({ files: { "/w/s1/i.md": ITEMS } });
  H.hws["todo list"] = todoList();
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(findNode(m, "card-t1-2").handlers.on_mouse_down_left, undefined);
  hover(m, "lane-todo", true);
  await release(m, "lane-todo", "root");
  assert.equal(moves(H).length, 0);
  await m.click("card-t1-2");
  assert.deepEqual(H.runs, [{ name: "pane.focus", args: { terminal: "t1" } }]);
});

test("a failed move shows on the quiet line and leaves the board as it was", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  H.hws["todo move"] = { fail: "no to-do a1 in space spc1" };
  const m = await mount("hws-work", { view: "tasks" });
  const lists = todoLists(H);
  press(m, "todo-a1");
  hover(m, "lane-doing", true);
  await release(m, "lane-doing", "root");
  assert.match(quietText(m), /no to-do a1 in space spc1/);
  assert.equal(todoLists(H), lists);
  assert.match(m.text(), /To do \| 1/);
  await m.fireTimer(10000);
  assert.match(quietText(m), /no to-do a1 in space spc1/);
});

// To-do dialog

const form = async (H, id) => {
  const m = await mount("hws-work", { view: "todo", space: "spc1", overlay: "ov9", ...(id ? { id } : {}) }, H);
  return m;
};

const dialogWorld = (...items) => {
  const H = world({ agents: [{ ...agent("t1"), program: { key: "claude", name: "Claude Code" } }, { ...agent("t2"), app: "codex", program: { key: "codex", name: "Codex" } }] });
  H.hws["todo list"] = todoList(...items);
  H.hws["todo add"] = (args) => ({ ...todo("new1", "x"), args });
  return H;
};

test("the dialog shows a new to-do without Send to or Archive and does no polling", async () => {
  const H = dialogWorld();
  const m = await form(H);
  assert.match(m.text(), /New to-do/);
  assert.equal(m.has("archive-todo"), false);
  assert.match(m.text(), /Title.*Notes.*Column/);
  assert.equal(/Send to/.test(m.text()), false);
  assert.equal(m.timers.filter((x) => x.repeating).length, 0);
  assert.equal(H.calls.length, 0);
});

test("Enter in the title adds the to-do and closes", async () => {
  const H = dialogWorld();
  const m = await form(H);
  m.view.form.title.type("Buy milk", m.cx);
  m.view.form.notes.type("- two percent\n- oat too", m.cx);
  m.view.form.title.submit(m.cx);
  await settle();
  assert.deepEqual(hwsCalls(H).at(-1).args, ["todo", "add", "--title=Buy milk", "--notes=- two percent\n- oat too", "--space", "spc1", "--json"]);
  assert.deepEqual(H.closed, ["ov9"]);
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.todos.changed", value: 1 });
});

test("a new to-do in another column is added, then moved", async () => {
  const H = dialogWorld();
  const m = await form(H);
  m.view.form.title.type("Buy milk", m.cx);
  await m.click("column-done");
  await m.click("save-todo");
  const calls = hwsCalls(H).map((c) => c.args);
  assert.deepEqual(calls[0], ["todo", "add", "--title=Buy milk", "--space", "spc1", "--json"]);
  assert.deepEqual(calls[1], ["todo", "move", "--id", "new1", "--column", "done", "--space", "spc1", "--json"]);
});

test("a blank title asks for one and runs nothing", async () => {
  const H = dialogWorld();
  const m = await form(H);
  await m.click("save-todo");
  assert.match(m.text(), /Give the to-do a title/);
  assert.equal(H.calls.length, 0);
  assert.equal(H.closed.length, 0);
});

test("the dialog loads an existing to-do and saves changes", async () => {
  const H = dialogWorld(todo("a1", "Fix login", { notes: "Old", column: "todo" }));
  const m = await form(H, "a1");
  assert.equal(m.view.form.title.value(), "Fix login");
  assert.equal(m.view.form.notes.value(), "Old");
  m.view.form.title.type("Fix sign in", m.cx);
  m.view.form.notes.type("", m.cx);
  await m.click("column-doing");
  await m.click("save-todo");
  const calls = hwsCalls(H).map((c) => c.args).filter((a) => a[1] !== "list");
  assert.deepEqual(calls[0], ["todo", "edit", "--id", "a1", "--title=Fix sign in", "--notes=", "--space", "spc1", "--json"]);
  assert.deepEqual(calls[1], ["todo", "move", "--id", "a1", "--column", "doing", "--space", "spc1", "--json"]);
  assert.deepEqual(H.closed, ["ov9"]);
});

test("saving an unchanged to-do writes nothing", async () => {
  const H = dialogWorld(todo("a1", "Fix login"));
  const m = await form(H, "a1");
  await m.click("save-todo");
  assert.deepEqual(hwsCalls(H).map((c) => c.args[1]), ["list"]);
  assert.deepEqual(H.closed, ["ov9"]);
});

test("a missing to-do says so and disables Save", async () => {
  const H = dialogWorld();
  const m = await form(H, "gone");
  assert.match(m.text(), /no longer exists/);
  assert.equal(m.clickable("save-todo"), false);
  assert.equal(m.clickable("archive-todo"), false);
});

test("Send to lists every agent and sends to the chosen address", async () => {
  const H = dialogWorld(todo("a1", "Fix login"));
  H.panes = [{ pane: "chat1", mod: "hws-chat", tab: "tb2" }];
  H.terminals = [{ address: "t5", state: "live", labels: { "herdr.chat": "chat1" }, program: { key: "claude", name: "Claude Code" } }];
  const m = await form(H, "a1");
  assert.match(m.text(), /Send to \| Claude Code .*Codex .*Claude Code/);
  for (const id of ["send-t1", "send-t2", "send-t5"]) assert.equal(m.has(id), true);
  await m.click("send-t5");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["todo", "send", "--id", "a1", "--terminal", "t5", "--space", "spc1", "--json"]);
  assert.deepEqual(H.closed, ["ov9"]);
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.todos.changed", value: 1 });
});

test("Send to saves edited text first because hws sends the stored text", async () => {
  const H = dialogWorld(todo("a1", "Fix login"));
  const m = await form(H, "a1");
  m.view.form.title.type("Fix sign in", m.cx);
  await m.click("send-t1");
  assert.deepEqual(hwsCalls(H).slice(1).map((c) => c.args[1]), ["edit", "send"]);
});

test("Send to says so when the space has no agents", async () => {
  const H = dialogWorld(todo("a1", "Fix login"));
  H.agents = [];
  const m = await form(H, "a1");
  assert.match(m.text(), /No agents in this space\./);
});

test("Archive runs hws todo archive and closes", async () => {
  const H = dialogWorld(todo("a1", "Fix login"));
  const m = await form(H, "a1");
  await m.click("archive-todo");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["todo", "archive", "--id", "a1", "--space", "spc1", "--json"]);
  assert.deepEqual(H.closed, ["ov9"]);
});

test("a failing call shows in the dialog and keeps it open", async () => {
  for (const [command, click] of [["todo edit", "save-todo"], ["todo send", "send-t1"], ["todo archive", "archive-todo"]]) {
    const H = dialogWorld(todo("a1", "Fix login"));
    H.hws[command] = { fail: `${command} went wrong` };
    const m = await form(H, "a1");
    if (command === "todo edit") m.view.form.title.type("Changed", m.cx);
    await m.click(click);
    assert.match(m.text(), new RegExp(`${command} went wrong`));
    assert.deepEqual(H.closed, []);
    assert.equal(m.clickable("save-todo"), true);
  }
});

test("Esc closes the dialog and Tab moves between fields", async () => {
  const H = dialogWorld();
  const m = await form(H);
  H.focusCalls.length = 0;
  await m.key("tab");
  assert.deepEqual(H.focusCalls, ["What needs doing?"]);
  await m.key("escape");
  assert.deepEqual(H.closed, ["ov9"]);
});

test("Outputs says none yet when no agent has any", async () => {
  world();
  const m = await mount("hws-work", { view: "outputs" });
  assert.match(m.text(), /No outputs yet/);
});

// Outputs view

test("Outputs shows declared rows first, with Touched collapsed, newest first", async () => {
  world({ files: { "/w/s1/o.json": outputsFile([decl("a.md", 100), decl("b.md", 200), seen("c.png", 300)]) } });
  const m = await mount("hws-work", { view: "outputs" });
  assert.match(m.text(), /b\.md \| doc.*a\.md \| doc.*Touched \(1\)/);
  assert.equal(m.has("output-t1-c.png"), false);
  await m.click("touched-t1");
  assert.equal(m.has("output-t1-c.png"), true);
  assert.equal(m.has("group-t1"), false);
});

test("Outputs groups by agent when more than one has outputs, newest agent first", async () => {
  world({
    agents: [agent("t1"), agent("t2")],
    sessions: [session("s1", "t1"), session("s2", "t2")],
    files: { "/w/s1/o.json": outputsFile([decl("old.md", 1)]), "/w/s2/o.json": outputsFile([decl("new.md", 9)]) },
  });
  const m = await mount("hws-work", { view: "outputs" });
  assert.match(m.text(), /Agent s2 \| new\.md.*Agent s1 \| old\.md/);
  assert.equal(m.has("group-t1"), true);
});

test("a page output opens beside its agent with hws", async () => {
  const H = world({ files: { "/w/s1/o.json": outputsFile([decl("docs/plan.md", 1)]) } });
  const m = await mount("hws-work", { view: "outputs" });
  await m.click("output-t1-docs/plan.md");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["surface", "open", "--type", "page", "--file", "/w/s1/docs/plan.md", "--terminal", "t1", "--json"]);
});

test("a flipped agent's page opens beside its chat pane", async () => {
  const H = world({
    agents: [],
    panes: [{ pane: "chat1", mod: "hws-chat", tab: "tb1" }],
    terminals: [{ address: "t5", state: "live", labels: { "herdr.chat": "chat1" }, program: { key: "claude" } }],
    sessions: [session("s5", "t5")],
    files: { "/w/s5/o.json": outputsFile([decl("page.html", 1)]) },
  });
  const m = await mount("hws-work", { view: "outputs" });
  await m.click("output-t5-page.html");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["surface", "open", "--type", "page", "--file", "/w/s5/page.html", "--terminal", "t5", "--beside-pane", "chat1", "--space", "spc1", "--json"]);
});

test("anything other than a local page goes to macOS open", async () => {
  const H = world({ files: { "/w/s1/o.json": outputsFile([decl("data.csv", 2), decl("http://localhost:3000/a.html", 1)]) } });
  const m = await mount("hws-work", { view: "outputs" });
  await m.click("output-t1-data.csv");
  assert.deepEqual(H.calls.at(-1), { command: "open", args: ["/w/s1/data.csv"] });
  await m.click("output-t1-http://localhost:3000/a.html");
  assert.deepEqual(H.calls.at(-1), { command: "open", args: ["http://localhost:3000/a.html"] });
  assert.equal(hwsCalls(H).length, 0);
});

test("an open failure shows in the panel", async () => {
  const H = world({ files: { "/w/s1/o.json": outputsFile([decl("plan.md", 1)]) } });
  H.hws["surface open"] = { fail: "terminal t1 is gone" };
  const m = await mount("hws-work", { view: "outputs" });
  await m.click("output-t1-plan.md");
  assert.match(m.text(), /terminal t1 is gone/);
  assert.equal(m.has("note"), true);
});

// Polling

const sessionsPolls = (H) => H.calls.filter((c) => c.command === "agent-brief" && c.args[0] === "sessions").length;

test("Tasks polls every 10 seconds and keeps polling while hidden", async () => {
  const H = world({ layout: panelLayout(true, "files") });
  const m = await mount("hws-work", { view: "tasks" });
  assert.deepEqual(m.timers.map((x) => x.ms), [10000]);
  assert.equal(sessionsPolls(H), 1);
  await m.fireTimer(10000);
  assert.equal(sessionsPolls(H), 2);
});

test("Outputs polls only while it is showing", async () => {
  const H = world({ layout: panelLayout(true, "outputs") });
  const m = await mount("hws-work", { view: "outputs" });
  assert.equal(sessionsPolls(H), 1);
  await m.fireTimer(10000);
  assert.equal(sessionsPolls(H), 1);
  H.layout = panelLayout(false, "outputs");
  await m.fireTimer(10000);
  assert.equal(sessionsPolls(H), 2);
});

test("a .feedback change reloads the panel", async () => {
  let fire;
  const H = world({ files: { "/w/s1/i.md": "- [ ] #1 One\n" } });
  H.watchResult = () => new Promise((resolve) => { fire = resolve; });
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("card-t1-2"), false);
  H.files["/w/s1/i.md"] = "- [ ] #1 One\n- [ ] #2 Two\n";
  fire(["/w/s1/.feedback"]);
  await settle();
  assert.equal(m.has("card-t1-2"), true);
});

// Source checks

test("hws-work uses only methods and imports Herdr provides", () => {
  const kit = readFileSync(`${process.env.HOME}/.config/herdr-app/gpui-kit.d.ts`, "utf8");
  const unknown = usedMethods().filter((name) => !new RegExp(`\\b${name}\\s*[<(]`).test(kit));
  assert.deepEqual(unknown, []);
  const herdr = readFileSync(`${process.env.HOME}/.config/herdr-app/herdr.d.ts`, "utf8");
  for (const file of ["../hws-work/main.js", "../hws-work/open.js", "../hws-work/todo.js", "../hws-brief/main.js"]) {
    const names = /import \{([^}]*)\} from "herdr"/.exec(read(file))[1].split(",").map((s) => s.trim());
    for (const name of names) assert.match(herdr, new RegExp(`export function ${name}\\b`), `${file}: ${name}`);
  }
});
