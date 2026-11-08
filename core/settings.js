import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { HwsError } from './errors.js';
import { home, stateRoot } from './paths.js';

const settingsFile = () => join(stateRoot(), 'settings.json');

function remembered() {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8')).parent;
  } catch {
    return undefined;
  }
}

// The folder new work starts in: the last one used, else ~/Projects, else home.
export function parentFolder() {
  const last = remembered();
  if (last && existsSync(last)) return last;
  const projects = join(home(), 'Projects');
  return existsSync(projects) ? projects : home();
}

export function rememberParent(folder) {
  mkdirSync(stateRoot(), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify({ parent: folder }));
}

export function requireFolder(folder) {
  if (!existsSync(folder)) throw new HwsError(`${folder} does not exist`);
  return folder;
}
