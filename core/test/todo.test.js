import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { test } from 'node:test';

import { todosPath } from '../paths.js';
import { liveFixtures, sandbox as plainSandbox } from './helpers.js';

const { space, tab, terminal } = liveFixtures;

// Agents use a Board only inside a workspace.

function sandbox(t) {
  const box = plainSandbox(t);
  box.inWorkspace('sp1');
  return box;
}

function todoFile(box, id = 'sp1') {
  return join(box.root, 'todos', `${id}.json`);
}

function readTodos(box, id = 'sp1') {
  return JSON.parse(readFileSync(todoFile(box, id), 'utf8'));
}

function add(box, title, ...rest) {
  return box.json(['todo', 'add', '--title', title, '--space', 'sp1', ...rest]);
}

function list(box) {
  return box.json(['todo', 'list', '--space', 'sp1']).items;
}

test('todo add writes the contract shape to the space file', (t) => {
  const box = sandbox(t);
  const item = add(box, 'Fix login', '--notes', 'Start with the form');

  assert.match(item.id, /^t[0-9a-f]{6}$/);
  assert.equal(typeof item.createdAt, 'number');
  assert.deepEqual(item, {
    id: item.id,
    title: 'Fix login',
    notes: 'Start with the form',
    column: 'todo',
    terminal: null,
    owner: 'unassigned',
    worktree: false,
    note: '',
    addedBy: null,
    report: '',
    reportFrom: null,
    session: null,
    replies: [],
    archived: false,
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
  });
  assert.deepEqual(readTodos(box), { version: 1, space: 'sp1', items: [item] });
});

test('todo add needs a title that is not blank', (t) => {
  const box = sandbox(t);
  assert.equal(box.hws(['todo', 'add', '--space', 'sp1']).code, 2);
  assert.equal(box.hws(['todo', 'add', '--title', '   ', '--space', 'sp1']).code, 2);
  assert.equal(existsSync(todoFile(box)), false);
});

test('todo list prints unarchived items, newest updatedAt first', (t) => {
  const box = sandbox(t);
  assert.deepEqual(box.json(['todo', 'list', '--space', 'sp1']), { items: [], orchestrator: null, spaces: ['sp1'], workspace: 'sp1' });

  const first = add(box, 'first');
  const second = add(box, 'second');
  const file = readTodos(box);
  file.items[0].updatedAt = 200;
  file.items[1].updatedAt = 100;
  writeFileSync(todoFile(box), JSON.stringify(file));

  assert.deepEqual(list(box).map((item) => item.id), [first.id, second.id]);
});

test('todo edit changes the text and can clear the notes', (t) => {
  const box = sandbox(t);
  const item = add(box, 'old', '--notes', 'keep');

  const renamed = box.json(['todo', 'edit', '--id', item.id, '--title', 'new', '--space', 'sp1']);
  assert.equal(renamed.title, 'new');
  assert.equal(renamed.notes, 'keep');

  const cleared = box.json(['todo', 'edit', '--id', item.id, '--notes', '', '--space', 'sp1']);
  assert.equal(cleared.notes, '');
  assert.deepEqual(readTodos(box).items, [cleared]);
});

test('todo edit refuses no changes and a blank title', (t) => {
  const box = sandbox(t);
  const item = add(box, 'stays');
  assert.equal(box.hws(['todo', 'edit', '--id', item.id, '--space', 'sp1']).code, 2);
  assert.equal(box.hws(['todo', 'edit', '--id', item.id, '--title', '', '--space', 'sp1']).code, 2);
  assert.equal(readTodos(box).items[0].title, 'stays');
});

test('todo move changes the column and refuses a bad one', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');

  assert.equal(box.json(['todo', 'move', '--id', item.id, '--column', 'done', '--space', 'sp1']).column, 'done');

  const bad = box.hws(['todo', 'move', '--id', item.id, '--column', 'later', '--space', 'sp1']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--column must be/);
  assert.equal(readTodos(box).items[0].column, 'done');
});

test('commands that take an id refuse an unknown one', (t) => {
  const box = sandbox(t);
  add(box, 'task');
  for (const args of [
    ['edit', '--title', 'x'],
    ['move', '--column', 'done'],
    ['send', '--terminal', 't5'],
    ['archive'],
  ]) {
    const result = box.hws(['todo', ...args, '--id', 'tnope', '--space', 'sp1']);
    assert.equal(result.code, 1, args[0]);
    assert.match(result.stderr, /no to-do tnope/);
  }
});

test('todo send pastes the title and notes, records the terminal and moves to doing', (t) => {
  const box = sandbox(t);
  const item = add(box, 'Fix login', '--notes', 'Start with the form');
  box.clearCalls();

  const sent = box.json(['todo', 'send', '--id', item.id, '--terminal', 't5', '--space', 'sp1']);

  assert.deepEqual(box.actions(), [['hc', 'send', 't5', 'Fix login\n\nStart with the form']]);
  assert.equal(sent.terminal, 't5');
  assert.equal(sent.column, 'doing');
  assert.deepEqual(readTodos(box).items, [sent]);
});

test('todo send sends only the title when there are no notes', (t) => {
  const box = sandbox(t);
  const item = add(box, 'Fix login');
  box.clearCalls();
  box.json(['todo', 'send', '--id', item.id, '--terminal', 't5', '--space', 'sp1']);
  assert.deepEqual(box.actions(), [['hc', 'send', 't5', 'Fix login']]);
});

test('todo send to a terminal that is not live fails without sending or changing the item', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');
  const before = readFileSync(todoFile(box), 'utf8');
  box.setState({ hc: { gone: 'missing', dead: { exit_code: 1 } } });
  box.clearCalls();

  for (const address of ['gone', 'dead']) {
    const result = box.hws(['todo', 'send', '--id', item.id, '--terminal', address, '--space', 'sp1']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`terminal ${address} is not live`));
  }

  assert.deepEqual(box.actions(), []);
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
});

test('a failed send leaves the item unchanged', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');
  const before = readFileSync(todoFile(box), 'utf8');
  box.setState({ sendFails: true });

  const result = box.hws(['todo', 'send', '--id', item.id, '--terminal', 't5', '--space', 'sp1']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /terminal is blocked/);
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
});

test('todo list --archived includes archived items', (t) => {
  const box = sandbox(t);
  const item = add(box, 'old');
  const other = add(box, 'other');
  box.json(['todo', 'archive', '--id', item.id, '--space', 'sp1']);
  const { items } = box.json(['todo', 'list', '--archived', '--space', 'sp1']);
  assert.deepEqual(items.map((entry) => [entry.id, entry.archived]).sort(), [[item.id, true], [other.id, false]].sort());
});

test('archived items are hidden, kept and frozen', (t) => {
  const box = sandbox(t);
  const item = add(box, 'old');
  const other = add(box, 'other');
  const archived = box.json(['todo', 'archive', '--id', item.id, '--space', 'sp1']);
  assert.equal(archived.archived, true);

  assert.deepEqual(list(box).map((entry) => entry.id), [other.id]);
  assert.equal(readTodos(box).items.length, 2);

  const before = readFileSync(todoFile(box), 'utf8');
  box.clearCalls();
  for (const args of [
    ['edit', '--title', 'x'],
    ['move', '--column', 'done'],
    ['send', '--terminal', 't5'],
  ]) {
    const result = box.hws(['todo', ...args, '--id', item.id, '--space', 'sp1']);
    assert.equal(result.code, 1, args[0]);
    assert.match(result.stderr, /is archived/);
  }
  assert.deepEqual(box.actions(), []);
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
});

test('archiving twice leaves the item as it was', (t) => {
  const box = sandbox(t);
  const item = add(box, 'old');
  const first = box.json(['todo', 'archive', '--id', item.id, '--space', 'sp1']);
  assert.deepEqual(box.json(['todo', 'archive', '--id', item.id, '--space', 'sp1']), first);
});

test('--space defaults to the selected space', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])], selected: 'sp1' });

  const item = box.json(['todo', 'add', '--title', 'here']);

  assert.deepEqual(readTodos(box).items, [item]);
  assert.deepEqual(box.json(['todo', 'list']).items, [item]);
});

test('--space wins over the selected space', (t) => {
  const box = sandbox(t);
  box.setState({ selected: 'sp1' });
  box.inWorkspace('sp2');
  const item = box.json(['todo', 'add', '--title', 'there', '--space', 'sp2']);
  assert.deepEqual(readTodos(box, 'sp2').items, [item]);
  assert.equal(existsSync(todoFile(box, 'sp1')), false);
});

test('no --space and no selected space is a usage error', (t) => {
  const box = sandbox(t);
  assert.equal(box.hws(['todo', 'list']).code, 2);
  box.setState({ statusFails: true });
  assert.equal(box.hws(['todo', 'add', '--title', 'x']).code, 2);
});

test('a board name cannot leave the to-dos folder', () => {
  assert.equal(basename(todosPath('studio/sp1')), 'studio%2Fsp1.json');
  assert.equal(basename(todosPath('../escape')), '..%2Fescape.json');
});

test('a damaged file is reported and kept', (t) => {
  const box = sandbox(t);
  add(box, 'task');
  writeFileSync(todoFile(box), '{ not json');

  const result = box.hws(['todo', 'add', '--title', 'x', '--space', 'sp1']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /is damaged/);
  assert.equal(readFileSync(todoFile(box), 'utf8'), '{ not json');
});

test('concurrent adds all land', async (t) => {
  const box = sandbox(t);
  const count = 8;

  const results = await Promise.all(
    Array.from({ length: count }, (_, index) => box.hwsAsync(['todo', 'add', '--title', `task ${index}`, '--space', 'sp1', '--json'])),
  );

  assert.deepEqual(results.map((result) => result.code), Array(count).fill(0));
  assert.equal(new Set(readTodos(box).items.map((item) => item.title)).size, count);
  assert.deepEqual(readdirSync(join(box.root, 'todos')), ['sp1.json']);
  assert.deepEqual(readdirSync(join(box.root, 'locks')), []);
});

test('to-dos survive closing a workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const item = box.json(['todo', 'add', '--title', 'keep me', '--space', manifest.id]);

  box.json(['close', '--workspace', manifest.id]);

  assert.deepEqual(readTodos(box, manifest.id).items, [item]);
});

test('surface open refuses a remote terminal before any Herdr call', (t) => {
  const box = sandbox(t);
  box.clearCalls();

  const result = box.hws(['surface', 'open', '--type', 'board', '--terminal', 'studio/t1']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /surfaces run on this computer/);
  assert.deepEqual(box.calls(), []);
});

test('hws --help lists the to-do commands', (t) => {
  const box = sandbox(t);
  const { stdout } = box.hws(['--help']);
  for (const command of ['list', 'add', 'edit', 'move', 'note', 'next', 'claim', 'send', 'reply', 'archive']) {
    assert.match(stdout, new RegExp(`todo ${command}`));
  }
});

function todoJson(box, ...args) {
  return box.json(['todo', ...args, '--space', 'sp1']);
}

function failure(box, ...args) {
  return box.hws(['todo', ...args, '--space', 'sp1']);
}

function writeLegacyItem(box) {
  const item = { id: 'told01', title: 'legacy', notes: '', column: 'todo', terminal: null, archived: false, createdAt: 1, updatedAt: 1 };
  mkdirSync(join(box.root, 'todos'), { recursive: true });
  writeFileSync(todoFile(box), JSON.stringify({ version: 1, space: 'sp1', items: [item] }));
  return item;
}

function setCreatedAt(box, times) {
  const file = readTodos(box);
  for (const item of file.items) item.createdAt = times[item.id];
  writeFileSync(todoFile(box), JSON.stringify(file));
}

test('todo add sets owner and worktree and refuses other owners', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task', '--owner', 'mine', '--worktree');
  assert.equal(item.owner, 'mine');
  assert.equal(failure(box, 'add', '--title', 'x', '--owner', 'nobody').code, 2);
  assert.equal(item.worktree, true);
  assert.deepEqual(readTodos(box).items, [item]);
});

test('todo add --titles adds a card per line and skips blank lines', (t) => {
  const box = sandbox(t);

  const { items } = todoJson(box, 'add', '--titles', 'one\n\n   \n  two  \r\nthree\n');

  assert.deepEqual(items.map((item) => item.title), ['one', 'two', 'three']);
  assert.equal(new Set(items.map((item) => item.id)).size, 3);
  assert.deepEqual(readTodos(box).items, items);
});

test('todo add --titles refuses all blank lines and other card fields', (t) => {
  const box = sandbox(t);
  for (const args of [
    ['--titles', ' \n\n'],
    ['--titles', ''],
    ['--titles', 'a', '--title', 'b'],
    ['--titles', 'a', '--title', ''],
    ['--titles', 'a', '--notes', 'n'],
    ['--titles', 'a', '--owner', 'mine'],
    ['--titles', 'a', '--worktree'],
  ]) {
    assert.equal(failure(box, 'add', ...args).code, 2, args.join(' '));
  }
  assert.equal(existsSync(todoFile(box)), false);
});

test('todo edit sets owner and worktree and refuses other values', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');

  const kept = todoJson(box, 'edit', '--id', item.id, '--owner', 'mine', '--worktree', 'true');
  assert.equal(kept.owner, 'mine');
  assert.equal(kept.worktree, true);

  const assigned = todoJson(box, 'edit', '--id', item.id, '--owner', 'agent');
  assert.equal(assigned.owner, 'agent');
  assert.equal(assigned.worktree, true);

  assert.equal(failure(box, 'edit', '--id', item.id, '--owner', 'yes').code, 2);
  assert.equal(failure(box, 'edit', '--id', item.id, '--worktree', '').code, 2);
  assert.equal(readTodos(box).items[0].owner, 'agent');
});

test('todo move reaches waiting and sets the note only when given', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');

  const waiting = todoJson(box, 'move', '--id', item.id, '--column', 'waiting', '--note', 'Which branch?');
  assert.equal(waiting.column, 'waiting');
  assert.equal(waiting.note, 'Which branch?');

  assert.equal(todoJson(box, 'move', '--id', item.id, '--column', 'waiting').note, 'Which branch?');
  assert.equal(todoJson(box, 'move', '--id', item.id, '--column', 'waiting', '--note', '').note, '');
});

test('leaving waiting by any route but reply keeps the note', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');
  const wait = () => todoJson(box, 'move', '--id', item.id, '--column', 'waiting', '--note', 'Need input');

  wait();
  assert.equal(todoJson(box, 'move', '--id', item.id, '--column', 'doing').note, 'Need input');

  wait();
  assert.equal(todoJson(box, 'send', '--id', item.id, '--terminal', 't5').note, 'Need input');

  wait();
  todoJson(box, 'move', '--id', item.id, '--column', 'todo');
  assert.equal(todoJson(box, 'claim', '--id', item.id, '--terminal', 't5').note, '');
});

test('todo note sets the note and leaves the column alone', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');

  const noted = todoJson(box, 'note', '--id', item.id, '--text', 'Half done');

  assert.equal(noted.note, 'Half done');
  assert.equal(noted.column, 'todo');
  assert.equal(failure(box, 'note', '--id', item.id).code, 2);
  assert.equal(failure(box, 'note', '--id', item.id, '--text', '  ').code, 2);
  assert.equal(readTodos(box).items[0].note, 'Half done');
});

test('todo next claims the oldest agent card and skips other owners and columns', (t) => {
  const box = sandbox(t);
  const held = add(box, 'unassigned');
  const mine = add(box, 'mine', '--owner', 'mine');
  const doing = add(box, 'doing', '--owner', 'agent');
  const archived = add(box, 'archived', '--owner', 'agent');
  const newer = add(box, 'newer', '--owner', 'agent');
  const older = add(box, 'older', '--owner', 'agent');
  todoJson(box, 'move', '--id', doing.id, '--column', 'doing');
  todoJson(box, 'archive', '--id', archived.id);
  setCreatedAt(box, { [held.id]: 1, [mine.id]: 1, [doing.id]: 2, [archived.id]: 3, [newer.id]: 20, [older.id]: 10 });

  const first = todoJson(box, 'next', '--terminal', 't5');
  assert.equal(first.id, older.id);
  assert.equal(first.column, 'doing');
  assert.equal(first.terminal, 't5');
  assert.deepEqual(readTodos(box).items.find((item) => item.id === older.id), first);

  assert.equal(todoJson(box, 'next', '--terminal', 't6').id, newer.id);
  assert.equal(todoJson(box, 'next', '--terminal', 't7'), null);
  assert.equal(readTodos(box).items.find((item) => item.id === held.id).column, 'todo');
});

test('cards added together are taken in line order', (t) => {
  const box = sandbox(t);
  const { items } = box.json(['todo', 'add', '--titles', 'one\ntwo\nthree', '--space', 'sp1']);
  for (const item of items) todoJson(box, 'edit', '--id', item.id, '--owner', 'agent');
  const titles = [1, 2, 3].map(() => todoJson(box, 'next', '--terminal', 't5').title);
  assert.deepEqual(titles, ['one', 'two', 'three']);
});

test('todo next with nothing to take writes nothing and needs a terminal', (t) => {
  const box = sandbox(t);
  assert.equal(todoJson(box, 'next', '--terminal', 't5'), null);
  assert.equal(existsSync(todoFile(box)), false);
  assert.equal(failure(box, 'next').code, 2);
});

test('todo claim takes an agent card and refuses other owners, moved and archived cards', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task', '--owner', 'agent');
  const held = add(box, 'unassigned');
  const mine = add(box, 'mine', '--owner', 'mine');
  const archived = add(box, 'archived', '--owner', 'agent');
  todoJson(box, 'archive', '--id', archived.id);

  const claimed = todoJson(box, 'claim', '--id', item.id, '--terminal', 't5');
  assert.equal(claimed.column, 'doing');
  assert.equal(claimed.terminal, 't5');

  const before = readFileSync(todoFile(box), 'utf8');
  const taken = failure(box, 'claim', '--id', item.id, '--terminal', 't6');
  assert.equal(taken.code, 1);
  assert.match(taken.stderr, /is not in To do/);
  const refused = failure(box, 'claim', '--id', held.id, '--terminal', 't6');
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /is not assigned to an agent/);
  assert.match(failure(box, 'claim', '--id', mine.id, '--terminal', 't6').stderr, /is not assigned to an agent/);
  assert.match(failure(box, 'claim', '--id', archived.id, '--terminal', 't6').stderr, /is archived/);
  assert.match(failure(box, 'claim', '--id', 'tnope', '--terminal', 't6').stderr, /no to-do tnope/);
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
});

test('concurrent next calls never take one card twice', async (t) => {
  const box = sandbox(t);
  const cards = 6;
  const workers = 10;
  for (let index = 0; index < cards; index += 1) add(box, `task ${index}`, '--owner', 'agent');

  const results = await Promise.all(
    Array.from({ length: workers }, (_, index) => box.hwsAsync(['todo', 'next', '--terminal', `w${index}`, '--space', 'sp1', '--json'])),
  );

  assert.deepEqual(results.map((result) => result.code), Array(workers).fill(0));
  const taken = results.map((result) => JSON.parse(result.stdout)).filter(Boolean);
  assert.equal(taken.length, cards);
  assert.equal(new Set(taken.map((item) => item.id)).size, cards);
  for (const item of readTodos(box).items) {
    assert.equal(item.terminal, taken.find((entry) => entry.id === item.id).terminal);
  }
  assert.deepEqual(readdirSync(join(box.root, 'locks')), []);
});

test('concurrent claims of one card have one winner', async (t) => {
  const box = sandbox(t);
  const item = add(box, 'task', '--owner', 'agent');
  const workers = 8;

  const results = await Promise.all(
    Array.from({ length: workers }, (_, index) => box.hwsAsync(['todo', 'claim', '--id', item.id, '--terminal', `w${index}`, '--space', 'sp1', '--json'])),
  );

  const winners = results.filter((result) => result.code === 0);
  assert.equal(winners.length, 1);
  assert.deepEqual(results.filter((result) => result.code !== 0).map((result) => result.code), Array(workers - 1).fill(1));
  assert.equal(readTodos(box).items[0].terminal, JSON.parse(winners[0].stdout).terminal);
});

test('todo reply pastes into the card terminal, clears the note and moves to doing', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');
  todoJson(box, 'send', '--id', item.id, '--terminal', 't5');
  todoJson(box, 'move', '--id', item.id, '--column', 'waiting', '--note', 'Which branch?');
  box.clearCalls();

  const replied = todoJson(box, 'reply', '--id', item.id, '--text', 'Use main');

  assert.deepEqual(box.actions(), [['hc', 'send', 't5', 'Use main']]);
  assert.equal(replied.note, '');
  assert.equal(replied.column, 'doing');
  assert.deepEqual(readTodos(box).items, [replied]);
});

test('a reply that cannot reach a live terminal leaves the card unchanged', (t) => {
  const box = sandbox(t);
  const noTerminal = add(box, 'no terminal');
  const item = add(box, 'task');
  todoJson(box, 'send', '--id', item.id, '--terminal', 'dead');
  todoJson(box, 'move', '--id', item.id, '--column', 'waiting', '--note', 'Stuck');
  const before = readFileSync(todoFile(box), 'utf8');
  box.setState({ hc: { dead: { exit_code: 1 } } });
  box.clearCalls();

  const none = failure(box, 'reply', '--id', noTerminal.id, '--text', 'hello');
  assert.equal(none.code, 1);
  assert.match(none.stderr, /has no terminal/);

  const dead = failure(box, 'reply', '--id', item.id, '--text', 'hello');
  assert.equal(dead.code, 1);
  assert.match(dead.stderr, /terminal dead is not live/);
  assert.deepEqual(box.actions(), []);

  box.setState({ hc: {}, sendFails: true });
  const blocked = failure(box, 'reply', '--id', item.id, '--text', 'hello');
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /terminal is blocked/);

  assert.equal(failure(box, 'reply', '--id', item.id, '--text', '  ').code, 2);
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
});

test('text flags take values that begin with a dash through the equals form', (t) => {
  const box = sandbox(t);
  const item = box.json(['todo', 'add', '--title=-v fails', '--notes=--see below', '--space', 'sp1']);
  assert.equal(item.title, '-v fails');
  assert.equal(item.notes, '--see below');

  const bulk = box.json(['todo', 'add', '--titles=-a\n--b', '--space', 'sp1']);
  assert.deepEqual(bulk.items.map((entry) => entry.title), ['-a', '--b']);

  assert.equal(box.json(['todo', 'edit', '--id', item.id, '--title=--json', '--space', 'sp1']).title, '--json');
  assert.equal(box.json(['todo', 'move', '--id', item.id, '--column', 'waiting', '--note=-why?', '--space', 'sp1']).note, '-why?');
  assert.equal(box.json(['todo', 'note', '--id', item.id, '--text=-later', '--space', 'sp1']).note, '-later');

  todoJson(box, 'send', '--id', item.id, '--terminal', 't5');
  box.clearCalls();
  box.json(['todo', 'reply', '--id', item.id, '--text=-y', '--space', 'sp1']);
  assert.deepEqual(box.actions(), [['hc', 'send', 't5', '-y']]);
});

test('older items read the new fields as defaults, and an unheld card is an agent card', (t) => {
  const box = sandbox(t);
  const legacy = writeLegacyItem(box);

  assert.deepEqual(list(box), [{ ...legacy, owner: 'agent', worktree: false, note: '', addedBy: null, report: '', reportFrom: null, session: null, replies: [] }]);

  const moved = todoJson(box, 'move', '--id', legacy.id, '--column', 'doing');
  assert.equal(moved.owner, 'agent');
  assert.equal(moved.worktree, false);
  assert.equal(moved.note, '');
  assert.deepEqual(readTodos(box).items, [moved]);
});

test('todo next claims an older item', (t) => {
  const box = sandbox(t);
  const legacy = writeLegacyItem(box);
  assert.equal(todoJson(box, 'next', '--terminal', 't5').id, legacy.id);
});

test('todo list prints the recorded orchestrator with its liveness', (t) => {
  const box = sandbox(t);
  add(box, 'task');
  writeFileSync(todoFile(box), JSON.stringify({ ...readTodos(box), orchestrator: { terminal: 't9', startedAt: 1 } }));

  assert.deepEqual(todoJson(box, 'list').orchestrator, { terminal: 't9', live: true, startedAt: 1 });

  box.setState({ hc: { t9: 'missing' } });
  assert.deepEqual(todoJson(box, 'list').orchestrator, { terminal: 't9', live: false, startedAt: 1 });
});

test('changing a card keeps the recorded orchestrator', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');
  const orchestrator = { terminal: 't9', startedAt: 1 };
  writeFileSync(todoFile(box), JSON.stringify({ ...readTodos(box), orchestrator }));

  todoJson(box, 'move', '--id', item.id, '--column', 'done');

  assert.deepEqual(readTodos(box).orchestrator, orchestrator);
});

function placedBoard(t, spaces, selected = 'other') {
  const box = sandbox(t);
  box.setState({ spaces: [...spaces, space('other', [tab('tb9', [terminal('t99', 'p99')])])], selected });
  return box;
}

function named(id, name, tabs = []) {
  return { ...space(id, tabs), name };
}

function addAs(box, address, ...flags) {
  return box.hws(['todo', 'add', '--title', 'task', '--json', ...flags], { HC_TERMINAL_ID: address });
}

function assertUnplaced(box, result) {
  assert.equal(result.code, 1);
  assert.match(JSON.parse(result.stdout).error, /cannot place terminal t50.*--space/);
  assert.equal(existsSync(join(box.root, 'todos')), false);
}

test('an agent resolves its own space from the live listing, not the selected one', (t) => {
  const box = placedBoard(t, [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])]);

  addAs(box, 't1');

  assert.equal(readTodos(box).items.length, 1);
  assert.equal(existsSync(todoFile(box, 'other')), false);
});

test('a sub-agent resolves the space of its parent pane', (t) => {
  const parent = { ...terminal('t1', 'p1'), sub_agents: [{ terminal: 't1b' }] };
  const box = placedBoard(t, [space('sp1', [tab('tb1', [parent])])]);

  addAs(box, 't1b');

  assert.equal(readTodos(box).items.length, 1);
});

test('a flipped agent resolves its space from the herdr.space label', (t) => {
  const box = placedBoard(t, [space('sp1', [])]);
  box.setState({ hc: { t50: { labels: { 'herdr.space': 'sp1' } } } });

  addAs(box, 't50');

  assert.equal(readTodos(box).items.length, 1);
});

test('the live listing wins over a label', (t) => {
  const box = placedBoard(t, [space('sp1', [tab('tb1', [terminal('t1', 'p1')])]), space('sp2', [])]);
  box.setState({ hc: { t1: { labels: { 'herdr.space': 'sp2' } } } });

  addAs(box, 't1');

  assert.equal(readTodos(box).items.length, 1);
  assert.equal(existsSync(todoFile(box, 'sp2')), false);
});

test('a where label places a terminal when its space name matches one space', (t) => {
  const box = placedBoard(t, [named('sp1', 'herdr-workspaces'), named('sp2', 'herdr')]);
  box.setState({ hc: { t50: { labels: { where: 'herdr-workspaces / img-test' } } } });

  addAs(box, 't50');

  assert.equal(readTodos(box).items.length, 1);
  assert.equal(existsSync(todoFile(box, 'sp2')), false);
});

test('a where label that matches two spaces is an error', (t) => {
  const box = placedBoard(t, [named('sp1', 'same'), named('sp2', 'same')]);
  box.setState({ hc: { t50: { labels: { where: 'same / tab' } } } });

  assertUnplaced(box, addAs(box, 't50'));
});

test('a where label that matches no space is an error', (t) => {
  const box = placedBoard(t, [named('sp1', 'one')]);
  box.setState({ hc: { t50: { labels: { where: 'gone / tab' } } } });

  assertUnplaced(box, addAs(box, 't50'));
});

test('a terminal nothing places is an error and never uses the selected space', (t) => {
  const box = placedBoard(t, [space('sp1', [])]);

  assertUnplaced(box, addAs(box, 't50'));

  const listed = box.hws(['todo', 'list', '--json'], { HC_TERMINAL_ID: 't50' });
  assert.equal(listed.code, 1);
  assert.match(JSON.parse(listed.stdout).error, /--space/);
  assert.equal(box.calls().some((call) => call.args[0] === 'status'), false);
});

test('a terminal still resolves its label when the window does not answer', (t) => {
  const box = placedBoard(t, []);
  box.setState({ lsFails: true, hc: { t50: { labels: { 'herdr.space': 'sp1' } } } });

  addAs(box, 't50');

  assert.equal(readTodos(box).items.length, 1);
});

test('--space wins over the terminal', (t) => {
  const box = placedBoard(t, [space('sp1', [])]);

  const result = addAs(box, 't50', '--space', 'sp1');

  assert.equal(result.code, 0);
  assert.equal(readTodos(box).items.length, 1);
  assert.equal(box.calls().length, 0);
});

test('with no terminal the selected space is used', (t) => {
  const box = placedBoard(t, [space('sp1', [])], 'sp1');

  box.json(['todo', 'add', '--title', 'task']);

  assert.equal(readTodos(box).items.length, 1);
});

test('an agent card records addedBy and starts unassigned', (t) => {
  const box = sandbox(t);

  const item = JSON.parse(addAs(box, 't7', '--space', 'sp1').stdout);

  assert.equal(item.addedBy, 't7');
  assert.equal(item.owner, 'unassigned');
});

test('every card from --titles records addedBy and starts unassigned', (t) => {
  const box = sandbox(t);

  const reply = box.hws(['todo', 'add', '--titles', 'one\ntwo', '--space', 'sp1', '--json'], { HC_TERMINAL_ID: 't7' });

  const { items } = JSON.parse(reply.stdout);
  assert.deepEqual(items.map((item) => [item.addedBy, item.owner]), [['t7', 'unassigned'], ['t7', 'unassigned']]);
});

test('a card with no terminal has a null addedBy and keeps its owner choice', (t) => {
  const box = sandbox(t);
  const plain = add(box, 'plain');

  assert.deepEqual([plain.addedBy, plain.owner], [null, 'unassigned']);
  assert.equal(add(box, 'kept', '--owner', 'mine').owner, 'mine');
  assert.equal(box.json(['todo', 'add', '--titles', 'one', '--space', 'sp1']).items[0].addedBy, null);
});

test('no agent takes an agent card until the person allows it', (t) => {
  const box = sandbox(t);
  const item = JSON.parse(addAs(box, 't7', '--space', 'sp1').stdout);

  assert.equal(box.json(['todo', 'next', '--terminal', 't8', '--space', 'sp1']), null);

  box.json(['todo', 'edit', '--id', item.id, '--owner', 'agent', '--space', 'sp1']);
  assert.equal(box.json(['todo', 'next', '--terminal', 't8', '--space', 'sp1']).id, item.id);
});

test('cards from before owners convert on read', (t) => {
  const box = sandbox(t);
  mkdirSync(join(box.root, 'todos'), { recursive: true });
  const card = (id, fields) => ({ id, title: id, notes: '', column: 'todo', terminal: null, archived: false, createdAt: 1, updatedAt: 1, ...fields });
  writeFileSync(todoFile(box), JSON.stringify({ version: 1, space: 'sp1', items: [
    card('draft', { hold: true, addedBy: 't7' }),
    card('kept', { hold: true, addedBy: null }),
    card('open', { hold: false, addedBy: null }),
  ] }));

  const owners = Object.fromEntries(list(box).map((item) => [item.id, item.owner]));

  assert.deepEqual(owners, { draft: 'unassigned', kept: 'mine', open: 'agent' });
  assert.equal(list(box).some((item) => 'hold' in item), false);
});

test('an agent cannot change a card that is mine, and the Board can', (t) => {
  const box = sandbox(t);
  const item = add(box, 'mine', '--owner', 'mine');
  const before = readFileSync(todoFile(box), 'utf8');
  const asAgent = (...args) => box.hws(['todo', ...args, '--id', item.id, '--space', 'sp1'], { HC_TERMINAL_ID: 't7' });

  for (const args of [['edit', '--title', 'x'], ['edit', '--owner', 'agent'], ['move', '--column', 'doing'], ['note', '--text', 'x'], ['archive'], ['send', '--terminal', 't5'], ['reply', '--text', 'x']]) {
    const result = asAgent(...args);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.stderr, /person's own|press Allow/);
  }
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
  assert.deepEqual(box.actions(), []);

  assert.equal(todoJson(box, 'move', '--id', item.id, '--column', 'doing').column, 'doing');
});

test('a closing message lands only on the cards that session just ended', (t) => {
  const box = sandbox(t);
  const asAgent = (terminal, ...args) => JSON.parse(box.hws(['todo', ...args, '--space', 'sp1', '--json'], { HC_TERMINAL_ID: terminal }).stdout);
  const [ended, asked, other, ownWords, reopened, earlier] = ['ended', 'asked', 'other', 'own', 'reopened', 'earlier'].map((title) => add(box, title));

  asAgent('t7', 'move', '--id', earlier.id, '--column', 'done');
  asAgent('t7', 'capture', '--terminal', 't7', '--text', 'first turn');
  asAgent('t7', 'move', '--id', ended.id, '--column', 'done');
  asAgent('t7', 'move', '--id', asked.id, '--column', 'waiting');
  asAgent('t8', 'move', '--id', other.id, '--column', 'done');
  asAgent('t7', 'move', '--id', ownWords.id, '--column', 'done', '--report', 'just this card');
  asAgent('t7', 'move', '--id', reopened.id, '--column', 'done');
  asAgent('t7', 'move', '--id', reopened.id, '--column', 'doing');

  assert.equal(asAgent('t7', 'capture', '--terminal', 't7', '--text', 'second turn').captured, 2);
  assert.equal(asAgent('t7', 'capture', '--terminal', 't7', '--text', 'third turn').captured, 0);

  const report = (item) => list(box).find((x) => x.id === item.id).report;
  assert.equal(report(earlier), 'first turn');
  assert.equal(report(ended), 'second turn');
  assert.equal(report(asked), 'second turn');
  assert.equal(report(other), '');
  assert.equal(report(ownWords), 'just this card');
  assert.equal(report(reopened), '');
});

test('an agent reading the board skips reports unless it asks for them', (t) => {
  const box = sandbox(t);
  const item = add(box, 'done');
  todoJson(box, 'move', '--id', item.id, '--column', 'done', '--report', 'long story');
  const read = (...flags) => JSON.parse(box.hws(['todo', 'list', '--space', 'sp1', '--json', ...flags], { HC_TERMINAL_ID: 't7' }).stdout).items[0];

  assert.equal('report' in read(), false);
  assert.equal(read('--reports').report, 'long story');
  assert.equal(list(box)[0].report, 'long story');
});

test('an agent can keep a card for the person but cannot add a ready one', (t) => {
  const box = sandbox(t);
  const agentAdd = (...flags) => box.hws(['todo', 'add', '--title', 'x', '--space', 'sp1', '--json', ...flags], { HC_TERMINAL_ID: 't7' });

  assert.equal(JSON.parse(agentAdd('--owner', 'mine').stdout).owner, 'mine');
  assert.equal(JSON.parse(agentAdd().stdout).owner, 'unassigned');
  assert.equal(agentAdd('--owner', 'agent').code, 2);
});

test('--help after a command names its flags', (t) => {
  const box = sandbox(t);
  const output = box.hws(['todo', 'status', '--help']).stdout;
  assert.match(output, /^hws todo status --space X$/m);
  assert.match(box.hws(['todo', '--help']).stdout, /hws todo add --title X/);
});

test('a reply stays on the card with the question it answered', (t) => {
  const box = sandbox(t);
  const item = add(box, 'asks');
  todoJson(box, 'send', '--id', item.id, '--terminal', 't5');
  todoJson(box, 'move', '--id', item.id, '--column', 'waiting', '--note', 'Which host?');

  const replied = todoJson(box, 'reply', '--id', item.id, '--text', 'The second one');

  assert.equal(replied.note, '');
  assert.deepEqual(replied.replies.map(({ question, answer }) => [question, answer]), [['Which host?', 'The second one']]);
});

const agentWith = (terminal) => ({ HC_TERMINAL_ID: terminal, CLAUDE_CODE_SESSION_ID: 'claude-1', CODEX_THREAD_ID: '' });
const withLiveSpace = (box, hc = {}) => box.setState({ spaces: [space('sp1', [tab('tb1', [])])], selected: 'sp1', hc });

test('a reply to a closed session reopens it with the reply as its next message', (t) => {
  const box = sandbox(t);
  const item = add(box, 'finished');
  box.hws(['todo', 'move', '--id', item.id, '--column', 'done', '--space', 'sp1', '--json'], agentWith('t7'));
  withLiveSpace(box, { t7: 'missing' });

  const reopened = todoJson(box, 'reply', '--id', item.id, '--text', 'Use the other name');

  const opened = box.actions().find((x) => x.includes('tab.new'));
  assert.match(opened.join(' '), /\["claude","--resume","claude-1","Use the other name"\]/);
  assert.equal(reopened.column, 'doing');
  assert.notEqual(reopened.terminal, 't7');
  assert.ok(box.actions().some((x) => x.includes('space.select')));
});

test('an agent cannot assign a card, and the Board can', (t) => {
  const box = sandbox(t);
  const item = add(box, 'draft');
  const asAgent = (...args) => box.hws(['todo', ...args, '--id', item.id, '--space', 'sp1'], { HC_TERMINAL_ID: 't7' });

  const edit = asAgent('edit', '--owner', 'agent');
  assert.equal(edit.code, 1);
  assert.match(edit.stderr, /press Allow/);
  assert.equal(asAgent('send', '--terminal', 't5').code, 1);
  assert.equal(todoJson(box, 'edit', '--id', item.id, '--owner', 'agent').owner, 'agent');
});

test('capture closes a worker whose card is done and leaves anyone else open', (t) => {
  const box = sandbox(t);
  const item = add(box, 'worker card');
  box.hws(['todo', 'move', '--id', item.id, '--column', 'done', '--space', 'sp1', '--json'], { HC_TERMINAL_ID: 't7' });
  box.setState({ hc: { t7: { labels: { 'hws.todo': item.id } } } });
  const capture = (terminal) => JSON.parse(box.hws(['todo', 'capture', '--terminal', terminal, '--text', 'done', '--space', 'sp1', '--json'], { HC_TERMINAL_ID: terminal }).stdout);

  assert.deepEqual(capture('t7'), { captured: 1, closed: true });
  assert.deepEqual(capture('t3'), { captured: 0, closed: false });
});

test('the orchestrator never runs a card and its summary stays off the card', (t) => {
  const box = sandbox(t);
  const item = add(box, 'unclear');
  writeFileSync(todoFile(box), JSON.stringify({ ...readTodos(box), orchestrator: { terminal: 't9', startedAt: 1 } }));
  const asOrchestrator = (...args) => JSON.parse(box.hws(['todo', ...args, '--space', 'sp1', '--json'], { HC_TERMINAL_ID: 't9' }).stdout);

  assert.equal(asOrchestrator('move', '--id', item.id, '--column', 'waiting', '--note', 'Which audience?').terminal, null);
  assert.equal(asOrchestrator('capture', '--terminal', 't9', '--text', 'Board summary').captured, 0);
  assert.equal(list(box)[0].report, '');
});

test('a worker with cards handed back still closes, and a handed-back card has no runner', (t) => {
  const box = sandbox(t);
  const item = add(box, 'too big');
  const worker = { HC_TERMINAL_ID: 't7', CLAUDE_CODE_SESSION_ID: 'claude-1', CODEX_THREAD_ID: '' };
  box.hws(['todo', 'move', '--id', item.id, '--column', 'doing', '--space', 'sp1', '--json'], worker);
  const back = JSON.parse(box.hws(['todo', 'move', '--id', item.id, '--column', 'todo', '--note', 'Needs its own worker: too big', '--space', 'sp1', '--json'], worker).stdout);
  assert.deepEqual([back.terminal, back.session], [null, null]);
  box.setState({ hc: { t7: { labels: { 'hws.todo': item.id } } } });

  const capture = JSON.parse(box.hws(['todo', 'capture', '--terminal', 't7', '--text', 'bye', '--space', 'sp1', '--json'], worker).stdout);
  assert.equal(capture.closed, true);
});

test('todo start claims the cards and starts one worker with the Models setting', (t) => {
  const box = sandbox(t);
  const first = add(box, 'build it', '--owner', 'agent', '--notes', 'the brief');
  const second = add(box, 'and this', '--owner', 'agent');
  box.setState({ spaces: [space('sp1', [tab('tb1', [])])], selected: 'sp1' });

  const result = JSON.parse(box.hws(['todo', 'start', '--ids', `${first.id},${second.id}`, '--folder', '/w', '--owns', 'a.js, b.js', '--space', 'sp1', '--json'], { HC_TERMINAL_ID: 't9' }).stdout);

  assert.equal(result.address, 't90');
  const run = box.actions().find((x) => x[1] === 'run');
  assert.match(run[5], new RegExp(`^todo-${first.id}-[0-9a-f]{4}$`));
  assert.deepEqual(run.slice(6, 10), ['--label', `hws.todo=${first.id},${second.id}`, '--cwd', '/w']);
  const session = list(box).find((x) => x.id === first.id).session;
  assert.deepEqual([session.tool, session.model, session.effort], ['claude', 'sonnet', 'medium']);
  assert.ok(run.join(' ').includes(`--session-id ${session.id}`));
  assert.deepEqual(run.slice(11, 15), ['claude', '--model', 'sonnet', '--effort']);
  const prompt = run.at(-1);
  assert.match(prompt, /Notes: the brief/);
  assert.match(prompt, /a\.js\nb\.js/);
  assert.match(prompt, /--report=/);
  assert.deepEqual(list(box).filter((x) => x.column === 'doing').map((x) => x.terminal), ['t90', 't90']);
});

test('models default to a stronger orchestrator and can change per role', (t) => {
  const box = sandbox(t);
  const shown = box.json(['models']);
  assert.deepEqual(shown.orchestrator, { tool: 'claude', model: 'opus', effort: 'high' });
  assert.deepEqual(shown.worker, { tool: 'claude', model: 'sonnet', effort: 'medium' });

  const changed = box.json(['models', 'set', '--role', 'worker', '--tool', 'codex', '--model', 'gpt-6.1-sol', '--effort', 'medium']);
  assert.equal(changed.worker.tool, 'codex');
  assert.equal(box.hws(['models', 'set', '--role', 'orchestrator', '--tool', 'codex', '--model', 'x', '--effort', 'low']).code, 2);
});

test('a Codex worker starts with its model and reports on the move', (t) => {
  const box = sandbox(t);
  box.json(['models', 'set', '--role', 'worker', '--tool', 'codex', '--model', 'gpt-6.1-sol', '--effort', 'medium']);
  const item = add(box, 'build it', '--owner', 'agent');
  box.setState({ spaces: [space('sp1', [tab('tb1', [])])], selected: 'sp1' });
  box.hws(['todo', 'start', '--ids', item.id, '--folder', '/w', '--space', 'sp1', '--json'], { HC_TERMINAL_ID: 't9' });
  const run = box.actions().find((x) => x[1] === 'run');
  assert.deepEqual(run.slice(11, 15), ['codex', '-m', 'gpt-6.1-sol', '-c']);
  assert.match(run.at(-1), /--report=/);
  assert.match(run.at(-1), /hc send t9 "todo .*done, close \$HC_TERMINAL_ID"/);
  assert.equal(list(box)[0].session, null);
});

test('a card saves the session of the agent that reports on it', (t) => {
  const box = sandbox(t);
  const claude = { HC_TERMINAL_ID: 't7', CLAUDE_CODE_SESSION_ID: 'claude-1', CODEX_THREAD_ID: '' };
  const codex = { HC_TERMINAL_ID: 't8', CLAUDE_CODE_SESSION_ID: '', CODEX_THREAD_ID: 'codex-1' };
  const run = (env, ...args) => JSON.parse(box.hws(['todo', ...args, '--space', 'sp1', '--json'], env).stdout);
  const first = add(box, 'claude card');
  const second = add(box, 'codex card');
  const queued = add(box, 'still to do');

  assert.equal(run(claude, 'move', '--id', first.id, '--column', 'done').session.id, 'claude-1');
  todoJson(box, 'move', '--id', second.id, '--column', 'doing');
  assert.equal(run(codex, 'note', '--id', second.id, '--text', 'halfway').session.tool, 'codex');
  assert.equal(run(codex, 'note', '--id', first.id, '--text', 'not the runner').session.id, 'claude-1');
  const waits = run(claude, 'note', '--id', queued.id, '--text', 'Waits for another card');
  assert.deepEqual([waits.terminal, waits.session], [null, null]);
});

test('todo resume opens the saved session in a new tab and links it', (t) => {
  const box = sandbox(t);
  const item = add(box, 'old run');
  const none = add(box, 'never run');
  JSON.parse(box.hws(['todo', 'move', '--id', item.id, '--column', 'done', '--space', 'sp1', '--json'], { HC_TERMINAL_ID: 't7', CLAUDE_CODE_SESSION_ID: 'claude-1', CODEX_THREAD_ID: '' }).stdout);

  box.setState({ spaces: [{ id: 'sp1', name: 'sp1', tabs: [{ id: 'tb1', name: 'one', terminals: [] }] }], selected: 'sp1', hc: { t7: 'missing' } });
  const resumed = todoJson(box, 'resume', '--id', item.id);
  const opened = box.actions().find((x) => x.includes('tab.new'));
  assert.match(opened.join(' '), /\["claude","--resume","claude-1"\]/);
  assert.notEqual(resumed.terminal, 't7');

  const failed = box.hws(['todo', 'resume', '--id', none.id, '--space', 'sp1']);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /no saved session/);
});

test('todo status separates what is ready, in flight and owed', (t) => {
  const box = sandbox(t);
  const ready = add(box, 'ready', '--owner', 'agent');
  add(box, 'not yet');
  const doing = add(box, 'running', '--owner', 'agent');
  todoJson(box, 'move', '--id', doing.id, '--column', 'doing');
  const waiting = add(box, 'asks');
  todoJson(box, 'move', '--id', waiting.id, '--column', 'waiting', '--note', 'Which?');

  const status = todoJson(box, 'status');
  assert.deepEqual(status.ready.map((x) => x.id), [ready.id]);
  assert.deepEqual(status.inFlight, [{ id: doing.id, title: 'running', terminal: null, live: false }]);
  assert.deepEqual(status.waiting, [{ id: waiting.id, title: 'asks', note: 'Which?' }]);
  assert.equal(status.needsAllow, 1);
});

test('a session that reports on a card becomes its link, and the first one stays', (t) => {
  const box = sandbox(t);
  const asAgent = (terminal, id, ...args) => JSON.parse(box.hws(['todo', ...args, '--id', id, '--space', 'sp1', '--json'], { HC_TERMINAL_ID: terminal }).stdout);
  const moved = add(box, 'moved');
  const noted = add(box, 'noted');
  const returned = add(box, 'returned');
  const onBoard = add(box, 'on the Board');

  assert.equal(asAgent('t7', moved.id, 'move', '--column', 'done').terminal, 't7');
  assert.equal(asAgent('t8', moved.id, 'move', '--column', 'doing').terminal, 't7');
  todoJson(box, 'move', '--id', noted.id, '--column', 'doing');
  assert.equal(asAgent('t7', noted.id, 'note', '--text', 'halfway').terminal, 't7');
  assert.equal(asAgent('t7', returned.id, 'move', '--column', 'todo').terminal, null);
  assert.equal(todoJson(box, 'move', '--id', onBoard.id, '--column', 'done').terminal, null);
});

test('an agent can read a card that is mine', (t) => {
  const box = sandbox(t);
  const item = add(box, 'mine', '--owner', 'mine');
  const reply = box.hws(['todo', 'list', '--space', 'sp1', '--json'], { HC_TERMINAL_ID: 't7' });
  assert.equal(JSON.parse(reply.stdout).items[0].id, item.id);
});

test('sending a card to a terminal assigns it to an agent', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task', '--owner', 'mine');
  const sent = box.json(['todo', 'send', '--id', item.id, '--terminal', 't5', '--space', 'sp1']);
  assert.equal(sent.owner, 'agent');
});

test('an agent in a plain space cannot use the Board', (t) => {
  const box = plainSandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t7', 'p7')])])], selected: 'sp1' });

  for (const args of [['list'], ['status'], ['add', '--title', 'x'], ['add', '--title', 'x', '--space', 'sp1'], ['next', '--terminal', 't7']]) {
    const result = box.hws(['todo', ...args], { HC_TERMINAL_ID: 't7' });
    assert.notEqual(result.code, 0, args.join(' '));
    assert.match(result.stderr, /only available inside a workspace/);
  }
  assert.equal(existsSync(todoFile(box)), false);
});

test('a plain space has no Board for the person either', (t) => {
  const box = plainSandbox(t);

  assert.deepEqual(box.json(['todo', 'list', '--space', 'sp1']), { items: [], orchestrator: null, spaces: ['sp1'], workspace: null });
  for (const args of [['add', '--title', 'x'], ['send', '--id', 'a', '--terminal', 't7'], ['reply', '--id', 'a', '--text', 'go'], ['resume', '--id', 'a'], ['status']]) {
    const result = box.hws(['todo', ...args, '--space', 'sp1']);
    assert.notEqual(result.code, 0, args[0]);
    assert.match(result.stderr, /only available inside a workspace/);
  }
  assert.equal(existsSync(todoFile(box)), false);
});

test('an agent can reach a workspace board from any terminal', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t7', 'p7')])])], selected: 'sp1' });
  assert.equal(box.hws(['todo', 'add', '--title', 'x', '--json'], { HC_TERMINAL_ID: 't7' }).code, 0);
});

test('a move that waits for a report leaves a marker, and capture removes it', (t) => {
  const box = sandbox(t);
  const marker = join(box.root, 'capture', 't7');
  const item = add(box, 'card');
  const asAgent = (...args) => box.hws(['todo', ...args, '--space', 'sp1', '--json'], { HC_TERMINAL_ID: 't7' });

  assert.equal(existsSync(marker), false);
  asAgent('move', '--id', item.id, '--column', 'done');
  assert.equal(existsSync(marker), true);
  asAgent('capture', '--terminal', 't7', '--text', 'finished');
  assert.equal(existsSync(marker), false);
});

test('a move that brings its own report leaves no marker', (t) => {
  const box = sandbox(t);
  const item = add(box, 'card');
  box.hws(['todo', 'move', '--id', item.id, '--column', 'done', '--report', 'written here', '--space', 'sp1', '--json'], { HC_TERMINAL_ID: 't7' });
  assert.equal(existsSync(join(box.root, 'capture', 't7')), false);
});

test('todo start leaves a marker for its Claude worker', (t) => {
  const box = sandbox(t);
  const item = add(box, 'build it', '--owner', 'agent');
  box.setState({ spaces: [space('sp1', [tab('tb1', [])])], selected: 'sp1' });
  box.hws(['todo', 'start', '--ids', item.id, '--folder', '/w', '--space', 'sp1', '--json'], { HC_TERMINAL_ID: 't9' });
  assert.equal(existsSync(join(box.root, 'capture', 't90')), true);
});

test('todo send links the session the terminal registered', (t) => {
  const box = sandbox(t);
  const item = add(box, 'card');
  box.setState({ hc: { t5: { foreground: { name: 'claude', argv: ['claude'], cwd: '/work' } } } });
  box.json(['register', '--terminal', 't5', '--session', 'uuid-5']);
  const sent = box.json(['todo', 'send', '--id', item.id, '--terminal', 't5', '--space', 'sp1']);
  assert.deepEqual(sent.session, { tool: 'claude', id: 'uuid-5', folder: '/work' });
});
