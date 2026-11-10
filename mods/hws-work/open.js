// Opens outputs and agent sessions. A page opens beside its agent and other outputs open in macOS.

import { exec, home, panes, run, spaces, terminals, window } from "herdr";
import { locateTerminal, opensAsPage, outputTarget, surfaceArgs } from "./data.js";

let found = null;

// Page surfaces this panel opened, keyed by agent and file.
const pagePanes = new Map();

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

// A surface opens in its agent's tab, so that tab must be showing to see it.
function showPane(tab, pane) {
  const owner = spaces().find((s) => s.tabs.some((x) => x.id === tab));
  if (owner && !owner.active) run("space.select", { id: owner.id });
  const active = (owner ?? spaces().find((s) => s.active))?.tabs.find((x) => x.active)?.id;
  if (tab && tab !== active) run("tab.select", { id: tab });
  if (pane) run("pane.focus", { pane });
}

// Selects the agent's tab when another is active, then focuses its terminal or chat pane.
export function focusAgent(agent) {
  showPane(agent.tab, agent.chatPane);
  if (!agent.chatPane) run("pane.focus", { terminal: agent.address });
}

// A worker has no pane until one is opened, so peek stands in for focus.
export function openSession(address) {
  const seat = locateTerminal({ panes: panes(), terminals: terminals() }, address);
  if (seat) focusAgent({ address, ...seat });
  else run("terminal.peek", { terminal: address });
}

function openedPane(r) {
  try {
    return JSON.parse(r.stdout).pane ?? null;
  } catch {
    return null;
  }
}

async function openPage(agent, target, ref) {
  const key = `${agent.address} ${target}`;
  const existing = panes().find((p) => p.pane === pagePanes.get(key));
  if (existing) {
    showPane(existing.tab, existing.pane);
    return null;
  }
  const r = await runHws(surfaceArgs(agent, target));
  if (r.code !== 0) return hwsError(r) || `Could not open ${ref}`;
  const pane = openedPane(r);
  if (pane) pagePanes.set(key, pane);
  showPane(agent.tab, pane);
  return null;
}

// Resolves to null on success and to a message on failure.
export async function openOutput(agent, folder, ref) {
  const target = outputTarget(ref, folder);
  try {
    if (opensAsPage(ref)) return await openPage(agent, target, ref);
    const r = await exec(window()?.platform === "linux" ? "xdg-open" : "open", [target]);
    return r.code === 0 ? null : (r.stderr || r.stdout).trim() || `Could not open ${ref}`;
  } catch (e) {
    return String(e?.message ?? e);
  }
}
