import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { checkout, commitsBehind, installedVersion, installVersion, recordInstall } from '../checkout.js';
import { home } from '../paths.js';

const PLUGIN_ID = 'herdr-workspaces@herdr-workspaces';
const SHIPPED = /\.(js|json|svg|py)$/;
const PROBE_MS = 30_000;

const appHome = () => process.env.HERDR_APP_HOME || join(home(), '.config/herdr-app');
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const install = (args = '') => `Run sh ${join(checkout(), 'install.sh')}${args}`;

function probe(bin, args) {
  return spawnSync(bin, args, { encoding: 'utf8', timeout: PROBE_MS, stdio: ['ignore', 'pipe', 'pipe'] });
}

function allFiles(dir, prefix) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? allFiles(join(dir, entry.name), path) : [path];
  });
}

// Matches the files that mods/install.sh copies. Herdr writes jsconfig.json itself.
function modFiles(dir) {
  const top = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SHIPPED.test(entry.name) && entry.name !== 'jsconfig.json')
    .map((entry) => entry.name);
  return existsSync(join(dir, 'core')) ? [...top, ...allFiles(join(dir, 'core'), 'core')] : top;
}

function checkNode() {
  const version = process.versions.node;
  return { name: 'Node', ok: Number(version.split('.')[0]) >= 20, detail: version, fix: 'Install Node 20 or newer' };
}

function checkTool(name, bin) {
  return { name, ok: !probe(bin, ['--version']).error, detail: bin, fix: `Install Herdr and put ${bin} on PATH` };
}

// Mods run hws from this exact path.
function checkLink() {
  const link = join(home(), '.local/bin/hws');
  const ok = existsSync(link) && realpathSync(link) === realpathSync(join(checkout(), 'bin/hws'));
  return { name: 'CLI link', ok, detail: link, fix: install(' --force') };
}

function checkMods() {
  const source = join(checkout(), 'mods');
  const mods = readdirSync(source).filter((name) => name.startsWith('hws-'));
  const problems = mods.flatMap((mod) => {
    const installed = join(appHome(), 'mods', mod);
    if (!existsSync(installed)) return [`${mod} is missing`];
    const same = modFiles(join(source, mod)).every((file) => {
      const copy = join(installed, file);
      return existsSync(copy) && hash(copy) === hash(join(source, mod, file));
    });
    return same ? [] : [`${mod} differs from this checkout`];
  });
  const detail = problems.length ? problems.join(', ') : `${mods.length} match this checkout`;
  return { name: 'Mods', ok: problems.length === 0, detail, fix: install(' --force') };
}

function checkLayout() {
  const installed = join(appHome(), 'layouts/hws.json');
  const ok = existsSync(installed) && hash(installed) === hash(join(checkout(), 'mods/layouts/hws.json'));
  return { name: 'Layout', ok, detail: installed, fix: install(' --force') };
}

// A window on another layout may be the person's choice, so this never fails the report.
function checkLayoutShown() {
  const name = 'Layout shown';
  const status = probe(process.env.HWS_HERDR_APP || 'herdr-app', ['status']);
  let layout;
  try {
    layout = JSON.parse(status.stdout).layout;
  } catch {
    layout = undefined;
  }
  if (!layout) return { name, ok: true, detail: 'not checked, because no Herdr window answered' };
  if (layout === 'hws') return { name, ok: true, detail: 'hws' };
  return { name, ok: true, note: true, detail: `the window shows ${layout}, so the Workspaces sidebar is hidden`, fix: 'Run herdr-app do layout.switch --name hws' };
}

function checkPixel() {
  const found = probe('sh', [join(checkout(), 'surface/pixel-path.sh')]);
  const path = found.stdout?.trim() ?? '';
  return { name: 'Pixel', ok: path !== '' && existsSync(path), detail: path, fix: install() };
}

function checkApp() {
  const bundle = join(checkout(), 'surface/app/out/main/index.cjs');
  return { name: 'Surface app', ok: existsSync(bundle), detail: bundle, fix: install() };
}

function checkPlugin() {
  const name = 'Claude plugin';
  const listed = probe(process.env.HWS_CLAUDE || 'claude', ['plugin', 'list', '--json']);
  if (listed.error || listed.status !== 0) return { name, ok: false, detail: 'claude did not answer', fix: 'Install Claude Code, then run the installer again' };
  let plugin;
  try {
    plugin = JSON.parse(listed.stdout).find(({ id }) => id === PLUGIN_ID);
  } catch {
    return { name, ok: false, detail: 'claude printed an unreadable plugin list', fix: install() };
  }
  if (!plugin) return { name, ok: false, detail: 'not installed', fix: install() };
  if (!plugin.enabled) return { name, ok: false, detail: 'disabled', fix: `Run claude plugin enable ${PLUGIN_ID}` };
  const { version } = JSON.parse(readFileSync(join(checkout(), 'plugin/.claude-plugin/plugin.json'), 'utf8'));
  return { name, ok: plugin.version === version, detail: `installed ${plugin.version}, checkout ${version}`, fix: install(' --force') };
}

// Being behind is news, not a broken install, so it never fails the report.
function checkUpdates() {
  const name = 'Updates';
  const behind = commitsBehind();
  if (behind === null) return { name, ok: true, detail: 'not checked, because GitHub did not answer' };
  if (behind === 0) return { name, ok: true, detail: 'up to date with GitHub' };
  return { name, ok: true, note: true, detail: `${behind} ${behind === 1 ? 'commit' : 'commits'} behind GitHub`, fix: 'Run hws update' };
}

// A stale install is news like being behind, so it never fails the report either.
function checkInstalled() {
  const name = 'Installed version';
  const version = installVersion();
  if (version === null) return { name, ok: true, detail: 'not checked, because this is not a git checkout' };
  const installed = installedVersion();
  if (installed === version) return { name, ok: true, detail: `${version} matches this checkout` };
  const detail = installed === null ? 'no finished install is recorded' : `${installed} differs from this checkout's ${version}`;
  return { name, ok: true, note: true, detail, fix: 'Run hws update' };
}

function report(checks) {
  const width = Math.max(...checks.map(({ name }) => name.length));
  return checks
    .flatMap((check) => {
      const status = check.note ? 'note' : check.ok ? 'ok  ' : 'FAIL';
      const line = `${status}  ${check.name.padEnd(width)}  ${check.detail}`;
      return check.fix && (check.note || !check.ok) ? [line, `      ${check.fix}`] : [line];
    })
    .join('\n');
}

export function doctor({ record = false } = {}) {
  const checks = [
    checkNode(),
    checkTool('Herdr app', process.env.HWS_HERDR_APP || 'herdr-app'),
    checkTool('hc', process.env.HWS_HC || 'hc'),
    checkLink(),
    checkMods(),
    checkLayout(),
    checkLayoutShown(),
    checkPixel(),
    checkApp(),
    checkPlugin(),
    checkUpdates(),
  ];
  const ok = checks.every((check) => check.ok);
  if (ok && record) recordInstall();
  checks.push(checkInstalled());
  if (!ok) process.exitCode = 1;
  return { data: { ok, checks }, text: report(checks) };
}
