import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { HWS, setup, mount, settle, hwsCalls, usedMethods } from "./harness.mjs";

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key),
};
beforeEach(() => stored.clear());

const args = (H) => hwsCalls(H).map((c) => c.args).filter((a) => a[0] !== "parent");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const APP = {
  version: 1, id: "spc1", name: "checkout demo", kind: "app", folder: "/Users/me/Projects/checkout", dir: "/state/workspaces/spc1", instructions: "Ship the demo", spaces: ["spc1"],
  tabs: [{ tabId: "tb1", name: "Plan", role: "plan" }],
  terminals: [{ terminal: "t13", tabId: "tb1", sessionId: null, role: "planner" }],
  surfaces: [{ id: "s1", type: "board", title: "flow", terminal: "t13", pane: "p9", socket: "/tmp/x", pid: 1 }],
  artifacts: [
    { id: "old", type: "note", title: "older", path: "/art/old", prompt: "/art/old/prompt.md", fromTerminal: null, createdAt: 1000, status: "current" },
    { id: "new", type: "board", title: "newer", path: "/art/new", prompt: "/art/new/prompt.md", fromTerminal: "t13", createdAt: 2000, status: "current" },
  ],
};
const THROWAWAY = { ...APP, name: "scratch", kind: "throwaway", folder: "/state/workspaces/spc1/scratch", instructions: "", surfaces: [], artifacts: [] };
const AGENT = { address: "t13", pane: "p1", space: "spc1", space_name: "x", tab: "tb1", tab_name: "Plan", status: "working", app: "claude-code", program: { key: "claude", name: "Claude Code" }, title: "t", seq: 1, pinned: false, focused: true };

function inWorkspace(manifest = APP, extra = {}) {
  return setup({ focused: { space: "spc1", tab: "tb1", pane: "p1", terminal: "t13", shown: null, agent: null, cwd: "/w" }, agents: [AGENT], panes: [{ pane: "p1", terminal: "t13", tab: "tb1" }], hws: { list: [manifest] }, ...extra });
}

// Launcher

test("launcher menu runs the right commands and closes after success", async () => {
  const H = setup();
  const m = await mount("hws-new", { overlay: "ov0" });
  assert.match(m.text(), /New terminal.*New workspace.*Throwaway.*New sketch.*New note/);
  assert.doesNotMatch(m.text(), /New board|the Board/);
  await m.click("new-terminal");
  assert.deepEqual(args(H), [["new", "terminal", "--folder", "/Users/me/work", "--json"]]);
  assert.deepEqual(H.closed, ["ov0"]);
  assert.equal(H.calls[0].command, HWS);

  const H2 = setup();
  const m2 = await mount("hws-new", { overlay: "ov0" });
  await m2.click("new-throwaway");
  assert.deepEqual(args(H2), [["new", "throwaway", "--json"]]);

  const H3 = setup();
  const m3 = await mount("hws-new", { overlay: "ov0" });
  await m3.click("new-board");
  assert.deepEqual(args(H3), [["surface", "open", "--type", "board", "--title", "Untitled sketch", "--standalone", "--json"]]);
});

const ACTIVE = { id: "spc1", active: true, machine: null, folder: "/space/dir", tabs: [] };
const IN_WORKSPACE = { "hws.workspace.spaces": ["spc1"] };

test("the launcher offers Orchestrate this space only when the active space is in a workspace", async () => {
  for (const sharedValues of [{}, { "hws.workspace.spaces": ["spc9"] }, { "hws.workspace.spaces": "spc1" }]) {
    setup({ spaces: [ACTIVE], sharedValues });
    const m = await mount("hws-new", { overlay: "ov0" });
    assert.equal(m.has("orchestrate"), false, JSON.stringify(sharedValues));
    assert.doesNotMatch(m.text(), /Orchestrate/);
  }
  for (const spaces of [[], [{ ...ACTIVE, active: false }]]) {
    setup({ spaces, sharedValues: IN_WORKSPACE });
    assert.equal((await mount("hws-new", { overlay: "ov0" })).has("orchestrate"), false);
  }
});

test("the launcher dialog fits its rows, because the row count changes", () => {
  const overlay = JSON.parse(read("../hws-new/mod.json")).overlay;
  assert.equal(overlay.kind, "dialog");
  assert.equal("height" in overlay, false);
  assert.match(read("../hws-new/main.js"), /\.id\("hws-new"\)[\s\S]{0,200}\.w_full\(\)/);
});

test("Orchestrate this space starts in the focused terminal's folder", async () => {
  const H = setup({ spaces: [ACTIVE], sharedValues: IN_WORKSPACE });
  const m = await mount("hws-new", { overlay: "ov0" });
  assert.match(m.text(), /Orchestrate this space \| Run Tasks with an agent that assigns the work\./);
  await m.click("orchestrate");
  assert.deepEqual(args(H), [["orchestrator", "start", "--space", "spc1", "--folder", "/Users/me/work", "--json"]]);
  assert.deepEqual(H.closed, ["ov0"]);
});

test("Orchestrate this space falls back to the space's folder", async () => {
  const H = setup({ spaces: [ACTIVE], sharedValues: IN_WORKSPACE, focused: { space: "spc1", tab: "tb1", pane: "p9", terminal: null, cwd: null } });
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("orchestrate");
  assert.deepEqual(args(H), [["orchestrator", "start", "--space", "spc1", "--folder", "/space/dir", "--json"]]);
});

test("Orchestrate this space ignores focus in another space", async () => {
  const H = setup({ spaces: [ACTIVE], sharedValues: IN_WORKSPACE, focused: { space: "spc2", tab: "tb9", pane: "p9", terminal: "t9", cwd: "/elsewhere" } });
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("orchestrate");
  assert.deepEqual(args(H), [["orchestrator", "start", "--space", "spc1", "--folder", "/space/dir", "--json"]]);
});

test("Orchestrate this space is disabled with no folder or a remote space", async () => {
  const unavailable = [
    { spaces: [{ ...ACTIVE, folder: "" }], focused: null },
    { spaces: [{ ...ACTIVE, machine: "vps" }] },
  ];
  for (const world of unavailable) {
    const H = setup({ ...world, sharedValues: IN_WORKSPACE });
    const m = await mount("hws-new", { overlay: "ov0" });
    assert.equal(m.has("orchestrate"), true);
    assert.equal(m.clickable("orchestrate"), false);
    m.view.at = 6;
    await m.key("enter");
    assert.deepEqual(args(H), []);
    assert.deepEqual(H.closed, []);
  }
});

test("Enter runs Orchestrate this space when it is selected", async () => {
  const H = setup({ spaces: [ACTIVE], sharedValues: IN_WORKSPACE });
  const m = await mount("hws-new", { overlay: "ov0" });
  m.view.at = 6;
  await m.key("enter");
  assert.deepEqual(args(H), [["orchestrator", "start", "--space", "spc1", "--folder", "/Users/me/work", "--json"]]);
});

test("the launcher shows why an orchestrator did not start and stays open", async () => {
  const H = setup({ spaces: [ACTIVE], sharedValues: IN_WORKSPACE });
  H.hws["orchestrator start"] = { fail: "claude is not installed" };
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("orchestrate");
  assert.match(m.text(), /claude is not installed/);
  assert.deepEqual(H.closed, []);
});

test("new terminal leaves out a folder from another machine", async () => {
  const H = setup({ spaces: [{ id: "spc1", machine: "vps", tabs: [] }] });
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("new-terminal");
  assert.deepEqual(args(H), [["new", "terminal", "--json"]]);
});

test("a failed launch keeps the dialog open and shows hws's message", async () => {
  const H = setup({ hws: { "surface open": { fail: "herdr is not answering" } } });
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("new-board");
  assert.deepEqual(H.closed, []);
  assert.match(m.text(), /herdr is not answering/);
});

test("hws falls back to the bare command when ~/.local/bin/hws cannot start", async () => {
  const H = setup({ missingHwsPaths: new Set([HWS]) });
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("new-board");
  assert.deepEqual(H.calls.map((c) => c.command), [HWS, "hws"]);
  assert.deepEqual(H.closed, ["ov0"]);
});

test("a missing hws is reported", async () => {
  const H = setup({ missingHwsPaths: new Set([HWS, "hws"]) });
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("new-board");
  assert.match(m.text(), /Could not run hws/);
  assert.deepEqual(H.closed, []);
});

test("the menu opens the form as its own dialog, and the keyboard works", async () => {
  const H = setup();
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.key("down");
  await m.key("enter");
  assert.deepEqual(H.closed, ["ov0"]);
  assert.equal(H.overlays[0].mod, "hws-new");
  assert.equal(H.overlays[0].props.step, "workspace");
  assert.equal(H.overlays[0].modal, true);
});

const RETIRED = [
  { id: "sp1", name: "throwaway-1c26", closedAt: Date.now() - 3 * 86400000, sessions: [{ sessionId: "s1", title: "Fix login" }], artifacts: [{ id: "a1" }] },
  { id: "sp2", name: "plain", closedAt: Date.now(), sessions: [], artifacts: [] },
];

test("the menu opens Find past work as its own dialog", async () => {
  const H = setup();
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("find-past");
  assert.deepEqual(H.closed, ["ov0"]);
  assert.equal(H.overlays[0].mod, "hws-new");
  assert.equal(H.overlays[0].props.step, "find");
});

test("find lists retired throwaways and reopens a clicked one", async () => {
  const H = setup({ hws: { find: RETIRED, reopen: { id: "sp9" } } });
  const m = await mount("hws-new", { overlay: "ov1", step: "find" });
  await settle();
  assert.deepEqual(args(H), [["find", "--", "--json"]]);
  assert.match(m.text(), /Fix login.*Throwaway, closed 3 days ago · throwaway-1c26 · 27 days left · 1 artifact.*Restore.*plain.*today/);
  await m.click("retired-sp2");
  assert.deepEqual(args(H).at(-1), ["reopen", "sp2", "--json"]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("find shows an archived workspace by name and restores it", async () => {
  const H = setup({ hws: { find: [{ id: "spa", name: "Cafe loyalty", archived: true, closedAt: Date.now(), sessions: [], artifacts: [{ id: "a1" }, { id: "a2" }] }], reopen: { id: "spa" } } });
  const m = await mount("hws-new", { overlay: "ov1", step: "find" });
  await settle();
  assert.match(m.text(), /Cafe loyalty.*Workspace, archived today · 2 artifacts.*Restore/);
  assert.doesNotMatch(m.text(), /days? left/);
  await m.click("retired-spa");
  assert.deepEqual(args(H).at(-1), ["reopen", "spa", "--json"]);
});

test("find searches as you type and the keyboard picks a row", async () => {
  const H = setup({ hws: { find: RETIRED, reopen: { id: "sp9" } } });
  const m = await mount("hws-new", { overlay: "ov1", step: "find" });
  await settle();
  m.view.inputs.query.type(" login ", m.cx);
  await settle();
  assert.deepEqual(args(H).at(-1), ["find", "--", "login", "--json"]);
  await m.key("down");
  m.view.reopenSelected(m.cx);
  await settle();
  assert.deepEqual(args(H).at(-1), ["reopen", "sp2", "--json"]);
});

test("find ignores a reply that a newer search replaced", async () => {
  setup({ hws: { find: RETIRED } });
  const m = await mount("hws-new", { overlay: "ov1", step: "find" });
  await settle();
  m.view.results = [];
  m.view.search(m.cx);
  m.view.searchId += 1;
  await settle();
  assert.deepEqual(m.view.results, []);
});

test("find explains an empty list and shows a failure", async () => {
  const H = setup({ hws: { find: [] } });
  const m = await mount("hws-new", { overlay: "ov1", step: "find" });
  await settle();
  assert.match(m.text(), /Archived workspaces and closed throwaways appear here/);
  m.view.inputs.query.type("zzz", m.cx);
  await settle();
  assert.match(m.text(), /Nothing matches/);
  H.hws.find = { fail: "boom" };
  m.view.inputs.query.type("zzzz", m.cx);
  await settle();
  assert.match(m.text(), /boom/);
});

async function form(extra = {}) {
  const H = setup(extra);
  const m = await mount("hws-new", { overlay: "ov1", step: "workspace" });
  return { H, m };
}

test("the form makes a workspace from an open space, with its name and folder filled in", async () => {
  const H = setup();
  const m = await mount("hws-new", { overlay: "ov1", step: "workspace", space: { id: "spc7", name: "api", folder: "/Users/me/Projects/api" } });
  assert.match(m.text(), /New workspace from api \| The space keeps its name, tabs and terminals\./);
  assert.deepEqual([m.view.values.name, m.view.values.folder], ["api", "~/Projects/api"]);
  await m.click("create");
  assert.deepEqual(args(H), [["new", "workspace", "--name", "api", "--folder", "/Users/me/Projects/api", "--space", "spc7", "--json"]]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("the form from a space with no folder starts at the parent folder and shows hws's refusal", async () => {
  const H = setup({ hws: { parent: { folder: "/Users/me/Projects" }, "new workspace": { fail: "api is the only space in demo, so add another space there first" } } });
  const m = await mount("hws-new", { overlay: "ov1", step: "workspace", space: { id: "spc7", name: "api", folder: "" } });
  assert.equal(m.view.values.folder, "~/Projects");
  await m.click("create");
  assert.match(m.text(), /only space in demo/);
  assert.deepEqual(H.closed, []);
});

test("form requires a folder and calls nothing without one", async () => {
  const { H, m } = await form();
  m.view.inputs.folder.type("", m.cx);
  await m.click("create");
  assert.deepEqual(args(H), []);
  assert.match(m.text(), /Choose a folder/);
  assert.deepEqual(H.closed, []);
});

test("form rejects a relative path and a missing folder", async () => {
  const { H, m } = await form({ missingDirs: new Set(["/nope"]) });
  m.view.inputs.folder.type("relative/path", m.cx);
  await m.click("create");
  assert.match(m.text(), /Use a full path/);
  m.view.inputs.folder.type("/nope", m.cx);
  await m.click("create");
  assert.match(m.text(), /\/nope does not exist/);
  assert.deepEqual(args(H), []);
});

test("form sends every field and expands ~", async () => {
  const { H, m } = await form();
  m.view.inputs.name.type("  Checkout  ", m.cx);
  m.view.inputs.folder.type("~/Projects/checkout/", m.cx);
  m.view.inputs.instructions.type("Ship it", m.cx);
  await m.click("create");
  assert.deepEqual(args(H), [["new", "workspace", "--name", "Checkout", "--folder", "/Users/me/Projects/checkout", "--instructions", "Ship it", "--json"]]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("form names an unnamed workspace and leaves out empty instructions", async () => {
  const { H, m } = await form();
  m.view.inputs.folder.type("/x/report", m.cx);
  await m.click("create");
  assert.deepEqual(args(H)[0], ["new", "workspace", "--name", "Untitled workspace", "--folder", "/x/report", "--json"]);
});

test("folder starts at the parent folder and creates nothing", async () => {
  const { H, m } = await form();
  assert.equal(m.view.inputs.folder.value(), "~/Projects");
  m.view.inputs.name.type("Checkout Demo", m.cx);
  await m.settle();
  assert.equal(m.view.inputs.folder.value(), "~/Projects");
  await m.click("create");
  assert.deepEqual(args(H).at(-1), ["new", "workspace", "--name", "Checkout Demo", "--folder", "/Users/me/Projects", "--json"]);
});

test("Choose fills the folder, and cancelling leaves it", async () => {
  const { H, m } = await form({ pickResult: "/picked" });
  await m.click("choose-folder");
  assert.equal(m.view.values.folder, "/picked");
  assert.equal(m.view.inputs.folder.value(), "/picked");
  H.pickResult = null;
  await m.click("choose-folder");
  assert.equal(m.view.values.folder, "/picked");
});

test("Choose fills the files folder, which stays editable and reaches hws", async () => {
  const { H, m } = await form({ pickResult: "/picked/files" });
  await m.click("choose-home");
  assert.equal(m.view.values.home, "/picked/files");
  assert.equal(m.view.values.folder, "~/Projects");
  m.view.inputs.home.type("/typed/files", m.cx);
  await m.settle();
  assert.equal(m.view.values.home, "/typed/files");
  await m.click("create");
  const sent = args(H).at(-1);
  assert.equal(sent[sent.indexOf("--home") + 1], "/typed/files");
});

test("Enter in a field submits, and a double submit runs once", async () => {
  const { H, m } = await form();
  m.view.inputs.folder.type("/x/d", m.cx);
  m.view.inputs.folder.submit(m.cx);
  m.view.inputs.folder.submit(m.cx);
  await settle();
  assert.equal(args(H).length, 1);
});

test("a failed create keeps the form open with the message", async () => {
  const { H, m } = await form({ hws: { "new workspace": { fail: "name taken" } } });
  m.view.inputs.folder.type("/x/d", m.cx);
  await m.click("create");
  assert.match(m.text(), /name taken/);
  assert.deepEqual(H.closed, []);
  assert.equal(m.view.busy, null);
});

test("Tab moves between fields", async () => {
  const { H, m } = await form();
  const before = H.focusCalls.length;
  m.view.focusedField = "name";
  await m.key("tab");
  assert.equal(H.focusCalls.at(-1), "~/Projects");
  m.view.focusedField = "name";
  await m.key("tab", { shift: true });
  assert.equal(H.focusCalls.length, before + 2);
  assert.equal(H.focusCalls.at(-1), "Optional. How agents should work and organize context here.");
});

// Row menu

const ROW = { view: "row-menu", workspace: "spc1", name: "demo", kind: "app", archived: false };

test("a kept row's menu offers Rename and Archive, with no way to lose it", async () => {
  const H = setup({ hws: { list: [] } });
  const m = await mount("hws-panel", { ...ROW, overlay: "ov1" }, H);
  assert.match(m.text(), /Rename.*Archive/);
  assert.doesNotMatch(m.text(), /Close/);
  await m.click("row-menu-archive");
  assert.deepEqual(H.closed, ["ov1"]);
  assert.deepEqual(H.overlays.at(-1).props, { view: "confirm", action: "archive", workspace: "spc1", name: "demo", kind: "app", archived: false });
});

test("Open panel switches to the space and opens beside its terminal", async () => {
  const H = setup({ hws: { list: [] }, spaces: [{ id: "spc2", active: false, tabs: [{ id: "tb2", active: true }] }], panes: [{ pane: "p5", terminal: "t5", tab: "tb2" }] });
  const m = await mount("hws-panel", { ...ROW, space: "spc2", overlay: "ov1" }, H);
  assert.match(m.text(), /Open panel.*Rename.*Archive/);
  await m.click("row-menu-panel");
  assert.deepEqual(H.runs, [
    { name: "space.select", args: { id: "spc2" } },
    { name: "pane.split", args: { direction: "right", pane: "p5", mod: "hws-panel", props: { terminal: "t5" } } },
  ]);
});

test("Open panel focuses a panel that is already open", async () => {
  const H = setup({ hws: { list: [] }, spaces: [{ id: "spc2", active: false, tabs: [{ id: "tb2", active: true }] }], panes: [{ pane: "p5", terminal: "t5", tab: "tb2" }, { pane: "p6", terminal: null, mod: "hws-panel", tab: "tb2" }] });
  const m = await mount("hws-panel", { ...ROW, space: "spc2", overlay: "ov1" }, H);
  await m.click("row-menu-panel");
  assert.deepEqual(H.runs.at(-1), { name: "pane.focus", args: { pane: "p6" } });
});

test("a row with no open space has no Open panel", async () => {
  const H = setup({ hws: { list: [] } });
  const m = await mount("hws-panel", { ...ROW, archived: true, overlay: "ov1" }, H);
  assert.equal(m.has("row-menu-panel"), false);
});

test("a throwaway's menu has no Archive and an archived row offers Restore", async () => {
  const H = setup({ hws: { list: [] } });
  const scrap = await mount("hws-panel", { ...ROW, kind: "throwaway", overlay: "ov1" }, H);
  assert.doesNotMatch(scrap.text(), /Archive/);
  const archived = await mount("hws-panel", { ...ROW, archived: true, overlay: "ov2" }, H);
  assert.match(archived.text(), /Restore.*Rename.*Remove/);
});

test("the rename dialog saves a trimmed name and refuses an empty one", async () => {
  const H = setup({ hws: { list: [] } });
  const d = await mount("hws-panel", { view: "rename", workspace: "spc1", name: "demo", overlay: "ov3" }, H);
  d.view.inputs.name.type("   ", d.cx);
  await d.click("rename-yes");
  assert.match(d.text(), /Enter a name/);
  assert.equal(hwsCalls(H).length, 0);
  d.view.inputs.name.type("  better  ", d.cx);
  await d.click("rename-yes");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["set", "--workspace", "spc1", "--name", "better", "--json"]);
  assert.deepEqual(H.closed, ["ov3"]);
});

test("the confirm dialog runs archive, restore and remove", async () => {
  for (const [action, expected] of [["archive", ["archive", "--workspace", "spc1", "--json"]], ["restore", ["unarchive", "--workspace", "spc1", "--json"]], ["remove", ["close", "--workspace", "spc1", "--json"]]]) {
    const H = setup({ hws: { list: [] } });
    const d = await mount("hws-panel", { view: "confirm", action, workspace: "spc1", name: "demo", kind: "app", overlay: "ov4" }, H);
    await d.click("confirm-yes");
    await d.settle();
    assert.deepEqual(hwsCalls(H).at(-1).args, expected);
    assert.deepEqual(H.closed, ["ov4"]);
  }
});

test("closing a throwaway with work opens the Keep or Trash dialog", async () => {
  const H = setup({ hws: { list: [], close: { decision: "needed", artifacts: [{ id: "a1" }], scratch: null } } });
  const d = await mount("hws-panel", { view: "confirm", action: "close", workspace: "spc1", name: "scrap", kind: "throwaway", overlay: "ov5" }, H);
  await d.click("confirm-yes");
  await d.settle();
  assert.equal(H.overlays.at(-1).props.view, "decide");
  assert.deepEqual(H.overlays.at(-1).props.artifacts, [{ id: "a1" }]);
});

// Panel

test("panel outside a workspace says so and offers to make this space a workspace", async () => {
  const H = setup({ hws: { list: [] }, spaces: [{ id: "spc1", name: "api", machine: null, folder: "/made/here", tabs: [{ id: "tb1" }] }], panes: [{ pane: "p1", terminal: "t1", tab: "tb1", cwd: "/Users/me/now" }] });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /Not in a workspace \| No workspace holds its folder\..*Make this space a workspace…/);
  assert.deepEqual(args(H).find((a) => a[0] === "space"), ["space", "match", "--space", "spc1", "--json"]);
  await m.click("new-workspace");
  assert.equal(H.overlays[0].mod, "hws-new");
  assert.deepEqual(H.overlays[0].props, { step: "workspace", space: { id: "spc1", name: "api", folder: "/Users/me/now" } });
});

const MATCH = (count) => ({ space: "spc1", folder: "/w/app", candidates: Array.from({ length: count }, (_, i) => ({ id: `w${i}`, name: `work ${i}`, folder: "/w", home: null })) });

test("a plain space whose folder sits in a workspace offers to join it, then reloads", async () => {
  const H = setup({ hws: { list: [], "space match": MATCH(1), "space move": { space: "spc1", workspace: "w0" } } });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /Not in a workspace \| Its folder belongs to work 0\..*Add this space to work 0.*Make this space a workspace…/);
  const lists = args(H).filter((a) => a[0] === "list").length;
  await m.click("join-w0");
  assert.deepEqual(args(H).find((a) => a[1] === "move"), ["space", "move", "--space", "spc1", "--workspace", "w0", "--json"]);
  assert.equal(args(H).filter((a) => a[0] === "list").length, lists + 1);
});

test("a plain space offers at most three workspaces and shows a failed move", async () => {
  setup({ hws: { list: [], "space match": MATCH(4), "space move": { fail: "w1 has no such space" } } });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /belongs to work 0, work 1 and work 2\./);
  assert.equal(m.has("join-w2"), true);
  assert.equal(m.has("join-w3"), false);
  await m.click("join-w1");
  assert.match(m.text(), /w1 has no such space/);
});

test("a failed space match offers only New workspace", async () => {
  setup({ hws: { list: [], "space match": { fail: "unknown command" } } });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /No workspace holds its folder\./);
  assert.equal(m.has("new-workspace"), true);
});

test("the panel edits the workspace instructions in a dialog", async () => {
  const H = inWorkspace();
  const m = await mount("hws-panel", {});
  await m.click("edit-instructions");
  const spec = H.overlays.at(-1);
  assert.equal(spec.props.view, "instructions");
  const d = await mount("hws-panel", { ...spec.props, overlay: "ov9" }, H);
  d.view.inputs.instructions.type("  Keep notes in context/  ", d.cx);
  await d.click("save-instructions");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["set", "--workspace", "spc1", "--instructions", "Keep notes in context/", "--json"]);
  assert.deepEqual(H.closed, ["ov9"]);
});

test("the panel leaves the kind out of its header", async () => {
  inWorkspace();
  const m = await mount("hws-panel", {});
  assert.doesNotMatch(m.text(), /General|Deliverable|Tells agents/);
});

test("panel shows the workspace, surfaces and artifacts newest first, and no Agents section", async () => {
  const H = inWorkspace();
  H.panes.push({ pane: "p9", terminal: null, tab: "tb1" });
  const m = await mount("hws-panel", {});
  const text = m.text();
  assert.match(text, /checkout demo.*~\/Projects\/checkout.*Ship the demo/);
  assert.match(text, /Open now.*flow.*sketch · Claude Code/);
  assert.doesNotMatch(text, /Agents|planner|t13/);
  assert.equal(m.has("agent-t13"), false);
  assert.ok(text.indexOf("Notes") < text.indexOf("older"));
  assert.ok(text.indexOf("older") < text.indexOf("Artifacts"));
  assert.match(text, /newer \| sketch · /);
  await m.click("surface-s1");
  assert.deepEqual(H.runs.at(-1), { name: "pane.focus", args: { pane: "p9" } });
});

test("Open now names an untitled window by its type and resumes it on click", async () => {
  const H = inWorkspace({ ...APP, surfaces: [{ id: "s3", type: "note", title: "note", terminal: "t13", pane: null, host: "t20", socket: "/tmp/y", pid: 2 }] });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /Open now \| note \| note · Claude Code/);
  await m.click("surface-s3");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["surface", "resume", "--id", "s3", "--json"]);
});

test("Open now shows only when something is open", async () => {
  inWorkspace({ ...APP, surfaces: [] });
  const m = await mount("hws-panel", {});
  assert.doesNotMatch(m.text(), /Open now|No boards, notes or pages open/);
  inWorkspace({ ...THROWAWAY, surfaces: [] });
  const scrap = await mount("hws-panel", {});
  assert.doesNotMatch(scrap.text(), /Open now/);
});

test("where files go starts folded and resets with the space", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /Where files go/);
  assert.equal(m.has("place-current"), false);
  assert.equal(m.has("suggest-places"), false);
  await m.click("places-toggle");
  assert.equal(m.has("place-current"), true);
  H.focused = { ...H.focused, space: "spc9" };
  m.render();
  H.focused = { ...H.focused, space: "spc1" };
  m.render();
  assert.equal(m.view.showPlaces, false);
});

test("a surface whose pane has gone is not clickable", async () => {
  inWorkspace();
  const m = await mount("hws-panel", {});
  assert.equal(m.clickable("surface-s1"), false);
});

const MENU = { view: "artifact-menu", overlay: "ov1" };
const menuFor = (artifact) => ({ ...MENU, artifact });
const BOARD_ARTIFACT = { id: "new", type: "board", path: "/art/new", prompt: "/art/new/prompt.md" };

test("the artifact menu reveals, copies and opens a board's sketch", async () => {
  const H = setup({});
  const m = await mount("hws-panel", menuFor(BOARD_ARTIFACT), H);
  assert.match(m.text(), /Open sketch.*Show in Finder.*Copy for Claude/);
  await m.click("row-menu-external");
  await m.settle();
  assert.deepEqual(H.calls.at(-1), { command: "open", args: ["/art/new/sketch.png"] });
  await m.click("row-menu-reveal");
  await m.settle();
  assert.deepEqual(H.calls.at(-1), { command: "open", args: ["-R", "/art/new/prompt.md"] });
  await m.click("row-menu-copy");
  await m.settle();
  const copied = H.calls.at(-1);
  assert.deepEqual(copied.args.slice(2), ["sh", "@/art/new/prompt.md"]);
  assert.match(copied.args[1], /pbcopy/);
});

test("the artifact menu quotes a path with spaces, as hws link does", async () => {
  const H = setup({});
  const m = await mount("hws-panel", menuFor({ id: "a", type: "file", path: "/w/my spec.md", prompt: "/w/my spec.md" }), H);
  await m.click("row-menu-copy");
  await m.settle();
  assert.deepEqual(H.calls.at(-1).args.slice(2), ["sh", '@"/w/my spec.md"']);
});

test("the artifact menu names the external tool for the file type", async () => {
  const H = setup({});
  const html = await mount("hws-panel", menuFor({ id: "a", type: "file", path: "/w/page.html", prompt: "/w/page.html" }), H);
  assert.match(html.text(), /Open in browser/);
  const md = await mount("hws-panel", menuFor({ id: "b", type: "file", path: "/w/spec.md", prompt: "/w/spec.md" }), H);
  assert.match(md.text(), /Open in default app/);
});

test("on Linux, the artifact menu uses the desktop's clipboard tool and xdg-open", async () => {
  const H = setup({});
  H.window = { platform: "linux" };
  const m = await mount("hws-panel", menuFor(BOARD_ARTIFACT), H);
  assert.match(m.text(), /Show in folder/);
  await m.click("row-menu-copy");
  await m.settle();
  assert.match(H.calls.at(-1).args[1], /wl-copy/);
  assert.doesNotMatch(H.calls.at(-1).args[1], /pbcopy/);
  await m.click("row-menu-reveal");
  await m.settle();
  assert.deepEqual(H.calls.at(-1), { command: "xdg-open", args: ["/art/new"] });
});

test("the header has no New board, New note or agent hint, and keeps Instructions…", async () => {
  inWorkspace();
  const m = await mount("hws-panel", {});
  assert.equal(m.has("new-board"), false);
  assert.equal(m.has("new-note"), false);
  assert.doesNotMatch(m.text(), /Boards and notes|Click one first/);
  assert.equal(m.has("edit-instructions"), true);
  assert.equal(m.has("close"), false);
  assert.doesNotMatch(m.text(), /Archive workspace|Close workspace/);
});

test("with no instructions the header says so beside Instructions…", async () => {
  inWorkspace({ ...APP, instructions: "" });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /No instructions yet \| Instructions…/);
});

test("the agent stays the target when the panel takes focus", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  m.render();
  H.focused = { ...H.focused, pane: "p2", terminal: null };
  H.agents = [{ ...AGENT, focused: false }];
  await m.click("open-current");
  assert.ok(args(H).some((a) => a[0] === "surface" && a.includes("--terminal") && a.includes("t13")));
});

test("the terminal the toggle saw seeds the target", async () => {
  const H = kept({ agents: [{ ...AGENT, focused: false }], focused: { space: "spc1", tab: "tb1", pane: "p2", terminal: null } });
  const m = await mount("hws-panel", { terminal: "t13" });
  await m.click("open-current");
  assert.ok(args(H).some((a) => a[0] === "surface" && a.includes("t13")));
});

test("the ··· menu beside the name offers Rename and Archive", async () => {
  const H = inWorkspace();
  const m = await mount("hws-panel", {});
  await m.click("workspace-menu");
  const spec = H.overlays.at(-1);
  assert.equal(spec.kind, "popup");
  assert.deepEqual(spec.props, { workspace: "spc1", name: "checkout demo", kind: "app", archived: false, space: null, view: "row-menu" });
  const menu = await mount("hws-panel", { ...spec.props, overlay: "ov2" }, H);
  assert.match(menu.text(), /Rename….*Archive…/);
  assert.equal(menu.has("row-menu-panel"), false);
  await menu.click("row-menu-archive");
  const confirm = await mount("hws-panel", { ...H.overlays.at(-1).props, overlay: "ov3" }, H);
  await confirm.click("confirm-yes");
  await confirm.settle();
  assert.deepEqual(args(H).at(-1), ["archive", "--workspace", "spc1", "--json"]);
});

// Runs the panel's ··· menu through to Close and its confirm dialog.
async function closeFromPanel(H) {
  const m = await mount("hws-panel", {});
  await m.click("workspace-menu");
  const menu = await mount("hws-panel", { ...H.overlays.at(-1).props, overlay: "ov2" }, H);
  assert.doesNotMatch(menu.text(), /Archive/);
  await menu.click("row-menu-close");
  const confirm = await mount("hws-panel", { ...H.overlays.at(-1).props, overlay: "ov3" }, H);
  await confirm.click("confirm-yes");
  await confirm.settle();
}

test("a throwaway's close decision opens the dialog and Keep calls --keep", async () => {
  const made = [{ id: "a1", type: "board", title: "flow" }, { id: "a2", type: "note", title: "ideas" }];
  const H = inWorkspace(THROWAWAY, { hws: { list: [THROWAWAY], close: (argv) => (argv.includes("--keep") || argv.includes("--trash") ? { closed: true } : { decision: "needed", artifacts: made }) } });
  await closeFromPanel(H);
  assert.deepEqual(args(H).filter((a) => a[0] === "close"), [["close", "--workspace", "spc1", "--json"]]);
  const spec = H.overlays.at(-1);
  assert.equal(spec.kind, "dialog");
  assert.equal(spec.props.view, "decide");
  assert.deepEqual(spec.props.artifacts, made);
  assert.equal(spec.props.scratch, null);

  const d = await mount("hws-panel", { ...spec.props, overlay: "ov7" }, H);
  assert.match(d.text(), /flow \| sketch.*ideas \| note/);
  await d.click("keep");
  assert.deepEqual(args(H).filter((a) => a[0] === "close").at(-1), ["close", "--workspace", "spc1", "--keep", "--json"]);
  assert.deepEqual(H.closed.at(-1), "ov7");
});

test("the close decision names the scratch folder, even with no artifacts", async () => {
  const H = inWorkspace(THROWAWAY, { hws: { list: [THROWAWAY], close: { decision: "needed", artifacts: [], scratch: "/Users/me/.local/state/hws/workspaces/spc1/scratch" } } });
  await closeFromPanel(H);
  const spec = H.overlays.at(-1);
  assert.equal(spec.props.scratch, "/Users/me/.local/state/hws/workspaces/spc1/scratch");
  const d = await mount("hws-panel", { ...spec.props, overlay: "ov7" }, H);
  assert.match(d.text(), /Scratch folder \| ~\/\.local\/state\/hws\/workspaces\/spc1\/scratch/);
});

test("the sidebar asks git about kept folders only", async () => {
  const H = setup({ hws: { list: [APP, { ...THROWAWAY, id: "spc2", spaces: ["spc2"], folder: "/state/workspaces/spc2/scratch" }] }, spaces: [{ id: "spc1", active: true, tabs: [] }] });
  await mount("hws-panel", { view: "sidebar" });
  const gits = H.calls.filter((c) => c.command === "git");
  assert.equal(gits.length, 1);
});

test("Trash calls --trash, and a failure stays in the dialog", async () => {
  const H = setup({ hws: { close: { fail: "Trash is full" } } });
  const d = await mount("hws-panel", { view: "decide", workspace: "spc1", name: "scratch", artifacts: [{ id: "a1", type: "note", title: "x" }], overlay: "ov7" });
  await d.click("trash");
  assert.deepEqual(args(H).at(-1), ["close", "--workspace", "spc1", "--trash", "--json"]);
  assert.deepEqual(H.closed, []);
  assert.match(d.text(), /Trash is full/);
  H.hws.close = { closed: true };
  await d.click("trash");
  assert.deepEqual(H.closed, ["ov7"]);
});

test("Cancel in the decide dialog runs nothing", async () => {
  const H = setup();
  const d = await mount("hws-panel", { view: "decide", workspace: "spc1", artifacts: [], overlay: "ov7" });
  await d.click("cancel");
  assert.deepEqual(args(H), []);
  assert.deepEqual(H.closed, ["ov7"]);
});

test("Promote shows only for a throwaway", async () => {
  inWorkspace();
  const app = await mount("hws-panel", {});
  assert.equal(app.has("promote"), false);
  inWorkspace(THROWAWAY);
  const throwaway = await mount("hws-panel", {});
  assert.equal(throwaway.has("promote"), true);
});

test("Promote passes the workspace, validates and calls hws promote", async () => {
  const H = inWorkspace(THROWAWAY);
  const m = await mount("hws-panel", {});
  await m.click("promote");
  const spec = H.overlays[0];
  assert.equal(spec.props.view, "promote");
  assert.equal(spec.props.name, "scratch");
  assert.equal(spec.props.workspace, "spc1");

  H.hws.parent = { folder: "/Users/me/Projects" };
  const d = await mount("hws-panel", { ...spec.props, overlay: "ov8" }, H);
  assert.equal(d.view.inputs.name.value(), "scratch");
  await d.settle();
  assert.equal(d.view.inputs.folder.value(), "~/Projects");
  d.view.inputs.folder.type("", d.cx);
  const before = hwsCalls(H).length;
  await d.click("promote-yes");
  assert.match(d.text(), /Choose a folder/);
  assert.equal(hwsCalls(H).length, before);
  d.view.inputs.name.type("Kept", d.cx);
  d.view.inputs.folder.type("/kept", d.cx);
  await d.click("promote-yes");
  assert.deepEqual(hwsCalls(H).at(-1).args, ["promote", "--workspace", "spc1", "--name", "Kept", "--folder", "/kept", "--json"]);
  assert.deepEqual(H.closed, ["ov8"]);
});

test("toggle opens the panel beside the terminal, returns focus, and closes it", async () => {
  const H = setup();
  await mount("hws-panel", { overlay: "ov0" });
  assert.deepEqual(H.closed, ["ov0"]);
  assert.deepEqual(H.runs, [
    { name: "pane.split", args: { direction: "right", pane: "p1", mod: "hws-panel", props: { terminal: "t1" } } },
    { name: "pane.focus", args: { terminal: "t1" } },
  ]);

  const H2 = setup({ panes: [{ pane: "p1", terminal: "t1", tab: "tb1" }, { pane: "p2", terminal: null, mod: "hws-panel", tab: "tb1" }] });
  await mount("hws-panel", { overlay: "ov0" });
  assert.deepEqual(H2.runs, [{ name: "pane.close", args: { pane: "p2" } }]);
});

test("the panel polls once every 20 seconds and overlapping refreshes collapse", async () => {
  const H = inWorkspace();
  const m = await mount("hws-panel", {});
  assert.deepEqual(m.timers.filter((t) => t.repeating).map((t) => t.ms), [20000]);
  const lists = () => args(H).filter((a) => a[0] === "list").length;
  assert.equal(lists(), 1);
  m.render();
  await settle();
  assert.equal(lists(), 1);
  await m.fireTimer(20000);
  assert.equal(lists(), 2);
});

test("the watch reloads for manifest changes and ignores surface writes", async () => {
  const { dir } = APP;
  const batches = [[`${dir}/surfaces/s1/board.json`], [`${dir}/workspace.json`]];
  const H = inWorkspace(APP, { watchResult: () => (batches.length ? Promise.resolve(batches.shift()) : new Promise(() => {})) });
  const m = await mount("hws-panel", {});
  m.render();
  await settle();
  assert.deepEqual([...new Set(H.watches)], [dir]);
  assert.equal(args(H).filter((a) => a[0] === "list").length, 2);
});

test("a space change refreshes and clears the panel's note", async () => {
  const H = inWorkspace();
  const m = await mount("hws-panel", {});
  m.view.note = { text: "Copied.", isError: false };
  H.focused = { ...H.focused, space: "spc2" };
  assert.match(m.text(), /Not in a workspace/);
  await settle();
  assert.equal(m.view.note, null);
  assert.equal(args(H).filter((a) => a[0] === "list").length, 2);
  assert.deepEqual(args(H).find((a) => a[0] === "space"), ["space", "match", "--space", "spc2", "--json"]);
});

test("a hws failure on list shows the message", async () => {
  setup({ hws: { list: { fail: "state folder unreadable" } } });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /state folder unreadable/);
});

// Context sections

const ctx = await import("../hws-panel/context.js");

const NOW = Date.now();
const NOTE_PATH = "/Users/me/Projects/checkout/docs/NEXT-STEPS.md";
const NOTE = [
  "# Current",
  "",
  "## Now",
  "- Boards open in their own window [commit:ba7d965abc]",
  "",
  "## Decisions in force",
  "- 2026-11-04 Studio is removed [card:17] [session:abcdef1234567890]",
  "",
  "## Next",
  "- Pick a panel treatment [file:docs/panel-options.md]",
  "- See the bundle [artifact:new]",
  "- Read the raw notes [file:notes/raw.txt]",
].join("\n");
const LINE = "Current is 3 sessions and 2 artifacts behind, last tidied Nov 3";
const STATUS = {
  tidiedAt: new Date(new Date(NOW).getFullYear(), 10, 3).getTime(),
  stage: "deciding",
  behind: { sessions: 3, artifacts: 2, commits: 0, cards: 0 },
  items: [
    { kind: "session", id: "abcdef1234567890", title: "Fix login", at: NOW - 120000, path: "/t.jsonl" },
    { kind: "artifact", id: "new", title: "newer", at: NOW - 3600000, path: "/art/new" },
    { kind: "card", id: "17", title: "Remove Studio", at: null, path: null },
  ],
  git: { repo: true, head: "abc", base: null, baseFound: false },
  live: null,
  places: { current: NOTE_PATH, artifacts: "/Users/me/Projects/checkout/.herdr-workspace/checkout-c1/artifacts", scratch: "/Users/me/Projects/checkout/.herdr-workspace/checkout-c1/scratch", decisions: "/Users/me/Projects/checkout/decisions", history: null, meetings: null },
  writers: { current: null, artifacts: null, scratch: null, decisions: "pmos", history: null, meetings: null },
  line: LINE,
};
const KEPT = {
  ...APP,
  stage: "deciding",
  board: { space: "spb", tab: "tbb" },
  places: { current: "docs/NEXT-STEPS.md", decisions: { path: "decisions", writer: "pmos" } },
  terminals: [{ terminal: "t13", tabId: "tb1", sessionId: "live0000aaaa", role: "planner" }],
  artifacts: [
    { id: "old", type: "note", title: "older", path: "/art/old", prompt: "/art/old/prompt.md", createdAt: 1000, status: "superseded" },
    { id: "new", type: "board", title: "newer", path: "/art/new", prompt: "/art/new/prompt.md", createdAt: 2000, status: "draft" },
    { id: "doc", type: "file", title: "spec", path: "/Users/me/Projects/checkout/docs/spec.md", createdAt: 1500, status: "current" },
  ],
};

function kept(extra = {}, answers = {}) {
  const H = inWorkspace(KEPT, {
    files: { [NOTE_PATH]: NOTE },
    hws: {
      list: [KEPT],
      "tidy status": STATUS,
      "tidy start": { terminal: "t20", started: true, packet: "/p.json" },
      ...answers,
    },
    ...extra,
  });
  H.hcCalls = [];
  return H;
}

test("freshness is fresh at zero, behind up to five and stale above", () => {
  const at = (n, tidiedAt = 1) => ctx.freshness({ tidiedAt, behind: { sessions: n, artifacts: 0, commits: 0, cards: 0 } });
  assert.deepEqual([at(0), at(1), at(5), at(6)], ["fresh", "behind", "behind", "stale"]);
  assert.equal(at(0, null), "unwritten");
  assert.equal(at(9, null), "unwritten");
  assert.equal(ctx.freshness({ behind: { sessions: 0, artifacts: 0, commits: 0, cards: 0 } }), "unwritten");
  assert.equal(ctx.freshness({ tidiedAt: 1, behind: { sessions: 9, artifacts: 0, commits: 0, cards: 0 }, landed: { total: 0 } }), "fresh");
  assert.equal(ctx.freshness({ tidiedAt: 1, behind: { sessions: 0, artifacts: 0, commits: 7, cards: 0 }, landed: { total: 7 } }), "stale");
  assert.equal(ctx.freshness({}), null);
  assert.equal(ctx.freshness(null), null);
});

test("the counts line drops zero counts and keeps every zero when nothing is behind", () => {
  assert.equal(ctx.countsLine(STATUS.behind), "3 sessions · 2 artifacts");
  assert.equal(ctx.countsLine({ sessions: 0, artifacts: 1, commits: 1, cards: 2 }), "1 artifact · 1 commit · 2 cards");
  assert.equal(ctx.countsLine({ sessions: 0, artifacts: 0, commits: 0, cards: 0 }), "0 sessions · 0 artifacts · 0 commits · 0 cards");
  assert.equal(ctx.countsLine(undefined), "0 sessions · 0 artifacts · 0 commits · 0 cards");
});

test("note lines keep headings and bullets, pull out cites and stop at the first screen", () => {
  const { lines, more } = ctx.noteLines(NOTE);
  assert.equal(more, 0);
  assert.deepEqual(lines[4], { kind: "bullet", text: "2026-11-04 Studio is removed", cites: [{ kind: "card", value: "17" }, { kind: "session", value: "abcdef1234567890" }] });
  assert.equal(lines[1].kind, "heading");
  const long = ctx.noteLines(Array.from({ length: 30 }, (_, i) => `- line ${i}`).join("\n"));
  assert.equal(long.lines.length, ctx.NOTE_LINES);
  assert.equal(long.more, 30 - ctx.NOTE_LINES);
});

test("a note table is one entry that keeps its rows and gives up its cites", () => {
  const table = ["| Horizon | What |", "|---|---|", "| Now | Boards [commit:ba7d965] |", "| Next | Notes |"].join("\n");
  const { lines, more } = ctx.noteLines(`# Plan\n\nBefore\n${table}\nAfter`);
  assert.equal(more, 0);
  assert.deepEqual(lines.map((line) => line.kind), ["heading", "text", "table", "text"]);
  assert.equal(lines[2].text, ["| Horizon | What |", "|---|---|", "| Now | Boards |", "| Next | Notes |"].join("\n"));
  assert.deepEqual(lines[2].cites, [{ kind: "commit", value: "ba7d965" }]);
});

test("a line with a pipe stays text without a rule row under it", () => {
  assert.deepEqual(ctx.noteLines("a | b\nc | d").lines.map((line) => line.kind), ["text", "text"]);
});

test("a table counts once toward the first screen", () => {
  const rows = Array.from({ length: 40 }, (_, i) => `| ${i} | x |`).join("\n");
  const { lines, more } = ctx.noteLines(`| a | b |\n|---|---|\n${rows}`);
  assert.equal(lines.length, 1);
  assert.equal(more, 0);
});

test("a note link resolves against the note and a web link stays a url", () => {
  const note = "/w/05-projects/plan/CURRENT.md";
  assert.deepEqual(ctx.linkCite("story.html", note), { kind: "file", value: "/w/05-projects/plan/story.html" });
  assert.deepEqual(ctx.linkCite("../cert/my%20plan.html#top", note), { kind: "file", value: "/w/05-projects/cert/my plan.html" });
  assert.deepEqual(ctx.linkCite("file:///w/a.pptx", note), { kind: "file", value: "/w/a.pptx" });
  assert.deepEqual(ctx.linkCite("https://claude.ai/artifact/abc", note), { kind: "url", value: "https://claude.ai/artifact/abc" });
  assert.equal(ctx.linkCite("#open-items", note), null);
});

test("backlog rows turn status items into cites", () => {
  assert.deepEqual(ctx.backlogRow({ kind: "commit", id: "abc1234", title: "Fix it", at: 5, path: null }), { source: "commit", title: "Fix it", at: 5, cite: { kind: "commit", value: "abc1234" } });
  assert.equal(ctx.backlogRow({ kind: "session", id: "abcdef123456", title: null }).title, "Session abcdef12");
  assert.equal(ctx.backlogRow({ kind: "card", id: 9, title: "x" }).cite.value, "9");
  assert.equal(ctx.backlogRow({ kind: "other", id: "x" }).cite, null);
  assert.deepEqual(ctx.livePass({ live: { terminal: "t12", startedAt: 1 } }), { terminal: "t12", startedAt: 1 });
  assert.equal(ctx.livePass({ live: null }), null);
});

test("superseded artifacts are held apart", () => {
  const groups = ctx.artifactGroups(KEPT.artifacts);
  assert.deepEqual(groups.shown.map((a) => a.id), ["new", "doc"]);
  assert.deepEqual(groups.superseded.map((a) => a.id), ["old"]);
});

test("place rows cover every role, with defaults and other writers", () => {
  const rows = ctx.placeRows(KEPT, STATUS);
  assert.deepEqual(rows.map((r) => r.role), ctx.ROLES);
  assert.deepEqual(rows[0], { role: "current", path: "docs/NEXT-STEPS.md", writer: null, resolved: NOTE_PATH });
  assert.equal(rows.find((r) => r.role === "decisions").writer, "pmos");
  assert.equal(rows.find((r) => r.role === "scratch").path, "");
  assert.match(rows.find((r) => r.role === "scratch").resolved, /scratch$/);
  assert.equal(ctx.placeRows({ places: {} }, { writers: { history: "pmos" } }).find((r) => r.role === "history").writer, "pmos");
  assert.equal(ctx.placeRows({ places: { history: { path: "h", writer: "hws" } } }).find((r) => r.role === "history").writer, null);
  assert.equal(ctx.placeRows(KEPT)[0].resolved, null);
});

test("the header shows the stage, the freshness line, Open note and Tidy", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  const text = m.text();
  assert.match(text, /checkout demo \| deciding \| ···/);
  assert.match(text, new RegExp(`${LINE} \\| Tidy \\| Open note`));
  assert.deepEqual(args(H).filter((a) => a[0] === "tidy" || a[0] === "place"), [["tidy", "status", "--workspace", "spc1", "--json"]]);
  await m.click("open-current");
  assert.deepEqual(args(H).find((a) => a[0] === "surface"), ["surface", "open", "--type", "note", "--file", NOTE_PATH, "--terminal", "t13", "--json"]);
  await m.click("tidy");
  assert.deepEqual(args(H).find((a) => a[1] === "start"), ["tidy", "start", "--workspace", "spc1", "--json"]);
  assert.match(m.text(), /Tidy started in a terminal\. Answer any questions there\./);
});

test("the header reads unknown with no line, and Tidy again pokes a live pass", async () => {
  kept({}, { "tidy status": { ...STATUS, line: null, live: { terminal: "t12", startedAt: 1, packet: "/p.json" } }, "tidy start": { terminal: "t12", started: false, packet: "/p.json" } });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /Freshness unknown/);
  assert.match(m.text(), /Tidy again/);
  assert.match(m.text(), /A tidy pass is running\. Click to go to it\./);
  await m.click("tidy-live");
  assert.deepEqual(globalThis.__herdr.runs.at(-1), { name: "agent.focus", args: { terminal: "t12" } });
  await m.click("tidy");
  assert.match(m.text(), /Asked the tidy pass to read the packet again/);
});

test("with no agent Open note reads in the panel, and it needs a note or a path", async () => {
  const noAgent = { agents: [{ ...AGENT, focused: false }], focused: { space: "spc1", tab: "tb1", pane: "p2", terminal: null } };
  const H = kept(noAgent);
  const m = await mount("hws-panel", {});
  assert.equal(m.clickable("tidy"), true);
  await m.click("open-current");
  await m.settle();
  assert.equal(args(H).some((a) => a[0] === "surface"), false);
  assert.match(m.text(), /Back \| Current note/);
  kept({ ...noAgent, files: {} });
  const unwritten = await mount("hws-panel", {});
  assert.equal(unwritten.clickable("open-current"), false);
  kept({}, { "tidy status": { ...STATUS, places: { ...STATUS.places, current: null } } });
  const none = await mount("hws-panel", {});
  assert.equal(none.clickable("open-current"), false);
  assert.match(none.text(), /A short summary of where this work stands\. Tidy writes it\./);
});

test("Current renders the note with a chip per cite", async () => {
  kept();
  const m = await mount("hws-panel", {});
  const text = m.text();
  assert.match(text, /Current.*Now.*Boards open in their own window \| ba7d965.*Studio is removed \| card 17 \| session abcdef12.*panel-options\.md.*newer.*raw\.txt/);
  assert.equal(text.includes("[commit:"), false);
});

test("a missing note explains itself and names where Tidy writes it", async () => {
  kept({ files: {} });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /A short summary of where this work stands\. Tidy writes it to ~\/Projects\/checkout\/docs\/NEXT-STEPS\.md/);
});

test("a card cite opens the card dialog over the Board", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  await m.click("cite-4-0");
  assert.deepEqual(H.runs.slice(-2), [{ name: "space.select", args: { id: "spb" } }, { name: "tab.select", args: { id: "tbb" } }]);
  const spec = H.overlays.at(-1);
  assert.equal(spec.mod, "hws-work");
  assert.equal(spec.kind, "dialog");
  assert.deepEqual(spec.props, { view: "todo", space: "spb", id: "17", height: spec.height });
});

test("a session cite resumes in a new tab, or focuses the session when it still runs", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  await m.click("cite-4-1");
  assert.deepEqual(H.runs.at(-1), { name: "tab.new", args: { name: "Resume abcdef12", space: "spc1", folder: KEPT.folder, argv: ["claude", "--resume", "abcdef1234567890"] } });
  const cites = await import("../hws-panel/cites.js");
  cites.resumeSession("live0000aaaa", KEPT, "spc1");
  assert.deepEqual(H.runs.at(-1), { name: "agent.focus", args: { terminal: "t13" } });
});

test("a commit cite copies the sha", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  await m.click("cite-2-0");
  const copy = H.calls.at(-1);
  assert.equal(copy.command, "sh");
  assert.deepEqual(copy.args.slice(2), ["sh", "ba7d965abc"]);
  assert.match(m.text(), /Copied ba7d965\./);
});

test("a markdown cite opens in the companion and other files open in macOS", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  await m.click("cite-6-0");
  await m.settle();
  assert.deepEqual(args(H).filter((a) => a[0] === "surface").at(-1), ["surface", "open", "--type", "page", "--file", "/Users/me/Projects/checkout/docs/panel-options.md", "--terminal", "t13", "--json"]);
  await m.click("cite-8-0");
  assert.deepEqual(H.calls.at(-1), { command: "open", args: ["/Users/me/Projects/checkout/notes/raw.txt"] });
});

test("with no agent an artifact opens standalone in the companion", async () => {
  const H = kept({ agents: [{ ...AGENT, focused: false }], focused: { space: "spc1", tab: "tb1", pane: "p2", terminal: null } });
  const m = await mount("hws-panel", {});
  await m.click("open-doc");
  await m.settle();
  assert.deepEqual(args(H).filter((a) => a[0] === "surface").at(-1), ["surface", "open", "--type", "page", "--file", "/Users/me/Projects/checkout/docs/spec.md", "--title", "spec", "--standalone", "--json"]);
});

test("a file already open in the companion gets the focus", async () => {
  const surfaces = [{ id: "s9", type: "page", title: "spec", file: "/Users/me/Projects/checkout/docs/spec.md", terminal: "t13", pane: "p9" }];
  const H = kept({}, { list: [{ ...KEPT, surfaces }] });
  H.panes.push({ pane: "p9", terminal: null, tab: "tb1" });
  const m = await mount("hws-panel", {});
  await m.click("artifact-open-doc");
  await m.settle();
  assert.deepEqual(H.runs.at(-1), { name: "pane.focus", args: { pane: "p9" } });
  assert.equal(args(H).some((a) => a[0] === "surface"), false);
});

test("an HTML cite opens as a page beside the agent", async () => {
  const H = kept({ files: { [NOTE_PATH]: "- mock [file:docs/page.html]" } });
  const m = await mount("hws-panel", {});
  await m.click("cite-0-0");
  assert.deepEqual(args(H).filter((a) => a[0] === "surface").at(-1), ["surface", "open", "--type", "page", "--file", "/Users/me/Projects/checkout/docs/page.html", "--terminal", "t13", "--json"]);
});

test("a flipped agent's page opens beside its chat pane", async () => {
  const H = kept({ files: { [NOTE_PATH]: "- mock [file:docs/page.html]" }, terminals: [{ address: "t13", state: "live", labels: { "herdr.chat": "p7" } }] });
  H.panes.push({ pane: "p7", terminal: null, tab: "tb1", mod: "hws-chat" });
  const m = await mount("hws-panel", {});
  await m.click("cite-0-0");
  assert.deepEqual(args(H).filter((a) => a[0] === "surface").at(-1).slice(-5), ["--beside-pane", "p7", "--space", "spc1", "--json"]);
});

test("the artifact row has one line, with Open and a menu", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /spec \| file · .* \| Open \| ···/);
  assert.doesNotMatch(m.text(), /Copy for Claude/);
  await m.click("more-new");
  assert.equal(H.overlays.at(-1).props.view, "artifact-menu");
  assert.equal(H.overlays.at(-1).kind, "popup");
});

test("a board opens its comments in the companion, or else its sketch", async () => {
  const H1 = kept({ files: { [NOTE_PATH]: NOTE, "/art/new/comments.md": "# Comments" } });
  const withComments = await mount("hws-panel", {});
  await withComments.click("open-new");
  await withComments.settle();
  assert.equal(args(H1).filter((a) => a[0] === "surface").at(-1)[5], "/art/new/comments.md");
  const H2 = kept({ files: { [NOTE_PATH]: NOTE, "/art/new/prompt.md": "@/art/new/sketch.png" } });
  const noComments = await mount("hws-panel", {});
  await noComments.click("open-new");
  await noComments.settle();
  assert.equal(args(H2).some((a) => a[0] === "surface"), false);
  assert.deepEqual(H2.calls.at(-1), { command: "open", args: ["/art/new/sketch.png"] });
});

test("a note bundle opens its prompt in the companion", async () => {
  const H = kept({ files: { [NOTE_PATH]: NOTE, "/art/old/prompt.md": "my note" } });
  const m = await mount("hws-panel", {});
  await m.click("superseded-toggle-notes");
  await m.click("open-old");
  await m.settle();
  assert.equal(args(H).filter((a) => a[0] === "surface").at(-1)[5], "/art/old/prompt.md");
});

// Panel layout helpers. They read the rendered tree, which the harness keeps as nodes.
const panelNode = (el, match) => {
  const n = el?.node ?? el;
  if (typeof n !== "object" || n === null) return null;
  if (match(n)) return n;
  for (const c of n.children ?? []) {
    const hit = panelNode(c, match);
    if (hit) return hit;
  }
  return null;
};
const panelById = (m, id) => panelNode(m.render(), (n) => n.id === id);
const panelLabel = (m, text) => panelNode(m.render(), (n) => n.children?.length === 1 && n.children[0] === text);
const panelText = (n) => (typeof n === "string" ? n : (n?.children ?? []).map((c) => panelText(c?.node ?? c)).filter(Boolean).join(" | "));

test("the header says where a workspace runs and keeps its files on two lines, when they differ", async () => {
  kept({}, { list: [{ ...KEPT, home: "/Users/me/Projects/checkout/05/p1" }] });
  const m = await mount("hws-panel", {});
  assert.equal(panelText(panelById(m, "header-runs-in")), "Runs in | ~/Projects/checkout");
  assert.equal(panelText(panelById(m, "header-files-in")), "Files in | ~/Projects/checkout/05/p1");
});

test("the header groups what the workspace is apart from how its context stands", async () => {
  kept();
  const m = await mount("hws-panel", {});
  const identity = panelText(panelById(m, "header-identity"));
  const state = panelText(panelById(m, "header-state"));
  assert.match(identity, /^checkout demo \| deciding \| ··· \| ~\/Projects\/checkout \| Ship the demo \| Instructions…$/);
  assert.match(state, /Tidy.*Open note.*Tasks/);
  assert.doesNotMatch(state, /Instructions|deciding/);
});

test("the stage control is a small button, and Tidy is the header's one filled button", async () => {
  kept({}, { list: [{ ...KEPT, stage: null }] });
  const m = await mount("hws-panel", {});
  assert.match(panelText(panelById(m, "stage")), /^Set stage$/);
  for (const id of ["stage", "workspace-menu", "edit-instructions", "open-current"]) assert.equal(panelById(m, id).bg, undefined, id);
  assert.equal(panelById(m, "tidy").bg, "color:solid");
});

test("a throwaway's header shows a plain Throwaway label in place of the stage", async () => {
  inWorkspace(THROWAWAY);
  const m = await mount("hws-panel", {});
  assert.equal(m.has("stage"), false);
  assert.equal(panelLabel(m, "Throwaway").text_color, "color:dim");
  assert.equal(m.has("header-state"), false);
});

test("section titles are dim labels, apart from the note's own headings", async () => {
  kept();
  const m = await mount("hws-panel", {});
  for (const title of ["Current note", "Not in the note yet", "Artifacts"]) assert.equal(panelLabel(m, title).text_color, "color:dim", title);
  assert.equal(panelLabel(m, "Now").text_color, "color:foreground");
});

test("a plain space fills Add this space only when it has one candidate", async () => {
  setup({ hws: { list: [], "space match": MATCH(1) } });
  const one = await mount("hws-panel", {});
  assert.equal(panelById(one, "join-w0").bg, "color:solid");
  assert.equal(panelById(one, "new-workspace").bg, "color:raised");
  assert.equal(panelText(panelById(one, "outside-title")), "Not in a workspace");
  setup({ hws: { list: [], "space match": MATCH(2) } });
  const two = await mount("hws-panel", {});
  assert.equal(panelById(two, "join-w0").bg, "color:raised");
  assert.equal(panelById(two, "join-w1").bg, "color:raised");
});

test("the stage pill opens the stage menu, which runs hws set --stage", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  await m.click("stage");
  const spec = H.overlays.at(-1);
  assert.deepEqual([spec.kind, spec.props], ["popup", { view: "stage-menu", workspace: "spc1" }]);
  const menu = await mount("hws-panel", { ...spec.props, overlay: "ov2" }, H);
  assert.match(menu.text(), /Discovery \| Deciding \| Building \| Settled/);
  await menu.click("row-menu-building");
  assert.deepEqual(H.closed.at(-1), "ov2");
  assert.deepEqual(args(H).at(-1), ["set", "--workspace", "spc1", "--stage", "building", "--json"]);
});

test("with no stage the pill reads Set stage, and a throwaway keeps a plain pill", async () => {
  kept({}, { list: [{ ...KEPT, stage: undefined }] });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /checkout demo \| Set stage/);
  inWorkspace(THROWAWAY);
  const scrap = await mount("hws-panel", {});
  assert.equal(scrap.has("stage"), false);
  assert.match(scrap.text(), /scratch \| Throwaway/);
});

const TODOS = { space: "spb", workspace: "spc1", items: [
  { id: "a", column: "todo" }, { id: "b", column: "todo" }, { id: "c", column: "doing" }, { id: "d", column: "waiting" }, { id: "e", column: "done" },
] };

test("the Tasks line counts open cards by column and shows the Board on click", async () => {
  const H = kept({}, { "todo list": TODOS });
  const m = await mount("hws-panel", {});
  assert.deepEqual(args(H).find((a) => a[0] === "todo"), ["todo", "list", "--space", "spb", "--json"]);
  assert.match(m.text(), new RegExp(`${LINE}.*Tasks \\| 2 to do · 1 in progress · 1 waiting on you`));
  const before = H.overlays.length;
  await m.click("tasks-row");
  assert.deepEqual(H.runs.slice(-2), [{ name: "space.select", args: { id: "spb" } }, { name: "tab.select", args: { id: "tbb" } }]);
  assert.equal(H.overlays.length, before);
});

test("the Tasks line leaves out empty columns and says Nothing open", async () => {
  kept({}, { "todo list": { items: [{ id: "x", column: "waiting" }, { id: "y", column: "done" }] } });
  const one = await mount("hws-panel", {});
  assert.match(one.text(), /Tasks \| 1 waiting on you/);
  assert.doesNotMatch(one.text(), /to do|in progress/);
  kept({}, { "todo list": { items: [] } });
  const none = await mount("hws-panel", {});
  assert.match(none.text(), /Tasks \| Nothing open/);
  assert.equal(ctx.tasksLine(ctx.taskCounts(undefined)), "Nothing open");
});

test("a slow or failed task list never holds up the rest of the panel", async () => {
  let release;
  const H = kept({}, { "todo list": () => ({ fail: "board unreadable" }) });
  H.exec = ((inner) => async (command, argv = []) => (argv[0] === "todo" ? new Promise((resolve) => { release = () => resolve(inner(command, argv)); }) : inner(command, argv)))(H.exec);
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /Boards open in their own window/);
  assert.match(m.text(), /Tasks \| Checking…/);
  release();
  await m.settle();
  assert.match(m.text(), /Boards open in their own window/);
  assert.equal(m.has("tasks-row"), true);
  assert.doesNotMatch(m.text(), /Checking…|board unreadable/);
});

test("a workspace with no Board offers Add tasks, which then shows Tasks", async () => {
  const H = kept({}, { list: [{ ...KEPT, board: undefined }], "board add": { workspace: "spc1", space: "spb", tab: "tbb" } });
  const m = await mount("hws-panel", {});
  assert.equal(args(H).some((a) => a[0] === "todo"), false);
  assert.match(m.text(), /No task list yet \| Add tasks/);
  await m.click("add-tasks");
  assert.deepEqual(args(H).find((a) => a[0] === "board"), ["board", "add", "--workspace", "spc1", "--json"]);
  assert.deepEqual(H.runs.slice(-2), [{ name: "space.select", args: { id: "spb" } }, { name: "tab.select", args: { id: "tbb" } }]);
  inWorkspace(THROWAWAY);
  const scrap = await mount("hws-panel", {});
  assert.doesNotMatch(scrap.text(), /Tasks|task list/);
});

test("a failed Add tasks shows the problem and moves nothing", async () => {
  const H = kept({}, { list: [{ ...KEPT, board: undefined }], "board add": { fail: "folder is read-only" } });
  const m = await mount("hws-panel", {});
  await m.click("add-tasks");
  assert.match(m.text(), /folder is read-only/);
  assert.equal(H.runs.some((r) => r.name === "tab.select"), false);
});

test("with no note yet the ring shows its own quiet state and the sentence stays", async () => {
  kept({ files: {} }, { "tidy status": { ...STATUS, tidiedAt: null, line: "No current note yet", landed: { total: 3 } } });
  const m = await mount("hws-panel", {});
  assert.equal(ctx.freshness(m.view.context.status), "unwritten");
  assert.equal(ctx.FRESHNESS_COLOR.unwritten, "dim");
  assert.match(m.text(), /No current note yet \| Tidy/);
});

test("a type of board reads sketch", () => {
  assert.equal(ctx.typeLabel("board"), "sketch");
  assert.equal(ctx.typeLabel("note"), "note");
  assert.equal(ctx.nameList(["a", "b", "c"]), "a, b and c");
  assert.equal(ctx.nameList(["a"]), "a");
});

test("a written note shows as a note in the backlog", async () => {
  assert.equal(ctx.backlogRow({ kind: "artifact", type: "note", id: "a1", title: "T" }).source, "note");
  assert.deepEqual(ctx.backlogRow({ kind: "artifact", type: "note", id: "a1", title: "T" }).cite, { kind: "artifact", value: "a1" });
});

test("Tidy passes the panel's pane so the terminal opens below it", async () => {
  const H = kept({}, {});
  H.panes.push({ pane: "p7", terminal: null, tab: "tb1", mod: "hws-panel" });
  const m = await mount("hws-panel", {});
  await m.click("tidy");
  assert.deepEqual(args(H).find((a) => a[1] === "start"), ["tidy", "start", "--workspace", "spc1", "--pane", "p7", "--json"]);
});

test("History opens the decision log and updates in the reader", async () => {
  kept({ files: { [NOTE_PATH]: NOTE, "/w/decisions.md": "# Decisions log" } }, { "tidy status": { ...STATUS, record: { decisions: { path: "/w/decisions.md", inForce: 2, replaced: 1 }, updates: "/w/updates.md" } } });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /History.*Decision log.*2 in force · 1 replaced.*Updates/);
  await m.click("history-decisions");
  await m.settle();
  assert.match(m.text(), /Back \| Decision log.*# Decisions log/s);
});

test("a long note folds after 24 lines and shows the rest in place", async () => {
  const long = Array.from({ length: 30 }, (_, i) => `- line ${i}`).join("\n");
  kept({ files: { [NOTE_PATH]: long } });
  const m = await mount("hws-panel", {});
  assert.doesNotMatch(m.text(), /line 29/);
  assert.match(m.text(), /6 more lines/);
  await m.click("note-more");
  assert.match(m.text(), /line 29/);
});

test("the note's own title does not repeat under the section title", async () => {
  kept();
  const m = await mount("hws-panel", {});
  assert.doesNotMatch(m.text(), /Current note \| Current \|/);
});

test("an unknown artifact cite shows the problem", async () => {
  kept({ files: { [NOTE_PATH]: "- gone [artifact:zzz]" } });
  const m = await mount("hws-panel", {});
  await m.click("cite-0-0");
  assert.match(m.text(), /No artifact zzz in this workspace/);
});

test("Not in the note yet shows the counts and rows, and a row opens its cite", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /Not in the note yet \| 3 sessions · 2 artifacts \| .*session \| Fix login \| 2m ago.*artifact \| newer \| 1h ago.*card \| Remove Studio/);
  await m.click("since-2");
  assert.equal(H.overlays.at(-1).props.id, "17");
});

test("a multi-line title stays on one backlog row", async () => {
  const items = [{ kind: "session", id: "s1", title: "first line\n\n1. second\n2. third", at: NOW, path: null }];
  kept({}, { "tidy status": { ...STATUS, items } });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /session \| first line 1\. second 2\. third \| just now/);
});

test("a long backlog folds after eight rows", async () => {
  const items = Array.from({ length: 11 }, (_, i) => ({ kind: "commit", id: `sha${i}`, title: `Commit ${i}`, at: NOW, path: null }));
  kept({}, { "tidy status": { ...STATUS, items } });
  const m = await mount("hws-panel", {});
  assert.equal(m.has("since-7"), true);
  assert.equal(m.has("since-8"), false);
  await m.click("since-more");
  assert.equal(m.has("since-10"), true);
});

test("a failed tidy status leaves the rest of the panel working", async () => {
  const H = kept({}, { "tidy status": { fail: "unknown command tidy" }, "place current": { role: "current", path: NOTE_PATH, writer: null } });
  const m = await mount("hws-panel", {});
  assert.deepEqual(args(H).find((a) => a[0] === "place"), ["place", "current", "--workspace", "spc1", "--json"]);
  assert.match(m.text(), /Freshness unavailable\. unknown command tidy/);
  assert.match(m.text(), /Freshness unknown/);
  assert.match(m.text(), /Boards open in their own window/);
});

test("artifact rows chip only a status worth noticing and fold superseded ones", async () => {
  kept();
  const m = await mount("hws-panel", {});
  const text = m.text();
  assert.match(text, /Notes.*Show 1 superseded.*Artifacts.*newer \| draft.*spec \| file/);
  assert.equal(m.has("open-old"), false);
  await m.click("superseded-toggle-notes");
  assert.equal(m.has("open-old"), true);
  assert.match(m.text(), /older \| superseded/);
});

const round = (id, createdAt, reviewOf, title = "Feedback on spec") => ({ id, type: "page", role: "feedback", title, path: `/art/${id}`, prompt: `/art/${id}/prompt.md`, file: "/w/spec.md", reviewOf, createdAt, status: "current" });
const ROUNDS = { ...KEPT, artifacts: [...KEPT.artifacts, round("r1", 1600, "doc"), round("r2", 1700, "doc"), round("r3", 1800, null, "Feedback on loose.html")] };

test("feedback rounds sort under the page they review, and an untracked page's round stands alone", () => {
  const { under, loose } = ctx.feedbackRounds(ROUNDS.artifacts);
  assert.deepEqual(under.doc.map((a) => a.id), ["r2", "r1"]);
  assert.deepEqual(loose.map((a) => a.id), ["r3"]);
  assert.deepEqual(ctx.roundFiles(ROUNDS.artifacts.at(-1)).at(0), "/art/r3/review.md");
});

test("a page row counts its feedback, unfolds the rounds and reads one in the panel", async () => {
  kept({ files: { [NOTE_PATH]: NOTE, "/art/r2/review.md": "# Review of spec" } }, { list: [ROUNDS] });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /spec \| 2 feedback \| file.*Feedback on loose\.html/);
  assert.equal(m.has("open-r1"), false);
  assert.equal(m.has("round-r2"), false);
  assert.equal(m.has("round-r3"), true);
  await m.click("rounds-toggle-doc");
  assert.equal(m.has("round-r1"), true);
  await m.click("round-r2");
  await m.settle();
  assert.match(m.text(), /Back \| Feedback on spec.*# Review of spec/s);
});

test("Places shows a row per role and records an edit with hws set --place", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  await m.click("places-toggle");
  assert.match(m.text(), /Where files go.*current.*artifacts.*scratch.*decisions \| decisions \| written by pmos.*history.*meetings/);
  const current = m.view.inputs["place-current"];
  assert.equal(current.value(), "docs/NEXT-STEPS.md");
  assert.equal(m.view.inputs["place-scratch"].placeholder, ctx.ROLE_DEFAULTS.scratch);
  assert.equal(m.has("place-save-decisions"), false);

  current.type("docs/NEXT-STEPS.md ", m.cx);
  current.submit(m.cx);
  await settle();
  assert.equal(args(H).some((a) => a[0] === "set"), false);

  current.type("docs/CURRENT.md", m.cx);
  assert.equal(m.has("place-save-current"), true);
  await m.click("place-save-current");
  assert.deepEqual(args(H).find((a) => a[0] === "set"), ["set", "--workspace", "spc1", "--place", "current=docs/CURRENT.md", "--json"]);
  assert.match(m.text(), /Saved the current place/);
  assert.equal(m.has("place-save-current"), false);
});

test("a place another tool writes is read only, with its resolved path when the manifest has none", async () => {
  kept({}, { list: [{ ...KEPT, places: { current: "docs/NEXT-STEPS.md" } }] });
  const m = await mount("hws-panel", {});
  await m.click("places-toggle");
  assert.match(m.text(), /decisions \| ~\/Projects\/checkout\/decisions \| written by pmos/);
  assert.equal(m.has("place-save-decisions"), false);
});

test("an emptied place field clears the role", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  await m.click("places-toggle");
  m.view.inputs["place-current"].type("", m.cx);
  assert.match(m.text(), /Clear/);
  await m.click("place-save-current");
  assert.deepEqual(args(H).find((a) => a[0] === "set"), ["set", "--workspace", "spc1", "--place", "current=", "--json"]);
  assert.match(m.text(), /Cleared the current place/);
});

test("Enter in a place field saves it", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  m.render();
  m.view.inputs["place-history"].type("docs/history", m.cx);
  m.view.inputs["place-history"].submit(m.cx);
  await settle();
  assert.deepEqual(args(H).find((a) => a[0] === "set"), ["set", "--workspace", "spc1", "--place", "history=docs/history", "--json"]);
});

test("a place saved elsewhere replaces an untouched field and keeps an edit", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  m.render();
  m.view.inputs["place-scratch"].type("mine", m.cx);
  const moved = { ...KEPT, places: { ...KEPT.places, current: "NOW.md", scratch: "theirs" } };
  H.hws.list = [moved];
  await m.fireTimer(20000);
  m.render();
  assert.equal(m.view.inputs["place-current"].value(), "NOW.md");
  assert.equal(m.view.inputs["place-scratch"].value(), "mine");
});

test("Suggest from folder pastes the prompt into the agent", async () => {
  const H = kept();
  const m = await mount("hws-panel", {});
  await m.click("places-toggle");
  await m.click("suggest-places");
  assert.equal(H.hcCalls.length, 1);
  const [verb, terminal, text] = H.hcCalls[0];
  assert.deepEqual([verb, terminal], ["send", "t13"]);
  assert.match(text, /propose a place map/);
  assert.match(text, /hws set --place ROLE=PATH/);
  assert.match(m.text(), /Asked Claude Code to propose places/);

  kept({ agents: [{ ...AGENT, focused: false }], focused: { space: "spc1", tab: "tb1", pane: "p2", terminal: null } });
  const none = await mount("hws-panel", {});
  await none.click("places-toggle");
  assert.equal(none.clickable("suggest-places"), false);
});

test("a throwaway shows its Record and Promote, and reads no freshness", async () => {
  const record = { ...THROWAWAY, terminals: [{ terminal: "t13", tabId: "tb1", sessionId: "aaaabbbbcccc", role: null }], artifacts: [{ id: "a1", type: "note", title: "ideas", path: "/art/a1", createdAt: 1, status: "current" }] };
  const H = inWorkspace(record, { hws: { list: [record] } });
  const m = await mount("hws-panel", {});
  const text = m.text();
  assert.match(text, /Record.*Sessions.*t13 \| aaaabbbb.*Scratch folder.*\/state\/workspaces\/spc1\/scratch.*Artifacts.*ideas.*Promote/);
  assert.equal(text.includes("~/Projects/checkout"), false);
  assert.equal(text.split("/state/workspaces/spc1/scratch").length, 2);
  assert.equal(/Not in the note yet|Where files go|Open note/.test(text), false);
  assert.equal(args(H).some((a) => a[0] === "tidy" || a[0] === "place"), false);
  assert.deepEqual(H.calls.find((c) => c.command === "test").args, ["-d", "/state/workspaces/spc1/scratch"]);
  await m.click("open-scratch");
  assert.deepEqual(H.calls.at(-1), { command: "open", args: ["/state/workspaces/spc1/scratch"] });
  await m.click("session-aaaabbbbcccc");
  assert.deepEqual(H.runs.at(-1), { name: "agent.focus", args: { terminal: "t13" } });
});

test("a reopened throwaway shows the scratch folder its Keep moved", async () => {
  const reopened = { ...THROWAWAY, places: { scratch: "/Users/me/Documents/kept/scratch" } };
  const H = inWorkspace(reopened, { hws: { list: [reopened] } });
  await mount("hws-panel", {});
  assert.deepEqual(H.calls.find((c) => c.command === "test").args, ["-d", "/Users/me/Documents/kept/scratch"]);
});

test("a throwaway with no scratch folder yet offers nothing to open", async () => {
  inWorkspace(THROWAWAY, { hws: { list: [THROWAWAY] }, missingDirs: new Set(["/state/workspaces/spc1/scratch"]) });
  const m = await mount("hws-panel", {});
  assert.equal(m.has("open-scratch"), false);
  assert.match(m.text(), /None recorded/);
});

// Brief

const panelLayout = (panel, active) => ({ id: "root", children: [{ id: "panel", hidden: panel === "hidden", children: [{ id: "panel-body", active, children: [{ id: "outputs" }] }] }] });

test("brief's key shows Outputs in a hidden panel and closes its overlay", async () => {
  const H = setup({ layout: panelLayout("hidden", "files") });
  await mount("hws-brief", { overlay: "ov0" });
  assert.deepEqual(H.runs, [{ name: "layout.select", args: { stack: "panel-body", child: "outputs" } }, { name: "layout.show", args: { id: "panel" } }]);
  assert.deepEqual(H.closed, ["ov0"]);
});

test("brief's key hides the panel when Outputs is already showing", async () => {
  const H = setup({ layout: panelLayout("shown", "outputs") });
  await mount("hws-brief", { overlay: "ov0" });
  assert.deepEqual(H.runs, [{ name: "layout.hide", args: { id: "panel" } }]);
  assert.deepEqual(H.closed, ["ov0"]);
});

test("brief's key shows a toast when the layout has no panel-body", async () => {
  const H = setup({ layout: { id: "root", children: [] }, notices: [] });
  await mount("hws-brief", { overlay: "ov0" });
  assert.deepEqual(H.runs, []);
  assert.equal(H.notices.length, 1);
  assert.deepEqual(H.closed, ["ov0"]);
});

test("brief does nothing without an overlay", async () => {
  const H = setup({ layout: panelLayout("hidden", "files") });
  await mount("hws-brief", {});
  assert.deepEqual(H.runs, []);
  assert.deepEqual(H.closed, []);
});

// Source checks

test("hws-new, hws-panel and hws-actions carry the same hws.js", () => {
  assert.equal(read("../hws-new/hws.js"), read("../hws-panel/hws.js"));
  assert.equal(read("../hws-new/hws.js"), read("../hws-actions/hws.js"));
});

test("every element method used exists in gpui-kit.d.ts", { skip: !existsSync(`${process.env.HOME}/.config/herdr-app/herdr.d.ts`) }, () => {
  const types = readFileSync(`${process.env.HOME}/.config/herdr-app/gpui-kit.d.ts`, "utf8");
  const unknown = usedMethods().filter((name) => !new RegExp(`\\b${name}\\s*[<(]`).test(types));
  assert.deepEqual(unknown, []);
});

test("every herdr import exists in herdr.d.ts", { skip: !existsSync(`${process.env.HOME}/.config/herdr-app/herdr.d.ts`) }, () => {
  const types = readFileSync(`${process.env.HOME}/.config/herdr-app/herdr.d.ts`, "utf8");
  for (const file of ["../hws-new/main.js", "../hws-new/hws.js", "../hws-panel/main.js", "../hws-panel/cites.js", "../hws-panel/sections.js", "../hws-panel/sidebar.js", "../hws-panel/unfiled.js", "../hws-brief/main.js"]) {
    const names = /import \{([^}]*)\} from "herdr"/.exec(read(file))[1].split(",").map((s) => s.trim());
    for (const name of names) assert.match(types, new RegExp(`export function ${name}\\b`), `${file}: ${name}`);
  }
});

test("mods keep the View lifecycle names to themselves", () => {
  for (const file of ["../hws-new/main.js", "../hws-panel/main.js"]) assert.equal(/^  (async )?close\(/m.test(read(file)), false, file);
});

test("keys.example.json avoids the chords Herdr binds", () => {
  const example = JSON.parse(read("../keys.example.json"));
  const herdr = JSON.parse(read("./fixtures/herdr-keys.json"));
  const taken = new Set(Object.values(herdr).flatMap((section) => Object.keys(section)));
  for (const chord of Object.keys(example.global)) assert.equal(taken.has(chord), false, chord);
});

// Sidebar section

const SIDEBAR_LAYOUT = { id: "root", children: [{ id: "sidebar", size: { px: 268 }, children: [{ id: "workspaces", size: { px: 69 } }] }] };

test("the sidebar shares the Board tab ids and watches the manifests", async () => {
  const H = setup({ hws: { list: [{ ...THROWAWAY, board: { space: "spb", tab: "tbb" }, dir: "/state/workspaces/spc1" }] }, sharedSets: [], sharedValues: {} });
  await mount("hws-panel", { view: "sidebar" });
  await settle();
  assert.deepEqual(H.sharedSets.find((x) => x.key === "hws.board.tabs").value, ["tbb"]);
  assert.ok(H.watches.includes("/state/workspaces"));
});

test("the sidebar shares every open workspace's spaces, sorted, and only when they change", async () => {
  const archived = { ...APP, id: "spa", spaces: ["spz"], archived: { at: 1, spaces: ["spz"] } };
  const list = [{ ...APP, spaces: ["spc3", "spc1"], board: { space: "spb", tab: "tbb" } }, { ...THROWAWAY, id: "spc2", spaces: ["spc2"] }];
  const H = setup({ hws: { list, "list --archived": [archived] }, sharedSets: [], sharedValues: {} });
  await mount("hws-panel", { view: "sidebar" });
  const sets = () => H.sharedSets.filter((x) => x.key === "hws.workspace.spaces");
  assert.deepEqual(sets().at(-1).value, ["spb", "spc1", "spc2", "spc3"]);
  H.sharedValues["hws.workspace.spaces"] = ["spb", "spc1", "spc2", "spc3"];
  const before = sets().length;
  await mount("hws-panel", { view: "sidebar" });
  assert.equal(sets().length, before);
});

test("the empty sidebar section offers New workspace and the launcher", async () => {
  const H = setup({ hws: { list: [] } });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /Workspaces.*New workspace/);
  await m.click("sidebar-new-workspace");
  assert.equal(H.overlays[0].props.step, "workspace");
  await m.click("sidebar-launcher");
  assert.deepEqual(H.runs.at(-1), { name: "mod.open", args: { name: "hws-new" } });
});

test("the sidebar shows Unfiled above the workspaces only while something is unfiled", async () => {
  const H = setup({ hws: { list: [APP], unfiled: { surfaces: [], artifacts: [] } }, spaces: [{ id: "spc1", active: true, tabs: [] }] });
  const empty = await mount("hws-panel", { view: "sidebar" });
  assert.equal(empty.has("sidebar-unfiled"), false);

  H.hws.unfiled = { surfaces: [{ id: "s1", type: "board", title: "idea", state: "draft" }], artifacts: [{ id: "a1", type: "note", title: "memo", path: "/a1" }] };
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /Unfiled.*2.*checkout demo/);
  await m.click("sidebar-unfiled");
  assert.deepEqual([H.overlays.at(-1).kind, H.overlays.at(-1).props], ["dialog", { view: "unfiled" }]);
});

test("a workspace row counts its open windows and brings them forward", async () => {
  const windows = [
    { id: "s1", workspace: "spc1", open: true },
    { id: "s2", workspace: "spc1", open: false },
    { id: "s3", workspace: "standalone", open: true },
    { id: "s4", workspace: "spc1", open: true },
  ];
  const H = setup({ hws: { list: [APP], "surface list": windows }, spaces: [{ id: "spc1", active: true, tabs: [] }] });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /checkout demo.*2/);
  await m.click("sidebar-windows-spc1");
  const resumed = args(H).filter((a) => a[0] === "surface" && a[1] === "resume").map((a) => a[a.indexOf("--id") + 1]);
  assert.deepEqual(resumed, ["s1", "s4"]);
  assert.equal(H.runs.some((r) => r.name === "space.select"), false);
});

test("the Unfiled dialog opens, trashes and moves each kind of item", async () => {
  const unfiled = {
    surfaces: [
      { id: "s1", type: "board", title: "idea", state: "open" },
      { id: "s2", type: "note", title: "memo", state: "draft" },
      { id: "s3", type: "page", title: "spec.html", state: "pane" },
    ],
    artifacts: [{ id: "a1", type: "board", title: "flow", path: "/a1", createdAt: 1 }],
  };
  const H = setup({ hws: { unfiled } });
  const d = await mount("hws-panel", { view: "unfiled", overlay: "ov3" });
  assert.match(d.text(), /idea.*sketch · open.*memo.*note · draft.*spec\.html.*page · in a pane.*flow.*saved/);

  await d.click("unfiled-open-s1");
  assert.deepEqual(args(H).at(-2), ["surface", "resume", "--id", "s1", "--json"]);
  await d.click("unfiled-open-s3");
  assert.deepEqual(args(H).at(-2), ["surface", "pop", "--id", "s3", "--to", "pane", "--json"]);

  assert.equal(d.clickable("unfiled-trash-s1"), false);
  assert.equal(d.clickable("unfiled-trash-s3"), false);
  assert.equal(d.clickable("unfiled-move-s3"), false);
  await d.click("unfiled-trash-s2");
  assert.deepEqual(args(H).at(-2), ["surface", "discard", "--id", "s2", "--json"]);
  await d.click("unfiled-trash-a1");
  assert.deepEqual(args(H).at(-2), ["artifact", "trash", "a1", "--json"]);
  assert.deepEqual(args(H).at(-1), ["unfiled", "--json"]);

  await d.click("unfiled-move-a1");
  assert.deepEqual(H.closed, ["ov3"]);
  assert.deepEqual(H.overlays.at(-1).props, { view: "move-item", kind: "artifact", id: "a1", title: "flow", from: "standalone" });
});

test("the Unfiled dialog says when nothing is left", async () => {
  setup({ hws: { unfiled: { surfaces: [], artifacts: [] } } });
  const d = await mount("hws-panel", { view: "unfiled", overlay: "ov3" });
  assert.match(d.text(), /Nothing is unfiled/);
});

test("the move dialog suggests the workspace in view, moves there and closes", async () => {
  const workspaces = [{ id: "w1", name: "docs", kind: "app" }, { id: "w2", name: "api", kind: "general" }];
  const H = setup({ hws: { "surface targets": { current: "standalone", suggested: "w2", workspaces } } });
  const d = await mount("hws-panel", { view: "move-item", kind: "surface", id: "s1", title: "idea", from: "standalone", overlay: "ov5" });
  assert.deepEqual(args(H).at(-1), ["surface", "targets", "--id", "s1", "--json"]);
  assert.match(d.text(), /Suggested.*api.*Other workspaces.*docs/);
  assert.equal(d.has("move-to-standalone"), false);
  await d.click("move-to-w2");
  assert.deepEqual(args(H).at(-1), ["surface", "move", "--id", "s1", "--workspace", "w2", "--json"]);
  assert.deepEqual(H.closed, ["ov5"]);
});

test("the move dialog moves an artifact, offers Unfiled for filed work and keeps a failure", async () => {
  const H = setup({ hws: { "surface targets": { current: null, suggested: null, workspaces: [{ id: "w1", name: "docs", kind: "app" }] }, "artifact move a1": { fail: "docs has no artifacts place" } } });
  const d = await mount("hws-panel", { view: "move-item", kind: "artifact", id: "a1", title: "flow", from: "w0", overlay: "ov5" });
  assert.deepEqual(args(H).at(-1), ["surface", "targets", "--json"]);
  assert.ok(d.has("move-to-standalone"));
  await d.click("move-to-w1");
  assert.deepEqual(args(H).at(-1), ["artifact", "move", "a1", "--workspace", "w1", "--json"]);
  assert.match(d.text(), /docs has no artifacts place/);
  assert.deepEqual(H.closed, []);
});

test("sidebar rows switch spaces, and only the current workspace toggles the panel", async () => {
  const other = { ...THROWAWAY, id: "spc2", spaces: ["spc2"] };
  const H = setup({ hws: { list: [APP, other] }, spaces: [{ id: "spc1", active: true, tabs: [] }, { id: "spc2", active: false, tabs: [] }] });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /checkout demo.*scratch.*Throwaway/);
  await m.click("sidebar-workspace-spc2");
  assert.deepEqual(H.runs.at(-1), { name: "space.select", args: { id: "spc2" } });
  await m.click("sidebar-panel");
  assert.deepEqual(H.runs.at(-1), { name: "mod.open", args: { name: "hws-panel" } });
  assert.equal(H.runs.filter((r) => r.name === "mod.open").length, 1);
});

test("right-clicking a sidebar row opens its menu beside the pointer", async () => {
  const H = setup({ hws: { list: [APP] }, spaces: [{ id: "spc1", active: true, tabs: [] }], layout: structuredClone(SIDEBAR_LAYOUT) });
  const m = await mount("hws-panel", { view: "sidebar" });
  await m.rightClick("sidebar-workspace-spc1");
  const spec = H.overlays.at(-1);
  assert.deepEqual([spec.kind, spec.props], ["popup", { workspace: "spc1", name: "checkout demo", kind: "app", archived: false, space: "spc1", spaces: ["spc1"], board: false, view: "row-menu" }]);
});

const ROW_MENU = { workspace: "spc1", name: "checkout demo", kind: "app", archived: false, space: "spc1", spaces: ["spc1", "spc3"], view: "row-menu", overlay: "ov4" };

test("an open workspace's menu offers Add space and, without a Board, Add tasks", async () => {
  setup({ spaces: SPACED });
  const m = await mount("hws-panel", { ...ROW_MENU, board: false });
  assert.match(m.text(), /Open panel \| Add space… \| Add tasks \| Rename… \| Archive…/);

  setup({ spaces: SPACED });
  const withBoard = await mount("hws-panel", { ...ROW_MENU, board: true });
  assert.match(withBoard.text(), /Open panel \| Add space… \| Rename… \| Archive…/);

  setup({ spaces: SPACED });
  const fromPanel = await mount("hws-panel", { workspace: "spc1", name: "checkout demo", kind: "app", archived: false, space: null, view: "row-menu", overlay: "ov4" });
  assert.doesNotMatch(fromPanel.text(), /Add/);
});

test("the menu's Add space opens the dialog for that workspace", async () => {
  const H = setup({ spaces: SPACED });
  const m = await mount("hws-panel", { ...ROW_MENU, board: false });
  await m.click("row-menu-add-space");
  assert.deepEqual(H.closed, ["ov4"]);
  assert.deepEqual(H.overlays.at(-1).props, { view: "add-space", workspace: "spc1", name: "checkout demo", spaces: ["spc1", "spc3"] });
});

test("the menu's Add tasks adds a Board and shows Tasks", async () => {
  const H = setup({ hws: { "board add": { workspace: "spc1", space: "spb", tab: "tbb" } }, spaces: SPACED });
  const m = await mount("hws-panel", { ...ROW_MENU, board: false });
  await m.click("row-menu-add-tasks");
  assert.deepEqual(args(H), [["board", "add", "--workspace", "spc1", "--json"]]);
  assert.deepEqual(H.runs.slice(-2), [{ name: "space.select", args: { id: "spb" } }, { name: "tab.select", args: { id: "tbb" } }]);
});

test("the menu of a workspace that is not current offers the same adds", async () => {
  const other = { ...APP, id: "spc2", name: "other", spaces: ["spc2"] };
  const H = setup({ hws: { list: [GROUP, other] }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  await m.rightClick("sidebar-workspace-spc2");
  assert.deepEqual(H.overlays.at(-1).props, { workspace: "spc2", name: "other", kind: "app", archived: false, space: "spc2", spaces: ["spc2"], board: false, view: "row-menu" });
});

test("the sidebar folds archived workspaces under one row and restores on click", async () => {
  const archived = { ...APP, id: "spa", name: "old work", spaces: [], archived: { at: 1, spaces: [] } };
  const H = setup({ hws: { list: [APP], "list --archived": [archived] }, spaces: [{ id: "spc1", active: true, tabs: [] }], layout: structuredClone(SIDEBAR_LAYOUT) });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 121 } });
  assert.equal(m.has("sidebar-archived-spa"), false);
  H.layout.children[0].children[0].size.px = 121;
  await m.click("sidebar-archived-toggle");
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 147 } });
  await m.click("sidebar-archived-spa");
  assert.deepEqual([H.overlays.at(-1).props.view, H.overlays.at(-1).props.action, H.overlays.at(-1).props.workspace], ["confirm", "restore", "spa"]);
  await m.rightClick("sidebar-archived-spa");
  assert.equal(H.overlays.at(-1).props.archived, true);
});

test("the sidebar section sizes its block to its rows and hides them when narrow", async () => {
  const H = setup({ hws: { list: [APP, THROWAWAY] }, spaces: [{ id: "spc1", active: true, tabs: [] }], layout: structuredClone(SIDEBAR_LAYOUT) });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 151 } });
  H.layout.children[0].children[0].size.px = 151;
  H.runs.length = 0;
  await m.fireTimer(1000);
  assert.deepEqual(H.runs, []);
  H.layout.children[0].size.px = 76;
  await m.fireTimer(1000);
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 31 } });
  assert.equal(m.has("sidebar-workspace-spc1"), false);
});

test("a drag on the divider caps the list, and a drag past every row clears the cap", async () => {
  localStorage.removeItem("sidebar.workspaces.cap");
  const H = setup({ hws: { list: [APP, THROWAWAY] }, spaces: [{ id: "spc1", active: true, tabs: [] }], layout: structuredClone(SIDEBAR_LAYOUT) });
  const m = await mount("hws-panel", { view: "sidebar" });
  const block = H.layout.children[0].children[0];
  const resizes = () => H.runs.filter((r) => r.name === "layout.resize");
  assert.deepEqual(resizes().at(-1).args, { id: "workspaces", px: 151 });

  await m.fireTimer(1000);
  assert.deepEqual(resizes().at(-1).args.px, 151, "a resize still pending is not a drag");
  block.size.px = 151;
  await m.fireTimer(1000);

  H.runs.length = 0;
  block.size.px = 69;
  await m.fireTimer(1000);
  await m.fireTimer(1000);
  assert.deepEqual(resizes(), [], "the dragged height holds");
  assert.equal(localStorage.getItem("sidebar.workspaces.cap"), "30");

  block.size.px = 160;
  await m.fireTimer(1000);
  assert.deepEqual(resizes().at(-1).args, { id: "workspaces", px: 151 }, "past every row it fits the rows again");
  assert.equal(localStorage.getItem("sidebar.workspaces.cap"), null);
});

const SPACED = [
  { id: "spc1", name: "api", active: true, status: "idle", tabs: [{ id: "tb1", name: "Plan", active: true }] },
  { id: "spc3", name: "web", active: false, status: "blocked", tabs: [{ id: "tb3", name: "Web", active: true }] },
  { id: "spc2", name: "other", active: false, status: null, tabs: [{ id: "tb9", name: "Other", active: true }] },
];
const GROUP = { ...APP, spaces: ["spc1", "spc3"] };

test("sidebar lists a workspace's spaces and shows its most urgent status", async () => {
  const H = setup({ hws: { list: [GROUP] }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /checkout demo.*api.*web/);
  assert.doesNotMatch(m.text(), /Add space|Add tasks/);
  assert.equal(m.has("sidebar-space-spc2"), false);
  await m.click("sidebar-space-spc3");
  assert.deepEqual(H.runs.at(-1), { name: "space.select", args: { id: "spc3" } });
});

// Sidebar test helpers

function findNode(el, id) {
  const node = el?.node ?? el;
  if (typeof node !== "object" || node === null) return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

async function hover(m, id, isHovered) {
  findNode(m.render(), id).handlers.on_hover(isHovered, m.cx);
  await settle();
}

const BOARDED = { ...GROUP, spaces: ["spc1", "spb"], board: { space: "spb", tab: "tbb" } };
const WITH_BOARD = [...SPACED, { id: "spb", name: "Board", active: false, status: null, tabs: [{ id: "tbb", name: "Tasks", active: true }] }];

test("a workspace with one space lists it as a child row, which takes the selection", async () => {
  setup({ hws: { list: [APP] }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /C \| checkout demo \| api/);
  assert.equal(m.has("sidebar-fold-spc1"), true);
  assert.equal(findNode(m.render(), "sidebar-space-spc1").bg, "color:selected");
  assert.equal(findNode(m.render(), "sidebar-workspace-spc1").bg, undefined);
});

test("a workspace with one space and a Board lists Tasks, then the space", async () => {
  setup({ hws: { list: [BOARDED] }, spaces: WITH_BOARD });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /C \| checkout demo \| Tasks \| api/);
  assert.equal(m.has("sidebar-space-spc1"), true);
  assert.equal(m.has("sidebar-space-spb"), true);
  assert.equal(m.has("sidebar-fold-spc1"), true);
  assert.equal(findNode(m.render(), "sidebar-space-spc1").bg, "color:selected");
});

test("the active space row holds the selection and its workspace row stays quiet", async () => {
  setup({ hws: { list: [GROUP] }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  const tree = m.render();
  assert.equal(findNode(tree, "sidebar-space-spc1").bg, "color:selected");
  assert.equal(findNode(tree, "sidebar-space-spc3").bg, undefined);
  assert.equal(findNode(tree, "sidebar-workspace-spc1").bg, undefined);
  assert.equal(findNode(tree, "sidebar-workspace-spc1").children[2].node.text_color, "color:foreground");
});

test("every workspace row draws a letter tile in a stable color and reserves the chevron slot", async () => {
  const other = { ...APP, id: "spc2", name: "billing", spaces: ["spc2"] };
  setup({ hws: { list: [GROUP, other] }, spaces: SPACED, sharedValues: { "space.colors": { spc1: "ansi4" } } });
  const m = await mount("hws-panel", { view: "sidebar" });
  const tree = m.render();
  const tile = findNode(tree, "sidebar-tile-spc1");
  assert.equal(tile.bg, "#5b8def");
  assert.equal(tile.opacity, undefined);
  assert.deepEqual(tile.children, ["C"]);
  const quiet = findNode(tree, "sidebar-tile-spc2");
  assert.deepEqual(quiet.children, ["B"]);
  assert.equal(quiet.opacity, 0.7);
  assert.equal(findNode(tree, "sidebar-workspace-spc2").children[2].node.text_color, "color:muted");

  setup({ hws: { list: [other] }, spaces: SPACED, sharedValues: {} });
  const again = await mount("hws-panel", { view: "sidebar" });
  assert.equal(findNode(again.render(), "sidebar-tile-spc2").bg, quiet.bg);

  const row = findNode(tree, "sidebar-workspace-spc2");
  assert.equal(m.has("sidebar-fold-spc2"), true);
  assert.equal(row.children[1].node.id, "sidebar-tile-spc2");

  // A workspace with no live space has no chevron, but its tile stays in the same slot.
  const gone = { ...APP, id: "spc7", name: "gone", spaces: ["spc7"] };
  setup({ hws: { list: [gone] }, spaces: SPACED, sharedValues: {} });
  const empty = await mount("hws-panel", { view: "sidebar" });
  assert.equal(empty.has("sidebar-fold-spc7"), false);
  assert.equal(findNode(empty.render(), "sidebar-workspace-spc7").children[1].node.id, "sidebar-tile-spc7");
});

test("the Board is listed once and first as Tasks, opens its tab and has no minus", async () => {
  const withBoard = { ...GROUP, spaces: ["spc1", "spc3", "spb"], board: { space: "spb", tab: "tbb" } };
  const H = setup({ hws: { list: [withBoard] }, spaces: WITH_BOARD });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /checkout demo \| Tasks \| api \| web/);
  assert.doesNotMatch(m.text(), /Board/);
  await hover(m, "sidebar-space-spb", true);
  assert.equal(m.has("sidebar-remove-spb"), false);
  await m.click("sidebar-space-spb");
  assert.deepEqual(H.runs.slice(-2), [{ name: "space.select", args: { id: "spb" } }, { name: "tab.select", args: { id: "tbb" } }]);
});

test("the minus shows only on a hovered row with two or more working spaces", async () => {
  setup({ hws: { list: [GROUP] }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.equal(m.has("sidebar-remove-spc3"), false);
  await hover(m, "sidebar-space-spc3", true);
  assert.equal(m.has("sidebar-remove-spc3"), true);
  assert.equal(m.has("sidebar-remove-spc1"), false);
  await hover(m, "sidebar-space-spc3", false);
  assert.equal(m.has("sidebar-remove-spc3"), false);

  setup({ hws: { list: [BOARDED] }, spaces: WITH_BOARD });
  const lone = await mount("hws-panel", { view: "sidebar" });
  await hover(lone, "sidebar-space-spb", true);
  assert.equal(lone.has("sidebar-remove-spb"), false);
  assert.equal(lone.has("sidebar-remove-spc1"), false);
});

test("the sidebar counts Waiting on you per Board and shares the map by space", async () => {
  const items = [{ id: "a", column: "waiting", archived: false }, { id: "b", column: "waiting", archived: true }, { id: "c", column: "todo", archived: false }, { id: "d", column: "waiting" }];
  const quiet = { ...APP, id: "spc2", name: "billing", spaces: ["spc2", "spq"], board: { space: "spq", tab: "tbq" } };
  const H = setup({
    hws: { list: [BOARDED, quiet, { ...APP, id: "spc9", spaces: ["spc9"] }], "todo list": (a) => (a.includes("spb") ? { items } : { items: [] }) },
    spaces: WITH_BOARD,
    sharedSets: [],
    sharedValues: { "hws.tasks.waiting": 3 },
  });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.deepEqual(args(H).filter((a) => a[0] === "todo"), [["todo", "list", "--space", "spb", "--json"], ["todo", "list", "--space", "spq", "--json"]]);
  const sets = () => H.sharedSets.filter((x) => x.key === "hws.tasks.waiting");
  assert.deepEqual(sets().at(-1).value, { spc1: 2, spb: 2, spc2: 0, spq: 0 });
  assert.match(m.text(), /Tasks \| 2/);
  assert.equal(m.has("sidebar-waiting-spc1"), true);
  assert.equal(m.has("sidebar-waiting-spc2"), false);

  H.sharedValues["hws.tasks.waiting"] = { spb: 2, spc1: 2, spq: 0, spc2: 0 };
  const before = sets().length;
  await m.fireTimer(60000);
  assert.equal(sets().length, before);
});

test("a failed task list counts as zero and leaves the list in place", async () => {
  const H = setup({ hws: { list: [BOARDED], "todo list": { fail: "board is locked" } }, spaces: WITH_BOARD, sharedSets: [], sharedValues: {} });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /checkout demo \| Tasks/);
  assert.doesNotMatch(m.text(), /board is locked/);
  assert.deepEqual(H.sharedSets.find((x) => x.key === "hws.tasks.waiting").value, { spc1: 0, spb: 0 });
});

const TALL_LAYOUT = {
  id: "root", type: "row", children: [{
    id: "sidebar", type: "column", size: { px: 268 }, children: [
      { id: "brand", type: "block", size: { px: 46 } },
      { id: "sidebar-lists", type: "column", children: [{ id: "workspaces", type: "block", size: { px: 69 }, min: 31 }, { id: "spaces", type: "block", size: { weight: 1 }, min: 90 }, { id: "agents", type: "block", size: { weight: 1 }, min: 90 }] },
      { id: "sidebar-footer", type: "block", size: { px: 97 } },
    ],
  }],
};
const MANY = Array.from({ length: 30 }, (_, i) => ({ ...APP, id: `w${i}`, name: `work ${i}`, spaces: [`w${i}`] }));

test("the list grows to the room the window leaves the other sidebar blocks", async () => {
  const H = setup({ hws: { list: MANY }, spaces: SPACED, layout: structuredClone(TALL_LAYOUT), window: { titlebar: "none" }, files: { "/Users/me/.config/herdr-app/window.json": JSON.stringify({ bounds: [31, 40, 1994, 1211] }) } });
  await mount("hws-panel", { view: "sidebar" });
  // 1211 less 46, 97 and two 90px minimums leaves 888 for the block.
  assert.deepEqual(H.runs.filter((r) => r.name === "layout.resize").at(-1), { name: "layout.resize", args: { id: "workspaces", px: 888 } });

  const small = setup({ hws: { list: MANY }, spaces: SPACED, layout: structuredClone(TALL_LAYOUT) });
  await mount("hws-panel", { view: "sidebar" });
  assert.deepEqual(small.runs.filter((r) => r.name === "layout.resize").at(-1), { name: "layout.resize", args: { id: "workspaces", px: 31 + 480 + 8 } });
});

test("the scrollbar paints only while the rows overflow", async () => {
  const { overflows } = await import("../hws-panel/sidebar.js");
  setup({ hws: { list: MANY }, spaces: SPACED, layout: structuredClone(TALL_LAYOUT) });
  const tall = await mount("hws-panel", { view: "sidebar" });
  assert.equal(overflows(tall.view.sidebar), true);

  setup({ hws: { list: [APP] }, spaces: SPACED, layout: structuredClone(TALL_LAYOUT) });
  const short = await mount("hws-panel", { view: "sidebar" });
  assert.equal(overflows(short.view.sidebar), false);
  findNode(short.render(), "sidebar-root").handlers.on_size_change({ width: 268, height: 50 }, short.cx);
  assert.equal(overflows(short.view.sidebar), true);
});

test("clicking a workspace keeps the member already showing", async () => {
  const H = setup({ hws: { list: [GROUP] }, spaces: SPACED.map((s) => ({ ...s, active: s.id === "spc3" })) });
  const m = await mount("hws-panel", { view: "sidebar" });
  await m.click("sidebar-workspace-spc1");
  assert.deepEqual(H.runs.at(-1), { name: "space.select", args: { id: "spc3" } });
});

test("the sidebar chevron folds spaces, resizes the block and remembers the choice", async () => {
  const H = setup({ hws: { list: [GROUP] }, spaces: SPACED, layout: structuredClone(SIDEBAR_LAYOUT) });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 121 } });
  H.layout.children[0].children[0].size.px = 121;
  await m.click("sidebar-fold-spc1");
  assert.equal(m.has("sidebar-space-spc1"), false);
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 69 } });
  assert.equal(H.runs.some((r) => r.name === "space.select"), false);
  const again = await mount("hws-panel", { view: "sidebar" });
  assert.equal(again.has("sidebar-space-spc1"), false);
});

test("a kept workspace row carries a freshness dot and a throwaway's does not", async () => {
  const other = { ...THROWAWAY, id: "spc2", spaces: ["spc2"] };
  const fresh = { ...STATUS, behind: { sessions: 9, artifacts: 0, commits: 0, cards: 0 }, line: "Current is 9 sessions behind, last tidied Nov 3" };
  const H = setup({ hws: { list: [APP, other], "tidy status": fresh }, spaces: [{ id: "spc1", active: true, tabs: [] }, { id: "spc2", active: false, tabs: [] }] });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.deepEqual(args(H).filter((a) => a[0] === "tidy"), [["tidy", "status", "--workspace", "spc1", "--json"]]);
  assert.equal(m.has("sidebar-fresh-spc1"), true);
  assert.equal(m.has("sidebar-fresh-spc2"), false);
  assert.deepEqual(m.view.sidebar.fresh.spc1, { level: "stale", title: "Current is 9 sessions behind, last tidied Nov 3" });
});

test("a kept workspace with no note yet shows the quiet ring with the status line", async () => {
  setup({ hws: { list: [APP], "tidy status": { ...STATUS, tidiedAt: null, line: "No current note yet" } }, spaces: [{ id: "spc1", active: true, tabs: [] }] });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.equal(m.has("sidebar-fresh-spc1"), true);
  assert.deepEqual(m.view.sidebar.fresh.spc1, { level: "unwritten", title: "No current note yet" });
});

test("the sidebar shows no dot when tidy status fails", async () => {
  setup({ hws: { list: [APP], "tidy status": { fail: "unknown command" } }, spaces: [{ id: "spc1", active: true, tabs: [] }] });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.equal(m.has("sidebar-fresh-spc1"), false);
  assert.match(m.text(), /checkout demo/);
});

// Space menu

const menuIds = (m) => ["rename", "worktree-new", "worktree-open", "worktree-remove", "move", "leave", "close"].filter((id) => m.has(`row-menu-${id}`));
const gitAnswers = (top, common) => (_command, argv) => ({ code: top ? 0 : 128, stdout: argv.includes("--show-toplevel") ? top : common, stderr: "" });

test("right-clicking a workspace's space opens the space menu, and the Tasks row has none", async () => {
  const withBoard = { ...GROUP, spaces: ["spc1", "spc3", "spc2"], board: { space: "spc2", tab: "tb9" } };
  const H = setup({ hws: { list: [withBoard] }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  await m.rightClick("sidebar-space-spc3");
  const spec = H.overlays.at(-1);
  assert.deepEqual([spec.mod, spec.kind], ["hws-panel", "popup"]);
  assert.deepEqual(spec.props, { space: "spc3", workspace: "spc1", workspaceName: "checkout demo", canLeave: true, view: "space-menu" });
  assert.equal(m.clickable("sidebar-space-spc2"), true);
  await assert.rejects(m.rightClick("sidebar-space-spc2"));
});

test("a plain space's menu renames, moves and closes it", async () => {
  const H = setup({ spaces: SPACED, panes: [], other: gitAnswers("", "") });
  const m = await mount("hws-panel", { view: "space-menu", space: "spc2", overlay: "ov1" });
  assert.deepEqual(menuIds(m), ["rename", "move", "close"]);
  await m.click("row-menu-rename");
  await m.click("row-menu-close");
  assert.deepEqual(H.runs, [{ name: "space.rename", args: { id: "spc2" } }, { name: "space.close", args: { id: "spc2" } }]);
  await m.click("row-menu-move");
  assert.deepEqual(H.closed, ["ov1", "ov1", "ov1"]);
  const spec = H.overlays.at(-1);
  assert.deepEqual([spec.kind, spec.modal, spec.props], ["dialog", true, { view: "move-space", id: "spc2", name: "other", folder: "" }]);
});

test("a space in a repo offers worktrees, and a linked one offers Remove worktree", async () => {
  const world = { spaces: SPACED.map((s) => ({ ...s, folder: "/w/app" })), panes: [] };
  const H = setup({ ...world, other: gitAnswers("/w/app", "/w/app/.git") });
  const main = await mount("hws-panel", { view: "space-menu", space: "spc2", overlay: "ov1" });
  assert.deepEqual(menuIds(main), ["rename", "worktree-new", "worktree-open", "move", "close"]);
  await main.click("row-menu-worktree-open");
  assert.deepEqual(H.overlays.at(-1), { mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: "spc2", action: "open" } });

  setup({ ...world, other: gitAnswers("/w/app-fix", "/w/app/.git") });
  const linked = await mount("hws-panel", { view: "space-menu", space: "spc2", overlay: "ov1" });
  assert.deepEqual(menuIds(linked), ["rename", "worktree-new", "worktree-open", "worktree-remove", "move", "close"]);
});

test("a member space's menu takes it out, and a workspace's only space cannot move", async () => {
  const member = { view: "space-menu", space: "spc3", workspace: "spc1", workspaceName: "checkout demo", overlay: "ov1" };
  const H = setup({ spaces: SPACED, panes: [], notices: [] });
  const m = await mount("hws-panel", { ...member, canLeave: true });
  assert.deepEqual(menuIds(m), ["rename", "move", "leave", "close"]);
  assert.match(m.text(), /Take out of checkout demo/);
  await m.click("row-menu-leave");
  assert.deepEqual(args(H), [["space", "remove", "--space", "spc3", "--json"]]);
  assert.deepEqual(H.notices, []);

  const failing = setup({ spaces: SPACED, panes: [], notices: [], hws: { "space remove": { fail: "herdr is not answering" } } });
  const again = await mount("hws-panel", { ...member, canLeave: true });
  await again.click("row-menu-leave");
  assert.deepEqual(failing.notices.map((n) => [n.body, n.level]), [["herdr is not answering", "error"]]);

  setup({ spaces: SPACED, panes: [] });
  const only = await mount("hws-panel", { ...member, canLeave: false });
  assert.deepEqual(menuIds(only), ["rename", "close"]);
});

const DOCS = { ...APP, id: "spd", name: "docs", spaces: ["spd"] };
const SCRAP = { ...THROWAWAY, id: "spt", name: "scrap", spaces: ["spt"] };
const MOVE = { view: "move-space", id: "spc2", name: "other", folder: "/w/docs/site", overlay: "ov1" };

test("the move dialog lists every open workspace, folder matches first, and moves on a click", async () => {
  const H = setup({ hws: { list: [APP, SCRAP, DOCS], "space match": { space: "spc2", folder: "/w/docs/site", candidates: [{ id: "spd", name: "docs", folder: "/w/docs", home: null }] } } });
  const m = await mount("hws-panel", MOVE);
  assert.match(m.text(), /^Move other to a workspace \| docs \| Holds this folder \| checkout demo \| scrap \| Throwaway \| New workspace from this space… \| Cancel$/);
  await m.click("move-to-spc1");
  assert.deepEqual(args(H).at(-1), ["space", "move", "--space", "spc2", "--workspace", "spc1", "--json"]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("the move dialog leaves out the space's own workspace and says what it leaves", async () => {
  setup({ hws: { list: [GROUP, DOCS] } });
  const m = await mount("hws-panel", { ...MOVE, id: "spc3", name: "web" });
  assert.match(m.text(), /^Move web to a workspace \| It leaves checkout demo, which keeps its tasks\. \| docs \| New workspace/);
  assert.equal(m.has("move-to-spc1"), false);
});

test("the move dialog hands the space to the new-workspace form", async () => {
  const H = setup({ hws: { list: [] } });
  const m = await mount("hws-panel", MOVE);
  await m.click("move-to-new");
  assert.deepEqual(H.closed, ["ov1"]);
  assert.deepEqual([H.overlays.at(-1).mod, H.overlays.at(-1).props], ["hws-new", { step: "workspace", space: { id: "spc2", name: "other", folder: "/w/docs/site" } }]);
});

test("the move dialog stays open on a failed move, and Escape closes it", async () => {
  const H = setup({ hws: { list: [APP], "space move": { fail: "other is on vps, and a workspace holds only spaces on this computer" } } });
  const m = await mount("hws-panel", MOVE);
  await m.click("move-to-spc1");
  assert.match(m.text(), /holds only spaces on this computer/);
  assert.deepEqual(H.closed, []);
  await m.key("escape");
  assert.deepEqual(H.closed, ["ov1"]);
});

test("the minus takes a space out of the workspace", async () => {
  const H = setup({ hws: { list: [GROUP] }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  await hover(m, "sidebar-space-spc3", true);
  await m.click("sidebar-remove-spc3");
  assert.deepEqual(args(H).find((a) => a[0] === "space"), ["space", "remove", "--space", "spc3", "--json"]);
  assert.equal(H.runs.some((r) => r.name === "space.select"), false);
});

test("Add space creates a named space and offers open spaces from outside", async () => {
  const H = setup({ spaces: SPACED });
  const m = await mount("hws-panel", { view: "add-space", workspace: "spc1", name: "checkout demo", spaces: ["spc1", "spc3"], overlay: "ov1" });
  assert.equal(m.has("move-spc1"), false);
  m.view.inputs.name.type("docs", m.cx);
  await m.click("add-space-yes");
  assert.deepEqual(args(H), [["space", "add", "--workspace", "spc1", "--name", "docs", "--json"]]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("Add space moves an open space into the workspace", async () => {
  const H = setup({ spaces: SPACED });
  const m = await mount("hws-panel", { view: "add-space", workspace: "spc1", name: "checkout demo", spaces: ["spc1", "spc3"], overlay: "ov1" });
  await m.click("move-spc2");
  assert.deepEqual(args(H), [["space", "move", "--space", "spc2", "--workspace", "spc1", "--json"]]);
});

test("the panel finds a workspace from any of its spaces", async () => {
  setup({ focused: { space: "spc3", tab: "tb3", pane: "p1", terminal: "t13", shown: null, agent: null, cwd: "/w" }, hws: { list: [GROUP] }, spaces: SPACED });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /checkout demo/);
});

test("the sidebar shows commits ahead and nothing when git has no answer", async () => {
  setup({
    hws: { list: [APP] },
    spaces: SPACED,
    other: (command) => (command === "git" ? { code: 0, stdout: "12\n", stderr: "" } : { code: 0, stdout: "", stderr: "" }),
  });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /checkout demo.*\u219112/);

  setup({ hws: { list: [APP] }, spaces: SPACED, other: () => ({ code: 128, stdout: "", stderr: "no upstream" }) });
  const quiet = await mount("hws-panel", { view: "sidebar" });
  assert.doesNotMatch(quiet.text(), /\u2191/);
});

test("the sidebar section reloads when the spaces change and shows a failure", async () => {
  const H = setup({ hws: { list: [] } });
  const m = await mount("hws-panel", { view: "sidebar" });
  const before = hwsCalls(H).length;
  await m.fireTimer(1000);
  assert.equal(hwsCalls(H).length, before);
  H.hws.list = { fail: "hws broke" };
  H.spaces = [...H.spaces, { id: "spc2", tabs: [] }];
  await m.fireTimer(1000);
  assert.match(m.text(), /hws broke/);
});

// Chat folding

async function foldOf(collapsed) {
  const { default: Chat } = await import("../hws-chat/main.js");
  const self = { findQuery: () => "", width: 1400, collapsed: new Set(collapsed) };
  return Chat.prototype.foldOf.call(self, { id: "m1", text: "long" }, [{ type: "md", text: "line\n".repeat(80) }]);
}

test("a long reply starts open and folds once collapsed", async () => {
  assert.equal((await foldOf([])).open, true);
  assert.equal((await foldOf(["m1"])).open, false);
});

// Chat divider drag

test("a divider drag waits for the width to hold still", async (t) => {
  const { default: Chat } = await import("../hws-chat/main.js");
  let now = 1000, notified = 0;
  t.mock.method(Date, "now", () => now);
  const timers = [];
  const cx = { notify: () => { notified++; }, timer: { after: (_ms, fn) => timers.push(fn) } };
  const self = {};

  Chat.prototype.settleWidth.call(self, cx);
  now += 100;
  Chat.prototype.settleWidth.call(self, cx);
  assert.equal(timers.length, 1);

  now += 100;
  timers.shift()(cx);
  assert.equal(self.settling, true);
  assert.equal(notified, 0);

  now += 150;
  timers.shift()(cx);
  assert.equal(self.settling, false);
  assert.equal(notified, 1);
});

test("the measurer stays empty and at the measured width during a drag", async () => {
  const { default: Chat } = await import("../hws-chat/main.js");
  const self = { settling: true, width: 500, heightsFor: 700, heights: new Map([["k", 40]]), measuredAt: new Map([["k", Date.now()]]), range: { start: 0, end: 1 } };
  const el = Chat.prototype.measurer.call(self, [{ id: "r" }], ["k"], {});
  assert.equal(el.node.w, 700);
  assert.equal(el.node.children[0].node.children.length, 0);
});

// Chat: an agent that quits or clears

async function chatAt(fg, extra = {}) {
  const { default: Chat } = await import("../hws-chat/main.js");
  const H = setup({ runs: [], hcCalls: [], terminals: [{ address: "t13", state: "live", labels: { "herdr.chat": "p7" } }],
    panes: [{ pane: "p7", terminal: null, tab: "tb1", mod: "hws-chat" }] });
  H.hc = (a) => (a[0] === "get" ? { code: 0, stdout: JSON.stringify({ state: "live", labels: { "herdr.chat": "p7" }, ...fg }), stderr: "" } : null);
  const self = Object.assign(Object.create(Chat.prototype), { addr: "t13", machine: null, phase: "ready", kind: "claude", path: "/logs/old.jsonl",
    lostTried: new Set(["t13"]), thread: null, inner: null, role: null }, extra);
  return { H, self, cx: { notify() {}, spawn() {} } };
}

test("/exit and /quit are the commands that end the agent", async () => {
  const { quits } = await import("../hws-chat/core/slash.js");
  assert.equal(quits("/exit"), true);
  assert.equal(quits(" /quit "), true);
  assert.equal(quits("/exit now"), false);
  assert.equal(quits("/clear"), false);
});

test("an agent quit from the chat ends its terminal and closes the chat", async () => {
  const { H, self, cx } = await chatAt({ foreground: { name: "zsh", pid: 9 } }, { exiting: Date.now() });
  await self.locate(cx);
  assert.deepEqual(H.runs, [{ name: "terminal.kill", args: { terminal: "t13" } }, { name: "pane.close", args: { pane: "p7" } }]);
});

test("an agent that quit some other way says so instead of No chat", async () => {
  const { H, self, cx } = await chatAt({ foreground: { name: "-zsh", pid: 9 } });
  await self.locate(cx);
  assert.equal(self.phase, "quit");
  assert.deepEqual(H.runs, []);

  const never = await chatAt({ foreground: { name: "zsh", pid: 9 } }, { kind: undefined, path: null, phase: "finding" });
  await never.self.locate(never.cx);
  assert.equal(never.self.phase, "unsupported");
});

test("after /clear the chat drops the old conversation before the new log exists", async () => {
  const { H, self, cx } = await chatAt({ status: { app: "claude-code" }, foreground: { name: "2.1.322", pid: 9 } }, { dfltFor: "claude|9", records: [{ id: "old" }] });
  H.other = () => ({ code: 0, stdout: "pending\n", stderr: "" });
  await self.locate(cx);
  assert.equal(self.path, null);
  assert.deepEqual(self.records, []);
  assert.equal(self.phase, "ready");
  assert.ok(self.conv);
});
