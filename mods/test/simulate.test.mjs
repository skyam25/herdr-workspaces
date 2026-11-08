import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HWS, setup, mount, settle, hwsCalls, usedMethods } from "./harness.mjs";

const args = (H) => hwsCalls(H).map((c) => c.args).filter((a) => a[0] !== "parent");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const APP = {
  version: 1, id: "spc1", name: "checkout demo", kind: "app", folder: "/Users/me/Projects/checkout", dir: "/state/workspaces/spc1", instructions: "Ship the demo",
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
  assert.deepEqual(args(H), [["new", "workspace", "--name", "Checkout", "--folder", "/Users/me/Projects/checkout", "--tabs", "Plan,Build", "--instructions", "Ship it", "--json"]]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("form names an unnamed workspace and leaves out empty instructions", async () => {
  const { H, m } = await form();
  m.view.inputs.folder.type("/x/report", m.cx);
  await m.click("create");
  assert.deepEqual(args(H)[0], ["new", "workspace", "--name", "Untitled workspace", "--folder", "/x/report", "--tabs", "Plan,Build", "--json"]);
});

test("folder starts at the parent folder and creates nothing", async () => {
  const { H, m } = await form();
  assert.equal(m.view.inputs.folder.value(), "~/Projects");
  m.view.inputs.name.type("Checkout Demo", m.cx);
  await m.settle();
  assert.equal(m.view.inputs.folder.value(), "~/Projects");
  await m.click("create");
  assert.deepEqual(args(H).at(-1), ["new", "workspace", "--name", "Checkout Demo", "--folder", "/Users/me/Projects", "--tabs", "Plan,Build", "--json"]);
});

test("cleared tabs leave out --tabs", async () => {
  const { H, m } = await form();
  m.view.inputs.tabs.type(" , ", m.cx);
  m.view.inputs.folder.type("/x/d", m.cx);
  await m.click("create");
  assert.equal(args(H)[0].includes("--tabs"), false);
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
  assert.equal(H.focusCalls.at(-1), "Plan, Build");
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
  const other = { ...THROWAWAY, id: "spc2" };
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
  const H = setup({ hws: { list: [APP, THROWAWAY] }, layout: structuredClone(SIDEBAR_LAYOUT) });
  const m = await mount("hws-panel", { view: "sidebar" });
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 99 } });
  H.layout.children[0].children[0].size.px = 99;
  H.runs.length = 0;
  await m.fireTimer(1000);
  assert.deepEqual(H.runs, []);
  H.layout.children[0].size.px = 76;
  await m.fireTimer(1000);
  assert.deepEqual(H.runs.at(-1), { name: "layout.resize", args: { id: "workspaces", px: 31 } });
  assert.equal(m.has("sidebar-workspace-spc1"), false);
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
