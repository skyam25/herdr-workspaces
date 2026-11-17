import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { HwsError, UsageError } from '../errors.js';
import { requireLive } from '../herdr.js';
import { listManifests, writeJsonAtomic } from '../manifest.js';
import { surfaceDataDir } from '../paths.js';
import { ANSWERS_FILE, QUESTIONS_FILE, mergeRound, parseQuestionsText, readRound } from '../questions.js';
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

// Ends the terminal's earlier rounds and returns the newest one's questions and answers.
async function takeEarlierRounds(terminal) {
  const live = requireLive();
  let held = { questions: [], answers: {} };
  for (const manifest of listManifests({ includeStandalone: true })) {
    for (const surface of manifest.surfaces.filter((item) => item.type === 'questions' && item.terminal === terminal)) {
      await endHost(live, surface);
      held = readRound(surfaceDataDir(manifest.id, surface.id));
      dropSurface(manifest, surface);
    }
  }
  return held;
}

function writeRound(dataDir, { questions, answers }) {
  writeJsonAtomic(join(dataDir, QUESTIONS_FILE), { questions });
  writeJsonAtomic(join(dataDir, ANSWERS_FILE), { answers });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function askText(asked, kept, windowed) {
  const where = windowed ? 'in their own window' : 'in a pane beside this terminal';
  const keptLine = kept ? ` ${plural(kept, 'answered question', 'answered questions')} from the last round stay.` : '';
  return `Asked ${plural(asked, 'question', 'questions')} ${where}.${keptLine} End the turn now. The answers arrive as your next prompt.`;
}

// Opens a round of questions beside the agent. Done sends the answers to it as one prompt.
export async function ask(flags) {
  const asked = readAsked(flags);
  const terminal = requireCallingTerminal(flags);
  if (terminal.includes('/')) throw new HwsError(`surfaces run on this computer, and ${terminal} is on another machine`);

  const round = mergeRound(await takeEarlierRounds(terminal), asked);
  const place = flags.window ? { window: true } : { 'in-pane': true };
  const title = flags.title?.trim() || DEFAULT_TITLE;
  const { data: surface } = await openSurface({ type: 'questions', title, terminal, ...place }, { prepare: (dataDir) => writeRound(dataDir, round) });
  const kept = round.questions.length - asked.length;
  return { data: { ...surface, asked: asked.length, kept }, text: askText(asked.length, kept, Boolean(flags.window)) };
}
