import { HwsError } from '../errors.js';
import { findArtifact, linkFor } from '../artifacts.js';
import { act, listLive } from '../herdr.js';
import { listManifests } from '../manifest.js';
import { STANDALONE, home } from '../paths.js';
import { workspaceByRef } from '../resolve.js';

function requireArtifact(artifactId) {
  const found = findArtifact(artifactId);
  if (!found) throw new HwsError(`no artifact ${artifactId}`);
  return found;
}

export function artifactList(flags) {
  const manifests = flags.workspace ? [workspaceByRef(flags.workspace)] : listManifests({ includeStandalone: true });
  const artifacts = manifests.flatMap((manifest) =>
    manifest.artifacts.map((artifact) => ({ ...artifact, workspace: manifest.id })),
  );
  return {
    data: artifacts,
    text: artifacts.map((item) => `${item.id}\t${item.type}\t${item.title}\t${item.path}`).join('\n'),
  };
}

export function link(_flags, [artifactId]) {
  const value = linkFor(requireArtifact(artifactId).artifact.prompt);
  return { data: { link: value }, text: value };
}

export function artifactTerminal(_flags, [artifactId]) {
  const { manifest, artifact } = requireArtifact(artifactId);
  const live = listLive()?.spaces.some((space) => space.id === manifest.id);
  const opened = act('tab.new', {
    name: artifact.title,
    space: live && manifest.id !== STANDALONE ? manifest.id : undefined,
    folder: manifest.id === STANDALONE ? home() : manifest.folder,
    argv: ['claude'],
    task: linkFor(artifact.prompt),
  });
  return { data: opened, text: `opened ${opened.terminal}` };
}
