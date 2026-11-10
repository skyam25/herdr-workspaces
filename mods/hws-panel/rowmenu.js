// The workspace menu, from a sidebar row's right-click or the panel's ··· button,
// the dialogs it opens, and the panel's stage menu.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { closeOverlay, openOverlay, panes, props, run, spaces } from "herdr";
import { hws, submitDialog, makeInput, focusField, formKeys, dialogRoot, dialogFooter, labeled, field, button, problemLine } from "./hws.js";
import { STAGES } from "./context.js";
import { showBoard } from "./cites.js";

const MOD = "hws-panel";
const MENU_WIDTH = 176;
const STAGE_MENU_WIDTH = 140;
const MENU_ROW_PX = 28;
const MENU_PADDING_PX = 4;

const RENAME_DIALOG = { width: 420, height: 170 };
const CONFIRM_DIALOG = { width: 440, height: 176 };
const ADD_SPACE_DIALOG = { width: 440, height: 460 };

const openDialog = ({ width, height }, dialogProps) => openOverlay({ mod: MOD, kind: "dialog", modal: true, width, height, props: dialogProps });

const CLOSE_BODY = {
  throwaway: "Its spaces and terminals close. Find throwaway can bring it back for 30 days.",
};

function confirmCopy({ action, name, kind }) {
  return {
    archive: { title: `Archive ${name}?`, body: "Its spaces and terminals close. Restore reopens them and resumes their agent sessions.", yes: "Archive", busy: "Archiving…" },
    restore: { title: `Restore ${name}?`, body: "This reopens its spaces and resumes their agent sessions.", yes: "Restore", busy: "Restoring…" },
    close: { title: `Close ${name}?`, body: CLOSE_BODY[kind === "throwaway" ? "throwaway" : "kept"], yes: "Close", busy: "Closing…" },
    remove: { title: `Remove ${name}?`, body: "It leaves the Archived list and cannot be restored. Its files stay in its folder.", yes: "Remove", busy: "Removing…" },
  }[action];
}

export const openConfirm = (action, target) => openDialog(CONFIRM_DIALOG, { ...target, view: "confirm", action });

const openRename = (target) => openDialog(RENAME_DIALOG, { ...target, view: "rename" });

// Opens on the space's shown tab and never closes a panel already there, so
// it reads the tab from `spaces()` and does not wait for the switch to land.
function openPanel(spaceId) {
  const tab = spaces().find((s) => s.id === spaceId)?.tabs.find((c) => c.active);
  run("space.select", { id: spaceId });
  const inTab = panes().filter((p) => p.tab === tab?.id);
  const seated = inTab.find((p) => p.mod === MOD);
  if (seated) {
    run("pane.focus", { pane: seated.pane });
    return;
  }
  const anchor = inTab.find((p) => p.terminal) ?? inTab[0];
  if (anchor) run("pane.split", { direction: "right", pane: anchor.pane, mod: MOD, props: anchor.terminal ? { terminal: anchor.terminal } : {} });
}

function openAddSpace(target) {
  const dialogProps = { view: "add-space", workspace: target.workspace, name: target.name, spaces: target.spaces };
  openDialog(ADD_SPACE_DIALOG, dialogProps);
}

// The sidebar reloads once the Board space appears.
function addTasks(target) {
  hws(["board", "add", "--workspace", target.workspace]).then(showBoard).catch(() => {});
}

// Only the sidebar's target carries `spaces`, so the panel's ··· menu leaves these out.
function addItems(target) {
  if (!Array.isArray(target.spaces)) return [];
  const addSpace = { id: "add-space", label: "Add space…", open: () => openAddSpace(target) };
  return target.board ? [addSpace] : [addSpace, { id: "add-tasks", label: "Add tasks", open: () => addTasks(target) }];
}

function menuItems(target) {
  const panel = target.space ? [{ id: "panel", label: "Open panel", open: () => openPanel(target.space) }] : [];
  const rename = { id: "rename", label: "Rename…", open: () => openRename(target) };
  const confirm = (id, label) => ({ id, label, open: () => openConfirm(id, target) });
  if (target.archived) return [confirm("restore", "Restore…"), rename, confirm("remove", "Remove…")];
  const adds = addItems(target);
  if (target.kind === "throwaway") return [...panel, ...adds, rename, confirm("close", "Close…")];
  return [...panel, ...adds, rename, confirm("archive", "Archive…")];
}

// `target` is `{ workspace, name, kind, archived, space }`. The sidebar adds
// `spaces` and `board`, whether the workspace has a Board.
export function openRowMenu(target) {
  const height = menuItems(target).length * MENU_ROW_PX + MENU_PADDING_PX * 2;
  openOverlay({ mod: MOD, kind: "popup", width: MENU_WIDTH, height, props: { ...target, view: "row-menu" } });
}

// One menu item. It closes the menu and then acts.
export function menuRow(t, item, overlay) {
  return h_flex()
    .id(`row-menu-${item.id}`)
    .h(MENU_ROW_PX)
    .flex_none()
    .px(8)
    .items_center()
    .rounded(5)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(() => {
      closeOverlay(overlay);
      item.open();
    })
    .child(item.label);
}

// `items` are `{ id, label, open }`.
export function popupMenu(t, items, overlay) {
  return v_flex()
    .id("hws-row-menu")
    .size_full()
    .p(MENU_PADDING_PX)
    .bg(t.popover)
    .text_color(t.foreground)
    .text_size(13)
    .children(items.map((item) => menuRow(t, item, overlay)));
}

export function renderRowMenu(t) {
  const { view: _view, overlay, ...target } = props();
  return popupMenu(t, menuItems(target), overlay);
}

export function popupHeight(count) {
  return count * MENU_ROW_PX + MENU_PADDING_PX * 2;
}

export function openStageMenu(workspace) {
  openOverlay({ mod: MOD, kind: "popup", width: STAGE_MENU_WIDTH, height: popupHeight(STAGES.length), props: { view: "stage-menu", workspace: workspace.id } });
}

// Each item closes the popup and then runs `hws set`. The panel's manifest
// watch shows the new stage.
export function renderStageMenu(t) {
  const { workspace, overlay } = props();
  const items = STAGES.map((stage) => ({
    id: stage,
    label: stage[0].toUpperCase() + stage.slice(1),
    open: () => { hws(["set", "--workspace", workspace, "--stage", stage]).catch(() => {}); },
  }));
  return popupMenu(t, items, overlay);
}

export function initRename(view, cx) {
  makeInput(view, "name", { value: props().name ?? "", placeholder: "Workspace name", submit: (cx) => saveName(view, cx) });
  focusField(view, "name", cx);
}

function saveName(view, cx) {
  const name = view.values.name.trim();
  if (!name) {
    view.problem = "Enter a name.";
    cx.notify();
    return;
  }
  submitDialog(view, "rename", () => hws(["set", "--workspace", props().workspace, "--name", name]), cx);
}

export function renderRename(t, view) {
  return dialogRoot(t, "hws-rename")
    .track_focus(view.handle)
    .on_key_down(formKeys(view, () => closeOverlay(props().overlay)))
    .child(
      v_flex()
        .flex_1()
        .min_h(0)
        .p(18)
        .gap(12)
        .child(div().text_size(15).font_semibold().child("Rename workspace"))
        .child(labeled(t, "Name", field(t, view, "name")))
        .when(Boolean(view.problem), (el) => el.child(problemLine(t, view.problem))),
    )
    .child(
      dialogFooter()
        .child(button(t, "cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button(t, "rename-yes", view.busy ? "Saving…" : "Save", true, (_e, cx) => saveName(view, cx), !view.busy)),
    );
}

// A throwaway with work left asks what to keep, in the Keep or Trash dialog.
async function closeForGood(p) {
  const answer = await hws(["close", "--workspace", p.workspace]);
  if (answer?.decision !== "needed") return;
  openDialog({ width: 460, height: 400 }, { view: "decide", workspace: p.workspace, name: p.name, artifacts: answer.artifacts ?? [], scratch: answer.scratch ?? null });
}

function runConfirmed(p) {
  if (p.action === "archive") return hws(["archive", "--workspace", p.workspace]);
  if (p.action === "restore") return hws(["unarchive", "--workspace", p.workspace]);
  return closeForGood(p);
}

export function renderConfirm(t, view) {
  const p = props();
  const copy = confirmCopy(p);
  return dialogRoot(t, "hws-confirm")
    .track_focus(view.handle)
    .on_key_down((e, cx) => {
      if (e.key !== "escape") return;
      closeOverlay(p.overlay);
      cx.stop_propagation();
    })
    .child(
      v_flex()
        .flex_1()
        .min_h(0)
        .p(18)
        .gap(6)
        .child(div().text_size(15).font_semibold().truncate().child(copy.title))
        .child(div().text_color(t.muted).whitespace_normal().child(copy.body))
        .when(Boolean(view.problem), (el) => el.child(problemLine(t, view.problem))),
    )
    .child(
      dialogFooter()
        .child(button(t, "cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button(t, "confirm-yes", view.busy ? copy.busy : copy.yes, true, (_e, cx) => submitDialog(view, p.action, () => runConfirmed(p), cx), !view.busy)),
    );
}
