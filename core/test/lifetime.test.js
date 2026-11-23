import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { liveFixtures, sandbox } from './helpers.js';

const { space, tab, terminal } = liveFixtures;
const DAY_MS = 24 * 60 * 60 * 1000;

const dataOf = (box, workspaceId, surfaceId) => join(box.root, 'workspaces', workspaceId, 'surfaces', surfaceId);
const ownDir = (manifest) => join(manifest.folder, '.herdr-workspace', `${manifest.name}-${manifest.id.slice(-6)}`);
const hostEnvOf = (call) => Object.fromEntries(call.filter((word) => /^[A-Z_]+=/.test(word)).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));

function openWindow(t) {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--title', 'flow', '--terminal', owner]);
  return { box, manifest, owner, surface };
}

function draw(box, workspaceId, surfaceId, name = 'flow') {
  const boards = join(dataOf(box, workspaceId, surfaceId), 'boards');
  mkdirSync(boards, { recursive: true });
  writeFileSync(join(boards, `${name}.excalidraw`), JSON.stringify({ type: 'excalidraw', elements: [{ id: 'a' }] }));
  writeFileSync(join(boards, `${name}.comments.json`), JSON.stringify({ overall: 'Bigger.', pins: [] }));
}

const surfaceOf = (box, manifest, id) => box.manifest(manifest.id).surfaces.find((item) => item.id === id);
const artifactOf = (box, manifest, id) => box.manifest(manifest.id).artifacts.find((item) => item.id === id);

// Moves every expiresAt in a manifest into the past.
function age(box, workspaceId) {
  box.rewriteManifest(workspaceId, (raw) => ({
    ...raw,
    surfaces: raw.surfaces.map((item) => (item.expiresAt ? { ...item, expiresAt: 1 } : item)),
    artifacts: raw.artifacts.map((item) => (item.expiresAt ? { ...item, expiresAt: 1 } : item)),
  }));
}

test('save marks a surface, outlives a reopening and reaches the host', (t) => {
  const { box, manifest, owner, surface } = openWindow(t);
  assert.deepEqual(box.json(['surface', 'save', '--id', surface.id]), { id: surface.id, saved: true, workspace: manifest.id });
  assert.equal(surfaceOf(box, manifest, surface.id).saved, true);

  box.setState({ hc: { t90: 'missing' } });
  box.clearCalls();
  box.json(['surface', 'resume', '--id', surface.id]);
  assert.equal(surfaceOf(box, manifest, surface.id).saved, true);
  assert.equal(hostEnvOf(box.actions().find((call) => call[1] === 'run')).HWS_SURFACE_SAVED, '1');

  const file = join(manifest.folder, 'spec.md');
  writeFileSync(file, '# Spec');
  const note = box.json(['surface', 'open', '--type', 'note', '--file', file, '--terminal', owner]);
  box.json(['surface', 'save', '--id', note.id]);
  box.setState({ hc: { t90: 'missing' } });
  box.json(['surface', 'open', '--type', 'note', '--file', file, '--terminal', owner]);
  assert.equal(surfaceOf(box, manifest, note.id).saved, true);

  assert.deepEqual(box.json(['surface', 'save', '--id', note.id, '--off']).saved, false);
  assert.equal(surfaceOf(box, manifest, note.id).saved, undefined);
});

test('save refuses questions, and an unfiled surface needs a workspace it then moves to', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const questions = join(box.dir, 'q.json');
  writeFileSync(questions, JSON.stringify([{ id: 'a', text: 'Why?', kind: 'text' }]));
  const round = box.json(['ask', '--file', questions, '--terminal', owner, '--window']);
  assert.equal(box.hws(['surface', 'save', '--id', round.id]).code, 1);

  box.setState({ spaces: [...box.state().spaces, space('sp9', [tab('tb9', [terminal('t9', 'p9')])])], selected: 'sp9' });
  const loose = box.json(['surface', 'open', '--type', 'board', '--title', 'idea', '--standalone']);
  assert.equal(box.hws(['surface', 'save', '--id', loose.id]).code, 2);
  box.clearCalls();
  assert.deepEqual(box.json(['surface', 'save', '--id', loose.id, '--workspace', manifest.id]), { id: loose.id, saved: true, workspace: manifest.id });
  assert.equal(hostEnvOf(box.actions().find((call) => call[1] === 'run')).HWS_SURFACE_SAVED, '1');
  assert.equal(surfaceOf(box, manifest, loose.id).saved, true);
  assert.equal(box.manifest('standalone').surfaces.some((item) => item.id === loose.id), false);
});

test('done files kept work from a saved surface and a round-trip from any other', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const kept = box.finishGlued(manifest, undefined, { save: true }).artifact;
  const round = box.finishGlued(manifest).artifact;

  assert.deepEqual([kept.path, kept.transient], [join(ownDir(manifest), 'artifacts', `flow-${kept.id}`), undefined]);
  assert.deepEqual([round.path, round.transient], [join(box.root, 'workspaces', manifest.id, 'artifacts', round.id), true]);
  assert.deepEqual(box.json(['artifact', 'scan', '--workspace', manifest.id]).tracked.map((item) => item.id), [kept.id]);
});

test('an unsaved closed draft waits once its owner ends, comes back with its owner, then goes to the Trash', (t) => {
  const { box, manifest, owner, surface } = openWindow(t);
  draw(box, manifest.id, surface.id);
  box.setState({ hc: { t90: 'missing', [owner]: 'missing' } });

  const before = Date.now();
  box.json(['prune']);
  const waiting = surfaceOf(box, manifest, surface.id).expiresAt;
  assert.ok(waiting >= before + 7 * DAY_MS && waiting <= Date.now() + 7 * DAY_MS);
  assert.equal(box.json(['surface', 'list'])[0].expiresAt, waiting);

  box.setState({ hc: { t90: 'missing' } });
  box.json(['prune']);
  assert.equal(surfaceOf(box, manifest, surface.id).expiresAt, undefined);

  box.setState({ hc: { t90: 'missing', [owner]: 'missing' } });
  box.json(['prune']);
  age(box, manifest.id);
  box.json(['prune']);
  assert.equal(surfaceOf(box, manifest, surface.id), undefined);
  assert.equal(existsSync(dataOf(box, manifest.id, surface.id)), false);
  assert.ok(readdirSync(box.trashDir).some((name) => name.endsWith(surface.id)));
});

test('recentDays in settings sets how long unheld work waits', (t) => {
  const { box, manifest, owner, surface } = openWindow(t);
  writeFileSync(join(box.root, 'settings.json'), JSON.stringify({ recentDays: 2 }));
  draw(box, manifest.id, surface.id);
  box.setState({ hc: { t90: 'missing', [owner]: 'missing' } });
  box.json(['prune']);
  assert.ok(surfaceOf(box, manifest, surface.id).expiresAt <= Date.now() + 2 * DAY_MS);
});

test('a saved surface whose owner ends gets a home in the workspace folder', (t) => {
  const { box, manifest, owner, surface } = openWindow(t);
  box.json(['surface', 'save', '--id', surface.id]);
  draw(box, manifest.id, surface.id);
  const drafts = join(dataOf(box, manifest.id, surface.id), 'drafts');
  mkdirSync(drafts, { recursive: true });
  writeFileSync(join(drafts, 'd1.json'), JSON.stringify({ id: 'd1', title: 'Launch notes', body: 'Ship Friday.' }));
  writeFileSync(join(drafts, 'd2.json'), JSON.stringify({ id: 'd2', body: '   ' }));

  box.setState({ hc: { t90: 'missing' } });
  box.json(['prune']);
  assert.equal(surfaceOf(box, manifest, surface.id).saved, true);

  box.setState({ hc: { t90: 'missing', [owner]: 'missing' } });
  box.json(['prune']);

  const after = box.manifest(manifest.id);
  assert.deepEqual(after.surfaces, []);
  const board = after.artifacts.find((item) => item.type === 'board');
  assert.equal(board.path, join(ownDir(manifest), 'artifacts', `flow-${board.id}`));
  assert.equal(board.transient, undefined);
  assert.ok(existsSync(join(board.path, 'board.excalidraw')));
  assert.ok(existsSync(join(board.path, 'comments.json')));
  assert.match(readFileSync(board.prompt, 'utf8'), /^Sketch "flow", saved from Herdr\./);
  const note = after.artifacts.find((item) => item.type === 'file');
  assert.equal(note.path, join(ownDir(manifest), 'artifacts', 'launch-notes.md'));
  assert.equal(readFileSync(note.path, 'utf8'), '# Launch notes\n\nShip Friday.\n');
  assert.equal(after.artifacts.length, 2);
  assert.equal(existsSync(dataOf(box, manifest.id, surface.id)), false);
});

test('a round-trip waits once its terminal ends, then goes to the Trash, and kept work stays', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const kept = box.finishGlued(manifest, undefined, { save: true }).artifact;
  const round = box.finishGlued(manifest).artifact;

  box.json(['prune']);
  assert.equal(artifactOf(box, manifest, round.id).expiresAt, undefined);

  box.setState({ hc: { [owner]: 'missing' } });
  box.json(['prune']);
  assert.ok(artifactOf(box, manifest, round.id).expiresAt > Date.now());
  assert.ok(box.json(['unfiled']));

  age(box, manifest.id);
  box.json(['prune']);
  assert.equal(artifactOf(box, manifest, round.id), undefined);
  assert.equal(existsSync(round.path), false);
  assert.ok(readdirSync(box.trashDir).some((name) => name.endsWith(round.id)));
  assert.ok(existsSync(artifactOf(box, manifest, kept.id).path));
});

test('a round-trip outside the state root becomes kept work instead of expiring', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const kept = box.finishGlued(manifest, undefined, { save: true }).artifact;
  box.rewriteManifest(manifest.id, (raw) => ({ ...raw, artifacts: raw.artifacts.map((item) => ({ ...item, transient: true })) }));
  box.setState({ hc: { [owner]: 'missing' } });
  box.json(['prune']);
  const after = artifactOf(box, manifest, kept.id);
  assert.deepEqual([after.transient, after.expiresAt], [undefined, undefined]);
});

test('keep moves a round-trip into the workspace folder and points its prompt there', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const round = box.finishGlued(manifest).artifact;
  const kept = box.json(['artifact', 'keep', round.id]);

  const home = join(ownDir(manifest), 'artifacts', `flow-${round.id}`);
  assert.deepEqual([kept.path, kept.prompt, kept.transient], [home, join(home, 'prompt.md'), undefined]);
  assert.equal(existsSync(round.path), false);
  assert.ok(readFileSync(kept.prompt, 'utf8').includes(`${home}/images/shot.png`));
  assert.equal(artifactOf(box, manifest, round.id).transient, undefined);
});

test('unfiled lists an empty window with a live owner as a draft, and a round-trip, with their lifetime fields', (t) => {
  const box = sandbox(t);
  box.app();
  box.setState({ spaces: [...box.state().spaces, space('sp9', [tab('tb9', [terminal('t9', 'p9')])])], selected: 'sp9' });
  const loose = box.json(['surface', 'open', '--type', 'board', '--title', 'idea', '--terminal', 't9']);
  box.setState({ hc: { t90: 'missing' } });
  const parked = box.json(['unfiled']).surfaces.find((item) => item.id === loose.id);
  assert.deepEqual([parked.state, parked.saved, parked.expiresAt], ['draft', false, null]);

  const pane = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'flow', '--standalone']);
  box.json(['surface', 'done', '--id', pane.id, '--bundle', box.bundle('bundle-loose')]);
  const [artifact] = box.json(['unfiled']).artifacts;
  assert.deepEqual([artifact.transient, artifact.expiresAt], [true, null]);
});
