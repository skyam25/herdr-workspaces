import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { HwsError } from './errors.js';

const FINDER_SCRIPT = [
  'on run argv',
  'repeat with p in argv',
  'set f to POSIX file (p as text) as alias',
  'tell application "Finder" to delete f',
  'end repeat',
  'end run',
];

function runTrash(bin, args) {
  const result = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    throw new HwsError(`could not move to the Trash: ${result.stderr?.trim() || result.error?.message}`);
  }
}

// Moves paths to the macOS Trash and throws when any path stays behind.
export function moveToTrash(paths) {
  const present = paths.filter((path) => existsSync(path));
  if (present.length === 0) return;
  const trashBin = process.env.HWS_TRASH || '/usr/bin/trash';
  if (existsSync(trashBin)) {
    runTrash(trashBin, present);
  } else {
    const osascript = process.env.HWS_OSASCRIPT || '/usr/bin/osascript';
    runTrash(osascript, [...FINDER_SCRIPT.flatMap((line) => ['-e', line]), ...present]);
  }
  const stuck = present.filter((path) => existsSync(path));
  if (stuck.length > 0) throw new HwsError(`could not move to the Trash: ${stuck.join(', ')}`);
}
