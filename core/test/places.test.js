import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { sandbox } from './helpers.js';

const ownDir = (manifest) => join(manifest.folder, '.herdr-workspace', `${manifest.name}-${manifest.id.slice(-6)}`);

function placeText(box, manifest, role) {
  const result = box.hws(['place', role, '--workspace', manifest.id]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}

test('a kept workspace takes the default places', (t) => {
  const box = sandbox(t);
  const manifest = box.app();

  assert.equal(placeText(box, manifest, 'current'), join(ownDir(manifest), 'CURRENT.md'));
  assert.equal(placeText(box, manifest, 'artifacts'), join(ownDir(manifest), 'artifacts'));
  assert.equal(placeText(box, manifest, 'scratch'), join(ownDir(manifest), 'scratch'));
  for (const role of ['decisions', 'history']) assert.equal(placeText(box, manifest, role), join(ownDir(manifest), role));
  assert.equal(placeText(box, manifest, 'meetings'), '');
  assert.deepEqual(box.json(['place', 'meetings', '--workspace', manifest.id]), { role: 'meetings', path: null, writer: null });
});

test('place creates only the scratch and artifacts folders', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['set', '--workspace', manifest.id, '--place', 'decisions=log', '--place', 'current=notes/CURRENT.md']);

  placeText(box, manifest, 'scratch');
  placeText(box, manifest, 'artifacts');
  placeText(box, manifest, 'decisions');
  placeText(box, manifest, 'current');

  assert.equal(existsSync(join(ownDir(manifest), 'scratch')), true);
  assert.equal(existsSync(join(ownDir(manifest), 'artifacts')), true);
  assert.equal(existsSync(join(manifest.folder, 'log')), false);
  assert.equal(existsSync(join(manifest.folder, 'notes')), false);
});

test('set records places relative to the folder, absolute or under home', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const elsewhere = box.folder('elsewhere');

  const updated = box.json([
    'set', '--workspace', manifest.id,
    '--place', 'current=docs/NEXT-STEPS.md',
    '--place', `history=${elsewhere}`,
    '--place', 'meetings=~/Meetings',
  ]);

  assert.deepEqual(updated.places, { current: 'docs/NEXT-STEPS.md', history: elsewhere, meetings: '~/Meetings' });
  assert.equal(placeText(box, manifest, 'current'), join(manifest.folder, 'docs', 'NEXT-STEPS.md'));
  assert.equal(placeText(box, manifest, 'history'), elsewhere);
  assert.equal(placeText(box, manifest, 'meetings'), join(box.homeDir, 'Meetings'));
});

test('changing a place moves no files and an empty value restores the default', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const oldPlace = placeText(box, manifest, 'artifacts');
  writeFileSync(join(oldPlace, 'keep.md'), 'old work');

  box.json(['set', '--workspace', manifest.id, '--place', 'artifacts=docs']);
  assert.equal(placeText(box, manifest, 'artifacts'), join(manifest.folder, 'docs'));
  assert.equal(existsSync(join(oldPlace, 'keep.md')), true);
  assert.equal(existsSync(join(manifest.folder, 'docs', 'keep.md')), false);

  const cleared = box.json(['set', '--workspace', manifest.id, '--place', 'artifacts=']);
  assert.equal(cleared.places, undefined);
  assert.equal(placeText(box, manifest, 'artifacts'), oldPlace);
});

test('settings.json places are the default map for kept workspaces only', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const scrap = box.throwaway();
  writeFileSync(join(box.root, 'settings.json'), JSON.stringify({ places: { current: 'NOTES.md', scratch: 'work/drafts', meetings: { path: 'calls' } } }));

  assert.equal(placeText(box, manifest, 'current'), join(manifest.folder, 'NOTES.md'));
  assert.equal(placeText(box, manifest, 'scratch'), join(manifest.folder, 'work', 'drafts'));
  assert.equal(placeText(box, manifest, 'meetings'), join(manifest.folder, 'calls'));
  assert.equal(placeText(box, manifest, 'artifacts'), join(ownDir(manifest), 'artifacts'));

  box.json(['set', '--workspace', manifest.id, '--place', 'current=docs/CURRENT.md']);
  assert.equal(placeText(box, manifest, 'current'), join(manifest.folder, 'docs', 'CURRENT.md'));

  assert.equal(placeText(box, scrap, 'current'), '');
  assert.equal(placeText(box, scrap, 'scratch'), join(box.root, 'workspaces', scrap.id, 'scratch'));
  assert.equal(placeText(box, scrap, 'artifacts'), join(box.root, 'workspaces', scrap.id, 'artifacts'));
});

test('a place with another writer is read and never written', (t) => {
  const box = sandbox(t);
  const manifest = box.app();

  assert.equal(box.hws(['set', '--workspace', manifest.id, '--writer', 'decisions=pmos']).code, 1);

  const updated = box.json(['set', '--workspace', manifest.id, '--place', 'decisions=decisions', '--writer', 'decisions=pmos', '--place', 'artifacts=out', '--writer', 'artifacts=pmos']);
  assert.deepEqual(updated.places, { decisions: { path: 'decisions', writer: 'pmos' }, artifacts: { path: 'out', writer: 'pmos' } });
  assert.deepEqual(box.json(['place', 'decisions', '--workspace', manifest.id]), { role: 'decisions', path: join(manifest.folder, 'decisions'), writer: 'pmos' });

  assert.equal(placeText(box, manifest, 'artifacts'), join(manifest.folder, 'out'));
  assert.equal(existsSync(join(manifest.folder, 'out')), false);

  const terminal = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'flow', '--terminal', terminal]);
  const bundle = box.bundle('bundle-refused');
  const refused = box.hws(['surface', 'done', '--id', surface.id, '--bundle', bundle]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /belongs to pmos/);
  assert.equal(existsSync(join(bundle, 'prompt.md')), true);
  assert.deepEqual(box.manifest(manifest.id).artifacts, []);

  const moved = box.json(['set', '--workspace', manifest.id, '--place', 'decisions=log']);
  assert.deepEqual(moved.places.decisions, { path: 'log', writer: 'pmos' });
  const freed = box.json(['set', '--workspace', manifest.id, '--writer', 'artifacts=hws']);
  assert.equal(freed.places.artifacts, 'out');
});

test('set records the stage and rejects unknown roles, stages and fixed kinds', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const scrap = box.throwaway();

  assert.equal(box.json(['set', '--workspace', manifest.id, '--stage', 'building']).stage, 'building');
  assert.equal(box.hws(['set', '--workspace', manifest.id, '--stage', 'shipping']).code, 2);
  assert.equal(box.hws(['set', '--workspace', manifest.id, '--place', 'memos=docs']).code, 2);
  assert.equal(box.hws(['set', '--workspace', manifest.id, '--place', 'artifacts']).code, 2);
  assert.equal(box.hws(['place', 'memos', '--workspace', manifest.id]).code, 2);
  assert.equal(box.hws(['place', '--workspace', manifest.id]).code, 2);
  assert.equal(box.manifest(manifest.id).stage, 'building');

  assert.equal(box.hws(['set', '--workspace', scrap.id, '--place', 'artifacts=docs']).code, 1);
  assert.equal(box.json(['set', '--workspace', scrap.id, '--stage', 'discovery']).stage, 'discovery');
});

test('done lands a kept bundle in a custom artifacts place with status current', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['set', '--workspace', manifest.id, '--place', 'artifacts=docs/outputs']);

  const { artifact, done } = box.finishGlued(manifest);

  const expected = join(manifest.folder, 'docs', 'outputs', `flow-${artifact.id}`);
  assert.equal(done.artifact, artifact.id);
  assert.equal(artifact.path, expected);
  assert.equal(artifact.prompt, join(expected, 'prompt.md'));
  assert.equal(artifact.status, 'current');
  assert.equal(existsSync(join(expected, 'images', 'shot.png')), true);
});

test('an artifact recorded without a status reads as current', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { artifact } = box.finishGlued(manifest);
  box.rewriteManifest(manifest.id, (raw) => ({ ...raw, artifacts: raw.artifacts.map(({ status, ...rest }) => rest) }));
  assert.equal(box.manifest(manifest.id).artifacts[0].status, undefined);

  const listed = box.json(['list']).find((item) => item.id === manifest.id);
  assert.equal(listed.artifacts.find((item) => item.id === artifact.id).status, 'current');
});

test('done still lands a default kept bundle under the workspace folder', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  mkdirSync(join(manifest.folder, 'docs'));
  const { artifact } = box.finishGlued(manifest);
  assert.equal(artifact.path, join(ownDir(manifest), 'artifacts', `flow-${artifact.id}`));
  assert.equal(artifact.status, 'current');
});

test('workspaces sharing a folder each keep their own current note', (t) => {
  const box = sandbox(t);
  const first = box.app();
  const second = box.json(['new', 'workspace', '--name', 'other', '--folder', first.folder, '--kind', 'app']);

  const notes = [placeText(box, first, 'current'), placeText(box, second, 'current')];
  assert.equal(notes[0], join(ownDir(first), 'CURRENT.md'));
  assert.notEqual(notes[0], notes[1]);
});

test('the latest tidier keeps a shared CURRENT.md and the others start over', (t) => {
  const box = sandbox(t);
  const first = box.app();
  const second = box.json(['new', 'workspace', '--name', 'other', '--folder', first.folder, '--kind', 'app']);
  const third = box.json(['new', 'workspace', '--name', 'fresh', '--folder', first.folder, '--kind', 'app']);
  writeFileSync(join(first.folder, 'CURRENT.md'), '# Shared\n');
  box.rewriteManifest(first.id, (raw) => ({ ...raw, current: { tidiedAt: 1000, covers: {} } }));
  box.rewriteManifest(second.id, (raw) => ({ ...raw, current: { tidiedAt: 2000, covers: {} } }));

  box.hws(['list']);

  assert.equal(placeText(box, second, 'current'), join(first.folder, 'CURRENT.md'));
  assert.equal(box.manifest(second.id).current.tidiedAt, 2000);
  assert.equal(placeText(box, first, 'current'), join(ownDir(first), 'CURRENT.md'));
  assert.equal(box.manifest(first.id).current, undefined);
  assert.equal(box.manifest(third.id).places, undefined);
  assert.equal(existsSync(join(first.folder, 'CURRENT.md')), true);
});
