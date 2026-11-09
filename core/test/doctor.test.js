import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { sandbox } from './helpers.js';

const PIXEL_PATH = fileURLToPath(new URL('../../surface/pixel-path.sh', import.meta.url));
const PLUGIN_ID = 'herdr-workspaces@herdr-workspaces';

function write(path, content = 'x') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// Builds a checkout and a matching install, and returns the environment that points at them.
function installed(box, plugins = [{ id: PLUGIN_ID, enabled: true, version: '1.0.0' }]) {
  const checkout = join(box.dir, 'checkout');
  const appHome = join(box.dir, 'app-home');
  const claude = join(box.dir, 'claude');
  write(join(checkout, 'bin/hws'));
  write(join(checkout, 'mods/hws-one/main.js'), 'main');
  write(join(checkout, 'mods/hws-one/core/deep/a.js'), 'deep');
  write(join(checkout, 'mods/layouts/hws.json'), '{}');
  write(join(checkout, 'plugin/.claude-plugin/plugin.json'), '{"version":"1.0.0"}');
  write(join(checkout, 'surface/app/out/main/index.cjs'));
  write(join(checkout, 'surface/node_modules/@zenbu-labs/pixel/electron/dist/Electron.app/Contents/MacOS/pixel'));
  write(join(checkout, 'surface/node_modules/@zenbu-labs/pixel/electron/dist/pixel'));
  mkdirSync(join(checkout, 'surface'), { recursive: true });
  copyFileSync(PIXEL_PATH, join(checkout, 'surface/pixel-path.sh'));
  write(join(appHome, 'mods/hws-one/main.js'), 'main');
  write(join(appHome, 'mods/hws-one/core/deep/a.js'), 'deep');
  write(join(appHome, 'mods/hws-one/jsconfig.json'), 'written by herdr');
  write(join(appHome, 'layouts/hws.json'), '{}');
  mkdirSync(join(box.homeDir, '.local/bin'), { recursive: true });
  symlinkSync(join(checkout, 'bin/hws'), join(box.homeDir, '.local/bin/hws'));
  writeFileSync(claude, `#!/bin/sh\necho '${JSON.stringify(plugins)}'\n`, { mode: 0o755 });
  return { checkout, appHome, env: { HWS_CHECKOUT: checkout, HERDR_APP_HOME: appHome, HWS_CLAUDE: claude } };
}

function run(box, env) {
  const result = box.hws(['doctor', '--json'], env);
  return { code: result.code, ...JSON.parse(result.stdout) };
}

const failed = (report) => report.checks.filter((check) => !check.ok).map((check) => check.name);

test('a complete install passes', (t) => {
  const box = sandbox(t);
  const report = run(box, installed(box).env);
  assert.deepEqual(failed(report), []);
  assert.equal(report.ok, true);
  assert.equal(report.code, 0);
});

test('a mod that differs from the checkout fails and names the fix', (t) => {
  const box = sandbox(t);
  const { appHome, env } = installed(box);
  write(join(appHome, 'mods/hws-one/core/deep/a.js'), 'old');
  const report = run(box, env);
  assert.deepEqual(failed(report), ['Mods']);
  assert.equal(report.code, 1);
  assert.match(report.checks.find((check) => check.name === 'Mods').detail, /hws-one differs/);
  assert.match(report.checks.find((check) => check.name === 'Mods').fix, /install\.sh --force/);
});

test('a missing mod fails', (t) => {
  const box = sandbox(t);
  const { appHome, env } = installed(box);
  rmSync(join(appHome, 'mods/hws-one'), { recursive: true });
  assert.match(run(box, env).checks.find((check) => check.name === 'Mods').detail, /hws-one is missing/);
});

test('a missing surface fails without failing the other parts', (t) => {
  const box = sandbox(t);
  const { checkout, env } = installed(box);
  rmSync(join(checkout, 'surface/app/out'), { recursive: true });
  rmSync(join(checkout, 'surface/node_modules'), { recursive: true });
  assert.deepEqual(failed(run(box, env)), ['Pixel', 'Surface app']);
});

test('a link to another checkout fails', (t) => {
  const box = sandbox(t);
  const { env } = installed(box);
  const link = join(box.homeDir, '.local/bin/hws');
  write(join(box.dir, 'other/bin/hws'));
  rmSync(link);
  symlinkSync(join(box.dir, 'other/bin/hws'), link);
  assert.deepEqual(failed(run(box, env)), ['CLI link']);
});

for (const [label, plugins, detail] of [
  ['absent', [], /not installed/],
  ['disabled', [{ id: PLUGIN_ID, enabled: false, version: '1.0.0' }], /disabled/],
  ['stale', [{ id: PLUGIN_ID, enabled: true, version: '0.9.0' }], /installed 0\.9\.0, checkout 1\.0\.0/],
]) {
  test(`a plugin that is ${label} fails`, (t) => {
    const box = sandbox(t);
    const report = run(box, installed(box, plugins).env);
    assert.deepEqual(failed(report), ['Claude plugin']);
    assert.match(report.checks.find((check) => check.name === 'Claude plugin').detail, detail);
  });
}

test('missing tools fail instead of crashing', (t) => {
  const box = sandbox(t);
  const { env } = installed(box);
  const missing = join(box.dir, 'not-here');
  const report = run(box, { ...env, HWS_HERDR_APP: missing, HWS_HC: missing, HWS_CLAUDE: missing });
  assert.deepEqual(failed(report), ['Herdr app', 'hc', 'Claude plugin']);
});

test('the plain report prints each failure with its fix', (t) => {
  const box = sandbox(t);
  const { appHome, env } = installed(box);
  rmSync(join(appHome, 'layouts/hws.json'));
  const result = box.hws(['doctor'], env);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /^ok {2}/m);
  assert.match(result.stdout, /^FAIL {2}Layout/m);
  assert.match(result.stdout, /^ {6}Run sh .*install\.sh --force$/m);
});

test('install.sh and doctor agree on which files a mod ships', (t) => {
  const box = sandbox(t);
  const { checkout, appHome, env } = installed(box);
  write(join(checkout, 'mods/hws-one/notes.md'), 'not shipped');
  write(join(checkout, 'mods/hws-one/gpui-kit.d.ts'), 'written by herdr');
  write(join(checkout, 'mods/hws-one/icon.svg'), 'shipped');
  assert.deepEqual(failed(run(box, env)), ['Mods']);
  write(join(appHome, 'mods/hws-one/icon.svg'), 'shipped');
  assert.deepEqual(failed(run(box, env)), []);
});
