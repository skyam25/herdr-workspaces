// The Phones popup, an overlay copy of hws-footer with { view: "phones" }. It lists the paired
// phones, what waits on the phone and a way to pair another. Only `hws` talks to the listener.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, home, closeOverlay, shared, setShared } from "herdr";

// The footer row reads the paired names from here, so it updates when the popup forgets a phone.
export const DEVICES_KEY = "hws-footer.devices";

// The popup asks the footer to pair, because the footer outlives the popup and keeps polling.
export const PAIR_KEY = "hws-footer.pair";

export const STATUS_POLL_MS = 3000;

// A phone talks to this Mac only while Agent Brief is open on it, and sends wait in its inbox
// until then. Active means a request in the last two minutes. The listener writes lastSeen at
// most once a minute, so a phone in use is never more than about a minute behind.
const CONNECTED_MS = 2 * 60_000;

const HANDOFFS_SHOWN = 5;
const STATUS_PROBLEM = "Couldn't read the phone status.";

const WIDTH = 320;
const MAX_HEIGHT = 440;
const PAD = 6;
const TITLE_H = 28;
const DEVICE_H = 60;
const LINE_H = 24;
const HANDOFF_H = 22;
const DIVIDER_H = 9;
const PAIR_H = 30;
const HINT_H = 28;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function hws(args) {
  for (const bin of [`${home()}/.local/bin/hws`, "hws"]) {
    try {
      const r = await exec(bin, [...args, "--json"]);
      if (r.code === 126 || r.code === 127) continue;
      return r.code === 0 ? JSON.parse(r.stdout || "{}") : null;
    } catch {
      // A missing program rejects, so the next candidate gets a turn.
    }
  }
  return null;
}

// Sets the shared list only when a name or connection changes, because every set redraws every mod.
export function publishDevices(devices, now = Date.now()) {
  const list = (devices ?? []).map((d) => ({ id: d.id, name: d.name, connected: isConnected(d, now) }));
  if (JSON.stringify(shared(DEVICES_KEY)) === JSON.stringify(list)) return;
  setShared(DEVICES_KEY, list);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function daysBetween(then, now) {
  const a = new Date(then).setHours(0, 0, 0, 0);
  const b = new Date(now).setHours(0, 0, 0, 0);
  return Math.round((b - a) / DAY);
}

function dateText(ms, now) {
  const d = new Date(ms);
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : `, ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

export const isConnected = (device, now) => typeof device.lastSeen === "number" && now - device.lastSeen < CONNECTED_MS;

export function seenText(ms, now) {
  const age = Math.max(0, now - ms);
  if (age < MINUTE) return "Seen just now";
  if (age < HOUR) return `Seen ${plural(Math.floor(age / MINUTE), "minute")} ago`;
  const days = daysBetween(ms, now);
  if (days <= 0) return `Seen ${plural(Math.floor(age / HOUR), "hour")} ago`;
  if (days === 1) return "Seen yesterday";
  if (days < 7) return `Seen ${days} days ago`;
  return `Seen ${dateText(ms, now)}`;
}

export function pairedText(ms, now) {
  const days = daysBetween(ms, now);
  if (days <= 0) return "Paired today";
  if (days === 1) return "Paired yesterday";
  return `Paired ${dateText(ms, now)}`;
}

function stateText(device, now) {
  if (isConnected(device, now)) return "Active now";
  if (typeof device.lastSeen !== "number") return "Idle · never opened";
  return `Idle · last active ${seenText(device.lastSeen, now).replace(/^Seen /, "")}`;
}

// The footer row and the popup title both say how many paired phones are active.
export function activeSummary(devices) {
  const on = devices.filter((d) => d.connected).length;
  if (!on) return "Idle";
  return on === devices.length ? "Active" : `${on} of ${devices.length} active`;
}

// A page hand-off names its file, and a board hand-off names the board it starts from.
function handoffLabel(h) {
  const what = h.page ? h.page.split("/").pop() : h.fromBoard || "Sketch";
  return h.sessionLabel ? `${what} · ${h.sessionLabel}` : what;
}

function listenerLine(status) {
  if (!status.running) return "This Mac isn't listening for phones";
  const waiting = status.handoffs?.length ?? 0;
  return waiting ? `${plural(waiting, "page")} waiting on the phone` : "Nothing waiting on the phone";
}

const noneConnected = (status, now) => status.devices.length > 0 && !status.devices.some((d) => isConnected(d, now));

const CHROME_H = PAD * 2 + TITLE_H + DIVIDER_H + PAIR_H;

// Herdr sizes a popup to its content, so the body takes this height and scrolls past it.
// Without a status yet, the body holds one line.
export function bodyHeight(status, problem = null, now = Date.now()) {
  const problemH = problem ? LINE_H : 0;
  if (!status) return problemH || LINE_H;
  const devices = Math.max(1, status.devices?.length ?? 0);
  const waiting = status.handoffs?.length ?? 0;
  const handoffRows = Math.min(waiting, HANDOFFS_SHOWN) + (waiting > HANDOFFS_SHOWN ? 1 : 0);
  const hint = status.devices && noneConnected(status, now) ? HINT_H : 0;
  const px = devices * DEVICE_H + hint + problemH + DIVIDER_H + LINE_H + handoffRows * HANDOFF_H;
  return Math.min(MAX_HEIGHT - CHROME_H, px);
}

// The footer places the popup above its row by this height.
export function popupSize(status, now = Date.now()) {
  return { width: WIDTH, height: CHROME_H + bodyHeight(status ? { devices: [], handoffs: [], ...status } : null, null, now) };
}

export class PhonesPopup {
  // The footer passes its last status, so the popup opens at the size it was placed for.
  constructor(overlay, cx, status = null) {
    this.overlay = overlay;
    this.status = status ? { ...status, devices: status.devices ?? [], handoffs: status.handoffs ?? [] } : null;
    this.problem = null;
    this.confirming = null;
    this.forgetting = null;
    this.seq = 0;
    cx.spawn(async (cx) => {
      await this.load();
      cx.notify();
    });
    cx.timer.every(STATUS_POLL_MS, async (cx) => {
      await this.load();
      cx.notify();
    });
  }

  // Only the newest read lands, so a slow poll cannot undo a Forget.
  async load() {
    const seq = ++this.seq;
    const status = await hws(["phone", "status"]);
    if (seq !== this.seq) return;
    if (!status) {
      this.problem = STATUS_PROBLEM;
      return;
    }
    this.status = { ...status, devices: status.devices ?? [], handoffs: status.handoffs ?? [] };
    if (this.problem === STATUS_PROBLEM) this.problem = null;
    publishDevices(this.status.devices);
  }

  ask(id, cx) {
    this.confirming = id;
    cx.notify();
  }

  forget(device, cx) {
    this.confirming = null;
    if (this.forgetting) return;
    this.forgetting = device.id;
    this.problem = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const done = await hws(["phone", "forget", device.id]);
      if (!done) this.problem = `Couldn't forget ${device.name}.`;
      await this.load();
      this.forgetting = null;
      cx.notify();
    });
  }

  pairAnother() {
    setShared(PAIR_KEY, { at: Date.now() });
    closeOverlay(this.overlay);
  }

  button(t, id, text, action, primary = false) {
    return div()
      .id(id)
      .flex_none()
      .px(6)
      .h(20)
      .flex()
      .items_center()
      .rounded(5)
      .text_size(11)
      .text_color(primary ? t.solid_foreground : t.muted)
      .when(primary, (el) => el.bg(t.solid))
      .cursor_pointer()
      .hover((s) => (primary ? s.opacity(0.88) : s.bg(t.hover).text_color(t.foreground)))
      .on_click(action)
      .child(text);
  }

  // Asks in place, as the Tasks board's Stop does. Moving the pointer away cancels.
  confirmRow(t, device) {
    return h_flex()
      .id(`forget-${device.id}-confirm`)
      .flex_1()
      .min_w(0)
      .gap(4)
      .items_center()
      .on_hover((hovered, cx) => {
        if (!hovered) this.ask(null, cx);
      })
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(`Forget ${device.name}?`))
      .child(this.button(t, `forget-${device.id}-no`, "Cancel", (_e, cx) => this.ask(null, cx)))
      .child(this.button(t, `forget-${device.id}-yes`, "Forget", (_e, cx) => this.forget(device, cx), true));
  }

  deviceRow(t, device, now) {
    const connected = isConnected(device, now);
    const dot = div().size(6).rounded_full().when(connected, (el) => el.bg(t.done)).when(!connected, (el) => el.border(1).border_color(t.dim));
    const row = h_flex().id(`phone-${device.id}`).h(DEVICE_H).flex_none().px(8).gap(9).items_center().child(div().w(14).flex_none().flex().justify_center().child(dot));
    if (this.confirming === device.id) return row.child(this.confirmRow(t, device));
    const forgetting = this.forgetting === device.id;
    const paired = typeof device.pairedAt === "number" ? pairedText(device.pairedAt, now) : null;
    return row
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(1)
          .child(div().truncate().child(device.name))
          .child(div().truncate().text_size(12).text_color(connected ? t.done : t.dim).child(stateText(device, now)))
          .when(Boolean(paired), (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).child(paired))),
      )
      .when(forgetting, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("Forgetting…")))
      .when(!forgetting && !this.forgetting, (el) => el.child(this.button(t, `forget-${device.id}`, "Forget", (_e, cx) => this.ask(device.id, cx))));
  }

  line(t, id, text, color = t.muted, height = LINE_H) {
    return div().id(id).h(height).flex_none().px(8).flex().items_center().text_size(12).text_color(color).child(div().truncate().child(text));
  }

  // A paired phone connects when the Agent Brief app is open on it.
  hint(t) {
    return this.line(t, "phones-hint", "Sends wait on the phone until Agent Brief opens.", t.muted, HINT_H);
  }

  divider(t) {
    return div().flex_none().mx(7).my(4).h(1).bg(t.border);
  }

  bodyRows(t, now) {
    const status = this.status;
    const problem = this.problem ? [this.line(t, "phones-problem", this.problem, t.blocked)] : [];
    if (!status) return problem.length ? problem : [this.line(t, "phones-reading", "Reading…", t.dim)];
    const devices = status.devices.length ? status.devices.map((d) => this.deviceRow(t, d, now)) : [this.line(t, "phones-none", "No phone is paired.", t.dim, DEVICE_H)];
    const hint = noneConnected(status, now) ? [this.hint(t)] : [];
    const waiting = status.handoffs;
    const shown = waiting.slice(0, HANDOFFS_SHOWN).map((h, i) => this.line(t, `handoff-${h.id ?? i}`, handoffLabel(h), t.foreground, HANDOFF_H));
    const more = waiting.length > HANDOFFS_SHOWN ? [this.line(t, "handoffs-more", `${waiting.length - HANDOFFS_SHOWN} more`, t.dim, HANDOFF_H)] : [];
    return [...devices, ...hint, ...problem, this.divider(t), this.line(t, "phones-listener", listenerLine(status)), ...shown, ...more];
  }

  connection() {
    const now = Date.now();
    return (this.status?.devices ?? []).map((d) => ({ connected: isConnected(d, now) }));
  }

  render() {
    const t = theme();
    const paired = Boolean(this.status?.devices.length);
    return v_flex()
      .id("hws-phones")
      .size_full()
      .p(PAD)
      .bg(t.popover)
      .text_size(13)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(TITLE_H)
          .flex_none()
          .px(8)
          .gap(8)
          .items_center()
          .child(div().flex_1().font_semibold().child("Phones"))
          .when((this.status?.devices.length ?? 0) > 1, (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(activeSummary(this.connection())))),
      )
      .child(v_flex().id("phones-body").h(bodyHeight(this.status, this.problem)).flex_none().overflow_y_scrollbar().children(this.bodyRows(t, Date.now())))
      .child(this.divider(t))
      .child(
        h_flex()
          .id("phones-pair")
          .h(PAIR_H)
          .flex_none()
          .px(8)
          .gap(9)
          .items_center()
          .rounded(7)
          .text_color(t.muted)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.pairAnother())
          .child(svg("mods/workspace-chrome/plus.svg").size(14).flex_none())
          .child(div().flex_1().truncate().child(paired ? "Pair another phone or iPad" : "Pair a phone or iPad")),
      );
  }
}
