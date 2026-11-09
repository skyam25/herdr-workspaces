import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';

import { sessionOfTerminal } from '../agent-session.js';
import { sandbox } from './helpers.js';

const OPENED = 1_000;
const TERMINAL = 't1';
const HAS_SQLITE = spawnSync('sqlite3', ['-version']).status === 0;
const needsSqlite = { skip: HAS_SQLITE ? false : 'sqlite3 is not installed' };

// sessionOfTerminal reads the environment, so each test points it at its own sandbox.
function world(t, foreground) {
  const box = sandbox(t);
  const codexHome = box.folder('codex');
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
  });
  Object.assign(process.env, box.environment, { CODEX_HOME: codexHome });
  box.setState({ hc: { [TERMINAL]: { created_ms: OPENED, foreground } } });
  return { box, database: join(codexHome, 'state_5.sqlite') };
}

const quote = (text) => `'${text.replaceAll("'", "''")}'`;

function threads(database, rows) {
  const inserts = rows.map(([id, cwd, originator, at]) => `insert into threads values (${quote(id)}, ${quote(cwd)}, ${quote(originator)}, ${at});`);
  const sql = `create table threads (id text, cwd text, originator text, created_at_ms integer);${inserts.join('')}`;
  assert.equal(spawnSync('sqlite3', [database, sql]).status, 0);
}

const codexIn = (cwd) => ({ cwd, argv: ['codex'] });

test('a claude terminal names the session its hook registered', (t) => {
  const { box } = world(t, null);
  const manifest = box.app();
  const terminal = manifest.terminals[0].terminal;
  box.json(['register', '--terminal', terminal, '--session', 'claude-1']);
  box.setState({ hc: { [terminal]: { foreground: { cwd: '/w', argv: ['/opt/bin/claude'] } } } });

  assert.deepEqual(sessionOfTerminal(terminal), { tool: 'claude', id: 'claude-1', folder: '/w' });
});

test('a claude terminal with no registered session names nothing', (t) => {
  world(t, { cwd: '/w', argv: ['claude'] });

  assert.equal(sessionOfTerminal(TERMINAL), null);
});

test('a terminal with no working folder names nothing', (t) => {
  world(t, { argv: ['claude'] });

  assert.equal(sessionOfTerminal(TERMINAL), null);
});

test('a terminal running another program names nothing', (t) => {
  world(t, { cwd: '/w', argv: ['vim'] });

  assert.equal(sessionOfTerminal(TERMINAL), null);
});

test('a codex terminal finds the one thread started in its folder since it opened', needsSqlite, (t) => {
  const { database } = world(t, codexIn('/w'));
  threads(database, [
    ['wanted', '/w', 'codex-tui', OPENED],
    ['too-old', '/w', 'codex-tui', OPENED - 1],
    ['elsewhere', '/other', 'codex-tui', OPENED + 5],
    ['headless', '/w', 'codex-exec', OPENED + 5],
  ]);

  assert.deepEqual(sessionOfTerminal(TERMINAL), { tool: 'codex', id: 'wanted', folder: '/w' });
});

test('a codex terminal names nothing when two threads could be its own', needsSqlite, (t) => {
  const { database } = world(t, codexIn('/w'));
  threads(database, [
    ['first', '/w', 'codex-tui', OPENED + 1],
    ['second', '/w', 'codex-tui', OPENED + 2],
  ]);

  assert.equal(sessionOfTerminal(TERMINAL), null);
});

test('a codex folder with a quote in its name still matches', needsSqlite, (t) => {
  const folder = "/w/bob's app";
  const { database } = world(t, codexIn(folder));
  threads(database, [['quoted', folder, 'codex-tui', OPENED]]);

  assert.deepEqual(sessionOfTerminal(TERMINAL), { tool: 'codex', id: 'quoted', folder });
});

test('a codex terminal names nothing when the database is missing', needsSqlite, (t) => {
  world(t, codexIn('/w'));

  assert.equal(sessionOfTerminal(TERMINAL), null);
});
