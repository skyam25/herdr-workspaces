import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { sandbox } from './helpers.js';

const HWS = fileURLToPath(new URL('../../bin/hws', import.meta.url));
const FAKE_CLI = fileURLToPath(new URL('./fakes/fake-agent-brief.cjs', import.meta.url));

function cli(box, args, { input = '', env = {}, cwd } = {}) {
  const result = spawnSync(HWS, ['surface', 'cli', ...args], { input, cwd, encoding: 'utf8', env: { ...box.environment, HWS_SURFACE_CLI: FAKE_CLI, ...env } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Opens a glued surface and stands a file in for its socket, as a running host leaves one.
function openListening(t, box, args) {
  const surface = box.json(['surface', 'open', ...args]);
  writeFileSync(surface.socket, '');
  t.after(() => rmSync(surface.socket, { force: true }));
  return surface;
}

test('surface cli runs the verb on the terminal surface as its stand-in session', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const page = join(manifest.folder, 'proto.html');
  writeFileSync(page, '<p>x</p>');
  const surface = openListening(t, box, ['--type', 'page', '--file', page, '--in-pane', '--terminal', owner]);

  const shell = box.folder('shell');
  const result = cli(box, ['--', 'behavior', 'update', 'proto.html', '--json', '--help'], { input: '{"version":"missing"}', cwd: shell, env: { HC_TERMINAL_ID: owner, CLAUDE_CODE_SESSION_ID: 'real', HWS_SURFACE_CLI_CWD: '/elsewhere' } });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, 'fake agent-brief\n');
  assert.deepEqual(JSON.parse(result.stdout), {
    args: ['behavior', 'update', 'proto.html', '--json', '--help'],
    socket: surface.socket,
    session: `surface-${surface.id}`,
    cwd: shell,
    stdin: '{"version":"missing"}',
  });
});

test('surface cli passes the exit code through', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  openListening(t, box, ['--type', 'board', '--in-pane', '--terminal', owner]);
  assert.equal(cli(box, ['--terminal', owner, '--', 'status', 'exit', '3']).code, 3);
});

test('surface cli picks a surface by title or type', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const board = openListening(t, box, ['--type', 'board', '--in-pane', '--title', 'flow', '--terminal', owner]);
  const page = join(manifest.folder, 'plan.html');
  writeFileSync(page, '<p>x</p>');
  const review = openListening(t, box, ['--type', 'page', '--file', page, '--in-pane', '--terminal', owner]);

  const socketOf = (args) => JSON.parse(cli(box, ['--terminal', owner, ...args, '--', 'read']).stdout).socket;
  assert.equal(socketOf([]), review.socket);
  assert.equal(socketOf(['--type', 'board']), board.socket);
  assert.equal(socketOf(['--title', 'flow']), board.socket);
});

test('surface cli fails clearly with no open surface, no verb or a bad flag', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;

  const none = cli(box, ['--terminal', owner, '--', 'status']);
  assert.equal(none.code, 1);
  assert.match(none.stderr, /has no open surface/);

  // A recorded surface whose host left no socket is not open.
  box.json(['surface', 'open', '--type', 'board', '--in-pane', '--terminal', owner]);
  assert.match(cli(box, ['--terminal', owner, '--', 'status']).stderr, /has no open surface/);

  assert.equal(cli(box, ['--terminal', owner, '--']).code, 2);
  assert.equal(cli(box, ['--terminal', owner, 'status']).code, 2);
  assert.equal(cli(box, ['--type', 'sheet', '--terminal', owner, '--', 'status']).code, 2);
  assert.equal(cli(box, ['--', 'status']).code, 2);
});

test('surface cli fails clearly when the surface is not built', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  openListening(t, box, ['--type', 'board', '--in-pane', '--terminal', owner]);
  const result = cli(box, ['--terminal', owner, '--', 'status'], { env: { HWS_SURFACE_CLI: join(box.dir, 'missing.mjs') } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no surface CLI at .*Run install\.sh/);
});
