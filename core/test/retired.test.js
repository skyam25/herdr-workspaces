import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { sandbox } from './helpers.js';

const DAYS_31 = 31 * 24 * 3600_000;

// A throwaway that has sat idle past the limit, with the window showing another space.
function idleThrowaway(box, name = 'scratch') {
  const manifest = box.throwaway(name);
  box.transcript(manifest, `sess-${name}`, { hours: 30 });
  box.age(manifest.id, 30);
  box.setState({ selected: 'sp-elsewhere' });
  box.clearCalls();
  return manifest;
}

const retiredFile = (box, id) => join(box.root, 'retired', `${id}.json`);
const hasManifest = (box, id) => existsSync(join(box.root, 'workspaces', id, 'workspace.json'));
const closedSpaces = (box) => box.actions().filter((call) => call[2] === 'space.close');

test('prune closes an idle throwaway and keeps a record of it', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);

  assert.deepEqual(box.json(['prune']).expired, [manifest.id]);

  assert.equal(closedSpaces(box).length, 1);
  assert.equal(hasManifest(box, manifest.id), false);
  const record = JSON.parse(readFileSync(retiredFile(box, manifest.id), 'utf8'));
  assert.equal(record.name, 'scratch');
  assert.equal(record.sessions[0].sessionId, 'sess-scratch');
  assert.equal(record.sessions[0].title, 'Fix the login page');
  assert.equal(record.sessions[0].lastPrompt, 'why does login fail');
});

test('a recent transcript keeps an old throwaway open', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.transcript(manifest, 'sess', { hours: 2 });
  box.age(manifest.id, 100);
  box.setState({ selected: 'sp-elsewhere' });
  assert.deepEqual(box.json(['prune']).expired, []);
  assert.ok(hasManifest(box, manifest.id));
});

test('a young throwaway with no session stays open', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.setState({ selected: 'sp-elsewhere' });
  assert.deepEqual(box.json(['prune']).expired, []);
  assert.ok(hasManifest(box, manifest.id));
});

test('an old throwaway with no session closes and leaves no record', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.age(manifest.id, 30);
  box.setState({ selected: 'sp-elsewhere' });
  assert.deepEqual(box.json(['prune']).expired, [manifest.id]);
  assert.equal(existsSync(retiredFile(box, manifest.id)), false);
});

test('kept workspaces never expire', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.age(manifest.id, 1000);
  box.setState({ selected: 'sp-elsewhere' });
  assert.deepEqual(box.json(['prune']).expired, []);
  assert.ok(hasManifest(box, manifest.id));
});

test('the selected space does not expire', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  box.setState({ selected: manifest.id });
  assert.deepEqual(box.json(['prune']).expired, []);
  assert.ok(hasManifest(box, manifest.id));
});

test('nothing expires when the selected space is unknown', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  box.setState({ statusFails: true });
  assert.deepEqual(box.json(['prune']).expired, []);
  assert.ok(hasManifest(box, manifest.id));
});

test('nothing expires when the window does not answer', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  box.setState({ lsFails: true });
  assert.deepEqual(box.json(['prune']).expired, []);
  assert.ok(hasManifest(box, manifest.id));
});

for (const status of ['working', 'blocked', 'done']) {
  test(`an agent that is ${status} keeps its throwaway open`, (t) => {
    const box = sandbox(t);
    const manifest = idleThrowaway(box);
    box.setTerminals(manifest.id, { status, app: 'claude-code' });
    assert.deepEqual(box.json(['prune']).expired, []);
    assert.ok(hasManifest(box, manifest.id));
  });
}

test('an idle agent does not keep its throwaway open', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  box.setTerminals(manifest.id, { status: 'idle', app: 'claude-code' });
  assert.deepEqual(box.json(['prune']).expired, [manifest.id]);
});

test('a running program keeps its throwaway open', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  box.setState({ hc: { [manifest.terminals[0].terminal]: { foreground: { name: 'node', argv: ['node', 'server.js'] } } } });
  assert.deepEqual(box.json(['prune']).expired, []);
  assert.ok(hasManifest(box, manifest.id));
});

test('an open surface window keeps its throwaway open', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  box.json(['surface', 'open', '--type', 'board', '--terminal', manifest.terminals[0].terminal]);
  box.setState({ selected: 'sp-elsewhere' });
  assert.deepEqual(box.json(['prune']).expired, []);
  assert.ok(hasManifest(box, manifest.id));
});

function flip(box, manifest, state) {
  const spaces = box.state().spaces.map((item) => (item.id === manifest.id ? { ...item, tabs: item.tabs.map((one) => ({ ...one, terminals: [] })) } : item));
  box.setState({ spaces, hc: { [manifest.terminals[0].terminal]: { labels: { 'herdr.chat': 'p9' }, status: { state } } } });
}

test('a working flipped agent keeps its throwaway open', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  flip(box, manifest, 'working');
  assert.deepEqual(box.json(['prune']).expired, []);
});

test('an idle flipped agent does not keep its throwaway open', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  flip(box, manifest, 'idle');
  assert.deepEqual(box.json(['prune']).expired, [manifest.id]);
});

test('a refused close leaves the throwaway for the next prune', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  box.setState({ failDo: ['space.close'] });
  assert.deepEqual(box.json(['prune']).expired, []);
  assert.ok(hasManifest(box, manifest.id));
  assert.equal(existsSync(retiredFile(box, manifest.id)), false);
});

test('find matches the title, the last prompt and the name, and needs every word', (t) => {
  const box = sandbox(t);
  const login = idleThrowaway(box, 'alpha');
  const billing = box.throwaway('beta');
  box.transcript(billing, 'sess-beta', { title: 'Billing export', prompt: 'export invoices to csv', hours: 30 });
  box.age(billing.id, 30);
  box.setState({ selected: 'sp-elsewhere' });
  box.json(['prune']);

  const ids = (args) => box.json(['find', ...args]).map((record) => record.id);
  assert.equal(ids([]).length, 2);
  assert.deepEqual(ids(['LOGIN']), [login.id]);
  assert.deepEqual(ids(['invoices']), [billing.id]);
  assert.deepEqual(ids(['beta']), [billing.id]);
  assert.deepEqual(ids(['export', 'csv']), [billing.id]);
  assert.deepEqual(ids(['login', 'csv']), []);
  assert.deepEqual(ids(['--', '--login']), []);
});

test('find falls back to the newest typed prompt', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const say = (content, extra = {}) => ({ type: 'user', message: { content }, ...extra });
  const users = [
    say('how do tax brackets work'),
    say([{ type: 'text', text: 'and what about capital gains' }, { type: 'image' }]),
    say([{ type: 'tool_result', content: 'noise' }]),
    say('injected context', { isMeta: true }),
    say('<command-name>/clear</command-name>'),
  ];
  box.transcript(manifest, 'sess', { title: '', prompt: '', users });
  box.json(['close', '--workspace', manifest.id]);
  const [record] = box.json(['find', 'capital', 'gains']);
  assert.equal(record.sessions[0].lastPrompt, 'and what about capital gains');
});

test('reopen resumes the session in a new space and restores the artifacts', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const { artifact } = box.finishGlued(manifest);
  box.transcript(manifest, 'sess-1', { hours: 30 });
  box.age(manifest.id, 30);
  box.setState({ selected: 'sp-elsewhere' });
  box.json(['prune']);
  box.clearCalls();

  const reopened = box.json(['reopen', manifest.id]);

  assert.notEqual(reopened.id, manifest.id);
  assert.equal(reopened.kind, 'throwaway');
  assert.equal(reopened.name, 'scratch');
  assert.equal(reopened.terminals[0].sessionId, 'sess-1');
  assert.deepEqual(reopened.artifacts.map((item) => item.path), [artifact.path]);
  const opened = box.actions().find((call) => call[2] === 'space.new');
  assert.equal(opened[opened.indexOf('--argv') + 1], JSON.stringify(['claude', '--resume', 'sess-1']));
  assert.equal(opened[opened.indexOf('--folder') + 1], manifest.folder);
  assert.equal(existsSync(retiredFile(box, manifest.id)), false);
  assert.deepEqual(box.json(['find']), []);
});

test('a reopened throwaway gets a fresh idle period', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  box.json(['prune']);
  box.json(['reopen', manifest.id]);
  box.setState({ selected: 'sp-elsewhere' });
  assert.deepEqual(box.json(['prune']).expired, []);
});

test('reopen starts one tab per session, newest first', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.json(['surface', 'open', '--type', 'note', '--terminal', manifest.terminals[0].terminal]);
  box.transcript(manifest, 'sess-old', { hours: 50 });
  const second = box.state().spaces.find((item) => item.id === manifest.id).tabs[0].terminals[1].terminal;
  box.transcript(manifest, 'sess-new', { hours: 40, terminal: second });
  box.json(['close', '--workspace', manifest.id]);
  box.clearCalls();

  const reopened = box.json(['reopen', manifest.id]);

  assert.deepEqual(reopened.terminals.map((item) => item.sessionId), ['sess-new', 'sess-old']);
  assert.deepEqual(reopened.tabs.map((item) => item.name), ['Claude', 'Claude 2']);
});

test('reopen fails for an unknown id and a missing folder', (t) => {
  const box = sandbox(t);
  assert.equal(box.hws(['reopen', 'nope']).code, 1);
  assert.equal(box.hws(['reopen', '../../workspaces/x']).code, 1);
  assert.equal(box.hws(['reopen']).code, 2);

  mkdirSync(join(box.root, 'retired'), { recursive: true });
  const record = { id: 'sp9', name: 'gone', folder: join(box.dir, 'missing'), closedAt: Date.now(), sessions: [], artifacts: [] };
  writeFileSync(retiredFile(box, 'sp9'), JSON.stringify(record));
  assert.equal(box.hws(['reopen', 'sp9']).code, 1);
  assert.ok(existsSync(retiredFile(box, 'sp9')));
});

test('closing a throwaway by hand keeps a record', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.transcript(manifest, 'sess');
  box.json(['close', '--workspace', manifest.id]);
  assert.equal(box.json(['find', 'login'])[0].id, manifest.id);
});

test('Keep records the moved artifacts', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.finishGlued(manifest);
  box.json(['close', '--workspace', manifest.id, '--keep']);
  const [record] = box.json(['find']);
  assert.match(record.artifacts[0].path, /Documents\/Herdr Workspaces\/scratch\//);
});

test('Trash leaves no record', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.finishGlued(manifest);
  box.transcript(manifest, 'sess');
  box.json(['close', '--workspace', manifest.id, '--trash']);
  assert.deepEqual(box.json(['find']), []);
});

test('Trash from inside the space still leaves no record after the next prune', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.transcript(manifest, 'sess');
  const path = join(box.root, 'workspaces', manifest.id, 'workspace.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), discarded: true }));
  box.setState({ spaces: [{ id: 'sp-other', name: 'o', folder: '/', tabs: [] }] });
  box.json(['prune']);
  assert.deepEqual(box.json(['find']), []);
});

test('a space closed outside hws keeps a record', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.transcript(manifest, 'sess');
  box.setState({ spaces: [{ id: 'sp-other', name: 'o', folder: '/', tabs: [] }] });
  box.json(['prune']);
  assert.equal(box.json(['find'])[0].id, manifest.id);
});

test('closing a kept workspace leaves no record', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.transcript(manifest, 'sess');
  box.json(['close', '--workspace', manifest.id]);
  assert.deepEqual(box.json(['find']), []);
});

test('artifact list and link still reach a retired throwaway', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const { artifact } = box.finishGlued(manifest);
  box.transcript(manifest, 'sess', { hours: 30 });
  box.age(manifest.id, 30);
  box.setState({ selected: 'sp-elsewhere' });
  box.json(['prune']);

  assert.deepEqual(box.json(['artifact', 'list']).map((item) => item.id), [artifact.id]);
  assert.equal(box.json(['link', artifact.id]).link, `@${artifact.prompt}`);
});

function backdate(box, id) {
  const path = retiredFile(box, id);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), closedAt: Date.now() - DAYS_31 }));
}

test('an old record goes away and its stored artifacts go to the Trash', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const { artifact } = box.finishGlued(manifest);
  box.transcript(manifest, 'sess', { hours: 30 });
  box.age(manifest.id, 30);
  box.setState({ selected: 'sp-elsewhere' });
  box.json(['prune']);
  assert.ok(existsSync(artifact.prompt));
  box.app('other');
  backdate(box, manifest.id);

  box.json(['prune']);

  assert.equal(existsSync(retiredFile(box, manifest.id)), false);
  assert.equal(existsSync(artifact.path), false);
  assert.ok(existsSync(join(box.trashDir, `0-${artifact.id}`, 'prompt.md')));
  assert.equal(existsSync(dirname(artifact.path)), false);
});

test('an old record leaves artifacts the user chose to keep', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.finishGlued(manifest);
  box.json(['close', '--workspace', manifest.id, '--keep']);
  const [{ artifacts: [kept] }] = box.json(['find']);
  box.app('other');
  backdate(box, manifest.id);

  box.json(['prune']);

  assert.ok(existsSync(kept.prompt));
  assert.equal(existsSync(retiredFile(box, manifest.id)), false);
});

test('a recent record stays', (t) => {
  const box = sandbox(t);
  const manifest = idleThrowaway(box);
  box.json(['prune']);
  box.json(['prune']);
  assert.ok(existsSync(retiredFile(box, manifest.id)));
});
