// The sidebar's Workspaces section. It lists every workspace, switches to one,
// and opens the launcher, the form and the workspace panel.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, exec, layout, readTextFile, run, setShared, shared, spaces, theme, watchFolder, window } from "herdr";
import { hws, message, openWorkspaceForm } from "./hws.js";
import { freshness } from "./context.js";
import { freshnessDot } from "./sections.js";
import { showBoard } from "./cites.js";
import { openConfirm, openRowMenu } from "./rowmenu.js";
import { openSpaceMenu } from "./spacemenu.js";
import { openUnfiled, unfiledOf } from "./unfiled.js";

const NODE = "workspaces";
const HEADING_PX = 31;
const ROW_PX = 30;
const SPACE_ROW_PX = 26;
const BOTTOM_PX = 8;
const CHEVRON_PX = 16;
const TILE_PX = 18;
const NARROW_PX = 160;
const CHECK_MS = 1000;
const REFRESH_MS = 60000;
const GIT_TIMEOUT_MS = 5000;
const FOLDED_KEY = "sidebar.folded";
const ARCHIVED_OPEN_KEY = "sidebar.archived.open";
const CAP_KEY = "sidebar.workspaces.cap";
const STATUS_ORDER = ["blocked", "done", "working", "idle"];

// Child glyphs center under the workspace tile.
const CHILD_INSET_PX = 8 + CHEVRON_PX + 8 + (TILE_PX - 12) / 2;

// The list grows until the sidebar's other blocks reach their own minimum height.
// Herdr's window.json gives the window height. Without it the list stops at the fallback.
const FALLBACK_MAX_LIST_PX = 480;
const SYSTEM_TITLEBAR_PX = 28;

// hws-tabs reads the first key. The second lists every space in an open workspace.
// The third maps each space of a workspace with a Board to its Waiting on you count.
const BOARD_TABS = "hws.board.tabs";
const WORKSPACE_SPACES = "hws.workspace.spaces";
const TASKS_WAITING = "hws.tasks.waiting";

// Tile colors match hws-spaces, which keeps a color per space in `space.colors`.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];

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

function pathTo(tree, id) {
  if (tree?.id === id) return [tree];
  for (const child of tree?.children ?? []) {
    const path = pathTo(child, id);
    if (path) return [tree, ...path];
  }
  return null;
}

const isNarrow = () => (findNode(layout(), "sidebar")?.size?.px ?? Infinity) < NARROW_PX;

const membersOf = (workspace, shown) => workspace.spaces.flatMap((id) => shown.filter((s) => s.id === id));
const isCurrent = (members) => members.some((s) => s.active);
const mostUrgent = (members) => STATUS_ORDER.find((status) => members.some((s) => s.status === status)) ?? null;
const workingSpaces = (workspace, members) => members.filter((s) => s.id !== workspace.board?.space);

// Tasks comes first. Every working space gets a row, a lone one included.
function childSpaces(workspace, members) {
  const board = members.filter((s) => s.id === workspace.board?.space);
  return [...board, ...workingSpaces(workspace, members)];
}

const shownChildren = (state, workspace, members) => (state.folded.has(workspace.id) ? [] : childSpaces(workspace, members));

// A stored space color wins, so the tile matches that space's color elsewhere.
// A workspace with none takes a color from its name.
function tileFill(t, workspace) {
  const colors = shared("space.colors") ?? {};
  const stored = colors[workspace.id] ?? colors[workspace.spaces[0]];
  const hash = [...workspace.name].reduce((sum, c) => (sum * 31 + c.codePointAt(0)) >>> 0, 0);
  const color = typeof stored === "string" ? stored : PALETTE[hash % PALETTE.length];
  return color.startsWith("#") ? color : (MARK[color] ?? t[color]);
}

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

// Work in no workspace and every open window, each read once per full load. A failure counts as none.
async function loose() {
  const [unfiled, windows] = await Promise.all([hws(["unfiled"]).catch(() => null), hws(["surface", "list"]).catch(() => null)]);
  const { surfaces, artifacts } = unfiledOf(unfiled);
  const open = {};
  for (const w of Array.isArray(windows) ? windows : []) if (w?.open && w.workspace) (open[w.workspace] ??= []).push(w.id);
  return { unfiled: surfaces.length + artifacts.length, open };
}

// Cards in Waiting on you on a workspace's Board. A failure counts as zero.
async function waitingOf(workspace) {
  if (!workspace.board) return 0;
  try {
    const list = await hws(["todo", "list", "--space", workspace.board.space]);
    return (list?.items ?? []).filter((x) => !x.archived && x.column === "waiting").length;
  } catch {
    return 0;
  }
}

async function windowHeight() {
  try {
    const bounds = JSON.parse((await readTextFile(`${appHome()}/window.json`)) ?? "null")?.bounds;
    return Number(bounds?.[3]) || null;
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

const sortedEntries = (map) => JSON.stringify(Object.keys(map).sort().map((key) => [key, map[key]]));

// Writes the whole map, and only when it changes. Readers treat a value that is not an object as empty.
function publishWaiting(workspaces, waiting) {
  const map = {};
  for (const w of workspaces) {
    if (!w.board) continue;
    for (const id of [...w.spaces, w.board.space]) map[id] = waiting[w.id] ?? 0;
  }
  const current = shared(TASKS_WAITING);
  const isObject = current !== null && typeof current === "object" && !Array.isArray(current);
  if (!isObject || sortedEntries(current) !== sortedEntries(map)) setShared(TASKS_WAITING, map);
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

      // The list paints first, so a slow `git`, `hws tidy status` or `hws todo list` cannot hold up a new row.
      fit(state);
      cx.notify();
      if (!listOnly) {
        // A throwaway's folder is its scratch folder, so git is never asked there.
        const extras = await Promise.all(state.workspaces.map((w) => Promise.all([w.id, w.kind === "throwaway" ? 0 : aheadOf(w.folder), freshnessOf(w), waitingOf(w)])));
        state.ahead = Object.fromEntries(extras.map(([id, ahead]) => [id, ahead]));
        state.fresh = Object.fromEntries(extras.map(([id, , fresh]) => [id, fresh]));
        state.waiting = Object.fromEntries(extras.map(([id, , , waiting]) => [id, waiting]));
        const { unfiled, open } = await loose();
        state.unfiled = unfiled;
        state.openWindows = open;
        publishWaiting(state.workspaces, state.waiting);
        state.windowPx = await windowHeight();
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

function rowsPx(state) {
  const shown = spaces();
  const px = state.workspaces.reduce((sum, w) => sum + ROW_PX + shownChildren(state, w, membersOf(w, shown)).length * SPACE_ROW_PX, 0);
  return unfiledPx(state) + Math.max(px, ROW_PX) + archivedRowCount(state) * SPACE_ROW_PX;
}

const verticalPadding = (node) => (Array.isArray(node.padding) ? node.padding[0] : (node.padding ?? 0)) * 2;

// The window height less every other block in the sidebar, each at its fixed size or its min.
function maxListPx(state) {
  const path = pathTo(layout(), NODE);
  if (!state.windowPx || !path) return FALLBACK_MAX_LIST_PX;
  let px = state.windowPx - (window()?.titlebar === "none" ? 0 : SYSTEM_TITLEBAR_PX);
  for (let i = 0; i < path.length - 1; i += 1) {
    const parent = path[i];
    if (parent.type !== "column") continue;
    const shown = parent.children.filter((c) => !c.hidden);
    px -= verticalPadding(parent) + (parent.gap ?? 0) * (shown.length - 1);
    for (const sibling of shown) if (sibling !== path[i + 1]) px -= sibling.size?.px ?? sibling.min ?? 0;
  }
  return Math.max(px - HEADING_PX - BOTTOM_PX, ROW_PX);
}

const listPx = (state) => Math.min(rowsPx(state), maxListPx(state));

// The block can come out shorter than asked, so its measured height counts too.
export function overflows(state) {
  const measured = state.blockPx ? state.blockPx - HEADING_PX - BOTTOM_PX : Infinity;
  return rowsPx(state) > Math.min(maxListPx(state), measured);
}

// A height this mod neither set nor is still waiting on came from a drag on the divider.
// Dragging up caps the list, which then scrolls. Dragging down to every row clears the cap.
function takeDrag(state, now, full) {
  if (state.fitPx == null || now == null || now === state.fitPx || now === state.fitFrom) return;
  const dragged = now - HEADING_PX - BOTTOM_PX;
  state.capPx = dragged < full ? Math.max(ROW_PX, dragged) : null;
  try {
    if (state.capPx == null) localStorage.removeItem(CAP_KEY);
    else localStorage.setItem(CAP_KEY, String(state.capPx));
  } catch {
    // The cap still holds for this window.
  }
}

// Sizes the block to its rows, so an empty section leaves no gap above Spaces.
function fit(state) {
  const block = findNode(layout(), NODE);
  if (!block || !state.workspaces) return;
  const now = block.size?.px;
  let px = HEADING_PX;
  if (!isNarrow()) {
    const full = listPx(state);
    takeDrag(state, now, full);
    px = HEADING_PX + Math.min(full, state.capPx ?? Infinity) + BOTTOM_PX;
  }
  if (now === px) {
    state.fitPx = px;
    state.fitFrom = null;
    return;
  }
  if (state.fitPx !== px) {
    state.fitFrom = now;
    state.fitPx = px;
  }
  run("layout.resize", { id: NODE, px });
}

function savedCap() {
  try {
    const px = Number(localStorage.getItem(CAP_KEY));
    return px > 0 ? px : null;
  } catch {
    return null;
  }
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
    waiting: {},
    unfiled: 0,
    openWindows: {},
    windowPx: null,
    blockPx: null,
    hovered: null,
    capPx: savedCap(),
    fitPx: null,
    fitFrom: null,
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
    .size(CHEVRON_PX)
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

// The minus shows only while the pointer is over its row.
function trackHover(state, id) {
  return (isHovered, cx) => {
    if (isHovered) state.hovered = id;
    else if (state.hovered === id) state.hovered = null;
    else return;
    cx.notify();
  };
}

function waitingBadge(t, workspace, count) {
  return div()
    .id(`sidebar-waiting-${workspace.id}`)
    .min_w(15)
    .h(15)
    .px(4)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(8)
    .bg(t.blocked + "26")
    .text_color(t.blocked)
    .text_size(10)
    .font_semibold()
    .child(String(count))
    .tooltip(`${count} waiting on you`);
}

function spaceRow(t, state, workspace, space, canRemove) {
  const isBoard = workspace.board?.space === space.id;
  const waiting = isBoard ? (state.waiting?.[workspace.id] ?? 0) : 0;
  const showsMinus = !isBoard && canRemove && state.hovered === space.id;
  return h_flex()
    .id(`sidebar-space-${space.id}`)
    .h(SPACE_ROW_PX)
    .flex_none()
    .pl(CHILD_INSET_PX)
    .pr(4)
    .gap(8)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_size(12.5)
    .text_color(space.active ? t.foreground : t.muted)
    .when(space.active, (el) => el.bg(t.selected))
    .when(!space.active, (el) => el.hover((s) => s.bg(t.hover)))
    .on_hover(trackHover(state, space.id))
    .on_click(() => (isBoard ? showBoard(workspace.board) : run("space.select", { id: space.id })))
    .when(!isBoard, (el) => el.on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      openSpaceMenu({ space: space.id, workspace: workspace.id, workspaceName: workspace.name, canLeave: canRemove });
    }))
    .child(svg(isBoard ? "mods/hws-panel/board.svg" : icon("terminal")).size(12).flex_none())
    .child(div().flex_1().min_w(0).truncate().child(isBoard ? "Tasks" : space.name || workspace.name))
    .when(waiting > 0, (el) => el.child(waitingBadge(t, workspace, waiting)))
    .when(Boolean(space.status), (el) => el.child(statusDot(t, space.status)))
    .when(showsMinus, (el) => el.child(iconButton(t, `sidebar-remove-${space.id}`, "minus", 18, (cx) => removeSpace(state, space.id, cx)).tooltip("Take out of this workspace. The space stays open.")));
}

// Brings each of a workspace's open windows forward.
function raiseWindows(state, ids, cx) {
  changeThenLoad(state, cx, async () => {
    for (const id of ids) await hws(["surface", "resume", "--id", id]);
  });
}

function windowsBadge(t, state, workspace, ids) {
  const label = ids.length === 1 ? "1 open window" : `${ids.length} open windows`;
  return h_flex()
    .id(`sidebar-windows-${workspace.id}`)
    .flex_none()
    .h(18)
    .px(3)
    .gap(3)
    .items_center()
    .rounded(4)
    .cursor_pointer()
    .text_size(11)
    .text_color(t.dim)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      raiseWindows(state, ids, cx);
    })
    .child(svg("mods/hws-panel/window.svg").size(11).flex_none())
    .child(String(ids.length))
    .tooltip(label);
}

// An open workspace's menu also offers Add space and Add tasks.
function menuTarget(workspace, archived, space = null) {
  const target = { workspace: workspace.id, name: workspace.name, kind: workspace.kind, archived, space };
  return archived ? target : { ...target, spaces: workspace.spaces, board: Boolean(workspace.board) };
}

function rightClick(workspace, archived, space) {
  return (_e, cx) => {
    cx.stop_propagation();
    openRowMenu(menuTarget(workspace, archived, space));
  };
}

function tile(t, workspace, isActive) {
  return h_flex()
    .id(`sidebar-tile-${workspace.id}`)
    .size(TILE_PX)
    .flex_none()
    .rounded(5)
    .bg(tileFill(t, workspace))
    .when(!isActive, (el) => el.opacity(0.7))
    .items_center()
    .justify_center()
    .text_size(10.5)
    .font_bold()
    .text_color("#ffffff")
    .child([...workspace.name][0]?.toUpperCase() ?? "?");
}

// The active workspace row takes the selection only when no child row shows the active space.
function workspaceRow(t, state, workspace, members) {
  const isActive = isCurrent(members);
  const isSelected = isActive && !shownChildren(state, workspace, members).some((s) => s.active);
  const status = mostUrgent(members);
  const target = members.find((s) => s.active) ?? members[0];
  const ahead = state.ahead?.[workspace.id] ?? 0;
  const fresh = state.fresh?.[workspace.id] ?? null;
  const windows = state.openWindows?.[workspace.id] ?? [];
  return h_flex()
    .id(`sidebar-workspace-${workspace.id}`)
    .h(ROW_PX)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .when(isSelected, (el) => el.bg(t.selected))
    .when(!isSelected, (el) => el.hover((s) => s.bg(t.hover)))
    .on_click(() => target && run("space.select", { id: target.id }))
    .on_mouse_down("right", rightClick(workspace, false, target?.id ?? null))
    .child(childSpaces(workspace, members).length > 0 ? foldButton(t, state, workspace.id) : div().size(CHEVRON_PX).flex_none())
    .child(tile(t, workspace, isActive))
    .child(div().flex_1().min_w(0).truncate().text_color(isActive ? t.foreground : t.muted).child(workspace.name))
    .when(Boolean(fresh), (el) => el.child(div().id(`sidebar-fresh-${workspace.id}`).flex_none().child(freshnessDot(t, fresh.level)).tooltip(fresh.title)))
    .when(workspace.kind === "throwaway", (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child("Throwaway")))
    .when(windows.length > 0, (el) => el.child(windowsBadge(t, state, workspace, windows)))
    .when(Boolean(status), (el) => el.child(statusDot(t, status)))
    .when(ahead > 0, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.ansi2).child(`↑${ahead}`)))
    .when(isActive, (el) => el.child(iconButton(t, "sidebar-panel", "panel-right", 22, () => run("mod.open", { name: "hws-panel" })).tooltip("Show or hide the workspace panel")));
}

// Unfiled sits above the workspaces, and shows only while something is in it.
const unfiledPx = (state) => (state.unfiled > 0 ? ROW_PX : 0);

function unfiledRow(t, state) {
  return h_flex()
    .id("sidebar-unfiled")
    .h(ROW_PX)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click(() => openUnfiled())
    .tooltip("Sketches, notes and pages that belong to no workspace")
    .child(div().size(CHEVRON_PX).flex_none())
    .child(h_flex().size(TILE_PX).flex_none().items_center().justify_center().child(svg("mods/hws-panel/inbox.svg").size(14)))
    .child(div().flex_1().min_w(0).truncate().child("Unfiled"))
    .child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(state.unfiled)));
}

const unfiledRows = (t, state) => (state.unfiled > 0 ? [unfiledRow(t, state)] : []);

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
  if (state.workspaces.length === 0) return [...unfiledRows(t, state), newRow(t), ...archivedRows(t, state)];
  const shown = spaces();
  const open = state.workspaces.flatMap((w) => {
    const members = membersOf(w, shown);
    const canRemove = workingSpaces(w, members).length >= 2;
    return [workspaceRow(t, state, w, members), ...shownChildren(state, w, members).map((space) => spaceRow(t, state, w, space, canRemove))];
  });
  return [...unfiledRows(t, state), ...open, ...archivedRows(t, state)];
}

// The scrollbar paints only while the rows overflow.
function list(t, state) {
  const isOver = Boolean(state.workspaces) && !state.problem && overflows(state);
  return v_flex()
    .id("sidebar-list")
    .flex_1()
    .min_h(0)
    .px(8)
    .when(isOver, (el) => el.overflow_y_scrollbar().mode("always"))
    .when(!isOver, (el) => el.overflow_y_scroll())
    .children(rows(t, state));
}

export function drawSidebar(state) {
  const t = theme();
  const isCollapsed = isNarrow();
  return v_flex()
    .id("sidebar-root")
    .size_full()
    .min_h(0)
    .bg(t.chrome)
    .text_size(13)
    .on_size_change(({ height }, cx) => {
      if (state.blockPx === height) return;
      state.blockPx = height;
      cx.notify();
    })
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
    .when(!isCollapsed, (el) => el.child(list(t, state)));
}
