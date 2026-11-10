// A space's menu, from a right-click on its sidebar row, and the dialog that
// moves the space to a workspace.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { closeOverlay, exec, notify, openOverlay, panes, props, run, spaces } from "herdr";
import { hws, message, submitDialog, openWorkspaceForm, formKeys, dialogRoot, dialogFooter, button, problemLine } from "./hws.js";
import { menuRow } from "./rowmenu.js";

const MOD = "hws-panel";

// A popup is as tall as its items, and `height` is only the most.
const MENU = { width: 210, height: 260 };
const MOVE_DIALOG = { width: 440, height: 420 };
const WORKTREE_DIALOG = { width: 440, height: 260 };
const WORKTREE_LIST_DIALOG = { width: 560, height: 480 };

const icon = (name) => `mods/workspace-chrome/${name}.svg`;

// Where a space is now: its first terminal's live folder, else where it was made.
function place(space) {
  const tabs = new Set((space?.tabs ?? []).map((tab) => tab.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space?.folder || "";
}

// What the new-workspace form needs to make a workspace from an open space.
export function spaceRef(id) {
  const space = spaces().find((s) => s.id === id);
  return { id, name: space?.name ?? "", folder: place(space) };
}

// A space's checkout: "main" for a repo's own, "linked" for a worktree, else null.
async function checkout(folder) {
  const ask = (args) => exec("git", ["rev-parse", ...args], { cwd: folder });
  const top = await ask(["--show-toplevel"]);
  const common = await ask(["--path-format=absolute", "--git-common-dir"]);
  if (top.code !== 0 || common.code !== 0 || !top.stdout.trim()) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

// `target` is `{ space, workspace, workspaceName, canLeave }`. `workspace` is
// absent for a plain space. `canLeave` is true when the workspace has another
// space and this one is not its Tasks space.
export function openSpaceMenu(target) {
  openOverlay({ mod: MOD, kind: "popup", ...MENU, props: { ...target, view: "space-menu" } });
}

function openMoveSpace(id) {
  openOverlay({ mod: MOD, kind: "dialog", modal: true, ...MOVE_DIALOG, props: { view: "move-space", ...spaceRef(id) } });
}

function openWorktree(space, action) {
  openOverlay({ mod: "worktree", kind: "dialog", ...(action === "open" ? WORKTREE_LIST_DIALOG : WORKTREE_DIALOG), props: { space, action } });
}

async function takeOut(target) {
  try {
    await hws(["space", "remove", "--space", target.space]);
  } catch (e) {
    notify({ title: `Could not take the space out of ${target.workspaceName}`, body: message(e), level: "error" });
  }
}

// A workspace's only space has nowhere to go, so it gets neither move item.
function spaceMenuItems(target, git) {
  const id = target.space;
  const isMember = Boolean(target.workspace);
  const worktree = (action, label) => ({ id: `worktree-${action}`, label, open: () => openWorktree(id, action) });
  return [
    { id: "rename", label: "Rename", open: () => run("space.rename", { id }) },
    ...(git ? [worktree("new", "New worktree"), worktree("open", "Open worktree")] : []),
    ...(git === "linked" ? [worktree("remove", "Remove worktree")] : []),
    ...(!isMember || target.canLeave ? [{ id: "move", label: "Move to workspace…", hasLine: true, open: () => openMoveSpace(id) }] : []),
    ...(isMember && target.canLeave ? [{ id: "leave", label: `Take out of ${target.workspaceName}`, open: () => takeOut(target) }] : []),
    { id: "close", label: "Close", hasLine: true, open: () => run("space.close", { id }) },
  ];
}

export function initSpaceMenu(view, cx) {
  view.git = null;
  const folder = place(spaces().find((s) => s.id === props().space));
  if (!folder) return;
  cx.spawn(async (cx) => {
    view.git = await checkout(folder).catch(() => null);
    cx.notify();
  });
}

export function renderSpaceMenu(t, view) {
  const { view: _view, overlay, ...target } = props();
  const line = () => div().flex_none().mx(6).my(3).h(1).bg(t.border);
  return v_flex()
    .id("hws-space-menu")
    .w_full()
    .min_h(0)
    .p(4)
    .bg(t.popover)
    .text_color(t.foreground)
    .text_size(13)
    .children(spaceMenuItems(target, view.git).flatMap((item) => [...(item.hasLine ? [line()] : []), menuRow(t, item, overlay)]));
}

// Workspaces that hold the space's folder come first.
function destinations(list, from, matches) {
  const others = list.filter((w) => w.id !== from?.id);
  return [...others.filter((w) => matches.has(w.id)), ...others.filter((w) => !matches.has(w.id))];
}

export function initMoveSpace(view, cx) {
  const id = props().id;
  view.from = null;
  view.matches = new Set();
  view.workspaces = null;
  view.handle.focus();
  cx.spawn(async (cx) => {
    try {
      const [list, match] = await Promise.all([hws(["list"]), hws(["space", "match", "--space", id]).catch(() => null)]);
      view.from = list.find((w) => w.spaces.includes(id)) ?? null;
      view.matches = new Set((match?.candidates ?? []).map((c) => c.id));
      view.workspaces = destinations(list, view.from, view.matches);
    } catch (e) {
      view.workspaces = [];
      view.problem = message(e);
    }
    cx.notify();
  });
}

function moveTo(view, workspace, cx) {
  submitDialog(view, `move-${workspace.id}`, () => hws(["space", "move", "--space", props().id, "--workspace", workspace.id]), cx);
}

function makeWorkspace() {
  const { id, name, folder, overlay } = props();
  closeOverlay(overlay);
  openWorkspaceForm({ id, name, folder });
}

function destinationRow(t, view, { id, glyph, label, detail, onClick }) {
  return h_flex()
    .id(id)
    .h(32)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .when(!view.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
    .child(svg(icon(glyph)).size(13).flex_none().text_color(t.dim))
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(Boolean(detail), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(detail)));
}

function workspaceDetail(view, workspace) {
  if (view.busy === `move-${workspace.id}`) return "Moving…";
  if (view.matches.has(workspace.id)) return "Holds this folder";
  return workspace.kind === "throwaway" ? "Throwaway" : null;
}

export function renderMoveSpace(t, view) {
  const p = props();
  const dismiss = () => closeOverlay(p.overlay);
  const rows = (view.workspaces ?? []).map((w) =>
    destinationRow(t, view, { id: `move-to-${w.id}`, glyph: "layers", label: w.name, detail: workspaceDetail(view, w), onClick: (_e, cx) => moveTo(view, w, cx) }),
  );
  const fresh = destinationRow(t, view, { id: "move-to-new", glyph: "plus", label: "New workspace from this space…", detail: null, onClick: makeWorkspace });
  return dialogRoot(t, "hws-move-space")
    .track_focus(view.handle)
    .on_key_down(formKeys(view, dismiss))
    .child(
      v_flex()
        .flex_1()
        .min_h(0)
        .p(18)
        .gap(10)
        .child(div().flex_none().text_size(15).font_semibold().truncate().child(`Move ${p.name || "this space"} to a workspace`))
        .when(Boolean(view.from), (el) => el.child(div().flex_none().text_color(t.muted).whitespace_normal().child(`It leaves ${view.from.name}, which keeps its tasks.`)))
        .child(
          v_flex()
            .id("hws-move-space-list")
            .flex_1()
            .min_h(0)
            .overflow_y_scrollbar()
            .when(view.workspaces === null, (el) => el.child(div().h(32).flex_none().px(8).flex().items_center().text_color(t.dim).child("Loading…")))
            .children(rows)
            .child(fresh),
        )
        .when(Boolean(view.problem), (el) => el.child(problemLine(t, view.problem))),
    )
    .child(dialogFooter().child(button(t, "cancel", "Cancel", false, dismiss)));
}
