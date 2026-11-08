import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HWS = fileURLToPath(new URL('../../bin/hws', import.meta.url));
const FAKES = fileURLToPath(new URL('./fakes/', import.meta.url));

function space(id, tabs) {
  return { id, name: id, folder: '/', tabs };
}

function tab(id, terminals) {
  return { id, name: id, terminals };
}

function terminal(address, pane) {
  return { terminal: address, pane, status: null, app: null, sub_agents: [] };
}

export const liveFixtures = { space, tab, terminal };

// Builds a private sandbox with fake binaries and a temporary HWS_HOME.
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hws-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const statePath = join(dir, 'fake-state.json');
  const logPath = join(dir, 'fake-log.jsonl');
  const root = join(dir, 'state');
  const homeDir = join(dir, 'home');
  const trashDir = join(dir, 'trash');
  mkdirSync(homeDir);
  writeFileSync(logPath, '');
  writeFileSync(statePath, JSON.stringify({ counter: 100, spaces: [], selected: null, hc: {} }));

  const environment = {
    ...process.env,
    HOME: homeDir,
    HWS_HOME: root,
    HWS_HERDR_APP: join(FAKES, 'fake-herdr.cjs'),
    HWS_HC: join(FAKES, 'fake-hc.cjs'),
    HWS_TRASH: join(FAKES, 'fake-trash.cjs'),
    HWS_OSASCRIPT: join(FAKES, 'fake-osascript.cjs'),
    FAKE_STATE: statePath,
    FAKE_LOG: logPath,
    FAKE_TRASH_DIR: trashDir,
    HC_TERMINAL_ID: '',
  };

  const box = {
    dir,
    root,
    homeDir,
    trashDir,
    environment,

    state: () => JSON.parse(readFileSync(statePath, 'utf8')),
    setState: (change) => writeFileSync(statePath, JSON.stringify({ ...box.state(), ...change })),
    calls: () => readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    clearCalls: () => writeFileSync(logPath, ''),

    // Calls other than the read-only ls, status and hc get.
    actions: () =>
      box
        .calls()
        .filter((call) => !['ls', 'status'].includes(call.args[0]) && !(call.bin === 'hc' && call.args[0] === 'get'))
        .map((call) => [call.bin, ...call.args]),

    hws(args, env = {}) {
      const result = spawnSync(HWS, args, { env: { ...environment, ...env }, encoding: 'utf8' });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    },

    json(args, env = {}) {
      const result = box.hws([...args, '--json'], env);
      if (result.code !== 0) throw new Error(`hws ${args.join(' ')} exited ${result.code}: ${result.stdout}${result.stderr}`);
      return JSON.parse(result.stdout);
    },

    hwsAsync(args) {
      return new Promise((resolve) => {
        const child = spawn(HWS, args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.on('exit', (code) => resolve({ code, stdout }));
      });
    },

    manifest: (id) => JSON.parse(readFileSync(join(root, 'workspaces', id, 'workspace.json'), 'utf8')),

    folder(name) {
      const path = join(dir, name);
      mkdirSync(path, { recursive: true });
      return path;
    },

    // Writes a bundle with a prompt that points at its own images.
    bundle(name, promptText) {
      const path = join(dir, name);
      mkdirSync(join(path, 'images'), { recursive: true });
      writeFileSync(join(path, 'images', 'shot.png'), 'png');
      writeFileSync(join(path, 'prompt.md'), promptText ?? `Look at @${path}/images/shot.png now.\n`);
      return path;
    },

    // Creates an app workspace and clears the call log.
    app(name = 'demo') {
      const manifest = box.json(['new', 'workspace', '--name', name, '--folder', box.folder(name), '--kind', 'app']);
      box.clearCalls();
      return manifest;
    },

    throwaway(name = 'scratch') {
      const manifest = box.json(['new', 'throwaway', '--name', name]);
      box.clearCalls();
      return manifest;
    },

    // Opens a glued surface, finishes it with a bundle and returns the record.
    finishGlued(manifest, bundlePrompt) {
      const terminal = manifest.terminals[0].terminal;
      const surface = box.json(['surface', 'open', '--type', 'board', '--title', 'flow', '--terminal', terminal]);
      const bundle = box.bundle(`bundle-${surface.id}`, bundlePrompt?.(join(box.dir, `bundle-${surface.id}`)));
      const done = box.json(['surface', 'done', '--id', surface.id, '--bundle', bundle]);
      box.clearCalls();
      return { surface, bundle, done, artifact: box.manifest(manifest.id).artifacts.at(-1) };
    },
  };
  return box;
}
