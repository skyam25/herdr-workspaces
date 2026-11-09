import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
    CLAUDE_CONFIG_DIR: join(homeDir, '.claude'),
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
    rewriteManifest: (id, change) => writeFileSync(join(root, 'workspaces', id, 'workspace.json'), JSON.stringify(change(box.manifest(id)))),

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

    // Moves a manifest's creation time into the past.
    age(id, hours) {
      const path = join(root, 'workspaces', id, 'workspace.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      writeFileSync(path, JSON.stringify({ ...manifest, createdAt: Date.now() - hours * 3600_000 }));
    },

    // Registers a session and writes its transcript, last changed `hours` ago.
    transcript(manifest, sessionId, { title = 'Fix the login page', prompt = 'why does login fail', users = [], hours = 0, terminal = manifest.terminals[0].terminal } = {}) {
      box.json(['register', '--terminal', terminal, '--session', sessionId]);
      const project = join(homeDir, '.claude', 'projects', manifest.folder.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(project, { recursive: true });
      const path = join(project, `${sessionId}.jsonl`);
      const lines = [...users, { type: 'ai-title', aiTitle: title, sessionId }, { type: 'last-prompt', lastPrompt: prompt }];
      writeFileSync(path, `not json\n${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
      const when = new Date(Date.now() - hours * 3600_000);
      utimesSync(path, when, when);
      box.clearCalls();
      return path;
    },

    // Changes every listed terminal of one space.
    setTerminals(id, change) {
      const spaces = box.state().spaces.map((item) => {
        if (item.id !== id) return item;
        return { ...item, tabs: item.tabs.map((one) => ({ ...one, terminals: one.terminals.map((record) => ({ ...record, ...change })) })) };
      });
      box.setState({ spaces });
    },

    // Opens a glued surface, finishes it with a bundle and returns the record.
    finishGlued(manifest, bundlePrompt) {
      const terminal = manifest.terminals[0].terminal;
      const surface = box.json(['surface', 'open', '--type', 'board', '--in-pane', '--title', 'flow', '--terminal', terminal]);
      const bundle = box.bundle(`bundle-${surface.id}`, bundlePrompt?.(join(box.dir, `bundle-${surface.id}`)));
      const done = box.json(['surface', 'done', '--id', surface.id, '--bundle', bundle]);
      box.clearCalls();
      return { surface, bundle, done, artifact: box.manifest(manifest.id).artifacts.at(-1) };
    },
  };
  return box;
}
