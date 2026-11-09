import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { HwsError } from './errors.js';
import { home, stateRoot } from './paths.js';

const settingsFile = () => join(stateRoot(), 'settings.json');

const EFFORTS = ['low', 'medium', 'high', 'xhigh'];

// What the Models dialog offers. Any other model name still works through `hws models set`.
export const MODEL_CATALOG = {
  claude: {
    name: 'Claude Code',
    models: [{ id: 'fable', name: 'Fable' }, { id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }, { id: 'haiku', name: 'Haiku' }],
    recommendedWorker: 'sonnet',
    efforts: EFFORTS,
  },
  codex: {
    name: 'Codex',
    models: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra' }, { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }, { id: 'gpt-6-luna', name: 'GPT-6 Luna' }],
    recommendedWorker: 'gpt-6.1-sol',
    efforts: EFFORTS,
  },
};

export const DEFAULT_MODELS = {
  orchestrator: { tool: 'claude', model: 'opus', effort: 'high' },
  worker: { tool: 'claude', model: 'sonnet', effort: 'medium' },
};

function readSettings() {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(changes) {
  mkdirSync(stateRoot(), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...changes }));
}

const remembered = () => readSettings().parent;

// The user's default place map for kept workspaces. Roles the manifest leaves out fall back to it.
export function defaultPlaces() {
  const places = readSettings().places;
  return places && typeof places === 'object' ? places : {};
}

export function agentModels() {
  const saved = readSettings().models ?? {};
  return { orchestrator: saved.orchestrator ?? DEFAULT_MODELS.orchestrator, worker: saved.worker ?? DEFAULT_MODELS.worker };
}

export function setAgentModel(role, value) {
  writeSettings({ models: { ...(readSettings().models ?? {}), [role]: value } });
}

// The start of the command line for an agent with these settings.
export function agentArgv({ tool, model, effort }) {
  return tool === 'codex' ? ['codex', '-m', model, '-c', `model_reasoning_effort="${effort}"`] : ['claude', '--model', model, '--effort', effort];
}

// The folder new work starts in: the last one used, else ~/Projects, else home.
export function parentFolder() {
  const last = remembered();
  if (last && existsSync(last)) return last;
  const projects = join(home(), 'Projects');
  return existsSync(projects) ? projects : home();
}

export function rememberParent(folder) {
  writeSettings({ parent: folder });
}

export function requireFolder(folder) {
  if (!existsSync(folder)) throw new HwsError(`${folder} does not exist`);
  return folder;
}
