// The Herdr version on PATH and the one this checkout needs.
// `engines.herdr` in the checkout's package.json holds the minimum, such as ">=0.1.16".

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkout } from './checkout.js';

const VERSION = /(\d+\.\d+\.\d+)/;

// The Herdr version on PATH, or null when herdr-app does not answer.
export function herdrVersion() {
  const result = spawnSync(process.env.HWS_HERDR_APP || 'herdr-app', ['--version'], { encoding: 'utf8', timeout: 10_000 });
  return VERSION.exec(result.stdout ?? '')?.[1] ?? null;
}

// The minimum Herdr version, or null when the checkout names none.
export function requiredHerdr() {
  try {
    const { engines } = JSON.parse(readFileSync(join(checkout(), 'package.json'), 'utf8'));
    return VERSION.exec(engines?.herdr ?? '')?.[1] ?? null;
  } catch {
    return null;
  }
}

// Raises `engines.herdr` to version and leaves a higher minimum alone.
// Returns true when package.json changed.
export function raiseRequiredHerdr(version) {
  const required = requiredHerdr();
  if (!required || compareVersions(version, required) <= 0) return false;
  const path = join(checkout(), 'package.json');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/("herdr"\s*:\s*">=)[^"]*"/, `$1${version}"`));
  return true;
}

// Negative when a is older than b, zero when equal, positive when newer.
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number));
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Says why this Herdr is too old for the checkout, or null when it is new enough or either version is unknown.
export function herdrTooOld() {
  const required = requiredHerdr();
  const found = required && herdrVersion();
  if (!found || compareVersions(found, required) >= 0) return null;
  return `this checkout needs Herdr ${required} or newer, and herdr-app is ${found}, so update Herdr, restart it and run this again`;
}
