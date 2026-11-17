import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { registeredSession } from '../agent-session.js';
import { HwsError, UsageError } from '../errors.js';
import { terminalInfo } from '../herdr.js';
import { withLock } from '../lock.js';
import { writeJsonAtomic } from '../manifest.js';
import { requireFlag, splitList } from '../resolve.js';

// `<session folder>/.feedback/outputs/<session id>.json` lists a session's outputs. `hws output add`
// and the Agent Brief plugin write it. The reader follows companion/src/shared/output-file.ts in the
// agent-brief repo, but keeps any `kind`, so a kind added there still shows here.

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

// The writer follows mod/agent-brief/hooks/outputs.ts in the agent-brief repo.

const KIND_BY_EXTENSION = { md: 'markdown', markdown: 'markdown', mdx: 'markdown', html: 'html', htm: 'html', pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx' };

function kindOf(ref) {
  const name = basename(ref);
  const dot = name.lastIndexOf('.');
  return (dot > 0 && KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()]) || 'other';
}

// The calling agent's session, and the folder the session-start hook registered for it.
function declaringSession() {
  const terminal = process.env.HC_TERMINAL_ID;
  const registered = terminal ? registeredSession(terminal) : null;
  const id = process.env.CLAUDE_CODE_SESSION_ID || registered?.id;
  if (!id) throw new UsageError('run this from a Claude session, or in a Herdr terminal whose session is registered');
  if (!safeId(id)) throw new HwsError(`session id ${id} cannot name a file`);
  const folder = registered?.id === id && registered.folder ? registered.folder : process.cwd();
  return { id, folder };
}

// The nearest existing folder's real path, with the missing rest appended.
function realPathOf(full) {
  const rest = [];
  let at = full;
  while (!existsSync(at) && dirname(at) !== at) {
    rest.unshift(basename(at));
    at = dirname(at);
  }
  return join(realpathSync(at), ...rest);
}

// A file output is named relative to the session folder. Agent Brief refuses one outside it, and so does this.
function fileRef(folder, raw) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) throw new HwsError(`${raw} is not a file path`);
  const ref = relative(realPathOf(folder), realPathOf(resolve(raw)));
  if (ref === '' || ref === '..' || ref.startsWith('../') || isAbsolute(ref)) {
    throw new HwsError(`${raw} is outside the session folder ${folder}, so Outputs would not list it`);
  }
  return ref;
}

function declaration(flags, folder) {
  const title = requireFlag(flags, 'title').trim();
  if (!title) throw new UsageError('--title is empty');
  if (Boolean(flags.path) === Boolean(flags.url)) throw new UsageError('pass exactly one of --path and --url');
  const status = flags.status ?? 'drafting';
  if (!STATUSES.has(status)) throw new UsageError('--status must be drafting or ready');
  if (flags.url) {
    if (!/^https?:\/\//i.test(flags.url)) throw new UsageError('--url must be an http or https link');
    return { ref: flags.url, url: flags.url, title, kind: 'artifact', status };
  }
  const ref = fileRef(folder, flags.path);
  return { ref, title, kind: kindOf(ref), status };
}

// `.feedback/.gitignore` holds `*`, so the folder stays out of git. An existing one is left alone.
function keepFeedbackIgnored(folder) {
  const ignore = join(folder, '.feedback', '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
}

// The file as written, so records and fields this writer does not know survive. Anything unusable starts over.
function readRawOutputs(file, sessionId) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw?.version === 1 && Array.isArray(raw.outputs)) return raw;
  } catch {
    // Missing or unreadable.
  }
  return { version: 1, sessionId, outputs: [] };
}

// Replaces the record with the same ref where it stands, keeping its other fields, or appends one.
function upsertDeclared(outputs, request, declaredAt) {
  const index = outputs.findIndex((item) => item?.ref === request.ref);
  const record = { ...(index === -1 ? {} : outputs[index]), ...request, tier: 'declared', declaredAt };
  return index === -1 ? [...outputs, record] : outputs.map((item, position) => (position === index ? record : item));
}

function declaredText(record, folder) {
  const line = `Declared "${record.title}" (${record.ref}, ${record.status}). It shows in Outputs.`;
  if (record.kind !== 'markdown' && record.kind !== 'html') return line;
  return `${line}\nWhen the person asks to review it, run: hws review ${JSON.stringify(join(folder, record.ref))}`;
}

export function outputAdd(flags) {
  const { id, folder } = declaringSession();
  const request = declaration(flags, folder);
  const file = join(folder, '.feedback', 'outputs', `${id}.json`);
  const output = withLock(`outputs-${id}`, () => {
    const content = readRawOutputs(file, id);
    const list = upsertDeclared(content.outputs, request, Date.now());
    writeJsonAtomic(file, { ...content, outputs: list });
    keepFeedbackIgnored(folder);
    return list.find((item) => item?.ref === request.ref);
  });
  return { data: { session: id, folder, file, output }, text: declaredText(output, folder) };
}
