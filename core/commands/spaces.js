import { HwsError } from '../errors.js';
import { act, keepingSelection, requireLive } from '../herdr.js';
import { withLock } from '../lock.js';
import { manifestOfSpace, readManifest, updateManifest } from '../manifest.js';
import { expandFolder } from '../paths.js';
import { requireFlag, resolveWorkspace, workspaceByRef } from '../resolve.js';
import { requireFolder } from '../settings.js';
import { boardOf, moveCards } from './todo.js';

// The tab bar hides a tab with this name, because the sidebar lists the Board.
const BOARD_TAB = 'Workspace board';

function liveSpace(id) {
  const space = requireLive().spaces.find((item) => item.id === id);
  if (!space) throw new HwsError(`no open space ${id}`);
  if (space.machine) throw new HwsError(`${space.name} is on ${space.machine}, and a workspace holds only spaces on this computer`);
  return space;
}

function requireOtherSpaces(manifest, space) {
  if (manifest.board?.space === space.id) throw new HwsError(`the Board space stays with ${manifest.name}`);
  if (manifest.spaces.length > 1) return;
  throw new HwsError(`${space.name} is the only space in ${manifest.name}, so add another space there first`);
}

// Takes a space and its terminal records out of a workspace, and returns the records.
function takeSpace(manifest, space) {
  const tabIds = new Set((space.tabs ?? []).map((tab) => tab.id));
  let taken = [];
  updateManifest(manifest.id, (draft) => {
    taken = draft.terminals.filter((item) => tabIds.has(item.tabId));
    draft.terminals = draft.terminals.filter((item) => !tabIds.has(item.tabId));
    draft.spaces = draft.spaces.filter((id) => id !== space.id);
  });
  return taken;
}

export function spaceAdd(flags) {
  const manifest = workspaceByRef(requireFlag(flags, 'workspace'));
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
  const target = workspaceByRef(requireFlag(flags, 'workspace'));
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

function openBoardSpace(manifest) {
  const opened = act('space.new', { name: 'Board', folder: manifest.folder });
  return { space: opened.space, shellTab: opened.tab };
}

function ensureBoard(id) {
  const manifest = readManifest(id);
  const open = requireLive().spaces.find((item) => item.id === manifest.board?.space);
  if (open?.tabs.some((tab) => tab.id === manifest.board.tab)) return manifest.board;

  const { space, shellTab } = open ? { space: open.id } : openBoardSpace(manifest);
  const openBoard = () => act('tab.new', { name: BOARD_TAB, space, mod: 'hws-work', props: { view: 'tasks' } });

  // An agent adding a Board must not take the window from the person.
  const { tab } = process.env.HC_TERMINAL_ID ? keepingSelection(openBoard) : openBoard();
  if (shellTab) act('tab.close', { id: shellTab, confirmed: true });
  const board = { space, tab };
  updateManifest(id, (draft) => {
    draft.board = board;
    if (!draft.spaces.includes(space)) draft.spaces.push(space);
  });
  return board;
}

// Adds the workspace's one Board space, or finds the one it has.
export function boardAdd(flags) {
  const manifest = resolveWorkspace(flags);
  const board = withLock(`board-${encodeURIComponent(manifest.id)}`, () => ensureBoard(manifest.id));
  return { data: { workspace: manifest.id, ...board }, text: `Board is space ${board.space}` };
}

// Finds a space's Board and never makes one. A plain space answers with no workspace.
export function boardOpen(flags) {
  const manifest = manifestOfSpace(requireFlag(flags, 'space'));
  if (!manifest) return { data: { workspace: null }, text: 'this space is not in a workspace' };
  const open = requireLive().spaces.find((item) => item.id === manifest.board?.space);
  const hasBoard = open?.tabs.some((tab) => tab.id === manifest.board.tab);
  const board = hasBoard ? manifest.board : { space: null, tab: null };
  return { data: { workspace: manifest.id, ...board }, text: hasBoard ? `Board is space ${board.space}` : `${manifest.name} has no Board` };
}
