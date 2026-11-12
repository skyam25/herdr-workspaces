import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { rewritePaths } from '../artifacts.js';
import { MAX_SEND_BYTES } from '../commands/surface.js';
import { flipToChat, liveFixtures, sandbox } from './helpers.js';

const { space, tab, terminal } = liveFixtures;
const HOST = fileURLToPath(new URL('../../surface/run.sh', import.meta.url));

function hostEnvOf(call) {
  const argv = JSON.parse(call[call.indexOf('--argv') + 1]);
  assert.equal(argv[0], 'env');
  assert.equal(argv.at(-1), HOST);
  return Object.fromEntries(argv.slice(1, -1).map((pair) => {
    const split = pair.indexOf('=');
    return [pair.slice(0, split), pair.slice(split + 1)];
  }));
}

test('surface open splits beside the owning terminal with the host environment', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const [{ terminal: owner, tabId }] = manifest.terminals;
  const ownerPane = box.state().spaces[0].tabs.find((item) => item.id === tabId).terminals[0].pane;

  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'flow', '--terminal', owner]);

  const [call] = box.actions();
  assert.deepEqual(call.slice(0, 8), ['herdr-app', 'do', 'pane.split', '--direction', 'right', '--pane', ownerPane, '--argv']);
  const environment = hostEnvOf(call);
  assert.deepEqual(environment, {
    HWS_HOME: box.root,
    HWS_SURFACE_ID: surface.id,
    HWS_WORKSPACE_ID: manifest.id,
    HWS_TERMINAL: owner,
    HWS_SURFACE_TYPE: 'board',
    HWS_SURFACE_TITLE: 'flow',
    HWS_SURFACE_FILE: '',
    HWS_FOLDER: manifest.folder,
    COMPANION_SOCKET: `/tmp/hws-${surface.id}.sock`,
    COMPANION_DATA_DIR: join(box.root, 'workspaces', manifest.id, 'surfaces', surface.id),
  });
  assert.ok(existsSync(environment.COMPANION_DATA_DIR));

  const [record] = box.manifest(manifest.id).surfaces;
  assert.deepEqual(record, {
    id: surface.id,
    type: 'board',
    title: 'flow',
    terminal: owner,
    pane: surface.pane,
    socket: `/tmp/hws-${surface.id}.sock`,
    pid: 4242,
  });
});

test('surface open passes a note file and defaults the title to its name', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const file = join(manifest.folder, 'notes.md');
  const surface = box.json(['surface', 'open', '--type', 'note', '--in-pane', '--file', file, '--terminal', manifest.terminals[0].terminal]);
  const environment = hostEnvOf(box.actions()[0]);
  assert.equal(environment.HWS_SURFACE_FILE, file);
  assert.equal(surface.title, 'notes.md');
});

test('surface open keeps a page url intact', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['surface', 'open', '--type', 'page', '--file', 'http://localhost:3000/a', '--terminal', manifest.terminals[0].terminal]);
  assert.equal(hostEnvOf(box.actions()[0]).HWS_SURFACE_FILE, 'http://localhost:3000/a');
});

test('surface open defaults to the calling terminal', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  assert.equal(box.json(['surface', 'open', '--type', 'board', '--in-pane'], { HC_TERMINAL_ID: owner }).terminal, owner);
});

test('standalone surface opens a tab in the selected space with no workspace', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])], selected: 'sp1' });

  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'idea', '--standalone']);

  const [call] = box.actions();
  assert.deepEqual(call.slice(0, 10), [
    'herdr-app', 'do', 'tab.new', '--name', 'idea', '--space', 'sp1', '--folder', box.homeDir, '--argv',
  ]);
  const environment = hostEnvOf(call);
  assert.equal(environment.HWS_WORKSPACE_ID, 'standalone');
  assert.equal(environment.HWS_TERMINAL, '');
  assert.equal(environment.HWS_FOLDER, box.homeDir);
  assert.equal(environment.COMPANION_DATA_DIR, join(box.root, 'workspaces', 'standalone', 'surfaces', surface.id));
  const [record] = box.manifest('standalone').surfaces;
  assert.equal(record.terminal, null);
  assert.match(record.pane, /^p/);
});

test('every pane gets a one-line title, the given one or else the file name', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])], selected: 'sp1' });
  let bundles = 0;

  // Each open shows a new file, so none of them finds a pane already open.
  const opened = (args) => {
    const file = join(box.folder(`bundle-${++bundles}`), 'prompt.md');
    writeFileSync(file, 'Apply it.');
    box.clearCalls();
    const surface = box.json(['surface', 'open', '--type', 'page', '--file', file, ...args]);
    const [call] = box.actions();
    return { surface, call, environment: hostEnvOf(call) };
  };

  const named = opened(['--title', 'Task workflow', '--standalone']);
  assert.equal(named.environment.HWS_SURFACE_TITLE, 'Task workflow');
  assert.equal(named.call[named.call.indexOf('--name') + 1], 'Task workflow');

  for (const blank of ['', '   ']) {
    const fallback = opened(['--title', blank, '--standalone']);
    assert.equal(fallback.environment.HWS_SURFACE_TITLE, 'prompt.md');
    assert.equal(fallback.surface.title, 'prompt.md');
  }

  const glued = opened(['--title', 'Two\nlines', '--terminal', 't1']);
  assert.equal(glued.environment.HWS_SURFACE_TITLE, 'Two lines');
});

test('standalone surface in a workspace space belongs to that workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--standalone']);
  assert.equal(surface.workspace, manifest.id);
  assert.equal(hostEnvOf(box.actions()[0]).HWS_FOLDER, manifest.folder);
  assert.equal(box.manifest(manifest.id).surfaces[0].terminal, null);
});

test('surface glued to a normal terminal records under standalone', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])] });
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', 't1']);
  assert.equal(surface.workspace, 'standalone');
  assert.equal(box.manifest('standalone').surfaces[0].terminal, 't1');
});

test('surface open rejects bad usage and unknown terminals', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])] });
  assert.equal(box.hws(['surface', 'open', '--type', 'map', '--terminal', 't1']).code, 2);
  assert.equal(box.hws(['surface', 'open', '--type', 'board', '--in-pane']).code, 2);
  assert.equal(box.hws(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', 't1', '--standalone']).code, 2);
  assert.equal(box.hws(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', 't404']).code, 1);
});

test('surface open splits beside the chat pane of a flipped agent', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { owner, chatPane } = flipToChat(box, manifest);

  const surface = box.json([
    'surface', 'open', '--type', 'board', '--in-pane', '--terminal', owner, '--beside-pane', chatPane, '--space', manifest.id,
  ]);

  const [call] = box.actions();
  assert.deepEqual(call.slice(0, 8), ['herdr-app', 'do', 'pane.split', '--direction', 'right', '--pane', chatPane, '--argv']);
  assert.equal(hostEnvOf(call).HWS_WORKSPACE_ID, manifest.id);
  assert.equal(surface.workspace, manifest.id);
  const [record] = box.manifest(manifest.id).surfaces;
  assert.equal(record.terminal, owner);
  assert.equal(record.pane, surface.pane);
});

test('surface open refuses a pane that does not match the herdr.chat label', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { owner } = flipToChat(box, manifest);
  const notFlipped = box.app('other').terminals[0].terminal;

  for (const terminal of [owner, notFlipped]) {
    const result = box.hws([
      'surface', 'open', '--type', 'board', '--terminal', terminal, '--beside-pane', 'pwrong', '--space', manifest.id,
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stdout + result.stderr, new RegExp(`terminal ${terminal} is not flipped to chat pane pwrong`));
  }
  assert.deepEqual(box.actions(), []);
  assert.deepEqual(box.manifest(manifest.id).surfaces, []);
});

test('surface open requires --beside-pane and --space together', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { owner, chatPane } = flipToChat(box, manifest);
  const open = (extra) => box.hws(['surface', 'open', '--type', 'board', ...extra]);

  assert.equal(open(['--terminal', owner, '--beside-pane', chatPane]).code, 2);
  assert.equal(open(['--terminal', owner, '--space', manifest.id]).code, 2);
  assert.equal(open(['--standalone', '--beside-pane', chatPane, '--space', manifest.id]).code, 2);
  assert.deepEqual(box.actions(), []);
});

test('done focuses the chat pane when the agent flipped after the surface opened', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', owner]);
  const { chatPane } = flipToChat(box, manifest);
  const bundle = box.bundle('bundle-flipped');
  box.clearCalls();

  box.json(['surface', 'done', '--id', surface.id, '--bundle', bundle]);

  assert.deepEqual(box.actions().slice(1), [
    ['herdr-app', 'do', 'pane.close', '--pane', surface.pane],
    ['herdr-app', 'do', 'pane.focus', '--pane', chatPane],
  ]);
});

test('done focuses the terminal when the agent flipped back after the surface opened', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { owner, chatPane } = flipToChat(box, manifest);
  const surface = box.json([
    'surface', 'open', '--type', 'board', '--in-pane', '--terminal', owner, '--beside-pane', chatPane, '--space', manifest.id,
  ]);
  box.setState({ hc: { [owner]: { labels: { 'herdr.chat': '' } } } });
  const bundle = box.bundle('bundle-unflipped');
  box.clearCalls();

  box.json(['surface', 'done', '--id', surface.id, '--bundle', bundle]);

  assert.deepEqual(box.actions().slice(1), [
    ['herdr-app', 'do', 'pane.close', '--pane', surface.pane],
    ['herdr-app', 'do', 'pane.focus', '--terminal', owner],
  ]);
});

test("a flipped agent's board opens in its own window and returns to the chat", (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { owner, chatPane } = flipToChat(box, manifest);

  const surface = box.json([
    'surface', 'open', '--type', 'board', '--terminal', owner, '--beside-pane', chatPane, '--space', manifest.id,
  ]);

  assert.equal(surface.pane, null);
  const run = box.actions().find((call) => call[0] === 'hc' && call[1] === 'run');
  const label = run.find((word) => word.startsWith('HWS_SURFACE_OWNER='));
  assert.match(label, new RegExp(` · ${owner}$`));

  box.clearCalls();
  box.json(['surface', 'focus', '--id', surface.id]);
  assert.deepEqual(box.actions()[0], ['herdr-app', 'do', 'pane.focus', '--pane', chatPane]);

  const bundle = box.bundle('bundle-window');
  box.clearCalls();
  box.json(['surface', 'done', '--id', surface.id, '--bundle', bundle]);
  assert.deepEqual(box.actions().filter((action) => action[2] === 'pane.focus').at(-1), ['herdr-app', 'do', 'pane.focus', '--pane', chatPane]);
});

test('done on a glued surface moves the bundle, sends, closes and focuses', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'flow', '--terminal', owner]);
  const bundle = box.bundle('bundle-a');
  box.clearCalls();

  const result = box.json(['surface', 'done', '--id', surface.id, '--bundle', bundle]);

  const after = box.manifest(manifest.id);
  const [artifact] = after.artifacts;
  const expectedDir = join(manifest.folder, '.herdr-workspace', `${manifest.name}-${manifest.id.slice(-6)}`, 'artifacts', `flow-${artifact.id}`);
  const expectedText = `Look at @${expectedDir}/images/shot.png now.\n`;
  assert.deepEqual(box.actions(), [
    ['hc', 'send', owner, expectedText],
    ['herdr-app', 'do', 'pane.close', '--pane', surface.pane],
    ['herdr-app', 'do', 'pane.focus', '--terminal', owner],
  ]);
  assert.deepEqual(result, { standalone: false, artifact: artifact.id, link: `@${expectedDir}/prompt.md`, delivered: true });
  assert.equal(existsSync(bundle), false);
  assert.equal(readFileSync(join(expectedDir, 'prompt.md'), 'utf8'), expectedText);
  assert.ok(existsSync(join(expectedDir, 'images', 'shot.png')));
  assert.deepEqual(after.surfaces, []);
  assert.deepEqual(
    [artifact.type, artifact.title, artifact.path, artifact.prompt, artifact.fromTerminal],
    ['board', 'flow', expectedDir, join(expectedDir, 'prompt.md'), owner],
  );
});

test('done stores a throwaway artifact in the state root', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const { artifact } = box.finishGlued(manifest);
  assert.equal(artifact.path, join(box.root, 'workspaces', manifest.id, 'artifacts', artifact.id));
  assert.ok(existsSync(artifact.prompt));
});

test('done acts like standalone when the terminal has finished', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', owner]);
  box.setState({ hc: { [owner]: { state: 'finished', exit_code: 0 } } });
  box.clearCalls();

  const result = box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-dead')]);

  const [artifact] = box.manifest(manifest.id).artifacts;
  assert.deepEqual(result, { standalone: true, artifact: artifact.id, link: `@${artifact.prompt}` });
  assert.equal(artifact.fromTerminal, owner);
  assert.deepEqual(box.actions(), []);
});

test('done acts like standalone when hc does not know the terminal', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', owner]);
  box.setState({ hc: { [owner]: 'missing' } });
  box.clearCalls();
  const result = box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-gone')]);
  assert.equal(result.standalone, true);
  assert.deepEqual(box.actions(), []);
});

test('done keeps the pane and reports it when the send fails', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', owner]);
  box.setState({ sendFails: true });
  box.clearCalls();
  const result = box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-busy')]);
  assert.equal(result.standalone, true);
  assert.equal(result.deliveryError, 'terminal is blocked');
  assert.deepEqual(box.actions().map((call) => call[1]), ['send']);
});

test('done on a standalone surface records and prints the link', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])], selected: 'sp1' });
  const surface = box.json(['surface', 'open', '--type', 'note', '--standalone']);
  box.clearCalls();

  const raw = box.hws(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-solo')]);

  const parsed = JSON.parse(raw.stdout);
  const [artifact] = box.manifest('standalone').artifacts;
  assert.deepEqual(parsed, { standalone: true, artifact: artifact.id, link: `@${artifact.prompt}` });
  assert.equal(artifact.path, join(box.root, 'standalone', 'artifacts', artifact.id));
  assert.equal(artifact.fromTerminal, null);
  assert.deepEqual(box.actions(), []);
});

test('a standalone pane keeps its record after done, so it can be found and sent again', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])], selected: 'sp1' });
  const page = join(box.folder('pages'), 'plan.html');
  writeFileSync(page, '<p>plan</p>');
  const surface = box.json(['surface', 'open', '--type', 'page', '--file', page, '--standalone']);

  box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-first')]);
  assert.deepEqual(box.manifest('standalone').surfaces.map((item) => item.id), [surface.id]);

  box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-second')]);
  assert.equal(box.manifest('standalone').artifacts.length, 2);

  box.clearCalls();
  const again = box.json(['surface', 'open', '--type', 'page', '--file', page, '--standalone']);
  assert.equal(again.focused, true);
  assert.deepEqual(box.actions(), [['herdr-app', 'do', 'pane.focus', '--pane', surface.pane]]);
});

test('done sends a link in place of a very long prompt', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', owner]);
  const bundle = box.bundle('bundle-long', 'x'.repeat(MAX_SEND_BYTES + 1));
  box.clearCalls();
  box.json(['surface', 'done', '--id', surface.id, '--bundle', bundle]);
  const [artifact] = box.manifest(manifest.id).artifacts;
  assert.deepEqual(box.actions()[0], ['hc', 'send', owner, `@${artifact.prompt}`]);
});

test('done rejects an unknown surface and a bundle with no prompt', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', manifest.terminals[0].terminal]);
  assert.equal(box.hws(['surface', 'done', '--id', 'nope', '--bundle', box.bundle('b1')]).code, 1);
  const noPrompt = box.folder('empty-bundle');
  assert.equal(box.hws(['surface', 'done', '--id', surface.id, '--bundle', noPrompt]).code, 1);
  assert.ok(existsSync(noPrompt));
  assert.equal(box.hws(['surface', 'done', '--id', surface.id]).code, 2);
});

test('done rewrites the real path when the bundle arrives through a symlink', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', owner]);
  const real = box.bundle('real-bundle');
  const alias = join(box.dir, 'alias-bundle');
  symlinkSync(real, alias);
  box.json(['surface', 'done', '--id', surface.id, '--bundle', alias]);
  const [artifact] = box.manifest(manifest.id).artifacts;
  assert.equal(readFileSync(artifact.prompt, 'utf8').includes(real), false);
  assert.match(readFileSync(artifact.prompt, 'utf8'), new RegExp(`@${artifact.path}/images/shot.png`));
});

test('rewritePaths handles references, siblings, punctuation and spellings', () => {
  const rewrite = (text) => rewritePaths(text, ['/tmp/bundle', '/private/tmp/bundle'], '/new/a1');
  assert.equal(rewrite('@/tmp/bundle/images/a.png'), '@/new/a1/images/a.png');
  assert.equal(rewrite('see /private/tmp/bundle/prompt.md'), 'see /new/a1/prompt.md');
  assert.equal(rewrite('in /tmp/bundle.'), 'in /new/a1.');
  assert.equal(rewrite('![x](/tmp/bundle/a b.png)'), '![x](/new/a1/a b.png)');
  assert.equal(rewrite('/tmp/bundle2/a /tmp/bundle-old/a /tmp/bundle.bak/a'), '/tmp/bundle2/a /tmp/bundle-old/a /tmp/bundle.bak/a');
});

test('rewritePaths quotes @ references when the target has spaces', () => {
  const rewrite = (text) => rewritePaths(text, ['/tmp/b'], '/My Docs/a1');
  assert.equal(rewrite('Look at @/tmp/b/images/a.png.'), 'Look at @"/My Docs/a1/images/a.png".');
  assert.equal(rewrite('@"/tmp/b/prompt.md"'), '@"/My Docs/a1/prompt.md"');
  assert.equal(rewrite('plain /tmp/b/x'), 'plain /My Docs/a1/x');
});

test('rewritePaths handles url-encoded folders', () => {
  const text = rewritePaths('![x](/tmp/my%20b/a.png) @/tmp/my b/a.png', ['/tmp/my b'], '/My Docs/a1');
  assert.equal(text, '![x](/My%20Docs/a1/a.png) @"/My Docs/a1/a.png"');
});

test('surface socket finds the newest surface or the matching title', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const first = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'one', '--terminal', owner]);
  const second = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'two', '--terminal', owner]);

  assert.equal(box.hws(['surface', 'socket', '--terminal', owner]).stdout.trim(), second.socket);
  assert.equal(box.hws(['surface', 'socket'], { HC_TERMINAL_ID: owner }).stdout.trim(), second.socket);
  assert.deepEqual(box.json(['surface', 'socket', '--terminal', owner, '--title', 'one']), {
    socket: first.socket,
    surface: first.id,
  });
  assert.equal(box.hws(['surface', 'socket', '--terminal', owner, '--title', 'none']).code, 1);
  assert.equal(box.hws(['surface', 'socket']).code, 2);
});

test('surface socket finds a surface glued to a normal terminal', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])] });
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', 't1']);
  assert.equal(box.hws(['surface', 'socket', '--terminal', 't1']).stdout.trim(), surface.socket);
});

function openWindow(t) {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['surface', 'open', '--type', 'board', '--title', 'flow', '--terminal', owner]);
  return { box, manifest, owner, surface };
}

test('a board opens in its own window, in a terminal with no pane', (t) => {
  const { box, manifest, owner, surface } = openWindow(t);
  const [call] = box.actions();
  assert.deepEqual(call.slice(0, 9), ['hc', 'run', '--bg', '--json', '--no-parent', '--no-notify', '--rm', '--cwd', manifest.folder]);
  assert.equal(call[9], '--');
  const pairs = Object.fromEntries(call.slice(11, -1).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
  assert.equal(pairs.HWS_SURFACE_WINDOW, '1');
  assert.match(pairs.HWS_SURFACE_OWNER, new RegExp(`· ${owner}$`));
  const [record] = box.manifest(manifest.id).surfaces;
  assert.equal(record.pane, null);
  assert.equal(record.host, 't90');
  assert.equal(surface.hostTerminal, 't90');
});

test('a note opens in a window and a page opens in a pane', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const note = box.json(['surface', 'open', '--type', 'note', '--terminal', owner]);
  assert.deepEqual(box.actions()[0].slice(0, 2), ['hc', 'run']);
  assert.equal(note.pane, null);
  assert.equal(note.host, 't90');

  box.clearCalls();
  const page = box.json(['surface', 'open', '--type', 'page', '--file', 'http://localhost:3000/', '--terminal', owner]);
  assert.equal(box.actions()[0][2], 'pane.split');
  assert.equal(page.host, undefined);
});

test('done on a window sends and shows the terminal, and closes no pane', (t) => {
  const { box, owner, surface } = openWindow(t);
  box.clearCalls();
  const result = box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-w')]);
  assert.equal(result.delivered, true);
  const calls = box.actions();
  assert.equal(calls[0][1], 'send');
  assert.deepEqual(calls[1], ['herdr-app', 'do', 'pane.focus', '--terminal', owner]);
  assert.equal(calls.some((call) => call.includes('pane.close')), false);
});

test('surface focus shows the owning terminal', (t) => {
  const { box, owner, surface } = openWindow(t);
  box.clearCalls();
  assert.deepEqual(box.json(['surface', 'focus', '--id', surface.id]), { focused: owner });
  assert.deepEqual(box.actions()[0], ['herdr-app', 'do', 'pane.focus', '--terminal', owner]);
});

test('surface focus refuses a terminal that has ended', (t) => {
  const { box, owner, surface } = openWindow(t);
  box.setState({ hc: { [owner]: 'missing' } });
  box.clearCalls();
  const result = box.hws(['surface', 'focus', '--id', surface.id, '--json']);
  assert.notEqual(result.code, 0);
  assert.deepEqual(box.actions().filter((call) => call[0] === 'herdr-app' && call[1] === 'do'), []);
});

test('a closed window leaves the manifest at the next prune', (t) => {
  const { box, manifest } = openWindow(t);
  box.setState({ hc: { t90: 'missing' } });
  box.json(['prune']);
  assert.deepEqual(box.manifest(manifest.id).surfaces, []);
});

test('closing a workspace ends its windows', (t) => {
  const { box, manifest } = openWindow(t);
  box.clearCalls();
  box.json(['close', '--workspace', manifest.id]);
  assert.ok(box.actions().some((call) => call[0] === 'hc' && call[1] === 'kill' && call[2] === 't90'));
});

function surfaceData(box, manifest, surface) {
  return join(box.root, 'workspaces', manifest.id, 'surfaces', surface.id);
}

function closeWindowWithDrawing(box, manifest, surface) {
  const boards = join(surfaceData(box, manifest, surface), 'boards');
  mkdirSync(boards, { recursive: true });
  writeFileSync(join(boards, 'Sketch.excalidraw'), JSON.stringify({ elements: [{ id: 'a' }] }));
  box.setState({ hc: { t90: 'missing' } });
}

test('a closed window with a drawing stays as a draft', (t) => {
  const { box, manifest, owner, surface } = openWindow(t);
  closeWindowWithDrawing(box, manifest, surface);
  box.json(['prune']);
  assert.equal(box.manifest(manifest.id).surfaces.length, 1);
  const [listed] = box.json(['surface', 'list']);
  assert.deepEqual([listed.id, listed.terminal, listed.open], [surface.id, owner, false]);
});

test('surface list shows an open window and leaves out an empty closed one', (t) => {
  const { box, surface } = openWindow(t);
  assert.deepEqual(box.json(['surface', 'list']).map((item) => [item.id, item.open]), [[surface.id, true]]);
  box.setState({ hc: { t90: 'missing' } });
  assert.deepEqual(box.json(['surface', 'list']), []);
});

test('a board with only deleted elements is not a draft', (t) => {
  const { box, manifest, surface } = openWindow(t);
  const boards = join(surfaceData(box, manifest, surface), 'boards');
  mkdirSync(boards, { recursive: true });
  writeFileSync(join(boards, 'Sketch.excalidraw'), JSON.stringify({ elements: [{ id: 'a', isDeleted: true }] }));
  box.setState({ hc: { t90: 'missing' } });
  box.json(['prune']);
  assert.deepEqual(box.manifest(manifest.id).surfaces, []);
});

test('resume starts a closed window again on the same id and data', (t) => {
  const { box, manifest, surface } = openWindow(t);
  closeWindowWithDrawing(box, manifest, surface);
  box.clearCalls();
  assert.deepEqual(box.json(['surface', 'resume', '--id', surface.id]), { id: surface.id, resumed: true, host: 't90' });
  const [call] = box.actions();
  assert.deepEqual(call.slice(0, 3), ['hc', 'run', '--bg']);
  const pairs = Object.fromEntries(call.slice(11, -1).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
  assert.equal(pairs.HWS_SURFACE_ID, surface.id);
  assert.equal(pairs.COMPANION_DATA_DIR, surfaceData(box, manifest, surface));
  assert.equal(pairs.HWS_SURFACE_WINDOW, '1');
  assert.equal(box.manifest(manifest.id).surfaces.length, 1);
});

test('resume on an open window starts no second host', (t) => {
  const { box, surface } = openWindow(t);
  box.clearCalls();
  const result = box.json(['surface', 'resume', '--id', surface.id]);
  assert.equal(result.resumed, false);
  assert.deepEqual(box.actions().filter((call) => call[1] === 'run'), []);
});

test('an agent cannot reach a draft through its dead socket', (t) => {
  const { box, manifest, owner, surface } = openWindow(t);
  assert.equal(box.json(['surface', 'socket', '--terminal', owner]).surface, surface.id);
  closeWindowWithDrawing(box, manifest, surface);
  assert.notEqual(box.hws(['surface', 'socket', '--terminal', owner, '--json']).code, 0);
});

test('discard moves a draft to the Trash and drops its record', (t) => {
  const { box, manifest, surface } = openWindow(t);
  closeWindowWithDrawing(box, manifest, surface);
  assert.deepEqual(box.json(['surface', 'discard', '--id', surface.id]), { id: surface.id, discarded: true });
  assert.deepEqual(box.manifest(manifest.id).surfaces, []);
  assert.equal(existsSync(surfaceData(box, manifest, surface)), false);
  assert.ok(existsSync(join(box.trashDir, `0-${surface.id}`)));
  const kept = readdirSync(box.trashDir).find((name) => name.startsWith('1-') && name.endsWith(surface.id));
  assert.ok(existsSync(join(box.trashDir, kept, 'boards', 'Sketch.excalidraw')));
});

test('discard refuses an open window', (t) => {
  const { box, manifest, surface } = openWindow(t);
  assert.notEqual(box.hws(['surface', 'discard', '--id', surface.id, '--json']).code, 0);
  assert.equal(box.manifest(manifest.id).surfaces.length, 1);
});

function runEnvOf(call) {
  return Object.fromEntries(call.slice(11, -1).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
}

const hcRuns = (box) => box.actions().filter((call) => call[0] === 'hc' && call[1] === 'run');

function ownerPaneOf(box, manifest) {
  const [{ terminal: owner, tabId }] = manifest.terminals;
  return box.state().spaces.flatMap((item) => item.tabs).find((item) => item.id === tabId).terminals.find((item) => item.terminal === owner).pane;
}

// A note file in the workspace folder, so its surface has a fixed id.
function noteFile(manifest, name = 'plan.md') {
  const file = join(manifest.folder, name);
  writeFileSync(file, '# Plan');
  return file;
}

test('surface open refuses --window with --in-pane', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const result = box.hws(['surface', 'open', '--type', 'note', '--window', '--in-pane', '--terminal', manifest.terminals[0].terminal]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /use --window or --in-pane, not both/);
  assert.deepEqual(box.actions(), []);
});

test('--window opens a page in a window that stores its file', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const file = noteFile(manifest, 'page.html');
  const surface = box.json(['surface', 'open', '--type', 'page', '--window', '--file', file, '--terminal', manifest.terminals[0].terminal]);
  const [run] = hcRuns(box);
  assert.equal(runEnvOf(run).HWS_SURFACE_FILE, file);
  assert.equal(runEnvOf(run).HWS_SURFACE_WINDOW, '1');
  const [record] = box.manifest(manifest.id).surfaces;
  assert.deepEqual([record.pane, record.host, record.file], [null, 't90', file]);
  assert.equal(surface.file, file);
});

test('reopening a file whose window is open raises it and starts no host', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const file = noteFile(manifest);
  const first = box.json(['surface', 'open', '--type', 'note', '--file', file, '--terminal', owner]);
  box.clearCalls();

  const again = box.json(['surface', 'open', '--type', 'note', '--in-pane', '--file', file, '--terminal', owner]);

  assert.equal(again.id, first.id);
  assert.equal(again.focused, true);
  assert.equal(again.host, 't90');
  assert.deepEqual(box.actions(), []);
  assert.equal(box.manifest(manifest.id).surfaces.length, 1);
});

test('reopening a file whose window closed starts it again and replaces the record', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const file = noteFile(manifest);
  const first = box.json(['surface', 'open', '--type', 'note', '--file', file, '--terminal', owner]);
  box.setState({ hc: { t90: 'missing' } });
  box.clearCalls();

  const again = box.json(['surface', 'open', '--type', 'note', '--file', file, '--terminal', owner]);

  assert.equal(again.id, first.id);
  assert.equal(again.focused, undefined);
  const [run] = hcRuns(box);
  assert.equal(runEnvOf(run).COMPANION_DATA_DIR, surfaceData(box, manifest, first));
  const records = box.manifest(manifest.id).surfaces;
  assert.equal(records.length, 1);
  assert.deepEqual([records[0].host, records[0].file], ['t90', file]);
});

test('reopening a file whose window closed follows --in-pane', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const file = noteFile(manifest);
  box.json(['surface', 'open', '--type', 'note', '--file', file, '--terminal', owner]);
  box.setState({ hc: { t90: 'missing' } });
  box.clearCalls();

  const again = box.json(['surface', 'open', '--type', 'note', '--in-pane', '--file', file, '--terminal', owner]);

  assert.equal(box.actions()[0][2], 'pane.split');
  const records = box.manifest(manifest.id).surfaces;
  assert.equal(records.length, 1);
  assert.equal(records[0].host, undefined);
  assert.equal(records[0].pane, again.pane);
});

test('reopening a file in an open pane focuses it even with --window', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const file = noteFile(manifest, 'page.html');
  const first = box.json(['surface', 'open', '--type', 'page', '--file', file, '--terminal', owner]);
  box.clearCalls();

  const again = box.json(['surface', 'open', '--type', 'page', '--window', '--file', file, '--terminal', owner]);

  assert.equal(again.focused, true);
  assert.deepEqual(box.actions(), [['herdr-app', 'do', 'pane.focus', '--pane', first.pane]]);
});

test('resume passes the window its file', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const file = noteFile(manifest);
  const surface = box.json(['surface', 'open', '--type', 'note', '--file', file, '--terminal', manifest.terminals[0].terminal]);
  box.setState({ hc: { t90: 'missing' } });
  box.clearCalls();

  box.json(['surface', 'resume', '--id', surface.id]);

  assert.equal(runEnvOf(hcRuns(box)[0]).HWS_SURFACE_FILE, file);
});

test('pop moves a pane into a window on the same id, data and file', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const file = noteFile(manifest, 'page.html');
  const surface = box.json(['surface', 'open', '--type', 'page', '--file', file, '--title', 'Plan', '--terminal', owner]);
  box.clearCalls();

  const result = box.json(['surface', 'pop', '--id', surface.id, '--to', 'window']);

  assert.deepEqual(result, { id: surface.id, shown: 'window', moved: true, host: 't90' });
  const actions = box.actions();
  assert.deepEqual(actions[0], ['herdr-app', 'do', 'pane.close', '--pane', surface.pane]);
  const environment = runEnvOf(actions[1]);
  assert.deepEqual(
    [environment.HWS_SURFACE_ID, environment.COMPANION_DATA_DIR, environment.HWS_SURFACE_TITLE, environment.HWS_SURFACE_FILE, environment.HWS_SURFACE_WINDOW],
    [surface.id, surfaceData(box, manifest, surface), 'Plan', file, '1'],
  );
  assert.match(environment.HWS_SURFACE_OWNER, new RegExp(`· ${owner}$`));
  const records = box.manifest(manifest.id).surfaces;
  assert.equal(records.length, 1);
  assert.deepEqual(
    [records[0].id, records[0].terminal, records[0].pane, records[0].host, records[0].file, records[0].socket],
    [surface.id, owner, null, 't90', file, surface.socket],
  );
});

test('pop moves a window back into a pane beside its owner', (t) => {
  const { box, manifest, owner, surface } = openWindow(t);
  box.clearCalls();

  const result = box.json(['surface', 'pop', '--id', surface.id]);

  const actions = box.actions();
  assert.deepEqual(actions[0], ['hc', 'kill', 't90']);
  assert.deepEqual(actions[1].slice(0, 8), ['herdr-app', 'do', 'pane.split', '--direction', 'right', '--pane', ownerPaneOf(box, manifest), '--argv']);
  const environment = hostEnvOf(actions[1]);
  assert.equal(environment.HWS_SURFACE_WINDOW, undefined);
  assert.equal(environment.HWS_SURFACE_ID, surface.id);
  assert.equal(environment.HWS_TERMINAL, owner);
  const [record] = box.manifest(manifest.id).surfaces;
  assert.deepEqual(result, { id: surface.id, shown: 'pane', moved: true, pane: record.pane });
  assert.equal(record.host, undefined);
  assert.match(record.pane, /^p/);
});

test('pop to a pane from a closed window starts the pane and kills nothing', (t) => {
  const { box, manifest, surface } = openWindow(t);
  closeWindowWithDrawing(box, manifest, surface);
  box.clearCalls();

  box.json(['surface', 'pop', '--id', surface.id, '--to', 'pane']);

  assert.deepEqual(box.actions().map((call) => call[2] ?? call[1]), ['pane.split']);
});

test('pop to a pane splits beside the chat pane of a flipped owner', (t) => {
  const { box, manifest, surface } = openWindow(t);
  const { chatPane } = flipToChat(box, manifest);
  box.clearCalls();

  box.json(['surface', 'pop', '--id', surface.id, '--to', 'pane']);

  const split = box.actions().find((call) => call[2] === 'pane.split');
  assert.equal(split[split.indexOf('--pane') + 1], chatPane);
});

test('pop to a pane opens a tab when the owner has ended', (t) => {
  const { box, manifest, owner, surface } = openWindow(t);
  box.setState({ hc: { [owner]: 'missing' } });
  box.clearCalls();

  const result = box.json(['surface', 'pop', '--id', surface.id, '--to', 'pane']);

  const opened = box.actions().find((call) => call[2] === 'tab.new');
  assert.deepEqual(opened.slice(0, 8), ['herdr-app', 'do', 'tab.new', '--name', 'flow', '--space', manifest.id, '--folder']);
  assert.equal(hostEnvOf(opened).HWS_TERMINAL, owner);
  assert.equal(box.manifest(manifest.id).surfaces[0].pane, result.pane);
});

test('pop moves a standalone surface both ways', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])], selected: 'sp1' });
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'idea', '--standalone']);
  box.clearCalls();

  assert.equal(box.json(['surface', 'pop', '--id', surface.id]).shown, 'window');
  const environment = runEnvOf(hcRuns(box)[0]);
  assert.deepEqual([environment.HWS_SURFACE_WINDOW, environment.HWS_SURFACE_OWNER, environment.HWS_TERMINAL], ['1', '', '']);

  box.clearCalls();
  assert.equal(box.json(['surface', 'pop', '--id', surface.id]).shown, 'pane');
  const opened = box.actions().find((call) => call[2] === 'tab.new');
  assert.deepEqual(opened.slice(0, 7), ['herdr-app', 'do', 'tab.new', '--name', 'idea', '--space', 'sp1']);
  const [record] = box.manifest('standalone').surfaces;
  assert.equal(record.host, undefined);
  assert.match(record.pane, /^p/);
});

test('pop to where a surface already is shows it and moves nothing', (t) => {
  const { box, surface } = openWindow(t);
  box.clearCalls();
  assert.deepEqual(box.json(['surface', 'pop', '--id', surface.id, '--to', 'window']), { id: surface.id, shown: 'window', moved: false });
  assert.deepEqual(box.actions(), []);

  const inPane = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', surface.terminal]);
  box.clearCalls();
  assert.deepEqual(box.json(['surface', 'pop', '--id', inPane.id, '--to', 'pane']), { id: inPane.id, shown: 'pane', moved: false });
  assert.deepEqual(box.actions(), [['herdr-app', 'do', 'pane.focus', '--pane', inPane.pane]]);
});

test('pop to a closed window starts it again on its data', (t) => {
  const { box, manifest, surface } = openWindow(t);
  closeWindowWithDrawing(box, manifest, surface);
  box.clearCalls();
  assert.equal(box.json(['surface', 'pop', '--id', surface.id, '--to', 'window']).moved, false);
  assert.equal(hcRuns(box).length, 1);
});

test('pop kills a pane host that does not end by itself before starting the window', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', manifest.terminals[0].terminal]);
  const paneHost = surface.hostTerminal;
  box.setState({ closeKeepsTerminal: true });
  box.clearCalls();

  box.json(['surface', 'pop', '--id', surface.id]);

  assert.deepEqual(box.actions().map((call) => call.slice(0, 3)), [
    ['herdr-app', 'do', 'pane.close'],
    ['hc', 'kill', paneHost],
    ['hc', 'run', '--bg'],
  ]);
});

test('pop refuses bad usage, an unknown surface and a closed pane', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', manifest.terminals[0].terminal]);
  assert.equal(box.hws(['surface', 'pop']).code, 2);
  assert.equal(box.hws(['surface', 'pop', '--id', surface.id, '--to', 'tab']).code, 2);
  assert.equal(box.hws(['surface', 'pop', '--id', 'nope']).code, 1);

  box.setState({ spaces: box.state().spaces.map((item) => ({ ...item, tabs: item.tabs.map((one) => ({ ...one, terminals: one.terminals.filter((record) => record.pane !== surface.pane) })) })) });
  box.clearCalls();
  const closed = box.hws(['surface', 'pop', '--id', surface.id]);
  assert.equal(closed.code, 1);
  assert.match(closed.stderr, /has no open pane/);
  assert.deepEqual(box.actions(), []);
});

test('pop finishes the move when its stdout closes early', async (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', manifest.terminals[0].terminal]);
  const child = spawn(fileURLToPath(new URL('../../bin/hws', import.meta.url)), ['surface', 'pop', '--id', surface.id, '--json'], { env: box.environment, stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.destroy();
  const code = await new Promise((done) => child.on('exit', done));
  assert.equal(code, 0);
  const [record] = box.manifest(manifest.id).surfaces;
  assert.deepEqual([record.pane, record.host], [null, 't90']);
});
