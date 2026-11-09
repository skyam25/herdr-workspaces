import { randomBytes } from 'node:crypto';

import { UsageError } from '../errors.js';
import { act } from '../herdr.js';
import { createManifest, updateManifest } from '../manifest.js';
import { expandFolder } from '../paths.js';
import { ensurePlace } from '../places.js';
import { requireFlag, splitList } from '../resolve.js';
import { parentFolder, rememberParent, requireFolder } from '../settings.js';

export const KEPT_KINDS = ['general', 'app', 'deliverable'];

export function keptKind(value = 'general') {
  if (!KEPT_KINDS.includes(value)) throw new UsageError('--kind must be general, app or deliverable');
  return value;
}

export function keptFields(flags) {
  const name = requireFlag(flags, 'name');
  const folder = requireFolder(expandFolder(requireFlag(flags, 'folder')));
  const home = flags.home ? requireFolder(expandFolder(flags.home)) : null;
  return { name, folder, home, kind: keptKind(flags.kind) };
}

function manifestFor({ name, kind, folder, instructions }, space, opened) {
  return createManifest({
    id: space,
    name,
    kind,
    folder,
    instructions: instructions ?? '',
    tabs: opened.map((tab) => ({ tabId: tab.tab, name: tab.name ?? null, role: tab.name?.toLowerCase() ?? null })),
    terminals: opened.map((tab) => ({ terminal: tab.terminal, tabId: tab.tab, sessionId: null, role: null })),
  });
}

export function createWorkspace({ name, kind, folder, instructions, tabs }) {
  const [firstTab, ...otherTabs] = tabs;
  const first = act('space.new', { name, folder, argv: firstTab.argv });
  if (firstTab.name) act('tab.rename', { id: first.tab, name: firstTab.name });
  const opened = [{ ...first, name: firstTab.name }];
  for (const tab of otherTabs) {
    opened.push({ ...act('tab.new', { name: tab.name, space: first.space, folder, argv: tab.argv }), name: tab.name });
  }
  return manifestFor({ name, kind, folder, instructions }, first.space, opened);
}

// A throwaway lives in its scratch folder, whose path holds the space id. So
// the space opens on a shell in the parent folder, and that shell closes once
// the throwaway's tabs are open in scratch.
function createThrowaway({ name, parent, tabs }) {
  const shell = act('space.new', { name, folder: parent });
  const scratch = ensurePlace({ id: shell.space, kind: 'throwaway', folder: parent }, 'scratch').path;
  const opened = tabs.map((tab) => ({ ...act('tab.new', { name: tab.name, space: shell.space, folder: scratch, argv: tab.argv }), name: tab.name }));
  act('tab.close', { id: shell.tab, confirmed: true });
  return manifestFor({ name, kind: 'throwaway', folder: scratch }, shell.space, opened);
}

// With no names, the workspace starts with one tab Herdr numbers.
function parseTabs(value) {
  const names = splitList(value);
  return names.length > 0 ? names.map((name) => ({ name })) : [{}];
}

export function newTerminal(flags) {
  const folder = flags.folder ? expandFolder(flags.folder) : undefined;
  const opened = act('tab.new', { folder });
  return { data: opened, text: `opened ${opened.terminal}` };
}

// New work starts out exploring, so a tidy pass decides nothing the person has not.
const FIRST_STAGE = 'discovery';

export function newWorkspace(flags) {
  const { name, folder, home, kind } = keptFields(flags);
  const manifest = createWorkspace({
    name,
    kind,
    folder,
    instructions: flags.instructions,
    tabs: parseTabs(flags.tabs),
  });
  const started = updateManifest(manifest.id, (draft) => {
    draft.stage = FIRST_STAGE;
    if (home && home !== folder) draft.home = home;
  });
  rememberParent(folder);
  return { data: started, text: `created ${kind} workspace ${name} (${manifest.id})` };
}

export function newThrowaway(flags) {
  const name = flags.name ?? `throwaway-${randomBytes(2).toString('hex')}`;

  const manifest = createThrowaway({ name, parent: parentFolder(), tabs: [{ name: 'Claude', argv: ['claude'] }] });
  return { data: manifest, text: `created throwaway ${name} (${manifest.id})` };
}
