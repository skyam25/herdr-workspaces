import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
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

const ranPnpm = (calls, args) => calls.some((call) => call.startsWith('npm exec') && call.endsWith(`-- pnpm ${args}`));

// Copies the installer into a temporary checkout with fake tools on PATH.
function setup(t, { claude = true } = {}) {
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
${process.platform === 'darwin' ? `mkdir -p "${pixel}/Electron.app/Contents/MacOS" && : > "${pixel}/Electron.app/Contents/MacOS/pixel" && chmod +x "${pixel}/Electron.app/Contents/MacOS/pixel"` : `mkdir -p "${pixel}" && : > "${pixel}/pixel" && chmod +x "${pixel}/pixel"`}
case "$*" in *"-- pnpm build") mkdir -p out/main; : > out/main/index.cjs ;; esac`);
  if (claude) {
    tool(bin, 'claude', `echo "claude $*" >> "${log}"
case "$*" in
  "plugin marketplace list") [ ! -f "${dir}/added" ] || echo herdr-workspaces ;;
  "plugin marketplace add"*) : > "${dir}/added" ;;
  "plugin list --json") echo '[{"id":"herdr-workspaces@herdr-workspaces","enabled":true,"version":"'"$(node -p "require('${root}/plugin/.claude-plugin/plugin.json').version")"'"}]' ;;
esac`);
  }

  const env = { PATH: `${bin}:${SYSTEM_PATH}`, HOME: home, HWS_RELEASE_URL: 'http://127.0.0.1:9/none', HWS_RETRY_SECONDS: '0' };
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
  assert.ok(ranPnpm(box.calls(), 'install --frozen-lockfile'));
  assert.ok(box.calls().includes(`claude plugin marketplace add ${box.root}`));
  assert.ok(box.calls().includes('claude plugin install herdr-workspaces@herdr-workspaces'));
  assert.match(output, /== Next[\s\S]*\/reload-plugins/);
});

test('a second run skips finished parts and still passes', (t) => {
  const box = setup(t);
  box.install();
  const before = box.calls().length;
  const { code, output } = box.install();
  const again = box.calls().slice(before);
  assert.equal(code, 0, output);
  assert.equal(again.filter((call) => call === 'npm ci').length, 0);
  assert.equal(again.filter((call) => call.includes('-- pnpm')).length, 0);
  assert.equal(again.filter((call) => call.startsWith('claude plugin marketplace add')).length, 0);
});

test('--force reinstalls the surface', (t) => {
  const box = setup(t);
  box.install();
  const before = box.calls().length;
  assert.equal(box.install('--force').code, 0);
  assert.ok(box.calls().slice(before).includes('npm ci'));
  assert.ok(ranPnpm(box.calls().slice(before), 'build'));
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
  assert.doesNotMatch(output, /== Next/);
});

test('a Pixel download that fails twice is retried and succeeds', (t) => {
  const box = setup(t);
  renameSync(join(box.bin, 'npm'), join(box.bin, 'npm-real'));
  const count = join(box.dir, 'count');
  writeFileSync(count, '0');
  tool(box.bin, 'npm', `[ "$1" = ci ] || exec npm-real "$@"; n=$(($(cat "${count}") + 1)); echo $n > "${count}"; [ $n -ge 3 ] || exit 1; exec npm-real "$@"`);

  const { code, output } = box.install();

  assert.equal(code, 0, output);
  assert.equal(readFileSync(count, 'utf8').trim(), '3');
  assert.match(output, /attempt 2 of 4/);
});

test('npm may run the install script of the pinned Pixel', () => {
  const { dependencies, allowScripts } = JSON.parse(readFileSync(join(REPO, 'surface/package.json'), 'utf8'));
  assert.equal(allowScripts[`@zenbu-labs/pixel@${dependencies['@zenbu-labs/pixel']}`], true);
});

test('a surface build that fails warns and finishes', (t) => {
  const box = setup(t);
  renameSync(join(box.bin, 'npm'), join(box.bin, 'npm-real'));
  tool(box.bin, 'npm', '[ "$1" != exec ] || exit 1; exec npm-real "$@"');
  const { code, output } = box.install();
  assert.equal(code, 1);
  assert.match(output, /warning: the surface did not build/);
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

test('--force rewrites only the mod files that changed', (t) => {
  const box = setup(t);
  const source = join(box.root, 'mods/hws-new');
  const installed = join(box.home, '.config/herdr-app/mods/hws-new');
  const layout = join(box.home, '.config/herdr-app/layouts/hws.json');
  mkdirSync(join(source, 'core'));
  writeFileSync(join(source, 'core/changed.js'), 'old');
  writeFileSync(join(source, 'core/same.js'), 'same');
  box.install();

  const untouched = [join(installed, 'mod.json'), join(installed, 'core/same.js'), layout];
  const past = new Date('2020-01-01T00:00:00Z');
  for (const file of untouched) utimesSync(file, past, past);
  writeFileSync(join(source, 'core/changed.js'), 'new');

  const { code, output } = box.install('--force');

  assert.equal(code, 0, output);
  assert.equal(readFileSync(join(installed, 'core/changed.js'), 'utf8'), 'new');
  for (const file of untouched) assert.equal(statSync(file).mtimeMs, past.getTime(), file);
  assert.match(output, /hws-new: updated 1 file/);
});

const SWITCH = 'herdr-app do layout.switch --name hws';

test('a new install shows the hws layout and later runs leave the window alone', (t) => {
  const box = setup(t);
  const { code, output } = box.install();
  assert.equal(code, 0, output);
  assert.match(output, /now shows the hws layout/);
  assert.ok(box.calls().includes(SWITCH));

  const before = box.calls().length;
  box.install('--force');
  assert.equal(box.calls().slice(before).includes(SWITCH), false);
});

test('a layout the person already has is never switched to', (t) => {
  const box = setup(t);
  mkdirSync(join(box.home, '.config/herdr-app/layouts'), { recursive: true });
  writeFileSync(join(box.home, '.config/herdr-app/layouts/hws.json'), '{}');
  box.install();
  assert.equal(box.calls().includes(SWITCH), false);
});

test('a closed Herdr window gets the command to run later', (t) => {
  const box = setup(t);
  tool(box.bin, 'herdr-app', '[ "$1" != do ] || exit 2');
  const { code, output } = box.install();
  assert.equal(code, 0, output);
  assert.match(output, /Herdr is not open.*layout\.switch --name hws/);
});

test('a mod that fails its check keeps the window on its layout', (t) => {
  const box = setup(t);
  tool(box.bin, 'herdr-app', `echo "herdr-app $*" >> "${join(box.dir, 'log')}"; [ "$1" != check ] || exit 1`);
  box.install();
  assert.equal(box.calls().includes(SWITCH), false);
});

test('unknown flags stop with usage', (t) => {
  const box = setup(t);
  assert.equal(box.install('--nope').code, 2);
});

// Commits the checkout and serves a surface archive for its surface/app tree from a local folder.
function release(box, checksum) {
  const git = (...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-C', box.root, ...args], { encoding: 'utf8' });
  writeFileSync(join(box.root, 'surface/app/package.json'), '{}');
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'x');
  const archive = `surface-${git('rev-parse', 'HEAD:surface/app').stdout.trim()}.tar.gz`;
  const assets = join(box.dir, 'releases/surface-prebuilt');
  const content = join(box.dir, 'content');
  mkdirSync(assets, { recursive: true });
  mkdirSync(join(content, 'out/main'), { recursive: true });
  mkdirSync(join(content, 'bin'));
  writeFileSync(join(content, 'out/main/index.cjs'), 'prebuilt');
  writeFileSync(join(content, 'bin/agent-brief.mjs'), 'cli');
  spawnSync('tar', ['-czf', join(assets, archive), '-C', content, 'out', 'bin']);
  const digest = createHash('sha256').update(readFileSync(join(assets, archive))).digest('hex');
  writeFileSync(join(assets, `${archive}.sha256`), `${checksum ?? digest}  ${archive}\n`);
  box.env.HWS_RELEASE_URL = `file://${join(box.dir, 'releases')}`;
}

test('a clean checkout installs the prebuilt surface without building', (t) => {
  const box = setup(t);
  release(box);
  const { code, output } = box.install();
  assert.equal(code, 0, output);
  assert.match(output, /downloaded the prebuilt surface/);
  assert.equal(readFileSync(join(box.root, 'surface/app/out/main/index.cjs'), 'utf8'), 'prebuilt');
  assert.equal(readFileSync(join(box.root, 'surface/app/bin/agent-brief.mjs'), 'utf8'), 'cli');
  assert.equal(box.calls().filter((call) => call.includes('-- pnpm')).length, 0);
});

test('local edits to the surface build instead of downloading', (t) => {
  const box = setup(t);
  release(box);
  writeFileSync(join(box.root, 'surface/app/package.json'), '{"edited":true}');
  const { code, output } = box.install();
  assert.equal(code, 0, output);
  assert.doesNotMatch(output, /downloaded the prebuilt surface/);
  assert.ok(ranPnpm(box.calls(), 'build'));
});

test('an archive with the wrong checksum is rejected and the surface builds instead', (t) => {
  const box = setup(t);
  release(box, '0'.repeat(64));
  const { code, output } = box.install();
  assert.equal(code, 0, output);
  assert.match(output, /no prebuilt surface for this commit/);
  assert.equal(readFileSync(join(box.root, 'surface/app/out/main/index.cjs'), 'utf8'), '');
  assert.ok(ranPnpm(box.calls(), 'build'));
});

function commitAll(root) {
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first']]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
}

const stamp = (box) => join(box.home, '.local/state/herdr-workspaces/install-version');

test('a finished install records its version and doctor agrees', (t) => {
  const box = setup(t);
  commitAll(box.root);
  const { code, output } = box.install();
  assert.equal(code, 0, output);
  assert.match(readFileSync(stamp(box), 'utf8'), /^[0-9a-f]{16}\n$/);
  assert.match(output, /ok {2,}Installed version/);
});

test('a run that skips built parts keeps the recorded version', (t) => {
  const box = setup(t);
  commitAll(box.root);
  box.install();
  writeFileSync(stamp(box), 'older\n');
  assert.equal(box.install().code, 0);
  assert.equal(readFileSync(stamp(box), 'utf8'), 'older\n');
});

test('a forced run replaces the recorded version', (t) => {
  const box = setup(t);
  commitAll(box.root);
  box.install();
  writeFileSync(stamp(box), 'older\n');
  assert.equal(box.install('--force').code, 0);
  assert.notEqual(readFileSync(stamp(box), 'utf8'), 'older\n');
});

test('a forced run whose surface build fails records nothing', (t) => {
  const box = setup(t);
  commitAll(box.root);
  box.install();
  writeFileSync(stamp(box), 'older\n');
  tool(box.bin, 'npm', `echo "npm $*" >> /dev/null
case "$*" in *pnpm*) exit 1 ;; esac`);
  box.install('--force');
  assert.equal(readFileSync(stamp(box), 'utf8'), 'older\n');
});

test('a forced run with local edits removes the recorded version', (t) => {
  const box = setup(t);
  commitAll(box.root);
  box.install();
  writeFileSync(join(box.root, 'install.sh'), `${readFileSync(join(box.root, 'install.sh'), 'utf8')}\n`);
  assert.equal(box.install('--force').code, 0);
  assert.equal(existsSync(stamp(box)), false);
});
