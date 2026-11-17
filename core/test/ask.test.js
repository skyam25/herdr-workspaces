import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { flipToChat, sandbox } from './helpers.js';

const ROUND = [
  { id: 'audience', text: 'Who reads it?', kind: 'options', options: ['Engineers', 'Managers'] },
  { id: 'format', text: 'Which format?', kind: 'select', options: ['Memo', 'Deck', 'Page'] },
  { id: 'deadline', text: 'When is it due?', kind: 'text' },
];

function setup(t) {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  return { box, manifest, owner };
}

const dataOf = (box, manifest, surface) => join(box.root, 'workspaces', manifest.id, 'surfaces', surface.id);
const readData = (box, manifest, surface, name) => JSON.parse(readFileSync(join(dataOf(box, manifest, surface), name), 'utf8'));

function askFile(box, round = ROUND) {
  const file = join(box.dir, 'questions.json');
  writeFileSync(file, JSON.stringify(round));
  return file;
}

test('ask refuses a bad round with exit 2, names the field and opens nothing', (t) => {
  const { box, owner } = setup(t);
  const cases = [
    [[], /questions must hold 1 to 8 questions/],
    [Array.from({ length: 9 }, (_, n) => ({ id: `q${n}`, text: 'Why?', kind: 'text' })), /1 to 8 questions/],
    [{ items: [] }, /questions must be an array/],
    [['nope'], /questions\[0\] must be an object/],
    [[{ text: 'Why?', kind: 'text' }], /questions\[0\]\.id must be a non-empty string/],
    [[{ id: 'a', text: ' ', kind: 'text' }], /questions\[0\]\.text must be a non-empty string/],
    [[{ id: 'a', text: 'Why?', kind: 'radio' }], /questions\[0\]\.kind must be options, select or text/],
    [[{ id: 'a', text: 'Why?', kind: 'options', options: ['1', '2', '3', '4', '5'] }], /questions\[0\]\.options must list 2 to 4 choices for kind options/],
    [[{ id: 'a', text: 'Why?', kind: 'select', options: ['1'] }], /questions\[0\]\.options must list 2 to 6 choices for kind select/],
    [[{ id: 'a', text: 'Why?', kind: 'select', options: ['1', ''] }], /questions\[0\]\.options must hold non-empty strings/],
    [[{ id: 'a', text: 'Why?', kind: 'options', options: ['Yes', 'Yes '] }], /questions\[0\]\.options must not repeat a choice/],
    [[{ id: 'a', text: 'Why?', kind: 'text', options: ['1', '2'] }], /questions\[0\]\.options is only for options and select questions/],
    [[{ id: 'a', text: 'Why?', kind: 'text' }, { id: 'a', text: 'How?', kind: 'text' }], /questions\[1\]\.id repeats "a"/],
  ];
  for (const [round, message] of cases) {
    const result = box.hws(['ask', '--file', askFile(box, round), '--terminal', owner]);
    assert.equal(result.code, 2, JSON.stringify(round));
    assert.match(result.stderr, message);
  }

  const notJson = box.hws(['ask', '--terminal', owner], {}, '{oops');
  assert.equal(notJson.code, 2);
  assert.match(notJson.stderr, /stdin is not JSON/);
  assert.match(box.hws(['ask', '--terminal', owner]).stderr, /no questions in stdin/);
  assert.equal(box.hws(['ask', '--file', join(box.dir, 'gone.json'), '--terminal', owner]).code, 1);
  assert.deepEqual(box.actions(), []);
});

test('ask opens the round in a pane beside the agent and writes it to the data folder', (t) => {
  const { box, manifest, owner } = setup(t);

  const result = box.hws(['ask', '--title', 'Brief', '--terminal', owner], {}, JSON.stringify({ questions: ROUND }));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'Asked 3 questions in a pane beside this terminal. End the turn now. The answers arrive as your next prompt.');
  const [split] = box.actions();
  assert.equal(split[2], 'pane.split');
  assert.match(split.at(-1), /HWS_SURFACE_TYPE=questions/);
  const [record] = box.manifest(manifest.id).surfaces;
  assert.deepEqual([record.type, record.title, record.terminal, record.file, record.host], ['questions', 'Brief', owner, undefined, undefined]);
  assert.ok(record.pane);
  assert.deepEqual(readData(box, manifest, record, 'questions.json'), { questions: ROUND });
  assert.deepEqual(readData(box, manifest, record, 'answers.json'), { answers: {} });
});

test('ask reads the calling terminal, trims the round and titles it Questions', (t) => {
  const { box, manifest, owner } = setup(t);
  const round = [{ id: ' a ', text: ' Ship it? ', kind: 'options', options: [' Yes', 'No '] }];

  const surface = box.json(['ask', '--file', askFile(box, round)], { HC_TERMINAL_ID: owner });

  assert.equal(surface.title, 'Questions');
  assert.equal(surface.terminal, owner);
  assert.deepEqual(readData(box, manifest, surface, 'questions.json').questions, [{ id: 'a', text: 'Ship it?', kind: 'options', options: ['Yes', 'No'] }]);
  assert.equal(box.hws(['ask', '--file', askFile(box)]).code, 2);
});

test('ask opens beside the chat pane of a flipped agent', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { owner, chatPane } = flipToChat(box, manifest);

  box.json(['ask', '--file', askFile(box), '--terminal', owner]);

  const split = box.actions().find((call) => call[2] === 'pane.split');
  assert.equal(split[split.indexOf('--pane') + 1], chatPane);
});

test('ask --window opens the round in its own window', (t) => {
  const { box, manifest, owner } = setup(t);

  const result = box.hws(['ask', '--file', askFile(box), '--terminal', owner, '--window']);

  assert.match(result.stdout, /^Asked 3 questions in their own window\./);
  assert.deepEqual(box.actions()[0].slice(0, 2), ['hc', 'run']);
  const [record] = box.manifest(manifest.id).surfaces;
  assert.deepEqual([record.pane, record.host], [null, 't90']);
});

test('a second round closes the first, keeps its answers and drops those asked again', (t) => {
  const { box, manifest, owner } = setup(t);
  const first = box.json(['ask', '--file', askFile(box), '--terminal', owner]);
  const answers = { audience: { answer: 'Engineers' }, format: { answer: 'Deck' }, deadline: { answer: ' ' } };
  writeFileSync(join(dataOf(box, manifest, first), 'answers.json'), JSON.stringify({ answers }));
  box.clearCalls();

  const again = [{ id: 'format', text: 'Which format now?', kind: 'text' }];
  const second = box.json(['ask', '--file', askFile(box, again), '--terminal', owner]);

  assert.deepEqual(box.actions()[0], ['herdr-app', 'do', 'pane.close', '--pane', first.pane]);
  assert.equal(second.id, first.id);
  assert.deepEqual([second.asked, second.kept], [1, 1]);
  assert.deepEqual(readData(box, manifest, second, 'questions.json').questions, [ROUND[0], again[0]]);
  assert.deepEqual(readData(box, manifest, second, 'answers.json').answers, { audience: { answer: 'Engineers' } });
  const surfaces = box.manifest(manifest.id).surfaces;
  assert.deepEqual(surfaces.map((item) => [item.id, item.pane]), [[second.id, second.pane]]);
});

test('a round that fails to open keeps the earlier round and its answers', (t) => {
  const { box, manifest, owner } = setup(t);
  const first = box.json(['ask', '--file', askFile(box), '--terminal', owner]);
  const answers = { audience: { answer: 'Engineers' }, format: { answer: 'Deck' } };
  writeFileSync(join(dataOf(box, manifest, first), 'answers.json'), JSON.stringify({ answers }));
  box.setState({ failDo: ['pane.split'] });

  const again = [{ id: 'audience', text: 'Who reads it now?', kind: 'text' }];
  const failed = box.hws(['ask', '--file', askFile(box, again), '--terminal', owner]);

  assert.equal(failed.code, 1);
  assert.deepEqual(readData(box, manifest, first, 'questions.json').questions, ROUND);
  assert.deepEqual(readData(box, manifest, first, 'answers.json').answers, answers);
  assert.deepEqual(box.manifest(manifest.id).surfaces.map((item) => item.id), [first.id]);

  box.setState({ failDo: [] });
  const next = box.json(['ask', '--file', askFile(box, [{ id: 'tone', text: 'Which tone?', kind: 'text' }]), '--terminal', owner]);
  assert.equal(next.kept, 2);
  assert.deepEqual(readData(box, manifest, next, 'answers.json').answers, answers);
});

test('a round holds at most 8 questions, keeping the newest answered ones', (t) => {
  const { box, manifest, owner } = setup(t);
  const question = (id) => ({ id, text: `Question ${id}?`, kind: 'text' });
  const first = box.json(['ask', '--file', askFile(box, ['a', 'b', 'c', 'd', 'e', 'f'].map(question)), '--terminal', owner]);
  const answers = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, { answer: id.toUpperCase() }]));
  writeFileSync(join(dataOf(box, manifest, first), 'answers.json'), JSON.stringify({ answers }));

  const result = box.hws(['ask', '--file', askFile(box, ['x', 'y', 'z'].map(question)), '--terminal', owner]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Asked 3 questions in a pane beside this terminal\. 5 answered questions from the last round stay\. 1 older answer left the round, which holds 8 questions\./);
  const round = readData(box, manifest, first, 'questions.json').questions;
  assert.deepEqual(round.map((item) => item.id), ['b', 'c', 'd', 'e', 'f', 'x', 'y', 'z']);
  assert.deepEqual(Object.keys(readData(box, manifest, first, 'answers.json').answers), ['b', 'c', 'd', 'e', 'f']);

  const full = box.json(['ask', '--file', askFile(box, ['1', '2', '3', '4', '5', '6', '7', '8'].map(question)), '--terminal', owner]);
  assert.deepEqual([full.asked, full.kept, full.dropped], [8, 0, 5]);
});

test('done delivers the answers as one prompt, files them as a message and closes the pane', (t) => {
  const { box, manifest, owner } = setup(t);
  const surface = box.json(['ask', '--file', askFile(box), '--terminal', owner]);
  const text = 'Answers to your questions:\n- Who reads it?: Engineers\n- Which format?: (no answer)\n- When is it due?: Friday\n';
  const bundle = box.bundle('answers', text);
  box.clearCalls();

  const done = box.json(['surface', 'done', '--id', surface.id, '--bundle', bundle]);

  assert.deepEqual(box.actions(), [
    ['hc', 'send', owner, text],
    ['herdr-app', 'do', 'pane.close', '--pane', surface.pane],
    ['herdr-app', 'do', 'pane.focus', '--terminal', owner],
  ]);
  assert.equal(done.delivered, true);
  const after = box.manifest(manifest.id);
  const [artifact] = after.artifacts;
  assert.deepEqual([artifact.type, artifact.role, artifact.title, artifact.fromTerminal], ['questions', 'answers', 'Questions', owner]);
  assert.deepEqual(after.surfaces, []);
  assert.deepEqual(box.json(['artifact', 'scan', '--workspace', manifest.id]).tracked, []);
});

test('a closed window with an answer stays as a draft, and one with none goes at prune', (t) => {
  const { box, manifest, owner } = setup(t);
  const surface = box.json(['ask', '--file', askFile(box), '--terminal', owner, '--window']);
  box.setState({ hc: { t90: 'missing' } });

  writeFileSync(join(dataOf(box, manifest, surface), 'answers.json'), JSON.stringify({ answers: { deadline: { answer: 'Friday' } } }));
  box.json(['prune']);
  assert.deepEqual(box.json(['surface', 'list']).map((item) => [item.id, item.type, item.open]), [[surface.id, 'questions', false]]);

  writeFileSync(join(dataOf(box, manifest, surface), 'answers.json'), JSON.stringify({ answers: { deadline: { answer: '' } } }));
  box.json(['prune']);
  assert.deepEqual(box.manifest(manifest.id).surfaces, []);
  assert.ok(!existsSync(join(manifest.folder, '.herdr-workspace', `${manifest.name}-${manifest.id.slice(-6)}`, 'scratch', 'drafts')));
});

test('a moved round takes its answers and makes no drafts folder', (t) => {
  const { box, manifest, owner } = setup(t);
  const other = box.app('other');
  const surface = box.json(['ask', '--file', askFile(box), '--terminal', owner, '--window']);
  const answers = { deadline: { answer: 'Friday' } };
  writeFileSync(join(dataOf(box, manifest, surface), 'answers.json'), JSON.stringify({ answers }));

  box.json(['surface', 'move', '--id', surface.id, '--workspace', other.id]);

  assert.deepEqual(readData(box, other, surface, 'answers.json').answers, answers);
  assert.ok(!existsSync(join(other.folder, '.herdr-workspace', `${other.name}-${other.id.slice(-6)}`, 'scratch', 'drafts')));
});

test('surface open leaves questions to hws ask', (t) => {
  const { box, owner } = setup(t);
  const result = box.hws(['surface', 'open', '--type', 'questions', '--terminal', owner]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--type must be board, note or page/);
});
