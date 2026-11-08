// The sidebar's Workspaces section. It lists every workspace, switches to one,
// and opens the launcher, the form and the workspace panel.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { layout, run, spaces, theme } from "herdr";
import { hws, message, openWorkspaceForm } from "./hws.js";

const NODE = "workspaces";
const HEADING_PX = 31;
const ROW_PX = 30;
const BOTTOM_PX = 8;
const MAX_ROWS = 5;
const NARROW_PX = 160;
const CHECK_MS = 1000;
const REFRESH_MS = 60000;

// `hws new workspace` makes the space before it writes the manifest.
const MANIFEST_WAIT_MS = 1500;

const icon = (name) => `mods/workspace-chrome/${name}.svg`;

function findNode(tree, id) {
  if (tree?.id === id) return tree;
  for (const child of tree?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

const isNarrow = () => (findNode(layout(), "sidebar")?.size?.px ?? Infinity) < NARROW_PX;

function load(state, cx) {
  if (state.fetching) {
    state.fetchAgain = true;
    return;
  }
  state.fetching = true;
  cx.spawn(async (cx) => {
    try {
      state.workspaces = await hws(["list"]);
      state.problem = null;
    } catch (e) {
      state.problem = message(e);
    }
    state.fetching = false;
    if (state.fetchAgain) {
      state.fetchAgain = false;
      load(state, cx);
    }
    fit(state);
    cx.notify();
  });
}

// Sizes the block to its rows, so an empty section leaves no gap above Spaces.
function fit(state) {
  const block = findNode(layout(), NODE);
  if (!block || !state.workspaces) return;
  const rows = Math.max(1, Math.min(state.workspaces.length, MAX_ROWS));
  const px = isNarrow() ? HEADING_PX : HEADING_PX + rows * ROW_PX + BOTTOM_PX;
  if (block.size?.px !== px) run("layout.resize", { id: NODE, px });
}

// A workspace is a space, so a change in the spaces is the cheap signal to reload.
function check(state, cx) {
  const key = spaces().map((s) => s.id).join();
  fit(state);
  if (key === state.spaceKey) return;
  state.spaceKey = key;
  load(state, cx);
  cx.spawn(async (cx) => {
    await cx.sleep(MANIFEST_WAIT_MS);
    load(state, cx);
  });
}

export function startSidebar(cx) {
  const state = { workspaces: null, problem: null, fetching: false, fetchAgain: false, spaceKey: spaces().map((s) => s.id).join() };
  load(state, cx);
  cx.timer.every(CHECK_MS, (cx) => check(state, cx));
  cx.timer.every(REFRESH_MS, (cx) => load(state, cx));
  return state;
}

function iconButton(t, id, name, size, onClick) {
  return div()
    .id(id)
    .size(size)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(6)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick();
    })
    .child(svg(icon(name)).size(14));
}

function newRow(t) {
  return h_flex()
    .id("sidebar-new-workspace")
    .h(ROW_PX)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click(() => openWorkspaceForm())
    .child(svg(icon("plus")).size(14).flex_none())
    .child("New workspace");
}

function workspaceRow(t, workspace, shown) {
  const isActive = Boolean(shown?.active);
  return h_flex()
    .id(`sidebar-workspace-${workspace.id}`)
    .h(ROW_PX)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .when(isActive, (el) => el.bg(t.raised))
    .when(!isActive, (el) => el.hover((s) => s.bg(t.hover)))
    .on_click(() => run("space.select", { id: workspace.id }))
    .child(svg(icon("layers")).size(14).flex_none().text_color(isActive ? t.foreground : t.dim))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(workspace.name))
    .when(workspace.kind === "throwaway", (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child("Throwaway")))
    .when(isActive, (el) => el.child(iconButton(t, "sidebar-panel", "panel-right", 22, () => run("mod.open", { name: "hws-panel" }))));
}

function rows(t, state) {
  if (state.problem) return [div().h(ROW_PX).flex_none().px(8).flex().items_center().text_size(11.5).text_color(t.blocked).child(div().truncate().child(state.problem))];
  if (!state.workspaces) return [];
  if (state.workspaces.length === 0) return [newRow(t)];
  const shown = spaces();
  return state.workspaces.map((w) => workspaceRow(t, w, shown.find((s) => s.id === w.id)));
}

export function drawSidebar(state) {
  const t = theme();
  const isCollapsed = isNarrow();
  return v_flex()
    .size_full()
    .min_h(0)
    .bg(t.chrome)
    .text_size(13)
    .child(
      h_flex()
        .h(HEADING_PX)
        .flex_none()
        .pl(16)
        .pr(10)
        .items_center()
        .justify_between()
        .text_size(11.5)
        .text_color(t.dim)
        .when(!isCollapsed, (el) => el.child("Workspaces"))
        .child(iconButton(t, "sidebar-launcher", "plus", 26, () => run("mod.open", { name: "hws-new" }))),
    )
    .when(!isCollapsed, (el) => el.child(v_flex().flex_1().min_h(0).px(8).overflow_y_scrollbar().mode("always").children(rows(t, state))));
}
