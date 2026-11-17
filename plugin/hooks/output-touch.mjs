import { execFile } from "node:child_process";
import { statSync } from "node:fs";

import { readStdin } from "./stdin.mjs";

// Stdin (1s) and one hws call stay under the 5s timeout in hooks.json.
const HWS_MS = 3000;

// hws decides what counts as a document. This list only spares it a start for every code edit.
const DOCUMENT = /\.(md|markdown|mdx|html?|pdf|docx|pptx|xlsx)$/i;

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isFolder(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// A failed tool reports an error, or a bare string, in place of its result.
function failed(response) {
  if (typeof response === "string") return true;
  if (response === null || typeof response !== "object") return false;
  return response.success === false || response.is_error === true || Boolean(response.error);
}

// Write's result says `type: "create"` for a new file. A rewrite to over twice the old length
// also counts as created, as in Agent Brief. Every other write is an edit.
function originOf(tool, response) {
  if (tool !== "Write" || response === null || typeof response !== "object") return "edited";
  if (response.type === "create") return "created";
  const before = response.originalFile;
  const after = response.content;
  return typeof before === "string" && typeof after === "string" && before.length < after.length / 2 ? "created" : "edited";
}

function hws(args, options) {
  return new Promise((resolve) => {
    execFile("hws", args, { timeout: HWS_MS, killSignal: "SIGKILL", ...options }, () => resolve());
  });
}

async function main() {
  const input = parse(await readStdin());
  const path = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (typeof path !== "string" || !DOCUMENT.test(path)) return;
  if (failed(input.tool_response)) return;

  // hws finds the outputs file from the session id, and counts a relative path from the session's folder.
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  const cwd = typeof input.cwd === "string" && isFolder(input.cwd) ? input.cwd : process.cwd();
  const env = sessionId ? { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId } : process.env;
  await hws(["output", "touch", "--path", path, "--origin", originOf(input.tool_name, input.tool_response)], { cwd, env });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
