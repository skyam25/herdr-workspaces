/**
 * A surface: one board, note or page in a Herdr pane or in its own window.
 *
 * The host stands in for the Claude plugin. It registers a session over the app's own socket,
 * opens the surface bound to that session, and long-polls for what Send delivers. Each delivery
 * becomes a bundle that `hws surface done` moves to the artifact store.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DeliveriesResponse, Delivery, OpenRequest } from '../protocol';
import type { SurfaceAction, SurfaceState, SurfaceTargets, SurfaceType } from '../shared/ipc';
import { isLocalUrl } from '../shared/outputs';
import { portablePrompt } from '../shared/sessions';
import type { HandedDraft } from './sender';

export interface SurfaceConfig {
  id: string;
  type: SurfaceType;
  title: string;
  /** Absolute path, or a local URL. Empty for a board. */
  file: string;
  terminal: string;
  folder: string;
  dataDir: string;
  hws: string;
  owner?: string;
  /** A pane streams the page, and a window shows it directly. */
  shown: 'pane' | 'window';
  /** A web view shows the page. */
  web?: boolean;
  /** The workspace that holds the surface. An empty name means Unfiled. */
  workspace?: { id: string; name: string };
}

/** The surface this process hosts, or undefined when it runs as the plain app. */
export function surfaceFromEnv(env: NodeJS.ProcessEnv): SurfaceConfig | undefined {
  if (!env.HWS_SURFACE_ID) return undefined;
  const type: SurfaceType = env.HWS_SURFACE_TYPE === 'note' || env.HWS_SURFACE_TYPE === 'page' ? env.HWS_SURFACE_TYPE : 'board';
  const folder = env.HWS_FOLDER || homedir();
  const raw = env.HWS_SURFACE_FILE ?? '';
  const file = !raw || isLocalUrl(raw) ? raw : resolve(folder, raw);
  return {
    id: env.HWS_SURFACE_ID,
    type,
    title: env.HWS_SURFACE_TITLE || type,
    file,
    terminal: env.HWS_TERMINAL ?? '',
    folder,
    dataDir: env.COMPANION_DATA_DIR ?? '',
    hws: env.HWS_BIN || 'hws',
    ...(env.HWS_SURFACE_OWNER ? { owner: env.HWS_SURFACE_OWNER } : {}),
    shown: env.HWS_SURFACE_WINDOW === '1' ? 'window' : 'pane',
    ...(env.HWS_SURFACE_WEB === '1' ? { web: true } : {}),
    ...(env.HWS_WORKSPACE_ID ? { workspace: { id: env.HWS_WORKSPACE_ID, name: env.HWS_WORKSPACE_NAME ?? '' } } : {}),
  };
}

const inside = (root: string, target: string) => target === root || target.startsWith(root + sep);

/**
 * The stand-in session's folder. The app only opens files inside its session's folder, and writes
 * the bundle there. A file under the workspace keeps its workspace-relative path in the prompt.
 */
export function sessionCwd(cfg: SurfaceConfig): string {
  const work = join(cfg.dataDir, 'work');
  if (!cfg.file || isLocalUrl(cfg.file) || !isAbsolute(cfg.file)) return work;
  const file = existsSync(cfg.file) ? realpathSync(cfg.file) : cfg.file;
  const folder = existsSync(cfg.folder) ? realpathSync(cfg.folder) : cfg.folder;
  return inside(folder, file) && folder !== homedir() ? folder : dirname(file);
}

/** The `POST /open` body that shows this surface. */
export function openRequest(cfg: SurfaceConfig, sessionId: string, cwd: string): OpenRequest {
  if (cfg.file) {
    if (isLocalUrl(cfg.file)) return { sessionId, output: { path: cfg.file } };
    const file = existsSync(cfg.file) ? realpathSync(cfg.file) : cfg.file;
    return { sessionId, output: { path: relative(cwd, file) } };
  }
  if (cfg.type === 'note') return { sessionId, mode: 'write' };
  if (cfg.type === 'page') return { sessionId, prompt: 'This page has no file to show.' };
  return { sessionId, board: cfg.title };
}

/**
 * Moves a delivered bundle under `root`, writes prompt.md with absolute paths, and points the bundle's
 * other Markdown files at siblings, so `hws` can move it anywhere. Returns the new folder.
 */
export function prepareBundle(delivery: Pick<Delivery, 'id' | 'dir' | 'draft'>, root: string): string {
  mkdirSync(root, { recursive: true });
  const dir = join(root, delivery.id);
  try {
    renameSync(delivery.dir, dir);
  } catch {
    // A project on another volume cannot rename into the surface's data folder.
    cpSync(delivery.dir, dir, { recursive: true });
    rmSync(delivery.dir, { recursive: true, force: true });
  }
  const prefix = `.feedback/sketches/${delivery.id}/`;
  for (const name of readdirSync(dir)) {
    if (extname(name) !== '.md') continue;
    const path = join(dir, name);
    writeFileSync(path, readFileSync(path, 'utf8').split(prefix).join(''));
  }
  writeFileSync(join(dir, 'prompt.md'), portablePrompt(delivery.draft, delivery.id, dir));
  return dir;
}

/** A digest of what a bundle holds, ignoring where it lives. Two presses on unchanged work match. */
export function bundleSignature(dir: string): string {
  const hash = createHash('sha256');
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name !== 'prompt.md') hash.update(relative(dir, path)).update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

export interface SurfaceDeps {
  socket: string;
  push: (state: SurfaceState) => void;
  copy: (text: string) => void;
  /** Ends a surface with no pane for `hws` to close. */
  close?: () => void;
  /** The draft a delivery handed over, which stays until `hws` takes the bundle. */
  handedOff?: (deliveryId: string) => HandedDraft | undefined;
  /** Deletes a handed draft, so the file opens next time with no delivered comments. */
  settle?: (handed: HandedDraft) => void;
  /** Writes the board, the drafts and the board comments to disk. */
  flush?: () => Promise<unknown>;
}

/** Names the draft `hws` is being handed. `hws` closes the pane on success, which ends this process before it can settle. */
const handedFile = (dataDir: string) => join(dataDir, 'handed-off.json');

type HwsResult = { standalone?: boolean; artifact?: string; link?: string; text?: string; deliveryError?: string; message?: string };

const POLL_WAIT_S = 25;
const RETRY_MS = 1000;

export class SurfaceHost {
  readonly sessionId: string;
  private readonly cwd: string;
  private state: SurfaceState;
  private opened = false;
  private stopped = false;
  private action: SurfaceAction | undefined;
  /** The signature of what the current artifact holds. */
  private signature: string | undefined;

  constructor(
    private readonly cfg: SurfaceConfig,
    private readonly deps: SurfaceDeps,
  ) {
    this.sessionId = `surface-${cfg.id}`;
    this.cwd = sessionCwd(cfg);
    this.state = {
      type: cfg.type,
      title: cfg.title,
      sessionId: this.sessionId,
      standalone: !cfg.terminal,
      ...(cfg.owner ? { owner: cfg.owner } : {}),
      shown: cfg.shown,
      ...(cfg.web ? { web: true } : {}),
      ...(cfg.workspace ? { workspace: cfg.workspace } : {}),
    };
  }

  info(): SurfaceState {
    return this.state;
  }

  /** Registers the stand-in session and keeps it alive until the host stops. */
  start(): void {
    mkdirSync(this.cwd, { recursive: true });
    this.settleLeftover();
    void this.poll();
  }

  /** Settles the draft an earlier host handed over just before its pane closed. */
  private settleLeftover(): void {
    this.settleHanded(readHanded(handedFile(this.cfg.dataDir)));
  }

  /** Deletes the handed draft and the marker that names it. */
  private settleHanded(handed: HandedDraft | undefined): void {
    if (handed) this.deps.settle?.(handed);
    rmSync(handedFile(this.cfg.dataDir), { force: true });
  }

  /** Runs the waiting press on the artifact already saved, when the surface has nothing new to send. */
  async repeat(): Promise<boolean> {
    const waiting = !!this.action && !!this.state.artifact;
    if (waiting) await this.afterArtifact();
    else this.action = undefined;
    return waiting;
  }

  stop(): void {
    this.stopped = true;
  }

  /** Runs once the renderer listens, because `/open` pushes events a loading page would miss. */
  async ready(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    try {
      await this.register();
      await this.request('POST', '/open', openRequest(this.cfg, this.sessionId, this.cwd));
    } catch (err) {
      this.update({ notice: { text: `Could not open ${this.cfg.title}: ${(err as Error).message}`, error: true } });
    }
  }

  /** Goes to the owning terminal or moves the surface now. Other actions wait for the artifact the next delivery makes. */
  want(action: SurfaceAction): void {
    if (action === 'owner') void this.focusOwner();
    else if (action === 'pop') void this.pop();
    else this.action = action;
  }

  /**
   * Saves pending work, then asks `hws` to show this surface in the other place.
   * `hws` ends this host part-way through a move, so the work is on disk before it runs.
   */
  private async pop(): Promise<void> {
    if (this.state.busy || this.state.delivered || this.cfg.web) return;
    const to = this.cfg.shown === 'pane' ? 'window' : 'pane';
    this.update({ busy: true });
    try {
      await this.deps.flush?.();
    } catch (err) {
      this.update({ busy: false, notice: { text: `Could not save before moving: ${(err as Error).message}`, error: true } });
      return;
    }
    try {
      await this.hws(['surface', 'pop', '--id', this.cfg.id, '--to', to, '--json']);
      this.update({ busy: false });
    } catch (err) {
      this.update({ busy: false, notice: { text: `Could not move: ${(err as Error).message}`, error: true } });
    }
  }

  /** The workspaces this surface can move to. */
  async targets(): Promise<SurfaceTargets> {
    const result = (await this.hws(['surface', 'targets', '--id', this.cfg.id, '--json'])) as Partial<SurfaceTargets>;
    return { current: result.current ?? null, suggested: result.suggested ?? null, workspaces: result.workspaces ?? [] };
  }

  /**
   * Saves pending work, then asks `hws` to move this surface. `hws` ends this host
   * and starts the window again from the moved data.
   */
  async move(workspace: string): Promise<void> {
    if (this.state.busy || this.state.delivered || this.cfg.shown !== 'window') return;
    this.update({ busy: true });
    try {
      await this.deps.flush?.();
    } catch (err) {
      this.update({ busy: false, notice: { text: `Could not save before moving: ${(err as Error).message}`, error: true } });
      return;
    }
    try {
      await this.hws(['surface', 'move', '--id', this.cfg.id, '--workspace', workspace, '--json']);
      this.update({ busy: false });
    } catch (err) {
      this.update({ busy: false, notice: { text: `Could not move: ${(err as Error).message}`, error: true } });
    }
  }

  private async focusOwner(): Promise<void> {
    try {
      await this.hws(['surface', 'focus', '--id', this.cfg.id, '--json']);
    } catch (err) {
      this.update({ notice: { text: (err as Error).message, error: true } });
    }
  }

  private update(patch: Partial<SurfaceState>): void {
    this.state = { ...this.state, notice: undefined, ...patch };
    this.deps.push(this.state);
  }

  private register(): Promise<unknown> {
    return this.request('POST', '/sessions', { sessionId: this.sessionId, cwd: this.cwd, title: this.cfg.title });
  }

  private async poll(): Promise<void> {
    while (!this.stopped) {
      try {
        // Registering each round brings the session back after a sleep past the server's timeout.
        await this.register();
        const { deliveries } = (await this.request('GET', `/deliveries?session=${encodeURIComponent(this.sessionId)}&wait=${POLL_WAIT_S}`)) as DeliveriesResponse;
        for (const delivery of deliveries) {
          await this.request('POST', `/deliveries/${encodeURIComponent(delivery.id)}/ack`);
          await this.finish(delivery);
        }
      } catch {
        await new Promise((done) => setTimeout(done, RETRY_MS));
      }
    }
  }

  private async finish(delivery: Delivery): Promise<void> {
    this.update({ busy: true });
    const handed = this.deps.handedOff?.(delivery.id);
    const marker = handedFile(this.cfg.dataDir);
    try {
      const bundle = prepareBundle(delivery, join(this.cfg.dataDir, 'bundles'));
      const signature = bundleSignature(bundle);
      if (this.state.artifact && signature === this.signature) {
        rmSync(bundle, { recursive: true, force: true });
        await this.settled(handed, delivery.id);
        await this.afterArtifact();
        return;
      }
      if (handed) writeFileSync(marker, JSON.stringify(handed));
      const result = await this.hws(['surface', 'done', '--id', this.cfg.id, '--bundle', bundle, '--json']);
      this.signature = signature;
      if (result.standalone) {
        const fellBack = !this.state.standalone;
        this.state = { ...this.state, standalone: true, artifact: result.artifact };
        await this.settled(handed, delivery.id);
        if (fellBack) {
          const text = result.deliveryError
            ? `Could not reach the terminal, so this was saved as an artifact. ${result.deliveryError}`
            : 'The terminal has ended, so this was saved as an artifact.';
          this.update({ busy: false, notice: { text, error: !!result.deliveryError } });
        }
        await this.afterArtifact(fellBack);
        return;
      }
      this.settleHanded(handed);
      this.update({ busy: false, delivered: true, notice: { text: 'Delivered.' } });
      this.deps.close?.();
    } catch (err) {
      rmSync(marker, { force: true });
      this.update({ busy: false, notice: { text: `Done failed: ${(err as Error).message}`, error: true } });
    }
  }

  /**
   * Clears what a saved bundle holds from a pane that stays open. The renderer drops its copy
   * when it sees `sent`, and a file's page then opens again with no delivered comments.
   */
  private async settled(handed: HandedDraft | undefined, deliveryId: string): Promise<void> {
    this.settleHanded(handed);
    this.update({ busy: true, sent: deliveryId });
    if (handed && this.cfg.file) await this.request('POST', '/open', openRequest(this.cfg, this.sessionId, this.cwd)).catch(() => undefined);
  }

  /** Carries out a standalone press, or reports the artifact when there was none. */
  private async afterArtifact(silent = false): Promise<void> {
    const action = this.action;
    this.action = undefined;
    const artifact = this.state.artifact;
    if (!action || !artifact) {
      this.update({ busy: false, ...(silent ? {} : { notice: { text: 'Saved.' } }) });
      return;
    }
    try {
      if (action === 'terminal') {
        await this.hws(['artifact', 'terminal', artifact, '--json']);
        this.update({ busy: false, notice: { text: 'Opened a terminal on this.' } });
      } else {
        const result = await this.hws(['link', artifact, '--json']);
        const link = result.link ?? result.text;
        if (!link) throw new Error('hws returned no link');
        this.deps.copy(link);
        this.update({ busy: false, notice: { text: 'Copied the link.' } });
      }
    } catch (err) {
      this.update({ busy: false, notice: { text: (err as Error).message, error: true } });
    }
  }

  /** Runs `hws` in its own process group, because closing this pane hangs up everything else in it. */
  private hws(args: string[]): Promise<HwsResult> {
    const env = { ...process.env };
    if (env.HWS_OUTER_XDG_STATE_HOME) env.XDG_STATE_HOME = env.HWS_OUTER_XDG_STATE_HOME;
    else delete env.XDG_STATE_HOME;
    return runHws(this.cfg.hws, args, { detached: true, env });
  }

  private request(method: string, path: string, body?: unknown): Promise<unknown> {
    return new Promise((done, fail) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        { socketPath: this.deps.socket, method, path, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => {
            const parsed = parseJson(text);
            if ((res.statusCode ?? 500) >= 400) fail(new Error((parsed as { error?: string } | undefined)?.error ?? `HTTP ${res.statusCode}`));
            else done(parsed);
          });
        },
      );
      req.on('error', fail);
      req.end(payload);
    });
  }
}

/** Runs `hws` and resolves its JSON, or its plain text under `text`. */
export function runHws(bin: string, args: string[], options: { detached?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<HwsResult> {
  return new Promise((done, fail) => {
    const child = spawn(bin, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', (e) => fail(new Error(`could not run hws: ${e.message}`)));
    child.on('close', (code) => {
      const parsed = parseJson(out);
      if (code === 0) done(parsed ?? { text: out.trim() });
      else fail(new Error((parsed as { error?: string } | undefined)?.error ?? (err.trim() || `hws exited ${code}`)));
    });
  });
}

function readHanded(path: string): HandedDraft | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<HandedDraft>;
    if (typeof raw.draftId !== 'string') return undefined;
    return { draftId: raw.draftId, ...(typeof raw.draftRevision === 'number' ? { draftRevision: raw.draftRevision } : {}) };
  } catch {
    return undefined;
  }
}

function parseJson(text: string): HwsResult | undefined {
  try {
    return JSON.parse(text) as HwsResult;
  } catch {
    return undefined;
  }
}
