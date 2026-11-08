// The + menu on agent panes and in the chat composer. It starts boards, notes and page
// reviews glued to an agent, and reaches the chat's file picker and the right panel.
// Props: { terminal, chat?, pane?, space?, lastReply? }. docs/CONTRACT.md lists the rows.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, closeOverlay, exec, appHome, writeTextFile, setShared, run } from "herdr";
import { hws, submitDialog, problemLine } from "./hws.js";

// One shell runs the chooser and the open, because the popup can close while the chooser has
// focus and an exec already started keeps running. Error -128 means the person cancelled.
const REVIEW_PAGE = `
f=$(osascript -e activate -e 'POSIX path of (choose file of type {"html", "htm", "md"} with prompt "Review a page")' 2>&1)
if [ $? -ne 0 ]; then
  case "$f" in *-128*) exit 0 ;; esac
  echo "Couldn't open the file chooser." >&2
  exit 1
fi
h="$HOME/.local/bin/hws"
[ -x "$h" ] || h=hws
exec "$h" surface open --type page --file "$f" "$@"
`;

function showPanel(view) {
  run("layout.select", { stack: "panel-body", child: view });
  run("layout.show", { id: "panel" });
}

export default class Actions extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.at = 0;
    this.busy = null;
    this.problem = null;
  }

  // A flipped agent has no pane, so its surface splits beside the chat.
  owner() {
    const p = props();
    return ["--terminal", p.terminal, ...(p.chat ? ["--beside-pane", p.pane, "--space", p.space] : [])];
  }

  openSurface(type, extra = []) {
    return hws(["surface", "open", "--type", type, ...extra, ...this.owner()]);
  }

  async writeFromReply(text) {
    const dir = `${appHome()}/data/hws-actions`;
    await exec("mkdir", ["-p", dir]);
    const file = `${dir}/reply-${Date.now()}.md`;
    await writeTextFile(file, text, null);
    await this.openSurface("note", ["--file", file]);
  }

  async reviewPage() {
    const r = await exec("sh", ["-c", REVIEW_PAGE, "hws-actions", ...this.owner(), "--json"]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "Couldn't open that page.");
  }

  items() {
    const p = props() ?? {};
    return [
      { id: "sketch", name: "Sketch", icon: "sketch", work: () => this.openSurface("board") },
      { id: "write", name: "Write", icon: "write", work: () => this.openSurface("note") },
      ...(p.lastReply ? [{ id: "write-reply", name: "Write from last reply", icon: "reply", work: () => this.writeFromReply(p.lastReply) }] : []),
      { id: "review", name: "Review a page…", icon: "review", work: () => this.reviewPage() },
      ...(p.chat ? [{ id: "attach", name: "Attach file…", icon: "attach", work: () => setShared("hws-chat.attach", { pane: p.pane, at: Date.now() }) }] : []),
      { id: "tasks", name: "Tasks", icon: "tasks", divided: true, work: () => showPanel("tasks") },
      { id: "outputs", name: "Outputs", icon: "outputs", work: () => showPanel("outputs") },
    ];
  }

  choose(item, cx) {
    submitDialog(this, item.id, item.work, cx);
  }

  onKey(e, cx, list) {
    if (e.key === "down") this.at = (this.at + 1) % list.length;
    else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
    else if (e.key === "enter") this.choose(list[this.at], cx);
    else if (e.key === "escape") closeOverlay(props()?.overlay);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  row(t, item, i) {
    const name = this.busy === item.id ? `${item.name.replace("…", "")}…` : item.name;
    return v_flex()
      .when(Boolean(item.divided), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
      .child(
        h_flex()
          .id(item.id)
          .h(31)
          .px(8)
          .gap(9)
          .rounded(7)
          .items_center()
          .text_color(t.foreground)
          .cursor_pointer()
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(item, cx))
          .child(svg(`mods/hws-actions/${item.icon}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().truncate().child(name)),
      );
  }

  render() {
    const t = theme();
    const list = this.items();
    return v_flex()
      .id("hws-actions")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx, list))
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(13)
      .children(list.map((item, i) => this.row(t, item, i)))
      .when(Boolean(this.problem), (el) => el.child(div().px(8).pt(5).pb(3).child(problemLine(t, this.problem))));
  }
}
