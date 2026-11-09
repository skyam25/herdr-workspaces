// Shows a flipped agent's permission requests as cards in hws-chat.
// Files live in <app home>/data/chat-asks, and <id> is <terminal>.<seconds>.<pid>.
//   req/<id>.json   the request from stdin, which the chat turns into a card
//   ans/<id>.json   the chat's decision, printed as it is. An empty file means no decision
//   end/<id>        why the request closed with no answer from the chat
//   open/<terminal> the chat's flag, touched every few seconds and removed on close
// Every path that does not end in a chat answer prints nothing, so Claude keeps its own prompt.

import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readStdin } from "./stdin.mjs";

// The timeout in hooks.json sits above this limit.
const GIVE_UP_MINUTES = 30;
const WAIT_MS = Number(process.env.HWS_ASK_WAIT_MS) || GIVE_UP_MINUTES * 60 * 1000;

const HC_MS = 2000;
const POLL_MS = 250;
const STATUS_EVERY = 4;
const FLAG_STALE_MS = 30000;
const END_KEEP_MS = 24 * 60 * 60 * 1000;

const CHAT_CLOSED = "Chat closed; it waits in the terminal";
const CHAT_LABEL = "herdr.chat";

const terminal = process.env.HC_TERMINAL_ID;
const home = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const asks = join(home, "data", "chat-asks");
const flag = join(asks, "open", terminal);

let files = null;
let leaving = false;

function quiet(action) {
  try {
    return action();
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns the terminal's record, or null when hc fails or times out.
function hcGet() {
  return new Promise((resolve) => {
    execFile("hc", ["get", terminal, "--json"], { timeout: HC_MS, maxBuffer: 1 << 20 }, (error, stdout) => {
      const info = error ? null : quiet(() => JSON.parse(stdout));
      resolve(info && !info.error ? info : null);
    });
  });
}

const chatPane = (info) => info?.labels?.[CHAT_LABEL] || "";
const isLive = (info) => info.exit_code == null && (info.state ?? "live") === "live";
const statusOf = (info) => (typeof info.status === "object" ? info.status?.state : info.status) ?? "";

function print(text) {
  return new Promise((resolve) => process.stdout.write(text, () => resolve()));
}

// Closes the request. Prints a chat decision, or records why there is none.
async function leave(decision = "", how = "") {
  if (leaving) return;
  leaving = true;

  if (decision) await print(decision);

  if (files) {
    if (how) {
      quiet(() => {
        writeFileSync(`${files.end}.tmp`, `${how}\n`);
        renameSync(`${files.end}.tmp`, files.end);
      });
    }
    for (const path of [files.req, `${files.req}.tmp`, files.ans]) quiet(() => rmSync(path, { force: true }));
  }

  process.exit(0);
}

function pruneEnds(folder) {
  for (const name of quiet(() => readdirSync(folder)) ?? []) {
    const path = join(folder, name);
    quiet(() => Date.now() - statSync(path).mtimeMs > END_KEEP_MS && rmSync(path, { force: true }));
  }
}

function flagAge() {
  return quiet(() => Date.now() - statSync(flag).mtimeMs) ?? Infinity;
}

async function waitForAnswer() {
  const started = Date.now();
  let chatSeen = false;
  let prompted = false;
  let blank = false;

  for (let tick = 0; Date.now() - started < WAIT_MS; tick += 1) {
    const text = quiet(() => readFileSync(files.ans, "utf8"));

    // A partial write reads as blank or broken JSON, so a blank file must hold for two polls.
    if (text !== null && text.trim() === "") {
      if (blank) return leave();
      blank = true;
    } else if (text !== null && quiet(() => JSON.parse(text)) !== null) {
      return leave(text);
    }

    if (tick % STATUS_EVERY === 0) {
      // A new chat gets FLAG_STALE_MS to touch its flag for the first time.
      if (flagAge() <= FLAG_STALE_MS) chatSeen = true;
      else if (chatSeen || Date.now() - started > FLAG_STALE_MS) return leave("", CHAT_CLOSED);

      const info = await hcGet();
      if (info) {
        if (!isLive(info)) return leave("", "Agent stopped");
        if (!chatPane(info)) return leave("", CHAT_CLOSED);

        // Claude reports blocked while its own prompt shows, and moves on once that prompt is answered.
        const status = statusOf(info);
        if (status === "blocked") prompted = true;
        else if (prompted && ["working", "idle", "done"].includes(status)) return leave("", "Answered in the terminal");
      }
    }

    await sleep(POLL_MS);
  }

  return leave("", `No answer in ${GIVE_UP_MINUTES} minutes; it waits in the terminal`);
}

async function main() {
  if (terminal.includes("/") || terminal.includes("..")) return;
  if (!chatPane(await hcGet())) return;

  const request = await readStdin();
  if (!request.trim()) return;

  const id = `${terminal}.${Math.floor(Date.now() / 1000)}.${process.pid}`;
  files = {
    req: join(asks, "req", `${id}.json`),
    ans: join(asks, "ans", `${id}.json`),
    end: join(asks, "end", id),
  };

  for (const folder of ["open", "req", "ans", "end"]) mkdirSync(join(asks, folder), { recursive: true });
  pruneEnds(join(asks, "end"));

  // The request can hold file contents and commands, so only this user reads it.
  writeFileSync(`${files.req}.tmp`, request, { mode: 0o600 });
  renameSync(`${files.req}.tmp`, files.req);

  await waitForAnswer();
}

process.stdout.on("error", () => {});

// Claude stops the hook when its own prompt is refused or interrupted.
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => leave("", "Declined or interrupted in the terminal"));
}

main()
  .catch(() => {})
  .finally(() => leave());
