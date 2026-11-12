import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { artifactOfFile, findArtifact, isInside, linkFor, moveDir, realOf } from '../artifacts.js';
import { HwsError, UsageError } from '../errors.js';
import { act, listLive } from '../herdr.js';
import { listManifests, manifestOfSpace, updateManifest } from '../manifest.js';
import { isKept, placeOf, writablePlace } from '../places.js';
import { requireCallingTerminal, requireFlag, resolveWorkspace, spaceOfTerminal, workspaceByRef } from '../resolve.js';
import { listRetired } from '../retired.js';
import { scanWorkspace } from '../scan.js';
import { newId, surfaceOpen } from './surface.js';

export const ARTIFACT_STATUSES = ['draft', 'current', 'superseded'];

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

function requireKept(manifest, option) {
  if (!isKept(manifest)) throw new HwsError(`${option} needs a kept workspace, and ${manifest.name} is a ${manifest.kind ?? 'standalone store'}`);
}

// A file that stays where it is, or a web document, is only ever pointed at.
// Registering the same one twice returns the first record.
function pointerRecord(manifest, flags) {
  if (flags.url !== undefined) {
    if (flags.file !== undefined) throw new UsageError('pass --file or --url, not both');
    if (!/^https?:\/\//i.test(flags.url)) throw new UsageError('--url must start with http:// or https://');
    requireKept(manifest, '--url');
    return { type: 'link', path: flags.url, prompt: flags.url, url: flags.url, title: flags.title || flags.url };
  }
  requireKept(manifest, '--in-place');
  const path = realOf(resolve(requireFlag(flags, 'file')));
  if (!existsSync(path)) throw new HwsError(`no file ${path}`);
  return inPlaceFields(path, flags.title);
}

const inPlaceFields = (path, title) => ({ type: 'file', path, prompt: path, inPlace: true, title: title || basename(path) });

function record(fields) {
  return { id: newId('a'), ...fields, fromTerminal: process.env.HC_TERMINAL_ID || null, createdAt: Date.now(), status: 'current', supersedes: null };
}

function addPointer(flags) {
  const manifest = resolveWorkspace(flags);
  const fields = pointerRecord(manifest, flags);
  const existing = manifest.artifacts.find((item) => item.path === fields.path);
  if (existing) return { data: { ...existing, workspace: manifest.id, existing: true }, text: `${fields.path} is already ${existing.id}` };
  const artifact = record(fields);
  updateManifest(manifest.id, (draft) => {
    draft.artifacts.push(artifact);
  });
  return { data: { ...artifact, workspace: manifest.id }, text: `registered ${artifact.id} at ${artifact.path}` };
}

export function artifactAdd(flags) {
  if (flags.url !== undefined || flags['in-place']) return addPointer(flags);
  const source = resolve(requireFlag(flags, 'file'));
  if (!existsSync(source)) throw new HwsError(`no file ${source}`);
  const manifest = resolveWorkspace(flags);
  const path = landFile(manifest, source);
  const artifact = record({ type: 'file', title: flags.title || basename(path), path, prompt: path });
  updateManifest(manifest.id, (draft) => {
    draft.artifacts.push(artifact);
  });
  return { data: { ...artifact, workspace: manifest.id }, text: `registered ${artifact.id} at ${path}` };
}

export function artifactScan(flags) {
  const found = scanWorkspace(resolveWorkspace(flags));
  const lines = [
    ...found.tracked.map((item) => `tracked\t${item.id}\t${item.type}\t${item.title}\t${item.path}`),
    ...found.candidates.map((item) => `untracked\t${item.kind}\t${item.title ?? ''}\t${item.url ?? item.path}`),
    ...(found.more ? [`and ${found.more} more`] : []),
  ];
  return { data: found, text: lines.join('\n') };
}

const REVIEWABLE = /\.(html?|md|markdown)$/i;

// A path, or the id of an artifact that tracks or reviews a file.
function reviewedFile(target) {
  const path = resolve(target);
  if (existsSync(path)) return realOf(path);
  let artifact = null;
  try {
    ({ artifact } = findArtifact(target));
  } catch {
    // Not an artifact id, so the missing file is the problem to report.
  }
  const file = artifact?.file ?? (artifact?.type === 'file' ? artifact.path : null);
  if (!file || !existsSync(file)) throw new HwsError(`no file ${path}`);
  return realOf(file);
}

// A kept workspace tracks the file where it sits, so each round of feedback files under it.
function trackReviewed(manifest, file, title) {
  if (!manifest || !isKept(manifest)) return null;
  const artifact = record(inPlaceFields(file, title));
  updateManifest(manifest.id, (draft) => {
    draft.artifacts.push(artifact);
  });
  return artifact;
}

function reviewText(file, terminal, surface) {
  const name = basename(file);
  const where = surface.pane ? `beside ${terminal}` : 'in its own window';
  if (!surface.focused) return `Opened ${name} ${where} for review. End the turn now. The person's comments arrive as your next prompt.`;
  if (surface.terminal === terminal) return `${name} is already open for review. End the turn now. The person's comments arrive as your next prompt.`;
  const place = surface.pane ? 'pane' : 'window';
  return `${name} is already open in a ${place} that ${surface.terminal ? `belongs to ${surface.terminal}` : 'has no agent attached'}, so its comments will not arrive here. Ask the person to close that ${place}, then run this again.`;
}

// Hands a page to the person for comments, in a pane beside the agent that asks or in its own window.
export async function review(flags, [target]) {
  const terminal = requireCallingTerminal(flags);
  const file = reviewedFile(target);
  if (!REVIEWABLE.test(file)) throw new HwsError('hws review opens .html and .md files');

  const space = spaceOfTerminal(terminal);
  const manifest = space ? manifestOfSpace(space) : null;
  const tracked = manifest && artifactOfFile(manifest, file);
  const title = flags.title ?? tracked?.title;
  const place = flags.window ? { window: true } : { 'in-pane': true };
  const { data: surface } = await surfaceOpen({ type: 'page', file, terminal, ...place, ...(title ? { title } : {}) });
  const artifact = tracked || trackReviewed(manifest, file, title);
  return { data: { ...surface, file, artifact: artifact?.id ?? null }, text: reviewText(file, terminal, surface) };
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
