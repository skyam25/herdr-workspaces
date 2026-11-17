import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isTerminalAlive } from './herdr.js';
import { surfaceDataDir } from './paths.js';
import { ANSWERS_FILE, isAnswered } from './questions.js';

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

// The host writes this when it loads a reopened sketch's seed. See SEEDED_FILE in surface/app/src/main/surface.ts.
const SEEDED_FILE = 'seeded.json';

// Each live element as `id:version`, sorted, as the host's elementSignature computes it.
const elementSignature = (elements) =>
  elements
    .filter((element) => typeof element?.id === 'string' && !element.isDeleted)
    .map((element) => `${element.id}:${element.version || 1}`)
    .sort();

function readSeeded(data) {
  try {
    const seeded = JSON.parse(readFileSync(join(data, SEEDED_FILE), 'utf8'));
    return typeof seeded?.board === 'string' && Array.isArray(seeded.elements) ? seeded : null;
  } catch {
    return null;
  }
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A reopened sketch's board holds its seed until someone edits it, so an unchanged seed is no work.
function boardFileHasWork(dir, name, seeded) {
  const isSeeded = (ext) => seeded && name === `${seeded.board}${ext}`;
  if (name.endsWith('.excalidraw')) {
    return fileHasWork(join(dir, name), (board) => boardHasElements(board) && !(isSeeded('.excalidraw') && sameJson(elementSignature(board.elements), seeded.elements)));
  }
  if (name.endsWith('.comments.json')) {
    return fileHasWork(join(dir, name), (comments) => hasComments(comments) && !(isSeeded('.comments.json') && sameJson(comments, seeded.comments)));
  }
  return false;
}

function hasAnswers(data) {
  if (!filesIn(data).includes(ANSWERS_FILE)) return false;
  return fileHasWork(join(data, ANSWERS_FILE), (file) => Object.values(file.answers ?? {}).some(isAnswered));
}

// True when a closed window left a drawing, comments, a note or an answer worth coming back to.
export function hasDraftWork(workspaceId, surfaceId) {
  const data = surfaceDataDir(workspaceId, surfaceId);
  const boards = join(data, 'boards');
  const seeded = readSeeded(data);
  return filesIn(boards).some((name) => boardFileHasWork(boards, name, seeded)) || filesIn(join(data, 'drafts')).length > 0 || hasAnswers(data);
}
