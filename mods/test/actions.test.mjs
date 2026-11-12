import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup, mount, hwsCalls, settle, usedMethods } from "./harness.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const OK = { code: 0, stdout: "", stderr: "" };
const AGENT_PANE = { pane: "p1", terminal: "t1", tab: "tb1", focused: true };
const CANCELLED = { code: 1, stdout: "", stderr: "execution error: User canceled. (-128)" };
const BROKEN = { code: 1, stdout: "", stderr: "execution error: no display (-1)" };

const TERMINAL = { terminal: "t1", overlay: "ov1" };
const FLIPPED = { terminal: "t1", chat: true, pane: "p2", space: "spc1", overlay: "ov1" };

// The sidebar shares the ids of every space in an open workspace.
const IN_WORKSPACE = { sharedValues: { "hws.workspace.spaces": ["spc1"] } };

function world(overrides) {
  const H = setup({ writes: [], sharedSets: [], sharedValues: {}, terminals: [], ...overrides });
  H.hcCalls = [];
  return H;
}

const rows = (m) => m.text().split(" | ");
const openArgs = (H) => hwsCalls(H).map((c) => c.args);
const osascriptCalls = (H) => H.calls.filter((c) => c.command === "osascript");

// hws-actions

test("a terminal agent's menu has the rows every agent gets", async () => {
  world();
  const m = await mount("hws-actions", TERMINAL);
  assert.deepEqual(rows(m), ["Sketch", "Write a note", "Review a page…", "Send to phone…", "Tasks", "Outputs"]);
});

test("a flipped agent with a reply gets every row in table order", async () => {
  world();
  const m = await mount("hws-actions", { ...FLIPPED, lastReply: "Done." });
  assert.deepEqual(rows(m), ["Sketch", "Write a note", "Write a note from last reply", "Review a page…", "Send to phone…", "Attach file…", "Tasks", "Outputs"]);
});

// The 240px popup leaves 191px for a label after padding, icon and gap. At 13px a
// label of 30 characters measures about 170px, and the longest today is 28.
test("every fixed row fits the 240px popup", async () => {
  assert.equal(JSON.parse(read("../hws-actions/mod.json")).overlay.width, 240);
  world(IN_WORKSPACE);
  const m = await mount("hws-actions", { ...FLIPPED, cwd: "/w", lastReply: "Done." });
  for (const row of rows(m)) assert.ok(row.length <= 30, row);
});

test("Orchestrate this space comes last, after its own divider", async () => {
  world(IN_WORKSPACE);
  const m = await mount("hws-actions", { ...TERMINAL, space: "spc1", cwd: "/w/proj" });
  assert.deepEqual(rows(m), ["Sketch", "Write a note", "Review a page…", "Send to phone…", "Tasks", "Outputs", "Orchestrate this space"]);
  const last = m.render().node.children.at(-1).node;
  assert.equal(last.children.length, 2);
  assert.equal(last.children[1].node.id, "orchestrate");
});

test("Orchestrate this space starts one in the agent's space and folder", async () => {
  const H = world(IN_WORKSPACE);
  const m = await mount("hws-actions", { ...TERMINAL, space: "spc1", cwd: "/w/proj" });
  await m.click("orchestrate");

  assert.deepEqual(openArgs(H), [["orchestrator", "start", "--space", "spc1", "--folder", "/w/proj", "--json"]]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("a flipped agent orchestrates its space too", async () => {
  const H = world(IN_WORKSPACE);
  const m = await mount("hws-actions", { ...FLIPPED, cwd: "/w/flip" });
  await m.click("orchestrate");

  assert.deepEqual(openArgs(H), [["orchestrator", "start", "--space", "spc1", "--folder", "/w/flip", "--json"]]);
});

test("Orchestrate this space is hidden on a space outside every workspace", async () => {
  for (const sharedValues of [{}, { "hws.workspace.spaces": ["spc9"] }]) {
    world({ sharedValues });
    const m = await mount("hws-actions", { ...TERMINAL, space: "spc1", cwd: "/w/proj" });
    assert.equal(m.has("orchestrate"), false, JSON.stringify(sharedValues));
  }
});

test("Orchestrate this space is hidden when the space or folder is unknown", async () => {
  world();
  for (const extra of [{}, { space: "spc1" }, { cwd: "/w/proj" }, { space: "spc1", cwd: "" }]) {
    const m = await mount("hws-actions", { ...TERMINAL, ...extra });
    assert.equal(m.has("orchestrate"), false, JSON.stringify(extra));
  }
});

test("a failing orchestrator start shows its message and keeps the menu open", async () => {
  const H = world({ ...IN_WORKSPACE, hws: { "orchestrator start": { fail: "claude is not installed" } } });
  const m = await mount("hws-actions", { ...TERMINAL, space: "spc1", cwd: "/w/proj" });
  await m.click("orchestrate");

  assert.match(m.text(), /claude is not installed/);
  assert.deepEqual(H.closed, []);
});

test("Sketch opens a board beside the terminal and closes the menu", async () => {
  const H = world();
  const m = await mount("hws-actions", TERMINAL);
  await m.click("sketch");

  assert.deepEqual(openArgs(H), [["surface", "open", "--type", "board", "--terminal", "t1", "--json"]]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("a flipped agent's surface splits beside its chat pane", async () => {
  const H = world();
  const m = await mount("hws-actions", FLIPPED);
  await m.click("write");

  assert.deepEqual(openArgs(H), [["surface", "open", "--type", "note", "--terminal", "t1", "--beside-pane", "p2", "--space", "spc1", "--json"]]);
});

test("a failing hws call shows its message and keeps the menu open", async () => {
  const H = world({ hws: { "surface open": { fail: "t1 is not live." } } });
  const m = await mount("hws-actions", TERMINAL);
  await m.click("sketch");

  assert.match(m.text(), /t1 is not live\./);
  assert.deepEqual(H.closed, []);
});

test("Write a note from last reply saves the reply, then opens that file as a note", async () => {
  const H = world();
  const m = await mount("hws-actions", { ...TERMINAL, lastReply: "The plan is ready." });
  await m.click("write-reply");

  assert.equal(H.writes.length, 1);
  const { path, text, expected } = H.writes[0];
  assert.match(path, /^\/Users\/me\/\.config\/herdr-app\/data\/hws-actions\/reply-\d+\.md$/);
  assert.equal(text, "The plan is ready.");
  assert.equal(expected, null);
  assert.deepEqual(H.calls.find((c) => c.command === "mkdir").args, ["-p", "/Users/me/.config/herdr-app/data/hws-actions"]);
  assert.deepEqual(openArgs(H), [["surface", "open", "--type", "note", "--file", path, "--terminal", "t1", "--json"]]);
  assert.deepEqual(H.closed, ["ov1"]);
});

// Runs the recorded review shell for real, with fake osascript and hws on PATH.
function runReview(H, osascript) {
  const { args } = H.calls.find((c) => c.command === "sh");
  const dir = mkdtempSync(join(tmpdir(), "hws-review-"));
  writeFileSync(join(dir, "osascript"), `#!/bin/sh\n${osascript}\n`, { mode: 0o755 });
  writeFileSync(join(dir, "uname"), "#!/bin/sh\necho Darwin\n", { mode: 0o755 });
  writeFileSync(join(dir, "hws"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  return spawnSync("/bin/sh", args, { encoding: "utf8", env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir } });
}

test("Review a page offers html, htm and md, then opens the chosen file", async () => {
  const H = world();
  const m = await mount("hws-actions", TERMINAL);
  await m.click("review");

  const run = runReview(H, 'echo "/Users/me/a b.html"');
  assert.equal(run.status, 0);
  assert.deepEqual(run.stdout.trim().split("\n"), ["surface", "open", "--type", "page", "--file", "/Users/me/a b.html", "--terminal", "t1", "--json"]);
  assert.match(H.calls.find((c) => c.command === "sh").args[1], /of type \{"html", "htm", "md"\}/);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("on Linux, Review a page uses the desktop's file picker and opens its first choice", async () => {
  const H = world();
  const m = await mount("hws-actions", TERMINAL);
  await m.click("review");
  const { args } = H.calls.find((c) => c.command === "sh");
  const dir = mkdtempSync(join(tmpdir(), "hws-review-"));
  writeFileSync(join(dir, "uname"), "#!/bin/sh\necho Linux\n", { mode: 0o755 });
  writeFileSync(join(dir, "python3"), '#!/bin/sh\necho "$2"\necho /second.html\n', { mode: 0o755 });
  writeFileSync(join(dir, "hws"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  const run = spawnSync("/bin/sh", args, { encoding: "utf8", env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir } });
  assert.equal(run.status, 0);
  assert.deepEqual(run.stdout.trim().split("\n").slice(0, 5), ["surface", "open", "--type", "page", "--file"]);
  assert.equal(run.stdout.trim().split("\n")[5], "/Users/me/.config/herdr-app/mods/hws-chat/pick-files.py");
});

test("a flipped agent's page opens beside its chat pane", async () => {
  const H = world();
  const m = await mount("hws-actions", FLIPPED);
  await m.click("review");

  const run = runReview(H, 'echo "/w/a.html"');
  assert.deepEqual(run.stdout.trim().split("\n").slice(6), ["--terminal", "t1", "--beside-pane", "p2", "--space", "spc1", "--json"]);
});

test("cancelling the page chooser opens nothing and exits cleanly", async () => {
  const H = world();
  const m = await mount("hws-actions", TERMINAL);
  await m.click("review");

  const run = runReview(H, 'echo "execution error: User canceled. (-128)" >&2; exit 1');
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "");
});

test("a page chooser that fails reports it and opens nothing", async () => {
  const H = world();
  const m = await mount("hws-actions", TERMINAL);
  await m.click("review");

  const run = runReview(H, 'echo "broken" >&2; exit 1');
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /Couldn't open the file chooser\./);
});

test("a failing review shows its message and keeps the menu open", async () => {
  const H = world({ other: (command) => (command === "sh" ? { code: 1, stdout: "", stderr: "Couldn't open the file chooser." } : OK) });
  const m = await mount("hws-actions", TERMINAL);
  await m.click("review");

  assert.match(m.text(), /Couldn't open the file chooser\./);
  assert.deepEqual(H.closed, []);
});

test("Attach file asks the chat pane to pick files and closes the menu", async () => {
  const H = world();
  const m = await mount("hws-actions", FLIPPED);
  await m.click("attach");

  assert.equal(H.sharedSets.length, 1);
  assert.equal(H.sharedSets[0].key, "hws-chat.attach");
  assert.equal(H.sharedSets[0].value.pane, "p2");
  assert.equal(typeof H.sharedSets[0].value.at, "number");
  assert.deepEqual(H.closed, ["ov1"]);
});

test("outputs selects its panel view and shows the panel", async () => {
  const H = world();
  const m = await mount("hws-actions", TERMINAL);
  await m.click("outputs");

  assert.deepEqual(H.runs, [
    { name: "layout.select", args: { stack: "panel-body", child: "outputs" } },
    { name: "layout.show", args: { id: "panel" } },
  ]);
  assert.deepEqual(H.closed, ["ov1"]);
});

const SPACE = (tabs) => [{ id: "spc1", active: true, machine: null, tabs }];

test("Tasks in a plain space opens nothing and says Tasks needs a workspace", async () => {
  const H = world({ spaces: SPACE([{ id: "tb1", name: "1", active: true }]), panes: [AGENT_PANE] });
  H.notices = [];
  const m = await mount("hws-actions", TERMINAL);
  await m.click("tasks");

  assert.deepEqual(H.runs, []);
  assert.deepEqual(H.notices.at(-1), { title: "Tasks needs a workspace", body: "Add this space to a workspace to use Tasks." });
  assert.deepEqual(H.closed, ["ov1"]);
});

test("Tasks selects the space's Board tab when it has one", async () => {
  const tabs = [{ id: "tb1", name: "1", active: true }, { id: "tb9", name: "Board", active: false }];
  const H = world({ spaces: SPACE(tabs), panes: [AGENT_PANE, { pane: "pb", terminal: null, tab: "tb9", mod: "hws-work", title: "Work" }] });
  const m = await mount("hws-actions", TERMINAL);
  await m.click("tasks");

  assert.deepEqual(H.runs, [{ name: "tab.select", args: { id: "tb9" } }]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("Up, Down and Enter move through the rows and run the selected one", async () => {
  const H = world();
  const m = await mount("hws-actions", TERMINAL);

  await m.key("down");
  await m.key("enter");
  assert.equal(openArgs(H)[0][3], "note");

  const H2 = world();
  const wrapped = await mount("hws-actions", TERMINAL, H2);
  await wrapped.key("up");
  await wrapped.key("enter");
  assert.equal(H2.runs[0].args.child, "outputs");
});

test("Esc closes the menu and runs nothing", async () => {
  const H = world();
  const m = await mount("hws-actions", TERMINAL);
  await m.key("escape");

  assert.deepEqual(H.closed, ["ov1"]);
  assert.deepEqual(openArgs(H), []);
  assert.deepEqual(H.runs, []);
});

test("hws-actions uses only documented builders and herdr functions", { skip: !existsSync(`${process.env.HOME}/.config/herdr-app/herdr.d.ts`) }, () => {
  const types = (name) => readFileSync(`${process.env.HOME}/.config/herdr-app/${name}`, "utf8");
  const gpui = types("gpui-kit.d.ts");
  const unknown = usedMethods().filter((name) => !new RegExp(`\\b${name}\\s*[<(]`).test(gpui));
  assert.deepEqual(unknown, []);

  const herdr = types("herdr.d.ts");
  const names = /import \{([^}]*)\} from "herdr"/.exec(read("../hws-actions/main.js"))[1].split(",").map((s) => s.trim());
  for (const name of names) assert.match(herdr, new RegExp(`export function ${name}\\b`), name);
});

// The + button in the pane header

const AGENT = { pane: "p1", terminal: "t1", tab: "tb1", focused: true, app: "claude-code", program: { agent: true, name: "Claude Code", key: "claude" } };
const SHELL = { pane: "p1", terminal: "t1", tab: "tb1", focused: true, program: { shell: true, name: "zsh", key: "zsh" } };
const CHAT_PANE = { pane: "p2", terminal: null, tab: "tb1", focused: true, mod: "hws-chat" };
const parked = { address: "t1", state: "live", labels: { "herdr.chat": "p2" }, status: "idle", program: AGENT.program };

test("an agent pane shows the + without hover and opens the menu for its terminal", async () => {
  const H = world({ panes: [AGENT] });
  const m = await mount("hws-pane", { pane: "p1" });
  assert.equal(m.view.hovered, false);
  await m.click("ph-new-p1");

  assert.deepEqual(H.overlays, [{ mod: "hws-actions", kind: "popup", width: 240, props: { terminal: "t1", space: "spc1" } }]);
});

test("an agent pane passes its folder to the menu", async () => {
  const H = world({ panes: [{ ...AGENT, cwd: "/w/proj" }] });
  const m = await mount("hws-pane", { pane: "p1" });
  await m.click("ph-new-p1");

  assert.deepEqual(H.overlays[0].props, { terminal: "t1", space: "spc1", cwd: "/w/proj" });
});

test("a chat pane's + opens the menu for its parked agent", async () => {
  const H = world({ panes: [CHAT_PANE], terminals: [parked] });
  const m = await mount("hws-pane", { pane: "p2" });
  await m.click("ph-new-p2");

  assert.deepEqual(H.overlays[0].props, { terminal: "t1", chat: true, pane: "p2", space: "spc1" });
});

test("a chat pane passes its parked agent's folder to the menu", async () => {
  const H = world({ panes: [CHAT_PANE], terminals: [{ ...parked, cwd: "/w/old", foreground: { cwd: "/w/live" } }] });
  const m = await mount("hws-pane", { pane: "p2" });
  await m.click("ph-new-p2");

  assert.deepEqual(H.overlays[0].props, { terminal: "t1", chat: true, pane: "p2", space: "spc1", cwd: "/w/live" });
});

test("shell panes and chats with no live agent have no +", async () => {
  world({ panes: [SHELL] });
  assert.equal((await mount("hws-pane", { pane: "p1" })).has("ph-new-p1"), false);

  world({ panes: [CHAT_PANE], terminals: [{ ...parked, state: "ended" }] });
  assert.equal((await mount("hws-pane", { pane: "p2" })).has("ph-new-p2"), false);
});

test("the + sits just left of the Chat | Terminal switch", async () => {
  world({ panes: [AGENT] });
  const m = await mount("hws-pane", { pane: "p1" });
  const kids = m.render().node.children;
  const plus = kids.findIndex((c) => c.node?.id === "ph-new-p1");
  assert.equal(kids[plus + 1].node.children[0].node.id, "ph-mode-p1-chat");
});

// The composer's + and the attach request

world();
const { default: Chat } = await import("../hws-chat/main.js");

function chat(overrides = {}) {
  const c = Object.create(Chat.prototype);
  const inline = [];
  Object.assign(c, {
    addr: "t1",
    conv: null,
    attachReqAt: 0,
    error: null,
    box: { focus() {} },
    inline,
    addInline: (list) => inline.push(...list),
    saveSoon() {},
    myPane: () => "p2",
    ...overrides,
  });
  return c;
}

const cx = { notify() {}, spawn: (fn) => fn(cx), timer: { after: (_ms, fn) => fn(cx) } };

const macPicker = (answer) => (command) => {
  if (command === "uname") return { ...OK, stdout: "Darwin\n" };
  return command === "osascript" ? answer : OK;
};

test("the composer's + is wired to the menu", () => {
  assert.match(read("../hws-chat/main.js"), /this\.round\("chat-attach",[^\n]*this\.openActions\(cx\)/);
});

test("the composer's + opens the menu with the newest assistant text", () => {
  const H = world({ panes: [CHAT_PANE], other: () => OK });
  const c = chat({ conv: { items: [{ kind: "agent", text: "Old" }, { kind: "agent", text: "New" }, { kind: "tools", steps: [] }] } });
  c.openActions(cx);

  assert.deepEqual(H.overlays, [{ mod: "hws-actions", kind: "popup", width: 240, props: { terminal: "t1", chat: true, pane: "p2", space: "spc1", lastReply: "New" } }]);
});

test("the composer's + passes the agent's folder", () => {
  const H = world({ panes: [CHAT_PANE] });
  chat({ t: { cwd: "/w/old", foreground: { cwd: "/w/live" } } }).openActions(cx);

  assert.equal(H.overlays[0].props.cwd, "/w/live");
  assert.equal(H.overlays[0].props.space, "spc1");
});

test("a chat with no known folder leaves cwd out", () => {
  const H = world({ panes: [CHAT_PANE] });
  chat().openActions(cx);

  assert.equal("cwd" in H.overlays[0].props, false);
});

test("a chat with no reply yet leaves lastReply out", () => {
  const H = world({ panes: [CHAT_PANE] });
  chat().openActions(cx);

  assert.equal("lastReply" in H.overlays[0].props, false);
});

test("a chat with no agent opens the file picker directly", async () => {
  const H = world({ other: macPicker(CANCELLED) });
  chat({ addr: null, myPane: () => null }).openActions(cx);
  await settle();

  assert.deepEqual(H.overlays, []);
  assert.equal(osascriptCalls(H).length, 1);
});

test("macOS picks several files and adds their POSIX paths", async () => {
  const H = world({ other: macPicker({ ...OK, stdout: "/a/one.png\n/a/two words.pdf\n" }) });
  const c = chat();
  c.pickFiles(cx);
  await settle();

  assert.match(osascriptCalls(H)[0].args.join(" "), /choose file .*with multiple selections allowed/);
  assert.match(osascriptCalls(H)[0].args.join(" "), /POSIX path of f/);
  assert.match(JSON.stringify(c.inline), /\/a\/one\.png/);
  assert.match(JSON.stringify(c.inline), /\/a\/two words\.pdf/);
  assert.equal(H.calls.some((x) => x.command === "sh"), false);
  assert.equal(c.error, null);
});

test("cancelling the macOS picker adds nothing and shows no error", async () => {
  world({ other: macPicker(CANCELLED) });
  const c = chat();
  c.pickFiles(cx);
  await settle();

  assert.deepEqual(c.inline, []);
  assert.equal(c.error, null);
});

test("a macOS picker that fails says so", async () => {
  world({ other: macPicker(BROKEN) });
  const c = chat();
  c.pickFiles(cx);
  await settle();

  assert.equal(c.error, "Couldn't open the file picker.");
});

test("Linux keeps the portal picker", async () => {
  const H = world({
    other: (command) => {
      if (command === "uname") return { ...OK, stdout: "Linux\n" };
      return command === "sh" ? { ...OK, stdout: "/home/me/x.txt\n" } : OK;
    },
  });
  const c = chat();
  c.pickFiles(cx);
  await settle();

  assert.match(H.calls.find((x) => x.command === "sh").args.at(-1), /mods\/hws-chat\/pick-files\.py$/);
  assert.equal(osascriptCalls(H).length, 0);
  assert.match(JSON.stringify(c.inline), /\/home\/me\/x\.txt/);
});

test("an attach request for this pane runs the picker once", async () => {
  const H = world({ other: macPicker(CANCELLED), sharedValues: { "hws-chat.attach": { pane: "p2", at: 50 } } });
  const c = chat();

  c.takeAttachRequest("p2", cx);
  c.takeAttachRequest("p2", cx);
  await settle();

  assert.equal(c.attachReqAt, 50);
  assert.equal(osascriptCalls(H).length, 1);
});

test("an attach request for another pane or an old time is ignored", async () => {
  const H = world({ other: macPicker(CANCELLED), sharedValues: { "hws-chat.attach": { pane: "p9", at: 50 } } });
  chat().takeAttachRequest("p2", cx);
  chat({ attachReqAt: 50 }).takeAttachRequest("p9", cx);
  await settle();

  assert.equal(osascriptCalls(H).length, 0);
});

// Boards left open or saved as drafts

const BOARD_LIST = "hws-pane.boards";
const boardsWorld = (boards) => world({ panes: [AGENT], sharedValues: { [BOARD_LIST]: boards } });
const draft = { id: "s1", title: "Plan", terminal: "t1", open: false };

test("a draft shows Resume sketch in its agent's header and resumes on click", async () => {
  const H = boardsWorld([draft]);
  const m = await mount("hws-pane", { pane: "p1" });
  assert.match(m.text(), /Resume sketch/);
  await m.click("ph-board-p1");
  await settle();
  assert.ok(openArgs(H).some((args) => args.join(" ") === "surface resume --id s1 --json"));
});

test("an open sketch shows Show sketch, and extra sketches are counted", async () => {
  boardsWorld([draft, { ...draft, id: "s2", open: true }]);
  const m = await mount("hws-pane", { pane: "p1" });
  assert.match(m.text(), /Show sketch \+1/);
});

test("another agent's board stays out of this header", async () => {
  boardsWorld([{ ...draft, terminal: "t9" }]);
  const m = await mount("hws-pane", { pane: "p1" });
  assert.equal(m.has("ph-board-p1"), false);
});

test("the + menu resumes and discards a draft and has no discard for an open board", async () => {
  world({});
  const m = await mount("hws-actions", { ...TERMINAL, boards: [draft, { ...draft, id: "s2", title: "Flow", open: true }] });
  const list = rows(m);
  assert.ok(list.includes("Resume Plan") && list.includes("Discard Plan") && list.includes("Show Flow"));
  assert.equal(list.includes("Discard Flow"), false);
});

test("an untitled sketch reads as sketch in the + menu", async () => {
  world({});
  const m = await mount("hws-actions", { ...TERMINAL, boards: [{ ...draft, title: "board" }] });
  const list = rows(m);
  assert.ok(list.includes("Resume sketch") && list.includes("Discard sketch"));
  assert.equal(list.some((row) => /board/i.test(row)), false);
});

test("discarding a draft takes it off the shared list at once", async () => {
  const H = boardsWorld([draft, { ...draft, id: "s2", open: true }]);
  const m = await mount("hws-actions", { ...TERMINAL, boards: [draft] });
  await m.click("discard-s1");
  await settle();
  assert.ok(openArgs(H).some((args) => args.join(" ") === "surface discard --id s1 --json"));
  assert.deepEqual(H.sharedSets.at(-1).value.map((b) => b.id), ["s2"]);
});

// The sidebar footer's Phone row

const NO_PHONE = { running: false, paired: false, devices: [], handoffs: [] };
const IPHONE = { running: true, paired: true, devices: [{ id: "d1", name: "iPhone" }], handoffs: [] };

test("the footer keeps Settings and Add machine and offers Pair phone when none is paired", async () => {
  const H = world({ hws: { "phone status": NO_PHONE } });
  const m = await mount("hws-footer", undefined);
  assert.equal(m.text(), "Settings | Add machine | Pair phone");

  await m.click("settings");
  await m.click("machine");
  assert.deepEqual(H.runs, [{ name: "app.settings", args: undefined }, { name: "mod.open", args: { name: "machine-add" } }]);
});

test("the footer names the paired phone", async () => {
  world({ hws: { "phone status": IPHONE } });
  const m = await mount("hws-footer", undefined);
  assert.match(m.text(), /^Settings \| Add machine \| iPhone \| (Active|Idle)$/);
});

test("Pair phone opens the pairing tab and stops checking once a phone pairs", async () => {
  let answer = NO_PHONE;
  const H = world({ hws: { "phone status": () => answer, "phone pair": { opened: "t9" } } });
  const m = await mount("hws-footer", undefined);
  await m.click("phone");
  assert.ok(openArgs(H).some((args) => args.join(" ") === "phone pair --json"));
  const pairing = () => m.timers.filter((t) => t.ms === 3000);
  assert.equal(pairing().length, 1);

  answer = IPHONE;
  await m.fireTimer(3000);
  assert.match(m.text(), /^Settings \| Add machine \| iPhone \| /);
  assert.equal(pairing()[0].cancelled, true);
});

test("the + menu no longer pairs a phone", () => {
  assert.doesNotMatch(read("../hws-actions/main.js"), /phone", "pair"/);
});
