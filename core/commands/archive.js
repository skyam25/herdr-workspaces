import { existsSync } from 'node:fs';

import { resumeArgv, sessionOfTerminal } from '../agent-session.js';
import { HwsError } from '../errors.js';
import { act, keepingSelection, killTerminal, requireLive, terminalInfo } from '../herdr.js';
import { TIDY_ROLE, updateManifest } from '../manifest.js';
import { transcriptPath } from '../paths.js';
import { modifiedAt } from '../retired.js';
import { isKept } from '../places.js';
import { callerIsAgent, requireFlag, resolveWorkspace, workspaceByRef } from '../resolve.js';
import { requireFolder } from '../settings.js';
import { inClosingOrder, liveSpaces } from './lifecycle.js';
import { addBoard } from './spaces.js';

// Herdr reports an unnamed tab by its position or id.
const savedName = (name) => (!name || /^(tb)?\d+$/.test(name) ? null : name);

const recordOf = (manifest, terminal) => manifest.terminals.find((item) => item.terminal === terminal);

// A flipped agent has no pane, so `herdr-app ls` leaves it out.
function flippedIn(manifest, tab, listed) {
  return manifest.terminals
    .filter((item) => item.tabId === tab.id && !listed.includes(item.terminal) && terminalInfo(item.terminal)?.labels?.['herdr.chat'])
    .map((item) => item.terminal);
}

const listedIn = (tab) => (tab.terminals ?? []).map((item) => item.terminal);

// A shell whose agent has exited still resumes, as `hws resume` does.
function sessionIn(manifest, terminal) {
  const running = sessionOfTerminal(terminal);
  if (running) return running;
  const id = recordOf(manifest, terminal)?.sessionId;
  return id ? { tool: 'claude', id, folder: null } : null;
}

// One entry per agent session, or one plain entry for a tab of shells. A tidy
// pass and a tab with no terminal are not worth reopening.
function savedTabs(manifest, tab) {
  const listed = listedIn(tab);
  const terminals = [...listed, ...flippedIn(manifest, tab, listed)].filter((terminal) => recordOf(manifest, terminal)?.role !== TIDY_ROLE);
  if (terminals.length === 0) return [];
  const name = savedName(tab.name);
  const sessions = terminals.map((terminal) => sessionIn(manifest, terminal)).filter(Boolean);
  if (sessions.length === 0) return [{ name, folder: terminalInfo(terminals[0])?.foreground?.cwd ?? null, session: null }];
  return sessions.map(({ tool, id, folder }) => ({ name, folder, session: { tool, id } }));
}

function snapshot(manifest, spaces) {
  return spaces.map((space) => ({
    name: space.name,
    folder: space.folder ?? null,
    board: space.id === manifest.board?.space,
    tabs: (space.tabs ?? []).filter((tab) => tab.id !== manifest.board?.tab).flatMap((tab) => savedTabs(manifest, tab)),
  }));
}

const RESTORED_SESSIONS = 4;

// What a kept workspace can reopen with once its spaces are already gone. Tab
// names went with them, so each recent agent session becomes one tab.
function afterTheFact(manifest) {
  const seen = manifest.terminals.filter((item) => item.sessionId && item.role !== TIDY_ROLE).map((item) => item.sessionId);
  const newest = [...new Set(seen)]
    .sort((a, b) => (modifiedAt(transcriptPath(manifest.folder, b)) ?? 0) - (modifiedAt(transcriptPath(manifest.folder, a)) ?? 0))
    .slice(0, RESTORED_SESSIONS);
  const tabs = newest.map((id) => ({ name: null, folder: null, session: { tool: 'claude', id } }));
  return [{ name: manifest.name, folder: null, board: false, tabs }, ...(manifest.board ? [{ name: 'Board', folder: null, board: true, tabs: [] }] : [])];
}

// A kept workspace whose spaces all closed stays restorable.
export function archiveClosed(manifest) {
  updateManifest(manifest.id, (draft) => {
    draft.archived = { at: Date.now(), spaces: afterTheFact(draft) };
    draft.spaces = [];
  });
}

// The flag goes on disk before anything closes, because a caller inside the
// workspace dies with its space.
export function archive(flags) {
  const manifest = resolveWorkspace(flags);
  if (!isKept(manifest)) throw new HwsError(`${manifest.name} is a ${manifest.kind}, so close it instead`);
  if (manifest.archived) throw new HwsError(`${manifest.name} is already archived`);
  const spaces = liveSpaces(manifest, requireLive());
  const saved = snapshot(manifest, spaces);
  const flipped = spaces.flatMap((space) => space.tabs ?? []).flatMap((tab) => flippedIn(manifest, tab, listedIn(tab)));

  updateManifest(manifest.id, (draft) => {
    draft.archived = { at: Date.now(), spaces: saved };
    draft.spaces = [];
  });
  for (const surface of manifest.surfaces) {
    if (surface.host) killTerminal(surface.host);
  }
  for (const terminal of flipped) {
    if (terminal !== process.env.HC_TERMINAL_ID) killTerminal(terminal);
  }
  for (const space of inClosingOrder(spaces)) {
    act('space.close', { id: space.id, confirmed: true });
  }
  return { data: { archived: true, workspace: manifest.id }, text: `archived ${manifest.name}` };
}

function tabArguments(tab, folder) {
  return { name: tab.name ?? undefined, folder, argv: tab.session ? resumeArgv(tab.session) : undefined };
}

// A worktree or subfolder can be gone by now, so each tab falls back to its space and then the workspace.
function folderChooser(manifest) {
  const usable = (path) => (path && existsSync(path) ? path : null);
  return (space, tab) => usable(tab?.folder) ?? usable(space.folder) ?? manifest.folder;
}

const openedRecord = (tab, opened) => ({ terminal: opened.terminal, tabId: opened.tab, sessionId: tab.session?.id ?? null });

// Opens a space and its tabs, and returns the space id and the opened terminals.
function openSpace(space, chooseFolder) {
  const [first = {}, ...others] = space.tabs;
  const { name: tabName, folder, argv } = tabArguments(first, chooseFolder(space, first));
  const opened = act('space.new', { name: space.name, folder, argv });
  if (tabName) act('tab.rename', { id: opened.tab, name: tabName });
  const records = [openedRecord(first, opened)];
  for (const tab of others) records.push(openedRecord(tab, act('tab.new', { ...tabArguments(tab, chooseFolder(space, tab)), space: opened.space })));
  return { space: opened.space, records };
}

function openBoardSpace(manifest, space, chooseFolder) {
  const board = addBoard(manifest.id);
  return space.tabs.map((tab) => openedRecord(tab, act('tab.new', { ...tabArguments(tab, chooseFolder(space, tab)), space: board.space })));
}

// Sessions keep their records, so freshness still counts them. Shell records
// name terminals that are gone.
function mergeRecords(terminals, opened) {
  const kept = terminals.filter((item) => item.sessionId);
  for (const record of opened) {
    const earlier = record.sessionId && kept.find((item) => item.sessionId === record.sessionId);
    if (earlier) Object.assign(earlier, record);
    else kept.push({ ...record, role: null });
  }
  return kept;
}

function restore(manifest) {
  const chooseFolder = folderChooser(manifest);
  const saved = manifest.archived.spaces;
  const board = saved.find((space) => space.board);
  const plain = saved.filter((space) => !space.board);
  const toOpen = plain.length > 0 || board ? plain : [{ name: manifest.name, folder: null, tabs: [] }];

  const boardRecords = board ? openBoardSpace(manifest, board, chooseFolder) : [];
  const opened = toOpen.map((space) => openSpace(space, chooseFolder));
  const updated = updateManifest(manifest.id, (draft) => {
    draft.spaces.push(...opened.map((item) => item.space));
    draft.terminals = mergeRecords(draft.terminals, [...boardRecords, ...opened.flatMap((item) => item.records)]);
    delete draft.archived;
  });
  if (opened.length > 0) act('space.select', { id: opened[0].space });
  return updated;
}

export function unarchive(flags) {
  const manifest = workspaceByRef(requireFlag(flags, 'workspace'));
  if (!manifest.archived) throw new HwsError(`${manifest.name} is not archived`);
  requireFolder(manifest.folder);
  requireLive();
  const updated = callerIsAgent() ? keepingSelection(() => restore(manifest)) : restore(manifest);
  return { data: updated, text: `restored ${manifest.name}` };
}
