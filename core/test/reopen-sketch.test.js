import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { liveFixtures, sandbox } from './helpers.js';

const { space, tab, terminal } = liveFixtures;

const SCENE = JSON.stringify({ type: 'excalidraw', elements: [{ id: 'r1', type: 'rectangle' }] });
const COMMENTS_MD = '# Comments on the board "flow"\n\n## 1. rectangle\n\nBigger.\n\n- Element: `r1`\n- At: 10,20 on the board\n';

// Files a finished sketch through Done and returns its artifact record.
function finishSketch(box, manifest, { comments = true, title = 'flow' } = {}) {
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--title', title, '--terminal', owner]);
  const bundle = box.bundle(`bundle-${surface.id}`, 'Sketch.\n');
  writeFileSync(join(bundle, 'board.excalidraw'), SCENE);
  if (comments) writeFileSync(join(bundle, 'comments.md'), COMMENTS_MD);
  box.json(['surface', 'done', '--id', surface.id, '--bundle', bundle]);
  box.clearCalls();
  return box.manifest(manifest.id).artifacts.at(-1);
}

const dataDir = (box, workspaceId, surfaceId) => join(box.root, 'workspaces', workspaceId, 'surfaces', surfaceId);
const hcRuns = (box) => box.actions().filter((call) => call[0] === 'hc' && call[1] === 'run');
const runEnvOf = (call) => Object.fromEntries(call.slice(11, -1).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));

test('a sketch artifact reopens in a board window owned by the given terminal', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const artifact = finishSketch(box, manifest);

  const surface = box.json(['surface', 'open', '--type', 'board', '--artifact', artifact.id, '--terminal', owner]);

  const [record] = box.manifest(manifest.id).surfaces;
  assert.deepEqual([record.type, record.title, record.terminal, record.reopens, record.file], ['board', 'flow', owner, artifact.id, join(artifact.path, 'board.excalidraw')]);
  assert.equal(surface.workspace, manifest.id);

  const env = runEnvOf(hcRuns(box)[0]);
  assert.deepEqual([env.HWS_SURFACE_TYPE, env.HWS_SURFACE_TITLE, env.HWS_SURFACE_FILE, env.HWS_TERMINAL], ['board', 'flow', '', owner]);

  const seed = join(dataDir(box, manifest.id, surface.id), 'seed');
  assert.equal(readFileSync(join(seed, 'board.excalidraw'), 'utf8'), SCENE);
  assert.equal(readFileSync(join(seed, 'comments.md'), 'utf8'), COMMENTS_MD);
  assert.equal(readFileSync(join(artifact.path, 'board.excalidraw'), 'utf8'), SCENE);
});

test('a file inside a sketch bundle reopens that artifact', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const artifact = finishSketch(box, manifest);

  const byFile = box.json(['surface', 'open', '--type', 'board', '--file', join(artifact.path, 'board.excalidraw'), '--terminal', owner]);

  assert.equal(byFile.reopens, artifact.id);
  box.clearCalls();
  const byId = box.json(['surface', 'open', '--type', 'board', '--artifact', artifact.id, '--terminal', owner]);
  assert.equal(byId.id, byFile.id);
  assert.equal(byId.focused, true);
});

test('a plain drawing opens in the caller workspace with no artifact to replace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const file = join(manifest.folder, 'Flow v2.excalidraw');
  writeFileSync(file, SCENE);

  const surface = box.json(['surface', 'open', '--type', 'board', '--file', file, '--terminal', owner]);

  const [record] = box.manifest(manifest.id).surfaces;
  assert.deepEqual([record.title, record.file, record.reopens], ['Flow v2', file, undefined]);
  const seed = join(dataDir(box, manifest.id, surface.id), 'seed');
  assert.deepEqual([existsSync(join(seed, 'board.excalidraw')), existsSync(join(seed, 'comments.md'))], [true, false]);
});

test('the surface lives in the workspace that holds the artifact, tied to the caller', (t) => {
  const box = sandbox(t);
  const first = box.app('one');
  const artifact = finishSketch(box, first);
  const second = box.app('two');
  const caller = second.terminals[0].terminal;

  const surface = box.json(['surface', 'open', '--type', 'board', '--artifact', artifact.id, '--terminal', caller]);

  assert.equal(surface.workspace, first.id);
  assert.deepEqual(box.manifest(first.id).surfaces.map((item) => [item.terminal, item.reopens]), [[caller, artifact.id]]);
  assert.deepEqual(box.manifest(second.id).surfaces, []);
  assert.ok(existsSync(join(dataDir(box, first.id, surface.id), 'seed', 'board.excalidraw')));
});

test('a reopened sketch with no terminal is standalone in its workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const artifact = finishSketch(box, manifest);

  const refused = box.hws(['surface', 'open', '--type', 'board', '--artifact', artifact.id]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /pass --terminal or --standalone/);

  box.json(['surface', 'open', '--type', 'board', '--artifact', artifact.id, '--standalone']);
  const [record] = box.manifest(manifest.id).surfaces;
  assert.deepEqual([record.terminal, record.reopens], [null, artifact.id]);
  assert.equal(runEnvOf(hcRuns(box)[0]).HWS_TERMINAL, '');
});

test('reopening an open sketch raises its window and starts no host', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const artifact = finishSketch(box, manifest);
  const first = box.json(['surface', 'open', '--type', 'board', '--artifact', artifact.id, '--terminal', owner]);
  box.clearCalls();

  const again = box.json(['surface', 'open', '--type', 'board', '--artifact', artifact.id, '--terminal', owner]);

  assert.deepEqual([again.id, again.focused], [first.id, true]);
  assert.deepEqual(hcRuns(box), []);
  assert.equal(box.manifest(manifest.id).surfaces.length, 1);
});

test('a closed draft keeps its edits, and a closed empty one starts from the artifact again', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const artifact = finishSketch(box, manifest);
  const surface = box.json(['surface', 'open', '--type', 'board', '--artifact', artifact.id, '--terminal', owner]);
  const data = dataDir(box, manifest.id, surface.id);

  // The host loads the seed once, and the edits land in boards/.
  rmSync(join(data, 'seed'), { recursive: true });
  mkdirSync(join(data, 'boards'), { recursive: true });
  writeFileSync(join(data, 'boards', 'flow.excalidraw'), JSON.stringify({ elements: [{ id: 'edited' }] }));
  box.setState({ hc: { t90: 'missing' } });
  box.clearCalls();
  box.json(['surface', 'open', '--type', 'board', '--artifact', artifact.id, '--terminal', owner]);
  assert.equal(existsSync(join(data, 'seed')), false);
  assert.equal(hcRuns(box).length, 1);

  rmSync(join(data, 'boards', 'flow.excalidraw'));
  box.setState({ hc: { t90: 'missing' } });
  box.json(['surface', 'open', '--type', 'board', '--artifact', artifact.id, '--terminal', owner]);
  assert.ok(existsSync(join(data, 'seed', 'board.excalidraw')));
});

test('done on a reopened sketch files a new bundle that supersedes the old one', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const old = finishSketch(box, manifest);
  const surface = box.json(['surface', 'open', '--type', 'board', '--artifact', old.id, '--terminal', owner]);
  const bundle = box.bundle('bundle-again', 'Sketch again.\n');
  box.clearCalls();

  const result = box.json(['surface', 'done', '--id', surface.id, '--bundle', bundle]);

  const after = box.manifest(manifest.id);
  const fresh = after.artifacts.find((item) => item.id === result.artifact);
  const before = after.artifacts.find((item) => item.id === old.id);
  assert.deepEqual([fresh.status, fresh.supersedes, fresh.title], ['current', old.id, 'flow']);
  assert.notEqual(fresh.path, old.path);
  assert.equal(before.status, 'superseded');
  assert.equal(readFileSync(join(old.path, 'board.excalidraw'), 'utf8'), SCENE);
  assert.deepEqual(after.surfaces, []);
  assert.deepEqual(box.actions()[0], ['hc', 'send', owner, 'Sketch again.\n']);
});

test('a second press on a standalone pane supersedes the first press', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const old = finishSketch(box, manifest);
  box.setState({ selected: manifest.id });
  const surface = box.json(['surface', 'open', '--type', 'board', '--artifact', old.id, '--standalone', '--in-pane']);

  const first = box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-one')]);
  const second = box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-two')]);

  const byId = Object.fromEntries(box.manifest(manifest.id).artifacts.map((item) => [item.id, item]));
  assert.deepEqual([byId[old.id].status, byId[first.artifact].status, byId[second.artifact].status], ['superseded', 'superseded', 'current']);
  assert.deepEqual([byId[first.artifact].supersedes, byId[second.artifact].supersedes], [old.id, first.artifact]);
  assert.equal(box.manifest(manifest.id).surfaces[0].reopens, second.artifact);
});

test('a reopened sketch moved away supersedes nothing', (t) => {
  const box = sandbox(t);
  const first = box.app('one');
  const second = box.app('two');
  const old = finishSketch(box, first);
  const surface = box.json(['surface', 'open', '--type', 'board', '--artifact', old.id, '--terminal', first.terminals[0].terminal]);
  box.json(['surface', 'move', '--id', surface.id, '--workspace', second.id]);

  const result = box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-moved')]);

  const fresh = box.manifest(second.id).artifacts.find((item) => item.id === result.artifact);
  assert.equal(fresh.supersedes, null);
  assert.equal(box.manifest(first.id).artifacts.find((item) => item.id === old.id).status, 'current');
});

test('reopening refuses what is not a sketch with a drawing', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const note = join(manifest.folder, 'plan.md');
  writeFileSync(note, '# Plan');
  const file = box.json(['artifact', 'add', '--file', note, '--in-place', '--workspace', manifest.id]);
  const empty = finishSketch(box, manifest);
  rmSync(join(empty.path, 'board.excalidraw'));
  const broken = join(manifest.folder, 'broken.excalidraw');
  writeFileSync(broken, '{"nope": 1}');

  const fails = (args, code, pattern) => {
    const result = box.hws(['surface', 'open', '--type', 'board', ...args, '--terminal', owner]);
    assert.equal(result.code, code, args.join(' '));
    assert.match(result.stderr, pattern);
  };
  fails(['--artifact', file.id], 1, /is a file, and only a sketch reopens on a board/);
  fails(['--artifact', empty.id], 1, /has no drawing to reopen/);
  fails(['--artifact', 'anope'], 1, /no artifact anope in an open workspace/);
  fails(['--file', note], 1, /a sketch opens an \.excalidraw file/);
  fails(['--file', broken], 1, /is not an Excalidraw scene/);
  fails(['--file', broken, '--artifact', empty.id], 2, /use --file or --artifact, not both/);

  const typed = box.hws(['surface', 'open', '--type', 'note', '--artifact', empty.id, '--terminal', owner]);
  assert.equal(typed.code, 2);
  assert.match(typed.stderr, /--artifact reopens a sketch/);
  assert.deepEqual(box.manifest(manifest.id).surfaces, []);
});

test('reopening refuses a sketch in an archived workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const artifact = finishSketch(box, manifest);
  box.json(['archive', '--workspace', manifest.id]);
  box.setState({ spaces: [space('sp9', [tab('tb9', [terminal('t9', 'p9')])])] });

  const result = box.hws(['surface', 'open', '--type', 'board', '--artifact', artifact.id, '--terminal', 't9']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /is archived, so restore it first/);
});
