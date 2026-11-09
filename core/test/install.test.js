import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SYSTEM_PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;

function tool(bin, name, script) {
  writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`);
  chmodSync(join(bin, name), 0o755);
}

// Copies the installer into a temporary checkout with fake tools on PATH.
function setup(t, { pnpm = true, claude = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hws-install-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'checkout');
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  const log = join(dir, 'log');
  mkdirSync(home);
  mkdirSync(bin);
  mkdirSync(join(root, 'surface/app'), { recursive: true });
  writeFileSync(log, '');
  for (const path of ['install.sh', 'bin', 'core', 'plugin/.claude-plugin', 'mods/install.sh', 'mods/layouts', 'mods/hws-new', 'surface/pixel-path.sh']) {
    cpSync(join(REPO, path), join(root, path), { recursive: true });
  }

  const pixel = join(root, 'surface/node_modules/@zenbu-labs/pixel/electron/dist');
  tool(bin, 'herdr-app', `echo "herdr-app $*" >> "${log}"`);
  tool(bin, 'hc', 'exit 0');
  tool(bin, 'npm', `echo "npm $*" >> "${log}"
${process.platform === 'darwin' ? `mkdir -p "${pixel}/Electron.app/Contents/MacOS" && : > "${pixel}/Electron.app/Contents/MacOS/pixel" && chmod +x "${pixel}/Electron.app/Contents/MacOS/pixel"` : `mkdir -p "${pixel}" && : > "${pixel}/pixel" && chmod +x "${pixel}/pixel"`}`);
  if (pnpm) tool(bin, 'pnpm', `echo "pnpm $*" >> "${log}"; [ "$1" != build ] || { mkdir -p out/main; : > out/main/index.cjs; }`);
  if (claude) {
    tool(bin, 'claude', `echo "claude $*" >> "${log}"
case "$*" in
  "plugin marketplace list") [ ! -f "${dir}/added" ] || echo herdr-workspaces ;;
  "plugin marketplace add"*) : > "${dir}/added" ;;
  "plugin list --json") echo '[{"id":"herdr-workspaces@herdr-workspaces","enabled":true,"version":"'"$(node -p "require('${root}/plugin/.claude-plugin/plugin.json').version")"'"}]' ;;
esac`);
  }

  const env = { PATH: `${bin}:${SYSTEM_PATH}`, HOME: home, HWS_RELEASE_URL: 'http://127.0.0.1:9/none' };
  const install = (...args) => {
    const result = spawnSync('sh', [join(root, 'install.sh'), ...args], { env, encoding: 'utf8' });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  };
  return { dir, root, home, bin, env, install, calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}

test('a fresh install sets up every part and passes doctor', (t) => {
  const box = setup(t);
  const { code, output } = box.install();
  assert.equal(code, 0, output);
  assert.equal(readlinkSync(join(box.home, '.local/bin/hws')), join(box.root, 'bin/hws'));
  assert.ok(existsSync(join(box.home, '.config/herdr-app/mods/hws-new/mod.json')));
  assert.ok(existsSync(join(box.home, '.config/herdr-app/layouts/hws.json')));
  assert.ok(box.calls().includes('npm ci'));
  assert.ok(box.calls().includes('pnpm install --frozen-lockfile'));
  assert.ok(box.calls().includes(`claude plugin marketplace add ${box.root}`));
  assert.ok(box.calls().includes('claude plugin install herdr-workspaces@herdr-workspaces'));
});

test('a second run skips finished parts and still passes', (t) => {
  const box = setup(t);
  box.install();
  const before = box.calls().length;
  const { code, output } = box.install();
  const again = box.calls().slice(before);
  assert.equal(code, 0, output);
  assert.equal(again.filter((call) => call === 'npm ci').length, 0);
  assert.equal(again.filter((call) => call.startsWith('pnpm')).length, 0);
  assert.equal(again.filter((call) => call.startsWith('claude plugin marketplace add')).length, 0);
});

test('--force reinstalls the surface', (t) => {
  const box = setup(t);
  box.install();
  const before = box.calls().length;
  assert.equal(box.install('--force').code, 0);
  assert.ok(box.calls().slice(before).includes('npm ci'));
  assert.ok(box.calls().slice(before).includes('pnpm build'));
});

test('a failed Pixel download still installs the rest and reports it', (t) => {
  const box = setup(t);
  tool(box.bin, 'npm', 'exit 1');
  const { code, output } = box.install();
  assert.equal(code, 1);
  assert.match(output, /warning: Pixel did not install/);
  assert.match(output, /FAIL {2}Pixel/);
  assert.match(output, /ok {4,}Mods/);
  assert.match(output, /ok {4,}Claude plugin/);
});

test('no pnpm on an untagged checkout warns and finishes', (t) => {
  const box = setup(t, { pnpm: false });
  const { code, output } = box.install();
  assert.equal(code, 1);
  assert.match(output, /warning: pnpm is required/);
  assert.match(output, /FAIL {2}Surface app/);
  assert.match(output, /ok {4,}Mods/);
});

test('no Claude Code skips the plugin and reports it', (t) => {
  const box = setup(t, { claude: false });
  const { code, output } = box.install();
  assert.equal(code, 1);
  assert.match(output, /warning: Claude Code is not on PATH/);
  assert.match(output, /FAIL {2}Claude plugin/);
});

test('a missing Herdr stops before anything is written', (t) => {
  const box = setup(t);
  rmSync(join(box.bin, 'herdr-app'));
  const { code, output } = box.install();
  assert.equal(code, 1);
  assert.match(output, /herdr-app is not on PATH/);
  assert.equal(existsSync(join(box.home, '.local')), false);
});

test('an existing file at the CLI path is never replaced', (t) => {
  const box = setup(t);
  mkdirSync(join(box.home, '.local/bin'), { recursive: true });
  writeFileSync(join(box.home, '.local/bin/hws'), 'mine');
  const { output } = box.install('--force');
  assert.match(output, /belongs to something else/);
  assert.equal(readFileSync(join(box.home, '.local/bin/hws'), 'utf8'), 'mine');
});

test('a symlink to another checkout changes only with --force', (t) => {
  const box = setup(t);
  const link = join(box.home, '.local/bin/hws');
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync('/somewhere/else', link);
  box.install();
  assert.equal(readlinkSync(link), '/somewhere/else');
  box.install('--force');
  assert.equal(readlinkSync(link), join(box.root, 'bin/hws'));
  assert.ok(lstatSync(link).isSymbolicLink());
});

test('unknown flags stop with usage', (t) => {
  const box = setup(t);
  assert.equal(box.install('--nope').code, 2);
});

// Tags the checkout and serves a surface archive for that tag from a local folder.
function release(box, checksum) {
  const git = (...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-C', box.root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'x');
  git('tag', 'v9.9.9');
  const assets = join(box.dir, 'releases/v9.9.9');
  const content = join(box.dir, 'content');
  mkdirSync(assets, { recursive: true });
  mkdirSync(join(content, 'out/main'), { recursive: true });
  writeFileSync(join(content, 'out/main/index.cjs'), 'prebuilt');
  spawnSync('tar', ['-czf', join(assets, 'surface-app.tar.gz'), '-C', content, 'out']);
  const digest = createHash('sha256').update(readFileSync(join(assets, 'surface-app.tar.gz'))).digest('hex');
  writeFileSync(join(assets, 'surface-app.tar.gz.sha256'), `${checksum ?? digest}  surface-app.tar.gz\n`);
  box.env.HWS_RELEASE_URL = `file://${join(box.dir, 'releases')}`;
}

test('a tagged checkout installs the prebuilt surface without pnpm', (t) => {
  const box = setup(t, { pnpm: false });
  release(box);
  const { code, output } = box.install();
  assert.equal(code, 0, output);
  assert.match(output, /downloaded the prebuilt surface for v9\.9\.9/);
  assert.equal(readFileSync(join(box.root, 'surface/app/out/main/index.cjs'), 'utf8'), 'prebuilt');
});

test('an archive with the wrong checksum is rejected and the surface builds instead', (t) => {
  const box = setup(t);
  release(box, '0'.repeat(64));
  const { code, output } = box.install();
  assert.equal(code, 0, output);
  assert.match(output, /could not download the prebuilt surface/);
  assert.equal(readFileSync(join(box.root, 'surface/app/out/main/index.cjs'), 'utf8'), '');
  assert.ok(box.calls().includes('pnpm build'));
});
