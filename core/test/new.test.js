import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { sandbox } from './helpers.js';

test('new terminal opens a tab and writes no manifest', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [{ id: 'sp1', name: 'a', folder: '/', tabs: [] }], selected: 'sp1' });
  const folder = box.folder('work');
  const result = box.json(['new', 'terminal', '--folder', folder]);
  assert.deepEqual(box.actions(), [['herdr-app', 'do', 'tab.new', '--folder', folder]]);
  assert.equal(result.space, 'sp1');
  assert.equal(existsSync(join(box.root, 'workspaces', 'sp1')), false);
});

test('new terminal without a folder leaves the folder to Herdr', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [{ id: 'sp1', name: 'a', folder: '/', tabs: [] }], selected: 'sp1' });
  box.json(['new', 'terminal']);
  assert.deepEqual(box.actions(), [['herdr-app', 'do', 'tab.new']]);
});

test('new workspace creates the space, named tabs and the manifest', (t) => {
  const box = sandbox(t);
  const folder = box.folder('work-here');
  const manifest = box.json([
    'new', 'workspace', '--name', 'checkout', '--folder', folder, '--kind', 'app',
    '--tabs', 'Plan, Build', '--instructions', 'ship it',
  ]);
  assert.deepEqual(box.actions(), [
    ['herdr-app', 'do', 'space.new', '--name', 'checkout', '--folder', folder],
    ['herdr-app', 'do', 'tab.rename', '--id', 'tb101', '--name', 'Plan'],
    ['herdr-app', 'do', 'tab.new', '--name', 'Build', '--space', 'sp102', '--folder', folder],
  ]);
  assert.deepEqual(box.manifest(manifest.id), manifest);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.kind, 'app');
  assert.equal(manifest.instructions, 'ship it');
  assert.deepEqual(manifest.tabs.map((tab) => [tab.name, tab.role]), [['Plan', 'plan'], ['Build', 'build']]);
  assert.deepEqual(manifest.terminals, [
    { terminal: 't101', tabId: 'tb101', sessionId: null, role: null },
    { terminal: 't103', tabId: 'tb103', sessionId: null, role: null },
  ]);
  assert.deepEqual([manifest.surfaces, manifest.artifacts], [[], []]);
});

test('new workspace rejects bad usage with exit 2', (t) => {
  const box = sandbox(t);
  const missing = box.hws(['new', 'workspace', '--name', 'x', '--kind', 'app']);
  assert.equal(missing.code, 2);
  const badKind = box.hws(['new', 'workspace', '--name', 'x', '--folder', box.dir, '--kind', 'throwaway', '--json']);
  assert.equal(badKind.code, 2);
  assert.match(JSON.parse(badKind.stdout).error, /kind/);
  assert.deepEqual(box.actions(), []);
});

test('new workspace defaults to general and the agent line leaves the word out', (t) => {
  const box = sandbox(t);
  const manifest = box.json(['new', 'workspace', '--name', 'plain', '--folder', box.folder('plain')]);
  assert.equal(manifest.kind, 'general');
  const terminal = manifest.terminals[0].terminal;
  assert.match(box.hws(['current', '--terminal', terminal, '--line']).stdout, /in the workspace "plain"/);
});

test('new workspace needs an existing folder and remembers it as the parent', (t) => {
  const box = sandbox(t);
  const missing = box.hws(['new', 'workspace', '--name', 'x', '--folder', join(box.dir, 'nope'), '--json']);
  assert.equal(missing.code, 1);
  assert.match(JSON.parse(missing.stdout).error, /does not exist/);
  assert.equal(existsSync(join(box.dir, 'nope')), false);
  const folder = box.folder('parent');
  box.json(['new', 'workspace', '--name', 'first', '--folder', folder]);
  assert.equal(box.json(['parent']).folder, folder);
});

test('the agent line carries the workspace instructions', (t) => {
  const box = sandbox(t);
  const manifest = box.json(['new', 'workspace', '--name', 'n', '--folder', box.folder('n'), '--instructions', 'Keep notes in context/']);
  const line = box.hws(['current', '--terminal', manifest.terminals[0].terminal, '--line']).stdout;
  assert.match(line, /Workspace instructions:\nKeep notes in context\//);
});

test('new throwaway starts one claude tab', (t) => {
  const box = sandbox(t);
  const manifest = box.json(['new', 'throwaway', '--name', 'quick']);
  assert.deepEqual(box.actions(), [
    ['herdr-app', 'do', 'space.new', '--name', 'quick', '--folder', box.homeDir, '--argv', '["claude"]'],
    ['herdr-app', 'do', 'tab.rename', '--id', 'tb101', '--name', 'Claude'],
  ]);
  assert.equal(manifest.kind, 'throwaway');
  assert.equal(manifest.tabs.length, 1);
});

test('new throwaway invents a name when none is given', (t) => {
  const box = sandbox(t);
  assert.match(box.json(['new', 'throwaway']).name, /^throwaway-[0-9a-f]{4}$/);
});

test('a failing herdr command exits 1 and reports the error', (t) => {
  const box = sandbox(t);
  box.setState({ failDo: ['space.new'] });
  const result = box.hws(['new', 'throwaway', '--json']);
  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stdout), { error: 'space.new refused' });
});
