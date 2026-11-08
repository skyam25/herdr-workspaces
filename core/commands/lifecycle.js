import { existsSync, readdirSync, rmSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { relocateArtifact } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import { act, findTerminal, isIdleShell, isTerminalAlive, killTerminal, listLive, requireLive, sendText, terminalInfo } from '../herdr.js';
import { listManifests, readManifest, updateManifest } from '../manifest.js';
import { STANDALONE, keptArtifactDir, keptThrowawayDir, manifestPath, workspaceDir } from '../paths.js';
import { resolveWorkspace } from '../resolve.js';
import { moveToTrash } from '../trash.js';
import { KEPT_KINDS, keptFields, keptKind } from './new.js';

function containsFile(dir) {
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? containsFile(path) : true;
  });
}

function removeIfEmpty(dir) {
  try {
    rmdirSync(dir);
  } catch {
    // The folder still holds user work or is already gone.
  }
}

// Removes a closed workspace's state. Surface drafts go to the Trash, and
// throwaway artifacts left by a space closed outside hws stay on disk.
function retireWorkspace(id) {
  const surfaces = join(workspaceDir(id), 'surfaces');
  if (containsFile(surfaces)) moveToTrash([surfaces]);
  else rmSync(surfaces, { recursive: true, force: true });
  unlinkSync(manifestPath(id));
  removeIfEmpty(join(workspaceDir(id), 'artifacts'));
  removeIfEmpty(workspaceDir(id));
}

// A surface in its own window has no pane, so its host terminal says whether it is open.
function dropClosedWindows() {
  for (const manifest of listManifests({ includeStandalone: true })) {
    const closed = manifest.surfaces.filter((surface) => surface.host && !isTerminalAlive(surface.host)).map((surface) => surface.id);
    if (closed.length === 0) continue;
    updateManifest(manifest.id, (draft) => {
      draft.surfaces = draft.surfaces.filter((surface) => !closed.includes(surface.id));
    });
  }
}

// Manifests are read before the window, so a workspace created during the
// listing is never pruned. An empty window counts as no answer.
export function prune() {
  const manifests = listManifests();
  const live = listLive();
  if (!live || live.spaces.length === 0) {
    return { data: { pruned: [], skipped: true }, text: 'the Herdr window did not answer, so nothing changed' };
  }
  dropClosedWindows();
  const liveIds = new Set(live.spaces.map((space) => space.id));
  const pruned = [];
  for (const manifest of manifests) {
    if (liveIds.has(manifest.id)) continue;
    try {
      retireWorkspace(manifest.id);
      pruned.push(manifest.id);
    } catch {
      // The manifest stays and the next prune retries it.
    }
  }
  return { data: { pruned, skipped: false }, text: `pruned ${pruned.length}` };
}

export function setWorkspace(flags) {
  if (flags.kind === undefined && flags.instructions === undefined) throw new UsageError('pass --kind or --instructions');
  const kind = flags.kind === undefined ? undefined : keptKind(flags.kind);
  const manifest = resolveWorkspace(flags);
  if (kind && !KEPT_KINDS.includes(manifest.kind)) throw new HwsError(`${manifest.name} is a ${manifest.kind}, which has a fixed kind`);
  const updated = updateManifest(manifest.id, (draft) => {
    if (kind) draft.kind = kind;
    if (flags.instructions !== undefined) draft.instructions = flags.instructions;
  });
  return { data: updated, text: `updated ${manifest.name}` };
}

export function promote(flags) {
  const { name, folder, kind } = keptFields(flags);
  const manifest = resolveWorkspace(flags);
  if (manifest.kind !== 'throwaway') throw new HwsError(`${manifest.name} is not a throwaway`);

  for (const artifact of manifest.artifacts) {
    if (existsSync(artifact.path)) relocateArtifact(manifest.id, artifact, keptArtifactDir(folder, { id: manifest.id, name }, artifact.id));
  }
  const updated = updateManifest(manifest.id, (draft) => {
    draft.name = name;
    draft.kind = kind;
    draft.folder = folder;
  });
  act('space.rename', { id: manifest.id, name });
  return { data: updated, text: `promoted to ${kind} workspace ${name}` };
}

function trashArtifacts(manifest) {
  for (const artifact of manifest.artifacts) {
    moveToTrash([artifact.path]);
    updateManifest(manifest.id, (draft) => {
      draft.artifacts = draft.artifacts.filter((item) => item.id !== artifact.id);
    });
  }
  return [];
}

function keepArtifacts(manifest) {
  return manifest.artifacts
    .filter((artifact) => existsSync(artifact.path))
    .map((artifact) => relocateArtifact(manifest.id, artifact, keptThrowawayDir(manifest.name, artifact.id)));
}

function chooseArtifactFate(manifest, flags) {
  if (manifest.kind !== 'throwaway' || manifest.artifacts.length === 0) {
    return { kept: manifest.artifacts.map((artifact) => artifact.path) };
  }
  if (flags.trash) return { kept: trashArtifacts(manifest) };
  if (flags.keep) return { kept: keepArtifacts(manifest) };
  return { decision: 'needed', artifacts: manifest.artifacts };
}

// Closes the space last. A caller inside the space dies with it, and the next
// prune then removes the manifest.
export function close(flags) {
  if (flags.keep && flags.trash) throw new UsageError('use --keep or --trash, not both');
  const manifest = resolveWorkspace(flags);
  if (manifest.id === STANDALONE) throw new HwsError('the standalone store is not a space');
  const live = requireLive();

  const fate = chooseArtifactFate(manifest, flags);
  if (fate.decision) return { data: fate };

  // A window's host runs outside the space, so closing the space would not end it.
  for (const surface of manifest.surfaces) {
    if (surface.host) killTerminal(surface.host);
  }
  if (live.spaces.some((space) => space.id === manifest.id)) {
    act('space.close', { id: manifest.id, confirmed: true });
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
      sendText(terminal, `claude --resume ${sessionId}`);
      resumed.push({ terminal, sessionId });
    } catch (error) {
      failed.push({ terminal, sessionId, error: error.message });
    }
  }
  return { data: { workspace: manifest.id, resumed, failed }, text: `resumed ${resumed.length}` };
}
