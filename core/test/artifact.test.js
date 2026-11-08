import assert from 'node:assert/strict';
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
