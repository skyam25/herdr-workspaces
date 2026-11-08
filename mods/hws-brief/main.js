// `mod.open:hws-brief` shows or hides Outputs in the right panel, then closes itself.

import { View, div } from "gpui-kit";
import { closeOverlay, layout, notify, props, run } from "herdr";

function findNode(tree, id) {
  if (tree?.id === id) return tree;
  for (const child of tree?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export default class Brief extends View {
  init(_props, cx) {
    if (props()?.overlay) cx.spawn(async () => this.toggle());
  }

  toggle() {
    const tree = layout();
    const body = findNode(tree, "panel-body");
    if (!body) notify({ title: "Outputs needs the panel layout", body: "The current layout has no right panel. Switch to the hws layout to see Outputs.", level: "warning" });
    else {
      const panel = findNode(tree, "panel");
      if (panel && !panel.hidden && body.active === "outputs") run("layout.hide", { id: "panel" });
      else {
        run("layout.select", { stack: "panel-body", child: "outputs" });
        run("layout.show", { id: "panel" });
      }
    }
    closeOverlay(props().overlay);
  }

  render() {
    return div();
  }
}
