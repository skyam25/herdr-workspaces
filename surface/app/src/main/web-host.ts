/**
 * Serves the renderer over loopback, so any web view can host a surface.
 *
 * The built page is public. Every /api route needs the bearer token, and every request must
 * name this server in its Host header, which stops DNS rebinding. Events reach the page
 * as a stream of server-sent events.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { decodeWire, encodeWire } from '../shared/web-wire';

const MAX_BODY = 64 * 1024 * 1024;
const MAX_QUEUED = 256;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

export interface WebHostOptions {
  root: string;
  token: string;
  invoke(channel: string, args: unknown[]): Promise<unknown>;
  send(channel: string, args: unknown[]): void;
  canInvoke(channel: string): boolean;
  canSend(channel: string): boolean;
}

interface WireCall {
  channel: string;
  args: unknown[];
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function isCall(value: unknown): value is WireCall {
  const call = value as Partial<WireCall> | null;
  return typeof call?.channel === 'string' && Array.isArray(call.args);
}

class TooLarge extends Error {}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new TooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class WebHost {
  private readonly server = http.createServer((req, res) => void this.route(req, res));
  private readonly streams = new Set<http.ServerResponse>();
  private readonly tokenDigest: Buffer;
  private queued: string[] = [];
  private started = false;
  private port = 0;

  constructor(private readonly opts: WebHostOptions) {
    this.tokenDigest = digest(opts.token);
  }

  async listen(): Promise<number> {
    await new Promise<void>((done, fail) => {
      this.server.once('error', fail);
      this.server.listen(0, '127.0.0.1', done);
    });
    this.port = (this.server.address() as AddressInfo).port;
    return this.port;
  }

  /** The address to open. The token stays in the fragment, so it never reaches a request line or a log. */
  url(): string {
    return `http://127.0.0.1:${this.port}/#t=${this.opts.token}`;
  }

  /** Events raised before the page connects wait for it. */
  emit(channel: string, args: unknown[]): void {
    const frame = `data: ${encodeWire({ channel, args })}\n\n`;
    if (!this.started) {
      if (this.queued.length < MAX_QUEUED) this.queued.push(frame);
      return;
    }
    for (const stream of this.streams) stream.write(frame);
  }

  async close(): Promise<void> {
    for (const stream of this.streams) stream.end();
    this.server.closeAllConnections();
    await new Promise<void>((done) => this.server.close(() => done()));
  }

  private allowedHost(req: http.IncomingMessage): boolean {
    return req.headers.host === `127.0.0.1:${this.port}` || req.headers.host === `localhost:${this.port}`;
  }

  private authorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) return false;
    return timingSafeEqual(digest(header.slice('Bearer '.length)), this.tokenDigest);
  }

  private sameOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    return !origin || origin === `http://${req.headers.host}`;
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (!this.allowedHost(req)) return this.fail(res, 403, 'wrong host');
      const path = new URL(req.url ?? '/', 'http://local').pathname;
      if (!path.startsWith('/api/')) return await this.serveFile(req, res, path);
      if (!this.sameOrigin(req)) return this.fail(res, 403, 'wrong origin');
      if (!this.authorized(req)) return this.fail(res, 401, 'bad token');
      if (req.method === 'GET' && path === '/api/events') return this.openStream(res);
      if (req.method === 'POST' && path === '/api/invoke') return await this.invoke(req, res);
      if (req.method === 'POST' && path === '/api/send') return await this.send(req, res);
      this.fail(res, 404, 'no such route');
    } catch (err) {
      if (err instanceof TooLarge) return this.fail(res, 413, 'body too large');
      if (err instanceof SyntaxError || err instanceof URIError) return this.fail(res, 400, 'bad request');
      this.fail(res, 500, (err as Error).message);
    }
  }

  private fail(res: http.ServerResponse, status: number, message: string): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }

  private async serveFile(req: http.IncomingMessage, res: http.ServerResponse, path: string): Promise<void> {
    if (req.method !== 'GET') return this.fail(res, 405, 'read only');
    const root = resolve(this.opts.root);
    const file = resolve(join(root, decodeURIComponent(path === '/' ? '/index.html' : path)));
    if (!file.startsWith(root + sep)) return this.fail(res, 403, 'outside the app');
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return this.fail(res, 404, 'not found');
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  }

  private openStream(res: http.ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    this.streams.add(res);
    res.on('close', () => this.streams.delete(res));
    if (this.started) return;
    this.started = true;
    for (const frame of this.queued) res.write(frame);
    this.queued = [];
  }

  private async readCall(req: http.IncomingMessage): Promise<WireCall | undefined> {
    const call = decodeWire(await readBody(req));
    return isCall(call) ? call : undefined;
  }

  private async invoke(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const call = await this.readCall(req);
    if (!call) return this.fail(res, 400, 'bad call');
    if (!this.opts.canInvoke(call.channel)) return this.fail(res, 404, 'no such channel');
    let reply: unknown;
    try {
      reply = { ok: true, result: await this.opts.invoke(call.channel, call.args) };
    } catch (err) {
      reply = { ok: false, error: (err as Error).message };
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(encodeWire(reply));
  }

  private async send(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const call = await this.readCall(req);
    if (!call) return this.fail(res, 400, 'bad call');
    if (!this.opts.canSend(call.channel)) return this.fail(res, 404, 'no such channel');
    this.opts.send(call.channel, call.args);
    res.writeHead(204);
    res.end();
  }
}
