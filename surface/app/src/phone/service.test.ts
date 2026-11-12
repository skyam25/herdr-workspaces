import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPhoneService, type PhoneService } from './service';

const PNG = 'iVBORw0KGgo=';

let dir: string;
let socket: string;
let port: number;
let exits: number;
let service: PhoneService;
let fingerprint = '';

/** Records each call with what the bundle held, then answers as hws would. Targets and accept answer for one agent terminal, t1. */
function fakeHws(behaviour = "console.log(JSON.stringify({ message: 'Sent to agent' }));"): string {
  const path = join(dir, 'fake-hws');
  writeFileSync(
    path,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const log = (entry) => fs.appendFileSync(${JSON.stringify(join(dir, 'hws.log'))}, JSON.stringify(entry) + '\\n');
if (args[1] === 'targets') {
  log({ args });
  console.log(JSON.stringify({ targets: [{ id: 't1', label: 'demo · Claude Code · t1' }] }));
  process.exit(0);
}
if (args[1] === 'accept') {
  log({ args });
  if (args[3] !== 't1') { console.log(JSON.stringify({ error: 'terminal ' + args[3] + ' does not run an agent' })); process.exit(1); }
  console.log(JSON.stringify({ send: 'p7', label: 'demo · Claude Code · t1', terminal: 't1' }));
  process.exit(0);
}
const bundle = args[args.indexOf('--bundle') + 1];
log({ args, files: fs.readdirSync(bundle).sort(), prompt: fs.readFileSync(bundle + '/prompt.md', 'utf8') });
${behaviour}
`,
  );
  chmodSync(path, 0o755);
  return path;
}

const hwsCalls = () => readFileSync(join(dir, 'hws.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

function control(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, any> }> {
  return new Promise((done, fail) => {
    const req = http.request({ socketPath: socket, path, method }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => done({ status: res.statusCode ?? 0, json: JSON.parse(text) }));
    });
    req.on('error', fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function phone(method: string, path: string, credential?: string, body?: unknown): Promise<{ status: number; text: string }> {
  return new Promise((done, fail) => {
    const req = https.request(
      { host: '127.0.0.1', port, path, method, rejectUnauthorized: false, agent: false, headers: credential ? { authorization: `Bearer ${credential}` } : {} },
      (res) => {
        const seen = createHash('sha256').update((res.socket as TLSSocket).getPeerCertificate(true).raw).digest('base64url');
        if (seen !== fingerprint) fail(new Error('certificate does not match the pairing link'));
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => done({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function begin(hws = fakeHws(), idleMs?: number): Promise<void> {
  service = createPhoneService({
    dataDir: join(dir, 'data'),
    socketPath: socket,
    hws,
    host: '127.0.0.1',
    port: 0,
    names: () => ({ computer: 'Test Mac' }),
    ...(idleMs !== undefined ? { idleMs } : {}),
    onExit: () => (exits += 1),
  });
  expect(await service.start()).toBe(true);
}

async function pair(): Promise<string> {
  const sheet = (await control('POST', '/pair')).json;
  expect(sheet.error).toBeUndefined();
  const link = new URL(sheet.url);
  port = Number(link.searchParams.get('p'));
  fingerprint = link.searchParams.get('f') ?? '';
  expect(link.searchParams.get('m')).toBe('Herdr on Test Mac');
  expect(sheet.qrText.length).toBeGreaterThan(100);
  const res = await phone('POST', '/v1/pair', undefined, { code: link.searchParams.get('c'), deviceName: 'iPhone' });
  expect(res.status).toBe(200);
  await control('DELETE', '/pair');
  return JSON.parse(res.text).credential as string;
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((r) => setTimeout(r, 25));
  expect(check()).toBe(true);
};

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'phone-')));
  socket = join(dir, 'c.sock');
  exits = 0;
});

afterEach(async () => {
  await service.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('phone listener', () => {
  it('returns a page review to hws as a bundle with review.md', async () => {
    await begin();
    const credential = await pair();
    writeFileSync(join(dir, 'index.html'), '<title>x</title><p>hi</p>');

    const handoff = (await control('POST', '/handoffs', { session: 'p1', label: 'demo · Claude Code', page: join(dir, 'index.html'), root: dir, prompt: 'Check this' })).json;
    expect(handoff.sessionLabel).toBe('demo · Claude Code');

    const inbox = JSON.parse((await phone('GET', '/v1/handoffs', credential)).text);
    expect(inbox.handoffs.map((h: { page: string }) => h.page)).toEqual(['index.html']);
    expect((await phone('GET', `/v1/handoffs/${handoff.id}/page/index.html`, credential)).text).toContain('<p>hi</p>');

    const answer = await phone('POST', `/v1/handoffs/${handoff.id}/deliver`, credential, { review: { comments: [], body: 'Tighten the header' }, utterances: [] });
    expect(JSON.parse(answer.text)).toMatchObject({ ok: true, state: 'delivered', message: 'Sent to agent' });

    const [call] = hwsCalls();
    expect(call.args.slice(0, 4)).toEqual(['phone', 'deliver', '--send', 'p1']);
    expect(call.files).toEqual(['prompt.md', 'review.md']);
    expect(call.prompt).not.toContain('.feedback/sketches');
    expect((await control('GET', '/status')).json.handoffs).toEqual([]);
  });

  it('starts a phone on a drawing and returns its sketch without claiming the board changed', async () => {
    await begin();
    const credential = await pair();
    const scene = JSON.stringify({ elements: [{ id: 'a', version: 1 }] });
    writeFileSync(join(dir, 'data', 'boards', 'flow.excalidraw'), scene);

    const handoff = (await control('POST', '/handoffs', { session: 'p2', label: 'demo', board: 'flow' })).json;
    expect(JSON.parse((await phone('GET', `/v1/handoffs/${handoff.id}`, credential)).text).scene).toBe(scene);

    const answer = await phone('POST', `/v1/handoffs/${handoff.id}/deliver`, credential, {
      pngBase64: PNG,
      scene: { elements: [] },
      notes: 'see the arrow',
      strokes: [],
      utterances: [],
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(JSON.parse(answer.text).message).toBe('Sent to agent');

    const [call] = hwsCalls();
    expect(call.files).toEqual(['board.excalidraw', 'notes.md', 'prompt.md', 'sketch.png']);
    expect(call.prompt).toContain('sketch.png');
  });

  it('opens a whiteboard the phone starts through hws phone accept, and delivers it to that send', async () => {
    await begin();
    const credential = await pair();

    expect(JSON.parse((await phone('GET', '/v1/targets', credential)).text)).toEqual({ targets: [{ id: 't1', label: 'demo · Claude Code · t1' }] });
    const gone = await phone('POST', '/v1/handoffs', credential, { target: 't9' });
    expect(gone.status).toBe(404);
    expect(JSON.parse(gone.text).error).toBe('terminal t9 does not run an agent');

    const opened = await phone('POST', '/v1/handoffs', credential, { target: 't1' });
    expect(opened.status).toBe(200);
    const handoff = JSON.parse(opened.text);
    expect(handoff).toMatchObject({ sessionId: 'p7', sessionLabel: 'demo · Claude Code · t1', state: 'open' });
    expect((await control('GET', '/status')).json.handoffs.map((h: { id: string }) => h.id)).toEqual([handoff.id]);

    const answer = await phone('POST', `/v1/handoffs/${handoff.id}/deliver`, credential, {
      pngBase64: PNG,
      scene: { elements: [] },
      notes: 'the plan',
      strokes: [],
      utterances: [],
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(JSON.parse(answer.text).message).toBe('Sent to agent');

    const calls = hwsCalls();
    expect(calls.map((call: { args: string[] }) => call.args.slice(0, 2))).toEqual([['phone', 'targets'], ['phone', 'accept'], ['phone', 'accept'], ['phone', 'deliver']]);
    expect(calls.at(-1).args.slice(0, 4)).toEqual(['phone', 'deliver', '--send', 'p7']);
    expect(calls.at(-1).files).toEqual(['board.excalidraw', 'notes.md', 'prompt.md', 'sketch.png']);
  });

  it('tells the phone to retry when hws fails, and keeps no bundle', async () => {
    await begin(fakeHws("console.log(JSON.stringify({ error: 'manifest is locked' })); process.exit(1);"));
    const credential = await pair();
    writeFileSync(join(dir, 'index.html'), '<p>hi</p>');
    const handoff = (await control('POST', '/handoffs', { session: 'p3', label: 'demo', page: join(dir, 'index.html'), root: dir })).json;

    const answer = await phone('POST', `/v1/handoffs/${handoff.id}/deliver`, credential, { review: { comments: [], body: 'x' }, utterances: [] });

    expect(answer.status).toBe(503);
    expect(answer.text).toContain('manifest is locked');
    expect(readdirSync(join(dir, 'data', 'bundles'))).toEqual([]);
  });

  it('refuses a device without a credential', async () => {
    await begin();
    await pair();
    expect((await phone('GET', '/v1/handoffs', 'nope.nope')).status).toBe(401);
  });

  it('leaves a second listener out', async () => {
    await begin();
    const second = createPhoneService({ dataDir: join(dir, 'other'), socketPath: socket, hws: 'hws', host: '127.0.0.1', port: 0, onExit: () => undefined });
    expect(await second.start()).toBe(false);
    await second.stop();
  });

  it('exits when the last phone is forgotten', async () => {
    await begin();
    await pair();
    const { devices } = (await control('GET', '/status')).json;
    await control('POST', '/forget', { id: devices[0].id });
    await until(() => exits === 1);
    expect(existsSync(socket)).toBe(false);
  });

  it('exits on its own when nothing is paired', async () => {
    await begin(fakeHws(), 20);
    await until(() => exits === 1);
  });
});
