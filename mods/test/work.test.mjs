import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { setup, mount, settle, hwsCalls, usedMethods } from "./harness.mjs";
import { modelsLine, ago, cardSessions, cardStory, cardSummary, cardTimes, describeSession, locateTerminal, mergeWaiting, orchestratorFolder, ownerTag, parseOutputs, replyEnded, roster, sendTargets, sessionFor, severalDialogHeight, storyHeight, todoColumns, todoDialogSize, todoLayout } from "../hws-work/data.js";

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

// Tasks view

const live = (address, extra = {}) => ({ address, state: "live", labels: {}, ...extra });

test("Tasks is four columns at every width", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "One"), todo("a2", "Two", { column: "doing" }), todo("a3", "Three", { column: "waiting" }), todo("a4", "Four", { column: "done" }));
  const m = await mount("hws-work", { view: "tasks" });
  for (const width of [368, 860]) {
    widen(m, width);
    assert.equal(m.has("board"), true);
    for (const lane of ["scroll-todo", "scroll-doing", "scroll-waiting", "scroll-done"]) assert.equal(m.has(lane), true);
  }
  assert.match(m.text(), /^Tasks \| 3/);
  assert.match(m.text(), /To do \| 1.*In progress \| 1.*Waiting on you \| 1.*Done \| 1/);
  assert.equal(/\bBoard\b/.test(m.text()), false);
});

test("the lanes share the width when they fit and take 200px each when they do not", async () => {
  world();
  const m = await mount("hws-work", { view: "tasks" });
  widen(m, 839);
  for (const key of ["todo", "doing", "waiting", "done"]) assert.equal(findNode(m, `lane-${key}`).w, 200);
  widen(m, 840);
  for (const key of ["todo", "doing", "waiting", "done"]) assert.equal(findNode(m, `lane-${key}`).w, 199);
});

test("the header has no Expand or Collapse control", async () => {
  world();
  const m = await mount("hws-work", { view: "tasks" });
  widen(m, 368);
  assert.equal(m.has("expand"), false);
  assert.equal(/Expand|Collapse/.test(m.text()), false);
});

test("Tasks shows only hws cards and never asks Agent Brief", async () => {
  const H = world({ files: { "/w/s1/i.md": "- [ ] #1 Pick a name\n  Claude: Which one?\n" } });
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  await m.fireTimer(10000);
  assert.equal(H.calls.some((c) => c.command === "agent-brief"), false);
  assert.equal(H.reads.length, 0);
  assert.equal(/Pick a name|#1/.test(m.text()), false);
  assert.equal(m.has("todo-a1"), true);
  assert.equal(m.has("quiet"), false);
});

test("the Waiting on you count equals the cards waiting on you", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Pick a host", { column: "waiting", note: "Which host?" }), todo("a2", "Other", { column: "waiting" }), todo("a3", "Busy", { column: "doing" }));
  const m = await mount("hws-work", { view: "tasks" });
  m.render();
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.tasks.waiting", value: { spc1: 2 } });
  assert.match(m.text(), /Waiting on you \| 2 \| Pick a host \| Which host\?/);
});

test("mergeWaiting sets the board's spaces, keeps the rest and reports no change as null", () => {
  assert.deepEqual(mergeWaiting({ spz: 4, spc1: 0 }, ["spc1", "spc2"], 2), { spz: 4, spc1: 2, spc2: 2 });
  assert.equal(mergeWaiting({ spz: 4, spc1: 2, spc2: 2 }, ["spc1", "spc2"], 2), null);
  for (const old of [3, null, undefined, "x", [1]]) assert.deepEqual(mergeWaiting(old, ["spc1"], 0), { spc1: 0 });
});

test("Tasks merges its count for every space on the board and keeps other spaces' counts", async () => {
  const H = world();
  H.sharedValues["hws.tasks.waiting"] = { spz: 4, spc2: 9 };
  H.hws["todo list"] = { ...todoList(todo("a1", "Pick a host", { column: "waiting" })), spaces: ["spc2", "spb"], workspace: "w1" };
  await mount("hws-work", { view: "tasks" });
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.tasks.waiting", value: { spz: 4, spc2: 1, spb: 1, spc1: 1 } });
});

test("Tasks sets the waiting map once, and only when it changes", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Pick a host", { column: "waiting" }));
  const m = await mount("hws-work", { view: "tasks" });
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.tasks.waiting", value: { spc1: 1 } });
  H.sharedValues["hws.tasks.waiting"] = { spc1: 1, spz: 3 };
  const before = H.sharedSets.length;
  m.render();
  await m.fireTimer(10000);
  assert.equal(H.sharedSets.length, before);
});

test("the waiting count drops to 0 when nothing waits", async () => {
  const H = world({ agents: [] });
  H.sharedValues["hws.tasks.waiting"] = 3;
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  await mount("hws-work", { view: "tasks" });
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.tasks.waiting", value: { spc1: 0 } });
});

test("a failed first load still sets the waiting count", async () => {
  const H = world();
  H.sharedValues["hws.tasks.waiting"] = { spc1: 3 };
  H.hws["todo list"] = { fail: "the to-do file is damaged" };
  await mount("hws-work", { view: "tasks" });
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.tasks.waiting", value: { spc1: 0 } });
});

test("a failed reload keeps the count for the spaces the board last listed", async () => {
  const H = world();
  H.hws["todo list"] = { ...todoList(todo("a1", "Pick a host", { column: "waiting" })), spaces: ["spc1", "spb"], workspace: "w1" };
  const m = await mount("hws-work", { view: "tasks" });
  H.sharedValues["hws.tasks.waiting"] = { spz: 2 };
  H.hws["todo list"] = { fail: "the to-do file is damaged" };
  await m.fireTimer(10000);
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.tasks.waiting", value: { spz: 2, spc1: 1, spb: 1 } });
});

test("Outputs never touches the waiting count", async () => {
  const H = world({ files: { "/w/s1/o.json": outputsFile([decl("a.md", 1)]) } });
  const m = await mount("hws-work", { view: "outputs" });
  m.render();
  assert.deepEqual(H.sharedSets, []);
});

test("Outputs loads only the active space's agents", async () => {
  const H = world({
    agents: [agent("t1"), agent("t9", "tb9", "spc2")],
    sessions: [session("s1", "t1"), session("s9", "t9")],
    files: { "/w/s1/o.json": outputsFile([decl("a.md", 1)]), "/w/s9/o.json": outputsFile([decl("b.md", 1)]) },
  });
  const m = await mount("hws-work", { view: "outputs" });
  m.render();
  await settle();
  assert.equal(H.reads.includes("/w/s9/o.json"), false);
  assert.equal(H.reads.includes("/w/s1/o.json"), true);
  assert.equal(H.reads.some((r) => String(r).endsWith(".md")), false);
  assert.deepEqual([...new Set(H.watches)], ["/w/s1/.feedback"]);
});

test("a folder match without the exact terminal does not bind", async () => {
  world({ sessions: [{ ...session("s1", "t1"), host: { bundleId: "dev.herdr.app" } }], files: { "/w/s1/o.json": outputsFile([decl("a.md", 1)]) } });
  const m = await mount("hws-work", { view: "outputs" });
  assert.equal(m.has("output-t1-a.md"), false);
  assert.match(m.text(), /no session/);
});

// Quiet line

const quietOf = (m) => findNode(m, "quiet");
const quietText = (m) => textOf(quietOf(m));

test("agent-brief failing shows on Outputs", async () => {
  world({ sessionsResult: () => { throw new Error("spawn ENOENT"); } });
  const outputs = await mount("hws-work", { view: "outputs" });
  assert.match(outputs.text(), /Could not run agent-brief: spawn ENOENT/);

  world({ sessionsResult: () => ({ code: 1, stdout: "", stderr: "Agent Brief is not running. Start it.\nmore\n" }) });
  const stopped = await mount("hws-work", { view: "outputs" });
  assert.match(stopped.text(), /Agent Brief is not running\. Start it\./);
  assert.equal(/\bmore\b/.test(stopped.text()), false);
});

test("Outputs says when a space has no Claude agents or runs on another machine", async () => {
  world({ agents: [] });
  const m = await mount("hws-work", { view: "outputs" });
  assert.match(m.text(), /No Claude Code agents in this space/);

  world({ spaces: [{ ...SPACES[0], machine: "vm" }] });
  const m2 = await mount("hws-work", { view: "outputs" });
  assert.match(m2.text(), /another machine/);
});

// To-dos on the board

test("todoColumns sorts cards into the four columns in list order", () => {
  const columns = todoColumns([todo("a", "A"), todo("b", "B", { column: "doing" }), todo("c", "C", { column: "done" }), todo("d", "D", { column: "waiting" }), todo("e", "E")]);
  assert.deepEqual(Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, v.map((c) => c.id)])), { todo: ["a", "e"], doing: ["b"], waiting: ["d"], done: ["c"] });
});

test("ownerTag gives one tag in To do and only Mine elsewhere", () => {
  assert.equal(ownerTag({ column: "todo", owner: "mine" }), "Mine");
  assert.equal(ownerTag({ column: "todo", owner: "unassigned" }), "Needs your OK");
  assert.equal(ownerTag({ column: "todo", owner: "agent" }), "Ready");
  assert.equal(ownerTag({ column: "doing", owner: "mine" }), "Mine");
  assert.equal(ownerTag({ column: "doing", owner: "agent" }), null);
  assert.equal(ownerTag({ column: "done", owner: "unassigned" }), null);
});

test("cardSummary shows the result, and otherwise the brief's first line", () => {
  assert.equal(cardSummary({ note: " done \n\nchecked", notes: "brief" }), "done checked");
  assert.equal(cardSummary({ column: "done", report: "**Shipped** it\n\n- `a.js`", notes: "brief" }), "Shipped it - a.js");
  assert.equal(cardSummary({ column: "doing", report: "old run", notes: "\n  first \nsecond" }), "first");
  assert.equal(cardSummary({}), "");
});

test("cardStory leads with the report once a card has ended", () => {
  assert.deepEqual(cardStory({ column: "done", note: "short", report: "long" }), { label: "What happened", text: "long" });
  assert.deepEqual(cardStory({ column: "waiting", note: "Which?", report: "" }), { label: "Latest update", text: "Which?" });
  assert.deepEqual(cardStory({ column: "doing", note: "now", report: "old run" }), { label: "Latest update", text: "now" });
  assert.equal(cardStory({ column: "done", note: "", report: "" }), null);
});

test("cardStory keeps the person's replies after the update", () => {
  const story = cardStory({ column: "done", report: "Renamed it", replies: [{ question: "Which name?", answer: "Small Tools" }] });
  assert.match(story.text, /^Renamed it\n\n\*\*Your replies\*\*\n\n- Which name\? \*\*You:\*\* Small Tools$/);
});

test("storyHeight fits short text and caps long text", () => {
  assert.equal(storyHeight("one line"), 48);
  assert.equal(storyHeight("x\n".repeat(6)), 126);
  assert.equal(storyHeight("x\n".repeat(50)), 360);
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

test("a workspace's agents are all send targets and name their space", () => {
  const lists = {
    agents: [{ address: "t1", space: "a", tab: "ta", program: { name: "Claude Code" } }, { address: "t2", space: "b", tab: "tb", program: { name: "Codex" } }, { address: "t3", space: "c", tab: "tc", program: { name: "Codex" } }],
    panes: [],
    terminals: [],
    spaces: [{ id: "a", name: "api", tabs: [{ id: "ta", name: "1" }] }, { id: "b", name: "web", tabs: [{ id: "tb", name: "2" }] }, { id: "c", name: "other", tabs: [{ id: "tc", name: "3" }] }],
  };
  assert.deepEqual(sendTargets(lists, "a", ["a", "b"]).map((x) => [x.address, x.tab]), [["t1", "api · 1"], ["t2", "web · 2"]]);
});

test("the roster covers every space in the active workspace", () => {
  const claude = { key: "claude", name: "Claude Code" };
  const lists = {
    agents: [{ address: "t1", space: "a", tab: "ta", app: "claude-code", program: claude }, { address: "t2", space: "b", tab: "tb", app: "claude-code", program: claude }, { address: "t3", space: "c", tab: "tc", app: "claude-code", program: claude }],
    panes: [],
    terminals: [],
    spaces: [{ id: "a", active: true, tabs: [{ id: "ta" }] }, { id: "b", tabs: [{ id: "tb" }] }, { id: "c", tabs: [{ id: "tc" }] }],
  };
  assert.deepEqual(roster(lists, ["a", "b"]).map((x) => x.address), ["t1", "t2"]);
  assert.deepEqual(roster(lists).map((x) => x.address), ["t1"]);
});

test("Tasks shows each card with its summary and who runs it", async () => {
  const H = world({
    agents: [{ ...agent("t1"), program: { key: "claude", name: "Claude Code" } }],
    terminals: [live("t1", { status: "working" })],
  });
  H.hws["todo list"] = todoList(todo("a1", "Fix login", { notes: "\nCheck the token\nmore" }), todo("a2", "Ship", { column: "doing", terminal: "t1" }), todo("a3", "Old", { column: "done", terminal: "t8" }));
  const m = await mount("hws-work", { view: "tasks" });
  widen(m, 860);
  assert.match(m.text(), /Tasks \| 2 open/);
  assert.match(m.text(), /To do \| 1 \| Fix login \| Check the token/);
  assert.match(m.text(), /In progress \| 1 \| Ship \| Run by Claude Code · Working/);
  assert.match(m.text(), /Waiting on you \| 0/);
  assert.match(m.text(), /Done \| 1 \| Archive done \| Old/);
  assert.equal(/\bt8\b/.test(m.text()), false);
  assert.deepEqual(hwsCalls(H).find((c) => c.args[0] === "todo").args, ["todo", "list", "--space", "spc1", "--json"]);
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
  const H = world();
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

test("+ Add opens a new to-do for the active space", async () => {
  const H = world();
  H.hws["todo list"] = todoList();
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("add");
  assert.deepEqual(H.overlays.map((o) => o.props), [{ space: "spc1", members: [], view: "todo", height: 480 }]);
  assert.equal(H.overlays[0].mod, "hws-work");
  assert.equal(H.overlays[0].kind, "dialog");
});

test("Add several opens its own dialog for the active space", async () => {
  const H = world();
  H.hws["todo list"] = todoList();
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("add-several");
  assert.deepEqual(H.overlays[0].props, { space: "spc1", members: [], view: "add-several" });
  assert.equal(H.overlays[0].height, 342);
});

test("the to-do dialog fills the Board up to its limit and never below its floor", () => {
  assert.deepEqual(todoDialogSize({ width: 2000, height: 1200 }), { width: 920, height: 820 });
  assert.deepEqual(todoDialogSize({ width: 800, height: 600 }), { width: 760, height: 560 });
  assert.deepEqual(todoDialogSize({ width: 300, height: 200 }), { width: 560, height: 480 });
  assert.equal(severalDialogHeight(), 342);
});

test("the notes box takes the height a report leaves", () => {
  const empty = todoLayout({ height: 820, waiting: false, story: null });
  assert.equal(empty.story, 0);
  assert.ok(empty.notes > 500);

  const short = todoLayout({ height: 820, waiting: false, story: { text: "One line" } });
  assert.equal(short.story, 48);
  assert.ok(short.notes > 400);

  const long = todoLayout({ height: 820, waiting: false, story: { text: "x\n".repeat(50) } });
  assert.ok(long.story <= long.notes);
  assert.equal(todoLayout({ height: 200, waiting: true, story: null }).notes, 96);
});

test("opening a card passes the dialog its size", async () => {
  const H = world({ agents: [agent("t1")] });
  H.hws["todo list"] = todoList(todo("a1", "One"));
  const m = await mount("hws-work", { view: "tasks" });
  m.render().node.handlers.on_size_change({ width: 1600, height: 1000 }, m.cx);
  press(m, "todo-a1");
  await release(m, "todo-a1", "lane-todo", "root");
  assert.deepEqual([H.overlays[0].width, H.overlays[0].height, H.overlays[0].props.height], [920, 820, 820]);
});

// Adding from the board

const QUICK_PLACEHOLDER = "Add a card, press Enter";
const adds = (H) => hwsCalls(H).filter((c) => c.args[0] === "todo" && c.args[1] === "add");

test("Enter in the To do input adds a card, empties it and keeps focus", async () => {
  const H = world();
  H.hws["todo list"] = todoList();
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("quick-add"), true);
  m.view.quick.type("  -dash first ", m.cx);
  H.focusCalls.length = 0;
  m.view.quick.submit(m.cx);
  await settle();
  assert.deepEqual(adds(H)[0].args, ["todo", "add", "--title=-dash first", "--space", "spc1", "--json"]);
  assert.equal(m.view.quick.value(), "");
  assert.deepEqual(H.focusCalls, [QUICK_PLACEHOLDER]);
  assert.equal(todoLists(H), 2);
});

test("a blank To do input adds nothing", async () => {
  const H = world();
  H.hws["todo list"] = todoList();
  const m = await mount("hws-work", { view: "tasks" });
  m.view.quick.type("   ", m.cx);
  m.view.quick.submit(m.cx);
  await settle();
  assert.equal(adds(H).length, 0);
});

test("a failed add shows on the quiet line and gives the text back", async () => {
  const H = world();
  H.hws["todo list"] = todoList();
  H.hws["todo add"] = { fail: "the to-do file is damaged" };
  const m = await mount("hws-work", { view: "tasks" });
  m.view.quick.type("Buy milk", m.cx);
  m.view.quick.submit(m.cx);
  await settle();
  assert.match(quietText(m), /the to-do file is damaged/);
  assert.equal(m.view.quick.value(), "Buy milk");
});

test("a failed add leaves later typing alone", async () => {
  const H = world();
  H.hws["todo list"] = todoList();
  H.hws["todo add"] = { fail: "no" };
  const m = await mount("hws-work", { view: "tasks" });
  m.view.quick.type("First", m.cx);
  m.view.quick.submit(m.cx);
  m.view.quick.type("Second", m.cx);
  await settle();
  assert.equal(m.view.quick.value(), "Second");
});

// Empty board and cards

test("an empty board says what it is for", async () => {
  const H = world({ files: { "/w/s1/i.md": "" } });
  H.hws["todo list"] = todoList();
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(m, "board-hint")), "Add a card, press Allow on it, then press Run.");
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  await m.fireTimer(10000);
  assert.equal(m.has("board-hint"), false);
});

test("a board that has not listed its to-dos shows no hint", async () => {
  const H = world({ files: { "/w/s1/i.md": "" } });
  H.hws["todo list"] = { fail: "the to-do file is damaged" };
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("board-hint"), false);
  for (const key of ["todo", "doing", "waiting", "done"]) assert.equal(m.has(`empty-${key}`), false);
});

test("each empty column says what lands there, and an empty board's To do says how to start", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Fix login"));
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("empty-todo"), false);
  assert.equal(textOf(findNode(m, "empty-doing")), "Cards an agent is working on");
  assert.equal(textOf(findNode(m, "empty-waiting")), "Cards that need your answer");
  assert.equal(textOf(findNode(m, "empty-done")), "Cards an agent has finished");
  H.hws["todo list"] = todoList();
  await m.fireTimer(10000);
  assert.equal(m.has("board-hint"), true);
  assert.equal(m.has("empty-todo"), false);
  assert.equal(m.has("empty-doing"), true);
  H.hws["todo list"] = todoList(todo("a2", "Ship", { column: "done" }));
  await m.fireTimer(10000);
  assert.equal(textOf(findNode(m, "empty-todo")), "Cards nobody has started");
});

test("the heading names the workspace and says what its number counts", async () => {
  const H = world();
  H.hws["todo list"] = { ...todoList(todo("a1", "One"), todo("a2", "Two", { column: "waiting" }), todo("a3", "Three", { column: "done" })), spaces: ["spc1"], workspace: "w1" };
  H.hws.list = [{ id: "w0", name: "other" }, { id: "w1", name: "checkout demo" }];
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(m, "heading")), "Tasks · checkout demo");
  assert.equal(textOf(findNode(m, "heading-count")), "2 open");
  await m.fireTimer(10000);
  assert.equal(hwsCalls(H).filter((c) => c.args[0] === "list").length, 1);
});

test("the heading reads Tasks until the workspace name loads, and asks again after a failure", async () => {
  const H = world();
  H.hws["todo list"] = { ...todoList(), spaces: ["spc1"], workspace: "w1" };
  H.hws.list = { fail: "no state" };
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(m, "heading")), "Tasks");
  H.hws.list = [{ id: "w1", name: "checkout demo" }];
  await m.fireTimer(10000);
  assert.equal(textOf(findNode(m, "heading")), "Tasks · checkout demo");
});

test("board controls share one button look and Allow is the card's primary button", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "One", { owner: "unassigned" }), todo("a2", "Two", { owner: "unassigned" }), todo("a3", "Done", { column: "done" }));
  const m = await mount("hws-work", { view: "tasks" });
  for (const id of ["add", "add-several", "allow-all", "archive-done"]) {
    assert.equal(findNode(m, id).bg, "color:raised", id);
    assert.equal(findNode(m, id).text_color, "color:foreground", id);
  }
  assert.equal(findNode(m, "allow-a1").bg, "color:solid");
  assert.equal(findNode(m, "allow-a1").text_color, "color:solid_foreground");
});

test("a card shows note in place of notes, with owner and Worktree tags", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "With note", { notes: "Plain notes", note: "Blocked on review\nmore" }), todo("a2", "Without", { notes: "Plain notes", owner: "mine", worktree: true }));
  const m = await mount("hws-work", { view: "tasks" });
  assert.match(textOf(findNode(m, "todo-a1")), /With note \| Blocked on review more/);
  assert.equal(m.has("tags-a1"), false);
  assert.equal(textOf(findNode(m, "tags-a2")), "Mine | Worktree");
  assert.match(textOf(findNode(m, "todo-a2")), /Without \| Plain notes/);
});

// Archive done

const archives = (H) => hwsCalls(H).filter((c) => c.args[0] === "todo" && c.args[1] === "archive");
const doneWorld = (...items) => {
  const H = world();
  H.hws["todo list"] = todoList(...items);
  return H;
};

test("Archive done shows only when Done has a card", async () => {
  doneWorld(todo("a1", "Open"));
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("archive-done"), false);

  doneWorld(todo("a1", "Open"), todo("d1", "Shipped", { column: "done" }));
  const n = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(n, "archive-done")), "Archive done");
});

test("Archive done asks in place and runs nothing until confirmed", async () => {
  const H = doneWorld(todo("d1", "One", { column: "done" }), todo("d2", "Two", { column: "done" }));
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("archive-done");
  assert.equal(textOf(findNode(m, "archive-confirm")), "Archive 2 done cards? | Cancel | Archive");
  assert.equal(m.has("archive-done"), false);
  assert.deepEqual(archives(H), []);
  await m.click("archive-done-no");
  assert.equal(m.has("archive-confirm"), false);
  assert.equal(m.has("archive-done"), true);
  assert.deepEqual(archives(H), []);
});

test("moving the pointer off the archive question cancels it", async () => {
  const H = doneWorld(todo("d1", "One", { column: "done" }));
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("archive-done");
  assert.match(textOf(findNode(m, "archive-confirm")), /^Archive 1 done card\?/);
  hover(m, "archive-confirm", true);
  assert.equal(m.has("archive-confirm"), true);
  hover(m, "archive-confirm", false);
  assert.equal(m.has("archive-confirm"), false);
  assert.deepEqual(archives(H), []);
});

test("confirming Archive done runs hws todo archive --done and reloads", async () => {
  const H = doneWorld(todo("a1", "Open"), todo("d1", "One", { column: "done" }), todo("d2", "Two", { column: "done" }));
  H.hws["todo archive"] = () => {
    H.hws["todo list"] = todoList(todo("a1", "Open"));
    return { archived: ["d1", "d2"] };
  };
  const m = await mount("hws-work", { view: "tasks" });
  const lists = todoLists(H);
  await m.click("archive-done");
  await m.click("archive-done-yes");
  assert.deepEqual(archives(H), [{ args: ["todo", "archive", "--done", "--space", "spc1", "--json"] }]);
  assert.equal(todoLists(H), lists + 1);
  assert.equal(m.has("todo-d1"), false);
  assert.equal(m.has("archive-done"), false);
  assert.match(m.text(), /Done \| 0/);
});

test("Archive done reads Archiving and is off while the command runs", async () => {
  let finish;
  const H = doneWorld(todo("d1", "One", { column: "done" }));
  const realExec = H.exec;
  H.exec = (command, args) => (args?.[1] === "archive" ? new Promise((resolve) => { finish = () => resolve({ code: 0, stdout: "{}", stderr: "" }); }) : realExec(command, args));
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("archive-done");
  await m.click("archive-done-yes");
  assert.equal(textOf(findNode(m, "archive-done")), "Archiving…");
  assert.equal(m.clickable("archive-done"), false);
  finish();
  await settle();
  assert.equal(textOf(findNode(m, "archive-done")), "Archive done");
});

test("an Archive done failure goes on the quiet line and keeps the cards", async () => {
  const H = doneWorld(todo("d1", "One", { column: "done" }));
  H.hws["todo archive"] = { fail: "unknown option --done" };
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("archive-done");
  await m.click("archive-done-yes");
  assert.match(quietText(m), /unknown option --done/);
  assert.equal(m.has("todo-d1"), true);
  assert.equal(m.clickable("archive-done"), true);
});

test("Done keeps its N more row with to-dos in it", async () => {
  const H = world();
  H.hws["todo list"] = todoList(...Array.from({ length: 10 }, (_, i) => todo(`d${i}`, `Done ${i}`, { column: "done" })));
  const m = await mount("hws-work", { view: "tasks" });
  assert.match(m.text(), /2 more/);
  assert.equal(m.has("todo-d9"), false);
  await m.click("done-more");
  assert.equal(m.has("todo-d9"), true);
});

test("a Done card is compact, with its title, one line of summary and Open or Resume", async () => {
  const H = world({ agents: [named], terminals: [live("t1", { status: "idle" }), { address: "t8", state: "exited" }] });
  H.hws["todo list"] = todoList(
    todo("d1", "Live", { column: "done", terminal: "t1", report: "Changed the host\n\nChecked it", owner: "mine", worktree: true, addedBy: "t2" }),
    todo("d2", "Saved", { column: "done", terminal: "t8", session: { tool: "claude", id: "c1", folder: "/w" } }),
    todo("d3", "Gone", { column: "done", terminal: "t8" }),
  );
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(m, "todo-d1")), "Live | Open | Changed the host Checked it");
  assert.equal(m.has("tags-d1"), false);
  assert.equal(m.has("session-d1"), false);
  assert.equal(textOf(findNode(m, "todo-d2")), "Saved | Resume");
  assert.equal(textOf(findNode(m, "todo-d3")), "Gone");
  await m.click("open-d1");
  assert.deepEqual(H.runs.at(-1), { name: "terminal.peek", args: { terminal: "t1" } });
});

test("a compact Done card still opens and drags from its body", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("d1", "Shipped", { column: "done" }));
  const m = await mount("hws-work", { view: "tasks" });
  press(m, "todo-d1");
  await release(m, "todo-d1", "lane-done", "root");
  assert.equal(H.overlays.at(-1).props.id, "d1");
  press(m, "todo-d1");
  hover(m, "lane-todo", true);
  await release(m, "lane-todo", "root");
  assert.deepEqual(moves(H).at(-1).args.slice(0, 6), ["todo", "move", "--id", "d1", "--column", "todo"]);
});

// Orchestrator

const ORCH_ARGS = ["orchestrator", "start", "--space", "spc1", "--folder", "/w/proj", "--json"];
const orchCalls = (H) => hwsCalls(H).filter((c) => c.args[0] === "orchestrator");
const orchWorld = (orchestrator, extra = {}) => {
  const H = world({ panes: [{ pane: "p-t1", terminal: "t1", tab: "tb1", cwd: "/w/proj" }], ...extra });
  H.hws["todo list"] = { items: [], orchestrator };
  return H;
};

test("orchestratorFolder prefers the first agent's folder, then the space's", () => {
  const spaces = [{ ...SPACES[0], folder: "/space/dir" }];
  assert.equal(orchestratorFolder({ agents: [agent("t1")], panes: [{ pane: "p-t1", cwd: "/w/proj" }], terminals: [], spaces }, "spc1"), "/w/proj");
  assert.equal(orchestratorFolder({ agents: [], panes: [], terminals: [], spaces }, "spc1"), "/space/dir");
  assert.equal(orchestratorFolder({ agents: [], panes: [], terminals: [], spaces: [{ ...SPACES[0], folder: "" }] }, "spc1"), null);
  assert.equal(orchestratorFolder({ agents: [], panes: [], terminals: [], spaces }, "gone"), null);
});

test("orchestratorFolder reads a flipped agent's folder from its terminal", () => {
  const lists = {
    agents: [],
    panes: [{ pane: "chat1", mod: "hws-chat", tab: "tb1" }],
    terminals: [{ address: "t5", state: "live", labels: { "herdr.chat": "chat1" }, foreground: { cwd: "/w/flip" } }],
    spaces: SPACES,
  };
  assert.equal(orchestratorFolder(lists, "spc1"), "/w/flip");
});

test("locateTerminal finds a pane, then a flipped agent's chat pane, then nothing", () => {
  const panes = [{ pane: "p9", terminal: "t9", tab: "tb2" }, { pane: "chat1", terminal: null, mod: "hws-chat", tab: "tb1" }];
  const terminals = [{ address: "t5", state: "live", labels: { "herdr.chat": "chat1" } }, { address: "t6", state: "exited", labels: { "herdr.chat": "chat1" } }];
  assert.deepEqual(locateTerminal({ panes, terminals }, "t9"), { tab: "tb2", chatPane: null });
  assert.deepEqual(locateTerminal({ panes, terminals }, "t5"), { tab: "tb1", chatPane: "chat1" });
  assert.equal(locateTerminal({ panes, terminals }, "t6"), null);
  assert.equal(locateTerminal({ panes, terminals }, "t7"), null);
});

const CONTROLS = ["orchestrating", "run-board", "orchestrator-go", "orchestrator-stop"];
const headerHasNoOrchestrator = (m) => CONTROLS.forEach((id) => assert.equal(m.has(id), false, id));

test("with none running the header says nothing about orchestration", async () => {
  orchWorld(null);
  const m = await mount("hws-work", { view: "tasks" });
  headerHasNoOrchestrator(m);
  assert.equal(m.text().includes("orchestrator"), false);
  assert.equal(m.has("add"), true);
});

test("a recorded orchestrator that is no longer live counts as none running", async () => {
  orchWorld({ terminal: "t9", live: false });
  const m = await mount("hws-work", { view: "tasks" });
  headerHasNoOrchestrator(m);
});

test("the header waits for the first list before showing the mode", async () => {
  const H = world();
  H.hws["todo list"] = { fail: "the to-do file is damaged" };
  const m = await mount("hws-work", { view: "tasks" });
  headerHasNoOrchestrator(m);
});

test("while one runs the header labels the mode, offers Run and Go to and Stop", async () => {
  const H = orchWorld({ terminal: "t1", live: true });
  H.hws["todo list"].items = [todo("r1", "Ready", { owner: "agent" })];
  const m = await mount("hws-work", { view: "tasks" });
  const label = findNode(m, "orchestrating");
  assert.equal(textOf(label), "Orchestrating");
  assert.equal(label.text_color, "color:accent");
  assert.equal(label.handlers.on_click, undefined);
  assert.match(textOf(findNode(m, "run-board")), /Run 1 ready/);
  assert.equal(textOf(findNode(m, "orchestrator-stop")), "Stop");
  const lists = todoLists(H);
  await m.click("run-board");
  assert.deepEqual(orchCalls(H).at(-1).args, ORCH_ARGS);
  assert.equal(todoLists(H), lists + 1);
  await m.click("orchestrator-go");
  assert.deepEqual(H.runs.at(-1), { name: "pane.focus", args: { terminal: "t1" } });
});

test("Run uses the space's folder when no agent reports one", async () => {
  const H = orchWorld({ terminal: "t9", live: true }, { agents: [], spaces: [{ ...SPACES[0], folder: "/space/dir" }] });
  H.hws["todo list"].items = [todo("r1", "Ready", { owner: "agent" })];
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("run-board");
  assert.deepEqual(orchCalls(H).at(-1).args, ["orchestrator", "start", "--space", "spc1", "--folder", "/space/dir", "--json"]);
});

test("Run cannot run twice at once", async () => {
  let finish;
  const H = orchWorld({ terminal: "t1", live: true });
  H.hws["todo list"].items = [todo("r1", "Ready", { owner: "agent" })];
  const realExec = H.exec;
  H.exec = (command, args) => (args?.[0] === "orchestrator" ? new Promise((resolve) => { finish = () => resolve({ code: 0, stdout: "{}", stderr: "" }); }) : realExec(command, args));
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("run-board");
  assert.equal(m.clickable("run-board"), false);
  assert.equal(m.clickable("orchestrator-stop"), false);
  finish();
  await settle();
  assert.equal(m.clickable("run-board"), true);
  assert.equal(m.clickable("orchestrator-stop"), true);
});

test("a Run failure goes on the quiet line", async () => {
  const H = orchWorld({ terminal: "t1", live: true });
  H.hws["todo list"].items = [todo("r1", "Ready", { owner: "agent" })];
  H.hws["orchestrator start"] = { fail: "claude is not installed" };
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("run-board");
  assert.match(quietText(m), /claude is not installed/);
  assert.equal(m.clickable("run-board"), true);
});

test("Run starts an orchestrator when none is running, and hides with nothing ready", async () => {
  const H = orchWorld(null);
  H.hws["todo list"].items = [todo("r1", "Ready", { owner: "agent" }), todo("r2", "Not yet", { owner: "unassigned" })];
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("run-board");
  assert.deepEqual(orchCalls(H).at(-1).args, ORCH_ARGS);

  const quiet = orchWorld(null);
  quiet.hws["todo list"].items = [todo("r2", "Not yet", { owner: "unassigned" })];
  const n = await mount("hws-work", { view: "tasks" });
  assert.equal(n.has("run-board"), false);
  assert.equal(textOf(findNode(n, "run-status")), "1 needs your OK");

  const two = orchWorld(null);
  two.hws["todo list"].items = [todo("r2", "Not yet", { owner: "unassigned" }), todo("r3", "Nor this", { owner: "unassigned" })];
  const o = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(o, "run-status")), "2 need your OK");
});

test("the header says when the orchestrator needs you or the run is finished", async () => {
  const silent = orchWorld({ terminal: "t9", live: true, startedAt: 1 }, { terminals: [{ address: "t9", state: "live", status: null }] });
  silent.hws["todo list"].items = [todo("a", "A", { column: "done" })];
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(m, "orchestrating")), "Orchestrator needs you, press Go to");

  const done = orchWorld({ terminal: "t9", live: true, startedAt: 1 }, { terminals: [{ address: "t9", state: "live", status: "done" }] });
  done.hws["todo list"].items = [todo("a", "A", { column: "done" })];
  const n = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(n, "orchestrating")), "Run finished");
});

test("a blocked worker shows in the header's status", async () => {
  const H = orchWorld(null, { terminals: [{ address: "t20", state: "live", status: "blocked", labels: { "hws.todo": "a" } }] });
  H.hws["todo list"].items = [todo("a", "A", { column: "doing", terminal: "t20" })];
  const m = await mount("hws-work", { view: "tasks" });
  assert.match(textOf(findNode(m, "run-status")), /^1 blocked, press Open · 1 running/);
});

const MODEL_SETTINGS = {
  orchestrator: { tool: "claude", model: "opus", effort: "high" },
  worker: { tool: "claude", model: "sonnet", effort: "medium" },
  catalog: {
    claude: { name: "Claude Code", models: [{ id: "opus", name: "Opus" }, { id: "sonnet", name: "Sonnet" }], recommendedWorker: "sonnet", efforts: ["low", "medium", "high"] },
    codex: { name: "Codex", models: [{ id: "gpt-6.1-sol", name: "GPT-6.1 Sol" }], recommendedWorker: "gpt-6.1-sol", efforts: ["low", "medium"] },
  },
  recommended: {
    orchestrator: { tool: "claude", model: "opus", effort: "high" },
    worker: { tool: "claude", model: "sonnet", effort: "medium" },
  },
};

test("modelsLine names the orchestrator and workers", () => {
  assert.equal(modelsLine(MODEL_SETTINGS), "Opus → Sonnet");
  assert.equal(modelsLine({ ...MODEL_SETTINGS, worker: { tool: "codex", model: "custom", effort: "low" } }), "Opus → custom");
});

test("the header shows the models and opens their dialog", async () => {
  const H = orchWorld(null);
  H.hws["models"] = MODEL_SETTINGS;
  const m = await mount("hws-work", { view: "tasks" });
  await settle();
  m.render();
  assert.equal(textOf(findNode(m, "models")), "Models | Opus → Sonnet");
  await m.click("models");
  assert.equal(H.overlays.at(-1).props.view, "models");
});

test("the Models dialog saves both roles and switching a worker's tool picks its recommended model", async () => {
  const H = world();
  H.hws["models"] = JSON.parse(JSON.stringify(MODEL_SETTINGS));
  H.hws["models set"] = {};
  const m = await mount("hws-work", { view: "models", space: "spc1", overlay: "ov9" });
  await settle();
  m.render();
  assert.equal(m.has("orchestrator-tool-codex"), false);
  await m.click("worker-tool-codex");
  m.render();
  await m.click("models-save");
  await settle();
  const saved = hwsCalls(H).filter((c) => c.args[0] === "models" && c.args[1] === "set").map((c) => c.args.slice(2, -1));
  assert.deepEqual(saved[1], ["--role", "worker", "--tool", "codex", "--model=gpt-6.1-sol", "--effort", "medium"]);
  assert.deepEqual(H.closed, ["ov9"]);
});

test("the Models dialog labels each row and swaps Use recommended for a note once the setup matches", async () => {
  const H = world();
  H.hws["models"] = { ...JSON.parse(JSON.stringify(MODEL_SETTINGS)), worker: { tool: "claude", model: "sonnet", effort: "low" } };
  const m = await mount("hws-work", { view: "models", space: "spc1", overlay: "ov9" });
  await settle();
  m.render();
  assert.match(textOf(findNode(m, "models-body")), /Recommended: Opus on high orchestrates, Sonnet on medium does the cards/);
  assert.match(textOf(findNode(m, "models-body")), /Tool.*Claude Code.*Codex.*Model.*Opus.*Sonnet.*Effort.*low/s);
  assert.equal(m.has("models-recommended-note"), false);
  await m.click("models-recommended");
  m.render();
  assert.equal(m.has("models-recommended"), false);
  assert.equal(textOf(findNode(m, "models-recommended-note")), "Using the recommended setup");
});

test("a worker silent since it was claimed counts as blocked", async () => {
  const H = orchWorld(null, { terminals: [{ address: "t20", state: "live", status: null, labels: { "hws.todo": "a" } }] });
  H.hws["todo list"].items = [todo("a", "A", { column: "doing", terminal: "t20", updatedAt: 1 })];
  const m = await mount("hws-work", { view: "tasks" });
  assert.match(textOf(findNode(m, "run-status")), /^1 blocked, press Open/);
});

test("a worker that has taken a turn is not blocked by staying quiet", async () => {
  const H = orchWorld(null, { terminals: [{ address: "t20", state: "live", status: null, turn: 2, labels: { "hws.todo": "a" } }] });
  H.hws["todo list"].items = [todo("a", "A", { column: "doing", terminal: "t20", updatedAt: 1 })];
  const m = await mount("hws-work", { view: "tasks" });
  assert.doesNotMatch(textOf(findNode(m, "run-status")), /blocked/);
});

test("the header counts what is running and what waits on you", async () => {
  const H = orchWorld(null);
  H.hws["todo list"].items = [todo("a", "A", { column: "doing" }), todo("b", "B", { column: "doing" }), todo("c", "C", { column: "waiting" })];
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(m, "run-status")), "2 running · 1 waiting on you");
});

test("Allow all assigns every unassigned To do card and appears only for two or more", async () => {
  const H = orchWorld(null);
  H.hws["todo list"].items = [todo("a", "A", { owner: "unassigned" }), todo("b", "B", { owner: "unassigned" }), todo("c", "C", { owner: "mine" }), todo("d", "D", { owner: "unassigned", column: "done" })];
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("allow-all");
  await settle();
  const assigned = hwsCalls(H).filter((c) => c.args[1] === "edit").map((c) => c.args[3]);
  assert.deepEqual(assigned, ["a", "b"]);

  const one = orchWorld(null);
  one.hws["todo list"].items = [todo("a", "A", { owner: "unassigned" })];
  const n = await mount("hws-work", { view: "tasks" });
  assert.equal(n.has("allow-all"), false);
});

test("a card whose session ended offers Resume only when its session was saved", async () => {
  const H = world({ terminals: [{ address: "t8", state: "exited" }] });
  H.hws["todo list"] = todoList(todo("a1", "Saved", { column: "done", terminal: "t8", session: { tool: "codex", id: "c1", folder: "/w" } }), todo("a2", "Unsaved", { column: "done", terminal: "t8" }));
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("resume-a2"), false);
  await m.click("resume-a1");
  await settle();
  assert.deepEqual(hwsCalls(H).find((c) => c.args[1] === "resume").args, ["todo", "resume", "--id", "a1", "--space", "spc1", "--json"]);
});

test("the dialog offers Resume for an ended session and runs it", async () => {
  const H = dialogWorld(todo("a1", "Old", { column: "done", terminal: "t8", session: { tool: "claude", id: "c1", folder: "/w" } }));
  H.terminals = [{ address: "t8", state: "exited" }];
  const m = await form(H, "a1");
  await m.click("session-resume-t8");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["todo", "resume", "--id", "a1", "--space", "spc1", "--json"]);
  assert.deepEqual(H.closed, ["ov9"]);
});

// A reply with nowhere to go

const SAVED = { tool: "claude", id: "c1", folder: "/w" };

test("replyEnded holds only for a card whose reply nothing can deliver", () => {
  assert.equal(replyEnded(todo("a", "x", { column: "waiting", terminal: "t8" }), false), true);
  assert.equal(replyEnded(todo("a", "x", { column: "waiting" }), false), true);
  assert.equal(replyEnded(todo("a", "x", { column: "waiting", terminal: "t8" }), true), false);
  assert.equal(replyEnded(todo("a", "x", { column: "waiting", terminal: "t8", session: SAVED }), false), false);
  assert.equal(replyEnded(todo("a", "x", { column: "done", terminal: "t8" }), false), true);
  assert.equal(replyEnded(todo("a", "x", { column: "done" }), false), false);
  assert.equal(replyEnded(todo("a", "x", { column: "doing", terminal: "t8" }), false), false);
  assert.equal(replyEnded(todo("a", "x", { column: "waiting", terminal: "t8", archived: true }), false), false);
});

test("a waiting card whose session ended unsaved offers Move to To do on the board", async () => {
  const H = world({ terminals: [live("t1"), { address: "t8", state: "exited" }] });
  H.hws["todo list"] = todoList(
    todo("w1", "Stuck", { column: "waiting", terminal: "t8" }),
    todo("w2", "Saved", { column: "waiting", terminal: "t8", session: SAVED }),
    todo("w3", "Live", { column: "waiting", terminal: "t1" }),
  );
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(m, "session-w1")), "Session ended | Move to To do");
  assert.equal(m.has("resume-w2"), true);
  assert.equal(m.has("move-todo-w2"), false);
  assert.equal(m.has("open-w3"), true);
  assert.equal(m.has("move-todo-w3"), false);
  press(m, "move-todo-w1");
  await m.click("move-todo-w1");
  assert.deepEqual(moves(H).at(-1).args, ["todo", "move", "--id", "w1", "--column", "todo", "--space", "spc1", "--json"]);
  assert.deepEqual(H.overlays, []);
});

test("the dialog swaps Reply for a plain sentence and Move to To do when the session ended unsaved", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", { column: "waiting", note: "Which host?", terminal: "t8", owner: "agent" }));
  H.terminals = [live("t1"), { address: "t8", state: "exited" }];
  const m = await form(H, "a1");
  assert.equal(m.has("reply-todo"), false);
  assert.match(textOf(findNode(m, "reply-ended")), /This session has ended and cannot be reopened\. \| Move to To do/);
  assert.equal(m.has("send-t1"), true);
  assert.notEqual(H.focusCalls.at(-1), REPLY_PLACEHOLDER);
  await m.click("move-todo");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["todo", "move", "--id", "a1", "--column", "todo", "--space", "spc1", "--json"]);
  assert.deepEqual(H.closed, ["ov9"]);
});

test("a waiting card with no session at all says so and offers Move to To do", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", { column: "waiting" }));
  const m = await form(H, "a1");
  assert.match(textOf(findNode(m, "reply-ended")), /No session runs this card, so it cannot take a reply\./);
});

test("a Done card whose session ended unsaved swaps Feedback for Move to To do", async () => {
  const H = dialogWorld(todo("a1", "Fix login", { column: "done", terminal: "t8" }));
  H.terminals = [{ address: "t8", state: "exited" }];
  const m = await form(H, "a1");
  assert.equal(m.has("reply-todo"), false);
  assert.match(m.text(), /Feedback \| This session has ended and cannot be reopened\./);
  m.view.form.title.type("Fix sign in", m.cx);
  await m.click("move-todo");
  assert.deepEqual(hwsCalls(H).slice(1).map((c) => c.args[1]), ["edit", "move"]);
});

test("a failed Move to To do shows in the dialog and keeps it open", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", { column: "waiting", terminal: "t8" }));
  H.hws["todo move"] = { fail: "no to-do a1 in space spc1" };
  const m = await form(H, "a1");
  await m.click("move-todo");
  assert.match(m.text(), /no to-do a1 in space spc1/);
  assert.deepEqual(H.closed, []);
});

test("Stop asks first and runs nothing until confirmed", async () => {
  const H = orchWorld({ terminal: "t1", live: true });
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("orchestrator-stop");
  assert.match(textOf(findNode(m, "orchestrator-confirm")), /^Stop orchestrator and its workers\? \| Cancel \| Stop$/);
  assert.equal(m.has("orchestrator-stop"), false);
  assert.equal(m.has("orchestrator"), false);
  assert.equal(m.has("orchestrating"), true);
  assert.deepEqual(orchCalls(H), []);
});

test("Cancel puts the controls back and stops nothing", async () => {
  const H = orchWorld({ terminal: "t1", live: true });
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("orchestrator-stop");
  await m.click("orchestrator-stop-no");
  assert.equal(m.has("orchestrator-confirm"), false);
  assert.equal(m.has("orchestrator-stop"), true);
  assert.deepEqual(orchCalls(H), []);
});

test("moving the pointer off the question cancels it", async () => {
  const H = orchWorld({ terminal: "t1", live: true });
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("orchestrator-stop");
  hover(m, "orchestrator-confirm", true);
  assert.equal(m.has("orchestrator-confirm"), true);
  hover(m, "orchestrator-confirm", false);
  assert.equal(m.has("orchestrator-confirm"), false);
  assert.deepEqual(orchCalls(H), []);
});

test("confirming Stop runs hws orchestrator stop, clears the header and reloads", async () => {
  const H = orchWorld({ terminal: "t1", live: true });
  H.hws["orchestrator stop"] = () => {
    H.hws["todo list"] = { items: [], orchestrator: null };
    return {};
  };
  const m = await mount("hws-work", { view: "tasks" });
  const lists = todoLists(H);
  await m.click("orchestrator-stop");
  await m.click("orchestrator-stop-yes");
  assert.deepEqual(orchCalls(H), [{ args: ["orchestrator", "stop", "--space", "spc1", "--json"] }]);
  assert.equal(todoLists(H), lists + 1);
  headerHasNoOrchestrator(m);
  assert.equal(m.has("orchestrator-confirm"), false);
});

test("Stop reads Stopping and is off while the command runs", async () => {
  let finish;
  const H = orchWorld({ terminal: "t1", live: true });
  const realExec = H.exec;
  H.exec = (command, args) => (args?.[0] === "orchestrator" ? new Promise((resolve) => { finish = () => resolve({ code: 0, stdout: "{}", stderr: "" }); }) : realExec(command, args));
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("orchestrator-stop");
  await m.click("orchestrator-stop-yes");
  assert.equal(textOf(findNode(m, "orchestrator-stop")), "Stopping…");
  assert.equal(m.clickable("orchestrator-stop"), false);
  assert.equal(m.clickable("orchestrator"), false);
  H.hws["todo list"] = { items: [], orchestrator: null };
  finish();
  await settle();
  assert.equal(m.has("orchestrator-stop"), false);
});

test("a Stop failure goes on the quiet line and keeps the controls", async () => {
  const H = orchWorld({ terminal: "t1", live: true });
  H.hws["orchestrator stop"] = { fail: "No orchestrator is running." };
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("orchestrator-stop");
  await m.click("orchestrator-stop-yes");
  assert.match(quietText(m), /No orchestrator is running\./);
  assert.equal(m.clickable("orchestrator-stop"), true);
  assert.equal(m.has("orchestrator-confirm"), false);
});

test("a question left open ends when the orchestrator does", async () => {
  const H = orchWorld({ terminal: "t1", live: true });
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("orchestrator-stop");
  H.hws["todo list"] = { items: [], orchestrator: null };
  await m.fireTimer(10000);
  headerHasNoOrchestrator(m);
  assert.equal(m.has("orchestrator-confirm"), false);
  H.hws["todo list"] = { items: [], orchestrator: { terminal: "t1", live: true } };
  await m.fireTimer(10000);
  assert.equal(m.has("orchestrator-confirm"), false);
  assert.equal(m.has("orchestrator-stop"), true);
});

// Run by and Open

const worker = { address: "t20", name: "todo-a1", parent: "t9", state: "live", labels: { "hws.todo": "a1" } };

test("a card names its runner as Orchestrator, Worker or an agent, never by address", async () => {
  const H = world({ terminals: [worker, live("t9"), live("t8", { status: "idle" })] });
  H.hws["todo list"] = {
    ...todoList(
      todo("a1", "By worker", { column: "doing", terminal: "t20" }),
      todo("a2", "By orchestrator", { column: "doing", terminal: "t9" }),
      todo("a3", "By hand", { column: "doing", terminal: "t8" }),
    ),
    orchestrator: { terminal: "t9", live: true },
  };
  const m = await mount("hws-work", { view: "tasks" });
  assert.match(textOf(findNode(m, "session-a1")), /^Run by Worker todo-a1/);
  assert.match(textOf(findNode(m, "session-a2")), /^Run by Orchestrator/);
  assert.match(textOf(findNode(m, "session-a3")), /^Run by an agent · Idle/);
  assert.equal(/\bt(8|9|20)\b/.test(m.text()), false);
});

test("Open shows only for a live session and peeks a worker with no pane", async () => {
  const H = world({ terminals: [worker, { address: "t8", state: "exited" }] });
  H.hws["todo list"] = todoList(todo("a1", "Live", { column: "doing", terminal: "t20" }), todo("a2", "Gone", { column: "doing", terminal: "t8" }));
  const m = await mount("hws-work", { view: "tasks" });
  widen(m, 860);
  assert.equal(m.has("open-a2"), false);
  assert.equal(textOf(findNode(m, "session-a2")), "Session ended");
  await m.click("open-a1");
  assert.deepEqual(H.runs, [{ name: "terminal.peek", args: { terminal: "t20" } }]);
  assert.deepEqual(H.overlays, []);
});

test("Open focuses a session that has a pane", async () => {
  const H = world({ terminals: [{ address: "t1", state: "live" }], panes: [{ pane: "p1", terminal: "t1", tab: "tb1" }] });
  H.hws["todo list"] = todoList(todo("a1", "Live", { column: "doing", terminal: "t1" }));
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("open-a1");
  assert.deepEqual(H.runs.at(-1), { name: "pane.focus", args: { terminal: "t1" } });
});

test("a card nobody has run keeps its face short and tags who added it", async () => {
  const H = world({ agents: [named], terminals: [live("t1", { status: "working" })] });
  H.hws["todo list"] = todoList(todo("a1", "Added", { addedBy: "t1", column: "waiting", note: "Which host?" }));
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("session-a1"), false);
  assert.equal(textOf(findNode(m, "tags-a1")), "From Claude Code");
});

test("a long report leaves every lane the same width", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Long", { column: "done", report: "word ".repeat(400) }));
  const m = await mount("hws-work", { view: "tasks" });
  widen(m, 1000);
  for (const key of ["todo", "doing", "waiting", "done"]) assert.equal(findNode(m, `lane-${key}`).w, 239);
});

test("a session that only added the card stays as a From tag", async () => {
  const H = world({ agents: [named], terminals: [live("t1")] });
  H.hws["todo list"] = todoList(todo("a1", "Split", { addedBy: "t1", terminal: "t20", column: "doing" }));
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(m, "session-a1")), "Session ended");
  assert.equal(textOf(findNode(m, "tags-a1")), "From Claude Code");
});

test("a card its own runner added shows no From tag", async () => {
  const H = world({ agents: [named], terminals: [live("t1")] });
  H.hws["todo list"] = todoList(todo("a1", "Self", { addedBy: "t1", terminal: "t1", column: "doing", owner: "agent" }));
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(m.has("tags-a1"), false);
  assert.match(textOf(findNode(m, "session-a1")), /^Run by Claude Code/);
});

test("cardSessions lists the runner first and one row for a single session", () => {
  assert.deepEqual(cardSessions({ terminal: "t2", addedBy: "t1" }), [{ role: "Run by", address: "t2" }, { role: "Added by", address: "t1" }]);
  assert.deepEqual(cardSessions({ terminal: "t1", addedBy: "t1" }), [{ role: "Run by", address: "t1" }]);
  assert.deepEqual(cardSessions({ terminal: null, addedBy: null }), []);
});

test("describeSession names the runner and reports its status", () => {
  const lists = { terminals: [{ address: "t1", state: "live", status: "blocked" }, { address: "t2", state: "exited" }, { address: "t3", state: "live" }], targets: [{ address: "t1", name: "Claude Code" }], orchestrator: "t3" };
  assert.deepEqual(describeSession(lists, "t1"), { name: "Claude Code", status: "Needs you", live: true });
  assert.deepEqual(describeSession(lists, "t2"), { name: null, status: "Session ended", live: false });
  assert.deepEqual(describeSession(lists, "t3"), { name: "Orchestrator", status: "", live: true });
});

test("cardTimes leaves out an update that matches the add", () => {
  const now = 3 * 3600000;
  assert.deepEqual(cardTimes({ createdAt: 3600000, updatedAt: 3600000 }, now), ["Added 2h ago"]);
  assert.deepEqual(cardTimes({ createdAt: 3600000, updatedAt: 2 * 3600000 }, now), ["Added 2h ago", "Updated 1h ago"]);
  assert.deepEqual(cardTimes({}, now), []);
});

// From and Allow

const named = { ...agent("t1"), program: { key: "claude", name: "Claude Code" } };
const edits = (H) => hwsCalls(H).filter((c) => c.args[0] === "todo" && c.args[1] === "edit");

// Fires press handlers from the innermost element outward, as GPUI does, until one stops the event.
function pressThrough(m, ...ids) {
  let stopped = false;
  m.cx.stop_propagation = () => { stopped = true; };
  for (const id of ids) {
    if (stopped) break;
    findNode(m, id).handlers.on_mouse_down_left?.({}, m.cx);
  }
  return stopped;
}

test("a card an agent added names it only while that agent is live and named", async () => {
  const H = world({ agents: [named], terminals: [live("t1"), live("t5"), { address: "t6", state: "exited", labels: {} }] });
  H.hws["todo list"] = todoList(
    todo("a1", "Known", { addedBy: "t1" }),
    todo("a2", "Unknown", { addedBy: "t77" }),
    todo("a3", "Mine", { addedBy: null }),
    todo("a4", "Live, no name", { addedBy: "t5" }),
    todo("a5", "Ended", { addedBy: "t6" }),
  );
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(m, "tags-a1")), "From Claude Code");
  assert.equal(textOf(findNode(m, "tags-a2")), "From an agent");
  assert.equal(m.has("tags-a3"), false);
  assert.equal(textOf(findNode(m, "tags-a4")), "From an agent");
  assert.equal(textOf(findNode(m, "tags-a5")), "From an agent");
});

test("a To do card shows one owner tag, and other columns show only Mine", async () => {
  const H = world();
  H.hws["todo list"] = todoList(
    todo("a1", "Kept", { owner: "mine" }),
    todo("a2", "Asked", { owner: "unassigned" }),
    todo("a3", "Go", { owner: "agent" }),
    todo("a4", "Mine moving", { owner: "mine", column: "doing" }),
    todo("a5", "Running", { owner: "agent", column: "doing" }),
    todo("a6", "Done held", { owner: "unassigned", column: "done" }),
  );
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(textOf(findNode(m, "tags-a1")), "Mine");
  assert.equal(textOf(findNode(m, "tags-a2")), "Needs your OK | Allow");
  assert.equal(textOf(findNode(m, "tags-a3")), "Ready");
  assert.equal(textOf(findNode(m, "tags-a4")), "Mine");
  assert.equal(m.has("tags-a5"), false);
  assert.equal(m.has("tags-a6"), false);
  assert.equal(/Unassigned|\bAgent\b/.test(m.text()), false);
});

test("Allow appears only on an unassigned To do card", async () => {
  const H = world();
  H.hws["todo list"] = todoList(
    todo("a1", "From an agent", { owner: "unassigned", addedBy: "t1" }),
    todo("a2", "Kept", { owner: "mine", addedBy: null }),
    todo("a3", "Assigned", { owner: "agent", addedBy: "t1" }),
    todo("a4", "Typed on the Board", { owner: "unassigned", addedBy: null }),
    todo("a5", "Moved along", { owner: "unassigned", column: "doing" }),
  );
  const m = await mount("hws-work", { view: "tasks" });
  assert.match(textOf(findNode(m, "tags-a1")), /^Needs your OK \| From an agent \| Allow$/);
  assert.equal(m.has("allow-a2"), false);
  assert.equal(m.has("allow-a3"), false);
  assert.equal(m.has("allow-a4"), true);
  assert.equal(m.has("allow-a5"), false);
});

test("Allow assigns the card to an agent and reloads without opening the card", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Held", { owner: "unassigned", addedBy: "t1" }));
  const m = await mount("hws-work", { view: "tasks" });
  const lists = todoLists(H);
  await m.click("allow-a1");
  assert.deepEqual(edits(H), [{ args: ["todo", "edit", "--id", "a1", "--owner=agent", "--space", "spc1", "--json"] }]);
  assert.equal(todoLists(H), lists + 1);
  assert.deepEqual(H.overlays, []);
});

test("pressing Allow starts no drag and never reaches the card", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Held", { owner: "unassigned", addedBy: "t1" }));
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(pressThrough(m, "allow-a1", "todo-a1"), true);
  assert.equal(m.view.drag, null);
  await release(m, "todo-a1", "lane-todo", "root");
  assert.deepEqual(H.overlays, []);
  assert.deepEqual(moves(H), []);
});

test("Allow's click stops at the button", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Held", { owner: "unassigned", addedBy: "t1" }));
  const m = await mount("hws-work", { view: "tasks" });
  let stopped = 0;
  m.cx.stop_propagation = () => { stopped += 1; };
  findNode(m, "allow-a1").handlers.on_click({}, m.cx);
  await settle();
  assert.equal(stopped, 1);
});

test("a card still drags and opens from its own body", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Held", { owner: "unassigned", addedBy: "t1" }));
  const m = await mount("hws-work", { view: "tasks" });
  assert.equal(pressThrough(m, "todo-a1"), false);
  assert.equal(m.view.drag.id, "a1");
  await release(m, "todo-a1", "lane-todo", "root");
  assert.equal(H.overlays.at(-1).props.id, "a1");
});

test("an Allow failure goes on the quiet line", async () => {
  const H = world();
  H.hws["todo list"] = todoList(todo("a1", "Held", { owner: "unassigned", addedBy: "t1" }));
  H.hws["todo edit"] = { fail: "That to-do no longer exists." };
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("allow-a1");
  assert.match(quietText(m), /That to-do no longer exists\./);
});

test("Go to reaches a terminal in another tab", async () => {
  const H = orchWorld({ terminal: "t9", live: true }, { panes: [{ pane: "p9", terminal: "t9", tab: "tb2" }] });
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("orchestrator-go");
  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb2" } }, { name: "pane.focus", args: { terminal: "t9" } }]);
});

test("Go to reaches a flipped orchestrator through its chat pane", async () => {
  const H = orchWorld({ terminal: "t9", live: true }, {
    panes: [{ pane: "chat9", terminal: null, mod: "hws-chat", tab: "tb2" }],
    terminals: [{ address: "t9", state: "live", labels: { "herdr.chat": "chat9" } }],
  });
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("orchestrator-go");
  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb2" } }, { name: "pane.focus", args: { pane: "chat9" } }]);
});

test("Go to falls back to the terminal when it has no pane", async () => {
  const H = orchWorld({ terminal: "t9", live: true }, { panes: [] });
  const m = await mount("hws-work", { view: "tasks" });
  await m.click("orchestrator-go");
  assert.deepEqual(H.runs, [{ name: "pane.focus", args: { terminal: "t9" } }]);
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
  assert.equal(findNode(m, "lane-todo").bg, "color:chrome");
  assert.equal(findNode(m, "todo-a1").opacity, 0.45);
  const lists = todoLists(H);
  await release(m, "lane-doing", "root");
  assert.deepEqual(hwsCalls(H).find((c) => c.args[1] === "move").args, ["todo", "move", "--id", "a1", "--column", "doing", "--space", "spc1", "--json"]);
  assert.equal(todoLists(H), lists + 1);
  assert.equal(findNode(m, "lane-doing").bg, "color:chrome");
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
  assert.equal(findNode(m, "lane-waiting").bg, "color:chrome");
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
  assert.equal(findNode(m, "lane-todo").bg, "color:chrome");
  assert.equal(findNode(m, "todo-a1").opacity, undefined);
  await release(m, "todo-a1", "lane-todo", "root");
  assert.deepEqual(H.overlays.map((o) => o.props), [{ view: "todo", height: 480, space: "spc1", members: [], id: "a1" }]);
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
  const H = world({ agents: [{ ...agent("t1"), program: { key: "claude", name: "Claude Code" } }, { ...agent("t2"), app: "codex", program: { key: "codex", name: "Codex" } }], terminals: [live("t1"), live("t2")] });
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

test("an archived to-do opens read-only", async () => {
  const H = dialogWorld(todo("a1", "Old", { column: "done", archived: true, session: { tool: "claude", id: "c1", folder: "/w" } }));
  const m = await form(H, "a1");
  assert.match(m.text(), /Archived to-do/);
  assert.equal(m.has("reply-todo"), false);
  assert.equal(m.clickable("save-todo"), false);
  assert.equal(m.clickable("archive-todo"), false);
  assert.ok(hwsCalls(H)[0].args.includes("--archived"));
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

test("the owner choice and worktree toggle send their flags on a new to-do", async () => {
  const H = dialogWorld();
  const m = await form(H);
  m.view.form.title.type("Buy milk", m.cx);
  await m.click("owner-mine");
  await m.click("toggle-worktree");
  assert.match(m.text(), /Mine \| Needs your OK \| Ready \| ✓ Use a worktree/);
  await m.click("save-todo");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["todo", "add", "--title=Buy milk", "--owner=mine", "--worktree", "--space", "spc1", "--json"]);
});

test("a new unassigned to-do with worktree off sends neither flag", async () => {
  const H = dialogWorld();
  const m = await form(H);
  m.view.form.title.type("Buy milk", m.cx);
  await m.click("owner-mine");
  await m.click("owner-unassigned");
  await m.click("save-todo");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["todo", "add", "--title=Buy milk", "--space", "spc1", "--json"]);
});

test("editing sends only the owner and toggle that changed", async () => {
  const H = dialogWorld(todo("a1", "Fix login", { owner: "mine", worktree: false }));
  const m = await form(H, "a1");
  await m.click("owner-agent");
  await m.click("toggle-worktree");
  await m.click("save-todo");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["todo", "edit", "--id", "a1", "--owner=agent", "--worktree=true", "--space", "spc1", "--json"]);

  const H2 = dialogWorld(todo("a1", "Fix login", { owner: "mine" }));
  const m2 = await form(H2, "a1");
  await m2.click("toggle-worktree");
  await m2.click("save-todo");
  assert.deepEqual(hwsCalls(H2).at(-1).args, ["todo", "edit", "--id", "a1", "--worktree=true", "--space", "spc1", "--json"]);
});

test("toggled flags are saved before Send to", async () => {
  const H = dialogWorld(todo("a1", "Fix login", { owner: "unassigned" }));
  const m = await form(H, "a1");
  await m.click("owner-mine");
  await m.click("send-t1");
  assert.deepEqual(hwsCalls(H).slice(1).map((c) => c.args[1]), ["edit", "send"]);
});

const WAITING_CARD = { column: "waiting", note: "Which host?", terminal: "t1" };
const REPLY_PLACEHOLDER = "Reply to this session";

test("a waiting card shows its note and Reply above the fields and focuses the reply", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", WAITING_CARD));
  const m = await form(H, "a1");
  assert.match(m.text(), /Latest update \| Which host\? \| Reply .*Title .*Notes .*Column .*Needs your OK .*Send to/);
  assert.equal(H.focusCalls.at(-1), REPLY_PLACEHOLDER);
});

test("Tab moves from the reply through the title and notes and back", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", WAITING_CARD));
  const m = await form(H, "a1");
  H.focusCalls.length = 0;
  for (const field of ["reply", "title", "notes"]) {
    m.view.form.focusedField = field;
    await m.key("tab");
  }
  assert.deepEqual(H.focusCalls, ["What needs doing?", "Add details for the agent (optional)", REPLY_PLACEHOLDER]);
});

test("a waiting card with no note still offers Reply", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", { column: "waiting", terminal: "t1" }));
  const m = await form(H, "a1");
  assert.equal(m.has("reply-todo"), true);
  assert.equal(m.has("todo-note"), false);
});

test("a Done card with a session takes feedback, and one without does not", async () => {
  const H = dialogWorld(todo("a1", "Fix login", { column: "done", terminal: "t8", session: { tool: "claude", id: "c1", folder: "/w" } }));
  H.terminals = [{ address: "t8", state: "exited" }];
  const m = await form(H, "a1");
  assert.match(m.text(), /Feedback/);
  m.view.form.replyBox.type("Use the other name", m.cx);
  await m.click("reply-todo");
  assert.deepEqual(hwsCalls(H).at(-1).args.slice(0, 3), ["todo", "reply", "--id"]);

  const typed = dialogWorld(todo("a2", "Mine", { column: "done" }));
  const n = await form(typed, "a2");
  assert.equal(n.has("reply-todo"), false);
});

test("clicking a Done card shows what happened", async () => {
  const H = dialogWorld(todo("a1", "Fix login", { column: "done", note: "Fixed", report: "Changed the token check" }));
  const m = await form(H, "a1");
  assert.match(m.text(), /What happened \| Changed the token check/);
});

test("a card in another column shows its update but has no Reply", async () => {
  const H = dialogWorld(todo("a1", "Fix login", { note: "Working" }));
  const m = await form(H, "a1");
  assert.equal(m.has("reply-todo"), false);
  assert.match(m.text(), /Latest update \| Working/);
});

test("Open saves edits, closes the dialog and only then opens the session", async () => {
  const H = dialogWorld(todo("a1", "Fix login", { column: "done", terminal: "t1", addedBy: "t2" }));
  H.terminals = [{ address: "t1", state: "live", status: "idle" }, { address: "t2", state: "exited" }];
  H.panes = [{ pane: "p1", terminal: "t1", tab: "tb1" }];
  const m = await form(H, "a1");
  assert.match(m.text(), /Session \| Run by Claude Code \| Idle · t1 .*Open .*Added by Codex \| Session ended · t2/);
  assert.equal(m.has("session-open-t2"), false);
  m.view.form.title.type("Fix sign in", m.cx);
  await m.click("session-open-t1");
  assert.deepEqual(hwsCalls(H).slice(1).map((c) => c.args[1]), ["edit"]);
  assert.deepEqual(H.closed, ["ov9"]);
  assert.deepEqual(H.runs.at(-1), { name: "pane.focus", args: { terminal: "t1" } });
});

test("the dialog's heading line shows the card id and its times", async () => {
  const H = dialogWorld(todo("a1", "Fix login", { createdAt: Date.now() - 7200000, updatedAt: Date.now() - 60000 }));
  const m = await form(H, "a1");
  assert.equal(textOf(findNode(m, "todo-details")), "a1 · Added 2h ago · Updated 1m ago");
});

test("Reply runs hws todo reply, keeps a leading dash and closes", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", WAITING_CARD));
  const m = await form(H, "a1");
  m.view.form.replyBox.type(" -the second one ", m.cx);
  await m.click("reply-todo");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["todo", "reply", "--id", "a1", "--text=-the second one", "--space", "spc1", "--json"]);
  assert.deepEqual(H.closed, ["ov9"]);
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.todos.changed", value: 1 });
});

test("Enter in the Reply box sends it", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", WAITING_CARD));
  const m = await form(H, "a1");
  m.view.form.replyBox.type("The second one", m.cx);
  m.view.form.replyBox.submit(m.cx);
  await settle();
  assert.equal(hwsCalls(H).at(-1).args[1], "reply");
});

test("Reply saves edits first because the dialog closes", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", WAITING_CARD));
  const m = await form(H, "a1");
  m.view.form.title.type("Pick a good host", m.cx);
  m.view.form.replyBox.type("Yes", m.cx);
  await m.click("reply-todo");
  assert.deepEqual(hwsCalls(H).slice(1).map((c) => c.args[1]), ["edit", "reply"]);
});

test("an empty Reply asks for text and runs nothing", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", WAITING_CARD));
  const m = await form(H, "a1");
  await m.click("reply-todo");
  assert.match(m.text(), /Write a reply first/);
  assert.deepEqual(hwsCalls(H).map((c) => c.args[1]), ["list"]);
});

test("a failed reply shows in the dialog and keeps it open", async () => {
  const H = dialogWorld(todo("a1", "Pick a host", WAITING_CARD));
  H.hws["todo reply"] = { fail: "terminal t1 has ended" };
  const m = await form(H, "a1");
  m.view.form.replyBox.type("Yes", m.cx);
  await m.click("reply-todo");
  assert.match(m.text(), /terminal t1 has ended/);
  assert.deepEqual(H.closed, []);
});

// Add several dialog

const several = (H) => mount("hws-work", { view: "add-several", space: "spc1", overlay: "ov7" }, H);

test("Add several sends the lines as --titles and closes", async () => {
  const H = dialogWorld();
  H.hws["todo add"] = { items: [] };
  const m = await several(H);
  assert.match(m.text(), /Add several \| Each line becomes a card/);
  m.view.form.lines.type("\n-first\n\nsecond\n", m.cx);
  await m.click("add-several-save");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["todo", "add", "--titles=-first\n\nsecond", "--space", "spc1", "--json"]);
  assert.deepEqual(H.closed, ["ov7"]);
  assert.deepEqual(H.sharedSets.at(-1), { key: "hws.todos.changed", value: 1 });
  assert.equal(m.timers.filter((x) => x.repeating).length, 0);
});

test("Add several with nothing typed asks for a line and runs nothing", async () => {
  const H = dialogWorld();
  const m = await several(H);
  m.view.form.lines.type("  \n ", m.cx);
  await m.click("add-several-save");
  assert.match(m.text(), /Write at least one line/);
  assert.equal(H.calls.length, 0);
  assert.deepEqual(H.closed, []);
});

test("Add several shows a failure and stays open, and Esc closes it", async () => {
  const H = dialogWorld();
  H.hws["todo add"] = { fail: "the to-do file is damaged" };
  const m = await several(H);
  m.view.form.lines.type("One", m.cx);
  await m.click("add-several-save");
  assert.match(m.text(), /the to-do file is damaged/);
  assert.deepEqual(H.closed, []);
  await m.key("escape");
  assert.deepEqual(H.closed, ["ov7"]);
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

test("a page opened for an agent in another tab selects that tab and focuses the surface", async () => {
  const H = world({ agents: [agent("t1", "tb2")], files: { "/w/s1/o.json": outputsFile([decl("hidden.md", 1)]) } });
  H.hws["surface open"] = { pane: "page1" };
  const m = await mount("hws-work", { view: "outputs" });
  await m.click("output-t1-hidden.md");
  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb2" } }, { name: "pane.focus", args: { pane: "page1" } }]);
});

test("a second click returns to the open surface instead of opening another", async () => {
  const H = world({ files: { "/w/s1/o.json": outputsFile([decl("again.md", 1)]) } });
  H.hws["surface open"] = { pane: "page2" };
  const m = await mount("hws-work", { view: "outputs" });
  await m.click("output-t1-again.md");
  H.panes.push({ pane: "page2", tab: "tb2" });
  await m.click("output-t1-again.md");
  assert.equal(hwsCalls(H).filter((c) => c.args[0] === "surface").length, 1);
  assert.deepEqual(H.runs.slice(-2), [{ name: "tab.select", args: { id: "tb2" } }, { name: "pane.focus", args: { pane: "page2" } }]);
});

test("a closed surface opens again", async () => {
  const H = world({ files: { "/w/s1/o.json": outputsFile([decl("closed.md", 1)]) } });
  H.hws["surface open"] = { pane: "page3" };
  const m = await mount("hws-work", { view: "outputs" });
  await m.click("output-t1-closed.md");
  await m.click("output-t1-closed.md");
  assert.equal(hwsCalls(H).filter((c) => c.args[0] === "surface").length, 2);
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
  assert.equal(hwsCalls(H).filter((c) => c.args[0] !== "todo").length, 0);
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

test("Tasks lists its cards every 10 seconds and keeps listing while hidden", async () => {
  const H = world({ layout: panelLayout(true, "files") });
  const m = await mount("hws-work", { view: "tasks" });
  assert.deepEqual(m.timers.map((x) => x.ms), [10000]);
  assert.equal(todoLists(H), 1);
  await m.fireTimer(10000);
  assert.equal(todoLists(H), 2);
  assert.equal(sessionsPolls(H), 0);
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

test("a .feedback change reloads Outputs", async () => {
  let fire;
  const H = world({ files: { "/w/s1/o.json": outputsFile([decl("one.md", 1)]) } });
  H.watchResult = () => new Promise((resolve) => { fire = resolve; });
  const m = await mount("hws-work", { view: "outputs" });
  assert.equal(m.has("output-t1-two.md"), false);
  H.files["/w/s1/o.json"] = outputsFile([decl("one.md", 1), decl("two.md", 2)]);
  fire(["/w/s1/.feedback"]);
  await settle();
  assert.equal(m.has("output-t1-two.md"), true);
});

// Source checks

test("nothing in hws-work resizes the layout", () => {
  for (const file of ["main.js", "todo.js", "open.js", "data.js"]) assert.equal(read(`../hws-work/${file}`).includes("layout.resize"), false, file);
});

test("hws-work uses only methods and imports Herdr provides", { skip: !existsSync(`${process.env.HOME}/.config/herdr-app/herdr.d.ts`) }, () => {
  const kit = readFileSync(`${process.env.HOME}/.config/herdr-app/gpui-kit.d.ts`, "utf8");
  const unknown = usedMethods().filter((name) => !new RegExp(`\\b${name}\\s*[<(]`).test(kit));
  assert.deepEqual(unknown, []);
  const herdr = readFileSync(`${process.env.HOME}/.config/herdr-app/herdr.d.ts`, "utf8");
  for (const file of ["../hws-work/main.js", "../hws-work/open.js", "../hws-work/todo.js", "../hws-brief/main.js"]) {
    const names = /import \{([^}]*)\} from "herdr"/.exec(read(file))[1].split(",").map((s) => s.trim());
    for (const name of names) assert.match(herdr, new RegExp(`export function ${name}\\b`), `${file}: ${name}`);
  }
});

// A Tasks tab left in a plain space

test("a plain space shows why it has no Tasks and offers no controls", async () => {
  const H = orchWorld(null);
  H.hws["todo list"] = { items: [], orchestrator: null, spaces: ["spc1"], workspace: null };
  const m = await mount("hws-work", { view: "tasks" }, H);

  assert.match(m.text(), /^Tasks \| Tasks only work inside a workspace/);
  for (const id of ["add", "add-several", "run-board", "board"]) assert.equal(m.has(id), false, id);
});
