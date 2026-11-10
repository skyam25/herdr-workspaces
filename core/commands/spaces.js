import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { HwsError } from '../errors.js';
import { act, keepingSelection, listLive, requireLive } from '../herdr.js';
import { withLock } from '../lock.js';
import { listManifests, manifestOfSpace, readManifest, updateManifest } from '../manifest.js';
import { expandFolder, home } from '../paths.js';
import { isKept } from '../places.js';
import { callerIsAgent, requireFlag, resolveWorkspace, workspaceByRef } from '../resolve.js';
import { requireFolder } from '../settings.js';
import { boardOf, callerSpace, moveCards } from './todo.js';

const BOARD_TAB = 'Workspace board';

export function liveSpace(id) {
  const space = requireLive().spaces.find((item) => item.id === id);
  if (!space) throw new HwsError(`no open space ${id}`);
  if (space.machine) throw new HwsError(`${space.name} is on ${space.machine}, and a workspace holds only spaces on this computer`);
  return space;
}

export function requireOtherSpaces(manifest, space) {
  if (manifest.board?.space === space.id) throw new HwsError(`the Tasks space stays with ${manifest.name}`);
  if (manifest.spaces.length > 1) return;
  throw new HwsError(`${space.name} is the only space in ${manifest.name}, so add another space there first`);
}

// Takes a space and its terminal records out of a workspace, and returns the records.
export function takeSpace(manifest, space) {
  const tabIds = new Set((space.tabs ?? []).map((tab) => tab.id));
  let taken = [];
  updateManifest(manifest.id, (draft) => {
    taken = draft.terminals.filter((item) => tabIds.has(item.tabId));
    draft.terminals = draft.terminals.filter((item) => !tabIds.has(item.tabId));
    draft.spaces = draft.spaces.filter((id) => id !== space.id);
  });
  return taken;
}

function requireNotArchived(manifest) {
  if (manifest.archived) throw new HwsError(`${manifest.name} is archived, so restore it first`);
  return manifest;
}

export function spaceAdd(flags) {
  const manifest = requireNotArchived(workspaceByRef(requireFlag(flags, 'workspace')));
  const folder = flags.folder ? requireFolder(expandFolder(flags.folder)) : manifest.folder;
  const opened = act('space.new', { name: flags.name, folder });
  updateManifest(manifest.id, (draft) => {
    draft.spaces.push(opened.space);
    draft.terminals.push({ terminal: opened.terminal, tabId: opened.tab, sessionId: null, role: null });
  });
  return { data: { workspace: manifest.id, ...opened }, text: `added ${opened.space} to ${manifest.name}` };
}

// A plain space brings its cards. Cards on another workspace's board stay with that workspace.
export function spaceMove(flags) {
  const target = requireNotArchived(workspaceByRef(requireFlag(flags, 'workspace')));
  const space = liveSpace(requireFlag(flags, 'space'));
  const source = manifestOfSpace(space.id);
  const data = { workspace: target.id, space: space.id };
  if (source?.id === target.id) return { data, text: `${space.name} is already in ${target.name}` };
  if (source) requireOtherSpaces(source, space);

  const ownBoard = source ? null : boardOf(space.id);
  const records = source ? takeSpace(source, space) : [];
  updateManifest(target.id, (draft) => {
    draft.spaces.push(space.id);
    draft.terminals.push(...records);
  });
  if (ownBoard) moveCards(ownBoard, target.id);
  return { data, text: `moved ${space.name} to ${target.name}` };
}

export function spaceRemove(flags) {
  const space = liveSpace(requireFlag(flags, 'space'));
  const manifest = manifestOfSpace(space.id);
  if (!manifest) throw new HwsError(`${space.name} is not in a workspace`);
  requireOtherSpaces(manifest, space);
  takeSpace(manifest, space);
  return { data: { workspace: manifest.id, space: space.id }, text: `removed ${space.name} from ${manifest.name}` };
}

// Returns the recorded Board's open space, and whether its tab still exists.
function liveBoard(manifest) {
  const open = requireLive().spaces.find((item) => item.id === manifest.board?.space);
  return { open, hasBoard: Boolean(open?.tabs.some((tab) => tab.id === manifest.board.tab)) };
}

function ensureBoard(id) {
  const manifest = readManifest(id);
  const { open, hasBoard } = liveBoard(manifest);
  if (hasBoard) return manifest.board;

  const fresh = open ? null : act('space.new', { name: 'Tasks', folder: manifest.folder });
  const space = open?.id ?? fresh.space;
  const openBoard = () => act('tab.new', { name: BOARD_TAB, space, mod: 'hws-work', props: { view: 'tasks' } });

  // An agent adding a Board must not take the window from the person.
  const { tab } = callerIsAgent() ? keepingSelection(openBoard) : openBoard();
  if (fresh) act('tab.close', { id: fresh.tab, confirmed: true });
  const board = { space, tab };
  updateManifest(id, (draft) => {
    draft.board = board;
    if (!draft.spaces.includes(space)) draft.spaces.push(space);
  });
  return board;
}

export const addBoard = (id) => withLock(`board-${encodeURIComponent(id)}`, () => ensureBoard(id));

// Adds the workspace's one Board space, or finds the one it has.
export function boardAdd(flags) {
  const manifest = requireNotArchived(resolveWorkspace(flags));
  const board = addBoard(manifest.id);
  return { data: { workspace: manifest.id, ...board }, text: `Tasks is space ${board.space}` };
}

// Finds a space's Board and never makes one. A plain space answers with no workspace.
export function boardOpen(flags) {
  const manifest = manifestOfSpace(requireFlag(flags, 'space'));
  if (!manifest) return { data: { workspace: null }, text: 'this space is not in a workspace' };
  const { hasBoard } = liveBoard(manifest);
  const board = hasBoard ? manifest.board : { space: null, tab: null };
  return { data: { workspace: manifest.id, ...board }, text: hasBoard ? `Tasks is space ${board.space}` : `${manifest.name} has no Tasks space` };
}

// Real paths, so /tmp and /private/tmp agree. A missing folder keeps its own path.
function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const isWithin = (folder, root) => folder.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

// Returns the length of the deepest workspace root that holds the folder, or 0.
// A root at home or / only matches itself, because everything sits inside it.
function matchDepth(folder, manifest, broad) {
  const roots = [manifest.folder, manifest.home].filter(Boolean).map(realPath);
  const hits = roots.filter((root) => folder === root || (!broad.has(root) && isWithin(folder, root)));
  return Math.max(0, ...hits.map((root) => root.length));
}

// A plain local space whose folder belongs to kept workspaces it is not part of.
function matchingWorkspaces(space) {
  if (!space?.folder || space.machine || space.id.includes('/') || manifestOfSpace(space.id)) return [];
  const folder = realPath(space.folder);
  const broad = new Set([realPath(home()), sep]);
  return listManifests()
    .filter((manifest) => isKept(manifest) && !manifest.archived)
    .map((manifest) => ({ manifest, depth: matchDepth(folder, manifest, broad) }))
    .filter(({ depth }) => depth > 0)
    .sort((a, b) => b.depth - a.depth)
    .map(({ manifest: { id, name, folder: own, home: files } }) => ({ id, name, folder: own, home: files ?? null }));
}

// Finds the kept workspaces a space's folder belongs to. Writes nothing.
export function spaceMatch(flags) {
  const id = callerSpace(flags);
  const space = listLive()?.spaces.find((item) => item.id === id);
  const candidates = matchingWorkspaces(space);
  const data = { space: id, folder: space?.folder ?? null, candidates };
  return { data, text: candidates.map((item) => `${item.id}\t${item.name}\t${item.folder}`).join('\n') };
}
