// The Board's dialogs, shown by a copy of this mod.
// Props are `{ view: "todo", space, id? }` for one card and `{ view: "add-several", space }` for many.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { agents, closeOverlay, panes, props, setShared, shared, spaces, terminals, theme } from "herdr";
import { COLUMNS, FORM, sendTargets, todoItems } from "./data.js";
import { hws } from "./open.js";

export const TODOS_CHANGED = "hws.todos.changed";

const message = (e) => String(e?.message ?? e);
const lineHeight = (px) => `${px}px`;

// The `--flag=value` form lets a value start with a dash, as a notes list does.
export const textFlag = (flag, value) => `--${flag}=${value}`;

// What both dialogs share: tracked fields, one change at a time, and the look.
class DialogForm {
  constructor(cx) {
    this.space = props().space;
    this.busy = null;
    this.problem = null;
    this.focusedField = null;
    this.handle = cx.focus_handle();
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

  ready() {
    return !this.busy;
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

  ask(text, cx) {
    this.problem = text;
    cx.notify();
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
    return v_flex().flex_none().child(div().pb(FORM.labelGap).line_height(lineHeight(FORM.label)).text_size(11.5).text_color(t.dim).child(text)).child(control);
  }

  button(t, id, text, primary, action, enabled) {
    return h_flex()
      .id(id)
      .flex_none()
      .h(FORM.button)
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

  body(t, id, heading, fields) {
    return v_flex()
      .id(id)
      .flex_1()
      .min_h(0)
      .overflow_y_scrollbar()
      .p(FORM.pad)
      .gap(FORM.gap)
      .child(div().flex_none().line_height(lineHeight(FORM.heading)).text_size(15).font_semibold().child(heading))
      .children(fields)
      .when(Boolean(this.problem), (el) => el.child(div().id("todo-problem").flex_none().line_height(lineHeight(FORM.problem)).text_size(11.5).text_color(t.blocked).child(this.problem)));
  }

  footer() {
    return h_flex().flex_none().px(FORM.pad).pt(FORM.footerTop).pb(FORM.pad).gap(8).items_center();
  }

  frame(t, id, body, footer) {
    return v_flex()
      .id(id)
      .size_full()
      .min_h(0)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.keys(e, cx))
      .child(body)
      .child(footer);
  }
}

export class TodoForm extends DialogForm {
  constructor(cx) {
    super(cx);
    this.id = props().id ?? null;
    this.item = null;
    this.column = "todo";
    this.hold = false;
    this.worktree = false;
    this.title = this.track("title", InputState.new({ placeholder: "What needs doing?" }), (cx) => this.save(cx));
    this.notes = this.track("notes", TextareaState.new({ placeholder: "Add details for the agent (optional)" }));
    this.replyBox = this.track("reply", InputState.new({ placeholder: "Answer the worker" }), (cx) => this.reply(cx));
    this.title.focus();
    cx.timer.after(600, () => this.firstField().focus());
    if (this.id) this.load(cx);
  }

  waiting() {
    return this.item?.column === "waiting";
  }

  // The fields Tab moves through. A card that waits on you starts at its reply.
  fields() {
    const fields = [["title", this.title], ["notes", this.notes]];
    return this.waiting() ? [["reply", this.replyBox], ...fields] : fields;
  }

  firstField() {
    return this.fields()[0][1];
  }

  load(cx) {
    cx.spawn(async (cx) => {
      try {
        const item = todoItems(await hws(["todo", "list", "--space", this.space])).find((x) => x.id === this.id);
        if (!item) throw new Error("This to-do no longer exists.");
        this.item = item;
        this.column = item.column;
        this.hold = Boolean(item.hold);
        this.worktree = Boolean(item.worktree);
        this.title.set_value(item.title);
        this.notes.set_value(item.notes ?? "");
        this.firstField().focus();
      } catch (e) {
        this.problem = message(e);
      }
      cx.notify();
    });
  }

  ready() {
    return super.ready() && (!this.id || Boolean(this.item));
  }

  // Writes only what differs from the stored card.
  async saveFields(title, notes) {
    const textChanged = title !== this.item.title || notes !== (this.item.notes ?? "");
    const changes = [
      ...(textChanged ? [textFlag("title", title), textFlag("notes", notes)] : []),
      ...(this.hold !== Boolean(this.item.hold) ? [textFlag("hold", this.hold)] : []),
      ...(this.worktree !== Boolean(this.item.worktree) ? [textFlag("worktree", this.worktree)] : []),
    ];
    if (changes.length > 0) await hws(["todo", "edit", "--id", this.id, ...changes, ...this.spaceFlag()]);
  }

  async add(title, notes) {
    const options = [...(notes ? [textFlag("notes", notes)] : []), ...(this.hold ? ["--hold"] : []), ...(this.worktree ? ["--worktree"] : [])];
    const added = await hws(["todo", "add", textFlag("title", title), ...options, ...this.spaceFlag()]);
    if (this.column !== "todo") await this.move(added.id);
  }

  move(id) {
    return hws(["todo", "move", "--id", id, "--column", this.column, ...this.spaceFlag()]);
  }

  // The trimmed title, or null after asking for one.
  titleText(cx) {
    const title = this.title.value().trim();
    if (title) return title;
    this.ask("Give the to-do a title.", cx);
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
      await this.saveFields(title, notes);
      if (this.column !== this.item.column) await this.move(this.id);
    }, cx);
  }

  // Saves edits first, because `hws todo send` pastes the stored text.
  send(address, cx) {
    const title = this.titleText(cx);
    if (title === null) return;
    this.submit("send", async () => {
      await this.saveFields(title, this.notes.value().trim());
      await hws(["todo", "send", "--id", this.id, "--terminal", address, ...this.spaceFlag()]);
    }, cx);
  }

  // Saves edits first, because the dialog closes after the reply goes.
  reply(cx) {
    const text = this.replyBox.value().trim();
    if (!text) {
      this.ask("Write a reply first.", cx);
      return;
    }
    const title = this.titleText(cx);
    if (title === null) return;
    this.submit("reply", async () => {
      await this.saveFields(title, this.notes.value().trim());
      await hws(["todo", "reply", "--id", this.id, textFlag("text", text), ...this.spaceFlag()]);
    }, cx);
  }

  archive(cx) {
    this.submit("archive", () => hws(["todo", "archive", "--id", this.id, ...this.spaceFlag()]), cx);
  }

  keys(e, cx) {
    if (e.key === "escape") this.close();
    else if (e.key === "tab") this.focusNext();
    else return;
    cx.stop_propagation();
  }

  focusNext() {
    const fields = this.fields();
    const at = fields.findIndex(([key]) => key === this.focusedField);
    fields[(at + 1) % fields.length][1].focus();
  }

  chip(t, id, text, on, action) {
    return h_flex()
      .id(id)
      .flex_none()
      .h(FORM.chip)
      .px(9)
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(on ? t.accent : t.input)
      .when(on, (el) => el.bg(t.selected))
      .text_size(12)
      .text_color(on ? t.foreground : t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(action)
      .child(text);
  }

  columnChoice(t) {
    const choose = (key) => (_e, cx) => {
      this.column = key;
      cx.notify();
    };
    return h_flex().gap(4).children(COLUMNS.filter((c) => c.drop).map((c) => this.chip(t, `column-${c.key}`, c.name, c.key === this.column, choose(c.key))));
  }

  toggle(t, key, text) {
    return this.chip(t, `toggle-${key}`, this[key] ? `✓ ${text}` : text, this[key], (_e, cx) => {
      this[key] = !this[key];
      cx.notify();
    });
  }

  toggles(t) {
    return h_flex().flex_none().gap(4).child(this.toggle(t, "hold", "Keep for me")).child(this.toggle(t, "worktree", "Use a worktree"));
  }

  sendRow(t, target, enabled) {
    const where = [target.tab, target.flipped ? "Chat" : null, target.address].filter(Boolean).join(" · ");
    return h_flex()
      .id(`send-${target.address}`)
      .flex_none()
      .h(FORM.sendRow)
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
    return v_flex().gap(FORM.sendGap).children(targets.map((x) => this.sendRow(t, x, enabled)));
  }

  // The worker's latest word and the box that answers it, for a card in Waiting on you.
  replyFields(t, enabled) {
    if (!this.waiting()) return [];
    const note = (this.item.note ?? "").trim();
    const row = h_flex()
      .gap(8)
      .items_center()
      .child(this.fieldStyle(Input.new(this.replyBox).flex_1().h(FORM.input), t, "reply"))
      .child(this.button(t, "reply-todo", this.busy === "reply" ? "Sending…" : "Reply", true, (_e, cx) => this.reply(cx), enabled));
    const box = this.labeled(t, "Reply", row);
    if (!note) return [box];
    const shown = div().id("todo-note").max_h(FORM.note).overflow_y_scrollbar().line_height("16px").text_size(12.5).whitespace_normal().child(note);
    return [this.labeled(t, "Latest from the worker", shown), box];
  }

  render() {
    const t = theme();
    const enabled = this.ready();
    const fields = [
      ...this.replyFields(t, enabled),
      this.labeled(t, "Title", this.fieldStyle(Input.new(this.title).h(FORM.input), t, "title")),
      this.labeled(t, "Notes", this.fieldStyle(Textarea.new(this.notes).h(FORM.notes).py(8), t, "notes")),
      this.labeled(t, "Column", this.columnChoice(t)),
      this.toggles(t),
      ...(this.id ? [this.labeled(t, "Send to", this.sendTo(t, enabled))] : []),
    ];
    const footer = this.footer()
      .when(Boolean(this.id), (el) => el.child(this.button(t, "archive-todo", this.busy === "archive" ? "Archiving…" : "Archive", false, (_e, cx) => this.archive(cx), enabled)))
      .child(div().flex_1())
      .child(this.button(t, "cancel-todo", "Cancel", false, () => this.close(), true))
      .child(this.button(t, "save-todo", this.busy === "save" ? "Saving…" : "Save", true, (_e, cx) => this.save(cx), enabled));
    return this.frame(t, "hws-todo", this.body(t, "todo-body", this.id ? "To-do" : "New to-do", fields), footer);
  }
}

export class AddSeveralForm extends DialogForm {
  constructor(cx) {
    super(cx);
    this.lines = this.track("lines", TextareaState.new({ placeholder: "One card per line" }));
    this.lines.focus();
    cx.timer.after(600, () => this.lines.focus());
  }

  save(cx) {
    const titles = this.lines.value().trim();
    if (!titles) {
      this.ask("Write at least one line.", cx);
      return;
    }
    this.submit("add", () => hws(["todo", "add", textFlag("titles", titles), ...this.spaceFlag()]), cx);
  }

  keys(e, cx) {
    if (e.key !== "escape") return;
    this.close();
    cx.stop_propagation();
  }

  render() {
    const t = theme();
    const enabled = this.ready();
    const fields = [this.labeled(t, "Each line becomes a card", this.fieldStyle(Textarea.new(this.lines).h(FORM.lines).py(8), t, "lines"))];
    const footer = this.footer()
      .child(div().flex_1())
      .child(this.button(t, "cancel-todo", "Cancel", false, () => this.close(), true))
      .child(this.button(t, "add-several-save", this.busy === "add" ? "Adding…" : "Add", true, (_e, cx) => this.save(cx), enabled));
    return this.frame(t, "hws-add-several", this.body(t, "several-body", "Add several", fields), footer);
  }
}
