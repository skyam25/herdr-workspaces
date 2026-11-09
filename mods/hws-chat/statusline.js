// Reads the status lines a CLI prints under its prompt, from the text of its screen.
// Returns null when the prompt isn't showing, so the caller keeps the lines it last had.

const MAX_LINES = 6;
const RULE = /^\s*[─━]{20,}\s*$/;
const CHOICE = /^\s*[❯›]\s*\d+\./;
const CLAUDE_PROMPT = /^\s*[❯>]/;
const CODEX_PROMPT = /^\s*›/;
const KEY_HINT = /^(← for agents · )?\? for shortcuts$/;
const MODEL = /^(claude\s+)?(opus|sonnet|haiku|fable|gpt|o[134])\b[-\w. ]*$/i;
const EFFORT = /^effort:\s*\S+$/i;

const SEPARATOR = / \| | · /;
const BAR = /^\[([█▓▒░\s]+)\]\s*(.*)$/;
const TERMINAL_GLYPH = /^[⏵⏸⧉←]+\s*/u;
const TERMINAL_HINT = /\s*\(shift\+tab to cycle\)$/i;

function belowClaudePrompt(lines) {
  const rules = lines.flatMap((line, i) => (RULE.test(line) ? [i] : []));
  if (rules.length < 2) return null;
  const [top, bottom] = rules.slice(-2);
  const box = lines.slice(top + 1, bottom);
  return box.some((line) => CLAUDE_PROMPT.test(line) && !CHOICE.test(line)) ? lines.slice(bottom + 1) : null;
}

function belowCodexPrompt(lines) {
  const prompt = lines.findLastIndex((line) => CODEX_PROMPT.test(line));
  return prompt < 0 || CHOICE.test(lines[prompt]) ? null : lines.slice(prompt + 1);
}

// Drops the model and effort, which the chat's model button already shows.
function withoutModel(line) {
  const separator = [" | ", " · "].find((s) => line.includes(s)) ?? " | ";
  return line.split(separator).filter((part) => !MODEL.test(part.trim()) && !EFFORT.test(part.trim())).join(separator);
}

export function statusLines(screen, kind) {
  const lines = String(screen ?? "").split("\n");
  const below = kind === "claude" ? belowClaudePrompt(lines) : kind === "codex" ? belowCodexPrompt(lines) : null;
  if (!below) return null;
  const shown = below
    .map((line) => line.trim())
    .filter((line) => line && !KEY_HINT.test(line) && !line.startsWith("[hc]"))
    .map(withoutModel)
    .filter(Boolean);
  return shown.length <= MAX_LINES ? shown : null;
}

// One line's text, without the marks and key hints that only mean something in a terminal.
function statusPart(segment) {
  const text = segment.trim().replace(TERMINAL_GLYPH, "").replace(TERMINAL_HINT, "");
  const bar = text.match(BAR);
  if (!bar) return { text };
  const cells = bar[1].replace(/\s/g, "");
  return { text: bar[2], meter: cells.replace(/[^█]/g, "").length / cells.length };
}

// The status lines as separate parts for one quiet row. A text progress bar becomes a meter from 0 to 1.
export function statusParts(lines) {
  return lines.flatMap((line) => line.split(SEPARATOR)).map(statusPart).filter((part) => part.text || part.meter !== undefined);
}
