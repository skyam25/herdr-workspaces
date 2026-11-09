import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    { id: "old", type: "note", title: "older", path: "/art/old", prompt: "/art/old/prompt.md", fromTerminal: null, createdAt: 1000 },
    { id: "new", type: "board", title: "newer", path: "/art/new", prompt: "/art/new/prompt.md", fromTerminal: "t13", createdAt: 2000 },
  ],
};
const THROWAWAY = { ...APP, name: "scratch", kind: "throwaway", instructions: "", surfaces: [], artifacts: [] };
const AGENT = { address: "t13", pane: "p1", space: "spc1", space_name: "x", tab: "tb1", tab_name: "Plan", status: "working", app: "claude-code", program: { key: "claude", name: "Claude Code" }, title: "t", seq: 1, pinned: false, focused: true };

function inWorkspace(manifest = APP, extra = {}) {
  return setup({ focused: { space: "spc1", tab: "tb1", pane: "p1", terminal: "t13", shown: null, agent: null, cwd: "/w" }, agents: [AGENT], panes: [{ pane: "p1", terminal: "t13", tab: "tb1" }], hws: { list: [manifest] }, ...extra });
}

// Launcher

test("launcher menu runs the right commands and closes after success", async () => {
  const H = setup();
  const m = await mount("hws-new", { overlay: "ov0" });
  assert.match(m.text(), /New terminal.*New workspace.*Throwaway.*New board.*New note/);
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
  assert.deepEqual(args(H3), [["surface", "open", "--type", "board", "--title", "Untitled board", "--standalone", "--json"]]);
});

const ACTIVE = { id: "spc1", active: true, machine: null, folder: "/space/dir", tabs: [] };

test("Orchestrate this space starts in the focused terminal's folder", async () => {
  const H = setup({ spaces: [ACTIVE] });
  const m = await mount("hws-new", { overlay: "ov0" });
  assert.match(m.text(), /Orchestrate this space \| Run the Board with an agent that assigns the work\./);
  await m.click("orchestrate");
  assert.deepEqual(args(H), [["orchestrator", "start", "--space", "spc1", "--folder", "/Users/me/work", "--json"]]);
  assert.deepEqual(H.closed, ["ov0"]);
});

test("Orchestrate this space falls back to the space's folder", async () => {
  const H = setup({ spaces: [ACTIVE], focused: { space: "spc1", tab: "tb1", pane: "p9", terminal: null, cwd: null } });
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("orchestrate");
  assert.deepEqual(args(H), [["orchestrator", "start", "--space", "spc1", "--folder", "/space/dir", "--json"]]);
});

test("Orchestrate this space ignores focus in another space", async () => {
  const H = setup({ spaces: [ACTIVE], focused: { space: "spc2", tab: "tb9", pane: "p9", terminal: "t9", cwd: "/elsewhere" } });
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("orchestrate");
  assert.deepEqual(args(H), [["orchestrator", "start", "--space", "spc1", "--folder", "/space/dir", "--json"]]);
});

test("Orchestrate this space is disabled with no space, no folder or a remote space", async () => {
  const unavailable = [
    { spaces: [] },
    { spaces: [{ ...ACTIVE, active: false }] },
    { spaces: [{ ...ACTIVE, folder: "" }], focused: null },
    { spaces: [{ ...ACTIVE, machine: "vps" }] },
  ];
  for (const world of unavailable) {
    const H = setup(world);
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
  const H = setup({ spaces: [ACTIVE] });
  const m = await mount("hws-new", { overlay: "ov0" });
  m.view.at = 6;
  await m.key("enter");
  assert.deepEqual(args(H), [["orchestrator", "start", "--space", "spc1", "--folder", "/Users/me/work", "--json"]]);
});

test("the launcher shows why an orchestrator did not start and stays open", async () => {
  const H = setup({ spaces: [ACTIVE] });
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

test("the menu opens Find throwaway as its own dialog", async () => {
  const H = setup();
  const m = await mount("hws-new", { overlay: "ov0" });
  await m.click("find-throwaway");
  assert.deepEqual(H.closed, ["ov0"]);
  assert.equal(H.overlays[0].mod, "hws-new");
  assert.equal(H.overlays[0].props.step, "find");
});

test("find lists retired throwaways and reopens a clicked one", async () => {
  const H = setup({ hws: { find: RETIRED, reopen: { id: "sp9" } } });
  const m = await mount("hws-new", { overlay: "ov1", step: "find" });
  await settle();
  assert.deepEqual(args(H), [["find", "--", "--json"]]);
  assert.match(m.text(), /Fix login.*throwaway-1c26.*3 days ago.*1 artifact.*plain.*Today/);
  await m.click("retired-sp2");
  assert.deepEqual(args(H).at(-1), ["reopen", "sp2", "--json"]);
  assert.deepEqual(H.closed, ["ov1"]);
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
  assert.match(m.text(), /Throwaways you close or that go idle appear here/);
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

// Panel

test("panel outside a workspace says so and offers New workspace", async () => {
  const H = setup({ hws: { list: [] } });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /not a workspace/);
  await m.click("new-workspace");
  assert.equal(H.overlays[0].mod, "hws-new");
  assert.equal(H.overlays[0].props.step, "workspace");
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

test("the panel changes a kept workspace's kind and hides the setting on a throwaway", async () => {
  const H = inWorkspace();
  const m = await mount("hws-panel", {});
  await m.click("kind-deliverable");
  await m.settle();
  assert.deepEqual(hwsCalls(H).find((c) => c.args[0] === "set").args, ["set", "--workspace", "spc1", "--kind", "deliverable", "--json"]);
});

test("panel shows the workspace, live status, surfaces and artifacts newest first", async () => {
  const H = inWorkspace();
  H.spaces = [{ id: "spc1", machine: null, tabs: [{ id: "tb1", name: "Plan", status: "working" }] }];
  H.panes.push({ pane: "p9", terminal: null, tab: "tb1" });
  const m = await mount("hws-panel", {});
  const text = m.text();
  assert.match(text, /checkout demo.*Ship the demo.*~\/Projects\/checkout.*General.*App.*Deliverable/);
  assert.match(text, /Plan.*Working.*Claude Code · planner · t13.*Working/);
  assert.match(text, /flow.*board · t13/);
  assert.ok(text.indexOf("newer") < text.indexOf("older"));
  await m.click("agent-t13");
  assert.deepEqual(H.runs.at(-1), { name: "agent.focus", args: { terminal: "t13" } });
  await m.click("surface-s1");
  assert.deepEqual(H.runs.at(-1), { name: "pane.focus", args: { pane: "p9" } });
});

test("live status follows agents() without another hws call", async () => {
  const H = inWorkspace();
  const m = await mount("hws-panel", {});
  const before = H.calls.length;
  H.agents = [{ ...AGENT, status: "blocked" }];
  assert.match(m.text(), /Needs you/);
  assert.equal(H.calls.length, before);
});

test("a surface whose pane has gone is not clickable", async () => {
  inWorkspace();
  const m = await mount("hws-panel", {});
  assert.equal(m.clickable("surface-s1"), false);
});

test("artifact actions call the right commands and copy through pbcopy", async () => {
  const H = inWorkspace(APP, { hws: { list: [APP], "link new": { link: "@/art/new/prompt.md" }, "artifact terminal new": {} } });
  const m = await mount("hws-panel", {});
  await m.click("terminal-new");
  assert.deepEqual(args(H).at(-1), ["artifact", "terminal", "new", "--json"]);
  await m.click("link-new");
  assert.deepEqual(args(H).at(-1), ["link", "new", "--json"]);
  const copy = H.calls.at(-1);
  assert.equal(copy.command, "sh");
  assert.deepEqual(copy.args.slice(2), ["sh", "@/art/new/prompt.md"]);
  assert.match(copy.args[1], /pbcopy/);
  assert.match(m.text(), /Link copied/);
  await m.click("folder-new");
  assert.deepEqual(H.calls.at(-1), { command: "open", args: ["/art/new"] });
});

test("New board and New note attach to the focused agent", async () => {
  const H = inWorkspace();
  const m = await mount("hws-panel", {});
  m.render();
  await m.click("new-board");
  assert.deepEqual(args(H).find((a) => a[0] === "surface"), ["surface", "open", "--type", "board", "--terminal", "t13", "--json"]);
  await m.click("new-note");
  assert.deepEqual(args(H).filter((a) => a[0] === "surface").at(-1), ["surface", "open", "--type", "note", "--terminal", "t13", "--json"]);
});

test("the agent stays the target when the panel takes focus", async () => {
  const H = inWorkspace();
  const m = await mount("hws-panel", {});
  m.render();
  H.focused = { ...H.focused, pane: "p2", terminal: null };
  H.agents = [{ ...AGENT, focused: false }];
  assert.match(m.text(), /opens beside t13/);
  await m.click("new-board");
  assert.ok(args(H).some((a) => a.includes("--terminal") && a.includes("t13")));
});

test("with no known agent the buttons are off and nothing is guessed", async () => {
  const H = inWorkspace(APP, { agents: [{ ...AGENT, focused: false }], focused: { space: "spc1", tab: "tb1", pane: "p2", terminal: null } });
  const m = await mount("hws-panel", {});
  assert.equal(m.clickable("new-board"), false);
  assert.equal(m.clickable("new-note"), false);
  assert.match(m.text(), /focus an agent/);
  assert.equal(args(H).some((a) => a[0] === "surface"), false);
});

test("the terminal the toggle saw seeds the target", async () => {
  inWorkspace(APP, { agents: [{ ...AGENT, focused: false }], focused: { space: "spc1", tab: "tb1", pane: "p2", terminal: null } });
  const m = await mount("hws-panel", { terminal: "t13" });
  assert.match(m.text(), /opens beside t13/);
});

test("Close asks first, then closes a workspace with no decision needed", async () => {
  const H = inWorkspace(APP, { hws: { list: [APP], close: { closed: true } } });
  const m = await mount("hws-panel", {});
  await m.click("close");
  assert.equal(args(H).some((a) => a[0] === "close"), false);
  assert.match(m.text(), /Close this workspace and its terminals/);
  await m.click("close-cancel");
  assert.equal(args(H).some((a) => a[0] === "close"), false);
  await m.click("close");
  await m.click("close-yes");
  assert.deepEqual(args(H).find((a) => a[0] === "close"), ["close", "--workspace", "spc1", "--json"]);
  assert.equal(H.overlays.length, 0);
});

test("a throwaway's close decision opens the dialog and Keep calls --keep", async () => {
  const made = [{ id: "a1", type: "board", title: "sketch" }, { id: "a2", type: "note", title: "ideas" }];
  const H = inWorkspace(THROWAWAY, { hws: { list: [THROWAWAY], close: (argv) => (argv.includes("--keep") || argv.includes("--trash") ? { closed: true } : { decision: "needed", artifacts: made }) } });
  const m = await mount("hws-panel", {});
  await m.click("close");
  await m.click("close-yes");
  assert.deepEqual(args(H).filter((a) => a[0] === "close"), [["close", "--workspace", "spc1", "--json"]]);
  const spec = H.overlays[0];
  assert.equal(spec.kind, "dialog");
  assert.equal(spec.props.view, "decide");
  assert.deepEqual(spec.props.artifacts, made);

  const d = await mount("hws-panel", { ...spec.props, overlay: "ov7" }, H);
  assert.match(d.text(), /sketch.*ideas/);
  await d.click("keep");
  assert.deepEqual(args(H).filter((a) => a[0] === "close").at(-1), ["close", "--workspace", "spc1", "--keep", "--json"]);
  assert.deepEqual(H.closed, ["ov7"]);
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

test("a space change refreshes and clears a half-done close", async () => {
  const H = inWorkspace();
  const m = await mount("hws-panel", {});
  await m.click("close");
  H.focused = { ...H.focused, space: "spc2" };
  assert.match(m.text(), /not a workspace/);
  await settle();
  assert.equal(m.view.isConfirmingClose, false);
  assert.equal(args(H).filter((a) => a[0] === "list").length, 2);
});

test("a hws failure on list shows the message", async () => {
  setup({ hws: { list: { fail: "state folder unreadable" } } });
  const m = await mount("hws-panel", {});
  assert.match(m.text(), /state folder unreadable/);
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

test("every element method used exists in gpui-kit.d.ts", () => {
  const types = readFileSync(`${process.env.HOME}/.config/herdr-app/gpui-kit.d.ts`, "utf8");
  const unknown = usedMethods().filter((name) => !new RegExp(`\\b${name}\\s*[<(]`).test(types));
  assert.deepEqual(unknown, []);
});

test("every herdr import exists in herdr.d.ts", () => {
  const types = readFileSync(`${process.env.HOME}/.config/herdr-app/herdr.d.ts`, "utf8");
  for (const file of ["../hws-new/main.js", "../hws-new/hws.js", "../hws-panel/main.js", "../hws-brief/main.js"]) {
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

test("the empty sidebar section offers New workspace and the launcher", async () => {
  const H = setup({ hws: { list: [] } });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /Workspaces.*New workspace/);
  await m.click("sidebar-new-workspace");
  assert.equal(H.overlays[0].props.step, "workspace");
  await m.click("sidebar-launcher");
  assert.deepEqual(H.runs.at(-1), { name: "mod.open", args: { name: "hws-new" } });
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

test("the sidebar section sizes its block to its rows and hides them when narrow", async () => {
  const H = setup({ hws: { list: [APP, THROWAWAY] }, spaces: [{ id: "spc1", active: true, tabs: [] }], layout: structuredClone(SIDEBAR_LAYOUT) });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 203 } });
  H.layout.children[0].children[0].size.px = 203;
  H.runs.length = 0;
  await m.fireTimer(1000);
  assert.deepEqual(H.runs, []);
  H.layout.children[0].size.px = 76;
  await m.fireTimer(1000);
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 31 } });
  assert.equal(m.has("sidebar-workspace-spc1"), false);
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
  assert.match(m.text(), /checkout demo.*api.*web.*Add space/);
  assert.equal(m.has("sidebar-space-spc2"), false);
  await m.click("sidebar-space-spc3");
  assert.deepEqual(H.runs.at(-1), { name: "space.select", args: { id: "spc3" } });
});

test("a workspace with one space has no space rows and still offers Add space", async () => {
  const H = setup({ hws: { list: [APP] }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.equal(m.has("sidebar-space-spc1"), false);
  assert.equal(m.has("sidebar-fold-spc1"), false);
  await m.click("sidebar-add-space-spc1");
  assert.deepEqual(H.overlays.at(-1).props, { view: "add-space", workspace: "spc1", name: "checkout demo", spaces: ["spc1"] });
});

test("Add board shows only under the current workspace until it has a Board", async () => {
  const H = setup({ hws: { list: [GROUP], "board add": { workspace: "spc1", space: "spb", tab: "tbb" } }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  await m.click("sidebar-add-board-spc1");
  assert.deepEqual(args(H).find((a) => a[0] === "board"), ["board", "add", "--workspace", "spc1", "--json"]);
  assert.deepEqual(H.runs.filter((r) => r.name !== "layout.resize").slice(-2), [{ name: "space.select", args: { id: "spb" } }, { name: "tab.select", args: { id: "tbb" } }]);

  setup({ hws: { list: [{ ...GROUP, board: { space: "spc3", tab: "tb3" } }] }, spaces: SPACED });
  const added = await mount("hws-panel", { view: "sidebar" });
  assert.equal(added.has("sidebar-add-board-spc1"), false);

  setup({ hws: { list: [GROUP] }, spaces: SPACED.map((s) => ({ ...s, active: false })) });
  const elsewhere = await mount("hws-panel", { view: "sidebar" });
  assert.equal(elsewhere.has("sidebar-add-board-spc1"), false);
});

test("the Board is listed once and first, opens its tab and has no minus", async () => {
  const withBoard = { ...GROUP, board: { space: "spc3", tab: "tb3" } };
  const H = setup({ hws: { list: [withBoard] }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.match(m.text(), /checkout demo.*web.*api.*Add space/);
  assert.equal(m.has("sidebar-remove-spc3"), false);
  assert.equal(m.has("sidebar-remove-spc1"), true);
  await m.click("sidebar-space-spc3");
  assert.deepEqual(H.runs.slice(-2), [{ name: "space.select", args: { id: "spc3" } }, { name: "tab.select", args: { id: "tb3" } }]);
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
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 173 } });
  H.layout.children[0].children[0].size.px = 173;
  await m.click("sidebar-fold-spc1");
  assert.equal(m.has("sidebar-space-spc1"), false);
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 69 } });
  assert.equal(H.runs.some((r) => r.name === "space.select"), false);
  const again = await mount("hws-panel", { view: "sidebar" });
  assert.equal(again.has("sidebar-space-spc1"), false);
});

test("the minus takes a space out of the workspace", async () => {
  const H = setup({ hws: { list: [GROUP] }, spaces: SPACED });
  const m = await mount("hws-panel", { view: "sidebar" });
  await m.click("sidebar-remove-spc3");
  assert.deepEqual(args(H).at(-2), ["space", "remove", "--space", "spc3", "--json"]);
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
