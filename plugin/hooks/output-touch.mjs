import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { hws, parse } from "./hws.mjs";
import { readStdin } from "./stdin.mjs";

// Stdin (1s) and one hws call stay under the 5s timeout in hooks.json.
const HWS_MS = 3000;

// Outputs never lists a file under these folders. core/commands/outputs.js holds the same set.
const SKIP_DIRS = new Set([".claude", ".feedback", "node_modules"]);

function isFolder(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// True for a path inside the session folder and outside every skipped folder.
// hws checks the same, so this only spares it a start.
function listable(folder, path) {
  const ref = relative(realPath(folder), realPath(resolve(folder, path)));
  if (ref === "" || ref === ".." || ref.startsWith(`..${sep}`) || isAbsolute(ref)) return false;
  return !ref.split(sep).slice(0, -1).some((dir) => SKIP_DIRS.has(dir));
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

// output-touch.sh has already checked the document extension.
async function main() {
  const input = parse(await readStdin());
  const path = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (typeof path !== "string" || path === "") return;
  if (failed(input.tool_response)) return;

  // hws finds the outputs file from the session id, and counts a relative path from the session's folder.
  const cwd = typeof input.cwd === "string" && isFolder(input.cwd) ? input.cwd : process.cwd();
  if (!listable(cwd, path)) return;

  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  const env = sessionId ? { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId } : process.env;
  await hws(["output", "touch", "--path", path, "--origin", originOf(input.tool_name, input.tool_response)], { timeout: HWS_MS, cwd, env });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
