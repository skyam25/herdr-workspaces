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

// The host writes this when it loads a reopened sketch's seed, and deletes it at the first edit.
// See SeedWatch in surface/app/src/main/surface.ts.
const SEEDED_FILE = 'seeded.json';

// The board a seed filled and nobody has edited since, or null.
function unchangedSeed(data) {
  try {
    const seeded = JSON.parse(readFileSync(join(data, SEEDED_FILE), 'utf8'));
    return typeof seeded?.board === 'string' ? seeded.board : null;
  } catch {
    return null;
  }
}

function boardFileHasWork(dir, name, seeded) {
  if (seeded && (name === `${seeded}.excalidraw` || name === `${seeded}.comments.json`)) return false;
  if (name.endsWith('.excalidraw')) return fileHasWork(join(dir, name), boardHasElements);
  if (name.endsWith('.comments.json')) return fileHasWork(join(dir, name), hasComments);
  return false;
}

function hasAnswers(data) {
  if (!filesIn(data).includes(ANSWERS_FILE)) return false;
  return fileHasWork(join(data, ANSWERS_FILE), (file) => Object.values(file.answers ?? {}).some(isAnswered));
}

// The names of boards whose drawing or comments hold work, without `.excalidraw`.
export function boardsWithWork(workspaceId, surfaceId) {
  const data = surfaceDataDir(workspaceId, surfaceId);
  const boards = join(data, 'boards');
  const seeded = unchangedSeed(data);
  const names = filesIn(boards).filter((name) => boardFileHasWork(boards, name, seeded)).map((name) => name.replace(/\.(excalidraw|comments\.json)$/, ''));
  return [...new Set(names)];
}

// True when a closed window left a drawing, comments, a note or an answer worth coming back to.
// The cheap checks run first, and the board check stops at the first board with work.
export function hasDraftWork(workspaceId, surfaceId) {
  const data = surfaceDataDir(workspaceId, surfaceId);
  if (filesIn(join(data, 'drafts')).length > 0 || hasAnswers(data)) return true;
  const boards = join(data, 'boards');
  const seeded = unchangedSeed(data);
  return filesIn(boards).some((name) => boardFileHasWork(boards, name, seeded));
}
