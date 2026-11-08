// Calls the hws CLI and holds the form parts hws-new and hws-panel share.
// Keep this file identical in both mods. test/simulate.test.mjs compares them.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, home, pickFolder } from "herdr";

let found = null;

async function start(args, terminal) {
  for (const bin of found ? [found] : [`${home()}/.local/bin/hws`, "hws"]) {
    try {
      const r = terminal ? await exec("env", [`HC_TERMINAL_ID=${terminal}`, bin, ...args]) : await exec(bin, args);

      // `env` exits 126 or 127 when it cannot start the program.
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
// `terminal` sets HC_TERMINAL_ID for commands that act on the current terminal.
export async function hws(args, { terminal } = {}) {
  const r = await start([...args, "--json"], terminal);
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

// The workspace setting that tells agents what kind of work this is.
export const KINDS = [
  { id: "general", name: "General" },
  { id: "app", name: "App" },
  { id: "deliverable", name: "Deliverable" },
];

// The new-workspace form, opened by the launcher and by the panel outside a workspace.
export const FORM_SIZE = { width: 500, height: 540 };

function expandFolder(text) {
  const typed = text.trim();
  const path = typed.length > 1 ? typed.replace(/\/+$/, "") : typed;
  if (path === "~") return home();
  return path.startsWith("~/") ? home() + path.slice(1) : path;
}

// Resolves with { path } or { problem }. A failed `test` call counts as a pass,
// so hws reports the folder itself.
export async function checkFolder(text) {
  const path = expandFolder(text);
  if (!path) return { problem: "Choose a folder." };
  if (!path.startsWith("/")) return { problem: "Use a full path, such as ~/Projects." };
  const r = await exec("test", ["-d", path]).catch(() => null);
  if (r && r.code !== 0) return { problem: `${path} does not exist. Choose an existing folder.` };
  return { path };
}

const tilde = (path) => (path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);

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
export function makeInput(view, key, { value = "", placeholder = "", submit, rows } = {}) {
  view.values[key] = value;
  const state = rows ? TextareaState.new({ value, placeholder, rows }) : InputState.new({ value, placeholder });
  state.on("change", (_e, cx) => {
    view.values[key] = state.value();
    view.problem = null;
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

export function moveFocus(view, back) {
  const keys = Object.keys(view.inputs);
  if (keys.length === 0) return;
  const at = keys.indexOf(view.focusedField);
  const next = at < 0 ? 0 : (at + (back ? keys.length - 1 : 1)) % keys.length;
  view.inputs[keys[next]].focus();
}

export function chooseFolder(view, cx) {
  cx.spawn(async (cx) => {
    const path = await pickFolder({ prompt: "Use Folder" }).catch(() => null);
    if (!path) return;
    view.inputs.folder.set_value(path);
    view.values.folder = path;
    view.problem = null;
    cx.notify();
  });
}

export const fieldLabel = (t, text) => div().pb(5).text_size(11.5).text_color(t.dim).child(text);

export function field(t, view, key) {
  return Input.new(view.inputs[key])
    .h(34)
    .px(10)
    .rounded(8)
    .border_1()
    .border_color(view.focusedField === key ? t.accent : t.input)
    .bg(t.background)
    .text_size(12.8)
    .text_color(t.foreground);
}

export function areaField(t, view, key) {
  return Textarea.new(view.inputs[key])
    .px(10)
    .py(8)
    .rounded(8)
    .border_1()
    .border_color(view.focusedField === key ? t.accent : t.input)
    .bg(t.background)
    .text_size(12.8)
    .text_color(t.foreground);
}

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

export function folderRow(t, view) {
  return h_flex()
    .gap(6)
    .items_center()
    .child(field(t, view, "folder").flex_1())
    .child(button(t, "choose-folder", "Choose…", false, (_e, cx) => chooseFolder(view, cx)));
}

export const problemLine = (t, text) => div().text_size(11.5).text_color(t.blocked).child(text);
