// Proves a board and a review page work in a plain web view, against the fake hws.
//
//   node scripts/verify-web.mjs [webkit] [chromium]
//
// Starts the real main process with HWS_SURFACE_WEB=1 and drives the page headlessly.
// Exits nonzero when a check fails.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACE = resolve(APP, '..');
const ROOT = '/tmp/hws-surface-verify-web';
const VIEWPORT = { width: 1750, height: 1070 };
const ENGINES = { webkit, chromium };
const STROKE_STEPS = 240;

const results = [];

function check(engine, name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${engine} ${name} ${detail}`);
}

async function until(test, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await test();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function startSurface(id, { type = 'board', title = 'flow', file = () => '' } = {}) {
  const root = join(ROOT, id);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  const drop = /^(HERDR|GHOSTTY|TERM_PROGRAM|KITTY|TMUX|ELECTRON_RUN_AS_NODE|TERMINAL_BROWSER|COMPANION_|HWS_|HC_)/;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !drop.test(key)));
  Object.assign(env, {
    HWS_SURFACE_WEB: '1',
    XDG_CACHE_HOME: join(root, 'cache'),
    HWS_HOME: join(root, 'state'),
    HWS_SURFACE_ID: id,
    HWS_WORKSPACE_ID: 'spc1',
    HWS_TERMINAL: 't1',
    HWS_SURFACE_TYPE: type,
    HWS_SURFACE_TITLE: title,
    HWS_SURFACE_FILE: file(root),
    HWS_FOLDER: root,
    COMPANION_SOCKET: `/tmp/hws-w-${id}.sock`,
    COMPANION_DATA_DIR: join(root, 'data'),
    HWS_BIN: join(SURFACE, 'test/fake-hws'),
    HWS_CLIPBOARD_FILE: join(root, 'clipboard.txt'),
    FAKE_HWS_DIR: join(root, 'hws'),
    FAKE_HWS_MODE: 'glued',
    FAKE_HWS_CLOSE: '0',
  });
  const child = spawn('/bin/zsh', [join(SURFACE, 'run.sh')], { env, stdio: 'ignore', detached: true });
  return { child, root, urlFile: join(root, 'data/web-url'), fake: join(root, 'hws') };
}

// Counts animation frames and the delay from each pointer move to the next frame.
const installMeter = () => {
  const meter = { frames: 0, last: 0, gaps: [], delays: [], moves: [], running: true };
  const tick = (now) => {
    if (!meter.running) return;
    if (meter.last) meter.gaps.push(now - meter.last);
    meter.last = now;
    meter.frames++;
    for (const at of meter.moves.splice(0)) meter.delays.push(now - at);
    requestAnimationFrame(tick);
  };
  addEventListener('pointermove', (event) => meter.moves.push(event.timeStamp), true);
  requestAnimationFrame(tick);
  window.__meter = meter;
};

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;

async function strokeAndMeasure(page) {
  await page.evaluate(installMeter);
  await page.keyboard.press('p');
  await page.mouse.move(400, 400);
  await page.mouse.down();
  const started = Date.now();
  for (let i = 0; i < STROKE_STEPS; i++) {
    await page.mouse.move(400 + i * 3, 400 + ((i % 40) - 20) * 6);
    await new Promise((done) => setTimeout(done, 16));
  }
  const seconds = (Date.now() - started) / 1000;
  await page.mouse.up();
  const meter = await page.evaluate(() => {
    window.__meter.running = false;
    return { frames: window.__meter.frames, gaps: window.__meter.gaps, delays: window.__meter.delays };
  });
  return { fps: meter.frames / seconds, gap: median(meter.gaps), gapP95: p95(meter.gaps), delay: median(meter.delays), delayP95: p95(meter.delays), moves: meter.delays.length };
}

const fixed = (n) => n.toFixed(1);

async function runEngine(name) {
  const surface = startSurface(`${name}1`);
  const browser = await ENGINES[name].launch();
  const errors = [];
  try {
    const url = await until(() => existsSync(surface.urlFile) && readFileSync(surface.urlFile, 'utf8'), 30000, 'the web url');
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url);
    await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
    check(name, 'board_renders', true);
    check(name, 'token_leaves_url', !page.url().includes('#t='), page.url());
    check(name, 'no_pop_in_web', (await page.locator('[data-testid^="surface-pop"]').count()) === 0);

    await page.waitForTimeout(1500);
    const stats = await strokeAndMeasure(page);
    console.log(`INFO ${name} stroke fps=${fixed(stats.fps)} frame_gap_ms=${fixed(stats.gap)} p95=${fixed(stats.gapP95)} move_to_frame_ms=${fixed(stats.delay)} p95=${fixed(stats.delayP95)} moves=${stats.moves}`);
    check(name, 'stroke_frames', stats.frames !== 0 && stats.moves > 0);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(surface.root, 'after-stroke.png') });

    await page.keyboard.press('Meta+Enter');
    const log = join(surface.fake, 'hws.log');
    const done = await until(() => existsSync(log) && readFileSync(log, 'utf8').includes('surface done') && readFileSync(log, 'utf8'), 20000, 'surface done').catch(() => '');
    check(name, 'cmd_enter_done', done.includes('surface done'), done.split('\n')[0] ?? '');

    const artifact = join(surface.fake, 'artifacts/a0');

    // The fake hws logs before it moves the bundle.
    await until(() => existsSync(join(artifact, 'prompt.md')), 5000, 'the artifact').catch(() => {});
    const files = existsSync(artifact) ? readdirSync(artifact, { recursive: true }).map(String) : [];
    check(name, 'artifact', files.includes('prompt.md'), files.slice(0, 6).join(' '));
    check(name, 'board_image_in_artifact', files.some((file) => file.endsWith('.png')));

    const real = errors.filter((text) => !/favicon|Failed to load resource/.test(text));
    check(name, 'no_page_errors', real.length === 0, real.slice(0, 4).join(' | ').slice(0, 400));
  } finally {
    await browser.close();
    try {
      process.kill(-surface.child.pid, 'SIGTERM');
    } catch {}
  }
}

// A review page in the surface's frame, served over loopback with the overlay.
function demoPage(root) {
  const folder = join(root, 'proj');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, 'demo.html');
  writeFileSync(
    file,
    '<!doctype html><body style="font:20px -apple-system;padding:40px"><h1>Review page</h1>' +
      '<p id="p"></p><script>document.getElementById("p").textContent = "companion: " + typeof window.companion;</script></body>',
  );
  return file;
}

async function runPage(name) {
  const surface = startSurface(`${name}page`, { type: 'page', title: 'demo', file: demoPage });
  const browser = await ENGINES[name].launch();
  const errors = [];
  try {
    const url = await until(() => existsSync(surface.urlFile) && readFileSync(surface.urlFile, 'utf8'), 30000, 'the web url');
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url);
    const frameElement = await page.waitForSelector('[data-testid="review-frame"]', { timeout: 30000 });
    const frame = await until(async () => {
      const found = await frameElement.contentFrame();
      return found && found.url().startsWith('http://127.0.0.1:') ? found : null;
    }, 15000, 'the review frame');
    check(name, 'page_over_loopback', new URL(frame.url()).origin !== new URL(url).origin, frame.url());
    await frame.waitForSelector('h1', { timeout: 15000 });
    check(name, 'page_renders', (await frame.textContent('h1')) === 'Review page');
    await until(() => frame.evaluate(() => !!document.querySelector('agent-brief-overlay')), 10000, 'the overlay').catch(() => false);
    check(name, 'overlay_loaded', await frame.evaluate(() => !!document.querySelector('agent-brief-overlay')));
    check(name, 'page_has_no_bridge', (await frame.textContent('#p')) === 'companion: undefined', await frame.textContent('#p'));

    // A box inside a frame is already in page coordinates.
    const heading = await frame.locator('h1').boundingBox();
    await page.mouse.click(heading.x + 40, heading.y + heading.height / 2);
    await page.waitForTimeout(800);
    await page.keyboard.type('tighten this', { delay: 20 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(surface.root, 'page-pinned.png') });
    await page.keyboard.press('Meta+Enter');

    const artifact = join(surface.fake, 'artifacts/a0');
    await until(() => existsSync(join(artifact, 'review.md')), 20000, 'the review').catch(() => {});
    const review = existsSync(join(artifact, 'review.md')) ? readFileSync(join(artifact, 'review.md'), 'utf8') : '';
    check(name, 'comment_in_review', review.includes('tighten this'), review.split('\n').slice(0, 6).join(' | '));
    const images = existsSync(join(artifact, 'images')) ? readdirSync(join(artifact, 'images')) : [];
    check(name, 'comment_picture', review.includes('- Picture:') && images.length === 1, images.join(' '));

    const real = errors.filter((text) => !/favicon|Failed to load resource/.test(text));
    check(name, 'no_page_errors_on_page', real.length === 0, real.slice(0, 4).join(' | ').slice(0, 400));
  } finally {
    await browser.close();
    try {
      process.kill(-surface.child.pid, 'SIGTERM');
    } catch {}
  }
}

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ENGINES)) {
  await runEngine(name);
  await runPage(name);
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
