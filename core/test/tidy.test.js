import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { sandbox } from './helpers.js';

const HOUR = 3600_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ARGV = '["claude","--model","opus","--effort","high"]';

function git(folder, ...args) {
  const result = spawnSync('git', ['-C', folder, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(folder, subject) {
  writeFileSync(join(folder, 'log.txt'), `${subject}\n`, { flag: 'a' });
  git(folder, 'add', 'log.txt');
  git(folder, 'commit', '-q', '-m', subject);
  return git(folder, 'rev-parse', 'HEAD');
}

function status(box, manifest) {
  return box.json(['tidy', 'status', '--workspace', manifest.id]);
}

function line(box, args) {
  const result = box.hws(['tidy', 'status', '--line', ...args]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}

function setCurrent(box, manifest, covers, tidiedAt = Date.now() - HOUR) {
  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, current: { tidiedAt, covers } }));
}

function addArtifacts(box, manifest, artifacts) {
  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, artifacts: [...draft.artifacts, ...artifacts] }));
}

function writeCards(box, manifest, items) {
  mkdirSync(join(box.root, 'todos'), { recursive: true });
  writeFileSync(join(box.root, 'todos', `${manifest.id}.json`), JSON.stringify({ version: 1, space: manifest.id, items }));
}

const card = (id, column, fields = {}) => ({ id, title: `Card ${id}`, notes: '', column, archived: false, createdAt: 1, updatedAt: 2, ...fields });

const artifact = (id, createdAt) => ({ id, type: 'board', title: `Artifact ${id}`, path: `/tmp/${id}`, prompt: `/tmp/${id}/prompt.md`, createdAt });

function shortDate(ms) {
  const date = new Date(ms);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function packetOf(box, manifest) {
  return JSON.parse(readFileSync(join(box.root, 'workspaces', manifest.id, 'tidy', 'packet.json'), 'utf8'));
}

test('sessions count when their transcript changed after sessionsThrough', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const users = [{ type: 'user', message: { content: 'plan the release' } }];
  box.transcript(manifest, 'old', { hours: 3 });
  const fresh = box.transcript(manifest, 'new', { hours: 0, users });
  setCurrent(box, manifest, { sessionsThrough: Date.now() - HOUR });

  const result = status(box, manifest);

  assert.equal(result.behind.sessions, 1);
  const session = result.items.find((item) => item.kind === 'session');
  assert.deepEqual({ ...session, at: typeof session.at }, { kind: 'session', id: 'new', title: 'plan the release', at: 'number', path: fresh });
});

test('a session without a transcript and the tidy pass session are left out', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.transcript(manifest, 'mine');
  box.transcript(manifest, 'tidy-session');
  box.rewriteManifest(manifest.id, (draft) => ({
    ...draft,
    terminals: [
      { ...draft.terminals[0], sessionId: 'mine' },
      { terminal: 't900', tabId: 'tb900', sessionId: 'tidy-session', role: 'tidy' },
      { terminal: 't901', tabId: 'tb901', sessionId: 'never-written', role: null },
    ],
  }));

  assert.deepEqual(status(box, manifest).items.map((item) => item.id), ['mine']);
});

test('artifacts count when created after artifactsThrough', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const through = Date.now() - HOUR;
  addArtifacts(box, manifest, [artifact('a1', through - 1), artifact('a2', through + 1)]);
  setCurrent(box, manifest, { artifactsThrough: through });

  const result = status(box, manifest);

  assert.equal(result.behind.artifacts, 1);
  assert.deepEqual(result.items, [{ kind: 'artifact', id: 'a2', title: 'Artifact a2', at: through + 1, path: '/tmp/a2' }]);
});

test('commits count from the recorded commit to HEAD', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  git(manifest.folder, 'init', '-q');
  const base = commit(manifest.folder, 'first');
  commit(manifest.folder, 'second');
  const head = commit(manifest.folder, 'third');
  setCurrent(box, manifest, { commit: base });

  const result = status(box, manifest);

  assert.equal(result.behind.commits, 2);
  assert.deepEqual(result.items.map((item) => [item.kind, item.title, item.path]), [['commit', 'third', null], ['commit', 'second', null]]);
  assert.equal(result.items[0].id, head);
  assert.deepEqual(result.git, { repo: true, head, base, baseFound: true });
});

test('a missing commit or a folder outside git counts zero commits and says why', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  setCurrent(box, manifest, { commit: 'abc1234' });
  assert.deepEqual(status(box, manifest).git, { repo: false, head: null, base: 'abc1234', baseFound: false });

  git(manifest.folder, 'init', '-q');
  const head = commit(manifest.folder, 'first');
  const result = status(box, manifest);

  assert.equal(result.behind.commits, 0);
  assert.deepEqual(result.git, { repo: true, head, base: 'abc1234', baseFound: false });
});

test('a review saved from the tidy terminal does not count as behind', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  setCurrent(box, manifest, { artifactsThrough: Date.now() - HOUR });
  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, terminals: draft.terminals.map((item, index) => (index === 0 ? { ...item, role: 'tidy' } : item)) }));

  const { artifact } = box.finishGlued(box.manifest(manifest.id));

  assert.equal(artifact.role, 'tidy');
  assert.equal(status(box, manifest).behind.artifacts, 0);
});

test('Done cards count until they are archived', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  writeCards(box, manifest, [card('c1', 'done'), card('c2', 'done', { archived: true }), card('c3', 'doing'), card('c4', 'done', { updatedAt: 5 })]);
  setCurrent(box, manifest, {});

  const result = status(box, manifest);

  assert.equal(result.behind.cards, 2);
  assert.deepEqual(result.items.map((item) => [item.kind, item.id, item.at]), [['card', 'c4', 5], ['card', 'c1', 2]]);
});

test('with no current note every item is behind', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.age(manifest.id, 1);
  box.transcript(manifest, 's1', { hours: 48 });
  addArtifacts(box, manifest, [artifact('a1', 1)]);
  writeCards(box, manifest, [card('c1', 'done')]);
  git(manifest.folder, 'init', '-q');
  commit(manifest.folder, 'since the workspace began');

  const result = status(box, manifest);

  assert.equal(result.tidiedAt, null);
  assert.equal(result.stage, 'discovery');
  assert.equal(result.live, null);
  assert.deepEqual(result.behind, { sessions: 1, artifacts: 1, commits: 1, cards: 1 });
  assert.equal(line(box, ['--workspace', manifest.id]), 'No current note yet');
  assert.equal(result.line, 'No current note yet');
});

test('a note written outside a tidy pass reads as not tidied', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  writeFileSync(status(box, manifest).places.current, '# Plan\n');

  assert.equal(status(box, manifest).line, 'Current note not tidied yet');
});

test('tidy start --here writes a packet and records no pass', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const terminal = manifest.terminals[0].terminal;
  box.clearCalls();

  const started = box.json(['tidy', 'start', '--here'], { HC_TERMINAL_ID: terminal });

  assert.equal(started.here, true);
  assert.ok(existsSync(started.packet));
  assert.deepEqual(JSON.parse(readFileSync(started.packet, 'utf8')).candidates, []);
  assert.equal(box.manifest(manifest.id).tidy, undefined);
  assert.deepEqual(box.actions(), []);
});

test('tidy start --here refuses while another terminal runs a pass', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const live = box.json(['tidy', 'start', '--workspace', manifest.id]);

  const result = box.hws(['tidy', 'start', '--here', '--workspace', manifest.id], { HC_TERMINAL_ID: manifest.terminals[0].terminal });

  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, new RegExp(`running in ${live.terminal}`));
});

test('a review of the pass proposal does not count as behind when an agent ran the pass in its own session', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const terminal = manifest.terminals[0].terminal;
  const { packet } = box.json(['tidy', 'start', '--here'], { HC_TERMINAL_ID: terminal });
  const proposal = join(packet, '..', 'proposal.md');
  writeFileSync(proposal, '# Proposal\n');

  const surface = box.json(['surface', 'open', '--type', 'page', '--in-pane', '--file', proposal, '--terminal', terminal]);
  box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('review')]);

  assert.equal(box.manifest(manifest.id).artifacts.at(-1).role, 'tidy');
  assert.equal(status(box, manifest).behind.artifacts, 0);
  assert.deepEqual(box.json(['artifact', 'scan', '--workspace', manifest.id]).tracked, []);
});

test('commits that only touch drafts or the note records do not count', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  git(manifest.folder, 'init', '-q');
  const save = (path, subject) => {
    mkdirSync(join(manifest.folder, path, '..'), { recursive: true });
    writeFileSync(join(manifest.folder, path), subject);
    git(manifest.folder, 'add', '-f', path);
    git(manifest.folder, 'commit', '-q', '-m', subject);
  };
  const scratch = status(box, manifest).places.scratch.slice(manifest.folder.length + 1);

  save(`${scratch}/draft.json`, 'Auto-commit draft');
  save('CURRENT.md', 'Auto-commit note');
  assert.equal(status(box, manifest).behind.commits, 0);

  save('plan.md', 'Real work');
  const result = status(box, manifest);
  assert.equal(result.behind.commits, 1);
  assert.equal(result.items.find((item) => item.kind === 'commit').title, 'Real work');
  assert.equal(result.items.find((item) => item.kind === 'commit').files, undefined);
});

test('status carries the resolved places and the line, and creates no folder', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['set', '--workspace', manifest.id, '--place', 'current=docs/NOW.md', '--place', 'decisions=decisions', '--writer', 'decisions=pmos']);
  const tidiedAt = Date.now() - HOUR;
  setCurrent(box, manifest, { sessionsThrough: tidiedAt, artifactsThrough: tidiedAt }, tidiedAt);

  const result = status(box, manifest);

  const own = join(manifest.folder, '.herdr-workspace', `demo-${manifest.id.slice(-6)}`);
  assert.deepEqual(result.places, {
    current: join(manifest.folder, 'docs/NOW.md'),
    notes: join(own, 'notes'),
    artifacts: join(own, 'artifacts'),
    scratch: join(own, 'scratch'),
    decisions: join(manifest.folder, 'decisions'),
    history: join(own, 'history'),
    meetings: null,
  });
  assert.deepEqual(result.writers, { current: null, notes: null, artifacts: null, scratch: null, decisions: 'pmos', history: null, meetings: null });
  assert.equal(result.line, `Current is up to date, last tidied ${shortDate(tidiedAt)}`);
  assert.equal(existsSync(own), false);
});

test('a throwaway status has a null line', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();

  const result = status(box, manifest);

  assert.equal(result.line, null);
  assert.equal(result.places.current, null);
});

test('the line names each source behind and leaves out zero sources', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const tidiedAt = Date.now() - HOUR;
  box.transcript(manifest, 's1');
  addArtifacts(box, manifest, [artifact('a1', Date.now()), artifact('a2', Date.now())]);
  writeCards(box, manifest, [card('c1', 'done')]);
  setCurrent(box, manifest, { sessionsThrough: tidiedAt, artifactsThrough: tidiedAt }, tidiedAt);

  assert.equal(line(box, ['--workspace', manifest.id]), `Current is 2 artifacts and 1 card behind, last tidied ${shortDate(tidiedAt)}`);

  writeCards(box, manifest, []);
  assert.equal(line(box, ['--workspace', manifest.id]), `Current is 2 artifacts behind, last tidied ${shortDate(tidiedAt)}`);

  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, artifacts: draft.artifacts.map((item) => ({ ...item, status: 'draft' })) }));
  assert.equal(line(box, ['--workspace', manifest.id]), `Nothing has landed since ${shortDate(tidiedAt)}`);

  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, artifacts: [], terminals: draft.terminals.map((item) => ({ ...item, sessionId: null })) }));
  assert.equal(line(box, ['--workspace', manifest.id]), `Current is up to date, last tidied ${shortDate(tidiedAt)}`);
});

test('the line finds the calling terminal and is silent outside a workspace', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const terminal = manifest.terminals[0].terminal;

  assert.equal(line(box, []), '');
  assert.equal(box.hws(['tidy', 'status', '--line'], { HC_TERMINAL_ID: 't777' }).stdout, '');
  assert.deepEqual(box.json(['tidy', 'status', '--line'], { HC_TERMINAL_ID: 't777' }), { line: null });
  assert.equal(box.hws(['tidy', 'status', '--line'], { HC_TERMINAL_ID: terminal }).stdout, 'No current note yet\n');
});

test('a throwaway has no line and no tidy pass', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();

  assert.equal(line(box, ['--workspace', manifest.id]), '');
  const result = box.hws(['tidy', 'start', '--workspace', manifest.id]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /has no current note/);
});

test('status reports a live pass and drops one whose terminal ended', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const tidy = { terminal: 't9', startedAt: 1, packet: '/p.json' };
  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, tidy }));

  assert.deepEqual(status(box, manifest).live, tidy);

  box.setState({ hc: { t9: 'missing' } });
  assert.equal(status(box, manifest).live, null);
});

test('start writes the packet, opens a Tidy tab and records the pass', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const selected = box.state().selected;
  box.transcript(manifest, 's1');
  addArtifacts(box, manifest, [artifact('a1', 5)]);
  writeCards(box, manifest, [card('c1', 'done', { note: 'n', report: 'r' }), card('c2', 'todo')]);
  git(manifest.folder, 'init', '-q');
  const head = commit(manifest.folder, 'first');
  box.json(['set', '--workspace', manifest.id, '--stage', 'deciding', '--instructions', 'Be brief']);
  box.clearCalls();
  const before = Date.now();

  const result = box.json(['tidy', 'start', '--workspace', manifest.id]);

  const path = join(box.root, 'workspaces', manifest.id, 'tidy', 'packet.json');
  const { terminal } = result;
  assert.deepEqual(result, { terminal, started: true, packet: path });
  assert.deepEqual(box.actions(), [
    ['herdr-app', 'do', 'tab.new', '--name', 'Tidy', '--space', manifest.id, '--folder', manifest.folder, '--argv', ARGV, '--task', `Use the herdr-workspaces:tidy skill. The packet is at ${path}.`],
    ['herdr-app', 'do', 'space.select', '--id', selected],
  ]);

  const recorded = box.manifest(manifest.id);
  assert.equal(recorded.tidy.terminal, terminal);
  assert.equal(recorded.tidy.packet, path);
  assert.ok(recorded.tidy.startedAt >= before);
  assert.deepEqual(recorded.terminals.at(-1), { terminal, tabId: terminal.replace('t', 'tb'), sessionId: null, role: 'tidy' });

  const packet = packetOf(box, manifest);
  assert.equal(packet.version, 1);
  assert.equal(packet.workspace, manifest.id);
  assert.equal(packet.folder, manifest.folder);
  assert.equal(packet.stage, 'deciding');
  assert.equal(packet.instructions, 'Be brief');
  assert.equal(packet.places.current, join(manifest.folder, 'CURRENT.md'));
  assert.equal(packet.places.history, join(manifest.folder, '.herdr-workspace', `demo-${manifest.id.slice(-6)}`, 'history'));
  assert.deepEqual(packet.live.artifacts.map((item) => item.id), ['a1']);
  assert.deepEqual(packet.live.decisions.inForce, []);
  assert.deepEqual(packet.live.cards, [{ id: 'c2', title: 'Card c2', column: 'todo' }]);
  assert.equal(packet.writers.decisions, null);
  assert.deepEqual(packet.current, { path: join(manifest.folder, 'CURRENT.md'), exists: false, hash: null, tidiedAt: null, covers: null });
  assert.deepEqual(packet.since.sessions.map((item) => item.id), ['s1']);
  assert.deepEqual(packet.since.artifacts, [{ id: 'a1', title: 'Artifact a1', path: '/tmp/a1', status: 'current', createdAt: 5 }]);
  assert.deepEqual(packet.since.commits.map((item) => [item.sha, item.subject]), [[head, 'first']]);
  assert.deepEqual(packet.since.cards, [{ id: 'c1', title: 'Card c1', notes: '', note: 'n', report: 'r', replies: [], updatedAt: 2 }]);
  assert.equal(packet.cutoff.commit, head);
  for (const key of ['sessionsThrough', 'artifactsThrough']) assert.ok(packet.cutoff[key] >= before, key);
});

test('the packet hashes an existing current note', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  writeFileSync(join(manifest.folder, 'CURRENT.md'), '# Current\n');

  box.json(['tidy', 'start', '--workspace', manifest.id]);

  const { current } = packetOf(box, manifest);
  assert.equal(current.exists, true);
  assert.equal(current.hash, createHash('sha256').update('# Current\n').digest('hex'));
});

test('start with a live pass writes a fresh packet and pastes a note', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const packet = join(box.root, 'workspaces', manifest.id, 'tidy', 'packet.json');
  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, tidy: { terminal: 't9', startedAt: 1, packet } }));
  const before = Date.now();

  const result = box.json(['tidy', 'start', '--workspace', manifest.id]);

  assert.deepEqual(result, { terminal: 't9', started: false, packet });
  assert.deepEqual(box.actions(), [['hc', 'send', 't9', `The workspace changed. Read the tidy packet again at ${packet}`]]);
  assert.ok(packetOf(box, manifest).cutoff.sessionsThrough >= before);
  assert.equal(box.manifest(manifest.id).tidy.startedAt, 1);
});

test('start over an ended pass opens a new tab', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, tidy: { terminal: 't9', startedAt: 1, packet: '/old.json' } }));
  box.setState({ hc: { t9: 'missing' } });

  const result = box.json(['tidy', 'start', '--workspace', manifest.id]);

  assert.equal(result.started, true);
  assert.notEqual(result.terminal, 't9');
  assert.equal(box.manifest(manifest.id).tidy.terminal, result.terminal);
  assert.ok(existsSync(result.packet));
});

// Apply

const NEW_NOTE = '# Current\n\n## Now\n- Apply works [commit:abc1234]\n';

// A workspace with a note, two files to demote, two artifacts, two Done cards and a started pass.
function applyFixture(box, { history = true } = {}) {
  const manifest = box.app();
  const folder = manifest.folder;
  mkdirSync(join(folder, 'docs'), { recursive: true });
  writeFileSync(join(folder, 'CURRENT.md'), '# Old\n');
  writeFileSync(join(folder, 'docs', 'plan.md'), 'plan');
  writeFileSync(join(folder, 'docs', 'scrap.md'), 'scrap');
  if (history) box.json(['set', '--workspace', manifest.id, '--place', 'history=docs/history']);
  addArtifacts(box, manifest, [artifact('a1', 1), artifact('a2', 2)]);
  writeCards(box, manifest, [card('c1', 'done'), card('c2', 'done'), card('c3', 'doing')]);
  const { packet } = box.json(['tidy', 'start', '--workspace', manifest.id]);
  box.clearCalls();
  return { manifest, folder, packet };
}

function writeProposal(box, manifest, packet, change = {}) {
  const proposal = {
    version: 1,
    workspace: manifest.id,
    packet,
    summary: 'Tidy the plan',
    current: NEW_NOTE,
    demote: [
      { path: join(manifest.folder, 'docs', 'plan.md'), to: 'history', reason: 'Decided' },
      { path: join(manifest.folder, 'docs', 'scrap.md'), to: 'trash', reason: 'Replaced' },
    ],
    artifacts: [{ id: 'a1', status: 'superseded', supersedes: null }, { id: 'a2', status: 'current', supersedes: 'a1' }],
    cards: ['c1', 'c2'],
    ...change,
  };
  const path = join(box.dir, 'proposal.json');
  writeFileSync(path, JSON.stringify(proposal));
  return path;
}

const cardsOf = (box, manifest) => JSON.parse(readFileSync(join(box.root, 'todos', `${manifest.id}.json`), 'utf8')).items;
const archivedIds = (box, manifest) => cardsOf(box, manifest).filter((item) => item.archived).map((item) => item.id);
const statuses = (box, manifest) => box.manifest(manifest.id).artifacts.map(({ id, status, supersedes }) => [id, status ?? null, supersedes ?? null]);

test('apply writes the note, demotes, marks artifacts, archives cards and stamps current', (t) => {
  const box = sandbox(t);
  const { manifest, folder, packet } = applyFixture(box);
  const file = writeProposal(box, manifest, packet);
  const before = Date.now();

  const result = box.json(['tidy', 'apply', '--file', file, '--workspace', manifest.id]);

  const history = join(folder, 'docs', 'history', 'plan.md');
  const snapshot = result.snapshot;
  assert.equal(readFileSync(snapshot, 'utf8'), '# Old\n');
  assert.deepEqual(result, {
    wrote: join(folder, 'CURRENT.md'),
    snapshot,
    updates: join(folder, 'docs', 'history', 'updates.md'),
    decisions: [],
    demoted: [{ path: join(folder, 'docs', 'plan.md'), to: history }, { path: join(folder, 'docs', 'scrap.md'), to: 'trash' }],
    artifacts: [{ id: 'a1', status: 'superseded', supersedes: null }, { id: 'a2', status: 'current', supersedes: 'a1' }],
    archived: ['c1', 'c2'],
    skipped: [],
  });
  assert.equal(readFileSync(join(folder, 'CURRENT.md'), 'utf8'), NEW_NOTE);
  assert.equal(readFileSync(history, 'utf8'), 'plan');
  assert.equal(existsSync(join(folder, 'docs', 'scrap.md')), false);
  assert.equal(readFileSync(join(box.trashDir, '0-scrap.md'), 'utf8'), 'scrap');
  assert.deepEqual(statuses(box, manifest), [['a1', 'superseded', null], ['a2', 'current', 'a1']]);
  assert.deepEqual(archivedIds(box, manifest), ['c1', 'c2']);

  const recorded = box.manifest(manifest.id);
  assert.equal(recorded.tidy, undefined);
  assert.ok(recorded.current.tidiedAt >= before);
  assert.deepEqual(recorded.current.covers, packetOf(box, manifest).cutoff);
  assert.match(status(box, manifest).line, /^Current is up to date/);
});

test('the proposal names its workspace, so apply needs no flag', (t) => {
  const box = sandbox(t);
  const { manifest, packet } = applyFixture(box);
  const file = writeProposal(box, manifest, packet, { demote: [], artifacts: [], cards: [] });

  const result = box.json(['tidy', 'apply', '--file', file]);

  assert.equal(result.wrote, join(manifest.folder, 'CURRENT.md'));
  assert.deepEqual([result.demoted, result.artifacts, result.archived, result.skipped], [[], [], [], []]);
});

for (const part of ['current', 'demote', 'artifacts', 'cards']) {
  test(`apply --skip ${part} leaves that part alone and still stamps current`, (t) => {
    const box = sandbox(t);
    const { manifest, folder, packet } = applyFixture(box);
    const file = writeProposal(box, manifest, packet);

    const result = box.json(['tidy', 'apply', '--file', file, '--skip', part]);

    assert.deepEqual(result.skipped, [part]);
    const note = readFileSync(join(folder, 'CURRENT.md'), 'utf8');
    assert.equal(note, part === 'current' ? '# Old\n' : NEW_NOTE);
    assert.equal(result.wrote, part === 'current' ? null : join(folder, 'CURRENT.md'));
    assert.equal(existsSync(join(folder, 'docs', 'plan.md')), part === 'demote');
    assert.equal(existsSync(join(folder, 'docs', 'scrap.md')), part === 'demote');
    assert.equal(result.demoted.length, part === 'demote' ? 0 : 2);
    const unchanged = [['a1', 'current', null], ['a2', 'current', null]];
    assert.deepEqual(statuses(box, manifest), part === 'artifacts' ? unchanged : [['a1', 'superseded', null], ['a2', 'current', 'a1']]);
    assert.deepEqual(archivedIds(box, manifest), part === 'cards' ? [] : ['c1', 'c2']);
    const recorded = box.manifest(manifest.id);
    assert.equal(recorded.tidy, undefined);
    assert.deepEqual(recorded.current.covers, packetOf(box, manifest).cutoff);
  });
}

test('apply refuses a note that changed after the packet and changes nothing', (t) => {
  const box = sandbox(t);
  const { manifest, folder, packet } = applyFixture(box);
  const file = writeProposal(box, manifest, packet);
  writeFileSync(join(folder, 'CURRENT.md'), '# Edited by hand\n');

  const result = box.hws(['tidy', 'apply', '--file', file]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /changed after the packet was written/);
  assert.equal(readFileSync(join(folder, 'CURRENT.md'), 'utf8'), '# Edited by hand\n');
  assert.equal(existsSync(join(folder, 'docs', 'scrap.md')), true);
  assert.deepEqual(archivedIds(box, manifest), []);
  assert.ok(box.manifest(manifest.id).tidy);
  assert.equal(box.manifest(manifest.id).current, undefined);
});

test('apply refuses a note that appeared after a packet with no note', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { packet } = box.json(['tidy', 'start', '--workspace', manifest.id]);
  writeFileSync(join(manifest.folder, 'CURRENT.md'), '# Written meanwhile\n');
  const file = writeProposal(box, manifest, packet, { demote: [], artifacts: [], cards: [] });

  const result = box.hws(['tidy', 'apply', '--file', file]);

  assert.equal(result.code, 1);
  assert.equal(readFileSync(join(manifest.folder, 'CURRENT.md'), 'utf8'), '# Written meanwhile\n');
});

test('apply writes a first note when the packet had none', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.json(['set', '--workspace', manifest.id, '--place', 'current=docs/NOW.md']);
  const { packet } = box.json(['tidy', 'start', '--workspace', manifest.id]);
  const file = writeProposal(box, manifest, packet, { current: '# Current', demote: [], artifacts: [], cards: [] });

  box.json(['tidy', 'apply', '--file', file]);

  assert.equal(readFileSync(join(manifest.folder, 'docs', 'NOW.md'), 'utf8'), '# Current\n');
});

test('a history demotion goes to the default history place', (t) => {
  const box = sandbox(t);
  const { manifest, folder, packet } = applyFixture(box, { history: false });
  const file = writeProposal(box, manifest, packet, { demote: [{ path: join(folder, 'docs', 'plan.md'), to: 'history', reason: 'Decided' }] });

  const result = box.json(['tidy', 'apply', '--file', file]);

  const target = join(folder, '.herdr-workspace', `demo-${manifest.id.slice(-6)}`, 'history', 'plan.md');
  assert.deepEqual(result.demoted, [{ path: join(folder, 'docs', 'plan.md'), to: target }]);
  assert.equal(readFileSync(target, 'utf8'), 'plan');
});

test('a history demotion never replaces a file already there', (t) => {
  const box = sandbox(t);
  const { manifest, folder, packet } = applyFixture(box);
  mkdirSync(join(folder, 'docs', 'history'));
  writeFileSync(join(folder, 'docs', 'history', 'plan.md'), 'older plan');
  const file = writeProposal(box, manifest, packet, { demote: [{ path: 'docs/plan.md', to: 'history', reason: 'Decided' }] });

  const result = box.json(['tidy', 'apply', '--file', file]);

  assert.deepEqual(result.demoted, [{ path: join(folder, 'docs', 'plan.md'), to: join(folder, 'docs', 'history', 'plan-2.md') }]);
  assert.equal(readFileSync(join(folder, 'docs', 'history', 'plan.md'), 'utf8'), 'older plan');
});

test('apply refuses demotions of the note, outside the folder, under another writer or holding a place', (t) => {
  const box = sandbox(t);
  const { manifest, folder, packet } = applyFixture(box);
  box.json(['set', '--workspace', manifest.id, '--place', 'decisions=decisions', '--writer', 'decisions=pmos']);
  mkdirSync(join(folder, 'decisions'));
  writeFileSync(join(folder, 'decisions', 'd1.md'), 'decision');
  const outside = join(box.folder('elsewhere'), 'notes.md');
  writeFileSync(outside, 'notes');

  const cases = [
    [join(folder, 'CURRENT.md'), /is or holds the current note/],
    [folder, /is or holds the current note/],
    [outside, /outside the workspace folder/],
    [join(folder, 'decisions', 'd1.md'), /decisions place that pmos writes/],
    [join(folder, '.herdr-workspace'), /holds the (notes|artifacts|scratch) place/],
    [join(folder, 'docs', 'missing.md'), /does not exist/],
  ];
  mkdirSync(join(folder, '.herdr-workspace'), { recursive: true });
  for (const [path, message] of cases) {
    const file = writeProposal(box, manifest, packet, { demote: [{ path, to: 'trash', reason: 'x' }] });
    const result = box.hws(['tidy', 'apply', '--file', file]);
    assert.equal(result.code, 1, path);
    assert.match(result.stderr, message, path);
  }
  assert.equal(readFileSync(join(folder, 'CURRENT.md'), 'utf8'), '# Old\n');
  assert.equal(existsSync(outside), true);
  assert.equal(existsSync(join(folder, 'decisions', 'd1.md')), true);
  assert.ok(box.manifest(manifest.id).tidy);
});

test('apply refuses a bad proposal and names the field', (t) => {
  const box = sandbox(t);
  const { manifest, packet } = applyFixture(box);
  const cases = [
    [{ version: 2 }, /proposal version must be 1/],
    [{ current: 7 }, /proposal current must be text/],
    [{ demote: [{ path: '/x', to: 'away' }] }, /proposal demote\[0\]\.to must be history or trash/],
    [{ artifacts: [{ id: 'a1', status: 'old' }] }, /proposal artifacts\[0\]\.status must be one of/],
    [{ cards: [3] }, /proposal cards\[0\] must be a card id/],
  ];
  for (const [change, message] of cases) {
    const result = box.hws(['tidy', 'apply', '--file', writeProposal(box, manifest, packet, change)]);
    assert.equal(result.code, 2, message.source);
    assert.match(result.stderr, message);
  }
  assert.equal(box.hws(['tidy', 'apply', '--file', writeProposal(box, manifest, packet), '--skip', 'notes']).code, 2);
  assert.equal(box.hws(['tidy', 'apply']).code, 2);
});

test('apply refuses an unknown artifact or a card that left Done', (t) => {
  const box = sandbox(t);
  const { manifest, packet } = applyFixture(box);

  const unknown = box.hws(['tidy', 'apply', '--file', writeProposal(box, manifest, packet, { artifacts: [{ id: 'zz', status: 'draft' }] })]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /no artifact zz/);

  const doing = box.hws(['tidy', 'apply', '--file', writeProposal(box, manifest, packet, { cards: ['c3'] })]);
  assert.equal(doing.code, 1);
  assert.match(doing.stderr, /card c3 is in doing/);
  assert.equal(readFileSync(join(manifest.folder, 'CURRENT.md'), 'utf8'), '# Old\n');
});

test('apply refuses to write a current note another writer owns', (t) => {
  const box = sandbox(t);
  const { manifest, packet } = applyFixture(box);
  box.json(['set', '--workspace', manifest.id, '--place', 'current=CURRENT.md', '--writer', 'current=pmos']);
  const file = writeProposal(box, manifest, packet);

  const result = box.hws(['tidy', 'apply', '--file', file]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /belongs to pmos/);
  assert.equal(box.json(['tidy', 'apply', '--file', file, '--skip', 'current']).wrote, null);
});

test('stop ends the pass terminal and clears the record, and is quiet with none', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { terminal } = box.json(['tidy', 'start', '--workspace', manifest.id]);
  box.clearCalls();

  assert.deepEqual(box.json(['tidy', 'stop', '--workspace', manifest.id]), { stopped: true, terminal });
  assert.deepEqual(box.actions(), [['hc', 'kill', terminal]]);
  assert.equal(box.manifest(manifest.id).tidy, undefined);

  const again = box.hws(['tidy', 'stop', '--workspace', manifest.id]);
  assert.equal(again.code, 0);
  assert.equal(again.stdout, 'no tidy pass is running\n');
});

test('stop clears a pass whose terminal already ended without killing anything', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.rewriteManifest(manifest.id, (draft) => ({ ...draft, tidy: { terminal: 't9', startedAt: 1, packet: '/p.json' } }));
  box.setState({ hc: { t9: 'missing' } });

  assert.deepEqual(box.json(['tidy', 'stop', '--workspace', manifest.id]), { stopped: true, terminal: 't9' });
  assert.deepEqual(box.actions(), []);
  assert.equal(box.manifest(manifest.id).tidy, undefined);
});

// Decisions, history and the pane

function decision(title, change = {}) {
  return { title, why: `Because of ${title}`, decidedAt: '2026-11-04', cites: ['card:c1'], ...change };
}

function freshPass(box, manifest) {
  return box.json(['tidy', 'start', '--workspace', manifest.id]).packet;
}

test('apply logs decisions, and a later pass replaces one and keeps both records', (t) => {
  const box = sandbox(t);
  const { manifest, folder, packet } = applyFixture(box);
  const first = writeProposal(box, manifest, packet, { demote: [], artifacts: [], cards: [], decisions: [decision('Use PDF')], summary: 'First pass' });

  const applied = box.json(['tidy', 'apply', '--file', first]);

  assert.deepEqual(applied.decisions, [{ id: 'D-001', decidedAt: '2026-11-04', title: 'Use PDF', replaces: [] }]);
  const log = join(folder, '.herdr-workspace', `demo-${manifest.id.slice(-6)}`, 'decisions', 'decisions.md');
  box.json(['tidy', 'stop', '--workspace', manifest.id]);

  const again = freshPass(box, manifest);
  assert.deepEqual(packetOf(box, manifest).live.decisions.inForce, [{ id: 'D-001', decidedAt: '2026-11-04', title: 'Use PDF' }]);
  const second = writeProposal(box, manifest, again, { demote: [], artifacts: [], cards: [], current: '# Current\n\n## Now\n- HTML [card:c1]\n', decisions: [decision('Use HTML', { decidedAt: '2026-11-08', replaces: ['D-001'] })], summary: 'We pivoted to HTML' });
  box.json(['tidy', 'apply', '--file', second]);

  const text = readFileSync(log, 'utf8');
  assert.match(text, /## D-001 · 2026-11-04 · Use PDF\n\nReplaced by D-002\.\n\nBecause of Use PDF/);
  assert.match(text, /## D-002 · 2026-11-08 · Use HTML\n\nReplaces D-001\./);
  assert.deepEqual(box.json(['decision', 'list', '--workspace', manifest.id]).decisions.map((item) => [item.id, item.replacedBy]), [['D-001', 'D-002'], ['D-002', null]]);

  const updates = readFileSync(join(folder, 'docs', 'history', 'updates.md'), 'utf8');
  assert.ok(updates.indexOf('We pivoted to HTML') < updates.indexOf('First pass'));
  assert.match(updates, /Decided D-002, Use HTML, replacing D-001/);
  assert.equal(status(box, manifest).record.decisions.inForce, 1);
  assert.equal(status(box, manifest).record.decisions.replaced, 1);
});

test('two passes on one day keep both earlier notes', (t) => {
  const box = sandbox(t);
  const { manifest, packet } = applyFixture(box);
  const first = box.json(['tidy', 'apply', '--file', writeProposal(box, manifest, packet, { demote: [], artifacts: [], cards: [] })]);
  const second = box.json(['tidy', 'apply', '--file', writeProposal(box, manifest, freshPass(box, manifest), { demote: [], artifacts: [], cards: [], current: '# Current\n\n## Now\n- Second [commit:abc]\n' })]);

  assert.notEqual(first.snapshot, second.snapshot);
  assert.equal(readFileSync(first.snapshot, 'utf8'), '# Old\n');
  assert.equal(readFileSync(second.snapshot, 'utf8'), NEW_NOTE);
});

test('apply refuses a bad decision or an unknown replacement and changes nothing', (t) => {
  const box = sandbox(t);
  const { manifest, folder, packet } = applyFixture(box);
  const rest = { demote: [], artifacts: [], cards: [] };

  const badDate = box.hws(['tidy', 'apply', '--file', writeProposal(box, manifest, packet, { ...rest, decisions: [decision('X', { decidedAt: 'soon' })] })]);
  assert.equal(badDate.code, 2);
  assert.match(badDate.stderr, /decisions\[0\]\.decidedAt/);

  const unknown = box.hws(['tidy', 'apply', '--file', writeProposal(box, manifest, packet, { ...rest, decisions: [decision('X', { replaces: ['D-009'] })] })]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /no decision D-009/);
  assert.equal(readFileSync(join(folder, 'CURRENT.md'), 'utf8'), '# Old\n');
});

test('apply refuses decisions when another tool owns the log, and --skip decisions leaves it alone', (t) => {
  const box = sandbox(t);
  const { manifest, packet } = applyFixture(box);
  box.json(['set', '--workspace', manifest.id, '--place', 'decisions=decisions', '--writer', 'decisions=pmos']);
  const file = writeProposal(box, manifest, packet, { demote: [], artifacts: [], cards: [], decisions: [decision('X')] });

  assert.match(box.hws(['tidy', 'apply', '--file', file]).stderr, /belongs to pmos/);
  assert.deepEqual(box.json(['tidy', 'apply', '--file', file, '--skip', 'decisions']).decisions, []);
});

test('decision add logs one mid-session and a replaced decision cannot be replaced again', (t) => {
  const box = sandbox(t);
  const manifest = box.app();

  const first = box.json(['decision', 'add', '--workspace', manifest.id, '--title', 'Use PDF', '--why', 'Prints well', '--decided-at', '2026-11-01', '--cites', 'card:c1,commit:abc']);
  assert.deepEqual(first, { id: 'D-001', decidedAt: '2026-11-01', title: 'Use PDF', replaces: [] });
  box.json(['decision', 'add', '--workspace', manifest.id, '--title', 'Use HTML', '--why', 'Phones', '--replaces', 'D-001']);

  const again = box.hws(['decision', 'add', '--workspace', manifest.id, '--title', 'Use text', '--why', 'Simple', '--replaces', 'D-001']);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already replaced by D-002/);
});

test('sessions and drafts never count as landed, and an edited artifact does', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const tidiedAt = Date.now() - HOUR;
  const file = join(manifest.folder, 'deck.md');
  writeFileSync(file, 'deck');
  box.transcript(manifest, 's1');
  addArtifacts(box, manifest, [{ ...artifact('old', tidiedAt - HOUR), path: file }, { ...artifact('idea', Date.now()), status: 'draft' }]);
  setCurrent(box, manifest, { sessionsThrough: tidiedAt, artifactsThrough: tidiedAt }, tidiedAt);

  const result = status(box, manifest);

  assert.deepEqual(result.behind, { sessions: 1, artifacts: 2, commits: 0, cards: 0 });
  assert.deepEqual(result.landed, { artifacts: 1, commits: 0, cards: 0, total: 1 });
  assert.deepEqual(result.items.find((item) => item.id === 'old').edited, true);
});

test('from the panel the pass opens in a terminal below it, in the workspace folder', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  box.clearCalls();

  const pane = box.state().spaces[0].tabs[0].terminals[0].pane;
  const { packet } = box.json(['tidy', 'start', '--workspace', manifest.id, '--pane', pane]);

  const [call] = box.actions();
  assert.deepEqual(call.slice(0, 8), ['herdr-app', 'do', 'pane.split', '--pane', pane, '--direction', 'down', '--argv']);
  assert.deepEqual(JSON.parse(call[8]), ['sh', '-c', 'cd "$0" && exec "$@"', manifest.folder, 'claude', '--model', 'opus', '--effort', 'high', `Use the herdr-workspaces:tidy skill. The packet is at ${packet}.`]);
  assert.equal(box.actions().some((item) => item.includes('tab.new')), false);
});

test('a new kept workspace starts in discovery', (t) => {
  const box = sandbox(t);
  assert.equal(box.app().stage, 'discovery');
});

// Workspace files in their own folder

function homeWorkspace(box) {
  const folder = box.folder('product');
  const home = join(folder, '05-projects', 'project1');
  mkdirSync(home, { recursive: true });
  const manifest = box.json(['new', 'workspace', '--name', 'Project one', '--folder', folder, '--home', home, '--kind', 'general']);
  box.clearCalls();
  return { manifest, folder, home };
}

test('a workspace with its own folder keeps plain, readable places there', (t) => {
  const box = sandbox(t);
  const { manifest, home } = homeWorkspace(box);

  const { places } = status(box, manifest);

  assert.equal(places.current, join(home, 'CURRENT.md'));
  for (const role of ['notes', 'artifacts', 'scratch', 'decisions', 'history']) assert.equal(places[role], join(home, role));
  assert.equal(status(box, manifest).home, home);
});

test('tidy counts only commits that touch the workspace folder', (t) => {
  const box = sandbox(t);
  const { manifest, folder, home } = homeWorkspace(box);
  git(folder, 'init', '-q');
  commit(folder, 'other project');
  writeFileSync(join(home, 'spec.md'), 'spec');
  git(folder, 'add', join(home, 'spec.md'));
  git(folder, 'commit', '-q', '-m', 'this project');

  assert.deepEqual(status(box, manifest).items.filter((item) => item.kind === 'commit').map((item) => item.title), ['this project']);
});

test('set --home moves the places and an empty value clears it', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const home = box.folder('elsewhere');

  box.json(['set', '--workspace', manifest.id, '--home', home]);
  assert.equal(status(box, manifest).places.artifacts, join(home, 'artifacts'));

  box.json(['set', '--workspace', manifest.id, '--home', '']);
  assert.equal(box.manifest(manifest.id).home, undefined);
  assert.equal(status(box, manifest).home, manifest.folder);
});

test('a note lands in notes and a board in artifacts, each named by its title', (t) => {
  const box = sandbox(t);
  const { manifest, home } = homeWorkspace(box);
  const terminal = manifest.terminals[0].terminal;
  const finish = (type, title) => {
    const surface = box.json(['surface', 'open', '--type', type, '--in-pane', '--title', title, '--terminal', terminal]);
    box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle(`bundle-${surface.id}`)]);
    return box.manifest(manifest.id).artifacts.at(-1);
  };

  const note = finish('note', 'Launch plan');
  const board = finish('board', 'User flow');

  assert.match(note.path, new RegExp(`^${join(home, 'notes')}/launch-plan-a`));
  assert.match(board.path, new RegExp(`^${join(home, 'artifacts')}/user-flow-a`));
});

test('unsent drafts live in the workspace and reopening a file keeps them', (t) => {
  const box = sandbox(t);
  const { manifest, home } = homeWorkspace(box);
  const terminal = manifest.terminals[0].terminal;
  const file = join(home, 'spec.md');
  writeFileSync(file, '# Spec');

  const first = box.json(['surface', 'open', '--type', 'page', '--file', file, '--terminal', terminal]);
  const data = join(box.root, 'workspaces', manifest.id, 'surfaces', first.id);
  writeFileSync(join(data, 'drafts', 'd1.json'), '{}');

  assert.ok(existsSync(join(home, 'scratch', 'drafts', `spec.md-${first.id}`, 'drafts', 'd1.json')));

  box.setState({ spaces: box.state().spaces.map((space) => ({ ...space, tabs: space.tabs.map((tab) => ({ ...tab, terminals: tab.terminals.filter((item) => item.pane !== first.pane) })) })) });
  const second = box.json(['surface', 'open', '--type', 'page', '--file', file, '--terminal', terminal]);

  assert.equal(second.id, first.id);
  assert.ok(existsSync(join(data, 'drafts', 'd1.json')));
  assert.equal(box.manifest(manifest.id).surfaces.length, 1);
});

test('opening a file already open focuses its pane', (t) => {
  const box = sandbox(t);
  const { manifest, home } = homeWorkspace(box);
  const terminal = manifest.terminals[0].terminal;
  const file = join(home, 'spec.md');
  writeFileSync(file, '# Spec');
  const first = box.json(['surface', 'open', '--type', 'page', '--file', file, '--terminal', terminal]);
  box.clearCalls();

  const again = box.json(['surface', 'open', '--type', 'page', '--file', file, '--terminal', terminal]);

  assert.equal(again.focused, true);
  assert.deepEqual(box.actions(), [['herdr-app', 'do', 'pane.focus', '--pane', first.pane]]);
});

test('a throwaway keeps its drafts in its own state folder', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const surface = box.json(['surface', 'open', '--type', 'note', '--in-pane', '--terminal', manifest.terminals[0].terminal]);

  const link = join(box.root, 'workspaces', manifest.id, 'surfaces', surface.id, 'drafts');
  assert.equal(existsSync(link), false);
});
