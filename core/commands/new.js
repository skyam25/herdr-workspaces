import { randomBytes } from 'node:crypto';

import { UsageError } from '../errors.js';
import { act } from '../herdr.js';
import { createManifest } from '../manifest.js';
import { expandFolder } from '../paths.js';
import { requireFlag } from '../resolve.js';
import { parentFolder, rememberParent, requireFolder } from '../settings.js';

export const KEPT_KINDS = ['general', 'app', 'deliverable'];

export function keptKind(value = 'general') {
  if (!KEPT_KINDS.includes(value)) throw new UsageError('--kind must be general, app or deliverable');
  return value;
}

export function keptFields(flags) {
  const name = requireFlag(flags, 'name');
  const folder = requireFolder(expandFolder(requireFlag(flags, 'folder')));
  return { name, folder, kind: keptKind(flags.kind) };
}

function createWorkspace({ name, kind, folder, instructions, tabNames, argv }) {
  const first = act('space.new', { name, folder, argv });
  act('tab.rename', { id: first.tab, name: tabNames[0] });
  const opened = [{ ...first, name: tabNames[0] }];
  for (const tabName of tabNames.slice(1)) {
    opened.push({ ...act('tab.new', { name: tabName, space: first.space, folder, argv }), name: tabName });
  }
  return createManifest({
    id: first.space,
    name,
    kind,
    folder,
    instructions: instructions ?? '',
    tabs: opened.map((tab) => ({ tabId: tab.tab, name: tab.name, role: tab.name.toLowerCase() })),
    terminals: opened.map((tab) => ({ terminal: tab.terminal, tabId: tab.tab, sessionId: null, role: null })),
  });
}

function parseTabNames(value) {
  const names = (value ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  return names.length > 0 ? names : ['Main'];
}

export function newTerminal(flags) {
  const folder = flags.folder ? expandFolder(flags.folder) : undefined;
  const opened = act('tab.new', { folder });
  return { data: opened, text: `opened ${opened.terminal}` };
}

export function newWorkspace(flags) {
  const { name, folder, kind } = keptFields(flags);
  const manifest = createWorkspace({
    name,
    kind,
    folder,
    instructions: flags.instructions,
    tabNames: parseTabNames(flags.tabs),
  });
  rememberParent(folder);
  return { data: manifest, text: `created ${kind} workspace ${name} (${manifest.id})` };
}

export function newThrowaway(flags) {
  const name = flags.name ?? `throwaway-${randomBytes(2).toString('hex')}`;

  const manifest = createWorkspace({
    name,
    kind: 'throwaway',
    folder: parentFolder(),
    tabNames: ['Claude'],
    argv: ['claude'],
  });
  return { data: manifest, text: `created throwaway ${name} (${manifest.id})` };
}
