import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { HwsError, UsageError } from '../errors.js';
import { requireLive } from '../herdr.js';
import { listManifests, writeJsonAtomic } from '../manifest.js';
import { surfaceDataDir } from '../paths.js';
import { ANSWERS_FILE, MAX_QUESTIONS, QUESTIONS_FILE, mergeRound, parseQuestionsText, readRound } from '../questions.js';
import { requireCallingTerminal } from '../resolve.js';
import { dropSurface, endHost, openSurface } from './surface.js';

const DEFAULT_TITLE = 'Questions';

function readAsked(flags) {
  if (flags.file) {
    const path = resolve(flags.file);
    if (!existsSync(path)) throw new HwsError(`no file ${path}`);
    return parseQuestionsText(readFileSync(path, 'utf8'), flags.file);
  }
  if (process.stdin.isTTY) throw new UsageError('pass --file or pipe the questions on stdin');
  return parseQuestionsText(readFileSync(0, 'utf8'), 'stdin');
}

// Ends the terminal's earlier rounds and returns them, with the newest one's questions, answers and folder.
// Their records stay until the new round is recorded.
async function endEarlierRounds(terminal) {
  const live = requireLive();
  const rounds = [];
  let held = { questions: [], answers: {} };
  let heldDir = null;
  for (const manifest of listManifests({ includeStandalone: true })) {
    for (const surface of manifest.surfaces.filter((item) => item.type === 'questions' && item.terminal === terminal)) {
      await endHost(live, surface);
      heldDir = surfaceDataDir(manifest.id, surface.id);
      held = readRound(heldDir);
      rounds.push({ manifest, surface });
    }
  }
  return { rounds, held, heldDir };
}

function writeRound(dataDir, { questions, answers }) {
  writeJsonAtomic(join(dataDir, QUESTIONS_FILE), { questions });
  writeJsonAtomic(join(dataDir, ANSWERS_FILE), { answers });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function askText(asked, kept, dropped, windowed) {
  const where = windowed ? 'in their own window' : 'in a pane beside this terminal';
  const keptLine = kept ? ` ${plural(kept, 'answered question', 'answered questions')} from the last round stay.` : '';
  const droppedLine = dropped ? ` ${plural(dropped, 'older answer', 'older answers')} left the round, which holds ${MAX_QUESTIONS} questions.` : '';
  return `Asked ${plural(asked, 'question', 'questions')} ${where}.${keptLine}${droppedLine} End the turn now. The answers arrive as your next prompt.`;
}

// Opens a round of questions beside the agent. Done sends the answers to it as one prompt.
// A round that fails to open puts the earlier round's questions and answers back.
export async function ask(flags) {
  const asked = readAsked(flags);
  const terminal = requireCallingTerminal(flags);

  const { rounds, held, heldDir } = await endEarlierRounds(terminal);
  const round = mergeRound(held, asked);
  const place = flags.window ? { window: true } : { 'in-pane': true };
  const title = flags.title?.trim() || DEFAULT_TITLE;
  let surface;
  try {
    ({ data: surface } = await openSurface({ type: 'questions', title, terminal, ...place }, { prepare: (dataDir) => writeRound(dataDir, round) }));
  } catch (error) {
    if (heldDir) writeRound(heldDir, held);
    throw error;
  }
  for (const earlier of rounds) {
    if (earlier.surface.id !== surface.id || earlier.manifest.id !== surface.workspace) dropSurface(earlier.manifest, earlier.surface);
  }
  const kept = round.questions.length - asked.length;
  return { data: { ...surface, asked: asked.length, kept, dropped: round.dropped }, text: askText(asked.length, kept, round.dropped, Boolean(flags.window)) };
}
