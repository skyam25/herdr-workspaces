import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIND } from "../hws-chat/core/chat-log.js";

const hasSqlite = spawnSync("sqlite3", ["-version"]).status === 0;

function check(name, makeRows, expected) {
  test(name, { skip: !hasSqlite }, async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "hws-codex-")));
    const work = join(home, "work");
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(work);

    const inserts = makeRows(work, Date.now()).map(([path, cwd, originator, at]) => `insert into threads values('${path}','${cwd}','${originator}',${at});`).join("");
    execFileSync("sqlite3", [join(home, ".codex/state_5.sqlite"), `create table threads(rollout_path, cwd, originator, created_at_ms);${inserts}`]);

    const agent = spawn("sleep", ["30"], { cwd: work, stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 150));
      const found = execFileSync("sh", ["-c", FIND, "chat", "codex", String(agent.pid)], { encoding: "utf8", env: { ...process.env, HOME: home } }).trim();
      assert.equal(found, expected);
    } finally {
      agent.kill();
      rmSync(home, { recursive: true, force: true });
    }
  });
}

check("one session in the folder since the process began is the match", (cwd, now) => [["/log/new.jsonl", cwd, "codex-tui", now]], "/log/new.jsonl");
check("no session yet waits", () => [], "pending");
check("an older session doesn't count", (cwd, now) => [["/log/old.jsonl", cwd, "codex-tui", now - 3600000]], "pending");
check("a session from another folder doesn't count", (_cwd, now) => [["/log/x.jsonl", "/elsewhere", "codex-tui", now]], "pending");
check("a session from another Codex app doesn't count", (cwd, now) => [["/log/x.jsonl", cwd, "codex_vscode", now]], "pending");
check("two candidates show nothing rather than guess", (cwd, now) => [["/log/a.jsonl", cwd, "codex-tui", now], ["/log/b.jsonl", cwd, "codex-tui", now]], "");
