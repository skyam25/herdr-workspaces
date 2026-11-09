// Turns a cite from the current note or a backlog row into an action.
// Each action resolves with a note to show, or null.

import { agents, exec, openOverlay, panes, run, terminals, window } from "herdr";
import { hws } from "./hws.js";
import { opensAsPage, resolvePath } from "./context.js";

// The Board's card dialog, at the size the Board itself prefers.
const CARD_DIALOG = { width: 920, height: 760 };
const LINUX_COPY = 'if [ -n "${WAYLAND_DISPLAY:-}" ]; then wl-copy; else xclip -selection clipboard; fi';

const onLinux = () => window()?.platform === "linux";

export async function copy(text) {
  const r = await exec("sh", ["-c", `printf %s "$1" | ${onLinux() ? LINUX_COPY : "pbcopy"}`, "sh", text]);
  if (r.code !== 0) throw new Error("Could not copy.");
}

// A flipped agent's surface opens beside its chat pane, as hws surface open requires.
function pageArgs(file, target) {
  const args = ["surface", "open", "--type", "page", "--file", file, "--terminal", target.address];
  const chat = terminals().find((x) => x.address === target.address)?.labels?.["herdr.chat"];
  return chat && panes().some((p) => p.pane === chat) ? [...args, "--beside-pane", chat, "--space", target.space] : args;
}

// Markdown and HTML open as a page beside the agent. Anything else, or no agent, opens in the desktop's default app.
export async function openPath(path, target) {
  if (opensAsPage(path) && target) {
    await hws(pageArgs(path, target));
    return null;
  }
  const r = await exec(onLinux() ? "xdg-open" : "open", [path]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `Could not open ${path}`);
  return null;
}

function openCard(id, workspace, space) {
  if (workspace.board) {
    run("space.select", { id: workspace.board.space });
    run("tab.select", { id: workspace.board.tab });
  }
  const props = { view: "todo", space: workspace.board?.space ?? space, id, height: CARD_DIALOG.height };
  openOverlay({ mod: "hws-work", kind: "dialog", modal: true, ...CARD_DIALOG, props });
  return null;
}

// A session still running in this workspace is focused, so it never runs twice.
// Otherwise it resumes with Claude Code in a new tab of this space.
export function resumeSession(id, workspace, space) {
  const live = (workspace.terminals ?? []).find((x) => x.sessionId === id && agents().some((a) => a.address === x.terminal));
  if (live) {
    run("agent.focus", { terminal: live.terminal });
    return null;
  }
  run("tab.new", { name: `Resume ${id.slice(0, 8)}`, space, folder: workspace.folder, argv: ["claude", "--resume", id] });
  return null;
}

// The second argument names the workspace, the agent pages open beside or null,
// and the space new tabs open in.
export async function openCite(cite, { workspace, target, space }) {
  if (cite.kind === "card") return openCard(cite.value, workspace, space);
  if (cite.kind === "session") return resumeSession(cite.value, workspace, space);
  if (cite.kind === "commit") {
    await copy(cite.value);
    return `Copied ${cite.value.slice(0, 7)}.`;
  }
  if (cite.kind === "artifact") {
    const artifact = (workspace.artifacts ?? []).find((a) => a.id === cite.value);
    if (!artifact?.path) throw new Error(`No artifact ${cite.value} in this workspace.`);
    return openPath(artifact.path, target);
  }
  return openPath(resolvePath(cite.value, workspace.folder), target);
}
