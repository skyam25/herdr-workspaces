import { existsSync, readdirSync, rmSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resumeArgv } from '../agent-session.js';
import { moveDir, relocateArtifact } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import { act, findTerminal, isIdleShell, killTerminal, listLive, requireLive, sendText, terminalInfo, windowStatus } from '../herdr.js';
import { listManifests, readManifest, updateManifest } from '../manifest.js';
import { STANDALONE, captureDir, terminalSessionDir, keptThrowawayDir, manifestPath, workspaceDir } from '../paths.js';
import { applyPlaces, assertRole, assertStage, ensurePlace, parseAssignment, placeOf, writablePlace } from '../places.js';
import { resolveWorkspace } from '../resolve.js';
import { containsFile, isStored, lastActiveAt, listRetired, recordRetired, removeRetired } from '../retired.js';
import { hasDraftWork, isWindowOpen } from '../surface-windows.js';
import { moveToTrash } from '../trash.js';
import { KEPT_KINDS, keptFields, keptKind } from './new.js';
import { spaceOfTerminal } from './todo.js';

const HOUR_MS = 60 * 60 * 1000;
const THROWAWAY_IDLE_MS = 24 * HOUR_MS;
const RETIRED_KEEP_MS = 30 * 24 * HOUR_MS;
const HINT_KEEP_MS = 30 * 24 * HOUR_MS;

// `done` means an answer nobody has looked at yet, so it counts as in use.
const QUIET_STATUSES = new Set([null, undefined, '', 'idle']);

function removeIfEmpty(dir) {
  try {
    rmdirSync(dir);
  } catch {
    // The folder still holds user work or is already gone.
  }
}

// Folders hws made for a throwaway. A reopened throwaway starts in the scratch
// folder of its first life.
function storedFolders(manifest) {
  if (manifest?.kind !== 'throwaway') return [];
  return [...new Set([placeOf(manifest, 'scratch').path, manifest.folder])].filter(isStored);
}

// Removes a closed workspace's state. Surface drafts go to the Trash. Throwaway
// artifacts and scratch files stay on disk for the retired record.
function retireWorkspace(id) {
  const manifest = readManifest(id);
  if (manifest) recordRetired(manifest);
  const surfaces = join(workspaceDir(id), 'surfaces');
  if (containsFile(surfaces)) moveToTrash([surfaces]);
  else rmSync(surfaces, { recursive: true, force: true });
  unlinkSync(manifestPath(id));
  for (const folder of [...storedFolders(manifest), join(workspaceDir(id), 'scratch')]) {
    if (!containsFile(folder)) rmSync(folder, { recursive: true, force: true });
    removeIfEmpty(dirname(folder));
  }
  removeIfEmpty(join(workspaceDir(id), 'artifacts'));
  removeIfEmpty(workspaceDir(id));
}

// A closed window with work stays listed as a draft. One with nothing on it goes.
function dropEmptyClosedWindows() {
  for (const manifest of listManifests({ includeStandalone: true })) {
    const closed = manifest.surfaces
      .filter((surface) => surface.host && !isWindowOpen(surface) && !hasDraftWork(manifest.id, surface.id))
      .map((surface) => surface.id);
    if (closed.length === 0) continue;
    updateManifest(manifest.id, (draft) => {
      draft.surfaces = draft.surfaces.filter((surface) => !closed.includes(surface.id));
    });
  }
}

// Markers and session records are hints, so old ones go without asking about their terminals.
function dropOldHints(dir) {
  const cutoff = Date.now() - HINT_KEEP_MS;
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const path = join(dir, name);
    if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
  }
}

function isQuietTerminal(record) {
  if (!QUIET_STATUSES.has(record.status)) return false;
  return record.app ? true : isIdleShell(terminalInfo(record.terminal));
}

// A flipped agent has no pane, so `herdr-app ls` leaves it out.
function isQuietUnlisted(terminal) {
  const info = terminalInfo(terminal);
  return !info?.labels?.['herdr.chat'] || QUIET_STATUSES.has(info.status?.state);
}

function liveSpaces(manifest, live) {
  return live.spaces.filter((space) => manifest.spaces.includes(space.id));
}

function isInUse(manifest, spaces, live) {
  if (manifest.surfaces.some((surface) => surface.host && isWindowOpen(surface))) return true;
  const listed = spaces.flatMap((space) => space.tabs ?? []).flatMap((tab) => tab.terminals ?? []);
  if (!listed.every(isQuietTerminal)) return true;
  const unlisted = manifest.terminals.map((item) => item.terminal).filter((terminal) => !findTerminal(live, terminal));
  return !unlisted.every(isQuietUnlisted);
}

// Skips everything when the selected space is unknown, so the space on screen is safe.
function expireIdleThrowaways(manifests, live) {
  const now = Date.now();
  const idle = manifests.filter((manifest) => manifest.kind === 'throwaway' && now - lastActiveAt(manifest) >= THROWAWAY_IDLE_MS);
  const selected = idle.length > 0 ? windowStatus()?.space : null;
  if (!selected) return [];
  const expired = [];
  for (const manifest of idle) {
    const spaces = liveSpaces(manifest, live);
    if (spaces.length === 0 || manifest.spaces.includes(selected) || isInUse(manifest, spaces, live)) continue;
    try {
      for (const space of spaces) act('space.close', { id: space.id, confirmed: true });
      retireWorkspace(manifest.id);
      expired.push(manifest.id);
    } catch {
      // The manifest stays and the next prune retries it.
    }
  }
  return expired;
}

// An artifact or scratch folder outside the state folder is one the user chose to keep.
function trashRetiredWork(record) {
  const artifacts = record.artifacts.map((artifact) => artifact.path).filter(isStored);
  const scratch = isStored(record.scratch) && existsSync(record.scratch) ? [record.scratch] : [];
  moveToTrash([...artifacts, ...scratch]);
  for (const path of artifacts) {
    removeIfEmpty(dirname(path));
    removeIfEmpty(dirname(dirname(path)));
  }
  for (const path of scratch) removeIfEmpty(dirname(path));
}

function purgeOldRetired() {
  const cutoff = Date.now() - RETIRED_KEEP_MS;
  for (const record of listRetired()) {
    if (record.closedAt > cutoff) continue;
    try {
      trashRetiredWork(record);
      removeRetired(record.id);
    } catch {
      // The record stays and the next prune retries it.
    }
  }
}

function dropSpaces(id, gone) {
  updateManifest(id, (draft) => {
    draft.spaces = draft.spaces.filter((space) => !gone.includes(space));
  });
}

// Manifests are read before the window, so a workspace created during the
// listing is never pruned. An empty window counts as no answer.
export function prune() {
  const manifests = listManifests();
  const live = listLive();
  if (!live || live.spaces.length === 0) {
    return { data: { pruned: [], expired: [], skipped: true }, text: 'the Herdr window did not answer, so nothing changed' };
  }
  dropEmptyClosedWindows();
  dropOldHints(captureDir());
  dropOldHints(terminalSessionDir());
  const liveIds = new Set(live.spaces.map((space) => space.id));
  const pruned = [];
  const open = [];
  for (const manifest of manifests) {
    const gone = manifest.spaces.filter((id) => !liveIds.has(id));
    try {
      if (gone.length === manifest.spaces.length) {
        retireWorkspace(manifest.id);
        pruned.push(manifest.id);
        continue;
      }
      if (gone.length > 0) dropSpaces(manifest.id, gone);
    } catch {
      // The manifest stays and the next prune retries it.
    }
    open.push(manifest);
  }
  const expired = expireIdleThrowaways(open, live);
  purgeOldRetired();
  return { data: { pruned, expired, skipped: false }, text: `pruned ${pruned.length}, expired ${expired.length}` };
}

// Changing a place moves no files. It changes where new things land.
export function setWorkspace(flags) {
  const paths = (flags.place ?? []).map((text) => parseAssignment(text, 'place'));
  const writers = (flags.writer ?? []).map((text) => parseAssignment(text, 'writer'));
  const changesPlaces = paths.length > 0 || writers.length > 0;
  if (flags.kind === undefined && flags.instructions === undefined && flags.stage === undefined && !changesPlaces) {
    throw new UsageError('pass --kind, --instructions, --stage, --place or --writer');
  }
  const kind = flags.kind === undefined ? undefined : keptKind(flags.kind);
  if (flags.stage !== undefined) assertStage(flags.stage);
  const manifest = resolveWorkspace(flags);
  if (kind && !KEPT_KINDS.includes(manifest.kind)) throw new HwsError(`${manifest.name} is a ${manifest.kind}, which has a fixed kind`);
  if (changesPlaces && !KEPT_KINDS.includes(manifest.kind)) throw new HwsError(`${manifest.name} is a ${manifest.kind}, which has fixed places`);
  const updated = updateManifest(manifest.id, (draft) => {
    if (kind) draft.kind = kind;
    if (flags.instructions !== undefined) draft.instructions = flags.instructions;
    if (flags.stage !== undefined) draft.stage = flags.stage;
    if (changesPlaces) applyPlaces(draft, paths, writers);
  });
  return { data: updated, text: `updated ${manifest.name}` };
}

// Prints nothing when the role is unset.
export function place(flags, [role]) {
  assertRole(role);
  const found = ensurePlace(resolveWorkspace(flags), role);
  return { data: found, text: found.path ?? '' };
}

// Moves every entry of one folder into another and refuses before moving
// anything when a name is taken. The source folder stays, because a live
// shell may be standing in it.
function moveContents(source, target) {
  const names = readdirSync(source);
  const taken = names.filter((name) => existsSync(join(target, name)));
  if (taken.length > 0) throw new HwsError(`${target} already holds ${taken.join(', ')}, so nothing moved`);
  for (const name of names) moveDir(join(source, name), join(target, name));
}

// Every place hws writes to is checked before anything moves.
export function promote(flags) {
  const { name, folder, kind } = keptFields(flags);
  const manifest = resolveWorkspace(flags);
  if (manifest.kind !== 'throwaway') throw new HwsError(`${manifest.name} is not a throwaway`);

  // The kept workspace starts from settings.json and the built-in places.
  const kept = { ...manifest, name, kind, folder, places: undefined };
  const artifacts = manifest.artifacts.filter((artifact) => existsSync(artifact.path));
  const scratch = placeOf(manifest, 'scratch').path;
  const hasScratch = containsFile(scratch);
  const artifactPlace = artifacts.length > 0 ? writablePlace(kept, 'artifacts') : null;
  const scratchPlace = hasScratch ? writablePlace(kept, 'scratch') : null;

  if (hasScratch) moveContents(scratch, scratchPlace);
  for (const artifact of artifacts) relocateArtifact(manifest.id, artifact, join(artifactPlace, artifact.id));
  const updated = updateManifest(manifest.id, (draft) => {
    draft.name = name;
    draft.kind = kind;
    draft.folder = folder;
    delete draft.places;
  });
  if (manifest.spaces.includes(manifest.id)) act('space.rename', { id: manifest.id, name });
  return { data: updated, text: `promoted to ${kind} workspace ${name}` };
}

function trashArtifacts(manifest) {
  for (const artifact of manifest.artifacts) {
    moveToTrash([artifact.path]);
    updateManifest(manifest.id, (draft) => {
      draft.artifacts = draft.artifacts.filter((item) => item.id !== artifact.id);
    });
  }
}

function keepArtifacts(manifest) {
  return manifest.artifacts
    .filter((artifact) => existsSync(artifact.path))
    .map((artifact) => relocateArtifact(manifest.id, artifact, keptThrowawayDir(manifest.name, artifact.id)));
}

// The id tail keeps two kept throwaways with one name apart.
function keepScratch(manifest, scratch) {
  const target = keptThrowawayDir(manifest.name, `scratch-${manifest.id.slice(-6)}`);
  moveDir(scratch, target);
  updateManifest(manifest.id, (draft) => {
    draft.places = { ...(draft.places ?? {}), scratch: target };
  });
  return [target];
}

// Artifacts and scratch files are the throwaway's work, so either one asks.
function chooseWorkFate(manifest, flags) {
  const scratch = manifest.kind === 'throwaway' ? placeOf(manifest, 'scratch').path : null;
  const hasScratch = containsFile(scratch);
  if (manifest.kind !== 'throwaway' || (manifest.artifacts.length === 0 && !hasScratch)) {
    return { kept: manifest.artifacts.map((artifact) => artifact.path) };
  }
  if (flags.trash) {
    trashArtifacts(manifest);
    if (hasScratch) moveToTrash([scratch]);
    return { kept: [] };
  }
  if (flags.keep) return { kept: [...keepArtifacts(manifest), ...(hasScratch ? keepScratch(manifest, scratch) : [])] };
  return { decision: 'needed', artifacts: manifest.artifacts, scratch: hasScratch ? scratch : null };
}

// The caller's own space closes last, because the caller dies with it.
function inClosingOrder(spaces) {
  const terminal = process.env.HC_TERMINAL_ID;
  const own = terminal ? spaceOfTerminal(terminal) : null;
  return [...spaces.filter((space) => space.id !== own), ...spaces.filter((space) => space.id === own)];
}

// Closes the spaces last. A caller inside one dies with it, and the next
// prune then removes the manifest.
export function close(flags) {
  if (flags.keep && flags.trash) throw new UsageError('use --keep or --trash, not both');
  const manifest = resolveWorkspace(flags);
  if (manifest.id === STANDALONE) throw new HwsError('the standalone store is not a space');
  const live = requireLive();

  const fate = chooseWorkFate(manifest, flags);
  if (fate.decision) return { data: fate };

  // The flag survives this process, which ends with the space when called from inside it.
  if (flags.trash && manifest.kind === 'throwaway') {
    updateManifest(manifest.id, (draft) => {
      draft.discarded = true;
    });
  }

  // A window's host runs outside the space, so closing the space would not end it.
  for (const surface of manifest.surfaces) {
    if (surface.host) killTerminal(surface.host);
  }
  for (const space of inClosingOrder(liveSpaces(manifest, live))) {
    act('space.close', { id: space.id, confirmed: true });
  }
  if (readManifest(manifest.id)) retireWorkspace(manifest.id);
  return { data: { closed: true, workspace: manifest.id, kept: fate.kept }, text: `closed ${manifest.name}` };
}

export function resume(flags) {
  const manifest = resolveWorkspace(flags);
  const live = requireLive();

  const resumed = [];
  const failed = [];
  for (const { terminal, sessionId } of manifest.terminals) {
    if (!sessionId || !findTerminal(live, terminal) || !isIdleShell(terminalInfo(terminal))) continue;
    try {
      sendText(terminal, resumeArgv({ tool: 'claude', id: sessionId }).join(' '));
      resumed.push({ terminal, sessionId });
    } catch (error) {
      failed.push({ terminal, sessionId, error: error.message });
    }
  }
  return { data: { workspace: manifest.id, resumed, failed }, text: `resumed ${resumed.length}` };
}
