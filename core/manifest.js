import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { HwsError } from './errors.js';
import { withLock } from './lock.js';
import { STANDALONE, home, manifestPath, stateRoot } from './paths.js';

// A manifest written before workspaces held several spaces has only its own space.
export function readManifest(id) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath(id), 'utf8'));
    manifest.spaces ??= manifest.id === STANDALONE ? [] : [manifest.id];
    return manifest;
  } catch {
    return null;
  }
}

export function writeJsonAtomic(target, value) {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, target);
}

function writeAtomic(manifest) {
  writeJsonAtomic(manifestPath(manifest.id), manifest);
}

export function listManifests({ includeStandalone = false } = {}) {
  let ids;
  try {
    ids = readdirSync(join(stateRoot(), 'workspaces'));
  } catch {
    return [];
  }
  return ids
    .filter((id) => includeStandalone || id !== STANDALONE)
    .map(readManifest)
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function manifestOfSpace(space) {
  return listManifests().find((manifest) => manifest.spaces.includes(space)) ?? null;
}

function blankManifest(fields) {
  return {
    version: 1,
    instructions: '',
    createdAt: Date.now(),
    spaces: fields.id === STANDALONE ? [] : [fields.id],
    tabs: [],
    terminals: [],
    surfaces: [],
    artifacts: [],
    ...fields,
  };
}

export function createManifest(fields) {
  const manifest = blankManifest(fields);
  withLock(manifest.id, () => writeAtomic(manifest));
  return manifest;
}

// Runs one locked read, change and atomic write.
export function updateManifest(id, change) {
  return withLock(id, () => {
    const manifest = readManifest(id);
    if (!manifest) throw new HwsError(`no workspace ${id}`);
    change(manifest);
    writeAtomic(manifest);
    return manifest;
  });
}

// Holds surfaces and artifacts that have no workspace.
export function ensureStandaloneManifest() {
  return withLock(STANDALONE, () => {
    const existing = readManifest(STANDALONE);
    if (existing) return existing;
    const manifest = blankManifest({ id: STANDALONE, name: 'Standalone', kind: STANDALONE, folder: home() });
    writeAtomic(manifest);
    return manifest;
  });
}
