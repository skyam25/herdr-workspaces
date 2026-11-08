import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sandbox } from './helpers.js';

test('unknown commands and flags exit 2', (t) => {
  const box = sandbox(t);
  assert.equal(box.hws(['bogus']).code, 2);
  assert.equal(box.hws(['list', '--nope']).code, 2);
  assert.equal(box.hws([]).code, 2);
});

test('--json works in any position', (t) => {
  const box = sandbox(t);
  const result = box.hws(['--json', 'list']);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), []);
});

test('failures print the message on stderr, or JSON under --json', (t) => {
  const box = sandbox(t);
  const plain = box.hws(['link', 'nope']);
  assert.deepEqual([plain.code, plain.stdout, plain.stderr], [1, '', 'no artifact nope\n']);
  const json = box.hws(['link', 'nope', '--json']);
  assert.deepEqual([json.code, JSON.parse(json.stdout)], [1, { error: 'no artifact nope' }]);
});

test('help exits 0 and lists commands', (t) => {
  const box = sandbox(t);
  const result = box.hws(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /surface done/);
});
