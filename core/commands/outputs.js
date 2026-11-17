import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { registeredSession } from '../agent-session.js';
import { pathWithin } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import { terminalInfo } from '../herdr.js';
import { withLock } from '../lock.js';
import { writeJsonAtomic } from '../manifest.js';
import { requireFlag, splitList } from '../resolve.js';

// `<session folder>/.feedback/outputs/<session id>.json` lists a session's outputs. `hws output add`,
// `hws output touch` from the plugin's write hook, and the Agent Brief plugin write it. The reader
// follows surface/app/src/shared/output-file.ts, but keeps any `kind`, so a kind added there still
// shows here.

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

const outputsFileOf = (folder, id) => join(folder, '.feedback', 'outputs', `${id}.json`);

// Binds a terminal to the session its hook registered. A record without a folder uses the program's folder.
function agentOutputs(terminal) {
  const session = registeredSession(terminal);
  if (!session || !safeId(session.id)) return { terminal, session: null, folder: null, file: null, outputs: [] };
  const folder = session.folder ?? terminalInfo(terminal)?.foreground?.cwd ?? null;
  if (!folder) return { terminal, session: session.id, folder: null, file: null, outputs: [] };
  const file = outputsFileOf(folder, session.id);
  return { terminal, session: session.id, folder, file, outputs: readOutputs(file) };
}

export function outputs(flags) {
  const agents = splitList(requireFlag(flags, 'terminals')).map(agentOutputs);
  const lines = agents.map(({ terminal, outputs: list, file }) => `${terminal}\t${list.length} ${list.length === 1 ? 'output' : 'outputs'}${file ? `\t${file}` : ''}`);
  return { data: { agents }, text: lines.join('\n') };
}

// The writer follows mod/agent-brief/hooks/outputs.ts in the agent-brief repo.

// The keys are DOCUMENT_EXTENSIONS in surface/app/src/protocol.ts, and SKIP_DIRS is its OUTPUT_SKIP_DIRS.
const KIND_BY_EXTENSION = { md: 'markdown', markdown: 'markdown', mdx: 'markdown', html: 'html', htm: 'html', pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx' };
const SKIP_DIRS = new Set(['.feedback', '.claude', 'node_modules']);

function extensionOf(ref) {
  const name = basename(ref);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const kindOf = (ref) => KIND_BY_EXTENSION[extensionOf(ref)] ?? 'other';

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

const isFilePath = (raw) => !/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/[\u0000-\u001f\u007f]/.test(raw);

// The path relative to the session folder, or null for a file outside it or the folder itself.
function insideRef(folder, raw) {
  return pathWithin(folder, resolve(raw)) || null;
}

// A file output is named relative to the session folder. Agent Brief refuses one outside it, and so does this.
function fileRef(folder, raw) {
  if (!isFilePath(raw)) throw new HwsError(`${raw} is not a file path`);
  const ref = insideRef(folder, raw);
  if (ref === null) throw new HwsError(`${raw} is outside the session folder ${folder}, so Outputs would not list it`);
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

// The file as written, so records and fields this writer does not know survive.
// A missing or blank file starts fresh. One that does not read as version 1 is refused and left alone.
function readRawOutputs(file, sessionId) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (!text.trim()) return { version: 1, sessionId, outputs: [] };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new HwsError(`${file} is not valid JSON (${error.message}), so hws leaves it alone. Fix or remove it, then declare again`);
  }
  if (raw?.version !== 1 || !Array.isArray(raw.outputs)) {
    throw new HwsError(`${file} is not a version 1 outputs file, so hws leaves it alone. Fix or remove it, then declare again`);
  }
  return raw;
}

// Replaces the record with `ref` where it stands, or appends one, so records keep their first-appearance order.
function put(outputs, ref, change) {
  const index = outputs.findIndex((item) => item?.ref === ref);
  if (index === -1) return [...outputs, change(undefined)];
  return outputs.map((item, position) => (position === index ? change(item) : item));
}

// A new declaration keeps the record's other fields, write times included.
const upsertDeclared = (outputs, request, declaredAt) => put(outputs, request.ref, (found) => ({ ...found, ...request, tier: 'declared', declaredAt }));

// A write adds to the record's times and count. The first write's origin stays, and a declared record stays declared.
function upsertWrite(outputs, { ref, origin, at }) {
  return put(outputs, ref, (found) =>
    found === undefined
      ? { ref, kind: kindOf(ref), tier: 'detected', origin, firstWriteAt: at, lastWriteAt: at, writes: 1 }
      : { ...found, origin: found.origin ?? origin, firstWriteAt: found.firstWriteAt ?? at, lastWriteAt: at, writes: (found.writes ?? 0) + 1 },
  );
}

function declaredText(record, folder) {
  const line = `Declared "${record.title}" (${record.ref}, ${record.status}). It shows in Outputs.`;
  if (record.kind !== 'markdown' && record.kind !== 'html') return line;
  return `${line}\nWhen the person asks to review it, run: hws review ${JSON.stringify(join(folder, record.ref))}`;
}

// Applies one change to the session's outputs file under its lock, and returns the file and the changed record.
function recordOutput(folder, id, ref, upsert) {
  const file = outputsFileOf(folder, id);
  const output = withLock(`outputs-${id}`, () => {
    const content = readRawOutputs(file, id);
    const list = upsert(content.outputs);
    writeJsonAtomic(file, { ...content, outputs: list });
    keepFeedbackIgnored(folder);
    return list.find((item) => item?.ref === ref);
  });
  return { file, output };
}

export function outputAdd(flags) {
  const { id, folder } = declaringSession();
  const request = declaration(flags, folder);
  const { file, output } = recordOutput(folder, id, request.ref, (list) => upsertDeclared(list, request, Date.now()));
  return { data: { session: id, folder, file, output }, text: declaredText(output, folder) };
}

// The document's path relative to the session folder, or null for anything Outputs does not list.
// That is a file outside the folder, one under a skipped folder, or one without a document extension.
function documentRef(folder, raw) {
  if (!isFilePath(raw) || !KIND_BY_EXTENSION[extensionOf(raw)]) return null;
  const ref = insideRef(folder, raw);
  if (ref === null) return null;
  return ref.split('/').slice(0, -1).some((dir) => SKIP_DIRS.has(dir)) ? null : ref;
}

// The plugin's PostToolUse hook calls this after each write. It prints nothing, and a path that is not a document records nothing.
export function outputTouch(flags) {
  const raw = requireFlag(flags, 'path');
  const origin = flags.origin ?? 'edited';
  if (!ORIGINS.has(origin)) throw new UsageError('--origin must be created or edited');
  const { id, folder } = declaringSession();
  const ref = documentRef(folder, raw);
  if (ref === null) return { data: { session: id, folder, file: null, output: null }, text: '' };
  const { file, output } = recordOutput(folder, id, ref, (list) => upsertWrite(list, { ref, origin, at: Date.now() }));
  return { data: { session: id, folder, file, output }, text: '' };
}
