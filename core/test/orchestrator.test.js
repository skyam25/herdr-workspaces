import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { liveFixtures, sandbox } from './helpers.js';

const { space, tab, terminal } = liveFixtures;

const PROMPT = 'Use the herdr-workspaces:orchestrate skill. Your board is space sp1.';
const NOTE = 'The board changed. Read it and dispatch anything new.';

function todoFile(box) {
  return join(box.root, 'todos', 'sp1.json');
}

function readTodos(box) {
  return JSON.parse(readFileSync(todoFile(box), 'utf8'));
}

function board(t) {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])], selected: 'sp1' });
  return { box, folder: box.folder('project') };
}

function start(box, folder) {
  return box.json(['orchestrator', 'start', '--space', 'sp1', '--folder', folder]);
}

function record(box, address) {
  mkdirSync(join(box.root, 'todos'), { recursive: true });
  writeFileSync(todoFile(box), JSON.stringify({ version: 1, space: 'sp1', items: [], orchestrator: { terminal: address, startedAt: 1 } }));
}

function tabsOpened(box) {
  return box.actions().filter((action) => action[2] === 'tab.new');
}

test('start opens an Orchestrator tab with the first prompt and records it', (t) => {
  const { box, folder } = board(t);
  const before = Date.now();

  const result = start(box, folder);

  assert.deepEqual(box.actions(), [
    ['herdr-app', 'do', 'tab.new', '--name', 'Orchestrator', '--space', 'sp1', '--folder', folder, '--argv', '["claude"]', '--task', PROMPT],
  ]);
  assert.deepEqual(result, { terminal: 't101', started: true });
  const { orchestrator } = readTodos(box);
  assert.equal(orchestrator.terminal, 't101');
  assert.ok(orchestrator.startedAt >= before);
  assert.equal(box.state().spaces[0].tabs.at(-1).name, 'Orchestrator');
});

test('start with a live orchestrator pastes the note and opens nothing', (t) => {
  const { box, folder } = board(t);
  record(box, 't9');
  const before = readFileSync(todoFile(box), 'utf8');

  const result = start(box, folder);

  assert.deepEqual(result, { terminal: 't9', started: false });
  assert.deepEqual(box.actions(), [['hc', 'send', 't9', NOTE]]);
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
});

test('a dead recorded terminal counts as none', (t) => {
  for (const hc of [{ t9: 'missing' }, { t9: { exit_code: 1 } }]) {
    const { box, folder } = board(t);
    record(box, 't9');
    box.setState({ hc });

    const result = start(box, folder);

    assert.equal(result.started, true);
    assert.notEqual(result.terminal, 't9');
    assert.equal(tabsOpened(box).length, 1);
    assert.equal(readTodos(box).orchestrator.terminal, result.terminal);
  }
});

test('start keeps the cards already on the board', (t) => {
  const { box, folder } = board(t);
  const item = box.json(['todo', 'add', '--title', 'task', '--space', 'sp1']);

  start(box, folder);

  assert.deepEqual(readTodos(box).items, [item]);
});

test('start needs a space and a folder that exists', (t) => {
  const { box, folder } = board(t);

  assert.equal(box.hws(['orchestrator', 'start', '--folder', folder]).code, 2);
  assert.equal(box.hws(['orchestrator', 'start', '--space', 'sp1']).code, 2);

  const missing = box.hws(['orchestrator', 'start', '--space', 'sp1', '--folder', join(box.dir, 'nowhere')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /does not exist/);

  assert.deepEqual(box.actions(), []);
  assert.equal(existsSync(todoFile(box)), false);
});

test('a tab that fails to open records nothing', (t) => {
  const { box, folder } = board(t);
  box.setState({ failDo: ['tab.new'] });

  const result = box.hws(['orchestrator', 'start', '--space', 'sp1', '--folder', folder]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /tab\.new refused/);
  assert.equal(existsSync(todoFile(box)), false);
});

test('a note that fails to send is reported and changes nothing', (t) => {
  const { box, folder } = board(t);
  record(box, 't9');
  const before = readFileSync(todoFile(box), 'utf8');
  box.setState({ sendFails: true });

  const result = box.hws(['orchestrator', 'start', '--space', 'sp1', '--folder', folder]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /terminal is blocked/);
  assert.equal(tabsOpened(box).length, 0);
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
});

test('concurrent starts open one tab', async (t) => {
  const { box, folder } = board(t);
  const count = 6;

  const results = await Promise.all(
    Array.from({ length: count }, () => box.hwsAsync(['orchestrator', 'start', '--space', 'sp1', '--folder', folder, '--json'])),
  );

  assert.deepEqual(results.map((result) => result.code), Array(count).fill(0));
  const replies = results.map((result) => JSON.parse(result.stdout));
  assert.equal(replies.filter((reply) => reply.started).length, 1);
  assert.equal(new Set(replies.map((reply) => reply.terminal)).size, 1);
  assert.equal(tabsOpened(box).length, 1);
  assert.deepEqual(readdirSync(join(box.root, 'locks')), []);
});

test('status prints null, then the terminal with its liveness', (t) => {
  const { box, folder } = board(t);
  const status = () => box.json(['orchestrator', 'status', '--space', 'sp1']);

  assert.equal(status(), null);

  const { terminal: address } = start(box, folder);
  assert.deepEqual(status(), { terminal: address, live: true });

  box.setState({ hc: { [address]: 'missing' } });
  assert.deepEqual(status(), { terminal: address, live: false });
});

test('status defaults to the selected space', (t) => {
  const { box } = board(t);
  record(box, 't9');
  assert.deepEqual(box.json(['orchestrator', 'status']), { terminal: 't9', live: true });
});

test('hws --help lists the orchestrator commands', (t) => {
  const { box } = board(t);
  const { stdout } = box.hws(['--help']);
  for (const command of ['start', 'stop', 'status']) assert.match(stdout, new RegExp(`orchestrator ${command}`));
});

function card(id, column, address) {
  return { id, title: id, notes: '', column, terminal: address, hold: false, worktree: false, note: 'working', addedBy: null, archived: false, createdAt: 1, updatedAt: 1 };
}

function boardWith(box, items, address = 't9') {
  mkdirSync(join(box.root, 'todos'), { recursive: true });
  writeFileSync(todoFile(box), JSON.stringify({ version: 1, space: 'sp1', items, orchestrator: { terminal: address, startedAt: 1 } }));
}

function stop(box) {
  return box.json(['orchestrator', 'stop', '--space', 'sp1']);
}

function kills(box) {
  return box.actions().filter((action) => action[1] === 'kill').map((action) => action[2]);
}

function cardNamed(box, id) {
  return readTodos(box).items.find((item) => item.id === id);
}

test('stop ends the orchestrator first, then its live workers, and returns their cards', (t) => {
  const { box } = board(t);
  boardWith(box, [card('a', 'doing', 't20'), card('b', 'doing', 't21')]);
  box.setState({ hc: { t20: { parent: 't9' }, t21: { parent: 't9' } } });
  const before = Date.now();

  const result = stop(box);

  assert.deepEqual(kills(box), ['t9', 't20', 't21']);
  assert.deepEqual(result, { stopped: true, terminal: 't9', workers: ['t20', 't21'], returned: ['a', 'b'] });
  const returned = cardNamed(box, 'a');
  assert.deepEqual(
    [returned.column, returned.terminal, returned.hold, returned.note],
    ['todo', null, true, 'Stopped before finishing'],
  );
  assert.ok(returned.updatedAt >= before);
  assert.equal(readTodos(box).orchestrator, undefined);
});

test('stop lists workers before they end with the orchestrator', (t) => {
  const { box } = board(t);
  boardWith(box, [card('a', 'doing', 't20')]);
  box.setState({ killEndsChildren: true, hc: { t9: {}, t20: { parent: 't9' } } });

  const result = stop(box);

  assert.deepEqual(kills(box), ['t9']);
  assert.deepEqual(result.workers, ['t20']);
  assert.deepEqual(result.returned, ['a']);
  assert.equal(cardNamed(box, 'a').column, 'todo');
});

test('stop leaves a card alone when its live terminal is not a child', (t) => {
  const { box } = board(t);
  boardWith(box, [card('mine', 'doing', 't30')]);
  box.setState({ hc: { t30: { parent: 't1' } } });

  const result = stop(box);

  assert.deepEqual(kills(box), ['t9']);
  assert.deepEqual(result.returned, []);
  const left = cardNamed(box, 'mine');
  assert.deepEqual([left.column, left.terminal, left.hold, left.note], ['doing', 't30', false, 'working']);
});

test('stop returns a doing card whose worker already ended', (t) => {
  const { box } = board(t);
  boardWith(box, [card('gone', 'doing', 't40')]);
  box.setState({ hc: { t40: 'missing' } });

  const result = stop(box);

  assert.deepEqual(kills(box), ['t9']);
  assert.deepEqual(result.returned, ['gone']);
});

test('stop leaves other columns and a doing card with no terminal', (t) => {
  const { box } = board(t);
  const items = [card('w', 'waiting', 't41'), card('d', 'done', 't42'), card('t', 'todo', null), card('n', 'doing', null)];
  boardWith(box, items);
  box.setState({ hc: { t41: 'missing', t42: 'missing' } });

  assert.deepEqual(stop(box).returned, []);

  assert.deepEqual(readTodos(box).items, items);
});

test('stop with nothing recorded succeeds and changes nothing', (t) => {
  const { box } = board(t);

  assert.deepEqual(stop(box), { stopped: false });

  assert.deepEqual(box.actions(), []);
  assert.equal(existsSync(todoFile(box)), false);
});

test('stop with a dead orchestrator reports not stopped and changes nothing', (t) => {
  const { box } = board(t);
  boardWith(box, [card('a', 'doing', 't20')]);
  box.setState({ hc: { t9: 'missing', t20: 'missing' } });
  const before = readFileSync(todoFile(box), 'utf8');

  assert.deepEqual(stop(box), { stopped: false });

  assert.deepEqual(box.actions(), []);
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
});

test('stop that cannot end a live orchestrator fails and keeps the board', (t) => {
  const { box } = board(t);
  boardWith(box, [card('a', 'doing', 't20')]);
  box.setState({ killFails: true, hc: { t20: { parent: 't9' } } });
  const before = readFileSync(todoFile(box), 'utf8');

  const result = box.hws(['orchestrator', 'stop', '--space', 'sp1']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /could not end the orchestrator t9/);
  assert.equal(readFileSync(todoFile(box), 'utf8'), before);
});

test('stop run from an agent uses the space of its terminal', (t) => {
  const { box } = board(t);
  boardWith(box, []);

  const result = box.hws(['orchestrator', 'stop', '--json'], { HC_TERMINAL_ID: 't1' });

  assert.equal(JSON.parse(result.stdout).stopped, true);
  assert.deepEqual(kills(box), ['t9']);
});
