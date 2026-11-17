// `hws migrate agent-brief` moves a Mac off the retired Agent Brief app and plugin.
// The report changes nothing. --import files old boards and drafts as Unfiled work.
// --apply uninstalls the plugin and moves the app and its data to the Trash.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  MARKETPLACE,
  PLUGIN,
  appRunning,
  applications,
  dataCounts,
  filesIn,
  isAgentBriefLink,
  linkPresent,
  linkTarget,
  marketplaceKnown,
  paths,
  pluginEnabled,
  pluginInstalled,
} from '../agent-brief.js';
import { findArtifactWhere, freeName, linkFor, readScene } from '../artifacts.js';
import { checkout } from '../checkout.js';
import { HwsError } from '../errors.js';
import { appHome } from '../forks.js';
import { herdrVersion } from '../herdr-version.js';
import { scanInstructions } from '../instruction-scan.js';
import { ensureStandaloneManifest, listManifests, updateManifest } from '../manifest.js';
import { expandFolder, home, slug } from '../paths.js';
import { writablePlace } from '../places.js';
import { remembered } from '../settings.js';
import { moveToTrash } from '../trash.js';
import { newId } from './surface.js';

const HWS_PLUGIN = 'herdr-workspaces@herdr-workspaces';
const QUIT_POLL_MS = 250;
const SCENE = 'board.excalidraw';
const ATTACHMENT = /\(att:([\w-]+)\)/g;

const tilde = (path) => (path === home() || path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const guide = () => join(checkout(), 'docs/GUIDE.md');

function countText({ boards, drafts }) {
  return `${plural(boards, 'board')} and ${plural(drafts, 'draft')}`;
}

// Each part of Agent Brief, as { name, path, present, detail }.
function agentBriefParts() {
  const where = paths();
  const part = (name, path, present = existsSync(path), detail = tilde(path)) => ({ name, path, present, detail });
  const dataPart = (name, path) => {
    if (!existsSync(path)) return part(name, path, false);
    const counts = dataCounts(path);
    return { ...part(name, path, true), ...counts, detail: `${tilde(path)}, ${countText(counts)}` };
  };
  const target = linkTarget(where.link);
  const appPresent = existsSync(where.app);
  const running = appPresent && appRunning();
  return [
    part('Plugin enabled', where.settings, pluginEnabled(PLUGIN), `${PLUGIN} in ${tilde(where.settings)}`),
    part('Plugin installed', where.installed, pluginInstalled(PLUGIN), `${PLUGIN} in ${tilde(where.installed)}`),
    part('Plugin marketplace', where.marketplaces, marketplaceKnown(), `${MARKETPLACE} in ${tilde(where.marketplaces)}`),
    part('Plugin cache', where.cache),
    part('CLI link', where.link, linkPresent(where.link), target ? `${tilde(where.link)} -> ${tilde(target)}` : tilde(where.link)),
    { ...part('App', where.app, appPresent), running, detail: appPresent ? `${where.app}, ${running ? 'running' : 'not running'}` : where.app },
    dataPart('Data', where.data),
    dataPart('Old data', where.oldData),
    part('Preferences', where.preferences),
    ...where.caches.map((path) => part('Cache', path)),
    part('Feedback inbox', where.inbox),
  ];
}

// What Herdr Workspaces needs in place before Agent Brief goes.
function readiness() {
  const link = join(home(), '.local/bin/hws');
  const version = herdrVersion();
  const herdrApp = join(applications(), 'Herdr.app');
  const wanted = readdirSync(join(checkout(), 'mods'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('hws-'))
    .map((entry) => entry.name);
  const missing = wanted.filter((name) => !existsSync(join(appHome(), 'mods', name)));
  const modsDir = tilde(join(appHome(), 'mods'));
  return [
    { name: 'CLI link', ok: existsSync(link), detail: tilde(link) },
    { name: 'Herdr app', ok: Boolean(version) || existsSync(herdrApp), detail: version ? `Herdr ${version}` : existsSync(herdrApp) ? herdrApp : 'herdr-app did not answer' },
    { name: 'Mods', ok: missing.length === 0, detail: missing.length ? `${missing.join(', ')} missing from ${modsDir}` : `${wanted.length} in ${modsDir}` },
    { name: 'Claude plugin', ok: pluginEnabled(HWS_PLUGIN), detail: `${HWS_PLUGIN} ${pluginEnabled(HWS_PLUGIN) ? 'enabled' : 'not enabled'}` },
  ];
}

function scanFolders(extra) {
  const workspaces = listManifests().filter((manifest) => !manifest.archived).map((manifest) => manifest.folder);
  const parent = remembered();
  return [...workspaces, ...(parent && existsSync(parent) ? [parent] : []), ...extra];
}

const alreadyImported = (source) => findArtifactWhere((item) => item.importedFrom === source)?.artifact ?? null;

function addUnfiled(record) {
  const manifest = ensureStandaloneManifest();
  updateManifest(manifest.id, (draft) => {
    draft.artifacts.push(record);
  });
}

function boardPrompt(dir, name, extras) {
  const lines = [`Sketch "${name}", imported from Agent Brief.`, '', `The drawing is ${linkFor(join(dir, SCENE))}.`];
  if (extras.includes('notes.md')) lines.push(`Its notes are ${linkFor(join(dir, 'notes.md'))}.`);
  if (extras.includes('comments.json')) lines.push(`Its pinned comments are ${linkFor(join(dir, 'comments.json'))}.`);
  return `${lines.join('\n')}\n`;
}

function importBoard(source, place) {
  const name = basename(source, '.excalidraw');
  const kind = 'board';
  const found = alreadyImported(source);
  if (found) return { skipped: { kind, name, source, reason: `already imported as ${found.id}` } };
  try {
    readScene(source);
  } catch (error) {
    return { skipped: { kind, name, source, reason: error.message.replace(source, 'the file') } };
  }
  const id = newId('a');
  const dir = join(place, id);
  mkdirSync(dir, { recursive: true });
  copyFileSync(source, join(dir, SCENE));
  const extras = [];
  for (const [suffix, target] of [['.comments.json', 'comments.json'], ['.notes.md', 'notes.md']]) {
    const side = join(source, '..', `${name}${suffix}`);
    if (existsSync(side)) {
      copyFileSync(side, join(dir, target));
      extras.push(target);
    }
  }
  const prompt = join(dir, 'prompt.md');
  writeFileSync(prompt, boardPrompt(dir, name, extras));
  const record = { id, type: kind, title: name, path: dir, prompt, fromTerminal: null, createdAt: statSync(source).mtimeMs, status: 'current', supersedes: null, importedFrom: source };
  addUnfiled(record);
  return { imported: { kind, name, source, artifact: id, path: dir } };
}

// The draft's title, else its first line with words, as Agent Brief's list showed it.
function draftTitle(draft) {
  if (typeof draft.title === 'string' && draft.title.trim()) return draft.title.trim();
  const first = draft.body
    .split('\n')
    .map((line) => line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^\s*(?:#+|[-*+]|\d+[.)]|>)\s*/, '').trim())
    .find(Boolean);
  return (first ?? draft.id).slice(0, 60);
}

// Pasted pictures live in the draft as data URLs, so the Markdown carries them inline.
function draftMarkdown(draft, title) {
  const body = draft.body.replace(ATTACHMENT, (whole, id) => (draft.attachments?.[id] ? `(${draft.attachments[id]})` : whole)).trimEnd();
  const headed = new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(body.split('\n')[0] ?? '');
  return draft.title && !headed ? `# ${title}\n\n${body}\n` : `${body}\n`;
}

function importDraft(source, place) {
  const kind = 'draft';
  const name = basename(source, '.json');
  const found = alreadyImported(source);
  if (found) return { skipped: { kind, name, source, reason: `already imported as ${found.id}` } };
  const draft = (() => {
    try {
      return JSON.parse(readFileSync(source, 'utf8'));
    } catch {
      return null;
    }
  })();
  if (!draft || typeof draft !== 'object') return { skipped: { kind, name, source, reason: 'not valid JSON' } };
  if (typeof draft.body !== 'string' || !draft.body.trim()) {
    const reason = draft.outline?.path ? `an outline, whose text lives in ${draft.outline.path}` : 'empty';
    return { skipped: { kind, name, source, reason } };
  }
  const title = draftTitle({ ...draft, id: draft.id ?? name });
  const file = freeName(place, `${slug(title)}.md`);
  writeFileSync(file, draftMarkdown(draft, title));
  const id = newId('a');
  const createdAt = Number.isFinite(draft.createdAt) ? draft.createdAt : statSync(source).mtimeMs;
  addUnfiled({ id, type: 'file', title, path: file, prompt: file, fromTerminal: null, createdAt, status: 'current', supersedes: null, importedFrom: source });
  return { imported: { kind, name: title, source, artifact: id, path: file } };
}

function importAll() {
  const where = paths();
  const place = writablePlace(ensureStandaloneManifest(), 'artifacts');
  mkdirSync(place, { recursive: true });
  const results = [where.data, where.oldData].flatMap((dir) => [
    ...filesIn(join(dir, 'boards'), '.excalidraw').sort().map((name) => importBoard(join(dir, 'boards', name), place)),
    ...filesIn(join(dir, 'drafts'), '.json').sort().map((name) => importDraft(join(dir, 'drafts', name), place)),
  ]);
  return { imported: results.flatMap((one) => one.imported ?? []), skipped: results.flatMap((one) => one.skipped ?? []) };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Asks the app to quit once and waits for it. Fails, with nothing changed, while it still runs.
async function requireQuit() {
  if (!appRunning()) return;
  spawnSync(process.env.HWS_OSASCRIPT || '/usr/bin/osascript', ['-e', 'tell application "Agent Brief" to quit'], { stdio: 'ignore', timeout: 15_000 });
  const deadline = Date.now() + Number(process.env.HWS_QUIT_WAIT_MS ?? 10_000);
  while (appRunning()) {
    if (Date.now() >= deadline) throw new HwsError('Agent Brief is still running, so nothing changed. Quit it and run this again');
    await sleep(QUIT_POLL_MS);
  }
}

function claude(args) {
  const result = spawnSync(process.env.HWS_CLAUDE || 'claude', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const command = `claude ${args.join(' ')}`;
  if (result.error?.code === 'ENOENT') return { ok: false, text: `skipped ${command}, because claude is not on PATH` };
  if (result.error || result.status !== 0) return { ok: false, text: `${command} failed: ${(result.stderr || result.stdout || result.error?.message || '').trim()}` };
  return { ok: true, text: `ran ${command}` };
}

function trashText(path, counts, imported) {
  if (!counts || counts.boards + counts.drafts === 0) return `moved ${tilde(path)} to the Trash`;
  const held = countText(counts);
  return imported ? `moved ${tilde(path)} to the Trash, with ${held} already imported` : `moved ${tilde(path)} to the Trash, with ${held}. --import would have kept them as Unfiled work`;
}

function applyAll(imported) {
  const where = paths();
  const actions = [];
  if (pluginEnabled(PLUGIN) || pluginInstalled(PLUGIN)) actions.push(claude(['plugin', 'uninstall', PLUGIN]));
  if (marketplaceKnown()) actions.push(claude(['plugin', 'marketplace', 'remove', MARKETPLACE]));

  if (isAgentBriefLink(where.link)) {
    unlinkSync(where.link);
    actions.push({ ok: true, text: `removed the link ${tilde(where.link)}` });
  } else if (linkPresent(where.link)) {
    actions.push({ ok: true, text: `kept ${tilde(where.link)}, because it is not a link into Agent Brief` });
  }

  const counts = new Map([where.data, where.oldData].map((dir) => [dir, dataCounts(dir)]));
  const doomed = [where.app, where.data, where.oldData, where.preferences, ...where.caches, where.cache, where.inbox].filter((path) => existsSync(path));
  let failure = null;
  try {
    moveToTrash(doomed);
  } catch (error) {
    failure = error.message;
  }
  for (const path of doomed) {
    if (existsSync(path)) actions.push({ ok: false, text: `could not move ${tilde(path)} to the Trash${failure ? `: ${failure}` : ''}` });
    else actions.push({ ok: true, text: trashText(path, counts.get(path), imported) });
  }
  return actions;
}

function partsText(parts) {
  const width = Math.max(...parts.map(({ name }) => name.length));
  return parts.map(({ name, present, detail }) => `  ${present ? 'present' : 'absent '}  ${name.padEnd(width)}  ${detail}`);
}

function readinessText(checks) {
  const width = Math.max(...checks.map(({ name }) => name.length));
  return checks.map(({ name, ok, detail }) => `  ${ok ? 'ok     ' : 'missing'}  ${name.padEnd(width)}  ${detail}`);
}

function instructionsText(findings) {
  if (findings.length === 0) return ['  none found'];
  return findings.map(({ file, line, term, replacement }) => `  ${tilde(file)}:${line}  ${term} -> ${replacement}`);
}

function nextStep(parts, findings) {
  const held = parts.filter((part) => part.present && (part.boards || part.drafts));
  const left = parts.some((part) => part.present);
  const lines = [];
  if (findings.length) lines.push(`Edit each stale line by hand. See "Moving off Agent Brief" in ${guide()}.`);
  if (held.length) lines.push('Run hws migrate agent-brief --import --apply to keep the boards and drafts as Unfiled work and remove the rest.');
  else if (left) lines.push('Run hws migrate agent-brief --apply to remove what is left.');
  else lines.push('Agent Brief is gone from this Mac.');
  return lines;
}

function resultsText({ imported, skipped }) {
  return [
    ...imported.map((item) => `imported ${item.kind} ${item.name} as ${item.artifact}, Unfiled`),
    ...skipped.map((item) => `skipped ${item.kind} ${item.name}: ${item.reason}`),
  ];
}

export async function migrate(flags) {
  const extra = (flags.scan ?? []).map((dir) => {
    const folder = expandFolder(dir);
    if (!existsSync(folder)) throw new HwsError(`${folder} does not exist`);
    return folder;
  });

  if (flags.apply) await requireQuit();
  const imports = flags.import ? importAll() : { imported: [], skipped: [] };
  const actions = flags.apply ? applyAll(Boolean(flags.import)) : [];
  if (actions.some((action) => !action.ok)) process.exitCode = 1;

  const parts = agentBriefParts();
  const checks = readiness();
  const findings = scanInstructions(scanFolders(extra));
  const done = [...resultsText(imports), ...actions.map((action) => action.text)];
  const text = [
    ...(done.length ? ['Done', ...done.map((line) => `  ${line}`), ''] : []),
    'Agent Brief',
    ...partsText(parts),
    '',
    'Herdr Workspaces',
    ...readinessText(checks),
    '',
    'Stale instructions',
    ...instructionsText(findings),
    '',
    ...nextStep(parts, findings),
  ].join('\n');
  return {
    data: { agentBrief: parts, herdrWorkspaces: checks, instructions: findings, ...imports, actions, guide: guide() },
    text,
  };
}
