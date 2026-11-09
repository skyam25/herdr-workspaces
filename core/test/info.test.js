import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { liveFixtures, sandbox } from './helpers.js';

const { space, tab, terminal } = liveFixtures;

test('current finds the manifest from the terminal flag or the environment', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const address = manifest.terminals[0].terminal;
  assert.equal(box.json(['current', '--terminal', address]).id, manifest.id);
  assert.equal(box.json(['current'], { HC_TERMINAL_ID: address }).id, manifest.id);
});

test('current finds a terminal hws did not create', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const live = box.state().spaces;
  live[0].tabs.push(tab('tb-user', [terminal('t900', 'p900')]));
  box.setState({ spaces: live });
  assert.equal(box.json(['current', '--terminal', 't900']).id, manifest.id);
});

test('current finds a sub-agent through its parent', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const live = box.state().spaces;
  live[0].tabs[0].terminals[0].sub_agents = [{ terminal: 't77' }];
  box.setState({ spaces: live });
  assert.equal(box.json(['current', '--terminal', 't77']).id, manifest.id);
});

test('current falls back to recorded terminals when the window is down', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.setState({ lsFails: true });
  assert.equal(box.json(['current', '--terminal', manifest.terminals[0].terminal]).id, manifest.id);
});

test('current --line prints one sentence inside a workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const result = box.hws(['current', '--line', '--terminal', manifest.terminals[0].terminal]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /app workspace "demo"/);
  assert.equal(result.stdout.trim().split('\n').length, 1);
});

test('current --line prints nothing outside a workspace', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])] });
  const inNormal = box.hws(['current', '--line', '--terminal', 't1']);
  assert.deepEqual([inNormal.code, inNormal.stdout], [0, '']);
  const noTerminal = box.hws(['current', '--line']);
  assert.deepEqual([noTerminal.code, noTerminal.stdout], [0, '']);
});

test('current fails outside a workspace and needs a terminal', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])] });
  assert.equal(box.hws(['current', '--terminal', 't1']).code, 1);
  assert.equal(box.hws(['current']).code, 2);
});

test('list returns every manifest but not the standalone store', (t) => {
  const box = sandbox(t);
  const first = box.app('one');
  const second = box.app('two');
  box.setState({ spaces: [...box.state().spaces, space('sp9', [tab('tb9', [terminal('t9', 'p9')])])], selected: 'sp9' });
  box.json(['surface', 'open', '--type', 'board', '--in-pane', '--standalone']);
  assert.deepEqual(box.json(['list']).map((item) => item.id).sort(), [first.id, second.id].sort());
});

test('register records the session and role', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const address = manifest.terminals[0].terminal;
  const result = box.json(['register', '--terminal', address, '--session', 'uuid-1', '--role', 'planner']);
  assert.deepEqual(result, { registered: true, workspace: manifest.id, terminal: address, session: 'uuid-1' });
  const record = box.manifest(manifest.id).terminals[0];
  assert.deepEqual([record.sessionId, record.role], ['uuid-1', 'planner']);
});

test('register keeps the role when none is given and adds new terminals', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const address = manifest.terminals[0].terminal;
  box.json(['register', '--terminal', address, '--session', 'one', '--role', 'planner']);
  box.json(['register', '--terminal', address, '--session', 'two']);
  assert.equal(box.manifest(manifest.id).terminals[0].role, 'planner');
  assert.equal(box.manifest(manifest.id).terminals[0].sessionId, 'two');

  const live = box.state().spaces;
  live[0].tabs[0].terminals.push(terminal('t500', 'p500'));
  box.setState({ spaces: live });
  box.json(['register', '--terminal', 't500', '--session', 'three']);
  const added = box.manifest(manifest.id).terminals.find((item) => item.terminal === 't500');
  assert.deepEqual(added, { terminal: 't500', tabId: live[0].tabs[0].id, sessionId: 'three', role: null });
});

test('register in a normal terminal succeeds and records nothing', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [terminal('t1', 'p1')])])] });
  assert.deepEqual(box.json(['register', '--terminal', 't1', '--session', 's']), { registered: false });
});

test('register needs a terminal and a session', (t) => {
  const box = sandbox(t);
  assert.equal(box.hws(['register', '--session', 's']).code, 2);
  assert.equal(box.hws(['register', '--terminal', 't1']).code, 2);
});

test('register records the session of a terminal outside any workspace', (t) => {
  const box = sandbox(t);
  const result = box.json(['register', '--terminal', 't-plain', '--session', 'uuid-2']);
  assert.equal(result.registered, false);
  const path = join(box.root, 'terminal-sessions', 't-plain.json');
  assert.equal(existsSync(path), true);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).id, 'uuid-2');
});
