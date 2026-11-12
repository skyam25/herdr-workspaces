// Proves Pop in on a surface shown in its own window, against the fake hws.
//
//   node scripts/verify-window.mjs
//
// Starts the host with HWS_SURFACE_WINDOW=1 and a debugging port, and drives the page over CDP.
// A real window shows for a few seconds at a time. Exits nonzero when a check fails.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACE = resolve(APP, '..');
const ROOT = '/tmp/hws-surface-verify-window';
const PIXEL = execFileSync('sh', [join(SURFACE, 'pixel-path.sh')], { encoding: 'utf8' }).trim();
const NOTE_TEXT = 'Ship the window first.';

const results = [];

function check(scenario, name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${scenario} ${name} ${detail}`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(test, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await test().catch(() => undefined);
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Starts one window host. A fresh start clears the surface's folder, and a reopen keeps it. */
function startWindow({ id, type, file = '', folder, port, fresh = true }) {
  const root = join(ROOT, id);
  if (fresh) rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  const drop = /^(HERDR|GHOSTTY|TERM_PROGRAM|KITTY|TMUX|ELECTRON_RUN_AS_NODE|TERMINAL_BROWSER|COMPANION_|HWS_|HC_|PIXEL_)/;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !drop.test(key)));
  Object.assign(env, {
    HWS_SURFACE_WINDOW: '1',
    XDG_CACHE_HOME: join(root, 'cache'),
    XDG_STATE_HOME: join(root, 'data/state'),
    HWS_HOME: join(root, 'state'),
    HWS_SURFACE_ID: id,
    HWS_WORKSPACE_ID: 'spc1',
    HWS_TERMINAL: 't1',
    HWS_SURFACE_TYPE: type,
    HWS_SURFACE_TITLE: 'demo',
    HWS_SURFACE_FILE: file,
    HWS_SURFACE_OWNER: 'verify / t1',
    HWS_FOLDER: folder ?? root,
    COMPANION_SOCKET: `/tmp/hws-win-${id}.sock`,
    COMPANION_DATA_DIR: join(root, 'data'),
    HWS_BIN: join(SURFACE, 'test/fake-hws'),
    HWS_CLIPBOARD_FILE: join(root, 'clipboard.txt'),
    FAKE_HWS_DIR: join(root, 'hws'),
    FAKE_HWS_MODE: 'glued',
    FAKE_HWS_CLOSE: '0',
  });
  rmSync(env.COMPANION_SOCKET, { force: true });
  const child = spawn(PIXEL, [`--remote-debugging-port=${port}`, join(SURFACE, 'host.cjs')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const log = join(root, 'hws/hws.log');
  return {
    root,
    data: join(root, 'data'),
    child,
    port,
    stderr: () => stderr,
    log: () => (existsSync(log) ? readFileSync(log, 'utf8') : ''),
  };
}

/** Ends the host and waits for it, so only one window shows at a time. */
async function stopWindow(host) {
  if (host.child.exitCode !== null) return;
  const exited = new Promise((done) => host.child.once('exit', done));
  host.child.kill('SIGTERM');
  await Promise.race([exited, sleep(4000)]);
  if (host.child.exitCode === null) {
    host.child.kill('SIGKILL');
    await exited;
  }
}

/** Opens a CDP session on the panel's page. */
async function attach(host) {
  const page = await until(async () => {
    const list = await (await fetch(`http://127.0.0.1:${host.port}/json/list`)).json();
    return list.find((target) => target.type === 'page' && target.url.includes('index.html'));
  }, 30000, 'the panel page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const waiting = new Map();
  let next = 1;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
  };
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = fail;
  });
  const send = (method, params = {}) => {
    const id = next++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((done) => waiting.set(id, done));
  };
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return { send, evaluate, close: () => socket.close() };
}

const drafts = (data) => {
  const folder = join(data, 'drafts');
  return existsSync(folder) ? readdirSync(folder).map((name) => readFileSync(join(folder, name), 'utf8')).join('\n') : '';
};

const POP_IN = '[data-testid="surface-pop-in"]';

async function pressPopIn(name, host, page) {
  check(name, 'no_pop_out', !(await page.evaluate('!!document.querySelector(\'[data-testid="surface-pop-out"]\')')));
  await page.evaluate(`document.querySelector('${POP_IN}').click()`);
  const line = `surface pop --id ${name} --to pane --json`;
  const log = await until(async () => host.log().includes(line) && host.log(), 10000, 'surface pop').catch(() => host.log());
  check(name, 'pop_in_called', log.includes(line), log.trim().split('\n').at(-1) ?? '');
}

async function pageScenario() {
  const name = 'wpage';
  const folder = join(ROOT, 'proj-page');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, 'demo.html');
  writeFileSync(file, '<!doctype html><body style="font:20px -apple-system;padding:40px"><h1>Review page</h1><p>Body text</p></body>');
  const host = startWindow({ id: name, type: 'page', file, folder, port: 9341 });
  try {
    const page = await attach(host);
    const shown = await until(() => page.evaluate(`!!document.querySelector('${POP_IN}') && !!document.querySelector('iframe')`), 30000, 'Pop in and the page').catch(() => false);
    check(name, 'pop_in_shown', shown);
    const label = await page.evaluate(`document.querySelector('${POP_IN}')?.textContent`);
    check(name, 'pop_in_label', label === 'Pop in', label);
    if (shown) await pressPopIn(name, host, page);
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    if (shot.result?.data) writeFileSync(join(host.root, 'window.png'), Buffer.from(shot.result.data, 'base64'));
    page.close();
  } finally {
    await stopWindow(host);
  }
}

async function noteScenario() {
  const name = 'wnote';
  const host = startWindow({ id: name, type: 'note', port: 9342 });
  try {
    const page = await attach(host);
    const ready = await until(() => page.evaluate(`!!document.querySelector('${POP_IN}') && !!document.querySelector('[contenteditable="true"]')`), 30000, 'the note').catch(() => false);
    check(name, 'pop_in_shown', ready);
    if (ready) {
      await page.evaluate('document.querySelector(\'[contenteditable="true"]\').focus()');
      await page.send('Input.insertText', { text: NOTE_TEXT });

      // Pop in runs before the autosave would, so the text reaches disk through the flush.
      await pressPopIn(name, host, page);
      check(name, 'draft_on_disk', drafts(host.data).includes(NOTE_TEXT));
    }
    page.close();
  } finally {
    await stopWindow(host);
  }

  const again = startWindow({ id: name, type: 'note', port: 9343, fresh: false });
  try {
    const page = await attach(again);
    const text = await until(() => page.evaluate(`document.querySelector('[contenteditable="true"]')?.innerText.includes(${JSON.stringify(NOTE_TEXT)})`), 30000, 'the note text').catch(() => false);
    check(name, 'text_after_reopen', text);
    page.close();
  } finally {
    await stopWindow(again);
  }
}

async function moveScenario() {
  const name = 'wmove';
  const host = startWindow({ id: name, type: 'board', port: 9344 });
  try {
    const page = await attach(host);
    const chip = '[data-testid="surface-workspace"]';
    const shown = await until(() => page.evaluate(`!!document.querySelector('${chip}')`), 30000, 'the workspace chip').catch(() => false);
    check(name, 'chip_shown', shown);
    check(name, 'chip_unfiled', (await page.evaluate(`document.querySelector('${chip}')?.textContent`)) === 'Unfiled');
    await page.evaluate(`document.querySelector('${chip}').click()`);
    const listed = await until(() => page.evaluate(`!!document.querySelector('[data-testid="move-to-w2"]')`), 10000, 'the move menu').catch(() => false);
    check(name, 'menu_lists_workspaces', listed);
    check(name, 'menu_suggests', (await page.evaluate(`document.querySelector('[data-testid="move-menu"] h3')?.textContent`)) === 'Suggested');
    await page.evaluate(`document.querySelector('[data-testid="move-to-w2"]').click()`);
    const line = `surface move --id ${name} --workspace w2 --json`;
    const log = await until(async () => host.log().includes(line) && host.log(), 10000, 'surface move').catch(() => host.log());
    check(name, 'move_called', log.includes(line), log.trim().split('\n').at(-1) ?? '');
    page.close();
  } finally {
    await stopWindow(host);
  }
}

for (const scenario of [pageScenario, noteScenario, moveScenario]) {
  try {
    await scenario();
  } catch (err) {
    check(scenario.name, 'ran', false, err.message);
  }
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
