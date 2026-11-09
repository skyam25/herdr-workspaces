import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HwsError, UsageError } from '../errors.js';
import { withLock } from '../lock.js';
import { writeTextAtomic } from '../manifest.js';
import { isForeign, isKept, placeOf, writablePlace } from '../places.js';
import { requireFlag, resolveWorkspace, splitList } from '../resolve.js';

const LOG_FILE = 'decisions.md';
const LOG_TITLE = '# Decisions\n';
const HEADING = /^## (D-\d+) · (\d{4}-\d{2}-\d{2}) · (.*)$/;
const REPLACED_BY = /^Replaced by (D-\d+)\.$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

function localDate(ms = Date.now()) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The place may name the log file itself, or a folder that holds it.
export function decisionLog(manifest) {
  const { path, writer } = placeOf(manifest, 'decisions');
  if (!path) return { path: null, writer };
  return { path: path.endsWith('.md') ? path : join(path, LOG_FILE), writer };
}

function parseLog(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) entries.push({ id: heading[1], decidedAt: heading[2], title: heading[3], replacedBy: null });
    const replaced = REPLACED_BY.exec(line);
    if (replaced && entries.length > 0) entries.at(-1).replacedBy = replaced[1];
  }
  return entries;
}

const readLogText = (path) => (path && existsSync(path) ? readFileSync(path, 'utf8') : '');

// Another tool's log has its own format, so hws reports its path and no entries.
export function readDecisions(manifest) {
  const { path, writer } = decisionLog(manifest);
  const decisions = isForeign(writer) ? [] : parseLog(readLogText(path));
  return { path, writer, decisions };
}

function badDecision(field, rule) {
  return new UsageError(`proposal ${field} ${rule}`);
}

export function checkDecisionShape(item, index) {
  const field = `decisions[${index}]`;
  if (!item || typeof item !== 'object') throw badDecision(field, 'must be an object');
  if (typeof item.title !== 'string' || !item.title.trim()) throw badDecision(`${field}.title`, 'must be text');
  if (typeof item.why !== 'string' || !item.why.trim()) throw badDecision(`${field}.why`, 'must be text');
  if (typeof item.decidedAt !== 'string' || !DATE.test(item.decidedAt) || Number.isNaN(Date.parse(item.decidedAt))) {
    throw badDecision(`${field}.decidedAt`, 'must be a YYYY-MM-DD date');
  }
  for (const list of ['cites', 'replaces']) {
    if (item[list] !== undefined && !(Array.isArray(item[list]) && item[list].every((value) => typeof value === 'string' && value))) {
      throw badDecision(`${field}.${list}`, 'must be an array of text');
    }
  }
}

// Checks that every replaced decision is in the log and still in force.
export function planDecisions(manifest, items) {
  if (items.length === 0) return [];
  writablePlace(manifest, 'decisions');
  const known = parseLog(readLogText(decisionLog(manifest).path));
  for (const id of items.flatMap((item) => item.replaces ?? [])) {
    const entry = known.find((candidate) => candidate.id === id);
    if (!entry) throw new HwsError(`no decision ${id} in ${manifest.name}'s log`);
    if (entry.replacedBy) throw new HwsError(`decision ${id} was already replaced by ${entry.replacedBy}`);
  }
  return items;
}

function nextNumber(entries) {
  return Math.max(0, ...entries.map((entry) => Number(entry.id.slice(2)))) + 1;
}

function entryText(id, item) {
  const replaces = item.replaces ?? [];
  const lines = [`## ${id} · ${item.decidedAt} · ${oneLine(item.title)}`, ''];
  if (replaces.length > 0) lines.push(`Replaces ${replaces.join(', ')}.`, '');
  lines.push(item.why.trim(), '');
  if (item.cites?.length) lines.push(item.cites.map((cite) => `[${cite}]`).join(' '), '');
  return lines.join('\n');
}

// The note under a replaced heading is the only change an old entry ever gets.
function markReplaced(text, id, by) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => HEADING.exec(line)?.[1] === id);
  lines.splice(at + 2, 0, `Replaced by ${by}.`, '');
  return lines.join('\n');
}

// Appends each decision and marks what it replaces. Returns the new entries.
export function recordDecisions(manifest, items) {
  if (items.length === 0) return [];
  const { path } = decisionLog(manifest);
  return withLock(`decisions-${encodeURIComponent(manifest.id)}`, () => {
    let text = readLogText(path) || `${LOG_TITLE}\n`;
    let number = nextNumber(parseLog(text));
    const added = [];
    for (const item of items) {
      const id = `D-${String(number).padStart(3, '0')}`;
      number += 1;
      for (const old of item.replaces ?? []) text = markReplaced(text, old, id);
      text = `${text.replace(/\n*$/, '\n\n')}${entryText(id, item)}`;
      added.push({ id, decidedAt: item.decidedAt, title: oneLine(item.title), replaces: item.replaces ?? [] });
    }
    writeTextAtomic(path, text);
    return added;
  });
}

function keptWorkspace(flags) {
  const manifest = resolveWorkspace(flags);
  if (!isKept(manifest)) throw new HwsError(`${manifest.name} is a ${manifest.kind}, which has no decision log`);
  return manifest;
}

export function decisionAdd(flags) {
  const manifest = keptWorkspace(flags);
  const item = {
    title: requireFlag(flags, 'title'),
    why: requireFlag(flags, 'why'),
    decidedAt: flags['decided-at'] ?? localDate(),
    cites: splitList(flags.cites),
    replaces: splitList(flags.replaces),
  };
  checkDecisionShape(item, 0);
  const [added] = recordDecisions(manifest, planDecisions(manifest, [item]));
  return { data: added, text: `logged ${added.id}: ${added.title}` };
}

export function decisionList(flags) {
  const result = readDecisions(keptWorkspace(flags));
  const text = result.decisions.map(({ id, decidedAt, title, replacedBy }) => `${id} ${decidedAt} ${title}${replacedBy ? ` (replaced by ${replacedBy})` : ''}`).join('\n');
  return { data: result, text };
}
