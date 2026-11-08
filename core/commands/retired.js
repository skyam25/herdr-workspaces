import { HwsError } from '../errors.js';
import { updateManifest } from '../manifest.js';
import { listRetired, readRetired, removeRetired } from '../retired.js';
import { requireFolder } from '../settings.js';
import { createWorkspace } from './new.js';

function searchText(record) {
  const parts = [record.name, ...record.sessions.flatMap((item) => [item.title, item.lastPrompt]), ...record.artifacts.map((item) => item.title)];
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

export function find(_flags, positionals) {
  const words = positionals.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
  const records = listRetired().filter((record) => matches(record, words));
  return { data: records, text: records.map(describe).join('\n') };
}

function tabsFor(record) {
  if (record.sessions.length === 0) return [{ name: 'Claude', argv: ['claude'] }];
  return record.sessions.map((item, index) => ({
    name: index === 0 ? 'Claude' : `Claude ${index + 1}`,
    argv: ['claude', '--resume', item.sessionId],
  }));
}

export function reopen(_flags, [id]) {
  const record = readRetired(id);
  if (!record) throw new HwsError(`no retired throwaway ${id}`);
  requireFolder(record.folder);
  const created = createWorkspace({ name: record.name, kind: 'throwaway', folder: record.folder, tabs: tabsFor(record) });
  const manifest = updateManifest(created.id, (draft) => {
    draft.artifacts = record.artifacts;
    record.sessions.forEach((item, index) => {
      draft.terminals[index].sessionId = item.sessionId;
    });
  });
  removeRetired(id);
  return { data: manifest, text: `reopened ${record.name} (${manifest.id})` };
}
