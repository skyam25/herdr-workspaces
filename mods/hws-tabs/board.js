// Finds or opens the Board. A workspace may have one Board space, and a plain space a Board tab.
// hws-work runs as a pane only on a Board, because the right panel holds it in a layout block
// and panes() lists tab panes.
// hws-tabs and hws-actions hold identical copies, and a test compares them.

import { exec, home, notify, spaces, panes, run } from "herdr";

export const WORKSPACE_BOARD_TAB = "Workspace board";

export function boardTab(space, paneList) {
  return space?.tabs.find((tab) => paneList.some((p) => p.tab === tab.id && p.mod === "hws-work")) ?? null;
}

async function workspaceBoard(space) {
  for (const bin of [`${home()}/.local/bin/hws`, "hws"]) {
    try {
      const r = await exec(bin, ["board", "open", "--space", space.id, "--json"]);
      if (r.code === 0) return JSON.parse(r.stdout);
    } catch {
      // Exec rejects when the program is missing, so the next candidate gets a turn.
    }
  }
  return null;
}

export async function openBoard() {
  const space = spaces().find((s) => s.active);
  const local = boardTab(space, panes());
  if (local) {
    run("tab.select", { id: local.id });
    return;
  }
  const opened = space && !space.machine ? await workspaceBoard(space) : null;
  if (opened?.space) {
    run("space.select", { id: opened.space });
    run("tab.select", { id: opened.tab });
  } else if (opened?.workspace) notify({ title: "This workspace has no Board", body: "Choose Add board under the workspace in the sidebar." });
  else run("tab.new", { name: "Board", mod: "hws-work", props: { view: "tasks" } });
}
