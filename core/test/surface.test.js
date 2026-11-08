import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { rewritePaths } from '../artifacts.js';
import { MAX_SEND_BYTES } from '../commands/surface.js';
import { liveFixtures, sandbox } from './helpers.js';

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
  const surface = box.json(['surface', 'open', '--type', 'note', '--file', file, '--terminal', manifest.terminals[0].terminal]);
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
  const expectedDir = join(manifest.folder, '.herdr-workspace', `${manifest.name}-${manifest.id.slice(-6)}`, 'artifacts', artifact.id);
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
  assert.deepEqual(box.manifest('standalone').surfaces, []);
  assert.deepEqual(box.actions(), []);
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

test('notes and pages stay in a pane', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['surface', 'open', '--type', 'note', '--terminal', manifest.terminals[0].terminal]);
  assert.equal(box.actions()[0][2], 'pane.split');
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
