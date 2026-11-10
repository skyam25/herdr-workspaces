// The sidebar footer. It keeps workspace-chrome's Settings and Add machine rows and adds Phone,
// which pairs the phone app with this Mac for the whole Herdr window.

import { View, svg, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, exec, home, layout, updates } from "herdr";

// A pairing code lasts 10 minutes, so the row checks for a new phone that long after Pair.
const PAIR_POLL_MS = 3000;
const PAIR_POLLS = 200;

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

// Status starts the phone listener when a phone is paired, so the phone can reach this Mac again after Herdr restarts.
async function hws(args) {
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

export default class Footer extends View {
  init(_props, cx) {
    this.devices = null;
    this.polling = null;
    cx.spawn(async (cx) => {
      await this.refresh();
      cx.notify();
    });
  }

  async refresh() {
    const status = await hws(["phone", "status"]);
    if (status) this.devices = status.devices ?? [];
    return this.devices?.length ?? 0;
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

  phoneLabel() {
    if (!this.devices?.length) return "Pair phone";
    return this.devices.map((d) => d.name).join(", ");
  }

  phoneTip() {
    if (!this.devices?.length) return "Pair the Agent Brief app on your iPhone or iPad with this Mac";
    return `${this.phoneLabel()} paired. Click to pair another phone or iPad`;
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const paired = Boolean(this.devices?.length);
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
      .child(row("phone", "mods/hws-footer/phone.svg", this.phoneLabel(), !paired, (_e, cx) => cx.spawn((cx) => this.pair(cx)), this.phoneTip())
        .when(paired && !collapsed, el => el.child(div().size(6).rounded_full().bg(t.done))));
  }
}
