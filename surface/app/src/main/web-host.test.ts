import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreloadApi } from '../preload/api';
import { createWebTransport, type WebTransport } from '../renderer/web-companion';
import { CH, IPC_INVOKE, IPC_SEND } from '../shared/ipc';
import { decodeWire, encodeWire } from '../shared/web-wire';
import { WebHost } from './web-host';

const TOKEN = 'secret-token';

let host: WebHost | undefined;
let transport: WebTransport | undefined;

afterEach(async () => {
  transport?.stop();
  await host?.close();
  host = transport = undefined;
});

function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'web-host-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<h1>app</h1>');
  writeFileSync(join(root, 'assets/app.js'), 'run()');
  writeFileSync(join(root, '..', 'web-host-secret.txt'), 'private');
  return root;
}

async function start(handlers: Partial<{ invoke: (c: string, a: unknown[]) => Promise<unknown>; send: (c: string, a: unknown[]) => void }> = {}) {
  host = new WebHost({
    root: appRoot(),
    token: TOKEN,
    invoke: handlers.invoke ?? (async () => undefined),
    send: handlers.send ?? (() => {}),
    canInvoke: (channel) => channel !== 'blocked',
    canSend: (channel) => channel !== 'blocked',
  });
  const port = await host.listen();
  return { port, base: `http://127.0.0.1:${port}` };
}

const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function post(base: string, path: string, body: string, headers: Record<string, string> = auth) {
  return fetch(`${base}${path}`, { method: 'POST', headers, body });
}

/** Sends a raw request, because fetch refuses to set Host and normalizes dot segments. */
function raw(port: number, path: string, hostHeader: string): Promise<number> {
  return new Promise((done, fail) => {
    const req = request({ port, path, host: '127.0.0.1', headers: { host: hostHeader } }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', fail);
    req.end();
  });
}

describe('web wire', () => {
  it('keeps bytes, Buffers and undefined arguments', () => {
    const decoded = decodeWire(encodeWire({ args: [new Uint8Array([1, 2, 255]), undefined, null, Buffer.from([7])] })) as { args: unknown[] };
    expect(decoded.args[0]).toEqual(new Uint8Array([1, 2, 255]));
    expect(decoded.args[1]).toBeUndefined();
    expect(decoded.args[2]).toBeNull();
    expect(decoded.args[3]).toEqual(new Uint8Array([7]));
    expect(decoded.args).toHaveLength(4);
  });

  it('carries a large byte array', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(decodeWire(encodeWire(bytes))).toEqual(bytes);
  });

  it('rejects an unknown tag', () => {
    expect(() => decodeWire('{"$hws":"nope"}')).toThrow(/unknown wire tag/);
  });
});

describe('WebHost', () => {
  it('serves the page and its assets without a token', async () => {
    const { base } = await start();
    const page = await fetch(`${base}/`);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toBe('<h1>app</h1>');
    expect(await (await fetch(`${base}/assets/app.js`)).text()).toBe('run()');
  });

  it('never serves a file outside the app', async () => {
    const { port } = await start();
    expect(await raw(port, '/../web-host-secret.txt', `127.0.0.1:${port}`)).toBe(404);
    expect(await raw(port, '/..%2fweb-host-secret.txt', `127.0.0.1:${port}`)).toBe(403);
  });

  it('refuses a foreign Host header', async () => {
    const { port } = await start();
    expect(await raw(port, '/', 'evil.example')).toBe(403);
    expect(await raw(port, '/', `127.0.0.1:${port + 1}`)).toBe(403);
  });

  it('refuses API calls without the right token', async () => {
    const invoke = vi.fn(async () => 1);
    const { base } = await start({ invoke });
    const call = encodeWire({ channel: 'a', args: [] });
    expect((await post(base, '/api/invoke', call, { 'content-type': 'application/json' })).status).toBe(401);
    expect((await post(base, '/api/invoke', call, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await fetch(`${base}/api/events`)).status).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses a call from another origin even with the token', async () => {
    const invoke = vi.fn(async () => 1);
    const { base } = await start({ invoke });
    const response = await post(base, '/api/invoke', encodeWire({ channel: 'a', args: [] }), { ...auth, origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses channels the app did not register', async () => {
    const { base } = await start();
    const call = encodeWire({ channel: 'blocked', args: [] });
    expect((await post(base, '/api/invoke', call)).status).toBe(404);
    expect((await post(base, '/api/send', call)).status).toBe(404);
  });

  it('answers malformed bodies with 400', async () => {
    const { base } = await start();
    expect((await post(base, '/api/invoke', '{nope')).status).toBe(400);
    expect((await post(base, '/api/invoke', '{"channel":3}')).status).toBe(400);
  });
});

describe('transport against WebHost', () => {
  const connect = (base: string) => {
    transport = createWebTransport(base, TOKEN);
    return transport;
  };

  it('runs invoke with bytes both ways through the preload API', async () => {
    const invoke = vi.fn(async (_c: string, args: unknown[]) => args[0]);
    const { base } = await start({ invoke });
    const api = createPreloadApi(connect(base)) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const clip = { data: new Uint8Array([9, 8, 7]), mimeType: 'audio/webm' };
    await expect(api.transcribeClip!(clip)).resolves.toEqual(clip);
    expect(invoke).toHaveBeenCalledWith(IPC_INVOKE.transcribeClip, [clip]);
  });

  it('rejects when the handler throws', async () => {
    const { base } = await start({ invoke: async () => { throw new Error('no such board'); } });
    await expect(connect(base).invoke('a')).rejects.toThrow('no such board');
  });

  it('delivers sends in order', async () => {
    const got: unknown[] = [];
    const { base } = await start({ send: (_c, args) => got.push(args[0]) });
    const t = connect(base);
    for (let i = 0; i < 20; i++) t.send(IPC_SEND.ready, i);
    await vi.waitFor(() => expect(got).toHaveLength(20));
    expect(got).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('holds events raised before the page connects', async () => {
    const { base } = await start();
    host!.emit(CH.surface, [{ early: true }]);
    const seen = new Promise((done) => {
      const t = connect(base);
      t.on(CH.surface, (_e, value) => done(value));
    });
    await expect(seen).resolves.toEqual({ early: true });
  });

  it('streams events after the page connects and honors removeListener', async () => {
    const { base } = await start();
    const t = connect(base);
    const first = vi.fn();
    const seen = new Promise((done) => t.on(CH.theme, (_e, value) => done(value)));
    t.on(CH.theme, first);
    t.removeListener(CH.theme, first);
    await vi.waitFor(async () => { host!.emit(CH.theme, ['dark']); await expect(Promise.race([seen, Promise.reject(new Error('wait'))])).resolves.toBe('dark'); });
    expect(first).not.toHaveBeenCalled();
  });
});
