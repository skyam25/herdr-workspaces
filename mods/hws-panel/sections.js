// The panel's sections, one function each.
//
// Each takes `{ t, host, workspace, target, now }`. `t` is the theme, `target` the
// agent new surfaces attach to (or null) and `host` the Panel view that owns the state.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, TextView } from "gpui-base";
import { run } from "herdr";
import { tilde } from "./hws.js";
import { revealLabel } from "./cites.js";
import { BACKLOG_ROWS, FRESHNESS_COLOR, agentName, ago, artifactGroups, backlog, citeLabel, countsLine, freshness, livePass, placeRows, recordedSessions } from "./context.js";

const STATUS_COLOR = { draft: "ansi3", current: "ansi2", superseded: "dim" };

export function sectionTitle(t, title) {
  return div().px(8).pb(6).text_size(13).font_semibold().text_color(t.foreground).child(title);
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
    .pt(6)
    .gap(6)
    .items_center()
    .when(Boolean(level), (el) => el.child(freshnessDot(t, level)))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(sentence))
    .child(smallButton(t, "open-current", "Open note", (_e, cx) => host.openCurrent(target, cx), Boolean(context?.currentPath && (target || context.current)) && !host.busy))
    .child(smallButton(t, "tidy", live ? "Tidy again" : "Tidy", (_e, cx) => host.startTidy(workspace, cx), !host.busy));
}

export function headerSection(view) {
  const { t, host, workspace, target } = view;
  const isThrowaway = workspace.kind === "throwaway";
  const stage = workspace.stage;
  const canAttach = Boolean(target) && !host.busy;
  return v_flex()
    .flex_none()
    .px(14)
    .py(10)
    .gap(2)
    .border_b(1)
    .border_color(t.border)
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(workspace.name))
        .when(Boolean(stage) && !isThrowaway, (el) => el.child(pill(t, stage)))
        .when(isThrowaway, (el) => el.child(pill(t, "Throwaway"))),
    )
    .when(Boolean(workspace.instructions), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(workspace.instructions.split("\n")[0])))
    .when(!isThrowaway, (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(tilde(workspace.folder))).child(freshnessRow(view)))
    .child(
      h_flex()
        .pt(6)
        .gap(4)
        .items_center()
        .child(smallButton(t, "new-board", "New board", (_e, cx) => host.openSurface("board", target, cx), canAttach))
        .child(smallButton(t, "new-note", "New note", (_e, cx) => host.openSurface("note", target, cx), canAttach))
        .child(smallButton(t, "edit-instructions", "Instructions…", () => host.openInstructions(workspace)))
        .child(div().flex_1().min_w(0).truncate().pl(4).text_size(11).text_color(t.dim).child(target ? `Boards and notes open beside ${agentName(target)}` : "Boards and notes need an agent. Click one first.")),
    );
}

// Current

function citeChips(t, host, workspace, key, cites) {
  return cites.map((cite, i) => chip(t, `cite-${key}-${i}`, citeLabel(cite, workspace), (_e, cx) => host.citeAction(cite, workspace, cx)));
}

function noteLine(t, host, workspace, line, i) {
  const words = div()
    .flex_1()
    .min_w(0)
    .whitespace_normal()
    .when(line.kind === "heading", (el) => el.pt(6).text_size(11.5).font_semibold().text_color(t.muted))
    .when(line.kind !== "heading", (el) => el.text_size(12).text_color(t.foreground))
    .child(line.text || " ");
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

// History

// The decision log and update log a past pass left behind.
export function historySection({ t, host, workspace }) {
  const record = isCurrentFor(host, workspace)?.status?.record;
  if (!record?.decisions && !record?.updates) return null;
  const row = (id, title, detail, path) =>
    h_flex()
      .id(id)
      .h(22)
      .px(8)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => host.openReader({ title, candidates: [path], reveal: path }, cx))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(title))
      .when(Boolean(detail), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(detail)));
  const { decisions, updates } = record;
  return v_flex()
    .flex_none()
    .gap(1)
    .child(sectionTitle(t, "History"))
    .when(Boolean(decisions), (el) => el.child(row("history-decisions", "Decision log", decisions ? `${decisions.inForce} in force · ${decisions.replaced} replaced` : "", decisions?.path)))
    .when(Boolean(updates), (el) => el.child(row("history-updates", "Updates", "", updates)));
}

// Artifacts

function artifactRow(t, host, workspace, artifact, now) {
  const { status } = artifact;
  return v_flex()
    .flex_none()
    .px(8)
    .gap(3)
    .child(
      h_flex()
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
            .on_click((_e, cx) => host.citeAction({ kind: "artifact", value: artifact.id }, workspace, cx))
            .child(artifact.title || artifact.id),
        )
        .when(Boolean(status) && status !== "current", (el) => el.child(pill(t, status, t[STATUS_COLOR[status]])))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`${artifact.type} · ${ago(now - (artifact.createdAt ?? now))}`)),
    )
    .child(
      h_flex()
        .gap(4)
        .child(smallButton(t, `open-${artifact.id}`, "Open", (_e, cx) => host.citeAction({ kind: "artifact", value: artifact.id }, workspace, cx)))
        .child(smallButton(t, `link-${artifact.id}`, "Copy for Claude", (_e, cx) => host.copyLink(artifact, cx)))
        .child(smallButton(t, `folder-${artifact.id}`, revealLabel(), (_e, cx) => host.reveal(artifact.prompt ?? artifact.path, cx))),
    );
}

// Current and draft artifacts, then one row that folds the superseded ones.
function artifactRows(t, host, workspace, now) {
  const { shown, superseded } = artifactGroups(workspace.artifacts);
  const rows = shown.map((a) => artifactRow(t, host, workspace, a, now));
  if (superseded.length === 0) return rows;
  const fold = h_flex()
    .id("superseded-toggle")
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
  return [...rows, fold, ...(host.showSuperseded ? superseded.map((a) => artifactRow(t, host, workspace, a, now)) : [])];
}

export function artifactsSection({ t, host, workspace, now }) {
  const rows = artifactRows(t, host, workspace, now);
  return v_flex()
    .flex_none()
    .gap(8)
    .child(sectionTitle(t, "Artifacts"))
    .when(rows.length === 0, (el) => el.child(dimLine(t, "None yet.")))
    .children(rows);
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
    .text_size(13)
    .font_semibold()
    .text_color(t.foreground)
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => {
      host.showPlaces = !host.showPlaces;
      cx.notify();
    })
    .child(svg(`mods/workspace-chrome/chevron-${host.showPlaces ? "down" : "right"}.svg`).size(12).flex_none())
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
  const artifacts = artifactRows(t, host, workspace, now);
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
