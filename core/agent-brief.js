// Finds what the retired Agent Brief app and plugin left on this Mac.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { home } from './paths.js';

export const PLUGIN = 'agent-brief@agent-brief';
export const MARKETPLACE = 'agent-brief';
export const APP_NAME = 'Agent Brief';

// The main process of the app. Its helpers run from Contents/Frameworks, so they never match.
const PROCESS = 'Agent Brief.app/Contents/MacOS/Agent Brief';

export const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(home(), '.claude');
export const applications = () => process.env.HWS_APPLICATIONS || '/Applications';
const library = (...parts) => join(home(), 'Library', ...parts);

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Claude settings name a plugin under enabledPlugins.
export const pluginEnabled = (id) => readJson(join(claudeHome(), 'settings.json'))?.enabledPlugins?.[id] === true;

// Version 2 of installed_plugins.json keeps plugins under `plugins`. Version 1 kept them at the top.
export function pluginInstalled(id) {
  const json = readJson(join(claudeHome(), 'plugins/installed_plugins.json'));
  return Boolean(json?.plugins?.[id] ?? json?.[id]);
}

export const marketplaceKnown = () => Boolean(readJson(join(claudeHome(), 'plugins/known_marketplaces.json'))?.[MARKETPLACE]);

export function paths() {
  return {
    settings: join(claudeHome(), 'settings.json'),
    installed: join(claudeHome(), 'plugins/installed_plugins.json'),
    marketplaces: join(claudeHome(), 'plugins/known_marketplaces.json'),
    cache: join(claudeHome(), 'plugins/cache/agent-brief'),
    link: join(home(), '.local/bin/agent-brief'),
    app: join(applications(), `${APP_NAME}.app`),
    data: library('Application Support', 'Agent Brief'),
    oldData: library('Application Support', 'AgentBrief'),
    preferences: library('Preferences', 'com.agentbrief.app.plist'),
    caches: ['com.agentbrief.app', 'com.agentbrief.app.ShipIt', 'agent-brief-app-updater'].map((name) => library('Caches', name)),
    inbox: join(home(), 'Downloads/feedback-inbox'),
  };
}

// A link counts even when its target is gone.
export const linkPresent = (path) => Boolean(lstatSync(path, { throwIfNoEntry: false }));

export function linkTarget(path) {
  const found = lstatSync(path, { throwIfNoEntry: false });
  return found?.isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : null;
}

// Only a link into the app or an agent-brief checkout belongs to Agent Brief.
export function isAgentBriefLink(path) {
  const target = linkTarget(path);
  return Boolean(target) && (target.includes(`${APP_NAME}.app`) || target.includes('agent-brief'));
}

export function appRunning() {
  const listed = spawnSync(process.env.HWS_PS || '/bin/ps', ['-axww', '-o', 'command='], { encoding: 'utf8', timeout: 10_000 });
  return (listed.stdout ?? '').split('\n').some((line) => line.includes(PROCESS));
}

export function filesIn(dir, suffix) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(suffix) && !name.startsWith('.'));
  } catch {
    return [];
  }
}

// Boards and drafts in one data folder.
export function dataCounts(dir) {
  return { boards: filesIn(join(dir, 'boards'), '.excalidraw').length, drafts: filesIn(join(dir, 'drafts'), '.json').length };
}

// The parts whose instructions still reach Claude sessions. `hws doctor` warns about these.
export function conflictingParts() {
  const { link, app } = paths();
  return [
    pluginEnabled(PLUGIN) && 'the plugin is enabled',
    pluginInstalled(PLUGIN) && 'the plugin is installed',
    linkPresent(link) && 'the agent-brief CLI link exists',
    existsSync(app) && 'the app is installed',
  ].filter(Boolean);
}
