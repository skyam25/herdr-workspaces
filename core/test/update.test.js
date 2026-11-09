import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { sandbox } from './helpers.js';

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const CHECKOUT_MODULE = new URL('../checkout.js', import.meta.url).href;

// A clone of a bare repo. Its install.sh logs its arguments, exits with the code in the
// `exit` file and records the install version on success, as the real one does.
function cloned(t, { installed = true } = {}) {
  const box = sandbox(t);
  const origin = join(box.dir, 'origin.git');
  const seed = join(box.dir, 'seed');
  const checkout = join(box.dir, 'checkout');
  const log = join(box.dir, 'installed');
  const exit = join(box.dir, 'exit');
  writeFileSync(exit, '0');
  git(box.dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(box.dir, 'clone', '-q', origin, seed);
  git(seed, 'switch', '-q', '-c', 'main');
  writeFileSync(join(seed, 'install.sh'), `echo "$*" >> "${log}"
echo installing
code="$(cat "${exit}")"
[ "$code" -ne 0 ] || node --input-type=module -e "import('${CHECKOUT_MODULE}').then((m) => m.recordInstall())"
exit "$code"
`);
  writeFileSync(join(seed, 'tracked'), 'one');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'first');
  git(seed, 'push', '-q', 'origin', 'main');
  git(box.dir, 'clone', '-q', origin, checkout);
  let edits = 0;
  const publish = (folder = 'mods') => {
    mkdirSync(join(seed, folder), { recursive: true });
    writeFileSync(join(seed, folder, 'file'), String(++edits));
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', `edit ${edits}`);
    git(seed, 'push', '-q', 'origin', 'main');
    return git(seed, 'rev-parse', '--short', 'HEAD');
  };
  const update = (...flags) => box.hws(['update', ...flags], { HWS_CHECKOUT: checkout });
  if (installed) {
    assert.equal(update().code, 0);
    rmSync(log);
  }
  const failInstalls = (fail) => writeFileSync(exit, fail ? '1' : '0');
  return { checkout, log, publish, update, failInstalls, stamp: join(box.root, 'install-version') };
}

test('update pulls main and reinstalls with --force', (t) => {
  const { checkout, log, publish, update } = cloned(t);
  const before = git(checkout, 'rev-parse', '--short', 'HEAD');
  const commit = publish();

  const result = update('--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { updated: true, from: before, commit, installed: true });
  assert.match(result.stderr, /installing/);
  assert.equal(git(checkout, 'rev-parse', '--short', 'HEAD'), commit);
  assert.equal(readFileSync(log, 'utf8').trim(), '--force');
});

test('update with nothing new installs nothing', (t) => {
  const { checkout, log, update } = cloned(t);
  const result = update();
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Already up to date at ${git(checkout, 'rev-parse', '--short', 'HEAD')}`));
  assert.equal(existsSync(log), false);
});

test('update refuses another branch and leaves it alone', (t) => {
  const { checkout, log, publish, update } = cloned(t);
  git(checkout, 'switch', '-q', '-c', 'work');
  const head = git(checkout, 'rev-parse', 'HEAD');
  publish();

  const result = update();

  assert.equal(result.code, 1);
  assert.match(result.stderr, /on work, so switch to main/);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), head);
  assert.equal(existsSync(log), false);
});

test('update refuses uncommitted changes and keeps them', (t) => {
  const { checkout, log, publish, update } = cloned(t);
  writeFileSync(join(checkout, 'tracked'), 'edited');
  publish();

  const result = update();

  assert.equal(result.code, 1);
  assert.match(result.stderr, /uncommitted changes/);
  assert.equal(readFileSync(join(checkout, 'tracked'), 'utf8'), 'edited');
  assert.equal(existsSync(log), false);
});

test('untracked files do not block an update', (t) => {
  const { checkout, publish, update } = cloned(t);
  writeFileSync(join(checkout, 'scratch'), 'mine');
  publish();
  assert.equal(update().code, 0);
  assert.equal(readFileSync(join(checkout, 'scratch'), 'utf8'), 'mine');
});

test('update refuses a checkout with commits of its own', (t) => {
  const { checkout, log, publish, update } = cloned(t);
  git(checkout, 'commit', '-q', '--allow-empty', '-m', 'local');
  publish();

  const result = update();

  assert.equal(result.code, 1);
  assert.match(result.stderr, /could not pull/);
  assert.equal(existsSync(log), false);
});

test('a failed install exits 1 and names the new commit', (t) => {
  const { publish, update, failInstalls } = cloned(t);
  failInstalls(true);
  const commit = publish();
  const result = update();
  assert.equal(result.code, 1);
  assert.match(result.stderr, new RegExp(`updated to ${commit}, but the install reported problems`));
});

test('update retries after a failed install', (t) => {
  const { checkout, log, publish, update, failInstalls } = cloned(t);
  failInstalls(true);
  publish();
  assert.equal(update().code, 1);
  rmSync(log);
  failInstalls(false);

  const result = update('--json');

  assert.equal(result.code, 0, result.stderr);
  const commit = git(checkout, 'rev-parse', '--short', 'HEAD');
  assert.deepEqual(JSON.parse(result.stdout), { updated: true, from: commit, commit, installed: true });
  assert.equal(readFileSync(log, 'utf8').trim(), '--force');
});

test('update installs after a manual pull', (t) => {
  const { checkout, log, publish, update } = cloned(t);
  publish();
  git(checkout, 'pull', '-q', '--ff-only', 'origin', 'main');

  const result = update();

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Installed/);
  assert.equal(readFileSync(log, 'utf8').trim(), '--force');
});

test('update with no recorded version installs', (t) => {
  const { log, update } = cloned(t, { installed: false });
  assert.equal(update().code, 0);
  assert.equal(readFileSync(log, 'utf8').trim(), '--force');
});

for (const folder of ['docs', 'core']) {
  test(`update pulls a change to ${folder} without installing`, (t) => {
    const { checkout, log, publish, update } = cloned(t);
    const before = git(checkout, 'rev-parse', '--short', 'HEAD');
    const commit = publish(folder);

    const result = update('--json');

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { updated: true, from: before, commit, installed: false });
    assert.equal(existsSync(log), false);
  });
}

test('a folder that is not a git checkout says so', (t) => {
  const box = sandbox(t);
  const result = box.hws(['update'], { HWS_CHECKOUT: box.folder('plain') });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not a git checkout/);
});
