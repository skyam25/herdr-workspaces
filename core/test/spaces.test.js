import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  mkdirSync(join(box.root, 'todos'), { recursive: true });
  writeFileSync(join(box.root, 'todos', `${plain}.json`), JSON.stringify({ version: 1, space: plain, items: [{ id: 't1', title: 'Mine', notes: '', column: 'todo', terminal: null, owner: 'unassigned', archived: false, createdAt: 1, updatedAt: 1 }] }));
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

test('board add makes one Tasks space with only the Board tab', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const first = box.json(['board', 'add', '--workspace', manifest.id]);
  const second = box.json(['board', 'add', '--workspace', manifest.id]);
  assert.deepEqual(second, first);
  const space = box.state().spaces.find((item) => item.id === first.space);
  assert.equal(space.name, 'Tasks');
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
  assert.match(removed.stderr, /Tasks space stays/);
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

test('a space brings its ~space cards after the workspace it founded has closed', (t) => {
  const box = sandbox(t);
  const manifest = box.app('target');
  const id = plainSpace(box);
  const card = (cardId) => ({ id: cardId, title: cardId, notes: '', column: 'todo', terminal: null, owner: 'unassigned', archived: false, createdAt: 1, updatedAt: 1 });
  mkdirSync(join(box.root, 'todos'), { recursive: true });
  writeFileSync(join(box.root, 'todos', `${id}.json`), JSON.stringify({ version: 1, space: id, items: [card('from-closed-workspace')] }));
  writeFileSync(join(box.root, 'todos', `${id}~space.json`), JSON.stringify({ version: 1, space: `${id}~space`, items: [card('its-own')] }));

  box.json(['space', 'move', '--space', id, '--workspace', manifest.id]);
  const items = box.json(['todo', 'list', '--space', manifest.id]).items.map((item) => item.id);
  assert.deepEqual(items, ['its-own']);
});

function plainSpaceAt(box, folder, id = 'sp-plain', extra = {}) {
  const tab = { id: `tb-${id}`, name: '1', terminals: [{ terminal: `t-${id}`, pane: `p-${id}`, status: null, app: null, sub_agents: [] }] };
  box.setState({ spaces: [...box.state().spaces, { id, name: id, folder, tabs: [tab], ...extra }] });
  return id;
}

const matchIds = (box, space) => box.json(['space', 'match', '--space', space]).candidates.map((item) => item.id);

test('space match finds the kept workspace whose folder a plain space shares', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const plain = plainSpaceAt(box, manifest.folder);
  const before = box.manifest(manifest.id);

  const result = box.json(['space', 'match', '--space', plain]);

  assert.deepEqual(result, { space: plain, folder: manifest.folder, candidates: [{ id: manifest.id, name: 'demo', folder: manifest.folder, home: null }] });
  assert.deepEqual(box.actions(), []);
  assert.deepEqual(box.manifest(manifest.id), before);
});

test('space match finds a space inside the folder or the home, deepest first', (t) => {
  const box = sandbox(t);
  const outer = box.json(['new', 'workspace', '--name', 'outer', '--folder', box.folder('outer')]);
  const inner = box.json(['new', 'workspace', '--name', 'inner', '--folder', box.folder('elsewhere'), '--home', box.folder('outer/inner')]);
  box.folder('outer/inner/deep');
  const plain = plainSpaceAt(box, join(box.dir, 'outer/inner/deep'));

  const { candidates } = box.json(['space', 'match', '--space', plain]);

  assert.deepEqual(candidates.map((item) => item.id), [inner.id, outer.id]);
  assert.equal(candidates[0].home, join(box.dir, 'outer/inner'));
});

test('space match compares real paths', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  symlinkSync(manifest.folder, join(box.dir, 'link'));
  assert.deepEqual(matchIds(box, plainSpaceAt(box, join(box.dir, 'link'))), [manifest.id]);
});

test('space match skips the inside rule for a workspace at home', (t) => {
  const box = sandbox(t);
  const manifest = box.json(['new', 'workspace', '--name', 'home', '--folder', box.homeDir]);
  mkdirSync(join(box.homeDir, 'sub'));
  assert.deepEqual(matchIds(box, plainSpaceAt(box, join(box.homeDir, 'sub'), 'sp-sub')), []);
  assert.deepEqual(matchIds(box, plainSpaceAt(box, box.homeDir, 'sp-home')), [manifest.id]);
});

test('space match leaves out throwaways, archived workspaces and unrelated folders', (t) => {
  const box = sandbox(t);
  const scratch = box.throwaway();
  const archived = box.app('old');
  box.rewriteManifest(archived.id, (manifest) => ({ ...manifest, archived: { at: 1, spaces: [] }, spaces: [] }));
  box.app('demo');

  assert.deepEqual(matchIds(box, plainSpaceAt(box, scratch.folder, 'sp-a')), []);
  assert.deepEqual(matchIds(box, plainSpaceAt(box, archived.folder, 'sp-b')), []);
  assert.deepEqual(matchIds(box, plainSpaceAt(box, box.folder('demo-two'), 'sp-c')), []);
});

test('space match gives no candidates for a member, a remote space or a space with no folder', (t) => {
  const box = sandbox(t);
  const { manifest, second } = workspaceWithTwoSpaces(box);
  const other = box.app('other');
  box.rewriteManifest(other.id, (draft) => ({ ...draft, folder: manifest.folder }));

  assert.deepEqual(matchIds(box, second), []);
  assert.deepEqual(matchIds(box, plainSpaceAt(box, manifest.folder, 'studio/sp9', { machine: 'studio' })), []);
  assert.deepEqual(matchIds(box, plainSpaceAt(box, undefined, 'sp-nofolder')), []);
  assert.deepEqual(box.json(['space', 'match', '--space', 'sp-gone']), { space: 'sp-gone', folder: null, candidates: [] });
});

test('space match defaults to the calling terminal\'s space', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const plain = plainSpaceAt(box, manifest.folder);
  const result = JSON.parse(box.hws(['space', 'match', '--json'], { HC_TERMINAL_ID: `t-${plain}` }).stdout);
  assert.equal(result.space, plain);
  assert.deepEqual(result.candidates.map((item) => item.id), [manifest.id]);
});

function saveCards(box, board, titles) {
  mkdirSync(join(box.root, 'todos'), { recursive: true });
  const items = titles.map((title, n) => ({ id: `t${n + 1}`, title, notes: '', column: 'todo', terminal: null, owner: 'unassigned', archived: false, createdAt: 1, updatedAt: 1 }));
  writeFileSync(join(box.root, 'todos', `${encodeURIComponent(board)}.json`), JSON.stringify({ version: 1, space: board, items }));
}

test('new workspace --space turns a plain space into a workspace and keeps its cards', (t) => {
  const box = sandbox(t);
  const plain = plainSpace(box);
  saveCards(box, plain, ['Mine']);
  box.clearCalls();
  const folder = box.folder('adopted');
  const manifest = box.json(['new', 'workspace', '--name', 'adopted', '--folder', folder, '--space', plain]);
  assert.deepEqual(box.actions(), []);
  assert.equal(manifest.id, plain);
  assert.deepEqual(manifest.spaces, [plain]);
  assert.deepEqual([manifest.kind, manifest.folder, manifest.stage], ['general', folder, 'discovery']);
  assert.deepEqual(manifest.tabs, [{ tabId: `tb-${plain}`, name: '1', role: null }]);
  assert.deepEqual(manifest.terminals, []);
  assert.equal(box.json(['current', '--terminal', `t-${plain}`]).id, plain);
  assert.deepEqual(box.json(['todo', 'list', '--space', plain]).items.map((item) => item.title), ['Mine']);
  assert.equal(box.json(['parent']).folder, folder);
});

test('new workspace --space takes a space out of its workspace with its terminal records', (t) => {
  const box = sandbox(t);
  const { manifest: from, second } = workspaceWithTwoSpaces(box);
  box.json(['todo', 'add', '--title=Stays', '--space', second]);
  const made = box.json(['new', 'workspace', '--name', 'split', '--folder', box.folder('split'), '--space', second]);
  assert.deepEqual(box.manifest(from.id).spaces, [from.id]);
  assert.equal(box.manifest(from.id).terminals.length, 1);
  assert.deepEqual(made.spaces, [second]);
  assert.equal(made.terminals.length, 1);
  assert.deepEqual(box.json(['todo', 'list', '--space', from.id]).items.map((item) => item.title), ['Stays']);
  assert.deepEqual(box.json(['todo', 'list', '--space', second]).items, []);
});

test('a space that founded a workspace and left it gets a workspace with a fresh id', (t) => {
  const box = sandbox(t);
  const { manifest: first } = workspaceWithTwoSpaces(box);
  box.json(['todo', 'add', '--title=Shared', '--space', first.id]);
  box.json(['space', 'remove', '--space', first.id]);
  saveCards(box, `${first.id}~space`, ['Own']);
  const made = box.json(['new', 'workspace', '--name', 'again', '--folder', box.folder('again'), '--space', first.id]);
  assert.match(made.id, /^ws[0-9a-f]{12}$/);
  assert.deepEqual(made.spaces, [first.id]);
  assert.equal(box.manifest(first.id).name, 'demo');
  assert.deepEqual(box.json(['todo', 'list', '--space', first.id]).items.map((item) => item.title), ['Own']);
  assert.deepEqual(box.json(['todo', 'list', '--space', box.manifest(first.id).spaces[0]]).items.map((item) => item.title), ['Shared']);
});

test('new workspace --space refuses a last space, a Tasks space, a closed space and --tabs', (t) => {
  const box = sandbox(t);
  const manifest = box.app('demo');
  const folder = box.folder('no');
  const last = box.hws(['new', 'workspace', '--name', 'x', '--folder', folder, '--space', manifest.id]);
  assert.equal(last.code, 1);
  assert.match(last.stderr, /only space in demo/);

  const board = box.json(['board', 'add', '--workspace', manifest.id]);
  const tasks = box.hws(['new', 'workspace', '--name', 'x', '--folder', folder, '--space', board.space]);
  assert.equal(tasks.code, 1);
  assert.match(tasks.stderr, /Tasks space stays with demo/);

  const closed = box.hws(['new', 'workspace', '--name', 'x', '--folder', folder, '--space', 'sp-gone']);
  assert.equal(closed.code, 1);
  assert.match(closed.stderr, /no open space sp-gone/);

  const plain = plainSpace(box);
  assert.equal(box.hws(['new', 'workspace', '--name', 'x', '--folder', folder, '--space', plain, '--tabs', 'Plan']).code, 2);
  assert.deepEqual(box.json(['list']).map((item) => item.id), [manifest.id]);
});
