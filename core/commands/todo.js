import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { HwsError, UsageError } from '../errors.js';
import { findTerminal, isTerminalAlive, listLive, sendText, terminalInfo, windowStatus } from '../herdr.js';
import { withLock } from '../lock.js';
import { writeJsonAtomic } from '../manifest.js';
import { todosPath } from '../paths.js';
import { requireFlag } from '../resolve.js';

const COLUMNS = ['todo', 'doing', 'waiting', 'done'];
const ITEM_DEFAULTS = { hold: false, worktree: false, note: '', addedBy: null };

// A `where` label reads "<space name> / <tab name>". Space names can repeat, so only a single match counts.
function spaceFromWhere(where, spaces) {
  const matches = spaces.filter(({ name }) => where === name || where.startsWith(`${name} / `));
  return matches.length === 1 ? matches[0].id : null;
}

// A flipped agent is missing from the listing, so its labels place it.
function spaceOfTerminal(terminal) {
  const live = listLive();
  const found = live && findTerminal(live, terminal);
  if (found) return found.space.id;
  const labels = terminalInfo(terminal)?.labels ?? {};
  if (labels['herdr.space']) return labels['herdr.space'];
  return live && labels.where ? spaceFromWhere(labels.where, live.spaces) : null;
}

// An agent's card must reach its own board, so a set terminal never falls back to the selected space.
export function resolveSpace(flags) {
  if (flags.space) return flags.space;
  const terminal = process.env.HC_TERMINAL_ID;
  if (terminal) {
    const own = spaceOfTerminal(terminal);
    if (!own) throw new HwsError(`Herdr cannot place terminal ${terminal} in a space, so pass --space`);
    return own;
  }
  const selected = windowStatus()?.space;
  if (!selected) throw new UsageError('pass --space, because the window has no selected space');
  return selected;
}

// Only a missing file counts as empty, so a damaged file is never overwritten.
export function readTodos(space) {
  const path = todosPath(space);
  try {
    const todos = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(todos.items)) {
      return { ...todos, items: todos.items.map((item) => ({ ...ITEM_DEFAULTS, ...item })) };
    }
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, space, items: [] };
  }
  throw new HwsError(`the to-do file ${path} is damaged`);
}

// Runs one locked read, change and atomic write. A null result writes nothing.
export function updateTodos(space, change) {
  return withLock(`todos-${encodeURIComponent(space)}`, () => {
    const todos = readTodos(space);
    const result = change(todos);
    if (result !== null) writeJsonAtomic(todosPath(space), todos);
    return result;
  });
}

// Returns null when no orchestrator is recorded.
export function orchestratorState(todos) {
  const terminal = todos.orchestrator?.terminal;
  return terminal ? { terminal, live: isTerminalAlive(terminal) } : null;
}

function findItem(todos, id) {
  const item = todos.items.find((entry) => entry.id === id);
  if (!item) throw new HwsError(`no to-do ${id} in space ${todos.space}`);
  return item;
}

function findOpenItem(todos, id) {
  const item = findItem(todos, id);
  if (item.archived) throw new HwsError(`to-do ${id} is archived`);
  return item;
}

function changeOpenItem(space, id, changes) {
  return updateTodos(space, (todos) => {
    const item = findOpenItem(todos, id);
    Object.assign(item, changes, { updatedAt: Date.now() });
    return item;
  });
}

function titleFrom(flags) {
  const title = flags.title?.trim();
  if (!title) throw new UsageError('--title must not be blank');
  return title;
}

function textFrom(flags) {
  const text = requireFlag(flags, 'text');
  if (!text.trim()) throw new UsageError('--text must not be blank');
  return text;
}

function parseBoolean(name, value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new UsageError(`--${name} must be true or false`);
}

function newItem(title, fields = {}) {
  const now = Date.now();
  return {
    id: `t${randomBytes(3).toString('hex')}`,
    title,
    notes: '',
    column: 'todo',
    terminal: null,
    ...ITEM_DEFAULTS,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

// An agent's card starts held, so it waits for the person to press Allow.
function agentFields() {
  const terminal = process.env.HC_TERMINAL_ID;
  return terminal ? { addedBy: terminal, hold: true } : {};
}

function claim(item, terminal) {
  return Object.assign(item, { column: 'doing', terminal, updatedAt: Date.now() });
}

// Cards added together can share a createdAt, so the first in the file wins a tie.
function oldestReady(items) {
  return items
    .filter((item) => item.column === 'todo' && !item.hold && !item.archived)
    .reduce((oldest, item) => (oldest && oldest.createdAt <= item.createdAt ? oldest : item), null);
}

function textToSend(item) {
  return item.notes.trim() ? `${item.title}\n\n${item.notes}` : item.title;
}

export function todoList(flags) {
  const todos = readTodos(resolveSpace(flags));
  const items = todos.items.filter((item) => !item.archived).sort((a, b) => b.updatedAt - a.updatedAt);
  return { data: { items, orchestrator: orchestratorState(todos) } };
}

function addTitles(flags) {
  if (flags.title !== undefined) throw new UsageError('pass --title or --titles, not both');
  if (flags.notes !== undefined || flags.hold || flags.worktree) {
    throw new UsageError('--titles takes only --space');
  }
  const titles = flags.titles.split('\n').map((line) => line.trim()).filter(Boolean);
  if (titles.length === 0) throw new UsageError('--titles must have a line that is not blank');
  const items = titles.map((title) => newItem(title, agentFields()));
  updateTodos(resolveSpace(flags), (todos) => todos.items.push(...items));
  return { data: { items } };
}

export function todoAdd(flags) {
  if (flags.titles !== undefined) return addTitles(flags);
  const item = newItem(titleFrom(flags), {
    notes: flags.notes ?? '',
    hold: Boolean(flags.hold),
    worktree: Boolean(flags.worktree),
    ...agentFields(),
  });
  updateTodos(resolveSpace(flags), (todos) => todos.items.push(item));
  return { data: item };
}

export function todoEdit(flags) {
  const id = requireFlag(flags, 'id');
  const changes = {};
  if (flags.title !== undefined) changes.title = titleFrom(flags);
  if (flags.notes !== undefined) changes.notes = flags.notes;
  for (const name of ['hold', 'worktree']) {
    if (flags[name] !== undefined) changes[name] = parseBoolean(name, flags[name]);
  }
  if (Object.keys(changes).length === 0) throw new UsageError('pass --title, --notes, --hold or --worktree');
  return { data: changeOpenItem(resolveSpace(flags), id, changes) };
}

export function todoMove(flags) {
  const id = requireFlag(flags, 'id');
  if (!COLUMNS.includes(flags.column)) throw new UsageError('--column must be todo, doing, waiting or done');
  const changes = { column: flags.column };
  if (flags.note !== undefined) changes.note = flags.note;
  return { data: changeOpenItem(resolveSpace(flags), id, changes) };
}

export function todoNote(flags) {
  const id = requireFlag(flags, 'id');
  return { data: changeOpenItem(resolveSpace(flags), id, { note: textFrom(flags) }) };
}

export function todoNext(flags) {
  const terminal = requireFlag(flags, 'terminal');
  const item = updateTodos(resolveSpace(flags), (todos) => {
    const ready = oldestReady(todos.items);
    return ready && claim(ready, terminal);
  });
  return { data: item };
}

export function todoClaim(flags) {
  const id = requireFlag(flags, 'id');
  const terminal = requireFlag(flags, 'terminal');
  const item = updateTodos(resolveSpace(flags), (todos) => {
    const found = findOpenItem(todos, id);
    if (found.hold) throw new HwsError(`to-do ${id} is held`);
    if (found.column !== 'todo') throw new HwsError(`to-do ${id} is not in To do`);
    return claim(found, terminal);
  });
  return { data: item };
}

// The send outlasts the lock's stale limit, so it runs outside the lock.
export function todoSend(flags) {
  const id = requireFlag(flags, 'id');
  const terminal = requireFlag(flags, 'terminal');
  const space = resolveSpace(flags);
  const item = findOpenItem(readTodos(space), id);
  if (!isTerminalAlive(terminal)) throw new HwsError(`terminal ${terminal} is not live`);
  sendText(terminal, textToSend(item));
  return { data: changeOpenItem(space, id, { terminal, column: 'doing' }) };
}

// The send outlasts the lock's stale limit, so it runs outside the lock.
export function todoReply(flags) {
  const id = requireFlag(flags, 'id');
  const text = textFrom(flags);
  const space = resolveSpace(flags);
  const { terminal } = findOpenItem(readTodos(space), id);
  if (!terminal) throw new HwsError(`to-do ${id} has no terminal`);
  if (!isTerminalAlive(terminal)) throw new HwsError(`terminal ${terminal} is not live`);
  sendText(terminal, text);
  return { data: changeOpenItem(space, id, { note: '', column: 'doing' }) };
}

export function todoArchive(flags) {
  const id = requireFlag(flags, 'id');
  const item = updateTodos(resolveSpace(flags), (todos) => {
    const found = findItem(todos, id);
    if (!found.archived) Object.assign(found, { archived: true, updatedAt: Date.now() });
    return found;
  });
  return { data: item };
}
