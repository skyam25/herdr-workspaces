import { act, sendText } from '../herdr.js';
import { withLock } from '../lock.js';
import { expandFolder } from '../paths.js';
import { requireFlag } from '../resolve.js';
import { requireFolder } from '../settings.js';
import { orchestratorState, readTodos, resolveSpace, updateTodos } from './todo.js';

const BOARD_CHANGED = 'The board changed. Read it and dispatch anything new.';

function firstPrompt(space) {
  return `Use the herdr-workspaces:orchestrate skill. Your board is space ${space}.`;
}

function openOrchestrator(space, folder) {
  const { terminal } = act('tab.new', {
    name: 'Orchestrator',
    space,
    folder,
    argv: ['claude'],
    task: firstPrompt(space),
  });
  updateTodos(space, (todos) => {
    todos.orchestrator = { terminal, startedAt: Date.now() };
  });
  return terminal;
}

// A start lock apart from the to-do lock makes two clicks open one tab,
// and to-do commands keep running while the tab opens.
export function orchestratorStart(flags) {
  const space = requireFlag(flags, 'space');
  const folder = requireFolder(expandFolder(requireFlag(flags, 'folder')));
  const result = withLock(`orchestrator-${encodeURIComponent(space)}`, () => {
    const state = orchestratorState(readTodos(space));
    if (state?.live) return { terminal: state.terminal, started: false };
    return { terminal: openOrchestrator(space, folder), started: true };
  });
  if (!result.started) sendText(result.terminal, BOARD_CHANGED);
  return { data: result };
}

export function orchestratorStatus(flags) {
  return { data: orchestratorState(readTodos(resolveSpace(flags))) };
}
