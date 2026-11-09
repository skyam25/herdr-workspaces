import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { phoneSocket } from '../paths.js';
import { sandbox } from './helpers.js';

const FAKE_HOST = fileURLToPath(new URL('./fakes/fake-phone-host.cjs', import.meta.url));
const HWS = fileURLToPath(new URL('../../bin/hws', import.meta.url));
const AS_TTY = 'data:text/javascript,process.stdout.isTTY=true';
const PHONE = { id: 'd1', name: 'iPhone' };

async function withHost(t, box, devices = [PHONE], pairing = 'pairs') {
  const log = join(box.dir, 'phone-log.jsonl');
  writeFileSync(log, '');
  const socket = phoneSocket(box.root);
  const host = spawn(process.execPath, [FAKE_HOST, socket, log, JSON.stringify(devices), pairing], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => {
    host.kill();
    rmSync(socket, { force: true });
  });
  await once(host.stdout, 'data');
  return { requests: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}

const handoffOf = (host) => host.requests().find((item) => item.key === 'POST /handoffs').body;

function appWith(box, name, content) {
  const manifest = box.app();
  const file = join(manifest.folder, name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  return { manifest, file, terminal: manifest.terminals[0].terminal };
}

const send = (box, file, terminal) => box.json(['phone', 'send', file, '--terminal', terminal]);
const sendRecord = (box, id) => JSON.parse(readFileSync(join(box.root, 'phone', 'sends', `${id}.json`), 'utf8'));
const SCENE = JSON.stringify({ type: 'excalidraw', elements: [{ id: 'a', version: 1 }] });

test('phone send hands a page over with the workspace folder as its root', async (t) => {
  const box = sandbox(t);
  const host = await withHost(t, box);
  const { manifest, file, terminal } = appWith(box, 'site/index.html', '<p>hi</p>');

  const result = send(box, file, terminal);

  const body = handoffOf(host);
  assert.equal(body.page, file);
  assert.equal(body.root, realpathSync(manifest.folder));
  assert.equal(body.session, result.send);
  assert.equal(sendRecord(box, result.send).workspace, manifest.id);
  assert.equal(sendRecord(box, result.send).terminal, terminal);
});

test('a page under a dot folder serves from its own folder', async (t) => {
  const box = sandbox(t);
  const host = await withHost(t, box);
  const { file, terminal } = appWith(box, '.herdr-workspace/demo/artifacts/report.html', '<p>hi</p>');

  send(box, file, terminal);

  assert.equal(handoffOf(host).root, join(file, '..'));
});

test('phone send copies a drawing, so later edits leave the phone copy alone', async (t) => {
  const box = sandbox(t);
  const host = await withHost(t, box);
  const { file, terminal } = appWith(box, 'flow.excalidraw', SCENE);

  send(box, file, terminal);
  writeFileSync(file, '{}');

  const body = handoffOf(host);
  assert.equal(body.board, 'flow');
  assert.equal(body.page, undefined);
  assert.deepEqual(JSON.parse(readFileSync(join(box.root, 'phone', 'boards', 'flow.excalidraw'), 'utf8')), JSON.parse(SCENE));
});

test('phone send takes an artifact id and finds the drawing in its bundle', async (t) => {
  const box = sandbox(t);
  const host = await withHost(t, box);
  const manifest = box.app();
  const { artifact } = box.finishGlued(manifest);
  writeFileSync(join(artifact.path, 'board.excalidraw'), SCENE);

  send(box, artifact.id, manifest.terminals[0].terminal);

  assert.equal(handoffOf(host).board, 'board');
});

test('phone send refuses a file the phone cannot open', async (t) => {
  const box = sandbox(t);
  await withHost(t, box);
  const { file, terminal } = appWith(box, 'notes.md', '# hi');

  const result = box.hws(['phone', 'send', file, '--terminal', terminal]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /opens \.html and \.excalidraw/);
});

test('phone send refuses until a phone is paired', async (t) => {
  const box = sandbox(t);
  await withHost(t, box, []);
  const { file, terminal } = appWith(box, 'index.html', '<p>hi</p>');

  const result = box.hws(['phone', 'send', file, '--terminal', terminal]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /hws phone pair/);
});

function delivered(box, t, foreground) {
  return async () => {
    await withHost(t, box);
    const { manifest, file, terminal } = appWith(box, 'index.html', '<p>hi</p>');
    box.setState({ hc: { [terminal]: foreground } });
    const { send: id } = send(box, file, terminal);
    box.clearCalls();
    const bundle = box.bundle('answer', 'Look at the review.\n');
    const result = box.json(['phone', 'deliver', '--send', id, '--bundle', bundle]);
    return { result, manifest, terminal, file, sends: box.actions().filter((call) => call[1] === 'send') };
  };
}

test('an answer reaches a terminal that still runs an agent and becomes an artifact', async (t) => {
  const box = sandbox(t);
  const { result, manifest, terminal, file, sends } = await delivered(box, t, { foreground: { name: 'claude', argv: ['claude'] } })();

  assert.equal(result.delivered, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][2], terminal);
  assert.match(sends[0][3], new RegExp(`^From the phone, about ${file}`));
  const artifact = box.manifest(manifest.id).artifacts.at(-1);
  assert.equal(artifact.id, result.artifact);
  assert.equal(artifact.type, 'page');
  assert.equal(artifact.fromTerminal, terminal);
  assert.equal(existsSync(join(artifact.path, 'prompt.md')), true);
});

test('an answer is not typed into a bare shell', async (t) => {
  const box = sandbox(t);
  const { result, manifest, sends } = await delivered(box, t, { foreground: { name: 'zsh', argv: ['-zsh'] } })();

  assert.equal(result.delivered, false);
  assert.match(result.message, /no longer runs an agent/);
  assert.deepEqual(sends, []);
  assert.equal(box.manifest(manifest.id).artifacts.at(-1).id, result.artifact);
});

test('an answer for an ended terminal stays as an artifact', async (t) => {
  const box = sandbox(t);
  const { result, sends } = await delivered(box, t, 'missing')();

  assert.equal(result.delivered, false);
  assert.match(result.message, /has ended/);
  assert.deepEqual(sends, []);
});

test('phone status reports no phone without starting a listener', (t) => {
  const box = sandbox(t);

  const status = box.json(['phone', 'status']);

  assert.deepEqual(status, { running: false, paired: false, devices: [], handoffs: [] });
  assert.deepEqual(box.actions(), []);
});

test('phone pair outside a terminal opens a tab that shows the code', async (t) => {
  const box = sandbox(t);
  box.app();

  box.json(['phone', 'pair']);

  const [call] = box.actions().filter((item) => item[2] === 'tab.new');
  const argv = JSON.parse(call[call.indexOf('--argv') + 1]);
  assert.deepEqual(argv.slice(-3), ['phone', 'pair', '--tab']);
});

test('phone forget needs a name that matches one phone', async (t) => {
  const box = sandbox(t);
  const host = await withHost(t, box);

  assert.equal(box.hws(['phone', 'forget', 'iPad']).code, 2);
  box.json(['phone', 'forget', 'iPhone']);

  assert.deepEqual(host.requests().find((item) => item.key === 'POST /forget').body, { id: 'd1' });
});

test('phone send takes index.html from a folder of pages', async (t) => {
  const box = sandbox(t);
  const host = await withHost(t, box);
  const { manifest, file, terminal } = appWith(box, 'site/index.html', '<p>hi</p>');
  writeFileSync(join(manifest.folder, 'site', 'other.html'), '<p>other</p>');

  send(box, join(manifest.folder, 'site'), terminal);

  assert.equal(handoffOf(host).page, file);
});

test('phone send takes the only page in a folder', async (t) => {
  const box = sandbox(t);
  const host = await withHost(t, box);
  const { manifest, file, terminal } = appWith(box, 'site/report.htm', '<p>hi</p>');

  send(box, join(manifest.folder, 'site'), terminal);

  assert.equal(handoffOf(host).page, file);
});

test('phone send refuses a folder with several pages and no index', async (t) => {
  const box = sandbox(t);
  await withHost(t, box);
  const { manifest, terminal } = appWith(box, 'site/a.html', '<p>a</p>');
  writeFileSync(join(manifest.folder, 'site', 'b.html'), '<p>b</p>');

  const result = box.hws(['phone', 'send', join(manifest.folder, 'site'), '--terminal', terminal]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /no drawing and no single page/);
});

for (const [name, content, message] of [
  ['broken JSON', 'not json', /is not valid JSON/],
  ['a file with no elements', '{"elements":1}', /is not an Excalidraw scene/],
]) {
  test(`phone send refuses a drawing with ${name}`, async (t) => {
    const box = sandbox(t);
    await withHost(t, box);
    const { file, terminal } = appWith(box, 'flow.excalidraw', content);

    const result = box.hws(['phone', 'send', file, '--terminal', terminal]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, message);
  });
}

test('phone send clears records older than 90 days and keeps newer ones', async (t) => {
  const box = sandbox(t);
  await withHost(t, box);
  const { file, terminal } = appWith(box, 'index.html', '<p>hi</p>');
  const folder = join(box.root, 'phone', 'sends');
  mkdirSync(folder, { recursive: true });
  const [old, recent] = [join(folder, 'old.json'), join(folder, 'recent.json')];
  writeFileSync(old, '{}');
  writeFileSync(recent, '{}');
  const longAgo = new Date(Date.now() - 91 * 24 * 3600_000);
  utimesSync(old, longAgo, longAgo);

  send(box, file, terminal);

  assert.equal(existsSync(old), false);
  assert.equal(existsSync(recent), true);
});

test('an answer the terminal will not take stays as an artifact', async (t) => {
  const box = sandbox(t);
  box.setState({ sendFails: true });

  const { result, manifest } = await delivered(box, t, { foreground: { name: 'claude', argv: ['claude'] } })();

  assert.equal(result.delivered, false);
  assert.match(result.message, /did not take it \(terminal is blocked\)/);
  assert.equal(box.manifest(manifest.id).artifacts.at(-1).id, result.artifact);
});

test('phone status lists paired phones and waiting handoffs', async (t) => {
  const box = sandbox(t);
  await withHost(t, box);

  assert.equal(box.hws(['phone', 'status']).stdout, 'Paired: iPhone\nWaiting on the phone: 0\n');
});

test('phone status with a listener and no phone says so', async (t) => {
  const box = sandbox(t);
  await withHost(t, box, []);

  assert.match(box.hws(['phone', 'status']).stdout, /^No phone is paired\. Run hws phone pair\.\n/);
});

test('phone stop asks a running listener to stop', async (t) => {
  const box = sandbox(t);
  const host = await withHost(t, box);

  assert.equal(box.json(['phone', 'stop']).stopped, true);
  assert.ok(host.requests().some((item) => item.key === 'POST /stop'));
});

test('phone stop with no listener reports that', (t) => {
  const box = sandbox(t);

  assert.equal(box.json(['phone', 'stop']).stopped, false);
});

// Pairing shows the code only when stdout is a terminal.
function pairAtTerminal(box, flags = [], env = {}) {
  const result = spawnSync(process.execPath, ['--import', AS_TTY, HWS, 'phone', 'pair', ...flags], { env: { ...box.environment, ...env }, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('phone pair shows the code, waits for a new device and closes the code', async (t) => {
  const box = sandbox(t);
  const host = await withHost(t, box);

  const result = pairAtTerminal(box);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /QR-CODE/);
  assert.match(result.stdout, /same network \(Home\)/);
  assert.match(result.stdout, /agentbrief:\/\/pair\/abc/);
  assert.match(result.stdout, /Paired New iPad\./);
  assert.equal(host.requests().at(-1).key, 'DELETE /pair');
});

test('a replaced pairing code fails and closes its own tab', async (t) => {
  const box = sandbox(t);
  await withHost(t, box, [PHONE], 'replaced');
  const manifest = box.app();
  const terminal = manifest.terminals[0].terminal;

  const result = pairAtTerminal(box, ['--tab'], { HC_TERMINAL_ID: terminal });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /This pairing code was replaced or closed\./);
  assert.equal(box.actions().filter((call) => call.includes('tab.close')).length, 1);
});

test('phone pair reports the reason the listener gives no code', async (t) => {
  const box = sandbox(t);
  await withHost(t, box, [PHONE], 'refused');

  const result = pairAtTerminal(box);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /pairing is busy/);
});
