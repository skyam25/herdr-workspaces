// The panel's sections, one function each.
//
// Each takes `{ t, host, workspace, target, now }`. `t` is the theme, `target` the
// agent new surfaces attach to (or null) and `host` the Panel view that owns the state.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, TextView } from "gpui-base";
import { run } from "herdr";
import { tilde } from "./hws.js";
import { revealLabel, showBoard } from "./cites.js";
import { openArtifactMenu } from "./artifactmenu.js";
import { openRowMenu, openStageMenu } from "./rowmenu.js";
import { BACKLOG_ROWS, FRESHNESS_COLOR, agentName, ago, artifactGroups, backlog, citeLabel, countsLine, feedbackRounds, freshness, isNote, linkCite, livePass, placeRows, recordedSessions, roundFiles, tasksLine, typeLabel } from "./context.js";

const STATUS_COLOR = { draft: "ansi3", current: "ansi2", superseded: "dim" };

// A small dim label, so a section title never reads as one of the note's headings.
export function sectionTitle(t, title) {
  return div().px(8).pb(4).text_size(11.5).font_medium().text_color(t.dim).child(title);
}

function smallButton(t, id, text, action, enabled = true) {
  return div()
    .id(id)
    .flex_none()
    .px(6)
    .h(20)
    .flex()
    .items_center()
    .rounded(5)
    .border_1()
    .border_color(t.border)
    .text_size(11)
    .text_color(enabled ? t.muted : t.dim)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground)).on_click(action))
    .child(text);
}

// The one filled button in the panel, for its main action.
function filledButton(t, id, text, action, enabled = true) {
  return div()
    .id(id)
    .flex_none()
    .px(8)
    .h(20)
    .flex()
    .items_center()
    .rounded(5)
    .border_1()
    .border_color(t.solid)
    .bg(t.solid)
    .text_size(11)
    .font_medium()
    .text_color(t.solid_foreground)
    .opacity(enabled ? 1 : 0.5)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action))
    .child(text);
}

// A ring, so it never reads as the agent status dot beside it.
export const freshnessDot = (t, level) => div().size(8).flex_none().rounded(4).border_1().border_color(t[FRESHNESS_COLOR[level]]);

const dimLine = (t, text) => div().px(8).text_size(12).text_color(t.dim).whitespace_normal().child(text);

function pill(t, text, color = t.muted) {
  return div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(color).child(text);
}

function chip(t, id, text, action) {
  return div()
    .id(id)
    .flex_none()
    .px(5)
    .h(18)
    .flex()
    .items_center()
    .rounded(4)
    .bg(t.raised)
    .text_size(10.5)
    .text_color(t.muted)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click(action)
    .child(text);
}

const isCurrentFor = (host, workspace) => (host.context?.workspaceId === workspace.id ? host.context : null);

// Header

function freshnessRow({ t, host, workspace, target }) {
  const context = isCurrentFor(host, workspace);
  const level = freshness(context?.status);
  const sentence = context ? context.line || "Freshness unknown" : "Checking…";
  const live = livePass(context?.status);
  return h_flex()
    .h(22)
    .gap(6)
    .items_center()
    .when(Boolean(level), (el) => el.child(freshnessDot(t, level)))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(sentence))
    .child(filledButton(t, "tidy", live ? "Tidy again" : "Tidy", (_e, cx) => host.startTidy(workspace, cx), !host.busy))
    .child(smallButton(t, "open-current", "Open note", (_e, cx) => host.openCurrent(target, cx), Boolean(context?.currentPath && (target || context.current)) && !host.busy));
}

// Open cards by column, loaded beside the context. A workspace with no Board offers one.
function tasksRow({ t, host, workspace }) {
  if (!workspace.board) {
    return h_flex()
      .h(22)
      .gap(6)
      .items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child("No task list yet"))
      .child(smallButton(t, "add-tasks", host.busy === "add-tasks" ? "Adding…" : "Add tasks", (_e, cx) => host.addTasks(workspace, cx), !host.busy));
  }
  const tasks = host.tasks?.workspaceId === workspace.id ? host.tasks : null;
  const counts = !tasks ? "Checking…" : tasks.counts ? tasksLine(tasks.counts) : "";
  return h_flex()
    .id("tasks-row")
    .h(22)
    .gap(8)
    .items_center()
    .rounded(5)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(() => showBoard(workspace.board))
    .child(div().flex_none().text_size(11.5).font_medium().text_color(t.foreground).child("Tasks"))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(counts));
}

// The folder name sits at the end, so the middle gives way first.
const pathText = (t, path) => div().min_w(0).truncate().text_ellipsis_middle().text_color(t.dim).child(tilde(path));

const labeledPath = (t, id, label, path) => h_flex().id(id).gap(4).text_size(11).text_color(t.dim).child(div().flex_none().child(label)).child(pathText(t, path));

// A separate home gets a line of its own, so each path gives way only once.
function folderLines(t, workspace) {
  if (!workspace.home) return [pathText(t, workspace.folder).id("header-folder").text_size(11)];
  return [labeledPath(t, "header-runs-in", "Runs in", workspace.folder), labeledPath(t, "header-files-in", "Files in", workspace.home)];
}

function workspaceMenu(workspace) {
  openRowMenu({ workspace: workspace.id, name: workspace.name, kind: workspace.kind, archived: false, space: null });
}

// What the workspace is sits above a gap, and how its context stands sits below.
export function headerSection(view) {
  const { t, host, workspace } = view;
  const isThrowaway = workspace.kind === "throwaway";
  const firstLine = workspace.instructions ? workspace.instructions.split("\n")[0] : "";
  const identity = v_flex()
    .id("header-identity")
    .gap(3)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(workspace.name))
        .child(isThrowaway ? div().flex_none().text_size(11).text_color(t.dim).child("Throwaway") : smallButton(t, "stage", workspace.stage || "Set stage", () => openStageMenu(workspace)))
        .child(smallButton(t, "workspace-menu", "···", () => workspaceMenu(workspace)).tooltip(isThrowaway ? "Rename or close" : "Rename or archive")),
    )
    .when(!isThrowaway, (el) => el.children(folderLines(t, workspace)))
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(firstLine ? t.muted : t.dim).child(firstLine || "No instructions yet"))
        .child(smallButton(t, "edit-instructions", "Instructions…", () => host.openInstructions(workspace))),
    );
  return v_flex()
    .flex_none()
    .px(14)
    .py(10)
    .border_b(1)
    .border_color(t.border)
    .child(identity)
    .when(!isThrowaway, (el) => el.child(v_flex().id("header-state").mt(10).gap(2).child(freshnessRow(view)).child(tasksRow(view))));
}

// Current

function citeChips(t, host, workspace, key, cites) {
  return cites.map((cite, i) => chip(t, `cite-${key}-${i}`, citeLabel(cite, workspace), (_e, cx) => host.citeAction(cite, workspace, cx)));
}

function noteMarkdown(host, workspace, line, i) {
  return TextView.markdown(`note-${workspace.id}-${i}`, line.text || " ")
    .selectable(true)
    .on_link_click((url, cx) => {
      const cite = linkCite(url, host.context?.currentPath);
      if (cite) host.citeAction(cite, workspace, cx);
    });
}

function noteLine(t, host, workspace, line, i) {
  if (line.kind === "table") {
    return v_flex()
      .flex_none()
      .px(8)
      .py(4)
      .gap(4)
      .text_size(12)
      .text_color(t.foreground)
      .child(noteMarkdown(host, workspace, line, i))
      .when(line.cites.length > 0, (el) => el.child(h_flex().flex_wrap().gap(4).children(citeChips(t, host, workspace, i, line.cites))));
  }
  const words = div()
    .flex_1()
    .min_w(0)
    .whitespace_normal()
    .when(line.kind === "heading", (el) => el.pt(8).font_semibold().text_color(t.foreground).text_size(line.level === 1 ? 15 : 14).child(line.text || " "))
    .when(line.kind !== "heading", (el) => el.text_size(12).text_color(t.foreground).child(noteMarkdown(host, workspace, line, i)));
  return h_flex()
    .flex_none()
    .px(8)
    .gap(6)
    .items_start()
    .when(line.kind === "bullet", (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child("•")))
    .child(words)
    .children(citeChips(t, host, workspace, i, line.cites));
}

// The note's own "# Current" title would repeat the section title.
const isNoteTitle = (line, i) => i === 0 && line.kind === "heading" && /^current$/i.test(line.text);

export function currentSection({ t, host, workspace }) {
  const context = isCurrentFor(host, workspace);
  const note = context?.current;
  const lines = host.showWholeNote ? note?.all : note?.lines;
  return v_flex()
    .flex_none()
    .gap(3)
    .child(sectionTitle(t, "Current note"))
    .when(!context, (el) => el.child(dimLine(t, "Loading…")))
    .when(Boolean(context) && !note, (el) => el.child(dimLine(t, context.currentPath ? `A short summary of where this work stands. Tidy writes it to ${tilde(context.currentPath)}.` : "A short summary of where this work stands. Tidy writes it.")))
    .when(Boolean(note), (el) =>
      el
        .children(lines.map((line, i) => (isNoteTitle(line, i) ? null : noteLine(t, host, workspace, line, i))).filter(Boolean))
        .when(note.more > 0, (inner) =>
          inner.child(smallButtonRow(t, "note-more", host.showWholeNote ? "Show fewer" : `${note.more} more ${note.more === 1 ? "line" : "lines"}`, (_e, cx) => {
            host.showWholeNote = !host.showWholeNote;
            cx.notify();
          })),
        ),
    );
}

// Since last tidy

function backlogRowView(t, host, workspace, row, i, now) {
  return h_flex()
    .id(`since-${i}`)
    .h(22)
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .when(Boolean(row.cite), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => host.citeAction(row.cite, workspace, cx)))
    .child(div().flex_none().w(52).text_size(11).text_color(t.dim).child(row.source))
    .child(div().flex_1().min_w(0).truncate().text_size(12).child(row.title))
    .when(Boolean(row.at), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(now - row.at))));
}

export function sinceSection({ t, host, workspace, now }) {
  const context = isCurrentFor(host, workspace);
  const status = context?.status ?? null;
  const rows = backlog(status);
  const shown = host.showAllBacklog ? rows : rows.slice(0, BACKLOG_ROWS);
  const live = livePass(status);
  return v_flex()
    .flex_none()
    .gap(1)
    .child(sectionTitle(t, "Not in the note yet"))
    .when(!context, (el) => el.child(dimLine(t, "Loading…")))
    .when(Boolean(context) && !status, (el) => el.child(dimLine(t, context.statusProblem ? `Freshness unavailable. ${context.statusProblem}` : "Freshness unavailable.")))
    .when(Boolean(status), (el) =>
      el
        .child(div().px(8).pb(2).text_size(11.5).text_color(t.muted).child(countsLine(status.behind)))
        .when(Boolean(live), (inner) =>
          inner.child(
            h_flex()
              .id("tidy-live")
              .h(22)
              .px(8)
              .items_center()
              .rounded(6)
              .text_size(12)
              .text_color(t.working)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .on_click(() => run("agent.focus", { terminal: live.terminal }))
              .child("A tidy pass is running. Click to go to it."),
          ),
        )
        .children(shown.map((row, i) => backlogRowView(t, host, workspace, row, i, now)))
        .when(rows.length > BACKLOG_ROWS, (inner) =>
          inner.child(smallButtonRow(t, "since-more", host.showAllBacklog ? "Show fewer" : `${rows.length - BACKLOG_ROWS} more`, (_e, cx) => {
            host.showAllBacklog = !host.showAllBacklog;
            cx.notify();
          })),
        ),
    );
}

const smallButtonRow = (t, id, text, action) => h_flex().px(8).pt(2).child(smallButton(t, id, text, action));

// A short row that opens something in the reader. A muted row brightens on hover.
function readerRow(t, { id, label, detail, open, muted = false, indent = false }) {
  return h_flex()
    .id(id)
    .flex_none()
    .h(22)
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .when(muted, (el) => el.text_color(t.muted))
    .hover((s) => (muted ? s.bg(t.hover).text_color(t.foreground) : s.bg(t.hover)))
    .on_click(open)
    .when(indent, (el) => el.child(div().flex_none().w(8)))
    .child(div().flex_1().min_w(0).truncate().text_size(12).child(label))
    .when(Boolean(detail), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(detail)));
}

// History

// The decision log and update log a past pass left behind.
export function historySection({ t, host, workspace }) {
  const record = isCurrentFor(host, workspace)?.status?.record;
  if (!record?.decisions && !record?.updates) return null;
  const row = (id, title, detail, path) => readerRow(t, { id, label: title, detail, open: (_e, cx) => host.openReader({ title, candidates: [path], reveal: path }, cx) });
  const { decisions, updates } = record;
  return v_flex()
    .flex_none()
    .gap(1)
    .child(sectionTitle(t, "History"))
    .when(Boolean(decisions), (el) => el.child(row("history-decisions", "Decision log", decisions ? `${decisions.inForce} in force · ${decisions.replaced} replaced` : "", decisions?.path)))
    .when(Boolean(updates), (el) => el.child(row("history-updates", "Updates", "", updates)));
}

// Artifacts

// A round of feedback is a message to the agent, so it reads in the panel and takes no comments.
// `label` is its own title when it stands alone, and "Feedback" under the page it reviews.
function roundRow(t, host, round, now, label) {
  const open = (_e, cx) => host.openReader({ title: round.title || "Feedback", candidates: roundFiles(round), reveal: round.prompt ?? round.path }, cx);
  return readerRow(t, { id: `round-${round.id}`, label: label ?? "Feedback", detail: ago(now - (round.createdAt ?? now)), open, muted: true, indent: !label });
}

// One line each. The title and Open go to the companion, and the menu holds the rest.
// A page with feedback gains a count that unfolds its rounds beneath it.
function artifactRow(t, host, workspace, artifact, now, rounds = []) {
  const { status } = artifact;
  const open = (_e, cx) => host.citeAction({ kind: "artifact", value: artifact.id }, workspace, cx);
  const unfolded = rounds.length > 0 && host.showRounds.has(artifact.id);
  const toggle = (_e, cx) => {
    if (unfolded) host.showRounds.delete(artifact.id);
    else host.showRounds.add(artifact.id);
    cx.notify();
  };
  const row = h_flex()
    .flex_none()
    .h(26)
    .px(8)
    .gap(8)
    .items_center()
    .child(
      div()
        .id(`artifact-open-${artifact.id}`)
        .flex_1()
        .min_w(0)
        .truncate()
        .cursor_pointer()
        .text_color(status === "superseded" ? t.muted : t.foreground)
        .hover((s) => s.text_color(t.accent))
        .on_click(open)
        .child(artifact.title || artifact.id),
    )
    .when(Boolean(status) && status !== "current", (el) => el.child(pill(t, status, t[STATUS_COLOR[status]])))
    .when(rounds.length > 0, (el) =>
      el.child(
        div()
          .id(`rounds-toggle-${artifact.id}`)
          .flex_none()
          .text_size(11)
          .text_color(unfolded ? t.foreground : t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.accent))
          .on_click(toggle)
          .child(`${rounds.length} feedback`),
      ),
    )
    .child(div().flex_none().text_size(11).text_color(t.dim).child(`${typeLabel(artifact.type)} · ${ago(now - (artifact.createdAt ?? now))}`))
    .child(smallButton(t, `open-${artifact.id}`, "Open", open))
    .child(smallButton(t, `more-${artifact.id}`, "···", () => openArtifactMenu(artifact)).tooltip("More ways to open"));
  return unfolded ? [row, ...rounds.map((round) => roundRow(t, host, round, now))] : [row];
}

// Current and draft items, then one row that folds the superseded ones.
// `rounds` maps an artifact's id to the feedback filed under it.
function artifactRows(t, host, workspace, now, items, suffix = "", rounds = {}) {
  const { shown, superseded } = artifactGroups(items);
  const rowsOf = (list) => list.flatMap((a) => artifactRow(t, host, workspace, a, now, rounds[a.id]));
  const rows = rowsOf(shown);
  if (superseded.length === 0) return rows;
  const fold = h_flex()
    .id(`superseded-toggle${suffix}`)
    .h(22)
    .px(8)
    .gap(6)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_size(12)
    .text_color(t.dim)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => {
      host.showSuperseded = !host.showSuperseded;
      cx.notify();
    })
    .child(`${host.showSuperseded ? "Hide" : "Show"} ${superseded.length} superseded`);
  return [...rows, fold, ...(host.showSuperseded ? rowsOf(superseded) : [])];
}

// Notes have their own folder, so they get their own list when there are any.
export function notesSection({ t, host, workspace, now }) {
  const notes = (workspace.artifacts ?? []).filter(isNote);
  if (notes.length === 0) return null;
  return v_flex().flex_none().gap(2).child(sectionTitle(t, "Notes")).children(artifactRows(t, host, workspace, now, notes, "-notes"));
}

export function artifactsSection({ t, host, workspace, now }) {
  const { under, loose } = feedbackRounds(workspace.artifacts);
  const rows = artifactRows(t, host, workspace, now, (workspace.artifacts ?? []).filter((a) => !isNote(a) && !a.role), "", under);
  return v_flex()
    .flex_none()
    .gap(2)
    .child(sectionTitle(t, "Artifacts"))
    .when(rows.length + loose.length === 0, (el) => el.child(dimLine(t, "None yet.")))
    .children(rows)
    .children(loose.map((round) => roundRow(t, host, round, now, round.title || round.id)));
}

// Reader

// A document opened from the panel, rendered in place of the panel's sections.
export function readerView({ t, host }) {
  const { title, text, reveal, isLoading } = host.reading;
  return v_flex()
    .id("hws-reader")
    .size_full()
    .min_h(0)
    .bg(t.background)
    .text_color(t.foreground)
    .text_size(13)
    .child(
      h_flex()
        .flex_none()
        .px(14)
        .py(8)
        .gap(8)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(smallButton(t, "reader-back", "Back", (_e, cx) => host.closeReader(cx)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(title))
        .child(smallButton(t, "reader-reveal", revealLabel(), (_e, cx) => host.reveal(reveal, cx))),
    )
    .child(
      v_flex()
        .id("hws-reader-body")
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .p(18)
        .when(isLoading, (el) => el.child(div().text_color(t.dim).child("Loading…")))
        .when(!isLoading && text === null, (el) => el.child(div().text_color(t.dim).child("This file is missing or can't be read.")))
        .when(typeof text === "string", (el) => el.child(TextView.markdown("reader-text", text || " ").selectable(true))),
    )
    .when(Boolean(host.note), (el) => el.child(div().flex_none().px(14).py(4).text_size(11).text_color(host.note.isError ? t.blocked : t.dim).whitespace_normal().child(host.note.text)));
}

// Places

// The label's tooltip shows where the role lands now. A place another tool
// writes is read only, because hws only reads there.
function placeRow(t, host, workspace, row) {
  const label = div()
    .id(`place-label-${row.role}`)
    .flex_none()
    .w(72)
    .text_size(12)
    .text_color(t.muted)
    .tooltip(row.resolved ? tilde(row.resolved) : "Unset")
    .child(row.role);
  if (row.writer) {
    return h_flex()
      .id(`place-${row.role}`)
      .h(28)
      .px(8)
      .gap(8)
      .items_center()
      .child(label)
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(row.path || tilde(row.resolved ?? "")))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(`written by ${row.writer}`));
  }
  const key = `place-${row.role}`;
  const typed = host.values[key].trim();
  const isDirty = typed !== host.placeSaved[row.role];
  const isFocused = host.focusedField === key;
  return h_flex()
    .id(`place-${row.role}`)
    .h(28)
    .px(8)
    .gap(8)
    .items_center()
    .child(label)
    .child(
      Input.new(host.inputs[key])
        .flex_1()
        .min_w(0)
        .h(24)
        .px(6)
        .rounded(5)
        .border_1()
        .border_color(isFocused ? t.accent : t.input)
        .bg(t.background)
        .text_size(12),
    )
    .when(isDirty, (el) => el.child(smallButton(t, `place-save-${row.role}`, host.busy === key ? "Saving…" : typed ? "Save" : "Clear", (_e, cx) => host.savePlace(workspace.id, row.role, cx), !host.busy)));
}

// Setup that rarely changes, so it starts folded.
function placesToggle(t, host) {
  return h_flex()
    .id("places-toggle")
    .h(22)
    .px(8)
    .gap(6)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_size(11.5)
    .font_medium()
    .text_color(t.dim)
    .hover((s) => s.bg(t.hover).text_color(t.muted))
    .on_click((_e, cx) => {
      host.showPlaces = !host.showPlaces;
      cx.notify();
    })
    .child(svg(`mods/workspace-chrome/chevron-${host.showPlaces ? "down" : "right"}.svg`).size(10).flex_none())
    .child("Where files go");
}

export function placesSection({ t, host, workspace, target }) {
  return v_flex()
    .flex_none()
    .gap(1)
    .child(placesToggle(t, host))
    .when(host.showPlaces, (el) =>
      el
        .children(placeRows(workspace, isCurrentFor(host, workspace)?.status).map((row) => placeRow(t, host, workspace, row)))
        .child(
          h_flex()
            .px(8)
            .pt(4)
            .gap(6)
            .items_center()
            .child(smallButton(t, "suggest-places", "Suggest from folder", (_e, cx) => host.suggestPlaces(target, cx), Boolean(target) && !host.busy))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(target ? `Asks ${agentName(target)} to propose where files go` : "Needs an agent. Click one first.")),
        ),
    );
}

// Record, a throwaway's stand-in for Current and Places

export function recordSection({ t, host, workspace, now }) {
  const context = isCurrentFor(host, workspace);
  const sessions = recordedSessions(workspace);
  const scratch = context?.scratch ?? null;
  const artifacts = artifactRows(t, host, workspace, now, workspace.artifacts ?? []);
  return v_flex()
    .flex_none()
    .gap(4)
    .child(sectionTitle(t, "Record"))
    .child(div().px(8).text_size(11).text_color(t.dim).child("Sessions"))
    .when(sessions.length === 0, (el) => el.child(dimLine(t, "None recorded.")))
    .children(
      sessions.map((s) =>
        h_flex()
          .id(`session-${s.sessionId}`)
          .h(22)
          .px(8)
          .gap(8)
          .items_center()
          .rounded(6)
          .cursor_pointer()
          .hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => host.citeAction({ kind: "session", value: s.sessionId }, workspace, cx))
          .child(div().flex_1().min_w(0).truncate().text_size(12).child([s.role, s.terminal].filter(Boolean).join(" · ") || "Session"))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(s.sessionId.slice(0, 8))),
      ),
    )
    .child(div().px(8).pt(4).text_size(11).text_color(t.dim).child("Scratch folder"))
    .child(
      h_flex()
        .px(8)
        .gap(8)
        .items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(context?.scratchExists ? t.foreground : t.dim).child(scratch ? tilde(scratch) : "None"))
        .when(Boolean(context?.scratchExists), (el) => el.child(smallButton(t, "open-scratch", "Open folder", (_e, cx) => host.openFolder({ id: "scratch", path: scratch }, cx)))),
    )
    .child(div().px(8).pt(4).text_size(11).text_color(t.dim).child("Artifacts"))
    .when(artifacts.length === 0, (el) => el.child(dimLine(t, "None yet.")))
    .children(artifacts)
    .child(h_flex().px(8).pt(6).child(smallButton(t, "promote", "Promote…", () => host.openPromote(workspace))));
}
