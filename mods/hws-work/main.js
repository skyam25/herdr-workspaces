// The Tasks tab and the right panel's Outputs, one copy per view, chosen by props().view.
// A dialog copy with view "todo", "add-several" or "models" shows a form.
// Outputs gets each agent's outputs from `hws outputs`, which binds agents only by exact terminal, so this mod never guesses.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, home, layout, openOverlay, panes, props, setShared, shared, spaces, terminals, theme, watchFolder } from "herdr";
import { COLUMNS, DONE_SHOWN, POLL_MS, SESSION_ENDED, SOME_AGENT, ago, cardSummary, describeSession, feedbackDir, fileName, findNode, lastTouched, locateTerminal, mergeWaiting, orchestratorFolder, outputGroups, ownerTag, replyEnded, roster, sendTargets, severalDialogHeight, todoColumns, todoDialogSize, todoItems, MODELS_DIALOG, modelsDialogHeight, modelsLine } from "./data.js";
import { focusAgent, hws, openOutput, openSession } from "./open.js";
import { AddSeveralForm, ModelsForm, TODOS_CHANGED, TodoForm, textFlag } from "./todo.js";

const WAITING_KEY = "hws.tasks.waiting";
const DIALOG_PX = 440;
const LANE_PX = 200;
const BOARD_CHROME_PX = 42;
const LANES_FIT_PX = 840;
const LOADING = "Loading…";
const NO_OUTPUTS = "No outputs recorded yet.";
const TASKS_HINT = "Add a card, press Allow on it, then press Run.";
const NEEDS_WORKSPACE = "Tasks only work inside a workspace. Add this space to a workspace to use them.";
const STOP_QUESTION = "Stop orchestrator and its workers?";
const archiveQuestion = (n) => `Archive ${n} done ${n === 1 ? "card" : "cards"}?`;

// Claude reports no status while a start-up prompt is open, so silence this long means it is waiting.
const SILENT_START_MS = 20000;

// A session on a start-up prompt reports nothing and has taken no turn.
const silentSince = (record, since) => !record.status && !(record.turn > 0) && Date.now() - since > SILENT_START_MS;

const message = (e) => String(e?.message ?? e);

// One quiet look for every board control. A primary one is solid.
function buttonLook(el, t, enabled, primary) {
  return el
    .flex_none()
    .h(22)
    .px(8)
    .flex()
    .items_center()
    .rounded(6)
    .border_1()
    .border_color(primary ? t.solid : t.input)
    .bg(primary ? t.solid : t.raised)
    .text_size(11.5)
    .text_color(primary ? t.solid_foreground : t.foreground)
    .opacity(enabled ? 1 : 0.5)
    .when(enabled, (e) => e.cursor_pointer().hover((s) => (primary ? s.opacity(0.88) : s.bg(t.hover))));
}

// True when Outputs is the visible child of a shown panel.
function outputsShowing() {
  const tree = layout();
  const panel = findNode(tree, "panel");
  const body = findNode(tree, "panel-body");
  return !panel || !body || (!panel.hidden && body.active === "outputs");
}

export default class Work extends View {
  init(_props, cx) {
    const view = props()?.view;
    const FORMS = { todo: TodoForm, "add-several": AddSeveralForm, models: ModelsForm };
    if (FORMS[view]) {
      this.form = new FORMS[view](cx);
      return;
    }
    this.kind = view === "outputs" ? "outputs" : "tasks";
    this.found = null;
    this.problem = null;
    this.note = null;
    this.width = 0;
    this.height = 0;
    this.doneOpen = false;
    this.touchedOpen = new Set();
    this.roster = [];
    this.rosterKey = null;
    this.dirs = new Set();
    this.watching = new Set();
    this.remote = false;
    this.targets = [];
    this.todos = null;
    this.todoProblem = null;
    this.drag = null;
    this.over = null;
    this.orchestrator = undefined;
    this.orchestratorBusy = null;
    this.confirmingStop = false;
    this.confirmingArchive = false;
    this.archiving = false;
    this.members = [];
    this.boardSpaces = [];
    this.workspace = null;
    if (this.kind === "tasks") {
      this.makeQuickAdd();
      this.syncTodos(cx);
    } else this.poll(cx);

    // Tasks keeps polling while hidden because the tab bar shows its waiting count.
    cx.timer.every(POLL_MS, (cx) => {
      if (this.kind === "tasks") this.loadTodos(cx);
      else if (outputsShowing()) this.poll(cx);
    });
  }

  // Tasks lists its spaces with its cards, so only Outputs asks for them.
  setMembers(members, cx) {
    if (JSON.stringify(members) === JSON.stringify(this.members)) return;
    this.members = members;
    this.rebind(cx);
  }

  // The spaces whose agents this view covers: the active space's workspace, or none.
  async loadMembers() {
    const space = spaces().find((s) => s.active);
    if (!space || space.machine) {
      this.members = [];
      return;
    }
    const listed = await hws(["todo", "list", "--space", space.id]).catch(() => null);
    this.members = listed?.spaces ?? [];
  }

  // Asks hws for each agent's outputs. A call made while one runs waits for it, then runs once.
  poll(cx) {
    if (this.fetching) {
      this.again = true;
      return;
    }
    this.fetching = true;
    cx.spawn(async (cx) => {
      try {
        await this.loadMembers();
        this.rebind(cx, false);
        const addresses = this.roster.map((a) => a.address);
        const listed = addresses.length > 0 ? await hws(["outputs", "--terminals", addresses.join(",")]) : null;
        this.found = new Map((listed?.agents ?? []).map((entry) => [entry.terminal, entry]));
        this.problem = null;
      } catch (e) {
        this.problem = message(e);
      } finally {
        this.fetching = false;
        this.watchFolders(cx);
        cx.notify();
        if (this.again) {
          this.again = false;
          this.poll(cx);
        }
      }
    });
  }

  // Loads to-dos when the active space changes or a dialog reports a change.
  syncTodos(cx) {
    const space = spaces().find((s) => s.active)?.id ?? null;
    const revision = shared(TODOS_CHANGED) ?? 0;
    if (space === this.todoSpace && revision === this.todoRevision) return;
    if (space !== this.todoSpace) {
      this.todos = null;
      this.todoProblem = null;
      this.orchestrator = undefined;
      this.plainSpace = false;
      this.confirmingStop = false;
      this.confirmingArchive = false;
      this.note = null;
      this.drag = null;
      this.over = null;
      this.boardSpaces = [];
      this.workspace = null;
    }
    this.todoSpace = space;
    this.todoRevision = revision;
    this.loadModels(cx);
    this.loadTodos(cx);
  }

  loadTodos(cx) {
    if (!this.todoSpace) return;
    if (this.loadingTodos) {
      this.loadAgain = true;
      return;
    }
    this.loadingTodos = true;
    const space = this.todoSpace;
    cx.spawn(async (cx) => {
      try {
        const listed = await hws(["todo", "list", "--space", space]);
        if (space === this.todoSpace) {
          this.todos = todoItems(listed);
          this.orchestrator = listed?.orchestrator ?? null;
          this.plainSpace = listed?.workspace === null;
          this.boardSpaces = listed?.spaces ?? [];
          this.setMembers(this.boardSpaces, cx);
          if (!this.orchestrator?.live) this.confirmingStop = false;
          this.todoProblem = null;
          if (listed?.workspace && listed.workspace !== this.workspace?.id) this.loadWorkspaceName(listed.workspace, cx);
        }
      } catch (e) {
        if (space === this.todoSpace) this.todoProblem = message(e);
      }
      if (space === this.todoSpace) this.publishWaiting(space);
      this.loadingTodos = false;
      if (this.loadAgain) {
        this.loadAgain = false;
        this.loadTodos(cx);
      }
      cx.notify();
    });
  }

  // The heading names the workspace. A failed lookup clears the record, so the next load asks again.
  loadWorkspaceName(id, cx) {
    this.workspace = { id, name: null };
    cx.spawn(async (cx) => {
      const listed = await hws(["list"]).catch(() => null);
      if (this.workspace?.id !== id) return;
      if (!Array.isArray(listed)) this.workspace = null;
      else this.workspace.name = listed.find((m) => m.id === id)?.name || null;
      cx.notify();
    });
  }

  loadModels(cx) {
    cx.spawn(async (cx) => {
      this.modelSettings = await hws(["models"]).catch(() => null);
      cx.notify();
    });
  }

  openDialog({ width, height }, dialogProps) {
    openOverlay({ mod: "hws-work", kind: "dialog", modal: true, width, height, props: { space: this.todoSpace, members: this.members, ...dialogProps } });
  }

  openTodo(id) {
    if (!this.todoSpace) return;
    const size = todoDialogSize({ width: this.width, height: this.height });
    this.openDialog(size, { view: "todo", height: size.height, ...(id ? { id } : {}) });
  }

  openModels() {
    this.openDialog({ width: MODELS_DIALOG.width, height: modelsDialogHeight() }, { view: "models" });
  }

  openSeveral() {
    if (this.todoSpace) this.openDialog({ width: DIALOG_PX, height: severalDialogHeight() }, { view: "add-several" });
  }

  makeQuickAdd() {
    this.quickFocused = false;
    this.quick = InputState.new({ placeholder: "Add a card, press Enter" });
    this.quick.on("submit", (_e, cx) => this.quickAdd(cx));
    for (const [event, focused] of [["focus", true], ["blur", false]]) {
      this.quick.on(event, (_e, cx) => {
        this.quickFocused = focused;
        cx.notify();
      });
    }
  }

  // Empties the input at once so the next card can be typed. A failed add puts its text back.
  quickAdd(cx) {
    const title = this.quick.value().trim();
    this.quick.focus();
    if (!title || !this.todoSpace) return;
    this.quick.set_value("");
    this.note = null;
    const space = this.todoSpace;
    cx.spawn(async (cx) => {
      try {
        await hws(["todo", "add", textFlag("title", title), "--space", space]);
        this.loadTodos(cx);
      } catch (e) {
        this.note = message(e);
        if (!this.quick.value()) this.quick.set_value(title);
      }
      cx.notify();
    });
  }

  // Runs one card change and reloads. A failure goes on the quiet line.
  changeTodo(args, cx) {
    this.note = null;
    cx.spawn(async (cx) => {
      try {
        await hws(["todo", ...args, "--space", this.todoSpace]);
        this.loadTodos(cx);
      } catch (e) {
        this.note = message(e);
      }
      cx.notify();
    });
  }

  moveTodo(id, column, cx) {
    this.changeTodo(["move", "--id", id, "--column", column], cx);
  }

  allowTodo(id, cx) {
    this.changeTodo(["edit", "--id", id, textFlag("owner", "agent")], cx);
  }

  // One command per card, so a failure stops the rest and names its card.
  allowAll(cards, cx) {
    this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const { id } of cards) await hws(["todo", "edit", "--id", id, textFlag("owner", "agent"), "--space", this.todoSpace]);
      } catch (e) {
        this.note = message(e);
      }
      this.loadTodos(cx);
      cx.notify();
    });
  }

  resumeTodo(id, cx) {
    this.changeTodo(["resume", "--id", id], cx);
  }

  askArchive(asking, cx) {
    this.confirmingArchive = asking;
    cx.notify();
  }

  // Archives every Done card in one command, then reloads.
  archiveDone(cx) {
    this.confirmingArchive = false;
    if (this.archiving || !this.todoSpace) return;
    this.archiving = true;
    this.note = null;
    cx.notify();
    const space = this.todoSpace;
    cx.spawn(async (cx) => {
      try {
        await hws(["todo", "archive", "--done", "--space", space]);
        this.loadTodos(cx);
      } catch (e) {
        this.note = message(e);
      }
      this.archiving = false;
      cx.notify();
    });
  }

  // Counts for the header and the cards Allow all acts on.
  boardCounts() {
    const cards = (this.todos ?? []).filter((x) => x.column === "todo");
    return {
      ready: cards.filter((x) => x.owner === "agent").length,
      unassigned: cards.filter((x) => x.owner === "unassigned"),
      running: (this.todos ?? []).filter((x) => x.column === "doing").length,
      waiting: (this.todos ?? []).filter((x) => x.column === "waiting").length,
      done: (this.todos ?? []).filter((x) => x.column === "done").length,
    };
  }

  orchestratorNeedsYou() {
    const record = this.frame.live.find((x) => x.address === this.orchestrator?.terminal);
    if (!record) return false;
    return record.status === "blocked" || silentSince(record, this.orchestrator.startedAt ?? Date.now());
  }

  // A worker on a start-up prompt reports nothing, so a silent one past the limit counts too.
  blockedWorkers() {
    const silent = (x) => (this.todos ?? []).some((card) => card.terminal === x.address && silentSince(x, card.updatedAt));
    return this.frame.live.filter((x) => x.state === "live" && x.labels?.["hws.todo"] && (x.status === "blocked" || silent(x))).length;
  }

  // Runs one orchestrator command at a time. A failure goes on the quiet line.
  orchestratorCommand(busy, args, cx, done = () => {}) {
    this.orchestratorBusy = busy;
    this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await hws(["orchestrator", ...args]);
        done();
        this.loadTodos(cx);
      } catch (e) {
        this.note = message(e);
      }
      this.orchestratorBusy = null;
      cx.notify();
    });
  }

  // Starts an orchestrator, or asks the live one to read the board again.
  runBoard(cx) {
    if (this.orchestratorBusy || !this.todoSpace) return;
    const lists = { agents: agents(), panes: panes(), terminals: terminals(), spaces: spaces() };
    const folder = orchestratorFolder(lists, this.todoSpace) ?? home();
    this.orchestratorCommand("send", ["start", "--space", this.todoSpace, "--folder", folder], cx);
  }

  // The header drops its controls at once, and the reload confirms it.
  stopOrchestrator(cx) {
    this.confirmingStop = false;
    if (this.orchestratorBusy || !this.todoSpace) return;
    const space = this.todoSpace;
    this.orchestratorCommand("stop", ["stop", "--space", space], cx, () => {
      if (space === this.todoSpace) this.orchestrator = null;
    });
  }

  askStop(asking, cx) {
    this.confirmingStop = asking;
    cx.notify();
  }

  goToOrchestrator() {
    const address = this.orchestrator?.terminal;
    if (address) focusAgent({ address, ...locateTerminal({ panes: panes(), terminals: terminals() }, address) });
  }

  // A press on a to-do card starts a drag. The pointer is already inside its column.
  pressTodo(item, from) {
    this.drag = { id: item.id, from, moved: false, crossed: false };
    this.over = from;
  }

  // Feedback waits for the pointer to leave the card, so a plain click draws nothing.
  hoverCard(id, hovered, cx) {
    if (hovered || this.drag?.id !== id || this.drag.moved) return;
    this.drag.moved = true;
    cx.notify();
  }

  hoverLane(key, hovered, cx) {
    if (!this.drag) return;
    if (hovered) {
      this.over = key;
      if (key !== this.drag.from) Object.assign(this.drag, { moved: true, crossed: true });
    } else if (this.over === key) {
      this.over = null;
    }
    cx.notify();
  }

  // Release handlers run from the card outward, so the root's cleanup comes last.
  releaseOnCard(item, cx) {
    const drag = this.drag;
    if (!drag || drag.id !== item.id || drag.crossed) return;
    this.endDrag(cx);
    this.openTodo(item.id);
  }

  releaseOnLane(column, cx) {
    const drag = this.drag;
    if (!drag?.crossed) return;
    this.endDrag(cx);
    if (column.drop && column.key !== drag.from) this.moveTodo(drag.id, column.key, cx);
  }

  endDrag(cx) {
    if (!this.drag) return;
    this.drag = null;
    this.over = null;
    cx.notify();
  }

  // Tasks names the workspace's agents. Outputs lists them and asks hws again when they change.
  rebind(cx, fetch = true) {
    const lists = { agents: agents(), panes: panes(), terminals: terminals(), spaces: spaces() };
    const active = lists.spaces.find((s) => s.active);
    if (this.kind === "tasks") {
      this.targets = active ? sendTargets(lists, active.id, this.members) : [];
      return;
    }
    this.remote = Boolean(active?.machine);
    this.roster = roster(lists, this.members);
    const key = this.roster.map((a) => a.address).join(" ");
    if (key === this.rosterKey) return;
    this.rosterKey = key;

    // A poll already running reads the roster once its members load.
    if (fetch && !this.fetching) this.poll(cx);
  }

  // Watches the .feedback folder of each agent with outputs. An agent with none waits for the next poll.
  watchFolders(cx) {
    const folders = [...(this.found?.values() ?? [])].filter((entry) => entry.folder && entry.outputs?.length > 0).map((entry) => feedbackDir(entry.folder));
    this.dirs = new Set(folders);
    for (const dir of this.dirs) this.watch(dir, cx);
  }

  watch(dir, cx) {
    if (this.watching.has(dir)) return;
    this.watching.add(dir);
    cx.spawn(async (cx) => {
      try {
        while (this.dirs.has(dir)) {
          await watchFolder(dir);
          this.poll(cx);
        }
      } catch {
        // The next poll watches again.
      }
      this.watching.delete(dir);
    });
  }

  open(group, output, cx) {
    this.note = null;
    cx.spawn(async (cx) => {
      this.note = await openOutput(group.agent, group.folder, output.ref);
      cx.notify();
    });
  }

  // Why Outputs has no agents to show, or null when it has.
  blocker() {
    if (this.problem) return this.problem;
    if (this.found === null) return LOADING;
    if (this.remote) return "This space runs on another machine. This panel only covers this Mac.";
    if (this.roster.length === 0) return "No Claude Code agents in this space.";
    return null;
  }

  // Sets this board's spaces in the shared map of space id to Waiting on you count.
  // The tab bar shows the active space's entry, and other spaces' entries stay.
  publishWaiting(space) {
    const count = (this.todos ?? []).filter((x) => x.column === "waiting").length;
    const ids = [...new Set([...this.boardSpaces, space])];
    const next = mergeWaiting(shared(WAITING_KEY), ids, count);
    if (next !== null) setShared(WAITING_KEY, next);
  }

  render(cx) {
    if (this.form) return this.form.render();
    const t = theme();
    this.rebind(cx);
    if (this.kind === "tasks") this.syncTodos(cx);
    const body = this.kind === "outputs" ? this.outputsBody(t, this.blocker()) : this.tasksBody(t);
    return v_flex()
      .id("root")
      .on_size_change((size, cx) => {
        this.width = size.width;
        this.height = size.height;
        cx.notify();
      })
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13)
      .when(this.kind === "tasks", (el) =>
        el.on_mouse_up("left", (_e, cx) => this.endDrag(cx)).on_hover((hovered, cx) => {
          if (!hovered) this.endDrag(cx);
        }),
      )
      .child(body.header)
      .when(Boolean(body.quiet), (el) => el.child(div().id("quiet").flex_none().px(14).py(5).text_size(11).text_color(t.dim).whitespace_normal().child(body.quiet)))
      .child(body.content)
      .when(this.kind === "outputs" && Boolean(this.note), (el) => el.child(div().id("note").flex_none().px(14).py(6).text_size(11).text_color(t.blocked).child(this.note)));
  }

  header(t, title, count, control = null) {
    return h_flex()
      .h(42)
      .flex_none()
      .px(14)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().id("heading").min_w(0).truncate().font_semibold().child(title))
      .when(count !== null, (el) => el.child(div().id("heading-count").flex_none().text_size(12).text_color(t.dim).child(String(count))))
      .child(div().flex_1())
      .when(control !== null, (el) => el.child(control));
  }

  message(t, text) {
    return div().p(14).text_size(12).text_color(t.dim).whitespace_normal().child(text);
  }

  tasksBody(t) {
    // One copy per render, because every card reads these and `terminals()` copies the whole list.
    this.frame = { live: terminals(), counts: this.boardCounts() };
    if (this.plainSpace) return { header: this.header(t, "Tasks", null, h_flex()), quiet: null, content: this.message(t, NEEDS_WORKSPACE) };

    const columns = todoColumns(this.todos ?? []);
    const open = columns.todo.length + columns.doing.length + columns.waiting.length;
    const controls = h_flex()
      .flex_none()
      .gap(4)
      .items_center()
      .child(this.runStatus(t))
      .children(this.orchestratorControls(t))
      .when(Boolean(this.modelSettings?.orchestrator), (el) => el.child(this.headerButton(t, "models", this.modelsLabel(t), () => this.openModels())))
      .children(this.runButton(t))
      .child(this.headerButton(t, "add", "+ Add", () => this.openTodo(null)))
      .child(this.headerButton(t, "add-several", "Add several", () => this.openSeveral()));
    const title = this.workspace?.name ? `Tasks · ${this.workspace.name}` : "Tasks";
    const header = this.header(t, title, this.todos === null ? null : `${open} open`, controls);
    const fits = this.width >= LANES_FIT_PX;
    const empty = this.todos !== null && Object.values(columns).every((cards) => cards.length === 0);
    const lanes = COLUMNS.map((c) => this.lane(t, c, columns[c.key], fits, empty));
    const content = h_flex().id("board").flex_1().min_h(0).w_full().items_stretch().p(8).gap(8).overflow_x_scrollbar().children(lanes);
    return { header, quiet: this.note ?? this.todoProblem, content };
  }

  // A label names the arrow, so the control reads as the models a run uses.
  modelsLabel(t) {
    return h_flex().gap(6).items_center().child(div().text_color(t.muted).child("Models")).child(div().child(modelsLine(this.modelSettings)));
  }

  // What is ready, in flight and owed, so the header answers "what happens if I press Run?".
  runStatus(t) {
    const { ready, unassigned, running, waiting } = this.frame.counts;
    const blocked = this.blockedWorkers();
    const ok = unassigned.length;
    const parts = [blocked > 0 && `${blocked} blocked, press Open`, running > 0 && `${running} running`, waiting > 0 && `${waiting} waiting on you`, ready === 0 && ok > 0 && `${ok} ${ok === 1 ? "needs" : "need"} your OK`].filter(Boolean);
    return div().id("run-status").flex_none().px(6).text_size(11).text_color(t.dim).child(parts.join(" · "));
  }

  // One button starts a run and adds to one, and it only appears when a card can start.
  runButton(t) {
    const { ready } = this.frame.counts;
    if (ready === 0 || this.confirmingStop) return [];
    const text = this.orchestratorBusy === "send" ? "Starting…" : `Run ${ready} ready`;
    return [this.headerButton(t, "run-board", text, (_e, cx) => this.runBoard(cx), this.orchestratorBusy === null, true)];
  }

  // A live orchestrator is the only thing that puts these in the header.
  orchestratorControls(t) {
    if (!this.orchestrator?.live) return [];
    const { ready, running, waiting, done } = this.frame.counts;
    const needsYou = this.orchestratorNeedsYou();
    const text = needsYou ? "Orchestrator needs you, press Go to" : ready + running + waiting === 0 && done > 0 ? "Run finished" : "Orchestrating";
    const label = div().id("orchestrating").flex_none().px(6).text_size(11).font_medium().text_color(needsYou ? t.blocked : t.accent).child(text);
    if (this.confirmingStop) return [label, this.stopConfirm(t)];
    const free = this.orchestratorBusy === null;
    return [
      label,
      this.headerButton(t, "orchestrator-go", "Go to", () => this.goToOrchestrator()),
      this.headerButton(t, "orchestrator-stop", this.orchestratorBusy === "stop" ? "Stopping…" : "Stop", (_e, cx) => this.askStop(true, cx), free),
    ];
  }

  // Asks in place. Moving the pointer away cancels, as the pane header's End agent does.
  stopConfirm(t) {
    return h_flex()
      .id("orchestrator-confirm")
      .flex_none()
      .gap(4)
      .items_center()
      .on_hover((hovered, cx) => {
        if (!hovered) this.askStop(false, cx);
      })
      .child(div().flex_none().whitespace_nowrap().text_size(11).text_color(t.foreground).child(STOP_QUESTION))
      .child(this.headerButton(t, "orchestrator-stop-no", "Cancel", (_e, cx) => this.askStop(false, cx)))
      .child(this.headerButton(t, "orchestrator-stop-yes", "Stop", (_e, cx) => this.stopOrchestrator(cx), true, true));
  }

  headerButton(t, id, text, action, enabled = true, primary = false) {
    return buttonLook(div().id(id), t, enabled, primary)
      .when(enabled, (el) => el.on_click(action))
      .child(text);
  }

  quickAddField(t) {
    return div()
      .id("quick-add")
      .flex_none()
      .child(Input.new(this.quick).h(30).px(8).rounded(7).border_1().border_color(this.quickFocused ? t.accent : t.input).bg(t.background).text_size(12).text_color(t.foreground));
  }

  // One status column: a head and its cards, scrolling on its own.
  lane(t, column, cards, fits, empty) {
    const lit = column.drop && Boolean(this.drag?.moved) && this.over === column.key;
    const { unassigned } = this.frame.counts;
    const head = h_flex()
      .id(`head-${column.key}`)
      .h(26)
      .flex_none()
      .px(4)
      .gap(7)
      .items_center()
      .child(div().flex_none().size(8).rounded_full().bg(t[column.color]))
      .child(div().text_size(12).font_medium().text_color(t.muted).child(column.name))
      .child(div().text_size(12).text_color(t.dim).child(String(cards.length)))
      .when(column.key === "todo" && unassigned.length > 1, (el) => el.child(div().flex_1()).child(this.headerButton(t, "allow-all", `Allow all ${unassigned.length}`, (_e, cx) => this.allowAll(unassigned, cx))))
      .when(column.key === "done" && cards.length > 0 && !this.confirmingArchive, (el) =>
        el.child(div().flex_1()).child(this.headerButton(t, "archive-done", this.archiving ? "Archiving…" : "Archive done", (_e, cx) => this.askArchive(true, cx), !this.archiving)),
      );
    const rows = this.laneRows(t, column, cards);

    // An empty column says what lands there. An empty board's To do says how to start instead.
    const hint = (id, text) => div().id(id).flex_none().px(4).py(4).text_size(11.5).text_color(t.dim).whitespace_normal().child(text);
    if (empty && column.key === "todo") rows.push(hint("board-hint", TASKS_HINT));
    else if (this.todos !== null && cards.length === 0) rows.push(hint(`empty-${column.key}`, column.empty));
    const lane = v_flex()
      .id(`lane-${column.key}`)
      .h_full()
      .min_h(0)
      .p(6)
      .gap(6)
      .rounded(8)
      .bg(lit ? t.selected : t.chrome)
      .on_hover((hovered, cx) => this.hoverLane(column.key, hovered, cx))
      .on_mouse_up("left", (_e, cx) => this.releaseOnLane(column, cx));

    // A fixed width keeps long card text from stretching its lane.
    const width = fits ? Math.floor((this.width - BOARD_CHROME_PX) / COLUMNS.length) : LANE_PX;
    return lane.flex_none().w(width)
      .child(head)
      .when(column.key === "todo", (el) => el.child(this.quickAddField(t)))
      .when(column.key === "done" && cards.length > 0 && this.confirmingArchive, (el) => el.child(this.archiveConfirm(t, cards.length)))
      .child(v_flex().id(`scroll-${column.key}`).flex_1().min_h(0).overflow_y_scrollbar().gap(6).children(rows));
  }

  // Asks in place, as Stop does. Moving the pointer away cancels.
  archiveConfirm(t, count) {
    return h_flex()
      .id("archive-confirm")
      .flex_none()
      .flex_wrap()
      .gap(4)
      .px(4)
      .items_center()
      .on_hover((hovered, cx) => {
        if (!hovered) this.askArchive(false, cx);
      })
      .child(div().flex_1().min_w(0).text_size(11).text_color(t.foreground).whitespace_normal().child(archiveQuestion(count)))
      .child(this.headerButton(t, "archive-done-no", "Cancel", (_e, cx) => this.askArchive(false, cx)))
      .child(this.headerButton(t, "archive-done-yes", "Archive", (_e, cx) => this.archiveDone(cx), true, true));
  }

  laneRows(t, column, cards) {
    const isDone = column.key === "done";
    const shown = isDone && !this.doneOpen ? cards.slice(0, DONE_SHOWN) : cards;
    const rows = shown.map((c) => this.todoCard(t, c, column.key));
    if (isDone && cards.length > DONE_SHOWN) rows.push(this.moreRow(t, cards.length - DONE_SHOWN));
    return rows;
  }

  tag(t, text) {
    return div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.dim).child(text);
  }

  // Stops the press, so a card's buttons neither open it nor start a drag.
  rowAction(t, id, text, action, primary = false) {
    return buttonLook(div().id(id), t, true, primary)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action(cx);
      })
      .child(text);
  }

  describe(address) {
    return describeSession({ terminals: this.frame.live, targets: this.targets, orchestrator: this.orchestrator?.terminal }, address);
  }

  // A different session that added the card, by name only while it is live and named.
  fromTag(item) {
    if (!item.addedBy || item.addedBy === item.terminal) return null;
    const { name, live } = this.describe(item.addedBy);
    return `From ${live && name ? name : SOME_AGENT}`;
  }

  // Open while the session is live and Resume once it has ended. A waiting card that can take no
  // reply offers Move to To do, the one move that frees it.
  sessionAction(t, item, address, live) {
    if (live) return this.rowAction(t, `open-${item.id}`, "Open", () => openSession(address));
    if (item.session) return this.rowAction(t, `resume-${item.id}`, "Resume", (cx) => this.resumeTodo(item.id, cx));
    if (item.column === "waiting" && replyEnded(item, false)) return this.rowAction(t, `move-todo-${item.id}`, "Move to To do", (cx) => this.moveTodo(item.id, "todo", cx));
    return null;
  }

  // The session running the card, with the action that fits its state.
  sessionRow(t, item, address) {
    const { name, status, live } = this.describe(address);
    const text = live ? [`Run by ${name ?? SOME_AGENT}`, status].filter(Boolean).join(" · ") : SESSION_ENDED;
    const action = this.sessionAction(t, item, address, live);
    return h_flex()
      .id(`session-${item.id}`)
      .gap(6)
      .items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(text))
      .when(action !== null, (row) => row.child(action));
  }

  // What every card shares: the frame, the press that starts a drag and the release that opens it.
  cardFrame(t, item, columnKey) {
    return v_flex()
      .id(`todo-${item.id}`)
      .flex_none()
      .rounded(7)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .when(this.drag?.id === item.id && this.drag.moved, (el) => el.opacity(0.45))
      .on_mouse_down("left", () => this.pressTodo(item, columnKey))
      .on_mouse_up("left", (_e, cx) => this.releaseOnCard(item, cx))
      .on_hover((hovered, cx) => this.hoverCard(item.id, hovered, cx));
  }

  // A Done card is one title line with its action, and at most one line of summary.
  doneCard(t, item) {
    const summary = item.summary ?? cardSummary(item);
    const action = item.terminal ? this.sessionAction(t, item, item.terminal, this.describe(item.terminal).live) : null;
    const top = h_flex().id(`done-top-${item.id}`).gap(6).items_center().child(div().flex_1().min_w(0).truncate().child(item.title));
    return this.cardFrame(t, item, "done")
      .px(8)
      .py(5)
      .gap(1)
      .child(top.when(action !== null, (row) => row.child(action)))
      .when(Boolean(summary), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(summary)));
  }

  todoCard(t, item, columnKey) {
    if (columnKey === "done") return this.doneCard(t, item);
    const summary = item.summary ?? cardSummary(item);
    const tags = [ownerTag(item), item.worktree && "Worktree", this.fromTag(item)].filter(Boolean);
    const canAllow = item.owner === "unassigned" && item.column === "todo";
    return this.cardFrame(t, item, columnKey)
      .p(8)
      .gap(3)
      .child(div().line_height("18px").max_h(36).overflow_hidden().whitespace_normal().child(item.title))
      .when(Boolean(summary), (el) => el.child(div().line_height("15px").max_h(45).overflow_hidden().whitespace_normal().text_size(11).text_color(t.dim).child(summary)))
      .when(Boolean(item.terminal), (el) => el.child(this.sessionRow(t, item, item.terminal)))
      .when(tags.length > 0, (el) =>
        el.child(
          h_flex()
            .id(`tags-${item.id}`)
            .flex_wrap()
            .gap(4)
            .items_center()
            .children(tags.map((x) => this.tag(t, x)))
            .when(canAllow, (row) => row.child(this.rowAction(t, `allow-${item.id}`, "Allow", (cx) => this.allowTodo(item.id, cx), true))),
        ),
      );
  }

  moreRow(t, hidden) {
    return div()
      .id("done-more")
      .h(24)
      .flex_none()
      .px(4)
      .flex()
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => {
        this.doneOpen = !this.doneOpen;
        cx.notify();
      })
      .child(this.doneOpen ? "Show fewer" : `${hidden} more`);
  }

  outputsBody(t, blocker) {
    const groups = blocker === null ? outputGroups(this.roster, this.found) : [];
    const count = groups.reduce((sum, g) => sum + g.declared.length + g.touched.length, 0);
    const header = this.header(t, "Outputs", blocker === null ? count : null);
    if (blocker !== null) return { header, content: this.message(t, blocker) };
    if (count === 0) return { header, content: this.message(t, NO_OUTPUTS) };
    const now = Date.now();
    const content = v_flex()
      .id("outputs")
      .flex_1()
      .min_h(0)
      .overflow_y_scrollbar()
      .p(6)
      .gap(10)
      .children(groups.map((g) => this.outputGroup(t, g, groups.length > 1, now)));
    return { header, content };
  }

  outputGroup(t, group, labelled, now) {
    const rows = group.declared.map((o) => this.outputRow(t, group, o, now));
    if (group.touched.length > 0) {
      const key = group.agent.address;
      const isOpen = this.touchedOpen.has(key);
      rows.push(this.touchedRow(t, key, group.touched.length, isOpen));
      if (isOpen) rows.push(...group.touched.map((o) => this.outputRow(t, group, o, now)));
    }
    return v_flex()
      .flex_none()
      .gap(1)
      .when(labelled, (el) => el.child(div().id(`group-${group.agent.address}`).px(8).pb(3).text_size(11.5).font_medium().text_color(t.muted).child(group.name)))
      .children(rows);
  }

  touchedRow(t, key, count, isOpen) {
    return h_flex()
      .id(`touched-${key}`)
      .h(28)
      .flex_none()
      .px(8)
      .items_center()
      .rounded(7)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        if (isOpen) this.touchedOpen.delete(key);
        else this.touchedOpen.add(key);
        cx.notify();
      })
      .child(`${isOpen ? "▾" : "▸"} Touched (${count})`);
  }

  outputRow(t, group, output, now) {
    const at = lastTouched(output);
    return h_flex()
      .id(`output-${group.agent.address}-${output.ref}`)
      .h(28)
      .flex_none()
      .px(8)
      .gap(8)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.open(group, output, cx))
      .child(div().flex_1().min_w(0).truncate().child(fileName(output.ref)))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(output.kind))
      .when(at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(now - at))));
  }
}
