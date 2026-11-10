import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';

import { FEEDBACK_ROLE, artifactOfFile, linkFor, moveBundle, realOf } from '../artifacts.js';
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
import { HOST_SCRIPT, slug, socketPath, stateRoot, surfaceDataDir, workspaceDir } from '../paths.js';
import { isForeign, isKept, placeOf, writablePlace } from '../places.js';
import { callingTerminal, requireCallingTerminal, requireFlag, spaceOfTerminal } from '../resolve.js';
import { hasDraftWork, isWindowOpen } from '../surface-windows.js';
import { moveToTrash } from '../trash.js';

const SURFACE_TYPES = ['board', 'note', 'page'];

// The limit for one argument on Linux, and well inside the 1 MiB macOS total.
export const MAX_SEND_BYTES = 128 * 1024;
const RAISE_MS = 3000;

export function newId(prefix) {
  return prefix + randomBytes(3).toString('hex');
}

const isUrl = (file) => /^[a-z][a-z0-9+.-]*:\/\//i.test(file);

function resolveFile(file) {
  if (!file) return '';
  return isUrl(file) ? file : resolve(file);
}

// A glued surface splits beside its terminal. A flipped agent has no pane and is
// missing from the listing, so its labels name the chat pane and space to split beside.
function gluedPlacement(live, terminal) {
  const found = findTerminal(live, terminal);
  if (found) return { workspace: manifestOfSpace(found.space.id), pane: found.pane, space: found.space.id };
  const labels = terminalInfo(terminal)?.labels ?? {};
  const chatPane = labels['herdr.chat'];
  if (!chatPane) throw new HwsError(`terminal ${terminal} is not in the Herdr window`);
  const space = spaceOfTerminal(terminal, labels);
  if (!space) throw new HwsError(`Herdr cannot place flipped terminal ${terminal} in a space, so pass --beside-pane and --space`);
  return { workspace: manifestOfSpace(space), pane: chatPane, space };
}

// The caller names the chat pane and space itself, as a mod that already knows them does.
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

// One file opens as one surface per workspace, so its draft is there when it reopens.
function surfaceIdFor(workspace, file) {
  if (!file || isUrl(file)) return newId('s');
  return `s${createHash('sha256').update(`${workspace.id}\n${file}`).digest('hex').slice(0, 8)}`;
}

const DRAFT_ENTRIES = ['drafts', 'boards'];

function draftsPlace(workspace) {
  if (!isKept(workspace)) return null;
  const { path, writer } = placeOf(workspace, 'scratch');
  return path && !isForeign(writer) ? join(path, 'drafts') : null;
}

// Clears folders left empty by delivered drafts. A surface still recorded keeps its own.
function sweepEmptyDrafts(place, workspace) {
  if (!existsSync(place)) return;
  for (const name of readdirSync(place)) {
    if (workspace.surfaces.some((surface) => name.endsWith(`-${surface.id}`))) continue;
    const folder = join(place, name);
    try {
      for (const entry of DRAFT_ENTRIES) if (existsSync(join(folder, entry))) rmdirSync(join(folder, entry));
      rmdirSync(folder);
    } catch {
      // Something is still in there, so it stays.
    }
  }
}

// The renderer writes unsent work to its data folder, beside its browser cache.
// Those two folders are links into the workspace, so the work is kept with it.
function linkDrafts(workspace, surfaceId, dataDir, name) {
  const place = draftsPlace(workspace);
  if (!place) return;
  sweepEmptyDrafts(place, workspace);
  const home = join(place, `${slug(name)}-${surfaceId}`);
  for (const entry of DRAFT_ENTRIES) {
    const link = join(dataDir, entry);
    const found = lstatSync(link, { throwIfNoEntry: false });
    if (found && !found.isSymbolicLink()) continue;
    if (found) unlinkSync(link);
    mkdirSync(join(home, entry), { recursive: true });
    symlinkSync(join(home, entry), link);
  }
}

// The workspace folder that holds a surface's linked drafts, or null.
function linkedDraftHome(dataDir) {
  const link = join(dataDir, DRAFT_ENTRIES[0]);
  return lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() && existsSync(link) ? dirname(realpathSync(link)) : null;
}

const paneIsOpen = (live, pane) => live.spaces.some((space) => (space.tabs ?? []).some((tab) => (tab.terminals ?? []).some((record) => record.pane === pane)));

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
  const file = flags.type === 'board' ? '' : resolveFile(flags.file);
  const surfaceId = surfaceIdFor(workspace, file);
  const already = workspace.surfaces.find((surface) => surface.id === surfaceId);
  if (already?.pane && paneIsOpen(live, already.pane)) {
    act('pane.focus', { pane: already.pane });
    return { data: { ...already, workspace: workspace.id, focused: true }, text: `showed ${surfaceId}` };
  }
  const title = flags.title ?? (file ? basename(file) : flags.type);
  const socket = socketPath(surfaceId);
  const dataDir = surfaceDataDir(workspace.id, surfaceId);
  mkdirSync(dataDir, { recursive: true });
  linkDrafts(workspace, surfaceId, dataDir, file ? basename(file) : title);

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

  const surface = { id: surfaceId, type: flags.type, title, terminal, pane, socket, pid, ...(file ? { file } : {}) };
  updateManifest(workspace.id, (draft) => {
    draft.surfaces = draft.surfaces.filter((item) => item.id !== surfaceId);
    draft.surfaces.push(surface);
  });
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

// A review belongs to a pass when a tidy terminal opened it or it shows a file
// from the pass's folder, which covers a pass run in the person's own session.
function isTidyReview(manifest, { terminal, file }) {
  if (manifest.terminals.some((item) => item.terminal === terminal && item.role === TIDY_ROLE)) return true;
  return Boolean(file) && dirname(resolve(file)) === join(workspaceDir(manifest.id), 'tidy');
}

// A page that shows a file is a round of feedback on it. The round names the file and
// the artifact that tracks it, so the panel files it under that artifact.
function feedbackFields(manifest, surface) {
  if (surface.type !== 'page' || !surface.file || isUrl(surface.file)) return null;
  const file = realOf(surface.file);
  return { role: FEEDBACK_ROLE, title: `Feedback on ${surface.title}`, file, reviewOf: artifactOfFile(manifest, file)?.id ?? null };
}

// Kept bundles land under the workspace's artifacts place. The surface's record stays.
export function archiveBundle({ manifest, surface }, bundle) {
  const artifactId = newId('a');

  // A kept workspace's folders are for people to read, so its bundles carry their titles.
  const place = surface.type === 'note' && isKept(manifest) ? 'notes' : 'artifacts';
  const artifactDir = join(writablePlace(manifest, place), isKept(manifest) ? `${slug(surface.title)}-${artifactId}` : artifactId);
  const prompt = moveBundle(bundle, artifactDir);
  const review = isTidyReview(manifest, surface) ? { role: TIDY_ROLE } : feedbackFields(manifest, surface);
  const artifact = {
    id: artifactId,
    type: surface.type,
    title: surface.title,
    path: artifactDir,
    prompt,
    fromTerminal: surface.terminal,
    createdAt: Date.now(),
    status: 'current',
    ...review,
  };
  updateManifest(manifest.id, (draft) => {
    draft.artifacts.push(artifact);
  });
  return artifact;
}

function dropSurface(manifest, surface) {
  updateManifest(manifest.id, (draft) => {
    draft.surfaces = draft.surfaces.filter((item) => item.id !== surface.id);
  });
}

const quoted = (path) => (/[\s"'$`\\]/.test(path) ? `'${path.replaceAll("'", `'\\''`)}'` : path);

// Tells the agent how to hand the page back, in the prompt it is about to read.
function askForAnotherLook(artifact) {
  if (artifact.role !== FEEDBACK_ROLE) return;
  appendFileSync(artifact.prompt, `\n\nIf you change the page, run \`hws review ${quoted(artifact.file)}\` afterwards so the person can look again.\n`);
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
  const drafts = linkedDraftHome(data);
  if (existsSync(data)) moveToTrash([data, ...(drafts ? [drafts] : [])]);
  dropSurface(manifest, surface);
  return { data: { id: surface.id, discarded: true }, text: `discarded ${surface.id}` };
}

export async function surfaceDone(flags) {
  const surfaceId = requireFlag(flags, 'id');
  const bundle = resolve(requireFlag(flags, 'bundle'));
  const found = findSurface(surfaceId);
  assertBundle(bundle);
  const artifact = archiveBundle(found, bundle);
  const link = linkFor(artifact.prompt);
  const { manifest, surface } = found;

  // A pane with no terminal to answer stays open on its work, so its record stays too.
  const saved = () => {
    if (!surface.pane) dropSurface(manifest, surface);
    return { standalone: true, artifact: artifact.id, link };
  };
  if (!surface.terminal) return { data: saved() };
  if (!isTerminalAlive(surface.terminal)) {
    logDelivery(surface, `terminal ${surface.terminal} is not live`);
    return { data: saved() };
  }
  askForAnotherLook(artifact);
  try {
    sendText(surface.terminal, promptToSend(artifact.prompt));
  } catch (error) {
    logDelivery(surface, error.message);
    return { data: { ...saved(), deliveryError: error.message } };
  }
  dropSurface(manifest, surface);

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
