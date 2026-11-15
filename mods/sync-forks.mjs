#!/usr/bin/env node
// Reports the forks of Herdr's mods, and with --merge brings each one up to the installed Herdr.
// Usage: node mods/sync-forks.mjs [--merge]

import { forks, herdrVersion, syncFork } from '../core/forks.js';

const merge = process.argv.includes('--merge');
const version = herdrVersion();
let conflicts = 0;
let behind = 0;

for (const entry of forks()) {
  if (entry.state !== 'behind') {
    console.log(`${entry.mod}: ${entry.state} (${entry.name} ${entry.version})`);
    continue;
  }
  behind += 1;
  if (!merge) {
    console.log(`${entry.mod}: behind, Herdr's ${entry.name} changed since ${entry.version}`);
    continue;
  }
  if (!version) {
    console.error('herdr-app did not report its version, so nothing was merged.');
    process.exit(1);
  }
  const count = syncFork(entry, version);
  conflicts += count;
  console.log(count ? `${entry.mod}: merged with ${count} conflict(s) to resolve in ${entry.fork}` : `${entry.mod}: merged cleanly to ${entry.name} ${version}`);
}

if (merge && behind) console.log('Next run the mod tests and herdr-app check, then install with sh mods/install.sh --force.');
if (!merge && behind) console.log('Run node mods/sync-forks.mjs --merge to bring them up to date.');
process.exitCode = conflicts || (!merge && behind) ? 1 : 0;
