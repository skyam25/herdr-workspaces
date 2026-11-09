import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STANDALONE = 'standalone';
export const HOST_SCRIPT = fileURLToPath(new URL('../surface/run.sh', import.meta.url));
export const PHONE_HOST = fileURLToPath(new URL('../surface/app/out/phone/host.cjs', import.meta.url));
export const HWS_BIN = fileURLToPath(new URL('../bin/hws', import.meta.url));

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

export function phoneDir() {
  return join(stateRoot(), 'phone');
}

// Kept short for the Unix limit. The hash gives each state root its own listener.
export function phoneSocket(root = stateRoot()) {
  return `/tmp/hws-phone-${createHash('sha256').update(root).digest('hex').slice(0, 8)}.sock`;
}

const slug = (name) => name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';

// One folder per workspace, because workspaces can share a parent folder.
// `storeName` keeps the folder in place after a rename.
export function keptWorkspaceDir(folder, workspace) {
  return join(folder, '.herdr-workspace', `${slug(workspace.storeName ?? workspace.name)}-${workspace.id.slice(-6)}`);
}

export function keptThrowawayDir(name, artifactId) {
  const safeName = name.replace(/[/:]/g, '-').replace(/^\.+/, '') || 'workspace';
  return join(home(), 'Documents', 'Herdr Workspaces', safeName, artifactId);
}

export function retiredDir() {
  return join(stateRoot(), 'retired');
}

// The id is encoded because `hws reopen` takes it from the command line.
export function retiredPath(id) {
  return join(retiredDir(), `${encodeURIComponent(id)}.json`);
}

// Claude Code stores a session under its start folder with each symbol turned into a dash.
export function transcriptPath(folder, sessionId) {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(home(), '.claude');
  return join(claudeHome, 'projects', folder.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
}

export function captureDir() {
  return join(stateRoot(), 'capture');
}

// plugin/hooks/stop.sh checks this path itself.
export function capturePath(terminal) {
  return join(captureDir(), encodeURIComponent(terminal));
}

export function terminalSessionDir() {
  return join(stateRoot(), 'terminal-sessions');
}

export function terminalSessionPath(terminal) {
  return join(terminalSessionDir(), `${encodeURIComponent(terminal)}.json`);
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
