// The sidebar's Workspaces section. It lists every workspace, switches to one,
// and opens the launcher, the form and the workspace panel.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, layout, openOverlay, run, setShared, shared, spaces, theme, watchFolder } from "herdr";
import { hws, message, openWorkspaceForm } from "./hws.js";
import { freshness } from "./context.js";
import { freshnessDot } from "./sections.js";
import { openConfirm, openRowMenu } from "./rowmenu.js";

const NODE = "workspaces";
const HEADING_PX = 31;
const ROW_PX = 30;
const SPACE_ROW_PX = 26;
const BOTTOM_PX = 8;
const MAX_LIST_PX = 300;
const NARROW_PX = 160;
const CHECK_MS = 1000;
const REFRESH_MS = 60000;
const GIT_TIMEOUT_MS = 5000;
const FOLDED_KEY = "sidebar.folded";
const ARCHIVED_OPEN_KEY = "sidebar.archived.open";
const STATUS_ORDER = ["blocked", "done", "working", "idle"];

// hws-tabs reads the first key. The second lists every space in an open workspace.
const BOARD_TABS = "hws.board.tabs";
const WORKSPACE_SPACES = "hws.workspace.spaces";

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

const membersOf = (workspace, shown) => workspace.spaces.flatMap((id) => shown.filter((s) => s.id === id));
const boardFirst = (workspace, members) => [...members].sort((a, b) => (b.id === workspace.board?.space) - (a.id === workspace.board?.space));
const isCurrent = (members) => members.some((s) => s.active);
const mostUrgent = (members) => STATUS_ORDER.find((status) => members.some((s) => s.status === status)) ?? null;

// One space needs no list of its own, because the workspace row already stands for it.
// A lone space has no chevron, so it can never stay folded.
const showsSpaces = (state, workspace, members) => members.length === 1 || !state.folded.has(workspace.id);
const showsAddRows = (state, workspace, members) => isCurrent(members) && !state.folded.has(workspace.id);
const hasBoard = (workspace, members) => members.some((s) => s.id === workspace.board?.space);

// A folder with no upstream, or no repo at all, has no count to show.
async function aheadOf(folder) {
  try {
    const r = await exec("git", ["rev-list", "--count", "@{upstream}..HEAD"], { cwd: folder, timeout: GIT_TIMEOUT_MS });
    return r.code === 0 ? Number(r.stdout.trim()) || 0 : 0;
  } catch {
    return 0;
  }
}

// A kept workspace's freshness as `{ level, title }`. A throwaway has no current
// note, and a failed call shows no dot.
async function freshnessOf(workspace) {
  if (workspace.kind === "throwaway") return null;
  try {
    const status = await hws(["tidy", "status", "--workspace", workspace.id]);
    const level = freshness(status);
    return level ? { level, title: status.line } : null;
  } catch {
    return null;
  }
}

// The tab bar hides these, because this list already shows each Board.
function publishBoardTabs(workspaces) {
  const tabs = workspaces.flatMap((w) => (w.board ? [w.board.tab] : []));
  if (JSON.stringify(tabs) !== JSON.stringify(shared(BOARD_TABS) ?? [])) setShared(BOARD_TABS, tabs);
}

// Sorted, Board spaces included, and set only when it changes.
function publishWorkspaceSpaces(workspaces) {
  const ids = [...new Set(workspaces.flatMap((w) => [...w.spaces, ...(w.board ? [w.board.space] : [])]))].sort();
  if (JSON.stringify(ids) !== JSON.stringify(shared(WORKSPACE_SPACES) ?? [])) setShared(WORKSPACE_SPACES, ids);
}

// An agent or the CLI can change who is in a workspace with no change to the spaces.
function watchManifests(state, cx) {
  const dir = [...state.workspaces, ...(state.archived ?? [])][0]?.dir;
  if (state.watching || !dir) return;
  state.watching = true;
  const root = dir.slice(0, dir.lastIndexOf("/"));
  cx.spawn(async (cx) => {
    try {
      for (;;) {
        const changed = await watchFolder(root);
        if (changed.some((p) => p === root || p.endsWith("/workspace.json"))) load(state, cx);
      }
    } catch {
      // The timer keeps the list current without a watch.
    }
    state.watching = false;
  });
}

function load(state, cx, { listOnly = false } = {}) {
  if (state.fetching) {
    state.fetchAgain = true;
    return;
  }
  state.fetching = true;
  cx.spawn(async (cx) => {
    try {
      state.workspaces = await hws(["list"]);
      state.archived = await hws(["list", "--archived"]);
      state.problem = null;
      publishBoardTabs(state.workspaces);
      publishWorkspaceSpaces(state.workspaces);
      watchManifests(state, cx);

      // The list paints first, so a slow `git` or `hws tidy status` cannot hold up a new row.
      fit(state);
      cx.notify();
      if (!listOnly) {
        // A throwaway's folder is its scratch folder, so git is never asked there.
        const extras = await Promise.all(state.workspaces.map((w) => Promise.all([w.id, w.kind === "throwaway" ? 0 : aheadOf(w.folder), freshnessOf(w)])));
        state.ahead = Object.fromEntries(extras.map(([id, ahead]) => [id, ahead]));
        state.fresh = Object.fromEntries(extras.map(([id, , fresh]) => [id, fresh]));
      }
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

function listPx(state) {
  const shown = spaces();
  const px = state.workspaces.reduce((sum, w) => {
    const members = membersOf(w, shown);
    const rows = (showsSpaces(state, w, members) ? members.length : 0) + addRowSpecs(state, w, members).length;
    return sum + ROW_PX + rows * SPACE_ROW_PX;
  }, 0);
  return Math.min(Math.max(px, ROW_PX) + archivedRowCount(state) * SPACE_ROW_PX, MAX_LIST_PX);
}

// Sizes the block to its rows, so an empty section leaves no gap above Spaces.
function fit(state) {
  const block = findNode(layout(), NODE);
  if (!block || !state.workspaces) return;
  const px = isNarrow() ? HEADING_PX : HEADING_PX + listPx(state) + BOTTOM_PX;
  if (block.size?.px !== px) run("layout.resize", { id: NODE, px });
}

const changeKey = () => spaces().map((s) => s.id).join();

// A change in the spaces is the cheap signal to reload. The first load only
// lists, because the manifest may not exist until the delayed load.
function check(state, cx) {
  const key = changeKey();
  fit(state);
  if (key === state.spaceKey) return;
  state.spaceKey = key;
  load(state, cx, { listOnly: true });
  cx.spawn(async (cx) => {
    await cx.sleep(MANIFEST_WAIT_MS);
    load(state, cx);
  });
}

export function startSidebar(cx) {
  const state = {
    workspaces: null,
    archived: [],
    showArchived: localStorage.getItem(ARCHIVED_OPEN_KEY) === "1",
    problem: null,
    fetching: false,
    fetchAgain: false,
    spaceKey: changeKey(),
    folded: new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]")),
    ahead: {},
    fresh: {},
  };
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
      onClick(cx);
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

function toggleFold(state, id, cx) {
  if (state.folded.has(id)) state.folded.delete(id);
  else state.folded.add(id);
  localStorage.setItem(FOLDED_KEY, JSON.stringify([...state.folded]));
  fit(state);
  cx.notify();
}

function foldButton(t, state, id) {
  const chevron = state.folded.has(id) ? "chevron-right" : "chevron-down";
  return div()
    .id(`sidebar-fold-${id}`)
    .size(16)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(4)
    .text_color(t.dim)
    .hover((s) => s.text_color(t.foreground))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      toggleFold(state, id, cx);
    })
    .child(svg(icon(chevron)).size(12));
}

const statusDot = (t, status) => div().size(6).rounded(3).flex_none().bg(t[status] ?? t.dim);

// Runs a change and reloads the list. A failure shows in place of the list.
function changeThenLoad(state, cx, work) {
  cx.spawn(async (cx) => {
    try {
      await work();
      state.problem = null;
    } catch (e) {
      state.problem = message(e);
      cx.notify();
      return;
    }
    load(state, cx);
  });
}

function removeSpace(state, id, cx) {
  changeThenLoad(state, cx, () => hws(["space", "remove", "--space", id]));
}

function openAddSpace(workspace) {
  const dialogProps = { view: "add-space", workspace: workspace.id, name: workspace.name, spaces: workspace.spaces };
  openOverlay({ mod: "hws-panel", kind: "dialog", modal: true, width: 440, height: 460, props: dialogProps });
}

function showBoard(board) {
  run("space.select", { id: board.space });
  run("tab.select", { id: board.tab });
}

function spaceRow(t, state, workspace, space, canRemove) {
  const isBoard = workspace.board?.space === space.id;
  return h_flex()
    .id(`sidebar-space-${space.id}`)
    .h(SPACE_ROW_PX)
    .flex_none()
    .pl(32)
    .pr(4)
    .gap(8)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_size(12.5)
    .text_color(space.active ? t.foreground : t.muted)
    .when(space.active, (el) => el.bg(t.hover))
    .when(!space.active, (el) => el.hover((s) => s.bg(t.hover)))
    .on_click(() => (isBoard ? showBoard(workspace.board) : run("space.select", { id: space.id })))
    .child(svg(isBoard ? "mods/hws-panel/board.svg" : icon("terminal")).size(12).flex_none())
    .child(div().flex_1().min_w(0).truncate().child(isBoard ? "Tasks" : space.name || workspace.name))
    .when(Boolean(space.status), (el) => el.child(statusDot(t, space.status)))
    .when(!isBoard && canRemove, (el) => el.child(iconButton(t, `sidebar-remove-${space.id}`, "minus", 18, (cx) => removeSpace(state, space.id, cx)).tooltip("Take out of this workspace. The space stays open.")));
}

function addBoard(state, workspace, cx) {
  changeThenLoad(state, cx, async () => showBoard(await hws(["board", "add", "--workspace", workspace.id])));
}

function addRow(t, id, label, onClick) {
  return h_flex()
    .id(id)
    .h(SPACE_ROW_PX)
    .flex_none()
    .pl(32)
    .pr(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_size(12.5)
    .text_color(t.dim)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => onClick(cx))
    .child(svg(icon("plus")).size(12).flex_none())
    .child(label);
}

// Sizing and drawing both read this list, so the block always fits its rows.
function addRowSpecs(state, workspace, members) {
  if (!showsAddRows(state, workspace, members)) return [];
  const addSpace = { id: `sidebar-add-space-${workspace.id}`, label: "Add space", onClick: () => openAddSpace(workspace) };
  if (hasBoard(workspace, members)) return [addSpace];
  return [addSpace, { id: `sidebar-add-board-${workspace.id}`, label: "Add tasks", onClick: (cx) => addBoard(state, workspace, cx) }];
}

const menuTarget = (workspace, archived, space = null) => ({ workspace: workspace.id, name: workspace.name, kind: workspace.kind, archived, space });

function rightClick(workspace, archived, space) {
  return (_e, cx) => {
    cx.stop_propagation();
    openRowMenu(menuTarget(workspace, archived, space));
  };
}

function workspaceRow(t, state, workspace, members) {
  const isActive = isCurrent(members);
  const status = mostUrgent(members);
  const target = members.find((s) => s.active) ?? members[0];
  const ahead = state.ahead[workspace.id] ?? 0;
  const fresh = state.fresh[workspace.id] ?? null;
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
    .on_click(() => target && run("space.select", { id: target.id }))
    .on_mouse_down("right", rightClick(workspace, false, target?.id ?? null))
    .when(members.length > 1, (el) => el.child(foldButton(t, state, workspace.id)))
    .child(svg(icon("layers")).size(14).flex_none().text_color(isActive ? t.foreground : t.dim))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(workspace.name))
    .when(Boolean(fresh), (el) => el.child(div().id(`sidebar-fresh-${workspace.id}`).flex_none().child(freshnessDot(t, fresh.level)).tooltip(fresh.title)))
    .when(workspace.kind === "throwaway", (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child("Throwaway")))
    .when(Boolean(status), (el) => el.child(statusDot(t, status)))
    .when(ahead > 0, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.ansi2).child(`\u2191${ahead}`)))
    .when(isActive, (el) => el.child(iconButton(t, "sidebar-panel", "panel-right", 22, () => run("mod.open", { name: "hws-panel" })).tooltip("Show or hide the workspace panel")));
}

function archivedRowCount(state) {
  const count = state.archived?.length ?? 0;
  if (count === 0) return 0;
  return state.showArchived ? count + 1 : 1;
}

function toggleArchived(state, cx) {
  state.showArchived = !state.showArchived;
  localStorage.setItem(ARCHIVED_OPEN_KEY, state.showArchived ? "1" : "0");
  fit(state);
  cx.notify();
}

function archivedHeading(t, state) {
  return h_flex()
    .id("sidebar-archived-toggle")
    .h(SPACE_ROW_PX)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_size(12.5)
    .text_color(t.dim)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => toggleArchived(state, cx))
    .child(svg(icon(state.showArchived ? "chevron-down" : "chevron-right")).size(12).flex_none())
    .child(div().flex_1().min_w(0).truncate().child("Archived"))
    .child(div().flex_none().text_size(11.5).child(String(state.archived.length)));
}

function archivedRow(t, workspace) {
  return h_flex()
    .id(`sidebar-archived-${workspace.id}`)
    .h(SPACE_ROW_PX)
    .flex_none()
    .pl(32)
    .pr(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_size(12.5)
    .text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click(() => openConfirm("restore", menuTarget(workspace, true)))
    .on_mouse_down("right", rightClick(workspace, true))
    .child(svg(icon("layers")).size(12).flex_none())
    .child(div().flex_1().min_w(0).truncate().child(workspace.name));
}

function archivedRows(t, state) {
  if (archivedRowCount(state) === 0) return [];
  return [archivedHeading(t, state), ...(state.showArchived ? state.archived.map((w) => archivedRow(t, w)) : [])];
}

function rows(t, state) {
  if (state.problem) return [div().h(ROW_PX).flex_none().px(8).flex().items_center().text_size(11.5).text_color(t.blocked).child(div().truncate().child(state.problem))];
  if (!state.workspaces) return [];
  if (state.workspaces.length === 0) return [newRow(t), ...archivedRows(t, state)];
  const shown = spaces();
  const open = state.workspaces.flatMap((w) => {
    const members = membersOf(w, shown);
    return [
      workspaceRow(t, state, w, members),
      ...(showsSpaces(state, w, members) ? boardFirst(w, members).map((space) => spaceRow(t, state, w, space, members.length > 1)) : []),
      ...addRowSpecs(state, w, members).map(({ id, label, onClick }) => addRow(t, id, label, onClick)),
    ];
  });
  return [...open, ...archivedRows(t, state)];
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
