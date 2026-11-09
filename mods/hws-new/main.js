// The Herdr Workspaces launcher. A key opens the menu. New workspace and Find
// past work each open a second dialog, because they need different sizes.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETIRED_KEEP_DAYS = 30;

function closedWhen(time) {
  const days = Math.floor((Date.now() - time) / DAY_MS);
  if (days <= 0) return "Today";
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

import { theme, props, closeOverlay, focused, openOverlay, spaces } from "herdr";
import { hws, message, submitDialog, openWorkspaceForm, checkFolder, fillParent, makeInput, focusField, formKeys, dialogRoot, dialogFooter, labeled, field, areaField, button, folderRow, problemLine } from "./hws.js";

export default class Launcher extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.isForm = props()?.step === "workspace";
    this.isFind = props()?.step === "find";
    this.busy = null;
    this.problem = null;
    this.at = 0;
    this.values = {};
    this.inputs = {};
    this.focusedField = null;
    if (this.isFind) {
      this.results = null;
      this.searchId = 0;
      makeInput(this, "query", { placeholder: "Search by name or what it was about", submit: (cx) => this.reopenSelected(cx), change: (cx) => this.search(cx) });
      this.search(cx);
      focusField(this, "query", cx);
      return;
    }
    if (!this.isForm) {
      this.handle.focus();
      return;
    }
    const submit = (cx) => this.create(cx);
    makeInput(this, "name", { placeholder: "Untitled workspace", submit });
    makeInput(this, "folder", { submit });
    makeInput(this, "home", { placeholder: "Optional. A folder inside it for this workspace's files", submit });
    makeInput(this, "instructions", { rows: 4, placeholder: "Optional. How agents should work and organize context here." });
    fillParent(this, cx);
    focusField(this, "name", cx);
  }

  dismiss() {
    closeOverlay(props()?.overlay);
  }

  launch(key, args, cx) {
    submitDialog(this, key, () => hws(args), cx);
  }

  newTerminal(cx) {
    const f = focused();
    const isLocal = !spaces().find((s) => s.id === f?.space)?.machine;
    this.launch("new-terminal", ["new", "terminal", ...(isLocal && f?.cwd ? ["--folder", f.cwd] : [])], cx);
  }

  openForm() {
    this.dismiss();
    openWorkspaceForm();
  }

  // The active local space and its folder, or null when either is unknown.
  orchestrateTarget() {
    const space = spaces().find((s) => s.active);
    if (!space || space.machine) return null;
    const f = focused();
    const folder = (f?.space === space.id && f.cwd) || space.folder;
    return folder ? { space: space.id, folder } : null;
  }

  orchestrateRow() {
    const target = this.orchestrateTarget();
    const args = target && ["orchestrator", "start", "--space", target.space, "--folder", target.folder];
    return { id: "orchestrate", name: "Orchestrate this space", line: "Run Tasks with an agent that assigns the work.", go: target ? (cx) => this.launch("orchestrate", args, cx) : null };
  }

  openFind() {
    this.dismiss();
    openOverlay({ mod: "hws-new", kind: "dialog", modal: true, width: 500, height: 420, props: { step: "find" } });
  }

  // Only the newest search may fill the list, because replies can arrive out of order.
  search(cx) {
    const query = this.values.query.trim();
    this.searchId += 1;
    const id = this.searchId;
    cx.spawn(async (cx) => {
      try {
        const results = await hws(["find", "--", ...(query ? [query] : [])]);
        if (id !== this.searchId) return;
        this.results = results;
        this.at = 0;
      } catch (e) {
        if (id !== this.searchId) return;
        this.problem = message(e);
      }
      cx.notify();
    });
  }

  reopen(item, cx) {
    submitDialog(this, `reopen-${item.id}`, () => hws(["reopen", item.id]), cx);
  }

  reopenSelected(cx) {
    const item = this.results?.[this.at];
    if (item) this.reopen(item, cx);
  }

  findKeys(e, cx) {
    const count = this.results?.length ?? 0;
    if (count > 0 && (e.key === "down" || e.key === "up")) {
      this.at = (this.at + (e.key === "down" ? 1 : count - 1)) % count;
      cx.stop_propagation();
      cx.notify();
      return;
    }
    formKeys(this, () => this.dismiss())(e, cx);
  }

  create(cx) {
    submitDialog(this, "create", async () => {
      const path = await checkFolder(this.values.folder);
      const instructions = this.values.instructions.trim();
      const home = this.values.home.trim() ? await checkFolder(this.values.home) : null;
      await hws([
        "new", "workspace",
        "--name", this.values.name.trim() || "Untitled workspace",
        "--folder", path,
        ...(home ? ["--home", home] : []),
        ...(instructions ? ["--instructions", instructions] : []),
      ]);
    }, cx);
  }

  menuItems() {
    return [
      { id: "new-terminal", name: "New terminal", line: "A plain tab with no workspace.", go: (cx) => this.newTerminal(cx) },
      { id: "new-workspace", name: "New workspace…", line: "A named place with its spaces, instructions and kept work.", go: () => this.openForm() },
      { id: "new-throwaway", name: "Throwaway", line: "Claude in a scratch workspace.", go: (cx) => this.launch("new-throwaway", ["new", "throwaway"], cx) },
      { id: "find-past", name: "Find past work…", line: "Bring back an archived workspace or a closed throwaway.", go: () => this.openFind() },
      { id: "new-board", name: "New sketch", line: "A sketch in its own floating window, tied to no terminal.", go: (cx) => this.launch("new-board", ["surface", "open", "--type", "board", "--title", "Untitled sketch", "--standalone"], cx) },
      { id: "new-note", name: "New note", line: "A prompt, template or note on its own.", go: (cx) => this.launch("new-note", ["surface", "open", "--type", "note", "--title", "Untitled note", "--standalone"], cx) },
      this.orchestrateRow(),
    ];
  }

  menuKey(e, cx, items) {
    if (e.key === "down") this.at = (this.at + 1) % items.length;
    else if (e.key === "up") this.at = (this.at + items.length - 1) % items.length;
    else if (e.key === "enter") items[this.at].go?.(cx);
    else if (e.key === "escape") this.dismiss();
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  renderMenu(t) {
    const items = this.menuItems();
    return v_flex()
      .id("hws-new")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.menuKey(e, cx, items))
      .size_full()
      .min_h(0)
      .p(6)
      .gap(1)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(13)
      .children(
        items.map((item, i) =>
          v_flex()
            .id(item.id)
            .flex_none()
            .px(10)
            .py(7)
            .rounded(7)
            .opacity(item.go ? 1 : 0.5)
            .when(i === this.at, (el) => el.bg(t.selected))
            .when(Boolean(item.go), (el) => el.cursor_pointer().hover((s) => s.bg(t.selected)).on_click((_e, cx) => item.go(cx)))
            .child(div().font_medium().child(this.busy === item.id ? `${item.name.replace("…", "")}…` : item.name))
            .child(div().text_size(11.5).text_color(t.dim).child(item.line)),
        ),
      )
      .when(Boolean(this.problem), (el) => el.child(div().px(10).pt(4).child(problemLine(t, this.problem))));
  }

  renderForm(t) {
    const isCreating = this.busy === "create";
    return dialogRoot(t, "hws-new-form")
      .track_focus(this.handle)
      .on_key_down(formKeys(this, () => this.dismiss()))
      .child(
        v_flex()
          .id("hws-new-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(18)
          .gap(12)
          .child(div().text_size(15).font_semibold().child("New workspace"))
          .child(labeled(t, "Name", field(t, this, "name")))
          .child(labeled(t, "Claude runs in", folderRow(t, this)))
          .child(labeled(t, "Workspace files in", folderRow(t, this, "home")))
          .child(labeled(t, "Instructions", areaField(t, this, "instructions")))
          .when(Boolean(this.problem), (el) => el.child(problemLine(t, this.problem))),
      )
      .child(
        dialogFooter()
          .border_t(1)
          .border_color(t.border)
          .child(button(t, "cancel", "Cancel", false, () => this.dismiss()))
          .child(button(t, "create", isCreating ? "Creating…" : "Create", true, (_e, cx) => this.create(cx), !isCreating)),
      );
  }

  renderResult(t, item, index) {
    const title = item.archived ? item.name : item.sessions[0]?.title || item.name;
    const artifacts = item.artifacts.length > 0 ? plural(item.artifacts.length, "artifact") : null;
    const daysLeft = Math.max(0, RETIRED_KEEP_DAYS - Math.floor((Date.now() - item.closedAt) / DAY_MS));
    const kind = item.archived ? `Workspace, archived ${closedWhen(item.closedAt).toLowerCase()}` : `Throwaway, closed ${closedWhen(item.closedAt).toLowerCase()}`;
    const detail = [kind, title === item.name ? null : item.name, item.archived ? null : `${plural(daysLeft, "day")} left`, artifacts].filter(Boolean).join(" · ");
    const isReopening = this.busy === `reopen-${item.id}`;
    return h_flex()
      .id(`retired-${item.id}`)
      .flex_none()
      .px(10)
      .py(7)
      .gap(10)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(index === this.at, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.selected))
      .on_click((_e, cx) => this.reopen(item, cx))
      .child(v_flex().flex_1().min_w(0).child(div().truncate().font_medium().child(title)).child(div().truncate().text_size(11.5).text_color(t.dim).child(detail)))
      .child(div().flex_none().text_size(11.5).text_color(t.muted).child(isReopening ? "Restoring…" : "Restore"));
  }

  findEmptyLine() {
    if (this.results === null) return "Searching…";
    return this.values.query.trim() ? "Nothing matches." : "Archived workspaces and closed throwaways appear here.";
  }

  renderFind(t) {
    const results = this.results ?? [];
    return dialogRoot(t, "hws-find")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.findKeys(e, cx))
      .child(
        v_flex()
          .flex_none()
          .p(18)
          .pb(10)
          .gap(12)
          .child(div().text_size(15).font_semibold().child("Find past work"))
          .child(field(t, this, "query"))
          .when(Boolean(this.problem), (el) => el.child(problemLine(t, this.problem))),
      )
      .child(
        v_flex()
          .id("hws-find-results")
          .flex_1()
          .min_h(0)
          .px(8)
          .pb(8)
          .gap(1)
          .overflow_y_scrollbar()
          .when(results.length === 0, (el) => el.child(div().px(10).py(7).text_color(t.dim).child(this.findEmptyLine())))
          .children(results.map((item, index) => this.renderResult(t, item, index))),
      );
  }

  render() {
    const t = theme();
    if (this.isFind) return this.renderFind(t);
    return this.isForm ? this.renderForm(t) : this.renderMenu(t);
  }
}
