import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

import { HwsError } from './errors.js';

const MAX_OUTPUT = 32 * 1024 * 1024;
const READ_MS = 10_000;
const ACT_MS = 60_000;
const SHELLS = /^-?(zsh|bash|fish|sh|dash|ksh|nu|pwsh)$/;

function herdrBin() {
  return process.env.HWS_HERDR_APP || 'herdr-app';
}

function hcBin() {
  return process.env.HWS_HC || 'hc';
}

function run(bin, args, timeout) {
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: MAX_OUTPUT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    failure: result.error?.message,
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

let liveListing;

// Returns null when the window does not answer. A process lists the window
// once, and `act` clears that answer because it changes the window.
export function listLive() {
  if (liveListing === undefined) {
    const result = run(herdrBin(), ['ls'], READ_MS);
    const live = result.ok ? parseJson(result.stdout) : null;
    liveListing = Array.isArray(live?.spaces) ? live : null;
  }
  return liveListing;
}

// Herdr selects every new tab, so this puts the window back where the person was.
export function keepingSelection(work) {
  const before = windowStatus();
  const result = work();
  if (before?.space) act('space.select', { id: before.space });
  if (before?.tab) act('tab.select', { id: before.tab });
  return result;
}

export function requireLive() {
  const live = listLive();
  if (!live) throw new HwsError('the Herdr window did not answer');
  return live;
}

// Returns null when the window does not answer.
export function windowStatus() {
  const result = run(herdrBin(), ['status'], READ_MS);
  return result.ok ? parseJson(result.stdout) : null;
}

export function act(command, args = {}) {
  liveListing = undefined;
  const argv = ['do', command];
  for (const [name, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    argv.push(`--${name}`, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const result = run(herdrBin(), argv, ACT_MS);
  const reply = parseJson(result.stdout);
  if (!result.ok || reply?.error) {
    const detail = reply?.error ?? (result.stderr.trim() || result.failure);
    throw new HwsError(detail || `herdr-app do ${command} failed`);
  }
  return reply ?? {};
}

// Closing the pane ends the host that called hws, and hws with it.
// A separate session keeps the focus step alive through that hangup.
// `kind` is the pane.focus flag that `target` fills, terminal or pane.
export async function closePaneThenFocus(pane, target, kind = 'terminal') {
  const script = '"$0" do pane.close --pane "$1"; "$0" do pane.focus "--$2" "$3"';
  const child = spawn('/bin/sh', ['-c', script, herdrBin(), pane, kind, target], {
    detached: true,
    stdio: 'ignore',
  });
  await once(child, 'exit');
}

function runInBackground(flags, cwd, argv) {
  const result = run(hcBin(), ['run', '--bg', '--json', ...flags, '--cwd', cwd, '--', ...argv], ACT_MS);
  const reply = parseJson(result.stdout);
  if (!result.ok || !reply?.address) {
    throw new HwsError(result.stderr.trim() || result.stdout.trim() || result.failure || 'hc run failed');
  }
  return reply;
}

// Starts a program in a terminal with no pane, tied to nothing that can end it early.
export function runDetached(argv, cwd) {
  return runInBackground(['--no-parent', '--no-notify', '--rm'], cwd, argv).address;
}

export function startWorker({ name, label, cwd, argv }) {
  return runInBackground(['--name', name, '--label', label], cwd, argv);
}

export function killTerminal(terminal) {
  return run(hcBin(), ['kill', terminal], READ_MS).ok;
}

// Shows the terminal, or its chat pane when flipped, and brings the Herdr window forward.
export function focusTerminal(terminal) {
  const chatPane = chatPaneOf(terminal);
  act('pane.focus', chatPane ? { pane: chatPane } : { terminal });
  if (process.platform === 'darwin') {
    run(process.env.HWS_OSASCRIPT || '/usr/bin/osascript', ['-e', 'tell application id "dev.herdr.app" to activate'], READ_MS);
  }
}

export function sendText(terminal, text) {
  const result = run(hcBin(), ['send', terminal, text], ACT_MS);
  if (!result.ok) {
    throw new HwsError(result.stderr.trim() || result.stdout.trim() || result.failure || 'hc send failed');
  }
}

// Returns null for an unknown terminal or a core that does not answer.
export function terminalInfo(terminal) {
  const result = run(hcBin(), ['get', terminal, '--json'], READ_MS);
  const info = result.ok ? parseJson(result.stdout) : null;
  return info && !info.error ? info : null;
}

// Returns the chat pane that shows a flipped agent, or null for any other terminal.
export function chatPaneOf(terminal) {
  return terminalInfo(terminal)?.labels?.['herdr.chat'] || null;
}

function isLive(info) {
  return Boolean(info) && info.exit_code == null && (info.state ?? 'live') === 'live';
}

export function isTerminalAlive(terminal) {
  return isLive(terminalInfo(terminal));
}

export function isLiveChild(terminal, parent) {
  const info = terminalInfo(terminal);
  return isLive(info) && info.parent === parent;
}

// A live terminal whose foreground program is not a shell.
export function isAgentTerminal(info) {
  return isLive(info) && !isIdleShell(info);
}

export function isIdleShell(info) {
  if (!isLive(info)) return false;
  const program = info.foreground?.name ?? info.foreground?.argv?.[0] ?? info.argv?.[0] ?? '';
  return SHELLS.test(program.split('/').pop());
}

function subAgentAddresses(record) {
  return (record.sub_agents ?? []).map((agent) => agent?.terminal ?? agent);
}

// Finds a terminal in `herdr-app ls`. A sub-agent reports its parent's pane.
export function findTerminal(live, terminal) {
  for (const space of live.spaces) {
    for (const tab of space.tabs ?? []) {
      for (const record of tab.terminals ?? []) {
        if (record.terminal === terminal || subAgentAddresses(record).includes(terminal)) {
          return { space, tab, record, pane: record.pane };
        }
      }
    }
  }
  return null;
}
