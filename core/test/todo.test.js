import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { liveFixtures, sandbox } from './helpers.js';

const { space, tab, terminal } = liveFixtures;

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
    hold: false,
    worktree: false,
    note: '',
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
  assert.deepEqual(box.json(['todo', 'list', '--space', 'sp1']), { items: [], orchestrator: null });

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

test('a remote space id keeps its to-dos in one file', (t) => {
  const box = sandbox(t);
  const item = box.json(['todo', 'add', '--title', 'remote', '--space', 'studio/sp1']);

  assert.deepEqual(box.json(['todo', 'list', '--space', 'studio/sp1']).items, [item]);
  assert.deepEqual(readdirSync(join(box.root, 'todos')), ['studio%2Fsp1.json']);
  assert.deepEqual(readdirSync(join(box.root, 'locks')), []);
});

test('a space id cannot leave the to-dos folder', (t) => {
  const box = sandbox(t);
  box.json(['todo', 'add', '--title', 'x', '--space', '../escape']);
  assert.equal(existsSync(join(box.root, 'escape.json')), false);
  assert.deepEqual(readdirSync(join(box.root, 'todos')), ['..%2Fescape.json']);
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

  assert.deepEqual(box.json(['todo', 'list', '--space', manifest.id]).items, [item]);
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

test('todo add sets hold and worktree', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task', '--hold', '--worktree');
  assert.equal(item.hold, true);
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
    ['--titles', 'a', '--hold'],
    ['--titles', 'a', '--worktree'],
  ]) {
    assert.equal(failure(box, 'add', ...args).code, 2, args.join(' '));
  }
  assert.equal(existsSync(todoFile(box)), false);
});

test('todo edit sets and clears hold and worktree and refuses other values', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');

  const held = todoJson(box, 'edit', '--id', item.id, '--hold', 'true', '--worktree', 'true');
  assert.equal(held.hold, true);
  assert.equal(held.worktree, true);

  const released = todoJson(box, 'edit', '--id', item.id, '--hold', 'false');
  assert.equal(released.hold, false);
  assert.equal(released.worktree, true);

  assert.equal(failure(box, 'edit', '--id', item.id, '--hold', 'yes').code, 2);
  assert.equal(failure(box, 'edit', '--id', item.id, '--worktree', '').code, 2);
  assert.equal(readTodos(box).items[0].hold, false);
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
  assert.equal(todoJson(box, 'claim', '--id', item.id, '--terminal', 't5').note, 'Need input');
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

test('todo next claims the oldest ready card and skips held and other columns', (t) => {
  const box = sandbox(t);
  const held = add(box, 'held', '--hold');
  const doing = add(box, 'doing');
  const archived = add(box, 'archived');
  const newer = add(box, 'newer');
  const older = add(box, 'older');
  todoJson(box, 'move', '--id', doing.id, '--column', 'doing');
  todoJson(box, 'archive', '--id', archived.id);
  setCreatedAt(box, { [held.id]: 1, [doing.id]: 2, [archived.id]: 3, [newer.id]: 20, [older.id]: 10 });

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
  todoJson(box, 'add', '--titles', 'one\ntwo\nthree');
  const titles = [1, 2, 3].map(() => todoJson(box, 'next', '--terminal', 't5').title);
  assert.deepEqual(titles, ['one', 'two', 'three']);
});

test('todo next with nothing to take writes nothing and needs a terminal', (t) => {
  const box = sandbox(t);
  assert.equal(todoJson(box, 'next', '--terminal', 't5'), null);
  assert.equal(existsSync(todoFile(box)), false);
  assert.equal(failure(box, 'next').code, 2);
});

test('todo claim takes a To do card and refuses held, moved and archived cards', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');
  const held = add(box, 'held', '--hold');
  const archived = add(box, 'archived');
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
  assert.match(refused.stderr, /is held/);
  assert.match(failure(box, 'claim', '--id', archived.id, '--terminal', 't6').stderr, /is archived/);
  assert.match(failure(box, 'claim', '--id', 'tnope', '--terminal', 't6').stderr, /no to-do tnope/);
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
});

test('concurrent next calls never take one card twice', async (t) => {
  const box = sandbox(t);
  const cards = 6;
  const workers = 10;
  todoJson(box, 'add', '--titles', Array.from({ length: cards }, (_, index) => `task ${index}`).join('\n'));

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
  const item = add(box, 'task');
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

test('older items read the new fields as false and empty', (t) => {
  const box = sandbox(t);
  const legacy = writeLegacyItem(box);

  assert.deepEqual(list(box), [{ ...legacy, hold: false, worktree: false, note: '' }]);

  const moved = todoJson(box, 'move', '--id', legacy.id, '--column', 'doing');
  assert.equal(moved.hold, false);
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

  assert.deepEqual(todoJson(box, 'list').orchestrator, { terminal: 't9', live: true });

  box.setState({ hc: { t9: 'missing' } });
  assert.deepEqual(todoJson(box, 'list').orchestrator, { terminal: 't9', live: false });
});

test('changing a card keeps the recorded orchestrator', (t) => {
  const box = sandbox(t);
  const item = add(box, 'task');
  const orchestrator = { terminal: 't9', startedAt: 1 };
  writeFileSync(todoFile(box), JSON.stringify({ ...readTodos(box), orchestrator }));

  todoJson(box, 'move', '--id', item.id, '--column', 'done');

  assert.deepEqual(readTodos(box).orchestrator, orchestrator);
});
