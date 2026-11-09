import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { phoneSocket } from '../paths.js';
import { sandbox } from './helpers.js';

const FAKE_HOST = fileURLToPath(new URL('./fakes/fake-phone-host.cjs', import.meta.url));
const PHONE = { id: 'd1', name: 'iPhone' };

async function withHost(t, box, devices = [PHONE]) {
  const log = join(box.dir, 'phone-log.jsonl');
  writeFileSync(log, '');
  const socket = phoneSocket(box.root);
  const host = spawn(process.execPath, [FAKE_HOST, socket, log, JSON.stringify(devices)], { stdio: ['ignore', 'pipe', 'inherit'] });
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
