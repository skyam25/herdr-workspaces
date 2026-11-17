import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { sandbox } from './helpers.js';

const HWS = fileURLToPath(new URL('../../bin/hws', import.meta.url));

function outline(box, folder, args, env = {}) {
  const result = spawnSync(HWS, ['outline', 'new', ...args], { cwd: folder, encoding: 'utf8', env: { ...box.environment, ...env } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('outline new writes the outline beside its target, with the target relative to the workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  mkdirSync(join(manifest.folder, 'docs'));

  const result = outline(box, join(manifest.folder, 'docs'), ['Onboarding', 'memo', '--target', 'memo.md'], { HC_TERMINAL_ID: owner });
  assert.equal(result.code, 0, result.stderr);
  const file = join(manifest.folder, 'docs', 'memo.outline.md');
  assert.equal(result.stdout.split('\n')[0], file);
  assert.equal(readFileSync(file, 'utf8'), '# Onboarding memo\n\nTarget: docs/memo.md\nKind: document\n');

  const again = outline(box, join(manifest.folder, 'docs'), ['Onboarding memo', '--target', 'memo.md'], { HC_TERMINAL_ID: owner });
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already exists/);
});

test('outline new names a file from the title, or takes --path and --kind', (t) => {
  const box = sandbox(t);
  const folder = box.folder('loose');

  assert.equal(outline(box, folder, ['Café plan!']).code, 0);
  assert.equal(readFileSync(join(folder, 'cafe-plan.outline.md'), 'utf8'), '# Café plan!\n\nKind: document\n');

  const data = JSON.parse(outline(box, folder, ['Landing', '--path', 'web/landing.outline.md', '--target', 'web/index.html', '--kind', 'page', '--json']).stdout);
  assert.deepEqual(data, { path: join(folder, 'web', 'landing.outline.md'), title: 'Landing', target: 'index.html', kind: 'page', root: join(folder, 'web') });
  assert.equal(readFileSync(data.path, 'utf8'), '# Landing\n\nTarget: index.html\nKind: page\n');
});

test('outline new keeps the project out of dot folders, as the surface does', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const hidden = join(manifest.folder, '.herdr-workspace', 'artifacts');
  mkdirSync(hidden, { recursive: true });
  assert.equal(outline(box, hidden, ['Memo', '--target', 'memo.md'], { HC_TERMINAL_ID: owner }).code, 0);
  assert.equal(readFileSync(join(hidden, 'memo.outline.md'), 'utf8'), '# Memo\n\nTarget: memo.md\nKind: document\n');
});

test('outline new refuses a bad kind, path, title or target', (t) => {
  const box = sandbox(t);
  const folder = box.folder('loose');
  writeFileSync(join(folder, 'x'), '');
  assert.equal(outline(box, folder, []).code, 2);
  assert.equal(outline(box, folder, ['Memo', '--kind', 'deck']).code, 2);
  assert.equal(outline(box, folder, ['Memo', '--path', 'memo.md']).code, 2);
  const outside = outline(box, join(folder), ['Memo', '--path', 'docs/memo.outline.md', '--target', 'memo.md']);
  assert.equal(outside.code, 1);
  assert.match(outside.stderr, /--target must be inside/);
});
