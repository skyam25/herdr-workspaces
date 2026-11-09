import { parseArgs } from 'node:util';

import { artifactAdd, artifactList, artifactScan, artifactSet, artifactTerminal, link } from './commands/artifact.js';
import { archive, unarchive } from './commands/archive.js';
import { doctor } from './commands/doctor.js';
import { update } from './commands/update.js';
import { current, list, parent, register } from './commands/info.js';
import { close, place, promote, prune, resume, setWorkspace } from './commands/lifecycle.js';
import { newTerminal, newThrowaway, newWorkspace } from './commands/new.js';
import { orchestratorStart, orchestratorStatus, orchestratorStop } from './commands/orchestrator.js';
import { phoneDeliver, phoneForget, phonePair, phoneSend, phoneStatus, phoneStop } from './commands/phone.js';
import { find, reopen } from './commands/retired.js';
import { decisionAdd, decisionList } from './commands/decision.js';
import { tidyApply, tidyStart, tidyStatus, tidyStop } from './commands/tidy.js';
import { boardAdd, boardOpen, spaceAdd, spaceMove, spaceRemove } from './commands/spaces.js';
import { surfaceDiscard, surfaceDone, surfaceFocus, surfaceList, surfaceOpen, surfaceResume, surfaceSocket } from './commands/surface.js';
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
  todoCapture,
  todoStart,
  todoResume,
  todoStatus,
} from './commands/todo.js';
import { modelsSet, modelsShow } from './commands/models.js';
import { UsageError } from './errors.js';

const text = { type: 'string' };
const flag = { type: 'boolean' };
const repeated = { type: 'string', multiple: true };

const ROUTES = [
  { path: ['new', 'terminal'], run: newTerminal, prunes: true, options: { folder: text } },
  {
    path: ['new', 'workspace'],
    run: newWorkspace,
    prunes: true,
    options: { name: text, folder: text, home: text, kind: text, tabs: text, instructions: text },
  },
  { path: ['new', 'throwaway'], run: newThrowaway, prunes: true, options: { name: text } },
  { path: ['board', 'add'], run: boardAdd, options: { workspace: text } },
  { path: ['board', 'open'], run: boardOpen, options: { space: text } },
  { path: ['space', 'add'], run: spaceAdd, options: { workspace: text, name: text, folder: text } },
  { path: ['space', 'move'], run: spaceMove, options: { space: text, workspace: text } },
  { path: ['space', 'remove'], run: spaceRemove, options: { space: text } },
  { path: ['current'], run: current, prunes: true, options: { terminal: text, line: flag } },
  { path: ['list'], run: list, prunes: true, options: { archived: flag } },
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
  { path: ['surface', 'list'], run: surfaceList, options: {} },
  { path: ['surface', 'resume'], run: surfaceResume, options: { id: text } },
  { path: ['surface', 'discard'], run: surfaceDiscard, options: { id: text } },
  { path: ['surface', 'socket'], run: surfaceSocket, options: { terminal: text, title: text } },
  { path: ['phone', 'pair'], run: phonePair, options: { tab: flag } },
  { path: ['phone', 'send'], run: phoneSend, options: { prompt: text, terminal: text, space: text }, positionals: 1 },
  { path: ['phone', 'status'], run: phoneStatus, options: {} },
  { path: ['phone', 'forget'], run: phoneForget, options: {}, positionals: 1 },
  { path: ['phone', 'stop'], run: phoneStop, options: {} },
  { path: ['phone', 'deliver'], run: phoneDeliver, options: { send: text, bundle: text } },
  { path: ['artifact', 'list'], run: artifactList, options: { workspace: text } },
  { path: ['artifact', 'terminal'], run: artifactTerminal, options: {}, positionals: 1 },
  { path: ['artifact', 'set'], run: artifactSet, options: { status: text, supersedes: text }, positionals: 1 },
  { path: ['artifact', 'add'], run: artifactAdd, options: { file: text, url: text, 'in-place': flag, title: text, workspace: text } },
  { path: ['artifact', 'scan'], run: artifactScan, options: { workspace: text } },
  { path: ['link'], run: link, options: {}, positionals: 1 },
  { path: ['todo', 'list'], run: todoList, options: { archived: flag, reports: flag, space: text } },
  {
    path: ['todo', 'add'],
    run: todoAdd,
    options: { title: text, titles: text, notes: text, owner: text, worktree: flag, space: text },
  },
  {
    path: ['todo', 'edit'],
    run: todoEdit,
    options: { id: text, title: text, notes: text, owner: text, worktree: text, space: text },
  },
  { path: ['todo', 'move'], run: todoMove, options: { id: text, column: text, note: text, report: text, space: text } },
  { path: ['todo', 'status'], run: todoStatus, options: { space: text } },
  { path: ['todo', 'resume'], run: todoResume, options: { id: text, space: text } },
  { path: ['todo', 'start'], run: todoStart, options: { ids: text, folder: text, owns: text, avoid: text, 'packet-file': text, space: text } },
  { path: ['todo', 'capture'], run: todoCapture, options: { terminal: text, text, space: text } },
  { path: ['todo', 'note'], run: todoNote, options: { id: text, text, space: text } },
  { path: ['todo', 'next'], run: todoNext, options: { terminal: text, space: text } },
  { path: ['todo', 'claim'], run: todoClaim, options: { id: text, terminal: text, space: text } },
  { path: ['todo', 'send'], run: todoSend, options: { id: text, terminal: text, space: text } },
  { path: ['todo', 'reply'], run: todoReply, options: { id: text, text, space: text } },
  { path: ['todo', 'archive'], run: todoArchive, options: { id: text, space: text } },
  { path: ['orchestrator', 'start'], run: orchestratorStart, options: { space: text, folder: text } },
  { path: ['models', 'set'], run: modelsSet, options: { role: text, tool: text, model: text, effort: text } },
  { path: ['models'], run: modelsShow, options: {} },
  { path: ['orchestrator', 'stop'], run: orchestratorStop, options: { space: text } },
  { path: ['orchestrator', 'status'], run: orchestratorStatus, options: { space: text } },
  {
    path: ['promote'],
    run: promote,
    options: { name: text, folder: text, kind: text, workspace: text },
  },
  {
    path: ['set'],
    run: setWorkspace,
    options: { workspace: text, name: text, kind: text, instructions: text, stage: text, home: text, place: repeated, writer: repeated },
  },
  { path: ['place'], run: place, options: { workspace: text }, positionals: 1 },
  { path: ['tidy', 'status'], run: tidyStatus, options: { workspace: text, line: flag } },
  { path: ['tidy', 'start'], run: tidyStart, options: { workspace: text, pane: text, here: flag } },
  { path: ['tidy', 'apply'], run: tidyApply, options: { file: text, skip: text, workspace: text } },
  { path: ['tidy', 'stop'], run: tidyStop, options: { workspace: text } },
  { path: ['decision', 'add'], run: decisionAdd, options: { title: text, why: text, 'decided-at': text, cites: text, replaces: text, workspace: text } },
  { path: ['decision', 'list'], run: decisionList, options: { workspace: text } },
  { path: ['parent'], run: parent, options: {} },
  { path: ['close'], run: close, prunes: true, options: { workspace: text, keep: flag, trash: flag } },
  { path: ['archive'], run: archive, options: { workspace: text } },
  { path: ['unarchive'], run: unarchive, options: { workspace: text } },
  { path: ['resume'], run: resume, options: { workspace: text } },
  { path: ['find'], run: find, options: {}, positionals: 'any' },
  { path: ['reopen'], run: reopen, options: {}, positionals: 1 },
  { path: ['prune'], run: prune, options: {} },
  { path: ['doctor'], run: doctor, options: {} },
  { path: ['update'], run: update, options: {} },
];

const USAGE = `Usage: hws <command> [--json]

${ROUTES.map((route) => `  ${route.path.join(' ')}`).join('\n')}

The contract in docs/CONTRACT.md lists every option.`;

function helpFor(words) {
  const routes = ROUTES.filter(({ path }) => words.every((word, index) => path[index] === word));
  if (routes.length === 0) return USAGE;
  const describe = ({ type }, name) => (type === 'boolean' ? `--${name}` : `--${name} X`);
  return routes.map(({ path, options }) => `hws ${[...path, ...Object.entries(options).map(([name, option]) => describe(option, name))].join(' ')}`).join('\n');
}

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
  const helpAt = args.findIndex((arg) => arg === '--help' || arg === '-h');
  if (helpAt > 0) {
    console.log(helpFor(args.slice(0, helpAt)));
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
