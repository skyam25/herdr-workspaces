// The right panel's Tasks and Outputs, one copy per view, chosen by props().view.
// A dialog copy with view "todo" shows the to-do form.
// An agent binds to a session only by exact terminal, so this panel never guesses.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, exec, layout, openOverlay, panes, props, readTextFile, run, setShared, shared, spaces, terminals, theme, watchFolder } from "herdr";
import { COLUMNS, DONE_SHOWN, POLL_MS, ago, agentName, board, cleanPath, feedbackDir, fileName, findNode, isTracked, lastTouched, mergeBoard, notesLine, outputGroups, parseItems, parseOutputs, roster, sendTargets, sessionFor, todoItems } from "./data.js";
import { hws, openOutput } from "./open.js";
import { TODOS_CHANGED, TodoForm } from "./todo.js";

const WAITING_KEY = "hws.tasks.waiting";
const WIDE_PX = 720;
const NARROW_PANEL_PX = 368;
const WIDE_PANEL_PX = 860;
const LOADING = "Loading…";
const TRACKING_OFF = "Item tracking is off for these sessions. Turn it on in the Agent Brief app.";
const NO_AGENT_ITEMS = { waiting: [], progress: [], done: [] };

// True when Outputs is the visible child of a shown panel.
function outputsShowing() {
  const tree = layout();
  const panel = findNode(tree, "panel");
  const body = findNode(tree, "panel-body");
  return !panel || !body || (!panel.hidden && body.active === "outputs");
}

export default class Work extends View {
  init(_props, cx) {
    if (props()?.view === "todo") {
      this.form = new TodoForm(cx);
      return;
    }
    this.kind = props()?.view === "outputs" ? "outputs" : "tasks";
    this.sessions = null;
    this.problem = null;
    this.note = null;
    this.width = 0;
    this.doneOpen = false;
    this.touchedOpen = new Set();
    this.docs = new Map();
    this.roster = [];
    this.bound = [];
    this.boundKey = "";
    this.dirs = new Set();
    this.watching = new Set();
    this.remote = false;
    this.targets = [];
    this.todos = null;
    this.todoProblem = null;
    this.drag = null;
    this.over = null;
    this.syncTodos(cx);
    this.poll(cx);

    // Tasks keeps polling while hidden because the tab bar shows its waiting count.
    cx.timer.every(POLL_MS, (cx) => {
      if (this.kind === "tasks" || outputsShowing()) this.poll(cx);
      if (this.kind === "tasks") this.loadTodos(cx);
    });
  }

  poll(cx) {
    if (this.fetching) return;
    this.fetching = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("agent-brief", ["sessions", "--json"]);
        if (r.code === 0) {
          this.sessions = JSON.parse(r.stdout).sessions ?? [];
          this.problem = null;
        } else this.problem = r.stderr.trim().split("\n")[0] || "Agent Brief is not running.";
      } catch (e) {
        this.problem = `Could not run agent-brief: ${e?.message ?? e}`;
      } finally {
        this.fetching = false;
        this.rebind(cx, true);
        cx.notify();
      }
    });
  }

  // Loads to-dos when the active space changes or a dialog reports a change.
  syncTodos(cx) {
    if (this.kind !== "tasks") return;
    const space = spaces().find((s) => s.active)?.id ?? null;
    const revision = shared(TODOS_CHANGED) ?? 0;
    if (space === this.todoSpace && revision === this.todoRevision) return;
    if (space !== this.todoSpace) {
      this.todos = null;
      this.todoProblem = null;
      this.note = null;
      this.drag = null;
      this.over = null;
    }
    this.todoSpace = space;
    this.todoRevision = revision;
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
        const listed = todoItems(await hws(["todo", "list", "--space", space]));
        if (space === this.todoSpace) {
          this.todos = listed;
          this.todoProblem = null;
        }
      } catch (e) {
        if (space === this.todoSpace) this.todoProblem = String(e?.message ?? e);
      }
      this.loadingTodos = false;
      if (this.loadAgain) {
        this.loadAgain = false;
        this.loadTodos(cx);
      }
      cx.notify();
    });
  }

  openTodo(id) {
    if (!this.todoSpace) return;
    const todoProps = { view: "todo", space: this.todoSpace, ...(id ? { id } : {}) };
    openOverlay({ mod: "hws-work", kind: "dialog", modal: true, width: 440, height: id ? 520 : 370, props: todoProps });
  }

  moveTodo(id, column, cx) {
    this.note = null;
    cx.spawn(async (cx) => {
      try {
        await hws(["todo", "move", "--id", id, "--column", column, "--space", this.todoSpace]);
        this.loadTodos(cx);
      } catch (e) {
        this.note = String(e?.message ?? e);
      }
      cx.notify();
    });
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

  // Recomputes the active space's agents and their sessions, and loads files when they change.
  rebind(cx, reload = false) {
    const lists = { agents: agents(), panes: panes(), terminals: terminals(), spaces: spaces() };
    const active = lists.spaces.find((s) => s.active);
    this.remote = Boolean(active?.machine);
    this.targets = active ? sendTargets(lists, active.id) : [];
    this.roster = roster(lists);
    this.bound = this.roster.map((agent) => ({ agent, session: sessionFor(this.sessions, agent.address) })).filter((b) => b.session);
    const key = this.bound.map((b) => b.session.sessionId).join(" ");
    if (!reload && key === this.boundKey) return;
    this.boundKey = key;
    const ids = new Set(this.bound.map((b) => b.session.sessionId));
    for (const id of this.docs.keys()) if (!ids.has(id)) this.docs.delete(id);
    this.dirs = new Set(this.bound.map((b) => feedbackDir(b.session)));
    for (const { session } of this.bound) this.load(session, cx);
  }

  load(session, cx) {
    const id = session.sessionId;
    const cwd = cleanPath(session.cwd);
    const outputsPath = session.outputsPath ?? `${cwd}/.feedback/outputs/${id}.json`;
    const itemsPath = session.itemsPath ?? `${cwd}/.feedback/items/${id}.md`;
    cx.spawn(async (cx) => {
      const [outputs, items] = await Promise.all([readTextFile(outputsPath).catch(() => null), readTextFile(itemsPath).catch(() => null)]);
      if (!this.bound.some((b) => b.session.sessionId === id)) return;
      this.docs.set(id, { outputs: outputs === null ? [] : parseOutputs(outputs), items: items === null ? null : parseItems(items) });

      // A missing folder has nothing to watch, so a later poll arms this.
      if (outputs !== null || items !== null) this.watch(feedbackDir(session), cx);
      cx.notify();
    });
  }

  watch(dir, cx) {
    if (this.watching.has(dir)) return;
    this.watching.add(dir);
    cx.spawn(async (cx) => {
      try {
        while (this.dirs.has(dir)) {
          await watchFolder(dir);
          for (const { session } of this.bound) if (feedbackDir(session) === dir) this.load(session, cx);
        }
      } catch {
        // The next poll watches again.
      }
      this.watching.delete(dir);
    });
  }

  // Selects the agent's tab when another is active, then focuses its terminal or chat pane.
  focusAgent(agent) {
    const activeTab = spaces().find((s) => s.active)?.tabs.find((x) => x.active)?.id;
    if (agent.tab && agent.tab !== activeTab) run("tab.select", { id: agent.tab });
    run("pane.focus", agent.chatPane ? { pane: agent.chatPane } : { terminal: agent.address });
  }

  open(group, output, cx) {
    this.note = null;
    cx.spawn(async (cx) => {
      this.note = await openOutput(group.agent, group.session, output.ref);
      cx.notify();
    });
  }

  // Why the panel has no agents to show, or null when it has.
  blocker() {
    if (this.problem) return this.problem;
    if (this.sessions === null) return LOADING;
    if (this.remote) return this.kind === "tasks" ? "This space runs on another machine, so agent items are not shown." : "This space runs on another machine. This panel only covers this Mac.";
    if (this.roster.length === 0) return "No Claude Code agents in this space.";
    if (this.bound.length === 0) return "Agent Brief reports no session for the Claude Code agents in this space.";
    if (!this.bound.every((b) => this.docs.has(b.session.sessionId))) return LOADING;
    return null;
  }

  // Keeps the tab bar's badge equal to the Waiting on you count.
  publishWaiting(count) {
    if (shared(WAITING_KEY) !== count) setShared(WAITING_KEY, count);
  }

  render(cx) {
    if (this.form) return this.form.render();
    const t = theme();
    this.rebind(cx);
    this.syncTodos(cx);
    const blocker = this.blocker();
    const body = this.kind === "outputs" ? this.outputsBody(t, blocker) : this.tasksBody(t, blocker);
    return v_flex()
      .id("root")
      .on_size_change((size, cx) => {
        this.width = size.width;
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
      .child(div().font_semibold().child(title))
      .when(count !== null, (el) => el.child(div().text_size(12).text_color(t.dim).child(String(count))))
      .child(div().flex_1())
      .when(control !== null, (el) => el.child(control));
  }

  message(t, text) {
    return div().p(14).text_size(12).text_color(t.dim).whitespace_normal().child(text);
  }

  tasksBody(t, blocker) {
    const agentColumns = blocker === null ? board(this.bound, this.docs) : NO_AGENT_ITEMS;
    if (blocker !== LOADING) this.publishWaiting(agentColumns.waiting.length);
    const columns = mergeBoard(this.todos ?? [], agentColumns);
    const open = columns.todo.length + columns.doing.length + columns.waiting.length;
    const controls = h_flex().flex_none().gap(4).items_center().child(this.addButton(t, "add", "+ Add")).child(this.expandButton(t));
    const header = this.header(t, "Tasks", blocker === LOADING ? null : open, controls);
    const wide = this.width >= WIDE_PX;
    const lanes = COLUMNS.map((c) => this.lane(t, c, columns[c.key], wide));
    const content = wide
      ? h_flex().id("board").flex_1().min_h(0).w_full().items_stretch().p(8).gap(8).children(lanes)
      : v_flex().id("stack").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(14).children(lanes);
    return { header, quiet: this.quietLine(blocker, agentColumns), content };
  }

  // The one line under the header. A failed action outranks the state of agent items.
  quietLine(blocker, agentColumns) {
    if (this.note) return this.note;
    if (this.todoProblem) return this.todoProblem;
    if (blocker === LOADING) return null;
    if (blocker !== null) return blocker;
    const agentItems = agentColumns.waiting.length + agentColumns.progress.length + agentColumns.done.length;
    const tracked = this.bound.some((b) => isTracked(b.session, this.docs.get(b.session.sessionId)));
    return agentItems === 0 && !tracked ? TRACKING_OFF : null;
  }

  addButton(t, id, text) {
    return div()
      .id(id)
      .flex_none()
      .px(6)
      .h(20)
      .flex()
      .items_center()
      .rounded(5)
      .text_size(11)
      .text_color(t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => this.openTodo(null))
      .child(text);
  }

  expandButton(t) {
    const wide = this.width >= WIDE_PX;
    return div()
      .id("expand")
      .flex_none()
      .px(6)
      .h(20)
      .flex()
      .items_center()
      .rounded(5)
      .text_size(11)
      .text_color(t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => run("layout.resize", { id: "panel", px: wide ? NARROW_PANEL_PX : WIDE_PANEL_PX }))
      .child(wide ? "Collapse" : "Expand");
  }

  // One status column: a head and its cards, scrolling on its own when wide.
  lane(t, column, cards, wide) {
    const lit = column.drop && Boolean(this.drag?.moved) && this.over === column.key;
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
      .when(column.key === "todo", (el) => el.child(div().flex_1()).child(this.addButton(t, "add-todo", "+")));
    const rows = this.laneRows(t, column, cards);
    const lane = v_flex()
      .id(`lane-${column.key}`)
      .p(4)
      .gap(6)
      .rounded(8)
      .when(lit, (el) => el.bg(t.selected))
      .on_hover((hovered, cx) => this.hoverLane(column.key, hovered, cx))
      .on_mouse_up("left", (_e, cx) => this.releaseOnLane(column, cx));
    if (!wide) return lane.flex_none().child(head).children(rows);
    return lane
      .h_full()
      .flex_1()
      .min_w(0)
      .min_h(0)
      .child(head)
      .child(v_flex().id(`scroll-${column.key}`).flex_1().min_h(0).overflow_y_scrollbar().gap(6).children(rows));
  }

  laneRows(t, column, cards) {
    const isDone = column.key === "done";
    const shown = isDone && !this.doneOpen ? cards.slice(0, DONE_SHOWN) : cards;
    const rows = shown.map((c) => (c.kind === "todo" ? this.todoCard(t, c, column.key) : this.card(t, c)));
    if (isDone && cards.length > DONE_SHOWN) rows.push(this.moreRow(t, cards.length - DONE_SHOWN));
    return rows;
  }

  todoCard(t, item, columnKey) {
    const notes = notesLine(item.notes);
    const sentTo = item.terminal ? (this.targets.find((x) => x.address === item.terminal)?.name ?? item.terminal) : null;
    return v_flex()
      .id(`todo-${item.id}`)
      .flex_none()
      .p(8)
      .gap(3)
      .rounded(7)
      .border_1()
      .border_color(t.border)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .when(this.drag?.id === item.id && this.drag.moved, (el) => el.opacity(0.45))
      .on_mouse_down("left", () => this.pressTodo(item, columnKey))
      .on_mouse_up("left", (_e, cx) => this.releaseOnCard(item, cx))
      .on_hover((hovered, cx) => this.hoverCard(item.id, hovered, cx))
      .child(div().line_height("18px").max_h(36).overflow_hidden().whitespace_normal().child(item.title))
      .when(Boolean(notes), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(notes)))
      .when(sentTo !== null, (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(`Sent to ${sentTo}`)));
  }

  card(t, card) {
    const meta = card.last === null ? card.name : `${card.name} · ${card.last}`;
    return v_flex()
      .id(`card-${card.agent.address}-${card.n}`)
      .flex_none()
      .p(8)
      .gap(3)
      .rounded(7)
      .border_1()
      .border_color(t.border)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.focusAgent(card.agent))
      .child(
        h_flex()
          .items_start()
          .gap(6)
          .child(div().flex_none().text_size(12).line_height("18px").text_color(t.dim).child(`#${card.n}`))
          .child(div().flex_1().min_w(0).line_height("18px").max_h(36).overflow_hidden().whitespace_normal().child(card.title)),
      )
      .child(div().truncate().text_size(11).text_color(t.dim).child(meta));
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
    const groups = blocker === null ? outputGroups(this.bound, this.docs) : [];
    const count = groups.reduce((sum, g) => sum + g.declared.length + g.touched.length, 0);
    const header = this.header(t, "Outputs", blocker === null ? count : null);
    if (blocker !== null) return { header, content: this.message(t, blocker) };
    if (count === 0) return { header, content: this.message(t, "No outputs yet. An output appears here when an agent declares a file or touches one.") };
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
      .when(labelled, (el) => el.child(div().id(`group-${group.agent.address}`).px(8).pb(3).text_size(11.5).font_medium().text_color(t.muted).child(agentName(group.session))))
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
