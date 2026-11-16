// Tracks the mods copied from Herdr's own. Each fork's mod.json records `cloned_from`
// {name, version}, and mods/upstream/<name>.js holds Herdr's file at that version.
// A sync merges Herdr's changes since then into the fork with `git merge-file`.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkout } from './checkout.js';
import { compareVersions, herdrVersion } from './herdr-version.js';
import { home } from './paths.js';

export const appHome = () => process.env.HERDR_APP_HOME || join(home(), '.config/herdr-app');

export { herdrVersion };

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// Names why Herdr's shipped file differs from the fork's base.
// `behind` means Herdr is newer than the base, or its version is unknown, so a merge applies.
// `herdr older` means the installed Herdr predates the base, so Herdr needs an update.
// `not restarted` means Herdr matches the base's version but still runs an older build.
function difference(version, herdr) {
  if (!herdr || !version) return 'behind';
  const order = compareVersions(herdr, version);
  return order > 0 ? 'behind' : order < 0 ? 'herdr older' : 'not restarted';
}

// Each fork with its paths and state.
export function forks() {
  const mods = join(checkout(), 'mods');
  const herdr = herdrVersion();
  return readdirSync(mods)
    .filter((dir) => dir.startsWith('hws-') && existsSync(join(mods, dir, 'mod.json')))
    .flatMap((dir) => {
      const from = readJson(join(mods, dir, 'mod.json')).cloned_from;
      if (!from?.name) return [];
      const fork = join(mods, dir, 'main.js');
      const base = join(mods, 'upstream', `${from.name}.js`);
      const shipped = join(appHome(), 'mods', from.name, 'main.js');
      const state = !existsSync(base) ? 'no base' : !existsSync(shipped) ? 'not shipped' : readFileSync(base, 'utf8') === readFileSync(shipped, 'utf8') ? 'current' : difference(from.version, herdr);
      return [{ mod: dir, name: from.name, version: from.version, fork, base, shipped, state }];
    });
}

// Merges Herdr's changes into one fork. The fork then carries conflict markers where
// both sides changed the same lines, and the base moves to Herdr's file either way.
export function syncFork(entry, version) {
  const merged = spawnSync('git', ['merge-file', '-p', '-L', entry.mod, '-L', `${entry.name} ${entry.version}`, '-L', `${entry.name} ${version}`, entry.fork, entry.base, entry.shipped], { encoding: 'utf8' });
  if (merged.status < 0 || merged.error || merged.status > 127) throw new Error(`git merge-file failed for ${entry.mod}: ${merged.stderr || merged.error?.message}`);
  writeFileSync(entry.fork, merged.stdout);
  copyFileSync(entry.shipped, entry.base);
  const manifest = join(entry.fork, '..', 'mod.json');
  const json = readJson(manifest);
  json.cloned_from = { name: entry.name, version };
  writeFileSync(manifest, `${JSON.stringify(json, null, 2)}\n`);
  return merged.status;
}
