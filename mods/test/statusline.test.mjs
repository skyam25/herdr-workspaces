import test from "node:test";
import assert from "node:assert/strict";
import { statusLines, statusParts } from "../hws-chat/statusline.js";

const RULE = "─".repeat(100);

test("Claude Code's lines come from below the prompt box", () => {
  const screen = ["⏺ pineapple", "", "✎ Sketch", RULE, "❯ ", RULE,
    "  Opus 5.5 | herdr-workspaces | main", "  [█████░░░░░] 26% | $4.30", "  ⏵⏵ auto mode on (shift+tab to cycle)", "", ""].join("\n");
  assert.deepEqual(statusLines(screen, "claude"), ["herdr-workspaces | main", "[█████░░░░░] 26% | $4.30", "⏵⏵ auto mode on (shift+tab to cycle)"]);
});

test("the model and effort are dropped because the model button shows them", () => {
  const screen = [RULE, "❯ ", RULE, "  Opus 5.5 | herdr-workspaces | main | effort:high | Max", "  Haiku 5.5"].join("\n");
  assert.deepEqual(statusLines(screen, "claude"), ["herdr-workspaces | main | Max"]);
});

test("Claude Code with no status line gives an empty list", () => {
  assert.deepEqual(statusLines([RULE, "❯ ", RULE, "  ? for shortcuts", ""].join("\n"), "claude"), []);
});

test("a Claude Code choice dialog keeps the last lines", () => {
  const screen = [RULE, " Do you want to proceed?", " ❯ 1. Yes", "   2. No", RULE, " Esc to cancel"].join("\n");
  assert.equal(statusLines(screen, "claude"), null);
});

test("a screen with no prompt box keeps the last lines", () => {
  assert.equal(statusLines("Loading…\n", "claude"), null);
});

test("Codex's lines come from below its prompt, without the key hints", () => {
  const screen = ["", "› Ask Codex to do anything", "", "  GPT-6.1-Sol high · ~/Projects/InstantJams · Context 0% used · 5h 100% left", "  ← for agents · ? for shortcuts", ""].join("\n");
  assert.deepEqual(statusLines(screen, "codex"), ["~/Projects/InstantJams · Context 0% used · 5h 100% left"]);
});

test("a Codex choice screen keeps the last lines", () => {
  const screen = ["  Trust this folder?", "", "› 1. Trust and continue", "  2. Back", "", "  enter continue · esc back"].join("\n");
  assert.equal(statusLines(screen, "codex"), null);
});

test("an unknown CLI has no lines", () => {
  assert.equal(statusLines(`${RULE}\n❯ \n${RULE}\nstatus`, "pi"), null);
});

test("too many lines below the prompt keeps the last lines", () => {
  const screen = [RULE, "❯ ", RULE, ...Array.from({ length: 7 }, (_, i) => `line ${i}`)].join("\n");
  assert.equal(statusLines(screen, "claude"), null);
});

test("status parts drop terminal marks and split on both separators", () => {
  const parts = statusParts(["herdr-workspaces | main | Max", "⏵⏵ auto mode on (shift+tab to cycle) · ⧉ mock · ← 1 agent"]);
  assert.deepEqual(parts.map((p) => p.text), ["herdr-workspaces", "main", "Max", "auto mode on", "mock", "1 agent"]);
});

test("a status text bar becomes a meter and keeps its figure", () => {
  assert.deepEqual(statusParts(["[██░░░░░░░░] 13% | $1.40"]), [{ text: "13%", meter: 0.2 }, { text: "$1.40" }]);
});

test("status parts keep a git arrow and a home path", () => {
  assert.deepEqual(statusParts(["~/Projects/app · ↑3"]).map((p) => p.text), ["~/Projects/app", "↑3"]);
});
