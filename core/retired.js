import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, sep } from 'node:path';

import { writeJsonAtomic } from './manifest.js';
import { retiredDir, retiredPath, stateRoot, transcriptPath } from './paths.js';
import { placeOf } from './places.js';

const MAX_PROMPT_CHARS = 2000;

export function modifiedAt(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export function containsFile(dir) {
  if (!dir || !existsSync(dir)) return false;
  return readdirSync(dir).some((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? containsFile(path) : true;
  });
}

// A path under the workspace store belongs to hws. Anything else is the user's.
export function isStored(path) {
  return Boolean(path) && path.startsWith(join(stateRoot(), 'workspaces') + sep);
}

const sessionIds = (manifest) => [...new Set(manifest.terminals.map((item) => item.sessionId).filter(Boolean))];

// The transcript changes on every agent turn, so its age measures idle time.
export function lastActiveAt(manifest) {
  const times = sessionIds(manifest).map((id) => modifiedAt(transcriptPath(manifest.folder, id)) ?? 0);
  return Math.max(manifest.createdAt, ...times);
}

// Returns what the user typed, or nothing for slash commands and injected context.
export function typedPrompt(entry) {
  if (entry.isMeta) return '';
  const content = entry.message?.content;
  const blocks = Array.isArray(content) ? content.filter((block) => block.type === 'text').map((block) => block.text) : [content ?? ''];
  const text = blocks.join(' ');
  return /^<(local-)?command/.test(text) ? '' : text;
}

// Claude Code's transcript lines are undocumented, so a transcript without
// these still yields a session that can be resumed. A short session often has
// a `last-prompt` line with no text, so the newest typed prompt fills in.
function readTranscript(path) {
  let title = '';
  let lastPrompt = '';
  let typed = '';
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!/"(ai-title|last-prompt|user)"/.test(line)) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'ai-title') title = entry.aiTitle ?? title;
      if (entry.type === 'last-prompt') lastPrompt = entry.lastPrompt ?? lastPrompt;
      if (entry.type === 'user') typed = typedPrompt(entry) || typed;
    } catch {
      // A damaged line says nothing about the session.
    }
  }
  return { title, lastPrompt: (lastPrompt || typed).slice(0, MAX_PROMPT_CHARS) };
}

function sessionsOf(manifest) {
  return sessionIds(manifest)
    .map((sessionId) => ({ sessionId, path: transcriptPath(manifest.folder, sessionId) }))
    .filter(({ path }) => existsSync(path))
    .map(({ sessionId, path }) => ({ sessionId, activeAt: modifiedAt(path), ...readTranscript(path) }))
    .sort((a, b) => b.activeAt - a.activeAt);
}

// Writes the record that keeps a closed throwaway findable. A throwaway with
// no session, no artifact and an empty scratch folder has nothing to find.
export function recordRetired(manifest) {
  if (manifest.kind !== 'throwaway' || manifest.discarded) return;
  const sessions = sessionsOf(manifest);
  const artifacts = manifest.artifacts.filter((artifact) => existsSync(artifact.path));
  const scratch = placeOf(manifest, 'scratch').path;
  if (sessions.length === 0 && artifacts.length === 0 && !containsFile(scratch)) return;
  writeJsonAtomic(retiredPath(manifest.id), {
    version: 1,
    id: manifest.id,
    name: manifest.name,
    folder: manifest.folder,
    createdAt: manifest.createdAt,
    closedAt: Date.now(),
    scratch,
    sessions,
    artifacts,
  });
}

export function readRetired(id) {
  try {
    return JSON.parse(readFileSync(retiredPath(id), 'utf8'));
  } catch {
    return null;
  }
}

export function removeRetired(id) {
  unlinkSync(retiredPath(id));
}

// Lists every record, newest close first.
export function listRetired() {
  let names;
  try {
    names = readdirSync(retiredDir());
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readRetired(decodeURIComponent(name.slice(0, -'.json'.length))))
    .filter(Boolean)
    .sort((a, b) => b.closedAt - a.closedAt);
}
