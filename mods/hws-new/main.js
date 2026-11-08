// The Herdr Workspaces launcher. A key opens the menu. New workspace opens the
// form as a second dialog, because the two need different sizes.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, focused, spaces } from "herdr";
import { hws, message, FORM_SIZE, checkFolder, fillParent, makeInput, moveFocus, fieldLabel, field, areaField, button, folderRow, problemLine } from "./hws.js";

export default class Launcher extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.isForm = props()?.step === "workspace";
    this.busy = null;
    this.problem = null;
    this.at = 0;
    this.values = {};
    this.inputs = {};
    this.focusedField = null;
    if (!this.isForm) {
      this.handle.focus();
      return;
    }
    const submit = (cx) => this.create(cx);
    makeInput(this, "name", { placeholder: "Untitled workspace", submit });
    makeInput(this, "folder", { submit });
    makeInput(this, "instructions", { rows: 4, placeholder: "Optional. How agents should work and organize context here." });
    makeInput(this, "tabs", { value: "Plan, Build", submit });
    fillParent(this, cx);
    this.inputs.name.focus();
    cx.timer.after(600, () => this.inputs.name.focus());
  }

  dismiss() {
    closeOverlay(props()?.overlay);
  }

  // The dialog stays open until hws answers, so a failure can show in it.
  launch(key, args, cx) {
    if (this.busy) return;
    this.busy = key;
    this.problem = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await hws(args);
        this.dismiss();
      } catch (e) {
        this.problem = message(e);
        this.busy = null;
        cx.notify();
      }
    });
  }

  newTerminal(cx) {
    const f = focused();
    const isLocal = !spaces().find((s) => s.id === f?.space)?.machine;
    this.launch("new-terminal", ["new", "terminal", ...(isLocal && f?.cwd ? ["--folder", f.cwd] : [])], cx);
  }

  openForm() {
    this.dismiss();
    openOverlay({ mod: "hws-new", kind: "dialog", modal: true, ...FORM_SIZE, props: { step: "workspace" } });
  }

  create(cx) {
    if (this.busy) return;
    this.busy = "create";
    this.problem = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const { path, problem } = await checkFolder(this.values.folder);
      if (problem) {
        this.problem = problem;
        this.busy = null;
        cx.notify();
        return;
      }
      const tabs = this.values.tabs.split(",").map((s) => s.trim()).filter(Boolean);
      const instructions = this.values.instructions.trim();
      try {
        await hws([
          "new", "workspace",
          "--name", this.values.name.trim() || "Untitled workspace",
          "--folder", path,
          ...(tabs.length > 0 ? ["--tabs", tabs.join(",")] : []),
          ...(instructions ? ["--instructions", instructions] : []),
        ]);
        this.dismiss();
      } catch (e) {
        this.problem = message(e);
        this.busy = null;
        cx.notify();
      }
    });
  }

  menuItems() {
    return [
      { id: "new-terminal", name: "New terminal", line: "A plain tab with no workspace.", go: (cx) => this.newTerminal(cx) },
      { id: "new-workspace", name: "New workspace…", line: "A named place with instructions, tabs and kept work.", go: () => this.openForm() },
      { id: "new-throwaway", name: "Throwaway", line: "Claude in a scratch workspace.", go: (cx) => this.launch("new-throwaway", ["new", "throwaway"], cx) },
      { id: "new-board", name: "New board", line: "A sketch on its own, tied to no terminal.", go: (cx) => this.launch("new-board", ["surface", "open", "--type", "board", "--title", "Untitled board", "--standalone"], cx) },
      { id: "new-note", name: "New note", line: "A prompt, template or note on its own.", go: (cx) => this.launch("new-note", ["surface", "open", "--type", "note", "--title", "Untitled note", "--standalone"], cx) },
    ];
  }

  menuKey(e, cx, items) {
    if (e.key === "down") this.at = (this.at + 1) % items.length;
    else if (e.key === "up") this.at = (this.at + items.length - 1) % items.length;
    else if (e.key === "enter") items[this.at].go(cx);
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
            .cursor_pointer()
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.selected))
            .on_click((_e, cx) => item.go(cx))
            .child(div().font_medium().child(this.busy === item.id ? `${item.name.replace("…", "")}…` : item.name))
            .child(div().text_size(11.5).text_color(t.dim).child(item.line)),
        ),
      )
      .when(Boolean(this.problem), (el) => el.child(div().px(10).pt(4).child(problemLine(t, this.problem))));
  }

  renderForm(t) {
    const isCreating = this.busy === "create";
    return v_flex()
      .id("hws-new-form")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "tab") moveFocus(this, e.modifiers?.shift);
        else if (e.key === "escape") this.dismiss();
        else return;
        cx.stop_propagation();
      })
      .size_full()
      .min_h(0)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(13)
      .child(
        v_flex()
          .id("hws-new-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(18)
          .gap(12)
          .child(div().text_size(15).font_semibold().child("New workspace"))
          .child(v_flex().child(fieldLabel(t, "Name")).child(field(t, this, "name")))
          .child(v_flex().child(fieldLabel(t, "Folder")).child(folderRow(t, this)))
          .child(v_flex().child(fieldLabel(t, "Instructions")).child(areaField(t, this, "instructions")))
          .child(v_flex().child(fieldLabel(t, "Starting tabs, separated by commas")).child(field(t, this, "tabs")))
          .when(Boolean(this.problem), (el) => el.child(problemLine(t, this.problem))),
      )
      .child(
        h_flex()
          .flex_none()
          .p(12)
          .gap(8)
          .justify_end()
          .border_t(1)
          .border_color(t.border)
          .child(button(t, "cancel", "Cancel", false, () => this.dismiss()))
          .child(button(t, "create", isCreating ? "Creating…" : "Create", true, (_e, cx) => this.create(cx), !isCreating)),
      );
  }

  render() {
    const t = theme();
    return this.isForm ? this.renderForm(t) : this.renderMenu(t);
  }
}
