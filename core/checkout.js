import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installVersionPath } from './paths.js';

// The installer reads none of these. `hws` runs bin and core from the checkout.
const NOT_INSTALLED = new Set(['.github', '.gitignore', 'CLAUDE.md', 'LICENSE', 'README.md', 'bin', 'core', 'docs']);

export const checkout = () => process.env.HWS_CHECKOUT || fileURLToPath(new URL('../', import.meta.url));

// Runs git in the checkout and resolves to its output, or null on failure.
// A credential prompt would hang, so git may not ask for one.
export function git(args, timeout = 20_000) {
  const result = spawnSync('git', ['-C', checkout(), ...args], {
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Counts the commits on GitHub's main that this checkout lacks, or null when git cannot say.
export function commitsBehind() {
  if (git(['fetch', '--quiet', 'origin', 'main']) === null) return null;
  const count = git(['rev-list', '--count', 'HEAD..FETCH_HEAD']);
  return count === null ? null : Number(count);
}

// Hashes the git trees the installer reads, so the version changes only when an install would.
// Resolves to null outside a git checkout.
export function installVersion() {
  const entries = git(['ls-tree', 'HEAD']);
  if (entries === null) return null;
  const installed = entries.split('\n').filter((entry) => !NOT_INSTALLED.has(entry.split('\t')[1]));
  return createHash('sha256').update(installed.join('\n')).digest('hex').slice(0, 16);
}

// Resolves to the version of the last finished install, or null when none is recorded.
export function installedVersion() {
  try {
    return readFileSync(installVersionPath(), 'utf8').trim() || null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Local edits match no commit, so an install made with them records no version.
export function recordInstall() {
  const version = git(['status', '--porcelain', '--untracked-files=no']) === '' ? installVersion() : null;
  if (version === null) {
    rmSync(installVersionPath(), { force: true });
    return;
  }
  mkdirSync(dirname(installVersionPath()), { recursive: true });
  writeFileSync(installVersionPath(), `${version}\n`);
}
