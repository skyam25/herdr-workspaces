import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { HwsError } from './errors.js';
import { withLock } from './lock.js';
import { STANDALONE, home, manifestPath, stateRoot } from './paths.js';

export function readManifest(id) {
  try {
    return JSON.parse(readFileSync(manifestPath(id), 'utf8'));
  } catch {
    return null;
  }
}

function writeAtomic(manifest) {
  const target = manifestPath(manifest.id);
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temp, target);
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

export function createManifest(fields) {
  const manifest = {
    version: 1,
    instructions: '',
    createdAt: Date.now(),
    tabs: [],
    terminals: [],
    surfaces: [],
    artifacts: [],
    ...fields,
  };
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
    const manifest = {
      version: 1,
      id: STANDALONE,
      name: 'Standalone',
      kind: STANDALONE,
      folder: home(),
      instructions: '',
      createdAt: Date.now(),
      tabs: [],
      terminals: [],
      surfaces: [],
      artifacts: [],
    };
    writeAtomic(manifest);
    return manifest;
  });
}
