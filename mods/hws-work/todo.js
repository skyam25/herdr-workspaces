// The Board's dialogs, shown by a copy of this mod.
// Props are `{ view: "todo", space, id? }` for one card and `{ view: "add-several", space }` for many.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { agents, closeOverlay, panes, props, setShared, shared, spaces, terminals, theme } from "herdr";
import { COLUMNS, FORM, cardSessions, cardStory, cardTimes, describeSession, sendTargets, todoItems, todoLayout } from "./data.js";
import { hws, openSession } from "./open.js";

export const TODOS_CHANGED = "hws.todos.changed";

const OWNERS = [{ key: "unassigned", name: "Unassigned" }, { key: "agent", name: "Agent" }, { key: "mine", name: "Mine" }];
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

  keys(e, cx) {
    if (e.key !== "escape") return;
    this.close();
    cx.stop_propagation();
  }

  close() {
    closeOverlay(props().overlay);
  }

  // Runs one change. The board reloads either way, because a failed step can follow a good one.
  submit(key, work, cx, afterClose = () => {}) {
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
        afterClose();
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

  rowButton(t, id, text, action, enabled) {
    return div()
      .id(id)
      .flex_none()
      .h(20)
      .px(8)
      .flex()
      .items_center()
      .rounded(5)
      .border_1()
      .border_color(t.input)
      .text_size(11)
      .opacity(enabled ? 1 : 0.5)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(action))
      .child(text);
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

  body(t, id, heading, fields, details = null) {
    return v_flex()
      .id(id)
      .flex_1()
      .min_h(0)
      .overflow_y_scrollbar()
      .p(FORM.pad)
      .gap(FORM.gap)
      .child(
        h_flex()
          .flex_none()
          .gap(8)
          .items_center()
          .child(div().flex_none().line_height(lineHeight(FORM.heading)).text_size(15).font_semibold().child(heading))
          .when(details !== null, (el) => el.child(div().flex_1()).child(div().id("todo-details").flex_none().text_size(11).text_color(t.dim).child(details))),
      )
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
    this.orchestrator = null;
    this.column = "todo";
    this.owner = "unassigned";
    this.worktree = false;
    this.title = this.track("title", InputState.new({ placeholder: "What needs doing?" }), (cx) => this.save(cx));
    this.notes = this.track("notes", TextareaState.new({ placeholder: "Add details for the agent (optional)" }));
    this.replyBox = this.track("reply", InputState.new({ placeholder: "Reply to this session" }), (cx) => this.reply(cx));
    this.title.focus();
    cx.timer.after(600, () => this.firstField().focus());
    if (this.id) this.load(cx);
  }

  waiting() {
    return this.item?.column === "waiting";
  }

  // A finished card takes feedback too, which reopens its session when that has closed.
  canReply() {
    if (this.item?.archived) return false;
    if (this.waiting()) return true;
    return this.item?.column === "done" && Boolean(this.item.session || this.item.terminal);
  }

  // The fields Tab moves through. A card that waits on you starts at its reply.
  fields() {
    const fields = [["title", this.title], ["notes", this.notes]];
    return this.canReply() ? [["reply", this.replyBox], ...fields] : fields;
  }

  firstField() {
    return this.fields()[0][1];
  }

  load(cx) {
    cx.spawn(async (cx) => {
      try {
        const listed = await hws(["todo", "list", "--archived", "--space", this.space]);
        const item = todoItems(listed).find((x) => x.id === this.id);
        if (!item) throw new Error("This to-do no longer exists.");
        this.item = item;
        this.orchestrator = listed?.orchestrator?.terminal ?? null;
        this.column = item.column;
        this.owner = item.owner;
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

  // An archived card is frozen, so the dialog only shows it.
  ready() {
    return super.ready() && (!this.id || Boolean(this.item)) && !this.item?.archived;
  }

  // Writes only what differs from the stored card.
  async saveFields(title, notes) {
    const textChanged = title !== this.item.title || notes !== (this.item.notes ?? "");
    const changes = [
      ...(textChanged ? [textFlag("title", title), textFlag("notes", notes)] : []),
      ...(this.owner !== this.item.owner ? [textFlag("owner", this.owner)] : []),
      ...(this.worktree !== Boolean(this.item.worktree) ? [textFlag("worktree", this.worktree)] : []),
    ];
    if (changes.length > 0) await hws(["todo", "edit", "--id", this.id, ...changes, ...this.spaceFlag()]);
  }

  async add(title, notes) {
    const options = [...(notes ? [textFlag("notes", notes)] : []), ...(this.owner !== "unassigned" ? [textFlag("owner", this.owner)] : []), ...(this.worktree ? ["--worktree"] : [])];
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

  // Saves edits first, because `hws todo send` pastes the stored text and the other actions close the dialog.
  saveThen(key, work, cx, afterClose) {
    const title = this.titleText(cx);
    if (title === null) return;
    this.submit(key, async () => {
      await this.saveFields(title, this.notes.value().trim());
      await work();
    }, cx, afterClose);
  }

  send(address, cx) {
    this.saveThen("send", () => hws(["todo", "send", "--id", this.id, "--terminal", address, ...this.spaceFlag()]), cx);
  }

  openLinked(address, cx) {
    this.saveThen("open", () => {}, cx, () => openSession(address));
  }

  resume(cx) {
    this.saveThen("resume", () => hws(["todo", "resume", "--id", this.id, ...this.spaceFlag()]), cx);
  }

  reply(cx) {
    const text = this.replyBox.value().trim();
    if (!text) {
      this.ask("Write a reply first.", cx);
      return;
    }
    this.saveThen("reply", () => hws(["todo", "reply", "--id", this.id, textFlag("text", text), ...this.spaceFlag()]), cx);
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

  columnChoice(t) {
    const choose = (key) => (_e, cx) => {
      this.column = key;
      cx.notify();
    };
    return h_flex().flex_wrap().gap(4).children(COLUMNS.filter((c) => c.drop).map((c) => this.chip(t, `column-${c.key}`, c.name, c.key === this.column, choose(c.key))));
  }

  toggle(t, key, text) {
    return this.chip(t, `toggle-${key}`, this[key] ? `✓ ${text}` : text, this[key], (_e, cx) => {
      this[key] = !this[key];
      cx.notify();
    });
  }

  ownerChoice(t) {
    const choose = (key) => (_e, cx) => {
      this.owner = key;
      cx.notify();
    };
    return OWNERS.map(({ key, name }) => this.chip(t, `owner-${key}`, name, key === this.owner, choose(key)));
  }

  ownerRow(t) {
    return h_flex().flex_none().flex_wrap().gap(4).children(this.ownerChoice(t)).child(this.toggle(t, "worktree", "Use a worktree"));
  }

  targets() {
    return sendTargets({ agents: agents(), panes: panes(), terminals: terminals(), spaces: spaces() }, this.space, props().members ?? []);
  }

  row(t, id, name, detail, control) {
    return h_flex()
      .id(id)
      .flex_none()
      .h(FORM.sendRow)
      .px(9)
      .gap(8)
      .items_center()
      .rounded(7)
      .border_1()
      .border_color(t.input)
      .child(div().flex_1().min_w(0).truncate().child(name))
      .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(detail))
      .when(control !== null, (el) => el.child(control));
  }

  sendRow(t, target, enabled) {
    const where = [target.tab, target.flipped ? "Chat" : null, target.address].filter(Boolean).join(" · ");
    return this.row(t, `target-${target.address}`, target.name, where, this.rowButton(t, `send-${target.address}`, this.busy === "send" ? "Sending…" : "Send", (_e, cx) => this.send(target.address, cx), enabled));
  }

  // The sessions behind this card, each with Open while it is live.
  linkedSessions(t, enabled, targets) {
    const sessions = this.item ? cardSessions(this.item) : [];
    if (sessions.length === 0) return [];
    const lists = { terminals: terminals(), targets, orchestrator: this.orchestrator };
    const rows = sessions.map(({ role, address }) => {
      const { name, status, live } = describeSession(lists, address);
      const canResume = !live && role === "Run by" && Boolean(this.item.session);
      const resume = canResume ? this.rowButton(t, `session-resume-${address}`, "Resume", (_e, cx) => this.resume(cx), enabled) : null;
      const open = live ? this.rowButton(t, `session-open-${address}`, "Open", (_e, cx) => this.openLinked(address, cx), enabled) : resume;
      return this.row(t, `session-row-${address}`, `${role} ${name}`, [status, address].filter(Boolean).join(" · "), open);
    });
    return [this.labeled(t, "Session", v_flex().gap(FORM.sendGap).children(rows))];
  }

  sendTo(t, enabled, targets) {
    if (targets.length === 0) return div().text_size(12).text_color(t.dim).child("No agents in this space.");
    return v_flex().gap(FORM.sendGap).children(targets.map((x) => this.sendRow(t, x, enabled)));
  }

  // What the session reported, and the box that answers it on a card in Waiting on you.
  updateFields(t, enabled, story, height) {
    const shown = story && div().id("todo-note").max_h(height).overflow_y_scrollbar().text_size(12.5).child(TextView.markdown("todo-story", story.text).selectable(true));
    const update = story ? [this.labeled(t, story.label, shown)] : [];
    if (!this.canReply()) return update;
    const row = h_flex()
      .gap(8)
      .items_center()
      .child(this.fieldStyle(Input.new(this.replyBox).flex_1().h(FORM.input), t, "reply"))
      .child(this.button(t, "reply-todo", this.busy === "reply" ? "Sending…" : "Reply", true, (_e, cx) => this.reply(cx), enabled));
    return [...update, this.labeled(t, this.waiting() ? "Reply" : "Feedback", row)];
  }

  render() {
    const t = theme();
    const enabled = this.ready();
    const story = this.item ? cardStory(this.item) : null;
    const sizes = todoLayout({ height: props().height, waiting: this.canReply(), story });
    const targets = this.targets();
    const reading = v_flex().flex_1().min_w(0).gap(FORM.gap).children([
      ...this.updateFields(t, enabled, story, sizes.story),
      this.labeled(t, "Title", this.fieldStyle(Input.new(this.title).h(FORM.input), t, "title")),
      this.labeled(t, "Notes", this.fieldStyle(Textarea.new(this.notes).h(sizes.notes).py(8), t, "notes")),
    ]);
    const controls = v_flex().flex_none().w(FORM.side).gap(FORM.gap).children([
      ...this.linkedSessions(t, enabled, targets),
      this.labeled(t, "Column", this.columnChoice(t)),
      this.labeled(t, "Owner", this.ownerRow(t)),
      ...(this.id ? [this.labeled(t, "Send to", this.sendTo(t, enabled, targets))] : []),
    ]);
    const fields = [h_flex().flex_none().items_start().gap(FORM.columnGap).child(reading).child(controls)];
    const footer = this.footer()
      .when(Boolean(this.id), (el) => el.child(this.button(t, "archive-todo", this.busy === "archive" ? "Archiving…" : "Archive", false, (_e, cx) => this.archive(cx), enabled)))
      .child(div().flex_1())
      .child(this.button(t, "cancel-todo", "Cancel", false, () => this.close(), true))
      .child(this.button(t, "save-todo", this.busy === "save" ? "Saving…" : "Save", true, (_e, cx) => this.save(cx), enabled));
    const details = this.item ? [this.item.id, ...cardTimes(this.item, Date.now())].join(" · ") : null;
    return this.frame(t, "hws-todo", this.body(t, "todo-body", this.item?.archived ? "Archived to-do" : this.id ? "To-do" : "New to-do", fields, details), footer);
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

const ROLES = [
  { key: "orchestrator", name: "Orchestrator", line: "Reads the board and decides how to run the cards. Always Claude Code." },
  { key: "worker", name: "Workers", line: "Do the cards." },
];
const MODEL_LABEL = 52;

export class ModelsForm extends DialogForm {
  constructor(cx) {
    super(cx);
    this.settings = null;
    cx.spawn(async (cx) => {
      try {
        this.settings = await hws(["models"]);
      } catch (e) {
        this.problem = message(e);
      }
      cx.notify();
    });
  }

  ready() {
    return super.ready() && Boolean(this.settings);
  }

  pick(role, change) {
    return (_e, cx) => {
      Object.assign(this.settings[role], change);
      cx.notify();
    };
  }

  useRecommended(cx) {
    const { orchestrator, worker } = this.settings.recommended;
    Object.assign(this.settings.orchestrator, orchestrator);
    Object.assign(this.settings.worker, worker);
    cx.notify();
  }

  recommendedInUse() {
    return ROLES.every(({ key }) => ["tool", "model", "effort"].every((f) => this.settings[key][f] === this.settings.recommended[key][f]));
  }

  modelName(role, id) {
    return this.settings.catalog[this.settings[role].tool].models.find((x) => x.id === id)?.name ?? id;
  }

  recommendedLine() {
    const { orchestrator, worker } = this.settings.recommended;
    return `Recommended: ${this.modelName("orchestrator", orchestrator.model)} on ${orchestrator.effort} orchestrates, ${this.modelName("worker", worker.model)} on ${worker.effort} does the cards.`;
  }

  // A model set through hws stays selectable even when the list does not name it.
  modelChoices(role) {
    const { tool, model } = this.settings[role];
    const models = this.settings.catalog[tool].models;
    return models.some((x) => x.id === model) ? models : [...models, { id: model, name: model }];
  }

  // One joined control, so the row reads as a single choice.
  segments(t, options) {
    return h_flex()
      .flex_none()
      .rounded(7)
      .border_1()
      .border_color(t.input)
      .overflow_hidden()
      .children(
        options.map(({ id, text, on, action }, i) =>
          h_flex()
            .id(id)
            .flex_none()
            .h(FORM.chip)
            .px(10)
            .items_center()
            .when(i > 0, (el) => el.border_l_1().border_color(t.input))
            .when(on, (el) => el.bg(t.selected).font_medium())
            .text_size(12)
            .text_color(on ? t.foreground : t.muted)
            .cursor_pointer()
            .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
            .on_click(action)
            .child(text),
        ),
      );
  }

  row(t, label, options) {
    return h_flex()
      .flex_none()
      .gap(10)
      .items_center()
      .child(div().w(MODEL_LABEL).flex_none().text_size(11.5).text_color(t.dim).child(label))
      .child(this.segments(t, options));
  }

  roleFields(t, { key, name, line }) {
    const current = this.settings[key];
    const option = (id, text, on, action) => ({ id, text, on, action });
    const tools = Object.entries(this.settings.catalog).map(([id, tool]) => option(`${key}-tool-${id}`, tool.name, id === current.tool, this.pick(key, { tool: id, model: tool.recommendedWorker })));
    const models = this.modelChoices(key).map((x) => option(`${key}-model-${x.id}`, x.name, x.id === current.model, this.pick(key, { model: x.id })));
    const efforts = this.settings.catalog[current.tool].efforts.map((x) => option(`${key}-effort-${x}`, x, x === current.effort, this.pick(key, { effort: x })));
    return v_flex()
      .flex_none()
      .gap(FORM.rowGap)
      .child(
        v_flex()
          .flex_none()
          .gap(2)
          .pb(2)
          .child(div().line_height(lineHeight(FORM.sectionName)).text_size(13).font_semibold().child(name))
          .child(div().line_height(lineHeight(FORM.label)).text_size(11.5).text_color(t.dim).child(line)),
      )
      .when(key === "worker", (el) => el.child(this.row(t, "Tool", tools)))
      .child(this.row(t, "Model", models))
      .child(this.row(t, "Effort", efforts));
  }

  save(cx) {
    this.submit("save", async () => {
      for (const { key } of ROLES) {
        const { tool, model, effort } = this.settings[key];
        await hws(["models", "set", "--role", key, "--tool", tool, textFlag("model", model), "--effort", effort]);
      }
    }, cx);
  }

  render() {
    const t = theme();
    const enabled = this.ready();
    const fields = this.settings
      ? [div().flex_none().line_height(lineHeight(FORM.label)).text_size(11.5).text_color(t.muted).child(this.recommendedLine()), ...ROLES.map((role) => this.roleFields(t, role))]
      : [];
    const inUse = Boolean(this.settings) && this.recommendedInUse();
    const footer = this.footer()
      .when(inUse, (el) => el.child(div().id("models-recommended-note").flex_none().text_size(11.5).text_color(t.dim).child("Using the recommended setup")))
      .when(!inUse, (el) => el.child(this.button(t, "models-recommended", "Use recommended", false, (_e, cx) => this.useRecommended(cx), enabled)))
      .child(div().flex_1())
      .child(this.button(t, "cancel-todo", "Cancel", false, () => this.close(), true))
      .child(this.button(t, "models-save", this.busy === "save" ? "Saving…" : "Save", true, (_e, cx) => this.save(cx), enabled));
    return this.frame(t, "hws-models", this.body(t, "models-body", "Models", fields), footer);
  }
}
