// Work that belongs to no workspace, and the dialog that files a surface or
// an artifact under a workspace.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { closeOverlay, focused, openOverlay, props } from "herdr";
import { hws, message, submitDialog, formKeys, dialogRoot, dialogFooter, button, problemLine } from "./hws.js";
import { ago, lifetimeLabel, trashLabel, typeLabel } from "./context.js";
import { openCite } from "./cites.js";

const MOD = "hws-panel";
const UNFILED_DIALOG = { width: 640, height: 480 };
const MOVE_DIALOG = { width: 440, height: 420 };

// `standalone` is the workspace id hws gives work that belongs to no workspace.
export const STANDALONE = "standalone";

const icon = (name) => `mods/workspace-chrome/${name}.svg`;

export const STATE_LABELS = { open: "open", draft: "draft", pane: "in a pane" };

// The move dialog's verbs. Save and Keep file the item and hold it for good.
const MOVE_MODES = {
  move: { heading: (title) => `Move ${title} to a workspace`, busy: "Moving…" },
  save: { heading: (title) => `Save ${title} to a workspace`, busy: "Saving…" },
  keep: { heading: (title) => `Keep ${title} in a workspace`, busy: "Keeping…" },
};

export function openUnfiled() {
  openOverlay({ mod: MOD, kind: "dialog", modal: true, ...UNFILED_DIALOG, props: { view: "unfiled" } });
}

// `item` is `{ kind: "surface" | "artifact", id, title, from, mode? }`, where `mode` is
// "save" or "keep" for a pick that also holds the item.
export function openMoveItem(item) {
  openOverlay({ mod: MOD, kind: "dialog", modal: true, ...MOVE_DIALOG, props: { view: "move-item", ...item } });
}

// A failed or empty reply counts as nothing unfiled.
export function unfiledOf(reply) {
  const surfaces = Array.isArray(reply?.surfaces) ? reply.surfaces : [];
  const artifacts = Array.isArray(reply?.artifacts) ? reply.artifacts : [];
  return { surfaces, artifacts };
}

// Unfiled

function loadUnfiled(view, cx) {
  cx.spawn(async (cx) => {
    try {
      view.unfiled = unfiledOf(await hws(["unfiled"]));
    } catch (e) {
      view.unfiled = { surfaces: [], artifacts: [] };
      view.problem = message(e);
    }
    cx.notify();
  });
}

export function initUnfiled(view, cx) {
  view.unfiled = null;
  view.handle.focus();
  loadUnfiled(view, cx);
}

// Runs one row action, then lists again. The dialog stays open.
function act(view, key, work, cx) {
  if (view.busy) return;
  view.busy = key;
  view.problem = null;
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      await work();
    } catch (e) {
      view.problem = message(e);
    }
    view.busy = null;
    loadUnfiled(view, cx);
  });
}

// An open window comes forward and a draft starts again. A pane is shown where it is.
function openSurface(surface) {
  if (surface.state === "pane") return hws(["surface", "pop", "--id", surface.id, "--to", "pane"]);
  return hws(["surface", "resume", "--id", surface.id]);
}

// Opens a saved bundle the way an [artifact:ID] cite does, as a page of its own.
function openSaved(artifact) {
  const record = { ...artifact, prompt: `${artifact.path}/prompt.md` };
  const workspace = { id: STANDALONE, artifacts: [record], surfaces: [], folder: "" };
  return openCite({ kind: "artifact", value: artifact.id }, { workspace, target: null, space: focused()?.space ?? null });
}

function moveItem(item) {
  closeOverlay(props().overlay);
  openMoveItem({ ...item, from: STANDALONE });
}

function smallButton(t, id, text, action, { enabled = true, tip = null } = {}) {
  return h_flex()
    .id(id)
    .flex_none()
    .h(24)
    .px(8)
    .items_center()
    .rounded(6)
    .border_1()
    .border_color(t.input)
    .bg(t.raised)
    .text_size(12)
    .opacity(enabled ? 1 : 0.45)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .child(text);
}

function itemRow(t, { id, glyph, title, detail, actions }) {
  return h_flex()
    .id(`unfiled-${id}`)
    .h(36)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .hover((s) => s.bg(t.hover))
    .child(svg(glyph).size(13).flex_none().text_color(t.dim))
    .child(div().flex_1().min_w(0).truncate().child(title))
    .child(div().flex_none().text_size(11.5).text_color(t.dim).child(detail))
    .children(actions);
}

// An open window or a pane has no draft to trash yet.
function trashTip(surface) {
  if (surface.state === "open") return "Close the window first";
  if (surface.state === "pane") return "Close the pane first";
  return null;
}

// Saving an unfiled surface moves it, so Save… needs its own window, as Move… does.
function surfaceRow(t, view, surface, now) {
  const title = !surface.title || surface.title === surface.type ? typeLabel(surface.type) : surface.title;
  const detail = [typeLabel(surface.type), STATE_LABELS[surface.state] ?? surface.state, trashLabel(surface.expiresAt, now)].filter(Boolean).join(" · ");
  const moves = { enabled: !view.busy && surface.state !== "pane", tip: surface.state === "pane" ? "Pop it out to its own window first" : null };
  const canSave = !surface.saved && surface.type !== "questions";
  return itemRow(t, {
    id: surface.id,
    glyph: icon(surface.type === "note" ? "file-text" : surface.type === "page" ? "files" : "square-pen"),
    title,
    detail: view.busy?.endsWith(surface.id) ? "Working…" : detail,
    actions: [
      smallButton(t, `unfiled-open-${surface.id}`, "Open", (_e, cx) => act(view, `open-${surface.id}`, () => openSurface(surface), cx), { enabled: !view.busy }),
      smallButton(t, `unfiled-move-${surface.id}`, "Move…", () => moveItem({ kind: "surface", id: surface.id, title }), moves),
      ...(canSave ? [smallButton(t, `unfiled-save-${surface.id}`, "Save…", () => moveItem({ kind: "surface", id: surface.id, title, mode: "save" }), moves)] : []),
      smallButton(t, `unfiled-trash-${surface.id}`, "Trash", (_e, cx) => act(view, `trash-${surface.id}`, () => hws(["surface", "discard", "--id", surface.id]), cx), {
        enabled: !view.busy && surface.state === "draft",
        tip: trashTip(surface),
      }),
    ],
  });
}

// A round-trip goes to the Trash once its terminal ends, unless it is kept.
function artifactRow(t, view, artifact, now) {
  const title = artifact.title || typeLabel(artifact.type) || artifact.id;
  const detail = [lifetimeLabel(artifact, now) ?? "saved", artifact.createdAt && ago(now - artifact.createdAt)].filter(Boolean).join(" · ");
  return itemRow(t, {
    id: artifact.id,
    glyph: icon("archive"),
    title,
    detail: view.busy?.endsWith(artifact.id) ? "Working…" : detail,
    actions: [
      smallButton(t, `unfiled-open-${artifact.id}`, "Open", (_e, cx) => act(view, `open-${artifact.id}`, () => openSaved(artifact), cx), { enabled: !view.busy }),
      smallButton(t, `unfiled-move-${artifact.id}`, "Move…", () => moveItem({ kind: "artifact", id: artifact.id, title }), { enabled: !view.busy }),
      ...(artifact.transient ? [smallButton(t, `unfiled-keep-${artifact.id}`, "Keep…", () => moveItem({ kind: "artifact", id: artifact.id, title, mode: "keep" }), { enabled: !view.busy })] : []),
      smallButton(t, `unfiled-trash-${artifact.id}`, "Trash", (_e, cx) => act(view, `trash-${artifact.id}`, () => hws(["artifact", "trash", artifact.id]), cx), { enabled: !view.busy }),
    ],
  });
}

const groupTitle = (t, text) => div().flex_none().pt(6).pb(2).px(8).text_size(11.5).text_color(t.dim).child(text);

export function renderUnfiled(t, view) {
  const p = props();
  const dismiss = () => closeOverlay(p.overlay);
  const { surfaces, artifacts } = view.unfiled ?? { surfaces: [], artifacts: [] };
  const now = Date.now();
  const isEmpty = view.unfiled !== null && surfaces.length + artifacts.length === 0;
  return dialogRoot(t, "hws-unfiled")
    .track_focus(view.handle)
    .on_key_down(formKeys(view, dismiss))
    .child(
      v_flex()
        .flex_1()
        .min_h(0)
        .p(18)
        .gap(10)
        .child(div().flex_none().text_size(15).font_semibold().child("Unfiled"))
        .child(div().flex_none().text_color(t.muted).whitespace_normal().child("Sketches, notes and pages that belong to no workspace. Move one to file it."))
        .child(
          v_flex()
            .id("hws-unfiled-list")
            .flex_1()
            .min_h(0)
            .overflow_y_scrollbar()
            .when(view.unfiled === null, (el) => el.child(div().h(32).flex_none().px(8).flex().items_center().text_color(t.dim).child("Loading…")))
            .when(isEmpty, (el) => el.child(div().h(32).flex_none().px(8).flex().items_center().text_color(t.dim).child("Nothing is unfiled.")))
            .when(surfaces.length > 0, (el) => el.child(groupTitle(t, "Open and drafts")).children(surfaces.map((s) => surfaceRow(t, view, s, now))))
            .when(artifacts.length > 0, (el) => el.child(groupTitle(t, "Saved")).children(artifacts.map((a) => artifactRow(t, view, a, now)))),
        )
        .when(Boolean(view.problem), (el) => el.child(problemLine(t, view.problem))),
    )
    .child(dialogFooter().child(button(t, "close", "Close", false, dismiss)));
}

// Move to a workspace

export function initMoveItem(view, cx) {
  const p = props();
  view.targets = null;
  view.handle.focus();
  cx.spawn(async (cx) => {
    try {
      const reply = await hws(["surface", "targets", ...(p.kind === "surface" ? ["--id", p.id] : [])]);
      view.targets = {
        current: reply?.current ?? p.from ?? null,
        suggested: reply?.suggested ?? null,
        workspaces: Array.isArray(reply?.workspaces) ? reply.workspaces : [],
      };
    } catch (e) {
      view.targets = { current: p.from ?? null, suggested: null, workspaces: [] };
      view.problem = message(e);
    }
    cx.notify();
  });
}

function moveCommand({ kind, id, mode }, workspaceId) {
  if (mode === "save") return ["surface", "save", "--id", id, "--workspace", workspaceId];
  if (mode === "keep") return ["artifact", "keep", id, "--workspace", workspaceId];
  return kind === "artifact" ? ["artifact", "move", id, "--workspace", workspaceId] : ["surface", "move", "--id", id, "--workspace", workspaceId];
}

function moveTo(view, workspaceId, cx) {
  submitDialog(view, `move-${workspaceId}`, () => hws(moveCommand(props(), workspaceId)), cx);
}

const modeOf = (p) => MOVE_MODES[p.mode] ?? MOVE_MODES.move;

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
    .child(svg(glyph).size(13).flex_none().text_color(t.dim))
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(Boolean(detail), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(detail)));
}

function workspaceRow(t, view, workspace, suggested) {
  const moving = view.busy === `move-${workspace.id}`;
  const detail = moving ? modeOf(props()).busy : suggested ? "The space you are in" : workspace.kind === "throwaway" ? "Throwaway" : null;
  return destinationRow(t, view, { id: `move-to-${workspace.id}`, glyph: icon("layers"), label: workspace.name, detail, onClick: (_e, cx) => moveTo(view, workspace.id, cx) });
}

export function renderMoveItem(t, view) {
  const p = props();
  const dismiss = () => closeOverlay(p.overlay);
  const targets = view.targets;
  const others = (targets?.workspaces ?? []).filter((w) => w.id !== targets.current && w.id !== targets.suggested);
  const suggested = (targets?.workspaces ?? []).find((w) => w.id === targets?.suggested && w.id !== targets.current) ?? null;
  const mode = modeOf(p);

  // Save and Keep file the item, so they never offer Unfiled.
  const canUnfile = !p.mode && Boolean(targets) && targets.current !== STANDALONE && targets.current !== null;
  const unfile = destinationRow(t, view, {
    id: "move-to-standalone",
    glyph: "mods/hws-panel/inbox.svg",
    label: "Unfiled",
    detail: view.busy === `move-${STANDALONE}` ? "Moving…" : "Belongs to no workspace",
    onClick: (_e, cx) => moveTo(view, STANDALONE, cx),
  });
  const isEmpty = Boolean(targets) && !suggested && others.length === 0 && !canUnfile;
  return dialogRoot(t, "hws-move-item")
    .track_focus(view.handle)
    .on_key_down(formKeys(view, dismiss))
    .child(
      v_flex()
        .flex_1()
        .min_h(0)
        .p(18)
        .gap(10)
        .child(div().flex_none().text_size(15).font_semibold().truncate().child(mode.heading(p.title || "this")))
        .when(p.kind === "surface", (el) => el.child(div().flex_none().text_color(t.muted).whitespace_normal().child("An open window closes and opens again in its new workspace.")))
        .child(
          v_flex()
            .id("hws-move-item-list")
            .flex_1()
            .min_h(0)
            .overflow_y_scrollbar()
            .when(targets === null, (el) => el.child(div().h(32).flex_none().px(8).flex().items_center().text_color(t.dim).child("Loading…")))
            .when(Boolean(suggested), (el) => el.child(groupTitle(t, "Suggested")).child(workspaceRow(t, view, suggested, true)))
            .when(others.length > 0, (el) => el.child(groupTitle(t, suggested ? "Other workspaces" : "Workspaces")).children(others.map((w) => workspaceRow(t, view, w, false))))
            .when(canUnfile, (el) => el.child(groupTitle(t, "Or")).child(unfile))
            .when(isEmpty, (el) => el.child(div().h(32).flex_none().px(8).flex().items_center().text_color(t.dim).child("No open workspace to move it to."))),
        )
        .when(Boolean(view.problem), (el) => el.child(problemLine(t, view.problem))),
    )
    .child(dialogFooter().child(button(t, "cancel", "Cancel", false, dismiss)));
}
