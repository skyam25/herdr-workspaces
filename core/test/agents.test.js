import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { sandbox } from './helpers.js';

const sessions = (box, id) => box.json(['agents', '--workspace', id]).agents.map((item) => item.session);

test('register keeps every session a terminal has run', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const address = manifest.terminals[0].terminal;
  box.json(['register', '--terminal', address, '--session', 'one', '--folder', manifest.folder]);
  box.json(['register', '--terminal', address, '--session', 'two', '--folder', manifest.folder]);
  box.json(['register', '--terminal', address, '--session', 'one', '--folder', manifest.folder]);

  const saved = box.manifest(manifest.id);
  assert.equal(saved.terminals[0].sessionId, 'one');
  assert.deepEqual(saved.agents.map((item) => [item.session, item.terminal, item.source]), [
    ['one', address, 'hook'],
    ['two', address, 'hook'],
  ]);
  assert.equal(typeof saved.agents[0].firstSeen, 'number');
});

test('tidy still sees a session a later one replaced on its terminal', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.transcript(manifest, 'first');
  box.transcript(manifest, 'second');
  const status = box.json(['tidy', 'status', '--workspace', manifest.id]);
  assert.deepEqual(status.items.filter((item) => item.kind === 'session').map((item) => item.id).sort(), ['first', 'second']);
});

test('agents lists the running session first, then ended ones newest first', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const address = manifest.terminals[0].terminal;
  box.transcript(manifest, 'old', { title: 'Old work', hours: 5 });
  box.transcript(manifest, 'newer', { title: 'Newer work', hours: 1 });
  box.transcript(manifest, 'live', { title: 'Live work', hours: 3 });
  box.setState({ hc: { [address]: { foreground: { name: 'claude', argv: ['claude'], cwd: manifest.folder } } } });

  const { agents } = box.json(['agents', '--workspace', manifest.id]);
  assert.deepEqual(agents.map((item) => [item.session, item.status, item.title]), [
    ['live', 'active', 'Live work'],
    ['newer', 'ended', 'Newer work'],
    ['old', 'ended', 'Old work'],
  ]);
  assert.match(box.hws(['agents', '--workspace', manifest.id]).stdout, /^active +\d{4}-\d{2}-\d{2} +Live work +live/);
});

test('a session recorded before the log existed still lists', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, terminals: [{ ...draft.terminals[0], sessionId: 'legacy' }] }));
  assert.deepEqual(sessions(box, manifest.id), ['legacy']);
});

test('agent add finds a transcript by id and takes its folder', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const elsewhere = box.folder('elsewhere');
  const project = join(box.homeDir, '.claude', 'projects', elsewhere.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'outside.jsonl'), `${JSON.stringify({ type: 'user', cwd: elsewhere, message: { content: 'plan the launch' } })}\n`);

  const added = box.json(['agent', 'add', '--workspace', manifest.id, '--session', 'outside']);
  assert.deepEqual([added.folder, added.existing], [elsewhere, false]);
  const entry = box.manifest(manifest.id).agents.find((item) => item.session === 'outside');
  assert.deepEqual([entry.source, entry.folder], ['manual', elsewhere]);
  assert.equal(box.json(['agent', 'add', '--workspace', manifest.id, '--session', 'outside']).existing, true);
});

test('agent add refuses a session with no transcript', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const result = box.hws(['agent', 'add', '--workspace', manifest.id, '--session', 'nowhere']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /no Claude transcript/);
});

test('a session in two workspaces names the other one', (t) => {
  const box = sandbox(t);
  const first = box.app('first');
  const second = box.app('second');
  box.transcript(first, 'shared');
  box.json(['agent', 'add', '--workspace', second.id, '--session', 'shared']);

  const listed = box.json(['agents', '--workspace', first.id]).agents[0];
  assert.deepEqual(listed.alsoIn, [{ id: second.id, name: 'second' }]);
  const where = box.json(['agents', '--session', 'shared']);
  assert.deepEqual(where.workspaces.map((item) => item.name).sort(), ['first', 'second']);
});

test('moving a space in logs the sessions running there', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const tab = { id: 'tb-plain', name: '1', terminals: [{ terminal: 't-plain', pane: 'p-plain', status: null, app: null, sub_agents: [] }] };
  box.setState({ spaces: [...box.state().spaces, { id: 'sp-plain', name: 'plain', folder: '/', tabs: [tab] }] });
  box.json(['register', '--terminal', 't-plain', '--session', 'brought', '--folder', '/tmp']);

  box.json(['space', 'move', '--space', 'sp-plain', '--workspace', manifest.id]);
  const entry = box.manifest(manifest.id).agents.find((item) => item.session === 'brought');
  assert.deepEqual([entry.source, entry.terminal, entry.folder], ['space', 't-plain', '/tmp']);
});

test('the first register on an older manifest keeps the session it replaces', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const address = manifest.terminals[0].terminal;
  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, terminals: [{ ...draft.terminals[0], sessionId: 'legacy' }] }));
  box.json(['register', '--terminal', address, '--session', 'fresh']);
  assert.deepEqual(box.manifest(manifest.id).agents.map((item) => [item.session, item.source]), [
    ['legacy', 'terminal'],
    ['fresh', 'hook'],
  ]);
});
