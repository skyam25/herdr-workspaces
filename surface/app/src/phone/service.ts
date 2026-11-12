/**
 * The phone listener, one per machine. `hws phone` starts it in a Herdr terminal with no pane.
 * It wraps the iPad module, answers `hws` on a Unix socket, and returns each answer through `hws phone deliver`.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { notFound } from '../board/errors';
import { Ipad, type IpadDeps } from '../ipad';
import type { LanTarget } from '../shared/ipad';
import { macNames } from '../ipad/lan';
import { readJson } from '../ipad/lan-server';
import { prepareBundle, runHws } from '../main/surface';
import { buildDraft, freeId, reviewOf, writeBundle } from '../server/bundle';
import type { DeliveryInput } from '../server/contract';
import { isLive } from '../server/index';
import { cleanBoardComments } from '../shared/board-comments';
import { isTextPayload, type Outgoing, type SendPayload, type TextPayload } from '../shared/ipc';
import { composeDelivery } from '../voice/compose';

const PHONE_LAN_PORT = 47614;

/** An unpaired listener with no pairing code open exits after this long. */
const IDLE_MS = 60_000;
const SETTLE_MS = 1_500;
const MAX_CONTROL_BODY = 64 * 1024;

interface PhoneOptions {
  dataDir: string;
  socketPath: string;
  /** The `hws` executable. */
  hws: string;
  host?: string;
  port?: number;
  names?: IpadDeps['names'];
  idleMs?: number;
  onExit: () => void;
}

export interface PhoneService {
  /** False when another listener already owns the socket. */
  start(): Promise<boolean>;
  stop(): Promise<void>;
}

interface HandoffBody {
  session: string;
  label: string;
  prompt?: string;
  page?: string;
  root?: string;
  board?: string;
}

class ControlError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const STATUS_OF: Record<string, number> = { not_found: 404, bad_request: 400, conflict: 409, unavailable: 503 };

function textInput(p: TextPayload): DeliveryInput {
  const review = reviewOf(p);
  return { boardName: '', text: p.text, ...(review ? { review } : {}) };
}

/** The phone transcribes its own speech, so no clip reaches the transcriber. */
async function sketchInput(p: SendPayload, tmpDir: string): Promise<DeliveryInput> {
  const input = await composeDelivery({
    boardName: p.boardName,
    png: Buffer.from(p.png),
    scene: p.scene,
    notes: p.notes || undefined,
    strokes: p.strokes,
    segments: [],
    ...(p.utterances ? { utterances: p.utterances } : {}),
    bounds: p.bounds,
    transcribe: { ffmpegPath: 'ffmpeg', yapPath: 'yap', tmpDir },
  });
  const comments = cleanBoardComments(p.comments);
  return { ...input, ...(comments ? { comments } : {}) };
}

export function createPhoneService(opts: PhoneOptions): PhoneService {
  const boardFile = (name: string) => join(opts.dataDir, 'boards', `${name}.excalidraw`);
  const labels = new Map<string, string>();
  const roots = new Map<string, string>();
  let sheetOpen = false;
  let stopping: Promise<void> | undefined;

  async function deliver(payload: Outgoing, send: string): Promise<{ ok: boolean; message: string }> {
    const bundles = join(opts.dataDir, 'bundles');
    const incoming = join(opts.dataDir, 'incoming');
    mkdirSync(bundles, { recursive: true });
    const id = freeId(bundles, Date.now());
    const written = join(incoming, id);
    let bundle: string | undefined;
    try {
      const input = isTextPayload(payload) ? textInput(payload) : await sketchInput(payload, incoming);
      await writeBundle(written, input);
      bundle = prepareBundle({ id, dir: written, draft: buildDraft(id, input) }, bundles);
      const result = await runHws(opts.hws, ['phone', 'deliver', '--send', send, '--bundle', bundle, '--json']);
      return { ok: true, message: result.message ?? 'Sent' };
    } catch (err) {
      // The phone keeps its work and tries again, so these copies can go.
      rmSync(written, { recursive: true, force: true });
      if (bundle) rmSync(bundle, { recursive: true, force: true });
      return { ok: false, message: (err as Error).message };
    }
  }

  const ipad = new Ipad({
    dataDir: opts.dataDir,

    // `hws phone deliver` checks the terminal when the answer arrives.
    isLive: () => true,
    sessionLabel: (id) => labels.get(id) ?? id,
    resolveBoard: (name) => {
      if (!existsSync(boardFile(name))) throw notFound(`no board named ${JSON.stringify(name)}`);
      return name;
    },
    loadBoard: (name) => ({ scene: readFileSync(boardFile(name), 'utf8'), notes: '' }),

    // The answer's bundle carries the drawing, so nothing else stores it.
    saveBoard: () => undefined,
    fileBoard: () => undefined,
    updateBoard: async (name, scene, _notes, unchanged) => {
      if (!unchanged()) return false;
      writeFileSync(boardFile(name), scene);
      return true;
    },
    send: deliver,
    sessionRoot: (id) => roots.get(id),

    // A whiteboard the phone starts gets a send record from hws, so its answer delivers as any other.
    targets: async () => {
      const result = (await runHws(opts.hws, ['phone', 'targets', '--json'])) as unknown as { targets?: LanTarget[] };
      return result.targets ?? [];
    },
    accept: async (target) => {
      let opened: { send: string; label: string };
      try {
        opened = (await runHws(opts.hws, ['phone', 'accept', '--terminal', target, '--json'])) as unknown as typeof opened;
      } catch (err) {
        throw notFound((err as Error).message);
      }
      labels.set(opened.send, opened.label);
      return { sessionId: opened.send, label: opened.label };
    },
    onPairedChange: () => setTimeout(stopIfIdle, SETTLE_MS),
    ...(opts.host ? { host: opts.host } : {}),
    port: opts.port ?? PHONE_LAN_PORT,
    names: () => {
      const names = (opts.names ?? macNames)();
      return { ...names, computer: `Herdr on ${names.computer}` };
    },
  });

  function stopIfIdle(): void {
    if (!sheetOpen && !ipad.status().paired) void stop();
  }

  function status() {
    return {
      pid: process.pid,
      ...ipad.status(),
      handoffs: ipad.listHandoffs().filter((h) => h.state === 'open'),
      ...(ipad.sheetStatus().error ? { error: ipad.sheetStatus().error } : {}),
    };
  }

  function createHandoff(body: HandoffBody) {
    if (typeof body.session !== 'string' || !body.session) throw new ControlError(400, 'session is required');
    labels.set(body.session, body.label);
    if (body.root) roots.set(body.session, body.root);
    return ipad.createHandoff({
      sessionId: body.session,
      ...(body.prompt ? { prompt: body.prompt } : {}),
      ...(body.page ? { page: body.page } : {}),
      ...(body.board ? { board: body.board } : {}),
    });
  }

  async function openPairing() {
    sheetOpen = true;
    const sheet = await ipad.openSheet();
    const qrText = sheet.url ? await QRCode.toString(sheet.url, { type: 'terminal', small: true, errorCorrectionLevel: 'M', margin: 2 }) : undefined;
    return { ...sheet, ...(qrText ? { qrText } : {}) };
  }

  async function closePairing() {
    sheetOpen = false;
    await ipad.closeSheet();
    setTimeout(stopIfIdle, SETTLE_MS);
    return { ok: true };
  }

  async function route(req: IncomingMessage): Promise<unknown> {
    const key = `${req.method} ${new URL(req.url ?? '/', 'http://phone').pathname}`;
    if (key === 'GET /status') return status();
    if (key === 'POST /pair') return openPairing();
    if (key === 'GET /pair') return ipad.sheetStatus();
    if (key === 'DELETE /pair') return closePairing();
    if (key === 'POST /handoffs') return createHandoff((await readJson(req, MAX_CONTROL_BODY)) as HandoffBody);
    if (key === 'POST /forget') {
      const { id } = (await readJson(req, MAX_CONTROL_BODY)) as { id?: unknown };
      if (typeof id !== 'string') throw new ControlError(400, 'id is required');
      return ipad.forget(id);
    }
    if (key === 'POST /stop') {
      setTimeout(() => void stop(), 50);
      return { ok: true };
    }
    throw new ControlError(404, 'no such route');
  }

  function reply(res: ServerResponse, code: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
  }

  const server = http.createServer((req, res) => {
    route(req).then(
      (body) => reply(res, 200, body),
      (err: Error & { status?: number; code?: string }) => reply(res, err.status ?? STATUS_OF[err.code ?? ''] ?? 500, { error: err.message }),
    );
  });

  const bind = () =>
    new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(opts.socketPath, () => {
        server.off('error', fail);
        done();
      });
    });

  async function claimSocket(): Promise<boolean> {
    try {
      await bind();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      if (await isLive(opts.socketPath)) return false;
      rmSync(opts.socketPath, { force: true });
      await bind();
    }
    chmodSync(opts.socketPath, 0o600);
    return true;
  }

  function stop(): Promise<void> {
    stopping ??= (async () => {
      await ipad.stop();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
      opts.onExit();
    })();
    return stopping;
  }

  return {
    async start() {
      mkdirSync(join(opts.dataDir, 'boards'), { recursive: true });
      if (!(await claimSocket())) return false;
      await ipad.sync();
      setTimeout(stopIfIdle, opts.idleMs ?? IDLE_MS).unref();
      return true;
    },
    stop,
  };
}
