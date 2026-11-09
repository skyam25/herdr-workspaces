import { existsSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import { findArtifact, linkFor, moveDir } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import { act, listLive } from '../herdr.js';
import { listManifests, updateManifest } from '../manifest.js';
import { placeOf, writablePlace } from '../places.js';
import { requireFlag, resolveWorkspace, workspaceByRef } from '../resolve.js';
import { listRetired } from '../retired.js';
import { newId } from './surface.js';

export const ARTIFACT_STATUSES = ['draft', 'current', 'superseded'];

// Follows symlinks where the path exists, so /tmp and /private/tmp compare equal.
export function realOf(path) {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

// True when child is parent or sits below it.
export function isInside(parent, child) {
  const rel = relative(realOf(parent), realOf(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertStatus(status, field = '--status') {
  if (!ARTIFACT_STATUSES.includes(status)) throw new UsageError(`${field} must be one of ${ARTIFACT_STATUSES.join(', ')}`);
  return status;
}

// Fails unless `supersedes` names another artifact of the same workspace.
export function assertSupersedes(manifest, id, supersedes) {
  if (supersedes === null) return;
  if (supersedes === id) throw new HwsError(`artifact ${id} cannot supersede itself`);
  if (!manifest.artifacts.some((item) => item.id === supersedes)) throw new HwsError(`no artifact ${supersedes} in ${manifest.name}`);
}

export function artifactList(flags) {
  const manifests = flags.workspace ? [workspaceByRef(flags.workspace)] : [...listManifests({ includeStandalone: true }), ...listRetired()];
  const artifacts = manifests.flatMap((manifest) =>
    manifest.artifacts.map((artifact) => ({ ...artifact, workspace: manifest.id })),
  );
  return {
    data: artifacts,
    text: artifacts.map((item) => `${item.id}\t${item.type}\t${item.title}\t${item.path}`).join('\n'),
  };
}

// Retired records are not manifests, so only open workspaces can change.
function openArtifact(id) {
  const manifest = listManifests({ includeStandalone: true }).find((item) => item.artifacts.some((one) => one.id === id));
  if (!manifest) throw new HwsError(`no artifact ${id} in an open workspace`);
  return manifest;
}

// An empty --supersedes clears it.
export function artifactSet(flags, [id]) {
  if (flags.status === undefined && flags.supersedes === undefined) throw new UsageError('pass --status, --supersedes or both');
  if (flags.status !== undefined) assertStatus(flags.status);
  const supersedes = flags.supersedes === undefined ? undefined : flags.supersedes || null;
  const manifest = openArtifact(id);
  if (supersedes !== undefined) assertSupersedes(manifest, id, supersedes);
  let record;
  updateManifest(manifest.id, (draft) => {
    record = draft.artifacts.find((item) => item.id === id);
    if (flags.status !== undefined) record.status = flags.status;
    if (supersedes !== undefined) record.supersedes = supersedes;
  });
  return { data: { ...record, workspace: manifest.id }, text: `${id} is ${record.status}` };
}

// A file inside the artifacts place stays put, so registering it writes nothing there.
// Any other file moves under the place by its own name and never replaces a file.
function landFile(manifest, source) {
  const place = placeOf(manifest, 'artifacts').path;
  if (place && isInside(place, source)) return source;
  const target = join(writablePlace(manifest, 'artifacts'), basename(source));
  if (existsSync(target)) throw new HwsError(`${target} already exists, so ${source} stays where it is`);
  moveDir(source, target);
  return target;
}

export function artifactAdd(flags) {
  const source = resolve(requireFlag(flags, 'file'));
  if (!existsSync(source)) throw new HwsError(`no file ${source}`);
  const manifest = resolveWorkspace(flags);
  const path = landFile(manifest, source);
  const artifact = {
    id: newId('a'),
    type: 'file',
    title: flags.title || basename(path),
    path,
    prompt: path,
    fromTerminal: process.env.HC_TERMINAL_ID || null,
    createdAt: Date.now(),
    status: 'current',
    supersedes: null,
  };
  updateManifest(manifest.id, (draft) => {
    draft.artifacts.push(artifact);
  });
  return { data: { ...artifact, workspace: manifest.id }, text: `registered ${artifact.id} at ${path}` };
}

export function link(_flags, [artifactId]) {
  const value = linkFor(findArtifact(artifactId).artifact.prompt);
  return { data: { link: value }, text: value };
}

export function artifactTerminal(_flags, [artifactId]) {
  const { manifest, artifact } = findArtifact(artifactId);
  const open = listLive()?.spaces ?? [];
  const space = (manifest.spaces ?? []).find((id) => open.some((item) => item.id === id));
  const opened = act('tab.new', {
    name: artifact.title,
    space,
    folder: manifest.folder,
    argv: ['claude'],
    task: linkFor(artifact.prompt),
  });
  return { data: opened, text: `opened ${opened.terminal}` };
}
