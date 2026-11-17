import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { ANSWERS_ROLE, FEEDBACK_ROLE, artifactOfFile, linkFor, moveBundle, moveDir, realOf } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import {
  act,
  chatPaneOf,
  closePaneThenFocus,
  findTerminal,
  focusTerminal,
  isTerminalAlive,
  killTerminal,
  listLive,
  requireLive,
  runDetached,
  sendText,
  terminalInfo,
  windowStatus,
} from '../herdr.js';
import { TIDY_ROLE, ensureStandaloneManifest, listManifests, manifestOfSpace, updateManifest } from '../manifest.js';
import { HOST_SCRIPT, STANDALONE, SURFACE_CLI, slug, socketPath, stateRoot, surfaceDataDir, workspaceDir } from '../paths.js';
import { isForeign, isKept, placeOf, writablePlace } from '../places.js';
import { callingTerminal, requireCallingTerminal, requireFlag, spaceOfTerminal, workspaceByRef } from '../resolve.js';
import { hasDraftWork, isWindowOpen } from '../surface-windows.js';
import { moveToTrash } from '../trash.js';

const SURFACE_TYPES = ['board', 'note', 'page'];
const OUTLINE_FILE = /\.outline\.md$/i;

// The limit for one argument on Linux, and well inside the 1 MiB macOS total.
export const MAX_SEND_BYTES = 128 * 1024;
const RAISE_MS = 3000;

// A host ends soon after its pane or window closes. A stuck one is killed.
const STOP_WAIT_MS = 3000;
const KILL_WAIT_MS = 2000;
const POLL_MS = 100;
const POP_PLACES = ['window', 'pane'];

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

// A board and a note open in a window, and a page opens in a pane.
function opensInWindow(flags) {
  if (flags.window && flags['in-pane']) throw new UsageError('use --window or --in-pane, not both');
  if (flags.window) return true;
  if (flags['in-pane']) return false;
  return flags.type !== 'page';
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

// The title names the pane in Herdr's header, so it is one line and never blank.
function surfaceTitle(given, file, type) {
  const line = (given ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  return line || (file ? basename(file) : type);
}

// One file opens as one surface per workspace, so its draft is there when it reopens.
// A terminal's questions open as one surface too, so a new round finds the answers held.
// A reopened sketch keys on its artifact, so a moved bundle still finds its surface.
function surfaceKey({ type, file, terminal, reopens }) {
  if (type === 'questions') return `questions ${terminal}`;
  if (type !== 'board') return file;
  if (reopens) return `board ${reopens}`;
  return file ? `board ${file}` : '';
}

function surfaceIdFor(workspace, surface) {
  const key = surfaceKey(surface);
  if (!key || isUrl(key)) return newId('s');
  return `s${createHash('sha256').update(`${workspace.id}\n${key}`).digest('hex').slice(0, 8)}`;
}

const DRAFT_ENTRIES = ['drafts', 'boards'];

// A sketch's drafts folder carries its title, because its source is always board.excalidraw.
const draftName = ({ type, file, title }) => (file && type !== 'board' ? basename(file) : title);

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

// The listed terminal that shows a pane, or null when the pane is closed.
function paneTerminal(live, pane) {
  if (!pane) return null;
  for (const space of live.spaces) {
    for (const tab of space.tabs ?? []) {
      const found = (tab.terminals ?? []).find((record) => record.pane === pane);
      if (found) return found.terminal;
    }
  }
  return null;
}

const paneIsOpen = (live, pane) => paneTerminal(live, pane) !== null;

// `owner` is set only for a surface in its own window. A sketch's drawing arrives as a seed, never as a file.
function hostArgv({ workspace, id, type, title, terminal, file, owner }) {
  const environment = {
    HWS_HOME: stateRoot(),
    HWS_SURFACE_ID: id,
    HWS_WORKSPACE_ID: workspace.id,
    HWS_WORKSPACE_NAME: workspace.id === STANDALONE ? '' : workspace.name,
    HWS_TERMINAL: terminal ?? '',
    HWS_SURFACE_TYPE: type,
    HWS_SURFACE_TITLE: title,
    HWS_SURFACE_FILE: type === 'board' ? '' : file,
    HWS_FOLDER: workspace.folder,
    COMPANION_SOCKET: socketPath(id),
    COMPANION_DATA_DIR: surfaceDataDir(workspace.id, id),
    ...(owner === undefined ? {} : { HWS_SURFACE_WINDOW: '1', HWS_SURFACE_OWNER: owner }),
  };
  return ['env', ...Object.entries(environment).map(([key, value]) => `${key}=${value}`), HOST_SCRIPT];
}

export function surfaceOpen(flags) {
  if (!SURFACE_TYPES.includes(flags.type)) throw new UsageError('--type must be board, note or page');
  if (flags.artifact !== undefined && flags.type !== 'board') throw new UsageError('--artifact reopens a sketch, so use it with --type board');
  return openSurface(flags);
}

// A Done bundle keeps its drawing here, and its pinned comments and notes beside it.
const BUNDLE_SCENE = 'board.excalidraw';
const SEED_DIR = 'seed';
const SEED_EXTRAS = ['comments.json', 'comments.md', 'notes.md'];

function openManifestOf(artifactId) {
  for (const manifest of listManifests({ includeStandalone: true })) {
    const artifact = manifest.artifacts.find((item) => item.id === artifactId);
    if (artifact) return { manifest, artifact };
  }
  return null;
}

// The board artifact whose bundle holds this drawing, or null.
function boardArtifactOfFile(file) {
  const real = realOf(file);
  for (const manifest of listManifests({ includeStandalone: true })) {
    const artifact = manifest.artifacts.find((item) => item.type === 'board' && item.path && realOf(join(item.path, BUNDLE_SCENE)) === real);
    if (artifact) return { manifest, artifact };
  }
  return null;
}

function assertScene(file) {
  let scene;
  try {
    scene = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new HwsError(`${file} is not valid JSON`);
  }
  if (!Array.isArray(scene?.elements)) throw new HwsError(`${file} is not an Excalidraw scene`);
}

function artifactSource({ manifest, artifact }) {
  if (artifact.type !== 'board') throw new HwsError(`artifact ${artifact.id} is a ${artifact.type}, and only a sketch reopens on a board`);
  if (manifest.archived) throw new HwsError(`${manifest.name} is archived, so restore it first`);
  const file = join(artifact.path, BUNDLE_SCENE);
  if (!existsSync(file)) throw new HwsError(`sketch ${artifact.id} has no drawing to reopen`);
  assertScene(file);
  return { file: realOf(file), manifest, artifact, title: artifact.title };
}

// What a board opens on: a sketch artifact, a file inside one, or a plain `.excalidraw` file. Null for a blank board.
function boardSource(flags) {
  if (flags.type !== 'board') return null;
  if (flags.file !== undefined && flags.artifact !== undefined) throw new UsageError('use --file or --artifact, not both');
  if (flags.artifact !== undefined) {
    const found = openManifestOf(flags.artifact);
    if (!found) throw new HwsError(`no artifact ${flags.artifact} in an open workspace`);
    return artifactSource(found);
  }
  if (!flags.file) return null;
  const file = resolve(flags.file);
  if (extname(file).toLowerCase() !== '.excalidraw') throw new HwsError(`a sketch opens an .excalidraw file, so it cannot open ${basename(file)}`);
  if (!existsSync(file)) throw new HwsError(`no file at ${file}`);
  const bundled = boardArtifactOfFile(file);
  if (bundled) return artifactSource(bundled);
  assertScene(file);
  return { file: realOf(file), manifest: null, artifact: null, title: basename(file, extname(file)) };
}

// Copies the drawing into the data folder, where the host loads it once. The source is only read.
function seedBoard(dataDir, source) {
  const seed = join(dataDir, SEED_DIR);
  rmSync(seed, { recursive: true, force: true });
  mkdirSync(seed, { recursive: true });
  copyFileSync(source.file, join(seed, BUNDLE_SCENE));
  if (!source.artifact) return;
  for (const name of SEED_EXTRAS) {
    const extra = join(source.artifact.path, name);
    if (existsSync(extra)) copyFileSync(extra, join(seed, name));
  }
}

// `prepare` writes into the data folder before the host starts. `hws ask` puts its round there.
export async function openSurface(flags, { prepare } = {}) {
  assertBesideFlags(flags);
  const windowed = opensInWindow(flags);
  const terminal = ownerTerminal(flags);
  if (terminal?.includes('/')) throw new HwsError(`surfaces run on this computer, and ${terminal} is on another machine`);
  const source = boardSource(flags);
  const live = requireLive();

  // A reopened sketch belongs to the workspace that holds its artifact.
  const placement = placementFor(live, terminal, flags);
  const workspace = source?.manifest ?? placement.workspace ?? ensureStandaloneManifest();
  const file = flags.type === 'questions' ? '' : flags.type === 'board' ? (source?.file ?? '') : resolveFile(flags.file);
  const reopens = source?.artifact?.id;
  const surfaceId = surfaceIdFor(workspace, { type: flags.type, file, terminal, reopens });

  // A file's surface shows again where it already is, whatever the flags say.
  const already = workspace.surfaces.find((surface) => surface.id === surfaceId);
  if (already?.pane && paneIsOpen(live, already.pane)) {
    act('pane.focus', { pane: already.pane });
    return { data: { ...already, workspace: workspace.id, focused: true }, text: `showed ${surfaceId}` };
  }
  if (already?.host && isWindowOpen(already)) {
    const raised = await raiseWindow(already);
    return { data: { ...already, workspace: workspace.id, focused: true, raised }, text: `showed ${surfaceId}` };
  }

  const title = surfaceTitle(flags.title ?? source?.title, flags.type === 'board' ? '' : file, flags.type);
  const socket = socketPath(surfaceId);
  const dataDir = surfaceDataDir(workspace.id, surfaceId);
  mkdirSync(dataDir, { recursive: true });

  // Questions leave no drafts, so they get no folder in the workspace.
  if (flags.type !== 'questions') linkDrafts(workspace, surfaceId, dataDir, draftName({ type: flags.type, file, title }));

  // A draft left from an earlier opening keeps its edits. Otherwise the board starts from the source.
  if (source && !(already && hasDraftWork(workspace.id, surfaceId))) seedBoard(dataDir, source);
  prepare?.(dataDir);

  const owner = windowed ? (terminal ? windowOwnerLabel(live, terminal, placement) : '') : undefined;
  const argv = hostArgv({ workspace, id: surfaceId, type: flags.type, title, terminal, file, owner });
  const fileFields = { ...(file ? { file } : {}), ...(reopens ? { reopens } : {}) };

  if (windowed) {
    const host = runDetached(argv, workspace.folder);
    const surface = { id: surfaceId, type: flags.type, title, terminal, pane: null, host, socket, pid: terminalInfo(host)?.pid ?? null, ...fileFields };
    replaceSurface(workspace.id, surface);
    return { data: { ...surface, workspace: workspace.id, hostTerminal: host }, text: `opened ${flags.type} ${surfaceId}` };
  }

  const opened = terminal
    ? act('pane.split', { direction: 'right', pane: placement.pane, argv })
    : act('tab.new', { name: title, space: placement.space, folder: workspace.folder, argv });
  const pane = opened.pane ?? findTerminal(listLive() ?? { spaces: [] }, opened.terminal)?.pane ?? null;
  const pid = terminalInfo(opened.terminal)?.pid ?? null;

  const surface = { id: surfaceId, type: flags.type, title, terminal, pane, socket, pid, ...fileFields };
  replaceSurface(workspace.id, surface);
  const data = { ...surface, workspace: workspace.id, hostTerminal: opened.terminal };
  return { data, text: `opened ${flags.type} ${surfaceId}` };
}

// A reopened surface replaces its old record and moves to the end of the list.
function replaceSurface(workspaceId, surface) {
  updateManifest(workspaceId, (draft) => {
    draft.surfaces = draft.surfaces.filter((item) => item.id !== surface.id);
    draft.surfaces.push(surface);
  });
}

// Rewrites a record where it stands. A prune may drop a record whose host just ended, so it comes back.
function rewriteSurface(workspaceId, surface) {
  updateManifest(workspaceId, (draft) => {
    const at = draft.surfaces.findIndex((item) => item.id === surface.id);
    if (at === -1) draft.surfaces.push(surface);
    else draft.surfaces[at] = surface;
  });
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
// A reopened sketch's bundle replaces the one it reopened, and a second press replaces the first.
export function archiveBundle({ manifest, surface }, bundle) {
  const artifactId = newId('a');

  // A kept workspace's folders are for people to read, so its bundles carry their titles.
  const place = surface.type === 'note' && isKept(manifest) ? 'notes' : 'artifacts';
  const artifactDir = join(writablePlace(manifest, place), isKept(manifest) ? `${slug(surface.title)}-${artifactId}` : artifactId);
  const prompt = moveBundle(bundle, artifactDir);
  const review = surface.type === 'questions' ? { role: ANSWERS_ROLE } : isTidyReview(manifest, surface) ? { role: TIDY_ROLE } : feedbackFields(manifest, surface);
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
    const old = surface.reopens ? draft.artifacts.find((item) => item.id === surface.reopens) : null;
    if (surface.reopens) artifact.supersedes = old ? old.id : null;
    if (old) old.status = 'superseded';
    draft.artifacts.push(artifact);
    const record = draft.surfaces.find((item) => item.id === surface.id);
    if (record?.reopens) record.reopens = artifactId;
  });
  return artifact;
}

export function dropSurface(manifest, surface) {
  updateManifest(manifest.id, (draft) => {
    draft.surfaces = draft.surfaces.filter((item) => item.id !== surface.id);
  });
}

const quoted = (path) => (/[\s"'$`\\]/.test(path) ? `'${path.replaceAll("'", `'\\''`)}'` : path);

// Tells the agent how to hand the page back, in the prompt it is about to read.
// An outline's view reloads as the agent changes it, so it needs no second look.
function askForAnotherLook(artifact) {
  if (artifact.role !== FEEDBACK_ROLE || OUTLINE_FILE.test(artifact.file)) return;
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

// Work that belongs to no workspace: surfaces still open or holding a draft, then saved artifacts.
// Each list is newest first.
export function unfiledList() {
  const manifest = listManifests({ includeStandalone: true }).find((item) => item.id === STANDALONE);
  if (!manifest) return { data: { surfaces: [], artifacts: [] }, text: 'nothing unfiled' };
  const live = listLive() ?? { spaces: [] };
  const stateOf = (surface) => {
    if (!surface.host) return paneIsOpen(live, surface.pane) ? 'pane' : null;
    if (isWindowOpen(surface)) return 'open';
    return hasDraftWork(manifest.id, surface.id) ? 'draft' : null;
  };
  const surfaces = manifest.surfaces
    .map((surface) => ({ id: surface.id, type: surface.type, title: surface.title, file: surface.file ?? null, state: stateOf(surface) }))
    .filter((surface) => surface.state)
    .reverse();
  const artifacts = manifest.artifacts
    .map((artifact) => ({ id: artifact.id, type: artifact.type, title: artifact.title, path: artifact.path, createdAt: artifact.createdAt ?? null }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const lines = [...surfaces.map((item) => `${item.id}\t${item.state}\t${item.title}`), ...artifacts.map((item) => `${item.id}\tsaved\t${item.title}`)];
  return { data: { surfaces, artifacts }, text: lines.join('\n') || 'nothing unfiled' };
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

// Starts a window host on the surface's id, data folder, title, file and owner.
function startWindow(manifest, surface, live) {
  const owner = surface.terminal ? windowOwnerLabel(live, surface.terminal, {}) : '';
  const argv = hostArgv({ workspace: manifest, id: surface.id, type: surface.type, title: surface.title, terminal: surface.terminal, file: surface.file ?? '', owner });
  const host = runDetached(argv, manifest.folder);
  return { host, pid: terminalInfo(host)?.pid ?? null };
}

// Brings an open window forward, or starts a closed one again on its saved data.
export async function surfaceResume(flags) {
  const { manifest, surface } = findWindow(requireFlag(flags, 'id'));
  if (isWindowOpen(surface)) {
    const raised = await raiseWindow(surface);
    return { data: { id: surface.id, resumed: false, raised }, text: `showed ${surface.id}` };
  }

  const { host, pid } = startWindow(manifest, surface, requireLive());
  rewriteSurface(manifest.id, { ...surface, host, pid });
  return { data: { id: surface.id, resumed: true, host }, text: `resumed ${surface.id}` };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function endsWithin(terminal, ms) {
  const deadline = Date.now() + ms;
  while (isTerminalAlive(terminal)) {
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
  return true;
}

// Two hosts on one surface would share its socket and Chromium data folder, so the old one must end first.
async function awaitHostEnd(terminal) {
  if (await endsWithin(terminal, STOP_WAIT_MS)) return;
  killTerminal(terminal);
  if (!(await endsWithin(terminal, KILL_WAIT_MS))) throw new HwsError(`the old host in ${terminal} did not end`);
}

// A surface comes back beside its owner, or beside the chat pane of a flipped owner.
// It opens a tab in the selected space when it has no live owner.
function popInPlacement(live, surface) {
  if (surface.terminal && isTerminalAlive(surface.terminal)) {
    const pane = findTerminal(live, surface.terminal)?.pane ?? chatPaneOf(surface.terminal);
    if (pane) return { pane };
  }
  return { pane: null, space: windowStatus()?.space ?? undefined };
}

async function popOut(manifest, surface, live) {
  const paneHost = paneTerminal(live, surface.pane);
  if (!paneHost) throw new HwsError(`surface ${surface.id} has no open pane`);
  act('pane.close', { pane: surface.pane });
  await awaitHostEnd(paneHost);
  const { host, pid } = startWindow(manifest, surface, live);
  rewriteSurface(manifest.id, { ...surface, pane: null, host, pid });
  return { id: surface.id, shown: 'window', moved: true, host };
}

async function popIn(manifest, surface, live) {
  const placement = popInPlacement(live, surface);
  if (isWindowOpen(surface)) {
    killTerminal(surface.host);
    await awaitHostEnd(surface.host);
  }
  const argv = hostArgv({ workspace: manifest, id: surface.id, type: surface.type, title: surface.title, terminal: surface.terminal, file: surface.file ?? '' });
  const opened = placement.pane
    ? act('pane.split', { direction: 'right', pane: placement.pane, argv })
    : act('tab.new', { name: surface.title, space: placement.space, folder: manifest.folder, argv });
  const pane = opened.pane ?? findTerminal(listLive() ?? { spaces: [] }, opened.terminal)?.pane ?? null;
  const pid = terminalInfo(opened.terminal)?.pid ?? null;
  const { host: _host, ...rest } = surface;
  rewriteSurface(manifest.id, { ...rest, pane, pid });
  return { id: surface.id, shown: 'pane', moved: true, pane };
}

// Ends a surface's host in its pane or window and waits for it to go. A closed one is left as it is.
export async function endHost(live, surface) {
  if (surface.host) {
    if (!isWindowOpen(surface)) return;
    killTerminal(surface.host);
    await awaitHostEnd(surface.host);
    return;
  }
  const paneHost = paneTerminal(live, surface.pane);
  if (!paneHost) return;
  act('pane.close', { pane: surface.pane });
  await awaitHostEnd(paneHost);
}

// Shows a surface where it already is. A closed window starts again on its saved data.
async function showInPlace(manifest, surface, live, shown) {
  if (shown === 'pane') {
    if (!paneIsOpen(live, surface.pane)) throw new HwsError(`surface ${surface.id} has no open pane`);
    act('pane.focus', { pane: surface.pane });
  } else if (isWindowOpen(surface)) {
    await raiseWindow(surface);
  } else {
    const { host, pid } = startWindow(manifest, surface, live);
    rewriteSurface(manifest.id, { ...surface, host, pid });
  }
  return { id: surface.id, shown, moved: false };
}

// Moves a surface between its pane and its own window. The surface's own host may call this
// and end part-way through, so hws ignores the hangup and its closed stdout.
export async function surfacePop(flags) {
  const surfaceId = requireFlag(flags, 'id');
  if (flags.to !== undefined && !POP_PLACES.includes(flags.to)) throw new UsageError('--to must be window or pane');
  const { manifest, surface } = findSurface(surfaceId);
  const live = requireLive();
  const shown = surface.host ? 'window' : 'pane';
  const target = flags.to ?? (shown === 'window' ? 'pane' : 'window');
  if (target === shown) {
    const data = await showInPlace(manifest, surface, live, shown);
    return { data, text: `showed ${surfaceId}` };
  }

  process.on('SIGHUP', () => {});
  const data = target === 'window' ? await popOut(manifest, surface, live) : await popIn(manifest, surface, live);
  return { data, text: `moved ${surfaceId} to a ${target}` };
}

// The workspace a move names. `standalone` takes a surface or artifact out of every workspace.
export function moveTarget(ref) {
  if (ref === STANDALONE) return ensureStandaloneManifest();
  const workspace = workspaceByRef(ref);
  if (workspace.archived) throw new HwsError(`${workspace.name} is archived, so restore it first`);
  return workspace;
}

// Turns linked draft folders back into real ones inside the data folder.
function unlinkDrafts(dataDir) {
  for (const entry of DRAFT_ENTRIES) {
    const link = join(dataDir, entry);
    if (!lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
    const target = existsSync(link) ? realpathSync(link) : null;
    unlinkSync(link);
    if (target) moveDir(target, link);
  }
}

// Puts real draft folders under the workspace's drafts place and links them back.
function relinkDrafts(workspace, surface, dataDir) {
  const place = draftsPlace(workspace);
  if (!place) return;
  const home = join(place, `${slug(draftName(surface))}-${surface.id}`);
  for (const entry of DRAFT_ENTRIES) {
    const link = join(dataDir, entry);
    if (existsSync(link)) moveDir(link, join(home, entry));
    else mkdirSync(join(home, entry), { recursive: true });
    symlinkSync(join(home, entry), link);
  }
}

// Moves a surface's record and data to another workspace, keeping its id.
// An open window ends first and starts again on the moved data.
export async function surfaceMove(flags) {
  const surfaceId = requireFlag(flags, 'id');
  const target = moveTarget(requireFlag(flags, 'workspace'));
  const { manifest, surface } = findSurface(surfaceId);
  if (manifest.id === target.id) return { data: { id: surfaceId, workspace: target.id, moved: false }, text: `${surfaceId} is already in ${target.name}` };
  if (!surface.host) throw new HwsError('pop the surface out to its own window before moving it');

  process.on('SIGHUP', () => {});
  const wasOpen = isWindowOpen(surface);
  if (wasOpen) {
    killTerminal(surface.host);
    await awaitHostEnd(surface.host);
  }

  const from = surfaceDataDir(manifest.id, surfaceId);
  const to = surfaceDataDir(target.id, surfaceId);
  const oldHome = linkedDraftHome(from);
  if (existsSync(from)) {
    unlinkDrafts(from);
    moveDir(from, to);
  } else {
    mkdirSync(to, { recursive: true });
  }
  relinkDrafts(target, surface, to);
  if (oldHome) {
    try {
      rmdirSync(oldHome);
    } catch {
      // Something else is still in there, so it stays.
    }
  }

  dropSurface(manifest, surface);
  let moved = { ...surface };
  if (wasOpen) {
    const { host, pid } = startWindow(target, surface, requireLive());
    moved = { ...moved, host, pid };
  }
  replaceSurface(target.id, moved);
  return { data: { id: surfaceId, from: manifest.id, workspace: target.id, moved: true, restarted: wasOpen }, text: `moved ${surfaceId} to ${target.name}` };
}

// Where a surface can move. The workspace of the selected space comes first when it is another one.
export function surfaceTargets(flags) {
  const current = flags.id ? findSurface(flags.id).manifest.id : null;
  const space = windowStatus()?.space;
  const selected = space ? manifestOfSpace(space)?.id ?? null : null;
  const workspaces = listManifests()
    .filter((item) => !item.archived)
    .map((item) => ({ id: item.id, name: item.name, kind: item.kind }));
  const suggested = selected && selected !== current ? selected : null;
  return {
    data: { current, suggested, workspaces },
    text: workspaces.map((item) => `${item.id}\t${item.name}${item.id === suggested ? '\tsuggested' : ''}${item.id === current ? '\tcurrent' : ''}`).join('\n'),
  };
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

// The newest surface glued to the terminal that matches the title and type.
function gluedSurface(terminal, { title, type }, listening = () => true) {
  return listManifests({ includeStandalone: true })
    .flatMap((manifest) => manifest.surfaces)
    .filter((surface) => surface.terminal === terminal && (!title || surface.title === title) && (!type || surface.type === type))

    // A draft's window is closed, so nothing listens on its socket.
    .filter((surface) => (!surface.host || isWindowOpen(surface)) && listening(surface))
    .at(-1);
}

export function surfaceSocket(flags) {
  const terminal = requireCallingTerminal(flags);
  const surface = gluedSurface(terminal, flags);
  if (!surface) throw new HwsError(`terminal ${terminal} has no matching surface`);
  return { data: { socket: surface.socket, surface: surface.id }, text: surface.socket };
}

// Runs the surface's `agent-brief` CLI against the terminal's surface, as the surface's stand-in session.
// Returns the CLI's exit code. Its stdin, stdout and stderr are this process's own.
export function surfaceCli(flags, args) {
  if (flags.type !== undefined && !SURFACE_TYPES.includes(flags.type)) throw new UsageError('--type must be board, note or page');
  if (args.length === 0) throw new UsageError('name an agent-brief verb after --, such as: hws surface cli -- status');
  const terminal = requireCallingTerminal(flags);
  const surface = gluedSurface(terminal, flags, (item) => existsSync(item.socket));
  if (!surface) {
    const kind = flags.type ? `${flags.type} ` : '';
    const named = flags.title ? ` titled ${JSON.stringify(flags.title)}` : '';
    throw new HwsError(`terminal ${terminal} has no open ${kind}surface${named}. Open one with hws review FILE or hws surface open first`);
  }
  const cli = process.env.HWS_SURFACE_CLI || SURFACE_CLI;
  if (!existsSync(cli)) throw new HwsError(`no surface CLI at ${cli}. Run install.sh to build the surface`);
  const environment = { ...process.env, COMPANION_SOCKET: surface.socket, CLAUDE_CODE_SESSION_ID: `surface-${surface.id}` };
  const ran = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: environment });
  if (ran.error) throw new HwsError(`could not run ${cli}: ${ran.error.message}`);
  return ran.status ?? 1;
}
