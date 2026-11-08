import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { artifactStoreDir, linkFor, moveDir, pathSpellings, rewritePromptFile } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import {
  act,
  closePaneThenFocus,
  findTerminal,
  isTerminalAlive,
  listLive,
  sendText,
  terminalInfo,
  windowStatus,
} from '../herdr.js';
import { ensureStandaloneManifest, listManifests, readManifest, updateManifest } from '../manifest.js';
import { HOST_SCRIPT, STANDALONE, home, socketPath, stateRoot, surfaceDataDir } from '../paths.js';
import { requireFlag } from '../resolve.js';

const SURFACE_TYPES = ['board', 'note', 'page'];

// The limit for one argument on Linux, and well inside the 1 MiB macOS total.
export const MAX_SEND_BYTES = 128 * 1024;

function newId(prefix) {
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
  return { workspace: readManifest(found.space.id), pane: found.pane, space: found.space.id };
}

// A standalone surface opens a tab in the selected space.
function standalonePlacement() {
  const space = windowStatus()?.space ?? undefined;
  return { workspace: space ? readManifest(space) : null, pane: null, space };
}

function hostEnvironment(fields) {
  return {
    HWS_HOME: stateRoot(),
    HWS_SURFACE_ID: fields.surfaceId,
    HWS_WORKSPACE_ID: fields.workspaceId,
    HWS_TERMINAL: fields.terminal ?? '',
    HWS_SURFACE_TYPE: fields.type,
    HWS_SURFACE_TITLE: fields.title,
    HWS_SURFACE_FILE: fields.file,
    HWS_FOLDER: fields.folder,
    COMPANION_SOCKET: fields.socket,
    COMPANION_DATA_DIR: fields.dataDir,
  };
}

function ownerTerminal(flags) {
  if (flags.terminal && flags.standalone) throw new UsageError('use --terminal or --standalone, not both');
  if (flags.standalone) return null;
  const terminal = flags.terminal ?? process.env.HC_TERMINAL_ID;
  if (!terminal) throw new UsageError('pass --terminal or --standalone');
  return terminal;
}

export function surfaceOpen(flags) {
  if (!SURFACE_TYPES.includes(flags.type)) throw new UsageError('--type must be board, note or page');
  const terminal = ownerTerminal(flags);
  const live = listLive();
  if (!live) throw new HwsError('the Herdr window did not answer');

  const placement = terminal ? gluedPlacement(live, terminal) : standalonePlacement();
  const workspace = placement.workspace ?? ensureStandaloneManifest();
  const surfaceId = newId('s');
  const file = flags.type === 'board' ? '' : resolveFile(flags.file);
  const title = flags.title ?? (file ? basename(file) : flags.type);
  const socket = socketPath(surfaceId);
  const dataDir = surfaceDataDir(workspace.id, surfaceId);
  const folder = workspace.id === STANDALONE ? home() : workspace.folder;
  mkdirSync(dataDir, { recursive: true });

  const environment = hostEnvironment({
    surfaceId,
    workspaceId: workspace.id,
    terminal,
    type: flags.type,
    title,
    file,
    folder,
    socket,
    dataDir,
  });
  const argv = ['env', ...Object.entries(environment).map(([key, value]) => `${key}=${value}`), HOST_SCRIPT];

  const opened = terminal
    ? act('pane.split', { direction: 'right', pane: placement.pane, argv })
    : act('tab.new', { name: title, space: placement.space, folder, argv });
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

function assertBundle(bundle) {
  if (!existsSync(bundle) || !statSync(bundle).isDirectory()) throw new HwsError(`no bundle folder at ${bundle}`);
  if (!existsSync(join(bundle, 'prompt.md'))) throw new HwsError(`no prompt.md in ${bundle}`);
}

// Very long text exceeds the argument limit, so the link goes in its place.
function promptToSend(promptPath) {
  const text = readFileSync(promptPath, 'utf8');
  return Buffer.byteLength(text) > MAX_SEND_BYTES ? linkFor(promptPath) : text;
}

function archiveBundle({ manifest, surface }, bundle) {
  const artifactId = newId('a');
  const artifactDir = artifactStoreDir(manifest, artifactId);
  const oldDirs = pathSpellings(bundle);
  moveDir(bundle, artifactDir);
  const prompt = join(artifactDir, 'prompt.md');
  rewritePromptFile(prompt, oldDirs, artifactDir);
  const artifact = {
    id: artifactId,
    type: surface.type,
    title: surface.title,
    path: artifactDir,
    prompt,
    fromTerminal: surface.terminal,
    createdAt: Date.now(),
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
  await closePaneThenFocus(surface.pane, surface.terminal);
  return { data: { standalone: false, artifact: artifact.id, link, delivered: true } };
}

export function surfaceSocket(flags) {
  const terminal = flags.terminal ?? process.env.HC_TERMINAL_ID;
  if (!terminal) throw new UsageError('pass --terminal or run inside a Herdr terminal');
  const matches = listManifests({ includeStandalone: true })
    .flatMap((manifest) => manifest.surfaces)
    .filter((surface) => surface.terminal === terminal && (!flags.title || surface.title === flags.title));
  const surface = matches.at(-1);
  if (!surface) throw new HwsError(`terminal ${terminal} has no matching surface`);
  return { data: { socket: surface.socket, surface: surface.id }, text: surface.socket };
}
