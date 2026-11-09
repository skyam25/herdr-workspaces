import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { allow, answers, deny, words } from "../../mods/hws-chat/core/asks.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "hooks", "ask-hook.sh");
const BODY = join(ROOT, "hooks", "ask-hook.mjs");

const TERMINAL = "t13";
const BASH_REQUEST = { tool_name: "Bash", tool_input: { command: "touch made.txt" }, cwd: "/tmp/x" };
const QUESTION_REQUEST = {
  tool_name: "AskUserQuestion",
  tool_input: { questions: [{ question: "Which one?", options: ["A", "B"] }] },
};

let dir;
let home;
let bin;
let nodeBin;
let state;
let log;
let chatAsks;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, ms = 6000) {
  const end = Date.now() + ms;

  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await sleep(20);
  }

  assert.fail(`timed out waiting for ${label}`);
}

function writeFake(script) {
  const path = join(bin, "hc");

  writeFileSync(path, script);
  chmodSync(path, 0o755);
}

function setTerminal(record) {
  writeFileSync(`${state}.tmp`, JSON.stringify(record));
  renameSync(`${state}.tmp`, state);
}

const flipped = (extra = {}) => ({ address: TERMINAL, state: "live", status: "working", labels: { "herdr.chat": "p9" }, exit_code: null, ...extra });

function hcCalls() {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}

function folder(name) {
  const path = join(chatAsks, name);

  return existsSync(path) ? readdirSync(path) : [];
}

function touchFlag() {
  mkdirSync(join(chatAsks, "open"), { recursive: true });
  const path = join(chatAsks, "open", TERMINAL);

  writeFileSync(path, "");
  utimesSync(path, new Date(), new Date());
}

function start({ env = {}, request = BASH_REQUEST, bundle = "dev.herdr.app", terminal = TERMINAL } = {}) {
  const started = Date.now();
  const childEnv = {
    HOME: home,
    PATH: `${bin}:${nodeBin}:/usr/bin:/bin`,
    HERDR_APP_HOME: join(dir, "app"),
    HC_STATE: state,
    HC_LOG: log,
    ...env,
  };

  childEnv.HWS_PLATFORM ??= "darwin";
  if (bundle) childEnv.__CFBundleIdentifier = bundle;
  if (terminal) childEnv.HC_TERMINAL_ID = terminal;

  const child = spawn("/bin/bash", [HOOK], { env: childEnv });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.on("error", () => {});
  child.stdin.end(typeof request === "string" ? request : JSON.stringify(request));

  const finished = new Promise((resolve) => {
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr, elapsed: Date.now() - started }));
  });

  return { child, finished };
}

async function waitingRequest() {
  const name = await until(() => folder("req").find((file) => file.endsWith(".json")), "the request file");

  return name.slice(0, -".json".length);
}

function answer(id, text) {
  writeFileSync(join(chatAsks, "ans", `${id}.json`), text);
}

function endLine(id) {
  return readFileSync(join(chatAsks, "end", id), "utf8").trim();
}

function assertSilent(result) {
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
}

function assertNoFilesLeft() {
  assert.deepEqual(folder("req"), []);
  assert.deepEqual(folder("ans"), []);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hws-ask-hook-"));
  home = join(dir, "home");
  bin = join(dir, "bin");
  nodeBin = join(dir, "node-bin");
  state = join(dir, "terminal.json");
  log = join(dir, "hc.log");
  chatAsks = join(dir, "app", "data", "chat-asks");

  mkdirSync(home);
  mkdirSync(bin);
  mkdirSync(nodeBin);
  symlinkSync(process.execPath, join(nodeBin, "node"));

  writeFake(`#!/bin/sh\necho "$*" >> "$HC_LOG"\ncat "$HC_STATE"\n`);
  setTerminal(flipped());
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ask hook gate", () => {
  for (const [name, options] of [
    ["outside the Herdr app", { bundle: "" }],
    ["in another app", { bundle: "com.apple.Terminal" }],
    ["with no terminal id", { terminal: "" }],
  ]) {
    it(`does nothing ${name}`, async () => {
      const result = await start(options).finished;

      assertSilent(result);
      assert.ok(result.elapsed < 2000, `took ${result.elapsed}ms`);
      assert.deepEqual(hcCalls(), []);
      assert.equal(existsSync(chatAsks), false);
    });
  }

  it("passes the gate on Linux with only a terminal id", async () => {
    setTerminal(flipped({ labels: { "herdr.chat": "" } }));
    assertSilent(await start({ bundle: "", env: { HWS_PLATFORM: "linux" } }).finished);

    assert.deepEqual(hcCalls(), [`get ${TERMINAL} --json`]);
  });

  it("does nothing in a Herdr terminal that is not flipped", async () => {
    setTerminal(flipped({ labels: { "herdr.chat": "" } }));
    assertSilent(await start().finished);

    assert.deepEqual(hcCalls(), [`get ${TERMINAL} --json`]);
    assert.equal(existsSync(chatAsks), false);
  });

  it("does nothing in a terminal with no labels", async () => {
    setTerminal(flipped({ labels: null }));
    assertSilent(await start().finished);
    assert.equal(existsSync(chatAsks), false);
  });

  it("does nothing when hc fails", async () => {
    writeFake("#!/bin/sh\nexit 1\n");
    assertSilent(await start().finished);
    assert.equal(existsSync(chatAsks), false);
  });

  it("stops waiting on a hung hc", async () => {
    writeFake("#!/bin/sh\nexec sleep 8\n");
    const result = await start().finished;

    assertSilent(result);
    assert.ok(result.elapsed < 5000, `took ${result.elapsed}ms`);
  });

  it("refuses a terminal id that leaves the folder", async () => {
    assertSilent(await start({ terminal: "../evil" }).finished);
    assert.deepEqual(hcCalls(), []);
  });

  it("ignores an empty request", async () => {
    assertSilent(await start({ request: "" }).finished);
    assert.deepEqual(folder("req"), []);
  });
});

describe("ask hook answers", () => {
  it("names the request by terminal, time and live pid, and keeps stdin exact", async () => {
    touchFlag();
    const raw = `${JSON.stringify(BASH_REQUEST)}\n`;
    const { child, finished } = start({ request: raw });
    const id = await waitingRequest();

    assert.match(id, new RegExp(`^${TERMINAL}\\.\\d{10}\\.${child.pid}$`));
    assert.equal(readFileSync(join(chatAsks, "req", `${id}.json`), "utf8"), raw);

    answer(id, allow());
    await finished;
  });

  for (const [name, request, decision] of [
    ["allow", BASH_REQUEST, () => allow()],
    ["deny", BASH_REQUEST, () => deny()],
    ["a question's answers", QUESTION_REQUEST, () => answers(QUESTION_REQUEST, { "Which one?": "B" })],
  ]) {
    it(`prints ${name} from the chat and cleans up`, async () => {
      touchFlag();
      const { finished } = start({ request });
      const id = await waitingRequest();

      answer(id, decision());
      const result = await finished;

      assert.equal(result.status, 0);
      assert.deepEqual(JSON.parse(result.stdout), JSON.parse(decision()));
      assertNoFilesLeft();
    });
  }

  it("makes no decision on an empty answer", async () => {
    touchFlag();
    const { finished } = start();
    const id = await waitingRequest();

    answer(id, "");
    assertSilent(await finished);
    assertNoFilesLeft();
  });

  it("waits past a half-written answer", async () => {
    touchFlag();
    const { child, finished } = start();
    const id = await waitingRequest();

    answer(id, '{"hookSpecificOutput":');
    await sleep(600);
    assert.equal(child.exitCode, null);

    answer(id, allow());
    assert.deepEqual(JSON.parse((await finished).stdout), JSON.parse(allow()));
  });

  it("shows an unknown tool as a card and decides nothing", async () => {
    touchFlag();
    const request = { tool_name: "FrobnicateTool", tool_input: { a: 1 } };
    const { finished } = start({ request, env: { HWS_ASK_WAIT_MS: "900" } });
    const id = await waitingRequest();
    const seen = JSON.parse(readFileSync(join(chatAsks, "req", `${id}.json`), "utf8"));

    assert.equal(words(seen).kind, "permission");
    assert.equal(words(seen).title, "Use FrobnicateTool");
    assertSilent(await finished);
  });
});

describe("ask hook releases", () => {
  it("gives up after its limit and keeps its own prompt", async () => {
    touchFlag();
    const { finished } = start({ env: { HWS_ASK_WAIT_MS: "900" } });
    const id = await waitingRequest();

    assertSilent(await finished);
    assert.match(endLine(id), /No answer in 30 minutes/);
    assertNoFilesLeft();
  });

  it("releases when the chat flips back to the terminal", async () => {
    touchFlag();
    const { finished } = start();
    const id = await waitingRequest();

    setTerminal(flipped({ labels: { "herdr.chat": "" } }));
    assertSilent(await finished);
    assert.match(endLine(id), /Chat closed/);
    assertNoFilesLeft();
  });

  it("releases when the chat removes its flag", async () => {
    touchFlag();
    const { finished } = start();
    const id = await waitingRequest();

    await until(() => hcCalls().length >= 2, "the first status check");
    rmSync(join(chatAsks, "open", TERMINAL));

    assertSilent(await finished);
    assert.match(endLine(id), /Chat closed/);
    assertNoFilesLeft();
  });

  it("still waits for a chat that has not touched its flag yet", async () => {
    const { child, finished } = start();
    const id = await waitingRequest();

    await sleep(600);
    assert.equal(child.exitCode, null);

    answer(id, allow());
    assert.deepEqual(JSON.parse((await finished).stdout), JSON.parse(allow()));
  });

  it("releases when the agent's terminal ends", async () => {
    touchFlag();
    const { finished } = start();
    const id = await waitingRequest();

    setTerminal(flipped({ state: "exited", exit_code: 0 }));
    assertSilent(await finished);
    assert.equal(endLine(id), "Agent stopped");
    assertNoFilesLeft();
  });

  it("closes the card when the terminal answers the prompt", async () => {
    touchFlag();
    const { finished } = start();
    const id = await waitingRequest();

    setTerminal(flipped({ status: "blocked" }));
    const seen = hcCalls().length;
    await until(() => hcCalls().length > seen, "a status check while blocked");

    setTerminal(flipped({ status: { state: "working" } }));
    assertSilent(await finished);
    assert.equal(endLine(id), "Answered in the terminal");
    assertNoFilesLeft();
  });

  it("ignores working status before the prompt shows", async () => {
    touchFlag();
    const { child, finished } = start();
    const id = await waitingRequest();

    await until(() => hcCalls().length >= 3, "two status checks");
    assert.equal(child.exitCode, null);

    answer(id, allow());
    await finished;
  });

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    it(`cleans up when ${signal} stops it`, async () => {
      touchFlag();
      const { child, finished } = start();
      const id = await waitingRequest();

      child.kill(signal);
      assertSilent(await finished);
      assert.match(endLine(id), /Declined or interrupted/);
      assertNoFilesLeft();
    });
  }

  it("prunes end files older than a day", async () => {
    touchFlag();
    mkdirSync(join(chatAsks, "end"), { recursive: true });
    const old = join(chatAsks, "end", "t1.1.1");
    const recent = join(chatAsks, "end", "t1.2.2");

    writeFileSync(old, "x");
    writeFileSync(recent, "x");
    utimesSync(old, new Date(0), new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

    const { finished } = start();
    const id = await waitingRequest();

    assert.equal(existsSync(old), false);
    assert.equal(existsSync(recent), true);

    answer(id, allow());
    await finished;
  });
});

describe("ask hook registration", () => {
  it("runs on every permission request with a timeout above the give-up", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
    const [entry] = config.hooks.PermissionRequest;
    const [hook] = entry.hooks;
    const minutes = Number(/GIVE_UP_MINUTES = (\d+)/.exec(readFileSync(BODY, "utf8"))[1]);

    assert.equal(entry.matcher, undefined);
    assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/ask-hook\.sh/);
    assert.ok(hook.timeout > minutes * 60, `timeout ${hook.timeout}s against ${minutes} minutes`);
  });
});
