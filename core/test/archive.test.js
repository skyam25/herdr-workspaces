import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { sandbox } from './helpers.js';

const spaceNames = (box) => box.state().spaces.map((space) => space.name);
const ids = (rows) => rows.map((row) => row.id);

test('set --name renames the workspace and the space named for it', (t) => {
  const box = sandbox(t);
  const manifest = box.app('old');
  box.json(['space', 'add', '--workspace', manifest.id, '--name', 'Build']);
  box.clearCalls();

  const updated = box.json(['set', '--workspace', manifest.id, '--name', '  new name  ']);

  assert.equal(updated.name, 'new name');
  assert.deepEqual(box.actions(), [['herdr-app', 'do', 'space.rename', '--id', manifest.id, '--name', 'new name']]);
});

test('set --name leaves a space with its own name alone', (t) => {
  const box = sandbox(t);
  const manifest = box.app('old');
  box.setState({ spaces: box.state().spaces.map((space) => ({ ...space, name: 'Build' })) });
  box.json(['set', '--workspace', manifest.id, '--name', 'new']);
  assert.deepEqual(box.actions(), []);
});

test('a rename keeps the default place folders where they were', (t) => {
  const box = sandbox(t);
  const manifest = box.app('old');
  const before = box.json(['place', 'scratch', '--workspace', manifest.id]).path;

  box.json(['set', '--workspace', manifest.id, '--name', 'new']);
  box.json(['set', '--workspace', manifest.id, '--name', 'newer']);

  assert.equal(box.manifest(manifest.id).storeName, 'old');
  assert.equal(box.json(['place', 'scratch', '--workspace', manifest.id]).path, before);
});

test('set --name refuses an empty name and the standalone store', (t) => {
  const box = sandbox(t);
  const manifest = box.app('old');
  assert.equal(box.hws(['set', '--workspace', manifest.id, '--name', '   ']).code, 2);
  assert.equal(box.manifest(manifest.id).name, 'old');
  box.inWorkspace('standalone');
  assert.equal(box.hws(['set', '--workspace', 'standalone', '--name', 'x']).code, 1);
});

test('set --name with the same name changes nothing', (t) => {
  const box = sandbox(t);
  const manifest = box.app('same');
  box.json(['set', '--workspace', manifest.id, '--name', 'same']);
  assert.deepEqual(box.actions(), []);
  assert.equal(box.manifest(manifest.id).storeName, undefined);
});

test('set --name works on a throwaway and sets no store name', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway('scrap');
  assert.equal(box.json(['set', '--workspace', manifest.id, '--name', 'better']).name, 'better');
  assert.equal(box.manifest(manifest.id).storeName, undefined);
});

test('archive closes the spaces and moves the workspace to the archived list', (t) => {
  const box = sandbox(t);
  const manifest = box.app();

  assert.deepEqual(box.json(['archive', '--workspace', manifest.id]), { archived: true, workspace: manifest.id });

  assert.deepEqual(box.state().spaces, []);
  const saved = box.manifest(manifest.id);
  assert.deepEqual(saved.spaces, []);
  assert.equal(saved.archived.spaces[0].name, 'demo');
  assert.deepEqual(ids(box.json(['list'])), []);
  assert.deepEqual(ids(box.json(['list', '--archived'])), [manifest.id]);
});

test('prune leaves an archived workspace in place', (t) => {
  const box = sandbox(t);
  const archived = box.app('archived');
  const other = box.app('open');
  box.json(['archive', '--workspace', archived.id]);

  const result = box.json(['prune']);

  assert.deepEqual(result.pruned, []);
  assert.ok(box.manifest(archived.id).archived);
  assert.deepEqual(ids(box.json(['list'])), [other.id]);
});

test('archive refuses a throwaway, an archived workspace and a silent window', (t) => {
  const box = sandbox(t);
  const scrap = box.throwaway();
  assert.equal(box.hws(['archive', '--workspace', scrap.id]).code, 1);

  const manifest = box.app();
  box.setState({ lsFails: true });
  assert.equal(box.hws(['archive', '--workspace', manifest.id]).code, 1);
  assert.equal(box.manifest(manifest.id).archived, undefined);
  box.setState({ lsFails: false });

  box.json(['archive', '--workspace', manifest.id]);
  assert.equal(box.hws(['archive', '--workspace', manifest.id]).code, 1);
});

test('archive finds the workspace from the calling terminal', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['archive'], { HC_TERMINAL_ID: manifest.terminals[0].terminal });
  assert.ok(box.manifest(manifest.id).archived);
});

test('archive ends window hosts and flipped agents', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const tabId = manifest.terminals[0].tabId;
  box.rewriteManifest(manifest.id, (draft) => ({
    ...draft,
    surfaces: [{ id: 's1', type: 'board', host: 't77' }],
    terminals: [...draft.terminals, { terminal: 't88', tabId, sessionId: 'flipped-session', role: null }],
  }));
  box.setState({ hc: { t88: { labels: { 'herdr.chat': 'p9' } } } });

  box.json(['archive', '--workspace', manifest.id]);

  const kills = box.actions().filter((call) => call[0] === 'hc' && call[1] === 'kill').map((call) => call[2]);
  assert.deepEqual(kills, ['t77', 't88']);
  assert.ok(box.manifest(manifest.id).archived.spaces[0].tabs.some((tab) => tab.session?.id === 'flipped-session'));
});

test('unarchive reopens the spaces and resumes recorded sessions', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['register', '--terminal', manifest.terminals[0].terminal, '--session', 'abc']);
  box.json(['archive', '--workspace', manifest.id]);
  box.clearCalls();

  const restored = box.json(['unarchive', '--workspace', manifest.id]);

  assert.equal(restored.id, manifest.id);
  assert.equal(restored.archived, undefined);
  assert.equal(restored.spaces.length, 1);
  assert.notEqual(restored.spaces[0], manifest.id);
  assert.deepEqual(spaceNames(box), ['demo']);
  const opened = box.actions().find((call) => call[3] === undefined || call[2] === 'space.new');
  assert.deepEqual(opened.slice(0, 3), ['herdr-app', 'do', 'space.new']);
  assert.ok(opened.includes(JSON.stringify(['claude', '--resume', 'abc'])), opened.join(' '));
  assert.deepEqual(restored.terminals.map((item) => item.sessionId), ['abc']);
  assert.deepEqual(restored.terminals.map((item) => item.terminal), [box.state().spaces[0].tabs[0].terminals[0].terminal]);
  assert.deepEqual(ids(box.json(['list'])), [manifest.id]);
  assert.deepEqual(ids(box.json(['list', '--archived'])), []);
});

test('unarchive restores several spaces and their named tabs', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['space', 'add', '--workspace', manifest.id, '--name', 'Build']);
  box.setState({
    spaces: box.state().spaces.map((space) =>
      space.name === 'Build' ? { ...space, tabs: [{ ...space.tabs[0], name: 'Tests' }, { id: 'tb9', name: 'Logs', terminals: [{ terminal: 't9', pane: 'p9', status: null, app: null, sub_agents: [] }] }] } : space,
    ),
  });
  box.json(['archive', '--workspace', manifest.id]);

  const restored = box.json(['unarchive', '--workspace', manifest.id]);

  assert.equal(restored.spaces.length, 2);
  assert.deepEqual(spaceNames(box), ['demo', 'Build']);
  assert.ok(box.actions().some((call) => call.includes('tab.rename') && call.includes('Tests')));
  assert.ok(box.actions().some((call) => call.includes('tab.new') && call.includes('Logs')));
  assert.ok(box.actions().some((call) => call.includes('space.select') && call.includes(restored.spaces[0])));
});

test('unarchive makes a new Board and keeps the to-do list', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const board = box.json(['board', 'add', '--workspace', manifest.id]);
  const card = box.json(['todo', 'add', '--title', 'Ship it', '--space', manifest.id]);
  box.json(['archive', '--workspace', manifest.id]);
  box.clearCalls();

  const restored = box.json(['unarchive', '--workspace', manifest.id]);

  const fresh = box.manifest(manifest.id).board;
  assert.notEqual(fresh.space, board.space);
  assert.ok(restored.spaces.includes(fresh.space));
  assert.equal(restored.spaces.length, 2);
  assert.ok(box.actions().some((call) => call.includes('tab.new') && call.includes('hws-work')));
  const items = box.json(['todo', 'list', '--space', restored.spaces.find((id) => id !== fresh.space)]).items;
  assert.deepEqual(ids(items), [card.id]);
});

test('unarchive opens one space when none was saved', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.setState({ spaces: [{ id: 'other', name: 'other', folder: '/', tabs: [] }] });
  box.json(['archive', '--workspace', manifest.id]);

  const restored = box.json(['unarchive', '--workspace', manifest.id]);

  assert.equal(restored.spaces.length, 1);
  assert.deepEqual(spaceNames(box), ['other', 'demo']);
});

test('unarchive fails and changes nothing when the folder is gone', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['archive', '--workspace', manifest.id]);
  rmSync(manifest.folder, { recursive: true });
  box.clearCalls();

  assert.equal(box.hws(['unarchive', '--workspace', manifest.id]).code, 1);

  assert.deepEqual(box.actions(), []);
  assert.ok(box.manifest(manifest.id).archived);
});

test('unarchive falls back to the workspace folder for a missing tab folder', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const gone = join(box.dir, 'gone');
  mkdirSync(gone);
  box.setState({ hc: { [manifest.terminals[0].terminal]: { foreground: { name: 'zsh', argv: ['/bin/zsh'], cwd: gone } } } });
  box.json(['archive', '--workspace', manifest.id]);
  assert.equal(box.manifest(manifest.id).archived.spaces[0].tabs[0].folder, gone);
  rmSync(gone, { recursive: true });
  box.clearCalls();

  box.json(['unarchive', '--workspace', manifest.id]);

  assert.equal(box.state().spaces[0].folder, manifest.folder);
});

test('unarchive refuses a workspace that is not archived and needs --workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  assert.equal(box.hws(['unarchive', '--workspace', manifest.id]).code, 1);
  assert.equal(box.hws(['unarchive']).code, 2);
});

test('close removes an archived workspace for good', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['archive', '--workspace', manifest.id]);

  box.json(['close', '--workspace', manifest.id]);

  assert.equal(existsSync(join(box.root, 'workspaces', manifest.id, 'workspace.json')), false);
  assert.deepEqual(box.json(['list', '--archived']), []);
});

test('an archived workspace takes no new spaces or Board', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['archive', '--workspace', manifest.id]);
  box.clearCalls();
  assert.equal(box.hws(['space', 'add', '--workspace', manifest.id]).code, 1);
  assert.equal(box.hws(['board', 'add', '--workspace', manifest.id]).code, 1);
  assert.deepEqual(box.actions(), []);
});

test('an archived workspace can be renamed', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['archive', '--workspace', manifest.id]);
  box.clearCalls();
  assert.equal(box.json(['set', '--workspace', manifest.id, '--name', 'renamed']).name, 'renamed');
  assert.deepEqual(box.actions(), []);
});
