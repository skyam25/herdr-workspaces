import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OVERLAY_PATH } from './review-protocol';
import { ReviewWebServer } from './review-web';

const ANCESTOR = 'http://127.0.0.1:4100';

let server: ReviewWebServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function project(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `review-web-${name}-`));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'page.html'), '<html><head><title>p</title></head><body><h1>Plan</h1></body></html>');
  writeFileSync(join(root, 'assets/app.js'), 'run()');
  writeFileSync(join(root, '.git/config'), 'secret');
  return root;
}

function start(): ReviewWebServer {
  const dir = mkdtempSync(join(tmpdir(), 'review-web-overlay-'));
  const overlayFile = join(dir, 'overlay.js');
  writeFileSync(overlayFile, '/* overlay */');
  server = new ReviewWebServer({ overlayFile, frameAncestor: () => ANCESTOR });
  return server;
}

/** A raw GET, so the test can set Host and the fetch metadata headers. */
function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const target = new URL(url);
  return new Promise((done, fail) => {
    const req = request({ host: target.hostname, port: target.port, path: target.pathname, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

describe('ReviewWebServer', () => {
  it('serves a page with the overlay and its assets from the project', async () => {
    const reviews = start();
    const url = await reviews.urlFor(project('a'), 'page.html');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/page\.html$/);

    const page = await get(url);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.body).toContain(`<script src="${OVERLAY_PATH}"`);
    expect(page.body).toContain('<h1');
    expect(page.headers['content-security-policy']).toBe(`frame-ancestors ${ANCESTOR}`);
    expect(page.headers['cross-origin-resource-policy']).toBe('same-site');

    const origin = new URL(url).origin;
    expect((await get(`${origin}/assets/app.js`)).body).toBe('run()');
    expect((await get(`${origin}${OVERLAY_PATH}`)).body).toBe('/* overlay */');
  });

  it('gives each project its own origin and keeps one per project', async () => {
    const reviews = start();
    const a = project('a');
    const first = new URL(await reviews.urlFor(a, 'page.html')).origin;
    const again = new URL(await reviews.urlFor(a, 'assets/app.js')).origin;
    const other = new URL(await reviews.urlFor(project('b'), 'page.html')).origin;
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it('maps an address it gave out back to its project and file', async () => {
    const reviews = start();
    const root = project('a');
    const url = await reviews.urlFor(root, 'docs/my plan.html');
    expect(reviews.pageOf(url)).toEqual({ root, path: 'docs/my plan.html' });
    expect(reviews.pageOf('http://127.0.0.1:1/page.html')).toBeUndefined();
    expect(reviews.pageOf('http://localhost:5173/')).toBeUndefined();
    expect(reviews.pageOf('not a url')).toBeUndefined();
  });

  it('encodes each path segment', async () => {
    const reviews = start();
    const root = project('a');
    writeFileSync(join(root, 'my plan.html'), '<p>x</p>');
    const url = await reviews.urlFor(root, 'my plan.html');
    expect(url).toMatch(/\/my%20plan\.html$/);
    expect((await get(url)).status).toBe(200);
  });

  it('refuses dot folders, paths outside the project, another host and cross-site requests', async () => {
    const reviews = start();
    const url = new URL(await reviews.urlFor(project('a'), 'page.html'));
    expect((await get(`${url.origin}/.git/config`)).status).toBe(404);
    expect((await get(`${url.origin}/../../etc/hosts`)).status).toBe(404);
    expect((await get(url.href, { host: `evil.test:${url.port}` })).status).toBe(403);
    expect((await get(url.href, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await get(url.href, { 'sec-fetch-site': 'same-site' })).status).toBe(200);
    expect((await get(url.href, { host: `localhost:${url.port}` })).status).toBe(200);
  });

  it('refuses writes', async () => {
    const reviews = start();
    const url = await reviews.urlFor(project('a'), 'page.html');
    expect((await fetch(url, { method: 'POST', body: 'x' })).status).toBe(405);
  });

  it('stops serving once closed', async () => {
    const reviews = start();
    const url = await reviews.urlFor(project('a'), 'page.html');
    await reviews.close();
    server = undefined;
    await expect(get(url)).rejects.toThrow();
  });
});
