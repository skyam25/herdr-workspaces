import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { liveFixtures, sandbox } from './helpers.js';

const { space, tab, terminal } = liveFixtures;

test('artifact list covers every workspace, standalone included', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { artifact } = box.finishGlued(manifest);
  box.setState({ spaces: [...box.state().spaces, space('sp9', [tab('tb9', [terminal('t9', 'p9')])])], selected: 'sp9' });
  const solo = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--standalone']);
  box.json(['surface', 'done', '--id', solo.id, '--bundle', box.bundle('solo-bundle')]);

  const all = box.json(['artifact', 'list']);
  assert.equal(all.length, 2);
  assert.deepEqual(box.json(['artifact', 'list', '--workspace', manifest.id]), [{ ...artifact, workspace: manifest.id }]);
  assert.equal(box.json(['artifact', 'list', '--workspace', 'demo']).length, 1);
  assert.equal(box.json(['artifact', 'list', '--workspace', 'standalone']).length, 1);
  assert.equal(box.hws(['artifact', 'list', '--workspace', 'nope']).code, 1);
});

test('link prints the prompt reference', (t) => {
  const box = sandbox(t);
  const { artifact } = box.finishGlued(box.app());
  assert.equal(box.hws(['link', artifact.id]).stdout, `@${artifact.prompt}\n`);
  assert.deepEqual(box.json(['link', artifact.id]), { link: `@${artifact.prompt}` });
  assert.equal(box.hws(['link', 'nope']).code, 1);
  assert.equal(box.hws(['link']).code, 2);
});

test('link quotes a prompt path with spaces', (t) => {
  const box = sandbox(t);
  const { artifact } = box.finishGlued(box.app('my demo'));
  assert.match(box.hws(['link', artifact.id]).stdout, /^@"[^"]* [^"]*\/prompt\.md"\n$/);
});

test('artifact terminal opens claude with the prompt in the workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { artifact } = box.finishGlued(manifest);
  box.json(['artifact', 'terminal', artifact.id]);
  assert.deepEqual(box.actions(), [[
    'herdr-app', 'do', 'tab.new', '--name', 'flow', '--space', manifest.id, '--folder', manifest.folder,
    '--argv', '["claude"]', '--task', `@${artifact.prompt}`,
  ]]);
});

test('artifact terminal opens a standalone artifact in the selected space from home', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])], selected: 'sp1' });
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'idea', '--standalone']);
  const { artifact } = box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('b')]);
  box.clearCalls();
  box.json(['artifact', 'terminal', artifact]);
  const prompt = join(box.root, 'standalone', 'artifacts', artifact, 'prompt.md');
  assert.deepEqual(box.actions(), [[
    'herdr-app', 'do', 'tab.new', '--name', 'idea', '--folder', box.homeDir,
    '--argv', '["claude"]', '--task', `@${prompt}`,
  ]]);
});

// Statuses and registered files

test('artifact set changes the status and supersedes, and checks both', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const first = box.finishGlued(manifest).artifact;
  const second = box.finishGlued(manifest).artifact;

  const result = box.json(['artifact', 'set', first.id, '--status', 'superseded']);
  assert.equal(result.status, 'superseded');
  assert.equal(result.workspace, manifest.id);
  box.json(['artifact', 'set', second.id, '--status', 'current', '--supersedes', first.id]);

  const records = box.manifest(manifest.id).artifacts;
  assert.deepEqual(records.map(({ id, status, supersedes }) => [id, status, supersedes ?? null]), [[first.id, 'superseded', null], [second.id, 'current', first.id]]);

  box.json(['artifact', 'set', second.id, '--supersedes', '']);
  assert.equal(box.manifest(manifest.id).artifacts[1].supersedes, null);

  assert.equal(box.hws(['artifact', 'set', first.id, '--status', 'old']).code, 2);
  assert.equal(box.hws(['artifact', 'set', first.id]).code, 2);
  assert.equal(box.hws(['artifact', 'set', 'nope', '--status', 'draft']).code, 1);
  assert.match(box.hws(['artifact', 'set', first.id, '--supersedes', first.id]).stderr, /cannot supersede itself/);
  assert.match(box.hws(['artifact', 'set', first.id, '--supersedes', 'azzzzz']).stderr, /no artifact azzzzz/);
});

test('artifact add moves a file under the artifacts place and records it like Done', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const source = join(manifest.folder, 'spec.md');
  writeFileSync(source, 'spec');
  const before = Date.now();

  const result = box.json(['artifact', 'add', '--file', source, '--title', 'The spec', '--workspace', manifest.id], { HC_TERMINAL_ID: 't5' });

  const place = box.json(['place', 'artifacts', '--workspace', manifest.id]).path;
  const path = join(place, 'spec.md');
  assert.equal(existsSync(source), false);
  assert.equal(readFileSync(path, 'utf8'), 'spec');
  const record = box.manifest(manifest.id).artifacts.at(-1);
  assert.deepEqual(result, { ...record, workspace: manifest.id });
  assert.deepEqual({ ...record, id: typeof record.id, createdAt: record.createdAt >= before }, {
    id: 'string', type: 'file', title: 'The spec', path, prompt: path, fromTerminal: 't5', createdAt: true, status: 'current', supersedes: null,
  });
  assert.match(record.id, /^a[0-9a-f]{6}$/);
  assert.equal(box.hws(['link', record.id]).stdout, `@${path}\n`);
});

test('artifact add leaves a file already in the place and never replaces one', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['set', '--workspace', manifest.id, '--place', 'artifacts=docs']);
  const docs = box.folder(join('demo', 'docs'));
  writeFileSync(join(docs, 'brief.md'), 'brief');

  const kept = box.json(['artifact', 'add', '--file', join(docs, 'brief.md'), '--workspace', manifest.id]);
  assert.equal(kept.path, join(docs, 'brief.md'));
  assert.equal(kept.title, 'brief.md');

  const other = join(box.folder('elsewhere'), 'brief.md');
  writeFileSync(other, 'another brief');
  const clash = box.hws(['artifact', 'add', '--file', other, '--workspace', manifest.id]);
  assert.equal(clash.code, 1);
  assert.match(clash.stderr, /already exists/);
  assert.equal(readFileSync(join(docs, 'brief.md'), 'utf8'), 'brief');
  assert.equal(existsSync(other), true);
  assert.equal(box.hws(['artifact', 'add', '--file', join(docs, 'none.md'), '--workspace', manifest.id]).code, 1);
});

test('artifact add refuses to move a file into a place another writer owns', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['set', '--workspace', manifest.id, '--place', 'artifacts=docs', '--writer', 'artifacts=pmos']);
  const source = join(manifest.folder, 'spec.md');
  writeFileSync(source, 'spec');

  const result = box.hws(['artifact', 'add', '--file', source, '--workspace', manifest.id]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /belongs to pmos/);
  assert.equal(existsSync(source), true);
  assert.equal(box.manifest(manifest.id).artifacts.length, 0);
});
