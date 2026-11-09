import { findArtifact, linkFor } from '../artifacts.js';
import { act, listLive } from '../herdr.js';
import { listManifests } from '../manifest.js';
import { workspaceByRef } from '../resolve.js';
import { listRetired } from '../retired.js';

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
