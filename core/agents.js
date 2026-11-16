import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { registeredSession } from './agent-session.js';
import { listManifests, updateManifest } from './manifest.js';
import { home, transcriptPath } from './paths.js';

// Every agent session a workspace has seen, oldest first. The log only grows.
// Sessions recorded on terminals or archived tabs before the log existed join it.
export function workspaceAgents(manifest) {
  const agents = [...(manifest.agents ?? [])];
  const seen = new Set(agents.map((item) => item.session));
  const add = (entry) => {
    if (seen.has(entry.session)) return;
    seen.add(entry.session);
    agents.push({ tool: 'claude', folder: null, terminal: null, role: null, firstSeen: null, source: 'terminal', ...entry });
  };
  for (const record of manifest.terminals ?? []) {
    if (record.sessionId) add({ session: record.sessionId, terminal: record.terminal, role: record.role ?? null });
  }
  for (const tab of (manifest.archived?.spaces ?? []).flatMap((space) => space.tabs ?? [])) {
    if (tab.session?.id) add({ session: tab.session.id, tool: tab.session.tool ?? 'claude', folder: tab.folder ?? null });
  }
  return agents;
}

export function agentTranscript(manifest, agent) {
  return agent.transcript ?? transcriptPath(agent.folder ?? manifest.folder, agent.session);
}

// Writes sessions known only from terminals or archived tabs into the log.
// Run it before a terminal's session changes, or the old session is lost.
export function seedAgents(draft) {
  draft.agents = workspaceAgents(draft);
}

// Adds a session to a manifest draft once. A known session keeps its first entry.
export function logAgent(draft, entry) {
  if (!draft.agents) seedAgents(draft);
  if (draft.agents.some((item) => item.session === entry.session)) return false;
  draft.agents.push({ tool: 'claude', folder: null, terminal: null, role: null, source: 'hook', ...entry, firstSeen: entry.firstSeen ?? Date.now() });
  return true;
}

// Logs the sessions registered on a space's live terminals, so a space that joins a workspace brings its agents.
export function logSpaceAgents(workspaceId, space) {
  const terminals = (space.tabs ?? []).flatMap((tab) => tab.terminals ?? []).map((item) => item.terminal).filter(Boolean);
  const found = terminals.map((terminal) => ({ terminal, session: registeredSession(terminal) })).filter((item) => item.session);
  if (found.length === 0) return;
  updateManifest(workspaceId, (draft) => {
    for (const { terminal, session } of found) logAgent(draft, { session: session.id, folder: session.folder, terminal, source: 'space' });
  });
}

// Other workspaces whose log holds the session.
export function workspacesWithAgent(session, exceptId) {
  return listManifests()
    .filter((manifest) => manifest.id !== exceptId && workspaceAgents(manifest).some((item) => item.session === session))
    .map(({ id, name }) => ({ id, name }));
}

// Finds a Claude transcript by session id when its start folder is unknown.
export function findTranscript(session) {
  const projects = join(process.env.CLAUDE_CONFIG_DIR || join(home(), '.claude'), 'projects');
  let dirs;
  try {
    dirs = readdirSync(projects);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    try {
      if (readdirSync(join(projects, dir)).includes(`${session}.jsonl`)) return join(projects, dir, `${session}.jsonl`);
    } catch {
      // A file or unreadable folder holds no transcripts.
    }
  }
  return null;
}
