import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isTerminalAlive } from './herdr.js';
import { surfaceDataDir } from './paths.js';

// A surface in its own window has no pane, so its host terminal says whether it is open.
export const isWindowOpen = (surface) => isTerminalAlive(surface.host);

function filesIn(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// An unreadable file counts as work, so it is never dropped by mistake.
function fileHasWork(path, inspect) {
  try {
    return inspect(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return true;
  }
}

const boardHasElements = (board) => (board.elements ?? []).some((element) => !element.isDeleted);
const hasComments = (comments) => (comments.pins ?? []).length > 0 || Boolean(comments.overall?.trim());

function boardFileHasWork(dir, name) {
  if (name.endsWith('.excalidraw')) return fileHasWork(join(dir, name), boardHasElements);
  if (name.endsWith('.comments.json')) return fileHasWork(join(dir, name), hasComments);
  return false;
}

// True when a closed window left a drawing, comments or a note worth coming back to.
export function hasDraftWork(workspaceId, surfaceId) {
  const data = surfaceDataDir(workspaceId, surfaceId);
  const boards = join(data, 'boards');
  return filesIn(boards).some((name) => boardFileHasWork(boards, name)) || filesIn(join(data, 'drafts')).length > 0;
}
