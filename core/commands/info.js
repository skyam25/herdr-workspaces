import { logAgent, seedAgents } from '../agents.js';
import { listManifests, updateManifest, writeJsonAtomic } from '../manifest.js';
import { terminalSessionPath, workspaceDir } from '../paths.js';
import { callingTerminal, locateTerminal, requireCallingTerminal, requireFlag, workspaceOfTerminal } from '../resolve.js';
import { parentFolder } from '../settings.js';

function oneLine(manifest) {
  const instructions = manifest.instructions?.trim();
  const custom = instructions ? `\n\nWorkspace instructions:\n${instructions}` : '';
  const kind = manifest.kind === 'general' ? '' : `${manifest.kind} `;
  const tasks = manifest.board ? '' : ' It has no Tasks, so it has no task list for cards.';
  return `This terminal is in the ${kind}workspace "${manifest.name}" at ${manifest.folder}.${tasks}${custom}`;
}

function currentLine(terminal) {
  const manifest = terminal ? locateTerminal(terminal).manifest : null;
  const line = manifest ? oneLine(manifest) : '';
  return { data: { line: line || null, tasks: Boolean(manifest?.board) }, text: line };
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

export function list(flags) {
  const manifests = listManifests()
    .filter((item) => Boolean(item.archived) === Boolean(flags.archived))
    .map((item) => ({ ...item, dir: workspaceDir(item.id) }));
  const text = manifests.map((item) => `${item.id}\t${item.kind}\t${item.name}\t${item.folder}`).join('\n');
  return { data: manifests, text };
}

// A terminal outside a workspace records only its session, and still succeeds.
// The terminal keeps its latest session. The agent log keeps every one.
export function register(flags) {
  const terminal = requireFlag(flags, 'terminal');
  const session = requireFlag(flags, 'session');
  writeJsonAtomic(terminalSessionPath(terminal), flags.folder ? { id: session, folder: flags.folder } : { id: session });
  const { manifest, tabId } = locateTerminal(terminal);
  if (!manifest) return { data: { registered: false }, text: `${terminal} is not in a workspace` };
  updateManifest(manifest.id, (draft) => {
    seedAgents(draft);
    let record = draft.terminals.find((item) => item.terminal === terminal);
    if (!record) {
      record = { terminal, tabId, sessionId: null, role: null };
      draft.terminals.push(record);
    }
    record.sessionId = session;
    if (flags.role) record.role = flags.role;
    logAgent(draft, { session, folder: flags.folder ?? null, terminal, role: record.role ?? null });
  });
  return {
    data: { registered: true, workspace: manifest.id, terminal, session },
    text: `registered ${session} on ${terminal}`,
  };
}
