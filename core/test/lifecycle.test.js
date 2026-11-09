import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { liveFixtures, sandbox } from './helpers.js';

const { space, tab, terminal } = liveFixtures;

function throwawayWithArtifact(box, name = 'scratch') {
  const manifest = box.throwaway(name);
  return { manifest, ...box.finishGlued(manifest) };
}

test('promote turns a throwaway into a kept workspace and moves artifacts', (t) => {
  const box = sandbox(t);
  const { manifest, artifact } = throwawayWithArtifact(box);
  const folder = box.folder('promoted');

  const result = box.json(['promote', '--name', 'real', '--folder', folder, '--kind', 'deliverable'], {
    HC_TERMINAL_ID: manifest.terminals[0].terminal,
  });

  const newDir = join(folder, '.herdr-workspace', 'real-sp102', 'artifacts', artifact.id);
  assert.deepEqual(box.actions(), [['herdr-app', 'do', 'space.rename', '--id', manifest.id, '--name', 'real']]);
  assert.deepEqual([result.kind, result.name, result.folder], ['deliverable', 'real', folder]);
  assert.deepEqual([result.artifacts[0].path, result.artifacts[0].prompt], [newDir, join(newDir, 'prompt.md')]);
  assert.equal(existsSync(artifact.path), false);
  assert.equal(readFileSync(join(newDir, 'prompt.md'), 'utf8').includes(artifact.path), false);
  assert.match(readFileSync(join(newDir, 'prompt.md'), 'utf8'), new RegExp(`${newDir}/images/shot.png`));
});

test('promote refuses a workspace that is not a throwaway', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const result = box.hws(['promote', '--name', 'x', '--folder', box.dir, '--kind', 'app', '--workspace', manifest.id]);
  assert.equal(result.code, 1);
});

test('set changes a kept kind and refuses a throwaway', (t) => {
  const box = sandbox(t);
  const kept = box.json(['new', 'workspace', '--name', 'k', '--folder', box.folder('k')]);
  assert.equal(box.json(['set', '--workspace', kept.id, '--kind', 'app']).kind, 'app');
  assert.equal(box.hws(['set', '--workspace', kept.id, '--kind', 'studio']).code, 2);
  assert.equal(box.hws(['set', '--workspace', kept.id]).code, 2);
  assert.equal(box.json(['set', '--workspace', kept.id, '--instructions', 'Use context/']).instructions, 'Use context/');
  const scrap = box.json(['new', 'throwaway', '--name', 's']);
  assert.equal(box.hws(['set', '--workspace', scrap.id, '--kind', 'app']).code, 1);
});

test('promote rejects bad usage', (t) => {
  const box = sandbox(t);
  assert.equal(box.hws(['promote', '--name', 'x', '--kind', 'app']).code, 2);
  assert.equal(box.hws(['promote', '--name', 'x', '--folder', box.dir, '--kind', 'studio']).code, 2);
  assert.equal(box.hws(['promote', '--name', 'x', '--folder', box.dir, '--kind', 'app']).code, 2);
});

test('close on a throwaway with artifacts asks and closes nothing', (t) => {
  const box = sandbox(t);
  const { manifest, artifact } = throwawayWithArtifact(box);
  const result = box.json(['close', '--workspace', manifest.id]);
  assert.deepEqual(result, { decision: 'needed', artifacts: [artifact], scratch: null });
  assert.deepEqual(box.actions(), []);
  assert.ok(existsSync(artifact.path));
  assert.ok(box.manifest(manifest.id));
});

test('close --trash moves artifacts with trash and closes the space', (t) => {
  const box = sandbox(t);
  const { manifest, artifact } = throwawayWithArtifact(box);
  const result = box.json(['close', '--workspace', manifest.id, '--trash']);
  assert.deepEqual(box.actions(), [
    ['trash', artifact.path],
    ['herdr-app', 'do', 'space.close', '--id', manifest.id, '--confirmed', 'true'],
  ]);
  assert.deepEqual(result, { closed: true, workspace: manifest.id, kept: [] });
  assert.equal(existsSync(artifact.path), false);
  assert.ok(existsSync(join(box.trashDir, `0-${artifact.id}`, 'prompt.md')));
  assert.equal(existsSync(join(box.root, 'workspaces', manifest.id)), false);
});

test('close --trash uses gio on Linux and refuses to delete when it fails', { skip: process.platform === 'darwin' }, (t) => {
  const box = sandbox(t);
  const { manifest, artifact } = throwawayWithArtifact(box);
  const missing = { HWS_TRASH: join(box.dir, 'no-such-trash'), HWS_GIO: join(box.dir, 'no-such-gio') };
  assert.notEqual(box.hws(['close', '--workspace', manifest.id, '--trash'], missing).code, 0);
  assert.equal(existsSync(artifact.path), true);
  const gio = join(box.dir, 'gio');
  writeFileSync(gio, '#!/bin/sh\nshift\nrm -rf "$@"\n', { mode: 0o755 });
  box.json(['close', '--workspace', manifest.id, '--trash'], { ...missing, HWS_GIO: gio });
  assert.equal(existsSync(artifact.path), false);
});

test('close --trash falls back to Finder when the binary is missing', { skip: process.platform !== 'darwin' }, (t) => {
  const box = sandbox(t);
  const { manifest, artifact } = throwawayWithArtifact(box);
  box.json(['close', '--workspace', manifest.id, '--trash'], { HWS_TRASH: join(box.dir, 'no-such-trash') });
  const finder = box.calls().find((call) => call.bin === 'osascript');
  assert.ok(finder.args.includes(artifact.path));
  assert.ok(finder.args.some((arg) => arg.includes('tell application "Finder"')));
  assert.equal(existsSync(artifact.path), false);
  assert.ok(existsSync(join(box.trashDir, `finder-0-${artifact.id}`)));
});

test('close --keep moves artifacts to Documents and rewrites paths', (t) => {
  const box = sandbox(t);
  const { manifest, artifact } = throwawayWithArtifact(box, 'my/scratch');
  const result = box.json(['close', '--workspace', manifest.id, '--keep']);
  const kept = join(box.homeDir, 'Documents', 'Herdr Workspaces', 'my-scratch', artifact.id);
  assert.deepEqual(result, { closed: true, workspace: manifest.id, kept: [kept] });
  assert.equal(existsSync(artifact.path), false);
  assert.ok(existsSync(join(kept, 'images', 'shot.png')));
  const prompt = readFileSync(join(kept, 'prompt.md'), 'utf8');
  assert.equal(prompt.includes(artifact.path), false);
  assert.ok(prompt.includes(`@"${kept}/images/shot.png"`));
  assert.ok(box.actions().some((call) => call[2] === 'space.close'));
});

test('close rejects both flags', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  assert.equal(box.hws(['close', '--workspace', manifest.id, '--keep', '--trash']).code, 2);
  assert.ok(box.manifest(manifest.id));
});

test('close on a throwaway with no artifacts just closes', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const result = box.json(['close', '--workspace', manifest.id]);
  assert.equal(result.closed, true);
  assert.deepEqual(box.actions(), [['herdr-app', 'do', 'space.close', '--id', manifest.id, '--confirmed', 'true']]);
});

test('close on a kept workspace archives it, keeps artifacts and ignores --trash', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { artifact } = box.finishGlued(manifest);
  const result = box.json(['close', '--workspace', 'demo', '--trash']);
  assert.deepEqual(result, { closed: true, archived: true, workspace: manifest.id, kept: null });
  assert.ok(existsSync(artifact.path));
  assert.ok(box.manifest(manifest.id).archived);
  assert.equal(box.calls().some((call) => call.bin === 'trash'), false);
});

test('close finds the workspace from the calling terminal', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const result = box.json(['close'], { HC_TERMINAL_ID: manifest.terminals[0].terminal });
  assert.equal(result.workspace, manifest.id);
  assert.equal(box.hws(['close']).code, 2);
});

test('removing an archived workspace moves unfinished surface data to the Trash', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', manifest.terminals[0].terminal]);
  const draft = join(box.root, 'workspaces', manifest.id, 'surfaces', surface.id, 'board.json');
  writeFileSync(draft, '{}');
  box.json(['close', '--workspace', manifest.id]);
  assert.ok(existsSync(draft));
  box.json(['close', '--workspace', manifest.id]);
  assert.ok(existsSync(join(box.trashDir, '0-surfaces', surface.id, 'board.json')));
});

test('close fails and moves nothing when the window does not answer', (t) => {
  const box = sandbox(t);
  const { manifest, artifact } = throwawayWithArtifact(box);
  box.setState({ lsFails: true });
  assert.equal(box.hws(['close', '--workspace', manifest.id, '--trash']).code, 1);
  assert.ok(existsSync(artifact.path));
  assert.ok(box.manifest(manifest.id));
});

test('close refuses the standalone store and unknown workspaces', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])], selected: 'sp1' });
  box.json(['surface', 'open', '--type', 'board', '--in-pane', '--standalone']);
  assert.equal(box.hws(['close', '--workspace', 'standalone']).code, 1);
  assert.equal(box.hws(['close', '--workspace', 'nope']).code, 1);
});

test('prune archives a kept workspace whose space is gone, with its recent sessions', (t) => {
  const box = sandbox(t);
  const gone = box.app('gone');
  const kept = box.app('kept');
  box.transcript(gone, 'sess-a');
  box.setState({ spaces: box.state().spaces.filter((item) => item.id !== gone.id) });
  assert.deepEqual(box.json(['prune']), { pruned: [gone.id], expired: [], skipped: false });
  const archived = box.manifest(gone.id).archived;
  assert.deepEqual(archived.spaces[0].tabs.map((tab) => tab.session.id), ['sess-a']);
  assert.deepEqual(box.manifest(gone.id).spaces, []);
  assert.ok(box.manifest(kept.id));
});

test('prune does nothing when the window does not answer', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.setState({ lsFails: true });
  assert.deepEqual(box.json(['prune']), { pruned: [], expired: [], skipped: true });
  assert.ok(box.manifest(manifest.id));
});

test('prune does nothing when the window reports no spaces', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.setState({ spaces: [] });
  assert.equal(box.json(['prune']).skipped, true);
  assert.ok(box.manifest(manifest.id));
});

test('prune skips the standalone store', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])], selected: 'sp1' });
  box.json(['surface', 'open', '--type', 'board', '--in-pane', '--standalone']);
  box.json(['prune']);
  assert.ok(box.manifest('standalone'));
});

test('prune keeps throwaway artifacts and trashes surface drafts', (t) => {
  const box = sandbox(t);
  const { manifest, artifact } = throwawayWithArtifact(box);
  const data = join(box.root, 'workspaces', manifest.id, 'surfaces', 'sx');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'draft.json'), '{}');
  box.setState({ spaces: [space('sp-other', [tab('tb1', [terminal('t1', 'p1')])])] });

  box.json(['prune']);

  assert.equal(existsSync(join(box.root, 'workspaces', manifest.id, 'workspace.json')), false);
  assert.ok(existsSync(artifact.prompt));
  assert.ok(existsSync(join(box.trashDir, '0-surfaces', 'sx', 'draft.json')));
});

for (const command of [['list'], ['new', 'terminal'], ['current', '--line'], ['close', '--workspace', 'anything']]) {
  test(`hws ${command[0]} prunes first`, (t) => {
    const box = sandbox(t);
    const gone = box.app('gone');
    const kept = box.app('kept');
    box.setState({ spaces: box.state().spaces.filter((item) => item.id !== gone.id), selected: kept.id });
    box.hws(command);
    assert.ok(box.manifest(gone.id).archived);
  });
}

test('resume runs claude --resume only in idle shells with a session', (t) => {
  const box = sandbox(t);
  const manifest = box.json(['new', 'workspace', '--name', 'x', '--folder', box.folder('x'), '--kind', 'app', '--tabs', 'A,B,C,D']);
  const [lost, busy, , finished] = manifest.terminals.map((item) => item.terminal);
  box.json(['register', '--terminal', lost, '--session', 'sess-lost']);
  box.json(['register', '--terminal', busy, '--session', 'sess-busy']);
  box.json(['register', '--terminal', finished, '--session', 'sess-done']);
  box.setState({
    hc: {
      [busy]: { foreground: { name: '2.1.319', argv: ['claude'] } },
      [finished]: { state: 'finished', exit_code: 1 },
    },
  });
  box.clearCalls();

  const result = box.json(['resume', '--workspace', manifest.id]);

  assert.deepEqual(result.resumed, [{ terminal: lost, sessionId: 'sess-lost' }]);
  assert.deepEqual(box.actions(), [['hc', 'send', lost, 'claude --resume sess-lost']]);
});

test('resume reports a failed send and needs a workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const address = manifest.terminals[0].terminal;
  box.json(['register', '--terminal', address, '--session', 'sess']);
  box.setState({ sendFails: true });
  const result = box.json(['resume'], { HC_TERMINAL_ID: address });
  assert.deepEqual(result.resumed, []);
  assert.equal(result.failed[0].error, 'terminal is blocked');
  assert.equal(box.hws(['resume']).code, 2);
});
