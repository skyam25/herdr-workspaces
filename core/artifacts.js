import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { HwsError } from './errors.js';
import { updateManifest, listManifests } from './manifest.js';
import { home } from './paths.js';
import { listRetired } from './retired.js';

// Marks a round of comments on a page. Like a tidy review, it is a message and not stream work.
export const FEEDBACK_ROLE = 'feedback';

// Marks the answers to an `hws ask` round, which are a message too.
export const ANSWERS_ROLE = 'answers';

// Follows symlinks, so /tmp and /private/tmp compare equal. A missing path
// takes the real path of its nearest existing folder, with the rest appended.
export function realOf(path) {
  const rest = [];
  let at = resolve(path);
  while (!existsSync(at) && dirname(at) !== at) {
    rest.unshift(basename(at));
    at = dirname(at);
  }
  return join(realpathSync(at), ...rest);
}

// The child's path relative to parent, or null when it lies outside. The parent itself gives ''.
export function pathWithin(parent, child) {
  const rel = relative(realOf(parent), realOf(child));
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? null : rel;
}

// True when child is parent or sits below it.
export const isInside = (parent, child) => pathWithin(parent, child) !== null;

// The folder a surface on this file works in. It follows sessionCwd in surface/app/src/main/surface.ts.
// That is the workspace folder when the file sits below it on a path with no dot folder and the
// folder is not home. Otherwise it is the file's own folder.
export function projectRootFor(folder, file) {
  const root = realOf(folder);
  const rel = pathWithin(root, file);
  const plain = Boolean(rel) && rel.split(sep).every((part) => !part.startsWith('.'));
  return plain && root !== realOf(home()) ? root : dirname(file);
}

// The parsed Excalidraw scene in a file. Anything else is refused.
export function readScene(file) {
  let scene;
  try {
    scene = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new HwsError(`${file} is not valid JSON`);
  }
  if (!Array.isArray(scene?.elements)) throw new HwsError(`${file} is not an Excalidraw scene`);
  return scene;
}

// The artifact that tracks a file. Reviews of the file are filed under it.
export function artifactOfFile(manifest, file) {
  const real = realOf(file);
  return manifest.artifacts.find((item) => item.type === 'file' && !item.role && realOf(item.path) === real) ?? null;
}

export function linkFor(promptPath) {
  if (/^https?:/i.test(promptPath)) return promptPath;
  return /\s/.test(promptPath) ? `@"${promptPath}"` : `@${promptPath}`;
}

// Across volumes, the source goes only after the copy succeeds.
export function moveDir(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  try {
    renameSync(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    cpSync(source, target, { recursive: true });
    rmSync(source, { recursive: true });
  }
}

// Never replaces a file, so a repeated name gains a number.
export function freeName(folder, name) {
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  let candidate = join(folder, name);
  for (let count = 2; existsSync(candidate); count += 1) candidate = join(folder, `${stem}-${count}${extension}`);
  return candidate;
}

// Lists the spellings a prompt may use for a folder.
function pathSpellings(dir) {
  const absolute = resolve(dir);
  return [...new Set([absolute, existsSync(absolute) ? realpathSync(absolute) : absolute])];
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Rewrites folder references in one pass. A dot or word character after the
// folder name means a longer sibling path, so that text stays. An @ reference
// to a target with spaces gets quotes because Claude Code needs them.
export function rewritePaths(text, oldDirs, newDir) {
  const replacements = new Map();
  for (const oldDir of oldDirs) {
    if (encodeURI(oldDir) !== oldDir) replacements.set(encodeURI(oldDir), encodeURI(newDir));
    replacements.set(oldDir, newDir);
  }
  const alternatives = [...replacements.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
  const pattern = new RegExp(
    `(@?)(${alternatives.join('|')})(?![\\w-]|\\.[\\w-])((?:/[^\\s"')\\]]*[^\\s"')\\].,;:!?])?)`,
    'g',
  );
  return text.replace(pattern, (_match, at, oldDir, rest) => {
    const target = replacements.get(oldDir);
    return at && /\s/.test(target) ? `@"${target}${rest}"` : `${at}${target}${rest}`;
  });
}

function rewritePromptFile(promptPath, oldDirs, newDir) {
  if (!existsSync(promptPath)) return;
  writeFileSync(promptPath, rewritePaths(readFileSync(promptPath, 'utf8'), oldDirs, newDir));
}

// Moves a bundle, points its prompt at the new folder and returns the prompt path.
export function moveBundle(source, targetDir) {
  const oldDirs = pathSpellings(source);
  moveDir(source, targetDir);
  const prompt = join(targetDir, 'prompt.md');
  rewritePromptFile(prompt, oldDirs, targetDir);
  return prompt;
}

// Moves an artifact and updates its record.
export function relocateArtifact(workspaceId, artifact, targetDir) {
  const prompt = moveBundle(artifact.path, targetDir);
  updateManifest(workspaceId, (manifest) => {
    const record = manifest.artifacts.find((item) => item.id === artifact.id);
    record.path = targetDir;
    record.prompt = prompt;
  });
  return targetDir;
}

// The first artifact that passes the test, with its manifest, or null. `open` leaves out closed workspaces.
export function findArtifactWhere(test, { open = false } = {}) {
  const manifests = listManifests({ includeStandalone: true });
  for (const manifest of open ? manifests : [...manifests, ...listRetired()]) {
    const artifact = manifest.artifacts.find(test);
    if (artifact) return { manifest, artifact };
  }
  return null;
}

export function findArtifact(artifactId, { open = false } = {}) {
  const found = findArtifactWhere((item) => item.id === artifactId, { open });
  if (!found) throw new HwsError(open ? `no artifact ${artifactId} in an open workspace` : `no artifact ${artifactId}`);
  return found;
}
