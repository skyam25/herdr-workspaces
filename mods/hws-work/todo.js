// The to-do dialog, shown by a copy of this mod opened with props `{ view: "todo", space, id? }`.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { agents, closeOverlay, panes, props, setShared, shared, spaces, terminals, theme } from "herdr";
import { COLUMNS, sendTargets, todoItems } from "./data.js";
import { hws } from "./open.js";

export const TODOS_CHANGED = "hws.todos.changed";

const message = (e) => String(e?.message ?? e);

// The `--flag=value` form lets a value start with a dash, as a notes list does.
const textFlag = (flag, value) => `--${flag}=${value}`;

export class TodoForm {
  constructor(cx) {
    const p = props();
    this.space = p.space;
    this.id = p.id ?? null;
    this.item = null;
    this.column = "todo";
    this.busy = null;
    this.problem = null;
    this.focusedField = null;
    this.handle = cx.focus_handle();
    this.title = this.track("title", InputState.new({ placeholder: "What needs doing?" }), (cx) => this.save(cx));
    this.notes = this.track("notes", TextareaState.new({ placeholder: "Add details for the agent (optional)", rows: 4 }));
    this.title.focus();
    cx.timer.after(600, () => this.title.focus());
    if (this.id) this.load(cx);
  }

  track(key, state, submit) {
    state.on("change", (_e, cx) => {
      this.problem = null;
      cx.notify();
    });
    state.on("focus", (_e, cx) => {
      this.focusedField = key;
      cx.notify();
    });
    state.on("blur", (_e, cx) => {
      if (this.focusedField === key) this.focusedField = null;
      cx.notify();
    });
    if (submit) state.on("submit", (_e, cx) => submit(cx));
    return state;
  }

  load(cx) {
    cx.spawn(async (cx) => {
      try {
        const item = todoItems(await hws(["todo", "list", "--space", this.space])).find((x) => x.id === this.id);
        if (!item) throw new Error("This to-do no longer exists.");
        this.item = item;
        this.column = item.column;
        this.title.set_value(item.title);
        this.notes.set_value(item.notes ?? "");
      } catch (e) {
        this.problem = message(e);
      }
      cx.notify();
    });
  }

  ready() {
    return !this.busy && (!this.id || Boolean(this.item));
  }

  close() {
    closeOverlay(props().overlay);
  }

  // Runs one change. The board reloads either way, because a failed step can follow a good one.
  submit(key, work, cx) {
    if (!this.ready()) return;
    this.busy = key;
    this.problem = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let failure = null;
      try {
        await work();
      } catch (e) {
        failure = message(e);
      }
      setShared(TODOS_CHANGED, (shared(TODOS_CHANGED) ?? 0) + 1);
      if (failure === null) {
        this.close();
        return;
      }
      this.problem = failure;
      this.busy = null;
      cx.notify();
    });
  }

  spaceFlag() {
    return ["--space", this.space];
  }

  // Writes the title and notes when they differ from the stored ones.
  async saveText(title, notes) {
    if (title === this.item.title && notes === (this.item.notes ?? "")) return;
    await hws(["todo", "edit", "--id", this.id, textFlag("title", title), textFlag("notes", notes), ...this.spaceFlag()]);
  }

  async add(title, notes) {
    const added = await hws(["todo", "add", textFlag("title", title), ...(notes ? [textFlag("notes", notes)] : []), ...this.spaceFlag()]);
    if (this.column !== "todo") await this.move(added.id);
  }

  move(id) {
    return hws(["todo", "move", "--id", id, "--column", this.column, ...this.spaceFlag()]);
  }

  // The trimmed title, or null after asking for one.
  titleText(cx) {
    const title = this.title.value().trim();
    if (title) return title;
    this.problem = "Give the to-do a title.";
    cx.notify();
    return null;
  }

  save(cx) {
    const title = this.titleText(cx);
    if (title === null) return;
    const notes = this.notes.value().trim();
    this.submit("save", async () => {
      if (!this.id) {
        await this.add(title, notes);
        return;
      }
      await this.saveText(title, notes);
      if (this.column !== this.item.column) await this.move(this.id);
    }, cx);
  }

  // Saves edited text first, because `hws todo send` pastes the stored text.
  send(address, cx) {
    const title = this.titleText(cx);
    if (title === null) return;
    this.submit("send", async () => {
      await this.saveText(title, this.notes.value().trim());
      await hws(["todo", "send", "--id", this.id, "--terminal", address, ...this.spaceFlag()]);
    }, cx);
  }

  archive(cx) {
    this.submit("archive", () => hws(["todo", "archive", "--id", this.id, ...this.spaceFlag()]), cx);
  }

  keys(e, cx) {
    if (e.key === "escape") this.close();
    else if (e.key === "tab") (this.focusedField === "title" ? this.notes : this.title).focus();
    else return;
    cx.stop_propagation();
  }

  fieldStyle(el, t, key) {
    return el
      .px(10)
      .rounded(8)
      .border_1()
      .border_color(this.focusedField === key ? t.accent : t.input)
      .bg(t.background)
      .text_size(12.8)
      .text_color(t.foreground);
  }

  labeled(t, text, control) {
    return v_flex().flex_none().child(div().pb(5).text_size(11.5).text_color(t.dim).child(text)).child(control);
  }

  button(t, id, text, primary, action, enabled) {
    return h_flex()
      .id(id)
      .flex_none()
      .h(30)
      .px(12)
      .items_center()
      .rounded(8)
      .border_1()
      .border_color(primary ? t.solid : t.input)
      .bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12.5)
      .font_medium()
      .opacity(enabled ? 1 : 0.5)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action))
      .child(text);
  }

  columnChoice(t) {
    return h_flex()
      .gap(4)
      .children(
        COLUMNS.filter((c) => c.drop).map((c) =>
          h_flex()
            .id(`column-${c.key}`)
            .flex_none()
            .h(26)
            .px(9)
            .items_center()
            .rounded(6)
            .border_1()
            .border_color(c.key === this.column ? t.accent : t.input)
            .when(c.key === this.column, (el) => el.bg(t.selected))
            .text_size(12)
            .text_color(c.key === this.column ? t.foreground : t.muted)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              this.column = c.key;
              cx.notify();
            })
            .child(c.name),
        ),
      );
  }

  sendRow(t, target, enabled) {
    const where = [target.tab, target.flipped ? "Chat" : null, target.address].filter(Boolean).join(" · ");
    return h_flex()
      .id(`send-${target.address}`)
      .flex_none()
      .h(28)
      .px(9)
      .gap(8)
      .items_center()
      .rounded(7)
      .border_1()
      .border_color(t.input)
      .opacity(enabled ? 1 : 0.5)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.send(target.address, cx)))
      .child(div().flex_1().min_w(0).truncate().child(target.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(where));
  }

  sendTo(t, enabled) {
    const targets = sendTargets({ agents: agents(), panes: panes(), terminals: terminals(), spaces: spaces() }, this.space);
    if (targets.length === 0) return div().text_size(12).text_color(t.dim).child("No agents in this space.");
    return v_flex().gap(4).children(targets.map((x) => this.sendRow(t, x, enabled)));
  }

  render() {
    const t = theme();
    const enabled = this.ready();
    return v_flex()
      .id("hws-todo")
      .size_full()
      .min_h(0)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.keys(e, cx))
      .child(
        v_flex()
          .id("todo-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(18)
          .gap(12)
          .child(div().flex_none().text_size(15).font_semibold().child(this.id ? "To-do" : "New to-do"))
          .child(this.labeled(t, "Title", this.fieldStyle(Input.new(this.title).h(34), t, "title")))
          .child(this.labeled(t, "Notes", this.fieldStyle(Textarea.new(this.notes).py(8), t, "notes")))
          .child(this.labeled(t, "Column", this.columnChoice(t)))
          .when(Boolean(this.id), (el) => el.child(this.labeled(t, "Send to", this.sendTo(t, enabled))))
          .when(Boolean(this.problem), (el) => el.child(div().id("todo-problem").flex_none().text_size(11.5).text_color(t.blocked).child(this.problem))),
      )
      .child(
        h_flex()
          .flex_none()
          .px(18)
          .pt(4)
          .pb(18)
          .gap(8)
          .items_center()
          .when(Boolean(this.id), (el) => el.child(this.button(t, "archive-todo", this.busy === "archive" ? "Archiving…" : "Archive", false, (_e, cx) => this.archive(cx), enabled)))
          .child(div().flex_1())
          .child(this.button(t, "cancel-todo", "Cancel", false, () => this.close(), true))
          .child(this.button(t, "save-todo", this.busy === "save" ? "Saving…" : "Save", true, (_e, cx) => this.save(cx), enabled)),
      );
  }
}
