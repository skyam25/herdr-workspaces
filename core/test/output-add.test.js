import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { sandbox } from './helpers.js';

const HWS = fileURLToPath(new URL('../../bin/hws', import.meta.url));

// Runs hws from a folder, as an agent's shell does.
function add(box, folder, args, env = {}) {
  const result = spawnSync(HWS, ['output', 'add', ...args, '--json'], { cwd: folder, encoding: 'utf8', env: { ...box.environment, CLAUDE_CODE_SESSION_ID: '', ...env } });
  return { code: result.status, data: result.status === 0 ? JSON.parse(result.stdout) : null, stdout: result.stdout, stderr: result.stderr };
}

const fileOf = (folder, session) => JSON.parse(readFileSync(join(folder, '.feedback', 'outputs', `${session}.json`), 'utf8'));

test('output add declares a file in the registered session folder, where hws outputs reads it', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  mkdirSync(join(folder, 'docs'));
  box.json(['register', '--terminal', 't1', '--session', 's1', '--folder', folder]);

  const result = add(box, join(folder, 'docs'), ['--title', 'Plan', '--path', 'plan.md'], { HC_TERMINAL_ID: 't1' });
  assert.equal(result.code, 0, result.stderr);
  const { declaredAt } = result.data.output;
  assert.deepEqual(result.data.output, { ref: 'docs/plan.md', title: 'Plan', kind: 'markdown', status: 'drafting', tier: 'declared', declaredAt });
  assert.equal(result.data.file, join(folder, '.feedback', 'outputs', 's1.json'));
  assert.deepEqual(fileOf(folder, 's1'), { version: 1, sessionId: 's1', outputs: [result.data.output] });
  assert.equal(readFileSync(join(folder, '.feedback', '.gitignore'), 'utf8'), '*\n');

  const [agent] = box.json(['outputs', '--terminals', 't1']).agents;
  assert.deepEqual(agent.outputs, [result.data.output]);
});

test('a second add with the same ref changes title and status in place and keeps other records', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  const detected = { ref: 'notes.md', kind: 'markdown', tier: 'detected', origin: 'created', writes: 2, future: 'kept' };
  mkdirSync(join(folder, '.feedback', 'outputs'), { recursive: true });
  writeFileSync(join(folder, '.feedback', 'outputs', 's1.json'), JSON.stringify({ version: 1, sessionId: 's1', outputs: [detected, { ref: 'page.html', kind: 'html', tier: 'detected', writes: 1 }] }));
  writeFileSync(join(folder, '.feedback', '.gitignore'), 'mine\n');

  const env = { CLAUDE_CODE_SESSION_ID: 's1' };
  add(box, folder, ['--title', 'Page', '--path', 'page.html'], env);
  const second = add(box, folder, ['--title', 'Final page', '--path', join(folder, 'page.html'), '--status', 'ready'], env);
  assert.equal(second.code, 0, second.stderr);

  const { outputs } = fileOf(folder, 's1');
  assert.deepEqual(outputs[0], detected);
  assert.equal(outputs.length, 2);
  assert.deepEqual({ ...outputs[1], declaredAt: 0 }, { ref: 'page.html', kind: 'html', tier: 'declared', writes: 1, title: 'Final page', status: 'ready', declaredAt: 0 });
  assert.equal(readFileSync(join(folder, '.feedback', '.gitignore'), 'utf8'), 'mine\n');

  const plain = spawnSync(HWS, ['output', 'add', '--title', 'Final page', '--path', 'page.html'], { cwd: folder, encoding: 'utf8', env: { ...box.environment, ...env } });
  assert.equal(plain.stdout, `Declared "Final page" (page.html, drafting). It shows in Outputs.\nWhen the person asks to review it, run: hws review "${join(folder, 'page.html')}"\n`);
});

test('output add declares a link, with the shell folder when no session is registered', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  const result = add(box, folder, ['--title', 'Deck', '--url', 'https://claude.ai/a/1'], { CLAUDE_CODE_SESSION_ID: 's2' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.data.folder, folder);
  assert.deepEqual({ ...result.data.output, declaredAt: 0 }, { ref: 'https://claude.ai/a/1', url: 'https://claude.ai/a/1', title: 'Deck', kind: 'artifact', status: 'drafting', tier: 'declared', declaredAt: 0 });
});

test('output add refuses what Agent Brief refuses', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  const env = { CLAUDE_CODE_SESSION_ID: 's1' };
  assert.equal(add(box, folder, ['--title', 'X', '--path', 'a.md']).code, 2);
  assert.equal(add(box, folder, ['--title', 'X'], env).code, 2);
  assert.equal(add(box, folder, ['--title', 'X', '--path', 'a.md', '--url', 'https://x'], env).code, 2);
  assert.equal(add(box, folder, ['--title', 'X', '--url', 'ftp://x'], env).code, 2);
  assert.equal(add(box, folder, ['--title', 'X', '--path', 'a.md', '--status', 'done'], env).code, 2);
  assert.equal(add(box, folder, ['--title', ' ', '--path', 'a.md'], env).code, 2);
  const outside = add(box, folder, ['--title', 'X', '--path', '../elsewhere.md'], env);
  assert.equal(outside.code, 1);
  assert.match(outside.stdout, /outside the session folder/);
  assert.equal(add(box, folder, ['--title', 'X', '--path', 'a.md'], { CLAUDE_CODE_SESSION_ID: '../x' }).code, 1);
});
