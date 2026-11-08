import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { liveFixtures, sandbox } from './helpers.js';

const { tab, terminal } = liveFixtures;

test('concurrent writes to one manifest all land', async (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const count = 24;
  const addresses = Array.from({ length: count }, (_, index) => `t${1000 + index}`);
  const live = box.state().spaces;
  live[0].tabs.push(tab('tb-many', addresses.map((address) => terminal(address, `p-${address}`))));
  box.setState({ spaces: live });

  const results = await Promise.all(
    addresses.map((address) => box.hwsAsync(['register', '--terminal', address, '--session', `s-${address}`, '--json'])),
  );

  assert.deepEqual(results.map((result) => result.code), Array(count).fill(0));
  const recorded = box.manifest(manifest.id).terminals.filter((item) => item.sessionId?.startsWith('s-t'));
  assert.equal(recorded.length, count);
  assert.deepEqual(readdirSync(join(box.root, 'workspaces', manifest.id)).filter((name) => name.endsWith('.tmp')), []);
  assert.deepEqual(readdirSync(join(box.root, 'locks')), []);
});

test('a stale lock from a crashed process is cleared', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const lock = join(box.root, 'locks', `${manifest.id}.lock`);
  mkdirSync(lock, { recursive: true });
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  const result = box.json(['register', '--terminal', manifest.terminals[0].terminal, '--session', 'after-crash']);
  assert.equal(result.registered, true);
});
