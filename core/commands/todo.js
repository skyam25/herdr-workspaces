import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { HwsError, UsageError } from '../errors.js';
import { isTerminalAlive, sendText, windowStatus } from '../herdr.js';
import { withLock } from '../lock.js';
import { writeJsonAtomic } from '../manifest.js';
import { todosPath } from '../paths.js';
import { requireFlag } from '../resolve.js';

const COLUMNS = ['todo', 'doing', 'done'];

function resolveSpace(flags) {
  const space = flags.space ?? windowStatus()?.space;
  if (!space) throw new UsageError('pass --space, because the window has no selected space');
  return space;
}

// Only a missing file counts as empty, so a damaged file is never overwritten.
function readTodos(space) {
  const path = todosPath(space);
  try {
    const todos = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(todos.items)) return todos;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, space, items: [] };
  }
  throw new HwsError(`the to-do file ${path} is damaged`);
}

// Runs one locked read, change and atomic write.
function updateTodos(space, change) {
  return withLock(`todos-${encodeURIComponent(space)}`, () => {
    const todos = readTodos(space);
    const result = change(todos);
    writeJsonAtomic(todosPath(space), todos);
    return result;
  });
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

function textToSend(item) {
  return item.notes.trim() ? `${item.title}\n\n${item.notes}` : item.title;
}

export function todoList(flags) {
  const items = readTodos(resolveSpace(flags))
    .items.filter((item) => !item.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return { data: { items } };
}

export function todoAdd(flags) {
  const title = titleFrom(flags);
  const now = Date.now();
  const item = {
    id: `t${randomBytes(3).toString('hex')}`,
    title,
    notes: flags.notes ?? '',
    column: 'todo',
    terminal: null,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  updateTodos(resolveSpace(flags), (todos) => todos.items.push(item));
  return { data: item };
}

export function todoEdit(flags) {
  const id = requireFlag(flags, 'id');
  const changes = {};
  if (flags.title !== undefined) changes.title = titleFrom(flags);
  if (flags.notes !== undefined) changes.notes = flags.notes;
  if (Object.keys(changes).length === 0) throw new UsageError('pass --title or --notes');
  return { data: changeOpenItem(resolveSpace(flags), id, changes) };
}

export function todoMove(flags) {
  const id = requireFlag(flags, 'id');
  if (!COLUMNS.includes(flags.column)) throw new UsageError('--column must be todo, doing or done');
  return { data: changeOpenItem(resolveSpace(flags), id, { column: flags.column }) };
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

export function todoArchive(flags) {
  const id = requireFlag(flags, 'id');
  const item = updateTodos(resolveSpace(flags), (todos) => {
    const found = findItem(todos, id);
    if (!found.archived) Object.assign(found, { archived: true, updatedAt: Date.now() });
    return found;
  });
  return { data: item };
}
