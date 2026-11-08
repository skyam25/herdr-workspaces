import { parseArgs } from 'node:util';

import { artifactList, artifactTerminal, link } from './commands/artifact.js';
import { current, list, parent, register } from './commands/info.js';
import { close, promote, prune, resume, setWorkspace } from './commands/lifecycle.js';
import { newTerminal, newThrowaway, newWorkspace } from './commands/new.js';
import { find, reopen } from './commands/retired.js';
import { orchestratorStart, orchestratorStatus } from './commands/orchestrator.js';
import { surfaceDone, surfaceFocus, surfaceOpen, surfaceSocket } from './commands/surface.js';
import {
  todoAdd,
  todoArchive,
  todoClaim,
  todoEdit,
  todoList,
  todoMove,
  todoNext,
  todoNote,
  todoReply,
  todoSend,
} from './commands/todo.js';
import { UsageError } from './errors.js';

const text = { type: 'string' };
const flag = { type: 'boolean' };

const ROUTES = [
  { path: ['new', 'terminal'], run: newTerminal, prunes: true, options: { folder: text } },
  {
    path: ['new', 'workspace'],
    run: newWorkspace,
    prunes: true,
    options: { name: text, folder: text, kind: text, tabs: text, instructions: text },
  },
  { path: ['new', 'throwaway'], run: newThrowaway, prunes: true, options: { name: text } },
  { path: ['current'], run: current, prunes: true, options: { terminal: text, line: flag } },
  { path: ['list'], run: list, prunes: true, options: {} },
  { path: ['register'], run: register, options: { terminal: text, session: text, role: text } },
  {
    path: ['surface', 'open'],
    run: surfaceOpen,
    options: {
      type: text,
      title: text,
      file: text,
      terminal: text,
      standalone: flag,
      'in-pane': flag,
      'beside-pane': text,
      space: text,
    },
  },
  { path: ['surface', 'done'], run: surfaceDone, options: { id: text, bundle: text } },
  { path: ['surface', 'focus'], run: surfaceFocus, options: { id: text } },
  { path: ['surface', 'socket'], run: surfaceSocket, options: { terminal: text, title: text } },
  { path: ['artifact', 'list'], run: artifactList, options: { workspace: text } },
  { path: ['artifact', 'terminal'], run: artifactTerminal, options: {}, positionals: 1 },
  { path: ['link'], run: link, options: {}, positionals: 1 },
  { path: ['todo', 'list'], run: todoList, options: { space: text } },
  {
    path: ['todo', 'add'],
    run: todoAdd,
    options: { title: text, titles: text, notes: text, hold: flag, worktree: flag, space: text },
  },
  {
    path: ['todo', 'edit'],
    run: todoEdit,
    options: { id: text, title: text, notes: text, hold: text, worktree: text, space: text },
  },
  { path: ['todo', 'move'], run: todoMove, options: { id: text, column: text, note: text, space: text } },
  { path: ['todo', 'note'], run: todoNote, options: { id: text, text, space: text } },
  { path: ['todo', 'next'], run: todoNext, options: { terminal: text, space: text } },
  { path: ['todo', 'claim'], run: todoClaim, options: { id: text, terminal: text, space: text } },
  { path: ['todo', 'send'], run: todoSend, options: { id: text, terminal: text, space: text } },
  { path: ['todo', 'reply'], run: todoReply, options: { id: text, text, space: text } },
  { path: ['todo', 'archive'], run: todoArchive, options: { id: text, space: text } },
  { path: ['orchestrator', 'start'], run: orchestratorStart, options: { space: text, folder: text } },
  { path: ['orchestrator', 'status'], run: orchestratorStatus, options: { space: text } },
  {
    path: ['promote'],
    run: promote,
    options: { name: text, folder: text, kind: text, workspace: text },
  },
  { path: ['set'], run: setWorkspace, options: { workspace: text, kind: text, instructions: text } },
  { path: ['parent'], run: parent, options: {} },
  { path: ['close'], run: close, prunes: true, options: { workspace: text, keep: flag, trash: flag } },
  { path: ['resume'], run: resume, options: { workspace: text } },
  { path: ['find'], run: find, options: {}, positionals: 'any' },
  { path: ['reopen'], run: reopen, options: {}, positionals: 1 },
  { path: ['prune'], run: prune, options: {} },
];

const USAGE = `Usage: hws <command> [--json]

${ROUTES.map((route) => `  ${route.path.join(' ')}`).join('\n')}

The contract in docs/CONTRACT.md lists every option.`;

function findRoute(args) {
  const route = ROUTES.find(({ path }) => path.every((word, index) => args[index] === word));
  if (!route) throw new UsageError(`unknown command: ${args.join(' ') || '(none)'}`);
  return route;
}

function parseRouteArgs(route, args) {
  const rest = args.slice(route.path.length);
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: route.options,
      allowPositionals: true,
      strict: true,
    });
    if (route.positionals !== 'any' && positionals.length !== (route.positionals ?? 0)) throw new UsageError(`wrong arguments for hws ${route.path.join(' ')}`);
    return { flags: values, positionals };
  } catch (error) {
    if (error.code?.startsWith('ERR_PARSE_ARGS')) throw new UsageError(error.message);
    throw error;
  }
}

function printResult({ data, text: humanText }, json) {
  if (!json && humanText !== undefined) {
    if (humanText) console.log(humanText);
  } else {
    console.log(JSON.stringify(data));
  }
}

function printFailure(message, json) {
  if (json) console.log(JSON.stringify({ error: message }));
  else console.error(message);
}

export async function main(argv) {
  process.stdout.on('error', () => {});
  const json = argv.includes('--json');
  const args = argv.filter((arg) => arg !== '--json');
  if (args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE);
    return;
  }
  try {
    const route = findRoute(args);
    const { flags, positionals } = parseRouteArgs(route, args);
    if (route.prunes) prune();
    const result = await route.run(flags, positionals);
    printResult(result, json);
  } catch (error) {
    printFailure(error.message, json);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
