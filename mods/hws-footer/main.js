// The sidebar footer. It keeps workspace-chrome's Settings and Add machine rows and adds Phone,
// which pairs the phone app with this Mac for the whole Herdr window.
// Props: none for the footer, or { view: "phones", status, overlay } for the Phones popup in phones.js.

import { View, svg, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, layout, updates, props, shared, openOverlay } from "herdr";
import { hws, publishDevices, popupSize, activeSummary, isConnected, PhonesPopup, DEVICES_KEY, PAIR_KEY } from "./phones.js";

// A pairing code lasts 10 minutes, so the row checks for a new phone that long after Pair.
const PAIR_POLL_MS = 3000;
const PAIR_POLLS = 200;

// A phone counts as active for two minutes after its last request, so the row checks once a minute.
const STATE_POLL_MS = 60_000;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Matches workspace-chrome, which goes by the sidebar's width.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// The popup opens above the row, or beside the rail when the sidebar is collapsed.
function anchor(bounds, size, collapsed) {
  if (!bounds) return "pointer";
  if (collapsed) return { x: Math.round(bounds.x + bounds.width + 6), y: Math.max(8, Math.round(bounds.y + bounds.height - size.height)) };
  return { x: Math.round(bounds.x), y: Math.max(8, Math.round(bounds.y - size.height - 4)) };
}

export default class Footer extends View {
  init(_props, cx) {
    if (props()?.view === "phones") {
      this.popup = new PhonesPopup(props().overlay, cx, props().status);
      return;
    }
    this.devices = null;
    this.status = null;
    this.polling = null;
    this.rowBounds = null;
    this.pairAsked = shared(PAIR_KEY)?.at ?? 0;
    cx.spawn(async (cx) => {
      await this.refresh();
      cx.notify();
    });
    cx.timer.every(STATE_POLL_MS, async (cx) => {
      if (!this.paired().length) return;
      await this.refresh();
      cx.notify();
    });
  }

  // Status starts the phone listener when a phone is paired, so the phone can reach this Mac again after Herdr restarts.
  async refresh() {
    const status = await hws(["phone", "status"]);
    if (status) {
      this.status = status;
      this.devices = status.devices ?? [];
      publishDevices(this.devices);
    }
    return this.paired().length;
  }

  // The Phones popup writes the shared list, so a Forget there updates this row.
  paired() {
    const now = Date.now();
    return shared(DEVICES_KEY) ?? (this.devices ?? []).map((d) => ({ id: d.id, name: d.name, connected: isConnected(d, now) }));
  }

  // The Pair phone tab shows the QR code. The row updates once the new phone appears.
  async pair(cx) {
    const before = await this.refresh();
    await hws(["phone", "pair"]);
    this.polling?.cancel();
    let polls = 0;
    this.polling = cx.timer.every(PAIR_POLL_MS, async (cx) => {
      polls += 1;
      const count = await this.refresh();
      if (count > before || polls >= PAIR_POLLS) this.polling.cancel();
      cx.notify();
    });
    cx.notify();
  }

  // The popup's Pair another phone sets PAIR_KEY and closes, and the footer runs the pairing.
  takePairRequest(cx) {
    const at = shared(PAIR_KEY)?.at ?? 0;
    if (at <= this.pairAsked) return;
    this.pairAsked = at;
    cx.timer.after(0, (cx) => cx.spawn((cx) => this.pair(cx)));
  }

  clickPhone(cx) {
    if (!this.paired().length) {
      cx.spawn((cx) => this.pair(cx));
      return;
    }
    const size = popupSize(this.status);
    openOverlay({ mod: "hws-footer", kind: "popup", ...size, at: anchor(this.rowBounds, size, narrow()), props: { view: "phones", status: this.status } });
  }

  phoneLabel() {
    const devices = this.paired();
    if (!devices.length) return "Pair phone";
    return devices.map((d) => d.name).join(", ");
  }

  phoneTip() {
    const devices = this.paired();
    if (!devices.length) return "Pair the Agent Brief app on your iPhone or iPad with this Mac";
    const state = activeSummary(devices).toLowerCase();
    return `${this.phoneLabel()}: ${state}. Sends wait on the phone until Agent Brief opens. Click for details`;
  }

  render(cx) {
    if (this.popup) return this.popup.render(cx);
    this.takePairRequest(cx);
    const t = theme();
    const collapsed = narrow();
    const devices = this.paired();
    const paired = devices.length > 0;
    const connected = devices.some((d) => d.connected);
    const dot = () => div().size(6).rounded_full().flex_none().when(connected, (el) => el.bg(t.done)).when(!connected, (el) => el.border(1).border_color(t.dim));
    const state = h_flex().flex_none().gap(6).items_center().text_size(11.5).text_color(connected ? t.done : t.dim).child(dot()).child(activeSummary(devices));
    const row = (id, icon, label, dim, action, tip = label) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
      .when(collapsed, el => el.relative().w(32).px(0).justify_center())
      .tooltip(tip)
      .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
      .on_click(action).child(svg(icon).size(14).flex_none())
      .when(!collapsed, el => el.child(div().flex_1().truncate().child(label)));
    const ready = div().size(6).rounded_full().bg(t.accent);
    return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
      .when(collapsed, el => el.px(0).items_center())
      .child(row("settings", "mods/workspace-chrome/settings.svg", "Settings", false, () => run("app.settings"))
        .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
      .child(row("machine", "mods/workspace-chrome/plus.svg", "Add machine", true, () => run("mod.open", { name: "machine-add" })))
      .child(row("phone", "mods/hws-footer/phone.svg", this.phoneLabel(), !paired, (_e, cx) => this.clickPhone(cx), this.phoneTip())
        .on_mouse_down("left", (e) => { if (e.bounds) this.rowBounds = e.bounds; })
        .when(paired && !collapsed, el => el.child(state))
        .when(paired && collapsed, el => el.child(dot().absolute().top(5).right(6))));
  }
}
