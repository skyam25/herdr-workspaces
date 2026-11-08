import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { updateManifest, listManifests } from './manifest.js';
import { STANDALONE, keptArtifactDir, standaloneArtifactDir, throwawayArtifactDir } from './paths.js';

export function artifactStoreDir(manifest, artifactId) {
  if (manifest.id === STANDALONE) return standaloneArtifactDir(artifactId);
  if (manifest.kind === 'throwaway') return throwawayArtifactDir(manifest.id, artifactId);
  return keptArtifactDir(manifest.folder, manifest, artifactId);
}

export function linkFor(promptPath) {
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

// Lists the spellings a prompt may use for a folder. Call before moving it.
export function pathSpellings(dir) {
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

export function rewritePromptFile(promptPath, oldDirs, newDir) {
  if (!existsSync(promptPath)) return;
  writeFileSync(promptPath, rewritePaths(readFileSync(promptPath, 'utf8'), oldDirs, newDir));
}

// Moves an artifact, rewrites its prompt and updates its record.
export function relocateArtifact(workspaceId, artifact, targetDir) {
  const oldDirs = pathSpellings(artifact.path);
  moveDir(artifact.path, targetDir);
  const prompt = join(targetDir, 'prompt.md');
  rewritePromptFile(prompt, oldDirs, targetDir);
  updateManifest(workspaceId, (manifest) => {
    const record = manifest.artifacts.find((item) => item.id === artifact.id);
    record.path = targetDir;
    record.prompt = prompt;
  });
  return targetDir;
}

export function findArtifact(artifactId) {
  for (const manifest of listManifests({ includeStandalone: true })) {
    const artifact = manifest.artifacts.find((item) => item.id === artifactId);
    if (artifact) return { manifest, artifact };
  }
  return null;
}
