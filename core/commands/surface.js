import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { basename, join, resolve } from 'node:path';

import { linkFor, moveBundle } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import {
  act,
  chatPaneOf,
  closePaneThenFocus,
  findTerminal,
  focusTerminal,
  isTerminalAlive,
  listLive,
  requireLive,
  runDetached,
  sendText,
  terminalInfo,
  windowStatus,
} from '../herdr.js';
import { TIDY_ROLE, ensureStandaloneManifest, listManifests, manifestOfSpace, updateManifest } from '../manifest.js';
import { HOST_SCRIPT, socketPath, stateRoot, surfaceDataDir } from '../paths.js';
import { writablePlace } from '../places.js';
import { callingTerminal, requireCallingTerminal, requireFlag } from '../resolve.js';
import { hasDraftWork, isWindowOpen } from '../surface-windows.js';
import { moveToTrash } from '../trash.js';

const SURFACE_TYPES = ['board', 'note', 'page'];

// The limit for one argument on Linux, and well inside the 1 MiB macOS total.
export const MAX_SEND_BYTES = 128 * 1024;
const RAISE_MS = 3000;

export function newId(prefix) {
  return prefix + randomBytes(3).toString('hex');
}

function resolveFile(file) {
  if (!file) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(file) ? file : resolve(file);
}

// A glued surface splits beside its terminal.
function gluedPlacement(live, terminal) {
  const found = findTerminal(live, terminal);
  if (!found) throw new HwsError(`terminal ${terminal} is not in the Herdr window`);
  return { workspace: manifestOfSpace(found.space.id), pane: found.pane, space: found.space.id };
}

// A flipped agent has no pane, so its surface splits beside its chat pane.
function flippedPlacement(terminal, chatPane, space) {
  if (chatPaneOf(terminal) !== chatPane) {
    throw new HwsError(`terminal ${terminal} is not flipped to chat pane ${chatPane}`);
  }
  return { workspace: manifestOfSpace(space), pane: chatPane, space };
}

// A standalone surface opens a tab in the selected space.
function standalonePlacement() {
  const space = windowStatus()?.space ?? undefined;
  return { workspace: space ? manifestOfSpace(space) : null, pane: null, space };
}

function placementFor(live, terminal, flags) {
  if (!terminal) return standalonePlacement();
  if (flags['beside-pane']) return flippedPlacement(terminal, flags['beside-pane'], flags.space);
  return gluedPlacement(live, terminal);
}

function assertBesideFlags(flags) {
  if (Boolean(flags['beside-pane']) !== Boolean(flags.space)) {
    throw new UsageError('use --beside-pane and --space together');
  }
  if (flags['beside-pane'] && flags.standalone) throw new UsageError('use --beside-pane or --standalone, not both');
}

const AGENT_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', pi: 'Pi' };

// Two agents in one tab can look alike, so the label ends with the terminal's address.
function ownerLabel(found, terminal) {
  const tab = /^\d+$/.test(found.tab.name ?? '') ? `tab ${found.tab.name}` : found.tab.name;
  const program = AGENT_NAMES[found.record.app] ?? found.record.name ?? found.record.app;
  return [found.space.name, tab, program, terminal].filter(Boolean).join(' · ');
}

// A flipped agent is missing from the window listing, so its label names the space and address.
export function windowOwnerLabel(live, terminal, placement) {
  const found = findTerminal(live, terminal);
  if (found) return ownerLabel(found, terminal);
  const space = live.spaces.find((item) => item.id === placement.space);
  return [space?.name, terminal].filter(Boolean).join(' · ');
}

function ownerTerminal(flags) {
  if (flags.terminal && flags.standalone) throw new UsageError('use --terminal or --standalone, not both');
  if (flags.standalone) return null;
  const terminal = callingTerminal(flags);
  if (!terminal) throw new UsageError('pass --terminal or --standalone');
  return terminal;
}

// `owner` is set only for a surface in its own window.
function hostArgv({ workspace, id, type, title, terminal, file, owner }) {
  const environment = {
    HWS_HOME: stateRoot(),
    HWS_SURFACE_ID: id,
    HWS_WORKSPACE_ID: workspace.id,
    HWS_TERMINAL: terminal ?? '',
    HWS_SURFACE_TYPE: type,
    HWS_SURFACE_TITLE: title,
    HWS_SURFACE_FILE: file,
    HWS_FOLDER: workspace.folder,
    COMPANION_SOCKET: socketPath(id),
    COMPANION_DATA_DIR: surfaceDataDir(workspace.id, id),
    ...(owner === undefined ? {} : { HWS_SURFACE_WINDOW: '1', HWS_SURFACE_OWNER: owner }),
  };
  return ['env', ...Object.entries(environment).map(([key, value]) => `${key}=${value}`), HOST_SCRIPT];
}

export function surfaceOpen(flags) {
  if (!SURFACE_TYPES.includes(flags.type)) throw new UsageError('--type must be board, note or page');
  assertBesideFlags(flags);
  const terminal = ownerTerminal(flags);
  if (terminal?.includes('/')) throw new HwsError(`surfaces run on this computer, and ${terminal} is on another machine`);
  const live = requireLive();

  const placement = placementFor(live, terminal, flags);
  const workspace = placement.workspace ?? ensureStandaloneManifest();
  const windowed = flags.type === 'board' && !flags['in-pane'];
  const surfaceId = newId('s');
  const file = flags.type === 'board' ? '' : resolveFile(flags.file);
  const title = flags.title ?? (file ? basename(file) : flags.type);
  const socket = socketPath(surfaceId);
  const dataDir = surfaceDataDir(workspace.id, surfaceId);
  mkdirSync(dataDir, { recursive: true });

  const owner = windowed ? (terminal ? windowOwnerLabel(live, terminal, placement) : '') : undefined;
  const argv = hostArgv({ workspace, id: surfaceId, type: flags.type, title, terminal, file, owner });

  if (windowed) {
    const host = runDetached(argv, workspace.folder);
    const surface = { id: surfaceId, type: flags.type, title, terminal, pane: null, host, socket, pid: terminalInfo(host)?.pid ?? null };
    updateManifest(workspace.id, (draft) => draft.surfaces.push(surface));
    return { data: { ...surface, workspace: workspace.id, hostTerminal: host }, text: `opened ${flags.type} ${surfaceId}` };
  }

  const opened = terminal
    ? act('pane.split', { direction: 'right', pane: placement.pane, argv })
    : act('tab.new', { name: title, space: placement.space, folder: workspace.folder, argv });
  const pane = opened.pane ?? findTerminal(listLive() ?? { spaces: [] }, opened.terminal)?.pane ?? null;
  const pid = terminalInfo(opened.terminal)?.pid ?? null;

  const surface = { id: surfaceId, type: flags.type, title, terminal, pane, socket, pid };
  updateManifest(workspace.id, (draft) => draft.surfaces.push(surface));
  const data = { ...surface, workspace: workspace.id, hostTerminal: opened.terminal };
  return { data, text: `opened ${flags.type} ${surfaceId}` };
}

function findSurface(surfaceId) {
  for (const manifest of listManifests({ includeStandalone: true })) {
    const surface = manifest.surfaces.find((item) => item.id === surfaceId);
    if (surface) return { manifest, surface };
  }
  throw new HwsError(`no surface ${surfaceId}`);
}

export function assertBundle(bundle) {
  if (!existsSync(bundle) || !statSync(bundle).isDirectory()) throw new HwsError(`no bundle folder at ${bundle}`);
  if (!existsSync(join(bundle, 'prompt.md'))) throw new HwsError(`no prompt.md in ${bundle}`);
}

// Very long text exceeds the argument limit, so the link goes in its place.
export function promptToSend(promptPath) {
  const text = readFileSync(promptPath, 'utf8');
  return Buffer.byteLength(text) > MAX_SEND_BYTES ? linkFor(promptPath) : text;
}

// Kept bundles land under the workspace's artifacts place.
export function archiveBundle({ manifest, surface }, bundle) {
  const artifactId = newId('a');
  const artifactDir = join(writablePlace(manifest, 'artifacts'), artifactId);
  const prompt = moveBundle(bundle, artifactDir);
  const fromTidy = manifest.terminals.some((item) => item.terminal === surface.terminal && item.role === TIDY_ROLE);
  const artifact = {
    id: artifactId,
    type: surface.type,
    title: surface.title,
    path: artifactDir,
    prompt,
    fromTerminal: surface.terminal,
    createdAt: Date.now(),
    status: 'current',
    ...(fromTidy ? { role: TIDY_ROLE } : {}),
  };
  updateManifest(manifest.id, (draft) => {
    draft.surfaces = draft.surfaces.filter((item) => item.id !== surface.id);
    draft.artifacts.push(artifact);
  });
  return artifact;
}

function logDelivery(surface, reason) {
  appendFileSync(join(stateRoot(), 'delivery.log'), `${new Date().toISOString()} ${surface.id} ${reason}\n`);
}

// The text has been delivered, so a failure here only leaves the focus where it was.
function focusAfterDone(surface) {
  try {
    focusTerminal(surface.terminal);
  } catch (error) {
    logDelivery(surface, error.message);
  }
}

export function surfaceFocus(flags) {
  const { surface } = findSurface(requireFlag(flags, 'id'));
  if (!surface.terminal || !isTerminalAlive(surface.terminal)) throw new HwsError('that terminal has ended');
  focusTerminal(surface.terminal);
  return { data: { focused: surface.terminal }, text: `focused ${surface.terminal}` };
}

function findWindow(surfaceId) {
  const found = findSurface(surfaceId);
  if (!found.surface.host) throw new HwsError(`surface ${surfaceId} has no window of its own`);
  return found;
}

// Lists every window and draft, oldest first. A closed window with nothing on it is left out.
export function surfaceList() {
  const windows = listManifests({ includeStandalone: true }).flatMap((manifest) =>
    manifest.surfaces
      .filter((surface) => surface.host)
      .map((surface) => ({
        id: surface.id,
        type: surface.type,
        title: surface.title,
        terminal: surface.terminal,
        workspace: manifest.id,
        open: isWindowOpen(surface),
      }))
      .filter((surface) => surface.open || hasDraftWork(manifest.id, surface.id)),
  );
  return { data: windows, text: windows.map((item) => `${item.id} ${item.open ? 'open' : 'draft'} ${item.title}`).join('\n') };
}

// A running host shows its window on POST /open. False means it has not started listening yet.
function raiseWindow(surface) {
  return new Promise((finish) => {
    const request = httpRequest({ socketPath: surface.socket, path: '/open', method: 'POST', headers: { 'content-type': 'application/json' } }, (response) => {
      response.resume();
      response.on('end', () => finish(response.statusCode < 400));
    });
    request.setTimeout(RAISE_MS, () => request.destroy());
    request.on('error', () => finish(false));
    request.end(JSON.stringify({ sessionId: `surface-${surface.id}`, reopen: true }));
  });
}

// Brings an open window forward, or starts a closed one again on its saved data.
export async function surfaceResume(flags) {
  const { manifest, surface } = findWindow(requireFlag(flags, 'id'));
  if (isWindowOpen(surface)) {
    const raised = await raiseWindow(surface);
    return { data: { id: surface.id, resumed: false, raised }, text: `showed ${surface.id}` };
  }

  const live = requireLive();
  const owner = surface.terminal ? windowOwnerLabel(live, surface.terminal, {}) : '';
  const argv = hostArgv({ workspace: manifest, id: surface.id, type: surface.type, title: surface.title, terminal: surface.terminal, file: '', owner });
  const host = runDetached(argv, manifest.folder);
  const pid = terminalInfo(host)?.pid ?? null;
  updateManifest(manifest.id, (draft) => {
    Object.assign(draft.surfaces.find((item) => item.id === surface.id), { host, pid });
  });
  return { data: { id: surface.id, resumed: true, host }, text: `resumed ${surface.id}` };
}

// A discarded draft is user work, so it goes to the Trash.
export function surfaceDiscard(flags) {
  const { manifest, surface } = findWindow(requireFlag(flags, 'id'));
  if (isWindowOpen(surface)) throw new HwsError('close that window before discarding it');
  const data = surfaceDataDir(manifest.id, surface.id);
  if (existsSync(data)) moveToTrash([data]);
  updateManifest(manifest.id, (draft) => {
    draft.surfaces = draft.surfaces.filter((item) => item.id !== surface.id);
  });
  return { data: { id: surface.id, discarded: true }, text: `discarded ${surface.id}` };
}

export async function surfaceDone(flags) {
  const surfaceId = requireFlag(flags, 'id');
  const bundle = resolve(requireFlag(flags, 'bundle'));
  const found = findSurface(surfaceId);
  assertBundle(bundle);
  const artifact = archiveBundle(found, bundle);
  const link = linkFor(artifact.prompt);
  const { surface } = found;

  const standalone = { standalone: true, artifact: artifact.id, link };
  if (!surface.terminal) return { data: standalone };
  if (!isTerminalAlive(surface.terminal)) {
    logDelivery(surface, `terminal ${surface.terminal} is not live`);
    return { data: standalone };
  }
  try {
    sendText(surface.terminal, promptToSend(artifact.prompt));
  } catch (error) {
    logDelivery(surface, error.message);
    return { data: { ...standalone, deliveryError: error.message } };
  }

  if (surface.pane) {
    // The user may have flipped since the surface opened, so the label is read now.
    const chatPane = chatPaneOf(surface.terminal);
    if (chatPane) await closePaneThenFocus(surface.pane, chatPane, 'pane');
    else await closePaneThenFocus(surface.pane, surface.terminal);
  } else {
    focusAfterDone(surface);
  }

  return { data: { standalone: false, artifact: artifact.id, link, delivered: true } };
}

export function surfaceSocket(flags) {
  const terminal = requireCallingTerminal(flags);
  const matches = listManifests({ includeStandalone: true })
    .flatMap((manifest) => manifest.surfaces)
    .filter((surface) => surface.terminal === terminal && (!flags.title || surface.title === flags.title))

    // A draft's window is closed, so nothing listens on its socket.
    .filter((surface) => !surface.host || isWindowOpen(surface));
  const surface = matches.at(-1);
  if (!surface) throw new HwsError(`terminal ${terminal} has no matching surface`);
  return { data: { socket: surface.socket, surface: surface.id }, text: surface.socket };
}
