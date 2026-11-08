import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  assert.deepEqual(box.json(['todo', 'list', '--space', 'sp1']), { items: [] });

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

  const bad = box.hws(['todo', 'move', '--id', item.id, '--column', 'waiting', '--space', 'sp1']);
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
  for (const command of ['list', 'add', 'edit', 'move', 'send', 'archive']) assert.match(stdout, new RegExp(`todo ${command}`));
});
