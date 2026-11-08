// Cleans up agents parked behind a chat pane, known by the core label herdr.chat=<chat pane>.
// When that pane goes, the agent ends, as closing its own pane would have ended it.
// A machine counts only once its layout has loaded, and a pane must be missing twice in a row.

import { machines, run, hc } from "herdr";
import { panes, terminals } from "./live.js";

export const LABEL = "herdr.chat";

const missing = new Set();
const kept = new Set();

// Parking turns core keep off, so this turns it back on.
async function keepOn(address) {
  kept.add(address);
  try {
    const t = JSON.parse((await hc(["get", address, "--json"])).stdout);
    if (t.keep === false) await hc(["keep", address]);
  } catch {
    kept.delete(address);
  }
}

export function sweep() {
  const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? ""));
  const have = new Set(panes().map((p) => p.pane));
  const own = new Set(panes().map((p) => p.terminal).filter(Boolean));

  for (const k of terminals()) {
    const chat = k.labels?.[LABEL];
    if (!chat || k.state !== "live") { kept.delete(k.address); continue; }

    const machine = k.address.includes("/") ? k.address.split("/")[0] : "";
    if (!ready.has(machine) || have.has(chat) || own.has(k.address)) {
      missing.delete(k.address);
      if (have.has(chat) && !own.has(k.address) && !kept.has(k.address)) keepOn(k.address);
      continue;
    }

    if (!missing.has(k.address)) { missing.add(k.address); continue; }
    missing.delete(k.address);
    run("terminal.kill", { terminal: k.address });
  }
}
