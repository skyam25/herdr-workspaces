import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { readStdin } from "./stdin.mjs";

const HWS_MS = 2000;

const REASON = [
  "This file is the workspace's current note, and only a tidy pass may rewrite it, because the pass records what the note covers.",
  "Load the herdr-workspaces:tidy skill and run `hws tidy start --here` to start one in this session.",
  "To add a single dated decision line, use Edit instead.",
].join(" ");

function hws(args) {
  return new Promise((resolve) => {
    execFile("hws", args, { timeout: HWS_MS, killSignal: "SIGKILL" }, (error, stdout) => resolve(error ? null : stdout.trim()));
  });
}

function parse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// The note may not exist yet, so only its folder can be resolved.
function canonical(path) {
  try {
    return join(realpathSync(dirname(path)), basename(path));
  } catch {
    return path;
  }
}

function print(text) {
  return new Promise((done) => process.stdout.write(text, done));
}

async function main() {
  const input = JSON.parse(await readStdin());
  const target = input.tool_input?.file_path;
  if (typeof target !== "string" || target === "") return;

  const place = parse(await hws(["place", "current", "--json"]));
  if (!place?.path || (place.writer && place.writer !== "hws")) return;

  const folder = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  if (canonical(resolve(folder, target)) !== canonical(place.path)) return;

  await print(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: REASON } }));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
