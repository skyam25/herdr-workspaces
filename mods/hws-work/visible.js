// Timed work that pauses while Herdr's window is hidden, covered or minimized.
// hws-panel, hws-work, hws-pane and hws-chat keep identical copies.

import { window } from "herdr";

// The window counts as shown when Herdr can't tell, as during `herdr-app check`.
const windowHidden = () => window()?.visible === false;

// Runs `fn` every `ms`, skipping each turn that falls while the window is hidden.
export function everyWhileShown(cx, ms, fn) {
  return cx.timer.every(ms, (cx) => {
    if (!windowHidden()) fn(cx);
  });
}
