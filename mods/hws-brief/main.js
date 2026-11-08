// Agent Brief's outputs and items for a Claude Code terminal.
// Work opens in the app. This pane never sends and never guesses a send target.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, panes, focused, props, exec, readTextFile, watchFolder, theme, run, nextCommand, closeOverlay } from "herdr";

const MOD = "hws-brief";
const HERDR_APP_BUNDLE = "dev.herdr.app";
const EMPTY_DOC = { outputs: [], items: null };
const STATUS_WORD = { working: "Working", blocked: "Needs you", done: "Done", idle: "Idle" };

const isClaude = (a) => a.app === "claude-code" || a.program?.key === "claude";
const isRemote = (address) => address.includes("/");
const cleanPath = (p) => (p ?? "").replace(/\/+$/, "");
const lastFolder = (p) => cleanPath(p).split("/").pop() || p;
const fileName = (ref) => ref.split("/").filter(Boolean).pop() ?? ref;
const hasScheme = (ref) => /^[a-z][a-z0-9+.-]*:/i.test(ref);

const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|[\w-]+(\.[\w-]+)*\.(localhost|local))$/i;
const isLocalUrl = (ref) => LOCAL_HOST.test(/^https?:\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(ref)?.[1] ?? "");

// Matches refSurface in companion/src/shared/output-file.ts.
const opensInApp = (ref) => (hasScheme(ref) ? isLocalUrl(ref) : /\.(html?|md|markdown|mdx)$/i.test(ref));

// Same rules as companion/src/shared/output-file.ts.
function parseOutputs(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (raw?.version !== 1 || !Array.isArray(raw.outputs)) return [];
  const seen = new Set();
  return raw.outputs.filter((o) => {
    if (typeof o?.ref !== "string" || !o.ref.trim() || !["declared", "detected"].includes(o.tier) || typeof o.kind !== "string" || seen.has(o.ref)) return false;
    seen.add(o.ref);
    return true;
  });
}

// Same format as companion/src/shared/items.ts.
function parseItems(text) {
  const items = [];
  let current;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const item = /^- \[( |x|X)\] #(\d+)\s*(.*)$/.exec(line);
    if (item) {
      current = { n: Number(item[2]), title: item[3].trim(), done: item[1] !== " ", lines: [] };
      items.push(current);
    } else if (line.trim() !== "" && /^\s+/.test(line) && current) {
      const spoken = /^(Claude|You):\s?(.*)$/.exec(line.trim());
      if (spoken) current.lines.push({ by: spoken[1] === "You" ? "you" : "claude", text: spoken[2].trim() });
    } else if (line.trim() !== "") {
      current = undefined;
    }
  }
  return items;
}

const awaitsUser = (item) => !item.done && item.lines.at(-1)?.by === "claude";

function ago(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

const lastTouched = (o) => Math.max(o.declaredAt ?? 0, o.lastWriteAt ?? 0);

export default class Brief extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.sessions = null;
    this.problem = null;
    this.note = null;
    this.last = null;
    this.picked = new Map();
    this.docId = null;
    this.doc = EMPTY_DOC;
    this.current = null;
    this.at = 0;
    this.touchedOpen = false;
    this.watching = new Set();

    // `mod.open:hws-brief` runs this copy as a brief overlay that seats or focuses the pane.
    if (props()?.overlay) {
      cx.spawn(async () => this.launch());
      return;
    }

    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") {
          this.handle.focus();
          cx.notify();
        }
      }
    });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  // One key: seats the pane beside the focused terminal, then focuses it, then closes it.
  launch() {
    const f = focused();
    const seated = panes().find((p) => p.mod === MOD && p.tab === f?.tab);
    closeOverlay(props().overlay);
    if (seated && seated.focused) run("pane.close", { pane: seated.pane });
    else if (seated) run("pane.focus", { pane: seated.pane });
    else if (f?.pane) run("pane.split", { direction: "right", pane: f.pane, mod: MOD, props: f.terminal ? { terminal: f.terminal } : {} });
  }

  refresh(cx) {
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
        this.problem = `Could not run agent-brief: ${e}`;
      } finally {
        this.fetching = false;
        if (this.current) this.load(this.current, cx);
        cx.notify();
      }
    });
  }

  // The agent this pane shows: its opening terminal, else the focused Claude agent, else
  // the last one focused, else the only Claude agent in the focused tab.
  target() {
    const claude = agents().filter(isClaude);
    const opened = claude.find((a) => a.address === props()?.terminal);
    if (opened) return { agent: opened, isPinned: true };
    const f = focused();
    const now = claude.find((a) => a.focused) ?? claude.find((a) => a.address === f?.terminal);
    if (now) {
      this.last = now.address;
      return { agent: now, isPinned: false };
    }
    const inTab = claude.filter((a) => a.tab === f?.tab);
    return { agent: claude.find((a) => a.address === this.last) ?? (inTab.length === 1 ? inTab[0] : null), isPinned: false };
  }

  // The session of `agent`. `hcTerminal` is exact. A folder match is a candidate until the user confirms it.
  bind(agent) {
    const sessions = this.sessions ?? [];
    const exact = sessions.find((s) => s.host?.hcTerminal === agent.address);
    if (exact) return { session: exact, via: "terminal", candidates: [] };
    const cwd = cleanPath(panes().find((p) => p.terminal === agent.address)?.cwd);
    const candidates = cwd ? sessions.filter((s) => cleanPath(s.cwd) === cwd && s.host?.bundleId === HERDR_APP_BUNDLE && !s.host?.hcTerminal) : [];
    const picked = candidates.find((s) => s.sessionId === this.picked.get(agent.address));
    if (picked) return { session: picked, via: "picked", candidates };
    return { session: candidates.length === 1 ? candidates[0] : null, via: candidates.length > 0 ? "folder" : null, candidates };
  }

  ensure(session, cx) {
    this.current = session;
    if (this.docId === session.sessionId) return;
    this.docId = session.sessionId;
    this.doc = EMPTY_DOC;
    this.note = null;
    this.load(session, cx);
  }

  clearDoc() {
    this.current = null;
    this.docId = null;
    this.doc = EMPTY_DOC;
  }

  load(session, cx) {
    const id = session.sessionId;
    const cwd = cleanPath(session.cwd);
    const outputsPath = session.outputsPath ?? `${cwd}/.feedback/outputs/${id}.json`;
    const itemsPath = session.itemsPath ?? `${cwd}/.feedback/items/${id}.md`;
    cx.spawn(async (cx) => {
      const [outputs, items] = await Promise.all([readTextFile(outputsPath).catch(() => null), readTextFile(itemsPath).catch(() => null)]);
      if (this.docId !== id) return;
      this.doc = { outputs: outputs === null ? [] : parseOutputs(outputs), items: items === null ? null : parseItems(items) };
      // A missing folder has nothing to watch, so the 10-second refresh arms this later.
      if (outputs !== null || items !== null) this.watch(`${cwd}/.feedback`, cx);
      cx.notify();
    });
  }

  watch(dir, cx) {
    this.watchDir = dir;
    if (this.watching.has(dir)) return;
    this.watching.add(dir);
    cx.spawn(async (cx) => {
      try {
        while (this.watchDir === dir) {
          await watchFolder(dir);
          if (this.watchDir === dir && this.current) this.load(this.current, cx);
        }
      } catch {
        // The next refresh watches again.
      }
      this.watching.delete(dir);
    });
  }

  openOutput(output, session, cx) {
    const cwd = cleanPath(session.cwd);
    const target = hasScheme(output.ref) || output.ref.startsWith("/") ? output.ref : `${cwd}/${output.ref}`;
    const isInApp = opensInApp(output.ref) && (hasScheme(output.ref) || target.startsWith(`${cwd}/`));
    this.note = null;
    cx.spawn(async (cx) => {
      try {
        const r = isInApp ? await exec("agent-brief", ["open", "--session", session.sessionId, "--output", target]) : await exec("open", [target]);
        if (r.code !== 0) this.note = (r.stderr || r.stdout).trim() || `Could not open ${output.ref}`;
      } catch (e) {
        this.note = `Could not open ${output.ref}: ${e}`;
      }
      cx.notify();
    });
  }

  pick(agent, session, cx) {
    this.picked.set(agent.address, session.sessionId);
    cx.notify();
  }

  onKey(e, cx) {
    const count = this.actions.length;
    if (e.key === "escape" && this.shown) run("pane.focus", { terminal: this.shown.address });
    else if ((e.key === "down" || e.key === "j") && count) this.at = (this.at + 1) % count;
    else if ((e.key === "up" || e.key === "k") && count) this.at = (this.at + count - 1) % count;
    else if (e.key === "enter" && count) this.actions[this.at](cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // Registers a keyboard action and returns its row index.
  action(fn) {
    this.actions.push(fn);
    return this.actions.length - 1;
  }

  row(t, id, index) {
    return h_flex()
      .id(id)
      .h(28)
      .flex_none()
      .px(8)
      .gap(8)
      .items_center()
      .rounded(7)
      .when(index === this.at && this.handle.is_focused(), (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover));
  }

  outputRow(t, session, output, canOpen, now) {
    const isDeclared = output.tier === "declared";
    const label = isDeclared ? (output.title ?? fileName(output.ref)) : output.ref;
    const status = isDeclared ? (output.status === "ready" ? "Ready" : "Drafting") : null;
    const at = lastTouched(output);
    const index = canOpen ? this.action((cx) => this.openOutput(output, session, cx)) : -1;
    return this.row(t, `output-${output.ref}`, index)
      .when(canOpen, (el) => el.on_click((_e, cx) => { this.at = index; cx.notify(); }))
      .child(div().flex_1().min_w(0).truncate().child(label))
      .when(status !== null, (el) => el.child(div().text_size(11).text_color(status === "Ready" ? t.done : t.dim).child(status)))
      .when(at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(now - at))))
      .when(canOpen, (el) =>
        el.child(
          div()
            .id(`open-${output.ref}`)
            .flex_none()
            .px(6)
            .h(20)
            .flex()
            .items_center()
            .rounded(5)
            .border_1()
            .border_color(t.border)
            .text_size(11)
            .text_color(t.muted)
            .cursor_pointer()
            .hover((s) => s.bg(t.raised).text_color(t.foreground))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.at = index;
              this.openOutput(output, session, cx);
            })
            .child("Open"),
        ),
      );
  }

  outputsSection(t, session, canOpen, now) {
    const { outputs } = this.doc;
    const declared = outputs.filter((o) => o.tier === "declared").sort((a, b) => (b.declaredAt ?? 0) - (a.declaredAt ?? 0));
    const touched = outputs.filter((o) => o.tier === "detected").sort((a, b) => (b.lastWriteAt ?? 0) - (a.lastWriteAt ?? 0));
    const rows = declared.map((o) => this.outputRow(t, session, o, canOpen, now));
    if (touched.length > 0) {
      const toggle = (cx) => {
        this.touchedOpen = !this.touchedOpen;
        cx.notify();
      };
      const index = this.action(toggle);
      rows.push(
        this.row(t, "touched", index)
          .cursor_pointer()
          .on_click((_e, cx) => toggle(cx))
          .text_color(t.dim)
          .child(`${this.touchedOpen ? "▾" : "▸"} Touched (${touched.length})`),
      );
      if (this.touchedOpen) rows.push(...touched.map((o) => this.outputRow(t, session, o, canOpen, now)));
    }
    return v_flex()
      .flex_none()
      .gap(1)
      .child(section(t, "Outputs"))
      .when(outputs.length === 0, (el) => el.child(div().px(8).text_color(t.dim).child("No outputs yet.")))
      .children(rows);
  }

  itemsSection(t) {
    const { items } = this.doc;
    if (items === null) return null;
    const open = items.filter((i) => !i.done);
    const done = items.length - open.length;
    return v_flex()
      .flex_none()
      .gap(6)
      .child(section(t, "Items"))
      .when(items.length === 0, (el) => el.child(div().px(8).text_color(t.dim).child("No items yet.")))
      .children(
        open.map((item) => {
          const claude = item.lines.filter((l) => l.by === "claude").at(-1)?.text;
          return v_flex()
            .px(8)
            .gap(2)
            .flex_none()
            .child(
              h_flex()
                .gap(6)
                .child(div().flex_none().font_semibold().child(`#${item.n}`))
                .child(div().flex_1().min_w(0).truncate().child(item.title))
                .when(awaitsUser(item), (el) => el.child(div().flex_none().text_size(11).text_color(t.blocked).child("Waiting on you"))),
            )
            .when(claude !== undefined, (el) => el.child(div().text_size(12).text_color(t.dim).truncate().child(`Claude: ${claude}`)));
        }),
      )
      .when(done > 0, (el) => el.child(div().px(8).text_size(11).text_color(t.dim).child(`${done} done`)))
      .when(open.some(awaitsUser), (el) => el.child(div().px(8).text_size(11).text_color(t.dim).child("Answer in the terminal or in Agent Brief.")));
  }

  // Candidate sessions for a terminal without an exact match. Picking one binds it for this pane.
  pickSection(t, agent, bound, now) {
    return v_flex()
      .flex_none()
      .gap(1)
      .child(section(t, bound.candidates.length === 1 ? "Confirm the session" : "Pick this terminal's session"))
      .child(div().px(8).pb(4).text_size(12).text_color(t.dim).child("Sessions in this folder do not report their terminal yet. Open stays off until you choose one."))
      .children(
        bound.candidates.map((s) => {
          const choose = (cx) => this.pick(agent, s, cx);
          const index = this.action(choose);
          return this.row(t, `pick-${s.sessionId}`, index)
            .cursor_pointer()
            .on_click((_e, cx) => choose(cx))
            .when(s.sessionId === bound.session?.sessionId && bound.via === "picked", (el) => el.bg(t.selected))
            .child(div().flex_1().min_w(0).truncate().child(s.summary || s.title || s.sessionId))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(s.activeAt ? ago(now - s.activeAt) : "new"));
        }),
      );
  }

  render(cx) {
    if (props()?.overlay) return div();
    const t = theme();
    const now = Date.now();
    this.actions = [];
    const { agent, isPinned } = this.target();
    this.shown = agent;
    const bound = agent && !isRemote(agent.address) ? this.bind(agent) : null;
    if (bound?.session) this.ensure(bound.session, cx);
    else this.clearDoc();

    let message = null;
    if (this.problem) message = this.problem;
    else if (this.sessions === null) message = "Loading…";
    else if (!agent) message = "Focus a Claude Code terminal to see its Brief.";
    else if (isRemote(agent.address)) message = "This agent runs on another machine. The Brief only covers this Mac.";
    else if (bound.via === null) message = "No Agent Brief session matches this terminal.";

    const session = bound?.session ?? null;
    const canOpen = bound?.via === "terminal" || bound?.via === "picked";
    const showsPick = bound?.via === "folder" || (bound?.via === "picked" && bound.candidates.length > 1);

    const parts = [];
    if (message !== null) parts.push(div().px(8).text_color(t.dim).child(message));
    else {
      if (showsPick) parts.push(this.pickSection(t, agent, bound, now));
      if (session) {
        parts.push(this.outputsSection(t, session, canOpen, now));
        const items = this.itemsSection(t);
        if (items) parts.push(items);
      }
    }
    if (this.at >= this.actions.length) this.at = Math.max(0, this.actions.length - 1);

    const statusColor = t[agent?.status] ?? t.dim;
    const mode = session?.mode && session.mode !== "default" ? session.mode[0].toUpperCase() + session.mode.slice(1) : null;
    return v_flex()
      .id("brief")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .size_full()
      .min_h(0)
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(13)
      .child(
        v_flex()
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
              .child(div().font_semibold().child("Brief"))
              .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(session ? session.name || session.title || lastFolder(session.cwd) : ""))
              .when(Boolean(agent), (el) => el.child(div().flex_none().text_size(11).text_color(statusColor).child(STATUS_WORD[agent.status] ?? agent.status)))
              .when(mode !== null, (el) => el.child(div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(mode))),
          )
          .when(Boolean(agent), (el) =>
            el.child(
              div()
                .truncate()
                .text_size(11)
                .text_color(t.dim)
                .child([agent.space_name, bound?.via === "terminal" ? `terminal ${agent.address}` : bound?.via === "picked" ? "matched by your pick" : bound?.via === "folder" ? "matched by folder" : null, isPinned ? "pinned to this terminal" : null].filter(Boolean).join(" · ")),
            ),
          ),
      )
      .child(v_flex().id("brief-body").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(14).children(parts))
      .when(Boolean(this.note), (el) => el.child(div().flex_none().px(14).py(6).text_size(11).text_color(t.blocked).child(this.note)));
  }
}

function section(t, title) {
  return div().px(8).pb(3).text_size(11.5).font_medium().text_color(t.muted).child(title);
}
