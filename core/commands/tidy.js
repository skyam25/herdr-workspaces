import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { freeName, moveDir } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import { act, isTerminalAlive, keepingSelection, killTerminal, sendText } from '../herdr.js';
import { withLock } from '../lock.js';
import { TIDY_ROLE, updateManifest, writeJsonAtomic, writeTextAtomic } from '../manifest.js';
import { STANDALONE, transcriptPath, workspaceDir } from '../paths.js';
import { ROLES, allPlaces, isForeign, isKept, placeOf, writablePlace } from '../places.js';
import { locateTerminal, requireFlag, resolveWorkspace, splitList, workspaceByRef } from '../resolve.js';
import { agentArgv } from '../agent-tools.js';
import { agentModels } from '../settings.js';
import { modifiedAt, typedPrompt } from '../retired.js';
import { moveToTrash } from '../trash.js';
import { assertStatus, assertSupersedes, isInside, realOf } from './artifact.js';
import { readTodos, spaceOfTerminal, updateTodos } from './todo.js';

const TITLE_CHARS = 200;
const HEAD_BYTES = 256 * 1024;
const GIT_BUFFER = 32 * 1024 * 1024;
const PACKET_CHANGED = 'The workspace changed. Read the tidy packet again at';
const PARTS = ['current', 'demote', 'artifacts', 'cards'];
const DESTINATIONS = ['history', 'trash'];

const SOURCES = [
  { key: 'sessions', one: 'session' },
  { key: 'artifacts', one: 'artifact' },
  { key: 'commits', one: 'commit' },
  { key: 'cards', one: 'card' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const packetPath = (id) => join(workspaceDir(id), 'tidy', 'packet.json');

function readHead(path) {
  const buffer = Buffer.alloc(HEAD_BYTES);
  const fd = openSync(path, 'r');
  try {
    return buffer.toString('utf8', 0, readSync(fd, buffer, 0, HEAD_BYTES, 0));
  } finally {
    closeSync(fd);
  }
}

// The first typed prompt sits near the start, so a long transcript is never read whole.
function firstPrompt(path) {
  try {
    for (const line of readHead(path).split('\n')) {
      if (!line.includes('"user"')) continue;
      try {
        const entry = JSON.parse(line);
        const text = entry.type === 'user' ? typedPrompt(entry).trim() : '';
        if (text) return text.slice(0, TITLE_CHARS);
      } catch {
        // A damaged or cut line says nothing about the session.
      }
    }
  } catch {
    // An unreadable transcript still counts by its modified time.
  }
  return null;
}

function trackedSessions(manifest) {
  const ids = manifest.terminals.filter((item) => item.sessionId && item.role !== TIDY_ROLE).map((item) => item.sessionId);
  return [...new Set(ids)]
    .map((id) => ({ id, transcript: transcriptPath(manifest.folder, id) }))
    .map((item) => ({ ...item, modifiedAt: modifiedAt(item.transcript) }))
    .filter((item) => item.modifiedAt !== null);
}

function sessionsSince(manifest, through) {
  return trackedSessions(manifest)
    .filter((item) => through == null || item.modifiedAt > through)
    .map((item) => ({ ...item, title: firstPrompt(item.transcript) }));
}

function artifactsSince(manifest, through) {
  return manifest.artifacts
    .filter((item) => item.role !== TIDY_ROLE && (through == null || (item.createdAt ?? 0) > through))
    .map(({ id, title, path, status, createdAt }) => ({ id, title: title ?? null, path, status, createdAt: createdAt ?? null }));
}

function git(folder, args) {
  const result = spawnSync('git', ['-C', folder, ...args], { encoding: 'utf8', maxBuffer: GIT_BUFFER, stdio: ['ignore', 'pipe', 'ignore'] });
  return !result.error && result.status === 0 ? result.stdout : null;
}

function parseLog(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, at, ...subject] = line.split('\x1f');
      return { sha, subject: subject.join('\x1f'), at: Number(at) * 1000 };
    });
}

// With no recorded commit, everything committed since the workspace began counts.
// A folder outside git, or a recorded commit git no longer has, counts as zero commits.
function commitsSince(manifest, base) {
  const head = git(manifest.folder, ['rev-parse', 'HEAD'])?.trim() || null;
  const info = { repo: Boolean(head), head, base: base ?? null, baseFound: false };
  if (!head) return { commits: [], git: info };
  const format = '--format=%H%x1f%ct%x1f%s';
  if (!base) {
    const since = `--since=${Math.floor(manifest.createdAt / 1000)}`;
    return { commits: parseLog(git(manifest.folder, ['log', format, since, 'HEAD']) ?? ''), git: info };
  }
  info.baseFound = git(manifest.folder, ['cat-file', '-e', `${base}^{commit}`]) !== null;
  if (!info.baseFound) return { commits: [], git: info };
  return { commits: parseLog(git(manifest.folder, ['log', format, `${base}..HEAD`]) ?? ''), git: info };
}

// Every Done card waits for a pass until it is archived. A workspace with no
// task list has no file, which reads as no cards.
function doneCards(manifest) {
  let todos;
  try {
    todos = readTodos(manifest.id);
  } catch {
    return [];
  }
  return todos.items
    .filter((item) => item.column === 'done' && !item.archived)
    .map(({ id, title, notes, note, report, replies, updatedAt }) => ({ id, title, notes: notes ?? '', note, report, replies, updatedAt: updatedAt ?? null }));
}

function collect(manifest) {
  const covers = manifest.current?.covers ?? null;
  const { commits, git: gitInfo } = commitsSince(manifest, covers?.commit);
  return {
    sessions: sessionsSince(manifest, covers?.sessionsThrough),
    artifacts: artifactsSince(manifest, covers?.artifactsThrough),
    commits,
    cards: doneCards(manifest),
    git: gitInfo,
  };
}

const newestFirst = (a, b) => (b.at ?? 0) - (a.at ?? 0);

function itemsOf(since) {
  return [
    since.sessions.map((item) => ({ kind: 'session', id: item.id, title: item.title, at: item.modifiedAt, path: item.transcript })).sort(newestFirst),
    since.artifacts.map((item) => ({ kind: 'artifact', id: item.id, title: item.title, at: item.createdAt, path: item.path })).sort(newestFirst),
    since.commits.map((item) => ({ kind: 'commit', id: item.sha, title: item.subject, at: item.at, path: null })),
    since.cards.map((item) => ({ kind: 'card', id: item.id, title: item.title, at: item.updatedAt, path: null })).sort(newestFirst),
  ].flat();
}

// A recorded pass whose terminal has ended is not live.
function livePass(manifest) {
  const terminal = manifest.tidy?.terminal;
  return terminal && isTerminalAlive(terminal) ? manifest.tidy : null;
}

// Resolves every role and creates no folder, unlike `hws place`.
function placesOf(manifest) {
  const found = ROLES.map((role) => placeOf(manifest, role));
  return {
    places: Object.fromEntries(found.map(({ role, path }) => [role, path])),
    writers: Object.fromEntries(found.map(({ role, writer }) => [role, writer])),
  };
}

function statusOf(manifest) {
  const since = collect(manifest);
  return {
    tidiedAt: manifest.current?.tidiedAt ?? null,
    stage: manifest.stage ?? null,
    behind: Object.fromEntries(SOURCES.map(({ key }) => [key, since[key].length])),
    items: itemsOf(since),
    git: since.git,
    live: livePass(manifest),
    ...placesOf(manifest),
  };
}

function shortDate(ms, now = Date.now()) {
  const date = new Date(ms);
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

const plural = (count, one) => `${count} ${one}${count === 1 ? '' : 's'}`;

function joinWords(parts) {
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function freshnessSentence(status) {
  if (!status.tidiedAt) return 'No current note yet';
  const when = shortDate(status.tidiedAt);
  const parts = SOURCES.filter(({ key }) => status.behind[key] > 0).map(({ key, one }) => plural(status.behind[key], one));
  if (parts.length === 0) return `Current is up to date, last tidied ${when}`;
  return `Current is ${joinWords(parts)} behind, last tidied ${when}`;
}

// Like `hws current --line`, a terminal outside a workspace prints nothing.
function lineWorkspace(flags) {
  if (flags.workspace) return workspaceByRef(flags.workspace);
  const terminal = process.env.HC_TERMINAL_ID;
  return terminal ? locateTerminal(terminal).manifest : null;
}

function statusLine(flags) {
  const manifest = lineWorkspace(flags);
  const line = manifest && isKept(manifest) ? freshnessSentence(statusOf(manifest)) : '';
  return { data: { line: line || null }, text: line };
}

export function tidyStatus(flags) {
  if (flags.line) return statusLine(flags);
  const manifest = resolveWorkspace(flags);
  if (manifest.id === STANDALONE) throw new HwsError('the standalone store has no current note');
  const status = statusOf(manifest);
  const line = isKept(manifest) ? freshnessSentence(status) : null;
  return { data: { ...status, line }, text: line ?? '' };
}

function noteHash(path) {
  return path && existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
}

// The cutoff is taken before the stream is read, so work that lands while
// the packet is written stays in the next backlog.
function writePacket(manifest) {
  const now = Date.now();
  const places = allPlaces(manifest);
  const { git: gitInfo, ...since } = collect(manifest);
  const path = packetPath(manifest.id);
  writeJsonAtomic(path, {
    version: 1,
    workspace: manifest.id,
    folder: manifest.folder,
    stage: manifest.stage ?? null,
    places,
    instructions: manifest.instructions ?? '',
    current: {
      path: places.current,
      exists: Boolean(places.current && existsSync(places.current)),
      hash: noteHash(places.current),
      tidiedAt: manifest.current?.tidiedAt ?? null,
      covers: manifest.current?.covers ?? null,
    },
    since,
    cutoff: { sessionsThrough: now, artifactsThrough: now, commit: gitInfo.head },
  });
  return path;
}

// The caller's own space when it belongs to the workspace, else the first that is not the Board.
function tabSpace(manifest) {
  const terminal = process.env.HC_TERMINAL_ID;
  const own = terminal ? spaceOfTerminal(terminal) : null;
  if (own && manifest.spaces.includes(own)) return own;
  const space = manifest.spaces.find((id) => id !== manifest.board?.space) ?? manifest.spaces[0];
  if (!space) throw new HwsError(`${manifest.name} has no open space`);
  return space;
}

function openTidy(manifest, packet) {
  const opened = keepingSelection(() => act('tab.new', {
    name: 'Tidy',
    space: tabSpace(manifest),
    folder: manifest.folder,
    argv: agentArgv(agentModels().orchestrator),
    task: `Use the herdr-workspaces:tidy skill. The packet is at ${packet}.`,
  }));
  updateManifest(manifest.id, (draft) => {
    draft.terminals.push({ terminal: opened.terminal, tabId: opened.tab ?? null, sessionId: null, role: TIDY_ROLE });
    draft.tidy = { terminal: opened.terminal, startedAt: Date.now(), packet };
  });
  return opened.terminal;
}

// A start lock apart from the manifest lock makes two clicks open one tab.
export function tidyStart(flags) {
  const { id } = resolveWorkspace(flags);
  const result = tidyLock(id, () => {
    const manifest = workspaceByRef(id);
    if (!isKept(manifest)) throw new HwsError(`${manifest.name} is a ${manifest.kind}, which has no current note`);
    const live = livePass(manifest);
    const packet = writePacket(manifest);
    if (live) return { terminal: live.terminal, started: false, packet };
    return { terminal: openTidy(manifest, packet), started: true, packet };
  });
  if (!result.started) sendText(result.terminal, `${PACKET_CHANGED} ${result.packet}`);
  const text = result.started ? `started a tidy pass in ${result.terminal}` : `asked ${result.terminal} to read the packet again`;
  return { data: result, text };
}

function tidyLock(id, run) {
  return withLock(`tidy-${encodeURIComponent(id)}`, run);
}

// Proposal checks

const isText = (value) => typeof value === 'string';

function bad(field, rule) {
  return new UsageError(`proposal ${field} ${rule}`);
}

function requireArray(proposal, field) {
  if (!Array.isArray(proposal[field])) throw bad(field, 'must be an array');
  return proposal[field];
}

function checkDemotion(item, index) {
  const field = `demote[${index}]`;
  if (!item || typeof item !== 'object') throw bad(field, 'must be an object');
  if (!isText(item.path) || !item.path) throw bad(`${field}.path`, 'must be a path');
  if (!DESTINATIONS.includes(item.to)) throw bad(`${field}.to`, `must be ${DESTINATIONS.join(' or ')}`);
  if (item.reason !== undefined && !isText(item.reason)) throw bad(`${field}.reason`, 'must be text');
}

function checkStatusChange(item, index) {
  const field = `artifacts[${index}]`;
  if (!item || typeof item !== 'object') throw bad(field, 'must be an object');
  if (!isText(item.id) || !item.id) throw bad(`${field}.id`, 'must be an artifact id');
  assertStatus(item.status, `proposal ${field}.status`);
  if (item.supersedes !== undefined && item.supersedes !== null && !isText(item.supersedes)) throw bad(`${field}.supersedes`, 'must be an artifact id or null');
}

function checkProposal(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw new UsageError('the proposal must be a JSON object');
  if (proposal.version !== 1) throw bad('version', 'must be 1');
  for (const field of ['workspace', 'packet', 'summary', 'current']) {
    if (!isText(proposal[field])) throw bad(field, 'must be text');
  }
  if (!proposal.packet) throw bad('packet', 'must be the packet path');
  requireArray(proposal, 'demote').forEach(checkDemotion);
  requireArray(proposal, 'artifacts').forEach(checkStatusChange);
  requireArray(proposal, 'cards').forEach((id, index) => {
    if (!isText(id) || !id) throw bad(`cards[${index}]`, 'must be a card id');
  });
  return proposal;
}

function readJson(path, what) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new HwsError(`cannot read the ${what} at ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`the ${what} at ${path} is not JSON`);
  }
}

function readSkips(value) {
  const skips = splitList(value);
  for (const part of skips) {
    if (!PARTS.includes(part)) throw new UsageError(`--skip takes ${PARTS.join(', ')}, not ${part}`);
  }
  return new Set(skips);
}

function readPacket(proposal, manifest) {
  const packet = readJson(resolve(proposal.packet), 'packet');
  if (packet.workspace !== manifest.id) throw new HwsError(`the packet belongs to ${packet.workspace}, not ${manifest.id}`);
  if (!packet.current || typeof packet.current !== 'object' || !packet.cutoff || typeof packet.cutoff !== 'object') {
    throw new HwsError(`the packet at ${proposal.packet} has no current or cutoff`);
  }
  return packet;
}

// The proposal names its workspace, so W defaults to it.
function applyWorkspace(flags, proposal) {
  const manifest = workspaceByRef(flags.workspace || proposal.workspace);
  if (proposal.workspace !== manifest.id) throw new HwsError(`the proposal belongs to ${proposal.workspace}, not ${manifest.id}`);
  if (!isKept(manifest)) throw new HwsError(`${manifest.name} is a ${manifest.kind}, which has no current note`);
  return manifest;
}

// A pass works from the note it read. Any edit since then, or a moved place, sends it back to start.
function checkNote(manifest, packet) {
  const path = placeOf(manifest, 'current').path;
  if (path !== packet.current.path) throw new HwsError(`the current place moved from ${packet.current.path} to ${path}, so run hws tidy start again`);
  if (noteHash(path) !== (packet.current.hash ?? null)) {
    throw new HwsError(`the current note ${path} changed after the packet was written, so run hws tidy start again`);
  }
  return path;
}

// Demotions

// Checks every demotion before anything moves. Returns each source and its destination role.
function planDemotions(manifest, demotions, notePath) {
  const historyPlace = placeOf(manifest, 'history');
  const places = ROLES.map((role) => placeOf(manifest, role)).filter(({ path }) => path);
  const foreign = places.filter(({ writer }) => isForeign(writer));
  const planned = [];
  for (const item of demotions) {
    const path = resolve(manifest.folder, item.path);
    if (!existsSync(path)) throw new HwsError(`cannot demote ${path}, which does not exist`);
    if (isInside(path, notePath)) throw new HwsError(`cannot demote ${path}, which is or holds the current note`);
    if (!isInside(manifest.folder, path) || realOf(path) === realOf(manifest.folder)) throw new HwsError(`cannot demote ${path}, which is outside the workspace folder`);
    const owner = foreign.find((place) => isInside(place.path, path));
    if (owner) throw new HwsError(`cannot demote ${path}, which is under the ${owner.role} place that ${owner.writer} writes`);
    const holds = places.find((place) => isInside(path, place.path));
    if (holds) throw new HwsError(`cannot demote ${path}, which is or holds the ${holds.role} place`);
    const overlap = planned.find((other) => isInside(other.path, path) || isInside(path, other.path));
    if (overlap) throw new HwsError(`cannot demote both ${overlap.path} and ${path}, because one holds the other`);
    const to = item.to === 'history' && historyPlace.path ? 'history' : 'trash';
    if (to === 'history') {
      writablePlace(manifest, 'history');
      if (isInside(historyPlace.path, path)) throw new HwsError(`cannot demote ${path} to history, because it is already there`);
    }
    planned.push({ path, to });
  }
  return { planned, history: historyPlace.path };
}

function demote(planned, history) {
  moveToTrash(planned.filter((item) => item.to === 'trash').map((item) => item.path));
  return planned.map(({ path, to }) => {
    if (to === 'trash') return { path, to };
    const target = freeName(history, basename(path));
    moveDir(path, target);
    return { path, to: target };
  });
}

// Artifacts and cards

function planStatuses(manifest, changes) {
  for (const change of changes) {
    if (!manifest.artifacts.some((item) => item.id === change.id)) throw new HwsError(`no artifact ${change.id} in ${manifest.name}`);
    if (change.supersedes !== undefined) assertSupersedes(manifest, change.id, change.supersedes);
  }
  return changes.map(({ id, status, supersedes }) => (supersedes === undefined ? { id, status } : { id, status, supersedes }));
}

// Archived cards stay archived. A card that left Done since the packet sends the pass back.
function planCards(manifest, ids) {
  if (ids.length === 0) return [];
  const { items } = readTodos(manifest.id);
  for (const id of ids) {
    const card = items.find((item) => item.id === id);
    if (!card) throw new HwsError(`no card ${id} on ${manifest.name}'s task list`);
    if (card.column !== 'done') throw new HwsError(`card ${id} is in ${card.column}, not done`);
  }
  return [...new Set(ids)];
}

// The person accepted the proposal, so cards marked as theirs archive too.
function archiveCards(manifest, ids) {
  if (ids.length === 0) return [];
  return updateTodos(manifest.id, (todos) => {
    const updatedAt = Date.now();
    for (const card of todos.items.filter((item) => ids.includes(item.id) && !item.archived)) Object.assign(card, { archived: true, updatedAt });
    return ids;
  });
}

function applyText({ wrote, demoted, artifacts, archived }) {
  const parts = [];
  if (wrote) parts.push(`wrote ${wrote}`);
  if (demoted.length) parts.push(`demoted ${plural(demoted.length, 'file')}`);
  if (artifacts.length) parts.push(`changed ${plural(artifacts.length, 'artifact')}`);
  if (archived.length) parts.push(`archived ${plural(archived.length, 'card')}`);
  return ['applied the tidy pass', ...parts].join(', ');
}

// Every check runs before the first write. The manifest stamp comes last, so a
// failed write leaves the pass open to retry.
export function tidyApply(flags) {
  const file = resolve(requireFlag(flags, 'file'));
  const skipped = readSkips(flags.skip);
  const proposal = checkProposal(readJson(file, 'proposal'));
  const { id } = applyWorkspace(flags, proposal);
  const result = tidyLock(id, () => {
    const manifest = workspaceByRef(id);
    const packet = readPacket(proposal, manifest);
    const notePath = checkNote(manifest, packet);
    const writeCurrent = !skipped.has('current');
    if (writeCurrent) writablePlace(manifest, 'current');
    const demotions = skipped.has('demote') ? { planned: [] } : planDemotions(manifest, proposal.demote, notePath);
    const statuses = skipped.has('artifacts') ? [] : planStatuses(manifest, proposal.artifacts);
    const cards = skipped.has('cards') ? [] : planCards(manifest, proposal.cards);

    if (writeCurrent) writeTextAtomic(notePath, proposal.current.endsWith('\n') ? proposal.current : `${proposal.current}\n`);
    const demoted = demote(demotions.planned, demotions.history);
    const archived = archiveCards(manifest, cards);
    updateManifest(id, (draft) => {
      for (const change of statuses) Object.assign(draft.artifacts.find((item) => item.id === change.id), change);
      draft.current = { tidiedAt: Date.now(), covers: packet.cutoff };
      delete draft.tidy;
    });
    return { wrote: writeCurrent ? notePath : null, demoted, artifacts: statuses, archived, skipped: PARTS.filter((part) => skipped.has(part)) };
  });
  return { data: result, text: applyText(result) };
}

// The record clears before the terminal ends, because the tidy agent may run this from that terminal.
export function tidyStop(flags) {
  const { id } = resolveWorkspace(flags);
  const tidy = tidyLock(id, () => {
    const recorded = workspaceByRef(id).tidy ?? null;
    if (recorded) updateManifest(id, (draft) => delete draft.tidy);
    return recorded;
  });
  if (!tidy) return { data: { stopped: false, terminal: null }, text: 'no tidy pass is running' };
  const { terminal } = tidy;
  if (isTerminalAlive(terminal) && !killTerminal(terminal) && isTerminalAlive(terminal)) throw new HwsError(`could not end the tidy pass in ${terminal}`);
  return { data: { stopped: true, terminal }, text: `ended the tidy pass in ${terminal}` };
}
