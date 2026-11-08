/** The renderer's host when a plain web view shows it, with no Electron preload. */

import { createPreloadApi, type RendererTransport } from '../preload/api';
import { CH, type CompanionApi } from '../shared/ipc';
import { decodeWire, encodeWire } from '../shared/web-wire';

const RECONNECT_MS = 1000;
const TOKEN_KEY = 'hws-surface-token';

type Listener = (event: unknown, ...args: unknown[]) => void;

interface Reply {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface WebTransport extends RendererTransport {
  /** Delivers an event raised in the page itself, as if the host had sent it. */
  emit(channel: string, ...args: unknown[]): void;
  /** Ends the event stream. */
  stop(): void;
}

export function createWebTransport(base: string, token: string, fetcher: typeof fetch = fetch): WebTransport {
  const listeners = new Map<string, Set<Listener>>();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const abort = new AbortController();
  let sends: Promise<unknown> = Promise.resolve();

  const emit = (channel: string, ...args: unknown[]) => {
    for (const listener of listeners.get(channel) ?? []) listener(undefined, ...args);
  };

  const post = (path: string, channel: string, args: unknown[]) =>
    fetcher(`${base}${path}`, { method: 'POST', headers, body: encodeWire({ channel, args }), signal: abort.signal });

  const readFrames = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      text += decoder.decode(value, { stream: true });
      const frames = text.split('\n\n');
      text = frames.pop() ?? '';
      for (const frame of frames) {
        if (!frame.startsWith('data: ')) continue;
        const { channel, args } = decodeWire(frame.slice('data: '.length)) as { channel: string; args: unknown[] };
        emit(channel, ...args);
      }
    }
  };

  const listen = async () => {
    while (!abort.signal.aborted) {
      try {
        const response = await fetcher(`${base}/api/events`, { headers, signal: abort.signal });
        if (response.body) await readFrames(response.body);
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error('[surface] event stream dropped', err);
      }
      await new Promise((done) => setTimeout(done, RECONNECT_MS));
    }
  };
  void listen();

  return {
    async invoke(channel, ...args) {
      const response = await post('/api/invoke', channel, args);
      if (!response.ok) throw new Error(`${channel} failed with ${response.status}`);
      const reply = decodeWire(await response.text()) as Reply;
      if (!reply.ok) throw new Error(reply.error ?? `${channel} failed`);
      return reply.result;
    },

    // Sends run one at a time, so the host sees them in order.
    send(channel, ...args) {
      sends = sends
        .then(() => post('/api/send', channel, args))
        .catch((err: unknown) => {
          if (!abort.signal.aborted) console.error(`[surface] ${channel} failed`, err);
        });
    },
    on(channel, listener) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    },
    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener);
    },
    emit,
    stop() {
      abort.abort();
    },
  };
}

/** The token arrives in the fragment once. A reload reads it back from this tab's storage. */
function takeToken(): string {
  const fromUrl = new URLSearchParams(location.hash.slice(1)).get('t');
  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    history.replaceState(null, '', location.pathname);
    return fromUrl;
  }
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

export function webCompanion(): CompanionApi {
  const transport = createWebTransport(location.origin, takeToken());
  addEventListener('keydown', (event) => {
    if (!event.metaKey || event.key !== 'Enter') return;
    event.preventDefault();
    transport.emit(CH.surfaceDoneKey);
  }, true);
  return createPreloadApi(transport);
}
