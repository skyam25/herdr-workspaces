import { listManifests, updateManifest } from '../manifest.js';
import { workspaceDir } from '../paths.js';
import { callingTerminal, locateTerminal, requireCallingTerminal, requireFlag, workspaceOfTerminal } from '../resolve.js';
import { parentFolder } from '../settings.js';

function oneLine(manifest) {
  const instructions = manifest.instructions?.trim();
  const custom = instructions ? `\n\nWorkspace instructions:\n${instructions}` : '';
  const kind = manifest.kind === 'general' ? '' : `${manifest.kind} `;
  return `This terminal is in the ${kind}workspace "${manifest.name}" at ${manifest.folder}.${custom}`;
}

function currentLine(terminal) {
  const manifest = terminal ? locateTerminal(terminal).manifest : null;
  const line = manifest ? oneLine(manifest) : '';
  return { data: { line: line || null }, text: line };
}

export function current(flags) {
  if (flags.line) return currentLine(callingTerminal(flags));
  const manifest = workspaceOfTerminal(requireCallingTerminal(flags));
  return { data: manifest, text: JSON.stringify(manifest, null, 2) };
}

export function parent() {
  const folder = parentFolder();
  return { data: { folder }, text: folder };
}

export function list() {
  const manifests = listManifests().map((item) => ({ ...item, dir: workspaceDir(item.id) }));
  const text = manifests.map((item) => `${item.id}\t${item.kind}\t${item.name}\t${item.folder}`).join('\n');
  return { data: manifests, text };
}

// A normal terminal has no manifest, so it registers nothing and still succeeds.
export function register(flags) {
  const terminal = requireFlag(flags, 'terminal');
  const session = requireFlag(flags, 'session');
  const { manifest, tabId } = locateTerminal(terminal);
  if (!manifest) return { data: { registered: false }, text: `${terminal} is not in a workspace` };
  updateManifest(manifest.id, (draft) => {
    let record = draft.terminals.find((item) => item.terminal === terminal);
    if (!record) {
      record = { terminal, tabId, sessionId: null, role: null };
      draft.terminals.push(record);
    }
    record.sessionId = session;
    if (flags.role) record.role = flags.role;
  });
  return {
    data: { registered: true, workspace: manifest.id, terminal, session },
    text: `registered ${session} on ${terminal}`,
  };
}
