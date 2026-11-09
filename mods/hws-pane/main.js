// A pane header with a Chat | Terminal switch for Claude Code and Codex panes.
// Chat splits hws-chat beside the agent's pane, trades places with it, then parks the terminal, so the chat takes its spot.
// Terminal reverses the swap. Each swap's last step removes this header's pane, so it runs last.
// The core label herdr.chat=<chat pane> records which chat shows which agent.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, theme, home, exec, hc, nextCommand, shared, setShared, openOverlay } from "herdr";
import { panes, terminals, spaces, inRender } from "./live.js";
import { button as uiButton, segmented, TEXT, RADIUS, toast, plainError } from "./ui.js";
import { LABEL, sweep } from "./parked.js";

const CHAT = "hws-chat";
const BOARD = "hws-work";
const SWEEP_MS = 4000;
const NEW_COPY_MS = 2000;
const SWAP_GAP_MS = 3000;
const CHAT_FADE_OUT_MS = 120;
const TRADE_TRIES = 10;
const TRADE_RETRY_MS = 50;
const LEAVING = "hws-chat.leaving";
const MENU_WIDTH = 240;
const BOARDS = "hws-pane.boards";
const BOARDS_MS = 5000;
const BOARDS_SLOW_MS = 60000;

// Every header copy shares these.
let lastSwap = 0;
let lastSweep = 0;
let lastBoards = 0;
let boardsJson = "";
let boardsTerminals = "";
let resuming = false;

const hws = (args) => exec(`${home()}/.local/bin/hws`, [...args, "--json"]);
const boardsOf = (terminal) => (shared(BOARDS) ?? []).filter((b) => b.terminal === terminal);

// One header copy reads the list, and shared state carries it to the others.
// A window opens and closes with its host terminal, so the slow timer only catches the rest.
async function refreshBoards() {
  const live = terminals().filter((x) => x.state === "live").map((x) => x.address).join();
  const sinceLast = Date.now() - lastBoards;
  if (sinceLast < BOARDS_MS / 2 || (live === boardsTerminals && sinceLast < BOARDS_SLOW_MS)) return;
  boardsTerminals = live;
  lastBoards = Date.now();
  let r;
  try { r = await hws(["surface", "list"]); } catch { return; }
  if (r.code !== 0 || r.stdout === boardsJson) return;
  boardsJson = r.stdout;
  try { setShared(BOARDS, JSON.parse(r.stdout)); } catch { boardsJson = ""; }
}

async function resumeBoard(id) {
  if (resuming) return;
  resuming = true;
  try {
    const r = await hws(["surface", "resume", "--id", id]);
    if (r.code !== 0) throw new Error(r.stdout.trim() || r.stderr.trim());
  } catch (e) {
    toast({ title: "Board didn't open", body: plainError(e), level: "error" });
  }
  resuming = false;
  lastBoards = 0;
  refreshBoards();
}

const chatty = (p) => Boolean(p?.terminal) && (["claude-code", "codex"].includes(p.app) || ["claude", "codex"].includes(p.program?.key));

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(`${h}/`) ? `~${cwd.slice(h.length)}` : cwd;
}

function chatOf(terminal) {
  const chat = terminals().find((x) => x.address === terminal)?.labels?.[LABEL];
  return chat && panes().some((p) => p.pane === chat && p.mod === CHAT) ? chat : null;
}

const agentOf = (chat) => terminals().find((x) => x.labels?.[LABEL] === chat && x.state === "live")?.address ?? null;

// Runs one app command and waits, because a swap's steps must go in order.
async function app(name, args) {
  const r = await exec("herdr-app", ["do", name, ...Object.entries(args).flatMap(([k, v]) => [`--${k}`, typeof v === "string" ? v : JSON.stringify(v)])]);
  let out = {};
  try { out = JSON.parse(r.stdout || "{}"); } catch { out = {}; }
  if (r.code !== 0 || out.error) throw new Error(out.error || r.stderr?.trim() || `${name} failed`);
  return out;
}

// Closing a pane gives its width to the pane on its left. Moving the new pane left of the old one
// makes the new pane the heir, so the neighbors keep their sizes.
// terminal.keep answers before its pane exists, so this retries. A flip still finishes if it fails.
async function tradePlaces(old, fresh, cx) {
  for (let i = 0; i < TRADE_TRIES; i++) {
    try {
      await app("pane.swap", { pane: old, target: fresh });
      return;
    } catch {
      await cx.sleep(TRADE_RETRY_MS);
    }
  }
}

function parked(terminal) {
  const k = terminals().find((x) => x.address === terminal);
  if (!k) return null;
  const status = ["working", "blocked", "done", "idle"].includes(k.status) ? k.status : null;
  return { program: k.program, status, cwd: k.foreground?.cwd ?? k.cwd ?? null, title: k.title ?? "" };
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.busy = false;
    this.ending = false;
    this.born = Date.now();

    cx.timer.every(SWEEP_MS, () => {
      if (Date.now() - lastSweep < SWEEP_MS / 2) return;
      lastSweep = Date.now();
      sweep();
    });
    refreshBoards();
    cx.timer.every(BOARDS_MS, () => { refreshBoards(); });

    // A short wait lets a reloaded build exit at its next cx use.
    cx.spawn(async (cx) => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        const self = this.me();
        if (c !== "toggle" || !self?.focused) continue;

        // The new pane's header may receive the toggle that made it, which would swap straight back.
        if (Date.now() - this.born < NEW_COPY_MS || Date.now() - lastSwap < SWAP_GAP_MS) continue;
        lastSwap = Date.now();
        if (self.mod === CHAT) { if (agentOf(self.pane)) this.toTerminal(self.pane, cx); }
        else if (chatty(self)) this.toChat(self, cx);
      }
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, name, onClick) {
    return h_flex()
      .id(id)
      .size(24)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(RADIUS.control)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onClick();
        cx.notify();
      })
      .child(svg(`mods/hws-pane/${name}.svg`).size(14));
  }

  // Opens the + menu at the pointer. A chat pane speaks for the agent parked behind it.
  openActions(self, agent) {
    const space = spaces().find((s) => s.tabs.some((c) => c.id === self.tab))?.id;
    const cwd = self.mod === CHAT ? parked(agent)?.cwd : self.cwd;
    const where = { space, ...(cwd ? { cwd } : {}) };
    const boards = boardsOf(agent ?? self.terminal);
    const owned = boards.length > 0 ? { boards } : {};
    const menu = self.mod === CHAT ? { terminal: agent, chat: true, pane: self.pane, ...owned, ...where } : { terminal: self.terminal, ...owned, ...where };
    openOverlay({ mod: "hws-actions", kind: "popup", width: MENU_WIDTH, props: menu });
  }

  // Acts on the newest board. The + menu lists them all and discards drafts.
  boardButton(boards, pane) {
    const board = boards.at(-1);
    const more = boards.length > 1 ? ` +${boards.length - 1}` : "";
    return uiButton(`ph-board-${pane}`, `${board.open ? "Show" : "Resume"} board${more}`, { onClick: () => resumeBoard(board.id) });
  }

  toChat(p, cx) {
    const open = chatOf(p.terminal);
    if (open) { run("pane.focus", { pane: open }); return; }
    if (this.busy) return;
    this.busy = true;
    this.going = "chat";
    const terminal = p.terminal;
    cx.spawn(async (cx) => {
      try {
        const out = await app("pane.split", { direction: "right", pane: p.pane, mod: CHAT, props: { terminal } });
        if (!out.pane) throw new Error("Herdr didn't open the chat");
        run("pane.focus", { pane: out.pane });
        await tradePlaces(p.pane, out.pane, cx);

        // These run together so the half-width split barely shows.
        await Promise.all([hc(["label", terminal, `${LABEL}=${out.pane}`]), app("terminal.park", { terminal })]);
      } catch (e) {
        this.going = null;
        toast({ title: "Chat didn't open", body: plainError(e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  toTerminal(chat, cx) {
    const terminal = agentOf(chat);

    // The agent ended or still has its own pane, so only the chat needs closing.
    const own = terminal && panes().find((x) => x.terminal === terminal);
    if (!terminal || own) {
      const zoomed = panes().find((x) => x.pane === chat)?.zoomed;
      run("pane.close", { pane: chat });
      if (terminal) hc(["label", terminal, `${LABEL}=`]);
      if (own) {
        if (zoomed && own.zoomed) run("pane.zoom", { pane: own.pane });
        run("pane.focus", { pane: own.pane });
      }
      return;
    }

    if (this.busy) return;
    this.busy = true;
    this.going = "terminal";
    setShared(LEAVING, { pane: chat, at: Date.now() });

    // The chat fades out first, because a terminal can't fade in.
    cx.timer.after(CHAT_FADE_OUT_MS, (cx) => cx.spawn(async (cx) => {
      try {
        await app("pane.focus", { pane: chat });
        const [out] = await Promise.all([app("terminal.keep", { terminal, place: "right" }), hc(["label", terminal, `${LABEL}=`])]);
        if (out.pane) {
          await tradePlaces(chat, out.pane, cx);
          run("pane.focus", { pane: out.pane });
        }
        await app("pane.close", { pane: chat });
      } catch (e) {
        this.going = null;
        setShared(LEAVING, null);
        toast({ title: "Terminal didn't come back", body: plainError(e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    }));
  }

  // Closing a chat ends its agent, as closing the agent's own pane would.
  endChat(chat) {
    this.ending = false;
    const terminal = agentOf(chat);
    if (terminal) run("terminal.kill", { terminal });
    run("pane.close", { pane: chat });
  }

  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    const t = theme();
    const self = this.me();
    if (!self) return div();

    const chatMode = self.mod === CHAT;
    const agent = chatMode ? agentOf(self.pane) : null;
    const p = (agent && parked(agent)) ?? self;
    const prog = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "Shell";
    const board = self.mod === BOARD;
    const name = self.mod === "hws-panel" ? "Workspace" : board ? "Board" : chatMode && !agent ? "Chat" : prog;
    const pic = icon(p.program, 14, t.dim);
    const pane = self.pane;
    const canSwitch = chatMode ? Boolean(agent) : chatty(self);

    // A surface runs on this computer, so a remote agent has no + menu.
    const canAct = canSwitch && !(agent ?? self.terminal ?? "").includes("/");
    const confirming = Boolean(agent) && this.ending;
    const boards = canAct ? boardsOf(agent ?? self.terminal) : [];

    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(TEXT.label)
      .on_hover((hovered, cx) => { this.hovered = hovered; if (!hovered) this.ending = false; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().max_w(260).min_w(0).truncate().font_medium().text_color(t.foreground).child(name))
      .child(div().flex_shrink_1().min_w(0).truncate().text_color(t.dim).child(folder(board ? null : p.cwd)))
      .child(div().flex_1())
      .when(p.status === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(p.status === "blocked", (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(RADIUS.control).bg(`${t.blocked}26`).text_size(TEXT.id).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(p.status === "done", (el) => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(confirming, (el) => el
        .child(div().flex_none().whitespace_nowrap().text_color(t.foreground).child(`End ${prog}?`))
        .child(uiButton(`ph-end-no-${pane}`, "Cancel", { kind: "plain", onClick: () => { this.ending = false; } }))
        .child(uiButton(`ph-end-${pane}`, "End agent", { kind: "primary", onClick: () => this.endChat(pane) })))
      .when(this.hovered && !confirming, (el) => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", () => run("pane.split", { direction: "right", pane })))
        .child(this.button(t, `ph-d-${pane}`, "split-down", () => run("pane.split", { direction: "down", pane })))
        .child(this.button(t, `ph-z-${pane}`, self.zoomed ? "unzoom" : "zoom", () => run("pane.zoom", { pane })))
        .child(this.button(t, `ph-x-${pane}`, "close", () => { if (agent) this.ending = true; else run("pane.close", { pane }); })))
      .when(canAct, (el) => el.child(this.button(t, `ph-new-${pane}`, "plus", () => this.openActions(self, agent))))
      .when(boards.length > 0, (el) => el.child(this.boardButton(boards, pane)))
      .when(canSwitch, (el) => el.child(segmented(`ph-mode-${pane}`, [["chat", "Chat"], ["terminal", "Terminal"]], this.going ?? (chatMode ? "chat" : "terminal"),
        (v, _e, cx) => (v === "chat" ? this.toChat(self, cx) : this.toTerminal(pane, cx)))));
  }
}
