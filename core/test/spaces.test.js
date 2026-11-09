import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sandbox } from './helpers.js';

function plainSpace(box, id = 'sp-plain') {
  const tab = { id: `tb-${id}`, name: '1', terminals: [{ terminal: `t-${id}`, pane: `p-${id}`, status: null, app: null, sub_agents: [] }] };
  box.setState({ spaces: [...box.state().spaces, { id, name: id, folder: '/', tabs: [tab] }] });
  return id;
}

function workspaceWithTwoSpaces(box) {
  const manifest = box.app('demo');
  const added = box.json(['space', 'add', '--workspace', manifest.id, '--name', 'web']);
  return { manifest, second: added.space };
}

const openIds = (box) => box.state().spaces.map((space) => space.id);

test('a new workspace starts as one space with one unnamed tab', (t) => {
  const box = sandbox(t);
  const manifest = box.json(['new', 'workspace', '--name', 'x', '--folder', box.folder('x')]);
  assert.deepEqual(manifest.spaces, [manifest.id]);
  assert.equal(manifest.tabs.length, 1);
  assert.equal(box.actions().some((call) => call.includes('tab.rename')), false);
});

test('space add opens a separate space in the workspace folder', (t) => {
  const box = sandbox(t);
  const { manifest, second } = workspaceWithTwoSpaces(box);
  const saved = box.manifest(manifest.id);
  assert.deepEqual(saved.spaces, [manifest.id, second]);
  assert.equal(saved.terminals.length, 2);
  assert.deepEqual(box.actions().at(-1), ['herdr-app', 'do', 'space.new', '--name', 'web', '--folder', manifest.folder]);
});

test('every space in a workspace resolves to that workspace', (t) => {
  const box = sandbox(t);
  const { manifest } = workspaceWithTwoSpaces(box);
  const terminal = box.manifest(manifest.id).terminals[1].terminal;
  assert.equal(box.json(['current', '--terminal', terminal]).id, manifest.id);
});

test('spaces in a workspace share one board', (t) => {
  const box = sandbox(t);
  const { manifest, second } = workspaceWithTwoSpaces(box);
  box.json(['todo', 'add', '--title=Shared', '--space', second]);
  const listed = box.json(['todo', 'list', '--space', manifest.id]);
  assert.deepEqual(listed.items.map((item) => item.title), ['Shared']);
  assert.deepEqual(listed.spaces, [manifest.id, second]);
});

test('moving a plain space in brings its cards to the shared board', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const plain = plainSpace(box);
  box.json(['todo', 'add', '--title=Mine', '--space', plain]);
  box.json(['space', 'move', '--space', plain, '--workspace', manifest.id]);
  assert.deepEqual(box.manifest(manifest.id).spaces, [manifest.id, plain]);
  assert.deepEqual(box.json(['todo', 'list', '--space', manifest.id]).items.map((item) => item.title), ['Mine']);
});

test('moving between workspaces carries terminal records and leaves cards behind', (t) => {
  const box = sandbox(t);
  const { manifest: from, second } = workspaceWithTwoSpaces(box);
  const to = box.app('other');
  box.json(['todo', 'add', '--title=Stays', '--space', second]);
  box.json(['space', 'move', '--space', second, '--workspace', to.id]);
  assert.deepEqual(box.manifest(from.id).spaces, [from.id]);
  assert.deepEqual(box.manifest(to.id).spaces, [to.id, second]);
  assert.equal(box.manifest(from.id).terminals.length, 1);
  assert.equal(box.manifest(to.id).terminals.length, 2);
  assert.deepEqual(box.json(['todo', 'list', '--space', from.id]).items.map((item) => item.title), ['Stays']);
  assert.deepEqual(box.json(['todo', 'list', '--space', second]).items, []);
});

test('a workspace keeps its last space', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const other = box.app('other');
  const moved = box.hws(['space', 'move', '--space', manifest.id, '--workspace', other.id]);
  assert.equal(moved.code, 1);
  assert.match(moved.stderr, /only space in demo/);
  assert.equal(box.hws(['space', 'remove', '--space', manifest.id]).code, 1);
});

test('a space on another machine cannot join', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  box.setState({ spaces: [...box.state().spaces, { id: 'vm/sp1', name: 'far', machine: 'vm', folder: '/', tabs: [] }] });
  const moved = box.hws(['space', 'move', '--space', 'vm/sp1', '--workspace', manifest.id]);
  assert.equal(moved.code, 1);
  assert.match(moved.stderr, /only spaces on this computer/);
});

test('the founding space leaves without taking the workspace board', (t) => {
  const box = sandbox(t);
  const { manifest, second } = workspaceWithTwoSpaces(box);
  box.json(['todo', 'add', '--title=Shared', '--space', second]);
  box.json(['space', 'remove', '--space', manifest.id]);
  assert.deepEqual(box.json(['todo', 'list', '--space', manifest.id]).items, []);
  assert.deepEqual(box.json(['todo', 'list', '--space', second]).items.map((item) => item.title), ['Shared']);
});

test('closing a workspace closes every space in it', (t) => {
  const box = sandbox(t);
  const { manifest } = workspaceWithTwoSpaces(box);
  const bystander = plainSpace(box);
  box.json(['close', '--workspace', manifest.id]);
  assert.deepEqual(openIds(box), [bystander]);
  assert.deepEqual(box.json(['list']), []);
});

test('closing from inside a workspace closes the calling space last', (t) => {
  const box = sandbox(t);
  const { manifest, second } = workspaceWithTwoSpaces(box);
  plainSpace(box);
  const caller = box.manifest(manifest.id).terminals[0].terminal;
  box.clearCalls();
  box.json(['close', '--workspace', manifest.id], { HC_TERMINAL_ID: caller });
  const closed = box.actions().filter((call) => call.includes('space.close')).map((call) => call[call.indexOf('--id') + 1]);
  assert.deepEqual(closed, [second, manifest.id]);
});

test('prune drops a closed space and keeps the workspace until the last one goes', (t) => {
  const box = sandbox(t);
  const { manifest, second } = workspaceWithTwoSpaces(box);
  box.setState({ spaces: box.state().spaces.filter((space) => space.id !== manifest.id) });
  box.json(['prune']);
  assert.deepEqual(box.manifest(manifest.id).spaces, [second]);
  plainSpace(box);
  box.setState({ spaces: box.state().spaces.filter((space) => space.id !== second) });
  assert.deepEqual(box.json(['prune']).pruned, [manifest.id]);
});

test('a manifest without a space list has its own space', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  box.rewriteManifest(manifest.id, ({ spaces, ...old }) => old);
  assert.deepEqual(box.json(['list'])[0].spaces, [manifest.id]);
});

test('board open makes one Board space with only the Board tab', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const first = box.json(['board', 'add', '--workspace', manifest.id]);
  const second = box.json(['board', 'add', '--workspace', manifest.id]);
  assert.deepEqual(second, first);
  const space = box.state().spaces.find((item) => item.id === first.space);
  assert.equal(space.name, 'Board');
  assert.deepEqual(space.tabs.map((tab) => tab.id), [first.tab]);
  assert.deepEqual(box.manifest(manifest.id).spaces, [manifest.id, first.space]);
});

test('a new workspace has no Board and finding one creates nothing', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  box.clearCalls();
  assert.deepEqual(box.json(['board', 'open', '--space', manifest.id]), { workspace: manifest.id, space: null, tab: null });
  assert.deepEqual(box.actions(), []);
  assert.equal(box.manifest(manifest.id).board, undefined);
});

test('an agent adds the Board from its own terminal', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const agent = box.manifest(manifest.id).terminals[0].terminal;
  const added = box.json(['board', 'add'], { HC_TERMINAL_ID: agent });
  assert.equal(added.workspace, manifest.id);
  assert.equal(box.manifest(manifest.id).board.space, added.space);
});

test('every space in a workspace finds the same Board', (t) => {
  const box = sandbox(t);
  const { manifest, second } = workspaceWithTwoSpaces(box);
  const added = box.json(['board', 'add', '--workspace', manifest.id]);
  assert.deepEqual(box.json(['board', 'open', '--space', second]), added);
  assert.equal(box.json(['board', 'open', '--space', added.space]).tab, added.tab);
});

test('board open on a plain space leaves the window alone', (t) => {
  const box = sandbox(t);
  const plain = plainSpace(box);
  box.clearCalls();
  assert.deepEqual(box.json(['board', 'open', '--space', plain]), { workspace: null });
  assert.deepEqual(box.actions(), []);
});

test('a closed Board space opens again', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const first = box.json(['board', 'add', '--workspace', manifest.id]);
  box.setState({ spaces: box.state().spaces.filter((space) => space.id !== first.space) });
  box.json(['prune']);
  const again = box.json(['board', 'add', '--workspace', manifest.id]);
  assert.notEqual(again.space, first.space);
  assert.deepEqual(box.manifest(manifest.id).spaces, [manifest.id, again.space]);
});

test('the Board keeps its space when only its tab was closed, and agents there stay', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const first = box.json(['board', 'add', '--workspace', manifest.id]);
  const agentTab = { id: 'tb-agent', name: 'agent', terminals: [] };
  box.setState({ spaces: box.state().spaces.map((space) => (space.id === first.space ? { ...space, tabs: [agentTab] } : space)) });
  const again = box.json(['board', 'add', '--workspace', manifest.id]);
  assert.equal(again.space, first.space);
  assert.deepEqual(box.state().spaces.find((space) => space.id === first.space).tabs.map((tab) => tab.id), ['tb-agent', again.tab]);
});

test('the Board space cannot leave its workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const other = box.app('other');
  const { space } = box.json(['board', 'add', '--workspace', manifest.id]);
  const removed = box.hws(['space', 'remove', '--space', space]);
  assert.equal(removed.code, 1);
  assert.match(removed.stderr, /Board space stays/);
  assert.equal(box.hws(['space', 'move', '--space', space, '--workspace', other.id]).code, 1);
});

test('closing a workspace closes its Board space', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  box.json(['board', 'add', '--workspace', manifest.id]);
  const bystander = plainSpace(box);
  box.json(['close', '--workspace', manifest.id]);
  assert.deepEqual(openIds(box), [bystander]);
});
