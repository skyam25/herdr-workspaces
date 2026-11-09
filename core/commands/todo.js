import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { callerSession, resumeArgv, sessionOfTerminal } from '../agent-session.js';
import { agentArgv, agentTool } from '../agent-tools.js';
import { HwsError, UsageError } from '../errors.js';
import { act, findTerminal, isTerminalAlive, keepingSelection, killTerminal, listLive, sendText, startWorker, terminalInfo, windowStatus } from '../herdr.js';
import { withLock } from '../lock.js';
import { manifestOfSpace, readManifest, writeJsonAtomic } from '../manifest.js';
import { capturePath, todosPath } from '../paths.js';
import { callerIsAgent, requireFlag, splitList } from '../resolve.js';
import { agentModels } from '../settings.js';
import { workerPrompt } from '../worker-prompt.js';

const COLUMNS = ['todo', 'doing', 'waiting', 'done'];
const OWNERS = ['mine', 'unassigned', 'agent'];
const ENDING_COLUMNS = ['waiting', 'done'];
const REPORT_LIMIT = 8000;
const ITEM_DEFAULTS = { worktree: false, note: '', addedBy: null, report: '', reportFrom: null, session: null, replies: [] };

// A `where` label reads "<space name> / <tab name>". Space names can repeat, so only a single match counts.
function spaceFromWhere(where, spaces) {
  const matches = spaces.filter(({ name }) => where === name || where.startsWith(`${name} / `));
  return matches.length === 1 ? matches[0].id : null;
}

// A flipped agent is missing from the listing, so its labels place it.
export function spaceOfTerminal(terminal) {
  const live = listLive();
  const found = live && findTerminal(live, terminal);
  if (found) return found.space.id;
  const labels = terminalInfo(terminal)?.labels ?? {};
  if (labels['herdr.space']) return labels['herdr.space'];
  return live && labels.where ? spaceFromWhere(labels.where, live.spaces) : null;
}

// An agent's card must reach its own board, so a set terminal never falls back to the selected space.
function callerSpace(flags) {
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

export function requireWorkspace(space) {
  if (!manifestOfSpace(space)) throw new HwsError(`the Board is only available inside a workspace, and space ${space} is not in one`);
}

function resolveSpace(flags) {
  const space = callerSpace(flags);
  requireWorkspace(space);
  return space;
}

// Spaces in a workspace share its board. A space that left a workspace it founded shares
// that workspace's id, so its own board keeps a different name, even once the workspace closes.
export function boardOf(space) {
  const manifest = manifestOfSpace(space);
  if (manifest) return manifest.id;
  const own = `${space}~space`;
  return readManifest(space) || existsSync(todosPath(own)) ? own : space;
}

export function resolveBoard(flags) {
  return boardOf(resolveSpace(flags));
}

// Adds to the new board before clearing the old one, so a failure cannot lose a card.
export function moveCards(from, to) {
  const { items, orchestrator } = readTodos(from);
  if (items.length === 0 && !orchestrator) return;
  updateTodos(to, (todos) => {
    todos.items.push(...items);
    if (orchestrator) todos.orchestrator ??= orchestrator;
  });
  updateTodos(from, (todos) => {
    todos.items = [];
    delete todos.orchestrator;
  });
}

// A card from before owners keeps its behavior, so a card that could be taken still can.
function legacyOwner(item) {
  if (!item.hold) return 'agent';
  return item.addedBy ? 'unassigned' : 'mine';
}

function withDefaults({ hold, ...item }) {
  return { ...ITEM_DEFAULTS, owner: item.owner ?? legacyOwner({ ...item, hold }), ...item };
}

// Only a missing file counts as empty, so a damaged file is never overwritten.
export function readTodos(space) {
  const path = todosPath(space);
  try {
    const todos = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(todos.items)) return { ...todos, items: todos.items.map(withDefaults) };
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
  return terminal ? { terminal, live: isTerminalAlive(terminal), startedAt: todos.orchestrator.startedAt ?? null } : null;
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

// A Herdr terminal is an agent's, and the Board runs with no terminal set.
function refuseAgentOnMine(item) {
  if (item.owner === 'mine' && callerIsAgent()) {
    throw new HwsError(`to-do ${item.id} is the person's own, so change it on the Board`);
  }
}

// Only the person assigns work, so the Board is the one place that can.
function refuseAgentAssigning(id) {
  if (callerIsAgent()) throw new HwsError(`to-do ${id} needs the person to press Allow on the Board`);
}

function findChangeableItem(todos, id) {
  const item = findOpenItem(todos, id);
  refuseAgentOnMine(item);
  return item;
}

function findClaimableItem(todos, id) {
  const item = findOpenItem(todos, id);
  if (item.owner !== 'agent') throw new HwsError(`to-do ${id} is not assigned to an agent`);
  if (item.column !== 'todo') throw new HwsError(`to-do ${id} is not in To do`);
  return item;
}

// A reporting session becomes the card's link on the Board, and the first one stays.
// Its session id is kept too, so the Board can resume it after the terminal ends.
function changeOpenItem(space, id, changes, reported = false) {
  const reporter = reported ? process.env.HC_TERMINAL_ID || null : null;
  const session = reporter ? callerSession() : null;
  return updateTodos(space, (todos) => {
    const item = findChangeableItem(todos, id);
    if (reporter && reporter !== todos.orchestrator?.terminal && (changes.column ?? item.column) !== 'todo') {
      item.terminal ??= reporter;
      if (session && item.terminal === reporter && item.session?.id !== session.id) item.session = session;
    }
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

function ownerFrom(value) {
  if (!OWNERS.includes(value)) throw new UsageError('--owner must be mine, unassigned or agent');
  return value;
}

function newItem(title, fields = {}) {
  const now = Date.now();
  return {
    id: `t${randomBytes(3).toString('hex')}`,
    title,
    notes: '',
    column: 'todo',
    terminal: null,
    owner: 'unassigned',
    ...ITEM_DEFAULTS,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

// An agent's card waits for the person to press Allow, so an agent can never add a ready card.
function agentFields(owner) {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) return {};
  if (owner === 'agent') throw new UsageError('an agent cannot add a ready card, so the person presses Allow');
  return { addedBy: terminal, owner: owner === 'mine' ? 'mine' : 'unassigned' };
}

function claim(item, terminal, fields) {
  return Object.assign(item, { column: 'doing', terminal, note: '', updatedAt: Date.now() }, fields);
}

// A claim made for another terminal says nothing about that terminal's session.
function ownSession(terminal) {
  const session = terminal === process.env.HC_TERMINAL_ID ? callerSession() : null;
  return session ? { session } : {};
}

// Cards added together can share a createdAt, so the first in the file wins a tie.
function oldestReady(items) {
  return items
    .filter((item) => item.column === 'todo' && item.owner === 'agent' && !item.archived)
    .reduce((oldest, item) => (oldest && oldest.createdAt <= item.createdAt ? oldest : item), null);
}

function textToSend(item) {
  return item.notes.trim() ? `${item.title}\n\n${item.notes}` : item.title;
}

export function todoList(flags) {
  const space = callerSpace(flags);
  const manifest = manifestOfSpace(space);

  // A mod asks with no terminal, and a plain space answers that it has no Board.
  if (!manifest && !callerIsAgent()) return { data: { items: [], orchestrator: null, spaces: [space], workspace: null } };

  requireWorkspace(space);
  const todos = readTodos(boardOf(space));
  const shown = todos.items.filter((item) => flags.archived || !item.archived).sort((a, b) => b.updatedAt - a.updatedAt);

  // An agent reading the board skips the reports, which can be long.
  const items = callerIsAgent() && !flags.reports ? shown.map(({ report, reportFrom, ...item }) => item) : shown;
  return { data: { items, orchestrator: orchestratorState(todos), spaces: manifest.spaces, workspace: manifest.id } };
}

function addTitles(flags) {
  if (flags.title !== undefined) throw new UsageError('pass --title or --titles, not both');
  if (flags.notes !== undefined || flags.owner !== undefined || flags.worktree) {
    throw new UsageError('--titles takes only --space');
  }
  const titles = flags.titles.split('\n').map((line) => line.trim()).filter(Boolean);
  if (titles.length === 0) throw new UsageError('--titles must have a line that is not blank');
  const items = titles.map((title) => newItem(title, agentFields()));
  updateTodos(resolveBoard(flags), (todos) => todos.items.push(...items));
  return { data: { items } };
}

export function todoAdd(flags) {
  if (flags.titles !== undefined) return addTitles(flags);
  const item = newItem(titleFrom(flags), {
    notes: flags.notes ?? '',
    ...(flags.owner !== undefined ? { owner: ownerFrom(flags.owner) } : {}),
    worktree: Boolean(flags.worktree),
    ...agentFields(flags.owner),
  });
  updateTodos(resolveBoard(flags), (todos) => todos.items.push(item));
  return { data: item };
}

export function todoEdit(flags) {
  const id = requireFlag(flags, 'id');
  const changes = {};
  if (flags.title !== undefined) changes.title = titleFrom(flags);
  if (flags.notes !== undefined) changes.notes = flags.notes;
  if (flags.owner !== undefined) changes.owner = ownerFrom(flags.owner);
  if (changes.owner === 'agent') refuseAgentAssigning(id);
  if (flags.worktree !== undefined) changes.worktree = parseBoolean('worktree', flags.worktree);
  if (Object.keys(changes).length === 0) throw new UsageError('pass --title, --notes, --owner or --worktree');
  return { data: changeOpenItem(resolveBoard(flags), id, changes) };
}

// The Stop hook skips a terminal with no marker, so most turns start no process at all.
function expectCapture(terminal) {
  const marker = capturePath(terminal);
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, '');
}

export function todoMove(flags) {
  const id = requireFlag(flags, 'id');
  if (!COLUMNS.includes(flags.column)) throw new UsageError('--column must be todo, doing, waiting or done');
  const changes = { column: flags.column };
  if (flags.note !== undefined) changes.note = flags.note;

  // The session's next closing message becomes the report, unless this move brings its own.
  changes.reportFrom = ENDING_COLUMNS.includes(flags.column) && flags.report === undefined ? process.env.HC_TERMINAL_ID || null : null;
  if (flags.report !== undefined) changes.report = flags.report.slice(0, REPORT_LIMIT);

  // Back in To do, a card has no runner until the next one claims it.
  if (flags.column === 'todo') Object.assign(changes, { terminal: null, session: null });
  const item = changeOpenItem(resolveBoard(flags), id, changes, true);
  if (changes.reportFrom) expectCapture(changes.reportFrom);
  return { data: item };
}

// Copies a session's closing message onto the cards it ended in that turn.
export function todoCapture(flags) {
  const terminal = requireFlag(flags, 'terminal');
  const report = textFrom(flags).slice(0, REPORT_LIMIT);
  const board = resolveBoard(flags);
  const cards = updateTodos(board, (todos) => {
    const ended = todos.items.filter((item) => item.reportFrom === terminal);
    if (ended.length === 0) return null;

    // Only the session that ran a card speaks for it, so an orchestrator's summary stays off.
    const own = ended.filter((item) => item.terminal === terminal);
    for (const item of own) item.report = report;
    for (const item of ended) item.reportFrom = null;
    return own;
  });

  // A worker whose card is done has nothing left to do, and Resume can bring it back.
  const cardIds = terminalInfo(terminal)?.labels?.['hws.todo']?.split(',') ?? [];
  const { items } = readTodos(board);
  const finished = cardIds.length > 0 && cardIds.every((id) => ['done', 'todo'].includes(items.find((item) => item.id === id)?.column));
  const closed = finished && killTerminal(terminal);
  if (closed || cardIds.length === 0) rmSync(capturePath(terminal), { force: true });
  return { data: { captured: cards?.length ?? 0, closed } };
}

// Starts one worker on one or more ready cards and claims them for it.
export function todoStart(flags) {
  const ids = splitList(requireFlag(flags, 'ids'));
  const folder = requireFlag(flags, 'folder');
  const orchestrator = process.env.HC_TERMINAL_ID;
  if (!orchestrator) throw new UsageError('run this inside the orchestrator terminal');
  const space = resolveSpace(flags);
  const board = boardOf(space);
  const todos = readTodos(board);
  const items = ids.map((id) => findClaimableItem(todos, id));
  const worker = agentModels().worker;
  const packet = flags['packet-file'] ? readFileSync(flags['packet-file'], 'utf8') : '';

  // Naming Claude's session up front means a worker that dies early can still be resumed.
  const tool = agentTool(worker.tool);
  const session = tool.sessionFlag ? { tool: worker.tool, id: randomUUID(), folder, model: worker.model, effort: worker.effort } : null;
  const prompt = workerPrompt({ items, space, orchestrator, packet, owns: splitList(flags.owns), avoid: splitList(flags.avoid), hooks: tool.reportsByHook });
  const name = `todo-${ids[0]}-${randomBytes(2).toString('hex')}`;
  const started = startWorker({ name, label: `hws.todo=${ids.join(',')}`, cwd: folder, argv: [...agentArgv(worker), ...(session ? [tool.sessionFlag, session.id] : []), prompt] });
  updateTodos(board, (current) => {
    for (const id of ids) claim(findOpenItem(current, id), started.address, { session });
  });
  if (tool.reportsByHook) expectCapture(started.address);
  return { data: { ...started, cards: ids, tool: worker.tool, model: worker.model } };
}

export function todoNote(flags) {
  const id = requireFlag(flags, 'id');
  return { data: changeOpenItem(resolveBoard(flags), id, { note: textFrom(flags) }, true) };
}

export function todoNext(flags) {
  const terminal = requireFlag(flags, 'terminal');
  const fields = ownSession(terminal);
  const item = updateTodos(resolveBoard(flags), (todos) => {
    const ready = oldestReady(todos.items);
    return ready && claim(ready, terminal, fields);
  });
  return { data: item };
}

export function todoClaim(flags) {
  const id = requireFlag(flags, 'id');
  const terminal = requireFlag(flags, 'terminal');
  const fields = ownSession(terminal);
  const item = updateTodos(resolveBoard(flags), (todos) => claim(findClaimableItem(todos, id), terminal, fields));
  return { data: item };
}

// The send outlasts the lock's stale limit, so it runs outside the lock.
export function todoSend(flags) {
  const id = requireFlag(flags, 'id');
  const terminal = requireFlag(flags, 'terminal');
  const board = resolveBoard(flags);
  const item = findChangeableItem(readTodos(board), id);
  if (item.owner !== 'agent') refuseAgentAssigning(id);
  if (!isTerminalAlive(terminal)) throw new HwsError(`terminal ${terminal} is not live`);
  sendText(terminal, textToSend(item));
  return { data: changeOpenItem(board, id, { terminal, column: 'doing', owner: 'agent', session: sessionOfTerminal(terminal) }) };
}

function openSessionTab(space, title, session, text) {
  return act('tab.new', { name: title.slice(0, 40), space, folder: session.folder, argv: resumeArgv(session, text) }).terminal;
}

// The send outlasts the lock's stale limit, so it runs outside the lock.
export function todoReply(flags) {
  const id = requireFlag(flags, 'id');
  const text = textFrom(flags);
  const space = resolveSpace(flags);
  const board = boardOf(space);
  const { title, terminal, note, replies, session } = findChangeableItem(readTodos(board), id);
  if (!terminal && !session) throw new HwsError(`to-do ${id} has no terminal`);
  const reply = { question: note, answer: text, at: Date.now() };
  const alive = terminal && isTerminalAlive(terminal);
  if (!alive && !session) throw new HwsError(`terminal ${terminal} is not live`);
  if (alive) sendText(terminal, text);

  // A closed session comes back with the person's words as its next message, so the window stays put.
  const reached = alive ? terminal : keepingSelection(() => openSessionTab(space, title, session, text));
  return { data: changeOpenItem(board, id, { terminal: reached, note: '', column: 'doing', replies: [...replies, reply] }) };
}

// What an orchestrator needs on each wake, without the text of every finished card.
export function todoStatus(flags) {
  const space = resolveSpace(flags);
  const todos = readTodos(boardOf(space));
  const open = todos.items.filter((item) => !item.archived);
  const inColumn = (column) => open.filter((item) => item.column === column);
  const ready = inColumn('todo').filter((item) => item.owner === 'agent').sort((a, b) => a.createdAt - b.createdAt);
  const data = {
    ready: ready.map(({ id, title, notes, note, worktree }) => ({ id, title, notes, note, worktree })),
    inFlight: inColumn('doing').map(({ id, title, terminal }) => ({ id, title, terminal, live: Boolean(terminal) && isTerminalAlive(terminal) })),
    waiting: inColumn('waiting').map(({ id, title, note }) => ({ id, title, note })),
    needsAllow: inColumn('todo').filter((item) => item.owner === 'unassigned').length,
    done: inColumn('done').length,
    orchestrator: orchestratorState(todos),
  };
  return { data, text: `${data.ready.length} ready, ${data.inFlight.length} in flight, ${data.waiting.length} waiting, ${data.needsAllow} need Allow` };
}

// Opens the card's saved session in a new tab of this space.
export function todoResume(flags) {
  const id = requireFlag(flags, 'id');
  const space = resolveSpace(flags);
  const board = boardOf(space);
  const item = findChangeableItem(readTodos(board), id);
  if (!item.session) throw new HwsError(`to-do ${id} has no saved session`);
  if (item.terminal && isTerminalAlive(item.terminal)) throw new HwsError(`to-do ${id} still has a live session`);
  const terminal = openSessionTab(space, item.title, item.session);
  return { data: changeOpenItem(board, id, { terminal }) };
}

export function todoArchive(flags) {
  const id = requireFlag(flags, 'id');
  const item = updateTodos(resolveBoard(flags), (todos) => {
    const found = findItem(todos, id);
    refuseAgentOnMine(found);
    if (!found.archived) Object.assign(found, { archived: true, updatedAt: Date.now() });
    return found;
  });
  return { data: item };
}
