import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "hooks", "output-touch.sh");

let dir;
let home;
let nodeBin;
let log;
let folder;
let nodeLog;

// Puts node alone in its own folder, so PATH cannot reach a real hws beside it.
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "hws-touch-")));
  home = join(dir, "home");
  nodeBin = join(dir, "node-bin");
  log = join(dir, "calls.log");
  nodeLog = join(dir, "node.log");
  folder = join(dir, "project");

  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  mkdirSync(nodeBin);
  mkdirSync(folder);

  // This node logs each start, so a test can tell when the shell script never started it.
  writeFileSync(join(nodeBin, "node"), `#!/bin/bash\necho start >> "${nodeLog}"\nexec "${process.execPath}" "$@"\n`);
  chmodSync(join(nodeBin, "node"), 0o755);

  // A fake hws that logs its folder, session and arguments, one line per call.
  const hws = join(home, ".local", "bin", "hws");
  writeFileSync(hws, `#!/bin/bash\necho "$PWD|$CLAUDE_CODE_SESSION_ID|$*" >> "${log}"\necho "loud"\nexit "\${FAKE_EXIT:-0}"\n`);
  chmodSync(hws, 0o755);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const payload = (tool, input, response = {}, extra = {}) =>
  JSON.stringify({ session_id: "sess-1", hook_event_name: "PostToolUse", cwd: folder, tool_name: tool, tool_input: input, tool_response: response, ...extra });

function run(input, { terminal = "t13", bundle = "dev.herdr.app", platform = "darwin", env = {} } = {}) {
  const childEnv = { HOME: home, PATH: `${nodeBin}:/usr/bin:/bin`, HWS_PLATFORM: platform, ...env };
  if (terminal) childEnv.HC_TERMINAL_ID = terminal;
  if (bundle) childEnv.__CFBundleIdentifier = bundle;
  return spawnSync("/bin/bash", [HOOK], { env: childEnv, input, encoding: "utf8", cwd: dir });
}

const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
const nodeStarts = () => (existsSync(nodeLog) ? readFileSync(nodeLog, "utf8").trim().split("\n").length : 0);

function assertSilent(result) {
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
}

describe("output touch hook", () => {
  it("records a new file from Write as created, from the session's folder and with its id", () => {
    const path = join(folder, "docs", "plan.md");
    assertSilent(run(payload("Write", { file_path: path, content: "# Plan" }, { type: "create", filePath: path, content: "# Plan", structuredPatch: [], originalFile: null })));
    assert.deepEqual(calls(), [`${folder}|sess-1|output touch --path ${path} --origin created`]);
  });

  it("counts a Write over a much shorter file as created and any other rewrite as edited", () => {
    const path = join(folder, "page.html");
    run(payload("Write", { file_path: path, content: "x".repeat(10) }, { type: "update", content: "x".repeat(10), originalFile: "x".repeat(4) }));
    run(payload("Write", { file_path: path, content: "x".repeat(10) }, { type: "update", content: "x".repeat(10), originalFile: "x".repeat(5) }));
    run(payload("Write", { file_path: path, content: "x" }, { type: "update", content: "x", originalFile: null }));
    assert.deepEqual(calls().map((line) => line.split(" ").at(-1)), ["created", "edited", "edited"]);
  });

  it("records Edit, MultiEdit and NotebookEdit as edited, reading notebook_path", () => {
    const spec = join(folder, "spec.MDX");
    const report = join(folder, "report.html");
    run(payload("Edit", { file_path: "notes.md", old_string: "a", new_string: "b" }, { filePath: "notes.md", originalFile: "" }));
    run(payload("MultiEdit", { file_path: spec, edits: [] }, { filePath: spec }));
    run(payload("NotebookEdit", { notebook_path: report, new_source: "x" }, { error: "" }));
    assert.deepEqual(calls().map((line) => line.split("|")[2]), [
      "output touch --path notes.md --origin edited",
      `output touch --path ${spec} --origin edited`,
      `output touch --path ${report} --origin edited`,
    ]);
  });

  it("starts no node for a payload without a document path", () => {
    for (const input of [
      payload("Write", { file_path: join(folder, "app.js"), content: "see notes.md" }, { type: "create" }),
      payload("Edit", { file_path: join(folder, "README.md.bak") }),
      "",
    ]) assertSilent(run(input));
    assert.equal(nodeStarts(), 0);
    run(payload("Write", { file_path: join(folder, "a.md") }, { type: "create" }));
    assert.equal(nodeStarts(), 1);
  });

  it("skips a document outside the session folder or under .claude, .feedback or node_modules", () => {
    for (const path of [
      "/abs/a.md",
      join(dir, "sibling.md"),
      "../up.md",
      join(folder, ".claude", "plans", "p.md"),
      join(folder, ".feedback", "outputs", "x.html"),
      join(folder, "web", "node_modules", "pkg", "README.md"),
    ]) assertSilent(run(payload("Write", { file_path: path }, { type: "create" })));
    assert.deepEqual(calls(), []);
    run(payload("Write", { file_path: join(folder, ".claude.md") }, { type: "create" }));
    assert.equal(calls().length, 1);
  });

  it("skips code, a failed tool and a payload it cannot read", () => {
    const md = { file_path: join(folder, "a.md"), content: "x" };
    for (const input of [
      payload("Write", { file_path: join(folder, "app.js"), content: "x" }, { type: "create" }),
      payload("NotebookEdit", { notebook_path: join(folder, "n.ipynb") }),
      payload("Write", md, "Error: permission denied"),
      payload("Write", md, { error: "File has not been read yet" }),
      payload("Edit", md, { success: false }),
      payload("Write", {}, {}),
      "not json",
      "",
    ]) assertSilent(run(input));
    assert.deepEqual(calls(), []);
  });

  it("runs only in a Herdr app terminal", () => {
    const input = payload("Write", { file_path: join(folder, "a.md") }, { type: "create" });
    assertSilent(run(input, { terminal: null }));
    assertSilent(run(input, { bundle: "com.apple.Terminal" }));
    assertSilent(run(input, { bundle: null }));
    assert.deepEqual(calls(), []);
    assertSilent(run(input, { bundle: null, platform: "linux" }));
    assert.equal(calls().length, 1);
  });

  it("stays silent and exits 0 when hws fails or is missing", () => {
    const input = payload("Write", { file_path: join(folder, "a.md") }, { type: "create" });
    assertSilent(run(input, { env: { FAKE_EXIT: "1" } }));
    rmSync(join(home, ".local", "bin", "hws"));
    assertSilent(run(input));
  });

  it("falls back to the hook's own folder when the payload names none that exists", () => {
    const path = join(dir, "a.md");
    run(payload("Write", { file_path: path }, { type: "create" }, { cwd: join(folder, "gone"), session_id: 7 }));
    assert.deepEqual(calls(), [`${dir}||output touch --path ${path} --origin created`]);
  });

  it("knows the same document extensions as hws", () => {
    const script = readFileSync(HOOK, "utf8");
    const core = readFileSync(join(ROOT, "..", "core", "commands", "outputs.js"), "utf8");
    const hook = script.match(/\\\.\(([a-z|]+)\)"'/)[1].split("|");
    const known = [...core.match(/const KIND_BY_EXTENSION = \{([^}]*)\}/)[1].matchAll(/(\w+):/g)].map((m) => m[1]);
    assert.ok(known.length > 0);
    assert.deepEqual(hook.sort(), known.sort());
  });

  it("is registered after Write, Edit, MultiEdit and NotebookEdit with a timeout above its own limits", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
    const [entry] = config.hooks.PostToolUse;
    assert.equal(entry.matcher, "Write|Edit|MultiEdit|NotebookEdit");
    assert.equal(entry.hooks[0].timeout, 5);
    assert.equal(entry.hooks[0].async, true);
    assert.match(entry.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/output-touch\.sh/);
  });
});
