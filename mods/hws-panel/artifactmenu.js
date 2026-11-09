// The "..." menu on an artifact row, holding every way to open it other than the companion.

import { openOverlay, props } from "herdr";
import { copy, openExternally, revealLabel, revealPath } from "./cites.js";
import { popupHeight, popupMenu } from "./rowmenu.js";

const MOD = "hws-panel";
const MENU_WIDTH = 190;

// The same form `hws link` prints.
const linkFor = (path) => (/\s/.test(path) ? `@"${path}"` : `@${path}`);

function externalItem({ type, path }) {
  if (type === "board") return { id: "external", label: "Open sketch", file: `${path}/sketch.png` };
  if (/\.html?$/i.test(path)) return { id: "external", label: "Open in browser", file: path };
  return { id: "external", label: "Open in default app", file: path };
}

function menuItems(artifact) {
  if (artifact.type === "link") {
    return [
      { id: "external", label: "Open in browser", run: () => openExternally(artifact.path) },
      { id: "copy", label: "Copy link", run: () => copy(artifact.path) },
    ];
  }
  const external = externalItem(artifact);
  return [
    { id: external.id, label: external.label, run: () => openExternally(external.file) },
    { id: "reveal", label: revealLabel(), run: () => revealPath(artifact.prompt ?? artifact.path) },
    { id: "copy", label: "Copy for Claude", run: () => copy(linkFor(artifact.prompt ?? artifact.path)) },
  ];
}

export function openArtifactMenu({ id, type, path, prompt }) {
  const artifact = { id, type, path, prompt };
  openOverlay({ mod: MOD, kind: "popup", width: MENU_WIDTH, height: popupHeight(menuItems(artifact).length), props: { artifact, view: "artifact-menu" } });
}

export function renderArtifactMenu(t) {
  const { artifact, overlay } = props();

  // The popup closes first. Each action starts one exec, which outlives it.
  const items = menuItems(artifact).map(({ id, label, run }) => ({ id, label, open: () => run().catch(() => {}) }));
  return popupMenu(t, items, overlay);
}
