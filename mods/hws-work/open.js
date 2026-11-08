// Opens an output, beside its agent when it is a page and in macOS otherwise.

import { exec, home } from "herdr";
import { opensAsPage, outputTarget, surfaceArgs } from "./data.js";

let found = null;

async function runHws(args) {
  for (const bin of found ? [found] : [`${home()}/.local/bin/hws`, "hws"]) {
    try {
      const r = await exec(bin, [...args, "--json"]);

      // The `hws` script starts through `env`, which exits 126 or 127 when node is missing.
      if (r.code !== 126 && r.code !== 127) {
        found = bin;
        return r;
      }
    } catch {
      // Exec rejects when the program is missing, so the next candidate gets a turn.
    }
  }
  throw new Error("Could not run hws. Expected it at ~/.local/bin/hws or on PATH.");
}

function hwsError(r) {
  try {
    return JSON.parse(r.stdout).error ?? null;
  } catch {
    return r.stderr.trim().split("\n")[0] || null;
  }
}

// Resolves with the parsed output of `hws <args> --json` and throws hws's own message on failure.
export async function hws(args) {
  const r = await runHws(args);
  if (r.code !== 0) throw new Error(hwsError(r) || `hws ${args.slice(0, 2).join(" ")} failed.`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

// Resolves to null on success and to a message on failure.
export async function openOutput(agent, session, ref) {
  const target = outputTarget(ref, session.cwd);
  try {
    if (opensAsPage(ref)) {
      const r = await runHws(surfaceArgs(agent, target));
      return r.code === 0 ? null : hwsError(r) || `Could not open ${ref}`;
    }
    const r = await exec("open", [target]);
    return r.code === 0 ? null : (r.stderr || r.stdout).trim() || `Could not open ${ref}`;
  } catch (e) {
    return String(e?.message ?? e);
  }
}
