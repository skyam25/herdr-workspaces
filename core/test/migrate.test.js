import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { matchLine } from '../instruction-scan.js';
import { sandbox } from './helpers.js';

const FAKE_CLAUDE = fileURLToPath(new URL('./fakes/fake-claude.cjs', import.meta.url));
const RUNNING = '/Applications/Agent Brief.app/Contents/MacOS/Agent Brief --no-sandbox\n';
const SCENE = JSON.stringify({ type: 'excalidraw', elements: [{ id: 'r1', type: 'rectangle' }], appState: {} });

function write(path, content = 'x') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const json = (value) => JSON.stringify(value, null, 2);

// Lays out every part of Agent Brief under the fake home and Applications folder.
function dirty(box) {
  const home = box.homeDir;
  const claude = join(home, '.claude');
  const app = join(box.dir, 'Applications/Agent Brief.app');
  const data = join(home, 'Library/Application Support/Agent Brief');
  write(join(claude, 'settings.json'), json({ enabledPlugins: { 'agent-brief@agent-brief': true } }));
  write(join(claude, 'plugins/installed_plugins.json'), json({ version: 2, plugins: { 'agent-brief@agent-brief': [{ scope: 'user' }] } }));
  write(join(claude, 'plugins/known_marketplaces.json'), json({ 'agent-brief': { source: {} } }));
  write(join(claude, 'plugins/cache/agent-brief/agent-brief/1.0.0/CLAUDE.md'), 'Agent Brief declare_output\n');
  write(join(app, 'Contents/MacOS/Agent Brief'));
  write(join(app, 'Contents/Resources/bin/agent-brief'));
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  symlinkSync(join(app, 'Contents/Resources/bin/agent-brief'), join(home, '.local/bin/agent-brief'));
  write(join(data, 'boards/login-flow.excalidraw'), SCENE);
  write(join(data, 'boards/login-flow.comments.json'), '[{"id":"c1","text":"tighten"}]');
  write(join(data, 'boards/login-flow.notes.md'), 'Remember the error state\n');
  write(join(data, 'boards/broken.excalidraw'), '{"type":"excalidraw"}');
  write(join(data, 'drafts/d1.json'), json({ id: 'd1', title: 'Launch plan', body: 'Ship on Friday\n\n![shot](att:p1)', attachments: { p1: 'data:image/png;base64,AAAA' }, createdAt: 1000, updatedAt: 2000, status: 'draft', rank: 0 }));
  write(join(data, 'drafts/d2.json'), json({ id: 'd2', body: '  \n', createdAt: 1, updatedAt: 1, status: 'draft', rank: 1 }));
  write(join(data, 'drafts/d3.json'), json({ id: 'd3', body: '## Retro notes\n- went well', createdAt: 3000, updatedAt: 3000, status: 'draft', rank: 2 }));
  write(join(home, 'Library/Preferences/com.agentbrief.app.plist'));
  write(join(home, 'Library/Caches/com.agentbrief.app/Cache.db'));
  write(join(home, 'Downloads/feedback-inbox/round.md'));
  write(
    join(claude, 'CLAUDE.md'),
    [
      '# Mine',
      'Use declare_output for deliverables.',
      'Sketch with `agent-brief draw` on the board.',
      'Notes live in agent-brief.md and docs/agent-brief.md.',
      'Show it with agent-brief open --note ID.',
      'Call mcp__agent-brief__ask_questions when unsure.',
      'agent brief, Agent brief and agent-brief drawing are not references.',
    ].join('\n'),
  );
  write(join(claude, 'skills/old/SKILL.md'), 'Run agent-brief outline first.\n');
  return { home, claude, app, data };
}

function project(box) {
  const folder = box.folder('project');
  write(join(folder, 'CLAUDE.md'), 'Ask with Agent Brief.\n');
  write(join(folder, 'AGENTS.md'), 'Hand off with agent-brief handoff.\n');
  write(join(folder, '.claude/commands/pic.md'), 'Use show_image for screenshots.\n');
  write(join(folder, '.claude/node_modules/pkg/README.md'), 'Agent Brief\n');
  write(join(folder, 'README.md'), 'Agent Brief\n');
  return folder;
}

const migrate = (box, args = [], env = {}) => box.hws(['migrate', 'agent-brief', ...args], { HWS_CLAUDE: FAKE_CLAUDE, ...env });
const report = (box, args = [], env = {}) => JSON.parse(migrate(box, [...args, '--json'], env).stdout);
const part = (data, name) => data.agentBrief.find((item) => item.name === name);
const trashed = (box) => (existsSync(box.trashDir) ? readdirSync(box.trashDir) : []);

test('the scanner matches real references and skips file names', () => {
  const terms = (line) => matchLine(line).map(({ term }) => term);
  assert.deepEqual(terms('see agent-brief.md and ~/agent-brief.md'), []);
  assert.deepEqual(terms('agent brief, Agent brief, agent-brief drawing'), []);
  assert.deepEqual(terms('run agent-brief draw then agent-brief png'), ['agent-brief draw', 'agent-brief png']);
  assert.deepEqual(terms('mcp__agent-brief__declare_output'), ['declare_output']);
  assert.deepEqual(terms('mcp__agent-brief__list_sessions'), ['mcp__agent-brief__list_sessions']);
  assert.deepEqual(terms('enable agent-brief@agent-brief in Agent Brief'), ['agent-brief@agent-brief', 'Agent Brief']);
  assert.match(matchLine('agent-brief open --output page.html')[0].replacement, /hws review FILE/);
  assert.match(matchLine('agent-brief open --note n1')[0].replacement, /--type note --file F/);
  assert.match(matchLine('agent-brief feedback list')[0].replacement, /--type page -- feedback/);
  assert.match(matchLine('agent-brief initiative show')[0].replacement, /herdr-workspaces:tidy/);
  assert.match(matchLine('agent-brief handoff --board x')[0].replacement, /delete the line/);
});

test('a clean Mac reports nothing to do', (t) => {
  const box = sandbox(t);
  const result = migrate(box);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Agent Brief is gone from this Mac/);
  const data = report(box);
  assert.ok(data.agentBrief.every((item) => !item.present));
  assert.deepEqual(data.instructions, []);
  assert.deepEqual(data.actions, []);
});

test('the report lists each part and stale line and changes nothing', (t) => {
  const box = sandbox(t);
  const { claude, app, data: dataDir } = dirty(box);
  const folder = project(box);
  const data = report(box, ['--scan', folder]);

  for (const name of ['Plugin enabled', 'Plugin installed', 'Plugin marketplace', 'Plugin cache', 'CLI link', 'App', 'Data', 'Preferences', 'Feedback inbox']) {
    assert.equal(part(data, name).present, true, name);
  }
  assert.equal(part(data, 'Old data').present, false);
  assert.equal(part(data, 'App').running, false);
  assert.deepEqual([part(data, 'Data').boards, part(data, 'Data').drafts], [2, 3]);

  const found = data.instructions.map(({ file, line, term }) => `${file.replace(box.dir, '')}:${line} ${term}`);
  assert.deepEqual(found, [
    '/home/.claude/CLAUDE.md:2 declare_output',
    '/home/.claude/CLAUDE.md:3 agent-brief draw',
    '/home/.claude/CLAUDE.md:5 agent-brief open',
    '/home/.claude/CLAUDE.md:6 ask_questions',
    '/home/.claude/settings.json:3 agent-brief@agent-brief',
    '/home/.claude/skills/old/SKILL.md:1 agent-brief outline',
    '/project/CLAUDE.md:1 Agent Brief',
    '/project/AGENTS.md:1 agent-brief handoff',
    '/project/.claude/commands/pic.md:1 show_image',
  ]);

  const text = migrate(box, ['--scan', folder]).stdout;
  assert.match(text, /~\/\.claude\/CLAUDE\.md:2 {2}declare_output -> `hws output add`/);
  assert.match(text, /Moving off Agent Brief/);
  assert.match(text, /--import --apply/);
  assert.deepEqual(box.calls().filter(({ args }) => args[0] !== '--version'), []);
  assert.ok(existsSync(app) && existsSync(dataDir) && existsSync(join(claude, 'plugins/cache/agent-brief')));
});

test('apply refuses while the app keeps running and changes nothing', (t) => {
  const box = sandbox(t);
  const { app } = dirty(box);
  writeFileSync(box.environment.FAKE_PS_FILE, RUNNING);
  const result = migrate(box, ['--apply'], { HWS_QUIT_WAIT_MS: '300' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /still running, so nothing changed/);
  const calls = box.calls();
  assert.deepEqual(calls.map(({ bin }) => bin), ['osascript']);
  assert.match(calls[0].args.join(' '), /tell application "Agent Brief" to quit/);
  assert.ok(existsSync(app));
  assert.ok(lstatSync(join(box.homeDir, '.local/bin/agent-brief')).isSymbolicLink());
  assert.deepEqual(trashed(box), []);
});

test('apply asks the app to quit, uninstalls the plugin and moves the rest to the Trash', (t) => {
  const box = sandbox(t);
  const { claude, app, data: dataDir } = dirty(box);
  writeFileSync(box.environment.FAKE_PS_FILE, RUNNING);
  const quits = join(box.dir, 'quits.sh');
  writeFileSync(quits, '#!/bin/sh\nrm -f "$FAKE_PS_FILE"\n', { mode: 0o755 });

  const result = migrate(box, ['--apply'], { HWS_OSASCRIPT: quits });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    box.calls().filter(({ bin }) => bin === 'claude').map(({ args }) => args.join(' ')),
    ['plugin uninstall agent-brief@agent-brief', 'plugin marketplace remove agent-brief'],
  );
  assert.equal(existsSync(join(box.homeDir, '.local/bin/agent-brief')), false);
  for (const path of [app, dataDir, join(claude, 'plugins/cache/agent-brief'), join(box.homeDir, 'Downloads/feedback-inbox')]) assert.equal(existsSync(path), false, path);
  assert.deepEqual(trashed(box).sort(), ['0-Agent Brief.app', '1-Agent Brief', '2-com.agentbrief.app.plist', '3-com.agentbrief.app', '4-agent-brief', '5-feedback-inbox'].sort());
  assert.match(result.stdout, /with 2 boards and 3 drafts\. --import would have kept them as Unfiled work/);
  assert.match(result.stdout, /removed the link ~\/\.local\/bin\/agent-brief/);
});

test('apply reports a failed uninstall and keeps going, and keeps a link that is not Agent Brief', (t) => {
  const box = sandbox(t);
  dirty(box);
  const link = join(box.homeDir, '.local/bin/agent-brief');
  const own = join(box.dir, 'mine/brief-tool');
  write(own);
  unlinkSync(link);
  symlinkSync(own, link);

  const result = migrate(box, ['--apply'], { FAKE_CLAUDE_FAIL: 'uninstall' });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /claude plugin uninstall agent-brief@agent-brief failed: uninstall failed/);
  assert.match(result.stdout, /ran claude plugin marketplace remove agent-brief/);
  assert.match(result.stdout, /kept ~\/\.local\/bin\/agent-brief, because it is not a link into Agent Brief/);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.match(result.stdout, /moved .*Agent Brief\.app to the Trash/);
});

test('import files boards with their comments and notes, and drafts, as Unfiled work', (t) => {
  const box = sandbox(t);
  const { data: dataDir } = dirty(box);
  const data = report(box, ['--import']);

  assert.deepEqual(data.imported.map(({ kind, name }) => `${kind} ${name}`), ['board login-flow', 'draft Launch plan', 'draft Retro notes']);
  assert.deepEqual(data.skipped.map(({ kind, name, reason }) => `${kind} ${name}: ${reason}`), ['board broken: the file is not an Excalidraw scene', 'draft d2: empty']);
  assert.ok(existsSync(dataDir), 'import alone trashes nothing');

  const unfiled = box.json(['unfiled']).artifacts;
  const board = unfiled.find((item) => item.type === 'board');
  assert.equal(board.title, 'login-flow');
  assert.deepEqual(readdirSync(board.path).sort(), ['board.excalidraw', 'comments.json', 'notes.md', 'prompt.md']);
  assert.equal(readFileSync(join(board.path, 'board.excalidraw'), 'utf8'), SCENE);
  assert.equal(readFileSync(join(board.path, 'notes.md'), 'utf8'), 'Remember the error state\n');

  const record = box.manifest('standalone').artifacts.find((item) => item.id === board.id);
  assert.equal(record.importedFrom, join(dataDir, 'boards/login-flow.excalidraw'));
  box.json(['surface', 'open', '--type', 'board', '--artifact', board.id, '--standalone']);
  assert.equal(box.manifest('standalone').surfaces[0].reopens, board.id);

  const plan = unfiled.find((item) => item.title === 'Launch plan');
  assert.equal(readFileSync(plan.path, 'utf8'), '# Launch plan\n\nShip on Friday\n\n![shot](data:image/png;base64,AAAA)\n');
  const retro = unfiled.find((item) => item.title === 'Retro notes');
  assert.equal(readFileSync(retro.path, 'utf8'), '## Retro notes\n- went well\n');
  assert.equal(record.type, 'board');
  assert.equal(box.manifest('standalone').artifacts.find((item) => item.id === plan.id).type, 'file');
});

test('a second import skips what the first imported', (t) => {
  const box = sandbox(t);
  dirty(box);
  const first = report(box, ['--import']);
  const second = report(box, ['--import']);
  assert.deepEqual(second.imported, []);
  const ids = first.imported.map(({ artifact }) => artifact);
  assert.deepEqual(second.skipped.filter(({ reason }) => reason.startsWith('already imported')).map(({ reason }) => reason.split(' ').at(-1)), ids);
  assert.equal(box.manifest('standalone').artifacts.length, 3);
});

test('import then apply says the data went to the Trash after its import', (t) => {
  const box = sandbox(t);
  dirty(box);
  const result = migrate(box, ['--import', '--apply']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /imported board login-flow as a\w+, Unfiled/);
  assert.match(result.stdout, /Agent Brief to the Trash, with 2 boards and 3 drafts already imported/);
  assert.equal(box.json(['unfiled']).artifacts.length, 3);
});
