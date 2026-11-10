import { HwsError, UsageError } from './errors.js';
import { findTerminal, listLive, terminalInfo } from './herdr.js';
import { listManifests, manifestOfSpace, readManifest } from './manifest.js';

// Finds a terminal's workspace. The live window decides when it answers.
// Otherwise the recorded terminals decide.
export function locateTerminal(terminal) {
  const live = listLive();
  const found = live && findTerminal(live, terminal);
  if (found) return { manifest: manifestOfSpace(found.space.id), tabId: found.tab.id };
  return recordedTerminal(terminal) ?? { manifest: null, tabId: null };
}

// The manifest that records a terminal, and the tab it was recorded in.
function recordedTerminal(terminal) {
  for (const manifest of listManifests()) {
    const row = manifest.terminals.find((t) => t.terminal === terminal);
    if (row) return { manifest, tabId: row.tabId };
  }
  return null;
}

// A `where` label reads "<space name> / <tab name>". Space names can repeat, so only a single match counts.
function spaceFromWhere(where, spaces) {
  const matches = spaces.filter(({ name }) => where === name || where.startsWith(`${name} / `));
  return matches.length === 1 ? matches[0].id : null;
}

// The tab a terminal was recorded in still names its space after the terminal is parked.
function spaceFromRecord(terminal, spaces) {
  const tabId = recordedTerminal(terminal)?.tabId;
  return (tabId && spaces.find((space) => (space.tabs ?? []).some((tab) => tab.id === tabId))?.id) || null;
}

// A flipped agent is missing from the listing, so its labels or its recorded tab place it.
// A caller that already read the terminal's labels passes them.
export function spaceOfTerminal(terminal, labels) {
  const live = listLive();
  const found = live && findTerminal(live, terminal);
  if (found) return found.space.id;
  labels ??= terminalInfo(terminal)?.labels ?? {};
  if (labels['herdr.space']) return labels['herdr.space'];
  if (!live) return null;
  return (labels.where && spaceFromWhere(labels.where, live.spaces)) || spaceFromRecord(terminal, live.spaces);
}

export function workspaceOfTerminal(terminal) {
  const { manifest } = locateTerminal(terminal);
  if (!manifest) throw new HwsError(`terminal ${terminal} is not in a workspace`);
  return manifest;
}

// Herdr sets this in every terminal, and the Board runs with none.
export const callerIsAgent = () => Boolean(process.env.HC_TERMINAL_ID);

// Reads a comma-separated flag. A missing flag is an empty list.
export function splitList(value) {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function callingTerminal(flags) {
  return flags.terminal ?? process.env.HC_TERMINAL_ID;
}

export function requireCallingTerminal(flags) {
  const terminal = callingTerminal(flags);
  if (!terminal) throw new UsageError('pass --terminal or run inside a Herdr terminal');
  return terminal;
}

export function workspaceByRef(ref) {
  const byId = readManifest(ref);
  if (byId) return byId;
  const named = listManifests().filter((item) => item.name === ref);
  if (named.length > 1) throw new HwsError(`more than one workspace is named ${ref}, so use its id`);
  if (named.length === 0) throw new HwsError(`no workspace ${ref}`);
  return named[0];
}

// Resolves --workspace, or else the workspace of the calling terminal.
export function resolveWorkspace(flags) {
  if (flags.workspace) return workspaceByRef(flags.workspace);
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) throw new UsageError('pass --workspace or run inside a Herdr terminal');
  return workspaceOfTerminal(terminal);
}

export function requireFlag(flags, name) {
  if (!flags[name]) throw new UsageError(`--${name} is required`);
  return flags[name];
}
