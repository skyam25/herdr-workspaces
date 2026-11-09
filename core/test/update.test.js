import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { sandbox } from './helpers.js';

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// A clone of a bare repo, with an install.sh that records its arguments and exits with $exit.
function cloned(t, { exit = 0 } = {}) {
  const box = sandbox(t);
  const origin = join(box.dir, 'origin.git');
  const seed = join(box.dir, 'seed');
  const checkout = join(box.dir, 'checkout');
  const log = join(box.dir, 'installed');
  git(box.dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(box.dir, 'clone', '-q', origin, seed);
  git(seed, 'switch', '-q', '-c', 'main');
  writeFileSync(join(seed, 'install.sh'), `echo "$*" >> "${log}"\necho installing\nexit ${exit}\n`);
  writeFileSync(join(seed, 'tracked'), 'one');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'first');
  git(seed, 'push', '-q', 'origin', 'main');
  git(box.dir, 'clone', '-q', origin, checkout);
  const publish = () => {
    git(seed, 'commit', '-q', '--allow-empty', '-m', 'second');
    git(seed, 'push', '-q', 'origin', 'main');
    return git(seed, 'rev-parse', '--short', 'HEAD');
  };
  const update = (...flags) => box.hws(['update', ...flags], { HWS_CHECKOUT: checkout });
  return { checkout, log, publish, update };
}

test('update pulls main and reinstalls with --force', (t) => {
  const { checkout, log, publish, update } = cloned(t);
  const before = git(checkout, 'rev-parse', '--short', 'HEAD');
  const commit = publish();

  const result = update('--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { updated: true, from: before, commit });
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
  const { publish, update } = cloned(t, { exit: 1 });
  const commit = publish();
  const result = update();
  assert.equal(result.code, 1);
  assert.match(result.stderr, new RegExp(`updated to ${commit}, but the install reported problems`));
});

test('a folder that is not a git checkout says so', (t) => {
  const box = sandbox(t);
  const result = box.hws(['update'], { HWS_CHECKOUT: box.folder('plain') });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not a git checkout/);
});
