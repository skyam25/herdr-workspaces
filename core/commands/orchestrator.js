import { HwsError } from '../errors.js';
import { act, isLiveChild, isTerminalAlive, keepingSelection, killTerminal, sendText } from '../herdr.js';
import { withLock } from '../lock.js';
import { expandFolder } from '../paths.js';
import { requireFlag } from '../resolve.js';
import { agentArgv } from '../agent-tools.js';
import { agentModels, requireFolder } from '../settings.js';
import { boardOf, orchestratorState, readTodos, requireWorkspace, resolveBoard, updateTodos } from './todo.js';

const BOARD_CHANGED = 'The task list changed. Run hws todo status and start whatever is ready.';
const STOPPED_NOTE = 'Stopped before finishing';

function firstPrompt(space) {
  return `Use the herdr-workspaces:orchestrate skill. Your task list is in space ${space}.`;
}

function openOrchestrator(space, board, folder) {
  const { terminal } = keepingSelection(() => act('tab.new', {
    name: 'Orchestrator',
    space,
    folder,
    argv: agentArgv(agentModels().orchestrator),
    task: firstPrompt(space),
  }));
  updateTodos(board, (todos) => {
    todos.orchestrator = { terminal, startedAt: Date.now() };
  });
  return terminal;
}

// A start lock apart from the to-do lock makes two clicks open one tab,
// and to-do commands keep running while the tab opens.
export function orchestratorStart(flags) {
  const space = requireFlag(flags, 'space');
  requireWorkspace(space);
  const folder = requireFolder(expandFolder(requireFlag(flags, 'folder')));
  const board = boardOf(space);
  const result = withLock(`orchestrator-${encodeURIComponent(board)}`, () => {
    const state = orchestratorState(readTodos(board));
    if (state?.live) return { terminal: state.terminal, started: false };
    return { terminal: openOrchestrator(space, board, folder), started: true };
  });
  if (!result.started) sendText(result.terminal, BOARD_CHANGED);
  return { data: result };
}

function doingTerminals(todos) {
  const doing = todos.items.filter((item) => item.column === 'doing' && item.terminal);
  return [...new Set(doing.map((item) => item.terminal))];
}

// Liveness checks can outlast the lock's stale limit, so they run before the lock.
// A card with no terminal never had a worker, so it stays where the person put it.
function returnEndedCards(space, orchestrator) {
  const ended = new Set(doingTerminals(readTodos(space)).filter((terminal) => !isTerminalAlive(terminal)));
  return updateTodos(space, (todos) => {
    const cards = todos.items.filter((item) => item.column === 'doing' && ended.has(item.terminal));
    const updatedAt = Date.now();
    for (const card of cards) Object.assign(card, { column: 'todo', terminal: null, owner: 'unassigned', note: STOPPED_NOTE, updatedAt });
    if (todos.orchestrator?.terminal === orchestrator) delete todos.orchestrator;
    return cards.map((card) => card.id);
  });
}

// Workers end with their parent, so they are listed before it ends.
export function orchestratorStop(flags) {
  const space = resolveBoard(flags);
  const todos = readTodos(space);
  const state = orchestratorState(todos);
  if (!state?.live) return { data: { stopped: false } };

  const { terminal } = state;
  const workers = doingTerminals(todos).filter((worker) => isLiveChild(worker, terminal));
  if (!killTerminal(terminal) && isTerminalAlive(terminal)) throw new HwsError(`could not end the orchestrator ${terminal}`);
  for (const worker of workers.filter(isTerminalAlive)) killTerminal(worker);

  return { data: { stopped: true, terminal, workers, returned: returnEndedCards(space, terminal) } };
}

export function orchestratorStatus(flags) {
  return { data: orchestratorState(readTodos(resolveBoard(flags))) };
}
