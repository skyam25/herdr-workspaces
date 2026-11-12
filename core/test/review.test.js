import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { flipToChat, liveFixtures, sandbox } from './helpers.js';

const { space, tab } = liveFixtures;

function pageIn(manifest, name = 'plan.html') {
  const file = join(manifest.folder, name);
  writeFileSync(file, '<p>plan</p>');
  return realpathSync(file);
}

const splitPane = (box) => {
  const call = box.actions().find((item) => item[2] === 'pane.split');
  return call?.[call.indexOf('--pane') + 1];
};

test('surface open finds a flipped agent by its recorded tab when it has no space label', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { owner } = flipToChat(box, manifest);

  const surface = box.json(['surface', 'open', '--type', 'note', '--in-pane', '--terminal', owner]);

  assert.equal(splitPane(box), 'pchat');
  assert.equal(surface.workspace, manifest.id);
  assert.equal(box.manifest(manifest.id).surfaces[0].terminal, owner);
});

test('surface open finds a flipped agent by its space label', (t) => {
  const box = sandbox(t);
  box.setState({
    spaces: [space('sp1', [tab('tb1', [])])],
    chatPanes: { pchat: 'tb1' },
    hc: { t9: { labels: { 'herdr.chat': 'pchat', 'herdr.space': 'sp1' } } },
  });

  box.json(['surface', 'open', '--type', 'note', '--in-pane', '--terminal', 't9']);

  assert.equal(splitPane(box), 'pchat');
});

test('surface open says what to pass when a flipped agent has no known space', (t) => {
  const box = sandbox(t);
  box.setState({ spaces: [space('sp1', [tab('tb1', [])])], chatPanes: { pchat: 'tb1' }, hc: { t9: { labels: { 'herdr.chat': 'pchat' } } } });

  const result = box.hws(['surface', 'open', '--type', 'note', '--terminal', 't9']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /pass --beside-pane and --space/);
});

test('review tracks the file where it sits and opens it beside the agent', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const file = pageIn(manifest);

  const opened = box.json(['review', file, '--terminal', owner]);

  const [artifact] = box.manifest(manifest.id).artifacts;
  assert.deepEqual(
    { type: artifact.type, path: artifact.path, inPlace: artifact.inPlace, title: artifact.title },
    { type: 'file', path: file, inPlace: true, title: 'plan.html' },
  );
  assert.equal(opened.artifact, artifact.id);
  assert.equal(opened.type, 'page');
  assert.equal(opened.terminal, owner);
  assert.ok(splitPane(box));
  assert.equal(readFileSync(file, 'utf8'), '<p>plan</p>');
});

test('review reads the calling terminal, takes an artifact id and tracks a file once', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const file = pageIn(manifest);
  const first = box.hws(['review', file], { HC_TERMINAL_ID: owner });
  assert.match(first.stdout, /^Opened plan\.html beside .* End the turn now\./);
  const [artifact] = box.manifest(manifest.id).artifacts;

  const second = box.hws(['review', artifact.id], { HC_TERMINAL_ID: owner });

  assert.match(second.stdout, /^plan\.html is already open for review\./);
  assert.equal(box.manifest(manifest.id).artifacts.length, 1);
});

test('review opens beside the chat pane of a flipped agent', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { owner } = flipToChat(box, manifest);

  box.json(['review', pageIn(manifest), '--terminal', owner]);

  assert.equal(splitPane(box), 'pchat');
});

test('review refuses a missing file, another file type and a caller with no terminal', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const picture = join(manifest.folder, 'shot.png');
  writeFileSync(picture, 'png');

  assert.equal(box.hws(['review', join(manifest.folder, 'gone.html'), '--terminal', owner]).code, 1);
  assert.match(box.hws(['review', picture, '--terminal', owner]).stderr, /opens \.html and \.md files/);
  assert.equal(box.hws(['review', pageIn(manifest)]).code, 2);
  assert.deepEqual(box.manifest(manifest.id).artifacts, []);
});

test('review says when the page is open in a pane with no agent attached', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const file = pageIn(manifest);
  box.setState({ selected: manifest.id });
  box.json(['surface', 'open', '--type', 'page', '--file', file, '--standalone']);

  const result = box.hws(['review', file, '--terminal', owner]);

  assert.match(result.stdout, /has no agent attached, so its comments will not arrive here/);
});

test('a throwaway reviews a file without tracking it', (t) => {
  const box = sandbox(t);
  const manifest = box.throwaway();
  const file = pageIn(manifest);

  const opened = box.json(['review', file, '--terminal', manifest.terminals[0].terminal]);

  assert.equal(opened.artifact, null);
  assert.deepEqual(box.manifest(manifest.id).artifacts, []);
});

test('done on a reviewed page files a feedback round under the page and asks for another look', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const file = pageIn(manifest);
  const surface = box.json(['review', file, '--terminal', owner, '--title', 'Plan']);
  box.clearCalls();

  box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-round', 'Move the header.\n')]);

  const [page, round] = box.manifest(manifest.id).artifacts;
  assert.deepEqual(
    { type: round.type, role: round.role, file: round.file, reviewOf: round.reviewOf, title: round.title },
    { type: 'page', role: 'feedback', file, reviewOf: page.id, title: 'Feedback on Plan' },
  );
  const sent = box.actions().find((call) => call[1] === 'send')[3];
  assert.equal(sent, readFileSync(round.prompt, 'utf8'));
  assert.match(sent, /^Move the header\.\n\n\nIf you change the page, run `hws review .*plan\.html` afterwards so the person can look again\.\n$/);
  assert.deepEqual(box.manifest(manifest.id).surfaces, []);
});

test('a round on an untracked page names the file and no artifact', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const file = pageIn(manifest);
  const surface = box.json(['surface', 'open', '--type', 'page', '--file', file, '--terminal', manifest.terminals[0].terminal]);

  box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-loose')]);

  const [round] = box.manifest(manifest.id).artifacts;
  assert.deepEqual({ role: round.role, file: round.file, reviewOf: round.reviewOf }, { role: 'feedback', file, reviewOf: null });
});

test('a board and a note with no file stay plain artifacts', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const { artifact } = box.finishGlued(manifest);
  assert.equal(artifact.role, undefined);
  assert.equal(artifact.title, 'flow');
  assert.doesNotMatch(readFileSync(artifact.prompt, 'utf8'), /hws review/);
});

test('feedback rounds stay out of freshness and the scan', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const surface = box.json(['review', pageIn(manifest), '--terminal', owner]);
  box.json(['surface', 'done', '--id', surface.id, '--bundle', box.bundle('bundle-quiet')]);
  const [page] = box.manifest(manifest.id).artifacts;

  const status = box.json(['tidy', 'status', '--workspace', manifest.id]);
  const scan = box.json(['artifact', 'scan', '--workspace', manifest.id]);

  assert.equal(status.behind.artifacts, 1);
  assert.deepEqual(status.items.filter((item) => item.kind === 'artifact').map((item) => item.id), [page.id]);
  assert.deepEqual(scan.tracked.map((item) => item.id), [page.id]);
});

test('review --window opens the page in its own window', (t) => {
  const box = sandbox(t);
  const manifest = box.app();
  const owner = manifest.terminals[0].terminal;
  const result = box.hws(['review', pageIn(manifest), '--window', '--terminal', owner]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /in its own window for review/);
  assert.ok(box.actions().some((call) => call[0] === 'hc' && call[1] === 'run'));
  assert.equal(box.manifest(manifest.id).surfaces[0].pane, null);
});
