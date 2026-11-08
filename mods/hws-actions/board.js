// Finds or opens the active space's Board tab. hws-work runs as a pane only on a Board,
// because the right panel holds it in a layout block and panes() lists tab panes.
// hws-tabs and hws-actions hold identical copies, and a test compares them.

import { spaces, panes, run } from "herdr";

export function boardTab(space, paneList) {
  return space?.tabs.find((tab) => paneList.some((p) => p.tab === tab.id && p.mod === "hws-work")) ?? null;
}

export function openBoard() {
  const board = boardTab(spaces().find((s) => s.active), panes());
  if (board) run("tab.select", { id: board.id });
  else run("tab.new", { name: "Board", mod: "hws-work", props: { view: "tasks" } });
}
