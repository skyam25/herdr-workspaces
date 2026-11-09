import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { checkout, git } from '../checkout.js';
import { HwsError } from '../errors.js';

const PULL_MS = 120_000;

function requireCleanMain() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === null) throw new HwsError(`${checkout()} is not a git checkout, so clone the repo again`);
  if (branch !== 'main') throw new HwsError(`this checkout is on ${branch}, so switch to main first`);
  if (git(['status', '--porcelain', '--untracked-files=no']) !== '') throw new HwsError('this checkout has uncommitted changes, so commit or stash them first');
}

// Brings this machine to GitHub's main and reinstalls every part.
export function update() {
  requireCleanMain();
  const before = git(['rev-parse', '--short', 'HEAD']);
  if (git(['pull', '--quiet', '--ff-only', 'origin', 'main'], PULL_MS) === null) {
    throw new HwsError('could not pull from GitHub, so check the connection and that this checkout has no commits of its own');
  }
  const after = git(['rev-parse', '--short', 'HEAD']);
  if (after === before) return { data: { updated: false, commit: after }, text: `Already up to date at ${after}` };

  // The installer's output goes to stderr, so stdout holds only the result.
  const install = spawnSync('sh', [join(checkout(), 'install.sh'), '--force'], { stdio: ['ignore', 2, 2] });
  if (install.status !== 0) throw new HwsError(`updated to ${after}, but the install reported problems, so read the checks above`);
  return { data: { updated: true, from: before, commit: after }, text: `Updated from ${before} to ${after}` };
}
