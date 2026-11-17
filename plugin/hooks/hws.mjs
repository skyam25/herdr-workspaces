import { execFile } from "node:child_process";

// Each call gets two seconds unless the hook passes its own timeout.
const HWS_MS = 2000;

// Resolves to trimmed stdout, or null when hws fails or outlives its timeout.
export function hws(args, { timeout = HWS_MS, ...options } = {}) {
  return new Promise((resolve) => {
    execFile("hws", args, { timeout, killSignal: "SIGKILL", ...options }, (error, stdout) => resolve(error ? null : stdout.trim()));
  });
}

// Returns the parsed JSON, or null for empty or broken text.
export function parse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
