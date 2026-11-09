import { mkdirSync } from 'node:fs';

import { resumeArgv } from '../agent-session.js';
import { HwsError } from '../errors.js';
import { listManifests, readManifest, updateManifest } from '../manifest.js';
import { isStored, listRetired, readRetired, removeRetired } from '../retired.js';
import { requireFolder } from '../settings.js';
import { unarchive } from './archive.js';
import { createWorkspace } from './new.js';

function searchText(record) {
  const parts = [record.name, record.instructions ?? '', ...record.sessions.flatMap((item) => [item.title, item.lastPrompt]), ...record.artifacts.map((item) => item.title)];
  return parts.join('\n').toLowerCase();
}

function matches(record, words) {
  const text = searchText(record);
  return words.every((word) => text.includes(word));
}

function describe(record) {
  const when = new Date(record.closedAt).toISOString().slice(0, 10);
  return `${record.id}\t${when}\t${record.name}\t${record.sessions[0]?.title ?? ''}`;
}

// An archived workspace, in the same shape as a retired throwaway.
function archivedRecord(manifest) {
  return { id: manifest.id, name: manifest.name, archived: true, instructions: manifest.instructions ?? '', closedAt: manifest.archived.at, folder: manifest.folder, sessions: [], artifacts: manifest.artifacts ?? [] };
}

export function find(_flags, positionals) {
  const words = positionals.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
  const archived = listManifests().filter((manifest) => manifest.archived).map(archivedRecord);
  const records = [...archived, ...listRetired()].filter((record) => matches(record, words)).sort((a, b) => b.closedAt - a.closedAt);
  return { data: records, text: records.map(describe).join('\n') };
}

function tabsFor(record) {
  if (record.sessions.length === 0) return [{ name: 'Claude', argv: ['claude'] }];
  return record.sessions.map((item, index) => ({
    name: index === 0 ? 'Claude' : `Claude ${index + 1}`,
    argv: resumeArgv({ tool: 'claude', id: item.sessionId }),
  }));
}

// Sessions resume only from the folder they started in. That is the old
// scratch folder, which hws makes again if Keep moved it away.
function startFolder(record) {
  if (isStored(record.folder)) mkdirSync(record.folder, { recursive: true });
  return requireFolder(record.folder);
}

export function reopen(_flags, [id]) {
  if (readManifest(id)?.archived) return unarchive({ workspace: id });
  const record = readRetired(id);
  if (!record) throw new HwsError(`no archived workspace or retired throwaway ${id}`);
  const folder = startFolder(record);
  const created = createWorkspace({ name: record.name, kind: 'throwaway', folder, tabs: tabsFor(record) });
  const manifest = updateManifest(created.id, (draft) => {
    draft.artifacts = record.artifacts;
    if (record.scratch) draft.places = { scratch: record.scratch };
    record.sessions.forEach((item, index) => {
      draft.terminals[index].sessionId = item.sessionId;
    });
  });
  removeRetired(id);
  return { data: manifest, text: `reopened ${record.name} (${manifest.id})` };
}
