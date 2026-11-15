import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { sandbox } from './helpers.js';

const SCRIPT = fileURLToPath(new URL('../../mods/sync-forks.mjs', import.meta.url));

const BASE = ['// tabs', 'const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;', 'const e = 5;', ''].join('\n');

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// A checkout with one fork of Herdr's `tabs`, synced at 0.1.16, and Herdr's shipped copy.
function world(t, { fork = BASE.replace('const a = 1;', 'const a = 10;'), shipped = BASE } = {}) {
  const box = sandbox(t);
  const checkout = join(box.dir, 'checkout');
  const appHome = join(box.dir, 'app-home');
  write(join(checkout, 'mods/hws-tabs/main.js'), fork);
  write(join(checkout, 'mods/hws-tabs/mod.json'), JSON.stringify({ place: 'none', cloned_from: { name: 'tabs', version: '0.1.16' } }));
  write(join(checkout, 'mods/hws-plain/main.js'), 'ours');
  write(join(checkout, 'mods/hws-plain/mod.json'), '{"place":"none"}');
  write(join(checkout, 'mods/upstream/tabs.js'), BASE);
  write(join(appHome, 'mods/tabs/main.js'), shipped);
  box.setState({ version: '0.1.17' });
  const env = { ...box.environment, HWS_CHECKOUT: checkout, HERDR_APP_HOME: appHome };
  const sync = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
  const read = (path) => readFileSync(join(checkout, path), 'utf8');
  return { box, env, sync, read };
}

test('a fork whose base matches Herdr is current, and a plain mod is no fork', (t) => {
  const { sync } = world(t);
  const result = sync();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /hws-tabs: current \(tabs 0\.1\.16\)/);
  assert.doesNotMatch(result.stdout, /hws-plain/);
});

test('a report names a fork whose Herdr original changed, and changes nothing', (t) => {
  const { sync, read } = world(t, { shipped: BASE.replace('const e = 5;', 'const e = 50;') });
  const result = sync();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /hws-tabs: behind/);
  assert.equal(read('mods/upstream/tabs.js'), BASE);
});

test('a merge carries Herdr changes into the fork and moves the base and version', (t) => {
  const shipped = BASE.replace('const e = 5;', 'const e = 50;');
  const { sync, read } = world(t, { shipped });
  const result = sync('--merge');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /merged cleanly to tabs 0\.1\.17/);
  assert.match(read('mods/hws-tabs/main.js'), /const a = 10;[\s\S]*const e = 50;/);
  assert.equal(read('mods/upstream/tabs.js'), shipped);
  assert.deepEqual(JSON.parse(read('mods/hws-tabs/mod.json')).cloned_from, { name: 'tabs', version: '0.1.17' });
});

test('a merge where both sides changed a line leaves conflict markers and fails', (t) => {
  const { sync, read } = world(t, { shipped: BASE.replace('const a = 1;', 'const a = 2;') });
  const result = sync('--merge');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /1 conflict/);
  assert.match(read('mods/hws-tabs/main.js'), /<<<<<<< hws-tabs[\s\S]*const a = 10;[\s\S]*=======[\s\S]*const a = 2;[\s\S]*>>>>>>> tabs 0\.1\.17/);
});

test('doctor notes a fork behind Herdr without failing', (t) => {
  const { box, env } = world(t, { shipped: BASE.replace('const e = 5;', 'const e = 50;') });
  const report = JSON.parse(box.hws(['doctor', '--json'], env).stdout);
  const forks = report.checks.find((check) => check.name === 'Forks');
  assert.equal(forks.ok, true);
  assert.equal(forks.note, true);
  assert.match(forks.detail, /hws-tabs behind/);
  assert.match(forks.fix, /sync-forks\.mjs --merge/);
});

test('every fork in this checkout records its origin and keeps that base', () => {
  const mods = fileURLToPath(new URL('../../mods/', import.meta.url));
  const recorded = ['hws-tabs', 'hws-agents', 'hws-spaces'].map((mod) => JSON.parse(readFileSync(join(mods, mod, 'mod.json'), 'utf8')).cloned_from);
  assert.deepEqual(recorded.map(({ name }) => name), ['tabs', 'agents', 'spaces']);
  for (const { name, version } of recorded) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.ok(readFileSync(join(mods, 'upstream', `${name}.js`), 'utf8').length > 0);
  }
});
