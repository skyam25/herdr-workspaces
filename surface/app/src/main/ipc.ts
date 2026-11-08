import { IPC_INVOKE, IPC_SEND, type CompanionApi, type InvokeMethod, type SendMethod } from '../shared/ipc';

export interface MainTransport {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

/** Main handlers use the same method names, arguments and results as the renderer API. */
export function mainIpc(transport: MainTransport) {
  return {
    handle<K extends InvokeMethod>(method: K, handler: (...args: Parameters<CompanionApi[K]>) => ReturnType<CompanionApi[K]> | Awaited<ReturnType<CompanionApi[K]>>) {
      transport.handle(IPC_INVOKE[method], (_event, ...args) => handler(...args as Parameters<CompanionApi[K]>));
    },
    on<K extends SendMethod>(method: K, handler: (...args: Parameters<CompanionApi[K]>) => void) {
      transport.on(IPC_SEND[method], (_event, ...args) => handler(...args as Parameters<CompanionApi[K]>));
    },
  };
}

type InvokeListener = (event: unknown, ...args: unknown[]) => unknown;
type SendListener = (event: unknown, ...args: unknown[]) => void;

/** Registers on Electron's IPC and keeps the handlers, so the web host can reach the same ones. */
export function teeTransport(inner: MainTransport) {
  const invokers = new Map<string, InvokeListener>();
  const senders = new Map<string, SendListener[]>();
  return {
    handle(channel: string, listener: InvokeListener) {
      invokers.set(channel, listener);
      inner.handle(channel, listener);
    },
    on(channel: string, listener: SendListener) {
      senders.set(channel, [...(senders.get(channel) ?? []), listener]);
      return inner.on(channel, listener);
    },
    canInvoke: (channel: string) => invokers.has(channel),
    canSend: (channel: string) => senders.has(channel),
    invoke: async (channel: string, args: unknown[]) => invokers.get(channel)?.(undefined, ...args),
    send(channel: string, args: unknown[]) {
      for (const listener of senders.get(channel) ?? []) listener(undefined, ...args);
    },
  };
}
