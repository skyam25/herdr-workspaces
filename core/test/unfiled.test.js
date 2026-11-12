import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { liveFixtures, sandbox } from './helpers.js';

const { space, tab, terminal } = liveFixtures;

const surfaceData = (box, workspaceId, surfaceId) => join(box.root, 'workspaces', workspaceId, 'surfaces', surfaceId);
const runEnvOf = (call) => Object.fromEntries(call.slice(11, -1).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
const hcRuns = (box) => box.actions().filter((call) => call[0] === 'hc' && call[1] === 'run');

// A workspace, then a plain space selected beside it, so the launcher's surfaces go unfiled.
function unfiledBox(t) {
  const box = sandbox(t);
  const manifest = box.app();
  box.setState({ spaces: [...box.state().spaces, space('sp9', [tab('tb9', [terminal('t9', 'p9')])])], selected: 'sp9' });
  return { box, manifest };
}

function drawOn(box, workspaceId, surfaceId) {
  const boards = join(surfaceData(box, workspaceId, surfaceId), 'boards');
  mkdirSync(boards, { recursive: true });
  writeFileSync(join(boards, 'Sketch.excalidraw'), JSON.stringify({ elements: [{ id: 'a' }] }));
}

test('a window opened from a plain space is unfiled and its host has no workspace name', (t) => {
  const { box } = unfiledBox(t);
  const surface = box.json(['surface', 'open', '--type', 'board', '--title', 'idea', '--standalone']);
  assert.equal(surface.workspace, 'standalone');
  const environment = runEnvOf(hcRuns(box)[0]);
  assert.equal(environment.HWS_WORKSPACE_NAME, '');
  assert.deepEqual(box.json(['unfiled']).surfaces.map((item) => [item.id, item.state]), [[surface.id, 'open']]);
});

test('unfiled lists drafts and saved artifacts, newest first, and leaves out an empty closed window', (t) => {
  const { box } = unfiledBox(t);
  const empty = box.json(['surface', 'open', '--type', 'board', '--title', 'empty', '--standalone']);
  box.setState({ hc: { [empty.host]: 'missing' } });
  const kept = box.json(['surface', 'open', '--type', 'board', '--title', 'kept', '--standalone']);
  drawOn(box, 'standalone', kept.id);
  box.setState({ hc: { [empty.host]: 'missing', [kept.host]: 'missing' } });
  const note = box.json(['surface', 'open', '--type', 'note', '--in-pane', '--title', 'memo', '--standalone']);
  box.json(['surface', 'done', '--id', note.id, '--bundle', box.bundle('bundle-memo')]);

  const unfiled = box.json(['unfiled']);
  assert.deepEqual(unfiled.surfaces.map((item) => [item.title, item.state]), [['memo', 'pane'], ['kept', 'draft']]);
  assert.deepEqual(unfiled.artifacts.map((item) => item.title), ['memo']);
});

test('unfiled is empty before anything goes there', (t) => {
  const box = sandbox(t);
  assert.deepEqual(box.json(['unfiled']), { surfaces: [], artifacts: [] });
});

test('move takes a closed draft into a workspace with its data and links its drafts there', (t) => {
  const { box, manifest } = unfiledBox(t);
  const surface = box.json(['surface', 'open', '--type', 'note', '--title', 'plan', '--standalone']);
  const drafts = join(surfaceData(box, 'standalone', surface.id), 'drafts');
  mkdirSync(drafts, { recursive: true });
  writeFileSync(join(drafts, 'd1.json'), '{"body":"keep me"}');
  box.setState({ hc: { [surface.host]: 'missing' } });
  box.clearCalls();

  const result = box.json(['surface', 'move', '--id', surface.id, '--workspace', manifest.id]);

  assert.deepEqual(result, { id: surface.id, from: 'standalone', workspace: manifest.id, moved: true, restarted: false });
  assert.deepEqual(hcRuns(box), []);
  assert.deepEqual(box.manifest('standalone').surfaces, []);
  const [record] = box.manifest(manifest.id).surfaces;
  assert.equal(record.id, surface.id);
  const moved = surfaceData(box, manifest.id, surface.id);
  assert.equal(existsSync(surfaceData(box, 'standalone', surface.id)), false);
  assert.ok(lstatSync(join(moved, 'drafts')).isSymbolicLink());
  assert.equal(readFileSync(join(moved, 'drafts', 'd1.json'), 'utf8'), '{"body":"keep me"}');
  assert.deepEqual(box.json(['unfiled']).surfaces, []);
  assert.deepEqual(box.json(['surface', 'list']).map((item) => [item.id, item.workspace, item.open]), [[surface.id, manifest.id, false]]);
});

test('move ends an open window and starts it again in the new workspace', (t) => {
  const { box, manifest } = unfiledBox(t);
  const surface = box.json(['surface', 'open', '--type', 'board', '--title', 'idea', '--standalone']);
  drawOn(box, 'standalone', surface.id);
  box.clearCalls();

  const result = box.json(['surface', 'move', '--id', surface.id, '--workspace', manifest.name]);

  assert.equal(result.restarted, true);
  const actions = box.actions();
  assert.deepEqual(actions[0], ['hc', 'kill', surface.host]);
  const environment = runEnvOf(hcRuns(box)[0]);
  assert.equal(environment.HWS_WORKSPACE_ID, manifest.id);
  assert.equal(environment.HWS_WORKSPACE_NAME, manifest.name);
  assert.equal(environment.HWS_SURFACE_ID, surface.id);
  assert.equal(environment.COMPANION_DATA_DIR, surfaceData(box, manifest.id, surface.id));
  assert.ok(existsSync(join(environment.COMPANION_DATA_DIR, 'boards', 'Sketch.excalidraw')));
  const [record] = box.manifest(manifest.id).surfaces;
  assert.equal(record.host, 't90');
});

test('move can take a surface back out of its workspace', (t) => {
  const { box, manifest } = unfiledBox(t);
  box.setState({ selected: manifest.id });
  const surface = box.json(['surface', 'open', '--type', 'board', '--title', 'idea', '--standalone']);
  assert.equal(surface.workspace, manifest.id);
  drawOn(box, manifest.id, surface.id);
  box.setState({ hc: { [surface.host]: 'missing' } });

  box.json(['surface', 'move', '--id', surface.id, '--workspace', 'standalone']);

  assert.deepEqual(box.manifest(manifest.id).surfaces, []);
  assert.deepEqual(box.json(['unfiled']).surfaces.map((item) => [item.id, item.state]), [[surface.id, 'draft']]);
});

test('move refuses a pane, an archived workspace and an unknown one, and a same-place move changes nothing', (t) => {
  const { box, manifest } = unfiledBox(t);
  const pane = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--standalone']);
  assert.match(box.hws(['surface', 'move', '--id', pane.id, '--workspace', manifest.id]).stderr, /pop the surface out/);

  const window = box.json(['surface', 'open', '--type', 'board', '--title', 'w', '--standalone']);
  assert.notEqual(box.hws(['surface', 'move', '--id', window.id, '--workspace', 'nope']).code, 0);
  assert.equal(box.json(['surface', 'move', '--id', window.id, '--workspace', 'standalone']).moved, false);
  assert.equal(box.hws(['surface', 'move', '--id', window.id]).code, 2);

  box.rewriteManifest(manifest.id, (item) => ({ ...item, archived: { at: 1, spaces: [] } }));
  assert.match(box.hws(['surface', 'move', '--id', window.id, '--workspace', manifest.id]).stderr, /archived/);
  assert.equal(box.manifest('standalone').surfaces.length, 2);
});

test('targets suggests the workspace of the selected space and names the current one', (t) => {
  const { box, manifest } = unfiledBox(t);
  const surface = box.json(['surface', 'open', '--type', 'board', '--standalone']);
  const plain = box.json(['surface', 'targets', '--id', surface.id]);
  assert.deepEqual(plain, { current: 'standalone', suggested: null, workspaces: [{ id: manifest.id, name: manifest.name, kind: 'app' }] });

  box.setState({ selected: manifest.id });
  assert.equal(box.json(['surface', 'targets', '--id', surface.id]).suggested, manifest.id);
  box.json(['surface', 'move', '--id', surface.id, '--workspace', manifest.id]);
  assert.equal(box.json(['surface', 'targets', '--id', surface.id]).suggested, null);
});

test('artifact move files an unfiled bundle under the workspace and points its prompt there', (t) => {
  const { box, manifest } = unfiledBox(t);
  const note = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'Login flow', '--standalone']);
  box.json(['surface', 'done', '--id', note.id, '--bundle', box.bundle('bundle-flow')]);
  const [artifact] = box.manifest('standalone').artifacts;

  const moved = box.json(['artifact', 'move', artifact.id, '--workspace', manifest.id]);

  assert.equal(moved.moved, true);
  assert.deepEqual(box.manifest('standalone').artifacts, []);
  const [record] = box.manifest(manifest.id).artifacts;
  assert.equal(record.id, artifact.id);
  assert.match(record.path, new RegExp(`login-flow-${artifact.id}$`));
  assert.equal(existsSync(artifact.path), false);
  const prompt = readFileSync(record.prompt, 'utf8');
  assert.ok(prompt.includes(`${record.path}/images/shot.png`));
  assert.ok(!prompt.includes(artifact.path));
  assert.deepEqual(box.json(['unfiled']).artifacts, []);
});

test('artifact trash moves an unfiled bundle to the Trash and refuses a filed one', (t) => {
  const { box, manifest } = unfiledBox(t);
  const note = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--standalone']);
  box.json(['surface', 'done', '--id', note.id, '--bundle', box.bundle('bundle-a')]);
  const [first] = box.manifest('standalone').artifacts;
  box.json(['surface', 'done', '--id', note.id, '--bundle', box.bundle('bundle-b')]);
  const second = box.manifest('standalone').artifacts.find((item) => item.id !== first.id);

  assert.deepEqual(box.json(['artifact', 'trash', first.id]), { id: first.id, trashed: true });
  assert.equal(existsSync(first.path), false);
  assert.ok(readdirSync(box.trashDir).some((name) => name.endsWith(first.id)));

  box.json(['artifact', 'move', second.id, '--workspace', manifest.id]);
  assert.match(box.hws(['artifact', 'trash', second.id]).stderr, /only an unfiled artifact/);
});
