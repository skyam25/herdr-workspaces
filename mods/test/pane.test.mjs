import test from "node:test";
import assert from "node:assert/strict";
import { setup, mount } from "./harness.mjs";

const AGENT = { pane: "p1", terminal: "t1", tab: "tb1", focused: true, app: "claude-code", program: { agent: true, name: "Claude Code", key: "claude" } };
const SHELL = { pane: "p1", terminal: "t1", tab: "tb1", focused: true, program: { shell: true, name: "zsh", key: "zsh" } };
const CHAT_PANE = { pane: "p2", terminal: null, tab: "tb1", focused: true, mod: "hws-chat" };
const parked = (address, chat = "p2") => ({ address, state: "live", labels: { "herdr.chat": chat }, status: "idle", program: AGENT.program });

function world(overrides) {
  const log = [];
  const H = setup({
    terminals: [],
    machines: [{ name: null, layout: "ready" }],
    other: (command, args) => {
      if (command !== "herdr-app") return { code: 0, stdout: "{}", stderr: "" };
      log.push(args[1]);
      if (args[1] === "pane.split") return { code: 0, stdout: '{"pane":"p2"}', stderr: "" };
      if (args[1] === "terminal.keep") return { code: 0, stdout: '{"pending":true,"pane":"p9"}', stderr: "" };
      return { code: 0, stdout: "{}", stderr: "" };
    },
    ...overrides,
  });
  H.hcCalls = [];
  H.log = log;
  return H;
}

const { sweep } = await import("../hws-pane/parked.js");

test("an agent pane shows the switch and a shell pane does not", async () => {
  world({ panes: [AGENT] });
  assert.equal((await mount("hws-pane", { pane: "p1" })).has("ph-mode-p1-chat"), true);

  world({ panes: [SHELL] });
  assert.equal((await mount("hws-pane", { pane: "p1" })).has("ph-mode-p1-chat"), false);
});

test("the workspace panel's pane is titled Workspace", async () => {
  world({ panes: [{ pane: "p3", terminal: null, tab: "tb1", focused: true, mod: "hws-panel", title: "hws-panel" }] });
  const m = await mount("hws-pane", { pane: "p3" });
  assert.match(m.text(), /^Workspace\b/);
  assert.doesNotMatch(m.text(), /hws-panel/);
});

test("a Board pane is titled Board with no folder and keeps its close button", async () => {
  const H = world({ panes: [{ pane: "p3", terminal: null, tab: "tb1", focused: true, mod: "hws-work", title: "Work", cwd: "/w" }] });
  const m = await mount("hws-pane", { pane: "p3" });
  m.view.hovered = true;

  assert.match(m.text(), /^Board\b/);
  assert.doesNotMatch(m.text(), /Work|\/w/);
  assert.equal(m.has("ph-mode-p3-chat"), false);
  assert.equal(m.has("ph-new-p3"), false);
  await m.click("ph-x-p3");
  assert.deepEqual(H.runs, [{ name: "pane.close", args: { pane: "p3" } }]);
});

test("Chat splits the chat, labels the agent, and parks the terminal last", async () => {
  const H = world({ panes: [AGENT] });
  const m = await mount("hws-pane", { pane: "p1" });
  await m.click("ph-mode-p1-chat");

  assert.deepEqual(H.log, ["pane.split", "pane.swap", "terminal.park"]);
  const swap = H.calls.find((c) => c.args[1] === "pane.swap").args;
  assert.deepEqual([swap[swap.indexOf("--pane") + 1], swap[swap.indexOf("--target") + 1]], ["p1", "p2"]);
  const split = H.calls.find((c) => c.args[1] === "pane.split").args;
  assert.equal(split[split.indexOf("--mod") + 1], "hws-chat");
  assert.equal(split[split.indexOf("--props") + 1], '{"terminal":"t1"}');
  assert.deepEqual(H.hcCalls, [["label", "t1", "herdr.chat=p2"]]);
  assert.deepEqual(H.runs, [{ name: "pane.focus", args: { pane: "p2" } }]);
});

test("Terminal restores the pane, clears the label, and closes the chat last", async () => {
  const H = world({ panes: [CHAT_PANE], terminals: [parked("t1")] });
  const m = await mount("hws-pane", { pane: "p2" });
  await m.click("ph-mode-p2-terminal");
  assert.deepEqual(H.log, [], "the chat fades out before the swap");

  await m.fireTimer(120);
  assert.deepEqual(H.log, ["pane.focus", "terminal.keep", "pane.swap", "pane.close"]);
  const swap = H.calls.find((c) => c.args[1] === "pane.swap").args;
  assert.deepEqual([swap[swap.indexOf("--pane") + 1], swap[swap.indexOf("--target") + 1]], ["p2", "p9"]);
  assert.deepEqual(H.hcCalls, [["label", "t1", "herdr.chat="]]);
  assert.deepEqual(H.runs, [{ name: "pane.focus", args: { pane: "p9" } }]);
});

test("the sweep ends a parked agent only after its chat is missing twice", () => {
  const H = world({ panes: [SHELL], terminals: [parked("t9")] });
  sweep();
  assert.deepEqual(H.runs, []);
  sweep();
  assert.deepEqual(H.runs, [{ name: "terminal.kill", args: { terminal: "t9" } }]);
});

test("the sweep waits for a machine's layout to load", () => {
  const H = world({ panes: [SHELL], terminals: [parked("t8")], machines: [{ name: null, layout: "loading" }] });
  sweep();
  sweep();
  assert.deepEqual(H.runs, []);
});

test("the sweep leaves an agent whose chat pane is open", () => {
  const H = world({ panes: [CHAT_PANE], terminals: [parked("t7")] });
  sweep();
  sweep();
  assert.deepEqual(H.runs, []);
});
