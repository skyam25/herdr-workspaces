import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { sandbox } from './helpers.js';

const DAYS_31 = 31 * 24 * 3600_000;

const retiredFile = (box, id) => join(box.root, 'retired', `${id}.json`);
const readRecord = (box, id) => JSON.parse(readFileSync(retiredFile(box, id), 'utf8'));
const scratchOf = (box, id) => join(box.root, 'workspaces', id, 'scratch');

function writeScratch(box, manifest, name = 'notes.md', text = 'draft') {
  const path = join(manifest.folder, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return path;
}

// Closes the throwaway's space outside hws, so the next prune retires it.
function closeOutside(box) {
  box.setState({ spaces: [{ id: 'sp-other', name: 'o', folder: '/', tabs: [] }] });
  box.json(['prune']);
}

function backdate(box, id) {
  const path = retiredFile(box, id);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), closedAt: Date.now() - DAYS_31 }));
}

test('a throwaway lives in its scratch place, and later tabs and spaces start there', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  assert.equal(manifest.folder, scratchOf(box, manifest.id));
  assert.equal(box.json(['place', 'scratch', '--workspace', manifest.id]).path, manifest.folder);

  box.json(['space', 'add', '--workspace', manifest.id]);
  const added = box.actions().find((call) => call[2] === 'space.new');
  assert.equal(added[added.indexOf('--folder') + 1], manifest.folder);
});

test('the retired record keeps the scratch path', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  box.transcript(manifest, 'sess');
  box.json(['close', '--workspace', manifest.id]);
  assert.equal(readRecord(box, manifest.id).scratch, manifest.folder);
});

test('scratch files alone keep a record, and the files stay', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const notes = writeScratch(box, manifest, 'deep/notes.md');
  closeOutside(box);
  const record = readRecord(box, manifest.id);
  assert.deepEqual([record.sessions, record.artifacts, record.scratch], [[], [], manifest.folder]);
  assert.equal(readFileSync(notes, 'utf8'), 'draft');
  assert.equal(existsSync(join(box.root, 'workspaces', manifest.id, 'workspace.json')), false);
});

test('an empty scratch folder and nothing else leaves no record and no folder', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  mkdirSync(join(manifest.folder, 'empty'));
  closeOutside(box);
  assert.equal(existsSync(retiredFile(box, manifest.id)), false);
  assert.equal(existsSync(join(box.root, 'workspaces', manifest.id)), false);
});

test('purge sends the scratch folder to the Trash with the artifacts', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const { artifact } = box.finishGlued(manifest);
  writeScratch(box, manifest);
  closeOutside(box);
  box.app('other');
  backdate(box, manifest.id);
  box.clearCalls();

  box.json(['prune']);

  assert.deepEqual(box.actions().filter((call) => call[0] === 'trash'), [['trash', artifact.path, manifest.folder]]);
  assert.equal(readFileSync(join(box.trashDir, '1-scratch', 'notes.md'), 'utf8'), 'draft');
  assert.equal(existsSync(retiredFile(box, manifest.id)), false);
  assert.equal(existsSync(join(box.root, 'workspaces', manifest.id)), false);
});

test('close asks before closing a throwaway with only scratch files', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  writeScratch(box, manifest);
  const result = box.json(['close', '--workspace', manifest.id]);
  assert.deepEqual(result, { decision: 'needed', artifacts: [], scratch: manifest.folder });
  assert.deepEqual(box.actions(), []);
  assert.ok(box.manifest(manifest.id));
});

test('close --trash sends the scratch folder to the Trash and leaves no record', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  writeScratch(box, manifest);
  box.transcript(manifest, 'sess');
  box.json(['close', '--workspace', manifest.id, '--trash']);
  assert.deepEqual(box.actions()[0], ['trash', manifest.folder]);
  assert.ok(existsSync(join(box.trashDir, '0-scratch', 'notes.md')));
  assert.equal(existsSync(retiredFile(box, manifest.id)), false);
  assert.equal(existsSync(join(box.root, 'workspaces', manifest.id)), false);
});

test('close --keep moves the scratch folder to Documents, and purge leaves it there', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway('quick');
  writeScratch(box, manifest);
  const kept = join(box.homeDir, 'Documents', 'Herdr Workspaces', 'quick', `scratch-${manifest.id.slice(-6)}`);

  const result = box.json(['close', '--workspace', manifest.id, '--keep']);

  assert.deepEqual(result.kept, [kept]);
  assert.equal(readFileSync(join(kept, 'notes.md'), 'utf8'), 'draft');
  assert.equal(readRecord(box, manifest.id).scratch, kept);
  assert.equal(existsSync(join(box.root, 'workspaces', manifest.id)), false);

  box.app('other');
  backdate(box, manifest.id);
  box.json(['prune']);
  assert.ok(existsSync(join(kept, 'notes.md')));
  assert.equal(existsSync(retiredFile(box, manifest.id)), false);
});

test('reopen starts in the old scratch folder, even after Keep moved it away', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway('quick');
  writeScratch(box, manifest);
  box.transcript(manifest, 'sess');
  box.json(['close', '--workspace', manifest.id, '--keep']);
  const kept = readRecord(box, manifest.id).scratch;
  box.clearCalls();

  const reopened = box.json(['reopen', manifest.id]);

  const opened = box.actions().find((call) => call[2] === 'space.new');
  assert.equal(opened[opened.indexOf('--folder') + 1], manifest.folder);
  assert.equal(reopened.folder, manifest.folder);
  assert.ok(existsSync(manifest.folder));
  assert.equal(box.json(['place', 'scratch', '--workspace', reopened.id]).path, kept);
});

test('promote moves scratch files and artifacts into the kept places', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const { artifact } = box.finishGlued(manifest);
  writeScratch(box, manifest, 'deep/notes.md');
  writeFileSync(join(box.root, 'settings.json'), JSON.stringify({ places: { artifacts: 'out/bundles' } }));
  const folder = box.folder('promoted');

  const result = box.json(['promote', '--name', 'real', '--folder', folder, '--kind', 'app', '--workspace', manifest.id]);

  const scratch = join(folder, '.herdr-workspace', `real-${manifest.id.slice(-6)}`, 'scratch');
  assert.equal(readFileSync(join(scratch, 'deep', 'notes.md'), 'utf8'), 'draft');
  assert.equal(result.artifacts[0].path, join(folder, 'out', 'bundles', artifact.id));
  assert.ok(existsSync(join(folder, 'out', 'bundles', artifact.id, 'prompt.md')));
  assert.equal(existsSync(artifact.path), false);
  assert.equal(existsSync(join(manifest.folder, 'deep')), false);
  assert.ok(existsSync(manifest.folder), 'the folder stays for the live shell');
  assert.equal(box.json(['place', 'scratch', '--workspace', manifest.id]).path, scratch);
});

test('promote refuses a kept place with another writer and moves nothing', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const notes = writeScratch(box, manifest);
  writeFileSync(join(box.root, 'settings.json'), JSON.stringify({ places: { scratch: { path: 'drafts', writer: 'pmos' } } }));
  const folder = box.folder('promoted');

  const result = box.hws(['promote', '--name', 'real', '--folder', folder, '--kind', 'app', '--workspace', manifest.id, '--json']);

  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).error, `the scratch place ${join(folder, 'drafts')} belongs to pmos, so hws does not write there`);
  assert.ok(existsSync(notes));
  assert.equal(box.manifest(manifest.id).kind, 'throwaway');
});

test('promote refuses a name the kept scratch place already holds', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const notes = writeScratch(box, manifest);
  writeFileSync(join(box.root, 'settings.json'), JSON.stringify({ places: { scratch: 'drafts' } }));
  const folder = box.folder('promoted');
  writeScratch(box, { folder: join(folder, 'drafts') }, 'notes.md', 'mine');

  const result = box.hws(['promote', '--name', 'real', '--folder', folder, '--kind', 'app', '--workspace', manifest.id, '--json']);

  assert.equal(result.code, 1);
  assert.match(JSON.parse(result.stdout).error, /already holds notes\.md/);
  assert.equal(readFileSync(notes, 'utf8'), 'draft');
  assert.equal(readFileSync(join(folder, 'drafts', 'notes.md'), 'utf8'), 'mine');
  assert.equal(box.manifest(manifest.id).kind, 'throwaway');
});
