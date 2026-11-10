import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "hooks", "session-start.sh");
const STOP_HOOK = join(ROOT, "hooks", "stop.sh");
const SUMMARY = join(ROOT, "scripts", "workspace-summary.sh");

const LINE = "This session is in the app workspace checkout demo at /tmp/checkout.";
const MANIFEST = '{"version":1,"name":"checkout demo","kind":"app"}';
const FOLDER = "/tmp/checkout";
const STDIN = JSON.stringify({ session_id: "sess-1", hook_event_name: "SessionStart", cwd: FOLDER });

const PLACES = {
  current: `${FOLDER}/docs/NEXT-STEPS.md`,
  artifacts: `${FOLDER}/docs`,
  scratch: `${FOLDER}/.herdr-workspace/checkout-1234/scratch`,
  decisions: null,
  history: null,
  meetings: null,
};
const PLACES_SENTENCE =
  "Artifacts land in docs/, drafts in .herdr-workspace/checkout-1234/scratch/, the current note is docs/NEXT-STEPS.md.";
const FRESHNESS = "Current is 3 sessions and 2 artifacts behind, last tidied Nov 3.";

// A fake `hws tidy status --json` body with the given places and line.
function status({ places = PLACES, line = FRESHNESS } = {}) {
  const body = { tidiedAt: null, stage: null, behind: { sessions: 3, artifacts: 2, commits: 0, cards: 0 }, items: [], live: false, places, line };
  return `echo '${JSON.stringify(body)}'`;
}

const REGISTER = `bin register --terminal t13 --session sess-1 --folder ${FOLDER} --json`;
const WORKSPACE_CALLS = [REGISTER, "bin artifact scan --json", "bin current --line", "bin tidy status --json"].sort();
const NOTE_RULE_TEXT = "load the herdr-workspaces:tidy skill";

let dir;
let home;
let nodeBin;
let log;

// Links node alone into its own folder, so PATH cannot reach a real hws beside it.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hws-plugin-"));
  home = join(dir, "home");
  nodeBin = join(dir, "node-bin");
  log = join(dir, "calls.log");

  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  mkdirSync(nodeBin);
  symlinkSync(process.execPath, join(nodeBin, "node"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Writes a stub hws that logs its arguments, then runs the case body for its subcommand.
function stub(
  folder,
  {
    register = "echo '{}'",
    current = `echo '${LINE}'`,
    json = `echo '${MANIFEST}'`,
    tidy = ":",
    scan = ":",
    match = ":",
  } = {},
) {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, "hws");

  writeFileSync(
    path,
    `#!/bin/bash
echo "$(basename "$(dirname "$0")") $*" >> "${log}"
case "$1 $2" in
  "current --line") ${current} ;;
  "current --json") ${json} ;;
  "tidy status") ${tidy} ;;
  "artifact scan") ${scan} ;;
  "space match") ${match} ;;
  register*) ${register} ;;
esac
`,
  );
  chmodSync(path, 0o755);
}

function homeStub(options) {
  stub(join(home, ".local", "bin"), options);
}

function run(script, { input = STDIN, terminal = "t13", path = `${nodeBin}:/usr/bin:/bin`, bundle, platform = "darwin" } = {}) {
  const env = { HOME: home, PATH: path, HWS_PLATFORM: platform };
  if (terminal) env.HC_TERMINAL_ID = terminal;
  if (bundle) env.__CFBundleIdentifier = bundle;

  const started = Date.now();
  const result = spawnSync("/bin/bash", [script], { env, input, encoding: "utf8" });

  return { ...result, elapsed: Date.now() - started };
}

// Sorted, because the hook runs its calls in parallel.
function calls() {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").sort() : [];
}

function assertSilent(result) {
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
}

const HERDR_APP = "dev.herdr.app";
const PHONE =
  'To put a page on the person\'s iPhone or iPad, run `hws phone send FILE --prompt "What to look at"` with an .html or .excalidraw file, then end the turn. Their markup arrives as your next prompt. Agent Brief\'s Outputs panel does not reach the phone. Run `~/.local/bin/hws` if `hws` is not on PATH.';

function contextOf(result) {
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

function assertTaskList(context) {
  for (const text of ["in Tasks", "`hws todo list --json`", '`hws todo add --title="..."`', "lands unassigned", "unless asked"]) {
    assert.ok(context.includes(text), text);
  }
}

const GUARD = join(ROOT, "hooks", "guard-note.sh");

function writeTo(file) {
  return JSON.stringify({ tool_name: "Write", tool_input: { file_path: file }, cwd: FOLDER });
}

describe("current note guard", () => {
  const NOTE = `${FOLDER}/docs/NEXT-STEPS.md`;

  function stubPlace(body) {
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const path = join(home, ".local", "bin", "hws");
    writeFileSync(path, `#!/bin/bash\n${body}\n`);
    chmodSync(path, 0o755);
  }

  it("denies a write to the current note and names the way forward", () => {
    stubPlace(`echo '${JSON.stringify({ role: "current", path: NOTE, writer: null })}'`);
    const output = JSON.parse(run(GUARD, { input: writeTo(NOTE) }).stdout).hookSpecificOutput;

    assert.equal(output.hookEventName, "PreToolUse");
    assert.equal(output.permissionDecision, "deny");
    assert.match(output.permissionDecisionReason, /hws tidy start --here/);
  });

  it("resolves a relative path against the session folder", () => {
    stubPlace(`echo '${JSON.stringify({ role: "current", path: NOTE, writer: null })}'`);
    assert.match(run(GUARD, { input: writeTo("docs/NEXT-STEPS.md") }).stdout, /deny/);
  });

  it("allows every other file", () => {
    stubPlace(`echo '${JSON.stringify({ role: "current", path: NOTE, writer: null })}'`);
    assertSilent(run(GUARD, { input: writeTo(`${FOLDER}/docs/other.md`) }));
  });

  it("allows the note when another tool owns it", () => {
    stubPlace(`echo '${JSON.stringify({ role: "current", path: NOTE, writer: "pmos" })}'`);
    assertSilent(run(GUARD, { input: writeTo(NOTE) }));
  });

  it("allows the write when hws fails or no terminal is set", () => {
    stubPlace("exit 1");
    assertSilent(run(GUARD, { input: writeTo(NOTE) }));
    assertSilent(run(GUARD, { input: writeTo(NOTE), terminal: "" }));
  });
});

describe("session-start hook", () => {
  it("registers the session and returns the line as context", () => {
    homeStub();
    const result = run(HOOK);

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: LINE },
    });
    assert.deepEqual(calls(), WORKSPACE_CALLS);
  });

  it("adds the places and freshness sentences after the line", () => {
    homeStub({ tidy: status() });

    const [first, rule] = contextOf(run(HOOK)).split("\n\n");
    assert.equal(first, `${LINE} ${PLACES_SENTENCE} ${FRESHNESS}`);
    assert.ok(rule.includes(NOTE_RULE_TEXT));
    assert.ok(rule.includes("Never rewrite the current note yourself"));
  });

  it("lists what the workspace tracks and counts what it does not", () => {
    const tracked = [
      { id: "a1", type: "link", title: "Live story", path: "https://claude.ai/artifact/x", status: "current" },
      { id: "a2", type: "file", title: "Old", path: "/w/old.html", status: "superseded" },
    ];
    const candidates = [{ kind: "file", path: "/w/deck.pptx" }, { kind: "link", url: "https://claude.ai/artifact/y" }];
    homeStub({ tidy: status(), scan: `echo '${JSON.stringify({ tracked, candidates, more: 1 })}'` });

    const context = contextOf(run(HOOK));
    assert.ok(context.includes("- Live story (link, id a1): https://claude.ai/artifact/x"));
    assert.ok(!context.includes("/w/old.html"));
    assert.ok(context.includes("3 existing files and links look like this workspace's work"));
  });

  it("gives no note rule outside a kept workspace", () => {
    homeStub({ tidy: status({ places: { current: null, artifacts: null, scratch: null } }) });
    assert.ok(!contextOf(run(HOOK)).includes(NOTE_RULE_TEXT));
  });

  it("keeps the task list paragraph after the new sentences", () => {
    homeStub({ tidy: status() });

    const context = contextOf(run(HOOK, { bundle: HERDR_APP }));
    assert.ok(context.startsWith(`${LINE} ${PLACES_SENTENCE} ${FRESHNESS}\n\n`));
    assertTaskList(context);
  });

  it("names only the places that are set", () => {
    homeStub({ tidy: status({ places: { ...PLACES, artifacts: null, current: "/elsewhere/CURRENT.md" }, line: "" }) });

    assert.equal(
      contextOf(run(HOOK)).split("\n\n")[0],
      `${LINE} Drafts land in .herdr-workspace/checkout-1234/scratch/, the current note is /elsewhere/CURRENT.md.`,
    );
  });

  it("gives the freshness line alone when no place is set", () => {
    homeStub({ tidy: status({ places: { current: null, artifacts: null, scratch: null } }) });
    assert.equal(contextOf(run(HOOK)), `${LINE} ${FRESHNESS}`);
  });

  for (const [name, tidy] of [
    ["status prints nothing", ":"],
    ["places and line are empty", status({ places: {}, line: "" })],
    ["places is null and line is missing", `echo '{"places":null}'`],
    ["status fails", "echo oops >&2; exit 1"],
    ["status prints malformed JSON", "echo '{not json'"],
  ]) {
    it(`leaves out the new sentences when ${name}`, () => {
      homeStub({ tidy });
      assert.equal(contextOf(run(HOOK)), LINE);
    });
  }

  it("skips tidy status outside a workspace", () => {
    homeStub({ current: ":", tidy: status() });

    assertSilent(run(HOOK));
    assert.deepEqual(calls(), [REGISTER, "bin current --line", "bin space match --json"].sort());
  });

  const matchBody = (...names) =>
    `echo '${JSON.stringify({ space: "sp1", folder: FOLDER, candidates: names.map((name, index) => ({ id: `w${index}`, name, folder: FOLDER, home: null })) })}'`;

  it("names the workspace that owns this folder when the space is not in it", () => {
    homeStub({ current: ":", match: matchBody("checkout demo") });

    assert.equal(
      contextOf(run(HOOK, { bundle: HERDR_APP })),
      `${PHONE}\n\n` +
      'This folder belongs to the Herdr workspace "checkout demo", but this space is not part of it, so its instructions and task list do not apply here. The person can add this space from the Workspace panel. Mention this only if the person asks about the workspace, its task list or its notes, and do not act on it yourself.',
    );
    assert.deepEqual(calls(), [REGISTER, "bin current --line", "bin space match --json"].sort());
  });

  it("names up to three owning workspaces and counts the rest", () => {
    homeStub({ current: ":", match: matchBody("one", "two", "three", "four") });

    const context = contextOf(run(HOOK));
    assert.ok(context.startsWith('This folder belongs to the Herdr workspaces "one", "two", "three" and 1 more, but this space is not part of any of them, so their instructions'), context);
    assert.ok(!context.includes("four"));
  });

  it("joins two owning workspaces with and", () => {
    homeStub({ current: ":", match: matchBody("one", "two") });
    assert.ok(contextOf(run(HOOK)).startsWith('This folder belongs to the Herdr workspaces "one" and "two", but'));
  });

  for (const [name, match] of [
    ["has no candidates", matchBody()],
    ["fails", "echo oops >&2; exit 1"],
    ["prints malformed JSON", "echo '{not json'"],
  ]) {
    it(`stays silent outside a workspace when space match ${name}`, () => {
      homeStub({ current: ":", match });
      assertSilent(run(HOOK));
    });
  }

  it("stays silent when space match hangs, within the hook's budget", () => {
    homeStub({ current: ":", match: "sleep 8" });
    const result = run(HOOK);

    assertSilent(result);
    assert.ok(result.elapsed < 5000, `took ${result.elapsed}ms`);
  });

  it("skips space match inside a workspace and when current fails", () => {
    homeStub({ match: matchBody("checkout demo") });
    assert.equal(contextOf(run(HOOK)), LINE);
    assert.ok(!calls().includes("bin space match --json"));

    rmSync(log, { force: true });
    homeStub({ current: "echo oops >&2; exit 1", match: matchBody("checkout demo") });
    assertSilent(run(HOOK));
    assert.ok(!calls().includes("bin space match --json"));
  });

  it("never calls hws place, which creates folders", () => {
    homeStub({ tidy: status() });
    run(HOOK);

    assert.ok(!calls().some((call) => call.startsWith("bin place")));
  });

  it("returns the line when tidy status hangs", () => {
    homeStub({ tidy: "sleep 8" });
    const result = run(HOOK);

    assert.equal(contextOf(result), LINE);
    assert.ok(result.elapsed < 4000, `took ${result.elapsed}ms`);
  });

  it("adds the task list paragraph after the line in a Herdr app terminal", () => {
    homeStub();
    const context = contextOf(run(HOOK, { bundle: HERDR_APP }));

    assert.ok(context.startsWith(`${LINE}\n\n`));
    assertTaskList(context);
  });

  it("teaches the review command after the task list in a Herdr app terminal", () => {
    homeStub();
    const context = contextOf(run(HOOK, { bundle: HERDR_APP }));

    assert.ok(context.endsWith("To show the person a page or document for comments, run `hws review FILE` with an .html or .md file, then end the turn. It opens beside this agent, and their comments arrive as your next prompt. Never open it with --standalone, because that pane has no agent to answer." + `\n\n${PHONE}`));
    assert.ok(!contextOf(run(HOOK)).includes("hws review"));
  });

  it("teaches only the phone outside a workspace in a Herdr app terminal", () => {
    homeStub({ current: ":" });
    assert.equal(contextOf(run(HOOK, { bundle: HERDR_APP })), PHONE);
  });

  it("leaves out the paragraph in another app's terminal", () => {
    homeStub();
    assert.equal(contextOf(run(HOOK, { bundle: "com.apple.Terminal" })), LINE);
  });

  it("treats a terminal id as Herdr on Linux, where no bundle id exists", () => {
    homeStub();
    const context = contextOf(run(HOOK, { platform: "linux" }));

    assert.ok(context.startsWith(`${LINE}\n\n`));
    assertTaskList(context);
  });

  it("stays silent in a Herdr app with no terminal id", () => {
    homeStub();
    assertSilent(run(HOOK, { bundle: HERDR_APP, terminal: "" }));
  });

  it("stays silent and skips hws with no terminal id", () => {
    homeStub();
    assertSilent(run(HOOK, { terminal: "" }));
    assert.deepEqual(calls(), []);
  });

  it("stays silent in a normal terminal, where the line is empty", () => {
    homeStub({ current: ":" });
    assertSilent(run(HOOK));
  });

  it("stays silent when hws is missing", () => {
    assertSilent(run(HOOK));
  });

  it("stays silent when node is missing", () => {
    homeStub();
    assertSilent(run(HOOK, { path: "/usr/bin:/bin" }));
    assert.deepEqual(calls(), []);
  });

  it("still returns the line when register fails", () => {
    homeStub({ register: `echo '{"error":"no such terminal"}'; exit 1` });
    const result = run(HOOK);

    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, LINE);
    assert.deepEqual(calls(), WORKSPACE_CALLS);
  });

  it("stays silent when current fails", () => {
    homeStub({ current: "echo oops >&2; exit 1" });
    assertSilent(run(HOOK));
  });

  it("stops waiting on a hung hws", () => {
    homeStub({ register: "sleep 8", current: "sleep 8" });
    const result = run(HOOK);

    assertSilent(result);
    assert.ok(result.elapsed < 5000, `took ${result.elapsed}ms`);
  });

  for (const [name, input] of [
    ["malformed JSON", "{not json"],
    ["empty stdin", ""],
    ["a JSON null", "null"],
    ["no session id", '{"cwd":"/tmp"}'],
    ["a non-string session id", '{"session_id":42}'],
  ]) {
    it(`stays silent and skips hws on ${name}`, () => {
      homeStub();
      assertSilent(run(HOOK, { input }));
      assert.deepEqual(calls(), []);
    });
  }

  it("prefers ~/.local/bin over PATH", () => {
    homeStub();
    stub(join(dir, "elsewhere"));
    run(HOOK, { path: `${join(dir, "elsewhere")}:${nodeBin}:/usr/bin:/bin` });

    assert.deepEqual(new Set(calls().map((call) => call.split(" ")[0])), new Set(["bin"]));
  });

  it("falls back to PATH", () => {
    stub(join(dir, "elsewhere"));
    const result = run(HOOK, { path: `${join(dir, "elsewhere")}:${nodeBin}:/usr/bin:/bin` });

    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, LINE);
    assert.deepEqual(new Set(calls().map((call) => call.split(" ")[0])), new Set(["elsewhere"]));
  });

  it("sets a timeout above the script's own limits", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
    const [hook] = config.hooks.SessionStart[0].hooks;

    assert.equal(hook.timeout, 6);
    assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  });
});

describe("stop hook", () => {
  const stopInput = (message) => JSON.stringify({ hook_event_name: "Stop", last_assistant_message: message });

  function expectCapture() {
    const dir = join(home, ".local", "state", "herdr-workspaces", "capture");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "t13"), "");
  }

  it("skips a terminal with nothing to report", () => {
    homeStub();
    assertSilent(run(STOP_HOOK, { input: stopInput("Changed the token check") }));
    assert.deepEqual(calls(), []);
  });

  it("copies the closing message to the board", () => {
    homeStub();
    expectCapture();
    const result = run(STOP_HOOK, { input: stopInput("-Changed the token check") });

    assertSilent(result);
    assert.deepEqual(calls(), ["bin todo capture --terminal t13 --text=-Changed the token check --json"]);
  });

  it("does nothing without a message or outside Herdr", () => {
    homeStub();
    expectCapture();
    assertSilent(run(STOP_HOOK, { input: JSON.stringify({ hook_event_name: "Stop" }) }));
    assertSilent(run(STOP_HOOK, { input: stopInput("done"), terminal: null }));
    assertSilent(run(STOP_HOOK, { input: "not json" }));
    assert.deepEqual(calls(), []);
  });

  it("sets a timeout above the script's own limits", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
    const [hook] = config.hooks.Stop[0].hooks;

    assert.equal(hook.timeout, 5);
    assert.match(hook.command, /stop\.sh/);
  });
});

describe("workspace summary", () => {
  it("prints the manifest in a workspace", () => {
    homeStub();
    const result = run(SUMMARY);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), MANIFEST);
  });

  it("explains a session outside Herdr", () => {
    assert.match(run(SUMMARY, { terminal: "" }).stdout, /not running in a Herdr terminal/);
  });

  it("explains a normal terminal", () => {
    homeStub({ current: ":" });
    assert.match(run(SUMMARY).stdout, /normal Herdr tab/);
  });

  it("explains a missing hws", () => {
    assert.match(run(SUMMARY).stdout, /not installed/);
  });

  for (const [name, options] of [
    ["the line", { current: "exit 1" }],
    ["the manifest", { json: "exit 1" }],
  ]) {
    it(`explains a failure reading ${name}`, () => {
      homeStub(options);
      const result = run(SUMMARY);

      assert.equal(result.status, 0);
      assert.match(result.stdout, /could not read/);
    });
  }
});
