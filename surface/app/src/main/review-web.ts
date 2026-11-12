/**
 * Serves project files to a review frame over loopback, for a surface shown in a web view.
 *
 * Each project folder gets its own port, so each is its own origin, as on the review scheme.
 * A request must name this server in Host, which stops DNS rebinding. A cross-site request is
 * refused, and only the surface's page may frame a review page, because the overlay answers
 * whichever page frames it.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { serveReviewPath } from './review-protocol';

interface Served {
  server: http.Server;
  port: number;
}

export interface ReviewWebOptions {
  overlayFile: string;
  /** The origin of the page that frames review pages, such as `http://127.0.0.1:5000`. */
  frameAncestor: () => string;
}

export class ReviewWebServer {
  private readonly byRoot = new Map<string, Promise<Served>>();
  private readonly rootByPort = new Map<number, string>();

  constructor(private readonly opts: ReviewWebOptions) {}

  /** The address of `path` under the project at `root`. The first call for a root starts its server. */
  async urlFor(root: string, path: string): Promise<string> {
    const { port } = await this.serve(root);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `http://127.0.0.1:${port}/${encoded}`;
  }

  /** The project and file path behind an address this server gave out, or undefined for any other. */
  pageOf(url: string): { root: string; path: string } | undefined {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    if (parsed.protocol !== 'http:' || (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost')) return undefined;
    const root = this.rootByPort.get(Number(parsed.port));
    if (!root) return undefined;
    try {
      return { root, path: decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) };
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    const served = await Promise.allSettled(this.byRoot.values());
    this.byRoot.clear();
    this.rootByPort.clear();
    await Promise.all(
      served.map((item) => {
        if (item.status !== 'fulfilled') return undefined;
        item.value.server.closeAllConnections();
        return new Promise<void>((done) => item.value.server.close(() => done()));
      }),
    );
  }

  private serve(root: string): Promise<Served> {
    let served = this.byRoot.get(root);
    if (!served) {
      served = this.listen(root);
      this.byRoot.set(root, served);

      // A failed start leaves no entry, so the next call tries again.
      served.catch(() => this.byRoot.delete(root));
    }
    return served;
  }

  private async listen(root: string): Promise<Served> {
    let port = 0;
    const server = http.createServer((req, res) => void this.route(root, port, req, res));
    await new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', done);
    });
    port = (server.address() as AddressInfo).port;
    this.rootByPort.set(port, root);
    return { server, port };
  }

  private async route(root: string, port: number, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return fail(res, 403, 'wrong host');
    if (req.headers['sec-fetch-site'] === 'cross-site') return fail(res, 403, 'cross-site');
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'read only');

    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://local').pathname;
    } catch {
      return fail(res, 400, 'bad request');
    }

    try {
      const answer = await serveReviewPath(root, this.opts.overlayFile, pathname);
      const headers: Record<string, string> = {
        ...Object.fromEntries(answer.headers),
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-site',
        'content-security-policy': `frame-ancestors ${this.opts.frameAncestor()}`,
      };
      const body = Buffer.from(await answer.arrayBuffer());
      res.writeHead(answer.status, { ...headers, 'content-length': String(body.length) });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      fail(res, 500, (err as Error).message);
    }
  }
}

function fail(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(message);
}
