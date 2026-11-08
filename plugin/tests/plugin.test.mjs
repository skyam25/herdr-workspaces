import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "hooks", "session-start.sh");
const SUMMARY = join(ROOT, "scripts", "workspace-summary.sh");

const LINE = "This session is in the app workspace checkout demo at /tmp/checkout.";
const MANIFEST = '{"version":1,"name":"checkout demo","kind":"app"}';
const STDIN = JSON.stringify({ session_id: "sess-1", hook_event_name: "SessionStart" });

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
function stub(folder, { register = "echo '{}'", current = `echo '${LINE}'`, json = `echo '${MANIFEST}'` } = {}) {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, "hws");

  writeFileSync(
    path,
    `#!/bin/bash
echo "$(basename "$(dirname "$0")") $*" >> "${log}"
case "$1 $2" in
  "current --line") ${current} ;;
  "current --json") ${json} ;;
  register*) ${register} ;;
esac
`,
  );
  chmodSync(path, 0o755);
}

function homeStub(options) {
  stub(join(home, ".local", "bin"), options);
}

function run(script, { input = STDIN, terminal = "t13", path = `${nodeBin}:/usr/bin:/bin` } = {}) {
  const env = { HOME: home, PATH: path };
  if (terminal) env.HC_TERMINAL_ID = terminal;

  const started = Date.now();
  const result = spawnSync("/bin/bash", [script], { env, input, encoding: "utf8" });

  return { ...result, elapsed: Date.now() - started };
}

function calls() {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}

function assertSilent(result) {
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
}

describe("session-start hook", () => {
  it("registers the session and returns the line as context", () => {
    homeStub();
    const result = run(HOOK);

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: LINE },
    });
    assert.deepEqual(calls(), ["bin register --terminal t13 --session sess-1 --json", "bin current --line"]);
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
    assert.deepEqual(calls(), ["bin register --terminal t13 --session sess-1 --json", "bin current --line"]);
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

    assert.deepEqual(calls().map((call) => call.split(" ")[0]), ["bin", "bin"]);
  });

  it("falls back to PATH", () => {
    stub(join(dir, "elsewhere"));
    const result = run(HOOK, { path: `${join(dir, "elsewhere")}:${nodeBin}:/usr/bin:/bin` });

    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, LINE);
    assert.deepEqual(calls().map((call) => call.split(" ")[0]), ["elsewhere", "elsewhere"]);
  });

  it("sets a timeout above the script's own limits", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
    const [hook] = config.hooks.SessionStart[0].hooks;

    assert.equal(hook.timeout, 6);
    assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
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
