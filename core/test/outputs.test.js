import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { flipToChat, sandbox } from './helpers.js';

const declared = (ref, at) => ({ ref, kind: 'markdown', tier: 'declared', status: 'ready', declaredAt: at });

// Writes `<folder>/.feedback/outputs/<session>.json` the way the Agent Brief plugin does.
function outputsFile(folder, session, content) {
  const dir = join(folder, '.feedback', 'outputs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${session}.json`), typeof content === 'string' ? content : JSON.stringify(content));
}

const agentsOf = (box, terminals) => box.json(['outputs', '--terminals', terminals.join(',')]).agents;

test('register keeps the session folder beside its id', (t) => {
  const box = sandbox(t);
  box.json(['register', '--terminal', 't1', '--session', 's1', '--folder', '/w']);
  assert.deepEqual(JSON.parse(readFileSync(join(box.root, 'terminal-sessions', 't1.json'), 'utf8')), { id: 's1', folder: '/w' });
});

test('outputs needs --terminals', (t) => {
  const box = sandbox(t);
  assert.equal(box.hws(['outputs']).code, 2);
});

test('a terminal with no registered session has no outputs', (t) => {
  const box = sandbox(t);
  assert.deepEqual(agentsOf(box, ['t1']), [{ terminal: 't1', session: null, folder: null, file: null, outputs: [] }]);
});

test('a session folder with no .feedback folder has no outputs', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  box.json(['register', '--terminal', 't1', '--session', 's1', '--folder', folder]);
  const [agent] = agentsOf(box, ['t1']);
  assert.deepEqual(agent, { terminal: 't1', session: 's1', folder, file: join(folder, '.feedback', 'outputs', 's1.json'), outputs: [] });
});

test('a session with no outputs file has no outputs', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  outputsFile(folder, 'other', { version: 1, outputs: [declared('a.md', 1)] });
  box.json(['register', '--terminal', 't1', '--session', 's1', '--folder', folder]);
  assert.deepEqual(agentsOf(box, ['t1'])[0].outputs, []);
});

test('a malformed or foreign outputs file reads as no outputs', (t) => {
  const box = sandbox(t);
  const bodies = ['not json', 'null', '[]', '{"version":2,"outputs":[]}', '{"version":1,"outputs":{}}'];
  bodies.forEach((body, index) => {
    const folder = box.folder(`w${index}`);
    outputsFile(folder, `s${index}`, body);
    box.json(['register', '--terminal', `t${index}`, '--session', `s${index}`, '--folder', folder]);
  });
  const agents = agentsOf(box, bodies.map((_, index) => `t${index}`));
  assert.deepEqual(agents.map((agent) => agent.outputs), bodies.map(() => []));
});

test('one agent lists its outputs, dropping bad records, duplicate refs and unknown fields', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  outputsFile(folder, 's1', {
    version: 1,
    sessionId: 's1',
    future: { anything: true },
    outputs: [
      { ...declared('docs/plan.md', 5), title: '  Plan  ', origin: 'created', lastWriteAt: 4, writes: 2, shiny: 'new' },
      declared('docs/plan.md', 9),
      { ref: 'notes.mdx', kind: 'notebook', tier: 'detected', lastWriteAt: 7, status: 'weird', declaredAt: 'yesterday' },
      { ref: 'https://claude.ai/artifact/x', url: 'https://claude.ai/artifact/x', kind: 'artifact', tier: 'declared', declaredAt: 3 },
      { ref: '', kind: 'markdown', tier: 'declared' },
      { ref: 'a.md', kind: 'markdown', tier: 'guessed' },
      { ref: 'b.md', tier: 'declared' },
      null,
      'a string',
    ],
  });
  box.json(['register', '--terminal', 't1', '--session', 's1', '--folder', folder]);

  assert.deepEqual(agentsOf(box, ['t1'])[0].outputs, [
    { ref: 'docs/plan.md', kind: 'markdown', tier: 'declared', title: 'Plan', status: 'ready', origin: 'created', declaredAt: 5, lastWriteAt: 4, writes: 2 },
    { ref: 'notes.mdx', kind: 'notebook', tier: 'detected', lastWriteAt: 7 },
    { ref: 'https://claude.ai/artifact/x', kind: 'artifact', tier: 'declared', url: 'https://claude.ai/artifact/x', declaredAt: 3 },
  ]);
});

test('a session registered without a folder uses the folder its program runs in', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  outputsFile(folder, 's1', { version: 1, outputs: [declared('a.md', 1)] });
  box.json(['register', '--terminal', 't1', '--session', 's1']);
  box.setState({ hc: { t1: { foreground: { cwd: folder, argv: ['claude'] } } } });
  const [agent] = agentsOf(box, ['t1']);
  assert.equal(agent.folder, folder);
  assert.deepEqual(agent.outputs.map((o) => o.ref), ['a.md']);
});

test('a session id that could leave the outputs folder binds nothing', (t) => {
  const box = sandbox(t);
  box.json(['register', '--terminal', 't1', '--session', '../escape', '--folder', box.folder('w')]);
  assert.equal(agentsOf(box, ['t1'])[0].session, null);
});

test('a flipped agent keeps its outputs', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { owner } = flipToChat(box, manifest);
  outputsFile(manifest.folder, 's1', { version: 1, outputs: [declared('page.html', 1)] });
  box.json(['register', '--terminal', owner, '--session', 's1', '--folder', manifest.folder]);
  const [agent] = agentsOf(box, [owner]);
  assert.equal(agent.terminal, owner);
  assert.deepEqual(agent.outputs.map((o) => o.ref), ['page.html']);
});

test('agents in two spaces of one workspace each list their own outputs, in the order asked', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['space', 'add', '--workspace', manifest.id, '--name', 'web']);
  const [first, second] = box.manifest(manifest.id).terminals.map((item) => item.terminal);
  const other = box.folder('web');
  outputsFile(manifest.folder, 's1', { version: 1, outputs: [declared('one.md', 1)] });
  outputsFile(other, 's2', { version: 1, outputs: [declared('two.md', 2)] });
  box.json(['register', '--terminal', first, '--session', 's1', '--folder', manifest.folder]);
  box.json(['register', '--terminal', second, '--session', 's2', '--folder', other]);

  const agents = agentsOf(box, [second, first]);
  assert.deepEqual(agents.map((agent) => [agent.terminal, agent.outputs.map((o) => o.ref)]), [[second, ['two.md']], [first, ['one.md']]]);
});

test('outputs writes nothing', (t) => {
  const box = sandbox(t);
  box.json(['register', '--terminal', 't1', '--session', 's1', '--folder', box.folder('w')]);
  box.clearCalls();
  agentsOf(box, ['t1', 't2']);
  assert.deepEqual(box.actions(), []);
});
