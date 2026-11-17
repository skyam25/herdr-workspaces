import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { sandbox } from './helpers.js';

const HWS = fileURLToPath(new URL('../../bin/hws', import.meta.url));

// Runs `hws output touch` from a folder, as the plugin's write hook does.
function touch(box, folder, args, env = { CLAUDE_CODE_SESSION_ID: 's1' }) {
  const result = spawnSync(HWS, ['output', 'touch', ...args], { cwd: folder, encoding: 'utf8', env: { ...box.environment, CLAUDE_CODE_SESSION_ID: '', ...env } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const outputsFile = (folder) => join(folder, '.feedback', 'outputs', 's1.json');
const recordsOf = (folder) => JSON.parse(readFileSync(outputsFile(folder), 'utf8')).outputs;

test('output touch records a document as detected, silently, and counts later writes', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  mkdirSync(join(folder, 'docs'));

  const first = touch(box, folder, ['--path', join(folder, 'docs', 'plan.md'), '--origin', 'created']);
  assert.deepEqual(first, { code: 0, stdout: '', stderr: '' });
  const [made] = recordsOf(folder);
  assert.deepEqual(made, { ref: 'docs/plan.md', kind: 'markdown', tier: 'detected', origin: 'created', firstWriteAt: made.firstWriteAt, lastWriteAt: made.firstWriteAt, writes: 1 });
  assert.equal(readFileSync(join(folder, '.feedback', '.gitignore'), 'utf8'), '*\n');

  // A later write keeps the first origin, and created on a later write changes nothing.
  assert.equal(touch(box, folder, ['--path', 'docs/plan.md']).code, 0);
  assert.equal(touch(box, folder, ['--path', 'docs/plan.md', '--origin', 'created']).code, 0);
  const [after] = recordsOf(folder);
  assert.equal(after.writes, 3);
  assert.equal(after.origin, 'created');
  assert.equal(after.firstWriteAt, made.firstWriteAt);
  assert.ok(after.lastWriteAt >= made.lastWriteAt);

  // An edit first keeps edited when a later write says created.
  touch(box, folder, ['--path', 'page.HTML']);
  touch(box, folder, ['--path', 'page.HTML', '--origin', 'created']);
  assert.deepEqual(recordsOf(folder).map((o) => [o.ref, o.kind, o.origin, o.writes]), [['docs/plan.md', 'markdown', 'created', 3], ['page.HTML', 'html', 'edited', 2]]);

  box.json(['register', '--terminal', 't1', '--session', 's1', '--folder', folder]);
  const [agent] = box.json(['outputs', '--terminals', 't1']).agents;
  assert.deepEqual(agent.outputs.map((o) => o.ref), ['docs/plan.md', 'page.HTML']);
});

test('output touch skips code, skipped folders and files outside the session folder', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  const skipped = ['src/app.js', 'notebook.ipynb', 'README', '.feedback/notes.md', '.claude/skills/x/SKILL.md', 'node_modules/pkg/README.md', '../elsewhere.md', 'https://example.com/a.md', '.md'];
  for (const path of skipped) {
    const result = touch(box, folder, ['--path', path]);
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' }, path);
  }
  assert.equal(existsSync(join(folder, '.feedback')), false);

  // Every document kind counts, in any folder below the session folder that is not skipped.
  for (const path of ['a.markdown', 'b.mdx', 'c.htm', 'd.pdf', 'e.docx', 'f.pptx', 'g.xlsx', 'docs/.hidden/h.md']) touch(box, folder, ['--path', path]);
  assert.deepEqual(recordsOf(folder).map((o) => o.kind), ['markdown', 'markdown', 'html', 'pdf', 'docx', 'pptx', 'xlsx', 'markdown']);
});

test('a declared output stays declared and gains its write times', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  const declared = { ref: 'spec.md', kind: 'markdown', tier: 'declared', title: 'Spec', status: 'ready', declaredAt: 5, future: 'kept' };
  mkdirSync(join(folder, '.feedback', 'outputs'), { recursive: true });
  writeFileSync(outputsFile(folder), JSON.stringify({ version: 1, sessionId: 's1', outputs: [declared] }));

  touch(box, folder, ['--path', 'spec.md']);
  touch(box, folder, ['--path', 'spec.md', '--origin', 'created']);
  const [record] = recordsOf(folder);
  assert.deepEqual({ ...record, firstWriteAt: 0, lastWriteAt: 0 }, { ...declared, origin: 'edited', firstWriteAt: 0, lastWriteAt: 0, writes: 2 });

  // A later declaration keeps the write times.
  const add = spawnSync(HWS, ['output', 'add', '--title', 'Spec v2', '--path', 'spec.md'], { cwd: folder, encoding: 'utf8', env: { ...box.environment, CLAUDE_CODE_SESSION_ID: 's1' } });
  assert.equal(add.status, 0, add.stderr);
  const [again] = recordsOf(folder);
  assert.equal(again.title, 'Spec v2');
  assert.equal(again.writes, 2);
  assert.equal(again.firstWriteAt, record.firstWriteAt);
});

test('output touch writes to the registered session folder', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  mkdirSync(join(folder, 'sub'));
  box.json(['register', '--terminal', 't1', '--session', 's1', '--folder', folder]);

  assert.equal(touch(box, join(folder, 'sub'), ['--path', 'notes.md'], { HC_TERMINAL_ID: 't1' }).code, 0);
  assert.deepEqual(recordsOf(folder).map((o) => o.ref), ['sub/notes.md']);
});

test('output touch fails only for real errors', (t) => {
  const box = sandbox(t);
  const folder = box.folder('w');
  assert.equal(touch(box, folder, ['--path', 'a.md'], {}).code, 2);
  assert.equal(touch(box, folder, []).code, 2);
  assert.equal(touch(box, folder, ['--path', 'a.md', '--origin', 'moved']).code, 2);

  const broken = '{"version": 1, "outputs": [';
  mkdirSync(join(folder, '.feedback', 'outputs'), { recursive: true });
  writeFileSync(outputsFile(folder), broken);
  const result = touch(box, folder, ['--path', 'a.md']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /leaves it alone/);
  assert.equal(readFileSync(outputsFile(folder), 'utf8'), broken);
});

test('output touch stays out of hws help', (t) => {
  const box = sandbox(t);
  const run = (args) => spawnSync(HWS, args, { encoding: 'utf8', env: box.environment }).stdout;
  assert.doesNotMatch(run(['--help']), /touch/);
  assert.doesNotMatch(run(['output', '--help']), /touch/);
  assert.match(run(['output', 'touch', '--help']), /hws output touch --path X --origin X/);
});
