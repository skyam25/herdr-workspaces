import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SurfaceState } from '../shared/ipc';
import { bundleSignature, openRequest, prepareBundle, sessionCwd, SurfaceHost, surfaceFromEnv, type SurfaceConfig } from './surface';

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'surface-')));

const config = (over: Partial<SurfaceConfig> = {}): SurfaceConfig => ({
  id: 's1',
  type: 'board',
  title: 'flow',
  file: '',
  terminal: 't1',
  folder: '/nowhere',
  dataDir: '/data',
  hws: 'hws',
  ...over,
});

describe('surfaceFromEnv', () => {
  it('is off without a surface id', () => {
    expect(surfaceFromEnv({})).toBeUndefined();
  });

  it('resolves a relative file against the workspace folder', () => {
    const cfg = surfaceFromEnv({ HWS_SURFACE_ID: 's1', HWS_SURFACE_TYPE: 'note', HWS_SURFACE_FILE: 'docs/a.md', HWS_FOLDER: '/work' });
    expect(cfg).toMatchObject({ type: 'note', file: '/work/docs/a.md', title: 'note', terminal: '' });
  });

  it('keeps a local URL as it is', () => {
    const cfg = surfaceFromEnv({ HWS_SURFACE_ID: 's1', HWS_SURFACE_TYPE: 'page', HWS_SURFACE_FILE: 'http://localhost:5173/', HWS_FOLDER: '/work' });
    expect(cfg?.file).toBe('http://localhost:5173/');
  });
});

describe('sessionCwd and openRequest', () => {
  it('puts a board in the data folder', () => {
    expect(sessionCwd(config())).toBe('/data/work');
    expect(openRequest(config(), 'x', '/data/work')).toEqual({ sessionId: 'x', board: 'flow' });
  });

  it('opens a note with no file as a new note', () => {
    expect(openRequest(config({ type: 'note' }), 'x', '/data/work')).toEqual({ sessionId: 'x', mode: 'write' });
  });

  it('keeps a file under the workspace relative to the workspace', () => {
    const folder = temp();
    mkdirSync(join(folder, 'docs'));
    const file = join(folder, 'docs/a.md');
    writeFileSync(file, 'x');
    const cfg = config({ type: 'note', file, folder });
    expect(sessionCwd(cfg)).toBe(folder);
    expect(openRequest(cfg, 'x', sessionCwd(cfg))).toEqual({ sessionId: 'x', output: { path: 'docs/a.md' } });
  });

  it('uses the file folder for a file outside the workspace or under a home-folder default', () => {
    const elsewhere = temp();
    const file = join(elsewhere, 'a.html');
    writeFileSync(file, 'x');
    expect(sessionCwd(config({ type: 'page', file, folder: temp() }))).toBe(elsewhere);
    expect(sessionCwd(config({ type: 'page', file, folder: homedir() }))).toBe(elsewhere);
  });
});

describe('prepareBundle', () => {
  const bundle = (root: string, id: string, draftMd = `![](.feedback/sketches/${id}/images/p.png)`) => {
    const dir = join(root, 'project/.feedback/sketches', id);
    mkdirSync(join(dir, 'images'), { recursive: true });
    writeFileSync(join(dir, 'images/p.png'), 'png');
    writeFileSync(join(dir, 'draft.md'), draftMd);
    return dir;
  };

  it('moves the bundle, writes absolute paths in prompt.md, and points other files at siblings', () => {
    const root = temp();
    const dir = bundle(root, 'id1');
    const out = prepareBundle({ id: 'id1', dir, draft: '@.feedback/sketches/id1/draft.md\nDo it.' }, join(root, 'bundles'));
    expect(out).toBe(join(root, 'bundles/id1'));
    expect(readFileSync(join(out, 'prompt.md'), 'utf8')).toBe(`@${out}/draft.md\nDo it.`);
    expect(readFileSync(join(out, 'draft.md'), 'utf8')).toBe('![](images/p.png)');
  });

  it('gives unchanged work the same signature in a different folder', () => {
    const root = temp();
    const first = prepareBundle({ id: 'a', dir: bundle(root, 'a', 'same'), draft: 'x' }, join(root, 'bundles'));
    const second = prepareBundle({ id: 'b', dir: bundle(root, 'b', 'same'), draft: 'y' }, join(root, 'bundles'));
    const third = prepareBundle({ id: 'c', dir: bundle(root, 'c', 'changed'), draft: 'y' }, join(root, 'bundles'));
    expect(bundleSignature(first)).toBe(bundleSignature(second));
    expect(bundleSignature(first)).not.toBe(bundleSignature(third));
  });
});

describe('SurfaceHost', () => {
  const HANDED = { draftId: 'd1', draftRevision: 5 };

  /** A companion socket that hands out one delivery, and an `hws` that answers with `reply` or fails without one. */
  async function harness(reply: object | undefined, over: Partial<SurfaceConfig> = {}) {
    const root = temp();
    const dataDir = join(root, 'data');
    const bundle = join(root, 'delivery');
    mkdirSync(dataDir);
    mkdirSync(bundle);
    writeFileSync(join(bundle, 'review.md'), 'Move the header.');
    const seen = join(root, 'marker-seen');
    const hws = join(root, 'hws');
    writeFileSync(hws, `#!/bin/sh\ntest -f '${join(dataDir, 'handed-off.json')}' && touch '${seen}'\n${reply ? `echo '${JSON.stringify(reply)}'` : 'echo no >&2; exit 1'}\n`, { mode: 0o755 });

    const requests: string[] = [];
    let pending = [{ id: 'dl1', dir: bundle, draft: 'Read review.md' }];
    const server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url?.split('?')[0]}`);
      req.resume();
      const deliveries = req.url?.startsWith('/deliveries?') ? pending : [];
      if (deliveries.length) pending = [];
      const send = () => res.end(JSON.stringify(req.url?.startsWith('/deliveries?') ? { deliveries } : {}));
      // An empty poll waits, as the real long poll does.
      if (req.url?.startsWith('/deliveries?') && !deliveries.length) setTimeout(send, 200);
      else send();
    });
    const socket = join(root, 'sock');
    await new Promise<void>((done) => server.listen(socket, done));

    const states: SurfaceState[] = [];
    const settle = vi.fn();
    const handedOff = vi.fn((id: string) => (id === 'dl1' ? HANDED : undefined));
    const cfg = config({ type: 'page', dataDir, folder: root, hws, ...over });
    const host = new SurfaceHost(cfg, { socket, push: (state) => states.push(state), copy: vi.fn(), handedOff, settle });
    const stop = () => {
      host.stop();
      server.closeAllConnections();
      server.close();
    };
    const until = (test: () => boolean) => vi.waitFor(() => expect(test()).toBe(true), { timeout: 5000 });
    return { host, dataDir, seen, states, settle, requests, stop, until };
  }

  it('settles the handed draft once hws delivers, and marks it while hws runs', async () => {
    const h = await harness({ standalone: false, artifact: 'a1', delivered: true });
    h.host.start();
    await h.until(() => h.states.some((state) => state.delivered));
    h.stop();
    expect(h.settle).toHaveBeenCalledWith(HANDED);
    expect(existsSync(h.seen)).toBe(true);
    expect(existsSync(join(h.dataDir, 'handed-off.json'))).toBe(false);
  });

  it('keeps the draft when hws refuses the bundle', async () => {
    const h = await harness(undefined);
    h.host.start();
    await h.until(() => h.states.some((state) => state.notice?.error));
    h.stop();
    expect(h.settle).not.toHaveBeenCalled();
    expect(existsSync(join(h.dataDir, 'handed-off.json'))).toBe(false);
  });

  it('clears a pane that stays open and shows its file again', async () => {
    const root = temp();
    const file = join(root, 'plan.html');
    writeFileSync(file, '<p>plan</p>');
    const h = await harness({ standalone: true, artifact: 'a1', link: '@/x/prompt.md' }, { terminal: '', file, folder: root });
    h.host.start();
    await h.until(() => h.states.some((state) => state.artifact === 'a1' && state.busy === false));
    h.stop();
    expect(h.settle).toHaveBeenCalledWith(HANDED);
    expect(h.states.find((state) => state.sent)?.sent).toBe('dl1');
    expect(h.requests).toContain('POST /open');
  });

  it('settles the draft a host handed over before its pane closed', async () => {
    const h = await harness({ standalone: false });
    writeFileSync(join(h.dataDir, 'handed-off.json'), JSON.stringify({ draftId: 'd0' }));
    h.host.start();
    h.stop();
    expect(h.settle).toHaveBeenCalledWith({ draftId: 'd0' });
    expect(existsSync(join(h.dataDir, 'handed-off.json'))).toBe(false);
  });

  it('repeats a waiting press on the saved artifact, and reports when there is none', async () => {
    const h = await harness({ standalone: true, artifact: 'a1', link: '@/x/prompt.md' }, { terminal: '' });
    expect(await h.host.repeat()).toBe(false);
    h.host.start();
    await h.until(() => h.states.some((state) => state.artifact === 'a1' && state.busy === false));
    h.host.want('link');
    expect(await h.host.repeat()).toBe(true);
    h.stop();
    expect(h.states.at(-1)?.notice?.text).toBe('Copied the link.');
  });
});
