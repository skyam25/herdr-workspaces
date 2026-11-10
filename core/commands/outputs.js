import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { registeredSession } from '../agent-session.js';
import { terminalInfo } from '../herdr.js';
import { requireFlag, splitList } from '../resolve.js';

// The Agent Brief plugin writes `<session folder>/.feedback/outputs/<session id>.json` for each session.
// The reader follows companion/src/shared/output-file.ts in the agent-brief repo, but keeps any `kind`,
// so a kind added there still shows here.

const TIERS = new Set(['declared', 'detected']);
const STATUSES = new Set(['drafting', 'ready']);
const ORIGINS = new Set(['created', 'edited']);
const TIMES = ['declaredAt', 'firstWriteAt', 'lastWriteAt', 'writes'];

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

// Keeps the known, well-formed fields of one record, or drops it when `ref`, `kind` or `tier` is unusable.
function cleanOutput(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  const ref = text(raw.ref);
  const kind = text(raw.kind);
  if (!ref || !kind || !TIERS.has(raw.tier)) return null;
  const record = { ref, kind, tier: raw.tier };
  if (text(raw.url)) record.url = raw.url;
  if (text(raw.title)) record.title = raw.title.trim();
  if (STATUSES.has(raw.status)) record.status = raw.status;
  if (ORIGINS.has(raw.origin)) record.origin = raw.origin;
  for (const key of TIMES) if (finite(raw[key])) record[key] = raw[key];
  return record;
}

// Returns the file's outputs, one per ref, or an empty list for anything but a version 1 file.
export function parseOutputsFile(content) {
  let raw;
  try {
    raw = JSON.parse(content);
  } catch {
    return [];
  }
  if (raw?.version !== 1 || !Array.isArray(raw.outputs)) return [];
  const seen = new Set();
  const outputs = [];
  for (const item of raw.outputs) {
    const record = cleanOutput(item);
    if (record && !seen.has(record.ref)) {
      seen.add(record.ref);
      outputs.push(record);
    }
  }
  return outputs;
}

function readOutputs(file) {
  try {
    return parseOutputsFile(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

// A session id names a file, so one that could leave the outputs folder binds nothing.
const safeId = (id) => /^[\w.-]+$/.test(id) && id !== '.' && id !== '..';

// Binds a terminal to the session its hook registered. A record without a folder uses the program's folder.
function agentOutputs(terminal) {
  const session = registeredSession(terminal);
  if (!session || !safeId(session.id)) return { terminal, session: null, folder: null, file: null, outputs: [] };
  const folder = session.folder ?? terminalInfo(terminal)?.foreground?.cwd ?? null;
  if (!folder) return { terminal, session: session.id, folder: null, file: null, outputs: [] };
  const file = join(folder, '.feedback', 'outputs', `${session.id}.json`);
  return { terminal, session: session.id, folder, file, outputs: readOutputs(file) };
}

export function outputs(flags) {
  const agents = splitList(requireFlag(flags, 'terminals')).map(agentOutputs);
  const lines = agents.map(({ terminal, outputs: list, file }) => `${terminal}\t${list.length} ${list.length === 1 ? 'output' : 'outputs'}${file ? `\t${file}` : ''}`);
  return { data: { agents }, text: lines.join('\n') };
}
