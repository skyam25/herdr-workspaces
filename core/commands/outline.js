import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { pathWithin, projectRootFor, realOf } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import { manifestOfSpace, readManifest } from '../manifest.js';
import { STANDALONE, home } from '../paths.js';
import { callingTerminal, spaceOfTerminal } from '../resolve.js';

// Outline files follow src/shared/outline.ts in surface/app. A new one holds only its title, target and kind.

const SUFFIX = '.outline.md';
const KINDS = ['document', 'page'];

export const isOutlinePath = (path) => path.endsWith(SUFFIX) && basename(path).length > SUFFIX.length;

// `docs/memo.md` becomes `docs/memo.outline.md`. A name without an extension gets the suffix appended.
function outlinePathFor(target) {
  const name = basename(target);
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? target.slice(0, target.length - name.length + dot) : target) + SUFFIX;
}

// `Onboarding memo` becomes `onboarding-memo.outline.md`.
function outlineSlugPath(title) {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  return `${slug || 'outline'}${SUFFIX}`;
}

// The folder `hws review` gives the surface: the calling terminal's workspace, else the standalone one.
function reviewFolder(flags) {
  const terminal = callingTerminal(flags);
  let space = null;
  try {
    space = terminal ? spaceOfTerminal(terminal) : null;
  } catch {
    // No Herdr window to ask, so the file's own folder is the project.
  }
  const manifest = (space && manifestOfSpace(space)) || readManifest(STANDALONE);
  return manifest?.folder ?? home();
}

function oneLine(value, what, max) {
  const line = (value ?? '').trim();
  if (!line) throw new UsageError(`${what} is empty`);
  if (/[\r\n\u0000-\u001f\u007f]/.test(line)) throw new UsageError(`${what} must be one line`);
  if (line.length > max) throw new UsageError(`${what} is over ${max} characters`);
  return line;
}

// Paths count from the current folder. The file's Target line counts from the project root.
export function outlineNew(flags, words) {
  const title = oneLine(words.join(' '), 'the title', 300);
  const kind = flags.kind ?? 'document';
  if (!KINDS.includes(kind)) throw new UsageError('--kind must be document or page');
  const target = flags.target ? realOf(oneLine(flags.target, '--target', 1000)) : null;
  const file = realOf(flags.path ?? (target ? outlinePathFor(target) : outlineSlugPath(title)));
  if (!isOutlinePath(file)) throw new UsageError(`${file} is not an outline. Outline files end in ${SUFFIX}`);
  if (lstatSync(file, { throwIfNoEntry: false })) throw new HwsError(`${file} already exists. Open it with hws review, or pass --path for a new file`);

  const root = projectRootFor(reviewFolder(flags), file);
  const targetRef = target ? pathWithin(root, target) : null;
  if (target && !targetRef) throw new HwsError(`--target must be inside ${root}, the folder the outline's surface works in`);

  const meta = [...(targetRef ? [`Target: ${targetRef}`] : []), `Kind: ${kind}`];
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `# ${title}\n\n${meta.join('\n')}\n`, { flag: 'wx' });
  const made = `made "${title}"${targetRef ? ` for ${targetRef}` : ''}. Show it with: hws review ${JSON.stringify(file)}`;
  return { data: { path: file, title, target: targetRef, kind, root }, text: `${file}\n${made}` };
}
