import { HwsError, UsageError } from './errors.js';
import { findTerminal, listLive } from './herdr.js';
import { listManifests, manifestOfSpace, readManifest } from './manifest.js';

// Finds a terminal's workspace. The live window decides when it answers.
// Otherwise the recorded terminals decide.
export function locateTerminal(terminal) {
  const live = listLive();
  const found = live && findTerminal(live, terminal);
  if (found) return { manifest: manifestOfSpace(found.space.id), tabId: found.tab.id };
  const manifest = listManifests().find((item) => item.terminals.some((t) => t.terminal === terminal));
  if (!manifest) return { manifest: null, tabId: null };
  return { manifest, tabId: manifest.terminals.find((t) => t.terminal === terminal).tabId };
}

export function workspaceOfTerminal(terminal) {
  const { manifest } = locateTerminal(terminal);
  if (!manifest) throw new HwsError(`terminal ${terminal} is not in a workspace`);
  return manifest;
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
