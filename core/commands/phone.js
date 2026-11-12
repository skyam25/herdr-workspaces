import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { findArtifact, freeName, isInside, linkFor, realOf } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import { act, findTerminal, isAgentTerminal, isIdleShell, isTerminalAlive, listLive, listLocalTerminals, requireLive, runDetached, sendText, terminalInfo, windowStatus } from '../herdr.js';
import { ensureStandaloneManifest, manifestOfSpace, readManifest, writeJsonAtomic } from '../manifest.js';
import { HWS_BIN, PHONE_HOST, home, phoneDir, phoneSocket, stateRoot } from '../paths.js';
import { requireCallingTerminal, requireFlag, spaceOfTerminal } from '../resolve.js';
import { archiveBundle, assertBundle, newId, promptToSend, windowOwnerLabel } from './surface.js';

const CONTROL_MS = 15_000;
const START_MS = 15_000;
const POLL_MS = 150;
const PAIR_POLL_MS = 1_000;
const PAIR_MS = 10 * 60_000;
const PAIRED_PAUSE_MS = 2_000;
const KEEP_MS = 90 * 24 * 3600_000;

// Forwarded so a test can point the listener at fakes and a private port.
const PASSED_TO_HOST = ['HWS_HC', 'HWS_HERDR_APP', 'HWS_PHONE_HOST', 'HWS_PHONE_PORT'];

// Resolves null when no listener answers.
function control(method, path, body) {
  return new Promise((finish, fail) => {
    const req = request({ socketPath: phoneSocket(), path, method, headers: { 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        const reply = JSON.parse(text || '{}');
        if (res.statusCode >= 400) fail(new HwsError(reply.error ?? `the phone listener answered ${res.statusCode}`));
        else finish(reply);
      });
    });
    req.setTimeout(CONTROL_MS, () => req.destroy());
    req.on('error', () => finish(null));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function hostArgv() {
  const passed = PASSED_TO_HOST.filter((name) => process.env[name]).map((name) => `${name}=${process.env[name]}`);
  return ['env', `HWS_HOME=${stateRoot()}`, `HWS_BIN=${HWS_BIN}`, `HWS_PHONE_SOCKET=${phoneSocket()}`, `HWS_PHONE_DATA=${phoneDir()}`, ...passed, process.execPath, PHONE_HOST];
}

// The listener runs in a Herdr terminal with no pane, so it ends with Herdr.
async function ensureHost() {
  const running = await control('GET', '/status');
  if (running) return running;
  if (!existsSync(PHONE_HOST)) throw new HwsError('build the phone listener first, with pnpm build in surface/app');
  mkdirSync(phoneDir(), { recursive: true });
  runDetached(hostArgv(), phoneDir());
  for (let waited = 0; waited < START_MS; waited += POLL_MS) {
    await sleep(POLL_MS);
    const status = await control('GET', '/status');
    if (status) return status;
  }
  throw new HwsError('the phone listener did not start');
}

function savedDevices() {
  try {
    return JSON.parse(readFileSync(join(phoneDir(), 'ipad', 'devices.json'), 'utf8')).devices ?? [];
  } catch {
    return [];
  }
}

function pruneOld(folder) {
  const dir = join(phoneDir(), folder);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (Date.now() - statSync(path).mtimeMs > KEEP_MS) rmSync(path, { force: true });
  }
}

const sendRecord = (id) => join(phoneDir(), 'sends', `${id}.json`);

function fileTarget(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm') return { type: 'page', file };
  if (ext === '.excalidraw') return { type: 'board', file };
  throw new HwsError(`the phone opens .html and .excalidraw files, so it cannot open ${basename(file)}`);
}

// A Done bundle holds its drawing as board.excalidraw.
function folderTarget(folder) {
  const names = readdirSync(folder);
  if (names.includes('board.excalidraw')) return fileTarget(join(folder, 'board.excalidraw'));
  const pages = names.filter((name) => /\.html?$/i.test(name));
  if (pages.includes('index.html')) return fileTarget(join(folder, 'index.html'));
  if (pages.length === 1) return fileTarget(join(folder, pages[0]));
  throw new HwsError(`${folder} has no drawing and no single page to send`);
}

function pathTarget(path) {
  return statSync(path).isDirectory() ? folderTarget(path) : fileTarget(path);
}

function resolveTarget(ref) {
  const path = resolve(ref);
  if (existsSync(path)) return pathTarget(path);
  const { artifact } = findArtifact(ref);
  if (!existsSync(artifact.path)) throw new HwsError(`artifact ${ref} is no longer at ${artifact.path}`);
  return pathTarget(artifact.path);
}

// The listener refuses paths with a dot segment, so a page under .herdr-workspace serves from its own folder.
function pageRoot(file, workspace) {
  const folder = realOf(workspace.folder);
  if (folder === realOf(home()) || !isInside(folder, file)) return dirname(file);
  const segments = relative(folder, realOf(file)).split(sep);
  return segments.some((part) => part.startsWith('.')) ? dirname(file) : folder;
}

// Takes a copy, so a later edit of the file cannot change what the phone is reviewing.
function snapshotBoard(file) {
  let scene;
  try {
    scene = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new HwsError(`${file} is not valid JSON`);
  }
  if (!Array.isArray(scene?.elements)) throw new HwsError(`${file} is not an Excalidraw scene`);

  const dir = join(phoneDir(), 'boards');
  mkdirSync(dir, { recursive: true });
  const stem = basename(file, extname(file)).replace(/[^\w.-]+/g, '-').replace(/^\.+/, '') || 'board';
  const target = freeName(dir, `${stem}.excalidraw`);
  writeFileSync(target, JSON.stringify(scene));
  return basename(target, '.excalidraw');
}

// The answer is a file on this Mac, which an agent on another machine cannot read.
const isRemote = (terminal) => terminal.includes('/');

function requireLocal(terminal) {
  if (isRemote(terminal)) throw new HwsError(`the phone answers terminals on this computer, and ${terminal} is on another machine`);
}

export async function phoneSend(flags, [ref]) {
  const terminal = requireCallingTerminal(flags);
  requireLocal(terminal);
  const target = resolveTarget(ref);
  const live = requireLive();
  const space = flags.space ?? spaceOfTerminal(terminal);
  const workspace = (space && manifestOfSpace(space)) ?? ensureStandaloneManifest();

  const status = await ensureHost();
  if (!status.paired) throw new HwsError('no phone is paired, so run hws phone pair first');
  if (status.error) throw new HwsError(status.error);

  pruneOld('sends');
  pruneOld('boards');
  const id = newId('p');
  const label = windowOwnerLabel(live, terminal, { space });
  const title = basename(target.file);
  writeJsonAtomic(sendRecord(id), { id, workspace: workspace.id, terminal, label, type: target.type, title, file: target.file, createdAt: Date.now() });

  const where = target.type === 'page' ? { page: target.file, root: pageRoot(target.file, workspace) } : { board: snapshotBoard(target.file) };
  const handoff = await control('POST', '/handoffs', { session: id, label, ...(flags.prompt ? { prompt: flags.prompt } : {}), ...where });
  if (!handoff) throw new HwsError('the phone listener stopped answering');
  return { data: { ...handoff, send: id, type: target.type, file: target.file }, text: `${title} is on your phone. Send there returns to terminal ${terminal}.` };
}

// Terminals that run an agent now, for a whiteboard the phone starts. Each costs one hc get.
export function phoneTargets() {
  const live = requireLive();
  const targets = [];
  const listed = new Set();
  for (const space of live.spaces) {
    for (const tab of space.tabs ?? []) {
      for (const record of tab.terminals ?? []) {
        listed.add(record.terminal);
        if (isRemote(record.terminal) || !isAgentTerminal(terminalInfo(record.terminal))) continue;
        targets.push({ id: record.terminal, label: windowOwnerLabel(live, record.terminal, { space: space.id }) });
      }
    }
  }

  // An agent flipped to Chat has no pane, so only hc lists it.
  for (const { address } of listLocalTerminals()) {
    if (listed.has(address)) continue;
    const info = terminalInfo(address);
    const labels = info?.labels ?? {};
    if (!labels['herdr.chat'] || !isAgentTerminal(info)) continue;
    targets.push({ id: address, label: windowOwnerLabel(live, address, { space: spaceOfTerminal(address, labels) }) });
  }
  return { data: { targets }, text: targets.length ? targets.map((item) => `${item.id}  ${item.label}`).join('\n') : 'No terminal runs an agent.' };
}

// Opens a send for a whiteboard the phone starts, as phone send does for a file. The listener calls this.
export function phoneAccept(flags) {
  const terminal = requireFlag(flags, 'terminal');
  requireLocal(terminal);
  const live = requireLive();
  if (!isAgentTerminal(terminalInfo(terminal))) throw new HwsError(`terminal ${terminal} does not run an agent`);
  const space = flags.space ?? spaceOfTerminal(terminal);
  const workspace = (space && manifestOfSpace(space)) ?? ensureStandaloneManifest();

  pruneOld('sends');
  const id = newId('p');
  const label = windowOwnerLabel(live, terminal, { space });
  writeJsonAtomic(sendRecord(id), { id, workspace: workspace.id, terminal, label, type: 'board', title: 'Whiteboard', createdAt: Date.now() });
  return { data: { send: id, label, terminal }, text: `Whiteboard ${id} answers to terminal ${terminal}.` };
}

function savedAnswer(artifact, why) {
  return { data: { delivered: false, artifact: artifact.id, link: linkFor(artifact.prompt), message: `Saved as artifact ${artifact.id}, because ${why}.` } };
}

// An answer can arrive hours later, and hc send to a shell would run its text as a command.
export function phoneDeliver(flags) {
  const id = requireFlag(flags, 'send');
  if (!existsSync(sendRecord(id))) throw new HwsError(`no phone send ${id}`);
  const send = JSON.parse(readFileSync(sendRecord(id), 'utf8'));
  const bundle = resolve(requireFlag(flags, 'bundle'));
  assertBundle(bundle);

  const promptFile = join(bundle, 'prompt.md');
  const about = send.file ? `about ${send.file}` : 'a new whiteboard';
  writeFileSync(promptFile, `From the phone, ${about}.\n\n${readFileSync(promptFile, 'utf8')}`);
  const manifest = readManifest(send.workspace) ?? ensureStandaloneManifest();
  const artifact = archiveBundle({ manifest, surface: { id: send.id, type: send.type, title: `Phone: ${send.title}`, terminal: send.terminal } }, bundle);

  if (!isTerminalAlive(send.terminal)) return savedAnswer(artifact, `terminal ${send.terminal} has ended`);
  if (isIdleShell(terminalInfo(send.terminal))) return savedAnswer(artifact, `terminal ${send.terminal} no longer runs an agent`);
  try {
    sendText(send.terminal, promptToSend(artifact.prompt));
  } catch (error) {
    return savedAnswer(artifact, `terminal ${send.terminal} did not take it (${error.message})`);
  }
  return { data: { delivered: true, artifact: artifact.id, message: `Sent to ${send.label}` } };
}

function closeOwnTab() {
  const terminal = process.env.HC_TERMINAL_ID;
  const live = terminal && listLive();
  const found = live && findTerminal(live, terminal);
  if (found) act('tab.close', { id: found.tab.id });
}

function openPairTab() {
  const space = windowStatus()?.space ?? undefined;
  const opened = act('tab.new', { name: 'Pair phone', space, folder: home(), argv: ['env', `HWS_HOME=${stateRoot()}`, process.execPath, HWS_BIN, 'phone', 'pair', '--tab'] });
  return { data: { opened: opened.terminal ?? null }, text: 'Opened a Pair phone tab with the QR code.' };
}

const newDevice = (before, devices) => devices.find((device) => !before.includes(device.id));

async function waitForDevice(before) {
  for (let waited = 0; waited < PAIR_MS; waited += PAIR_POLL_MS) {
    await sleep(PAIR_POLL_MS);
    const sheet = await control('GET', '/pair');
    if (!sheet) return { problem: 'The phone listener stopped.' };
    const device = newDevice(before, sheet.devices ?? []);
    if (device) return { device };
    if (!sheet.url) return { problem: 'This pairing code was replaced or closed.' };
  }
  return { problem: 'This pairing code expired. Run hws phone pair again.' };
}

async function showPairing(flags) {
  const status = await ensureHost();
  const quit = async () => {
    await control('DELETE', '/pair');
    process.exit(130);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, quit);

  const sheet = await control('POST', '/pair');
  if (!sheet?.url) throw new HwsError(sheet?.error ?? 'the phone listener gave no pairing code');
  console.log(sheet.qrText);
  console.log('Scan this with the Agent Brief app on your iPad or iPhone.');
  console.log(`Both devices must be on the same network${sheet.network ? ` (${sheet.network})` : ''}.`);
  console.log(`\nOr paste this link into the app:\n${sheet.url}\n`);

  const { device, problem } = await waitForDevice((status.devices ?? []).map((item) => item.id));
  await control('DELETE', '/pair');
  console.log(device ? `Paired ${device.name}.` : problem);
  if (flags.tab) {
    await sleep(PAIRED_PAUSE_MS);
    closeOwnTab();
  }
  if (!device) throw new HwsError(problem);
  return { data: { paired: device.name }, text: '' };
}

export async function phonePair(flags) {
  return process.stdout.isTTY ? showPairing(flags) : openPairTab();
}

function statusText({ devices, handoffs, error }) {
  const paired = devices.length ? `Paired: ${devices.map((item) => item.name).join(', ')}` : 'No phone is paired. Run hws phone pair.';
  return [paired, `Waiting on the phone: ${handoffs.length}`, ...(error ? [error] : [])].join('\n');
}

// A paired phone needs the listener, so this restarts it after Herdr has been closed.
export async function phoneStatus() {
  if (savedDevices().length === 0 && !(await control('GET', '/status'))) {
    return { data: { running: false, paired: false, devices: [], handoffs: [] }, text: 'No phone is paired. Run hws phone pair.' };
  }
  const status = await ensureHost();
  return { data: { running: true, ...status }, text: statusText(status) };
}

export async function phoneForget(_flags, [ref]) {
  const { devices } = await ensureHost();
  const matches = devices.filter((item) => item.id === ref || item.name === ref);
  if (matches.length !== 1) throw new UsageError(`no single paired phone matches ${ref}`);
  await control('POST', '/forget', { id: matches[0].id });
  return { data: { forgotten: matches[0].name }, text: `Forgot ${matches[0].name}` };
}

export async function phoneStop() {
  const answered = await control('POST', '/stop');
  return { data: { stopped: Boolean(answered) }, text: answered ? 'Stopped the phone listener' : 'The phone listener is not running' };
}
