// Finds instructions that still tell agents to use Agent Brief, with the Herdr Workspaces command for each.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { claudeHome } from './agent-brief.js';
import { checkout } from './checkout.js';

const VERBS = ['draw', 'read', 'png', 'snap', 'update', 'delete', 'note', 'open', 'output', 'outline', 'feedback', 'behavior', 'show', 'status', 'boards', 'handoff', 'initiative'];
const BOARD_VERBS = new Set(['draw', 'read', 'png', 'snap', 'update', 'delete', 'boards', 'status']);
const PAGE_VERBS = new Set(['outline', 'feedback', 'behavior']);
const TOOLS = ['declare_output', 'ask_questions', 'show_image', 'feedback_latest'];

// A file name such as agent-brief.md never matches, because a verb must follow a space.
const TERMS = new RegExp(
  [
    'mcp__agent-brief__(\\w*)',
    `(?<![\\w-])agent-brief\\s+(${VERBS.join('|')})(?![\\w-])`,
    `\\b(${TOOLS.join('|')})\\b`,
    'agent-brief@agent-brief',
    'Agent Brief',
  ].join('|'),
  'g',
);

const SCANNED = /\.(md|json|sh|mjs|js)$/;
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'worktrees']);
const MAX_BYTES = 1024 * 1024;

const NOTE = 'write a Markdown file and `hws surface open --type note --file F --terminal $HC_TERMINAL_ID`';
const REVIEW = '`hws review FILE`';
const PICTURE = 'name the file, or `hws review` an .md that embeds it';
const INITIATIVE = "the workspace's current note and `herdr-workspaces:tidy`";
const DROPPED = 'nothing, so delete the line';

const TOOL_REPLACEMENTS = {
  declare_output: '`hws output add`',
  ask_questions: '`hws ask`',
  show_image: PICTURE,
  feedback_latest: `${REVIEW}, whose comments arrive as the next prompt`,
};

function verbReplacement(verb, line) {
  if (BOARD_VERBS.has(verb)) return `\`hws surface cli --type board -- ${verb}\``;
  if (PAGE_VERBS.has(verb)) return `\`hws surface cli --type page -- ${verb}\``;
  if (verb === 'note') return NOTE;
  if (verb === 'show') return PICTURE;
  if (verb === 'output') return '`hws output add`';
  if (verb === 'handoff') return DROPPED;
  if (verb === 'initiative') return INITIATIVE;
  if (/--note\b/.test(line)) return NOTE;
  if (/--output\b/.test(line)) return REVIEW;
  if (/--initiative\b/.test(line)) return INITIATIVE;
  return '`hws surface open --type board --terminal $HC_TERMINAL_ID`';
}

// One `{ term, replacement }` per distinct reference on the line.
export function matchLine(line) {
  const found = new Map();
  for (const match of line.matchAll(TERMS)) {
    const [text, mcpTool, verb, tool] = match;
    let hit;
    if (mcpTool !== undefined) hit = TOOL_REPLACEMENTS[mcpTool] ? { term: mcpTool, replacement: TOOL_REPLACEMENTS[mcpTool] } : { term: text, replacement: 'the matching `hws` command in docs/GUIDE.md' };
    else if (verb) hit = { term: `agent-brief ${verb}`, replacement: verbReplacement(verb, line) };
    else if (tool) hit = { term: tool, replacement: TOOL_REPLACEMENTS[tool] };
    else if (text === 'Agent Brief') hit = { term: text, replacement: 'Herdr Workspaces, or delete the line' };
    else hit = { term: text, replacement: '`herdr-workspaces@herdr-workspaces`' };
    if (!found.has(hit.term)) found.set(hit.term, hit);
  }
  return [...found.values()];
}

function realOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : walk(path);
    return entry.isFile() && SCANNED.test(entry.name) ? [path] : [];
  });
}

// ~/.claude is read only through its instruction files, so plugin caches and transcripts stay out.
function claudeFiles() {
  const root = claudeHome();
  let settings = [];
  try {
    settings = readdirSync(root).filter((name) => /^settings.*\.json$/.test(name)).map((name) => join(root, name));
  } catch {
    // No Claude home.
  }
  return [join(root, 'CLAUDE.md'), ...settings, ...['skills', 'agents', 'commands'].flatMap((name) => walk(join(root, name)))];
}

function folderFiles(folder) {
  const dotClaude = join(folder, '.claude');
  const isClaudeHome = realOrNull(dotClaude) !== null && realOrNull(dotClaude) === realOrNull(claudeHome());
  return [join(folder, 'CLAUDE.md'), join(folder, 'AGENTS.md'), ...(isClaudeHome ? [] : walk(dotClaude))];
}

function inside(parent, child) {
  return child === parent || child.startsWith(`${parent}/`);
}

// Scans ~/.claude and each folder's CLAUDE.md, AGENTS.md and .claude/. Skips this checkout.
export function scanInstructions(folders) {
  const own = realOrNull(checkout());
  const seen = new Set();
  const findings = [];
  for (const file of [...claudeFiles(), ...folders.flatMap(folderFiles)]) {
    const real = realOrNull(file);
    if (!real || seen.has(real) || (own && inside(own, real))) continue;
    seen.add(real);
    const stats = statSync(real);
    if (!stats.isFile() || stats.size > MAX_BYTES) continue;
    readFileSync(real, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const hit of matchLine(line)) findings.push({ file, line: index + 1, ...hit });
      });
  }
  return findings;
}
