import { mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { HwsError } from './errors.js';
import { lockDir } from './paths.js';

const STALE_MS = 10_000;
const WAIT_MS = 15_000;
const RETRY_MS = 10;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

// A crashed holder leaves its directory behind, so old locks are cleared.
function clearIfStale(dir) {
  try {
    if (Date.now() - statSync(dir).mtimeMs < STALE_MS) return;
    const tomb = `${dir}.stale.${process.pid}`;
    renameSync(dir, tomb);
    rmSync(tomb, { recursive: true, force: true });
  } catch {
    // Another process holds or cleared the lock.
  }
}

function acquire(dir) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      mkdirSync(dir);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    clearIfStale(dir);
    if (Date.now() > deadline) throw new HwsError(`timed out waiting for lock ${dir}`);
    Atomics.wait(sleeper, 0, 0, RETRY_MS + Math.random() * RETRY_MS);
  }
}

export function withLock(name, fn) {
  const dir = lockDir(name);
  mkdirSync(dirname(dir), { recursive: true });
  acquire(dir);
  try {
    return fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
