// Calls the hws CLI and holds the form parts hws-new, hws-panel and hws-actions share.
// Keep this file identical in all three. test/simulate.test.mjs compares them.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { closeOverlay, exec, home, openOverlay, pickFolder, props } from "herdr";

let found = null;

async function start(args) {
  for (const bin of found ? [found] : [`${home()}/.local/bin/hws`, "hws"]) {
    try {
      const r = await exec(bin, args);

      // The `hws` script starts through `env`, which exits 126 or 127 when node is missing.
      if (r.code !== 126 && r.code !== 127) {
        found = bin;
        return r;
      }
    } catch {
      // Exec rejects when the program is missing, so the next candidate gets a turn.
    }
  }
  throw new Error("Could not run hws. Expected it at ~/.local/bin/hws or on PATH.");
}

// Runs `hws <args> --json` and resolves with the parsed output, or plain text
// when the output is not JSON. Throws with hws's own message on failure.
export async function hws(args) {
  const r = await start([...args, "--json"]);
  const out = r.stdout.trim();
  let value = out;
  try {
    value = JSON.parse(out);
  } catch {
    // Plain text stays as it is.
  }
  if (r.code !== 0) throw new Error(value?.error ?? (r.stderr.trim().split("\n")[0] || `hws ${args[0]} failed.`));
  return value;
}

export const message = (e) => String(e?.message ?? e);

// Runs one dialog action. The dialog stays open until `work` finishes, so a
// failure can show in it. The view must set `busy` and `problem`.
export function submitDialog(view, key, work, cx) {
  if (view.busy) return;
  view.busy = key;
  view.problem = null;
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      await work();
      closeOverlay(props()?.overlay);
    } catch (e) {
      view.problem = message(e);
      view.busy = null;
      cx.notify();
    }
  });
}

// The workspace setting that tells agents what kind of work this is.
export const KINDS = [
  { id: "general", name: "General" },
  { id: "app", name: "App" },
  { id: "deliverable", name: "Deliverable" },
];

// The new-workspace form, opened by the launcher and by the panel outside a workspace.
// With `space` as `{ id, name, folder }`, the form makes the workspace from that open space.
export function openWorkspaceForm(space = null) {
  openOverlay({ mod: "hws-new", kind: "dialog", modal: true, width: 500, height: 540, props: { step: "workspace", ...(space ? { space } : {}) } });
}

function expandFolder(text) {
  const typed = text.trim();
  const path = typed.length > 1 ? typed.replace(/\/+$/, "") : typed;
  if (path === "~") return home();
  return path.startsWith("~/") ? home() + path.slice(1) : path;
}

// Resolves with the full path, or throws the problem to show. A failed `test`
// call counts as a pass, so hws reports the folder itself.
export async function checkFolder(text) {
  const path = expandFolder(text);
  if (!path) throw new Error("Choose a folder.");
  if (!path.startsWith("/")) throw new Error("Use a full path, such as ~/Projects.");
  const r = await exec("test", ["-d", path]).catch(() => null);
  if (r && r.code !== 0) throw new Error(`${path} does not exist. Choose an existing folder.`);
  return path;
}

export const tilde = (path) => (path?.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : (path ?? ""));

// Starts the folder field at the parent folder new work goes in.
export function fillParent(view, cx) {
  cx.spawn(async (cx) => {
    const folder = await hws(["parent"]).then((r) => r.folder).catch(() => null);
    if (!folder || view.values.folder) return;
    view.values.folder = tilde(folder);
    view.inputs.folder.set_value(view.values.folder);
    cx.notify();
  });
}

// Creates an input whose text lives in view.values[key] and whose state lives
// in view.inputs[key]. The view must set `values`, `inputs` and `problem`.
export function makeInput(view, key, { value = "", placeholder = "", submit, rows, change } = {}) {
  view.values[key] = value;
  const state = rows ? TextareaState.new({ value, placeholder, rows }) : InputState.new({ value, placeholder });
  state.on("change", (_e, cx) => {
    view.values[key] = state.value();
    view.problem = null;
    change?.(cx);
    cx.notify();
  });
  state.on("submit", (_e, cx) => submit?.(cx));
  state.on("focus", (_e, cx) => {
    view.focusedField = key;
    cx.notify();
  });
  state.on("blur", (_e, cx) => {
    if (view.focusedField === key) view.focusedField = null;
    cx.notify();
  });
  view.inputs[key] = state;
  return state;
}

// Focuses a dialog's field now and again once the dialog has opened.
export function focusField(view, key, cx) {
  view.inputs[key].focus();
  cx.timer.after(600, () => view.inputs[key].focus());
}

export function moveFocus(view, back) {
  const keys = Object.keys(view.inputs);
  if (keys.length === 0) return;
  const at = keys.indexOf(view.focusedField);
  const next = at < 0 ? 0 : (at + (back ? keys.length - 1 : 1)) % keys.length;
  view.inputs[keys[next]].focus();
}

export function chooseFolder(view, cx, key = "folder") {
  cx.spawn(async (cx) => {
    const path = await pickFolder({ prompt: "Use Folder" }).catch(() => null);
    if (!path) return;
    view.inputs[key].set_value(path);
    view.values[key] = path;
    view.problem = null;
    cx.notify();
  });
}

// Moves focus with Tab and dismisses with Escape.
export function formKeys(view, dismiss) {
  return (e, cx) => {
    if (e.key === "tab") moveFocus(view, e.modifiers?.shift);
    else if (e.key === "escape") dismiss();
    else return;
    cx.stop_propagation();
  };
}

export const dialogRoot = (t, id) => v_flex().id(id).size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(13);

export const dialogFooter = () => h_flex().flex_none().p(12).gap(8).justify_end();

const fieldLabel = (t, text) => div().pb(5).text_size(11.5).text_color(t.dim).child(text);

export const labeled = (t, text, control) => v_flex().child(fieldLabel(t, text)).child(control);

function styleField(el, t, view, key) {
  return el
    .px(10)
    .rounded(8)
    .border_1()
    .border_color(view.focusedField === key ? t.accent : t.input)
    .bg(t.background)
    .text_size(12.8)
    .text_color(t.foreground);
}

export const field = (t, view, key) => styleField(Input.new(view.inputs[key]).h(34), t, view, key);

export const areaField = (t, view, key) => styleField(Textarea.new(view.inputs[key]).py(8), t, view, key);

export function button(t, id, text, primary, action, enabled = true) {
  return h_flex()
    .id(id)
    .flex_none()
    .h(30)
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

export function folderRow(t, view, key = "folder") {
  return h_flex()
    .gap(6)
    .items_center()
    .child(field(t, view, key).flex_1())
    .child(button(t, `choose-${key}`, "Choose…", false, (_e, cx) => chooseFolder(view, cx, key)));
}

export const problemLine = (t, text) => div().text_size(11.5).text_color(t.blocked).child(text);
