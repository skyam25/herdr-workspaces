import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

import { HwsError } from './errors.js';
import { updateManifest, listManifests } from './manifest.js';
import { listRetired } from './retired.js';

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

export function findArtifact(artifactId) {
  for (const manifest of [...listManifests({ includeStandalone: true }), ...listRetired()]) {
    const artifact = manifest.artifacts.find((item) => item.id === artifactId);
    if (artifact) return { manifest, artifact };
  }
  throw new HwsError(`no artifact ${artifactId}`);
}
