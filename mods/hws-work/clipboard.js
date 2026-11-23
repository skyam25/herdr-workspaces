// Copies text to the clipboard.
// Keep this file identical in hws-panel and hws-work. test/simulate.test.mjs compares them.

import { exec, window } from "herdr";

// wl-copy stays behind to serve the clipboard, so its output must not hold exec open.
const LINUX_COPY = 'if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wl-copy >/dev/null; then wl-copy >/dev/null 2>&1; else xclip -selection clipboard; fi';

export async function copy(text) {
  const copier = window()?.platform === "linux" ? LINUX_COPY : "pbcopy";
  const r = await exec("sh", ["-c", `printf %s "$1" | ${copier}`, "sh", text]);
  if (r.code !== 0) throw new Error("Could not copy.");
}
