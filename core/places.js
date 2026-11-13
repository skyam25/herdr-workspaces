import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { HwsError, UsageError } from './errors.js';
import { STANDALONE, expandFolder, keptWorkspaceDir, stateRoot, workspaceDir } from './paths.js';
import { defaultPlaces } from './settings.js';

export const ROLES = ['current', 'notes', 'artifacts', 'scratch', 'decisions', 'history', 'meetings'];
const STAGES = ['discovery', 'deciding', 'building', 'settled'];

// `hws place` creates these folders on first use. The others belong to the user.
const CREATED_ON_USE = ['scratch', 'artifacts', 'notes'];
const HWS = 'hws';

export function assertRole(role) {
  if (!ROLES.includes(role)) throw new UsageError(`unknown place ${role}, use one of ${ROLES.join(', ')}`);
  return role;
}

export function assertStage(stage) {
  if (!STAGES.includes(stage)) throw new UsageError(`unknown stage ${stage}, use one of ${STAGES.join(', ')}`);
  return stage;
}

// Splits ROLE=VALUE. An empty value clears the role.
export function parseAssignment(text, flag) {
  const at = text.indexOf('=');
  if (at < 1) throw new UsageError(`--${flag} takes ROLE=VALUE`);
  return [assertRole(text.slice(0, at)), text.slice(at + 1).trim()];
}

// A place is a path string or `{ path, writer }`. Anything else counts as unset.
function entryOf(value) {
  if (typeof value === 'string' && value) return { path: value, writer: null };
  if (value && typeof value.path === 'string' && value.path) return { path: value.path, writer: value.writer || null };
  return null;
}

// Where the workspace's own files live. `folder` is where its agents run.
export const homeOf = (manifest) => manifest.home || manifest.folder;

// A workspace with a folder to itself uses plain names. One sharing its folder
// keeps its files under `.herdr-workspace` so they stay out of the way.
export const hasOwnHome = (manifest) => Boolean(manifest.home) && manifest.home !== manifest.folder;

export const isKept = (manifest) => manifest.id !== STANDALONE && manifest.kind !== 'throwaway';

function builtInDefaults(manifest) {
  if (manifest.id === STANDALONE) return { artifacts: join(stateRoot(), STANDALONE, 'artifacts') };
  if (manifest.kind === 'throwaway') {
    return { artifacts: join(workspaceDir(manifest.id), 'artifacts'), scratch: join(workspaceDir(manifest.id), 'scratch') };
  }
  if (hasOwnHome(manifest)) return { current: 'CURRENT.md', notes: 'notes', artifacts: 'artifacts', scratch: 'scratch', decisions: 'decisions', history: 'history' };
  const own = keptWorkspaceDir(manifest.folder, manifest);
  return { current: join(own, 'CURRENT.md'), notes: join(own, 'notes'), artifacts: join(own, 'artifacts'), scratch: join(own, 'scratch'), decisions: join(own, 'decisions'), history: join(own, 'history') };
}

// True when neither the manifest nor settings.json names the role.
const takesDefault = (manifest, role) => !entryOf(manifest.places?.[role]) && !entryOf(defaultPlaces()[role]);

// The manifest decides first, then settings.json for a kept workspace, then the built-in default.
function entryFor(manifest, role) {
  const fromManifest = entryOf(manifest.places?.[role]);
  if (fromManifest) return fromManifest;
  const fromSettings = isKept(manifest) ? entryOf(defaultPlaces()[role]) : null;
  if (fromSettings) return fromSettings;
  return entryOf(builtInDefaults(manifest)[role]);
}

function absolute(manifest, path) {
  if (path === '~' || path.startsWith('~/')) return expandFolder(path);
  return isAbsolute(path) ? resolve(path) : resolve(homeOf(manifest), path);
}

export const isForeign = (writer) => Boolean(writer) && writer !== HWS;

// `path` is absolute, or null when the role is unset.
export function placeOf(manifest, role) {
  const entry = entryFor(manifest, assertRole(role));
  return { role, path: entry ? absolute(manifest, entry.path) : null, writer: entry?.writer ?? null };
}

export function allPlaces(manifest) {
  return Object.fromEntries(ROLES.map((role) => [role, placeOf(manifest, role).path]));
}

// Returns the absolute path for hws to write under, or fails.
export function writablePlace(manifest, role) {
  const { path, writer } = placeOf(manifest, role);
  if (!path) throw new HwsError(`${manifest.name} has no ${role} place`);
  if (isForeign(writer)) throw new HwsError(`the ${role} place ${path} belongs to ${writer}, so hws does not write there`);
  return path;
}

// Creates a scratch or artifacts folder that hws may write. Never creates the others.
export function ensurePlace(manifest, role) {
  const found = placeOf(manifest, role);
  if (found.path && CREATED_ON_USE.includes(role) && !isForeign(found.writer)) mkdirSync(found.path, { recursive: true });
  return found;
}

// Changes the manifest's own map in place. A new path keeps the role's writer.
export function applyPlaces(draft, paths, writers) {
  const places = { ...(draft.places ?? {}) };
  for (const [role, path] of paths) {
    const writer = entryOf(places[role])?.writer;
    if (!path) delete places[role];
    else places[role] = isForeign(writer) ? { path, writer } : path;
  }
  for (const [role, writer] of writers) {
    const path = entryOf(places[role])?.path;
    if (!path) throw new HwsError(`give ${role} a path with --place before naming its writer`);
    places[role] = isForeign(writer) ? { path, writer } : path;
  }
  if (Object.keys(places).length > 0) draft.places = places;
  else delete draft.places;
}

// A kept workspace without its own home once kept its note at `<folder>/CURRENT.md`,
// which every workspace in that folder shared. The latest tidier in each folder keeps
// that file as an explicit place. The others forget their pass, so the next one
// gathers their whole stream into a note of their own.
export function adoptSharedNotes(manifests, update) {
  const byFolder = new Map();
  for (const manifest of manifests) {
    if (!isKept(manifest) || hasOwnHome(manifest) || !manifest.current?.tidiedAt || !takesDefault(manifest, 'current')) continue;
    if (existsSync(placeOf(manifest, 'current').path)) continue;
    if (!existsSync(join(manifest.folder, 'CURRENT.md'))) continue;
    byFolder.set(manifest.folder, [...(byFolder.get(manifest.folder) ?? []), manifest]);
  }
  const adopted = [];
  for (const group of byFolder.values()) {
    const [owner, ...others] = group.sort((a, b) => b.current.tidiedAt - a.current.tidiedAt);
    update(owner.id, (draft) => applyPlaces(draft, [['current', 'CURRENT.md']], []));
    for (const other of others) update(other.id, (draft) => delete draft.current);
    adopted.push(owner.id);
  }
  return adopted;
}
