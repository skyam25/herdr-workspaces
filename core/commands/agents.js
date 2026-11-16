import { existsSync, readFileSync } from 'node:fs';

import { sessionOfTerminal } from '../agent-session.js';
import { agentTranscript, findTranscript, logAgent, workspaceAgents } from '../agents.js';
import { HwsError, UsageError } from '../errors.js';
import { listLocalTerminals } from '../herdr.js';
import { listManifests, updateManifest } from '../manifest.js';
import { expandFolder, transcriptPath } from '../paths.js';
import { modifiedAt } from '../retired.js';
import { requireFlag, resolveWorkspace } from '../resolve.js';
import { sessionTitle } from './tidy.js';

const FOLDER_SCAN_BYTES = 256 * 1024;

// Maps each session to the workspaces whose log holds it.
function membership() {
  const found = new Map();
  for (const manifest of listManifests()) {
    for (const { session } of workspaceAgents(manifest)) {
      if (!found.has(session)) found.set(session, []);
      found.get(session).push({ id: manifest.id, name: manifest.name });
    }
  }
  return found;
}

// A session is active while its terminal still runs it. One listing finds the live terminals,
// so a long log of ended sessions costs one call.
function activeSessions(agents) {
  const active = new Set();
  const known = new Set(agents.map((item) => item.terminal).filter(Boolean));
  if (known.size === 0) return active;
  const live = listLocalTerminals().map((item) => item.address).filter((terminal) => known.has(terminal));
  for (const terminal of live) {
    const running = sessionOfTerminal(terminal);
    if (running) active.add(running.id);
  }
  return active;
}

function describe(manifest, agent, active, members) {
  const transcript = agentTranscript(manifest, agent);
  const found = existsSync(transcript);
  return {
    ...agent,
    title: found ? sessionTitle(transcript) : null,
    activeAt: found ? modifiedAt(transcript) : null,
    status: active.has(agent.session) ? 'active' : 'ended',
    alsoIn: (members.get(agent.session) ?? []).filter((item) => item.id !== manifest.id),
  };
}

const day = (time) => (time ? new Date(time).toISOString().slice(0, 10) : '----------');

const LINE_TITLE_CHARS = 72;

// A title is a first prompt, so it can span lines. The text view keeps one short line.
function shortTitle(title) {
  const flat = (title ?? '(untitled)').replace(/\s+/g, ' ').trim();
  return flat.length > LINE_TITLE_CHARS ? `${flat.slice(0, LINE_TITLE_CHARS - 1)}…` : flat;
}

function line(agent) {
  const also = agent.alsoIn.length > 0 ? `  also in ${agent.alsoIn.map((item) => item.name).join(', ')}` : '';
  const role = agent.role ? ` [${agent.role}]` : '';
  return `${agent.status.padEnd(6)}  ${day(agent.activeAt)}  ${shortTitle(agent.title)}${role}  ${agent.session}${also}`;
}

function sessionWorkspaces(session) {
  const workspaces = membership().get(session) ?? [];
  const text = workspaces.length > 0 ? workspaces.map((item) => `${item.id}\t${item.name}`).join('\n') : `no workspace logs ${session}`;
  return { data: { session, workspaces }, text };
}

// Active sessions first, then the rest by last activity, newest first.
export function agentsList(flags) {
  if (flags.session) return sessionWorkspaces(flags.session);
  const manifest = resolveWorkspace(flags);
  const agents = workspaceAgents(manifest);
  const active = activeSessions(agents);
  const members = membership();
  const described = agents
    .map((agent) => describe(manifest, agent, active, members))
    .sort((a, b) => (a.status === b.status ? (b.activeAt ?? 0) - (a.activeAt ?? 0) : a.status === 'active' ? -1 : 1));
  return { data: { workspace: manifest.id, agents: described }, text: described.map(line).join('\n') };
}

// Claude writes the session's working folder on its transcript lines.
function transcriptFolder(path) {
  try {
    const head = readFileSync(path, 'utf8').slice(0, FOLDER_SCAN_BYTES);
    for (const text of head.split('\n')) {
      const match = text.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
      if (match) return JSON.parse(`"${match[1]}"`);
    }
  } catch {
    // An unreadable transcript names no folder.
  }
  return null;
}

function locateClaude(session, folder) {
  if (folder && existsSync(transcriptPath(folder, session))) return { folder, transcript: null };
  const transcript = findTranscript(session);
  if (!transcript) throw new HwsError(`no Claude transcript for session ${session}`);
  return { folder: transcriptFolder(transcript) ?? folder, transcript };
}

export function agentAdd(flags) {
  const manifest = resolveWorkspace(flags);
  const session = requireFlag(flags, 'session');
  const tool = flags.tool ?? 'claude';
  if (!['claude', 'codex'].includes(tool)) throw new UsageError('--tool is claude or codex');
  const folder = flags.folder ? expandFolder(flags.folder) : null;
  if (tool === 'codex' && !folder) throw new UsageError('a Codex session needs --folder');
  const where = tool === 'claude' ? locateClaude(session, folder) : { folder, transcript: null };

  let added = false;
  updateManifest(manifest.id, (draft) => {
    const entry = { session, tool, folder: where.folder, source: 'manual' };
    if (where.transcript && where.transcript !== transcriptPath(where.folder ?? '', session)) entry.transcript = where.transcript;
    added = logAgent(draft, entry);
  });
  const data = { workspace: manifest.id, session, folder: where.folder, existing: !added };
  return { data, text: added ? `logged ${session} in ${manifest.name}` : `${manifest.name} already logs ${session}` };
}
