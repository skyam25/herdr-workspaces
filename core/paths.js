import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STANDALONE = 'standalone';
export const HOST_SCRIPT = fileURLToPath(new URL('../surface/run.sh', import.meta.url));

export function home() {
  return homedir();
}

export function stateRoot() {
  return resolve(process.env.HWS_HOME || join(home(), '.local/state/herdr-workspaces'));
}

export function workspaceDir(id) {
  return join(stateRoot(), 'workspaces', id);
}

export function manifestPath(id) {
  return join(workspaceDir(id), 'workspace.json');
}

// A remote space id has a machine prefix with a slash, so the name encodes it.
export function todosPath(spaceId) {
  return join(stateRoot(), 'todos', `${encodeURIComponent(spaceId)}.json`);
}

export function surfaceDataDir(workspaceId, surfaceId) {
  return join(workspaceDir(workspaceId), 'surfaces', surfaceId);
}

export function socketPath(surfaceId) {
  return `/tmp/hws-${surfaceId}.sock`;
}

const slug = (name) => name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';

// One folder per workspace, because workspaces can share a parent folder.
export function keptArtifactDir(folder, workspace, artifactId) {
  return join(folder, '.herdr-workspace', `${slug(workspace.name)}-${workspace.id.slice(-6)}`, 'artifacts', artifactId);
}

export function throwawayArtifactDir(spaceId, artifactId) {
  return join(workspaceDir(spaceId), 'artifacts', artifactId);
}

export function standaloneArtifactDir(artifactId) {
  return join(stateRoot(), STANDALONE, 'artifacts', artifactId);
}

export function keptThrowawayDir(name, artifactId) {
  const safeName = name.replace(/[/:]/g, '-').replace(/^\.+/, '') || 'workspace';
  return join(home(), 'Documents', 'Herdr Workspaces', safeName, artifactId);
}

export function lockDir(name) {
  return join(stateRoot(), 'locks', `${name}.lock`);
}

// Expands a leading ~ and makes the folder absolute.
export function expandFolder(folder) {
  if (folder === '~') return home();
  if (folder.startsWith('~/')) return join(home(), folder.slice(2));
  return resolve(folder);
}
