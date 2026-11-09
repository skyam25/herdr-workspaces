import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { sandbox } from './helpers.js';

const URL = 'https://claude.ai/artifact/85fk8RpFLjhf';

// A workspace whose README links a neighbouring project and a live artifact.
function project(box) {
  const manifest = box.app();
  const neighbour = join(box.dir, 'cert');
  mkdirSync(neighbour);
  writeFileSync(join(neighbour, 'plan.html'), '<h1>Plan</h1>');
  writeFileSync(join(manifest.folder, 'story.html'), '<h1>Story</h1>');
  writeFileSync(join(manifest.folder, 'deck.pptx'), 'deck');
  writeFileSync(join(manifest.folder, 'story.html.feedback.md'), 'log');
  writeFileSync(join(manifest.folder, 'README.md'), `[Cert plan](${join('..', 'cert', 'plan.html')})\n[Live story](${URL})\n[Gone](missing.html)\n`);
  return { manifest, plan: join(neighbour, 'plan.html') };
}

test('--in-place leaves the file where it is and repeats return the first record', (t) => {
  const box = sandbox(t);
  const { manifest, plan } = project(box);

  const first = box.json(['artifact', 'add', '--file', plan, '--in-place', '--title', 'Plan', '--workspace', manifest.id]);
  const again = box.json(['artifact', 'add', '--file', plan, '--in-place', '--workspace', manifest.id]);

  assert.ok(existsSync(plan));
  assert.equal(first.inPlace, true);
  assert.equal(first.path, plan);
  assert.equal(again.id, first.id);
  assert.equal(again.existing, true);
  assert.equal(box.manifest(manifest.id).artifacts.length, 1);
});

test('--url records a link that reaches the tidy packet', (t) => {
  const box = sandbox(t);
  const { manifest } = project(box);

  const link = box.json(['artifact', 'add', '--url', URL, '--title', 'Live story', '--workspace', manifest.id]);
  const started = box.json(['tidy', 'status', '--workspace', manifest.id]);

  assert.equal(link.type, 'link');
  assert.equal(link.url, URL);
  assert.equal(link.path, URL);
  assert.equal(started.behind.artifacts, 1);
  assert.equal(box.json(['link', link.id]).link, URL);
});

test('--url needs a web address and a kept workspace', (t) => {
  const box = sandbox(t);
  const { manifest } = project(box);

  assert.notEqual(box.hws(['artifact', 'add', '--url', 'plan.html', '--workspace', manifest.id]).code, 0);
  assert.notEqual(box.hws(['artifact', 'add', '--url', URL, '--file', 'x', '--workspace', manifest.id]).code, 0);
  const throwaway = box.throwaway();
  assert.notEqual(box.hws(['artifact', 'add', '--url', URL, '--workspace', throwaway.id]).code, 0);
});

test('scan finds folder outputs, linked files and web documents, and leaves out what is tracked', (t) => {
  const box = sandbox(t);
  const { manifest, plan } = project(box);

  const first = box.json(['artifact', 'scan', '--workspace', manifest.id]);
  const paths = first.candidates.filter((item) => item.kind === 'file').map((item) => item.path);
  const web = first.candidates.filter((item) => item.kind === 'link');

  assert.deepEqual(paths.sort(), [plan, join(manifest.folder, 'deck.pptx'), join(manifest.folder, 'story.html')].sort());
  assert.deepEqual(web.map((item) => [item.url, item.title, item.foundIn]), [[URL, 'Live story', 'README.md']]);
  assert.equal(first.candidates.find((item) => item.path === plan).origin, 'linked');

  box.json(['artifact', 'add', '--file', plan, '--in-place', '--workspace', manifest.id]);
  box.json(['artifact', 'add', '--url', URL, '--workspace', manifest.id]);
  const second = box.json(['artifact', 'scan', '--workspace', manifest.id]);

  assert.equal(second.tracked.length, 2);
  assert.deepEqual(second.candidates.map((item) => item.path).sort(), [join(manifest.folder, 'deck.pptx'), join(manifest.folder, 'story.html')].sort());
});

test('a throwaway has nothing to scan', (t) => {
  const box = sandbox(t);
  assert.deepEqual(box.json(['artifact', 'scan', '--workspace', box.throwaway().id]).candidates, []);
});
