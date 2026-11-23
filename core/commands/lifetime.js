// Work stays while a window, a live owner terminal, Save or Keep holds it.
// Unheld work waits `recentDays` days, then goes to the Trash. Prune runs this.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readJson } from '../agent-brief.js';
import { isInside } from '../artifacts.js';
import { copyBoardBundle, writeDraftFile } from '../drafts.js';
import { listManifests, updateManifest } from '../manifest.js';
import { stateRoot, surfaceDataDir } from '../paths.js';
import { writablePlace } from '../places.js';
import { recentDays } from '../settings.js';
import { boardsWithWork, hasDraftWork } from '../surface-windows.js';
import { moveToTrash } from '../trash.js';
import { bundleDir, liveCheck, newId, paneIsOpen, pushArtifact, trashSurfaceData } from './surface.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Files each board and draft as kept work, and returns their records.
function filedWork(manifest, surface) {
  const data = surfaceDataDir(manifest.id, surface.id);
  const boards = join(data, 'boards');
  const names = boardsWithWork(manifest.id, surface.id).filter((name) => existsSync(join(boards, `${name}.excalidraw`)));
  const record = (fields) => ({ id: newId('a'), fromTerminal: surface.terminal ?? null, createdAt: Date.now(), status: 'current', ...fields });
  const filed = names.map((name) => {
    const title = names.length === 1 ? surface.title : name;
    const fields = record({ type: 'board', title });
    const path = bundleDir(manifest, fields, fields.id, { transient: false });
    return { ...fields, path, prompt: copyBoardBundle(boards, name, path, { title, origin: 'saved from Herdr' }) };
  });
  const drafts = join(data, 'drafts');
  for (const name of existsSync(drafts) ? readdirSync(drafts).filter((item) => item.endsWith('.json')) : []) {
    const written = writeDraftFile(readJson(join(drafts, name)), writablePlace(manifest, 'artifacts'), surface.id);
    if (written) filed.push(record({ type: 'file', title: written.title, path: written.file, prompt: written.file }));
  }
  return filed;
}

// A saved surface with no window and no owner gets its home in the workspace folder.
// Its data folder also holds browser data, so it goes to the Trash once its work is filed.
function fileSavedSurface(manifest, surface) {
  const filed = filedWork(manifest, surface);
  updateManifest(manifest.id, (draft) => {
    for (const record of filed) pushArtifact(draft, record, record.type === 'board' ? surface.reopens : null);
    draft.surfaces = draft.surfaces.filter((item) => item.id !== surface.id);
  });
  trashSurfaceData(manifest.id, surface.id);
}

// Sets or clears each changed record's expiresAt, and drops the records `gone` names.
function writeLife(manifest, list, changes, gone) {
  if (changes.size === 0 && gone.size === 0) return;
  updateManifest(manifest.id, (draft) => {
    draft[list] = draft[list].filter((item) => !gone.has(item.id));
    for (const item of draft[list]) {
      const change = changes.get(item.id);
      if (!change) continue;
      if (change.expiresAt === null) delete item.expiresAt;
      else item.expiresAt = change.expiresAt;
      if (change.kept) delete item.transient;
    }
  });
}

// A surface counting down already had work, and nothing writes to a closed surface, so it is not read again.
function ageSurfaces(manifest, live, alive, now, expiresAt) {
  const changes = new Map();
  const gone = new Set();
  for (const surface of manifest.surfaces) {
    const open = surface.host ? alive(surface.host) : paneIsOpen(live, surface.pane);
    if (open || alive(surface.terminal)) {
      if (surface.expiresAt) changes.set(surface.id, { expiresAt: null });
      continue;
    }
    if (surface.expiresAt > now) continue;
    try {
      if (surface.saved) {
        fileSavedSurface(manifest, surface);
      } else if (surface.expiresAt) {
        trashSurfaceData(manifest.id, surface.id);
        gone.add(surface.id);
      } else if (hasDraftWork(manifest.id, surface.id)) {
        changes.set(surface.id, { expiresAt });
      } else {
        gone.add(surface.id);
      }
    } catch {
      // The record stays and the next prune retries it.
    }
  }
  writeLife(manifest, 'surfaces', changes, gone);
}

// Prune trashes only what hws wrote under the state root. Anything else stays kept work.
function ageArtifacts(manifest, alive, now, expiresAt) {
  const changes = new Map();
  const gone = new Set();
  for (const artifact of manifest.artifacts.filter((item) => item.transient)) {
    if (!isInside(stateRoot(), artifact.path)) {
      changes.set(artifact.id, { expiresAt: null, kept: true });
    } else if (alive(artifact.fromTerminal)) {
      if (artifact.expiresAt) changes.set(artifact.id, { expiresAt: null });
    } else if (!artifact.expiresAt) {
      changes.set(artifact.id, { expiresAt });
    } else if (artifact.expiresAt <= now) {
      try {
        if (existsSync(artifact.path)) moveToTrash([artifact.path]);
        gone.add(artifact.id);
      } catch {
        // The record stays and the next prune retries it.
      }
    }
  }
  writeLife(manifest, 'artifacts', changes, gone);
}

// Archived workspaces keep everything until they come back.
export function ageWork(live) {
  const now = Date.now();
  const expiresAt = now + recentDays() * DAY_MS;
  const alive = liveCheck();
  for (const manifest of listManifests({ includeStandalone: true })) {
    if (manifest.archived) continue;
    try {
      ageSurfaces(manifest, live, alive, now, expiresAt);
      ageArtifacts(manifest, alive, now, expiresAt);
    } catch {
      // The manifest stays and the next prune retries it.
    }
  }
}
